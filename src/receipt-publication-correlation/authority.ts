/**
 * WP-15 Phase 2 — receipt/publication correlation authority (decision core).
 *
 * Deterministic, fail-closed flow (§19):
 *
 *   narrow correlation request (workspace + predecessor publication id +
 *   receipt id)
 *   → input hygiene + descriptor-based request capture (§7)
 *   → genuine capability gate (CAP-008…016)
 *   → fresh durable-state reconstruction (pre-lock verification; §9/§21)
 *   → publication-correlation lock (`receipt-publication-correlation|<predecessorPublicationRecordId>`; §20)
 *   → mandatory under-lock re-read + verification re-run (§21; authoritative)
 *   → predecessor currentness/supersession resolution (claimant-first; §11)
 *   → exact successor replay/conflict resolution (§17/§23)
 *   → publish successor if absent (opaque record id minted ONLY here)
 *   → reread/verify durable successor
 *   → exact SupersessionRecord replay/conflict resolution (§18/§24)
 *   → publish supersession if absent
 *   → final fresh verification (§19)
 *   → typed result (audit ids ONLY for actual new writes; §31)
 *
 * Fresh durable-state reconstruction: every correlation attempt re-reads
 * the exact required durable records freshly — no previous validation
 * result, no caller-supplied fact, no project-visible `ExecutionResult`,
 * no enumeration order/timestamp is trusted. The exact attempt/outcome
 * subject reuses the Phase 1A claimant-first exact outcome resolution
 * (`resolveExactOutcome`) and the committed shared retrospective path
 * (`deriveRetrospectiveFactsFromStore`) — there is NO second derivation
 * engine in this family (§12/§38).
 *
 * The committed S4 resolver is single-publication by design; the
 * correlation transition is the committed two-publication state
 * (predecessor + successor). When the shared path fails with its
 * `state.publication-ambiguous` signal, the authority tolerates EXACTLY
 * {predecessor + one schema-valid same-result successor claimant} and
 * delegates material classification to the successor resolution — the
 * shared derivation primitive itself is never reimplemented (§12;
 * SIR-WP15-P2-A-001).
 *
 * This module performs NO TrustedReceipt issuance, NO ExecutionResult
 * mutation, NO validation/evaluator provenance change, NO mutation of the
 * historical predecessor, NO RuntimeGrant read (the correlation read set
 * has no runtime-grant class; §29), and NO generic lifecycle-write
 * authority.
 */
import { validateLifecycleRecord } from '../api/validate.js';
import { registryReferenceFor } from '../control-plane/records.js';
import { LockContentionError } from '../control-plane/coordination.js';
import { isAcceptedTimestamp } from '../control-plane/subject.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { jcsSerialize } from '../canonical/jcs.js';
import { isBrandedRegistry, snapshotJson } from '../internal/snapshot.js';
import { receiptEventDispositionOk, resolveExactOutcome } from '../lifecycle/retrospective-eligibility.js';
import { receiptSourceBindingOk } from '../lifecycle/graph.js';
import { bundleReferencesEqual } from '../internal/protocol-equality.js';
import { deriveRetrospectiveFactsFromStore } from '../retrospective-derivation/index.js';
import {
  createCorrelationPublicationPermit,
  createCorrelationSupersessionPermit,
  isGenuineCorrelationCapability,
  type CorrelationCapability,
  type CorrelationPublicationPermit,
  type CorrelationSupersessionPermit,
} from './internal/brand.js';
import {
  CORRELATION_PUBLICATION_ROLE,
  CORRELATION_SUPERSESSION_ROLE,
  type CorrelationFailureCategory,
  type CorrelationInput,
  type CorrelationPublicationResult,
  type CorrelationRequest,
  type CorrelationResult,
} from './types.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Exact own-key set of the correlation request (unknown keys fail closed; §6/§7). */
const REQUEST_KEYS: ReadonlySet<string> = new Set(['workspaceId', 'predecessorPublicationRecordId', 'trustedReceiptRecordId']);

/** Exact own-key set of the correlation input (unknown keys — incl. any transition operand — fail closed). */
const CORRELATION_INPUT_KEYS: ReadonlySet<string> = new Set(['request', 'registry', 'store', 'coordinate', 'identity', 'schemaRegistry', 'capability', 'hooks']);

/**
 * Closed material projection of the successor `ResultPublicationRecord`
 * (§23): every schema material field except the explicit record
 * identity/time. A future schema field is NOT compared until deliberately
 * added here (fail-closed drift).
 */
const SUCCESSOR_MATERIAL_FIELDS: readonly string[] = [
  'record_type',
  'responsible_role',
  'registry_snapshot_reference',
  'result_subject',
  'evaluator_provenance',
  'association_mode',
  'validation_record_id',
  'bundle',
  'workspace_id',
  'occurrence_id',
  'attempt_id',
  'publication_scopes',
  'receipt_correlations',
];

/** Closed material projection of the SupersessionRecord (§24). */
const SUPERSESSION_MATERIAL_FIELDS: readonly string[] = [
  'record_type',
  'responsible_role',
  'registry_snapshot_reference',
  'prior',
  'successor',
  'scope',
  'reason_code',
];

/**
 * The receipt-gated privileged scopes enabled by the exact verified
 * receipt correlation (WP-15 contract §10 — the ONLY scope transition of
 * the correlation producer; no new scope is invented).
 */
const RECEIPT_GATED_SCOPES: readonly string[] = ['completion-status', 'downstream-automation', 'authoritative-reporting'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(r: Readonly<Record<string, unknown>>, key: string): string {
  const v = r[key];
  return typeof v === 'string' ? v : '';
}

type SafeCall<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function safeCall<T>(fn: () => T): SafeCall<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

function failure(category: CorrelationFailureCategory, code: string, message: string): CorrelationResult {
  return { ok: false, category, code, message };
}

function inputInvalid(code: string, message: string): CorrelationResult {
  return failure('CORRELATION-INPUT-INVALID', code, message);
}

function internalFailure(code: string, message: string): CorrelationResult {
  return failure('CORRELATION-INTERNAL-FAILURE', code, message);
}

// ─── request capture (§7) ───────────────────────────────────────────────────

/**
 * Descriptor-based safe capture of the narrow correlation request through
 * the committed hostile-input primitive (`snapshotJson`, src/internal/snapshot.ts):
 * own enumerable data descriptors only. Accessors (getters/setters) are
 * rejected without invocation; symbols, non-enumerable fields, inherited
 * values, non-plain prototypes, and Proxy structural traps (throwing
 * `ownKeys`/`getOwnPropertyDescriptor`/`getPrototypeOf`, revoked proxies)
 * fail closed as typed `CORRELATION-INPUT-INVALID` — no untyped exception
 * escapes. The captured values are detached; the caller's object is never
 * reread and mutation after capture has no effect.
 */
function captureCorrelationRequest(value: unknown): { readonly ok: true; readonly request: CorrelationRequest } | { readonly ok: false; readonly code: string } {
  let captured: unknown;
  try {
    captured = snapshotJson(value, '$');
  } catch {
    return { ok: false, code: 'request.hostile-input' };
  }
  if (!isRecord(captured)) return { ok: false, code: 'request.root-invalid' };
  for (const key of Object.keys(captured)) {
    if (!REQUEST_KEYS.has(key)) return { ok: false, code: `request.unknown-key.${key}` };
  }
  const workspaceId = captured['workspaceId'];
  const predecessorPublicationRecordId = captured['predecessorPublicationRecordId'];
  const trustedReceiptRecordId = captured['trustedReceiptRecordId'];
  if (workspaceId === undefined) return { ok: false, code: 'request.missing-key.workspaceId' };
  if (predecessorPublicationRecordId === undefined) return { ok: false, code: 'request.missing-key.predecessorPublicationRecordId' };
  if (trustedReceiptRecordId === undefined) return { ok: false, code: 'request.missing-key.trustedReceiptRecordId' };
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_RE.test(workspaceId)) return { ok: false, code: 'request.workspace-invalid' };
  if (typeof predecessorPublicationRecordId !== 'string' || !RECORD_ID_RE.test(predecessorPublicationRecordId)) return { ok: false, code: 'request.predecessor-invalid' };
  if (typeof trustedReceiptRecordId !== 'string' || !RECORD_ID_RE.test(trustedReceiptRecordId)) return { ok: false, code: 'request.receipt-invalid' };
  return { ok: true, request: Object.freeze({ workspaceId, predecessorPublicationRecordId, trustedReceiptRecordId }) };
}

