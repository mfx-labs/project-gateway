/**
 * WP-13A — execution foundation type vocabulary.
 *
 * The execution foundation is the transport-free, I/O-free WP-13 core that
 * turns a validated execution request into a recorded, executed,
 * observation-bound attempt with a bounded host-side outcome. It performs
 * NO lifecycle publication, NO result production, NO receipt production,
 * and NO pi-guard activation: every trusted capability enters through the
 * two narrow injected boundaries (control-plane and Pi host), and WP-12
 * remains the authoritative recorder/gate for attempts.
 *
 * Trust separation is structural: the untrusted request carries only
 * workspace/occurrence operands; the plan, enforcement evidence, previous
 * attempt outcome, and the two boundaries are host-injected and never
 * request-supplied.
 *
 * Committed contract: docs/reports/wp-13-pre-implementation-contract-decision.md
 * (Decisions 1–2 scope: execution foundation only; no CompletionContract
 * evaluation, no ExecutionResult, no ADR-038 publication authority, no
 * ExecutionRetrospectiveFacts — those remain WP-13B/C/D).
 */
import { OCCURRENCE_ID_RE, WORKSPACE_ID_RE } from '../control-plane/types.js';
import type { PiEnforcementEvidence, GuardActivationDecision } from '../adapters/pi/enforcement/types.js';
import type { PiExecutionObservation, PiHostBridge, PiInvocationPlan } from '../adapters/pi/types.js';

export { OCCURRENCE_ID_RE, WORKSPACE_ID_RE };

// ─── closed attempt disposition vocabulary (committed execution-result-body) ─

/** The closed execution disposition vocabulary (execution-result-body schema). */
export const EXECUTION_ATTEMPT_DISPOSITIONS = ['completed', 'incomplete', 'failed', 'cancelled', 'timed-out', 'crashed', 'rejected'] as const;
export type ExecutionAttemptDisposition = (typeof EXECUTION_ATTEMPT_DISPOSITIONS)[number];

/** Retry classification per the committed retry rule (§4.2). */
export type RetryClassification = 'retryable' | 'terminal';

/** Closed non-proposal reasons (committed retry rule §4.2/§4.3/§4.8). */
export const RETRY_NON_PROPOSAL_REASONS = [
  'terminal-completed',
  'terminal-rejected',
  'terminal-ambiguous',
  'basis-ambiguous',
  'basis-stale',
  'subject-mismatch',
  'allowance-exhausted',
  'grant-not-current',
] as const;
export type RetryNonProposalReason = (typeof RETRY_NON_PROPOSAL_REASONS)[number];

// ─── closed failure taxonomy ────────────────────────────────────────────────

/**
 * Closed WP-13A failure categories. Failures are deterministic and never
 * disclose raw host exceptions, paths, or stack content.
 */
export const EXECUTION_FAILURE_CATEGORIES = [
  'EXEC-INPUT-INVALID',
  'EXEC-PLAN-UNCORRELATED',
  'EXEC-REVALIDATION-FAILED',
  'EXEC-ENFORCEMENT-UNAVAILABLE',
  'EXEC-ENFORCEMENT-UNCORRELATED',
  'EXEC-ENFORCEMENT-STALE',
  'EXEC-RETRY-DENIED',
  'EXEC-RETRY-AMBIGUOUS',
  'EXEC-ATTEMPT-RECORDING-FAILED',
  'EXEC-OBSERVATION-UNCORRELATED',
  'EXEC-HOST-FAILURE',
  'EXEC-INTERNAL-FAILURE',
] as const;
export type ExecutionFailureCategory = (typeof EXECUTION_FAILURE_CATEGORIES)[number];

// ─── untrusted request model ────────────────────────────────────────────────

/** Untrusted WP-13A execution request operands (never authority-bearing). */
export interface ExecutionAttemptRequest {
  /** Exact trusted workspace identity (committed `pgw:w:` syntax). */
  readonly workspaceId: string;
  /** Exact reserved occurrence identity (committed `pgw:o:` syntax). */
  readonly reservedOccurrenceId: string;
}

// ─── durable attempt facts (WP-12 store-derived; read-only) ─────────────────

/** One durable ExecutionAttemptRecord fact (boundary-derived; immutable). */
export interface DurableAttemptFact {
  readonly recordId: string;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly runtimeGrantId: string;
  /** The exact bundle reference of the attempt (byte-comparable). */
  readonly bundle: Readonly<Record<string, unknown>>;
}

// ─── narrow control-plane boundary (host-injected) ─────────────────────────

/** Narrow decision evidence from the WP-12 control plane (correlation only). */
export interface ControlPlaneDecisionEvidence {
  readonly outcome: 'orchestrated' | 'attempt-recorded';
  readonly recordId: string;
  readonly occurrenceRecordId: string;
  readonly activationRecordId: string;
  readonly runtimeGrantId: string;
  /** The exact occurrence bundle subject (identity fields). */
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
  readonly workspaceId: string;
  /** orchestrationDecision only: derived grant currentness fact. */
  readonly grantCurrent?: boolean;
  /** orchestrationDecision only: derived remaining allowance. */
  readonly remainingAllowance?: number;
  /** recordExecutionAttempt only: the internally allocated attempt identity. */
  readonly attemptId?: string;
  /** recordExecutionAttempt only: the recorded ordinal. */
  readonly ordinal?: number;
  readonly attemptRecordId?: string;
}

