/**
 * WP-13C — trusted result publication authority (ADR-038).
 *
 * Deterministic, fail-closed flow:
 *
 *   validated handoff + trusted request
 *   → input hygiene + handoff re-correlation (safeCall → exact shape → use)
 *   → evaluator-provenance correlation (exact; never mapped)
 *   → genuine capability gate (CAP-008…016)
 *   → attempt-level coordination lock (workspace|bundle|occurrence|attempt;
 *     result_instance NEVER participates in the key; SCR-WP13-006)
 *   → mandatory under-lock re-read (publication/result-association state for
 *     the ENTIRE exact attempt regardless of result instance; exact passing
 *     ValidationRecord; current lifecycle chain + grant currentness;
 *     registry context)
 *   → atomic decision under the lock:
 *       no association        → construct/validate exactly one
 *                               ResultPublicationRecord (opaque record id),
 *                               permit-mint, WP-8 publishRecord under the lock
 *       exact existing        → idempotent replay (existing durable id, no write)
 *       different instance    → typed conflict, no write
 *       same instance, divergence → typed conflict, no write
 *
 * WP-13C performs NO receipt production, NO privileged scopes (WP-15-owned),
 * NO lifecycle authority beyond the one record class, NO WP-13D
 * retrospective-facts work, and NO pi-guard interaction. The handoff is
 * consumed exactly; missing/malformed/mismatched handoff facts fail closed.
 */
import { validateLifecycleRecord } from '../api/validate.js';
import { registryReferenceFor } from '../control-plane/records.js';
import { LockContentionError } from '../control-plane/coordination.js';
import { resultRelativePath } from '../completion/writer.js';
import { computePayloadDigest } from '../storage/format/envelope.js';
import { jcsSerialize } from '../canonical/jcs.js';
import { isGenuineResultPublicationCapability, createResultPublicationPermit, type ResultPublicationCapability, type ResultPublicationPermit } from './capability.js';
import { RESULT_PUBLICATION_RECORD_CLASS, RESULT_PUBLICATION_SCOPE, type PublicationFailureCategory, type PublicationInput, type PublicationResult } from './types.js';
import type { ValidatedResultHandoff } from '../completion/types.js';
import type { AcceptedRegistryContext } from '../api/types.js';
import type { SchemaRegistry } from '../schema/registry.js';

const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
const ATTEMPT_ID_RE = /^pgw:a:[0-9a-f]{32}$/;
const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;
const EVALUATOR_ID_RE = /^pgw:ev:[0-9a-f]{32}$/;
const CAPABILITY_PROFILE_ID_RE = /^pgw:cp:[0-9a-f]{32}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ASSOCIATION_MODES = ['originated', 'adopted'] as const;
const WRITE_OUTCOMES = ['created', 'already-exact'] as const;
const BUNDLE_KIND = 'ExecutionBundle';

/** Exact own-key set of the publication input (unknown keys — incl. any scope/receipt operand — fail closed). */
const PUBLICATION_INPUT_KEYS: ReadonlySet<string> = new Set([
  'handoff',
  'evaluatorProvenance',
  'registry',
  'store',
  'coordinate',
  'identity',
  'schemaRegistry',
  'capability',
  'hooks',
]);