/**
 * Shape-validate the host-supplied registry context (§28). The `snapshot`
 * member must be a genuinely accepted branded `ValidatedRegistrySnapshot`
 * (the committed `isBrandedRegistry` primitive; no second brand is
 * invented — SIR-WP15-P1B-002 pattern).
 */
function registryShape(value: unknown): { readonly ok: true; readonly registry: AcceptedRegistryContext } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const registry = value as Readonly<Record<string, unknown>>;
  if (typeof registry['registryProtocolId'] !== 'string' || registry['registryProtocolId'].length === 0) return { ok: false };
  if (typeof registry['registrySnapshotFormatVersion'] !== 'string' || registry['registrySnapshotFormatVersion'] !== '1.0') return { ok: false };
  if (typeof registry['registrySnapshotId'] !== 'string' || !/^pgw:g:[0-9a-f]{32}$/.test(registry['registrySnapshotId'] as string)) return { ok: false };
  if (typeof registry['registrySnapshotDigest'] !== 'string' || !DIGEST_RE.test(registry['registrySnapshotDigest'] as string)) return { ok: false };
  if (!isBrandedRegistry(registry['snapshot'])) return { ok: false };
  return { ok: true, registry: value as unknown as AcceptedRegistryContext };
}

// ─── record construction (§14/§15/§18) ──────────────────────────────────────

/**
 * Construct the exact successor `ResultPublicationRecord` payload (§14/§15).
 * Starts from the fresh validated predecessor and preserves EVERY
 * immutable/non-correlation fact exactly (workspace, result subject,
 * execution identifiers, validation/evaluator provenance, bundle); ONLY
 * the contract-authorized receipt-gating surface changes:
 * `receipt_correlations` = the exact verified receipt identity, and
 * `publication_scopes` = predecessor scopes ∪ the receipt-gated privileged
 * scopes (contract §10 — the exact scope transition; no new scope is
 * invented). `responsible_role` stays the committed schema role
 * (`trusted-result-publisher`); registry reference derives from the
 * host-owned current context (never the caller).
 */
function buildSuccessorPayload(fields: {
  readonly registry: AcceptedRegistryContext;
  readonly predecessor: Readonly<Record<string, unknown>>;
  readonly receiptRecordId: string;
  readonly recordId: string;
  readonly createdAt: string;
}): Readonly<Record<string, unknown>> {
  const predecessorScopes = Array.isArray(fields.predecessor['publication_scopes'])
    ? (fields.predecessor['publication_scopes'] as readonly unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const scopes: string[] = [...predecessorScopes];
  for (const gated of RECEIPT_GATED_SCOPES) {
    if (!scopes.includes(gated)) scopes.push(gated);
  }
  return Object.freeze({
    record_type: 'ResultPublicationRecord',
    record_id: fields.recordId,
    created_at: fields.createdAt,
    responsible_role: CORRELATION_PUBLICATION_ROLE,
    registry_snapshot_reference: registryReferenceFor(fields.registry),
    result_subject: Object.freeze({ ...(isRecord(fields.predecessor['result_subject']) ? fields.predecessor['result_subject'] : {}) }),
    evaluator_provenance: Object.freeze({ ...(isRecord(fields.predecessor['evaluator_provenance']) ? fields.predecessor['evaluator_provenance'] : {}) }),
    association_mode: fields.predecessor['association_mode'],
    validation_record_id: fields.predecessor['validation_record_id'],
    bundle: Object.freeze({ ...(isRecord(fields.predecessor['bundle']) ? fields.predecessor['bundle'] : {}) }),
    workspace_id: fields.predecessor['workspace_id'],
    occurrence_id: fields.predecessor['occurrence_id'],
    attempt_id: fields.predecessor['attempt_id'],
    publication_scopes: Object.freeze(scopes),
    receipt_correlations: Object.freeze([fields.receiptRecordId]),
  });
}

/**
 * Construct the exact `SupersessionRecord` payload (§18). Binds the exact
 * predecessor publication → the exact durable successor publication; scope
 * and reason follow the committed lifecycle schema vocabulary (the
 * committed `publicationScope` enum and `reason_code` pattern); the
 * committed schema role `trusted-lifecycle-authority` is retained (no new
 * schema role; the correlation capability is distinct).
 */
function buildSupersessionPayload(fields: {
  readonly registry: AcceptedRegistryContext;
  readonly predecessorRecordId: string;
  readonly successorRecordId: string;
  readonly recordId: string;
  readonly createdAt: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'SupersessionRecord',
    record_id: fields.recordId,
    created_at: fields.createdAt,
    responsible_role: CORRELATION_SUPERSESSION_ROLE,
    registry_snapshot_reference: registryReferenceFor(fields.registry),
    prior: Object.freeze({ subject_type: 'result-publication', record_id: fields.predecessorRecordId }),
    successor: Object.freeze({ subject_type: 'result-publication', record_id: fields.successorRecordId }),
    scope: 'ordinary-review',
    reason_code: 'receipt-correlation',
  });
}

/**
 * Material exactness over the CLOSED material projection (§23/§24): every
 * schema material field compared in committed canonical form (JCS),
 * excluding only record_id/created_at. An absent key and a present key
 * (including `null`) never compare equal. Never record identity alone. The
 * explicit projection means a future schema field fails closed until
 * deliberately added.
 */
function materiallyExact(fields: readonly string[], proposed: Readonly<Record<string, unknown>>, durable: Readonly<Record<string, unknown>>): boolean {
  for (const key of fields) {
    const a = proposed[key];
    const b = durable[key];
    if (a === undefined || b === undefined) {
      if (a !== b) return false;
      continue;
    }
    if (jcsSerialize(a) !== jcsSerialize(b)) return false;
  }
  return true;
}

/** Exact array equality (JCS form) of the publication scopes. */
function scopesExact(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => jcsSerialize(value) === jcsSerialize(b[index]));
}

// ─── shared read/enumerate helpers ─────────────────────────────────────────

type EligibilityFailure = { readonly ok: false; readonly category: CorrelationFailureCategory; readonly code: string; readonly message: string };

function rejected(category: CorrelationFailureCategory, code: string, message: string): EligibilityFailure {
  return { ok: false, category, code, message };
}

/**
 * Schema gate over a candidate lifecycle payload (SIR-WP15-P1B-001
 * pattern): the outer call result AND the inner ValidationReport AND the
 * validated wrapper must all succeed.
 */
function schemaGate(payload: Readonly<Record<string, unknown>>, schemaRegistry: unknown): boolean {
  const gate = safeCall(() => validateLifecycleRecord(payload, schemaRegistry as unknown as SchemaRegistry));
  return gate.ok === true && gate.value !== undefined && gate.value.ok === true && gate.value.value !== undefined;
}

/**
 * Enumerate one read class and verify EVERY entry is a valid record of its
 * class (S4/WP-13C precondition pattern): unreadable/corrupt entries fail
 * closed and are NEVER silently skipped.
 */