export type ControlPlaneDecisionResult =
  | { readonly ok: true; readonly evidence: ControlPlaneDecisionEvidence }
  | { readonly ok: false; readonly category: string; readonly code: string; readonly message: string };

/**
 * The ONLY control-plane surface WP-13A may touch: decision-only
 * orchestration, attempt recording, and durable attempt reads. WP-13A never
 * holds a store boundary, never publishes, and never reads other lifecycle
 * classes.
 */
export interface ControlPlaneExecutionBoundary {
  /** WP-12 orchestrationDecision (EXE-007 point-of-use; zero records). */
  readonly orchestrationDecision: (workspaceId: string, reservedOccurrenceId: string) => ControlPlaneDecisionResult;
  /** WP-12 recordExecutionAttempt (authoritative recorder/gate; ordinal proposed by WP-13A). */
  readonly recordExecutionAttempt: (workspaceId: string, reservedOccurrenceId: string, ordinal: number) => ControlPlaneDecisionResult;
  /** Durable attempt-count/ordinal source: the immutable ExecutionAttemptRecord set for the occurrence (S4-D3). */
  readonly durableAttempts: (reservedOccurrenceId: string) => readonly DurableAttemptFact[];
}

// ─── Pi host boundary (host-injected) ───────────────────────────────────────

/** Live pi-guard enforcement state (fresh host reading; present-state only). */
export type EnforcementStateSnapshot =
  | {
      readonly available: true;
      readonly active: boolean;
      readonly mode: 'PROJECTED' | 'RESTORED' | 'NONE';
      readonly projectionIdentity: string;
      readonly permittedProfile: readonly string[];
      /** Live effective-surface sample (name+source) for the stability check. */
      readonly surfaceEntries: readonly { readonly name: string; readonly source: string }[];
    }
  | { readonly available: false };

/** Raw execution-layer facts reported by the host (never authority). */
export interface HostExecutionFacts {
  readonly bridge: PiHostBridge;
  readonly sessionCorrelationId?: string;
  readonly turnCorrelationId?: string;
  /** Host-observed execution-layer outcomes not derivable from adapter events. */
  readonly timedOut?: boolean;
  readonly crashed?: boolean;
  readonly enforcementDenied?: boolean;
}

export type HostRunResult =
  | { readonly ok: true; readonly facts: HostExecutionFacts }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * The ONLY Pi execution surface WP-13A may touch. The host wires the real
 * Pi host (WP-5A bridge + pi-guard composition); WP-13A never spawns,
 * never activates/restores pi-guard, and never reads the tool inventory.
 */
export interface ExecutionHostBoundary {
  /** Fresh live pi-guard enforcement state (never cached evidence). */
  readonly readEnforcementState: () => EnforcementStateSnapshot;
  /** WP-5A plan projection for the RECORDED attempt (host-side projection). */
  readonly projectPlan: (attemptId: string) => { readonly ok: true; readonly plan: PiInvocationPlan } | { readonly ok: false; readonly code: string; readonly message: string };
  /** Execute one attempt under the already-active enforcement. */
  readonly execute: (request: { readonly plan: PiInvocationPlan }) => HostRunResult;
}

// ─── identity source ────────────────────────────────────────────────────────

/** Host-owned time source (accepted UTC timestamp form). */
export interface ExecutionIdentitySource {
  readonly nowUtcIso: () => string;
}

// ─── enforcement input (host-supplied activation facts) ─────────────────────

/**
 * The occurrence's pi-guard activation evidence (WP-5B) plus the WP-12
 * activation correlation facts. Host-supplied from the occurrence's
 * activation run; never persisted, never self-reactivated (WP-5B restart
 * rule); WP-13A verifies correlation and LIVE state only.
 */
export interface ExecutionEnforcementInput {
  readonly evidence: PiEnforcementEvidence;
  readonly activation: GuardActivationDecision;
}

// ─── complete input + results ───────────────────────────────────────────────

/** One complete WP-13A execution-attempt input (host-assembled). */
export interface ExecutionAttemptInput {
  readonly request: ExecutionAttemptRequest;
  /** The occurrence's pi-guard activation evidence (host-supplied). */
  readonly enforcement: ExecutionEnforcementInput;
  /** The in-session outcome of the immediately preceding attempt (retry basis; absent for the first attempt). */
  readonly previousOutcome?: ExecutionAttemptOutcome;
  readonly host: ExecutionHostBoundary;
  readonly controlPlane: ControlPlaneExecutionBoundary;
  readonly identity: ExecutionIdentitySource;
}

/** Bounded host-side attempt outcome (retry-rule input; never persisted). */
export interface ExecutionAttemptOutcome {
  readonly disposition: ExecutionAttemptDisposition;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly observedAt: string;
  readonly sessionCorrelationId?: string;
  readonly turnCorrelationId?: string;
  /** Disposition classification per the committed retry rule (§4.2). */
  readonly retry: { readonly eligible: boolean; readonly reason?: RetryNonProposalReason };
}

export interface ExecutionAttemptSuccess {
  readonly ok: true;
  readonly attemptId: string;
  readonly ordinal: number;
  readonly attemptRecordId: string;
  /** The validated branded observation (exact correlation). */
  readonly observation: PiExecutionObservation;
  readonly outcome: ExecutionAttemptOutcome;
}

export interface ExecutionAttemptFailure {
  readonly ok: false;
  readonly category: ExecutionFailureCategory;
  readonly code: string;
  readonly message: string;
}

export type ExecutionAttemptResult = ExecutionAttemptSuccess | ExecutionAttemptFailure;
