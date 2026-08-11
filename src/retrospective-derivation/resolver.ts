/**
 * WP-13 durability S4 — thin durable-state resolver (cold-restart path).
 *
 * Reads and validates trusted durable records ONLY, establishes exact
 * correlation/cardinality, assembles the validated durable semantic state,
 * and invokes the SAME shared pure derivation primitive
 * (`deriveExecutionRetrospectiveFacts`). The resolver contains NO
 * 21-field derivation logic — the mapping lives once, in the primitive.
 *
 * Discovery rules (contract §3; decision §12): records are correlated by
 * exact content (workspace + bundle + occurrence + attempt identities),
 * never selected by enumeration order, newest timestamp, record id, or
 * lexical ordering. Ambiguity means failure:
 *
 * - the exact anchor `ExecutionAttemptRecord` (read by its record id);
 * - exactly one correlated `ExecutionOccurrenceRecord`;
 * - exactly one ordinal−1 previous attempt for the same
 *   occurrence/workspace/bundle (ordinal 1 → none);
 * - ZERO correlated `ExecutionOutcomeRecord` → `terminal-unverifiable`
 *   (`RETROSPECTIVE-NO-FACTS`: a valid lifecycle state — no fact-set, no
 *   disposition guess, no fabrication, receipt-ineligible); exactly one →
 *   derivation; more than one → fail closed;
 * - the exact passing `ValidationRecord` when the outcome carries a result
 *   association;
 * - at most one attempt-scoped `ResultPublicationRecord`; zero →
 *   `terminal-unpublished` (association retained, publication `null`, `[]`
 *   scopes — no recovery); more than one → fail closed.
 *
 * Every entry discovered inside a read class must be a valid record of
 * that class; unreadable/corrupt entries fail closed and are NEVER
 * silently skipped (WP-13C precondition pattern).
 */
import { bundleReferencesEqual } from '../internal/protocol-equality.js';
import { deriveExecutionRetrospectiveFacts } from './facts.js';
import type { RetrospectiveDerivationInput, RetrospectiveDerivationResult, ValidatedDurableState } from './types.js';
import type { RecordClassId } from '../storage/types.js';

const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
const ATTEMPT_ID_RE = /^pgw:a:[0-9a-f]{32}$/;
const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
const BUNDLE_KIND = 'ExecutionBundle';

