/**
 * WP-8-C metadata bootstrap persistence (W8C-D05/D13; ADR-028 decision D).
 *
 * Phase-specific no-overwrite bootstrap protocol for the immutable per-
 * namespace StoreMetadata file. It is NOT a general record publisher: no
 * lifecycle or ConfigurationSnapshotRecord publication exists, and hard-link
 * publication (WPR) is not used.
 *
 * New creation: `O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY`, explicit `0600`,
 * descriptor-bound `fchmod`/`fstat`, bounded write-all loop (a single write
 * must not be assumed to complete the buffer), file `fsync`, metadata-
 * directory `fsync`, namespace-directory `fsync`.
 *
 * `EEXIST` replay is descriptor-bound and no-follow only: open
 * `O_RDONLY|O_NOFOLLOW`, pre-read `fstat`, verify regular-file type/UID/
 * mode/dev/ino/location, descriptor-based read (`readFileSync(fd)`), then a
 * mandatory post-read `fstat` compared against the pre-read stat on device,
 * inode, type, UID, mode, and size (W8C-D13). Path-based `readFileSync(path)`
 * is prohibited for replay verification.
 */
import { openSync, closeSync, writeSync, readFileSync, fsyncSync, fchmodSync, fstatSync } from 'node:fs';
import { constants } from 'node:fs';
import { parseRawJson } from '../../json/scanner.js';
import { jcsSerialize } from '../../canonical/jcs.js';
import { computeDomainDigest, STORAGE_PAYLOAD_DIGEST_DOMAIN, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { isGenuineConfigurationRecoveryMetadataPermit, configurationRecoveryMetadataPermitLive, type InitializationCapability, type ConfigurationRecoveryMetadataPermit } from '../capabilities/authenticity.js';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import { METADATA_MAX_BYTES, METADATA_RECORD_FORMAT_VERSION, METADATA_RECORD_KIND, verifyMetadataModel, type StoreMetadataExpectation } from './store-metadata.js';
import type { VerifiedStoreMetadata } from '../types.js';

const { O_CREAT, O_EXCL, O_NOFOLLOW, O_WRONLY, O_RDONLY, O_DIRECTORY } = constants;

export interface PersistResult {
  readonly ok: boolean;
  readonly metadata?: VerifiedStoreMetadata;
  /** 'created' | 'verified' (idempotent replay) | failure code */
  readonly outcome?: 'created' | 'verified';
  readonly code?: string;
  readonly message?: string;
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly metadata?: VerifiedStoreMetadata;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Bounded write-all loop: `writeSync` may write fewer bytes than requested;
 * loop until the full buffer is written or an error occurs. Injectable writer
 * for deterministic partial-write tests.
 */
export function writeAllSync(
  buffer: Uint8Array,
  write: (buf: Uint8Array, offset: number, length: number, position: number | null) => number,
): boolean {
  let written = 0;
  while (written < buffer.length) {
    const n = write(buffer, written, buffer.length - written, written);
    if (!Number.isSafeInteger(n) || n <= 0) return false;
    written += n;
  }
  return written === buffer.length;
}

/** Create the metadata file with the no-overwrite bootstrap protocol. */
export function persistMetadata(
  capability: InitializationCapability,
  path: string,
  metadata: VerifiedStoreMetadata,
  serviceUid: number,
  metadataDirPath: string,
  namespaceDirPath: string,
  hooks: {
    readonly fsyncFile?: (fd: number) => void;
    readonly fsyncDirectory?: (path: string) => void;
    readonly write?: (fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => number;
  } = {},
): PersistResult {
  const check = capability.verify('namespace-initialize');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'initialization capability is not usable at a metadata boundary' };
  }
  const bytes = Buffer.from(metadata.canonicalUtf8, 'utf8');
  const syncFile = hooks.fsyncFile ?? fsyncSync;
  const syncDirectory = hooks.fsyncDirectory ?? fsyncDirectory;
  const writeBytes = hooks.write ?? ((fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => writeSync(fd, buf, off, len, pos));
  let fd: number | undefined;
  try {
    fd = openSync(path, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const replay = replayMetadata(capability, path, metadata.facts, serviceUid);
      if (!replay.ok) return { ok: false, code: replay.code, message: replay.message };
      return { ok: true, metadata: replay.metadata, outcome: 'verified' };
    }
    // Pre-creation failure: no state was created; keep the deterministic
    // native mapping (W8C-S02).
    const mapped = (err as NodeJS.ErrnoException).code;
    if (mapped === 'EROFS') return { ok: false, code: 'ERR-STO-READONLY-FS', message: 'filesystem is read-only' };
    if (mapped === 'ENOSPC') return { ok: false, code: 'ERR-STO-NO-SPACE', message: 'capacity limit reached during metadata persistence' };
    if (mapped === 'EDQUOT') return { ok: false, code: 'ERR-STO-QUOTA-EXCEEDED', message: 'quota exceeded during metadata persistence' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'metadata file could not be created exclusively' };
  }
  const fileFd = fd;
  try {
    fchmodSync(fileFd, 0o600);
    const preStat = fstatSync(fileFd);
    const modeCheck = verifyRegularFileStat(preStat, serviceUid);
    if (!modeCheck.ok) return { ok: false, code: modeCheck.code, message: modeCheck.message };
    if (!writeAllSync(bytes, (buf, off, len, pos) => writeBytes(fileFd, buf, off, len, pos))) {
      // The metadata file exists (possibly partial): durability is unknown
      // and verification is required (W8C-S02).
      return { ok: false, code: 'ERR-STO-DURABILITY', message: 'metadata write did not complete; durability unknown' };
    }
    syncFile(fileFd);
    const postStat = fstatSync(fileFd);
    if (postStat.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata size does not match canonical bytes' };
    }
    closeSync(fileFd);
    fd = undefined;
    syncDirectory(metadataDirPath);
    syncDirectory(namespaceDirPath);
    return { ok: true, metadata, outcome: 'created' };
  } catch {
    // Post-creation failure at any durability stage: the metadata file may
    // exist and may be partially durable. Report ERR-STO-DURABILITY with
    // verify-before-retry semantics; never ordinary IO-FAILURE/NO_STATE,
    // never delete or roll back the created file (W8C-S02).
    return { ok: false, code: 'ERR-STO-DURABILITY', message: 'metadata durability point not reached; verify state before retry' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Directory `fsync` for the durability point. */
function fsyncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * WP-8-M exact configuration-recovery metadata publication entry (§16.7/
 * ADR-036). Sink-level confinement mirror of `persistMetadata` for the
 * configuration-namespace recovery operation: consumes ONLY a genuine live
 * `ConfigurationRecoveryMetadataPermit` minted by the configuration-recovery
 * composition boundary. The permit binds the genuine recovery capability,
 * the exact `recover-configuration-namespace` operation, the exact
 * configuration identity/version, the exact canonical configuration digest,
 * the deterministic trusted-input identity digest, and the exact internally
 * derived destination `metadata/metadata.json`. The sink re-parses and
 * re-verifies the canonical bytes (record kind, supported format version,
 * payload digest, configuration identity/version binding) and re-derives
 * the destination before using the exact no-overwrite bootstrap protocol
 * (O_CREAT|O_EXCL|O_NOFOLLOW; fchmod; write-all; file fsync; metadata-
 * directory fsync; namespace-directory fsync). An existing final object is
 * NEVER overwritten: EEXIST performs exact-match replay verification only
 * and fails closed on any mismatch (a conflicting configuration object is
 * never repaired, truncated, replaced, or unlinked by recovery).
 */
export function persistRecoveryConfigurationMetadata(input: {
  readonly permit: ConfigurationRecoveryMetadataPermit;
  readonly path: string;
  readonly canonicalUtf8: string;
  readonly configurationDigest: string;
  readonly serviceUid: number;
  readonly metadataDirPath: string;
  readonly namespaceDirPath: string;
  readonly hooks?: {
    readonly fsyncFile?: (fd: number) => void;
    readonly fsyncDirectory?: (path: string) => void;
    readonly write?: (fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => number;
  };
}): PersistResult {
  // 1. Genuine permit verification BEFORE any filesystem access.
  if (!isGenuineConfigurationRecoveryMetadataPermit(input.permit)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration-recovery permit operand is not genuine' };
  }
  if (!configurationRecoveryMetadataPermitLive(input.permit)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration-recovery permit is disposed' };
  }
  const binding = input.permit.binding;
  const capability = binding.capability;
  if (!capability.verify(binding.operation).ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'recovery capability is not usable at the configuration-recovery boundary' };
  }
  // 2. Re-derive the destination internally and verify it matches the permit.
  if (input.path !== `${capability.binding.storeInstance.parentIdentity.canonicalPath}/config-v1/${binding.destinationDesignation}`) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'derived destination does not match the configuration-recovery permit binding' };
  }
  if (input.metadataDirPath !== `${capability.binding.storeInstance.parentIdentity.canonicalPath}/config-v1/metadata`) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'derived metadata directory does not match the configuration-recovery permit binding' };
  }
  if (input.namespaceDirPath !== `${capability.binding.storeInstance.parentIdentity.canonicalPath}/config-v1`) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'derived namespace directory does not match the configuration-recovery permit binding' };
  }
  // 3. Parse and re-verify the canonical bytes against the permit: the
  // recovered object must be the exact store-metadata kind at the supported
  // version, digest-consistent, and bound to the exact configuration
  // identity/version of the permit (never another configuration kind,
  // another version, or caller-selected bytes).
  const bytes = Buffer.from(input.canonicalUtf8, 'utf8');
  if (bytes.length > METADATA_MAX_BYTES) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'configuration metadata exceeds the bounded byte limit' };
  }
  const parsed = parseRawJson(input.canonicalUtf8, METADATA_MAX_BYTES);
  const parsedModel = parsed.model;
  if (typeof parsedModel !== 'object' || parsedModel === null || Array.isArray(parsedModel)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'configuration metadata bytes are not a canonical JSON object' };
  }
  const model = parsedModel as Readonly<Record<string, unknown>>;
  if (model['recordKind'] !== METADATA_RECORD_KIND) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration metadata record kind does not match the permit binding' };
  }
  if (model['formatVersion'] !== METADATA_RECORD_FORMAT_VERSION) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration metadata version does not match the permit binding' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'configuration metadata payload is malformed' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  const recordedProfile = p['limitProfileIdentity'] as Readonly<Record<string, unknown>> | null | undefined;
  if (recordedProfile === null || typeof recordedProfile !== 'object' || Array.isArray(recordedProfile)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'configuration metadata limit-profile identity is malformed' };
  }
  if (p['configurationIdentity'] !== binding.configurationIdentity || recordedProfile['configurationIdentity'] !== binding.configurationIdentity) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration metadata identity does not match the permit binding' };
  }
  if (recordedProfile['configurationVersion'] !== binding.configurationVersion) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration metadata version does not match the permit binding' };
  }
  const canonicalPayload = jcsSerialize(payload);
  const declaredPayloadDigest = model['payloadDigest'];
  if (typeof declaredPayloadDigest !== 'string') {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'configuration metadata payload digest is malformed' };
  }
  const recomputedPayloadDigest = computeMetadataPayloadDigest(canonicalPayload);
  if (recomputedPayloadDigest !== declaredPayloadDigest) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'configuration metadata payload digest mismatch' };
  }
  const recordDigest = computeMetadataRecordDigest(jcsSerialize(model));
  if (recordDigest !== input.configurationDigest || recordDigest !== binding.configurationDigest) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'configuration metadata canonical digest does not match the permit binding' };
  }
  // 4. Exact no-overwrite bootstrap protocol (never truncate, replace,
  // rename, chmod/chown, or unlink an existing final object).
  const syncFile = input.hooks?.fsyncFile ?? fsyncSync;
  const syncDirectory = input.hooks?.fsyncDirectory ?? fsyncDirectory;
  const writeBytes = input.hooks?.write ?? ((fd: number, buf: Uint8Array, off: number, len: number, pos: number | null) => writeSync(fd, buf, off, len, pos));
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // A conflicting configuration object appeared: exact-match replay
      // verification only; never overwrite. A non-exact object fails
      // closed and is never repaired or unlinked.
      const replay = replayMetadata(capability as never, input.path, expectedFromBinding(binding), input.serviceUid);
      if (!replay.ok) return { ok: false, code: replay.code, message: replay.message };
      if (replay.metadata === undefined || replay.metadata.canonicalUtf8 !== input.canonicalUtf8) {
        return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'existing configuration metadata conflicts with the recovery permit; never overwritten' };
      }
      return { ok: true, metadata: replay.metadata, outcome: 'verified' };
    }
    const mapped = (err as NodeJS.ErrnoException).code;
    if (mapped === 'EROFS') return { ok: false, code: 'ERR-STO-READONLY-FS', message: 'filesystem is read-only' };
    if (mapped === 'ENOSPC') return { ok: false, code: 'ERR-STO-NO-SPACE', message: 'capacity limit reached during configuration recovery' };
    if (mapped === 'EDQUOT') return { ok: false, code: 'ERR-STO-QUOTA-EXCEEDED', message: 'quota exceeded during configuration recovery' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'configuration metadata could not be created exclusively' };
  }
  const fileFd = fd;
  try {
    fchmodSync(fileFd, 0o600);
    const preStat = fstatSync(fileFd);
    const modeCheck = verifyRegularFileStat(preStat, input.serviceUid);
    if (!modeCheck.ok) return { ok: false, code: modeCheck.code, message: modeCheck.message };
    if (!writeAllSync(bytes, (buf, off, len, pos) => writeBytes(fileFd, buf, off, len, pos))) {
      return { ok: false, code: 'ERR-STO-DURABILITY', message: 'configuration metadata write did not complete; durability unknown' };
    }
    syncFile(fileFd);
    const postStat = fstatSync(fileFd);
    if (postStat.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'configuration metadata size does not match canonical bytes' };
    }
    closeSync(fileFd);
    fd = undefined;
    syncDirectory(input.metadataDirPath);
    syncDirectory(input.namespaceDirPath);
    return { ok: true, metadata: undefined, outcome: 'created' };
  } catch {
    return { ok: false, code: 'ERR-STO-DURABILITY', message: 'configuration metadata durability point not reached; verify state before retry' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Metadata expectation derived from the permit binding (replay verification). */
function expectedFromBinding(binding: ConfigurationRecoveryMetadataPermit['binding']): StoreMetadataExpectation {
  return {
    metadataFormatVersion: '1',
    layoutVersion: 'v1',
    namespaceKind: 'configuration',
    namespaceIdentity: { kind: 'configuration', canonicalPath: '', dev: 0, ino: 0 },
    parentIdentity: binding.capability.binding.storeInstance.parentIdentity,
    lane: 'posix-0700',
    configurationIdentity: binding.configurationIdentity,
    actionIdentity: binding.capability.binding.actionIdentity,
    limitProfileIdentity: { configurationVersion: binding.configurationVersion, configurationIdentity: binding.configurationIdentity },
  };
}

/**
 * Descriptor-bound, no-follow replay verification (W8C-D05/D13). Exact match
 * only is verification-only idempotence; any mismatch fails closed.
 */
export function replayMetadata(capability: InitializationCapability, path: string, expected: StoreMetadataExpectation, serviceUid: number): ReplayResult {
  const check = capability.verify('namespace-initialize');
  if (!check.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'initialization capability is not usable at a metadata boundary' };
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const typeCheck = verifyRegularFileStat(pre, serviceUid);
    if (!typeCheck.ok) return { ok: false, code: typeCheck.code, message: typeCheck.message };
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) return { ok: false, code: revalidated.code, message: revalidated.message };
    if (post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata size changed during descriptor-based read' };
    }
    let model: unknown;
    try {
      model = parseRawJson(bytes, METADATA_MAX_BYTES).model;
    } catch {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata is not canonical JSON or contains duplicate members' };
    }
    if (typeof model !== 'object' || model === null || Array.isArray(model)) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata must be a JSON object' };
    }
    const raw = bytes.toString('utf8');
    if (jcsSerialize(model) !== raw) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata bytes are not canonical' };
    }
    const modelObj = model as Readonly<Record<string, unknown>>;
    // Precedence (W8C-S04; ERM-014): a wrong record kind is malformed input,
    // not an unsupported format version; only a recognized kind with an
    // unsupported format version maps to UNSUPPORTED-VERSION.
    if (modelObj['recordKind'] !== METADATA_RECORD_KIND) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata record kind is not the store-metadata kind' };
    }
    if (modelObj['formatVersion'] !== METADATA_RECORD_FORMAT_VERSION) {
      return { ok: false, code: 'ERR-STO-UNSUPPORTED-VERSION', message: 'metadata version is not supported' };
    }
    const verified = verifyMetadataModel(model as Readonly<Record<string, unknown>>, expected);
    if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };
    if (verified.metadata === undefined) {
      return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'metadata verification produced no model' };
    }
    return { ok: true, metadata: verified.metadata };
  } catch (err) {
    const mapped = (err as NodeJS.ErrnoException).code;
    if (mapped === 'ENOENT') return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'metadata file is absent' };
    if (mapped === 'ELOOP') return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata path must not traverse a symbolic link' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'metadata replay verification failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Payload-digest computation for configuration metadata (STORAGE_PAYLOAD_DIGEST_DOMAIN). */