/** Keys excluded from material-exactness comparison (record identity/time). */
const MATERIAL_EXACT_IGNORED_KEYS: ReadonlySet<string> = new Set(['record_id', 'created_at']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type SafeCall<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function safeCall<T>(fn: () => T): SafeCall<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

function failure(category: PublicationFailureCategory, code: string, message: string): PublicationResult {
  return { ok: false, category, code, message };
}

function inputInvalid(code: string, message: string): PublicationResult {
  return failure('PUBLICATION-INPUT-INVALID', code, message);
}

function internalFailure(code: string, message: string): PublicationResult {
  return failure('PUBLICATION-INTERNAL-FAILURE', code, message);
}

// ─── shape validation ───────────────────────────────────────────────────────

/** Re-correlate the exact WP-13B handoff (internal consistency; never reconstructed). */
function handoffShape(input: unknown): { readonly ok: true; readonly handoff: ValidatedResultHandoff } | { readonly ok: false; readonly code: string } {
  if (!isRecord(input)) return { ok: false, code: 'input.handoff-invalid' };
  const h = input as Readonly<Record<string, unknown>>;
  const workspaceId = h['workspaceId'];
  const occurrenceId = h['occurrenceId'];
  const attemptId = h['attemptId'];
  const ordinal = h['ordinal'];
  const disposition = h['disposition'];
  const associationMode = h['associationMode'];
  const resultInstanceId = h['resultInstanceId'];
  const resultRevisionId = h['resultRevisionId'];
  const resultDigest = h['resultDigest'];
  const validationRecordId = h['validationRecordId'];
  const evaluatorId = h['evaluatorId'];
  const capabilityProfileId = h['capabilityProfileId'];
  const artifactRelativePath = h['artifactRelativePath'];
  const writeOutcome = h['writeOutcome'];
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_RE.test(workspaceId)) return { ok: false, code: 'input.workspace-invalid' };
  if (typeof occurrenceId !== 'string' || !OCCURRENCE_ID_RE.test(occurrenceId)) return { ok: false, code: 'input.occurrence-invalid' };
  if (typeof attemptId !== 'string' || !ATTEMPT_ID_RE.test(attemptId)) return { ok: false, code: 'input.attempt-invalid' };
  if (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 1) return { ok: false, code: 'input.ordinal-invalid' };
  if (disposition !== 'completed') return { ok: false, code: 'input.disposition-invalid' };
  if (typeof associationMode !== 'string' || !(ASSOCIATION_MODES as readonly string[]).includes(associationMode)) return { ok: false, code: 'input.association-mode-invalid' };
  if (typeof resultInstanceId !== 'string' || !INSTANCE_ID_RE.test(resultInstanceId)) return { ok: false, code: 'input.result-instance-invalid' };
  if (typeof resultRevisionId !== 'string' || !REVISION_ID_RE.test(resultRevisionId)) return { ok: false, code: 'input.result-revision-invalid' };
  if (typeof resultDigest !== 'string' || !DIGEST_RE.test(resultDigest)) return { ok: false, code: 'input.result-digest-invalid' };
  if (typeof validationRecordId !== 'string' || !RECORD_ID_RE.test(validationRecordId)) return { ok: false, code: 'input.validation-record-invalid' };
  if (typeof evaluatorId !== 'string' || evaluatorId.length === 0) return { ok: false, code: 'input.evaluator-id-invalid' };
  if (typeof capabilityProfileId !== 'string' || capabilityProfileId.length === 0) return { ok: false, code: 'input.capability-profile-invalid' };
  if (typeof artifactRelativePath !== 'string' || artifactRelativePath.length === 0 || artifactRelativePath.startsWith('/')) return { ok: false, code: 'input.path-invalid' };
  if (typeof writeOutcome !== 'string' || !(WRITE_OUTCOMES as readonly string[]).includes(writeOutcome)) return { ok: false, code: 'input.write-outcome-invalid' };
  const bundle = h['bundleReference'];
  if (!isRecord(bundle)) return { ok: false, code: 'input.bundle-invalid' };
  if (bundle['target_protocol_version'] !== '1.0') return { ok: false, code: 'input.bundle-protocol-invalid' };
  const targetKind = bundle['target_kind'];
  if (!isRecord(targetKind) || targetKind['id'] !== BUNDLE_KIND || targetKind['version'] !== '1.0') return { ok: false, code: 'input.bundle-kind-invalid' };
  if (typeof bundle['target_instance_id'] !== 'string' || !INSTANCE_ID_RE.test(bundle['target_instance_id'] as string)) return { ok: false, code: 'input.bundle-instance-invalid' };
  if (typeof bundle['target_revision_id'] !== 'string' || !REVISION_ID_RE.test(bundle['target_revision_id'] as string)) return { ok: false, code: 'input.bundle-revision-invalid' };
  if (typeof bundle['target_digest'] !== 'string' || !DIGEST_RE.test(bundle['target_digest'] as string)) return { ok: false, code: 'input.bundle-digest-invalid' };
  const binding = bundle['target_workspace_binding'];
  if (!isRecord(binding) || binding['mode'] !== 'bound' || binding['workspace_id'] !== workspaceId) return { ok: false, code: 'input.bundle-workspace-mismatch' };
  // The deterministic per-attempt destination is re-derived (binding is by
  // digest, never by path — the path itself is still re-correlated exactly).
  const expectedPath = resultRelativePath(occurrenceId, attemptId);
  if (artifactRelativePath !== expectedPath) return { ok: false, code: 'input.path-mismatch' };
  const evidenceReferences = h['evidenceReferences'];
  if (!Array.isArray(evidenceReferences)) return { ok: false, code: 'input.evidence-invalid' };
  return { ok: true, handoff: input as unknown as ValidatedResultHandoff };
}

