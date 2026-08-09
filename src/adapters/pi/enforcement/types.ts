/**
 * WP-5B — pi-guard enforcement / activation-evidence integration (public types).
 *
 * Consumes committed primitives only: the WP-5A `PiInvocationPlan` (validated,
 * `projection-ready`, `piGuardEnforcementPending`), the WP-6 validated
 * `EligibilityReport`, WP-12 control-plane activation facts, the validated
 * trusted-extension expectations, and the released pi-guard v0.1.2 trusted
 * projection API captured by the environment-gated Gateway host harness.
 *
 * WP-5B is enforcement-and-evidence integration only: it never reinterprets
 * `AuthorityPolicy`, `RuntimeGrant`, ceilings, or capability intersection,
 * never issues lifecycle records, never executes tools, and never issues
 * authority. `PiEnforcementEvidence` is correlation/evidence only.
 */
import type { ConsumerSupportDeclaration, EligibilityReport } from '../../../index.js';
import type { PiInvocationPlan } from '../types.js';
import type { ValidatedExpectedToolSource } from '../../../trusted/extension-set.js';

/** Verified pi-guard lane identity (released v0.1.2 compatibility lane). */
export const PI_GUARD_PACKAGE_ID = 'pi-guard';
export const PI_GUARD_VERIFIED_LANE = 'pi-guard-0.1.2';
export const PI_GUARD_VERSION = '0.1.2';
/** Released implementation commit (annotated tag v0.1.2 resolves to it). */
export const PI_GUARD_RELEASE_COMMIT = '7a7580cc4cbd7926797564c72269394fc29a860a';
export const PI_GUARD_RELEASE_TAG = 'v0.1.2';
/** Trusted-projection interface contract version (pi-guard v0.1.2). */
export const GUARD_PROJECTION_VERSION = 1;

/** WP-5B enforcement protocol / consumer identity. */
export const GUARD_ENFORCEMENT_PROTOCOL_VERSION = '1.0';
export const GUARD_CONSUMER_IDENTITY = 'project-gateway.artifact-core';
export const GUARD_CONSUMER_VERSION = '0.1.0';

/** Canonical projection identity domain (Part E; excludes timestamps/outcomes). */
export const GUARD_PROJECTION_IDENTITY_DOMAIN = 'PGAP-PI-ENFORCEMENT-PROJECTION-v1\u0000';
/** Canonical evidence fingerprint domain (Part E; includes timestamps + source id). */
export const GUARD_EVIDENCE_FINGERPRINT_DOMAIN = 'PGAP-PI-ENFORCEMENT-EVIDENCE-v1\u0000';

export type GuardActivationOutcome = 'applied' | 'failed-closed' | 'not-attempted';
export type GuardRestorationOutcome = 'verified' | 'failed' | 'not-applicable';

// ─── verified trusted projection API (released pi-guard v0.1.2 surface) ─────

/** Apply result vocabulary reported by the released pi-guard v0.1.2 API. */
export type TrustedProjectionApplyResult =
  | { readonly kind: 'invalid'; readonly code: string; readonly reason: string }
  | { readonly kind: 'fingerprintMismatch'; readonly expected: string; readonly actual: string; readonly reason: string }
  | { readonly kind: 'conflictingActivation'; readonly activeProjectionIdentity: string; readonly reason: string }
  | { readonly kind: 'idempotentReplay'; readonly projectionIdentity: string }
  | { readonly kind: 'applied'; readonly projectionIdentity: string; readonly profile: readonly string[] }
  | { readonly kind: 'applicationFailed'; readonly reason: string; readonly restorationVerified: boolean };

/** Inspection result vocabulary reported by the released pi-guard v0.1.2 API. */
export type TrustedProjectionInspection =
  | { readonly active: false; readonly mode: 'OFF' | 'INSPECT' | 'EDIT' | 'WRITE' }
  | {
      readonly active: true;
      readonly mode: 'PROJECTED';
      readonly projectionIdentity: string;
      readonly inventoryFingerprint: string;
      readonly permittedProfile: readonly string[];
    };

/** Restore result vocabulary reported by the released pi-guard v0.1.2 API. */
export type TrustedProjectionRestoreResult =
  | { readonly kind: 'not-applicable' }
  | { readonly kind: 'restored'; readonly restorationVerified: true }
  | { readonly kind: 'restorationFailed'; readonly restorationVerified: false };

