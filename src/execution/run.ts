/**
 * WP-13A — execution-attempt flow.
 *
 * Deterministic, fail-closed execution foundation:
 *
 *   validated input → WP-12 orchestration revalidation (EXE-007) →
 *   enforcement gate (live state + evidence correlation) → retry
 *   eligibility/ordinal (§4) → WP-12 recordExecutionAttempt → WP-5A plan
 *   projection (host) + exact correlation → (ordinal 1) enforcement plan
 *   fingerprint → Pi execution through the host boundary →
 *   PiExecutionObservation collection/validation → bounded outcome.
 *
 * WP-13A never publishes lifecycle records, never activates/restores
 * pi-guard, never recomputes authority, never infers authorization from
 * observations, and never executes from cached enforcement evidence: the
 * live pi-guard state is re-read at every attempt.
 *
 * SIR-WP13A-001 (boundary containment): every required nested container is
 * shape-validated before property access, and every injected boundary call
 * (control plane, Pi host, identity, observation collection) goes through
 * the bounded safe-call pattern. Raw exception text, error objects, and
 * stacks never escape; malformed containers and throwing boundary members
 * map into the closed taxonomy (EXEC-INPUT-INVALID for caller/input shape,
 * EXEC-HOST-FAILURE for the Pi host boundary, EXEC-INTERNAL-FAILURE for
 * trusted/internal boundaries). There is no fallback success and no
 * authority inference from exceptions: execution remains fail closed.
 */
import { computePlanFingerprint, surfaceStable } from '../adapters/pi/enforcement/index.js';
import type { PiEnforcementEvidence } from '../adapters/pi/enforcement/types.js';
import { isPiExecutionObservation, isPiInvocationPlan, observePiExecution } from '../adapters/pi/index.js';
import type { PiInvocationPlan } from '../adapters/pi/types.js';
import { ATTEMPT_ID_RE, RECORD_ID_RE } from '../control-plane/types.js';
import { evaluateRetryEligibility, isExecutionAttemptOutcome, terminalReason } from './retry.js';
import type {
  ControlPlaneDecisionResult,
  DurableAttemptFact,
  EnforcementStateSnapshot,
  ExecutionAttemptDisposition,
  ExecutionAttemptFailure,
  ExecutionAttemptInput,
  ExecutionAttemptOutcome,
  ExecutionAttemptRequest,
  ExecutionAttemptResult,
  ExecutionAttemptSuccess,
  ExecutionFailureCategory,
  HostExecutionFacts,
} from './types.js';

/** Deterministic disposition mapping (committed §4.2 vocabulary; precedence fixed). */
function mapDisposition(observationStatus: 'completed' | 'cancelled' | 'error' | 'not-observed', facts: HostExecutionFacts): ExecutionAttemptDisposition {
  if (facts.enforcementDenied === true) return 'rejected';
  if (facts.crashed === true) return 'crashed';
  if (facts.timedOut === true) return 'timed-out';
  switch (observationStatus) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'failed';
    default:
      return 'incomplete';
  }
}

