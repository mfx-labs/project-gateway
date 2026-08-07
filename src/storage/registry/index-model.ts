/**
 * WP-8-H persistent registry-index model (ADR-031; contract 5.2 `index/`,
 * CSA-003/004, ITG-005, RGY-001/007, WPR-009, LMT `indexRebuildWork` /
 * `indexBytes`). PURE and FILESYSTEM-FREE: this module defines the
 * deterministic canonical index snapshot, its identity binding, its roots,
 * its bounds, and its parser/validator. It never opens files, never reads
 * the store, and grants no authority (an index is derived cache; RGY-010).
 *
 * Canonical model (one family, one snapshot):
 *   `index/registry-index/<shard4>/<indexId>.idx` where `indexId` is the
 *   deterministic domain digest over (model version, verified store
 *   identity, registry scan generation, structural surface generation,
 *   record root, audit root, observation root, scan bounds, index bounds).
 *   The snapshot content is the complete verified scan output that fully
 *   determines the registry view: the registry-mode observations (records,
 *   audit events, and foreign entries at the records/audit surfaces) with
 *   bounded stat facts (the freshness manifest), plus the structure-level
 *   scan findings and the scan facts. The registry view itself is
 *   re-derived purely from the stored observations, so the fast path and
 *   the authoritative path share one derivation (deep equivalence).
 *
 * Invariant (WP-8-H §5): a persistent index is constructed ONLY from a
 * COMPLETE registry view — truncated scans and unresolved continuation
 * states are rejected before any bytes are produced. Bounds
 * (`indexRebuildWork` entries, `indexBytes` bytes, identity groups,
 * conflicts, associations, findings) fail the build deterministically;
 * an over-bound store never produces a partial index.
 *
 * The identity never depends on host enumeration order, clock, randomness,
 * PID, raw paths, or capability identity. Same verified immutable state
 * yields identical canonical bytes.
 */
