/**
 * WP-13 durability S3 — outcome-recording decision core.
 *
 * Turns ONE already trusted retrospective-complete attempt into AT MOST ONE
 * durable ExecutionOutcomeRecord (ADR-039 §4/§5/§9; WP-13 durability
 * decision §1–§8/§15). Model-1 lock semantics: acquire the exact attempt
 * coordination key (shared byte-for-byte with WP-13C) → under-lock re-read
 * of the current attempt record + every outcome candidate for the exact
 * attempt → uniqueness/replay decision → publish through S2 (only in the
 * no-existing branch) → RELEASE the lock completely. WP-13C then acquires
 * the SAME key independently; no nested/reentrant acquisition, no lock
 * handoff.
 *
 * Cardinality: zero candidates → no-existing branch (opaque ids/timestamp
 * allocated ONLY there, in `new-outcome.ts`); exactly one → material replay
 * verification (no allocations, no timestamp, no permit, no write); more
 * than one → fail closed as a durable outcome conflict. No newest-wins, no
 * record-id/created_at/enumeration-order selection; malformed/corrupt
 * candidate state fails closed.
 *
 * S3 does NOT derive ExecutionRetrospectiveFacts (S4), does NOT issue
 * receipts (WP-15), does NOT publish results (WP-13C), and implements NO
 * recovery/resume protocol.
 */
import { jcsSerialize } from '../canonical/jcs.js';
import { validateCanonicalInput } from '../canonical/input.js';
import { createHash } from 'node:crypto';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { validateLifecycleRecord } from '../api/validate.js';
import { bundleReferencesEqual } from '../internal/protocol-equality.js';
import { attemptCoordinationKey } from '../internal/attempt-coordination-key.js';
import { registryReferenceFor } from '../control-plane/records.js';
import { LockContentionError } from '../control-plane/coordination.js';
import { computePlanIdentity, computeEvidenceFingerprint, stripUndefined } from '../adapters/pi/enforcement/evidence.js';
import { isPiExecutionObservation } from '../adapters/pi/index.js';
import { isGenuineExecutionOutcomeCapability, type ExecutionOutcomeCapability } from '../outcome/capability.js';
import { buildOutcomePayload, publishNewOutcome, type OutcomeMaterial } from './new-outcome.js';
import type { OutcomeProductionFailureCategory, OutcomeProductionInput, OutcomeProductionResult } from './types.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { SchemaRegistry } from '../schema/registry.js';
import type { PiEnforcementEvidence } from '../adapters/pi/enforcement/types.js';

const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
const ATTEMPT_ID_RE = /^pgw:a:[0-9a-f]{32}$/;
const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
const EVIDENCE_ID_RE = /^pgw:e:[0-9a-f]{32}$/;
const BUNDLE_KIND = 'ExecutionBundle';

const DISPOSITIONS: ReadonlySet<string> = new Set(['completed', 'incomplete', 'failed', 'cancelled', 'timed-out', 'crashed', 'rejected']);
const ASSOCIATION_MODES: ReadonlySet<string> = new Set(['originated', 'adopted']);