function enumerateAll(
  input: CorrelationInput,
  recordClass: 'execution-attempt-record' | 'execution-outcome-record' | 'result-publication-record' | 'supersession-record' | 'revocation-record',
  expectedRecordType: string,
): { readonly ok: true; readonly payloads: readonly Readonly<Record<string, unknown>>[] } | { readonly ok: false; readonly code: string } {
  const enumerated = input.store.enumerateLifecycleRecords(recordClass);
  if (!enumerated.ok) return { ok: false, code: `state.enumerate-failed.${recordClass}` };
  const payloads: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = input.store.readLifecyclePayload(recordClass, recordId);
    if (!read.ok || read.payload === undefined) return { ok: false, code: `state.unreadable.${recordClass}` };
    if (!isRecord(read.payload) || read.payload['record_type'] !== expectedRecordType) {
      return { ok: false, code: `state.corrupt-entry.${recordClass}` };
    }
    payloads.push(read.payload);
  }
  return { ok: true, payloads: Object.freeze(payloads) };
}

// ─── fresh correlation verification (§9/§21) ────────────────────────────────

interface CorrelationSubject {
  readonly predecessor: Readonly<Record<string, unknown>>;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly attempt: Readonly<Record<string, unknown>>;
  readonly outcome: Readonly<Record<string, unknown>>;
}

/**
 * Fresh durable-state reconstruction + point-of-use correlation
 * verification. Every call re-reads the exact required durable records
 * freshly (no cache, no previous validation result, no caller facts). Runs
 * before the lock AND again under the lock; under-lock failures are
 * authoritative.
 *
 * - predecessor: exact class/schema/role, exact workspace, ordinary-review
 *   scope state, empty receipt correlation state (exact Phase-2
 *   predecessor surface; §10), not revoked by an applicable current
 *   revocation (PUB-004 active-publication check);
 * - receipt: exact class/schema, `result-publication-correlation` event,
 *   `completed` disposition (committed Phase 1A validator), event_record_id
 *   equal to the predecessor, exact workspace/occurrence/attempt binding,
 *   committed source-binding semantics (Phase 1A);
 * - attempt/occurrence: exactly one exact attempt context (tuple + bundle);
 * - outcome: exactly one exact valid ExecutionOutcomeRecord (Phase 1A
 *   claimant-first resolver) + exact result-association quartet + exact
 *   passing ValidationRecord/evaluator provenance;
 * - shared retrospective path: the committed S4 resolver+primitive; when
 *   the resolver reports its committed `state.publication-ambiguous`
 *   signal, the tolerated set is EXACTLY the predecessor plus one
 *   schema-valid same-result-instance successor claimant (SIR-WP15-P2-A-001)
 *   — any unrelated/extra publication fails closed as retrospective-invalid;
 * - registry: the host-owned current context must be genuinely accepted
 *   (branded snapshot); no RuntimeGrant read (correlation read set; §29).
 */
