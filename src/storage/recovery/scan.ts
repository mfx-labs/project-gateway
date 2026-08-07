/**
 * WP-8-E read-only store scan (contract §13 RDS-004/007, §16 CSA, §19
 * LMT-006/010, §24 DTM-003; WP-8-E scope item 1; corrections F1–F4, F1-B,
 * F1-S, F3-G). FILESYSTEM-BEARING, READ-ONLY: this is the sole scan owner
 * in the storage tree for the records, audit, tmp, and locks surfaces
 * (alongside the class enumeration owner `src/storage/read/enumerate.ts`
 * and the provisioning classifier). The module performs NO mutation of any
 * kind (its filesystem allowlist contains no mutating API) and NEVER
 * decides candidate classifications: it extracts pure facts and delegates
 * every category decision to the filesystem-free classifier
 * (`src/storage/registry/classify.ts`). Derived views and plans are
 * constructed elsewhere; this module returns observations and findings
 * only.
 *
 * Scanning model (deterministic; host directory order is never trusted):
 *   - parent surfaces first: `records/` and `audit/` are enumerated
 *     deterministically; the exact configured record-class directory set
 *     and the expected audit class directory are recognized; unknown
 *     directories, stray files, symlinks, and special objects are reported
 *     as foreign observations; missing required class directories are
 *     reported as findings (F3). Parent-level structure is budget-free and
 *     is reported by the first page only (no continuation): content pages
 *     report candidates only, so the paging union stays complete and
 *     duplicate-free.
 *   - class surfaces in fixed order: the 15 record classes in taxonomy
 *     order (`records/<segment>/`), then the audit class
 *     (`audit/audit-event/`), then — only for recovery-mode scans — `tmp/`
 *     and `locks/`;
 *   - every directory is descriptor-verified before and after `readdirSync`
 *     (device/inode/UID/mode snapshot; point-of-use revalidation,
 *     SRX-013/FSP-004); identity drift between the two snapshots fails
 *     closed with ERR-STO-ROOT-IDENTITY-CHANGED. A directory that was
 *     successfully opened and verified and then fails to re-open (or
 *     vanishes during readdir) is drift, never absence; only a first-
 *     attempt ENOENT (never opened) is an absent surface (F4). Class
 *     directories, the audit directory, `tmp/`, `locks/`, and shard
 *     directories follow the same drift rule.
 *   - names are sorted lexicographically; shard iteration is the sorted
 *     set of existing shard directories (never a host-order read);
 *   - bounds: strict entry and aggregate-byte limits with exact-limit
 *     acceptance and limit-plus-one fail-closed truncation
 *     (`totalScanEntries`/`totalScanBytes` for the registry scan; the same
 *     with `recoveryScanEntries` fail-closed semantics for the recovery
 *     scan; LMT-004/005/006/010); every candidate is bounded by the
 *     per-record byte limit;
 *   - continuation cursor `{generation, surfaceGeneration, recordClass,
 *     shard, entry}`: the request `generation` binds store identity,
 *     namespace identity, effective entry/byte limits, scan mode,
 *     fail-closed behavior, and the class-order model version (F2); the
 *     `surfaceGeneration` binds the cross-page structural snapshot —
 *     `records/` and `audit/` parent presence and identity, the expected
 *     record-class presence set, `audit-event` presence, and the
 *     identities of every present class directory (F3-G). A cursor whose
 *     request generation differs from the current request's computed
 *     generation is rejected with ERR-STO-REQ-INVALID before any candidate
 *     content is scanned; a cursor whose surface generation no longer
 *     matches the re-read structural snapshot is rejected with
 *     ERR-STO-ROOT-IDENTITY-CHANGED (cross-page deletion, addition,
 *     replacement, or parent disappearance is drift; absent-on-both-pages
 *     is unchanged).
 *   - forward progress (F1, accepted WP-8-D enumeration model): entries
 *     skipped because they are at or before the continuation cursor are
 *     cursor-seeking work and do NOT consume the resumed page's entry
 *     budget; reissuing the same request with the returned cursor and
 *     identical bounds advances strictly beyond the previous cursor and a
 *     finite store terminates after repeated same-bounds requests; no
 *     candidate is duplicated.
 *   - byte-bound truncation never advances past an unread candidate
 *     (F1-B): when candidate X passes its individual size bound but cannot
 *     fit within the remaining aggregate page budget, X is not processed,
 *     no observation for X is emitted, no cursor position sorts at or
 *     after X, and no candidate after X is processed on that page. If at
 *     least one resumable candidate was processed on the page, the
 *     continuation points at the last successfully processed resumable
 *     candidate (strictly before X); if zero resumable candidates were
 *     processed, no continuation is emitted and the truncated result
 *     signals a no-progress state: the caller must restart WITHOUT the
 *     cursor with a larger byte profile (the request generation binds byte
 *     limits, so a raised limit invalidates the old cursor with
 *     ERR-STO-REQ-INVALID anyway). X is never skipped and no result
 *     implies X was processed.
 *   - self-validating cursors (F1-S): a foreign shard name is a
 *     non-resumable structural anomaly — budget-free, reported at its
 *     first encounter in deterministic scan order, never a resumable
 *     cursor position, never blocking later valid candidates. Every
 *     emitted continuation is validated against the scanner's own cursor
 *     validator before return (an invalid emission is an internal
 *     invariant failure).
 *   - entries whose name fails the layout grammar are foreign findings
 *     (never opened); entries at a non-derived location are read within
 *     bounds so their envelope identity is available for the deterministic
 *     duplicate/conflict pass (18.2: location classification still precedes
 *     content classification);
 *   - observation ids and the scan generation tokens are deterministic
 *     domain digests; no clock, randomness, environment, or path material
 *     enters them (DTM-007). No raw device/inode value ever leaves the
 *     module (F3-G binds identities only through the surface digest).
 *
 * No raw absolute path, record payload, or lock nonce ever leaves this
 * module (RDS-012, ERM-004, AUD-006).
 */