import { jcsSerialize } from '../../canonical/jcs.js';
import { computeDomainDigest, isValidDigestSyntax, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../format/envelope.js';
import { parseRawJson } from '../../json/scanner.js';
import { REGISTRY_INDEX_FAMILY } from '../layout/layout.js';
import { finalizeSnapshotClassifications, verifiedAuditEventViews, verifiedRecordViews, deriveRegistryViewFromScan } from './derive.js';
import { recordObservationId, auditObservationId, foreignObservationId } from '../recovery/scan.js';
import type { AuditScanObservation, ForeignScanObservation, RecordScanObservation, ScanCursor, ScanFacts, ScanObservation, ScannedObjectStat, StorageFinding, VerifiedStoreInstance } from '../types.js';

/** Registry-index model version (WP-8-H §12): any semantic change to the
 * canonical index interpretation must bump this version. */
export const REGISTRY_INDEX_MODEL_VERSION = '1' as const;

/** Domain-separated registry-index identity domain (WP-8-H §3). */
export const STORAGE_REGISTRY_INDEX_IDENTITY_DOMAIN = 'PGAP-STORAGE-REGISTRY-INDEX-IDENTITY-v1\u0000';
/** Domain-separated registry-index record-root domain. */
export const STORAGE_REGISTRY_INDEX_RECORD_ROOT_DOMAIN = 'PGAP-STORAGE-REGISTRY-INDEX-RECORD-ROOT-v1\u0000';
/** Domain-separated registry-index audit-root domain. */
export const STORAGE_REGISTRY_INDEX_AUDIT_ROOT_DOMAIN = 'PGAP-STORAGE-REGISTRY-INDEX-AUDIT-ROOT-v1\u0000';
/** Domain-separated registry-index observation-root domain. */
export const STORAGE_REGISTRY_INDEX_OBSERVATION_ROOT_DOMAIN = 'PGAP-STORAGE-REGISTRY-INDEX-OBSERVATION-ROOT-v1\u0000';

/** Index-family constants (ADR-031; layout 5.3 length arithmetic). */
export const REGISTRY_INDEX_KIND = 'RegistryIndex' as const;
export const REGISTRY_INDEX_COMPONENT_RE = /^[0-9a-f]{32}$/;
export const REGISTRY_INDEX_FILENAME_RE = /^[0-9a-f]{32}\.idx$/;

/** Hard parse cap for index entries: the `indexRebuildWork` hard maximum
 * (LMT-012 contract constant; the selected profile may be stricter). */
export const REGISTRY_INDEX_MAX_ENTRIES = 16 * 1024 * 1024;

/** Index identity (32-hex opaque component; ADR-031). */
export interface RegistryIndexIdentityInput {
  readonly modelVersion: string;
  /** Verified trusted-parent identity (dev/ino only; never a path). */
  readonly parentIdentity: { readonly dev: number; readonly ino: number };
  /** Both verified namespace identities (configuration + store-records). */
  readonly namespaces: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
  /** Registry scan generation (computeScanGeneration, mode `registry`). */
  readonly generation: string;
  /** Registry-mode structural surface generation (F3-G). */
  readonly surfaceGeneration: string;
  readonly recordRoot: string;
  readonly auditRoot: string;
  readonly observationRoot: string;
  /** Registry scan bounds that change derived semantics (F2; re-bound here). */
  readonly entryLimit: number;
  readonly byteLimit: number;
  readonly failClosed: boolean;
  /** Index bounds (ADR-031; LMT). */
  readonly indexRebuildWork: number;
  readonly indexBytes: number;
  /** Scan counters (part of the canonical bytes; bound so byte-identity and
   * index identity cannot diverge for the same derived state). */
  readonly scannedEntries: number;
  readonly scannedBytes: number;
}

/** Deterministic registry-index identity (32-hex; WP-8-H §3). */
export function computeRegistryIndexIdentity(input: RegistryIndexIdentityInput): string {
  const tuple = {
    modelVersion: input.modelVersion,
    parentIdentity: { dev: input.parentIdentity.dev, ino: input.parentIdentity.ino },
    namespaces: [...input.namespaces].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    generation: input.generation,
    surfaceGeneration: input.surfaceGeneration,
    recordRoot: input.recordRoot,
    auditRoot: input.auditRoot,
    observationRoot: input.observationRoot,
    entryLimit: input.entryLimit,
    byteLimit: input.byteLimit,
    failClosed: input.failClosed,
    indexRebuildWork: input.indexRebuildWork,
    indexBytes: input.indexBytes,
    scannedEntries: input.scannedEntries,
    scannedBytes: input.scannedBytes,
  };
  const digest = computeDomainDigest(STORAGE_REGISTRY_INDEX_IDENTITY_DOMAIN, jcsSerialize(tuple));
  return digest.slice('sha-256:'.length, 'sha-256:'.length + 32);
}

/** Bounded stat facts persisted per index entry (the freshness manifest). */
export interface IndexEntryStat {
  readonly fileType: 'regular' | 'directory' | 'symlink' | 'special';
  readonly uid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly ino: number;
}

/** Canonical per-observation index tuple (never a raw path). */
export interface IndexObservationTuple {
  readonly kind: 'record' | 'audit-event' | 'foreign-object';
  /** Parent surface for parent-level foreign entries (id derivation). */
  readonly surface?: 'records' | 'audit';
  readonly recordClass?: string;
  readonly shard?: string;
  readonly entry: string;
  readonly classification?: string;
  readonly code: string;
  readonly stat?: IndexEntryStat;
  readonly envelope?: {
    readonly recordId: string;
    readonly revision?: number;
    readonly createdAt?: string;
    readonly payloadDigest?: string;
    readonly recordDigest?: string;
    readonly previousRecordDigest?: string;
    readonly referenceDigests?: readonly string[];
  };
  readonly auditAssociation?: {
    readonly eventKind: string;
    readonly primaryRecordId?: string;
    readonly primaryDigest?: string;
  };
}

function trimStat(stat: ScannedObjectStat): IndexEntryStat {
  return { fileType: stat.fileType, uid: stat.uid, mode: stat.mode, nlink: stat.nlink, size: stat.size, ino: stat.ino };
}

function trimEnvelope(envelope: NonNullable<RecordScanObservation['envelope']>): NonNullable<IndexObservationTuple['envelope']> {
  // Envelope-bearing observations always carry a record identity (the scan
  // extractor sets the envelope only when the identity parsed).
  const recordId = envelope.recordId as string;
  return {
    recordId,
    ...(envelope.revision !== undefined ? { revision: envelope.revision } : {}),
    ...(envelope.createdAt !== undefined ? { createdAt: envelope.createdAt } : {}),
    ...(envelope.payloadDigest !== undefined ? { payloadDigest: envelope.payloadDigest } : {}),
    ...(envelope.recordDigest !== undefined ? { recordDigest: envelope.recordDigest } : {}),
    ...(envelope.previousRecordDigest !== undefined ? { previousRecordDigest: envelope.previousRecordDigest } : {}),
    ...(envelope.referenceDigests !== undefined ? { referenceDigests: [...envelope.referenceDigests] } : {}),
  };
}

/** Deterministic observation → index tuple (stat trimmed to the manifest facts). */
export function registryIndexTuple(observation: ScanObservation): IndexObservationTuple {
  if (observation.kind === 'record' || observation.kind === 'audit-event') {
    return {
      kind: observation.kind,
      recordClass: observation.recordClass,
      shard: observation.shard,
      entry: observation.entry,
      classification: observation.classification,
      code: observation.code,
      ...(observation.stat !== undefined ? { stat: trimStat(observation.stat) } : {}),
      ...(observation.envelope !== undefined ? { envelope: trimEnvelope(observation.envelope) } : {}),
      ...(observation.kind === 'audit-event' && observation.auditAssociation !== undefined ? { auditAssociation: { ...observation.auditAssociation } } : {}),
    };
  }
  const foreign = observation as ForeignScanObservation;
  return {
    kind: 'foreign-object',
    surface: foreign.surface,
    recordClass: foreign.recordClass,
    shard: foreign.shard,
    entry: foreign.entry,
    code: foreign.code,
    ...(foreign.stat !== undefined ? { stat: trimStat(foreign.stat) } : {}),
  };
}

/** Reconstruct one deterministic observation from its canonical tuple (inverse of registryIndexTuple). */
export function observationFromIndexTuple(tuple: IndexObservationTuple): ScanObservation {
  if (tuple.kind === 'record') {
    const recordClass = tuple.recordClass as RecordScanObservation['recordClass'];
    const shard = tuple.shard as string;
    return {
      id: recordObservationId(recordClass, shard, tuple.entry),
      kind: 'record',
      recordClass,
      shard,
      entry: tuple.entry,
      classification: (tuple.classification ?? 'malformed') as RecordScanObservation['classification'],
      code: tuple.code,
      ...(tuple.stat !== undefined ? { stat: untrimStat(tuple.stat) } : {}),
      ...(tuple.envelope !== undefined ? { envelope: untrimEnvelope(tuple.envelope) } : {}),
    };
  }
  if (tuple.kind === 'audit-event') {
    return {
      id: auditObservationId(tuple.shard as string, tuple.entry),
      kind: 'audit-event',
      recordClass: 'authoritative-audit-event',
      shard: tuple.shard as string,
      entry: tuple.entry,
      classification: (tuple.classification ?? 'malformed') as AuditScanObservation['classification'],
      code: tuple.code,
      ...(tuple.stat !== undefined ? { stat: untrimStat(tuple.stat) } : {}),
      ...(tuple.envelope !== undefined ? { envelope: untrimEnvelope(tuple.envelope) } : {}),
      ...(tuple.auditAssociation !== undefined ? { auditAssociation: { ...tuple.auditAssociation } } : {}),
    };
  }
  const scope = tuple.recordClass ?? tuple.surface ?? 'records';
  return {
    id: foreignObservationId(scope, tuple.shard, tuple.entry),
    kind: 'foreign-object',
    ...(tuple.recordClass !== undefined ? { recordClass: tuple.recordClass as ForeignScanObservation['recordClass'] } : {}),
    ...(tuple.shard !== undefined ? { shard: tuple.shard } : {}),
    entry: tuple.entry,
    classification: 'foreign-entry',
    code: tuple.code,
    ...(tuple.stat !== undefined ? { stat: untrimStat(tuple.stat) } : {}),
  };
}

function untrimStat(stat: IndexEntryStat): ScannedObjectStat {
  return { fileType: stat.fileType, uid: stat.uid, mode: stat.mode, nlink: stat.nlink, size: stat.size, dev: 0, ino: stat.ino };
}

function untrimEnvelope(envelope: NonNullable<IndexObservationTuple['envelope']>): NonNullable<RecordScanObservation['envelope']> {
  return {
    recordId: envelope.recordId,
    ...(envelope.revision !== undefined ? { revision: envelope.revision } : {}),
    ...(envelope.createdAt !== undefined ? { createdAt: envelope.createdAt } : {}),
    ...(envelope.payloadDigest !== undefined ? { payloadDigest: envelope.payloadDigest } : {}),
    ...(envelope.recordDigest !== undefined ? { recordDigest: envelope.recordDigest } : {}),
    ...(envelope.previousRecordDigest !== undefined ? { previousRecordDigest: envelope.previousRecordDigest } : {}),
    ...(envelope.referenceDigests !== undefined ? { referenceDigests: [...envelope.referenceDigests] } : {}),
  };
}

/**
 * Select the observations a registry index covers: every record and audit
 * observation at the records/audit surfaces plus every foreign observation
 * there. Registry scan output contains only these kinds; recovery scans
 * additionally carry tmp/locks/quarantine observations, which are filtered
 * out (registry semantics only).
 */
export function registryIndexObservations(observations: readonly ScanObservation[]): readonly ScanObservation[] {
  return observations.filter((o) => o.kind === 'record' || o.kind === 'audit-event' || o.kind === 'foreign-object');
}

/** Deterministic observation root over the canonical index tuples (sorted). */
export function computeObservationRoot(observations: readonly ScanObservation[], modelVersion: string): string {
  const tuples = registryIndexObservations(observations).map(registryIndexTuple);
  tuples.sort(compareTuples);
  return computeDomainDigest(STORAGE_REGISTRY_INDEX_OBSERVATION_ROOT_DOMAIN, jcsSerialize({ modelVersion, entries: tuples }));
}

/** Deterministic record root over the view's verified records (sorted). */
export function computeRecordRoot(observations: readonly ScanObservation[], modelVersion: string): string {
  const finalized = finalizeSnapshotClassifications(observations);
  const views = verifiedRecordViews(finalized.observations);
  const tuples = views
    .map((v) => ({ recordClass: v.recordClass, recordId: v.recordId, revision: v.revision, recordDigest: v.recordDigest }))
    .sort((a, b) => (a.recordClass < b.recordClass ? -1 : a.recordClass > b.recordClass ? 1 : a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.revision - b.revision));
  return computeDomainDigest(STORAGE_REGISTRY_INDEX_RECORD_ROOT_DOMAIN, jcsSerialize({ modelVersion, records: tuples }));
}

/** Deterministic audit root over the verified audit events (sorted by (createdAt, eventId)). */
export function computeAuditRoot(observations: readonly ScanObservation[], modelVersion: string): string {
  const finalized = finalizeSnapshotClassifications(observations);
  const views = verifiedAuditEventViews(finalized.observations);
  const tuples = views.map((v) => ({
    eventId: v.eventId,
    eventKind: v.eventKind,
    createdAt: v.createdAt,
    recordDigest: v.recordDigest,
    primaryRecordId: v.primaryRecordId ?? '',
    primaryDigest: v.primaryDigest ?? '',
  }));
  return computeDomainDigest(STORAGE_REGISTRY_INDEX_AUDIT_ROOT_DOMAIN, jcsSerialize({ modelVersion, events: tuples }));
}

/** All three deterministic roots over one observation set (builder and recovery scanner share this). */
export function computeRegistryIndexRoots(observations: readonly ScanObservation[], modelVersion: string): {
  readonly recordRoot: string;
  readonly auditRoot: string;
  readonly observationRoot: string;
} {
  const selected = registryIndexObservations(observations);
  return {
    recordRoot: computeRecordRoot(selected, modelVersion),
    auditRoot: computeAuditRoot(selected, modelVersion),
    observationRoot: computeObservationRoot(selected, modelVersion),
  };
}

function compareTuples(a: IndexObservationTuple, b: IndexObservationTuple): number {
  const aClass = a.recordClass ?? a.surface ?? '';
  const bClass = b.recordClass ?? b.surface ?? '';
  if (aClass !== bClass) return aClass < bClass ? -1 : 1;
  const aShard = a.shard ?? '';
  const bShard = b.shard ?? '';
  if (aShard !== bShard) return aShard < bShard ? -1 : 1;
  if (a.entry !== b.entry) return a.entry < b.entry ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return 0;
}

/** Pure index build input: the complete verified registry snapshot. */
export interface RegistryIndexBuildInput {
  readonly observations: readonly ScanObservation[];
  /** Structure-level scan findings (reproduced verbatim by the fast path). */
  readonly findings: readonly StorageFinding[];
  readonly scanFacts: ScanFacts;
  /** Verified store instance (identity binding only; never a path). */
  readonly storeInstance: VerifiedStoreInstance;
  /** Registry scan bounds (re-bound in the identity; F2). */
  readonly entryLimit: number;
  readonly byteLimit: number;
  /** Selected profile bounds (`indexRebuildWork`, `indexBytes`). */
  readonly indexRebuildWork: number;
  readonly indexBytes: number;
  /** Unresolved continuation state (rejected: the index requires a COMPLETE view). */
  readonly continuation?: ScanCursor;
}

export interface RegistryIndexBuildResult {
  readonly ok: boolean;
  readonly index?: {
    readonly indexId: string;
    readonly canonicalUtf8: string;
    readonly digest: string;
    readonly recordRoot: string;
    readonly auditRoot: string;
    readonly observationRoot: string;
    readonly entryCount: number;
    readonly byteLength: number;
  };
  readonly code?: string;
  readonly message?: string;
}

/** Deterministic canonical index bytes (WP-8-H §3/§5). Identical verified
 * state and bounds yield identical bytes; the identity binds every input. */
export function buildRegistryIndex(input: RegistryIndexBuildInput): RegistryIndexBuildResult {
  if (input.scanFacts.truncated) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'a persistent index may only be built from a COMPLETE registry view; the scan was truncated' };
  }
  if (input.continuation !== undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'a persistent index may only be built from a COMPLETE registry view; continuation state is unresolved' };
  }
  if (!Number.isSafeInteger(input.indexRebuildWork) || input.indexRebuildWork < 1 || !Number.isSafeInteger(input.indexBytes) || input.indexBytes < 1) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'index bounds are malformed' };
  }
  const selected = registryIndexObservations(input.observations);
  if (selected.length > input.indexRebuildWork) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'indexed entries exceed the indexRebuildWork bound; rebuild fails closed' };
  }
  if (input.findings.length > input.indexRebuildWork) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'represented findings exceed the indexRebuildWork bound; rebuild fails closed' };
  }
  // Completeness invariant: derive the full view from the observations and
  // verify the derived-group bounds (identity groups, conflicts,
  // associations — all bounded by the entry bound, checked explicitly).
  const view = deriveRegistryViewFromScan(selected, input.scanFacts);
  const identityGroupCount = Object.keys(view.recordsByIdentity).length;
  const conflictCount = view.duplicateConflicts.length;
  const associationCount = Object.keys(view.auditByPrimary).length;
  if (identityGroupCount > input.indexRebuildWork || conflictCount > input.indexRebuildWork || associationCount > input.indexRebuildWork) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'derived index groups exceed the indexRebuildWork bound; rebuild fails closed' };
  }
  const roots = computeRegistryIndexRoots(selected, REGISTRY_INDEX_MODEL_VERSION);
  const namespaces = input.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
  const indexId = computeRegistryIndexIdentity({
    modelVersion: REGISTRY_INDEX_MODEL_VERSION,
    parentIdentity: { dev: input.storeInstance.parentIdentity.dev, ino: input.storeInstance.parentIdentity.ino },
    namespaces,
    generation: input.scanFacts.generation,
    surfaceGeneration: input.scanFacts.surfaceGeneration,
    recordRoot: roots.recordRoot,
    auditRoot: roots.auditRoot,
    observationRoot: roots.observationRoot,
    entryLimit: input.entryLimit,
    byteLimit: input.byteLimit,
    failClosed: input.scanFacts.failClosed,
    indexRebuildWork: input.indexRebuildWork,
    indexBytes: input.indexBytes,
    scannedEntries: input.scanFacts.scannedEntries,
    scannedBytes: input.scanFacts.scannedBytes,
  });
  const entries = selected.map(registryIndexTuple).sort(compareTuples);
  const envelope = {
    indexKind: REGISTRY_INDEX_KIND,
    modelVersion: REGISTRY_INDEX_MODEL_VERSION,
    indexId,
    binding: {
      storeInstance: {
        parentIdentity: { dev: input.storeInstance.parentIdentity.dev, ino: input.storeInstance.parentIdentity.ino },
        namespaces: [...namespaces].sort((a, b) => (a.kind < b.kind ? -1 : 1)),
      },
      generation: input.scanFacts.generation,
      surfaceGeneration: input.scanFacts.surfaceGeneration,
      recordRoot: roots.recordRoot,
      auditRoot: roots.auditRoot,
      observationRoot: roots.observationRoot,
      entryLimit: input.entryLimit,
      byteLimit: input.byteLimit,
      failClosed: input.scanFacts.failClosed,
      indexRebuildWork: input.indexRebuildWork,
      indexBytes: input.indexBytes,
    },
    scannedEntries: input.scanFacts.scannedEntries,
    scannedBytes: input.scanFacts.scannedBytes,
    findings: input.findings.map((f) => ({ code: f.code, message: f.message, phase: f.phase })),
    entries,
  };
  const canonicalUtf8 = jcsSerialize(envelope);
  const byteLength = Buffer.byteLength(canonicalUtf8, 'utf8');
  if (byteLength > input.indexBytes) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'canonical index bytes exceed the indexBytes bound; rebuild fails closed' };
  }
  const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalUtf8);
  return {
    ok: true,
    index: {
      indexId,
      canonicalUtf8,
      digest,
      recordRoot: roots.recordRoot,
      auditRoot: roots.auditRoot,
      observationRoot: roots.observationRoot,
      entryCount: entries.length,
      byteLength,
    },
  };
}