function failure(category: ExecutionFailureCategory, code: string, message: string): ExecutionAttemptFailure {
  return { ok: false, category, code, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ─── bounded safe-call pattern (SIR-WP13A-001) ──────────────────────────────
// Contains ANY throw from an injected boundary call. The exception itself is
// discarded: raw text, error objects, and stacks never reach findings or
// evidence. Failures map to the closed taxonomy by boundary class — there is
// no fallback success and no authority inference from exceptions.
type SafeCall<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function safeCall<T>(fn: () => T): SafeCall<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

/** Malformed caller/input container or boundary member → EXEC-INPUT-INVALID. */
function inputInvalid(code: string, message: string): ExecutionAttemptFailure {
  return failure('EXEC-INPUT-INVALID', code, message);
}

function isValidRequest(request: unknown): request is ExecutionAttemptRequest {
  if (!isRecord(request)) return false;
  return typeof request['workspaceId'] === 'string' && typeof request['reservedOccurrenceId'] === 'string';
}

/** A WP-12 decision result in the committed narrow shape (ok/evidence or ok/category/code/message).
 *  SIR-WP13A-001(b): the ok:true evidence is validated to the FULL nested
 *  shape WP-13A consumes — never just `isRecord(evidence)`. */
interface OrchestrationEvidenceShape {
  readonly outcome: 'orchestrated';
  readonly grantCurrent: boolean;
  readonly remainingAllowance: number;
  readonly runtimeGrantId: string;
  readonly workspaceId: string;
  readonly occurrenceRecordId: string;
  readonly activationRecordId: string;
  readonly subject: {
    readonly protocolId: string;
    readonly protocolVersion: string;
    readonly kindId: string;
    readonly kindVersion: string;
    readonly instanceId: string;
    readonly revisionId: string;
    readonly digest: string;
    readonly workspaceId: string;
  };
}

type OrchestrationDecisionResultShape =
  | { readonly ok: true; readonly evidence: OrchestrationEvidenceShape }
  | { readonly ok: false; readonly category: string; readonly code: string; readonly message: string };

interface AttemptRecordedEvidenceShape {
  readonly outcome: 'attempt-recorded';
  readonly attemptId: string;
  readonly ordinal: number;
  readonly recordId: string;
  readonly attemptRecordId?: string;
}

type AttemptRecordedResultShape =
  | { readonly ok: true; readonly evidence: AttemptRecordedEvidenceShape }
  | { readonly ok: false; readonly category: string; readonly code: string; readonly message: string };

/** Canonical subject identity container (all eight committed fields, non-empty). */
function isSubjectShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value['protocolId'] === 'string' && (value['protocolId'] as string).length > 0 &&
    typeof value['protocolVersion'] === 'string' && (value['protocolVersion'] as string).length > 0 &&
    typeof value['kindId'] === 'string' && (value['kindId'] as string).length > 0 &&
    typeof value['kindVersion'] === 'string' && (value['kindVersion'] as string).length > 0 &&
    typeof value['instanceId'] === 'string' && (value['instanceId'] as string).length > 0 &&
    typeof value['revisionId'] === 'string' && (value['revisionId'] as string).length > 0 &&
    typeof value['digest'] === 'string' && (value['digest'] as string).length > 0 &&
    typeof value['workspaceId'] === 'string' && (value['workspaceId'] as string).length > 0
  );
}

function isOrchestrationDecisionResult(value: unknown): value is OrchestrationDecisionResultShape {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') return false;
  if (value['ok'] === false) {
    return typeof value['category'] === 'string' && typeof value['code'] === 'string' && typeof value['message'] === 'string';
  }
  const evidence = value['evidence'];
  if (!isRecord(evidence)) return false;
  if (evidence['outcome'] !== 'orchestrated') return false;
  if (typeof evidence['grantCurrent'] !== 'boolean') return false;
  if (typeof evidence['remainingAllowance'] !== 'number' || !Number.isSafeInteger(evidence['remainingAllowance']) || (evidence['remainingAllowance'] as number) < 0) return false;
  if (typeof evidence['runtimeGrantId'] !== 'string' || (evidence['runtimeGrantId'] as string).length === 0) return false;
  if (typeof evidence['workspaceId'] !== 'string' || (evidence['workspaceId'] as string).length === 0) return false;
  if (typeof evidence['occurrenceRecordId'] !== 'string' || (evidence['occurrenceRecordId'] as string).length === 0) return false;
  if (typeof evidence['activationRecordId'] !== 'string' || (evidence['activationRecordId'] as string).length === 0) return false;
  if (!isSubjectShape(evidence['subject'])) return false;
  return true;
}

/** SIR-WP13A-001(c): attempt evidence must carry ACTUAL valid attempt/record
 *  identities (committed syntax); no `String(undefined)`-style fabrication. */
function isAttemptRecordedResult(value: unknown): value is AttemptRecordedResultShape {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') return false;
  if (value['ok'] === false) {
    return typeof value['category'] === 'string' && typeof value['code'] === 'string' && typeof value['message'] === 'string';
  }
  const evidence = value['evidence'];
  if (!isRecord(evidence)) return false;
  if (evidence['outcome'] !== 'attempt-recorded') return false;
  if (typeof evidence['attemptId'] !== 'string' || !ATTEMPT_ID_RE.test(evidence['attemptId'])) return false;
  if (typeof evidence['ordinal'] !== 'number' || !Number.isSafeInteger(evidence['ordinal']) || (evidence['ordinal'] as number) < 1) return false;
  if (typeof evidence['recordId'] !== 'string' || !RECORD_ID_RE.test(evidence['recordId'])) return false;
  const attemptRecordId = evidence['attemptRecordId'];
  if (attemptRecordId !== undefined && (typeof attemptRecordId !== 'string' || !RECORD_ID_RE.test(attemptRecordId))) return false;
  return true;
}