import { readdirSync, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { jcsSerialize } from '../../canonical/jcs.js';
import { computeDomainDigest, isValidDigestSyntax, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { parseRawJson } from '../../json/scanner.js';
import { verifyObjectBytesAt } from '../publication/publish-record.js';
import { computeQuarantineEvidenceIdentity } from './evidence.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { RECORD_CLASS_BY_ID, RECORD_CLASS_PROFILES } from '../format/taxonomy.js';
import { comparePrePostStat } from '../root/identity.js';
import { verifyNamespaceRootIdentity } from '../read/read-record.js';
import { classifyCandidate, extractEnvelopeFacts, type CandidateFacts } from '../registry/classify.js';
import { parseLockRecordFacts } from './assess.js';
import { LOCK_RECORD_MAX_BYTES } from '../locks/lock.js';
import type {
  AuditAssociationFacts,
  AuditScanObservation,
  ForeignScanObservation,
  LockScanObservation,
  QuarantineObjectClassification,
  QuarantineScanObservation,
  RecordClassId,
  RecordObservationFacts,
  RecordScanObservation,
  ScanCursor,
  ScanHooks,
  ScanMode,
  ScanObservation,
  ScannedObjectStat,
  StorageFinding,
  StoreScanInput,
  StoreScanResult,
  TemporaryScanObservation,
  VerifiedStoreInstance,
} from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;

/** Domain-separated scan-observation identity domain. */
const SCAN_OBSERVATION_ID_DOMAIN = 'PGAP-STORAGE-SCAN-OBSERVATION-v1\u0000';

/** Publication temporary-name grammar (WPR-003): `pub-<16 hex>-<ordinal hex>` (WP-8-F re-derivation). */
export function isPublicationTemporaryName(name: string): boolean {
  return TEMP_NAME_RE.test(name);
}

/** Deterministic temporary-object observation id (WP-8-F evidence binding; matches the WP-8-E scan). */
export function temporaryObservationId(entry: string): string {
  return observationId('temporary-object', undefined, undefined, entry);
}

/** Deterministic quarantine-object observation id (WP-8-F). */
export function quarantineObservationId(shard: string, entry: string): string {
  return observationId('quarantine-object', shard, undefined, entry);
}

/**
 * Extract quarantine-temporary evidence payload facts from one canonical
 * store-evidence-record (WP-8-F §8): quarantine ID, source digest, and
 * source entry. Used for dangling-evidence detection. Pure.
 */
export function extractQuarantineEvidenceFacts(raw: string): { readonly quarantineId?: string; readonly sourceDigest?: string; readonly sourceEntry?: string } {
  try {
    const model = parseRawJson(raw, 1024 * 1024).model;
    if (typeof model !== 'object' || model === null || Array.isArray(model)) return {};
    const payload = (model as Readonly<Record<string, unknown>>)['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const p = payload as Readonly<Record<string, unknown>>;
    if (p['recoveryOperation'] !== 'quarantine-temporary') return {};
    const quarantineId = p['quarantineId'];
    const sourceDigest = p['sourceDigest'];
    const sourceEntry = p['targetEntry'];
    if (typeof quarantineId !== 'string' || !/^[0-9a-f]{64}$/.test(quarantineId)) return {};
    if (typeof sourceDigest !== 'string' || !isValidDigestSyntax(sourceDigest)) return {};
    if (typeof sourceEntry !== 'string' || sourceEntry.length === 0) return {};
    return { quarantineId, sourceDigest, sourceEntry };
  } catch {
    return {};
  }
}
/** Domain-separated scan-generation token domain (request compatibility; F2). */
export const SCAN_GENERATION_DOMAIN = 'PGAP-STORAGE-SCAN-GENERATION-v1\u0000';
/** Domain-separated cross-page surface-generation token domain (F3-G). */
export const SCAN_SURFACE_GENERATION_DOMAIN = 'PGAP-STORAGE-SCAN-SURFACE-v1\u0000';
/**
 * Class-order/surface model version bound into both generation tokens (F2,
 * F3-G): a future change to the deterministic class order or surface model
 * must bump this constant so cursors from the previous model are rejected.
 */
const SCAN_MODEL_VERSION = 'v1' as const;

const SHARD_RE = /^[0-9a-f]{4}$/;
/** Quarantine object filename: `<64-hex>.qtn` (ADR-030; §16.5). */
const QUARANTINE_NAME_RE = /^[0-9a-f]{64}\.qtn$/;
const QUARANTINE_SUFFIX = '.qtn';
const COMPONENT_RE = /^[0-9a-f]{32}$/;
/** Publication temporary-name grammar (WPR-003): `pub-<16 hex>-<ordinal hex>`. */
const TEMP_NAME_RE = /^pub-[0-9a-f]{16}-[0-9a-f]{1,4}$/;

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function finding(code: string, message: string): StorageFinding {
  return { code, message, phase: 'request-validation', state: NO_STATE };
}

function compareFindings(a: StorageFinding, b: StorageFinding): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

function failResult(code: string, message: string): StoreScanResult {
  return { ok: false, observations: [], findings: [finding(code, message)], scannedEntries: 0, scannedBytes: 0, truncated: false };
}

/** Deterministic observation id: domain digest over kind/scope/location/entry. */
function observationId(kind: string, scope: string | undefined, shard: string | undefined, entry: string): string {
  const tuple = jcsSerialize({ kind, scope: scope ?? null, shard: shard ?? null, entry });
  const digest = computeDomainDigest(SCAN_OBSERVATION_ID_DOMAIN, tuple);
  return `obs-${digest.slice('sha-256:'.length, 'sha-256:'.length + 16)}`;
}

/**
 * Deterministic request-compatibility generation token (F2; RGY-005):
 * domain digest over the verified store instance identity (both namespace
 * identities), the scan mode, the effective entry/byte limits, the
 * fail-closed behavior, and the class-order model version. Identical
 * stores, modes, and bounds yield identical tokens; registry and recovery
 * scans over the same store and numeric limits produce DIFFERENT tokens
 * because their modes differ.
 */
export function computeScanGeneration(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly mode: ScanMode;
  readonly entryLimit: number;
  readonly byteLimit: number;
  readonly failClosed: boolean;
}): string {
  const tuple = jcsSerialize({
    modelVersion: SCAN_MODEL_VERSION,
    mode: input.mode,
    storeInstance: input.storeInstance.namespaces
      .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    entryLimit: input.entryLimit,
    byteLimit: input.byteLimit,
    failClosed: input.failClosed,
  });
  return computeDomainDigest(SCAN_GENERATION_DOMAIN, tuple);
}

/** Descriptor identity of a directory (never exposed raw; F3-G binds it only through a digest). */
interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

/**
 * Cross-page structural snapshot (F3-G): parent presence and identity,
 * expected record-class presence set, `audit-event` presence, and the
 * identities of every present class directory.
 */
interface SurfaceStructure {
  /** Absent (undefined) when the parent was never successfully opened. */
  readonly recordsParent: DirectoryIdentity | undefined;
  readonly auditParent: DirectoryIdentity | undefined;
  /** Present record classes in taxonomy order. */
  readonly recordClasses: readonly RecordClassId[];
  readonly auditEventPresent: boolean;
  /** Identities of every present class directory (records classes and audit-event). */
  readonly classIdentities: ReadonlyMap<RecordClassId, DirectoryIdentity>;
  /** WP-8-F quarantine structure (recovery mode only). */
  readonly quarantineParent: DirectoryIdentity | undefined;
  readonly quarantineTemporaryPresent: boolean;
  readonly quarantineShards: readonly { readonly shard: string; readonly dev: number; readonly ino: number }[];
}

/**
 * Deterministic cross-page surface-generation token (F3-G): domain digest
 * over the structural snapshot. Absent-on-both-pages is unchanged (same
 * digest); present-to-absent, absent-to-present, class-set change, parent
 * disappearance, and directory replacement/identity change all change the
 * digest and fail closed on resume with ERR-STO-ROOT-IDENTITY-CHANGED.
 */
function computeSurfaceGeneration(structure: SurfaceStructure): string {
  // The store-evidence-record class is excluded from the structural token:
  // evidence directories legitimately appear as the direct result of
  // recovery-mutation execution itself (WP-8-F), so their appearance must
  // not be treated as structural drift by later recovery steps or resumed
  // pages. The class is still enumerated and verified by the scan.
  // Quarantine structure is bound in recovery mode only (QRN/WP-8-F §8).
  const recordClasses = structure.recordClasses.filter((c) => c !== 'store-evidence-record');
  const classIdentities = [...structure.classIdentities.entries()]
    .filter(([recordClass]) => recordClass !== 'store-evidence-record')
    .map(([recordClass, identity]) => ({ recordClass, dev: identity.dev, ino: identity.ino }))
    .sort((a, b) => (a.recordClass < b.recordClass ? -1 : a.recordClass > b.recordClass ? 1 : 0));
  const quarantineShards = [...structure.quarantineShards]
    .map((q) => ({ shard: q.shard, dev: q.dev, ino: q.ino }))
    .sort((a, b) => (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : 0));
  const tuple = jcsSerialize({
    modelVersion: SCAN_MODEL_VERSION,
    recordsParent: structure.recordsParent ?? null,
    auditParent: structure.auditParent ?? null,
    recordClasses,
    auditEventPresent: structure.auditEventPresent,
    classIdentities,
    quarantineParent: structure.quarantineParent ?? null,
    quarantineTemporaryPresent: structure.quarantineTemporaryPresent,
    quarantineShards,
  });
  return computeDomainDigest(SCAN_SURFACE_GENERATION_DOMAIN, tuple);
}

/**
 * Recompute the current cross-page surface-structure token (WP-8-F): the
 * mutation boundary re-reads the structural snapshot and compares it with
 * the assessment-bound token before any mutation (F3-G drift rule).
 */
export function recomputeSurfaceGeneration(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly mode: ScanMode;
  readonly hooks?: ScanHooks;
}): { readonly ok: boolean; readonly generation?: string; readonly code?: string; readonly message?: string } {
  const structureRead = readSurfaceStructure({ namespaceRoot: input.namespaceRoot, serviceUid: input.serviceUid, hooks: input.hooks, report: false, mode: input.mode });
  if (!structureRead.ok || structureRead.structure === undefined) {
    return { ok: false, code: structureRead.code ?? 'ERR-STO-IO-FAILURE', message: structureRead.message ?? 'surface structure could not be re-read' };
  }
  return { ok: true, generation: computeSurfaceGeneration(structureRead.structure) };
}

/** Deterministic scan class order: the 15 `.rec` classes (taxonomy order), then the audit class. */
function scanClassOrder(): RecordClassId[] {
  const records: RecordClassId[] = [];
  for (const profile of RECORD_CLASS_PROFILES) {
    if (profile.namespace === 'store-records' && profile.suffix === '.rec' && profile.id !== 'store-metadata') records.push(profile.id);
  }
  return [...records, 'authoritative-audit-event'];
}

/** Store-namespace record classes partitioned under `records/` (LAY-005). */
function storeRecordClassProfiles(): readonly (typeof RECORD_CLASS_PROFILES)[number][] {
  // `store-metadata` is excluded: it is persisted at `metadata/metadata.json`
  // (STORE_METADATA_RELATIVE_PATH), never under `records/`.
  return RECORD_CLASS_PROFILES.filter((p) => p.namespace === 'store-records' && p.suffix === '.rec' && p.id !== 'store-metadata');
}

/** The scanner's own cursor validator (F1-S: every emitted cursor must pass it). */
function cursorShapeValid(cursor: ScanCursor): boolean {
  const profile = RECORD_CLASS_BY_ID.get(cursor.recordClass);
  return (
    typeof cursor.generation === 'string' &&
    isValidDigestSyntax(cursor.generation) &&
    typeof cursor.surfaceGeneration === 'string' &&
    isValidDigestSyntax(cursor.surfaceGeneration) &&
    profile !== undefined &&
    profile.namespace === 'store-records' &&
    SHARD_RE.test(cursor.shard) &&
    cursor.entry.length > 0 &&
    cursor.entry.length <= 128
  );
}

interface DirectoryBracket {
  readonly names: readonly string[];
  /** True only when the directory was absent on the FIRST open attempt (F4). */
  readonly absent: boolean;
  /** Descriptor identity of the opened directory (present when not absent; F3-G). */
  readonly identity: DirectoryIdentity;
}

/**
 * Descriptor-verified readdir bracket (FSP-004, SRX-013): open the directory
 * no-follow, verify type/UID/mode from the descriptor, readdir, run the
 * test-only hook, re-open and compare the identity snapshot. Any drift fails
 * closed.
 *
 * F4: a directory that was successfully opened and verified and then fails
 * to re-open (or vanishes during readdir) is identity drift and fails
 * closed with ERR-STO-ROOT-IDENTITY-CHANGED — never `absent:true`. Only a
 * first-attempt ENOENT (the directory was never successfully opened) is an
 * absent surface, which the caller may treat as legitimately absent where
 * the contract allows (phase-2 stores lack `records/`, `audit/`, `locks/`).
 */
function readdirVerified(path: string, serviceUid: number, hooks: ScanHooks | undefined, location: Parameters<NonNullable<ScanHooks['afterReaddir']>>[0]): { readonly ok: boolean; readonly bracket?: DirectoryBracket; readonly code?: string; readonly message?: string } {
  let beforeFd: number | undefined;
  let afterFd: number | undefined;
  let opened = false;
  try {
    beforeFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const pre = fstatSync(beforeFd);
    if (!pre.isDirectory()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'expected a directory at a scan surface' };
    }
    if (pre.uid !== serviceUid || (pre.mode & 0o777) !== 0o700) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'scan surface directory violates the store permission policy' };
    }
    opened = true;
    const identity: DirectoryIdentity = { dev: Number(pre.dev), ino: Number(pre.ino) };
    let names: string[];
    try {
      names = readdirSync(path);
    } finally {
      closeSync(beforeFd);
      beforeFd = undefined;
    }
    hooks?.afterReaddir?.(location);
    afterFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const post = fstatSync(afterFd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'directory identity changed during the scan' };
    }
    return { ok: true, bracket: { names: [...names].sort(), absent: false, identity } };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (opened) {
      // F4: post-open disappearance (or readdir-time disappearance) is
      // identity drift, never absence.
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'scan surface directory disappeared or changed during the scan' };
    }
    if (code === 'ENOENT') return { ok: true, bracket: { names: [], absent: true, identity: { dev: 0, ino: 0 } } };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'scan surface is not accessible' };
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'scan surface could not be enumerated' };
  } finally {
    if (beforeFd !== undefined) closeSync(beforeFd);
    if (afterFd !== undefined) closeSync(afterFd);
  }
}