/**
 * Narrow structural view of the process-local trusted projection API captured
 * from the pi-guard v0.1.2 extension factory (predicate 12). Only the
 * verified public surface is used; pi-guard internals are never accessed.
 */
export interface TrustedProjectionApi {
  readonly applyTrustedProjection: (projection: unknown) => TrustedProjectionApplyResult;
  readonly inspectActiveProjection: () => TrustedProjectionInspection;
  readonly restoreTrustedProjection: () => TrustedProjectionRestoreResult;
}

// ─── pi-guard compatibility (predicate 12–17) ────────────────────────────────

/** Stable WP-5B finding categories (bounded, deterministic). */
export type GuardFindingCategory =
  | 'GUARD-INPUT-INVALID'
  | 'GUARD-PLAN-UNCORRELATED'
  | 'GUARD-ELIGIBILITY-UNCORRELATED'
  | 'GUARD-ACTIVATION-UNCORRELATED'
  | 'GUARD-LANE-INCOMPATIBLE'
  | 'GUARD-SURFACE-UNAVAILABLE'
  | 'GUARD-INVENTORY-DRIFT'
  | 'GUARD-PROJECTION-FAILURE'
  | 'GUARD-ACTIVATION-FAILURE';

export interface GuardFinding {
  readonly category: GuardFindingCategory;
  readonly key: string;
  readonly message: string;
}

/** pi-guard lane package inspection (environment-gated discovery). */
export interface GuardPackageInspection {
  readonly inspected: boolean;
  readonly packagePath?: string;
  readonly packageId?: string;
  readonly version?: string;
  readonly extensionEntry?: string;
  readonly trustedApiCaptured: boolean;
  readonly compatible: boolean;
  readonly findings: readonly GuardFinding[];
}

/** Compatibility result over the verified public surface (predicate 17). */
export interface GuardCompatibilityResult {
  readonly compatible: boolean;
  readonly fingerprint: string;
  readonly verifiedLane: string;
  readonly releasedCommit: string;
  readonly releasedTag: string;
  readonly piGuardVersion: string;
  readonly observedSurface: Readonly<{ apiMethods: readonly string[]; frozen: boolean; projectionVersionSupported: boolean }>;
  readonly findings: readonly GuardFinding[];
}

/** Expected tool-source declarations (validated trusted extension set). */
export type ExpectedToolSource = ValidatedExpectedToolSource;

// ─── effective tool surface (F-R1) ───────────────────────────────────────────

/** One observed effective tool entry (name + surviving source). */
export interface EffectiveToolEntry {
  readonly name: string;
  readonly source: string;
}

/** Observed effective surface: registered entries plus the active set. */
export interface EffectiveToolSurface {
  readonly entries: readonly EffectiveToolEntry[];
  readonly activeTools: readonly string[];
  readonly sampledAt: string;
}

export interface EffectiveToolSurfaceObservation {
  readonly ok: boolean;
  readonly surface?: EffectiveToolSurface;
  readonly findings: readonly GuardFinding[];
}

// ─── projection ──────────────────────────────────────────────────────────────

export interface GuardProjectionInput {
  /** Evaluated/requested capability (validated eligibility; never reinterpreted). */
  readonly capability: string;
  /** Capability-vocabulary version binding. */
  readonly capabilityVocabularyVersion: string;
  readonly surface: EffectiveToolSurface;
  readonly expectedToolSources: readonly ExpectedToolSource[];
  readonly workspaceIdentity: string;
}

export interface GuardProjection {
  readonly capability: string;
  readonly allowedToolNames: readonly string[];
  readonly deniedToolNames: readonly string[];
  readonly unsupportedRequiredCapabilities: readonly string[];
  /** F-R4 canonical projection identity (see evidence.ts). */
  readonly projectionIdentity: string;
}

export type GuardProjectionResult =
  | { readonly ok: true; readonly projection: GuardProjection }
  | { readonly ok: false; readonly findings: readonly GuardFinding[] };

// ─── activation decision (WP-12 correlation facts) ───────────────────────────

/**
 * WP-12 control-plane activation correlation facts consumed by WP-5B. These
 * are decision correlation facts only (ADR-002 / §26.16 / §27): WP-5B binds
 * them to the exact plan occurrence/attempt and to grant currentness; it never
 * reads the underlying lifecycle records and never interprets policy/grant.
 */
