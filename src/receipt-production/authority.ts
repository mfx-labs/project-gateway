/**
 * WP-15 Phase 1B — trusted receipt production authority (decision core).
 *
 * Deterministic, fail-closed flow (§2/§6/§12):
 *
 *   narrow issuance request (workspace + event type + exact event record id)
 *   → input hygiene + descriptor-based request capture (SIR-WP15-P1B-004)
 *   → genuine capability gate (CAP-008…016)
 *   → fresh durable-state reconstruction (pre-lock eligibility; §6/§7)
 *   → event-subject coordination lock (event_type|event_record_id)
 *   → mandatory under-lock re-read + eligibility re-run (§12)
 *   → claimant enumeration (exact event subject; §13/§14)
 *   → replay/conflict classification (§13)
 *   → publish only when a new issuance is valid (opaque record id minted
 *     ONLY in the no-claimant branch; permit-gated single-class boundary;
 *     D-6 authorized-write audit at the WP-8 durability point)
 *
 * Fresh durable-state reconstruction: every issuance attempt re-reads the
 * exact required durable records freshly — no previous validation result,
 * no caller-supplied fact, no project-visible `ExecutionResult`, no
 * enumeration order/timestamp is trusted. Attempt-correlated receipts reuse
 * the committed shared retrospective path (durable-state resolver →
 * `deriveExecutionRetrospectiveFacts`) AND the Phase 1A exact outcome
 * resolution (`resolveExactOutcome`) for exact outcome/cardinality checks.
 * There is no second retrospective derivation engine in this family.
 *
 * Focused correction (SIR-WP15-P1B-001…005): every ValidationReport gate
 * checks the report's own `ok`/wrapper (safeCall `ok` only captures
 * exceptions); durable claimants and collision re-reads are class/role/schema
 * gated before any material comparison; the request is captured through the
 * committed hostile-input primitive; the current chain is resolved by ONE
 * exact cardinality/correlation primitive (activation ↔ occurrence ↔ grant
 * ↔ bundle ↔ reservation ↔ allowance ↔ revocation); the receipt disposition
 * is derived by the Phase 1A authoritative primitive only.
 *
 * This module performs NO successor ResultPublicationRecord production, NO
 * SupersessionRecord production, NO correlation transition (Phase 2), NO
 * execution/activation/grant mutation, and NO pi-guard interaction.
 */
import { validateLifecycleRecord } from '../api/validate.js';
import { registryReferenceFor } from '../control-plane/records.js';
import { LockContentionError } from '../control-plane/coordination.js';
import { isAcceptedTimestamp } from '../control-plane/subject.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { jcsSerialize } from '../canonical/jcs.js';
import { isBrandedRegistry, snapshotJson } from '../internal/snapshot.js';
import {
  ATTEMPT_CORRELATED_RECEIPT_EVENTS,
  deriveReceiptDisposition,
  receiptEventDispositionOk,
  resolveExactOutcome,
} from '../lifecycle/retrospective-eligibility.js';
import {
  receiptEventSourceClass,
  receiptSourceClassMatches,
  receiptSourceBindingOk,
} from '../lifecycle/graph.js';
import { deriveRetrospectiveFactsFromStore } from '../retrospective-derivation/index.js';
import { bundleReferencesEqual } from '../internal/protocol-equality.js';
import { createTrustedReceiptPermit, isGenuineTrustedReceiptCapability, type TrustedReceiptCapability, type TrustedReceiptPermit } from './internal/brand.js';
import { TRUSTED_RECEIPT_PRODUCER_ROLE, type ReceiptFailureCategory, type ReceiptInput, type ReceiptPublicationResult, type ReceiptRequest, type ReceiptResult } from './types.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Exact own-key set of the issuance request (unknown keys fail closed). */
const REQUEST_KEYS: ReadonlySet<string> = new Set(['workspaceId', 'eventType', 'eventRecordId']);

/** Exact own-key set of the receipt input (unknown keys — incl. any receipt/fact operand — fail closed). */
const RECEIPT_INPUT_KEYS: ReadonlySet<string> = new Set(['request', 'registry', 'store', 'coordinate', 'identity', 'schemaRegistry', 'capability', 'hooks']);

/**
 * Closed material projection (§26): every schema material field except the
 * explicit record identity/time. A future schema field is NOT compared
 * until deliberately added here (fail-closed drift).
 */
const RECEIPT_MATERIAL_FIELDS: readonly string[] = [
  'record_type',
  'responsible_role',
  'registry_snapshot_reference',
  'event_type',
  'event_record_id',
  'workspace_id',
  'occurrence_id',
  'attempt_id',
  'disposition',
];

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

function failure(category: ReceiptFailureCategory, code: string, message: string): ReceiptResult {
  return { ok: false, category, code, message };
}

function inputInvalid(code: string, message: string): ReceiptResult {
  return failure('RECEIPT-INPUT-INVALID', code, message);
}

function internalFailure(code: string, message: string): ReceiptResult {
  return failure('RECEIPT-INTERNAL-FAILURE', code, message);
}

// ─── request capture (SIR-WP15-P1B-004) ─────────────────────────────────────

/**
 * Descriptor-based safe capture of the narrow issuance request through the
 * committed hostile-input primitive (`snapshotJson`, src/internal/snapshot.ts):
 * own enumerable data descriptors only. Accessors (getters/setters) are
 * rejected without invocation; symbols, non-enumerable fields, inherited
 * values, non-plain prototypes, and Proxy structural traps (throwing
 * `ownKeys`/`getOwnPropertyDescriptor`/`getPrototypeOf`, revoked proxies)
 * fail closed as typed `RECEIPT-INPUT-INVALID` — no untyped exception
 * escapes. The captured values are detached; the caller's object is never
 * reread and mutation after capture has no effect.
 */
function captureReceiptRequest(value: unknown): { readonly ok: true; readonly request: ReceiptRequest } | { readonly ok: false; readonly code: string } {
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
  const eventType = captured['eventType'];
  const eventRecordId = captured['eventRecordId'];
  if (workspaceId === undefined) return { ok: false, code: 'request.missing-key.workspaceId' };
  if (eventType === undefined) return { ok: false, code: 'request.missing-key.eventType' };
  if (eventRecordId === undefined) return { ok: false, code: 'request.missing-key.eventRecordId' };
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_RE.test(workspaceId)) return { ok: false, code: 'request.workspace-invalid' };
  if (typeof eventType !== 'string' || eventType.length === 0) return { ok: false, code: 'request.event-type-invalid' };
  if (typeof eventRecordId !== 'string' || !RECORD_ID_RE.test(eventRecordId)) return { ok: false, code: 'request.event-record-id-invalid' };
  return { ok: true, request: Object.freeze({ workspaceId, eventType, eventRecordId }) };
}