/** Parsed index model (validated shape; canonical bytes verified by the caller path). */
export interface ParsedRegistryIndex {
  readonly indexId: string;
  readonly modelVersion: string;
  readonly binding: {
    readonly storeInstance: {
      readonly parentIdentity: { readonly dev: number; readonly ino: number };
      readonly namespaces: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
    };
    readonly generation: string;
    readonly surfaceGeneration: string;
    readonly recordRoot: string;
    readonly auditRoot: string;
    readonly observationRoot: string;
    readonly entryLimit: number;
    readonly byteLimit: number;
    readonly failClosed: boolean;
    readonly indexRebuildWork: number;
    readonly indexBytes: number;
  };
  readonly scannedEntries: number;
  readonly scannedBytes: number;
  readonly findings: readonly { readonly code: string; readonly message: string; readonly phase: string }[];
  readonly entries: readonly IndexObservationTuple[];
}

/**
 * Parse and shape-validate one canonical registry-index snapshot. Requires
 * canonical JCS bytes (duplicate keys rejected), the exact index kind, a
 * supported model version, digest-syntax bindings, bounded arrays, and
 * positive numeric fields. Returns `ok:false` with a closed code for every
 * malformed form; the caller classifies `unsupported-version` separately
 * when the model version parses but is not supported.
 */
