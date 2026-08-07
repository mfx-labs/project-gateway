/**
 * WP-8-D single-writer lock (contract 12.3, LOK-001…018; ADR-029 D-3).
 *
 * Fixed per-namespace lock location `<namespace>/locks/writer.lock`
 * (LOK-004; `WRITER_LOCK_RELATIVE_PATH`). WP-8-D writes only `store-v1`, so
 * the exercised lock is `store-v1/locks/writer.lock`.
 *
 * Acquisition: `O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY` with explicit mode
 * `0600`, descriptor-bound `fstat` verification (regular file, configured
 * trusted service UID), bounded canonical lock-record bytes, file `fsync`,
 * locks-directory `fsync` (LOK-005). Bounded wait and deadline; contention,
 * timeout, and cancellation map to the closed lock codes; identity-bound
 * release verifies nonce + store instance, `unlink`s, and `fsync`s the
 * locks directory (LOK-013).
 *
 * WP-8-D NEVER classifies a lock stale and NEVER breaks, replaces, repairs,
 * or deletes a lock it does not positively own (LOK-007/008/009): malformed,
 * foreign, live, stale-looking, or indeterminate existing locks all fail
 * closed with ERR-STO-LOCK-UNAVAILABLE. Stale-lock recovery is phase 4.
 *
 * D-3 entropy/process exception: this exact module is the only storage
 * module allowed named `randomBytes` from `node:crypto` (contract-mandated
 * random per-acquisition nonce, 12.3) and `process.pid` (LOK-015). No
 * namespace/default/dynamic crypto imports; no UUID randomness helpers; no
 * `Math.random`; no `Date.now`; no `process.hrtime`; no environment-derived
 * entropy; no action-derived nonce; no production `/proc` read. Process
 * start time, the acquisition clock, and the optional boot identity are
 * injected bounded values supplied by the trusted composition root (never
 * by request payloads); the boot-identity field is reserved for phase-4
 * recovery parsing and is recorded absent in WP-8-D.
 *
 * Lock functions require a genuine capability operand; a structural object
 * is rejected before any filesystem access.
 */
