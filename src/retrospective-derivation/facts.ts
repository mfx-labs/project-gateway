/**
 * WP-13 durability S4 — the ONE shared pure retrospective derivation
 * primitive.
 *
 * `deriveExecutionRetrospectiveFacts(state)` maps the validated durable
 * semantic state to the fixed 21-field `ExecutionRetrospectiveFacts`
 * SEMANTIC object exactly per the committed §12 durable-source mapping
 * (docs/reports/wp-13-closure-durability-architecture-decision.md §12).
 * WP-13 (S4) consumes this primitive now; WP-15 later reuses the SAME
 * implementation — a second independent transformation engine is
 * FORBIDDEN by contract (retrospective simplification amendment §3/§7).
 *
 * Purity boundary (contract §1): the primitive is synchronous, read-only,
 * deterministic, and free of store mutation, persistence, identity
 * allocation, timestamps/current time, random values, authority decisions,
 * receipt issuance, and scheduler/recovery semantics. Repeated derivation
 * of the same valid durable semantic state yields STRUCTURALLY EQUAL field
 * values (semantic equality — `deepStrictEqual` suffices). The fact-set is
 * a semantic object: no JCS/canonical-byte serialization, no content
 * hash/identity (the retrospective fact-set content identity is retired), no
 * byte-identity machinery exists here or anywhere in this family.
 *
 * The primitive interprets ONLY the validated state it is given (field
 * shape + internal consistency + the §12 mapping). Correlation against the
 * durable store (which records belong to the exact attempt, cardinality,
 * terminal-state detection) is the resolver's job (`resolver.ts`) — the
 * loader never duplicates derivation logic.
 *
 * Grouping/absence rules preserved (contract §2): all 21 keys always
 * present; `previous_attempt_id` `null` iff ordinal 1; result fields 12–15
 * all-`null` or all-non-`null`; publication id `null` iff scopes `[]`;
 * enforcement fields 19–20 both-`null` or both-non-`null`; no `undefined`;
 * no alternate absence sentinel.
 */
import type { ExecutionRetrospectiveFacts, RetrospectiveDerivationResult, ValidatedDurableState } from './types.js';

const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
const ATTEMPT_ID_RE = /^pgw:a:[0-9a-f]{32}$/;
const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
const EVIDENCE_ID_RE = /^pgw:e:[0-9a-f]{32}$/;
const BUNDLE_KIND = 'ExecutionBundle';

const DISPOSITIONS: ReadonlySet<string> = new Set(['completed', 'incomplete', 'failed', 'cancelled', 'timed-out', 'crashed', 'rejected']);
const ASSOCIATION_MODES: ReadonlySet<string> = new Set(['originated', 'adopted']);

