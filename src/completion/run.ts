/**
 * WP-13B — completion & result flow.
 *
 * Deterministic, fail-closed flow:
 *
 *   validated input → completion decision gate (§4.2; EXE-008/009) →
 *   exact attempt correlation → canonical ExecutionResult model + identity
 *   → (adoption: exact candidate equality) → WP-4 self-validation →
 *   narrow exclusive-create result write (adoption/recovery) → WP-12
 *   recordValidation (trusted producer) → bounded validated-result handoff
 *   for WP-13C.
 *
 * WP-13B performs NO publication (ADR-038 stays WP-13C), NO receipt
 * production, NO authority evaluation, NO pi-guard interaction, and NO
 * lifecycle-record production beyond the WP-12 `recordValidation` path.
 * An attempt may have no evaluator-produced result (EXE-008); a denied
 * attempt never gains a result association (EXE-009).
 */
import { jcsSerialize } from '../canonical/jcs.js';
import { isLevelAtLeast, parseRawJsonInput, validateArtifactSelf } from '../api/validate.js';
import { isPiExecutionObservation } from '../adapters/pi/index.js';
import { isExecutionAttemptOutcome } from '../execution/retry.js';
import type { PiExecutionObservation } from '../adapters/pi/types.js';
import type { ExecutionAttemptOutcome } from '../execution/types.js';
import type { ValidatedArtifact } from '../api/types.js';
import { completionDecision, completionFactsCorrelated } from './evaluator.js';
import { buildResultModel, enforcementEvidenceReference } from './result.js';
import { writeResultArtifact, resultRelativePath, type ResultWriteOutcome } from './writer.js';
import type {
  CompletionFailureCategory,
  CompletionInput,
  CompletionResult,
  ResultEvidenceReference,
  ResultIdentitySource,
  ValidatedResultHandoff,
} from './types.js';

/** Committed evaluator provenance constants (ADR-012 publication bindings). */
export const COMPLETION_EVALUATOR_ID = 'project-gateway.completion-evaluator.v1';
export const COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID = 'project-gateway.completion-evaluation.v1';

const WORKSPACE_ID_RE = /^pgw:w:[0-9a-f]{32}$/;
const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
const ATTEMPT_ID_RE = /^pgw:a:[0-9a-f]{32}$/;
const RECORD_ID_RE = /^pgw:l:[0-9a-f]{32}$/;
const INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
const REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;
const EVIDENCE_ID_RE = /^pgw:e:[0-9a-f]{32}$/;
const FINGERPRINT_RE = /^sha-256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(category: CompletionFailureCategory, code: string, message: string): CompletionResult {
  return { ok: false, category, code, message };
}

/**
 * Extract the adoption candidate's opaque identities + committed evidence
 * reference (SIR-WP13B-001): the candidate must carry exactly one
 * enforcement-evidence reference whose `content_digest` is the current
 * WP-5B fingerprint; its opaque `evidence_id` and the candidate's opaque
 * instance/revision ids are preserved verbatim. Shape/syntax failures and
 * fingerprint mismatches fail closed as `RESULT-CANDIDATE-INVALID`.
 */