/** SIR-WP13A-001(a): the committed host execution-result shape. For ok:true the
 *  facts container must exist (members are validated before use); for ok:false
 *  only the code is accepted — the host message is NEVER trusted. */
type HostRunResultShape =
  | { readonly ok: true; readonly facts: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: string };

function hostRunResultShape(value: unknown): value is HostRunResultShape {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') return false;
  if (value['ok'] === true) return isRecord(value['facts']);
  return typeof value['code'] === 'string';
}

/** SIR-WP13A-001(a): the committed host plan-projection result shape (the plan
 *  itself is validated by the WP-5A brand check before use). */
type HostPlanResultShape = { readonly ok: true; readonly plan: unknown } | { readonly ok: false; readonly code: string };

function hostPlanResultShape(value: unknown): value is HostPlanResultShape {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') return false;
  if (value['ok'] === true) return true;
  return typeof value['code'] === 'string';
}

/** One durable attempt fact in the committed narrow shape. */
function isDurableAttemptFact(value: unknown): value is DurableAttemptFact {
  if (!isRecord(value)) return false;
  return (
    typeof value['recordId'] === 'string' &&
    typeof value['attemptId'] === 'string' &&
    typeof value['ordinal'] === 'number' &&
    Number.isSafeInteger(value['ordinal']) &&
    (value['ordinal'] as number) >= 1 &&
    typeof value['runtimeGrantId'] === 'string' &&
    isRecord(value['bundle'])
  );
}

/** Live enforcement snapshot shape (available:false OR the full PROJECTED/… member set). */
function enforcementSnapshotShape(snapshot: unknown): snapshot is EnforcementStateSnapshot {
  if (!isRecord(snapshot) || typeof snapshot['available'] !== 'boolean') return false;
  if (snapshot['available'] === false) return true;
  if (typeof snapshot['active'] !== 'boolean') return false;
  if (snapshot['mode'] !== 'PROJECTED' && snapshot['mode'] !== 'RESTORED' && snapshot['mode'] !== 'NONE') return false;
  if (typeof snapshot['projectionIdentity'] !== 'string') return false;
  if (!Array.isArray(snapshot['permittedProfile']) || !snapshot['permittedProfile'].every((s) => typeof s === 'string')) return false;
  if (
    !Array.isArray(snapshot['surfaceEntries']) ||
    !snapshot['surfaceEntries'].every((e) => isRecord(e) && typeof e['name'] === 'string' && typeof e['source'] === 'string')
  ) {
    return false;
  }
  return true;
}

/** Exactly the identity fields of the occurrence bundle subject. */
function bundleIdentityMatches(
  subject: { readonly instanceId: string; readonly revisionId: string; readonly digest: string; readonly kindId: string },
  plan: PiInvocationPlan,
): boolean {
  const ref = plan.bundleReference as unknown;
  if (!isRecord(ref)) return false;
  const kind = isRecord(ref['target_kind']) ? ref['target_kind'] : undefined;
  return (
    ref['target_instance_id'] === subject.instanceId &&
    ref['target_revision_id'] === subject.revisionId &&
    ref['target_digest'] === subject.digest &&
    kind !== undefined &&
    kind['id'] === subject.kindId
  );
}

function planWorkspaceMatches(plan: PiInvocationPlan, workspaceId: string): boolean {
  const ref = plan.bundleReference as unknown;
  const binding = isRecord(ref) && isRecord(ref['target_workspace_binding']) ? ref['target_workspace_binding'] : undefined;
  return binding !== undefined && binding['mode'] === 'bound' && binding['workspace_id'] === workspaceId;
}

function setsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((v, i) => v === b[i]);
}