/**
 * Shape-validate the host-supplied registry context (§16). SIR-WP15-P1B-002
 * §8: a scalar-shaped or merely shape-valid registry reference is NEVER
 * equivalent to trusted current registry state — the `snapshot` member must
 * be a genuinely accepted branded `ValidatedRegistrySnapshot` (the committed
 * `isBrandedRegistry` primitive; no second brand is invented).
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

// ─── receipt construction (§11) ─────────────────────────────────────────────

/**
 * Construct the `TrustedReceipt` payload internally from freshly verified
 * state. Only contract/schema fields are populated. `occurrenceId` /
 * `attemptId` are `undefined` ONLY for the denied-activation branch, in
 * which case the keys are ABSENT (A1 schema: never null, never fabricated);
 * every other branch carries the fields with `null` as the
 * not-applicable sentinel per the committed convention.
 */
function buildReceiptPayload(fields: {
  readonly request: ReceiptRequest;
  readonly disposition: string;
  readonly occurrenceId: string | undefined;
  readonly attemptId: string | undefined;
  readonly registry: AcceptedRegistryContext;
  readonly recordId: string;
  readonly createdAt: string;
}): Readonly<Record<string, unknown>> {
  const base = {
    record_type: 'TrustedReceipt',
    record_id: fields.recordId,
    created_at: fields.createdAt,
    responsible_role: TRUSTED_RECEIPT_PRODUCER_ROLE,
    registry_snapshot_reference: registryReferenceFor(fields.registry),
    event_type: fields.request.eventType,
    event_record_id: fields.request.eventRecordId,
    workspace_id: fields.request.workspaceId,
    disposition: fields.disposition,
  };
  if (fields.request.eventType === 'activation-decision' && fields.disposition === 'denied') {
    // §8: occurrence_id/attempt_id MUST be ABSENT on the denied branch.
    return Object.freeze(base);
  }
  return Object.freeze({
    ...base,
    occurrence_id: fields.occurrenceId ?? null,
    attempt_id: fields.attemptId ?? null,
  });
}

/**
 * Material exactness over the CLOSED material projection (§26): every schema
 * material field compared in committed canonical form (JCS), excluding only
 * record_id/created_at. An absent key and a present key (including `null`)
 * never compare equal; absent-vs-absent is equal. Never record_id/created_at
 * identity alone (§13). The explicit projection means a future schema field
 * fails closed until deliberately added.
 */