import { openSync, closeSync, writeSync, readFileSync, fsyncSync, fstatSync, unlinkSync } from 'node:fs';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseRawJson } from '../../json/scanner.js';
import { jcsSerialize } from '../../canonical/jcs.js';
import { computeDomainDigest, isValidDigestSyntax, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { writeAllSync } from '../metadata/bootstrap-persist.js';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import { isGenuineWriteCapability, isGenuineRecoveryCapability, type CapabilityCheck, type RecoveryCapability, type WriteCapability } from '../capabilities/authenticity.js';

/**
 * WP-8-F: the single-writer lock is shared by the write path and the
 * authorized recovery-mutation path. Both capability kinds are genuine
 * mutation-capable brands; a structural object is rejected before any
 * filesystem access. The checked operation is the caller's closed
 * vocabulary ('record-publish' for writes, 'orphan-removal' for recovery
 * mutations).
 */
export type LockAuthority = WriteCapability | RecoveryCapability;
export type LockOperation =
  | 'record-publish'
  | 'orphan-removal'
  | 'quarantine-temporary'
  | 'audit-reconstruction'
  | 'registry-index-rebuild'
  | 'dispose-wpr023d-temporary'
  | 'dispose-quarantined-temporary'
  | 'dispose-conflicting-index'
  | 'break-writer-lock';

function isGenuineLockAuthority(value: unknown): value is LockAuthority {
  return isGenuineWriteCapability(value) || isGenuineRecoveryCapability(value);
}
import type { LockResult, LockTimeSource, WriterLockRecord } from '../types.js';

const { O_CREAT, O_EXCL, O_WRONLY, O_RDONLY, O_NOFOLLOW, O_NONBLOCK, O_DIRECTORY } = constants;

/** Lock-record format version (12.3 "lock version"). */
export const LOCK_VERSION = '1' as const;
/** Domain-separated digest domain for the trusted-action-identity safe reference. */
export const STORAGE_LOCK_ACTION_DIGEST_DOMAIN = 'PGAP-STORAGE-LOCK-ACTION-v1\u0000';
/** Bounded lock-record byte cap (transient state; not a normative limit). */
export const LOCK_RECORD_MAX_BYTES = 4096;

// WP-8-J (12.3.1/ADR-033): recovery-break guard and lock-instance identity.
/** Fixed recovery-break guard name under `locks/` (12.3.1; never a general writer lock). */
export const RECOVERY_BREAK_GUARD_NAME = 'recovery-break.guard' as const;
/** Guard record format version. */
export const LOCK_GUARD_VERSION = '1' as const;
/** Domain-separated lock-instance identity domain (non-authoritative binding; 12.3.1). */
export const STORAGE_WRITER_LOCK_INSTANCE_DOMAIN = 'PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1\u0000';

/** Canonical recovery-break guard record (12.3.1). */
export interface RecoveryBreakGuardRecord {
  readonly guardVersion: '1';
  readonly storeInstance: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
  /** Random per-acquisition nonce. */
  readonly nonce: string;
  /** Safe reference: domain digest of the trusted recovery action identity. */
  readonly actionIdentityDigest: string;
  readonly acquisitionTime: number;
}

/** Injectable fs/clock hooks for deterministic per-stage lock tests. */
export interface LockHooks {
  readonly fsyncFile?: (fd: number) => void;
  readonly fsyncDirectory?: (path: string) => void;
  readonly write?: (fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => number;
  readonly unlink?: (path: string) => void;
}

/** Deterministic mapping of an open/creation failure at the lock boundary. */
function mapLockError(code: string | undefined): { readonly code: string; readonly message: string } {
  switch (code) {
    case 'EROFS':
      return { code: 'ERR-STO-READONLY-FS', message: 'filesystem is read-only' };
    case 'ENOSPC':
      return { code: 'ERR-STO-NO-SPACE', message: 'capacity limit reached during lock creation' };
    case 'EDQUOT':
      return { code: 'ERR-STO-QUOTA-EXCEEDED', message: 'quota exceeded during lock creation' };
    case 'EACCES':
    case 'EPERM':
      return { code: 'ERR-STO-PERM-DENIED', message: 'permission denied at the lock boundary' };
    case 'ELOOP':
      return { code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'the lock path must not traverse a symbolic link' };
    default:
      return { code: 'ERR-STO-IO-FAILURE', message: 'lock boundary operation failed' };
  }
}

/** Canonical lock-record bytes (bounded; deterministic field order via JCS). */
export function canonicalLockRecordBytes(record: WriterLockRecord): string {
  return jcsSerialize(record);
}

/** Build the normative lock-record fields (12.3/LOK-005). */
export function buildLockRecord(input: {
  readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[];
  readonly actionIdentity: string;
  readonly serviceUid: number;
  readonly lockWaitMs: number;
  readonly timeSource: LockTimeSource;
}): WriterLockRecord {
  const nonce = randomBytes(16).toString('hex');
  const actionIdentityDigest = computeDomainDigest(STORAGE_LOCK_ACTION_DIGEST_DOMAIN, input.actionIdentity);
  if (!isValidDigestSyntax(actionIdentityDigest)) {
    throw new TypeError('action identity digest failed syntax check');
  }
  const record: WriterLockRecord = {
    lockVersion: LOCK_VERSION,
    storeInstance: input.storeInstance.map((n) => ({ kind: n.kind as 'configuration' | 'store-records', dev: n.dev, ino: n.ino })),
    nonce,
    actionIdentityDigest,
    pid: process.pid,
    processStartTime: input.timeSource.processStartTime,
    acquisitionTime: input.timeSource.now(),
    maxAgeMs: input.lockWaitMs,
    // The boot-identity field is reserved for phase-4 recovery; recorded only
    // when an injected source supplies it (absent in WP-8-D).
    ...(input.timeSource.bootIdentity !== undefined ? { bootIdentity: input.timeSource.bootIdentity } : {}),
  };
  return record;
}

function fsyncDirectory(path: string, hooks: LockHooks): void {
  const sync = hooks.fsyncDirectory;
  if (sync !== undefined) {
    sync(path);
    return;
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Descriptor-bound no-follow inspection of the lock location (LOK-008):
 * absent | present (regular file) | foreign (anything else). Never reads
 * record content; used to fail closed on any lock that cannot be positively
 * treated as the caller's own live acquisition.
 */
export function probeWriterLock(lockPath: string): LockResult {
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, O_RDONLY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return { ok: false, outcome: 'foreign-lock', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'lock location is not a regular file' };
    }
    return { ok: false, outcome: 'contention', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'writer lock is held or contended' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, outcome: 'acquired', message: 'lock location is free' };
    }
    const mapped = mapLockError((err as NodeJS.ErrnoException).code);
    return { ok: false, outcome: 'foreign-lock', code: mapped.code, message: mapped.message };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Acquire the writer lock (LOK-005/006/011/012/015). Requires a genuine
 * live write capability; the lock record carries the random nonce, the
 * store-instance identity, the trusted action identity digest, PID,
 * process start time, optional boot identity, acquisition time, and max
 * age. `EEXIST` is contention: with an injected wait/clock, acquisition
 * retries within `lockWait` and fails with ERR-STO-LOCK-TIMEOUT; without a
 * wait hook it fails immediately with ERR-STO-LOCK-UNAVAILABLE. Cancellation
 * during the wait fails with ERR-STO-CANCELLED and leaves no partial state.
 */
export function acquireWriterLock(input: {
  readonly capability: LockAuthority;
  /** Closed operation vocabulary of the caller's mutation boundary. */
  readonly operation?: LockOperation;
  readonly lockPath: string;
  readonly locksDirPath: string;
  readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[];
  readonly actionIdentity: string;
  readonly lockWaitMs: number;
  readonly timeSource: LockTimeSource;
  readonly hooks?: LockHooks;
}): LockResult {
  const operation = input.operation ?? 'record-publish';
  // The capability operand must be genuine BEFORE any method call or
  // filesystem access (CAP-007): a structural object with a forged verify()
  // is rejected here.
  if (!isGenuineLockAuthority(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'lock capability operand is not genuine' };
  }
  // The brand check above guarantees a genuine mutation-capable capability;
  // widen the verify call (both brands re-check their own brand inside).
  const check = (input.capability as { verify(op: string): CapabilityCheck }).verify(operation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'capability is not usable at the lock boundary' };
  }
  const serviceUid = input.capability.binding.serviceUid;
  const record = buildLockRecord({
    storeInstance: input.storeInstance,
    actionIdentity: input.actionIdentity,
    serviceUid,
    lockWaitMs: input.lockWaitMs,
    timeSource: input.timeSource,
  });
  const bytes = Buffer.from(canonicalLockRecordBytes(record), 'utf8');
  if (bytes.length > LOCK_RECORD_MAX_BYTES) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'lock record exceeds the bounded size' };
  }
  const hooks = input.hooks ?? {};
  const syncFile = hooks.fsyncFile ?? fsyncSync;
  const writeBytes = hooks.write ?? ((fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => writeSync(fd, buf, off, len, pos));
  const unlinkPath = hooks.unlink ?? ((p: string) => unlinkSync(p));
  const startedAt = input.timeSource.now();
  const deadline = startedAt + input.lockWaitMs;
  let fd: number | undefined;
  // First attempt.
  try {
    fd = openSync(input.lockPath, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      // An existing object at the lock path: classify it before failing
      // closed. A regular file is live-lock contention; anything else
      // (symlink, directory, special file, unverifiable) is a foreign lock
      // that WP-8-D never breaks (LOK-008/009).
      const probe = probeWriterLock(input.lockPath);
      if (!probe.ok && probe.outcome === 'foreign-lock') {
        return { ok: false, outcome: 'foreign-lock', code: probe.code ?? 'ERR-STO-FTYPE-UNSUPPORTED', message: probe.message ?? 'foreign object at the lock location' };
      }
      // Contention: bounded wait only when the composition injects a wait
      // primitive and a clock; otherwise fail closed immediately.
      if (input.timeSource.wait !== undefined) {
        while (input.timeSource.now() < deadline) {
          if (input.timeSource.cancelled?.() === true) {
            return { ok: false, outcome: 'cancelled', code: 'ERR-STO-CANCELLED', message: 'lock acquisition cancelled' };
          }
          input.timeSource.wait(1);
          try {
            fd = openSync(input.lockPath, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
            break;
          } catch (again) {
            if ((again as NodeJS.ErrnoException).code !== 'EEXIST') {
              const mapped = mapLockError((again as NodeJS.ErrnoException).code);
              return { ok: false, outcome: 'foreign-lock', code: mapped.code, message: mapped.message };
            }
          }
        }
        if (fd === undefined) {
          return { ok: false, outcome: 'timeout', code: 'ERR-STO-LOCK-TIMEOUT', message: 'lock wait exceeded the bounded limit' };
        }
      } else {
        return { ok: false, outcome: 'contention', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'writer lock is held or contended' };
      }
    } else {
      const mapped = mapLockError(code);
      return { ok: false, outcome: 'foreign-lock', code: mapped.code, message: mapped.message };
    }
  }
  const fileFd = fd;
  try {
    const preStat = fstatSync(fileFd);
    const verified = verifyRegularFileStat(preStat, serviceUid);
    if (!verified.ok) {
      unlinkPath(input.lockPath);
      return { ok: false, code: verified.code, message: verified.message };
    }
    if (!writeAllSync(bytes, (buf, off, len, pos) => writeBytes(fileFd, buf, off, len, pos))) {
      unlinkPath(input.lockPath);
      return { ok: false, code: 'ERR-STO-DURABILITY', message: 'lock record write did not complete' };
    }
    const postStat = fstatSync(fileFd);
    if (postStat.size !== bytes.length) {
      unlinkPath(input.lockPath);
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'lock record size does not match canonical bytes' };
    }
    syncFile(fileFd);
    closeSync(fileFd);
    fd = undefined;
    fsyncDirectory(input.locksDirPath, hooks);
    return { ok: true, outcome: 'acquired', record };
  } catch {
    // The lock file may exist and may be partially durable; it is transient
    // state, never trusted state. Attempt to remove the exact file this
    // acquisition created; failure leaves it for phase-4 recovery handling.
    try {
      unlinkPath(input.lockPath);
    } catch {
      // ignore: recovery phase classifies the leftover lock (LOK-014).
    }
    return { ok: false, outcome: 'foreign-lock', code: 'ERR-STO-IO-FAILURE', message: 'lock acquisition could not be completed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Identity-bound release (LOK-013): verify the lock record's nonce and
 * store-instance identity against the caller's own acquisition, unlink the
 * exact path, and `fsync` the locks directory. A lock whose record cannot
 * be positively verified as the caller's own is never touched.
 */
export function releaseWriterLock(input: {
  readonly capability: LockAuthority;
  /** Closed operation vocabulary of the caller's mutation boundary. */
  readonly operation?: LockOperation;
  readonly lockPath: string;
  readonly locksDirPath: string;
  readonly expected: { readonly nonce: string; readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[] };
  readonly timeSource: LockTimeSource;
  readonly hooks?: LockHooks;
}): LockResult {
  const operation = input.operation ?? 'record-publish';
  // The capability operand must be genuine BEFORE any method call or
  // filesystem access (CAP-007).
  if (!isGenuineLockAuthority(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'lock capability operand is not genuine' };
  }
  // The brand check above guarantees a genuine mutation-capable capability;
  // widen the verify call (both brands re-check their own brand inside).
  const check = (input.capability as { verify(op: string): CapabilityCheck }).verify(operation);
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'capability is not usable at the release boundary' };
  }
  const serviceUid = input.capability.binding.serviceUid;
  let fd: number | undefined;
  try {
    fd = openSync(input.lockPath, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, serviceUid);
    if (!verified.ok) {
      return { ok: false, outcome: 'not-owned', code: verified.code, message: verified.message };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) {
      return { ok: false, outcome: 'not-owned', code: revalidated.code, message: revalidated.message };
    }
    if (post.size !== bytes.length) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-INTEGRITY', message: 'lock record changed during descriptor-based read' };
    }
    closeSync(fd);
    fd = undefined;
    let model: unknown;
    try {
      model = parseRawJson(bytes, LOCK_RECORD_MAX_BYTES).model;
    } catch {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-MALFORMED', message: 'lock record is not canonical JSON' };
    }
    if (typeof model !== 'object' || model === null || Array.isArray(model)) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-MALFORMED', message: 'lock record must be a JSON object' };
    }
    const raw = bytes.toString('utf8');
    if (jcsSerialize(model) !== raw) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-MALFORMED', message: 'lock record bytes are not canonical' };
    }
    const record = model as Readonly<Record<string, unknown>>;
    if (record['lockVersion'] !== LOCK_VERSION) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-MALFORMED', message: 'lock record version is not supported' };
    }
    if (record['nonce'] !== input.expected.nonce) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'lock nonce does not match the caller acquisition' };
    }
    const stored = record['storeInstance'];
    if (!Array.isArray(stored) || stored.length !== input.expected.storeInstance.length) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'lock store instance does not match' };
    }
    for (let i = 0; i < stored.length; i++) {
      const s = stored[i] as Readonly<Record<string, unknown>> | null | undefined;
      const e = input.expected.storeInstance[i]!;
      if (s === null || typeof s !== 'object' || s['kind'] !== e.kind || s['dev'] !== e.dev || s['ino'] !== e.ino) {
        return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'lock store instance does not match' };
      }
    }
    const unlinkPath = input.hooks?.unlink ?? ((p: string) => unlinkSync(p));
    unlinkPath(input.lockPath);
    fsyncDirectory(input.locksDirPath, input.hooks ?? {});
    return { ok: true, outcome: 'released', record: record as unknown as WriterLockRecord };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'lock file is absent; ownership cannot be verified' };
    }
    const mapped = mapLockError((err as NodeJS.ErrnoException).code);
    return { ok: false, outcome: 'not-owned', code: mapped.code, message: mapped.message };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ── WP-8-J: recovery-break guard and instance-bound lock removal (12.3.1) ──

