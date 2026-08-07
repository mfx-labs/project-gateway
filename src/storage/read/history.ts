/**
 * WP-8-K read-only audit-history inspection (contract 13.4, RDS-006/008/011,
 * HST-001…010, AUD-014; ADR-034). READ-ONLY fs owner with a strict
 * read-only allowlist (readdirSync/openSync/closeSync/fstatSync/
 * readFileSync/constants): zero mutation primitives, no capability,
 * provenance, publication-permit, lock, or recovery-mutation import, no
 * subprocess/network (HST-010).
 *
 * Model (13.4/ADR-034):
 * - authoritative source: verified immutable target record + `audit/`
 *   surface; the registry index is never consulted (HST-002).
 * - association: an event belongs to the target's history only when its
 *   verified payload binds the exact target identity; the original
 *   `authorized-write` event must additionally match the deterministic
 *   D-8 expected identity/digest derived from the verified target facts.
 *   Wrong-digest, malformed, dangling, duplicate, conflicting,
 *   unsupported-version, and unverified objects are classified findings,
 *   never adopted, never repaired (HST-004).
 * - original vs reconstructed: event kinds are never flattened; a
 *   reconstruction reports the gap marker and the recovery action; the
 *   original event is never synthesized (HST-003, AUD-014).
 * - ordering: the normative audit ordering tuple (primary logical
 *   creation time, primary record identity, audit event identity; D-8);
 *   timestamps are recorded facts, the event identity is the final
 *   tie-break (HST-005).
 * - bounds: scanned audit+evidence entries ≤ `totalScanEntries` (fail
 *   closed when exceeded — complete history in one bounded inspection),
 *   scanned bytes ≤ `totalScanBytes`, per-object bytes ≤ `recordBytes`,
 *   reported events/findings/annotations per page ≤ `enumerationResults`
 *   with an opaque self-validating continuation cursor (HST-006/008).
 * - snapshot: the query binds the scan/surface generations and
 *   re-verifies the audit surface, the evidence surface, and the target
 *   digest after inspection; any material change fails closed with
 *   ERR-STO-ROOT-IDENTITY-CHANGED (HST-009).
 */
