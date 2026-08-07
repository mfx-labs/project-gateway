/**
 * WP-8-D immutable record publication substrate (contract 10.1, WPR-001…023,
 * DS-21; ADR-029). The single owner of the hard-link publication primitive.
 *
 * Protocol (normative order): exclusive no-follow temporary creation under
 * the verified `tmp/` → bounded write-all loop with zero-progress detection
 * → descriptor type/UID/mode/size verification → temporary `fsync` →
 * capability revalidation → hard-link no-replace publication (`link(2)`),
 * `EEXIST` classified per 10.2/18.2 → final-object identity/link verification
 * → final-record-directory `fsync` → exact-own-temp `unlink` → `tmp/`
 * directory `fsync`. Plain `rename` is prohibited; no overwrite, no adoption,
 * no rollback of durable state.
 *
 * Same-action deterministic temporary-name `EEXIST` (MINOR-2 resolution):
 * the existing object is never adopted, reopened for writing, or unlinked as
 * newly owned; it is inspected only through bounded no-follow descriptor
 * facts, and the retry outcome is decided by final-target (primary + audit)
 * verification performed by the composition boundary.
 *
 * Every mutation boundary revalidates the still-live genuine write
 * capability.
 */
import { openSync, closeSync, writeSync, fsyncSync, fchmodSync, fstatSync, linkSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { parsePersistedEnvelope, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { classifyExistingTarget, type ExistingTargetClass } from '../errors/precedence.js';
import { deriveRecordRelativePath, deriveRegistryIndexRelativePath, REGISTRY_INDEX_FAMILY } from '../layout/layout.js';
import { parseRegistryIndex, validateRegistryIndexSelfConsistency, REGISTRY_INDEX_MAX_ENTRIES } from '../registry/index-model.js';
import { writeAllSync } from '../metadata/bootstrap-persist.js';
import { comparePrePostStat, verifyDirectoryStat, verifyRegularFileStat } from '../root/identity.js';
import { isGenuineWriteCapability, isGenuineRecoveryPublicationPermit, recoveryPublicationPermitLive, type RecoveryPublicationPermit, type WriteCapability } from '../capabilities/authenticity.js';
import { RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND } from '../audit/write-audit.js';
import type { PublicationHooks, RecordClassId } from '../types.js';

const { O_CREAT, O_EXCL, O_WRONLY, O_RDONLY, O_NOFOLLOW, O_DIRECTORY } = constants;

/** Domain-separated deterministic temporary-name domain (WPR-003 pattern). */
export const STORAGE_PUBLICATION_TEMP_DOMAIN = 'PGAP-STORAGE-PUBLICATION-TEMP-v1\u0000';

/** Deterministic per-action temporary name: action-digest prefix + bounded ordinal. */
export function publicationTempName(actionIdentity: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 0xffff) {
    throw new RangeError('per-action publication ordinal out of bounds');
  }
  const digest = computeDomainDigest(STORAGE_PUBLICATION_TEMP_DOMAIN, actionIdentity);
  return `pub-${digest.slice('sha-256:'.length, 'sha-256:'.length + 16)}-${ordinal.toString(16)}`;
}

export interface PublishStageResult {
  readonly ok: boolean;
  readonly outcome?: 'published' | 'idempotent-duplicate' | 'duplicate' | 'conflict-revision' | 'temp-exists' | 'failed';
  readonly code?: string;
  readonly message?: string;
  /** Final object identity (dev/ino) when the link exists. */
  readonly finalIdentity?: { readonly dev: number; readonly ino: number };
}

export interface ExistingTargetVerification {
  readonly ok: boolean;
  readonly classification?: ExistingTargetClass;
  readonly code?: string;
  readonly message?: string;
}

/** Deterministic native-error mapping at the publication boundary (WPR-015, FSL-008). */
export function mapPublishError(code: string | undefined, stage: 'temp' | 'link' | 'dir'): { readonly code: string; readonly message: string } {
  switch (code) {
    case 'EROFS':
      return { code: 'ERR-STO-READONLY-FS', message: 'filesystem is read-only' };
    case 'ENOSPC':
      return { code: 'ERR-STO-NO-SPACE', message: 'capacity limit reached during publication' };
    case 'EDQUOT':
      return { code: 'ERR-STO-QUOTA-EXCEEDED', message: 'quota exceeded during publication' };
    case 'EXDEV':
      return { code: 'ERR-STO-CROSS-DEVICE', message: 'cross-device condition during publication' };
    case 'EOPNOTSUPP':
    case 'ENOTSUP':
      return { code: 'ERR-STO-FS-UNSUPPORTED', message: 'the filesystem lacks the required publication primitive' };
    case 'EACCES':
    case 'EPERM':
      return { code: 'ERR-STO-PERM-DENIED', message: 'permission denied at the publication boundary' };
    case 'ELOOP':
      return { code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'publication paths must not traverse a symbolic link' };
    case 'ENOTDIR':
    case 'ENOENT':
      return { code: 'ERR-STO-CONTAINMENT-DENIED', message: 'a derived publication path component is missing or not a directory' };
    default:
      return { code: 'ERR-STO-IO-FAILURE', message: 'publication boundary operation failed' };
  }
}

function fsyncDirectory(path: string, hooks: PublicationHooks): void {
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
 * Class/shard directory provisioning (ADR-029 D-7/M-1): create only the
 * exact derived directories
 * `<ns>/records/<class-segment>/<shard>` or `<ns>/audit/audit-event/<shard>`
 * for a validated class and canonical identifier, under the genuine live
 * write capability AFTER writer-lock acquisition. The class comes from the
 * closed validated taxonomy; the segment from the accepted layout
 * derivation; the shard is the exact canonical four-lowercase-hex value from
 * the validated record identity. No raw path operand; no arbitrary segment
 * or shard; no other capability may create these targets. `EEXIST` enters
 * descriptor verification (exact directory → idempotent continue; invalid →
 * fail closed); no repair, chown, deletion, or adoption.
 */
export function ensureClassShardDirectories(input: {
  readonly capability: WriteCapability;
  readonly namespaceRoot: string;
  readonly recordClass: RecordClassId;
  readonly rawIdentifier: string;
  readonly serviceUid: number;
}): PublishStageResult {
  // WP-8-F correction: the generic substrate accepts WRITE authority only;
  // a recovery capability (or any other brand) is rejected before any
  // filesystem access. Recovery publication provisions through the exact
  // permit-bound entry point only.
  if (!isGenuineWriteCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'write capability operand is not genuine' };
  }
  const check = input.capability.verify('record-publish');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'write capability is not usable at the class/shard boundary' };
  }
  return ensureClassShardDirectoriesFor(input.namespaceRoot, input.recordClass, input.rawIdentifier, input.serviceUid);
}