/** Exact own-key set of the resolver input (unknown keys fail closed). */
const INPUT_KEYS: ReadonlySet<string> = new Set(['records', 'attemptRecordId']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function corrupt(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-STATE-CORRUPT', code, message };
}

function mismatched(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-CORRELATION-MISMATCH', code, message };
}

function inputInvalid(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-INPUT-INVALID', code, message };
}

function noFacts(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-NO-FACTS', code, message };
}

/** Correlation-relevant shape of the anchor attempt (the §12 anchor). */
function attemptShape(value: unknown): { readonly ok: true; readonly attempt: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const a = value as Readonly<Record<string, unknown>>;
  if (a['record_type'] !== 'ExecutionAttemptRecord') return { ok: false };
  if (typeof a['record_id'] !== 'string' || !RECORD_ID_RE.test(a['record_id'] as string)) return { ok: false };
  if (typeof a['workspace_id'] !== 'string' || !WORKSPACE_ID_RE.test(a['workspace_id'] as string)) return { ok: false };
  if (typeof a['occurrence_id'] !== 'string' || !OCCURRENCE_ID_RE.test(a['occurrence_id'] as string)) return { ok: false };
  if (typeof a['attempt_id'] !== 'string' || !ATTEMPT_ID_RE.test(a['attempt_id'] as string)) return { ok: false };
  if (typeof a['activation_record_id'] !== 'string' || !RECORD_ID_RE.test(a['activation_record_id'] as string)) return { ok: false };
  if (typeof a['runtime_grant_id'] !== 'string' || !RECORD_ID_RE.test(a['runtime_grant_id'] as string)) return { ok: false };
  if (typeof a['ordinal'] !== 'number' || !Number.isSafeInteger(a['ordinal'] as number) || (a['ordinal'] as number) < 1 || (a['ordinal'] as number) > 64) return { ok: false };
  const bundle = bundleShape(a['bundle']);
  if (!bundle.ok) return { ok: false };
  return { ok: true, attempt: a };
}

/** Exact bundle-reference shape (the committed exact-artifact-reference form). */
function bundleShape(value: unknown): { readonly ok: true; readonly bundle: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const b = value as Readonly<Record<string, unknown>>;
  if (b['target_protocol_version'] !== '1.0') return { ok: false };
  const kind = b['target_kind'];
  if (!isRecord(kind) || kind['id'] !== BUNDLE_KIND || kind['version'] !== '1.0') return { ok: false };
  if (typeof b['target_instance_id'] !== 'string' || !INSTANCE_ID_RE.test(b['target_instance_id'] as string)) return { ok: false };
  if (typeof b['target_revision_id'] !== 'string' || !REVISION_ID_RE.test(b['target_revision_id'] as string)) return { ok: false };
  if (typeof b['target_digest'] !== 'string' || !DIGEST_RE.test(b['target_digest'] as string)) return { ok: false };
  const binding = b['target_workspace_binding'];
  if (!isRecord(binding) || binding['mode'] !== 'bound' || typeof binding['workspace_id'] !== 'string') return { ok: false };
  return { ok: true, bundle: b };
}

/** Read every payload of one class, failing closed on ANY unreadable/corrupt entry. */
function enumerateClass(
  input: RetrospectiveDerivationInput,
  recordClass: RecordClassId,
  expectedRecordType: string,
): { readonly ok: true; readonly payloads: readonly Readonly<Record<string, unknown>>[] } | { readonly ok: false; readonly result: RetrospectiveDerivationResult } {
  const enumerated = input.records.enumerateLifecycleRecords(recordClass);
  if (!enumerated.ok) {
    return { ok: false, result: corrupt('state.enumerate-failed', `the ${recordClass} set could not be enumerated`) };
  }
  const payloads: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = input.records.readLifecyclePayload(recordClass, recordId);
    if (!read.ok || read.payload === undefined) {
      return { ok: false, result: corrupt('state.unreadable', `a ${recordClass} entry could not be read`) };
    }
    const payload = read.payload;
    if (!isRecord(payload) || payload['record_type'] !== expectedRecordType) {
      return { ok: false, result: corrupt('state.corrupt-entry', `a ${recordClass} entry is malformed`) };
    }
    payloads.push(payload);
  }
  return { ok: true, payloads: Object.freeze(payloads) };
}

/**
 * Assemble the validated durable semantic state for the exact attempt:
 * resolve → validate → invoke the shared primitive. This is the
 * cold-restart reconstruction path (fresh process, trusted durable records
 * only — no process-local outcome/observation/handoff, no project-visible
 * `ExecutionResult`, no receipt, no cache).
 */