/** Shape-validate the host-supplied registry context. */
function registryShape(value: unknown): { readonly ok: true; readonly registry: AcceptedRegistryContext } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const registry = value as Readonly<Record<string, unknown>>;
  if (typeof registry['registryProtocolId'] !== 'string' || registry['registryProtocolId'].length === 0) return { ok: false };
  if (typeof registry['registrySnapshotFormatVersion'] !== 'string' || registry['registrySnapshotFormatVersion'] !== '1.0') return { ok: false };
  if (typeof registry['registrySnapshotId'] !== 'string' || !/^pgw:g:[0-9a-f]{32}$/.test(registry['registrySnapshotId'] as string)) return { ok: false };
  if (typeof registry['registrySnapshotDigest'] !== 'string' || !DIGEST_RE.test(registry['registrySnapshotDigest'] as string)) return { ok: false };
  return { ok: true, registry: value as unknown as AcceptedRegistryContext };
}

/** Attempt-level coordination key: workspace|bundle|occurrence|attempt (SCR-WP13-006). */
function attemptLockKey(handoff: ValidatedResultHandoff): string {
  const bundle = handoff.bundleReference as Readonly<Record<string, unknown>>;
  return [
    handoff.workspaceId,
    bundle['target_instance_id'],
    bundle['target_revision_id'],
    bundle['target_digest'],
    handoff.occurrenceId,
    handoff.attemptId,
  ].join('|');
}

/** Exact-artifact-reference equality for the bundle binding. */
function bundleMatches(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const aBinding = a['target_workspace_binding'];
  const bBinding = b['target_workspace_binding'];
  if (!isRecord(aBinding) || !isRecord(bBinding)) return false;
  return (
    a['target_instance_id'] === b['target_instance_id'] &&
    a['target_revision_id'] === b['target_revision_id'] &&
    a['target_digest'] === b['target_digest'] &&
    aBinding['workspace_id'] === bBinding['workspace_id']
  );
}

/** Attempt-scoped association test (workspace + bundle + occurrence + attempt; NEVER result instance). */
function isAttemptAssociation(payload: Readonly<Record<string, unknown>>, handoff: ValidatedResultHandoff): boolean {
  if (payload['record_type'] !== 'ResultPublicationRecord') return false;
  if (payload['workspace_id'] !== handoff.workspaceId) return false;
  if (payload['occurrence_id'] !== handoff.occurrenceId) return false;
  if (payload['attempt_id'] !== handoff.attemptId) return false;
  const bundle = payload['bundle'];
  return isRecord(bundle) && bundleMatches(bundle, handoff.bundleReference as Readonly<Record<string, unknown>>);
}

/**
 * Material exactness between a proposed publication payload and a durable
 * one: identical decision material (everything except record_id/created_at —
 * including result subject, provenance, validation id, bindings, scopes,
 * receipts, and registry context), compared in committed canonical form
 * (JCS; durable payloads are canonical-order, proposed payloads are
 * insertion-order). SCR-WP13-003.
 */