function candidateIdentityMaterial(
  candidateModel: Readonly<Record<string, unknown>>,
  enforcementFingerprint: string,
): { readonly ok: true; readonly instanceId: string; readonly revisionId: string; readonly evidenceReferences: readonly ResultEvidenceReference[] } | { readonly ok: false } {
  const instanceId = candidateModel['instance_id'];
  if (typeof instanceId !== 'string' || !INSTANCE_ID_RE.test(instanceId)) return { ok: false };
  const revision = candidateModel['revision'];
  if (!isRecord(revision)) return { ok: false };
  const revisionId = revision['id'];
  if (typeof revisionId !== 'string' || !REVISION_ID_RE.test(revisionId)) return { ok: false };
  const body = candidateModel['body'];
  if (!isRecord(body)) return { ok: false };
  const refs = body['evidence_references'];
  if (!Array.isArray(refs) || refs.length !== 1) return { ok: false };
  const ref = refs[0];
  if (!isRecord(ref)) return { ok: false };
  if (ref['kind'] !== 'external-evidence') return { ok: false };
  const evidenceId = ref['evidence_id'];
  if (typeof evidenceId !== 'string' || !EVIDENCE_ID_RE.test(evidenceId)) return { ok: false };
  if (ref['content_digest'] !== enforcementFingerprint) return { ok: false };
  if (ref['declared_media_type'] !== 'application/json') return { ok: false };
  if (ref['observation_role'] !== 'evaluation-evidence') return { ok: false };
  return {
    ok: true,
    instanceId,
    revisionId,
    evidenceReferences: Object.freeze([
      Object.freeze({
        kind: 'external-evidence' as const,
        evidence_id: evidenceId,
        content_digest: enforcementFingerprint,
        declared_media_type: 'application/json',
        observation_role: 'evaluation-evidence' as const,
      }),
    ]),
  };
}

type SafeCall<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function safeCall<T>(fn: () => T): SafeCall<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

function inputInvalid(code: string, message: string): CompletionResult {
  return failure('COMPLETION-INPUT-INVALID', code, message);
}

/** Shape-validate the attempt facts container. */
function attemptFactsShape(value: unknown): { readonly ok: true; readonly facts: CompletionInput['attempt'] } | { readonly ok: false } {
  if (!isRecord(value)) return { ok: false };
  const occurrenceId = value['occurrenceId'];
  const attemptId = value['attemptId'];
  const ordinal = value['ordinal'];
  const attemptRecordId = value['attemptRecordId'];
  const occurrenceRecordId = value['occurrenceRecordId'];
  const activationRecordId = value['activationRecordId'];
  const runtimeGrantId = value['runtimeGrantId'];
  if (
    typeof occurrenceId !== 'string' || !OCCURRENCE_ID_RE.test(occurrenceId) ||
    typeof attemptId !== 'string' || !ATTEMPT_ID_RE.test(attemptId) ||
    typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 1 ||
    typeof attemptRecordId !== 'string' || !RECORD_ID_RE.test(attemptRecordId) ||
    typeof occurrenceRecordId !== 'string' || !RECORD_ID_RE.test(occurrenceRecordId) ||
    typeof activationRecordId !== 'string' || !RECORD_ID_RE.test(activationRecordId) ||
    typeof runtimeGrantId !== 'string' || !RECORD_ID_RE.test(runtimeGrantId)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    facts: {
      occurrenceId,
      attemptId,
      ordinal,
      attemptRecordId,
      occurrenceRecordId,
      activationRecordId,
      runtimeGrantId,
    },
  };
}

/** Shape-validate the host-supplied validated CompletionContract artifact. */
function completionContractShape(value: unknown): { readonly ok: true; readonly artifact: ValidatedArtifact } | { readonly ok: false } {
  if (!isRecord(value) || typeof value['level'] !== 'string') return { ok: false };
  const model = value['model'];
  if (!isRecord(model)) return { ok: false };
  const kind = model['kind'];
  if (!isRecord(kind) || kind['id'] !== 'CompletionContract' || kind['version'] !== '1.0') return { ok: false };
  if (typeof value['instanceId'] !== 'string' || typeof value['revisionId'] !== 'string' || typeof value['digest'] !== 'string' || typeof value['canonicalUtf8'] !== 'string') {
    return { ok: false };
  }
  if (!isLevelAtLeast(value['level'] as never, 'self-semantic-valid')) return { ok: false };
  const body = model['body'];
  if (!isRecord(body) || !Array.isArray(body['checks'])) return { ok: false };
  return { ok: true, artifact: value as unknown as ValidatedArtifact };
}