/** Shape-validate the enforcement container + every member the flow accesses. */
function enforcementInputShape(input: ExecutionAttemptInput): {
  readonly evidence: PiEnforcementEvidence;
  readonly activation: { readonly decision: string; readonly grantCurrent: boolean; readonly resolvedOccurrenceId: string; readonly runtimeGrantId: string };
} | undefined {
  const enforcement = input['enforcement'];
  if (!isRecord(enforcement)) return undefined;
  const evidence = enforcement['evidence'];
  const activation = enforcement['activation'];
  if (!isRecord(evidence) || !isRecord(activation)) return undefined;
  const authorityInputIdentities = evidence['authorityInputIdentities'];
  if (
    typeof evidence['activationOutcome'] !== 'string' ||
    typeof evidence['projectionIdentity'] !== 'string' ||
    typeof evidence['observedToolInventoryIdentity'] !== 'string' ||
    typeof evidence['planFingerprint'] !== 'string' ||
    !isRecord(authorityInputIdentities) ||
    typeof authorityInputIdentities['grantIdentity'] !== 'string' ||
    !Array.isArray(evidence['projectedAllowedTools']) ||
    !evidence['projectedAllowedTools'].every((s) => typeof s === 'string') ||
    typeof activation['decision'] !== 'string' ||
    typeof activation['grantCurrent'] !== 'boolean' ||
    typeof activation['resolvedOccurrenceId'] !== 'string' ||
    typeof activation['runtimeGrantId'] !== 'string'
  ) {
    return undefined;
  }
  return {
    evidence: evidence as unknown as PiEnforcementEvidence,
    activation: {
      decision: activation['decision'] as string,
      grantCurrent: activation['grantCurrent'] as boolean,
      resolvedOccurrenceId: activation['resolvedOccurrenceId'] as string,
      runtimeGrantId: activation['runtimeGrantId'] as string,
    },
  };
}

/**
 * Execute one attempt. Every required current state is verified before any
 * durable attempt recording; every failure is deterministic and closed.
 */
