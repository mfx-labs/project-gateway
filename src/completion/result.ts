/**
 * WP-13B — ExecutionResult model construction.
 *
 * Pure module: builds the canonical `ExecutionResult` envelope (committed
 * `execution-result`/`execution-result-body` schemas) from the evaluated
 * completion facts, computes the artifact digest (committed
 * `artifactProjection` convention) over the canonical projection, and
 * produces the exact canonical bytes of the project-visible artifact.
 *
 * Identity semantics (ADR-008; SIR-WP13B-001): the result instance and
 * revision identifiers are OPAQUE and host-supplied through the trusted
 * identity boundary (`ResultIdentitySource`); they never encode workspace,
 * lifecycle, or content semantics and are never derived in this module.
 * The canonical digest is computed exactly from the committed
 * `artifactProjection` (projection excludes `revision.digest` and
 * `annotations`); instance, revision, and digest remain distinct, and no
 * digest/identity circularity workaround exists (the digest covers the
 * opaque instance id and revision id directly).
 *
 * Evidence references use only committed evidence identity material
 * (SIR-WP13B-001): the WP-5B enforcement-evidence fingerprint is the
 * `content_digest` (committed sha-256 form), the `evidence_id` is an
 * opaque `pgw:e:` id from the trusted identity boundary, and the
 * reference shape is the committed `external-evidence` vocabulary. No
 * content-derived evidence-ID protocol is minted; the execution
 * observation is embedded content in the result body (reported facts),
 * not an external-evidence reference.
 */
import { jcsSerialize } from '../canonical/jcs.js';
import { artifactProjection } from '../digest/index.js';
import type { PiExecutionObservation } from '../adapters/pi/types.js';
import type { ExecutionAttemptOutcome } from '../execution/types.js';
import type { ValidatedArtifact } from '../api/types.js';
import type { CompletionAttemptFacts, ExecutionResultIdentities, ResultEvidenceReference } from './types.js';
import { evaluateChecks, type CompletionCheckObservation } from './evaluator.js';

const ARTIFACT_PROTOCOL_ID = 'project-gateway.artifact';
const ARTIFACT_PROTOCOL_VERSION = '1.0';
const ARTIFACT_CANONICALIZATION = 'jcs-rfc8785-v1';
const RESULT_KIND_ID = 'ExecutionResult';
const RESULT_KIND_VERSION = '1.0';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Committed-shape external-evidence reference for the WP-5B enforcement
 * evidence: the `content_digest` is the committed evidence fingerprint
 * (sha-256 over the canonical evidence serialization; WP-5B) and the
 * `evidence_id` is the opaque id supplied by the trusted identity
 * boundary. Pure construction; the caller validates both operands.
 */
export function enforcementEvidenceReference(evidenceFingerprint: string, evidenceId: string): ResultEvidenceReference {
  return Object.freeze({
    kind: 'external-evidence',
    evidence_id: evidenceId,
    content_digest: evidenceFingerprint,
    declared_media_type: 'application/json',
    observation_role: 'evaluation-evidence',
  });
}

/** Deterministic violations over observed facts only (never fabricated). */
function observedViolations(observation: PiExecutionObservation): readonly Readonly<Record<string, unknown>>[] {
  const violations: Readonly<Record<string, unknown>>[] = [];
  observation.hostErrors.forEach((text, i) => {
    violations.push(
      Object.freeze({
        violation_id: `host-error-${i}`,
        category: 'runtime',
        summary: text,
      }),
    );
  });
  observation.findings.forEach((finding, i) => {
    violations.push(
      Object.freeze({
        violation_id: `adapter-finding-${i}`,
        category: 'integrity',
        summary: typeof finding['message'] === 'string' ? finding['message'] : 'adapter finding',
      }),
    );
  });
  return Object.freeze(violations);
}