/** Descriptor facts for one opened object (never a path). */
function statFacts(stat: ReturnType<typeof fstatSync>): ScannedObjectStat {
  return {
    fileType: stat.isFile() ? 'regular' : stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'special',
    uid: Number(stat.uid),
    mode: Number(stat.mode) & 0o777,
    nlink: Number(stat.nlink),
    size: Number(stat.size),
    dev: Number(stat.dev),
    ino: Number(stat.ino),
  };
}

/** Lightweight no-follow directory identity read (F3-G structural pass). */
function statDirectoryIdentity(path: string): { readonly ok: boolean; readonly identity?: DirectoryIdentity; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const st = fstatSync(fd);
    return { ok: true, identity: { dev: Number(st.dev), ino: Number(st.ino) } };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'class directory is not accessible' };
    // Symlinked, non-directory, or otherwise unopenable class positions fail
    // closed with the same coarse mapping as the class-dir bracket (F5
    // deferred).
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'class directory identity could not be read' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Structural snapshot pass (F3-G + F3): read the `records/` and `audit/`
 * parents (descriptor-verified; F4 within-page drift applies), derive the
 * expected record-class presence set and `audit-event` presence, read every
 * present class directory's identity, and — on the first page only
 * (`report`) — emit parent-level foreign observations and missing-class
 * findings. The returned structure feeds the class-loop membership, the
 * class-dir identity verification, and the cross-page surface digest.
 * Budget-free: the structure is bounded by the closed taxonomy.
 */
function readSurfaceStructure(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly hooks: ScanHooks | undefined;
  readonly report: boolean;
  /** Registry mode excludes quarantine structure; recovery mode binds it (WP-8-F §8). */
  readonly mode: ScanMode;
}): { readonly ok: boolean; readonly structure?: SurfaceStructure; readonly observations?: readonly ForeignScanObservation[]; readonly findings?: readonly StorageFinding[]; readonly code?: string; readonly message?: string } {
  const recordsBracket = readdirVerified(`${input.namespaceRoot}/records`, input.serviceUid, input.hooks, { surface: 'records' });
  if (!recordsBracket.ok || recordsBracket.bracket === undefined) {
    return { ok: false, code: recordsBracket.code ?? 'ERR-STO-IO-FAILURE', message: recordsBracket.message ?? 'records parent scan failed' };
  }
  const auditBracket = readdirVerified(`${input.namespaceRoot}/audit`, input.serviceUid, input.hooks, { surface: 'audit' });
  if (!auditBracket.ok || auditBracket.bracket === undefined) {
    return { ok: false, code: auditBracket.code ?? 'ERR-STO-IO-FAILURE', message: auditBracket.message ?? 'audit parent scan failed' };
  }
  const recordsNames = recordsBracket.bracket.absent ? [] : recordsBracket.bracket.names;
  const auditNames = auditBracket.bracket.absent ? [] : auditBracket.bracket.names;
  const recordsNameSet = new Set(recordsNames);
  const auditNameSet = new Set(auditNames);
  const expectedSegments = new Map<string, RecordClassId>();
  for (const profile of storeRecordClassProfiles()) expectedSegments.set(profile.segment, profile.id);

  const recordClasses: RecordClassId[] = scanClassOrder().filter((recordClass) => {
    const profile = RECORD_CLASS_BY_ID.get(recordClass);
    return profile !== undefined && profile.suffix === '.rec' && recordsNameSet.has(profile.segment);
  });
  const auditEventPresent = auditNameSet.has('audit-event');

  // WP-8-F quarantine structure (recovery mode only): the quarantine
  // parent, the temporary class directory, and every 4-hex shard identity.
  let quarantineParent: DirectoryIdentity | undefined;
  let quarantineTemporaryPresent = false;
  const quarantineShards: { readonly shard: string; readonly dev: number; readonly ino: number }[] = [];
  if (input.mode === 'recovery') {
    const quarantineBracket = readdirVerified(`${input.namespaceRoot}/quarantine`, input.serviceUid, input.hooks, { surface: 'quarantine' });
    if (!quarantineBracket.ok || quarantineBracket.bracket === undefined) {
      return { ok: false, code: quarantineBracket.code ?? 'ERR-STO-IO-FAILURE', message: quarantineBracket.message ?? 'quarantine parent scan failed' };
    }
    if (!quarantineBracket.bracket.absent) {
      quarantineParent = quarantineBracket.bracket.identity;
      const temporaryNames = quarantineBracket.bracket.names.filter((n) => n === 'temporary');
      if (temporaryNames.length === 1) {
        const temporaryBracket = readdirVerified(`${input.namespaceRoot}/quarantine/temporary`, input.serviceUid, input.hooks, { surface: 'quarantine-temporary' });
        if (!temporaryBracket.ok || temporaryBracket.bracket === undefined) {
          return { ok: false, code: temporaryBracket.code ?? 'ERR-STO-IO-FAILURE', message: temporaryBracket.message ?? 'quarantine temporary class scan failed' };
        }
        if (!temporaryBracket.bracket.absent) {
          quarantineTemporaryPresent = true;
          for (const shardName of temporaryBracket.bracket.names) {
            if (!SHARD_RE.test(shardName)) continue;
            const identity = statDirectoryIdentity(`${input.namespaceRoot}/quarantine/temporary/${shardName}`);
            if (!identity.ok) {
              return { ok: false, code: identity.code ?? 'ERR-STO-IO-FAILURE', message: identity.message ?? 'quarantine shard identity could not be read' };
            }
            if (identity.identity === undefined) {
              return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'quarantine shard disappeared during the scan' };
            }
            quarantineShards.push({ shard: shardName, dev: identity.identity.dev, ino: identity.identity.ino });
          }
        }
      }
    }
  }

  const observations: ForeignScanObservation[] = [];
  const findings: StorageFinding[] = [];
  if (input.report) {
    for (const name of recordsNames) {
      if (expectedSegments.has(name)) continue;
      observations.push(foreignParentObservation(`${input.namespaceRoot}/records`, 'records', name));
    }
    for (const name of auditNames) {
      if (name === 'audit-event') continue;
      observations.push(foreignParentObservation(`${input.namespaceRoot}/audit`, 'audit', name));
    }
    for (const [segment, classId] of expectedSegments) {
      if (!recordsNameSet.has(segment)) {
        findings.push(finding('ERR-STO-INTEGRITY', `required record-class directory is absent: ${classId}`));
      }
    }
    if (!auditEventPresent) {
      findings.push(finding('ERR-STO-INTEGRITY', 'required audit class directory is absent: authoritative-audit-event'));
    }
  }

  // Identities of every present class directory (records classes and the
  // audit class). A class listed by its parent but absent at the identity
  // read is disappearance → drift (F4 rule).
  const classIdentities = new Map<RecordClassId, DirectoryIdentity>();
  for (const recordClass of [...recordClasses, ...(auditEventPresent ? (['authoritative-audit-event'] as RecordClassId[]) : [])]) {
    const profile = RECORD_CLASS_BY_ID.get(recordClass);
    if (profile === undefined) continue;
    const surface = profile.suffix === '.aud' ? 'audit' : 'records';
    const identity = statDirectoryIdentity(`${input.namespaceRoot}/${surface}/${profile.segment}`);
    if (!identity.ok) {
      return { ok: false, code: identity.code ?? 'ERR-STO-IO-FAILURE', message: identity.message ?? 'class directory identity could not be read' };
    }
    if (identity.identity === undefined) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'class directory disappeared during the scan' };
    }
    classIdentities.set(recordClass, identity.identity);
  }

  return {
    ok: true,
    structure: {
      recordsParent: recordsBracket.bracket.absent ? undefined : recordsBracket.bracket.identity,
      auditParent: auditBracket.bracket.absent ? undefined : auditBracket.bracket.identity,
      recordClasses,
      auditEventPresent,
      classIdentities,
      quarantineParent,
      quarantineTemporaryPresent,
      quarantineShards,
    },
    observations,
    findings,
  };
}