/** Exact own-key set of the validated state (unknown keys fail closed). */
const STATE_KEYS: ReadonlySet<string> = new Set(['attempt', 'occurrence', 'previousAttemptId', 'outcome', 'validation', 'publication']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function corrupted(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-STATE-CORRUPT', code, message };
}

function mismatched(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-CORRELATION-MISMATCH', code, message };
}

function inputInvalid(code: string, message: string): RetrospectiveDerivationResult {
  return { ok: false, category: 'RETROSPECTIVE-INPUT-INVALID', code, message };
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

/** Field-level shape of the anchor `ExecutionAttemptRecord` (§12 rows 1–8/10/21). */
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
  const binding = bundle.bundle['target_workspace_binding'] as Readonly<Record<string, unknown>>;
  if (binding['workspace_id'] !== a['workspace_id']) return { ok: false };
  return { ok: true, attempt: a };
}

/** Field-level shape of the correlated `ExecutionOccurrenceRecord` (§12 row 9). */
function occurrenceShape(value: unknown): { readonly ok: true; readonly occurrence: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const o = value as Readonly<Record<string, unknown>>;
  if (o['record_type'] !== 'ExecutionOccurrenceRecord') return { ok: false };
  if (typeof o['record_id'] !== 'string' || !RECORD_ID_RE.test(o['record_id'] as string)) return { ok: false };
  return { ok: true, occurrence: o };
}

/**
 * Field-level shape + group consistency of the exactly-one
 * `ExecutionOutcomeRecord` (§12 rows 11/18/19/20). The enforcement pair and
 * the result quartet are all-or-nothing; partial groups are corrupt.
 */
function outcomeShape(value: unknown): { readonly ok: true; readonly outcome: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const o = value as Readonly<Record<string, unknown>>;
  if (o['record_type'] !== 'ExecutionOutcomeRecord') return { ok: false };
  if (typeof o['disposition'] !== 'string' || !DISPOSITIONS.has(o['disposition'] as string)) return { ok: false };
  // observation_evidence: the one committed external-evidence reference (§12 row 18).
  const oe = o['observation_evidence'];
  if (!isRecord(oe)) return { ok: false };
  if (oe['kind'] !== 'external-evidence') return { ok: false };
  if (typeof oe['evidence_id'] !== 'string' || !EVIDENCE_ID_RE.test(oe['evidence_id'] as string)) return { ok: false };
  if (typeof oe['content_digest'] !== 'string' || !DIGEST_RE.test(oe['content_digest'] as string)) return { ok: false };
  if (oe['declared_media_type'] !== 'application/json') return { ok: false };
  if (oe['observation_role'] !== 'evaluation-evidence') return { ok: false };
  // enforcement group (rows 19/20): both present or both absent.
  const ee = o['enforcement_evidence'];
  if (ee !== undefined) {
    if (!isRecord(ee)) return { ok: false };
    if (typeof ee['projection_identity'] !== 'string' || !DIGEST_RE.test(ee['projection_identity'] as string)) return { ok: false };
    if (typeof ee['evidence_fingerprint'] !== 'string' || !DIGEST_RE.test(ee['evidence_fingerprint'] as string)) return { ok: false };
  }
  // result group (rows 12–15): all four present or all absent.
  const ra = o['result_association'];
  if (ra !== undefined) {
    if (!isRecord(ra)) return { ok: false };
    if (typeof ra['instance_id'] !== 'string' || !INSTANCE_ID_RE.test(ra['instance_id'] as string)) return { ok: false };
    if (typeof ra['revision_digest'] !== 'string' || !DIGEST_RE.test(ra['revision_digest'] as string)) return { ok: false };
    if (typeof ra['association_mode'] !== 'string' || !ASSOCIATION_MODES.has(ra['association_mode'] as string)) return { ok: false };
    if (typeof ra['validation_record_id'] !== 'string' || !RECORD_ID_RE.test(ra['validation_record_id'] as string)) return { ok: false };
  }
  return { ok: true, outcome: o };
}

/** Field-level shape of the exact passing `ValidationRecord` (§12 row 15 cross-verification). */
function validationShape(value: unknown): { readonly ok: true; readonly validation: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const v = value as Readonly<Record<string, unknown>>;
  if (v['record_type'] !== 'ValidationRecord') return { ok: false };
  if (v['structural_outcome'] !== 'pass' || v['semantic_outcome'] !== 'pass') return { ok: false };
  const subject = v['subject'];
  if (!isRecord(subject)) return { ok: false };
  const kind = subject['kind'];
  if (!isRecord(kind) || kind['id'] !== 'ExecutionResult' || kind['version'] !== '1.0') return { ok: false };
  if (subject['protocol_version'] !== '1.0') return { ok: false };
  if (typeof subject['instance_id'] !== 'string' || !INSTANCE_ID_RE.test(subject['instance_id'] as string)) return { ok: false };
  if (typeof subject['digest'] !== 'string' || !DIGEST_RE.test(subject['digest'] as string)) return { ok: false };
  if (typeof subject['workspace_id'] !== 'string' || !WORKSPACE_ID_RE.test(subject['workspace_id'] as string)) return { ok: false };
  return { ok: true, validation: v };
}

/** Field-level shape of the at-most-one attempt-scoped `ResultPublicationRecord` (§12 rows 16/17). */
function publicationShape(value: unknown): { readonly ok: true; readonly publication: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const p = value as Readonly<Record<string, unknown>>;
  if (p['record_type'] !== 'ResultPublicationRecord') return { ok: false };
  if (typeof p['record_id'] !== 'string' || !RECORD_ID_RE.test(p['record_id'] as string)) return { ok: false };
  if (!Array.isArray(p['publication_scopes']) || p['publication_scopes'].some((s) => typeof s !== 'string')) return { ok: false };
  return { ok: true, publication: p };
}

/**
 * Owned frozen copy of the exact `ExecutionBundle` reference (the committed
 * shape: five scalar members + the nested `target_kind` and
 * `target_workspace_binding` objects). The nested objects are ALSO copied
 * and frozen, so post-derivation mutation of caller-owned input can never
 * change an already-derived fact-set (SIR-WP13-DUR-S4-001): once
 * `deriveExecutionRetrospectiveFacts` returns, the emitted fact-set owns
 * every value it exposes, including the nested bundle members. Bounded
 * explicitly to this one committed shape — no generic deep-clone
 * machinery, no serialization, no JCS, no hashing.
 */
function freezeOwnedBundle(bundle: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const kind = bundle['target_kind'];
  const binding = bundle['target_workspace_binding'];
  return Object.freeze({
    target_protocol_version: bundle['target_protocol_version'],
    target_kind: isRecord(kind) ? Object.freeze({ ...kind }) : kind,
    target_instance_id: bundle['target_instance_id'],
    target_revision_id: bundle['target_revision_id'],
    target_digest: bundle['target_digest'],
    target_workspace_binding: isRecord(binding) ? Object.freeze({ ...binding }) : binding,
  });
}

/**
 * THE ONE shared pure derivation primitive (§12 mapping; amendment §3/§8).
 *
 * Precondition (documented): `state` is a VALIDATED durable semantic state
 * as assembled by `resolveRetrospectiveDurableState` — exact correlation
 * and cardinality against the durable store are the resolver's
 * responsibility. The primitive additionally enforces field-level shape and
 * the internal consistency of the state it emits, so any misuse (including
 * direct WP-15 reuse) fails closed instead of fabricating a fact-set.
 *
 * Deterministic: the result is a pure function of the state — no clock, no
 * random, no identity, no I/O. The returned object (and every nested
 * member, including the nested bundle objects) is frozen and owned: once
 * this function returns, later mutation of caller-owned input objects
 * cannot change any value of the emitted fact-set (SIR-WP13-DUR-S4-001).
 */
export function deriveExecutionRetrospectiveFacts(state: ValidatedDurableState): RetrospectiveDerivationResult {
  // ─── state hygiene ──────────────────────────────────────────────────────
  if (!isRecord(state)) return inputInvalid('state.root-invalid', 'the validated durable state is missing or malformed');
  for (const key of Object.keys(state)) {
    if (!STATE_KEYS.has(key)) return inputInvalid('state.unknown-key', 'the validated durable state carries an unknown operand');
  }
  const attemptCheck = attemptShape(state['attempt']);
  if (!attemptCheck.ok) return corrupted('facts.attempt-invalid', 'the durable ExecutionAttemptRecord is missing or malformed');
  const attempt = attemptCheck.attempt;
  const occurrenceCheck = occurrenceShape(state['occurrence']);
  if (!occurrenceCheck.ok) return corrupted('facts.occurrence-invalid', 'the durable ExecutionOccurrenceRecord is missing or malformed');
  const outcomeCheck = outcomeShape(state['outcome']);
  if (!outcomeCheck.ok) return corrupted('facts.outcome-invalid', 'the durable ExecutionOutcomeRecord is missing or malformed');
  const outcome = outcomeCheck.outcome;

  // ─── retry group (row 10): previous_attempt_id null iff ordinal 1 ───────
  const ordinal = attempt['ordinal'] as number;
  const previous = state['previousAttemptId'];
  if (ordinal === 1) {
    if (previous !== null) return corrupted('facts.previous-inconsistent', 'ordinal 1 must have a null previous attempt');
  } else {
    if (typeof previous !== 'string' || !ATTEMPT_ID_RE.test(previous)) {
      return corrupted('facts.previous-inconsistent', 'a retry attempt must carry the exact ordinal−1 attempt identity');
    }
  }

  // ─── result group (rows 12–15): association ⇔ validation ────────────────
  const association = outcome['result_association'];
  const validationRaw = state['validation'];
  if (association !== undefined) {
    const validationCheck = validationShape(validationRaw);
    if (!validationCheck.ok) return corrupted('facts.validation-invalid', 'a result association requires the exact durable passing ValidationRecord');
    const validation = validationCheck.validation;
    const subject = validation['subject'] as Readonly<Record<string, unknown>>;
    if (subject['instance_id'] !== (association as Readonly<Record<string, unknown>>)['instance_id']) {
      return mismatched('facts.validation-subject-mismatch', 'the ValidationRecord subject instance does not exactly match the outcome result association');
    }
    if (subject['digest'] !== (association as Readonly<Record<string, unknown>>)['revision_digest']) {
      return mismatched('facts.validation-subject-mismatch', 'the ValidationRecord subject digest does not exactly match the outcome result association');
    }
    if (subject['workspace_id'] !== attempt['workspace_id']) {
      return mismatched('facts.validation-subject-mismatch', 'the ValidationRecord subject workspace does not exactly match the attempt');
    }
  } else if (validationRaw !== undefined) {
    return corrupted('facts.validation-inconsistent', 'a ValidationRecord requires an outcome result association');
  }

  // ─── publication group (rows 16/17): publication requires association; EXE-013 exactness ──
  let publication: Readonly<Record<string, unknown>> | undefined;
  const publicationRaw = state['publication'];
  if (publicationRaw !== undefined) {
    if (association === undefined) {
      return mismatched('facts.publication-without-association', 'a publication cannot create result facts absent from the outcome result association');
    }
    const publicationCheck = publicationShape(publicationRaw);
    if (!publicationCheck.ok) return corrupted('facts.publication-invalid', 'the durable ResultPublicationRecord is missing or malformed');
    publication = publicationCheck.publication;
    const assoc = association as Readonly<Record<string, unknown>>;
    // EXE-013: the original attempt-scoped publication must exact-match the outcome association.
    if (publication['association_mode'] !== assoc['association_mode']) {
      return mismatched('facts.publication-association-mismatch', 'the publication association mode does not exactly match the outcome result association');
    }
    if (publication['validation_record_id'] !== assoc['validation_record_id']) {
      return mismatched('facts.publication-association-mismatch', 'the publication ValidationRecord identity does not exactly match the outcome result association');
    }
    const subject = publication['result_subject'];
    if (!isRecord(subject)) return corrupted('facts.publication-invalid', 'the ResultPublicationRecord carries no result subject');
    if (subject['instance_id'] !== assoc['instance_id'] || subject['digest'] !== assoc['revision_digest'] || subject['workspace_id'] !== attempt['workspace_id']) {
      return mismatched('facts.publication-association-mismatch', 'the publication result subject does not exactly match the outcome result association');
    }
  }

  // ─── the exact 21-field mapping (§12) ────────────────────────────────────
  const bundle = attempt['bundle'] as Readonly<Record<string, unknown>>;
  const oe = outcome['observation_evidence'] as Readonly<Record<string, unknown>>;
  const ee = outcome['enforcement_evidence'] as Readonly<Record<string, unknown>> | undefined;
  const ra = association as Readonly<Record<string, unknown>> | undefined;
  const facts: ExecutionRetrospectiveFacts = Object.freeze({
    workspace_id: String(attempt['workspace_id']),
    bundle: freezeOwnedBundle(bundle),
    occurrence_id: String(attempt['occurrence_id']),
    attempt_id: String(attempt['attempt_id']),
    attempt_ordinal: ordinal,
    activation_record_id: String(attempt['activation_record_id']),
    runtime_grant_id: String(attempt['runtime_grant_id']),
    execution_attempt_record_id: String(attempt['record_id']),
    occurrence_record_id: String(state['occurrence']['record_id']),
    previous_attempt_id: previous as string | null,
    disposition: outcome['disposition'] as ExecutionRetrospectiveFacts['disposition'],
    result_instance_id: ra === undefined ? null : String(ra['instance_id']),
    result_revision_digest: ra === undefined ? null : String(ra['revision_digest']),
    association_mode: ra === undefined ? null : (ra['association_mode'] as 'originated' | 'adopted'),
    result_validation_record_id: ra === undefined ? null : String(ra['validation_record_id']),
    result_publication_record_id: publication === undefined ? null : String(publication['record_id']),
    publication_scopes: publication === undefined ? Object.freeze([]) : Object.freeze([...(publication['publication_scopes'] as readonly string[])]),
    observation_references: Object.freeze([Object.freeze({ ...oe })]),
    enforcement_evidence_identity: ee === undefined ? null : String(ee['projection_identity']),
    enforcement_evidence_fingerprint: ee === undefined ? null : String(ee['evidence_fingerprint']),
    orchestration_evidence_identity: String(attempt['record_id']),
  });
  return { ok: true, facts };
}