export function parseRegistryIndex(canonicalUtf8: string, byteLimit: number, maxEntries: number): { readonly ok: boolean; readonly model?: ParsedRegistryIndex; readonly code?: string; readonly message?: string } {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'index parse bounds are malformed' };
  }
  if (Buffer.byteLength(canonicalUtf8, 'utf8') > byteLimit) {
    return { ok: false, code: 'ERR-STO-LIMIT-EXCEEDED', message: 'registry index exceeds the bounded byte limit' };
  }
  let model: unknown;
  try {
    model = parseRawJson(canonicalUtf8, byteLimit).model;
  } catch {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'registry index is not canonical JSON' };
  }
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'registry index must be a JSON object' };
  }
  if (jcsSerialize(model) !== canonicalUtf8) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'registry index bytes are not canonical JSON' };
  }
  const m = model as Readonly<Record<string, unknown>>;
  if (m['indexKind'] !== REGISTRY_INDEX_KIND) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index kind is not a registry index' };
  }
  const modelVersion = m['modelVersion'];
  if (typeof modelVersion !== 'string' || modelVersion.length === 0 || modelVersion.length > 16) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index model version is malformed' };
  }
  const indexId = m['indexId'];
  if (typeof indexId !== 'string' || !REGISTRY_INDEX_COMPONENT_RE.test(indexId)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index identity is not 32 lowercase hex characters' };
  }
  const binding = m['binding'];
  if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index binding is malformed' };
  }
  const b = binding as Readonly<Record<string, unknown>>;
  const storeInstance = b['storeInstance'];
  if (typeof storeInstance !== 'object' || storeInstance === null || Array.isArray(storeInstance)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index store binding is malformed' };
  }
  const si = storeInstance as Readonly<Record<string, unknown>>;
  const parentIdentity = si['parentIdentity'];
  const namespaces = si['namespaces'];
  if (typeof parentIdentity !== 'object' || parentIdentity === null || !isDevIno(parentIdentity)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index parent identity is malformed' };
  }
  if (!Array.isArray(namespaces) || namespaces.length !== 2 || !namespaces.every((n) => typeof n === 'object' && n !== null && isKindDevIno(n))) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index namespace identities are malformed' };
  }
  const generation = b['generation'];
  const surfaceGeneration = b['surfaceGeneration'];
  const recordRoot = b['recordRoot'];
  const auditRoot = b['auditRoot'];
  const observationRoot = b['observationRoot'];
  if (
    typeof generation !== 'string' || !isValidDigestSyntax(generation) ||
    typeof surfaceGeneration !== 'string' || !isValidDigestSyntax(surfaceGeneration) ||
    typeof recordRoot !== 'string' || !isValidDigestSyntax(recordRoot) ||
    typeof auditRoot !== 'string' || !isValidDigestSyntax(auditRoot) ||
    typeof observationRoot !== 'string' || !isValidDigestSyntax(observationRoot)
  ) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index binding digests are malformed' };
  }
  const entryLimit = b['entryLimit'];
  const byteLimitBound = b['byteLimit'];
  const failClosed = b['failClosed'];
  const indexRebuildWork = b['indexRebuildWork'];
  const indexBytes = b['indexBytes'];
  if (
    !isSafeCount(entryLimit) || !isSafeCount(byteLimitBound) ||
    typeof failClosed !== 'boolean' ||
    !isSafeCount(indexRebuildWork) || !isSafeCount(indexBytes)
  ) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index bound fields are malformed' };
  }
  const scannedEntries = m['scannedEntries'];
  const scannedBytes = m['scannedBytes'];
  if (!isSafeCount(scannedEntries) || !isSafeCount(scannedBytes)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index scan facts are malformed' };
  }
  const findings = m['findings'];
  if (!Array.isArray(findings) || findings.length > maxEntries || !findings.every((f) => typeof f === 'object' && f !== null && typeof (f as Record<string, unknown>)['code'] === 'string' && typeof (f as Record<string, unknown>)['message'] === 'string' && typeof (f as Record<string, unknown>)['phase'] === 'string')) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index findings are malformed or unbounded' };
  }
  const entries = m['entries'];
  if (!Array.isArray(entries) || entries.length > maxEntries) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'index entries are malformed or unbounded' };
  }
  const parsedEntries: IndexObservationTuple[] = [];
  for (const raw of entries) {
    const tuple = validateEntryTuple(raw);
    if (tuple === undefined) {
      return { ok: false, code: 'ERR-STO-MALFORMED', message: 'an index entry tuple is malformed' };
    }
    parsedEntries.push(tuple);
  }
  return {
    ok: true,
    model: {
      indexId,
      modelVersion,
      binding: {
        storeInstance: {
          parentIdentity: { dev: (parentIdentity as Record<string, unknown>)['dev'] as number, ino: (parentIdentity as Record<string, unknown>)['ino'] as number },
          namespaces: (namespaces as Array<Record<string, unknown>>).map((n) => ({ kind: n['kind'] as 'configuration' | 'store-records', dev: n['dev'] as number, ino: n['ino'] as number })),
        },
        generation,
        surfaceGeneration,
        recordRoot,
        auditRoot,
        observationRoot,
        entryLimit: entryLimit as number,
        byteLimit: byteLimitBound as number,
        failClosed,
        indexRebuildWork: indexRebuildWork as number,
        indexBytes: indexBytes as number,
      },
      scannedEntries: scannedEntries as number,
      scannedBytes: scannedBytes as number,
      findings: findings.map((f) => ({ code: (f as Record<string, unknown>)['code'] as string, message: (f as Record<string, unknown>)['message'] as string, phase: (f as Record<string, unknown>)['phase'] as string })),
      entries: parsedEntries,
    },
  };
}