export function resolveRetrospectiveDurableState(input: RetrospectiveDerivationInput): { readonly ok: true; readonly state: ValidatedDurableState } | { readonly ok: false; readonly result: RetrospectiveDerivationResult } {
  // ─── input hygiene ─────────────────────────────────────────────────────
  if (!isRecord(input)) return { ok: false, result: inputInvalid('input.root-invalid', 'the retrospective derivation input is missing or malformed') };
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) return { ok: false, result: inputInvalid('input.unknown-key', 'the retrospective derivation input carries an unknown operand') };
  }
  const records = input['records'];
  if (!isRecord(records) || typeof records['readLifecyclePayload'] !== 'function' || typeof records['enumerateLifecycleRecords'] !== 'function') {
    return { ok: false, result: inputInvalid('input.records-invalid', 'the durable read boundary is missing or not a function') };
  }
  if (typeof input['attemptRecordId'] !== 'string' || !RECORD_ID_RE.test(input['attemptRecordId'])) {
    return { ok: false, result: inputInvalid('input.attempt-record-id-invalid', 'the anchor attempt record identity is missing or malformed') };
  }

  // ─── 1. the exact anchor attempt record ─────────────────────────────────
  const attemptRead = records.readLifecyclePayload('execution-attempt-record', input['attemptRecordId']);
  if (!attemptRead.ok || attemptRead.payload === undefined) {
    return {
      ok: false,
      result: attemptRead.code === 'not-found'
        ? corrupt('state.attempt-missing', 'the anchor ExecutionAttemptRecord does not exist in the durable store')
        : corrupt('state.attempt-unreadable', 'the anchor ExecutionAttemptRecord could not be read'),
    };
  }
  const attemptCheck = attemptShape(attemptRead.payload);
  if (!attemptCheck.ok) return { ok: false, result: corrupt('state.attempt-corrupt', 'the anchor ExecutionAttemptRecord is malformed') };
  const attempt = attemptCheck.attempt;
  if (attempt['record_id'] !== input['attemptRecordId']) return { ok: false, result: corrupt('state.attempt-corrupt', 'the anchor attempt record identity does not match the requested identity') };

  // ─── 2. exactly one correlated ExecutionOccurrenceRecord (§12 row 9) ────
  const occurrences = enumerateClass(input, 'execution-occurrence-record', 'ExecutionOccurrenceRecord');
  if (!occurrences.ok) return occurrences;
  const correlatedOccurrences = occurrences.payloads.filter((payload) => attemptCorrelated(payload, attempt, false));
  if (correlatedOccurrences.length === 0) return { ok: false, result: corrupt('state.occurrence-missing', 'no correlated ExecutionOccurrenceRecord exists for the exact attempt') };
  if (correlatedOccurrences.length > 1) return { ok: false, result: corrupt('state.occurrence-ambiguous', 'more than one ExecutionOccurrenceRecord is correlated to the exact attempt') };
  const occurrence = correlatedOccurrences[0]!;

  // ─── 3. previous attempt: exactly one ordinal−1, same occurrence/workspace/bundle (§12 row 10) ──
  const attempts = enumerateClass(input, 'execution-attempt-record', 'ExecutionAttemptRecord');
  if (!attempts.ok) return attempts;
  const ordinal = attempt['ordinal'] as number;
  let previousAttemptId: string | null = null;
  if (ordinal > 1) {
    const previousCandidates = attempts.payloads.filter(
      (payload) => payload['ordinal'] === ordinal - 1 && attemptCorrelated(payload, attempt, false),
    );
    if (previousCandidates.length === 0) return { ok: false, result: corrupt('state.previous-missing', 'the ordinal−1 previous attempt record does not exist for the exact occurrence') };
    if (previousCandidates.length > 1) return { ok: false, result: corrupt('state.previous-ambiguous', 'more than one ordinal−1 attempt record exists for the exact occurrence') };
    previousAttemptId = String(previousCandidates[0]!['attempt_id']);
  }

  // ─── 4. outcome cardinality: 0 → terminal-unverifiable; 1 → proceed; >1 → corrupt ──
  const outcomes = enumerateClass(input, 'execution-outcome-record', 'ExecutionOutcomeRecord');
  if (!outcomes.ok) return outcomes;
  const correlatedOutcomes = outcomes.payloads.filter((payload) => attemptCorrelated(payload, attempt, true));
  if (correlatedOutcomes.length === 0) {
    return {
      ok: false,
      result: noFacts('terminal-unverifiable', 'no valid ExecutionOutcomeRecord exists for the exact attempt; the attempt is terminal-unverifiable and emits NO retrospective facts'),
    };
  }
  if (correlatedOutcomes.length > 1) return { ok: false, result: corrupt('state.outcome-ambiguous', 'more than one ExecutionOutcomeRecord exists for the exact attempt') };
  const outcome = correlatedOutcomes[0]!;
  // §12 anchor binding: the outcome record must bind the exact anchor attempt record.
  if (outcome['execution_attempt_record_id'] !== attempt['record_id']) {
    return { ok: false, result: corrupt('state.outcome-anchor-mismatch', 'the ExecutionOutcomeRecord does not bind the exact anchor attempt record') };
  }
  if (outcome['ordinal'] !== ordinal) {
    return { ok: false, result: corrupt('state.outcome-ordinal-mismatch', 'the ExecutionOutcomeRecord ordinal does not exactly match the attempt') };
  }

  // ─── 5. exact passing ValidationRecord iff the outcome carries a result association (§12 row 15) ──
  const association = outcome['result_association'];
  let validation: Readonly<Record<string, unknown>> | undefined;
  if (association !== undefined) {
    if (!isRecord(association) || typeof association['validation_record_id'] !== 'string' || !RECORD_ID_RE.test(association['validation_record_id'] as string)) {
      return { ok: false, result: corrupt('state.outcome-corrupt', 'the ExecutionOutcomeRecord result association is malformed') };
    }
    const validationRead = records.readLifecyclePayload('validation-record', association['validation_record_id'] as string);
    if (!validationRead.ok || validationRead.payload === undefined) {
      return {
        ok: false,
        result: validationRead.code === 'not-found'
          ? mismatched('validation.missing', 'the result association references a ValidationRecord that does not exist in the durable store')
          : corrupt('state.validation-unreadable', 'the referenced ValidationRecord could not be read'),
      };
    }
    if (validationRead.payload['record_type'] !== 'ValidationRecord') {
      return { ok: false, result: corrupt('state.validation-corrupt', 'the referenced ValidationRecord is malformed') };
    }
    validation = validationRead.payload;
  }

  // ─── 6. at most one attempt-scoped ResultPublicationRecord (§12 rows 16/17) ──
  const publications = enumerateClass(input, 'result-publication-record', 'ResultPublicationRecord');
  if (!publications.ok) return publications;
  const correlatedPublications = publications.payloads.filter((payload) => attemptCorrelated(payload, attempt, true));
  if (correlatedPublications.length > 1) return { ok: false, result: corrupt('state.publication-ambiguous', 'more than one ResultPublicationRecord exists for the exact attempt') };
  const publication = correlatedPublications.length === 1 ? correlatedPublications[0] : undefined;

  return {
    ok: true,
    state: Object.freeze({
      attempt,
      occurrence,
      previousAttemptId,
      outcome,
      ...(validation !== undefined ? { validation } : {}),
      ...(publication !== undefined ? { publication } : {}),
    }),
  };
}

/**
 * Cold-restart entry: resolve the validated durable semantic state for the
 * exact attempt and derive the 21-field fact-set through the ONE shared
 * primitive. Contains no derivation logic of its own.
 */
export function deriveRetrospectiveFactsFromStore(input: RetrospectiveDerivationInput): RetrospectiveDerivationResult {
  const resolved = resolveRetrospectiveDurableState(input);
  if (!resolved.ok) return resolved.result;
  return deriveExecutionRetrospectiveFacts(resolved.state);
}

/** Exact content correlation: workspace + occurrence + exact bundle (+ attempt id when `attemptScoped`). */
function attemptCorrelated(payload: Readonly<Record<string, unknown>>, attempt: Readonly<Record<string, unknown>>, attemptScoped: boolean): boolean {
  if (payload['workspace_id'] !== attempt['workspace_id']) return false;
  if (payload['occurrence_id'] !== attempt['occurrence_id']) return false;
  if (attemptScoped && payload['attempt_id'] !== attempt['attempt_id']) return false;
  return bundleReferencesEqual(payload['bundle'], attempt['bundle']);
}