/** Canonical recovery-break guard bytes (deterministic field order via JCS). */
export function canonicalLockRecoveryGuardBytes(record: RecoveryBreakGuardRecord): string {
  return jcsSerialize(record);
}

/** Build the normative recovery-break guard record (12.3.1/ADR-033). */
export function buildLockRecoveryGuardRecord(input: {
  readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[];
  readonly actionIdentity: string;
  readonly timeSource: LockTimeSource;
}): RecoveryBreakGuardRecord {
  const nonce = randomBytes(16).toString('hex');
  const actionIdentityDigest = computeDomainDigest(STORAGE_LOCK_ACTION_DIGEST_DOMAIN, input.actionIdentity);
  if (!isValidDigestSyntax(actionIdentityDigest)) {
    throw new TypeError('action identity digest failed syntax check');
  }
  return {
    guardVersion: LOCK_GUARD_VERSION,
    storeInstance: input.storeInstance.map((n) => ({ kind: n.kind as 'configuration' | 'store-records', dev: n.dev, ino: n.ino })),
    nonce,
    actionIdentityDigest,
    acquisitionTime: input.timeSource.now(),
  };
}

/**
 * Deterministic non-authoritative lock-instance identity (12.3.1; ADR-033):
 * domain digest over (store identity, fixed lock name, canonical lock-record
 * digest). The random per-acquisition nonce makes the record digest unique
 * per instance, so the instance identity is a stable non-secret binding for
 * the trusted request and the recovery evidence. It grants no authority and
 * never discloses the nonce.
 */