function isDevIno(v: unknown): v is { readonly dev: number; readonly ino: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['dev'] === 'number' && Number.isSafeInteger(o['dev']) && o['dev'] >= 0 && typeof o['ino'] === 'number' && Number.isSafeInteger(o['ino']) && o['ino'] >= 0;
}

function isKindDevIno(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (o['kind'] === 'configuration' || o['kind'] === 'store-records') && isDevIno({ dev: o['dev'], ino: o['ino'] });
}

function isSafeCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function validateEntryTuple(raw: unknown): IndexObservationTuple | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const t = raw as Record<string, unknown>;
  if (t['kind'] !== 'record' && t['kind'] !== 'audit-event' && t['kind'] !== 'foreign-object') return undefined;
  if (typeof t['entry'] !== 'string' || t['entry'].length === 0 || t['entry'].length > 128) return undefined;
  if (typeof t['code'] !== 'string') return undefined; // empty codes are legitimate for valid records
  const base = { kind: t['kind'] as IndexObservationTuple['kind'], entry: t['entry'] as string, code: t['code'] as string };
  const tuple: Record<string, unknown> = { ...base };
  if (t['surface'] === 'records' || t['surface'] === 'audit') tuple['surface'] = t['surface'];
  if (typeof t['recordClass'] === 'string' && t['recordClass'].length > 0 && t['recordClass'].length <= 64) tuple['recordClass'] = t['recordClass'];
  if (typeof t['shard'] === 'string' && /^[0-9a-f]{4}$/.test(t['shard'])) tuple['shard'] = t['shard'];
  if (typeof t['classification'] === 'string' && t['classification'].length > 0) tuple['classification'] = t['classification'];
  const stat = t['stat'];
  if (stat !== undefined) {
    if (typeof stat !== 'object' || stat === null || Array.isArray(stat)) return undefined;
    const s = stat as Record<string, unknown>;
    if (
      (s['fileType'] !== 'regular' && s['fileType'] !== 'directory' && s['fileType'] !== 'symlink' && s['fileType'] !== 'special') ||
      !isSafeCount(s['uid']) || !isSafeCount(s['mode']) || !isSafeCount(s['nlink']) || !isSafeCount(s['size']) || !isSafeCount(s['ino'])
    ) {
      return undefined;
    }
    tuple['stat'] = { fileType: s['fileType'] as IndexEntryStat['fileType'], uid: s['uid'] as number, mode: s['mode'] as number, nlink: s['nlink'] as number, size: s['size'] as number, ino: s['ino'] as number };
  }
  const envelope = t['envelope'];
  if (envelope !== undefined) {
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return undefined;
    const e = envelope as Record<string, unknown>;
    if (typeof e['recordId'] !== 'string' || !/^pgw:[rl]:[0-9a-f]{32}$/.test(e['recordId'])) return undefined;
    const env: Record<string, unknown> = { recordId: e['recordId'] as string };
    if (typeof e['revision'] === 'number' && Number.isSafeInteger(e['revision']) && e['revision'] >= 0) env['revision'] = e['revision'];
    if (typeof e['createdAt'] === 'string' && e['createdAt'].length <= 64) env['createdAt'] = e['createdAt'];
    if (typeof e['payloadDigest'] === 'string' && isValidDigestSyntax(e['payloadDigest'])) env['payloadDigest'] = e['payloadDigest'];
    if (typeof e['recordDigest'] === 'string' && isValidDigestSyntax(e['recordDigest'])) env['recordDigest'] = e['recordDigest'];
    if (typeof e['previousRecordDigest'] === 'string' && isValidDigestSyntax(e['previousRecordDigest'])) env['previousRecordDigest'] = e['previousRecordDigest'];
    if (Array.isArray(e['referenceDigests']) && e['referenceDigests'].every((r) => typeof r === 'string' && isValidDigestSyntax(r)) && e['referenceDigests'].length <= 1024) {
      env['referenceDigests'] = e['referenceDigests'] as string[];
    }
    tuple['envelope'] = env;
  }
  const association = t['auditAssociation'];
  if (association !== undefined) {
    if (typeof association !== 'object' || association === null || Array.isArray(association)) return undefined;
    const a = association as Record<string, unknown>;
    if (typeof a['eventKind'] !== 'string' || a['eventKind'].length === 0 || a['eventKind'].length > 64) return undefined;
    const assoc: Record<string, unknown> = { eventKind: a['eventKind'] as string };
    if (typeof a['primaryRecordId'] === 'string' && /^pgw:r:[0-9a-f]{32}$/.test(a['primaryRecordId'])) assoc['primaryRecordId'] = a['primaryRecordId'];
    if (typeof a['primaryDigest'] === 'string' && isValidDigestSyntax(a['primaryDigest'])) assoc['primaryDigest'] = a['primaryDigest'];
    tuple['auditAssociation'] = assoc;
  }
  return tuple as unknown as IndexObservationTuple;
}