function materiallyExact(proposed: Readonly<Record<string, unknown>>, durable: Readonly<Record<string, unknown>>): boolean {
  for (const key of RECEIPT_MATERIAL_FIELDS) {
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

// ─── current lifecycle chain (SIR-WP15-P1B-003) ─────────────────────────────

type EligibilityFailure = { readonly ok: false; readonly category: ReceiptFailureCategory; readonly code: string; readonly message: string };

function rejected(code: string, message: string): EligibilityFailure {
  return { ok: false, category: 'RECEIPT-LIFECYCLE-REJECTED', code, message };
}

function unverifiable(code: string, message: string): EligibilityFailure {
  return { ok: false, category: 'RECEIPT-STATE-UNVERIFIABLE', code, message };
}

function chainConflict(code: string, message: string): EligibilityFailure {
  return { ok: false, category: 'RECEIPT-CONFLICT', code, message };
}

/** The exact chain anchors for one point-of-use currentness resolution. */
interface CurrentChainAnchor {
  readonly workspaceId: string;
  readonly activationRecordId: string;
  /** Exact expected occurrence identity; `undefined` → no occurrence link required. */
  readonly occurrenceId: string | undefined;
  /** The exact ExecutionBundle reference defining the chain identity. */
  readonly bundle: unknown;
  readonly grantRecordId: string;
  /** Current trusted time (host-owned clock). */
  readonly now: string;
  /** Attempt ordinal for the grant allowance check (attempt-correlated chains only). */
  readonly attemptOrdinal: number | undefined;
}

/**
 * ONE pure exact current-chain resolution primitive (SIR-WP15-P1B-003) —
 * the single point-of-use currentness definition of the receipt authority.
 * No first/latest/timestamp/enumeration-order semantics anywhere:
 *
 * - activation: exact identity read; class/workspace/decision checks plus
 *   the full committed cross-bindings (bundle identity, reserved occurrence,
 *   runtime grant identity) — a divergent activation is conflicting state;
 * - occurrence (when the chain links one): claimant-first exact cardinality
 *   (claimants = exact tuple OR exact bundle+occurrence correlation); zero →
 *   lifecycle-rejected; more than one → conflict/ambiguous; one divergent
 *   claimant → conflict/malformed;
 * - grant: exact identity read; class/workspace checks plus the full
 *   committed cross-bindings (subject bundle identity, reserved occurrence);
 *   the grant allowance uses the committed EXE-005/§27.3 comparison
 *   (attempt ordinal <= attempt_limit; a malformed authoritative
 *   attempt_limit fails closed); validity window covers the trusted now;
 * - revocation: committed applicability semantics (target identity AND
 *   target type — never a same-ID different-class shortcut; committed scope
 *   set; `effective_at` must be an accepted timestamp at-or-before now) —
 *   future revocations do not invalidate, wrong-type and out-of-scope
 *   revocations do not invalidate, an applicable current revocation does.
 *
 * Enumeration/read failures fail closed as state-unverifiable.
 */
function resolveCurrentChain(
  input: ReceiptInput,
  anchor: CurrentChainAnchor,
): { readonly ok: true; readonly activation: Readonly<Record<string, unknown>>; readonly grant: Readonly<Record<string, unknown>> } | EligibilityFailure {
  // ─── 1. activation (exact identity) ───────────────────────────────────────
  const activationRead = input.store.readLifecyclePayload('activation-record', anchor.activationRecordId);
  if (!activationRead.ok || activationRead.payload === undefined) {
    return activationRead.code === 'not-found'
      ? rejected('lifecycle.activation-missing', 'the correlated ActivationRecord does not exist in the durable store')
      : unverifiable('state.activation-unreadable', 'the correlated ActivationRecord could not be re-read');
  }
  const activation = activationRead.payload;
  if (activation['record_type'] !== 'ActivationRecord' || str(activation, 'workspace_id') !== anchor.workspaceId) {
    return rejected('lifecycle.activation-mismatch', 'the correlated ActivationRecord is not exact for the workspace');
  }
  if (activation['decision'] !== 'accepted') return rejected('lifecycle.activation-denied', 'the correlated activation decision is not accepted');
  if (!bundleReferencesEqual(activation['bundle'], anchor.bundle)) {
    return chainConflict('state.activation-bundle-divergence', 'the ActivationRecord bundle does not exactly match the chain bundle');
  }
  if (anchor.occurrenceId !== undefined && str(activation, 'reserved_occurrence_id') !== anchor.occurrenceId) {
    return chainConflict('state.activation-reservation-divergence', 'the ActivationRecord reserved occurrence does not match the chain occurrence');
  }
  if (str(activation, 'runtime_grant_id') !== anchor.grantRecordId) {
    return chainConflict('state.activation-grant-divergence', 'the ActivationRecord runtime grant does not match the chain grant');
  }

  // ─── 2. occurrence (exact claimant cardinality; only when linked) ─────────
  if (anchor.occurrenceId !== undefined) {
    const occurrences = enumerateAll(input, 'execution-occurrence-record');
    if (!occurrences.ok) return unverifiable('state.occurrence-enumerate-failed', 'the occurrence-record set could not be enumerated');
    const claimants = occurrences.payloads.filter(
      (payload) =>
        (str(payload, 'workspace_id') === anchor.workspaceId &&
          str(payload, 'activation_record_id') === anchor.activationRecordId &&
          str(payload, 'occurrence_id') === anchor.occurrenceId) ||
        (str(payload, 'workspace_id') === anchor.workspaceId &&
          str(payload, 'occurrence_id') === anchor.occurrenceId &&
          bundleReferencesEqual(payload['bundle'], anchor.bundle)),
    );
    if (claimants.length === 0) return rejected('lifecycle.occurrence-missing', 'the exact correlated ExecutionOccurrenceRecord does not exist in the durable store');
    if (claimants.length > 1) return chainConflict('state.occurrence-ambiguous', 'more than one ExecutionOccurrenceRecord claims the exact chain occurrence');
    const occurrence = claimants[0]!;
    const occurrenceExact =
      str(occurrence, 'workspace_id') === anchor.workspaceId &&
      str(occurrence, 'activation_record_id') === anchor.activationRecordId &&
      str(occurrence, 'occurrence_id') === anchor.occurrenceId &&
      bundleReferencesEqual(occurrence['bundle'], anchor.bundle) &&
      str(occurrence, 'runtime_grant_id') === anchor.grantRecordId;
    if (!occurrenceExact) return chainConflict('state.occurrence-malformed', 'the single occurrence claimant is not exactly chain-bound');
  }

  // ─── 3. grant (exact identity + full committed correlation) ───────────────
  const grantRead = input.store.readLifecyclePayload('runtime-grant', anchor.grantRecordId);
  if (!grantRead.ok || grantRead.payload === undefined) {
    return grantRead.code === 'not-found'
      ? rejected('lifecycle.grant-missing', 'the correlated RuntimeGrant does not exist in the durable store')
      : unverifiable('state.grant-unreadable', 'the correlated RuntimeGrant could not be re-read');
  }
  const grant = grantRead.payload;
  if (grant['record_type'] !== 'RuntimeGrant' || str(grant, 'workspace_id') !== anchor.workspaceId) {
    return rejected('lifecycle.grant-mismatch', 'the correlated RuntimeGrant is not exact for the workspace');
  }
  // Grant ↔ chain bundle correlation: the committed RuntimeGrant payload
  // carries the exact ExecutionBundle reference (same shape as the
  // activation/occurrence/attempt `bundle` members).
  if (!bundleReferencesEqual(grant['bundle'], anchor.bundle)) {
    return chainConflict('state.grant-bundle-divergence', 'the RuntimeGrant bundle does not exactly match the chain bundle');
  }
  if (anchor.occurrenceId !== undefined && str(grant, 'reserved_occurrence_id') !== anchor.occurrenceId) {
    return chainConflict('state.grant-reservation-divergence', 'the RuntimeGrant reserved occurrence does not match the chain occurrence');
  }
  if (anchor.attemptOrdinal !== undefined) {
    // Committed EXE-005/§27.3 allowance: attempt ordinal <= attempt_limit;
    // a malformed authoritative attempt_limit fails closed (committed
    // control-plane Gate C treats it as store-failure).
    const limit = grant['attempt_limit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
      return unverifiable('state.grant-limit-malformed', 'the RuntimeGrant attempt allowance is malformed');
    }
    if (anchor.attemptOrdinal > limit) {
      return rejected('lifecycle.attempt-allowance-exceeded', 'the attempt ordinal exceeds the RuntimeGrant attempt allowance');
    }
  }
  const validity = grant['validity'];
  if (!isRecord(validity) || typeof validity['not_before'] !== 'string' || typeof validity['not_after'] !== 'string') {
    return rejected('lifecycle.grant-mismatch', 'the correlated RuntimeGrant validity window is malformed');
  }
  if (validity['not_before'] > anchor.now || validity['not_after'] < anchor.now) {
    return rejected('lifecycle.grant-expired', 'the correlated RuntimeGrant validity window does not cover the current trusted time');
  }

  // ─── 4. revocation applicability (committed semantics + type hardening) ───
  const revocations = enumerateAll(input, 'revocation-record');
  if (!revocations.ok) return unverifiable('state.revocation-enumerate-failed', 'the revocation-record set could not be enumerated');
  for (const revocation of revocations.payloads) {
    if (revocation['record_type'] !== 'RevocationRecord') continue; // committed currentness: never a different class
    const target = revocation['target'];
    if (!isRecord(target)) continue;
    // SIR-WP15-P1B-003 §19: a revocation invalidates ONLY when BOTH the
    // exact target identity AND the exact target class match — a same-ID
    // different-class record never invalidates the grant.
    if (target['record_id'] !== anchor.grantRecordId || target['record_type'] !== 'RuntimeGrant') continue;
    const scope = str(revocation, 'scope');
    if (scope !== 'all-uses' && scope !== 'execution-use') continue; // committed scope applicability
    const effectiveAt = str(revocation, 'effective_at');
    if (!isAcceptedTimestamp(effectiveAt)) continue; // committed currentness: malformed/future never applies
    if (effectiveAt <= anchor.now) return rejected('lifecycle.grant-revoked', 'the correlated RuntimeGrant is revoked by an applicable current revocation');
  }
  return { ok: true, activation, grant };
}

function enumerateAll(
  input: ReceiptInput,
  recordClass: 'execution-attempt-record' | 'execution-occurrence-record' | 'execution-outcome-record' | 'revocation-record' | 'result-publication-record',
): { readonly ok: true; readonly payloads: readonly Readonly<Record<string, unknown>>[] } | { readonly ok: false } {
  const enumerated = input.store.enumerateLifecycleRecords(recordClass);
  if (!enumerated.ok) return { ok: false };
  const payloads: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = input.store.readLifecyclePayload(recordClass, recordId);
    if (!read.ok || read.payload === undefined) return { ok: false };
    payloads.push(read.payload);
  }
  return { ok: true, payloads: Object.freeze(payloads) };
}

/**
 * Exact record-type → store class-id map for the committed receipt event
 * source classes (the Phase 1A matrix speaks record types; the store
 * boundary speaks class ids).
 */
const RECORD_TYPE_TO_CLASS: Readonly<Record<string, string>> = {
  ActivationRecord: 'activation-record',
  ExecutionOccurrenceRecord: 'execution-occurrence-record',
  ExecutionAttemptRecord: 'execution-attempt-record',
  ResultPublicationRecord: 'result-publication-record',
};

/**
 * Read the exact event source record freshly by identity. For the dual-branch
 * `cancellation` event the concrete class is resolved by read outcome
 * (occurrence first, then attempt); every other event type maps to exactly
 * one class through the Phase 1A matrix.
 */
function readEventSource(
  input: ReceiptInput,
  sourceClass: string | 'occurrence-or-attempt' | undefined,
  eventRecordId: string,
): { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> } | EligibilityFailure {
  const candidates =
    sourceClass === 'occurrence-or-attempt'
      ? (['execution-occurrence-record', 'execution-attempt-record'] as const)
      : ([RECORD_TYPE_TO_CLASS[sourceClass ?? '']] as const);
  for (const recordClass of candidates) {
    if (recordClass === undefined) {
      return rejected('event.source-class-mismatch', 'the event source class is not in the committed vocabulary');
    }
    const eventRead = input.store.readLifecyclePayload(recordClass as import('../storage/types.js').RecordClassId, eventRecordId);
    if (eventRead.ok && eventRead.payload !== undefined) return { ok: true, payload: eventRead.payload };
    if (eventRead.code !== 'not-found') {
      return unverifiable('state.event-unreadable', 'the exact event source record could not be re-read');
    }
  }
  return rejected('event.source-missing', 'the exact event source record does not exist in the durable store');
}

// ─── eligibility verification (§6/§7/§9) ───────────────────────────────────

interface Eligibility {
  readonly disposition: string;
  /** `undefined` ONLY for the denied-activation branch (keys ABSENT). */
  readonly occurrenceId: string | undefined;
  readonly attemptId: string | undefined;
}

/**
 * Fresh durable-state reconstruction + point-of-use issuance verification.
 * Every call re-reads the exact required durable records freshly (no cache,
 * no previous validation result, no caller facts). Runs before the lock AND
 * again under the lock; under-lock failures are authoritative.
 *
 * Event: exact source record exists, correct class, exact bindings,
 * event/disposition semantics. Workspace/context: workspace exact;
 * occurrence/attempt exact where applicable. Outcome: attempt-correlated
 * receipts require exactly one exact valid ExecutionOutcomeRecord (Phase 1A
 * claimant-first resolver) AND the committed shared retrospective path
 * (S4 durable-state resolver → `deriveExecutionRetrospectiveFacts`); zero →
 * terminal-unverifiable/receipt-ineligible; conflict/malformed → fail
 * closed. Registry: the host-owned current context must be genuinely
 * accepted (branded snapshot) and is bound through the committed
 * `registryReferenceFor` machinery. Authority/revocation: the exact current
 * chain is resolved through the ONE exact-chain primitive (grant not
 * revoked — committed applicability — validity covers `now`, allowance
 * respected). Disposition: derived by the Phase 1A authoritative primitive
 * (SIR-WP15-P1B-005). Provenance/result: the correlation branch requires
 * the exact ResultPublicationRecord source, the exact outcome result
 * association, and the committed validation/evaluator provenance still
 * valid.
 */
function verifyEligibility(input: ReceiptInput, now: string): { readonly ok: true; readonly eligibility: Eligibility } | EligibilityFailure {
  const request = input.request;
  const eventType = request.eventType;

  // ─── event-type → exact source class (Phase 1A authoritative matrix) ─────
  const sourceClass = receiptEventSourceClass(eventType);
  if (sourceClass === undefined) return rejected('event.type-unknown', 'the receipt event type is not in the committed vocabulary');

  // ─── exact source record (fresh read; §7 event) ───────────────────────────
  const eventRead = readEventSource(input, sourceClass, request.eventRecordId);
  if (!eventRead.ok) return eventRead;
  const event = eventRead.payload;
  if (!receiptSourceClassMatches(sourceClass, str(event, 'record_type'))) {
    return rejected('event.source-class-mismatch', 'the event source record class does not match the class defined for the event type');
  }
  if (str(event, 'workspace_id') !== request.workspaceId) {
    return { ok: false, category: 'RECEIPT-INPUT-INVALID', code: 'request.workspace-mismatch', message: 'the nominated workspace does not exactly match the event source record' };
  }

  // ─── branch-specific verification ─────────────────────────────────────────
  let occurrenceId: string | undefined;
  let attemptId: string | undefined;
  let outcome: Readonly<Record<string, unknown>> | undefined;

  if (eventType === 'activation-decision') {
    // §8: denied branch binds NO occurrence/attempt and requires NO live
    // chain (a historical denial documents a decision, not an exercised
    // authority — preserved unchanged, SIR-WP15-P1B-003 §21); accepted binds
    // the exact reserved occurrence through the exact current chain.
    const decision = str(event, 'decision');
    if (decision !== 'accepted' && decision !== 'denied') return rejected('event.decision-invalid', 'the ActivationRecord decision is not in the committed vocabulary');
    if (decision === 'accepted') {
      occurrenceId = str(event, 'reserved_occurrence_id');
      const chain = resolveCurrentChain(input, {
        workspaceId: request.workspaceId,
        activationRecordId: str(event, 'record_id'),
        occurrenceId,
        bundle: event['bundle'],
        grantRecordId: str(event, 'runtime_grant_id'),
        now,
        attemptOrdinal: undefined,
      });
      if (!chain.ok) return chain;
    }
  } else if (eventType === 'occurrence-start' || (eventType === 'cancellation' && str(event, 'record_type') === 'ExecutionOccurrenceRecord')) {
    // occurrence-level branch: the source record IS the occurrence; the
    // exact chain links activation + occurrence + grant.
    occurrenceId = str(event, 'occurrence_id');
    const chain = resolveCurrentChain(input, {
      workspaceId: request.workspaceId,
      activationRecordId: str(event, 'activation_record_id'),
      occurrenceId,
      bundle: event['bundle'],
      grantRecordId: str(event, 'runtime_grant_id'),
      now,
      attemptOrdinal: undefined,
    });
    if (!chain.ok) return chain;
  } else if (eventType === 'result-publication-correlation') {
    // §7 provenance/result: exact publication source; exact attempt context
    // (unique tuple + bundle); exactly one exact-bound outcome; the
    // outcome's result association must match the publication's result
    // subject exactly; the committed validation provenance must remain
    // valid. §19: NO successor publication, NO receipt_correlations
    // mutation, NO privileged scope enabling — ordinary-review is
    // contract-approved for a valid correlation receipt.
    const attempts = enumerateAll(input, 'execution-attempt-record');
    if (!attempts.ok) return unverifiable('state.attempt-enumerate-failed', 'the attempt-record set could not be enumerated');
    const context = attempts.payloads.filter(
      (a) =>
        str(a, 'workspace_id') === str(event, 'workspace_id') &&
        str(a, 'occurrence_id') === str(event, 'occurrence_id') &&
        str(a, 'attempt_id') === str(event, 'attempt_id') &&
        bundleReferencesEqual(a['bundle'], event['bundle']),
    );
    if (context.length === 0) return rejected('event.publication-context-missing', 'no exact ExecutionAttemptRecord exists for the publication context');
    if (context.length > 1) return chainConflict('state.publication-context-ambiguous', 'more than one ExecutionAttemptRecord matches the publication context');
    const attempt = context[0]!;
    const resolution = resolveAttemptOutcome(input, attempt, now);
    if (!resolution.ok) return resolution;
    outcome = resolution.outcome;
    occurrenceId = str(attempt, 'occurrence_id');
    attemptId = str(attempt, 'attempt_id');
    // exact result-association ↔ publication-subject correlation (the
    // committed graph semantics, SIR-WP15-P1A-001 §13).
    const association = outcome['result_association'];
    const resultSubject = event['result_subject'];
    if (!isRecord(association) || !isRecord(resultSubject)) return rejected('event.correlation-missing', 'the outcome result association or the publication result subject is missing');
    if (
      str(association, 'instance_id') !== str(resultSubject, 'instance_id') ||
      str(association, 'revision_digest') !== str(resultSubject, 'digest') ||
      str(association, 'association_mode') !== str(event, 'association_mode') ||
      str(association, 'validation_record_id') !== str(event, 'validation_record_id')
    ) {
      return rejected('event.correlation-mismatch', 'the outcome result association does not exactly match the publication result subject');
    }
    // committed validation provenance remains valid (WP-13C current-chain
    // pattern): the referenced ValidationRecord exists and is a passing
    // ExecutionResult subject matching the association quartet.
    const validationRead = input.store.readLifecyclePayload('validation-record', str(association, 'validation_record_id'));
    if (!validationRead.ok || validationRead.payload === undefined) {
      return validationRead.code === 'not-found'
        ? rejected('event.validation-missing', 'the correlated ValidationRecord does not exist in the durable store')
        : unverifiable('state.validation-unreadable', 'the correlated ValidationRecord could not be re-read');
    }
    const validation = validationRead.payload;
    if (validation['record_type'] !== 'ValidationRecord' || validation['structural_outcome'] !== 'pass' || validation['semantic_outcome'] !== 'pass') {
      return rejected('event.validation-invalid', 'the correlated ValidationRecord is not a passing validation');
    }
    const subject = validation['subject'];
    if (
      !isRecord(subject) ||
      !isRecord(subject['kind']) ||
      subject['kind']['id'] !== 'ExecutionResult' ||
      subject['kind']['version'] !== '1.0' ||
      str(subject, 'instance_id') !== str(association, 'instance_id') ||
      str(subject, 'digest') !== str(association, 'revision_digest') ||
      str(subject, 'workspace_id') !== request.workspaceId
    ) {
      return rejected('event.validation-mismatch', 'the correlated ValidationRecord subject does not exactly match the outcome association');
    }
  } else if (ATTEMPT_CORRELATED_RECEIPT_EVENTS.has(eventType) || (eventType === 'cancellation' && str(event, 'record_type') === 'ExecutionAttemptRecord')) {
    // attempt-correlated retrospective events (attempt-start, attempt-end,
    // enforcement-denial, attempt-level cancellation, timeout, crash):
    // §9 retrospective-only — the durable state must be sufficient to prove
    // the event. Exactly one exact valid ExecutionOutcomeRecord (Phase 1A
    // claimant-first resolution) + the committed shared retrospective path.
    const attempt = event;
    const resolution = resolveAttemptOutcome(input, attempt, now);
    if (!resolution.ok) return resolution;
    outcome = resolution.outcome;
    occurrenceId = str(attempt, 'occurrence_id');
    attemptId = str(attempt, 'attempt_id');
  } else {
    return rejected('event.type-unknown', 'the receipt event type is not in the committed vocabulary');
  }

  // ─── authoritative disposition derivation (SIR-WP15-P1B-005) ─────────────
  // ONE derivation authority: the Phase 1A primitive. A not-derivable result
  // (e.g. enforcement-denial over a non-rejected/unevidenced outcome) is
  // conflicting durable state, never a guessed disposition.
  const derived = deriveReceiptDisposition(eventType, event, outcome);
  if (!derived.ok) {
    return chainConflict('state.disposition-divergence', 'the receipt disposition is not derivable from the exact event/source/outcome semantics');
  }
  const disposition = derived.disposition;

  // ─── authoritative event/disposition consistency (SIR-WP15-P1A-003) ──────
  // Defensive assertion: the derivation and the committed validator are the
  // SAME mapping; a divergence is internal state corruption and fails closed.
  if (!receiptEventDispositionOk(eventType, disposition, event, outcome)) {
    return chainConflict('state.disposition-divergence', 'the derived disposition diverges from the committed event/outcome semantics');
  }

  // ─── authoritative source-binding consistency (A1) on the constructed form ─
  const constructed = buildReceiptPayload({ request, disposition, occurrenceId, attemptId, registry: input.registry, recordId: '', createdAt: '' });
  const binding = receiptSourceBindingOk(constructed, event);
  if (!binding.ok) {
    return chainConflict('state.binding-divergence', 'the constructed receipt diverges from the committed source-binding semantics');
  }
  return { ok: true, eligibility: { disposition, occurrenceId, attemptId } };
}

/**
 * Phase 1A exact outcome resolution + the committed shared retrospective
 * path (§6/§7 outcome). Zero claimants → terminal-unverifiable
 * (receipt-ineligible — a VALID lifecycle state, no fabrication);
 * more than one → conflicting durable state; one misanchored claimant →
 * malformed. When exactly-one-valid, the S4 durable-state resolver →
 * `deriveExecutionRetrospectiveFacts` MUST also succeed (the shared
 * derivation engine; no second derivation family exists), the derived facts
 * must agree with the exact attempt/outcome, and the exact current chain
 * (activation → occurrence → grant, with the attempt ordinal allowance)
 * must resolve.
 */
function resolveAttemptOutcome(
  input: ReceiptInput,
  attempt: Readonly<Record<string, unknown>>,
  now: string,
): { readonly ok: true; readonly outcome: Readonly<Record<string, unknown>> } | EligibilityFailure {
  const outcomes = enumerateAll(input, 'execution-outcome-record');
  if (!outcomes.ok) {
    return unverifiable('state.outcome-enumerate-failed', 'the outcome-record set could not be enumerated');
  }
  const resolution = resolveExactOutcome(attempt, outcomes.payloads);
  if (resolution.kind === 'none') {
    return rejected('eligibility.terminal-unverifiable', 'the exact attempt has no trustworthy outcome record; the attempt is terminal-unverifiable and receipt-ineligible');
  }
  if (resolution.kind !== 'exactly-one-valid') {
    const code = resolution.kind === 'conflict' ? 'state.outcome-conflict' : 'state.outcome-malformed';
    return chainConflict(code, 'the exact attempt has conflicting or malformed outcome state');
  }
  // Committed shared retrospective path (S4): durable-state resolver →
  // deriveExecutionRetrospectiveFacts. A divergence between the Phase 1A
  // resolution and the shared derivation fails closed.
  const facts = deriveRetrospectiveFactsFromStore({ records: input.store, attemptRecordId: str(attempt, 'record_id') });
  if (!facts.ok) {
    if (facts.category === 'RETROSPECTIVE-NO-FACTS') {
      return rejected('eligibility.terminal-unverifiable', 'the shared retrospective path found no retrospective-complete facts; the attempt is receipt-ineligible');
    }
    return chainConflict('state.retrospective-path-failed', `the shared retrospective derivation rejected the durable state (${facts.code})`);
  }
  const f = facts.facts;
  if (
    f.workspace_id !== str(attempt, 'workspace_id') ||
    f.occurrence_id !== str(attempt, 'occurrence_id') ||
    f.attempt_id !== str(attempt, 'attempt_id') ||
    f.execution_attempt_record_id !== str(attempt, 'record_id') ||
    f.disposition !== str(resolution.outcome, 'disposition')
  ) {
    return chainConflict('state.retrospective-divergence', 'the shared retrospective facts diverge from the exact attempt/outcome state');
  }
  // Exact current chain with the attempt-ordinal allowance (SIR-WP15-P1B-003).
  const ordinal = attempt['ordinal'];
  const attemptOrdinal = typeof ordinal === 'number' && Number.isSafeInteger(ordinal) && ordinal >= 1 ? ordinal : undefined;
  if (attemptOrdinal === undefined) return unverifiable('state.attempt-ordinal-malformed', 'the attempt ordinal is malformed');
  const chain = resolveCurrentChain(input, {
    workspaceId: str(attempt, 'workspace_id'),
    activationRecordId: str(attempt, 'activation_record_id'),
    occurrenceId: str(attempt, 'occurrence_id'),
    bundle: attempt['bundle'],
    grantRecordId: str(attempt, 'runtime_grant_id'),
    now,
    attemptOrdinal,
  });
  if (!chain.ok) return chain;
  return { ok: true, outcome: resolution.outcome };
}

// ─── claimant enumeration (§13/§14) ─────────────────────────────────────────

/**
 * Claimant identity (§14): the exact intended event subject — the exact
 * event record identity + event type. Workspace/occurrence/attempt
 * applicability and disposition semantics are bound to the source record,
 * so a divergent claimant (corrupt state) is still a claimant and fails
 * closed; broad attempt_id equality and timestamps/ordering are never
 * identity. Every entry inside the trusted-receipt class must be a
 * TrustedReceipt with the exact producer role; class/role violations fail
 * closed (never skipped).
 */
function enumerateClaimants(
  input: ReceiptInput,
): { readonly ok: true; readonly claimants: readonly Readonly<Record<string, unknown>>[] } | EligibilityFailure {
  const enumerated = input.store.enumerateLifecycleRecords('trusted-receipt');
  if (!enumerated.ok) {
    return unverifiable('state.receipt-enumerate-failed', 'the trusted-receipt set could not be enumerated');
  }
  const claimants: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = input.store.readLifecyclePayload('trusted-receipt', recordId);
    if (!read.ok || read.payload === undefined) {
      return unverifiable('state.receipt-unreadable', 'an existing trusted-receipt entry could not be re-read');
    }
    const payload = read.payload;
    if (!isRecord(payload) || payload['record_type'] !== 'TrustedReceipt' || payload['responsible_role'] !== TRUSTED_RECEIPT_PRODUCER_ROLE) {
      return chainConflict('state.receipt-corrupt', 'an existing trusted-receipt entry is malformed');
    }
    if (str(payload, 'event_type') === input.request.eventType && str(payload, 'event_record_id') === input.request.eventRecordId) {
      claimants.push(payload);
    }
  }
  return { ok: true, claimants: Object.freeze(claimants) };
}