/** Exact own-key set of the outcome-production input (unknown keys fail closed). */
const OUTCOME_INPUT_KEYS: ReadonlySet<string> = new Set([
  'attempt',
  'outcome',
  'observation',
  'enforcement',
  'handoff',
  'validation',
  'registry',
  'store',
  'records',
  'coordinate',
  'identity',
  'schemaRegistry',
  'capability',
  'hooks',
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function denied(category: OutcomeProductionFailureCategory, code: string, message: string): OutcomeProductionResult {
  return { ok: false, category, code, message };
}

function inputInvalid(code: string, message: string): OutcomeProductionResult {
  return denied('OUTCOME-INPUT-INVALID', code, message);
}

function internalFailure(code: string, message: string): OutcomeProductionResult {
  return denied('OUTCOME-INTERNAL-FAILURE', code, message);
}

// ─── shape validation (trusted inputs; exact correlation) ───────────────────

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

/** The exact durable ExecutionAttemptRecord payload (correlation anchor). */
function attemptShape(value: unknown): { readonly ok: true; readonly attempt: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const a = value as Readonly<Record<string, unknown>>;
  if (a['record_type'] !== 'ExecutionAttemptRecord') return { ok: false };
  if (typeof a['record_id'] !== 'string' || !RECORD_ID_RE.test(a['record_id'] as string)) return { ok: false };
  if (typeof a['workspace_id'] !== 'string' || !WORKSPACE_ID_RE.test(a['workspace_id'] as string)) return { ok: false };
  if (typeof a['occurrence_id'] !== 'string' || !OCCURRENCE_ID_RE.test(a['occurrence_id'] as string)) return { ok: false };
  if (typeof a['attempt_id'] !== 'string' || !ATTEMPT_ID_RE.test(a['attempt_id'] as string)) return { ok: false };
  if (typeof a['ordinal'] !== 'number' || !Number.isSafeInteger(a['ordinal'] as number) || (a['ordinal'] as number) < 1) return { ok: false };
  const bundle = bundleShape(a['bundle']);
  if (!bundle.ok) return { ok: false };
  const binding = (bundle.bundle['target_workspace_binding'] as Readonly<Record<string, unknown>>);
  if (binding['workspace_id'] !== a['workspace_id']) return { ok: false };
  return { ok: true, attempt: a };
}

/** The verified terminal ExecutionAttemptOutcome (exact attempt correlation). */
function outcomeShape(value: unknown): { readonly ok: true; readonly disposition: string } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const o = value as Readonly<Record<string, unknown>>;
  if (typeof o['disposition'] !== 'string' || !DISPOSITIONS.has(o['disposition'] as string)) return { ok: false };
  if (typeof o['occurrenceId'] !== 'string' || typeof o['attemptId'] !== 'string') return { ok: false };
  if (typeof o['ordinal'] !== 'number' || !Number.isSafeInteger(o['ordinal'] as number) || (o['ordinal'] as number) < 1) return { ok: false };
  return { ok: true, disposition: o['disposition'] as string };
}

/** Registry context shape (accepted host-supplied context). */
function registryShape(value: unknown): { readonly ok: true; readonly registry: AcceptedRegistryContext } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const r = value as Readonly<Record<string, unknown>>;
  if (typeof r['registryProtocolId'] !== 'string' || r['registryProtocolId'].length === 0) return { ok: false };
  if (r['registrySnapshotFormatVersion'] !== '1.0') return { ok: false };
  if (typeof r['registrySnapshotId'] !== 'string' || !/^pgw:g:[0-9a-f]{32}$/.test(r['registrySnapshotId'] as string)) return { ok: false };
  if (typeof r['registrySnapshotDigest'] !== 'string' || !DIGEST_RE.test(r['registrySnapshotDigest'] as string)) return { ok: false };
  return { ok: true, registry: value as unknown as AcceptedRegistryContext };
}

/** The bounded validated-result handoff (the result quartet's ONLY source). */
function handoffShape(value: unknown): { readonly ok: true; readonly handoff: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const h = value as Readonly<Record<string, unknown>>;
  if (typeof h['workspaceId'] !== 'string' || !WORKSPACE_ID_RE.test(h['workspaceId'] as string)) return { ok: false };
  if (typeof h['occurrenceId'] !== 'string' || !OCCURRENCE_ID_RE.test(h['occurrenceId'] as string)) return { ok: false };
  if (typeof h['attemptId'] !== 'string' || !ATTEMPT_ID_RE.test(h['attemptId'] as string)) return { ok: false };
  if (typeof h['ordinal'] !== 'number' || !Number.isSafeInteger(h['ordinal'] as number) || (h['ordinal'] as number) < 1) return { ok: false };
  if (h['disposition'] !== 'completed') return { ok: false };
  if (typeof h['associationMode'] !== 'string' || !ASSOCIATION_MODES.has(h['associationMode'] as string)) return { ok: false };
  if (typeof h['resultInstanceId'] !== 'string' || !INSTANCE_ID_RE.test(h['resultInstanceId'] as string)) return { ok: false };
  if (typeof h['resultDigest'] !== 'string' || !DIGEST_RE.test(h['resultDigest'] as string)) return { ok: false };
  if (typeof h['validationRecordId'] !== 'string' || !RECORD_ID_RE.test(h['validationRecordId'] as string)) return { ok: false };
  const bundle = bundleShape(h['bundleReference']);
  if (!bundle.ok) return { ok: false };
  const binding = (bundle.bundle['target_workspace_binding'] as Readonly<Record<string, unknown>>);
  if (binding['workspace_id'] !== h['workspaceId']) return { ok: false };
  return { ok: true, handoff: h };
}