/** Reconstructed observations for the fast path (inverse of the tuple encoding). */
export function registryIndexObservationsOf(model: ParsedRegistryIndex): readonly ScanObservation[] {
  return model.entries.map(observationFromIndexTuple);
}

/** The freshness manifest: (class-or-surface, shard-or-empty, entry) → stat | null. */
export function registryIndexManifest(model: ParsedRegistryIndex): ReadonlyMap<string, IndexEntryStat | null> {
  const manifest = new Map<string, IndexEntryStat | null>();
  for (const tuple of model.entries) {
    const scope = tuple.recordClass ?? tuple.surface ?? '';
    const key = `${scope}\u0000${tuple.shard ?? ''}\u0000${tuple.entry}`;
    manifest.set(key, tuple.stat ?? null);
  }
  return manifest;
}

/** Manifest side (records vs audit) for one manifest key. */
export function registryIndexManifestSide(tuple: IndexObservationTuple): 'records' | 'audit' {
  if (tuple.recordClass === 'authoritative-audit-event' || (tuple.recordClass === undefined && tuple.surface === 'audit')) return 'audit';
  return 'records';
}

/** Self-consistency check of a parsed index: the identity must equal the
 * digest of the declared binding, and the three roots must equal the
 * deterministic roots of the stored entries. Any mismatch is a conflicting
 * or tampered index (never authoritative). */