/** The observation workspace binding must match the completion workspace. */
function observationWorkspaceMatches(observation: PiExecutionObservation, workspaceId: string): boolean {
  const ref = observation.bundleReference;
  if (!isRecord(ref)) return false;
  const binding = ref['target_workspace_binding'];
  if (!isRecord(binding)) return false;
  if (binding['mode'] === 'bound') return binding['workspace_id'] === workspaceId;
  return false;
}

type WriteMappedResult =
  | { readonly ok: true; readonly outcome: 'created' | 'already-exact' }
  | { readonly ok: false; readonly category: CompletionFailureCategory; readonly code: string; readonly message: string };

function mapWriteOutcome(outcome: ResultWriteOutcome): WriteMappedResult {
  if (outcome.ok) return { ok: true, outcome: outcome.outcome };
  switch (outcome.code) {
    case 'exclusive-create-conflict':
      return { ok: false, category: 'RESULT-WRITE-CONFLICT', code: 'result.write-exclusive-create-conflict', message: 'the deterministic result destination already holds conflicting bytes; a second distinct result for this attempt fails closed' };
    case 'containment-denied':
    case 'ownership-mismatch':
    case 'parent-not-verified':
    case 'invalid-operand':
      return { ok: false, category: 'RESULT-CONTAINMENT-DENIED', code: `result.write-${outcome.code}`, message: 'the result destination containment, ownership, or path revalidation failed' };
    default:
      return { ok: false, category: 'RESULT-WRITE-FAILED', code: `result.write-${outcome.code}`, message: 'the result artifact write failed' };
  }
}

/**
 * Complete one attempt: evaluate, produce/adopt one result instance, write
 * the canonical artifact, record the passing ValidationRecord through
 * WP-12, and return the bounded validated-result handoff for WP-13C.
 */