function verifyCorrelation(input: CorrelationInput, now: string): { readonly ok: true; readonly subject: CorrelationSubject } | EligibilityFailure {
  const request = input.request;

  // ─── 1. exact predecessor publication (fresh read) ───────────────────────
  const predecessorRead = input.store.readLifecyclePayload('result-publication-record', request.predecessorPublicationRecordId);
  if (!predecessorRead.ok || predecessorRead.payload === undefined) {
    return predecessorRead.code === 'not-found'
      ? rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.missing', 'the nominated predecessor ResultPublicationRecord does not exist in the durable store')
      : rejected('CORRELATION-STATE-UNVERIFIABLE', 'state.predecessor-unreadable', 'the nominated predecessor ResultPublicationRecord could not be re-read');
  }
  const predecessor = predecessorRead.payload;
  if (!isRecord(predecessor) || predecessor['record_type'] !== 'ResultPublicationRecord') {
    return rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.class-mismatch', 'the nominated predecessor is not a ResultPublicationRecord');
  }
  if (!schemaGate(predecessor, input.schemaRegistry)) {
    return rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.schema-invalid', 'the nominated predecessor is not schema-valid');
  }
  if (predecessor['responsible_role'] !== CORRELATION_PUBLICATION_ROLE) {
    return rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.role-mismatch', 'the nominated predecessor responsible role is not the committed publisher role');
  }
  if (str(predecessor, 'workspace_id') !== request.workspaceId) {
    return { ok: false, category: 'CORRELATION-INPUT-INVALID', code: 'request.workspace-mismatch', message: 'the nominated workspace does not exactly match the predecessor publication' };
  }
  // §10 exact predecessor surface: ordinary-review scope state and EMPTY
  // receipt correlation state — a receipt-correlated or privileged
  // predecessor is not a Phase-2 predecessor.
  const predecessorScopes = predecessor['publication_scopes'];
  if (!Array.isArray(predecessorScopes) || predecessorScopes.length !== 1 || predecessorScopes[0] !== 'ordinary-review') {
    return rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.scope-state', 'the predecessor publication scope state is not the Phase-2 ordinary-review surface');
  }
  const predecessorCorrelations = predecessor['receipt_correlations'];
  if (!Array.isArray(predecessorCorrelations) || predecessorCorrelations.length !== 0) {
    return rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.receipt-state', 'the predecessor publication already carries a receipt correlation');
  }

  // ─── 2. exact TrustedReceipt (fresh read; §8/§9/§13) ─────────────────────
  const receiptRead = input.store.readLifecyclePayload('trusted-receipt', request.trustedReceiptRecordId);
  if (!receiptRead.ok || receiptRead.payload === undefined) {
    return receiptRead.code === 'not-found'
      ? rejected('CORRELATION-RECEIPT-REJECTED', 'receipt.missing', 'the nominated TrustedReceipt does not exist in the durable store')
      : rejected('CORRELATION-STATE-UNVERIFIABLE', 'state.receipt-unreadable', 'the nominated TrustedReceipt could not be re-read');
  }
  const receipt = receiptRead.payload;
  if (!isRecord(receipt) || receipt['record_type'] !== 'TrustedReceipt') {
    return rejected('CORRELATION-RECEIPT-REJECTED', 'receipt.class-mismatch', 'the nominated receipt is not a TrustedReceipt');
  }
  if (!schemaGate(receipt, input.schemaRegistry)) {
    return rejected('CORRELATION-RECEIPT-REJECTED', 'receipt.schema-invalid', 'the nominated TrustedReceipt is not schema-valid');
  }
  if (receipt['event_type'] !== 'result-publication-correlation') {
    return rejected('CORRELATION-RECEIPT-REJECTED', 'receipt.event-type', 'the nominated receipt is not a result-publication-correlation receipt');
  }
  // Committed Phase 1A event/disposition validator: disposition MUST be
  // `completed` for this event type.
  if (!receiptEventDispositionOk('result-publication-correlation', str(receipt, 'disposition'), predecessor, undefined)) {
    return rejected('CORRELATION-RECEIPT-REJECTED', 'receipt.disposition', 'the nominated receipt disposition is not `completed` for the correlation event');
  }
  // §13: the receipt MUST attest the EXACT predecessor publication — same
  // workspace/occurrence/attempt/event source, never merely same-attempt.
  if (str(receipt, 'event_record_id') !== str(predecessor, 'record_id')) {
    return rejected('CORRELATION-MISMATCH', 'binding.event-record', 'the receipt event_record_id does not identify the exact predecessor publication');
  }
  if (str(receipt, 'workspace_id') !== request.workspaceId) {
    return rejected('CORRELATION-MISMATCH', 'binding.workspace', 'the receipt workspace does not exactly match the correlation subject');
  }
  if (str(receipt, 'occurrence_id') !== str(predecessor, 'occurrence_id')) {
    return rejected('CORRELATION-MISMATCH', 'binding.occurrence', 'the receipt occurrence does not exactly match the predecessor publication');
  }
  if (str(receipt, 'attempt_id') !== str(predecessor, 'attempt_id')) {
    return rejected('CORRELATION-MISMATCH', 'binding.attempt', 'the receipt attempt does not exactly match the predecessor publication');
  }
  // Committed Phase 1A source-binding semantics on the constructed form.
  const binding = receiptSourceBindingOk(receipt, predecessor);
  if (!binding.ok) {
    return rejected('CORRELATION-MISMATCH', 'binding.source', `the receipt diverges from the committed source-binding semantics (${binding.message})`);
  }

  // ─── 3. exact attempt context (§9/§13) ───────────────────────────────────
  const attempts = enumerateAll(input, 'execution-attempt-record', 'ExecutionAttemptRecord');
  if (!attempts.ok) return rejected('CORRELATION-STATE-UNVERIFIABLE', attempts.code, 'the attempt-record set could not be enumerated');
  const context = attempts.payloads.filter(
    (a) =>
      str(a, 'workspace_id') === str(predecessor, 'workspace_id') &&
      str(a, 'occurrence_id') === str(predecessor, 'occurrence_id') &&
      str(a, 'attempt_id') === str(predecessor, 'attempt_id') &&
      bundleReferencesEqual(a['bundle'], predecessor['bundle']),
  );
  if (context.length === 0) return rejected('CORRELATION-MISMATCH', 'subject.attempt-missing', 'no exact ExecutionAttemptRecord exists for the predecessor publication subject');
  if (context.length > 1) return rejected('CORRELATION-MISMATCH', 'subject.attempt-ambiguous', 'more than one ExecutionAttemptRecord matches the predecessor publication subject');
  const attempt = context[0]!;

  // ─── 4. exact outcome (Phase 1A claimant-first resolver; §9/§12) ─────────
  const outcomes = enumerateAll(input, 'execution-outcome-record', 'ExecutionOutcomeRecord');
  if (!outcomes.ok) return rejected('CORRELATION-STATE-UNVERIFIABLE', outcomes.code, 'the outcome-record set could not be enumerated');
  const resolution = resolveExactOutcome(attempt, outcomes.payloads);
  if (resolution.kind === 'none') {
    return rejected('CORRELATION-MISMATCH', 'subject.outcome-missing', 'the exact attempt has no trustworthy outcome record');
  }
  if (resolution.kind !== 'exactly-one-valid') {
    const code = resolution.kind === 'conflict' ? 'subject.outcome-conflict' : 'subject.outcome-malformed';
    return rejected('CORRELATION-MISMATCH', code, 'the exact attempt has conflicting or malformed outcome state');
  }
  const outcome = resolution.outcome;

  // ─── 5. exact result association ↔ publication subject (§9/§13) ──────────
  const association = outcome['result_association'];
  const resultSubject = predecessor['result_subject'];
  if (!isRecord(association) || !isRecord(resultSubject)) {
    return rejected('CORRELATION-MISMATCH', 'subject.association-missing', 'the outcome result association or the publication result subject is missing');
  }
  if (
    str(association, 'instance_id') !== str(resultSubject, 'instance_id') ||
    str(association, 'revision_digest') !== str(resultSubject, 'digest') ||
    str(association, 'association_mode') !== str(predecessor, 'association_mode') ||
    str(association, 'validation_record_id') !== str(predecessor, 'validation_record_id')
  ) {
    return rejected('CORRELATION-MISMATCH', 'subject.association-mismatch', 'the outcome result association does not exactly match the publication result subject');
  }

  // ─── 6. exact ValidationRecord / evaluator provenance (§9) ────────────────
  const validationRead = input.store.readLifecyclePayload('validation-record', str(association, 'validation_record_id'));
  if (!validationRead.ok || validationRead.payload === undefined) {
    return validationRead.code === 'not-found'
      ? rejected('CORRELATION-MISMATCH', 'subject.validation-missing', 'the correlated ValidationRecord does not exist in the durable store')
      : rejected('CORRELATION-STATE-UNVERIFIABLE', 'state.validation-unreadable', 'the correlated ValidationRecord could not be re-read');
  }
  const validation = validationRead.payload;
  if (!isRecord(validation) || validation['record_type'] !== 'ValidationRecord' || validation['structural_outcome'] !== 'pass' || validation['semantic_outcome'] !== 'pass') {
    return rejected('CORRELATION-MISMATCH', 'subject.validation-invalid', 'the correlated ValidationRecord is not a passing validation');
  }
  const validationSubject = validation['subject'];
  if (
    !isRecord(validationSubject) ||
    !isRecord(validationSubject['kind']) ||
    validationSubject['kind']['id'] !== 'ExecutionResult' ||
    validationSubject['kind']['version'] !== '1.0' ||
    str(validationSubject, 'instance_id') !== str(association, 'instance_id') ||
    str(validationSubject, 'digest') !== str(association, 'revision_digest') ||
    str(validationSubject, 'workspace_id') !== request.workspaceId
  ) {
    return rejected('CORRELATION-MISMATCH', 'subject.validation-mismatch', 'the correlated ValidationRecord subject does not exactly match the outcome association');
  }
  // Evaluator provenance: the predecessor carries the committed schema-valid
  // provenance form (the schema gate already enforced the shape); the
  // provenance is preserved exactly into the successor (never changed).
  const evaluatorProvenance = predecessor['evaluator_provenance'];
  if (
    !isRecord(evaluatorProvenance) ||
    typeof evaluatorProvenance['evaluator_id'] !== 'string' ||
    evaluatorProvenance['evaluator_id'].length === 0 ||
    typeof evaluatorProvenance['capability_profile_id'] !== 'string' ||
    evaluatorProvenance['capability_profile_id'].length === 0
  ) {
    return rejected('CORRELATION-MISMATCH', 'subject.provenance-invalid', 'the predecessor evaluator provenance is malformed');
  }

  // ─── 7. shared retrospective path (§12) ───────────────────────────────────
  const facts = deriveRetrospectiveFactsFromStore({ records: input.store, attemptRecordId: str(attempt, 'record_id') });
  if (facts.ok) {
    const f = facts.facts;
    if (
      f.workspace_id !== str(attempt, 'workspace_id') ||
      f.occurrence_id !== str(attempt, 'occurrence_id') ||
      f.attempt_id !== str(attempt, 'attempt_id') ||
      f.execution_attempt_record_id !== str(attempt, 'record_id') ||
      f.disposition !== str(outcome, 'disposition') ||
      f.result_instance_id !== str(association, 'instance_id') ||
      f.result_revision_digest !== str(association, 'revision_digest') ||
      f.association_mode !== str(association, 'association_mode') ||
      f.result_validation_record_id !== str(association, 'validation_record_id') ||
      f.result_publication_record_id !== str(predecessor, 'record_id') ||
      !scopesExact(f.publication_scopes, predecessor['publication_scopes'])
    ) {
      return rejected('CORRELATION-MISMATCH', 'subject.retrospective-divergence', 'the shared retrospective facts diverge from the exact receipt/publication/outcome state');
    }
    return { ok: true, subject: { predecessor, receipt, attempt, outcome } };
  }
  // The committed resolver is single-publication by design. The correlation
  // transition is the committed two-publication state: when the resolver
  // reports its exact `state.publication-ambiguous` signal, the tolerated
  // ambiguity set is EXACTLY {predecessor, one same-result successor
  // claimant} (SIR-WP15-P2-A-001). Anything else — zero/duplicate
  // predecessor presence, more than one other publication, a different
  // result instance, or a malformed/schema-invalid claimant on the same
  // ambiguity surface — is conflicting durable state and fails closed as
  // retrospective-invalid. Material exactness is NOT classified here: the
  // single successor-material resolver (`resolveSuccessor`) remains the one
  // authority for replay/divergence classification. Every other derivation
  // failure fails closed.
  if (facts.category === 'RETROSPECTIVE-STATE-CORRUPT' && facts.code === 'state.publication-ambiguous') {
    const publications = enumerateAll(input, 'result-publication-record', 'ResultPublicationRecord');
    if (!publications.ok) return rejected('CORRELATION-STATE-UNVERIFIABLE', publications.code, 'the publication-record set could not be enumerated');
    const attemptScoped = publications.payloads.filter(
      (p) =>
        str(p, 'workspace_id') === str(attempt, 'workspace_id') &&
        str(p, 'occurrence_id') === str(attempt, 'occurrence_id') &&
        str(p, 'attempt_id') === str(attempt, 'attempt_id') &&
        bundleReferencesEqual(p['bundle'], attempt['bundle']),
    );
    if (attemptScoped.length < 2) {
      return rejected('CORRELATION-RETROSPECTIVE-INVALID', 'subject.retrospective-publication-state', 'the attempt-scoped publication set is not the predecessor plus exactly one successor claimant');
    }
    // The predecessor itself must be present EXACTLY once in the tolerated set.
    const predecessors = attemptScoped.filter((p) => p['record_id'] === predecessor['record_id']);
    if (predecessors.length !== 1) {
      return rejected('CORRELATION-RETROSPECTIVE-INVALID', 'subject.retrospective-publication-state', 'the predecessor itself is not present exactly once in the attempt-scoped publication set');
    }
    // EXACTLY ONE other publication may share the ambiguity surface.
    const others = attemptScoped.filter((p) => p['record_id'] !== predecessor['record_id']);
    if (others.length !== 1) {
      return rejected('CORRELATION-RETROSPECTIVE-INVALID', 'subject.retrospective-publication-state', `the attempt-scoped publication set must contain exactly one other publication besides the predecessor (found ${others.length})`);
    }
    // The single other publication must be schema-valid and must claim the
    // SAME exact result instance as the predecessor (an unrelated
    // different-instance publication is never tolerated).
    const successorClaimant = others[0]!;
    if (!schemaGate(successorClaimant, input.schemaRegistry)) {
      return rejected('CORRELATION-RETROSPECTIVE-INVALID', 'subject.retrospective-publication-state', 'the single attempt-scoped successor publication is not schema-valid');
    }
    const otherSubject = successorClaimant['result_subject'];
    const predecessorSubject = predecessor['result_subject'];
    if (!isRecord(otherSubject) || !isRecord(predecessorSubject) || str(otherSubject, 'instance_id') !== str(predecessorSubject, 'instance_id')) {
      return rejected('CORRELATION-RETROSPECTIVE-INVALID', 'subject.retrospective-publication-state', 'the single attempt-scoped successor publication does not claim the exact same result instance as the predecessor');
    }
    return { ok: true, subject: { predecessor, receipt, attempt, outcome } };
  }
  return rejected('CORRELATION-RETROSPECTIVE-INVALID', 'subject.retrospective-path-failed', `the committed shared retrospective derivation rejected the durable state (${facts.category}/${facts.code})`);
}