/**
 * Module-private class/shard provisioning (write path and the exact-record
 * recovery entry point; authority is checked by the caller before this runs).
 */
function ensureClassShardDirectoriesFor(namespaceRoot: string, recordClass: RecordClassId, rawIdentifier: string, serviceUid: number): PublishStageResult {
  const derived = deriveRecordRelativePath(recordClass, rawIdentifier);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'record path derivation failed' };
  }
  // derived.relativePath is `records/<segment>/<shard>/<file>` or
  // `audit/<segment>/<shard>/<file>`; the top-level `records`/`audit`
  // directories are provisioned by the phase-3 top-level step.
  const topLevel = derived.relativePath.startsWith('audit/') ? 'audit' : 'records';
  const classDir = `${namespaceRoot}/${topLevel}/${derived.classSegment}`;
  const shardDir = `${classDir}/${derived.shard}`;
  const dirs = [classDir, shardDir];
  for (const dir of dirs) {
    let created = false;
    try {
      mkdirSync(dir, 0o700);
      created = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'dir');
        return { ok: false, code: mapped.code, message: mapped.message };
      }
    }
    let fd: number | undefined;
    try {
      fd = openSync(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      const stat = fstatSync(fd);
      const verified = verifyDirectoryStat(stat, serviceUid);
      if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
      if (created) {
        fchmodSync(fd, 0o700);
        const after = fstatSync(fd);
        const modeCheck = verifyDirectoryStat(after, serviceUid);
        if (!modeCheck.ok) return { ok: false, code: modeCheck.code, message: modeCheck.message };
        fsyncSync(fd);
      }
    } catch {
      return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'class/shard directory could not be verified descriptor-bound' };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return { ok: true };
}