/** The exact durable passing ValidationRecord payload (subject-kind ExecutionResult). */
function validationShape(value: unknown): { readonly ok: true; readonly validation: Readonly<Record<string, unknown>> } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const v = value as Readonly<Record<string, unknown>>;
  if (v['record_type'] !== 'ValidationRecord') return { ok: false };
  if (typeof v['record_id'] !== 'string' || !RECORD_ID_RE.test(v['record_id'] as string)) return { ok: false };
  if (v['structural_outcome'] !== 'pass' || v['semantic_outcome'] !== 'pass') return { ok: false };
  const subject = v['subject'];
  if (!isRecord(subject)) return { ok: false };
  const kind = subject['kind'];
  if (!isRecord(kind) || kind['id'] !== 'ExecutionResult' || kind['version'] !== '1.0') return { ok: false };
  if (subject['protocol_version'] !== '1.0') return { ok: false };
  if (typeof subject['instance_id'] !== 'string' || !INSTANCE_ID_RE.test(subject['instance_id'] as string)) return { ok: false };
  if (typeof subject['revision_id'] !== 'string' || !REVISION_ID_RE.test(subject['revision_id'] as string)) return { ok: false };
  if (typeof subject['digest'] !== 'string' || !DIGEST_RE.test(subject['digest'] as string)) return { ok: false };
  if (typeof subject['workspace_id'] !== 'string' || !WORKSPACE_ID_RE.test(subject['workspace_id'] as string)) return { ok: false };
  return { ok: true, validation: v };
}

// ─── observation canonical binding (ADR-039 §7; EXE-011) ────────────────────

/**
 * Canonical observation content digest: JCS of the observation object under
 * the committed NFC/canonical-input discipline, `sha-256:` over that
 * canonical material. The digest is a BINDING over the canonical
 * serialization — never stored observation content; raw session/turn
 * correlation ids stay inside the digest-bound material and are NEVER
 * evidence identities.
 */
export function canonicalObservationContentDigest(
  observation: unknown,
): { readonly ok: true; readonly digest: string } | { readonly ok: false } {
  const canonical = stripUndefined(observation);
  const gate = validateCanonicalInput(canonical, { subjectClass: 'artifact' });
  if (gate.ok !== true) return { ok: false };
  const material = jcsSerialize(canonical);
  const hash = createHash('sha256');
  hash.update(material, 'utf8');
  return { ok: true, digest: 'sha-256:' + hash.digest('hex') };
}

// ─── material construction ──────────────────────────────────────────────────

interface TrustedFacts {
  readonly attempt: Readonly<Record<string, unknown>>;
  readonly disposition: string;
  readonly observationDigest: string;
  readonly enforcement?: { readonly projectionIdentity: string; readonly evidenceFingerprint: string };
  readonly association?: { readonly instanceId: string; readonly revisionDigest: string; readonly mode: string; readonly validationRecordId: string };
}

function materialOf(facts: TrustedFacts, registry: AcceptedRegistryContext): OutcomeMaterial {
  const attempt = facts.attempt;
  return Object.freeze({
    registryReference: registryReferenceFor(registry),
    workspaceId: String(attempt['workspace_id']),
    bundle: attempt['bundle'] as Readonly<Record<string, unknown>>,
    occurrenceId: String(attempt['occurrence_id']),
    attemptId: String(attempt['attempt_id']),
    ordinal: attempt['ordinal'] as number,
    attemptRecordId: String(attempt['record_id']),
    disposition: facts.disposition,
    observationDigest: facts.observationDigest,
    ...(facts.enforcement !== undefined ? { enforcement: Object.freeze(facts.enforcement) } : {}),
    ...(facts.association !== undefined ? { association: Object.freeze(facts.association) } : {}),
  });
}