/**
 * Predecessor currentness (PUB-004 active-publication check; §10/§29):
 * an applicable current RevocationRecord targeting the EXACT predecessor
 * publication (target class + identity) with an accepted effective_at
 * at-or-before now fails the transition closed.
 */
function predecessorRevoked(input: CorrelationInput, predecessor: Readonly<Record<string, unknown>>, now: string): EligibilityFailure | undefined {
  const revocations = enumerateAll(input, 'revocation-record', 'RevocationRecord');
  if (!revocations.ok) return rejected('CORRELATION-STATE-UNVERIFIABLE', revocations.code, 'the revocation-record set could not be enumerated');
  for (const revocation of revocations.payloads) {
    const target = revocation['target'];
    if (!isRecord(target)) continue;
    if (target['record_id'] !== predecessor['record_id'] || target['record_type'] !== 'ResultPublicationRecord') continue;
    const effectiveAt = str(revocation, 'effective_at');
    if (!isAcceptedTimestamp(effectiveAt)) continue; // committed currentness: malformed/future never applies
    if (effectiveAt <= now) {
      return rejected('CORRELATION-PREDECESSOR-REJECTED', 'predecessor.revoked', 'the predecessor publication is revoked by an applicable current revocation');
    }
  }
  return undefined;
}

// ─── claimant resolution (§11/§17/§18/§23/§24) ──────────────────────────────

/**
 * Supersession resolution for the predecessor (§11/§24): claimant-first
 * over the EXACT predecessor relation (prior.subject_type
 * `result-publication` + exact prior.record_id). No first/latest/
 * timestamp/enumeration-order semantics:
 *
 * - no claimant → predecessor may be current (no supersession);
 * - exactly one schema-valid claimant naming the exact materially-identical
 *   successor → State E replay (the named successor record is re-read and
 *   material-verified);
 * - exactly one claimant naming a divergent successor → the predecessor is
 *   superseded to another successor (State D) — fail closed;
 * - multiple claimants → fail closed; schema-invalid claimant → fail closed.
 */
function resolveSupersession(
  input: CorrelationInput,
  subject: CorrelationSubject,
  projectedSuccessor: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly supersession: Readonly<Record<string, unknown>>; readonly namedSuccessor: Readonly<Record<string, unknown>> } | EligibilityFailure {
  const supersessions = enumerateAll(input, 'supersession-record', 'SupersessionRecord');
  if (!supersessions.ok) return rejected('CORRELATION-STATE-UNVERIFIABLE', supersessions.code, 'the supersession-record set could not be enumerated');
  const claimants = supersessions.payloads.filter((s) => {
    const prior = s['prior'];
    return isRecord(prior) && prior['subject_type'] === 'result-publication' && str(prior, 'record_id') === str(subject.predecessor, 'record_id');
  });
  for (const claimant of claimants) {
    if (!schemaGate(claimant, input.schemaRegistry)) {
      return rejected('CORRELATION-SUPERSESSION-CONFLICT', 'supersession.corrupt-claimant', 'a supersession claimant for the predecessor is not schema-valid');
    }
  }
  if (claimants.length > 1) {
    return rejected('CORRELATION-SUPERSESSION-CONFLICT', 'supersession.multiple-claimants', 'more than one SupersessionRecord claims the exact predecessor relation');
  }
  if (claimants.length === 0) return { ok: true, supersession: undefined as never, namedSuccessor: undefined as never };
  const supersession = claimants[0]!;
  const successorRef = supersession['successor'];
  if (!isRecord(successorRef) || successorRef['subject_type'] !== 'result-publication' || typeof successorRef['record_id'] !== 'string' || !RECORD_ID_RE.test(successorRef['record_id'] as string)) {
    return rejected('CORRELATION-SUPERSESSION-CONFLICT', 'supersession.malformed-claimant', 'the supersession claimant successor reference is malformed');
  }
  const successorId = successorRef['record_id'] as string;
  const successorRead = input.store.readLifecyclePayload('result-publication-record', successorId);
  if (!successorRead.ok || successorRead.payload === undefined) {
    return successorRead.code === 'not-found'
      ? rejected('CORRELATION-STATE-UNVERIFIABLE', 'state.supersession-successor-missing', 'the supersession claimant names a successor publication that does not exist in the durable store')
      : rejected('CORRELATION-STATE-UNVERIFIABLE', 'state.supersession-successor-unreadable', 'the supersession claimant successor publication could not be re-read');
  }
  const namedSuccessor = successorRead.payload;
  if (!isRecord(namedSuccessor) || namedSuccessor['record_type'] !== 'ResultPublicationRecord') {
    return rejected('CORRELATION-SUPERSESSION-CONFLICT', 'supersession.divergent-successor', 'the supersession claimant names a record that is not a ResultPublicationRecord');
  }
  if (!schemaGate(namedSuccessor, input.schemaRegistry)) {
    return rejected('CORRELATION-SUPERSESSION-CONFLICT', 'supersession.divergent-successor', 'the supersession claimant names a successor that is not schema-valid');
  }
  if (!materiallyExact(SUCCESSOR_MATERIAL_FIELDS, projectedSuccessor, namedSuccessor)) {
    return rejected('CORRELATION-PREDECESSOR-NOT-CURRENT', 'predecessor.superseded-divergent', 'the predecessor is superseded to a divergent successor publication');
  }
  return { ok: true, supersession, namedSuccessor };
}