/**
 * WP-8-H exact registry-index family provisioning (ADR-031): lazily create
 * `index/`, `index/registry-index/`, and the exact bound shard under the
 * writer lock with exact fixed-directory verification (no-follow; expected
 * UID; exact directory mode; same verified namespace filesystem). `index/`
 * is a deferred top-level directory (provision.ts State D), so the chain
 * is created here; every created entry's PARENT is fsynced in deterministic
 * order (namespace root, `index/`, `index/registry-index/`). Absent
 * directories may be created; existing directories must be verified; a
 * symlink, special file, wrong UID, wrong mode, or replacement fails
 * closed. No arbitrary caller-provided directory creation exists.
 */
function ensureRegistryIndexDirectoriesFor(namespaceRoot: string, indexId: string, serviceUid: number, hooks: PublicationHooks | undefined): PublishStageResult {
  const derived = deriveRegistryIndexRelativePath(indexId);
  if (!derived.ok) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'registry-index path derivation failed' };
  }
  const dirs = [
    `${namespaceRoot}/index`,
    `${namespaceRoot}/index/${REGISTRY_INDEX_FAMILY}`,
    `${namespaceRoot}/index/${REGISTRY_INDEX_FAMILY}/${derived.shard}`,
  ];
  const createdParents: string[] = [];
  for (const dir of dirs) {
    let createdNow = false;
    try {
      mkdirSync(dir, 0o700);
      createdNow = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'dir');
        return { ok: false, code: mapped.code, message: mapped.message };
      }
    }
    let fd: number | undefined;
    try {
      fd = openSync(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      const stat = fstatSync(fd);
      const verified = verifyDirectoryStat(stat, serviceUid);
      if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
      if (createdNow) {
        createdParents.push(dir.slice(0, dir.lastIndexOf('/')));
      }
    } catch {
      return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'registry-index directory could not be verified descriptor-bound' };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  for (const parent of createdParents) {
    fsyncDirectory(parent, hooks ?? {});
  }
  return { ok: true };
}

/** Descriptor-bound no-follow inspection of an existing temporary object (MINOR-2). */
export function inspectTempObject(input: {
  readonly tmpPath: string;
  readonly serviceUid: number;
}): PublishStageResult {
  let fd: number | undefined;
  try {
    fd = openSync(input.tmpPath, O_RDONLY | O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      // Wrong type (directory, symlink, FIFO, socket, device): fail closed
      // with the file-type code (FSP-005) before any content checks.
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'temporary location is not a regular file' };
    }
    if (stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'temporary object policy does not match the store' };
    }
    // A regular file with the store policy at the deterministic temp name:
    // plausible leftover of the same action, but ownership is NOT claimed.
    return { ok: true, outcome: 'temp-exists' };
  } catch (err) {
    const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'temp');
    return { ok: false, code: mapped.code, message: mapped.message };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Descriptor-bound verification of a final object's canonical bytes and
 * digest (used for existing-target classification and the retry protocol's
 * primary/audit verification). Never mutates; wrong type/UID/mode fails
 * closed; absent maps to NOT-FOUND.
 */
export function verifyObjectBytesAt(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): { readonly ok: boolean; readonly canonicalUtf8?: string; readonly digest?: string; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const verified = verifyRegularFileStat(pre, input.serviceUid);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (pre.size > input.byteLimit) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) return { ok: false, code: revalidated.code, message: revalidated.message };
    if (post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    // Canonical parse (duplicate-key rejection + envelope validation + canonical bytes).
    const parsed = parsePersistedEnvelope(raw, input.byteLimit);
    if (!parsed.ok || parsed.bytes === undefined) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'object is not a canonical record envelope' };
    }
    return { ok: true, canonicalUtf8: parsed.bytes.canonicalUtf8, digest: parsed.bytes.digest };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'object is absent' };
    }
    const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'temp');
    return { ok: false, code: mapped.code, message: mapped.message };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Verify an existing final target and classify it per 10.2/18.2 (WPR-006/019).
 * The caller MUST pass the fully verified expected record facts; the
 * existing object is read descriptor-bound and compared canonically.
 */