import { readdirSync, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { jcsSerialize } from '../../canonical/jcs.js';
import { computeDomainDigest, parsePersistedEnvelope, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { AUDIT_RECORD_FORMAT_VERSION, AUTHORIZED_WRITE_EVENT_KIND, RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND, buildAuthorizedWriteAuditEvent, type AuditEventTupleInput } from '../audit/write-audit.js';
import { deriveRecordRelativePath } from '../layout/layout.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { verifyRecordObjectAt } from './read-record.js';
import { computeScanGeneration, recomputeSurfaceGeneration } from '../recovery/scan.js';
import { comparePrePostStat, verifyRegularFileStat } from '../root/identity.js';
import type {
  AuditHistoryCursor,
  AuditHistoryFinding,
  AuditHistoryFindingKind,
  AuditHistoryInspectionResult,
  AuditHistoryTargetFacts,
  HistoryAuditEvent,
  ReconstructionEvidenceAnnotation,
  RecordClassId,
  StorageFinding,
  VerifiedStoreInstance,
} from '../types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;

/** Domain-separated audit-history cursor/store-identity binding domain (HST-008). */
export const STORAGE_AUDIT_HISTORY_CURSOR_DOMAIN = 'PGAP-STORAGE-AUDIT-HISTORY-CURSOR-v1\u0000';

/** Fixed audit entry grammar (layout; 32 lowercase hex + `.aud`). */
const COMPONENT_RE = /^[0-9a-f]{32}$/;
const SHARD_RE = /^[0-9a-f]{4}$/;

/** The only supported audit event format version (VRS-003). */
const AUDIT_EVENT_FORMAT_VERSION = AUDIT_RECORD_FORMAT_VERSION;

/** Test-only inspection stage hooks (same pattern as `ScanHooks`/`RecoveryMutationHooks`). */
export type AuditHistoryStage =
  | 'after-target-verification'
  | 'after-audit-structure'
  | 'after-audit-verification'
  | 'after-evidence-structure'
  | 'after-evidence-verification'
  | 'before-surface-recheck'
  | 'after-surface-recheck';

/** Injectable test hooks (stage callback only; no fs override exists). */
export interface AuditHistoryHooks {
  readonly stage?: (stage: AuditHistoryStage) => void;
}

interface InspectionLimits {
  readonly scanEntriesLimit: number;
  readonly scanBytesLimit: number;
  readonly resultsLimit: number;
  readonly recordBytes: number;
}

interface SurfacePosition {
  readonly shard: string;
  readonly entry: string;
  readonly path: string;
}

interface SurfaceStructure {
  readonly token: string;
  readonly positions: readonly SurfacePosition[];
  readonly scannedEntries: number;
}

/** Closed history target classes: store-records classes with the mechanical write-audit relationship (WPR-010; 13.4). */
export function isHistoryTargetClass(recordClass: RecordClassId): boolean {
  const profile = RECORD_CLASS_BY_ID.get(recordClass);
  return (
    profile !== undefined &&
    profile.namespace === 'store-records' &&
    profile.id !== 'authoritative-audit-event' &&
    profile.id !== 'store-metadata'
  );
}

/** Deterministic store/namespace identity binding for cursors (HST-008). */
function storeIdentityFor(storeInstance: VerifiedStoreInstance): string {
  const tuple = jcsSerialize(
    storeInstance.namespaces
      .map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }))
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
  );
  const digest = computeDomainDigest(STORAGE_AUDIT_HISTORY_CURSOR_DOMAIN, tuple);
  return `pgw:h:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Deterministic query-shape binding (limit shape; changing limits invalidates cursors). */
function queryShapeFor(limits: InspectionLimits): string {
  const digest = computeDomainDigest(
    STORAGE_AUDIT_HISTORY_CURSOR_DOMAIN,
    jcsSerialize({ scanEntriesLimit: limits.scanEntriesLimit, scanBytesLimit: limits.scanBytesLimit, resultsLimit: limits.resultsLimit, recordBytes: limits.recordBytes }),
  );
  return `pgw:h:${digest.slice('sha-256:'.length, 'sha-256:'.length + 32)}`;
}

/** Descriptor-verified directory bracket (pre/post snapshot; DTM-003). */
function readdirBracket(path: string, serviceUid: number): { readonly ok: boolean; readonly names?: readonly string[]; readonly identity?: { readonly dev: number; readonly ino: number }; readonly absent?: boolean; readonly code?: string; readonly message?: string } {
  let beforeFd: number | undefined;
  let afterFd: number | undefined;
  try {
    beforeFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const pre = fstatSync(beforeFd);
    if (!pre.isDirectory()) {
      return { ok: false, code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'expected a directory at an inspection surface' };
    }
    if (pre.uid !== serviceUid || (pre.mode & 0o777) !== 0o700) {
      return { ok: false, code: 'ERR-STO-PERM-DENIED', message: 'inspection surface directory violates the store permission policy' };
    }
    const identity = { dev: Number(pre.dev), ino: Number(pre.ino) };
    let names: string[];
    try {
      names = readdirSync(path);
    } finally {
      closeSync(beforeFd);
      beforeFd = undefined;
    }
    afterFd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const post = fstatSync(afterFd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok) {
      return { ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'directory identity changed during inspection' };
    }
    return { ok: true, names: [...names].sort(), identity };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, absent: true };
    }
    return { ok: false, code: 'ERR-STO-IO-FAILURE', message: 'inspection surface directory could not be read' };
  } finally {
    if (beforeFd !== undefined) closeSync(beforeFd);
    if (afterFd !== undefined) closeSync(afterFd);
  }
}

/**
 * Structural pass over one surface (audit events or store evidence):
 * descriptor-verified readdir brackets only — no file reads — producing a
 * deterministic surface token and the ordered entry positions. Bounded by
 * `scanEntriesLimit`; exceeding the bound fails closed (complete history
 * in one bounded inspection; HST-006).
 */
function surfaceStructure(input: {
  readonly surface: 'audit' | 'evidence';
  readonly namespaceRoot: string;
  readonly serviceUid: number;
  readonly classDirPath: string;
  readonly scanEntriesLimit: number;
}): { readonly ok: boolean; readonly structure?: SurfaceStructure; readonly code?: string; readonly message?: string } {
  const parentBracket = readdirBracket(`${input.namespaceRoot}/${input.surface === 'audit' ? 'audit' : 'records'}`, input.serviceUid);
  if (!parentBracket.ok) {
    return { ok: false, code: parentBracket.code ?? 'ERR-STO-IO-FAILURE', message: parentBracket.message ?? 'surface parent could not be verified' };
  }
  const classBracket = parentBracket.absent ? { ok: true as const, absent: true } : readdirBracket(input.classDirPath, input.serviceUid);
  if (!classBracket.ok) {
    return { ok: false, code: classBracket.code ?? 'ERR-STO-IO-FAILURE', message: classBracket.message ?? 'surface class directory could not be verified' };
  }
  const shards: { readonly shard: string; readonly dev: number; readonly ino: number; readonly entries: readonly string[] }[] = [];
  const positions: SurfacePosition[] = [];
  let scanned = 0;
  if (!parentBracket.absent && !classBracket.absent && classBracket.names !== undefined && classBracket.identity !== undefined) {
    const shardNames = classBracket.names.filter((n) => SHARD_RE.test(n));
    for (const shardName of shardNames) {
      const shardDir = `${input.classDirPath}/${shardName}`;
      const shardBracket = readdirBracket(shardDir, input.serviceUid);
      if (!shardBracket.ok || shardBracket.names === undefined || shardBracket.identity === undefined) {
        return { ok: false, code: shardBracket.code ?? 'ERR-STO-ROOT-IDENTITY-CHANGED', message: shardBracket.message ?? 'surface shard directory could not be verified' };
      }
      const entries: string[] = [];
      for (const name of shardBracket.names) {
        scanned++;
        if (scanned > input.scanEntriesLimit) {
          return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'inspection surface exceeds the bounded scan limit; history cannot be proven complete' };
        }
        entries.push(name);
        positions.push({ shard: shardName, entry: name, path: `${shardDir}/${name}` });
      }
      shards.push({ shard: shardName, dev: shardBracket.identity.dev, ino: shardBracket.identity.ino, entries });
    }
  }
  const token = computeDomainDigest(
    STORAGE_AUDIT_HISTORY_CURSOR_DOMAIN,
    jcsSerialize({
      surface: input.surface,
      parent: parentBracket.identity ?? null,
      classDir: classBracket.identity ?? null,
      shards: [...shards].sort((a, b) => (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : 0)).map((s) => ({ shard: s.shard, dev: s.dev, ino: s.ino, entries: [...s.entries].sort() })),
    }),
  );
  return { ok: true, structure: { token, positions, scannedEntries: scanned } };
}

/** Read one audit event entry descriptor-bound with granular failure classification. */
function readAuditEntry(input: {
  readonly path: string;
  readonly serviceUid: number;
  readonly byteLimit: number;
}): {
  readonly ok: boolean;
  readonly canonicalUtf8?: string;
  readonly digest?: string;
  readonly byteLength?: number;
  readonly model?: Readonly<Record<string, unknown>>;
  readonly failure?: { readonly kind: AuditHistoryFindingKind; readonly code: string; readonly message: string };
} {
  let fd: number | undefined;
  try {
    fd = openSync(input.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    const pre = fstatSync(fd);
    const typeCheck = verifyRegularFileStat(pre, input.serviceUid);
    if (!typeCheck.ok) {
      return { ok: false, failure: { kind: 'unverified-audit', code: typeCheck.code ?? 'ERR-STO-PERM-DENIED', message: typeCheck.message ?? 'audit event violates the store permission policy' } };
    }
    if (pre.size > input.byteLimit) {
      return { ok: false, failure: { kind: 'unverified-audit', code: 'ERR-STO-LIMIT-EXCEEDED', message: 'audit event exceeds the bounded byte limit' } };
    }
    const bytes = readFileSync(fd);
    const post = fstatSync(fd);
    const revalidated = comparePrePostStat(pre, post);
    if (!revalidated.ok || post.size !== bytes.length) {
      return { ok: false, failure: { kind: 'unverified-audit', code: 'ERR-STO-INTEGRITY', message: 'audit event changed during descriptor-based read' } };
    }
    const raw = bytes.toString('utf8');
    const parsed = parsePersistedEnvelope(raw, input.byteLimit);
    if (!parsed.ok || parsed.model === undefined || parsed.bytes === undefined) {
      return { ok: false, failure: { kind: 'malformed-audit', code: 'ERR-STO-MALFORMED', message: 'audit event is not a canonical record envelope' } };
    }
    if (jcsSerialize(parsed.model) !== raw) {
      return { ok: false, failure: { kind: 'malformed-audit', code: 'ERR-STO-MALFORMED', message: 'audit event bytes are not canonical JSON' } };
    }
    return { ok: true, canonicalUtf8: parsed.bytes.canonicalUtf8, digest: parsed.bytes.digest, byteLength: parsed.bytes.byteLength, model: parsed.model };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EISDIR' || code === 'ENXIO') {
      return { ok: false, failure: { kind: 'unverified-audit', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'audit event location is not a regular file' } };
    }
    if (code === 'ENOENT') {
      return { ok: false, failure: { kind: 'unverified-audit', code: 'ERR-STO-ROOT-IDENTITY-CHANGED', message: 'audit event disappeared during inspection' } };
    }
    return { ok: false, failure: { kind: 'unverified-audit', code: 'ERR-STO-IO-FAILURE', message: 'audit event could not be read descriptor-bound' } };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Deterministic expected original authorized-write event for the verified target (D-8). */
function expectedOriginalEvent(input: { readonly storeInstance: VerifiedStoreInstance; readonly target: AuditHistoryTargetFacts }): { readonly eventId: string; readonly digest: string; readonly canonicalUtf8: string } | undefined {
  const tuple: AuditEventTupleInput = {
    storeInstance: input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: input.target.recordClass,
    primaryRecordId: input.target.recordId,
    primaryRevision: input.target.revision,
    primaryDigest: input.target.recordDigest,
    eventKind: AUTHORIZED_WRITE_EVENT_KIND,
    trustedActionIdentity: input.target.trustedActionId,
    primaryCreatedAt: input.target.createdAt,
  };
  const built = buildAuthorizedWriteAuditEvent({ ...tuple, eventKind: AUTHORIZED_WRITE_EVENT_KIND });
  if (!built.ok || built.event === undefined) return undefined;
  return { eventId: built.event.recordId, digest: built.event.digest, canonicalUtf8: built.event.canonicalUtf8 };
}

function boundaryFinding(code: string, message: string, retryable: boolean): StorageFinding {
  return { code, message, phase: 'request-validation', state: { retryable, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: retryable } };
}

/** Position comparison (lexicographic shard then entry; deterministic scan order). */
function positionAfter(position: { readonly shard: string; readonly entry: string } | undefined, shard: string, entry: string): boolean {
  if (position === undefined) return true;
  if (shard !== position.shard) return shard > position.shard;
  return entry > position.entry;
}

/**
 * WP-8-K audit-history inspection over the verified store instance
 * (13.4/HST-001…010). Capability-free: the caller establishes the verified
 * store instance through the D-5 boundary; this function performs the
 * bounded read-only inspection. Exact revision only; no logical-identity
 * aggregation, no predecessor/successor inference (ADR-034).
 *
 * Page model: every page verifies the full bounded surfaces and reports
 * only the items after the continuation position; the page on which both
 * surfaces complete carries the deterministic history synthesis
 * (status/findings/completeness). A page that exhausts the results budget
 * returns an opaque self-validating continuation cursor.
 */
export function inspectAuditHistoryByIdentity(input: {
  readonly storeInstance: VerifiedStoreInstance;
  readonly namespaceRoot: string;
  readonly recordClass: RecordClassId;
  readonly recordId: string;
  readonly revision?: number;
  readonly continuation?: AuditHistoryCursor;
  readonly hooks?: AuditHistoryHooks;
}): AuditHistoryInspectionResult {
  if (!isHistoryTargetClass(input.recordClass)) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-REQ-INVALID', 'record class is outside the inspected vocabulary (13.4)', false)] };
  }
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-REQ-INVALID', 'revision must be a positive safe integer', false)] };
  }
  const derived = deriveRecordRelativePath(input.recordClass, input.recordId);
  if (!derived.ok || derived.namespace !== 'store-records') {
    return { ok: false, findings: [boundaryFinding('ERR-STO-CONTAINMENT-DENIED', 'record identity derivation failed', false)] };
  }
  const storeInstance = input.storeInstance;
  const serviceUid = storeInstance.serviceUid;
  const profile = storeInstance.limitProfile;
  const limits: InspectionLimits = {
    scanEntriesLimit: profile['totalScanEntries'] ?? 1024 * 1024,
    scanBytesLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
    resultsLimit: profile['enumerationResults'] ?? 1024,
    recordBytes: profile['recordBytes'] ?? 1024 * 1024,
  };
  const generation = computeScanGeneration({ storeInstance, mode: 'registry', entryLimit: limits.scanEntriesLimit, byteLimit: limits.scanBytesLimit, failClosed: true });
  const surfaceStart = recomputeSurfaceGeneration({ namespaceRoot: input.namespaceRoot, serviceUid, mode: 'registry', hooks: undefined });
  if (!surfaceStart.ok || surfaceStart.generation === undefined) {
    return { ok: false, findings: [boundaryFinding(surfaceStart.code ?? 'ERR-STO-IO-FAILURE', surfaceStart.message ?? 'surface structure could not be re-read', true)] };
  }
  const surfaceGeneration = surfaceStart.generation;
  const storeIdentity = storeIdentityFor(storeInstance);
  const queryShape = queryShapeFor(limits);
  const resume = input.continuation;
  if (resume !== undefined) {
    if (resume.storeIdentity !== storeIdentity || resume.recordClass !== input.recordClass || resume.recordId !== input.recordId || resume.revision !== revision) {
      return { ok: false, findings: [boundaryFinding('ERR-STO-REQ-INVALID', 'continuation cursor does not bind this store/target', false)] };
    }
    if (resume.generation !== generation || resume.surfaceGeneration !== surfaceGeneration || resume.queryShape !== queryShape) {
      return { ok: false, findings: [boundaryFinding('ERR-STO-REQ-INVALID', 'continuation cursor does not bind this generation/surface/query shape', false)] };
    }
    if (resume.phase !== 'audit' && resume.phase !== 'evidence') {
      return { ok: false, findings: [boundaryFinding('ERR-STO-REQ-INVALID', 'continuation cursor phase is outside the closed vocabulary', false)] };
    }
    if ((resume.phase === 'audit' && (resume.lastAuditShard === undefined || resume.lastAuditEntry === undefined)) || (resume.phase === 'evidence' && (resume.lastEvidenceShard === undefined || resume.lastEvidenceEntry === undefined))) {
      return { ok: false, findings: [boundaryFinding('ERR-STO-REQ-INVALID', 'continuation cursor position is incomplete', false)] };
    }
  }

  // Verified target record (RDS-002; HST-002): exact class/identity/revision.
  const targetPath = `${input.namespaceRoot}/${derived.relativePath}`;
  const verifiedTarget = verifyRecordObjectAt({ path: targetPath, serviceUid, byteLimit: limits.recordBytes });
  if (!verifiedTarget.ok) {
    return { ok: false, findings: [boundaryFinding(verifiedTarget.code ?? 'ERR-STO-INTEGRITY', verifiedTarget.message ?? 'target record verification failed', false)] };
  }
  if (verifiedTarget.recordId !== input.recordId) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-INTEGRITY', 'target record identity does not match the requested identity', false)] };
  }
  if (verifiedTarget.revision !== revision) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-INTEGRITY', 'target record revision does not match the requested revision', false)] };
  }
  const targetModel = parsePersistedEnvelope(verifiedTarget.canonicalUtf8 ?? '', limits.recordBytes);
  if (!targetModel.ok || targetModel.model === undefined) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-MALFORMED', 'target record envelope could not be parsed', false)] };
  }
  const tm = targetModel.model;
  const trustedActionId = typeof tm['trustedActionId'] === 'string' ? tm['trustedActionId'] : '';
  const createdAt = typeof tm['createdAt'] === 'string' ? tm['createdAt'] : '';
  const recordKind = typeof tm['recordKind'] === 'string' ? tm['recordKind'] : '';
  const formatVersion = typeof tm['formatVersion'] === 'string' ? tm['formatVersion'] : '';
  if (trustedActionId === '' || createdAt === '') {
    return { ok: false, findings: [boundaryFinding('ERR-STO-MALFORMED', 'target record identity fields are malformed', false)] };
  }
  const target: AuditHistoryTargetFacts = {
    recordClass: input.recordClass,
    recordId: input.recordId,
    revision,
    recordDigest: verifiedTarget.digest ?? '',
    recordKind,
    formatVersion,
    trustedActionId,
    createdAt,
  };
  const expectedOriginal = expectedOriginalEvent({ storeInstance, target });
  const hooks = input.hooks ?? {};
  hooks.stage?.('after-target-verification');

  let scannedBytes = verifiedTarget.byteLength ?? 0;

  // ── Audit surface: structural pass + verification ────────────────────────
  const auditStructure = surfaceStructure({
    surface: 'audit',
    namespaceRoot: input.namespaceRoot,
    serviceUid,
    classDirPath: `${input.namespaceRoot}/audit/audit-event`,
    scanEntriesLimit: limits.scanEntriesLimit,
  });
  if (!auditStructure.ok || auditStructure.structure === undefined) {
    return { ok: false, findings: [boundaryFinding(auditStructure.code ?? 'ERR-STO-INTEGRITY', auditStructure.message ?? 'audit surface could not be enumerated', true)] };
  }
  const auditSurface = auditStructure.structure;
  hooks.stage?.('after-audit-structure');

  // Full verified sets (every page re-verifies the complete bounded
  // surface; the final page's synthesis derives from these).
  const auditEventsAll: HistoryAuditEvent[] = [];
  const auditFindingsAll: AuditHistoryFinding[] = [];
  // The page's reported slice (items after the continuation position).
  const reportedEvents: HistoryAuditEvent[] = [];
  const reportedFindings: AuditHistoryFinding[] = [];
  let findingsReported = 0;
  let eventsReported = 0;
  let auditTruncated = false;
  const lastAuditReported = resume !== undefined ? { shard: resume.lastAuditShard ?? '', entry: resume.lastAuditEntry ?? '' } : undefined;
  // Position of the last item that produced a reported finding or event on
  // this page (the reporting resume boundary when the audit budget is hit).
  let lastReportedAuditPosition: { readonly shard: string; readonly entry: string } | undefined = lastAuditReported;

  // Every page re-verifies the full bounded surface: events and findings are
  // ALWAYS collected (the final page's synthesis derives from the complete
  // sets), while reporting is gated by the continuation position and the
  // per-page results budget (HST-006/008).
  for (const position of auditSurface.positions) {
    const shouldReport = positionAfter(lastAuditReported, position.shard, position.entry);
    const component = position.entry.slice(0, 32);
    if (!COMPONENT_RE.test(component) || !position.entry.endsWith('.aud') || position.entry.length !== 36) {
      if (shouldReport && findingsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const hfind1: AuditHistoryFinding = { kind: 'unverified-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, reason: 'foreign entry in the audit-event surface' };
      auditFindingsAll.push(hfind1);
      if (shouldReport) {
        reportedFindings.push(hfind1);
        findingsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    const read = readAuditEntry({ path: position.path, serviceUid, byteLimit: limits.recordBytes });
    if (!read.ok) {
      if (read.failure !== undefined) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfind2: AuditHistoryFinding = { kind: read.failure.kind, position: { surface: 'audit', shard: position.shard, entry: position.entry }, reason: read.failure.message };
        auditFindingsAll.push(hfind2);
        if (shouldReport) {
          reportedFindings.push(hfind2);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
      }
      continue;
    }
    scannedBytes += read.byteLength ?? 0;
    if (scannedBytes > limits.scanBytesLimit) {
      return { ok: false, findings: [boundaryFinding('ERR-STO-LIMIT-EXCEEDED', 'inspection exceeds the bounded scan byte limit', false)] };
    }
    if (read.model === undefined) continue;
    const model = read.model;
    const recordId = model['recordId'];
    if (typeof recordId !== 'string' || !recordId.endsWith(component)) {
      if (shouldReport && findingsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const hfind3: AuditHistoryFinding = { kind: 'unverified-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, reason: 'audit event identity does not match its derived location' };
      auditFindingsAll.push(hfind3);
      if (shouldReport) {
        reportedFindings.push(hfind3);
        findingsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    const derivedEvent = deriveRecordRelativePath('authoritative-audit-event', recordId);
    if (!derivedEvent.ok || derivedEvent.shard !== position.shard || derivedEvent.filename !== position.entry) {
      if (shouldReport && findingsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const hfind4: AuditHistoryFinding = { kind: 'unverified-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event location does not match the layout derivation' };
      auditFindingsAll.push(hfind4);
      if (shouldReport) {
        reportedFindings.push(hfind4);
        findingsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    if (model['formatVersion'] !== AUDIT_EVENT_FORMAT_VERSION) {
      if (shouldReport && findingsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const hfind5: AuditHistoryFinding = { kind: 'unsupported-audit-version', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event format version is not supported' };
      auditFindingsAll.push(hfind5);
      if (shouldReport) {
        reportedFindings.push(hfind5);
        findingsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    const payload = model['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      if (shouldReport && findingsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const hfind6: AuditHistoryFinding = { kind: 'dangling-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event association payload is malformed' };
      auditFindingsAll.push(hfind6);
      if (shouldReport) {
        reportedFindings.push(hfind6);
        findingsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    const p = payload as Readonly<Record<string, unknown>>;
    const eventKind = p['eventKind'];
    const primaryRecordId = p['recordId'];
    const primaryDigest = p['recordDigest'];
    if (typeof eventKind !== 'string' || typeof primaryRecordId !== 'string' || typeof primaryDigest !== 'string') {
      if (shouldReport && findingsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const hfind7: AuditHistoryFinding = { kind: 'dangling-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event association payload fields are malformed' };
      auditFindingsAll.push(hfind7);
      if (shouldReport) {
        reportedFindings.push(hfind7);
        findingsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    if (primaryRecordId !== target.recordId) {
      // A verified event of another record: not part of this target's history.
      continue;
    }
    // Reference-digest linkage: the envelope must bind the target digest
    // (checked for events that would otherwise be adopted; HST-004).
    const referenceDigests = model['referenceDigests'];
    const bindsTarget = Array.isArray(referenceDigests) && referenceDigests.includes(target.recordDigest);
    const trustedEventAction = typeof model['trustedActionId'] === 'string' ? model['trustedActionId'] : '';
    const eventCreatedAt = typeof model['createdAt'] === 'string' ? model['createdAt'] : '';
    if (eventKind === AUTHORIZED_WRITE_EVENT_KIND) {
      if (primaryDigest !== target.recordDigest) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfind9: AuditHistoryFinding = { kind: 'wrong-target-digest', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'authorized-write audit references a digest different from the target record digest' };
        auditFindingsAll.push(hfind9);
        if (shouldReport) {
          reportedFindings.push(hfind9);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      const isOriginal = expectedOriginal !== undefined && recordId === expectedOriginal.eventId && read.digest === expectedOriginal.digest && read.canonicalUtf8 === expectedOriginal.canonicalUtf8;
      if (recordId === expectedOriginal?.eventId && !isOriginal) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfind10: AuditHistoryFinding = { kind: 'conflicting-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'authorized-write audit at the expected identity does not match the derived bytes' };
        auditFindingsAll.push(hfind10);
        if (shouldReport) {
          reportedFindings.push(hfind10);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      if (!isOriginal && expectedOriginal !== undefined) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfind11: AuditHistoryFinding = { kind: 'duplicate-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'authorized-write audit does not match the deterministic expected identity for the target' };
        auditFindingsAll.push(hfind11);
        if (shouldReport) {
          reportedFindings.push(hfind11);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      if (!bindsTarget) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfindref: AuditHistoryFinding = { kind: 'conflicting-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event reference digests do not bind the target record digest' };
        auditFindingsAll.push(hfindref);
        if (shouldReport) {
          reportedFindings.push(hfindref);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      if (shouldReport && eventsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const evOriginal: HistoryAuditEvent = { eventId: recordId, eventKind: AUTHORIZED_WRITE_EVENT_KIND, digest: read.digest ?? '', createdAt: eventCreatedAt, trustedActionId: trustedEventAction, isOriginalWrite: true };
      auditEventsAll.push(evOriginal);
      if (shouldReport) {
        reportedEvents.push(evOriginal);
        eventsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    if (eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND) {
      if (primaryDigest !== target.recordDigest) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfind12: AuditHistoryFinding = { kind: 'wrong-target-digest', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'reconstruction audit references a digest different from the target record digest' };
        auditFindingsAll.push(hfind12);
        if (shouldReport) {
          reportedFindings.push(hfind12);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      const gap = p['gapMarker'];
      const gapOk = typeof gap === 'object' && gap !== null && !Array.isArray(gap) && (gap as Readonly<Record<string, unknown>>)['missingEventKind'] === AUTHORIZED_WRITE_EVENT_KIND;
      if (!gapOk) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfind13: AuditHistoryFinding = { kind: 'conflicting-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'reconstruction audit lacks the exact gap marker' };
        auditFindingsAll.push(hfind13);
        if (shouldReport) {
          reportedFindings.push(hfind13);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      if (!bindsTarget) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          auditTruncated = true;
          break;
        }
        const hfindref: AuditHistoryFinding = { kind: 'conflicting-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event reference digests do not bind the target record digest' };
        auditFindingsAll.push(hfindref);
        if (shouldReport) {
          reportedFindings.push(hfindref);
          findingsReported++;
          lastReportedAuditPosition = position;
        }
        continue;
      }
      if (shouldReport && eventsReported >= limits.resultsLimit) {
        auditTruncated = true;
        break;
      }
      const evRecon: HistoryAuditEvent = { eventId: recordId, eventKind: RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND, digest: read.digest ?? '', createdAt: eventCreatedAt, trustedActionId: trustedEventAction, isOriginalWrite: false, gapMarker: { missingEventKind: 'authorized-write' } };
      auditEventsAll.push(evRecon);
      if (shouldReport) {
        reportedEvents.push(evRecon);
        eventsReported++;
        lastReportedAuditPosition = position;
      }
      continue;
    }
    if (shouldReport && findingsReported >= limits.resultsLimit) {
      auditTruncated = true;
      break;
    }
    const hfind14: AuditHistoryFinding = { kind: 'conflicting-audit', position: { surface: 'audit', shard: position.shard, entry: position.entry }, ...(recordId !== undefined ? { eventId: recordId } : {}), reason: 'audit event kind is outside the implemented vocabulary' };
    auditFindingsAll.push(hfind14);
    if (shouldReport) {
      reportedFindings.push(hfind14);
      findingsReported++;
      lastReportedAuditPosition = position;
    }
  }
  hooks.stage?.('after-audit-verification');
  const auditEndPosition = auditSurface.positions.length > 0 ? { shard: auditSurface.positions[auditSurface.positions.length - 1]!.shard, entry: auditSurface.positions[auditSurface.positions.length - 1]!.entry } : lastAuditReported;

  // ── Evidence surface (operational annotations only; runs only when the
  // audit page budget is not exhausted) ────────────────────────────────────
  const evidenceAnnotations: ReconstructionEvidenceAnnotation[] = [];
  let evidenceReported = 0;
  let evidenceTruncated = false;
  let evidenceSurface: SurfaceStructure | undefined;
  const lastEvidenceReported = resume !== undefined && resume.phase === 'evidence' ? { shard: resume.lastEvidenceShard ?? '', entry: resume.lastEvidenceEntry ?? '' } : undefined;
  let lastReportedEvidencePosition: { readonly shard: string; readonly entry: string } | undefined = lastEvidenceReported;
  if (!auditTruncated) {
    const evidenceStructure = surfaceStructure({
      surface: 'evidence',
      namespaceRoot: input.namespaceRoot,
      serviceUid,
      classDirPath: `${input.namespaceRoot}/records/evidence`,
      scanEntriesLimit: limits.scanEntriesLimit,
    });
    if (!evidenceStructure.ok || evidenceStructure.structure === undefined) {
      return { ok: false, findings: [boundaryFinding(evidenceStructure.code ?? 'ERR-STO-INTEGRITY', evidenceStructure.message ?? 'evidence surface could not be enumerated', true)] };
    }
    evidenceSurface = evidenceStructure.structure;
    hooks.stage?.('after-evidence-structure');
    const pushEvidenceFinding = (kind: AuditHistoryFindingKind, position: { readonly shard: string; readonly entry: string }, eventId: string | undefined, reason: string, shouldReport: boolean): void => {
      const hfind15: AuditHistoryFinding = { kind, position: { surface: 'evidence', shard: position.shard, entry: position.entry }, ...(eventId !== undefined ? { eventId } : {}), reason };
      auditFindingsAll.push(hfind15);
      if (shouldReport) {
        reportedFindings.push(hfind15);
        findingsReported++;
        lastReportedEvidencePosition = position;
      }
    };
    for (const position of evidenceSurface.positions) {
      const shouldReport = positionAfter(lastEvidenceReported, position.shard, position.entry);
      const component = position.entry.slice(0, 32);
      if (!COMPONENT_RE.test(component) || !position.entry.endsWith('.rec') || position.entry.length !== 36) {
        // Foreign entries in the evidence surface are not the target's
        // history; the surface token still binds them to the snapshot.
        continue;
      }
      const verified = verifyRecordObjectAt({ path: position.path, serviceUid, byteLimit: limits.recordBytes });
      if (!verified.ok || verified.canonicalUtf8 === undefined) continue;
      scannedBytes += verified.byteLength ?? 0;
      if (scannedBytes > limits.scanBytesLimit) {
        return { ok: false, findings: [boundaryFinding('ERR-STO-LIMIT-EXCEEDED', 'inspection exceeds the bounded scan byte limit', false)] };
      }
      const model = parsePersistedEnvelope(verified.canonicalUtf8, limits.recordBytes);
      if (!model.ok || model.model === undefined) continue;
      const m = model.model;
      const payload = m['payload'];
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;
      const p = payload as Readonly<Record<string, unknown>>;
      if (p['evidenceKind'] !== 'recovery-evidence' || p['recoveryOperation'] !== 'audit-reconstruction') continue;
      if (p['targetRecordId'] !== target.recordId) continue;
      const outcome = p['outcome'];
      const targetRecordDigest = p['targetRecordDigest'];
      const reconstructionAuditId = p['reconstructionAuditId'];
      const originalActionIdentity = p['originalActionIdentity'];
      if (typeof outcome !== 'string' || typeof targetRecordDigest !== 'string' || typeof reconstructionAuditId !== 'string' || typeof originalActionIdentity !== 'string') {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          evidenceTruncated = true;
          break;
        }
        pushEvidenceFinding('dangling-audit', position, verified.recordId, 'reconstruction evidence payload facts are incomplete', shouldReport);
        continue;
      }
      const recoveryActionIdentity = typeof m['trustedActionId'] === 'string' ? m['trustedActionId'] : '';
      const evidenceCreatedAt = typeof m['createdAt'] === 'string' ? m['createdAt'] : '';
      const duplicateEvidence = evidenceAnnotations.some((a) => a.reconstructionAuditId === reconstructionAuditId);
      if (duplicateEvidence) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          evidenceTruncated = true;
          break;
        }
        pushEvidenceFinding('conflicting-audit', position, verified.recordId, 'duplicate reconstruction evidence for the same reconstruction audit identity', shouldReport);
        continue;
      }
      if (targetRecordDigest !== target.recordDigest) {
        if (shouldReport && findingsReported >= limits.resultsLimit) {
          evidenceTruncated = true;
          break;
        }
        pushEvidenceFinding('wrong-target-digest', position, verified.recordId, 'reconstruction evidence references a digest different from the target record digest', shouldReport);
        continue;
      }
      if (shouldReport && evidenceReported >= limits.resultsLimit) {
        evidenceTruncated = true;
        break;
      }
      const linked = auditEventsAll.find((e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND && e.eventId === reconstructionAuditId);
      evidenceAnnotations.push({
        evidenceId: verified.recordId ?? '',
        outcome,
        targetRecordDigest,
        reconstructionAuditId,
        originalActionIdentity,
        recoveryActionIdentity,
        createdAt: evidenceCreatedAt,
        ...(linked !== undefined ? { linkedReconstructionEventId: linked.eventId } : {}),
        verified: true,
      });
      if (shouldReport) {
        evidenceReported++;
        lastReportedEvidencePosition = position;
      }
    }
    hooks.stage?.('after-evidence-verification');
  }

  const truncated = auditTruncated || evidenceTruncated;

  // ── Summary derivation (final pages only; HST-003/004/007) ───────────────
  // The status answers "what is the lineage state" from the complete
  // verified sets; `completeness.complete` additionally requires a clean
  // original lineage with zero findings. A truncated page carries no
  // definitive status (the page-local facts remain available).
  let status: AuditHistoryInspectionResult['status'];
  if (!truncated) {
    const originalEvents = auditEventsAll.filter((e) => e.isOriginalWrite);
    const reconstructionEvents = auditEventsAll.filter((e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND);
    const originalPresent = originalEvents.length > 0;
    const pushSummaryFinding = (f: AuditHistoryFinding): void => {
      if (!auditFindingsAll.some((x) => x.kind === f.kind && x.reason === f.reason)) {
        auditFindingsAll.push(f);
        reportedFindings.push(f);
      }
    };
    if (!originalPresent && reconstructionEvents.length === 0) {
      pushSummaryFinding({ kind: 'missing-authorized-write', reason: 'the original authorized-write audit event is absent' });
    }
    if (!originalPresent && reconstructionEvents.length === 0 && evidenceAnnotations.length > 0) {
      pushSummaryFinding({ kind: 'evidence-without-event', reason: 'reconstruction evidence exists but no durable reconstruction audit event references the target' });
    }
    if (!originalPresent && reconstructionEvents.length > 0 && evidenceAnnotations.length === 0) {
      pushSummaryFinding({ kind: 'event-without-evidence', reason: 'reconstruction audit event exists but no reconstruction evidence record references it' });
    }
    if (reconstructionEvents.length > 1) {
      pushSummaryFinding({ kind: 'conflicting-audit', reason: 'multiple reconstruction audit events for the same gap' });
    }
    const contestedLineage = auditFindingsAll.some((f) => f.kind === 'duplicate-audit' || f.kind === 'conflicting-audit' || f.kind === 'ambiguous-history' || f.kind === 'wrong-target-digest' || f.kind === 'dangling-audit');
    const pushAmbiguous = (): void => {
      if (!auditFindingsAll.some((f) => f.kind === 'ambiguous-history')) {
        const hfind16: AuditHistoryFinding = { kind: 'ambiguous-history', reason: 'audit lineage is contested: the history cannot be presented as a single clean lineage' };
        auditFindingsAll.push(hfind16);
        reportedFindings.push(hfind16);
      }
    };
    if (originalPresent && reconstructionEvents.length === 0 && auditFindingsAll.length === 0) {
      status = 'complete';
    } else if (contestedLineage || (originalPresent && reconstructionEvents.length > 0) || (originalPresent && auditFindingsAll.length > 0)) {
      // Contested or finding-carrying lineage: never treated as clean (§9).
      status = 'ambiguous-history';
      pushAmbiguous();
    } else if (reconstructionEvents.length > 0) {
      status = 'reconstructed-gap';
    } else {
      status = 'missing-authorized-write';
    }
  }
  reportedFindings.sort((a, b) => {
    const ka = a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    if (ka !== 0) return ka;
    const sa = a.position?.surface ?? '';
    const sb = b.position?.surface ?? '';
    if (sa !== sb) return sa < sb ? -1 : 1;
    const sha = a.position?.shard ?? '';
    const shb = b.position?.shard ?? '';
    if (sha !== shb) return sha < shb ? -1 : 1;
    const ea = a.position?.entry ?? '';
    const eb = b.position?.entry ?? '';
    if (ea !== eb) return ea < eb ? -1 : 1;
    return (a.eventId ?? '') < (b.eventId ?? '') ? -1 : 1;
  });
  // D-8 ordering tuple: primary logical creation time, primary record identity, event identity.
  auditEventsAll.sort((a, b) => {
    const ta = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    if (ta !== 0) return ta;
    if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
    return 0;
  });
  evidenceAnnotations.sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));

  // ── Snapshot re-verification (HST-009): no two generations merged ────────
  hooks.stage?.('before-surface-recheck');
  const recheckAudit = surfaceStructure({
    surface: 'audit',
    namespaceRoot: input.namespaceRoot,
    serviceUid,
    classDirPath: `${input.namespaceRoot}/audit/audit-event`,
    scanEntriesLimit: limits.scanEntriesLimit,
  });
  if (!recheckAudit.ok || recheckAudit.structure === undefined) {
    return { ok: false, findings: [boundaryFinding(recheckAudit.code ?? 'ERR-STO-INTEGRITY', recheckAudit.message ?? 'audit surface re-verification failed', true)] };
  }
  if (recheckAudit.structure.token !== auditSurface.token) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-ROOT-IDENTITY-CHANGED', 'audit surface changed during inspection; retry', true)] };
  }
  if (evidenceSurface !== undefined) {
    const recheckEvidence = surfaceStructure({
      surface: 'evidence',
      namespaceRoot: input.namespaceRoot,
      serviceUid,
      classDirPath: `${input.namespaceRoot}/records/evidence`,
      scanEntriesLimit: limits.scanEntriesLimit,
    });
    if (!recheckEvidence.ok || recheckEvidence.structure === undefined) {
      return { ok: false, findings: [boundaryFinding(recheckEvidence.code ?? 'ERR-STO-INTEGRITY', recheckEvidence.message ?? 'evidence surface re-verification failed', true)] };
    }
    if (recheckEvidence.structure.token !== evidenceSurface.token) {
      return { ok: false, findings: [boundaryFinding('ERR-STO-ROOT-IDENTITY-CHANGED', 'evidence surface changed during inspection; retry', true)] };
    }
  }
  const generationAfter = computeScanGeneration({ storeInstance, mode: 'registry', entryLimit: limits.scanEntriesLimit, byteLimit: limits.scanBytesLimit, failClosed: true });
  if (generationAfter !== generation) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-ROOT-IDENTITY-CHANGED', 'store generation changed during inspection; retry', true)] };
  }
  const surfaceAfter = recomputeSurfaceGeneration({ namespaceRoot: input.namespaceRoot, serviceUid, mode: 'registry', hooks: undefined });
  if (!surfaceAfter.ok || surfaceAfter.generation !== surfaceGeneration) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-ROOT-IDENTITY-CHANGED', 'surface generation changed during inspection; retry', true)] };
  }
  const targetAfter = verifyRecordObjectAt({ path: targetPath, serviceUid, byteLimit: limits.recordBytes });
  if (!targetAfter.ok || targetAfter.digest !== target.recordDigest) {
    return { ok: false, findings: [boundaryFinding('ERR-STO-ROOT-IDENTITY-CHANGED', 'target record changed during inspection; retry', true)] };
  }
  hooks.stage?.('after-surface-recheck');

  const continuation: AuditHistoryCursor | undefined = truncated
    ? auditTruncated
      ? {
          storeIdentity,
          recordClass: input.recordClass,
          recordId: input.recordId,
          revision,
          generation,
          surfaceGeneration,
          queryShape,
          phase: 'audit',
          lastAuditShard: lastReportedAuditPosition?.shard ?? '',
          lastAuditEntry: lastReportedAuditPosition?.entry ?? '',
        }
      : {
          storeIdentity,
          recordClass: input.recordClass,
          recordId: input.recordId,
          revision,
          generation,
          surfaceGeneration,
          queryShape,
          phase: 'evidence',
          ...(auditEndPosition !== undefined ? { lastAuditShard: auditEndPosition.shard, lastAuditEntry: auditEndPosition.entry } : {}),
          lastEvidenceShard: lastReportedEvidencePosition?.shard ?? '',
          lastEvidenceEntry: lastReportedEvidencePosition?.entry ?? '',
        }
    : undefined;
  const reconstruction = { present: auditEventsAll.some((e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND), events: auditEventsAll.filter((e) => e.eventKind === RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND) };
  const originalWrite = auditEventsAll.find((e) => e.isOriginalWrite);
  return {
    ok: true,
    findings: [],
    target,
    ...(status !== undefined ? { status } : {}),
    originalAuthorizedWrite: { present: originalWrite !== undefined, ...(originalWrite !== undefined ? { eventId: originalWrite.eventId, digest: originalWrite.digest } : {}) },
    reconstruction,
    events: reportedEvents,
    auditFindings: reportedFindings,
    reconstructionEvidence: evidenceAnnotations,
    completeness: {
      complete: !truncated && status === 'complete' && auditFindingsAll.length === 0,
      truncated,
      scannedAuditEntries: auditSurface.scannedEntries,
      scannedEvidenceEntries: evidenceSurface?.scannedEntries ?? 0,
      scannedBytes,
    },
    snapshot: { generation, surfaceGeneration },
    ...(continuation !== undefined ? { continuation } : {}),
  };
}