/**
 * Successor resolution (§17/§23): claimant-first over the exact successor
 * subject (same workspace/occurrence/attempt/bundle and the same result
 * instance, excluding the predecessor itself). A claimant is the durable
 * successor ONLY when it is materially identical to the closed projection;
 * any divergent same-subject claimant is conflicting durable state (State
 * C) — zero new successor IDs are minted on conflict.
 */
function resolveSuccessor(
  input: CorrelationInput,
  subject: CorrelationSubject,
  projectedSuccessor: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly successor: Readonly<Record<string, unknown>> | undefined } | EligibilityFailure {
  const publications = enumerateAll(input, 'result-publication-record', 'ResultPublicationRecord');
  if (!publications.ok) return rejected('CORRELATION-STATE-UNVERIFIABLE', publications.code, 'the publication-record set could not be enumerated');
  const subjectInstance = (): string => {
    const rs = subject.predecessor['result_subject'];
    return isRecord(rs) ? str(rs, 'instance_id') : '';
  };
  const instance = subjectInstance();
  const claimants = publications.payloads.filter((p) => {
    if (p['record_id'] === subject.predecessor['record_id']) return false;
    if (str(p, 'workspace_id') !== str(subject.predecessor, 'workspace_id')) return false;
    if (str(p, 'occurrence_id') !== str(subject.predecessor, 'occurrence_id')) return false;
    if (str(p, 'attempt_id') !== str(subject.predecessor, 'attempt_id')) return false;
    if (!bundleReferencesEqual(p['bundle'], subject.predecessor['bundle'])) return false;
    const rs = p['result_subject'];
    return isRecord(rs) && str(rs, 'instance_id') === instance;
  });
  for (const claimant of claimants) {
    if (!schemaGate(claimant, input.schemaRegistry)) {
      return rejected('CORRELATION-SUCCESSOR-CONFLICT', 'successor.corrupt-claimant', 'a successor claimant is not schema-valid');
    }
  }
  if (claimants.length > 1) {
    return rejected('CORRELATION-SUCCESSOR-CONFLICT', 'successor.multiple-claimants', 'more than one publication claims the exact successor subject');
  }
  if (claimants.length === 1) {
    if (!materiallyExact(SUCCESSOR_MATERIAL_FIELDS, projectedSuccessor, claimants[0]!)) {
      return rejected('CORRELATION-SUCCESSOR-CONFLICT', 'successor.material-divergence', 'a durable publication claims the exact successor subject with divergent material');
    }
    return { ok: true, successor: claimants[0] };
  }
  return { ok: true, successor: undefined };
}

// ─── publish under the lock (§25/§31) ───────────────────────────────────────

/**
 * Publish one correlation record under the lock through the permit-gated
 * boundary. `newWrite` is true ONLY when WP-8 actually wrote a new durable
 * record (`published`); a materially-exact collision reread is a replay
 * (zero new writes, NO audit event — §31).
 */
function publishUnderLock(
  input: CorrelationInput,
  payload: Readonly<Record<string, unknown>>,
  kind: 'successor' | 'supersession',
): { readonly ok: true; readonly recordId: string; readonly recordDigest: string; readonly newWrite: boolean; readonly auditEventId?: string } | { readonly ok: false; readonly category: CorrelationFailureCategory; readonly code: string; readonly message: string } {
  const payloadDigest = computePayloadDigest(payload);
  const permitCheck = safeCall(() =>
    kind === 'successor'
      ? createCorrelationPublicationPermit({
          capability: input.capability,
          role: 'receipt-publication-correlation',
          recordId: String(payload['record_id']),
          recordDigest: payloadDigest,
          canonicalBytesDigest: payloadDigest,
        })
      : createCorrelationSupersessionPermit({
          capability: input.capability,
          role: 'receipt-publication-correlation',
          recordId: String(payload['record_id']),
          recordDigest: payloadDigest,
          canonicalBytesDigest: payloadDigest,
        }),
  );
  if (!permitCheck.ok || permitCheck.value === undefined) {
    return { ok: false, category: 'CORRELATION-INTERNAL-FAILURE', code: 'internal.permit-denied', message: 'the exact-record correlation permit could not be minted' };
  }
  const permit = permitCheck.value as CorrelationPublicationPermit | CorrelationSupersessionPermit;
  const publishCall = safeCall(() =>
    kind === 'successor'
      ? input.store.publishSuccessorPublication(permit, payload)
      : input.store.publishSupersession(permit, payload),
  );
  if (!publishCall.ok) return { ok: false, category: 'CORRELATION-INTERNAL-FAILURE', code: 'internal.publish-exception', message: 'the correlation store boundary raised an unexpected exception' };
  const result = publishCall.value as CorrelationPublicationResult;
  if (!result.ok) return result;
  if (result.outcome === 'published') {
    if (typeof result.recordId !== 'string' || result.recordId.length === 0) {
      return { ok: false, category: 'CORRELATION-INTERNAL-FAILURE', code: 'internal.publish-incomplete', message: 'the correlation store boundary returned an incomplete success' };
    }
    return { ok: true, recordId: result.recordId, recordDigest: result.recordDigest, newWrite: true, ...(result.auditEventId !== undefined ? { auditEventId: result.auditEventId } : {}) };
  }
  // WP-8 found an existing durable record for this identity (collision
  // reread). Correct sequence is class/role gate → schema gate → validated
  // capture → material comparison (SIR-WP15-P1B-001 pattern). A malformed
  // collision record returns a typed failure — it MUST NOT throw from JCS,
  // escape as an untyped exception, replay, or overwrite.
  const readClass = kind === 'successor' ? ('result-publication-record' as const) : ('supersession-record' as const);
  const expectedType = kind === 'successor' ? 'ResultPublicationRecord' : 'SupersessionRecord';
  const reRead = input.store.readLifecyclePayload(readClass, String(payload['record_id']));
  if (!reRead.ok || reRead.payload === undefined) return { ok: false, category: 'CORRELATION-STATE-UNVERIFIABLE', code: 'state.collision-read-failed', message: 'the existing colliding record could not be re-read' };
  const durable = reRead.payload;
  const conflictCategory: CorrelationFailureCategory = kind === 'successor' ? 'CORRELATION-SUCCESSOR-CONFLICT' : 'CORRELATION-SUPERSESSION-CONFLICT';
  if (!isRecord(durable) || durable['record_type'] !== expectedType) {
    return { ok: false, category: conflictCategory, code: 'state.collision-corrupt', message: 'the colliding durable record is not the expected correlation record class' };
  }
  if (!schemaGate(durable, input.schemaRegistry)) {
    return { ok: false, category: conflictCategory, code: 'state.collision-corrupt', message: 'the colliding durable record is not schema-valid' };
  }
  const materialFields = kind === 'successor' ? SUCCESSOR_MATERIAL_FIELDS : SUPERSESSION_MATERIAL_FIELDS;
  if (materiallyExact(materialFields, payload, durable)) {
    return { ok: true, recordId: String(durable['record_id']), recordDigest: computePayloadDigest(durable), newWrite: false };
  }
  return { ok: false, category: conflictCategory, code: 'conflict.durable-record', message: 'the existing durable record for the same identity diverges materially' };
}

// ─── authority entry ────────────────────────────────────────────────────────

/**
 * Correlate (or replay/recover) exactly one receipt-correlated successor
 * publication + exact SupersessionRecord under the publication-correlation
 * coordination lock. Returns the durable successor/supersession identities
 * (correlated / recovered / replayed) or a typed fail-closed failure. No
 * caller-supplied transition fact can become authority: the successor and
 * supersession are constructed internally from freshly verified durable
 * state. The trusted members of `input` (registry, store, coordinate,
 * identity, schemaRegistry, capability, hooks) are supplied ONLY by the
 * trusted host composition.
 */