export function completeExecution(input: CompletionInput): CompletionResult {
  // ─── 1. input hygiene (containers + members; SIR-WP13A-001 pattern) ──────
  if (!isRecord(input)) return inputInvalid('input.root-invalid', 'completion input is missing or malformed');
  const workspaceId = input['workspaceId'];
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_RE.test(workspaceId)) return inputInvalid('input.workspace-invalid', 'workspace identity is invalid');

  const attemptCheck = safeCall(() => attemptFactsShape(input['attempt']));
  if (!attemptCheck.ok || !attemptCheck.value.ok) return inputInvalid('input.attempt-invalid', 'attempt facts are missing or malformed');
  const attempt = (input['attempt'] as unknown) as CompletionInput['attempt'];

  const outcomeCheck = safeCall(() => isExecutionAttemptOutcome(input['outcome']));
  if (!outcomeCheck.ok || !outcomeCheck.value) return inputInvalid('input.outcome-invalid', 'the attempt outcome is missing or malformed');
  const outcome = (input['outcome'] as unknown) as ExecutionAttemptOutcome;

  let observation: PiExecutionObservation | undefined;
  if (input['observation'] !== undefined) {
    const observationCheck = safeCall(() => isPiExecutionObservation(input['observation']));
    if (!observationCheck.ok || !observationCheck.value) return inputInvalid('input.observation-invalid', 'the execution observation is malformed');
    observation = (input['observation'] as unknown) as PiExecutionObservation;
  }

  let completionContract: ValidatedArtifact | undefined;
  if (input['completionContract'] !== undefined) {
    const contractCheck = safeCall(() => completionContractShape(input['completionContract']));
    if (!contractCheck.ok || !contractCheck.value.ok) return inputInvalid('input.contract-invalid', 'the CompletionContract artifact is malformed');
    completionContract = (input['completionContract'] as unknown) as ValidatedArtifact;
  }

  const enforcement = input['enforcementEvidence'];
  if (!isRecord(enforcement) || typeof enforcement['evidenceFingerprint'] !== 'string' || !FINGERPRINT_RE.test(enforcement['evidenceFingerprint'] as string)) {
    return inputInvalid('input.enforcement-reference-invalid', 'the enforcement evidence reference is missing or malformed');
  }
  const enforcementFingerprint = enforcement['evidenceFingerprint'] as string;

  const adoptCandidateBytes = input['adoptCandidateBytes'];
  if (adoptCandidateBytes !== undefined && (!(adoptCandidateBytes instanceof Uint8Array) || adoptCandidateBytes.byteLength === 0)) {
    return inputInvalid('input.candidate-invalid', 'the adoption candidate bytes are malformed');
  }
  const resultRoot = input['resultRoot'];
  if (typeof resultRoot !== 'string' || resultRoot.length === 0) return inputInvalid('input.result-root-invalid', 'the result root is missing');
  const serviceUid = input['serviceUid'];
  if (typeof serviceUid !== 'number' || !Number.isSafeInteger(serviceUid) || serviceUid < 0) return inputInvalid('input.service-uid-invalid', 'the service uid is invalid');
  const schemaRegistry = input['schemaRegistry'];
  if (!isRecord(schemaRegistry) || typeof schemaRegistry['validate'] !== 'function') return inputInvalid('input.schema-registry-invalid', 'the schema registry is missing or malformed');
  const controlPlane = input['controlPlane'];
  if (!isRecord(controlPlane) || typeof controlPlane['recordValidation'] !== 'function') {
    return inputInvalid('input.boundary-invalid', 'the validation-recording boundary is missing or not a function');
  }
  const identitySource = input['identitySource'];
  if (!isRecord(identitySource) || typeof identitySource['newResultInstanceId'] !== 'function' || typeof identitySource['newResultRevisionId'] !== 'function' || typeof identitySource['newEvidenceId'] !== 'function') {
    return inputInvalid('input.identity-source-invalid', 'the result identity source is missing or not a function');
  }

  // ─── 2. completion decision gate (§4.2; EXE-008/009) ──────────────────────
  const decision = completionDecision({ outcome, observation, completionContract });
  if (decision.decision === 'no-result') {
    return { ok: true, decision: 'no-result', reason: decision.reason };
  }

  // ─── 3. exact attempt correlation ─────────────────────────────────────────
  const correlationCheck = safeCall(() => completionFactsCorrelated({ workspaceId, attempt, outcome, observation: observation as PiExecutionObservation }));
  if (!correlationCheck.ok || !correlationCheck.value) {
    return inputInvalid('input.correlation-mismatch', 'the outcome/observation are not correlated with the exact attempt facts');
  }
  const workspaceBindingCheck = safeCall(() => observationWorkspaceMatches(observation as PiExecutionObservation, workspaceId));
  if (!workspaceBindingCheck.ok || !workspaceBindingCheck.value) {
    return inputInvalid('input.workspace-binding-mismatch', 'the observation bundle workspace binding does not match the completion workspace');
  }

  // ─── 4. adoption candidate parse (exact compatible candidate only; ADR-012 §3.2/§3.4) ─
  let candidateModel: Readonly<Record<string, unknown>> | undefined;
  if (adoptCandidateBytes !== undefined) {
    const candidateCheck = safeCall(() => parseRawJsonInput(adoptCandidateBytes as Uint8Array, { subjectClass: 'artifact' }));
    if (!candidateCheck.ok || !candidateCheck.value.ok) {
      return failure('RESULT-CANDIDATE-INVALID', 'result.candidate-unparsable', 'the adoption candidate is not valid JSON content');
    }
    candidateModel = candidateCheck.value.model as Readonly<Record<string, unknown>>;
  }

  // ─── 5. opaque identities + committed evidence references (SIR-WP13B-001) ─
  // Origination: fresh opaque instance/revision/evidence ids through the
  // trusted identity boundary (ADR-008; D-3 pattern), contained with
  // safeCall → exact shape validation → use. Adoption: the candidate's
  // already-valid opaque instance/revision identities and its committed
  // enforcement-evidence reference (content_digest = the current WP-5B
  // fingerprint) are preserved exactly — never re-derived, never minted.
  let instanceId: string;
  let revisionId: string;
  let evidenceReferences: readonly ResultEvidenceReference[];
  if (candidateModel !== undefined) {
    const extracted = candidateIdentityMaterial(candidateModel, enforcementFingerprint);
    if (!extracted.ok) {
      return failure('RESULT-CANDIDATE-INVALID', 'result.candidate-invalid', 'the adoption candidate does not carry the exact opaque result identities and committed evidence reference for this attempt');
    }
    instanceId = extracted.instanceId;
    revisionId = extracted.revisionId;
    evidenceReferences = extracted.evidenceReferences;
  } else {
    const instanceCall = safeCall(() => identitySource['newResultInstanceId']());
    if (!instanceCall.ok) {
      return failure('COMPLETION-INTERNAL-FAILURE', 'identity.instance-id-exception', 'the result identity source raised an unexpected exception');
    }
    if (typeof instanceCall.value !== 'string' || !INSTANCE_ID_RE.test(instanceCall.value)) {
      return failure('COMPLETION-INTERNAL-FAILURE', 'identity.instance-id-malformed', 'the result identity source returned a malformed result instance identity');
    }
    const revisionCall = safeCall(() => identitySource['newResultRevisionId']());
    if (!revisionCall.ok) {
      return failure('COMPLETION-INTERNAL-FAILURE', 'identity.revision-id-exception', 'the result identity source raised an unexpected exception');
    }
    if (typeof revisionCall.value !== 'string' || !REVISION_ID_RE.test(revisionCall.value)) {
      return failure('COMPLETION-INTERNAL-FAILURE', 'identity.revision-id-malformed', 'the result identity source returned a malformed result revision identity');
    }
    const evidenceCall = safeCall(() => identitySource['newEvidenceId']());
    if (!evidenceCall.ok) {
      return failure('COMPLETION-INTERNAL-FAILURE', 'identity.evidence-id-exception', 'the result identity source raised an unexpected exception');
    }
    if (typeof evidenceCall.value !== 'string' || !EVIDENCE_ID_RE.test(evidenceCall.value)) {
      return failure('COMPLETION-INTERNAL-FAILURE', 'identity.evidence-id-malformed', 'the result identity source returned a malformed evidence identity');
    }
    instanceId = instanceCall.value;
    revisionId = revisionCall.value;
    evidenceReferences = Object.freeze([enforcementEvidenceReference(enforcementFingerprint, evidenceCall.value)]);
  }

  // ─── 6. canonical result model ────────────────────────────────────────────
  const modelCheck = safeCall(() =>
    buildResultModel({
      workspaceId,
      attempt,
      outcome,
      observation: observation as PiExecutionObservation,
      completionContract: completionContract as ValidatedArtifact,
      instanceId,
      revisionId,
      evidenceReferences,
    }),
  );
  if (!modelCheck.ok) {
    return failure('COMPLETION-INTERNAL-FAILURE', 'result.model-build-failed', 'the canonical result model could not be derived');
  }
  const model = modelCheck.value;

  // ─── 7. adoption: exact compatible candidate only (ADR-012 §3.4) ─────────
  let associationMode: 'originated' | 'adopted' = 'originated';
  if (candidateModel !== undefined) {
    const candidateCanonicalCheck = safeCall(() => jcsSerialize(candidateModel));
    if (!candidateCanonicalCheck.ok || candidateCanonicalCheck.value !== model.canonicalUtf8) {
      return failure('RESULT-CANDIDATE-INVALID', 'result.candidate-not-exact', 'the adoption candidate is not the exact canonical result for this attempt');
    }
    associationMode = 'adopted';
  }

  // ─── 8. WP-4 validation of the result (structural + semantic self) ───────
  const artifactCheck = safeCall(() => {
    const parsed = parseRawJsonInput(new TextEncoder().encode(model.canonicalUtf8), { subjectClass: 'artifact' });
    if (!parsed.ok) return undefined;
    const report = validateArtifactSelf(parsed.model, schemaRegistry as never);
    if (report.ok !== true || report.value === undefined) return undefined;
    return { report, artifact: report.value };
  });
  if (!artifactCheck.ok || artifactCheck.value === undefined) {
    return failure('RESULT-VALIDATION-REJECTED', 'result.validation-rejected', 'the WP-4 validation rejected the result artifact');
  }
  const validatedArtifact = artifactCheck.value.artifact;
  const acceptedReport = artifactCheck.value.report as unknown as Readonly<Record<string, unknown>>;

  // ─── 7. narrow result write (exclusive create / adoption-recovery) ───────
  const writeCall = safeCall(() =>
    writeResultArtifact({
      root: resultRoot,
      serviceUid,
      occurrenceId: attempt.occurrenceId,
      attemptId: attempt.attemptId,
      bytes: new TextEncoder().encode(model.canonicalUtf8),
    }),
  );
  if (!writeCall.ok) {
    return failure('RESULT-WRITE-FAILED', 'result.write-unexpected-exception', 'the result write executor raised an unexpected exception');
  }
  const writeMapped = mapWriteOutcome(writeCall.value);
  if (!writeMapped.ok) return writeMapped;
  const writeOutcome = writeMapped.outcome;

  // ─── 9. WP-12 recordValidation (trusted producer; SCR-WP13-002) ──────────
  const recordCall = safeCall(() =>
    controlPlane['recordValidation']({
      workspaceId,
      subject: {
        protocolId: 'project-gateway.artifact',
        protocolVersion: '1.0',
        kindId: 'ExecutionResult',
        kindVersion: '1.0',
        instanceId: model.instanceId,
        revisionId: model.revisionId,
        digest: model.digest,
        workspaceId,
      },
      evidence: {
        report: acceptedReport,
        artifact: validatedArtifact,
      },
    }),
  );
  if (!recordCall.ok) {
    return failure('COMPLETION-INTERNAL-FAILURE', 'validation.recording-exception', 'the validation-recording boundary raised an unexpected exception');
  }
  const recordValue = recordCall.value;
  if (!isRecord(recordValue) || typeof recordValue['ok'] !== 'boolean') {
    return failure('COMPLETION-INTERNAL-FAILURE', 'validation.recording-malformed', 'the validation-recording boundary returned a malformed result');
  }
  if (recordValue['ok'] !== true) {
    const category = typeof recordValue['category'] === 'string' ? recordValue['category'] : 'unknown';
    const message = typeof recordValue['message'] === 'string' ? recordValue['message'] : 'the WP-12 recordValidation operation refused the validation record';
    return failure('VALIDATION-RECORDING-FAILED', `validation.${category}`, message);
  }
  const validationRecordId = recordValue['validationRecordId'];
  if (typeof validationRecordId !== 'string' || validationRecordId.length === 0) {
    return failure('COMPLETION-INTERNAL-FAILURE', 'validation.recording-incomplete', 'the validation-recording boundary returned no validation-record identity');
  }

  // ─── 10. bounded validated-result handoff (WP-13C input) ─────────────────
  const handoff: ValidatedResultHandoff = Object.freeze({
    workspaceId,
    occurrenceId: attempt.occurrenceId,
    attemptId: attempt.attemptId,
    ordinal: attempt.ordinal,
    bundleReference: (observation as PiExecutionObservation).bundleReference as unknown as Readonly<Record<string, unknown>>,
    disposition: 'completed',
    associationMode,
    resultInstanceId: model.instanceId,
    resultRevisionId: model.revisionId,
    resultDigest: model.digest,
    artifactRelativePath: resultRelativePath(attempt.occurrenceId, attempt.attemptId),
    validationRecordId,
    evaluatorId: COMPLETION_EVALUATOR_ID,
    capabilityProfileId: COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID,
    evidenceReferences,
    writeOutcome,
  });
  return { ok: true, decision: 'produced', handoff };
}

export type { CompletionInput, CompletionResult, ValidatedResultHandoff, ResultEvidenceReference };