export function computeWriterLockInstanceIdentity(input: {
  readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[];
  readonly lockRecordDigest: string;
}): string {
  const tuple = {
    storeInstance: [...input.storeInstance]
      .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    lockName: 'writer.lock',
    lockRecordDigest: input.lockRecordDigest,
  };
  const digest = computeDomainDigest(STORAGE_WRITER_LOCK_INSTANCE_DOMAIN, jcsSerialize(tuple));
  return `pgw:r:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Descriptor-bound no-follow read of one lock-like object with canonical parse. */
function readLockObject(input: {
  readonly path: string;
  readonly serviceUid: number;
}): { readonly ok: boolean; readonly raw?: string; readonly digest?: string; readonly dev?: number; readonly ino?: number; readonly nlink?: number; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    if (!pre.isFile()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'lock location is not a regular file' };
    }
    if (pre.uid !== input.serviceUid || (pre.mode & 0o777) !== 0o600) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'lock object violates the store permission policy' };
    }
    if (pre.size > LOCK_RECORD_MAX_BYTES) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'lock object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'lock object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    let model: unknown;
    try {
      model = parseRawJson(raw, LOCK_RECORD_MAX_BYTES).model;
    } catch {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'lock object is not canonical JSON' };
    }
    if (typeof model !== 'object' || model === null || Array.isArray(model) || jcsSerialize(model) !== raw) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'lock object bytes are not canonical' };
    }
    return {
      ok: true,
      raw,
      digest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw),
      dev: Number(pre.dev),
      ino: Number(pre.ino),
      nlink: Number(pre.nlink),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'lock object is absent' };
    }
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EISDIR') {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'lock location is not a regular file' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'lock object could not be read' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Acquire the recovery-break guard (12.3.1; LOK-020/ADR-033): exclusive
 * creation of `locks/recovery-break.guard` with a canonical guard record,
 * file fsync, and locks-directory fsync. The guard cannot coexist with
 * another lock-break attempt (EEXIST fails closed) and is never acquired by
 * writers. The caller's capability must verify the exact
 * `break-writer-lock` operation.
 */
export function acquireRecoveryBreakGuard(input: {
  readonly capability: LockAuthority;
  readonly lockPath: string;
  readonly locksDirPath: string;
  readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[];
  readonly actionIdentity: string;
  readonly timeSource: LockTimeSource;
  readonly hooks?: LockHooks;
}): LockResult {
  if (!isGenuineLockAuthority(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery-break guard capability operand is not genuine' };
  }
  const check = (input.capability as { verify(op: string): CapabilityCheck }).verify('break-writer-lock');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'capability is not usable at the recovery-break guard boundary' };
  }
  const serviceUid = input.capability.binding.serviceUid;
  const record = buildLockRecoveryGuardRecord({
    storeInstance: input.storeInstance,
    actionIdentity: input.actionIdentity,
    timeSource: input.timeSource,
  });
  const bytes = Buffer.from(canonicalLockRecoveryGuardBytes(record), 'utf8');
  if (bytes.length > LOCK_RECORD_MAX_BYTES) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'recovery-break guard record exceeds the bounded size' };
  }
  const hooks = input.hooks ?? {};
  const syncFile = hooks.fsyncFile ?? fsyncSync;
  const writeBytes = hooks.write ?? ((fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => writeSync(fd, buf, off, len, pos));
  const unlinkPath = hooks.unlink ?? ((p: string) => unlinkSync(p));
  let fd: number | undefined;
  try {
    fd = openSync(input.lockPath, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, outcome: 'contention', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'another lock-recovery break is in progress; the recovery-break guard is held' };
    }
    const mapped = mapLockError((err as NodeJS.ErrnoException).code);
    return { ok: false, outcome: 'foreign-lock', code: mapped.code, message: mapped.message };
  }
  const guardFd = fd;
  try {
    const preStat = fstatSync(guardFd);
    const verified = verifyRegularFileStat(preStat, serviceUid);
    if (!verified.ok) {
      unlinkPath(input.lockPath);
      return { ok: false, code: verified.code, message: verified.message };
    }
    if (!writeAllSync(bytes, (buf, off, len, pos) => writeBytes(guardFd, buf, off, len, pos))) {
      unlinkPath(input.lockPath);
      return { ok: false, code: 'ERR-STO-DURABILITY', message: 'recovery-break guard write did not complete' };
    }
    const postStat = fstatSync(guardFd);
    if (postStat.size !== bytes.length) {
      unlinkPath(input.lockPath);
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'recovery-break guard size does not match canonical bytes' };
    }
    syncFile(guardFd);
    closeSync(guardFd);
    fd = undefined;
    fsyncDirectory(input.locksDirPath, hooks);
    return { ok: true, outcome: 'acquired', record: record as unknown as WriterLockRecord };
  } catch {
    try {
      unlinkPath(input.lockPath);
    } catch {
      // ignore: recovery classifies the leftover guard (12.3.1).
    }
    return { ok: false, outcome: 'foreign-lock', code: 'ERR-STO-IO-FAILURE', message: 'recovery-break guard acquisition could not be completed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Identity-bound guard release (12.3.1): verify the guard record's nonce and
 * store-instance identity, unlink the exact guard name, and fsync the locks
 * directory. A guard that cannot be positively verified as the caller's own
 * is never touched.
 */
export function releaseRecoveryBreakGuard(input: {
  readonly capability: LockAuthority;
  readonly lockPath: string;
  readonly locksDirPath: string;
  readonly expected: { readonly nonce: string; readonly storeInstance: readonly { readonly kind: string; readonly dev: number; readonly ino: number }[] };
  readonly hooks?: LockHooks;
}): LockResult {
  if (!isGenuineLockAuthority(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery-break guard capability operand is not genuine' };
  }
  const check = (input.capability as { verify(op: string): CapabilityCheck }).verify('break-writer-lock');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'capability is not usable at the recovery-break guard release boundary' };
  }
  const serviceUid = input.capability.binding.serviceUid;
  const read = readLockObject({ path: input.lockPath, serviceUid });
  if (!read.ok || read.raw === undefined) {
    return { ok: false, outcome: 'not-owned', code: read.code ?? 'ERR-STO-INTEGRITY', message: read.message ?? 'recovery-break guard could not be verified' };
  }
  let model: unknown;
  try {
    model = parseRawJson(read.raw, LOCK_RECORD_MAX_BYTES).model;
  } catch {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-MALFORMED', message: 'recovery-break guard record is not canonical JSON' };
  }
  const record = model as Readonly<Record<string, unknown>>;
  if (record['guardVersion'] !== LOCK_GUARD_VERSION) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-MALFORMED', message: 'recovery-break guard version is not supported' };
  }
  if (record['nonce'] !== input.expected.nonce) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'recovery-break guard nonce does not match the caller acquisition' };
  }
  const stored = record['storeInstance'];
  if (!Array.isArray(stored) || stored.length !== input.expected.storeInstance.length) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'recovery-break guard store instance does not match' };
  }
  for (let i = 0; i < stored.length; i++) {
    const s = stored[i] as Readonly<Record<string, unknown>> | null | undefined;
    const e = input.expected.storeInstance[i]!;
    if (s === null || typeof s !== 'object' || s['kind'] !== e.kind || s['dev'] !== e.dev || s['ino'] !== e.ino) {
      return { ok: false, outcome: 'not-owned', code: 'ERR-STO-LOCK-UNAVAILABLE', message: 'recovery-break guard store instance does not match' };
    }
  }
  const unlinkPath = input.hooks?.unlink ?? ((p: string) => unlinkSync(p));
  unlinkPath(input.lockPath);
  fsyncDirectory(input.locksDirPath, input.hooks ?? {});
  return { ok: true, outcome: 'released' };
}

/**
 * Instance-bound writer-lock removal (12.3.1; LOK-021/ADR-033): descriptor
 * read of the exact lock name, canonical parse, and the FINAL recheck of
 * the exact lock-record digest, descriptor identity (dev/ino), and link
 * count against the verified facts; then unlink of exactly that one name,
 * absence verification, and locks-directory fsync. A replacement lock
 * (different digest — the per-acquisition nonce makes byte equality
 * impossible for a new acquisition), a reappearing name, a malformed,
 * foreign, or changed object fails closed before any removal or after it
 * (absence check). The caller holds the recovery-break guard for the whole
 * break, so no second breaker can span this window.
 */
export function unlinkVerifiedWriterLock(input: {
  readonly capability: LockAuthority;
  readonly lockPath: string;
  readonly locksDirPath: string;
  readonly serviceUid: number;
  /** Verified lock facts from the current-state re-verification (digest + descriptor). */
  readonly expected: { readonly recordDigest: string; readonly dev: number; readonly ino: number; readonly nlink: number };
  readonly hooks?: LockHooks;
}): LockResult {
  if (!isGenuineLockAuthority(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'lock-removal capability operand is not genuine' };
  }
  const check = (input.capability as { verify(op: string): CapabilityCheck }).verify('break-writer-lock');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'capability is not usable at the lock-removal boundary' };
  }
  const read = readLockObject({ path: input.lockPath, serviceUid: input.serviceUid });
  if (!read.ok) {
    return { ok: false, outcome: 'not-owned', code: read.code ?? 'ERR-STO-INTEGRITY', message: read.message ?? 'writer lock could not be re-verified before removal' };
  }
  if (read.digest !== input.expected.recordDigest) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-INTEGRITY', message: 'writer lock record digest does not match the adjudicated instance; fail closed' };
  }
  if (read.dev !== input.expected.dev || read.ino !== input.expected.ino) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-INTEGRITY', message: 'writer lock inode changed since re-verification; fail closed' };
  }
  if (read.nlink !== input.expected.nlink) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-INTEGRITY', message: 'writer lock link count changed since re-verification; fail closed' };
  }
  const unlinkPath = input.hooks?.unlink ?? ((p: string) => unlinkSync(p));
  try {
    unlinkPath(input.lockPath);
  } catch (err) {
    const mapped = mapLockError((err as NodeJS.ErrnoException).code);
    return { ok: false, outcome: 'not-owned', code: mapped.code, message: mapped.message };
  }
  // Absence verification: the exact name must no longer resolve. A
  // reappearing or replaced name fails closed (LOK-021): a legitimate new
  // writer lock created after this removal is never removed again.
  const after = readLockObject({ path: input.lockPath, serviceUid: input.serviceUid });
  if (after.ok) {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-INTEGRITY', message: 'writer lock name reappeared immediately after removal; fail closed' };
  }
  if (after.code !== 'ERR-STO-NOT-FOUND') {
    return { ok: false, outcome: 'not-owned', code: after.code ?? 'ERR-STO-INTEGRITY', message: 'writer lock name state is uncertain after removal; fail closed' };
  }
  return { ok: true, outcome: 'released' };
}

/** fsync the locks directory descriptor-bound (12.3.1; the composition
 * boundary orders this after the unlink and before evidence publication). */
export function fsyncLocksDirectory(input: { readonly locksDirPath: string; readonly serviceUid: number; readonly hooks?: LockHooks }): LockResult {
  try {
    fsyncDirectory(input.locksDirPath, input.hooks ?? {});
    return { ok: true, outcome: 'released' };
  } catch {
    return { ok: false, outcome: 'not-owned', code: 'ERR-STO-IO-FAILURE', message: 'locks directory fsync failed' };
  }
}