export function validateRegistryIndexSelfConsistency(model: ParsedRegistryIndex): { readonly ok: boolean; readonly reason?: string } {
  const observations = registryIndexObservationsOf(model);
  const recomputedId = computeRegistryIndexIdentity({
    modelVersion: model.modelVersion,
    parentIdentity: model.binding.storeInstance.parentIdentity,
    namespaces: model.binding.storeInstance.namespaces,
    generation: model.binding.generation,
    surfaceGeneration: model.binding.surfaceGeneration,
    recordRoot: model.binding.recordRoot,
    auditRoot: model.binding.auditRoot,
    observationRoot: model.binding.observationRoot,
    entryLimit: model.binding.entryLimit,
    byteLimit: model.binding.byteLimit,
    failClosed: model.binding.failClosed,
    indexRebuildWork: model.binding.indexRebuildWork,
    indexBytes: model.binding.indexBytes,
    scannedEntries: model.scannedEntries,
    scannedBytes: model.scannedBytes,
  });
  if (recomputedId !== model.indexId) return { ok: false, reason: 'identity-binding-mismatch' };
  const roots = computeRegistryIndexRoots(observations, model.modelVersion);
  if (roots.observationRoot !== model.binding.observationRoot) return { ok: false, reason: 'observation-root-mismatch' };
  if (roots.recordRoot !== model.binding.recordRoot) return { ok: false, reason: 'record-root-mismatch' };
  if (roots.auditRoot !== model.binding.auditRoot) return { ok: false, reason: 'audit-root-mismatch' };
  return { ok: true };
}

/** Deterministic registry-view reproduction from a parsed index (the fast
 * path serves exactly the authoritative derivation semantics). */
export function registryIndexViewOf(model: ParsedRegistryIndex) {
  const observations = registryIndexObservationsOf(model);
  const source: ScanFacts = {
    generation: model.binding.generation,
    surfaceGeneration: model.binding.surfaceGeneration,
    scannedEntries: model.scannedEntries,
    scannedBytes: model.scannedBytes,
    truncated: false,
    failClosed: model.binding.failClosed,
  };
  return deriveRegistryViewFromScan(observations, source);
}

/** Internal family constant re-export for sink provisioning. */
export { REGISTRY_INDEX_FAMILY };