/** Foreign parent entry observation with best-effort descriptor facts (never opened for content). */
function foreignParentObservation(parentPath: string, surface: 'records' | 'audit', name: string): ForeignScanObservation {
  let stat: ScannedObjectStat | undefined;
  let fd: number | undefined;
  try {
    fd = openSync(`${parentPath}/${name}`, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    stat = statFacts(fstatSync(fd));
  } catch {
    stat = undefined; // symlinks, sockets, and other unopenable objects carry no stat
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { id: observationId('foreign-object', surface, undefined, name), entry: name, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', ...(stat !== undefined ? { stat } : {}) };
}

/**
 * Scan one candidate record/audit entry (records/audit surfaces). Bounded
 * descriptor read with pre/post revalidation; pure fact extraction; the
 * classifier decides the category. Returns `null` when a bound stops the
 * scan (truncation or fail-closed) and `'stop'` semantics are handled by
 * the caller.
 */
function scanRecordEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly component: string;
  readonly shard: string;
  readonly recordClass: RecordClassId;
  readonly serviceUid: number;
  readonly recordBytes: number;
  readonly bounds: { readonly entryLimit: number; readonly byteLimit: number; readonly failClosed: boolean };
  readonly state: { readonly scannedBytes: number };
}): { readonly observation?: ScanObservation; readonly stop?: 'truncated' | 'failed'; readonly code?: string; readonly message?: string } {
  const derived = deriveRecordRelativePath(input.recordClass, `pgw:r:${input.component}`);
  const derivedOk = derived.ok && derived.filename === input.name && derived.shard === input.shard;
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const fileType = pre.isFile() ? 'regular' : pre.isSymbolicLink() ? 'symlink' : pre.isDirectory() ? 'directory' : 'special';
    const stat = statFacts(pre);
    if (input.state.scannedBytes + stat.size > input.bounds.byteLimit) {
      closeSync(fd);
      fd = undefined;
      return { stop: input.bounds.failClosed ? 'failed' : 'truncated', code: 'ERR-STO-LIMIT-EXCEEDED' };
    }
    let facts: CandidateFacts;
    // Content is read and verified even when the link count is unexpected:
    // the crash-twin case (WPR-023 (a)) inherently leaves both names at
    // nlink 2, and the (a) classification requires the published record's
    // bytes to verify against the twin inode.
    if (fileType === 'regular' && stat.uid === input.serviceUid && (stat.mode & 0o777) === 0o600 && stat.size <= input.recordBytes) {
      const bytes = readFileSync(fd);
      const post = fstatSync(fd);
      const revalidated = comparePrePostStat(pre, post);
      if (!revalidated.ok || post.size !== bytes.length) {
        closeSync(fd);
        fd = undefined;
        return { observation: recordObservation(input.recordClass, input.shard, input.name, stat, { classification: 'malformed', code: 'ERR-STO-INTEGRITY', message: 'record changed during descriptor-based read' }, undefined, undefined) };
      }
      const extracted = extractEnvelopeFacts({ raw: bytes.toString('utf8'), byteLimit: input.recordBytes, component: input.component, recordClass: input.recordClass });
      facts = {
        entryName: input.name,
        recordClass: input.recordClass,
        shard: input.shard,
        derived: { ok: derivedOk, shard: derived.ok ? derived.shard : undefined, filename: derived.ok ? derived.filename : undefined },
        fileType,
        uidOk: stat.uid === input.serviceUid,
        modeOk: (stat.mode & 0o777) === 0o600,
        nlink: stat.nlink,
        size: stat.size,
        byteLimit: input.recordBytes,
        nameGrammarOk: true,
        ...extracted,
      };
      const classified = classifyCandidate(facts);
      const observation = recordObservation(input.recordClass, input.shard, input.name, stat, classified, extracted.envelope, extracted.auditAssociation);
      if (input.recordClass === 'store-evidence-record' && observation.kind === 'record' && observation.envelope !== undefined && classified.classification === 'valid-immutable-record') {
        const qFacts = extractQuarantineEvidenceFacts(bytes.toString('utf8'));
        if (qFacts.quarantineId !== undefined && qFacts.sourceDigest !== undefined && qFacts.sourceEntry !== undefined) {
          return { observation: { ...observation, quarantineEvidenceFacts: { quarantineId: qFacts.quarantineId, sourceDigest: qFacts.sourceDigest, sourceEntry: qFacts.sourceEntry } } };
        }
      }
      return { observation };
    }
    // Non-regular, policy-violating, hard-linked, or over-limit content:
    // classification without reading (precedence inside classifyCandidate).
    facts = {
      entryName: input.name,
      recordClass: input.recordClass,
      shard: input.shard,
      derived: { ok: derivedOk, shard: derived.ok ? derived.shard : undefined, filename: derived.ok ? derived.filename : undefined },
      fileType,
      uidOk: stat.uid === input.serviceUid,
      modeOk: (stat.mode & 0o777) === 0o600,
      nlink: stat.nlink,
      size: stat.size,
      byteLimit: input.recordBytes,
      nameGrammarOk: true,
      rawParses: false,
      canonicalOk: false,
      minimumEnvelopeParses: false,
      versionStructurallyValid: false,
      versionSupported: false,
      envelopeDeferredOk: false,
      digestOk: false,
      identityComponentMatches: false,
      classLabelMatches: false,
    };
    const classified = classifyCandidate(facts);
    return { observation: recordObservation(input.recordClass, input.shard, input.name, stat, classified, undefined, undefined) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENXIO: Unix-domain socket; ELOOP: symlink; ENOTDIR: dangling entry;
    // EISDIR: directory without the directory flag. All are special/non-
    // regular locations → wrong-type (FSP-003/005).
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { observation: recordObservation(input.recordClass, input.shard, input.name, undefined, { classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'record location is not a regular file' }, undefined, undefined) };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { observation: recordObservation(input.recordClass, input.shard, input.name, undefined, { classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'record is not accessible under the store permission policy' }, undefined, undefined) };
    }
    return { stop: 'failed', code: 'ERR-STO-IO-FAILURE', message: 'record could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function recordObservation(
  recordClass: RecordClassId,
  shard: string,
  name: string,
  stat: ScannedObjectStat | undefined,
  classified: { readonly classification: 'valid-immutable-record' | 'malformed' | 'unsupported-version' | 'digest-mismatch' | 'wrong-derived-location' | 'wrong-type' | 'wrong-uid-or-mode' | 'unexpected-hard-link' | 'foreign-entry' | 'incomplete-relationship' | 'duplicate-conflicting-identity'; readonly code: string; readonly message: string },
  envelope: RecordObservationFacts | undefined,
  auditAssociation: AuditAssociationFacts | undefined,
): RecordScanObservation | AuditScanObservation {
  const base = { id: observationId(recordClass === 'authoritative-audit-event' ? 'audit-event' : 'record', recordClass, shard, name), entry: name, code: classified.code, ...(stat !== undefined ? { stat } : {}) };
  if (recordClass === 'authoritative-audit-event') {
    return { ...base, kind: 'audit-event', recordClass, shard, classification: classified.classification, ...(envelope !== undefined ? { envelope } : {}), ...(auditAssociation !== undefined ? { auditAssociation } : {}) };
  }
  return { ...base, kind: 'record', recordClass, shard, classification: classified.classification, ...(envelope !== undefined ? { envelope } : {}) };
}

/**
 * Scan the `tmp/` surface (recovery mode; WPR-023/CSA-010/015). Temporary
 * names are classified against the closed WPR-023 categories; the scan
 * never removes, renames, or repairs anything.
 */
function scanTemporaryEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly serviceUid: number;
  readonly temporaryBytes: number;
  readonly recordBytes: number;
  readonly bounds: { readonly entryLimit: number; readonly byteLimit: number; readonly failClosed: boolean };
  readonly state: { readonly scannedBytes: number };
  readonly publishedInodes: ReadonlyMap<string, boolean>;
}): { readonly observation?: ScanObservation; readonly stop?: 'truncated' | 'failed'; readonly code?: string; readonly message?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (input.state.scannedBytes + stat.size > input.bounds.byteLimit) {
      closeSync(fd);
      fd = undefined;
      return { stop: input.bounds.failClosed ? 'failed' : 'truncated', code: 'ERR-STO-LIMIT-EXCEEDED' };
    }
    const inodeKey = `${stat.dev}:${stat.ino}`;
    const sharesInodeWithPublished = input.publishedInodes.has(inodeKey);
    const observationBase = { id: observationId('temporary-object', undefined, undefined, input.name), entry: input.name };
    if (stat.fileType !== 'regular' || stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      closeSync(fd);
      fd = undefined;
      const code = stat.fileType !== 'regular' ? 'ERR-STO-FTYPE-UNSUPPORTED' : 'ERR-STO-PERM-DENIED';
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'temporary-other',
        code,
        sharesInodeWithPublished: false,
        stat,
      };
      return { observation };
    }
    if (sharesInodeWithPublished) {
      // WP-8-F: the crash-twin observation carries the twin's envelope
      // facts (the temporary IS the published bytes). Bounded descriptor
      // read with pre/post revalidation; a read or parse failure still
      // classifies (a) from the inode relationship but attaches no
      // envelope (the recovery executor then requires disposition).
      let envelope: RecordObservationFacts | undefined;
      if (stat.size <= input.recordBytes) {
        try {
          const bytes = readFileSync(fd);
          const post = fstatSync(fd);
          const revalidated = comparePrePostStat(pre, post);
          if (revalidated.ok && post.size === bytes.length) {
            const extracted = extractEnvelopeFacts({ raw: bytes.toString('utf8'), byteLimit: input.recordBytes, component: '' });
            if (extracted.rawParses && extracted.canonicalOk && extracted.envelope !== undefined) envelope = extracted.envelope;
          }
        } catch {
          envelope = undefined;
        }
      }
      closeSync(fd);
      fd = undefined;
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'orphan-referencing-published',
        code: '',
        sharesInodeWithPublished: true,
        stat,
        ...(envelope !== undefined ? { envelope } : {}),
      };
      return { observation };
    }
    if (stat.size > input.temporaryBytes) {
      closeSync(fd);
      fd = undefined;
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'malformed-temporary',
        code: 'ERR-STO-LIMIT-EXCEEDED',
        sharesInodeWithPublished: false,
        stat,
      };
      return { observation };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      closeSync(fd);
      fd = undefined;
      const observation: TemporaryScanObservation = {
        ...observationBase,
        kind: 'temporary-object',
        classification: 'temporary-other',
        code: 'ERR-STO-INTEGRITY',
        sharesInodeWithPublished: false,
        stat,
      };
      return { observation };
    }
    const raw = bytes.toString('utf8');
    // Deterministic content digest over the raw bytes (WP-8-F: the source
    // content digest is the pre-mutation evidence digest for (b)/(c)
    // quarantine sources).
    const contentDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
    // The temporary's record class is unknown from its name; parse without
    // the class-label check. Complete canonical records → (b) incomplete
    // unpublished; anything else → (c) malformed temporary.
    let parsed = false;
    let envelope: RecordObservationFacts | undefined;
    try {
      const extracted = extractEnvelopeFacts({ raw, byteLimit: input.recordBytes, component: '' });
      parsed = extracted.rawParses && extracted.canonicalOk && extracted.minimumEnvelopeParses && extracted.versionStructurallyValid && extracted.versionSupported && extracted.envelopeDeferredOk && extracted.digestOk && extracted.identityComponentMatches;
      envelope = extracted.envelope;
    } catch {
      parsed = false;
    }
    const observation: TemporaryScanObservation = {
      ...observationBase,
      kind: 'temporary-object',
      classification: parsed ? 'incomplete-unpublished' : 'malformed-temporary',
      code: parsed ? '' : 'ERR-STO-MALFORMED',
      contentDigest,
      sharesInodeWithPublished: false,
      stat,
      ...(envelope !== undefined ? { envelope } : {}),
    };
    return { observation };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      const observation: TemporaryScanObservation = {
        id: observationId('temporary-object', undefined, undefined, input.name),
        entry: input.name,
        kind: 'temporary-object',
        classification: 'temporary-other',
        code: 'ERR-STO-FTYPE-UNSUPPORTED',
        sharesInodeWithPublished: false,
      };
      return { observation };
    }
    return { stop: 'failed', code: 'ERR-STO-IO-FAILURE', message: 'temporary object could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Scan the `locks/` surface (recovery mode; LOK-004…008). Observation only. */
function scanLockEntry(input: {
  readonly path: string;
  readonly name: string;
  readonly serviceUid: number;
  readonly bounds: { readonly entryLimit: number; readonly byteLimit: number; readonly failClosed: boolean };
  readonly state: { readonly scannedBytes: number };
  readonly expectedStoreInstance: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
}): { readonly observation?: ScanObservation; readonly stop?: 'truncated' | 'failed'; readonly code?: string; readonly message?: string } {
  const observationBase = { id: observationId('lock-object', undefined, undefined, input.name), entry: input.name };
  if (input.name !== 'writer.lock') {
    const observation: ForeignScanObservation = { ...observationBase, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' };
    return { observation };
  }
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (input.state.scannedBytes + stat.size > input.bounds.byteLimit) {
      closeSync(fd);
      fd = undefined;
      return { stop: input.bounds.failClosed ? 'failed' : 'truncated', code: 'ERR-STO-LIMIT-EXCEEDED' };
    }
    if (stat.fileType !== 'regular') {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-foreign', code: 'ERR-STO-FTYPE-UNSUPPORTED', stat };
      return { observation };
    }
    if (stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-foreign', code: 'ERR-STO-PERM-DENIED', stat };
      return { observation };
    }
    if (stat.size > LOCK_RECORD_MAX_BYTES) {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-LIMIT-EXCEEDED', stat };
      return { observation };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      closeSync(fd);
      fd = undefined;
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-INTEGRITY', stat };
      return { observation };
    }
    const parsed = parseLockRecordFacts(bytes.toString('utf8'), input.expectedStoreInstance);
    closeSync(fd);
    fd = undefined;
    const observation: LockScanObservation = {
      ...observationBase,
      kind: 'lock-object',
      classification: parsed.ok ? (parsed.storeInstanceMatches ? 'writer-lock-present' : 'writer-lock-foreign') : 'writer-lock-malformed',
      code: parsed.ok ? '' : 'ERR-STO-MALFORMED',
      stat,
      ...(parsed.facts !== undefined ? { lock: parsed.facts } : {}),
    };
    return { observation };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const observation: LockScanObservation = { ...observationBase, kind: 'lock-object', classification: 'writer-lock-malformed', code: 'ERR-STO-INTEGRITY' };
      return { observation };
    }
    return { stop: 'failed', code: 'ERR-STO-IO-FAILURE', message: 'lock object could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Scan the `quarantine/` surface (WP-8-F; recovery mode only). The surface
 * layout is fixed: `quarantine/temporary/<shard>/<quarantineId>.qtn`
 * (ADR-030). Foreign entries, malformed names, wrong types, wrong
 * UID/mode, unexpected link counts, and unknown shards/classes are
 * classified deterministically; every valid `.qtn` object is matched
 * against its identity-derived recovery evidence and against `tmp/`
 * objects sharing its inode (interrupted-link / conflict states).
 */
function scanQuarantineSurface(input: {
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly hooks: ScanHooks | undefined;
  readonly storeInstance: VerifiedStoreInstance;
  readonly temporaryBytes: number;
  readonly tmpObservations: readonly TemporaryScanObservation[];
}): { readonly ok: boolean; readonly observations: readonly QuarantineScanObservation[]; readonly findings: readonly StorageFinding[]; readonly code?: string; readonly message?: string } {
  const observations: QuarantineScanObservation[] = [];
  const findings: StorageFinding[] = [];
  const quarantineDir = `${input.namespaceRoot}/quarantine`;
  const quarantineBracket = readdirVerified(quarantineDir, input.serviceUid, input.hooks, { surface: 'quarantine' });
  if (!quarantineBracket.ok || quarantineBracket.bracket === undefined) {
    return { ok: false, observations, findings, code: quarantineBracket.code ?? 'ERR-STO-IO-FAILURE', message: quarantineBracket.message ?? 'quarantine parent scan failed' };
  }
  if (quarantineBracket.bracket.absent) return { ok: true, observations, findings };
  for (const name of quarantineBracket.bracket.names) {
    if (name === 'temporary') continue;
    observations.push({
      id: quarantineObservationId('', name),
      entry: name,
      kind: 'quarantine-object',
      shard: '',
      classification: 'foreign-entry',
      code: 'ERR-STO-MALFORMED',
    });
  }
  if (!quarantineBracket.bracket.names.includes('temporary')) return { ok: true, observations, findings };
  const temporaryBracket = readdirVerified(`${quarantineDir}/temporary`, input.serviceUid, input.hooks, { surface: 'quarantine-temporary' });
  if (!temporaryBracket.ok || temporaryBracket.bracket === undefined) {
    return { ok: false, observations, findings, code: temporaryBracket.code ?? 'ERR-STO-IO-FAILURE', message: temporaryBracket.message ?? 'quarantine temporary class scan failed' };
  }
  if (temporaryBracket.bracket.absent) return { ok: true, observations, findings };
  for (const shardName of temporaryBracket.bracket.names) {
    if (!SHARD_RE.test(shardName)) {
      observations.push({
        id: quarantineObservationId('', shardName),
        entry: shardName,
        kind: 'quarantine-object',
        shard: '',
        classification: 'foreign-entry',
        code: 'ERR-STO-MALFORMED',
      });
      continue;
    }
    const shardBracket = readdirVerified(`${quarantineDir}/temporary/${shardName}`, input.serviceUid, input.hooks, { surface: 'quarantine-temporary', shard: shardName });
    if (!shardBracket.ok || shardBracket.bracket === undefined) {
      return { ok: false, observations, findings, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'quarantine shard scan failed' };
    }
    if (shardBracket.bracket.absent) {
      return { ok: false, observations, findings, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'quarantine shard disappeared during the scan' };
    }
    for (const entryName of shardBracket.bracket.names) {
      const base = { id: quarantineObservationId(shardName, entryName), entry: entryName, kind: 'quarantine-object' as const, shard: shardName };
      if (!QUARANTINE_NAME_RE.test(entryName)) {
        observations.push({
          ...base,
          classification: entryName.endsWith(QUARANTINE_SUFFIX) ? 'quarantine-malformed' : 'foreign-entry',
          code: 'ERR-STO-MALFORMED',
        });
        continue;
      }
      const quarantineId = entryName.slice(0, 64);
      const objectRead = readQuarantineObject({
        path: `${quarantineDir}/temporary/${shardName}/${entryName}`,
        serviceUid: input.serviceUid,
        byteLimit: input.temporaryBytes,
      });
      if (!objectRead.ok) {
        observations.push({ ...base, quarantineId, classification: objectRead.classification ?? 'quarantine-malformed', code: objectRead.code ?? '' });
        continue;
      }
      // Interrupted-link detection: any tmp/ object sharing this inode.
      const tmpTwin = input.tmpObservations.find((t) => t.stat !== undefined && t.stat.dev === objectRead.dev && t.stat.ino === objectRead.ino);
      if (tmpTwin !== undefined) {
        observations.push({
          ...base,
          quarantineId,
          classification: 'quarantine-interrupted-link',
          code: 'ERR-STO-INTEGRITY',
          sourceEntry: tmpTwin.entry,
          contentDigest: objectRead.contentDigest ?? '',
          envelope: objectRead.envelope,
          sharesInodeWithTemporary: true,
        });
        continue;
      }
      if (objectRead.nlink !== 1) {
        observations.push({ ...base, quarantineId, classification: 'unexpected-hard-link', code: 'ERR-STO-INTEGRITY', contentDigest: objectRead.contentDigest });
        continue;
      }
      // Evidence matching (identity-derived; outcome `quarantined`).
      const evidenceId = computeQuarantineEvidenceIdentity({ storeInstance: input.storeInstance, quarantineId, sourceDigest: objectRead.contentDigest ?? '', outcome: 'quarantined' });
      const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceId);
      const evidencePath = evidenceDerived.ok ? `${input.namespaceRoot}/${evidenceDerived.relativePath}` : undefined;
      const evidence = evidencePath === undefined ? undefined : verifyObjectBytesAt({ path: evidencePath, serviceUid: input.serviceUid, byteLimit: input.temporaryBytes });
      if (evidence !== undefined && evidence.ok && evidence.canonicalUtf8 !== undefined) {
        const facts = extractQuarantineEvidenceFacts(evidence.canonicalUtf8);
        const matching = facts.quarantineId === quarantineId && facts.sourceDigest === (objectRead.contentDigest ?? '');
        if (matching) {
          observations.push({
            ...base,
            quarantineId,
            classification: 'quarantined-valid',
            code: '',
            sourceEntry: facts.sourceEntry,
            contentDigest: objectRead.contentDigest,
            envelope: objectRead.envelope,
          });
          continue;
        }
        observations.push({ ...base, quarantineId, classification: 'quarantine-conflict', code: 'ERR-STO-INTEGRITY', contentDigest: objectRead.contentDigest });
        continue;
      }
      observations.push({ ...base, quarantineId, classification: 'quarantined-missing-evidence', code: 'ERR-STO-INTEGRITY', contentDigest: objectRead.contentDigest, envelope: objectRead.envelope });
    }
  }
  return { ok: true, observations, findings };
}

/** Descriptor-bound read of one quarantine object (regular-file policy). */
function readQuarantineObject(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): { readonly ok: boolean; readonly classification?: QuarantineObjectClassification; readonly code?: string; readonly message?: string; readonly dev?: number; readonly ino?: number; readonly nlink?: number; readonly contentDigest?: string; readonly envelope?: RecordObservationFacts } {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const stat = statFacts(pre);
    if (stat.fileType !== 'regular') {
      return { ok: false, classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'quarantine location is not a regular file' };
    }
    if (stat.uid !== input.serviceUid || (stat.mode & 0o777) !== 0o600) {
      return { ok: false, classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'quarantine object violates the store permission policy' };
    }
    if (pre.size > input.byteLimit) {
      return { ok: false, classification: 'quarantine-malformed', code: 'ERR-STO-LIMIT-EXCEEDED', message: 'quarantine object exceeds the bounded byte limit' };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, classification: 'quarantine-malformed', code: 'ERR-STO-INTEGRITY', message: 'quarantine object changed during descriptor-based read' };
    }
    const raw = bytes.toString('utf8');
    const contentDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
    let envelope: RecordObservationFacts | undefined;
    try {
      const extracted = extractEnvelopeFacts({ raw, byteLimit: input.byteLimit, component: '' });
      if (extracted.rawParses && extracted.canonicalOk && extracted.envelope !== undefined) envelope = extracted.envelope;
    } catch {
      envelope = undefined;
    }
    return {
      ok: true,
      dev: Number(pre.dev),
      ino: Number(pre.ino),
      nlink: Number(pre.nlink),
      contentDigest,
      envelope,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'ENODEV' || code === 'EISDIR') {
      return { ok: false, classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'quarantine location is not a regular file' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'quarantine object is not accessible' };
    }
    return { ok: false, classification: 'quarantine-malformed', code: 'ERR-STO-IO-FAILURE', message: 'quarantine object could not be scanned' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Bounded read-only store scan (RDS-004/007, CSA, LMT-006/010, DTM-003;
 * F1–F4, F1-B, F1-S, F3-G). `bounds.failClosed` selects the recovery-scan
 * limit semantics (over-limit fails closed with ERR-STO-LIMIT-EXCEEDED)
 * versus the registry scan semantics (truncation with evidence and
 * continuation). The scan mode must be consistent with `failClosed`
 * (registry → truncating, recovery → fail-closed); a mismatch is
 * ERR-STO-REQ-INVALID. Requires a genuine live read capability
 * (`enumerate-class` operation: the scan is a bounded enumeration read; the
 * operation vocabulary is closed).
 *
 * Cursor validation order (F2/F3-G): (1) cursor syntax and digest shape;
 * (2) request-generation compatibility; (3) the re-read structural snapshot
 * against the cursor-bound surface generation; (4) traversal position;
 * (5) candidate scanning. Mismatches map to ERR-STO-REQ-INVALID (steps 1–2,
 * 4) or ERR-STO-ROOT-IDENTITY-CHANGED (step 3).
 */
export function scanStoreSnapshot(input: StoreScanInput): StoreScanResult {
  const check = input.capability.verify('enumerate-class');
  if (!check.ok) {
    return failResult('ERR-STO-REQ-INVALID', 'read capability is not usable at the scan boundary');
  }
  const profile = input.capability.binding.limitProfile;
  const recordBytes = profile['recordBytes'] ?? 1024 * 1024;
  const temporaryBytes = profile['temporaryBytes'] ?? 64 * 1024 * 1024;
  const serviceUid = input.capability.binding.serviceUid;
  const bounds = input.bounds;
  // F2: the mode and the fail-closed behavior are distinct generation
  // bindings; they must be consistent.
  if ((bounds.mode === 'registry') === bounds.failClosed) {
    return failResult('ERR-STO-REQ-INVALID', 'scan mode and fail-closed behavior are inconsistent');
  }
  const namespaceIdentity = verifyNamespaceRootIdentity(input.namespaceRoot, serviceUid, 'store-records');
  if (!namespaceIdentity.ok || namespaceIdentity.identity === undefined) {
    return failResult(namespaceIdentity.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', 'namespace root could not be revalidated at the scan boundary');
  }
  const bound = input.capability.binding.storeInstance.namespaces.find((n) => n.kind === 'store-records');
  if (bound === undefined || bound.dev !== namespaceIdentity.identity.dev || bound.ino !== namespaceIdentity.identity.ino) {
    return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'namespace root identity drifted from the verified store instance');
  }
  // F2: the request-generation token is computed from the verified store
  // instance, the mode, the effective limits, and the fail-closed behavior.
  const generation = computeScanGeneration({
    storeInstance: input.capability.binding.storeInstance,
    mode: bounds.mode,
    entryLimit: bounds.entryLimit,
    byteLimit: bounds.byteLimit,
    failClosed: bounds.failClosed,
  });
  const cursor = input.continuation;
  if (cursor !== undefined) {
    // Step 1: syntax and digest shape; step 2: request-generation
    // compatibility. A cursor from any other store, bounds, mode, or model
    // version is rejected before any candidate content is scanned; never
    // silently restarted or continued.
    if (!cursorShapeValid(cursor)) {
      return failResult('ERR-STO-REQ-INVALID', 'scan continuation is malformed');
    }
    if (cursor.generation !== generation) {
      return failResult('ERR-STO-REQ-INVALID', 'scan continuation generation does not match the current scan request');
    }
  }
  const classes = scanClassOrder();
  const cursorClassIndex = cursor === undefined ? -1 : classes.indexOf(cursor.recordClass);
  if (cursor !== undefined && cursorClassIndex === -1) {
    return failResult('ERR-STO-REQ-INVALID', 'scan continuation class is not scannable');
  }

  // ── structural snapshot (F3-G): parents + present class identities ─────
  // Parent-level structure is budget-free and reported by the first page
  // only (a continuation cursor suppresses re-reporting so the paging union
  // stays complete and duplicate-free).
  const reportParent = cursor === undefined;
  const structureRead = readSurfaceStructure({ namespaceRoot: input.namespaceRoot, serviceUid, hooks: input.hooks, report: reportParent, mode: bounds.mode });
  if (!structureRead.ok || structureRead.structure === undefined) {
    return failResult(structureRead.code ?? 'ERR-STO-IO-FAILURE', structureRead.message ?? 'surface structure scan failed');
  }
  const structure = structureRead.structure;
  // Step 3: the re-read structural snapshot must match the cursor-bound
  // surface generation. Present-to-absent, absent-to-present, class-set
  // change, parent disappearance, and directory replacement are drift.
  const surfaceGeneration = computeSurfaceGeneration(structure);
  if (cursor !== undefined && cursor.surfaceGeneration !== surfaceGeneration) {
    return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'store structure changed since the continuation page');
  }

  const observations: ScanObservation[] = [];
  const findings: StorageFinding[] = [];
  let scannedEntries = 0;
  let scannedBytes = 0;
  let truncated = false;
  let lastClass: RecordClassId | undefined;
  let lastShard: string | undefined;
  let lastEntry: string | undefined;

  if (reportParent) {
    observations.push(...(structureRead.observations ?? []));
    findings.push(...(structureRead.findings ?? []));
  }

  // ── class surfaces ─────────────────────────────────────────────────────
  for (let ci = 0; ci < classes.length; ci++) {
    if (truncated) break;
    const recordClass = classes[ci]!;
    if (cursor !== undefined && ci < cursorClassIndex) continue;
    const recordProfile = RECORD_CLASS_BY_ID.get(recordClass);
    if (recordProfile === undefined) continue;
    const surface = recordProfile.suffix === '.aud' ? 'audit' : 'records';
    const present = surface === 'records' ? structure.recordClasses.includes(recordClass) : structure.auditEventPresent;
    if (!present) continue; // missing-class finding already reported by the first page
    const classDir = `${input.namespaceRoot}/${surface}/${recordProfile.segment}`;
    const classBracket = readdirVerified(classDir, serviceUid, input.hooks, { surface, recordClass });
    if (!classBracket.ok || classBracket.bracket === undefined) {
      return failResult(classBracket.code ?? 'ERR-STO-IO-FAILURE', classBracket.message ?? 'class directory scan failed');
    }
    if (classBracket.bracket.absent) {
      // Listed by the structural pass but absent at open: disappearance → drift (F4).
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'class directory disappeared during the scan');
    }
    // F3-G: the opened class directory must be the SAME directory the
    // structural snapshot bound; a replacement between the snapshot and the
    // open is drift.
    const expectedIdentity = structure.classIdentities.get(recordClass);
    if (expectedIdentity === undefined || classBracket.bracket.identity.dev !== expectedIdentity.dev || classBracket.bracket.identity.ino !== expectedIdentity.ino) {
      return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'class directory identity changed during the scan');
    }
    for (const shardName of classBracket.bracket.names) {
      if (truncated) break;
      // F1: cursor-seeking work is not page-result work — shards before the
      // cursor's shard do not consume the resumed page's entry budget. The
      // cursor's own shard is opened (its entries after the cursor are
      // processed) but its NAME is not re-counted: it was already counted on
      // the page that produced the cursor.
      const cursorShard = cursor !== undefined && ci === cursorClassIndex && shardName === cursor.shard;
      if (cursor !== undefined && ci === cursorClassIndex && shardName < cursor.shard) continue;
      if (!SHARD_RE.test(shardName)) {
        // F1-S: a foreign shard name is a non-resumable structural anomaly —
        // budget-free, reported at its first encounter in deterministic scan
        // order (resume skips everything at or before the cursor, so each
        // anomaly is reported exactly once), never a resumable cursor
        // position, never blocking later valid candidates.
        observations.push({ id: observationId('foreign-object', recordClass, shardName, shardName), entry: shardName, kind: 'foreign-object', recordClass, classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' });
        continue;
      }
      if (!cursorShard) {
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          if (bounds.failClosed) {
            return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
          }
          findings.push(finding('ERR-STO-LIMIT-EXCEEDED', 'scan entry bound exceeded; truncated with evidence'));
          break;
        }
      }
      const shardDir = `${classDir}/${shardName}`;
      const shardBracket = readdirVerified(shardDir, serviceUid, input.hooks, { surface, recordClass, shard: shardName });
      if (!shardBracket.ok || shardBracket.bracket === undefined) {
        return failResult(shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', shardBracket.message ?? 'shard directory scan failed');
      }
      if (shardBracket.bracket.absent) {
        return failResult('ERR-STO-ROOT-IDENTITY-CHANGED', 'shard directory disappeared during the scan');
      }
      for (const entryName of shardBracket.bracket.names) {
        if (truncated) break;
        // F1: entries at or before the cursor entry do not consume the
        // resumed page's entry budget.
        if (cursor !== undefined && ci === cursorClassIndex && shardName === cursor.shard && entryName <= cursor.entry) continue;
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          if (bounds.failClosed) {
            return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
          }
          findings.push(finding('ERR-STO-LIMIT-EXCEEDED', 'scan entry bound exceeded; truncated with evidence'));
          break;
        }
        const component = entryName.slice(0, 32);
        const nameGrammarOk = COMPONENT_RE.test(component) && entryName.length === 36 && entryName.endsWith(recordProfile.suffix);
        if (!nameGrammarOk) {
          const foreign: ForeignScanObservation = { id: observationId('foreign-object', recordClass, shardName, entryName), entry: entryName, kind: 'foreign-object', recordClass, classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' };
          observations.push(foreign);
          lastClass = recordClass;
          lastShard = shardName;
          lastEntry = entryName;
          continue;
        }
        const result = scanRecordEntry({
          path: `${shardDir}/${entryName}`,
          name: entryName,
          component,
          shard: shardName,
          recordClass,
          serviceUid,
          recordBytes,
          bounds,
          state: { scannedBytes },
        });
        if (result.stop !== undefined) {
          if (result.stop === 'failed') {
            return failResult(result.code ?? 'ERR-STO-LIMIT-EXCEEDED', result.message ?? 'scan bound exceeded');
          }
          truncated = true;
          if (bounds.failClosed) {
            return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan byte bound exceeded; recovery fails closed');
          }
          findings.push(finding('ERR-STO-LIMIT-EXCEEDED', 'scan byte bound exceeded; truncated with evidence'));
          // F1-B: never advance past the unread candidate X. The
          // continuation (emitted below) stays at the last successfully
          // processed resumable candidate, strictly before X; when nothing
          // was processed on this page, no continuation is emitted and the
          // truncated result signals that this byte profile cannot make
          // progress: the caller must restart WITHOUT the cursor with a
          // larger byte limit (the request generation binds byte limits, so
          // a raised limit invalidates the old cursor anyway). X is never
          // skipped and no result implies X was processed.
          break;
        }
        if (result.observation !== undefined) {
          observations.push(result.observation);
          scannedBytes += result.observation.stat?.size ?? 0;
          lastClass = recordClass;
          lastShard = shardName;
          lastEntry = entryName;
        }
      }
    }
  }

  // ── tmp/ and locks/ surfaces (recovery mode only) ──────────────────────
  const recoveryMode = bounds.failClosed;
  if (!truncated && recoveryMode) {
    const tmpDir = `${input.namespaceRoot}/tmp`;
    const tmpBracket = readdirVerified(tmpDir, serviceUid, input.hooks, { surface: 'tmp' });
    if (!tmpBracket.ok || tmpBracket.bracket === undefined) {
      return failResult(tmpBracket.code ?? 'ERR-STO-IO-FAILURE', tmpBracket.message ?? 'tmp directory scan failed');
    }
    if (!tmpBracket.bracket.absent) {
      // Published inode map over content-verified record/audit observations
      // (envelope present ⇒ canonical parse + payload digest verified).
      // WPR-023 (a) requires the published record's bytes to verify, so the
      // map is keyed by content verification, not by classification (the
      // crash-twin record legitimately carries an unexpected link count).
      const publishedInodes = new Map<string, boolean>();
      for (const obs of observations) {
        if ((obs.kind === 'record' || obs.kind === 'audit-event') && obs.envelope !== undefined && obs.stat !== undefined) {
          publishedInodes.set(`${obs.stat.dev}:${obs.stat.ino}`, true);
        }
      }
      for (const tmpName of tmpBracket.bracket.names) {
        if (truncated) break;
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
        }
        if (!TEMP_NAME_RE.test(tmpName)) {
          const foreign: ForeignScanObservation = { id: observationId('foreign-object', undefined, undefined, tmpName), entry: tmpName, kind: 'foreign-object', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED' };
          observations.push(foreign);
          lastClass = undefined;
          lastShard = 'tmp';
          lastEntry = tmpName;
          continue;
        }
        const result = scanTemporaryEntry({
          path: `${tmpDir}/${tmpName}`,
          name: tmpName,
          serviceUid,
          temporaryBytes,
          recordBytes,
          bounds,
          state: { scannedBytes },
          publishedInodes,
        });
        if (result.stop !== undefined) {
          if (result.stop === 'failed') {
            return failResult(result.code ?? 'ERR-STO-LIMIT-EXCEEDED', result.message ?? 'recovery scan bound exceeded');
          }
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan byte bound exceeded; recovery fails closed');
        }
        if (result.observation !== undefined) {
          observations.push(result.observation);
          scannedBytes += result.observation.stat?.size ?? 0;
          lastClass = undefined;
          lastShard = 'tmp';
          lastEntry = tmpName;
        }
      }
    }
  }
  if (!truncated && recoveryMode) {
    const locksDir = `${input.namespaceRoot}/locks`;
    const locksBracket = readdirVerified(locksDir, serviceUid, input.hooks, { surface: 'locks' });
    if (!locksBracket.ok || locksBracket.bracket === undefined) {
      return failResult(locksBracket.code ?? 'ERR-STO-IO-FAILURE', locksBracket.message ?? 'locks directory scan failed');
    }
    if (!locksBracket.bracket.absent) {
      const expectedStoreInstance = input.capability.binding.storeInstance.namespaces
        .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
        .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
      for (const lockName of locksBracket.bracket.names) {
        if (truncated) break;
        scannedEntries++;
        if (scannedEntries > bounds.entryLimit) {
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan entry bound exceeded; recovery fails closed');
        }
        const result = scanLockEntry({
          path: `${locksDir}/${lockName}`,
          name: lockName,
          serviceUid,
          bounds,
          state: { scannedBytes },
          expectedStoreInstance,
        });
        if (result.stop !== undefined) {
          if (result.stop === 'failed') {
            return failResult(result.code ?? 'ERR-STO-LIMIT-EXCEEDED', result.message ?? 'recovery scan bound exceeded');
          }
          truncated = true;
          return failResult('ERR-STO-LIMIT-EXCEEDED', 'recovery scan byte bound exceeded; recovery fails closed');
        }
        if (result.observation !== undefined) {
          observations.push(result.observation);
          scannedBytes += result.observation.stat?.size ?? 0;
          lastClass = undefined;
          lastShard = 'locks';
          lastEntry = lockName;
        }
      }
    }
  }

  // F1-B: the continuation is emitted only from the last successfully
  // processed resumable candidate — never from an unread candidate and
  // never from a non-resumable structural anomaly. When nothing was
  // processed, `truncated` without a continuation is the detectable
  // no-progress state.
  // ── quarantine/ surface (WP-8-F; recovery mode only) ────────────────────
  // Quarantine objects are never registry records: registry mode does not
  // scan this surface at all (QRN/WP-8-F §8).
  const quarantineObservations: QuarantineScanObservation[] = [];
  if (!truncated && recoveryMode) {
    const quarantineScan = scanQuarantineSurface({
      namespaceRoot: input.namespaceRoot,
      serviceUid,
      hooks: input.hooks,
      storeInstance: input.capability.binding.storeInstance,
      temporaryBytes,
      tmpObservations: observations.filter((o): o is TemporaryScanObservation => o.kind === 'temporary-object'),
    });
    if (!quarantineScan.ok) {
      return failResult(quarantineScan.code ?? 'ERR-STO-IO-FAILURE', quarantineScan.message ?? 'quarantine surface scan failed');
    }
    quarantineObservations.push(...quarantineScan.observations);
    findings.push(...quarantineScan.findings);
  }
  observations.push(...quarantineObservations);

  const continuation: ScanCursor | undefined =
    truncated && lastClass !== undefined && lastShard !== undefined && lastEntry !== undefined && !recoveryMode
      ? { generation, surfaceGeneration, recordClass: lastClass, shard: lastShard, entry: lastEntry }
      : undefined;
  // F1-S: every emitted cursor must pass the scanner's own validator.
  if (continuation !== undefined && !cursorShapeValid(continuation)) {
    return failResult('ERR-STO-INTERNAL-INVARIANT', 'continuation failed self-validation');
  }
  findings.sort(compareFindings);
  return { ok: true, observations, findings, scannedEntries, scannedBytes, truncated, generation, surfaceGeneration, ...(continuation !== undefined ? { continuation } : {}) };
}