export interface GuardActivationDecision {
  /** Control-plane activation decision ('accepted' required). */
  readonly decision: 'accepted' | 'denied';
  readonly runtimeGrantId: string;
  readonly reservedOccurrenceId: string;
  readonly resolvedOccurrenceId: string;
  readonly attemptId: string;
  /** Derived grant currentness fact (non-revoked, within validity). */
  readonly grantCurrent: boolean;
}

// ─── PiEnforcementEvidence (Part E) ──────────────────────────────────────────

/**
 * Deterministic enforcement evidence (Part E). It is NOT an `ExecutionResult`,
 * NOT a `TrustedReceipt`, and NOT proof of successful execution. It never
 * issues authority, approves artifacts, activates a RuntimeGrant, replaces
 * pi-guard runtime enforcement, or replaces local approval state.
 */
export interface PiEnforcementEvidence {
  readonly inputPlanIdentity: string;
  readonly planFingerprint: string;
  /** Single canonical definition (F-R4); excludes timestamps/outcomes. */
  readonly projectionIdentity: string;
  readonly authorityInputIdentities: {
    readonly globalCeilingsIdentity?: string;
    readonly workspaceCeilingsIdentity?: string;
    readonly policyRevisionId?: string;
    readonly grantIdentity: string;
    readonly consumerDeclarationIdentity: string;
  };
  readonly effectiveAuthorityIdentity: string;
  readonly piGuardIdentity: string;
  readonly piGuardVersion: string;
  readonly piIdentity: string;
  readonly piVersion: string;
  readonly observedToolInventoryIdentity: string;
  readonly projectedAllowedTools: readonly string[];
  readonly projectedDeniedTools: readonly string[];
  readonly unsupportedRequiredCapabilities: readonly string[];
  readonly activationOutcome: GuardActivationOutcome;
  readonly restorationOutcome: GuardRestorationOutcome;
  readonly compatibilityFindings: readonly GuardFinding[];
  /** Host-supplied only (ADR-022); never synthesized. */
  readonly timestampSource: string;
  /** Accepted host timestamp value embedded in the canonical evidence record
   *  (F-R2): included in `evidenceFingerprint`, excluded from
   *  `projectionIdentity`. */
  readonly observedAt: string;
  /** Deterministic SHA-256 over the canonical evidence serialization. */
  readonly evidenceFingerprint: string;
}

// ─── enforcement run ─────────────────────────────────────────────────────────

export interface GuardEnforcementInput {
  /** Validated WP-5A plan (projection-ready, piGuardEnforcementPending). */
  readonly plan: PiInvocationPlan;
  /** Validated, correlated eligibility evidence. */
  readonly eligibility: EligibilityReport;
  /** WP-12 activation correlation facts. */
  readonly activation: GuardActivationDecision;
  /** WP-6 ceiling identity versions (authority-input identities). */
  readonly globalCeilingsIdentity?: string;
  readonly workspaceCeilingsIdentity?: string;
  /** Exact AuthorityPolicy revision identity (correlation only). */
  readonly policyRevisionId?: string;
  /** Consumer-support declaration (authority-input identity). */
  readonly consumer: ConsumerSupportDeclaration;
  /** Workspace identity (must equal plan correlated eligibility workspace). */
  readonly workspaceIdentity: string;
  /** Capability-vocabulary version binding. */
  readonly capabilityVocabularyVersion: string;
  /** Validated trusted-extension expected source declarations. */
  readonly expectedToolSources: readonly ExpectedToolSource[];
  /** Point-of-use evaluator/interface version (F-R6). */
  readonly evaluatorVersion: string;
  /** Verified Pi host lane (WP-5A). */
  readonly piHost: { readonly piIdentity: string; readonly piVersion: string };
  /** Verified pi-guard lane inspection + captured trusted API. */
  readonly guard: { readonly packageInspection: GuardPackageInspection; readonly api: TrustedProjectionApi };
  /** Effective-surface reading (injected; deterministic over the host). */
  readonly surface: EffectiveToolSurface;
  /** Host-supplied accepted timestamp value (F-R2). */
  readonly hostTimestamp: string;
  /** Host-supplied timestamp-source identifier (ADR-022). */
  readonly timestampSource: string;
}

/** Deterministic, atomic enforcement run result (never authority). */
export type GuardEnforcementRunResult =
  | {
      readonly ok: true;
      readonly evidence: PiEnforcementEvidence;
      readonly active: { readonly projectionIdentity: string; readonly allowedToolNames: readonly string[] };
    }
  | {
      readonly ok: false;
      readonly evidence: PiEnforcementEvidence;
      readonly findings: readonly GuardFinding[];
    };