export function correlateReceiptPublication(input: CorrelationInput): CorrelationResult {
  // ─── 1. input hygiene (containers + boundary members; SIR-WP13A-001 pattern) ─
  if (!isRecord(input)) return inputInvalid('input.root-invalid', 'the correlation input is missing or malformed');
  for (const key of Object.keys(input)) {
    if (!CORRELATION_INPUT_KEYS.has(key)) return inputInvalid('input.unknown-key', 'the correlation input carries an unknown operand');
  }
  const requestCheck = safeCall(() => captureCorrelationRequest(input['request']));
  if (!requestCheck.ok) return inputInvalid('input.request-invalid', 'the correlation request is missing or malformed');
  if (!requestCheck.value.ok) return inputInvalid(requestCheck.value.code, 'the correlation request is missing or malformed');
  const request = requestCheck.value.request;

  const registryCheck = safeCall(() => registryShape(input['registry']));
  if (!registryCheck.ok || !registryCheck.value.ok) return inputInvalid('input.registry-invalid', 'the registry context is missing or malformed');

  const store = input['store'];
  if (
    !isRecord(store) ||
    typeof store['publishSuccessorPublication'] !== 'function' ||
    typeof store['publishSupersession'] !== 'function' ||
    typeof store['readLifecyclePayload'] !== 'function' ||
    typeof store['enumerateLifecycleRecords'] !== 'function'
  ) {
    return inputInvalid('input.store-invalid', 'the correlation store boundary is missing or not a function');
  }
  const coordinate = input['coordinate'];
  if (!isRecord(coordinate) || typeof coordinate['withLock'] !== 'function') return inputInvalid('input.coordinate-invalid', 'the decision coordinator is missing or not a function');
  const identity = input['identity'];
  if (!isRecord(identity) || typeof identity['nowUtcIso'] !== 'function' || typeof identity['newRecordId'] !== 'function') {
    return inputInvalid('input.identity-invalid', 'the correlation identity source is missing or not a function');
  }
  const schemaRegistry = input['schemaRegistry'];
  if (!isRecord(schemaRegistry) || typeof schemaRegistry['validate'] !== 'function') return inputInvalid('input.schema-registry-invalid', 'the schema registry is missing or malformed');
  const hooks = input['hooks'];
  if (
    hooks !== undefined &&
    (!isRecord(hooks) ||
      (hooks['beforeFirstSuccessorPublication'] !== undefined && typeof hooks['beforeFirstSuccessorPublication'] !== 'function') ||
      (hooks['beforeFirstSupersessionPublication'] !== undefined && typeof hooks['beforeFirstSupersessionPublication'] !== 'function'))
  ) {
    return inputInvalid('input.hooks-invalid', 'the correlation hooks are malformed');
  }
  const capability = input['capability'];
  if (!isGenuineCorrelationCapability(capability)) return failure('CORRELATION-CAPABILITY-DENIED', 'capability.not-genuine', 'the correlation capability is not genuine');
  const capabilityCheck = safeCall(() => (capability as CorrelationCapability).verify());
  if (!capabilityCheck.ok) return failure('CORRELATION-CAPABILITY-DENIED', 'capability.not-genuine', 'the correlation capability is not usable');
  if (!capabilityCheck.value.ok) {
    return failure('CORRELATION-CAPABILITY-DENIED', `capability.${capabilityCheck.value.reason}`, 'the correlation capability is not usable');
  }

  // ─── 2. fresh durable-state reconstruction (pre-lock verification; §9) ────
  const nowCall = safeCall(() => identity['nowUtcIso']());
  if (!nowCall.ok || typeof nowCall.value !== 'string' || !TIMESTAMP_RE.test(nowCall.value)) {
    return internalFailure('identity.time-invalid', 'the correlation identity source returned a malformed timestamp');
  }
  const preCheck = safeCall(() => verifyCorrelation(input, nowCall.value));
  if (!preCheck.ok) return internalFailure('state.pre-verification-exception', 'the pre-lock correlation verification raised an unexpected exception');
  if (!preCheck.value.ok) return failure(preCheck.value.category, preCheck.value.code, 'the fresh trusted-state verification rejected the correlation transition');

  // ─── 3. publication-correlation coordination lock (§20) ───────────────────
  // The key binds the EXACT predecessor publication identity — never merely
  // the workspace or the attempt. Two concurrent correlations for the same
  // predecessor contend on this key; independent predecessors do NOT
  // globally serialize.
  const key = `receipt-publication-correlation|${request.predecessorPublicationRecordId}`;
  let outcome: CorrelationResult;
  try {
    outcome = coordinate.withLock(key, () => {
      // ─── 4. mandatory under-lock re-read + verification re-run (§21) ─────
      const nowUnderLockCall = safeCall(() => identity['nowUtcIso']());
      if (!nowUnderLockCall.ok || typeof nowUnderLockCall.value !== 'string' || !TIMESTAMP_RE.test(nowUnderLockCall.value)) {
        return internalFailure('identity.time-invalid', 'the correlation identity source returned a malformed timestamp');
      }
      const now = nowUnderLockCall.value;
      const underLockCheck = safeCall(() => verifyCorrelation(input, now));
      if (!underLockCheck.ok) return internalFailure('state.under-lock-verification-exception', 'the under-lock correlation verification raised an unexpected exception');
      if (!underLockCheck.value.ok) return failure(underLockCheck.value.category, underLockCheck.value.code, 'the under-lock trusted-state re-verification rejected the correlation transition');
      const subject = underLockCheck.value.subject;

      // PUB-004 active-publication currentness (fresh, under lock).
      const revocationCheck = safeCall(() => predecessorRevoked(input, subject.predecessor, now));
      if (!revocationCheck.ok) return internalFailure('state.revocation-check-exception', 'the predecessor currentness check raised an unexpected exception');
      if (revocationCheck.value !== undefined) return failure(revocationCheck.value.category, revocationCheck.value.code, 'the predecessor currentness check rejected the correlation transition');

      // ─── 5. hook A (host-only test seam; runs before claimant resolution) ─
      try {
        hooks?.beforeFirstSuccessorPublication?.();
      } catch {
        return internalFailure('internal.hook-failure', 'the correlation hook raised an unexpected exception');
      }

      // ─── 6. predecessor currentness / supersession resolution (§11) ──────
      const projected = buildSuccessorPayload({
        registry: input.registry,
        predecessor: subject.predecessor,
        receiptRecordId: str(subject.receipt, 'record_id'),
        recordId: '',
        createdAt: '',
      });
      const supersessionCheck = safeCall(() => resolveSupersession(input, subject, projected));
      if (!supersessionCheck.ok) return internalFailure('state.supersession-resolution-exception', 'the supersession resolution raised an unexpected exception');
      if (!supersessionCheck.value.ok) return failure(supersessionCheck.value.category, supersessionCheck.value.code, 'the supersession resolution rejected the correlation transition');
      const supersessionResolution = supersessionCheck.value;

      if (supersessionResolution.supersession !== undefined) {
        // State E (§22): the exact supersession already durably names the
        // exact materially-identical successor — idempotent replay with
        // ZERO new IDs, ZERO durable writes, NO audit event.
        const successor = supersessionResolution.namedSuccessor;
        const finalCheck = safeCall(() => verifyCorrelation(input, now));
        if (!finalCheck.ok) return internalFailure('state.final-verification-exception', 'the final fresh verification raised an unexpected exception');
        if (!finalCheck.value.ok) return failure(finalCheck.value.category, finalCheck.value.code, 'the final fresh verification rejected the replayed transition');
        const durableSuccessorRef = supersessionResolution.supersession['successor'];
        if (!isRecord(durableSuccessorRef) || str(durableSuccessorRef, 'record_id') !== str(successor, 'record_id')) {
          return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.final-binding-mismatch', 'the durable successor identity diverges from the supersession binding');
        }
        return {
          ok: true,
          outcome: 'replayed',
          predecessorRecordId: str(subject.predecessor, 'record_id'),
          successorRecordId: str(successor, 'record_id'),
          supersessionRecordId: str(supersessionResolution.supersession, 'record_id'),
          receiptRecordId: str(subject.receipt, 'record_id'),
          successorRecordDigest: computePayloadDigest(successor),
          supersessionRecordDigest: computePayloadDigest(supersessionResolution.supersession),
        } as CorrelationResult;
      }

      // ─── 7. exact successor replay/conflict resolution (§17/§23) ─────────
      const successorCheck = safeCall(() => resolveSuccessor(input, subject, projected));
      if (!successorCheck.ok) return internalFailure('state.successor-resolution-exception', 'the successor resolution raised an unexpected exception');
      if (!successorCheck.value.ok) return failure(successorCheck.value.category, successorCheck.value.code, 'the successor resolution rejected the correlation transition');

      let successor: Readonly<Record<string, unknown>>;
      let successorNewWrite = false;
      let successorAuditEventId: string | undefined;
      let successorReplayDigest: string | undefined;
      if (successorCheck.value.successor !== undefined) {
        // State B (§22): the exact durable successor already exists — ZERO
        // new successor IDs, ZERO duplicate successor writes; only the exact
        // missing SupersessionRecord is published below.
        successor = successorCheck.value.successor;
        successorReplayDigest = computePayloadDigest(successor);
      } else {
        // ─── 8. no-claimant branch: mint identity, construct, gate, publish ─
        const recordIdCall = safeCall(() => identity['newRecordId']());
        if (!recordIdCall.ok || typeof recordIdCall.value !== 'string' || !RECORD_ID_RE.test(recordIdCall.value)) {
          return internalFailure('identity.record-id-invalid', 'the correlation identity source returned a malformed record identity');
        }
        const successorPayload = buildSuccessorPayload({
          registry: input.registry,
          predecessor: subject.predecessor,
          receiptRecordId: str(subject.receipt, 'record_id'),
          recordId: recordIdCall.value,
          createdAt: now,
        });
        if (!schemaGate(successorPayload, schemaRegistry)) {
          return internalFailure('internal.schema-gate-rejected', 'the constructed successor publication failed committed lifecycle schema validation');
        }
        const published = publishUnderLock(input, successorPayload, 'successor');
        if (!published.ok) return failure(published.category, published.code, 'the successor write failed or conflicted under the held lock');
        successorNewWrite = published.newWrite;
        successorAuditEventId = published.auditEventId;
        // ─── 9. reread/verify the durable successor (fresh, under lock) ────
        const reRead = input.store.readLifecyclePayload('result-publication-record', published.recordId);
        if (!reRead.ok || reRead.payload === undefined) {
          return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.successor-read-failed', 'the newly published successor could not be re-read');
        }
        if (!isRecord(reRead.payload) || reRead.payload['record_type'] !== 'ResultPublicationRecord' || !schemaGate(reRead.payload, schemaRegistry)) {
          return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.successor-invalid', 'the newly published successor is not a schema-valid ResultPublicationRecord');
        }
        if (!materiallyExact(SUCCESSOR_MATERIAL_FIELDS, successorPayload, reRead.payload)) {
          return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.successor-diverges', 'the durable successor diverges from the constructed projection');
        }
        successor = reRead.payload;
      }

      // ─── 10. hook B (host-only test seam; runs before the supersession
      //          write — crash-after-successor coverage) ────────────────────
      try {
        hooks?.beforeFirstSupersessionPublication?.();
      } catch {
        return internalFailure('internal.hook-failure', 'the correlation hook raised an unexpected exception');
      }

      // ─── 11. publish the exact SupersessionRecord (§18) ──────────────────
      const supersessionIdCall = safeCall(() => identity['newRecordId']());
      if (!supersessionIdCall.ok || typeof supersessionIdCall.value !== 'string' || !RECORD_ID_RE.test(supersessionIdCall.value)) {
        return internalFailure('identity.record-id-invalid', 'the correlation identity source returned a malformed record identity');
      }
      const supersessionPayload = buildSupersessionPayload({
        registry: input.registry,
        predecessorRecordId: str(subject.predecessor, 'record_id'),
        successorRecordId: str(successor, 'record_id'),
        recordId: supersessionIdCall.value,
        createdAt: now,
      });
      if (!schemaGate(supersessionPayload, schemaRegistry)) {
        return internalFailure('internal.schema-gate-rejected', 'the constructed SupersessionRecord failed committed lifecycle schema validation');
      }
      const supersessionPublished = publishUnderLock(input, supersessionPayload, 'supersession');
      if (!supersessionPublished.ok) return failure(supersessionPublished.category, supersessionPublished.code, 'the supersession write failed or conflicted under the held lock');
      const supersessionNewWrite = supersessionPublished.newWrite;
      const supersessionAuditEventId = supersessionPublished.auditEventId;

      // ─── 12. reread/verify the durable SupersessionRecord (fresh) ────────
      const supersessionReRead = input.store.readLifecyclePayload('supersession-record', supersessionPublished.recordId);
      if (!supersessionReRead.ok || supersessionReRead.payload === undefined) {
        return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.supersession-read-failed', 'the newly published SupersessionRecord could not be re-read');
      }
      const durableSupersession = supersessionReRead.payload;
      if (!isRecord(durableSupersession) || durableSupersession['record_type'] !== 'SupersessionRecord' || !schemaGate(durableSupersession, schemaRegistry)) {
        return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.supersession-invalid', 'the newly published SupersessionRecord is not a schema-valid SupersessionRecord');
      }
      if (!materiallyExact(SUPERSESSION_MATERIAL_FIELDS, supersessionPayload, durableSupersession)) {
        return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.supersession-diverges', 'the durable SupersessionRecord diverges from the constructed projection');
      }
      const prior = durableSupersession['prior'];
      const successorRef = durableSupersession['successor'];
      if (
        !isRecord(prior) || prior['subject_type'] !== 'result-publication' || str(prior, 'record_id') !== str(subject.predecessor, 'record_id') ||
        !isRecord(successorRef) || successorRef['subject_type'] !== 'result-publication' || str(successorRef, 'record_id') !== str(successor, 'record_id')
      ) {
        return failure('CORRELATION-STATE-UNVERIFIABLE', 'state.supersession-binding-mismatch', 'the durable SupersessionRecord binding diverges from the transition subject');
      }

      // ─── 13. final fresh verification (§19) ───────────────────────────────
      const finalCheck = safeCall(() => verifyCorrelation(input, now));
      if (!finalCheck.ok) return internalFailure('state.final-verification-exception', 'the final fresh verification raised an unexpected exception');
      if (!finalCheck.value.ok) return failure(finalCheck.value.category, finalCheck.value.code, 'the final fresh verification rejected the completed transition');

      const outcome: CorrelationResult = {
        ok: true,
        // 'correlated' = successor newly written; 'recovered' = exact durable
        // successor reused, only the supersession newly written; 'replayed' =
        // neither newly written (identity-collision replay of both records).
        outcome: successorNewWrite ? 'correlated' : supersessionNewWrite ? 'recovered' : 'replayed',
        predecessorRecordId: str(subject.predecessor, 'record_id'),
        successorRecordId: str(successor, 'record_id'),
        supersessionRecordId: str(durableSupersession, 'record_id'),
        receiptRecordId: str(subject.receipt, 'record_id'),
        successorRecordDigest: successorReplayDigest ?? computePayloadDigest(successor),
        supersessionRecordDigest: computePayloadDigest(durableSupersession),
        ...(successorAuditEventId !== undefined ? { successorAuditEventId } : {}),
        ...(supersessionAuditEventId !== undefined ? { supersessionAuditEventId } : {}),
      };
      return outcome;
    });
  } catch (err) {
    if (err instanceof LockContentionError) return failure('CORRELATION-LOCK-CONFLICT', 'lock.conflict', 'another correlation decision holds the publication-correlation lock');
    return internalFailure('lock.unexpected-exception', 'the publication-correlation lock raised an unexpected exception');
  }
  return outcome;
}