/** The deterministic result body (committed execution-result-body vocabulary). */
export function buildResultBody(input: {
  readonly outcome: ExecutionAttemptOutcome;
  readonly observation: PiExecutionObservation;
  readonly completionContract: ValidatedArtifact;
  readonly evidenceReferences: readonly ResultEvidenceReference[];
}): Readonly<Record<string, unknown>> {
  const observation = input.observation;
  const completionText = typeof observation.completionText === 'string' && observation.completionText.length > 0 ? observation.completionText : undefined;
  const observedOutputs: Readonly<Record<string, unknown>>[] =
    completionText === undefined
      ? []
      : [Object.freeze({ output_id: 'completion-summary', kind: 'summary', text: completionText })];
  const checks: CompletionCheckObservation[] = evaluateChecks({
    contract: input.completionContract,
    evidenceReferences: input.evidenceReferences,
    producedArtifactInstanceIds: [],
  });
  return Object.freeze({
    reported_bundle: observation.bundleReference,
    reported_occurrence_id: observation.occurrenceId,
    reported_attempt_id: observation.attemptId,
    disposition: input.outcome.disposition,
    observed_outputs: Object.freeze(observedOutputs),
    observed_changed_resources: Object.freeze([]),
    completion_check_observations: Object.freeze(
      checks.map((c) => Object.freeze({ check_id: c.check_id, status: c.status, evidence: Object.freeze(c.evidence) })),
    ),
    violations: observedViolations(observation),
    produced_artifact_references: Object.freeze([]),
    evidence_references: Object.freeze(input.evidenceReferences),
  });
}

/**
 * Build the canonical result envelope + identities + exact canonical bytes.
 * The instance/revision identifiers are OPAQUE inputs (ADR-008; supplied
 * through the trusted identity boundary, or preserved from an adopted
 * candidate); the artifact digest follows the committed convention
 * (canonical projection excluding `revision.digest` and `annotations`);
 * the file bytes are the exact JCS serialization of the complete envelope
 * (the digest-covered content).
 */
export function buildResultModel(input: {
  readonly workspaceId: string;
  readonly attempt: CompletionAttemptFacts;
  readonly outcome: ExecutionAttemptOutcome;
  readonly observation: PiExecutionObservation;
  readonly completionContract: ValidatedArtifact;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly evidenceReferences: readonly ResultEvidenceReference[];
}): ExecutionResultIdentities {
  const body = buildResultBody({
    outcome: input.outcome,
    observation: input.observation,
    completionContract: input.completionContract,
    evidenceReferences: input.evidenceReferences,
  });

  // The committed artifact digest is computed over the canonical projection
  // (which excludes revision.digest and annotations). The revision id is
  // final at this point (opaque input), so the projection — and therefore
  // the digest — is stable over the complete envelope.
  const modelWithoutDigest = Object.freeze({
    protocol: Object.freeze({ id: ARTIFACT_PROTOCOL_ID, version: ARTIFACT_PROTOCOL_VERSION, canonicalization: ARTIFACT_CANONICALIZATION }),
    kind: Object.freeze({ id: RESULT_KIND_ID, version: RESULT_KIND_VERSION }),
    instance_id: input.instanceId,
    revision: Object.freeze({ id: input.revisionId, generation: 0, predecessor: null, digest: '' }),
    workspace_binding: Object.freeze({ mode: 'bound', workspace_id: input.workspaceId }),
    requirements: Object.freeze({ protocol_features: Object.freeze([]), consumer_capabilities: Object.freeze([]) }),
    extensions: Object.freeze([]),
    body,
  });
  const digest = artifactProjection(modelWithoutDigest as Readonly<Record<string, unknown>>).digest;

  const model = Object.freeze({
    ...modelWithoutDigest,
    revision: Object.freeze({ id: input.revisionId, generation: 0, predecessor: null, digest }),
  });
  // The committed projection excludes revision.digest, so the digest is
  // stable over the complete envelope.
  const verified = artifactProjection(model as Readonly<Record<string, unknown>>);
  if (verified.digest !== digest) {
    throw new Error('result artifact digest is not stable over the complete envelope');
  }
  return {
    instanceId: input.instanceId,
    revisionId: input.revisionId,
    digest,
    canonicalUtf8: jcsSerialize(model),
    body,
  };
}