export function executeExecutionAttempt(input: ExecutionAttemptInput): ExecutionAttemptResult {
  // ─── 1. input hygiene (containers + boundary members; SIR-WP13A-001) ─────
  if (!isRecord(input)) return inputInvalid('input.root-invalid', 'execution input is missing or malformed');
  const requestCheck = safeCall(() => input['request']);
  if (!requestCheck.ok || !isValidRequest(requestCheck.value)) return inputInvalid('input.request-invalid', 'execution request is invalid');
  const request = requestCheck.value;
  const workspaceId = request.workspaceId;
  const reservedOccurrenceId = request.reservedOccurrenceId;
  if (!/^pgw:w:[0-9a-f]{32}$/.test(workspaceId)) return inputInvalid('input.workspace-invalid', 'workspace identity is invalid');
  if (!/^pgw:o:[0-9a-f]{32}$/.test(reservedOccurrenceId)) return inputInvalid('input.occurrence-invalid', 'occurrence identity is invalid');

  // Required nested boundary containers + members must exist and be callable.
  const containers: readonly { readonly name: string; readonly value: unknown }[] = [
    { name: 'host', value: input['host'] },
    { name: 'controlPlane', value: input['controlPlane'] },
    { name: 'identity', value: input['identity'] },
  ];
  for (const container of containers) {
    if (!isRecord(container.value)) return inputInvalid('input.boundary-invalid', 'a required injected boundary container is missing or malformed');
  }
  const host = input['host'] as unknown as Readonly<Record<string, unknown>>;
  const controlPlane = input['controlPlane'] as unknown as Readonly<Record<string, unknown>>;
  const identity = input['identity'] as unknown as Readonly<Record<string, unknown>>;
  const members: readonly { readonly name: string; readonly value: unknown }[] = [
    { name: 'controlPlane.orchestrationDecision', value: controlPlane['orchestrationDecision'] },
    { name: 'controlPlane.recordExecutionAttempt', value: controlPlane['recordExecutionAttempt'] },
    { name: 'controlPlane.durableAttempts', value: controlPlane['durableAttempts'] },
    { name: 'host.readEnforcementState', value: host['readEnforcementState'] },
    { name: 'host.projectPlan', value: host['projectPlan'] },
    { name: 'host.execute', value: host['execute'] },
    { name: 'identity.nowUtcIso', value: identity['nowUtcIso'] },
  ];
  for (const member of members) {
    if (typeof member.value !== 'function') return inputInvalid('input.boundary-invalid', 'a required injected boundary member is missing or not a function');
  }

  // Enforcement container + evidence/activation member shapes.
  let enforcementShape: ReturnType<typeof enforcementInputShape>;
  const enforcementCheck = safeCall(() => enforcementInputShape(input));
  if (!enforcementCheck.ok || enforcementCheck.value === undefined) {
    return inputInvalid('input.enforcement-invalid', 'enforcement evidence input is missing or malformed');
  }
  enforcementShape = enforcementCheck.value;

  // Previous-outcome container shape (host-supplied retry basis).
  if (input['previousOutcome'] !== undefined) {
    const previousCheck = safeCall(() => isExecutionAttemptOutcome(input['previousOutcome']));
    if (!previousCheck.ok || !previousCheck.value) return inputInvalid('input.previous-outcome-invalid', 'the previous attempt outcome is malformed');
  }

  // ─── 2. execution-time revalidation (WP-12 orchestration; EXE-007) ────────
  const orchestrationCall = safeCall(() => (controlPlane['orchestrationDecision'] as (w: string, o: string) => ControlPlaneDecisionResult)(workspaceId, reservedOccurrenceId));
  if (!orchestrationCall.ok) {
    return failure('EXEC-INTERNAL-FAILURE', 'control-plane.orchestration-exception', 'the control-plane orchestration boundary raised an unexpected exception');
  }
  // SIR-WP13A-001(b): full nested evidence shape (container, subject identity
  // fields, bundle-reference fields, workspace/occurrence/grant correlations)
  // validated before any property access or correlation logic.
  const orchestrationShapeCheck = safeCall(() => isOrchestrationDecisionResult(orchestrationCall.value));
  if (!orchestrationShapeCheck.ok || !orchestrationShapeCheck.value) {
    return failure('EXEC-INTERNAL-FAILURE', 'control-plane.orchestration-malformed', 'the control-plane orchestration boundary returned a malformed result');
  }
  const orchestration = orchestrationCall.value as unknown as OrchestrationDecisionResultShape;
  if (!orchestration.ok) {
    return failure('EXEC-REVALIDATION-FAILED', `revalidation.${orchestration.category}`, orchestration.message);
  }
  const orchestrationEvidence = orchestration.evidence;
  if (orchestrationEvidence.grantCurrent !== true || orchestrationEvidence.remainingAllowance < 1) {
    return failure('EXEC-REVALIDATION-FAILED', 'revalidation.grant-not-current', 'the occurrence grant is not current or the allowance is exhausted');
  }

  // ─── 3. enforcement gate (live state; never cached evidence) ──────────────
  const evidence = enforcementShape.evidence;
  const activation = enforcementShape.activation;
  if (evidence.activationOutcome !== 'applied') {
    return failure('EXEC-ENFORCEMENT-UNCORRELATED', 'enforcement.evidence-not-applied', 'the occurrence enforcement evidence does not record an applied activation');
  }
  if (activation.decision !== 'accepted' || activation.grantCurrent !== true) {
    return failure('EXEC-ENFORCEMENT-UNCORRELATED', 'enforcement.activation-not-current', 'the activation decision is not accepted or the grant is not current');
  }
  if (activation.resolvedOccurrenceId !== reservedOccurrenceId) {
    return failure('EXEC-ENFORCEMENT-UNCORRELATED', 'enforcement.occurrence-mismatch', 'the activation decision is not correlated with the request occurrence');
  }
  const evidenceGrant = evidence.authorityInputIdentities.grantIdentity;
  if (typeof evidenceGrant !== 'string' || evidenceGrant.length === 0 || evidenceGrant !== activation.runtimeGrantId) {
    return failure('EXEC-ENFORCEMENT-UNCORRELATED', 'enforcement.grant-mismatch', 'the enforcement evidence grant does not match the activation decision');
  }
  if (activation.runtimeGrantId !== orchestrationEvidence.runtimeGrantId) {
    return failure('EXEC-ENFORCEMENT-UNCORRELATED', 'enforcement.occurrence-grant-mismatch', 'the enforcement evidence is not correlated with the occurrence grant');
  }
  const snapshotCall = safeCall(() => (host['readEnforcementState'] as () => EnforcementStateSnapshot)());
  if (!snapshotCall.ok) {
    return failure('EXEC-HOST-FAILURE', 'host.enforcement-state-exception', 'the Pi host enforcement-state boundary raised an unexpected exception');
  }
  if (!enforcementSnapshotShape(snapshotCall.value)) {
    return failure('EXEC-HOST-FAILURE', 'host.enforcement-state-malformed', 'the Pi host returned a malformed enforcement-state snapshot');
  }
  const snapshot = snapshotCall.value;
  if (snapshot.available !== true) {
    return failure('EXEC-ENFORCEMENT-UNAVAILABLE', 'enforcement.state-unavailable', 'live pi-guard enforcement state is unavailable; enforcement must be (re)activated by a fresh activation decision');
  }
  if (snapshot.active !== true || snapshot.mode !== 'PROJECTED') {
    return failure('EXEC-ENFORCEMENT-STALE', 'enforcement.not-projected', 'pi-guard is not in an active PROJECTED state; a fresh activation decision is required');
  }
  if (snapshot.projectionIdentity !== evidence.projectionIdentity) {
    return failure('EXEC-ENFORCEMENT-STALE', 'enforcement.identity-mismatch', 'the live projection identity does not match the occurrence enforcement evidence');
  }
  if (!setsEqual(snapshot.permittedProfile, evidence.projectedAllowedTools)) {
    return failure('EXEC-ENFORCEMENT-STALE', 'enforcement.profile-mismatch', 'the live projection profile does not match the occurrence enforcement evidence');
  }
  const stabilityCall = safeCall(() => surfaceStable(evidence.observedToolInventoryIdentity, snapshot.surfaceEntries));
  if (!stabilityCall.ok || stabilityCall.value !== true) {
    return failure('EXEC-ENFORCEMENT-STALE', 'enforcement.surface-drift', 'the live tool surface drifted from the enforcement inventory; enforcement is not current');
  }

  // ─── 4. retry eligibility / proposed ordinal (§4) ─────────────────────────
  const attemptsCall = safeCall(() => (controlPlane['durableAttempts'] as (o: string) => readonly DurableAttemptFact[])(reservedOccurrenceId));
  if (!attemptsCall.ok) {
    return failure('EXEC-INTERNAL-FAILURE', 'control-plane.attempts-exception', 'the control-plane durable-attempts boundary raised an unexpected exception');
  }
  if (!Array.isArray(attemptsCall.value) || !attemptsCall.value.every(isDurableAttemptFact)) {
    return failure('EXEC-INTERNAL-FAILURE', 'control-plane.attempts-malformed', 'the control-plane durable-attempts boundary returned a malformed result');
  }
  const durableAttempts = attemptsCall.value;
  const retryCall = safeCall(() => evaluateRetryEligibility({
    occurrenceId: reservedOccurrenceId,
    workspaceId,
    previousOutcome: input['previousOutcome'],
    durableAttempts,
    orchestration: {
      runtimeGrantId: orchestrationEvidence.runtimeGrantId,
      grantCurrent: true,
      remainingAllowance: orchestrationEvidence.remainingAllowance,
    },
  }));
  if (!retryCall.ok) {
    return failure('EXEC-INTERNAL-FAILURE', 'retry.evaluation-exception', 'retry eligibility evaluation failed unexpectedly');
  }
  const retry = retryCall.value;
  if (!retry.mayPropose) {
    const ambiguous = retry.reason === 'basis-ambiguous' || retry.reason === 'basis-stale';
    if (ambiguous) {
      return failure('EXEC-RETRY-AMBIGUOUS', `retry.${retry.reason}`, 'retry eligibility is ambiguous and fails closed; a fresh activation decision is required');
    }
    return failure('EXEC-RETRY-DENIED', `retry.${retry.reason}`, `no retry is proposed: ${retry.reason}`);
  }
  const ordinal = retry.ordinal;

  // ─── 5. attempt recording (WP-12 authoritative gate) ──────────────────────
  const recordedCall = safeCall(() => (controlPlane['recordExecutionAttempt'] as (w: string, o: string, n: number) => ControlPlaneDecisionResult)(workspaceId, reservedOccurrenceId, ordinal));
  if (!recordedCall.ok) {
    return failure('EXEC-INTERNAL-FAILURE', 'control-plane.attempt-recording-exception', 'the control-plane attempt-recording boundary raised an unexpected exception');
  }
  // SIR-WP13A-001(c): the recorded evidence must carry ACTUAL valid
  // attempt/record identities — malformed evidence fails closed here and no
  // `String(undefined)`-style identity is ever fabricated.
  const recordedShapeCheck = safeCall(() => isAttemptRecordedResult(recordedCall.value));
  if (!recordedShapeCheck.ok || !recordedShapeCheck.value) {
    return failure('EXEC-INTERNAL-FAILURE', 'control-plane.attempt-recording-malformed', 'the control-plane attempt-recording boundary returned a malformed result');
  }
  const recorded = recordedCall.value as unknown as AttemptRecordedResultShape;
  if (!recorded.ok) {
    return failure('EXEC-ATTEMPT-RECORDING-FAILED', `attempt.recording-${recorded.category}`, recorded.message);
  }
  const recordedEvidence = recorded.evidence;
  const attemptId = recordedEvidence.attemptId;
  if (recordedEvidence.ordinal !== ordinal) {
    return failure('EXEC-INTERNAL-FAILURE', 'attempt.ordinal-mismatch', 'the recorded attempt ordinal does not match the proposed ordinal');
  }

  // ─── 6. plan projection + exact correlation ───────────────────────────────
  const projectedCall = safeCall(() => (host['projectPlan'] as (a: string) => { readonly ok: true; readonly plan: PiInvocationPlan } | { readonly ok: false; readonly code: string; readonly message: string })(attemptId));
  if (!projectedCall.ok) {
    return failure('EXEC-HOST-FAILURE', 'host.plan-exception', 'the Pi host plan-projection boundary raised an unexpected exception');
  }
  const projectedShapeCheck = safeCall(() => hostPlanResultShape(projectedCall.value));
  if (!projectedShapeCheck.ok || !projectedShapeCheck.value) {
    return failure('EXEC-HOST-FAILURE', 'host.plan-result-malformed', 'the Pi host returned a malformed plan-projection result');
  }
  const projected = projectedCall.value as unknown as HostPlanResultShape;
  if (!projected.ok) {
    return failure('EXEC-HOST-FAILURE', `plan.projection-failed:${projected.code}`, 'the host could not project a plan for the recorded attempt');
  }
  const plan = projected.plan as unknown;
  if (!isPiInvocationPlan(plan)) return failure('EXEC-PLAN-UNCORRELATED', 'plan.not-branded', 'the projected plan is not a validated Pi invocation plan');
  if (plan.status !== 'projection-ready' || plan.piGuardEnforcementPending !== true) {
    return failure('EXEC-PLAN-UNCORRELATED', 'plan.status-invalid', 'the projected plan is not projection-ready');
  }
  if (plan.occurrenceId !== reservedOccurrenceId) return failure('EXEC-PLAN-UNCORRELATED', 'plan.occurrence-mismatch', 'the plan occurrence does not match the request occurrence');
  if (plan.attemptId !== attemptId) return failure('EXEC-PLAN-UNCORRELATED', 'plan.attempt-mismatch', 'the plan attempt does not match the recorded attempt');
  if (!planWorkspaceMatches(plan, workspaceId)) return failure('EXEC-PLAN-UNCORRELATED', 'plan.workspace-binding-mismatch', 'the plan workspace binding does not match the request workspace');
  if (!bundleIdentityMatches(orchestrationEvidence.subject, plan)) {
    return failure('EXEC-PLAN-UNCORRELATED', 'plan.bundle-mismatch', 'the plan bundle does not match the occurrence bundle');
  }

  // ─── 7. enforcement plan correlation (first attempt only) ─────────────────
  // The activation evidence is bound to the occurrence; for the first
  // attempt it must be the exact plan being executed (the only plan that
  // could have been activated for this occurrence). Retries run under the
  // still-active occurrence projection verified in step 3.
  if (ordinal === 1) {
    const fingerprintCall = safeCall(() => computePlanFingerprint(plan));
    if (!fingerprintCall.ok || fingerprintCall.value !== evidence.planFingerprint) {
      return failure('EXEC-ENFORCEMENT-UNCORRELATED', 'enforcement.plan-fingerprint-mismatch', 'the enforcement evidence is not correlated with the first-attempt plan');
    }
  }

  // ─── 8. Pi execution through the host boundary ────────────────────────────
  const executedCall = safeCall(() => (host['execute'] as (r: { readonly plan: PiInvocationPlan }) => import('./types.js').HostRunResult)({ plan }));
  if (!executedCall.ok) {
    return failure('EXEC-HOST-FAILURE', 'host.unexpected-exception', 'the Pi host boundary raised an unexpected exception; execution failed closed');
  }
  // SIR-WP13A-001(a): full result-shape validation before reading `ok`; the
  // host failure message is NEVER trusted — a fixed bounded message is used.
  const executedShapeCheck = safeCall(() => hostRunResultShape(executedCall.value));
  if (!executedShapeCheck.ok || !executedShapeCheck.value) {
    return failure('EXEC-HOST-FAILURE', 'host.execution-result-malformed', 'the Pi host returned a malformed execution result');
  }
  const executed = executedCall.value as unknown as HostRunResultShape;
  if (!executed.ok) {
    return failure('EXEC-HOST-FAILURE', `host.execute-failed:${executed.code}`, 'the Pi host failed the execution attempt');
  }
  const hostFacts = executed.facts;
  let sessionCorrelationIdValue: unknown;
  let turnCorrelationIdValue: unknown;
  let bridge: unknown;
  const factsExtraction = safeCall(() => {
    sessionCorrelationIdValue = hostFacts['sessionCorrelationId'];
    turnCorrelationIdValue = hostFacts['turnCorrelationId'];
    bridge = hostFacts['bridge'];
  });
  if (!factsExtraction.ok) {
    return failure('EXEC-HOST-FAILURE', 'host.execution-facts-malformed', 'the Pi host returned malformed execution facts');
  }
  const sessionCorrelationId = typeof sessionCorrelationIdValue === 'string' ? sessionCorrelationIdValue : undefined;
  const turnCorrelationId = typeof turnCorrelationIdValue === 'string' ? turnCorrelationIdValue : undefined;
  if (sessionCorrelationId === undefined || sessionCorrelationId.length === 0 || turnCorrelationId === undefined || turnCorrelationId.length === 0) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.correlation-missing', 'the host did not report session/turn correlation for the attempt');
  }
  // The host report must equal the session/turn correlation the bridge
  // CAPTURED from actual host events — a host cannot claim a session the
  // events did not produce (the observation adopts the caller-supplied ids).
  const bridgeSession = isRecord(bridge) ? bridge['sessionCorrelationId'] : undefined;
  const bridgeTurn = isRecord(bridge) ? bridge['turnCorrelationId'] : undefined;
  if (bridgeSession !== sessionCorrelationId || bridgeTurn !== turnCorrelationId) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.session-turn-mismatch', 'the reported session/turn correlation does not match the captured host events');
  }

  // ─── 9. observation collection + exact correlation ────────────────────────
  let observation;
  try {
    observation = observePiExecution(bridge as unknown as import('../adapters/pi/types.js').PiHostBridge, { sessionCorrelationId, turnCorrelationId });
  } catch {
    return failure('EXEC-INTERNAL-FAILURE', 'observation.build-failed', 'the execution observation could not be derived');
  }
  if (!isPiExecutionObservation(observation)) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.not-branded', 'the derived observation is not a validated Pi execution observation');
  }
  if (observation.occurrenceId !== reservedOccurrenceId) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.occurrence-mismatch', 'the observation occurrence does not match the recorded attempt');
  }
  if (observation.attemptId !== attemptId) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.attempt-mismatch', 'the observation attempt does not match the recorded attempt');
  }
  if (JSON.stringify(observation.bundleReference) !== JSON.stringify(plan.bundleReference)) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.bundle-mismatch', 'the observation bundle reference does not match the executed plan');
  }
  if (observation.sessionCorrelationId !== sessionCorrelationId || observation.turnCorrelationId !== turnCorrelationId) {
    return failure('EXEC-OBSERVATION-UNCORRELATED', 'observation.session-turn-mismatch', 'the observation session/turn correlation does not match the host report');
  }

  // ─── 10. bounded outcome + retry classification (§4.2) ────────────────────
  const timeCall = safeCall(() => (identity['nowUtcIso'] as () => string)());
  if (!timeCall.ok || typeof timeCall.value !== 'string' || timeCall.value.length === 0) {
    return failure('EXEC-INTERNAL-FAILURE', 'identity.time-source-invalid', 'the trusted time source failed or returned an invalid timestamp');
  }
  const disposition = mapDisposition(observation.completionStatus, hostFacts as unknown as HostExecutionFacts);
  const retryable = disposition === 'failed' || disposition === 'cancelled' || disposition === 'timed-out' || disposition === 'crashed';
  const outcome: ExecutionAttemptOutcome = Object.freeze({
    disposition,
    occurrenceId: reservedOccurrenceId,
    attemptId,
    ordinal,
    observedAt: timeCall.value,
    ...(sessionCorrelationId !== undefined ? { sessionCorrelationId } : {}),
    ...(turnCorrelationId !== undefined ? { turnCorrelationId } : {}),
    retry: Object.freeze({
      eligible: retryable,
      ...(!retryable ? { reason: terminalReason(disposition) } : {}),
    }),
  });

  const success: ExecutionAttemptSuccess = {
    ok: true,
    attemptId,
    ordinal,
    attemptRecordId: recordedEvidence.attemptRecordId ?? recordedEvidence.recordId,
    observation,
    outcome,
  };
  return success;
}