function computeMetadataPayloadDigest(canonicalPayload: string): string {
  return computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, canonicalPayload);
}

/** Record-byte digest computation for configuration metadata (STORAGE_RECORD_BYTES_DIGEST_DOMAIN). */
function computeMetadataRecordDigest(canonicalEnvelope: string): string {
  return computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalEnvelope);
}

/**
 * Descriptor-bound no-follow exact-byte read of an existing configuration
 * metadata object (EEXIST replay; WP-8-M). Returns `exact` only when the
 * stored bytes equal the expected canonical configuration bytes; a wrong
 * type/UID/mode, unreadable, or byte-different object fails closed and is
 * never modified.
 */
function readMetadataBytesExact(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly expectedUtf8: string;
}): { readonly ok: boolean; readonly exact?: boolean; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW);
    const pre = fstatSync(fd);
    const typeCheck = verifyRegularFileStat(pre, input.serviceUid);
    if (!typeCheck.ok) return { ok: false, code: typeCheck.code, message: typeCheck.message };
    if (pre.size > METADATA_MAX_BYTES) {
      return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'existing configuration metadata exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) return { ok: false, code: revalidated.code, message: revalidated.message };
    if (post.size !== bytes.length) {
      return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'configuration metadata changed during descriptor-based read' };
    }
    return { ok: true, exact: bytes.toString('utf8') === input.expectedUtf8 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, code: 'ERR-STO-NOT-FOUND', message: 'configuration metadata disappeared during replay' };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'configuration metadata replay read failed' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