export function classifyExistingTargetObject(input: {
  readonly finalPath: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
  readonly expectedRecordId: string;
  readonly expectedRevision: number;
  readonly expectedCanonicalUtf8: string;
  readonly expectedDigest: string;
}): ExistingTargetVerification {
  const existing = verifyObjectBytesAt({ path: input.finalPath, serviceUid: input.serviceUid, byteLimit: input.byteLimit });
  if (!existing.ok) {
    return { ok: false, code: existing.code, message: existing.message };
  }
  const parsed = parsePersistedEnvelope(existing.canonicalUtf8 ?? '', input.byteLimit);
  if (!parsed.ok || parsed.model === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'existing target is not a canonical record envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  const classification = classifyExistingTarget({
    sameIdentifier: model['recordId'] === input.expectedRecordId,
    identicalCanonicalBytes: existing.canonicalUtf8 === input.expectedCanonicalUtf8,
    digestMatches: existing.digest === input.expectedDigest,
    sameRevision: model['revision'] === input.expectedRevision,
  });
  return { ok: true, classification };
}

/**
 * Publish one immutable record via the hard-link protocol (10.1/WPR) under
 * WRITE authority only (WP-8-F correction: the generic substrate never
 * accepts a recovery capability or any caller-supplied recovery operation).
 * The caller supplies the canonical bytes and all derived fixed paths. On
 * `EEXIST` at the final target the existing object is verified and
 * classified; on `EEXIST` at the temporary name the object is inspected
 * without adoption and the caller must run the retry classification. Every
 * mutation boundary revalidates the genuine write capability. Injectable
 * hooks enable deterministic per-stage failure tests (WPR-022).
 */
export function publishImmutableRecord(input: {
  readonly capability: WriteCapability;
  readonly canonicalUtf8: string;
  readonly byteLimit: number;
  readonly tmpPath: string;
  readonly tmpDirPath: string;
  readonly finalPath: string;
  readonly finalDirPath: string;
  readonly serviceUid: number;
  readonly expectedRecordId: string;
  readonly expectedRevision: number;
  readonly expectedDigest: string;
  /** Additional fixed directories to fsync at the durability point (audit parents). */
  readonly syncDirectories?: readonly string[];
  readonly hooks?: PublicationHooks;
}): PublishStageResult {
  // WP-8-F correction: genuine brand verification before any method call or
  // filesystem access (CAP-007) — a recovery capability, forged structural
  // object, or lookalike never reaches the generic sink.
  if (!isGenuineWriteCapability(input.capability)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'write capability operand is not genuine' };
  }
  const check = input.capability.verify('record-publish');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'write capability is not usable at the publication boundary' };
  }
  return publishImmutableCore({
    revalidate: (): RevalidationResult => {
      const again = input.capability.verify('record-publish');
      return again.ok ? { ok: true } : { ok: false, message: 'write capability invalidated before primary publication' };
    },
    canonicalUtf8: input.canonicalUtf8,
    byteLimit: input.byteLimit,
    tmpPath: input.tmpPath,
    tmpDirPath: input.tmpDirPath,
    finalPath: input.finalPath,
    finalDirPath: input.finalDirPath,
    serviceUid: input.serviceUid,
    expectedRecordId: input.expectedRecordId,
    expectedRevision: input.expectedRevision,
    expectedDigest: input.expectedDigest,
    syncDirectories: input.syncDirectories,
    hooks: input.hooks,
  });
}