/** Exact WP-5B correlation: the evidence fingerprint recomputes and the plan identity matches the attempt. */
function enforcementCorrelated(
  enforcement: PiEnforcementEvidence,
  attempt: Readonly<Record<string, unknown>>,
): boolean {
  if (typeof enforcement.projectionIdentity !== 'string' || !DIGEST_RE.test(enforcement.projectionIdentity)) return false;
  if (typeof enforcement.evidenceFingerprint !== 'string' || !DIGEST_RE.test(enforcement.evidenceFingerprint)) return false;
  // Genuine evidence: the fingerprint must recompute from the complete
  // canonical record (WP-5B F-R2 convention).
  const { evidenceFingerprint: _declared, ...without } = enforcement;
  try {
    if (computeEvidenceFingerprint(without) !== enforcement.evidenceFingerprint) return false;
  } catch {
    return false;
  }
  // Exact attempt correlation required by WP-5B: the canonical plan identity
  // over occurrence + attempt + bundle instance.
  const bundle = attempt['bundle'] as Readonly<Record<string, unknown>>;
  try {
    const planIdentity = computePlanIdentity({
      occurrenceId: String(attempt['occurrence_id']),
      attemptId: String(attempt['attempt_id']),
      bundleReference: { target_instance_id: String(bundle['target_instance_id']) },
    } as never);
    return enforcement.inputPlanIdentity === planIdentity;
  } catch {
    return false;
  }
}

// ─── replay material comparison (ADR-039 §9; EXE-010) ───────────────────────

/**
 * Replay equivalence: every independently caller-verifiable material field
 * compared exactly; ONLY the operation-assigned values (record_id,
 * created_at, observation_evidence.evidence_id) are excluded. The existing
 * durable evidence id must keep valid `pgw:e:` syntax and is preserved
 * exactly — never minted again. The durable record must already have passed
 * the committed lifecycle schema gate (extra/unknown keys fail there).
 */
function replayEquivalence(
  durable: Readonly<Record<string, unknown>>,
  material: OutcomeMaterial,
): boolean {
  if (durable['record_type'] !== 'ExecutionOutcomeRecord') return false;
  if (durable['responsible_role'] !== 'trusted-execution-outcome-recorder') return false;
  if (jcsSerialize(durable['registry_snapshot_reference']) !== jcsSerialize(material.registryReference)) return false;
  if (durable['workspace_id'] !== material.workspaceId) return false;
  if (!bundleReferencesEqual(durable['bundle'], material.bundle)) return false;
  if (durable['occurrence_id'] !== material.occurrenceId) return false;
  if (durable['attempt_id'] !== material.attemptId) return false;
  if (durable['ordinal'] !== material.ordinal) return false;
  if (durable['execution_attempt_record_id'] !== material.attemptRecordId) return false;
  if (durable['disposition'] !== material.disposition) return false;
  // observation_evidence: exact except the evidence id (syntax-checked + preserved).
  const oe = durable['observation_evidence'];
  if (!isRecord(oe)) return false;
  if (oe['kind'] !== 'external-evidence') return false;
  if (typeof oe['evidence_id'] !== 'string' || !EVIDENCE_ID_RE.test(oe['evidence_id'] as string)) return false;
  if (oe['content_digest'] !== material.observationDigest) return false;
  if (oe['declared_media_type'] !== 'application/json') return false;
  if (oe['observation_role'] !== 'evaluation-evidence') return false;
  // enforcement group: presence must match + exact values.
  const de = durable['enforcement_evidence'];
  if (material.enforcement === undefined) {
    if (de !== undefined) return false;
  } else {
    if (!isRecord(de)) return false;
    if (de['projection_identity'] !== material.enforcement.projectionIdentity) return false;
    if (de['evidence_fingerprint'] !== material.enforcement.evidenceFingerprint) return false;
  }
  // result association: presence must match + exact quartet.
  const ra = durable['result_association'];
  if (material.association === undefined) {
    if (ra !== undefined) return false;
  } else {
    if (!isRecord(ra)) return false;
    if (ra['instance_id'] !== material.association.instanceId) return false;
    if (ra['revision_digest'] !== material.association.revisionDigest) return false;
    if (ra['association_mode'] !== material.association.mode) return false;
    if (ra['validation_record_id'] !== material.association.validationRecordId) return false;
  }
  return true;
}

// ─── under-lock state re-read ───────────────────────────────────────────────

interface UnderLockState {
  readonly attempt: Readonly<Record<string, unknown>>;
  readonly candidates: readonly Readonly<Record<string, unknown>>[];
}