function materiallyExact(proposed: Readonly<Record<string, unknown>>, durable: Readonly<Record<string, unknown>>): boolean {
  for (const key of new Set([...Object.keys(proposed), ...Object.keys(durable)])) {
    if (MATERIAL_EXACT_IGNORED_KEYS.has(key)) continue;
    if (jcsSerialize(proposed[key]) !== jcsSerialize(durable[key])) return false;
  }
  return true;
}

// ─── under-lock state re-read ───────────────────────────────────────────────

interface UnderLockState {
  readonly associations: readonly Readonly<Record<string, unknown>>[];
}

/** Mandatory under-lock re-read (§3.3/§5): attempt-scoped lookup + validation + lifecycle chain. */
function reReadUnderLock(
  input: PublicationInput,
  handoff: ValidatedResultHandoff,
  now: string,
): { readonly ok: true; readonly state: UnderLockState } | { readonly ok: false; readonly category: PublicationFailureCategory; readonly code: string } {
  // 1. Attempt-scoped publication/result-association lookup (ENTIRE exact
  //    attempt; discovers ANY association regardless of result instance).
  const enumerated = input.store.enumerateLifecycleRecords(RESULT_PUBLICATION_RECORD_CLASS);
  if (!enumerated.ok) return { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.publication-enumerate-failed' };
  const associations: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = input.store.readLifecyclePayload(RESULT_PUBLICATION_RECORD_CLASS, recordId);
    if (!read.ok || read.payload === undefined) return { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.publication-read-failed' };
    if (isAttemptAssociation(read.payload, handoff)) associations.push(read.payload);
  }

  // 2. Exact passing ValidationRecord for the result subject.
  const validationRead = input.store.readLifecyclePayload('validation-record', handoff.validationRecordId);
  if (!validationRead.ok || validationRead.payload === undefined) {
    return validationRead.code === 'not-found'
      ? { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.validation-record-missing' }
      : { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.validation-read-failed' };
  }
  const validation = validationRead.payload;
  if (validation['record_type'] !== 'ValidationRecord') return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.validation-record-mismatch' };
  if (validation['structural_outcome'] !== 'pass' || validation['semantic_outcome'] !== 'pass') {
    return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.validation-record-not-passing' };
  }
  const subject = validation['subject'];
  if (!isRecord(subject)) return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.validation-record-mismatch' };
  const kind = subject['kind'];
  if (!isRecord(kind) || kind['id'] !== 'ExecutionResult' || kind['version'] !== '1.0') return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.validation-record-mismatch' };
  if (
    subject['protocol_version'] !== '1.0' ||
    subject['instance_id'] !== handoff.resultInstanceId ||
    subject['revision_id'] !== handoff.resultRevisionId ||
    subject['digest'] !== handoff.resultDigest ||
    subject['workspace_id'] !== handoff.workspaceId
  ) {
    return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.validation-record-mismatch' };
  }

  // 3. Current lifecycle chain: the exact attempt is durable; its
  //    occurrence/activation/grant chain is durable; the grant is not
  //    revoked and its validity window covers the current time.
  const attempts = enumerateAll(input.store, 'execution-attempt-record');
  if (!attempts.ok) return { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.attempt-enumerate-failed' };
  const attempt = attempts.payloads.find(
    (payload) =>
      payload['attempt_id'] === handoff.attemptId &&
      payload['occurrence_id'] === handoff.occurrenceId &&
      payload['workspace_id'] === handoff.workspaceId &&
      isRecord(payload['bundle']) && bundleMatches(payload['bundle'] as Readonly<Record<string, unknown>>, handoff.bundleReference as Readonly<Record<string, unknown>>),
  );
  if (attempt === undefined) return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.attempt-missing' };
  const activationRecordId = attempt['activation_record_id'];
  const runtimeGrantId = attempt['runtime_grant_id'];
  if (typeof activationRecordId !== 'string' || !RECORD_ID_RE.test(activationRecordId)) return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.attempt-mismatch' };
  if (typeof runtimeGrantId !== 'string' || !RECORD_ID_RE.test(runtimeGrantId)) return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.attempt-mismatch' };

  const activationRead = input.store.readLifecyclePayload('activation-record', activationRecordId);
  if (!activationRead.ok || activationRead.payload === undefined) {
    return activationRead.code === 'not-found'
      ? { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.activation-missing' }
      : { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.activation-read-failed' };
  }
  const activation = activationRead.payload;
  if (activation['record_type'] !== 'ActivationRecord' || activation['workspace_id'] !== handoff.workspaceId) {
    return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.activation-mismatch' };
  }
  if (activation['decision'] !== 'accepted') return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.activation-denied' };

  const occurrences = enumerateAll(input.store, 'execution-occurrence-record');
  if (!occurrences.ok) return { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.occurrence-enumerate-failed' };
  const occurrence = occurrences.payloads.find(
    (payload) =>
      payload['occurrence_id'] === handoff.occurrenceId &&
      payload['workspace_id'] === handoff.workspaceId &&
      payload['activation_record_id'] === activationRecordId &&
      isRecord(payload['bundle']) && bundleMatches(payload['bundle'] as Readonly<Record<string, unknown>>, handoff.bundleReference as Readonly<Record<string, unknown>>),
  );
  if (occurrence === undefined) return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.occurrence-missing' };

  const grantRead = input.store.readLifecyclePayload('runtime-grant', runtimeGrantId);
  if (!grantRead.ok || grantRead.payload === undefined) {
    return grantRead.code === 'not-found'
      ? { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.grant-missing' }
      : { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.grant-read-failed' };
  }
  const grant = grantRead.payload;
  if (grant['record_type'] !== 'RuntimeGrant' || grant['workspace_id'] !== handoff.workspaceId) {
    return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.grant-mismatch' };
  }
  const revocations = enumerateAll(input.store, 'revocation-record');
  if (!revocations.ok) return { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.revocation-enumerate-failed' };
  for (const revocation of revocations.payloads) {
    const target = revocation['target'];
    if (revocation['record_type'] === 'RevocationRecord' && isRecord(target) && target['record_id'] === runtimeGrantId) {
      return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.grant-revoked' };
    }
  }
  const validity = grant['validity'];
  if (!isRecord(validity) || typeof validity['not_before'] !== 'string' || typeof validity['not_after'] !== 'string') {
    return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.grant-mismatch' };
  }
  if (validity['not_before'] > now || validity['not_after'] < now) {
    return { ok: false, category: 'PUBLICATION-LIFECYCLE-REJECTED', code: 'lifecycle.grant-expired' };
  }

  return { ok: true, state: { associations: Object.freeze(associations) } };
}

function enumerateAll(
  store: PublicationInput['store'],
  recordClass: 'execution-attempt-record' | 'execution-occurrence-record' | 'revocation-record',
): { readonly ok: true; readonly payloads: readonly Readonly<Record<string, unknown>>[] } | { readonly ok: false } {
  const enumerated = store.enumerateLifecycleRecords(recordClass);
  if (!enumerated.ok) return { ok: false };
  const payloads: Readonly<Record<string, unknown>>[] = [];
  for (const recordId of enumerated.recordIds) {
    const read = store.readLifecyclePayload(recordClass, recordId);
    if (!read.ok || read.payload === undefined) return { ok: false };
    payloads.push(read.payload);
  }
  return { ok: true, payloads: Object.freeze(payloads) };
}

// ─── record construction ────────────────────────────────────────────────────

/** Construct the exactly-one ResultPublicationRecord payload (schema form). */
function buildPublicationPayload(input: PublicationInput, handoff: ValidatedResultHandoff, recordId: string, createdAt: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_type: 'ResultPublicationRecord',
    record_id: recordId,
    created_at: createdAt,
    responsible_role: 'trusted-result-publisher',
    registry_snapshot_reference: registryReferenceFor(input.registry),
    result_subject: Object.freeze({
      protocol_version: '1.0',
      kind: Object.freeze({ id: 'ExecutionResult', version: '1.0' }),
      instance_id: handoff.resultInstanceId,
      revision_id: handoff.resultRevisionId,
      digest: handoff.resultDigest,
      workspace_id: handoff.workspaceId,
    }),
    evaluator_provenance: Object.freeze({
      evaluator_id: input.evaluatorProvenance.evaluator_id,
      capability_profile_id: input.evaluatorProvenance.capability_profile_id,
    }),
    association_mode: handoff.associationMode,
    validation_record_id: handoff.validationRecordId,
    bundle: Object.freeze({ ...handoff.bundleReference }),
    workspace_id: handoff.workspaceId,
    occurrence_id: handoff.occurrenceId,
    attempt_id: handoff.attemptId,
    publication_scopes: Object.freeze([RESULT_PUBLICATION_SCOPE]),
    receipt_correlations: Object.freeze([]),
  });
}

/** Publish one record under the lock through the permit-gated boundary. */
function publishUnderLock(
  input: PublicationInput,
  payload: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly recordId: string; readonly recordDigest: string } | { readonly ok: false; readonly category: PublicationFailureCategory; readonly code: string } {
  const payloadDigest = computePayloadDigest(payload);
  const permitCheck = safeCall(() =>
    createResultPublicationPermit({
      capability: input.capability,
      role: 'result-publication',
      recordId: String(payload['record_id']),
      recordDigest: payloadDigest,
      canonicalBytesDigest: payloadDigest,
    }),
  );
  if (!permitCheck.ok || permitCheck.value === undefined) {
    return { ok: false, category: 'PUBLICATION-INTERNAL-FAILURE', code: 'internal.permit-denied' };
  }
  const permit = permitCheck.value as ResultPublicationPermit;
  const publishCall = safeCall(() => input.store.publishResultPublicationRecord(permit, payload));
  if (!publishCall.ok) return { ok: false, category: 'PUBLICATION-INTERNAL-FAILURE', code: 'internal.publish-exception' };
  if (!isRecord(publishCall.value)) return { ok: false, category: 'PUBLICATION-INTERNAL-FAILURE', code: 'internal.publish-malformed' };
  const result = publishCall.value as Readonly<Record<string, unknown>>;
  if (result['ok'] !== true || result['outcome'] === undefined) {
    // A typed WP-8 failure is a write failure under the held lock.
    return { ok: false, category: 'PUBLICATION-WRITE-FAILED', code: 'write.publish-failed' };
  }
  const outcome = result['outcome'];
  if (outcome === 'published') {
    if (typeof result['recordId'] !== 'string' || (result['recordId'] as string).length === 0) {
      return { ok: false, category: 'PUBLICATION-INTERNAL-FAILURE', code: 'internal.publish-incomplete' };
    }
    return { ok: true, recordId: result['recordId'] as string, recordDigest: typeof result['recordDigest'] === 'string' ? (result['recordDigest'] as string) : '' };
  }
  if (outcome === 'idempotent-duplicate' || outcome === 'duplicate') {
    // WP-8 found an existing durable record for this identity: re-read it
    // under the SAME lock and compare material exactness.
    const reRead = input.store.readLifecyclePayload(RESULT_PUBLICATION_RECORD_CLASS, String(payload['record_id']));
    if (!reRead.ok || reRead.payload === undefined) return { ok: false, category: 'PUBLICATION-STATE-UNVERIFIABLE', code: 'state.publication-read-failed' };
    if (materiallyExact(payload, reRead.payload)) {
      return { ok: true, recordId: String(reRead.payload['record_id']), recordDigest: computePayloadDigest(reRead.payload) };
    }
    return { ok: false, category: 'PUBLICATION-CONFLICT', code: 'conflict.durable-record' };
  }
  if (outcome === 'conflict-revision') {
    return { ok: false, category: 'PUBLICATION-CONFLICT', code: 'conflict.durable-record' };
  }
  return { ok: false, category: 'PUBLICATION-WRITE-FAILED', code: 'write.publish-failed' };
}

// ─── authority entry ────────────────────────────────────────────────────────

/**
 * Publish one validated result under the attempt-level lock. Returns the
 * durable `ResultPublicationRecord` identity (published or idempotent
 * replay) or a typed fail-closed failure.
 */
export function publishValidatedResult(input: PublicationInput): PublicationResult {
  // ─── 1. input hygiene (containers + boundary members; SIR-WP13A-001 pattern) ─
  if (!isRecord(input)) return inputInvalid('input.root-invalid', 'publication input is missing or malformed');
  // Exact-key discipline: WP-13 scopes and receipt correlation are NEVER
  // caller operands (§3.6) — any unknown key (including any scope/receipt
  // material) is rejected, never ignored.
  for (const key of Object.keys(input)) {
    if (!PUBLICATION_INPUT_KEYS.has(key)) return inputInvalid('input.unknown-key', 'the publication input carries an unknown operand');
  }
  const handoffCheck = safeCall(() => handoffShape(input['handoff']));
  if (!handoffCheck.ok) return inputInvalid('input.handoff-invalid', 'the validated-result handoff is missing or malformed');
  if (!handoffCheck.value.ok) return inputInvalid(handoffCheck.value.code, 'the validated-result handoff is missing or malformed');
  const handoff = handoffCheck.value.handoff;

  const provenance = input['evaluatorProvenance'];
  if (
    !isRecord(provenance) ||
    typeof provenance['evaluator_id'] !== 'string' ||
    !EVALUATOR_ID_RE.test(provenance['evaluator_id'] as string) ||
    typeof provenance['capability_profile_id'] !== 'string' ||
    !CAPABILITY_PROFILE_ID_RE.test(provenance['capability_profile_id'] as string)
  ) {
    return inputInvalid('input.evaluator-provenance-invalid', 'the evaluator provenance is missing or malformed');
  }
  // Re-correlation: the record-bound provenance must EXACTLY equal the
  // handoff's declared evaluator provenance (never mapped, never derived).
  if (provenance['evaluator_id'] !== handoff.evaluatorId || provenance['capability_profile_id'] !== handoff.capabilityProfileId) {
    return inputInvalid('input.evaluator-provenance-mismatch', 'the evaluator provenance does not exactly match the handoff declaration');
  }

  const registryCheck = safeCall(() => registryShape(input['registry']));
  if (!registryCheck.ok || !registryCheck.value.ok) return inputInvalid('input.registry-invalid', 'the registry context is missing or malformed');

  const store = input['store'];
  if (
    !isRecord(store) ||
    typeof store['publishResultPublicationRecord'] !== 'function' ||
    typeof store['readLifecyclePayload'] !== 'function' ||
    typeof store['enumerateLifecycleRecords'] !== 'function'
  ) {
    return inputInvalid('input.store-invalid', 'the publication store boundary is missing or not a function');
  }
  const coordinate = input['coordinate'];
  if (!isRecord(coordinate) || typeof coordinate['withLock'] !== 'function') return inputInvalid('input.coordinate-invalid', 'the decision coordinator is missing or not a function');
  const identity = input['identity'];
  if (!isRecord(identity) || typeof identity['nowUtcIso'] !== 'function' || typeof identity['newRecordId'] !== 'function') {
    return inputInvalid('input.identity-invalid', 'the publication identity source is missing or not a function');
  }
  const schemaRegistry = input['schemaRegistry'];
  if (!isRecord(schemaRegistry) || typeof schemaRegistry['validate'] !== 'function') return inputInvalid('input.schema-registry-invalid', 'the schema registry is missing or malformed');
  const capability = input['capability'];
  if (!isGenuineResultPublicationCapability(capability)) return failure('PUBLICATION-CAPABILITY-DENIED', 'capability.not-genuine', 'the result-publication capability is not genuine');
  const capabilityCheck = safeCall(() => (capability as ResultPublicationCapability).verify());
  if (!capabilityCheck.ok) return failure('PUBLICATION-CAPABILITY-DENIED', 'capability.not-genuine', 'the result-publication capability is not usable');
  if (!capabilityCheck.value.ok) {
    return failure('PUBLICATION-CAPABILITY-DENIED', `capability.${capabilityCheck.value.reason}`, 'the result-publication capability is not usable');
  }

  // ─── 2. attempt-level coordination lock (result_instance NEVER in the key) ─
  const key = attemptLockKey(handoff);
  let outcome: PublicationResult;
  try {
    outcome = coordinate.withLock(key, () => {
      // ─── 3. mandatory under-lock re-read (§3.3/§5) ─────────────────────────
      const nowCall = safeCall(() => identity['nowUtcIso']());
      if (!nowCall.ok || typeof nowCall.value !== 'string' || !TIMESTAMP_RE.test(nowCall.value)) {
        return internalFailure('identity.time-invalid', 'the publication identity source returned a malformed timestamp');
      }
      const now = nowCall.value;
      const stateCheck = safeCall(() => reReadUnderLock(input, handoff, now));
      if (!stateCheck.ok) return internalFailure('state.re-read-exception', 'the under-lock state re-read raised an unexpected exception');
      if (!stateCheck.value.ok) return failure(stateCheck.value.category, stateCheck.value.code, 'the under-lock trusted-state re-read rejected the publication');

      // ─── 4. atomic decision under the lock (§6) ────────────────────────────
      const associations = stateCheck.value.state.associations;
      const proposed = buildPublicationPayload(input, handoff, '', '');
      if (associations.length > 0) {
        const exact = associations.filter((payload) => materiallyExact(proposed, payload));
        if (exact.length > 0) {
          // Exact existing publication: idempotent replay, NO second write.
          const durable = exact[0]!;
          return { ok: true, outcome: 'idempotent-replay', recordId: String(durable['record_id']), recordDigest: computePayloadDigest(durable) } as PublicationResult;
        }
        const instanceMatches = associations.some((payload) => {
          const subject = payload['result_subject'];
          return isRecord(subject) && subject['instance_id'] === handoff.resultInstanceId;
        });
        return instanceMatches
          ? failure('PUBLICATION-CONFLICT', 'conflict.material-divergence', 'an existing publication for the exact attempt binds the same result instance with divergent material')
          : failure('PUBLICATION-CONFLICT', 'conflict.result-instance', 'an existing publication for the exact attempt binds a different result instance');
      }

      try {
        input.hooks?.beforeFirstPublication?.();
      } catch {
        return internalFailure('internal.hook-failure', 'the publication hook raised an unexpected exception');
      }

      // ─── 5. first publication: construct/validate exactly one record ──────
      const recordIdCall = safeCall(() => identity['newRecordId']());
      if (!recordIdCall.ok || typeof recordIdCall.value !== 'string' || !RECORD_ID_RE.test(recordIdCall.value)) {
        return internalFailure('identity.record-id-invalid', 'the publication identity source returned a malformed record identity');
      }
      const payload = buildPublicationPayload(input, handoff, recordIdCall.value, now);
      const gate = safeCall(() => validateLifecycleRecord(payload, schemaRegistry as unknown as SchemaRegistry));
      if (!gate.ok || gate.value.ok !== true) {
        return internalFailure('internal.schema-gate-rejected', 'the constructed publication record failed lifecycle schema validation');
      }
      const published = publishUnderLock(input, payload);
      if (!published.ok) return failure(published.category, published.code, 'the publication write failed or conflicted under the held lock');
      return { ok: true, outcome: 'published', recordId: published.recordId, recordDigest: published.recordDigest } as PublicationResult;
    });
  } catch (err) {
    if (err instanceof LockContentionError) return failure('PUBLICATION-LOCK-CONFLICT', 'lock.conflict', 'another publication decision holds the attempt-level lock');
    return internalFailure('lock.unexpected-exception', 'the attempt-level lock raised an unexpected exception');
  }
  return outcome;
}