// ─── publish under the lock ─────────────────────────────────────────────────

/**
 * Schema gate over a candidate receipt payload: the outer call result AND
 * the inner ValidationReport AND the validated wrapper must all succeed
 * (SIR-WP15-P1B-001 §1). `validateLifecycleRecord` RETURNS `{ok:false}`
 * for invalid records (it never throws), so the report's own `ok` is the
 * authoritative signal — `safeCall`'s `ok` only captures exceptions.
 */
function schemaGate(payload: Readonly<Record<string, unknown>>, schemaRegistry: unknown): boolean {
  const gate = safeCall(() => validateLifecycleRecord(payload, schemaRegistry as unknown as SchemaRegistry));
  return gate.ok === true && gate.value !== undefined && gate.value.ok === true && gate.value.value !== undefined;
}

/** Publish one record under the lock through the permit-gated boundary. */
function publishUnderLock(
  input: ReceiptInput,
  payload: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly recordId: string; readonly recordDigest: string; readonly auditEventId?: string } | { readonly ok: false; readonly category: ReceiptFailureCategory; readonly code: string; readonly message: string } {
  const payloadDigest = computePayloadDigest(payload);
  const permitCheck = safeCall(() =>
    createTrustedReceiptPermit({
      capability: input.capability,
      role: TRUSTED_RECEIPT_PRODUCER_ROLE,
      recordId: String(payload['record_id']),
      recordDigest: payloadDigest,
      canonicalBytesDigest: payloadDigest,
    }),
  );
  if (!permitCheck.ok || permitCheck.value === undefined) {
    return { ok: false, category: 'RECEIPT-INTERNAL-FAILURE', code: 'internal.permit-denied', message: 'the exact-record receipt permit could not be minted' };
  }
  const permit = permitCheck.value as TrustedReceiptPermit;
  const publishCall = safeCall(() => input.store.publishTrustedReceipt(permit, payload));
  if (!publishCall.ok) return { ok: false, category: 'RECEIPT-INTERNAL-FAILURE', code: 'internal.publish-exception', message: 'the receipt store boundary raised an unexpected exception' };
  const result = publishCall.value as ReceiptPublicationResult;
  if (!result.ok) return result;
  if (result.outcome === 'published') {
    if (typeof result.recordId !== 'string' || result.recordId.length === 0) {
      return { ok: false, category: 'RECEIPT-INTERNAL-FAILURE', code: 'internal.publish-incomplete', message: 'the receipt store boundary returned an incomplete success' };
    }
    return { ok: true, recordId: result.recordId, recordDigest: result.recordDigest, ...(result.auditEventId !== undefined ? { auditEventId: result.auditEventId } : {}) };
  }
  // WP-8 found an existing durable record for this identity (collision
  // reread). SIR-WP15-P1B-001 §3: correct sequence is class/role gate →
  // schema gate → validated capture → material comparison. A malformed
  // collision record returns a typed failure — it MUST NOT throw from JCS,
  // escape as an untyped exception, replay, or overwrite.
  const reRead = input.store.readLifecyclePayload('trusted-receipt', String(payload['record_id']));
  if (!reRead.ok || reRead.payload === undefined) return { ok: false, category: 'RECEIPT-STATE-UNVERIFIABLE', code: 'state.receipt-read-failed', message: 'the existing receipt record could not be re-read' };
  const durable = reRead.payload;
  if (!isRecord(durable) || durable['record_type'] !== 'TrustedReceipt' || durable['responsible_role'] !== TRUSTED_RECEIPT_PRODUCER_ROLE) {
    return { ok: false, category: 'RECEIPT-CONFLICT', code: 'state.receipt-corrupt', message: 'the colliding durable record is not an exact TrustedReceipt' };
  }
  if (!schemaGate(durable, input.schemaRegistry)) {
    return { ok: false, category: 'RECEIPT-CONFLICT', code: 'state.receipt-corrupt', message: 'the colliding durable receipt is not schema-valid' };
  }
  if (materiallyExact(payload, durable)) {
    return { ok: true, recordId: String(durable['record_id']), recordDigest: computePayloadDigest(durable) };
  }
  return { ok: false, category: 'RECEIPT-CONFLICT', code: 'conflict.durable-record', message: 'the existing durable receipt for the same identity diverges materially' };
}