interface RevalidationResult {
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * Shared immutable hard-link publication core (10.1/WPR). Authority is
 * verified by the caller BEFORE this runs, and `revalidate` re-verifies it
 * immediately before the primary link (CAP-009 boundary 2). Never exposed;
 * both production entry points (write path and the exact-record recovery
 * permit entry point) live in this module.
 */
function publishImmutableCore(input: {
  readonly revalidate: () => RevalidationResult;
  readonly canonicalUtf8: string;
  readonly byteLimit: number;
  readonly tmpPath: string;
  readonly tmpDirPath: string;
  readonly finalPath: string;
  readonly finalDirPath: string;
  readonly serviceUid: number;
  readonly expectedRecordId: string;
  readonly expectedRevision: number;
  readonly expectedDigest: string;
  readonly syncDirectories?: readonly string[];
  readonly hooks?: PublicationHooks;
}): PublishStageResult {
  const bytes = Buffer.from(input.canonicalUtf8, 'utf8');
  if (bytes.length > input.byteLimit) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record exceeds the bounded byte limit' };
  }
  const hooks = input.hooks ?? {};
  const syncFile = hooks.fsyncFile ?? fsyncSync;
  const syncDir = hooks.fsyncDirectory;
  const writeBytes = hooks.write ?? ((fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => writeSync(fd, buf, off, len, pos));
  const linkPaths = hooks.link ?? ((a: string, b: string) => linkSync(a, b));
  const unlinkPath = hooks.unlink ?? ((p: string) => unlinkSync(p));
  let tmpFd: number | undefined;
  try {
    try {
      tmpFd = openSync(input.tmpPath, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Same-action deterministic temp name: never adopt, reopen, or
        // unlink. The composition runs the MINOR-2 retry classification.
        return { ok: false, outcome: 'temp-exists', code: 'ERR-STO-DURABILITY', message: 'temporary name already exists; retry classification required' };
      }
      const mapped = mapPublishError((err as NodeJS.ErrnoException).code, 'temp');
      return { ok: false, outcome: 'failed', code: mapped.code, message: mapped.message };
    }
    const tempFd = tmpFd;
    fchmodSync(tempFd, 0o600);
    const preStat = fstatSync(tempFd);
    const modeCheck = verifyRegularFileStat(preStat, input.serviceUid);
    if (!modeCheck.ok) {
      unlinkPath(input.tmpPath);
      return { ok: false, outcome: 'failed', code: modeCheck.code, message: modeCheck.message };
    }
    if (!writeAllSync(bytes, (buf, off, len, pos) => writeBytes(tempFd, buf, off, len, pos))) {
      unlinkPath(input.tmpPath);
      return { ok: false, outcome: 'failed', code: 'ERR-STO-DURABILITY', message: 'temporary write did not complete; no partial record is published' };
    }
    const postWriteStat = fstatSync(tempFd);
    if (postWriteStat.size !== bytes.length) {
      unlinkPath(input.tmpPath);
      return { ok: false, outcome: 'failed', code: 'ERR-STO-INTEGRITY', message: 'temporary size does not match canonical bytes' };
    }
    syncFile(tempFd);
    // Authority revalidation immediately before primary publication (CAP-009 boundary 2).
    const beforeLink = input.revalidate();
    if (!beforeLink.ok) {
      unlinkPath(input.tmpPath);
      return { ok: false, outcome: 'failed', code: 'ERR-STO-REQ-INVALID', message: beforeLink.message ?? 'authority invalidated before primary publication' };
    }
    const tempInode = { dev: Number(preStat.dev), ino: Number(preStat.ino) };
    try {
      linkPaths(input.tmpPath, input.finalPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // Existing-target case (WPR-006): verify and classify; never replace.
        const classified = classifyExistingTargetObject({
          finalPath: input.finalPath,
          serviceUid: input.serviceUid,
          byteLimit: input.byteLimit,
          expectedRecordId: input.expectedRecordId,
          expectedRevision: input.expectedRevision,
          expectedCanonicalUtf8: input.canonicalUtf8,
          expectedDigest: input.expectedDigest,
        });
        unlinkPath(input.tmpPath);
        if (!classified.ok) {
          return { ok: false, outcome: 'failed', code: classified.code, message: classified.message };
        }
        const outcome = classified.classification === 'idempotent-duplicate' ? 'idempotent-duplicate' : classified.classification === 'conflict-revision' ? 'conflict-revision' : 'duplicate';
        const code = classified.classification === 'idempotent-duplicate' ? undefined : classified.classification === 'conflict-revision' ? 'ERR-STO-CONFLICT-REVISION' : 'ERR-STO-DUPLICATE';
        return { ok: outcome === 'idempotent-duplicate', outcome, code, message: outcome === 'idempotent-duplicate' ? 'existing target is an exact idempotent duplicate' : 'existing target conflicts with the requested record' };
      }
      const mapped = mapPublishError(code, 'link');
      unlinkPath(input.tmpPath);
      return { ok: false, outcome: 'failed', code: mapped.code, message: mapped.message };
    }
    // Verify the final object: identity matches the temp inode, regular
    // file, store policy, and the expected link relationship (FSP-006).
    let finalFd: number | undefined;
    try {
      finalFd = openSync(input.finalPath, O_RDONLY | O_NOFOLLOW);
      const finalStat = fstatSync(finalFd);
      const finalCheck = verifyRegularFileStat(finalStat, input.serviceUid);
      if (!finalCheck.ok) {
        return { ok: false, outcome: 'failed', code: finalCheck.code, message: finalCheck.message };
      }
      if (Number(finalStat.dev) !== tempInode.dev || Number(finalStat.ino) !== tempInode.ino) {
        return { ok: false, outcome: 'failed', code: 'ERR-STO-INTEGRITY', message: 'final object identity does not match the published temporary inode' };
      }
      if (Number(finalStat.nlink) !== 2) {
        return { ok: false, outcome: 'failed', code: 'ERR-STO-INTEGRITY', message: 'unexpected link count on the published record' };
      }
    } finally {
      if (finalFd !== undefined) closeSync(finalFd);
    }
    // Final-record-directory fsync BEFORE the temporary unlink (10.1 step 6).
    if (syncDir !== undefined) {
      syncDir(input.finalDirPath);
      for (const dir of input.syncDirectories ?? []) syncDir(dir);
    } else {
      fsyncDirectory(input.finalDirPath, hooks);
      for (const dir of input.syncDirectories ?? []) fsyncDirectory(dir, hooks);
    }
    // Unlink the exact owned temporary object (step 7).
    try {
      unlinkPath(input.tmpPath);
    } catch {
      return { ok: false, outcome: 'failed', code: 'ERR-STO-PUBLISH-FAILED', message: 'temporary object could not be unlinked; final name is durable' };
    }
    // Temporary-directory fsync (step 8): durable removal of the temp name.
    if (syncDir !== undefined) {
      syncDir(input.tmpDirPath);
    } else {
      fsyncDirectory(input.tmpDirPath, hooks);
    }
    return { ok: true, outcome: 'published', finalIdentity: tempInode };
  } catch {
    // Post-creation failure at any durability stage: the record may be
    // durable through its final name; report the durability class with
    // verify-before-retry semantics; never roll back, never report success.
    return { ok: false, outcome: 'failed', code: 'ERR-STO-DURABILITY', message: 'publication durability point not reached; verify state before retry' };
  } finally {
    if (tmpFd !== undefined) closeSync(tmpFd);
  }
}

/**
 * WP-8-F correction: dedicated exact-record recovery publication entry
 * point. Consumes ONLY a genuine branded `RecoveryPublicationPermit`; no
 * record class, final path, shard, operation, evidence kind, or audit
 * payload is accepted from the caller. Verifies the genuine permit and its
 * live state, parses and verifies the canonical record bytes (class, record
 * kind, identity, canonical-byte digest) against the permit binding,
 * derives the destination internally and verifies it against the permit,
 * provisions only the exact bound class/shard, and publishes with the
 * shared immutable hard-link no-replace algorithm (same durability and
 * idempotency behavior as the write path). A permit for one exact record
 * can never publish another record, even within the same class.
 */
export function publishRecoveryBoundRecord(input: {
  readonly permit: RecoveryPublicationPermit;
  readonly canonicalUtf8: string;
  readonly byteLimit: number;
  readonly serviceUid: number;
  readonly hooks?: PublicationHooks;
}): PublishStageResult {
  // 1. Genuine permit verification BEFORE any filesystem access.
  if (!isGenuineRecoveryPublicationPermit(input.permit)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery publication permit operand is not genuine' };
  }
  if (!recoveryPublicationPermitLive(input.permit)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery publication permit is disposed' };
  }
  const binding = input.permit.binding;
  const capability = binding.capability;
  if (!capability.verify(binding.operation).ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the recovery publication boundary' };
  }
  // 2-4. Parse and verify the canonical bytes against the permit. The
  // registry-index role consumes a canonical index snapshot (ADR-031); all
  // other roles consume canonical record envelopes.
  const bytes = Buffer.from(input.canonicalUtf8, 'utf8');
  if (bytes.length > input.byteLimit) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record exceeds the bounded byte limit' };
  }
  if (binding.role === 'registry-index') {
    const indexParsed = parseRegistryIndex(input.canonicalUtf8, input.byteLimit, REGISTRY_INDEX_MAX_ENTRIES);
    if (!indexParsed.ok || indexParsed.model === undefined) {
      return { ok: false, code: indexParsed.code ?? 'ERR-STO-MALFORMED', message: indexParsed.message ?? 'registry index bytes are not a canonical index snapshot' };
    }
    if (indexParsed.model.indexId !== binding.recordId) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'registry index identity does not match the permit binding' };
    }
    if (computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, input.canonicalUtf8) !== binding.recordDigest || computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, input.canonicalUtf8) !== binding.canonicalBytesDigest) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'registry index canonical-byte digest does not match the permit binding' };
    }
    const indexConsistent = validateRegistryIndexSelfConsistency(indexParsed.model);
    if (!indexConsistent.ok) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'registry index identity or roots are inconsistent with the permit binding' };
    }
  } else {
  const parsed = parsePersistedEnvelope(input.canonicalUtf8, input.byteLimit);
  if (!parsed.ok || parsed.model === undefined || parsed.bytes === undefined) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'record bytes are not a canonical record envelope' };
  }
  const model = parsed.model as Readonly<Record<string, unknown>>;
  const expectedKind = binding.recordClass === 'store-evidence-record' ? 'StoreEvidenceRecord' : 'AuthoritativeAuditEvent';
  if (model['recordKind'] !== expectedKind) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record kind does not match the permit-bound class' };
  }
  if (model['recordId'] !== binding.recordId) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record identity does not match the permit binding' };
  }
  if (parsed.bytes.digest !== binding.recordDigest || parsed.bytes.digest !== binding.canonicalBytesDigest) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record canonical-byte digest does not match the permit binding' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'record payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  if (binding.role === 'recovery-authorized-write-audit' || binding.role === 'reconstructed-recovery-audit') {
    // Exact audit binding: event kind, referenced record identity and
    // digest, trusted recovery action identity, and reference linkage.
    const audit = binding.audit;
    if (audit === undefined) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit permit binding is missing' };
    }
    if (binding.role === 'recovery-authorized-write-audit') {
      if (p['eventKind'] !== 'authorized-write') {
        return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit event kind does not match the permit binding' };
      }
    } else {
      // WP-8-G reconstructed audit: the exact `recovery-audit-reconstruction`
      // kind with the explicit gap marker naming the missing original event.
      if (p['eventKind'] !== RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND) {
        return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit event kind does not match the reconstructed-audit permit binding' };
      }
      const gapMarker = p['gapMarker'];
      if (typeof gapMarker !== 'object' || gapMarker === null || Array.isArray(gapMarker) || (gapMarker as Readonly<Record<string, unknown>>)['missingEventKind'] !== 'authorized-write') {
        return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'reconstructed audit gap marker does not match the permit binding' };
      }
    }
    if (p['recordId'] !== audit.referencedRecordId) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit referenced record does not match the permit binding' };
    }
    if (p['recordDigest'] !== audit.referencedRecordDigest) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit referenced digest does not match the permit binding' };
    }
    if (model['trustedActionId'] !== audit.trustedActionIdentity) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit trusted action identity does not match the permit binding' };
    }
    const references = model['referenceDigests'];
    if (!Array.isArray(references) || references[0] !== audit.referencedRecordDigest) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'audit reference digests do not match the permit binding' };
    }
  } else {
    // Exact evidence binding: evidence kind and recovery operation.
    if (p['evidenceKind'] !== 'recovery-evidence') {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'evidence kind does not match the permit binding' };
    }
    if (p['recoveryOperation'] !== binding.operation) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery operation does not match the permit binding' };
    }
  }
  }
  // 5-6. Derive the destination internally and verify it matches the permit.
  const namespaceRoot = `${capability.binding.storeInstance.parentIdentity.canonicalPath}/store-v1`;
  let derived: { readonly ok: boolean; readonly relativePath?: string; readonly classSegment?: string; readonly code?: string; readonly message?: string };
  if (binding.role === 'registry-index') {
    const indexDerived = deriveRegistryIndexRelativePath(binding.recordId);
    derived = indexDerived.ok ? { ok: true, relativePath: indexDerived.relativePath } : { ok: false };
  } else {
    derived = deriveRecordRelativePath(binding.recordClass as Parameters<typeof deriveRecordRelativePath>[0], binding.recordId);
  }
  if (!derived.ok || derived.relativePath === undefined) {
    return { ok: false, code: 'ERR-STO-CONTAINMENT-DENIED', message: 'record path derivation failed' };
  }
  if (derived.relativePath !== binding.destinationDesignation) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'derived destination does not match the permit binding' };
  }
  const topLevel = derived.relativePath.startsWith('audit/') ? 'audit' : derived.relativePath.startsWith('index/') ? 'index' : 'records';
  const finalPath = `${namespaceRoot}/${derived.relativePath}`;
  const finalDirPath = `${namespaceRoot}/${derived.relativePath.slice(0, derived.relativePath.lastIndexOf('/'))}`;
  const parentDirPath = `${namespaceRoot}/${topLevel}/${binding.role === 'registry-index' ? REGISTRY_INDEX_FAMILY : derived.classSegment}`;
  const tmpDirPath = `${namespaceRoot}/tmp`;
  // Same deterministic per-operation temp ordinals as the recovery evidence
  // path: evidence = base, audit = base + 1 (2/3 orphan-removal, 4/5
  // quarantine-temporary, 6/7 audit-reconstruction, 8/9 index rebuild).
  const ordinalBase = binding.operation === 'quarantine-temporary' ? 4 : binding.operation === 'audit-reconstruction' ? 6 : binding.operation === 'registry-index-rebuild' ? 8 : 2;
  const ordinal = binding.role === 'recovery-authorized-write-audit' ? ordinalBase + 1 : ordinalBase;
  const tmpPath = `${tmpDirPath}/${publicationTempName(capability.binding.actionIdentity, ordinal)}`;
  // 7. Provision only the exact bound class/shard or index family/shard
  // (module-private; authority already verified above).
  let provisioned: { readonly ok: boolean; readonly code?: string; readonly message?: string };
  if (binding.role === 'registry-index') {
    provisioned = ensureRegistryIndexDirectoriesFor(namespaceRoot, binding.recordId, input.serviceUid, input.hooks);
  } else {
    provisioned = ensureClassShardDirectoriesFor(namespaceRoot, binding.recordClass as Parameters<typeof ensureClassShardDirectoriesFor>[1], binding.recordId, input.serviceUid);
  }
  if (!provisioned.ok) {
    return { ok: false, code: provisioned.code ?? 'ERR-STO-IO-FAILURE', message: provisioned.message ?? 'recovery record class/shard directories could not be established' };
  }
  // 8-9. Publish with the shared immutable hard-link algorithm.
  return publishImmutableCore({
    revalidate: (): RevalidationResult => {
      if (!isGenuineRecoveryPublicationPermit(input.permit)) return { ok: false, message: 'recovery publication permit invalidated before primary publication' };
      if (!recoveryPublicationPermitLive(input.permit)) return { ok: false, message: 'recovery publication permit invalidated before primary publication' };
      if (!capability.verify(binding.operation).ok) return { ok: false, message: 'recovery capability invalidated before primary publication' };
      return { ok: true };
    },
    canonicalUtf8: input.canonicalUtf8,
    byteLimit: input.byteLimit,
    tmpPath,
    tmpDirPath,
    finalPath,
    finalDirPath,
    serviceUid: input.serviceUid,
    expectedRecordId: binding.recordId,
    expectedRevision: 1,
    expectedDigest: binding.recordDigest,
    syncDirectories: [parentDirPath, `${namespaceRoot}/${topLevel}`],
    hooks: input.hooks,
  });
}