/** Mandatory under-lock re-read: exact current attempt + every outcome candidate. */
function reReadUnderLock(input: OutcomeProductionInput, attempt: Readonly<Record<string, unknown>>): { readonly ok: true; readonly state: UnderLockState } | { readonly ok: false; readonly result: OutcomeProductionResult } {
  const attemptRead = input.records.readLifecyclePayload('execution-attempt-record', String(attempt['record_id']));
  if (!attemptRead.ok || attemptRead.payload === undefined) {
    return { ok: false, result: denied('OUTCOME-CONFLICT', 'state.attempt-unverifiable', 'the current durable attempt record could not be re-read under the lock') };
  }
  // Exact current attempt: the durable payload must equal the trusted input
  // (attempt records are immutable; divergence fails closed).
  if (jcsSerialize(attemptRead.payload) !== jcsSerialize(attempt)) {
    return { ok: false, result: denied('OUTCOME-CONFLICT', 'state.attempt-diverged', 'the current durable attempt record diverges from the trusted input') };
  }
  const enumerated = input.store.enumerateLifecycleRecords('execution-outcome-record');
  if (!enumerated.ok) {
    return { ok: false, result: denied('OUTCOME-CONFLICT', 'state.outcome-enumerate-failed', 'the outcome-record set could not be enumerated under the lock') };
  }
  const candidates: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = input.store.readLifecyclePayload('execution-outcome-record', recordId);
    if (!read.ok || read.payload === undefined) {
      return { ok: false, result: denied('OUTCOME-CONFLICT', 'state.outcome-unreadable', 'an existing outcome record could not be re-read under the lock') };
    }
    const payload = read.payload;
    if (!isRecord(payload) || payload['record_type'] !== 'ExecutionOutcomeRecord') {
      return { ok: false, result: denied('OUTCOME-CONFLICT', 'state.outcome-corrupt', 'an existing outcome record is malformed') };
    }
    // Exact attempt binding (the shared uniqueness subject; NEVER result material).
    if (
      payload['workspace_id'] === attempt['workspace_id'] &&
      payload['occurrence_id'] === attempt['occurrence_id'] &&
      payload['attempt_id'] === attempt['attempt_id'] &&
      bundleReferencesEqual(payload['bundle'], attempt['bundle'])
    ) {
      candidates.push(payload);
    }
  }
  return { ok: true, state: { attempt: attemptRead.payload, candidates: Object.freeze(candidates) } };
}

// ─── authority entry ────────────────────────────────────────────────────────

/**
 * Produce (or replay) exactly one ExecutionOutcomeRecord for the exact
 * attempt under the attempt-level coordination lock (Model-1). Returns the
 * durable outcome identity (published or idempotent material replay) or a
 * typed fail-closed failure. The lock is released completely before return.
 */