// ─── authority entry ────────────────────────────────────────────────────────

/**
 * Issue (or replay) exactly one TrustedReceipt for the exact intended event
 * subject under the event-subject coordination lock. Returns the durable
 * receipt identity (issued or idempotent material replay) or a typed
 * fail-closed failure. No caller-supplied receipt object or trusted fact can
 * become authority: the receipt is constructed internally from freshly
 * verified durable state. The trusted members of `input` (registry, store,
 * coordinate, identity, schemaRegistry, capability, hooks) are supplied
 * ONLY by the trusted host composition (SIR-WP15-P1B-002).
 */
export function issueTrustedReceipt(input: ReceiptInput): ReceiptResult {
  // ─── 1. input hygiene (containers + boundary members; SIR-WP13A-001 pattern) ─
  if (!isRecord(input)) return inputInvalid('input.root-invalid', 'the receipt-issuance input is missing or malformed');
  for (const key of Object.keys(input)) {
    if (!RECEIPT_INPUT_KEYS.has(key)) return inputInvalid('input.unknown-key', 'the receipt-issuance input carries an unknown operand');
  }
  const requestCheck = safeCall(() => captureReceiptRequest(input['request']));
  if (!requestCheck.ok) return inputInvalid('input.request-invalid', 'the receipt issuance request is missing or malformed');
  if (!requestCheck.value.ok) return inputInvalid(requestCheck.value.code, 'the receipt issuance request is missing or malformed');
  const request = requestCheck.value.request;

  const registryCheck = safeCall(() => registryShape(input['registry']));
  if (!registryCheck.ok || !registryCheck.value.ok) return inputInvalid('input.registry-invalid', 'the registry context is missing or malformed');

  const store = input['store'];
  if (
    !isRecord(store) ||
    typeof store['publishTrustedReceipt'] !== 'function' ||
    typeof store['readLifecyclePayload'] !== 'function' ||
    typeof store['enumerateLifecycleRecords'] !== 'function'
  ) {
    return inputInvalid('input.store-invalid', 'the receipt store boundary is missing or not a function');
  }
  const coordinate = input['coordinate'];
  if (!isRecord(coordinate) || typeof coordinate['withLock'] !== 'function') return inputInvalid('input.coordinate-invalid', 'the decision coordinator is missing or not a function');
  const identity = input['identity'];
  if (!isRecord(identity) || typeof identity['nowUtcIso'] !== 'function' || typeof identity['newRecordId'] !== 'function') {
    return inputInvalid('input.identity-invalid', 'the receipt identity source is missing or not a function');
  }
  const schemaRegistry = input['schemaRegistry'];
  if (!isRecord(schemaRegistry) || typeof schemaRegistry['validate'] !== 'function') return inputInvalid('input.schema-registry-invalid', 'the schema registry is missing or malformed');
  const hooks = input['hooks'];
  if (hooks !== undefined && (!isRecord(hooks) || (hooks['beforeFirstReceiptPublication'] !== undefined && typeof hooks['beforeFirstReceiptPublication'] !== 'function'))) {
    return inputInvalid('input.hooks-invalid', 'the issuance hooks are malformed');
  }
  const capability = input['capability'];
  if (!isGenuineTrustedReceiptCapability(capability)) return failure('RECEIPT-CAPABILITY-DENIED', 'capability.not-genuine', 'the trusted-receipt capability is not genuine');
  const capabilityCheck = safeCall(() => (capability as TrustedReceiptCapability).verify());
  if (!capabilityCheck.ok) return failure('RECEIPT-CAPABILITY-DENIED', 'capability.not-genuine', 'the trusted-receipt capability is not usable');
  if (!capabilityCheck.value.ok) {
    return failure('RECEIPT-CAPABILITY-DENIED', `capability.${capabilityCheck.value.reason}`, 'the trusted-receipt capability is not usable');
  }

  // ─── 2. fresh durable-state reconstruction (pre-lock eligibility; §6/§7) ──
  const nowCall = safeCall(() => identity['nowUtcIso']());
  if (!nowCall.ok || typeof nowCall.value !== 'string' || !TIMESTAMP_RE.test(nowCall.value)) {
    return internalFailure('identity.time-invalid', 'the receipt identity source returned a malformed timestamp');
  }
  const preCheck = safeCall(() => verifyEligibility(input, nowCall.value));
  if (!preCheck.ok) return internalFailure('state.pre-verification-exception', 'the pre-lock eligibility verification raised an unexpected exception');
  if (!preCheck.value.ok) return failure(preCheck.value.category, preCheck.value.code, 'the fresh trusted-state verification rejected the receipt issuance');

  // ─── 3. event-subject coordination lock (§12) ─────────────────────────────
  // The key binds the exact intended receipt event subject
  // (event_type|event_record_id) — never merely the workspace or the
  // attempt. Two concurrent issuances for the same event subject contend on
  // this key; divergent requests for the same subject cannot double-write.
  const key = `trusted-receipt|${request.eventType}|${request.eventRecordId}`;
  let outcome: ReceiptResult;
  try {
    outcome = coordinate.withLock(key, () => {
      // ─── 4. mandatory under-lock re-read + eligibility re-run (§12) ──────
      const nowUnderLockCall = safeCall(() => identity['nowUtcIso']());
      if (!nowUnderLockCall.ok || typeof nowUnderLockCall.value !== 'string' || !TIMESTAMP_RE.test(nowUnderLockCall.value)) {
        return internalFailure('identity.time-invalid', 'the receipt identity source returned a malformed timestamp');
      }
      const underLockCheck = safeCall(() => verifyEligibility(input, nowUnderLockCall.value));
      if (!underLockCheck.ok) return internalFailure('state.under-lock-verification-exception', 'the under-lock eligibility verification raised an unexpected exception');
      if (!underLockCheck.value.ok) return failure(underLockCheck.value.category, underLockCheck.value.code, 'the under-lock trusted-state re-verification rejected the receipt issuance');
      const eligibility = underLockCheck.value.eligibility;

      // ─── 5. hook (host-only test seam; runs before claimant enumeration) ──
      try {
        hooks?.beforeFirstReceiptPublication?.();
      } catch {
        return internalFailure('internal.hook-failure', 'the receipt-issuance hook raised an unexpected exception');
      }

      // ─── 6. claimant enumeration + replay/conflict classification (§13) ──
      const claimantCheck = safeCall(() => enumerateClaimants(input));
      if (!claimantCheck.ok) return internalFailure('state.claimant-enumeration-exception', 'the claimant enumeration raised an unexpected exception');
      if (!claimantCheck.value.ok) return failure(claimantCheck.value.category, claimantCheck.value.code, 'the receipt claimant enumeration failed under the held lock');
      const claimants = claimantCheck.value.claimants;

      const proposed = buildReceiptPayload({ request, disposition: eligibility.disposition, occurrenceId: eligibility.occurrenceId, attemptId: eligibility.attemptId, registry: input.registry, recordId: '', createdAt: '' });
      if (claimants.length > 1) {
        // Multiple claimants: fail closed as conflict/corruption; never a
        // newest/timestamp winner (§13).
        return failure('RECEIPT-CONFLICT', 'conflict.multiple-claimants', 'more than one durable receipt exists for the exact event subject');
      }
      if (claimants.length === 1) {
        const durable = claimants[0]!;
        // SIR-WP15-P1B-001 §2: schema-validate every existing claimant BEFORE
        // material equality/replay — an invalid claimant (even one whose
        // invalidity lives only in record_id/created_at, the fields excluded
        // from material comparison) is never a replay candidate.
        if (!schemaGate(durable, schemaRegistry)) {
          return failure('RECEIPT-CONFLICT', 'state.receipt-corrupt', 'the existing receipt record is not schema-valid');
        }
        if (materiallyExact(proposed, durable)) {
          // Exactly one materially identical existing receipt: idempotent
          // replay — return the existing durable identity; ZERO new IDs, ZERO
          // durable writes, NO audit event (§13/§17).
          return { ok: true, outcome: 'replayed', recordId: String(durable['record_id']), recordDigest: computePayloadDigest(durable) } as ReceiptResult;
        }
        return failure('RECEIPT-CONFLICT', 'conflict.material-divergence', 'an existing durable receipt for the exact event subject diverges materially');
      }

      // ─── 7. no-claimant branch: mint identity, construct, gate, publish ──
      const recordIdCall = safeCall(() => identity['newRecordId']());
      if (!recordIdCall.ok || typeof recordIdCall.value !== 'string' || !RECORD_ID_RE.test(recordIdCall.value)) {
        return internalFailure('identity.record-id-invalid', 'the receipt identity source returned a malformed record identity');
      }
      const payload = buildReceiptPayload({ request, disposition: eligibility.disposition, occurrenceId: eligibility.occurrenceId, attemptId: eligibility.attemptId, registry: input.registry, recordId: recordIdCall.value, createdAt: nowUnderLockCall.value });
      if (!schemaGate(payload, schemaRegistry)) {
        return internalFailure('internal.schema-gate-rejected', 'the constructed receipt failed committed lifecycle schema validation');
      }
      const published = publishUnderLock(input, payload);
      if (!published.ok) return failure(published.category, published.code, 'the receipt write failed or conflicted under the held lock');
      return { ok: true, outcome: 'issued', recordId: published.recordId, recordDigest: published.recordDigest, ...(published.auditEventId !== undefined ? { auditEventId: published.auditEventId } : {}) } as ReceiptResult;
    });
  } catch (err) {
    if (err instanceof LockContentionError) return failure('RECEIPT-LOCK-CONFLICT', 'lock.conflict', 'another receipt decision holds the event-subject lock');
    return internalFailure('lock.unexpected-exception', 'the event-subject lock raised an unexpected exception');
  }
  return outcome;
}