export function produceExecutionOutcome(input: OutcomeProductionInput): OutcomeProductionResult {
  // ─── 1. input hygiene (containers + boundary members) ─────────────────────
  if (!isRecord(input)) return inputInvalid('input.root-invalid', 'the outcome-production input is missing or malformed');
  for (const key of Object.keys(input)) {
    if (!OUTCOME_INPUT_KEYS.has(key)) return inputInvalid('input.unknown-key', 'the outcome-production input carries an unknown operand');
  }
  const attemptCheck = attemptShape(input['attempt']);
  if (!attemptCheck.ok) return inputInvalid('input.attempt-invalid', 'the durable attempt record is missing or malformed');
  const attempt = attemptCheck.attempt;
  const outcomeCheck = outcomeShape(input['outcome']);
  if (!outcomeCheck.ok) return inputInvalid('input.outcome-invalid', 'the verified terminal outcome is missing or malformed');

  const observation = input['observation'];
  if (!isPiExecutionObservation(observation)) return inputInvalid('input.observation-not-genuine', 'the execution observation is not a genuine branded Pi execution observation');
  if (observation.occurrenceId !== attempt['occurrence_id']) return inputInvalid('input.observation-correlation', 'the observation occurrence does not exactly match the attempt record');
  if (observation.attemptId !== attempt['attempt_id']) return inputInvalid('input.observation-correlation', 'the observation attempt does not exactly match the attempt record');
  if (!bundleReferencesEqual(observation.bundleReference, attempt['bundle'])) return inputInvalid('input.observation-correlation', 'the observation bundle reference does not exactly match the attempt record');

  const digestCheck = canonicalObservationContentDigest(observation);
  if (!digestCheck.ok) return inputInvalid('input.observation-canonicalization', 'the observation material is not canonical under the committed JCS/NFC discipline');

  const enforcement = input['enforcement'];
  if (enforcement !== undefined) {
    if (!isRecord(enforcement) || !enforcementCorrelated(enforcement as PiEnforcementEvidence, attempt)) {
      return inputInvalid('input.enforcement-correlation', 'the enforcement evidence is not exactly correlated per the committed WP-5B discipline');
    }
  }

  let association: TrustedFacts['association'];
  const handoffRaw = input['handoff'];
  const validationRaw = input['validation'];
  if (handoffRaw !== undefined) {
    const handoffCheck = handoffShape(handoffRaw);
    if (!handoffCheck.ok) return inputInvalid('input.handoff-invalid', 'the validated-result handoff is missing or malformed');
    const h = handoffCheck.handoff;
    if (h['workspaceId'] !== attempt['workspace_id']) return inputInvalid('input.handoff-correlation', 'the handoff workspace does not exactly match the attempt record');
    if (h['occurrenceId'] !== attempt['occurrence_id']) return inputInvalid('input.handoff-correlation', 'the handoff occurrence does not exactly match the attempt record');
    if (h['attemptId'] !== attempt['attempt_id']) return inputInvalid('input.handoff-correlation', 'the handoff attempt does not exactly match the attempt record');
    if (h['ordinal'] !== attempt['ordinal']) return inputInvalid('input.handoff-correlation', 'the handoff ordinal does not exactly match the attempt record');
    if (!bundleReferencesEqual(h['bundleReference'], attempt['bundle'])) return inputInvalid('input.handoff-correlation', 'the handoff bundle reference does not exactly match the attempt record');
    if (validationRaw === undefined) return inputInvalid('input.validation-missing', 'a validated-result handoff requires the exact durable passing ValidationRecord');
    const validationCheck = validationShape(validationRaw);
    if (!validationCheck.ok) return inputInvalid('input.validation-invalid', 'the ValidationRecord is missing or malformed');
    const v = validationCheck.validation;
    if (v['record_id'] !== h['validationRecordId']) return inputInvalid('input.validation-mismatch', 'the ValidationRecord identity does not exactly match the handoff reference');
    if (v['subject'] === undefined) return inputInvalid('input.validation-mismatch', 'the ValidationRecord subject is missing');
    const subject = (v['subject'] as Readonly<Record<string, unknown>>);
    if (subject['instance_id'] !== h['resultInstanceId']) return inputInvalid('input.validation-mismatch', 'the ValidationRecord subject instance does not exactly match the handoff');
    if (subject['revision_id'] !== h['resultRevisionId']) return inputInvalid('input.validation-mismatch', 'the ValidationRecord subject revision does not exactly match the handoff');
    if (subject['digest'] !== h['resultDigest']) return inputInvalid('input.validation-mismatch', 'the ValidationRecord subject digest does not exactly match the handoff');
    if (subject['workspace_id'] !== attempt['workspace_id']) return inputInvalid('input.validation-mismatch', 'the ValidationRecord subject workspace does not exactly match the attempt record');
    association = Object.freeze({
      instanceId: h['resultInstanceId'] as string,
      revisionDigest: h['resultDigest'] as string,
      mode: h['associationMode'] as string,
      validationRecordId: h['validationRecordId'] as string,
    });
  } else if (validationRaw !== undefined) {
    return inputInvalid('input.handoff-missing', 'a ValidationRecord requires the validated-result handoff');
  }

  const registryCheck = registryShape(input['registry']);
  if (!registryCheck.ok) return inputInvalid('input.registry-invalid', 'the registry context is missing or malformed');
  const registry = registryCheck.registry;

  const store = input['store'];
  if (
    !isRecord(store) ||
    typeof store['publishExactOutcomeRecord'] !== 'function' ||
    typeof store['readLifecyclePayload'] !== 'function' ||
    typeof store['enumerateLifecycleRecords'] !== 'function'
  ) {
    return inputInvalid('input.store-invalid', 'the outcome store boundary is missing or not a function');
  }
  const records = input['records'];
  if (!isRecord(records) || typeof records['readLifecyclePayload'] !== 'function' || typeof records['enumerateLifecycleRecords'] !== 'function') {
    return inputInvalid('input.records-invalid', 'the lifecycle read boundary is missing or not a function');
  }
  const coordinate = input['coordinate'];
  if (!isRecord(coordinate) || typeof coordinate['withLock'] !== 'function') return inputInvalid('input.coordinate-invalid', 'the decision coordinator is missing or not a function');
  const identity = input['identity'];
  if (
    !isRecord(identity) ||
    typeof identity['nowUtcIso'] !== 'function' ||
    typeof identity['newRecordId'] !== 'function' ||
    typeof identity['newEvidenceId'] !== 'function'
  ) {
    return inputInvalid('input.identity-invalid', 'the outcome identity source is missing or not a function');
  }
  const schemaRegistry = input['schemaRegistry'];
  if (!isRecord(schemaRegistry) || typeof schemaRegistry['validate'] !== 'function') return inputInvalid('input.schema-registry-invalid', 'the schema registry is missing or malformed');
  const capability = input['capability'];
  if (!isGenuineExecutionOutcomeCapability(capability)) return denied('OUTCOME-CAPABILITY-DENIED', 'capability.not-genuine', 'the outcome-recorder capability is not genuine');
  const capabilityCheck = (capability as ExecutionOutcomeCapability).verify();
  if (!capabilityCheck.ok) return denied('OUTCOME-CAPABILITY-DENIED', `capability.${capabilityCheck.reason}`, 'the outcome-recorder capability is not usable');

  // ─── 2. material + exact attempt coordination key (shared with WP-13C) ────
  const material = materialOf(
    {
      attempt,
      disposition: outcomeCheck.disposition,
      observationDigest: digestCheck.digest,
      ...(enforcement !== undefined ? { enforcement: Object.freeze({ projectionIdentity: (enforcement as PiEnforcementEvidence).projectionIdentity, evidenceFingerprint: (enforcement as PiEnforcementEvidence).evidenceFingerprint }) } : {}),
      ...(association !== undefined ? { association } : {}),
    },
    registry,
  );
  const bundle = attempt['bundle'] as Readonly<Record<string, unknown>>;
  const key = attemptCoordinationKey({
    workspaceId: String(attempt['workspace_id']),
    bundleInstanceId: String(bundle['target_instance_id']),
    bundleRevisionId: String(bundle['target_revision_id']),
    bundleDigest: String(bundle['target_digest']),
    occurrenceId: String(attempt['occurrence_id']),
    attemptId: String(attempt['attempt_id']),
  });

  // ─── 3. Model-1 lock: re-read → decide → publish → release ───────────────
  let result: OutcomeProductionResult;
  try {
    result = coordinate.withLock(key, () => {
      const stateCheck = reReadUnderLock(input, attempt);
      if (!stateCheck.ok) return stateCheck.result;
      const candidates = stateCheck.state.candidates;

      // ─── cardinality decision (no newest-wins / ordering selection) ───────
      if (candidates.length > 1) {
        return denied('OUTCOME-CONFLICT', 'conflict.multiple-outcomes', 'more than one durable outcome record exists for the exact attempt');
      }
      if (candidates.length === 1) {
        // ─── material replay verification ────────────────────────────────────
        const durable = candidates[0]!;
        const gate = validateLifecycleRecord(durable, schemaRegistry as unknown as SchemaRegistry);
        if (gate.ok !== true || gate.value === undefined) {
          return denied('OUTCOME-CONFLICT', 'state.outcome-corrupt', 'the existing outcome record is not schema-valid');
        }
        if (!replayEquivalence(durable, material)) {
          return denied('OUTCOME-CONFLICT', 'conflict.material-divergence', 'the existing outcome record diverges from the trusted retrospective-complete material');
        }
        // Exact replay: return the existing durable record/id; the existing
        // evidence id is preserved exactly. NO allocation, NO timestamp, NO
        // permit, NO write (S2/WP-8 writers are never called).
        const evidenceId = isRecord(durable['observation_evidence']) ? String(durable['observation_evidence']['evidence_id']) : '';
        return {
          ok: true,
          outcome: 'replayed',
          recordId: String(durable['record_id']),
          recordDigest: computePayloadDigest(durable),
          evidenceId,
        } as OutcomeProductionResult;
      }

      // ─── no-existing branch (ONLY after zero candidates is proven) ────────
      try {
        input.hooks?.beforeFirstOutcomePublication?.();
      } catch {
        return internalFailure('internal.hook-failure', 'the outcome-production hook raised an unexpected exception');
      }
      return publishNewOutcome({ material, registry, store, capability, schemaRegistry, identity });
    });
  } catch (err) {
    if (err instanceof LockContentionError) {
      return denied('OUTCOME-LOCK-CONFLICT', 'lock.conflict', 'another outcome decision holds the attempt-level lock');
    }
    return internalFailure('lock.unexpected-exception', 'the attempt-level lock raised an unexpected exception');
  }
  return result;
}
