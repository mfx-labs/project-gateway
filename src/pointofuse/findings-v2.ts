/**
 * WP-6 Phase 3A: typed fail-closed Phase-3 boundary findings (POU2 namespace,
 * contract Section 20). Findings are immutable, deterministic, root-safe,
 * path-safe, and secret-free: static messages only, no caller destination
 * text, no canonical paths, no hostile object stringification, and no raw
 * exception stacks.
 *
 * Exact POU2 code strings are implementation-owned; the closed catalog and its
 * stage mapping are documented in the Phase-3A implementation report. The
 * catalog below is the Phase-3A boundary subset (contract Section 20 lists the
 * full closed family; later phases add their semantic families).
 */
import type { RouterFailureStage } from './router-types.js';
import { mk } from '../internal/report.js';
import type { Finding } from '../internal/report.js';
import type { FailureCategory, ValidationPhase } from '../internal/phase.js';

// Phase/category constants used by the committed point-of-use findings.
const POU_PHASE = 'point-of-use-eligibility' as ValidationPhase;
const AGGREGATE_CATEGORY = 'AGGREGATE-RESPONSIBILITY-FAILURE' as FailureCategory;

export type POU2FindingCode =
  | 'POU2-001' // router-shell structural failure (unknown/missing/hostile shell fields)
  | 'POU2-002' // outer route-version failure (routeProtocolVersion not the exact literal)
  | 'POU2-003' // legacy-declaration failure (legacyCompatibilityMode missing or not exact literal)
  | 'POU2-004' // nested v2 input capture failure (structure, unknown fields, accessors, traps)
  | 'POU2-005' // inner PointOfUseInputs version missing
  | 'POU2-006' // inner PointOfUseInputs version mismatch (not the exact literal "2")
  | 'POU2-007' // workspace capture failure (non-string or hostile workspace fields)
  | 'POU2-008' // callable-view adaptation failure
  | 'POU2-009' // lifecycle records-array snapshot failure (hostile array or duplicate record IDs)
  | 'POU2-010' // registry or lifecycle-record runtime-brand failure
  | 'POU2-011' // bare-model capture failure (bundle/policy/grant)
  | 'POU2-012' // static-projection construction failure
  | 'POU2-013' // static-input identity construction failure
  | 'POU2-014' // result-identity construction failure
  | 'POU2-015' // trusted-configuration genuineness failure (router boundary)
  | 'POU2-016' // unsupported trusted-configuration version (defensive; unreachable for genuine configs)
  | 'POU2-017' // unknown workspace (router boundary)
  | 'POU2-018' // legacy-not-permitted (v1 request under a v2-required configuration)
  | 'POU2-019' // unexpected internal evaluation exception (router boundary)
  | 'POU2-020' // semantic: configured global capability ceiling denies the requested capability
  | 'POU2-021' // semantic: configured workspace capability ceiling denies the requested capability
  | 'POU2-022'; // semantic: captured RuntimeGrant record type is not "RuntimeGrant"

export interface POU2Finding {
  readonly code: POU2FindingCode;
  /** Stable machine-readable message key. */
  readonly messageKey: string;
  /** Deterministic human-readable message (static; no paths, secrets, or stacks). */
  readonly message: string;
  /** Closed router-failure stage this finding maps to (contract Section 20). */
  readonly stage: RouterFailureStage;
}

export function pou2Finding(
  code: POU2FindingCode,
  messageKey: string,
  message: string,
  stage: RouterFailureStage,
): POU2Finding {
  return Object.freeze({ code, messageKey, message, stage });
}

/** Deterministic ordering: code, then message key (locale-independent). */
export function sortPou2Findings(findings: readonly POU2Finding[]): POU2Finding[] {
  return [...findings].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.messageKey !== b.messageKey) return a.messageKey < b.messageKey ? -1 : 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Closed Phase-3A finding catalog with fixed static messages.
// ---------------------------------------------------------------------------

/** Router-shell structural failure (unknown, missing, or hostile shell fields). */
export function findingShellStructural(): POU2Finding {
  return pou2Finding('POU2-001', 'pou2.shell-structural', 'point-of-use router request shell is malformed or hostile', 'shell-structural');
}

/** Outer route-version failure (routeProtocolVersion not the exact literal). */
export function findingRouteTag(): POU2Finding {
  return pou2Finding('POU2-002', 'pou2.route-version', 'point-of-use router route protocol version is unsupported', 'route-tag');
}

/** Legacy-declaration failure (legacyCompatibilityMode missing or not the exact literal). */
export function findingLegacyDeclaration(): POU2Finding {
  return pou2Finding('POU2-003', 'pou2.legacy-declaration', 'point-of-use legacy compatibility declaration is missing or unsupported', 'legacy-declaration');
}

/** Nested v2 input capture failure. */
export function findingNestedInputCapture(): POU2Finding {
  return pou2Finding('POU2-004', 'pou2.nested-input-capture', 'point-of-use v2 input record is malformed or hostile', 'input-capture');
}

/** Inner PointOfUseInputs version missing. */
export function findingInnerVersionMissing(): POU2Finding {
  return pou2Finding('POU2-005', 'pou2.inner-version-missing', 'point-of-use input protocol version is missing', 'inner-version-missing');
}

/** Inner PointOfUseInputs version mismatch (not the exact literal "2"). */
export function findingInnerVersionMismatch(): POU2Finding {
  return pou2Finding('POU2-006', 'pou2.inner-version-mismatch', 'point-of-use input protocol version is unsupported', 'inner-version-mismatch');
}

/** Workspace capture failure. */
export function findingWorkspaceCapture(): POU2Finding {
  return pou2Finding('POU2-007', 'pou2.workspace-capture', 'point-of-use workspace fields are malformed or hostile', 'workspace-capture');
}

/** Callable-view adaptation failure. */
export function findingViewAdaptation(): POU2Finding {
  return pou2Finding('POU2-008', 'pou2.view-adaptation', 'point-of-use callable view member is missing or hostile', 'view-adaptation');
}

/** Lifecycle records-array snapshot failure. */
export function findingLifecycleSnapshot(): POU2Finding {
  return pou2Finding('POU2-009', 'pou2.lifecycle-snapshot', 'point-of-use lifecycle records snapshot is malformed or duplicate', 'lifecycle-snapshot');
}

/** Registry or lifecycle-record runtime-brand failure. */
export function findingOperandBrand(): POU2Finding {
  return pou2Finding('POU2-010', 'pou2.operand-brand', 'point-of-use registry or lifecycle record is not runtime-genuine', 'operand-brand');
}

/** Bare-model capture failure (bundle/policy/grant). */
export function findingModelCapture(): POU2Finding {
  return pou2Finding('POU2-011', 'pou2.model-capture', 'point-of-use bundle, policy, or grant model is malformed or hostile', 'model-capture');
}

/** Static-projection construction failure. */
export function findingStaticProjection(): POU2Finding {
  return pou2Finding('POU2-012', 'pou2.static-projection', 'point-of-use static input projection construction failed', 'static-projection');
}

/** Static-input identity construction failure. */
export function findingStaticIdentity(): POU2Finding {
  return pou2Finding('POU2-013', 'pou2.static-identity', 'point-of-use static input identity computation failed', 'static-identity');
}

/** Result-identity construction failure. */
export function findingResultIdentity(): POU2Finding {
  return pou2Finding('POU2-014', 'pou2.result-identity', 'point-of-use result identity computation failed', 'identity-construction');
}

/** Trusted-configuration genuineness failure (router boundary; no identities). */
export function findingConfigNotGenuine(): POU2Finding {
  return pou2Finding('POU2-015', 'pou2.config-not-genuine', 'trusted configuration is not runtime-genuine', 'config-not-genuine');
}

/** Unsupported trusted-configuration version (defensive; unreachable for genuine configs). */
export function findingConfigVersion(): POU2Finding {
  return pou2Finding('POU2-016', 'pou2.config-version', 'trusted configuration version is unsupported', 'config-version');
}

/** Unknown workspace (router boundary; no identities). */
export function findingWorkspaceUnknown(): POU2Finding {
  return pou2Finding('POU2-017', 'pou2.workspace-unknown', 'workspace is not registered in the trusted configuration', 'workspace-unknown');
}

/** Legacy-not-permitted: a v1 legacy request under a v2-required configuration. */
export function findingLegacyNotPermitted(): POU2Finding {
  return pou2Finding('POU2-018', 'pou2.legacy-not-permitted', 'legacy point-of-use evaluation is not permitted for this configuration', 'legacy-not-permitted');
}

/** Unexpected internal evaluation exception (router boundary; static message only). */
export function findingEvaluationException(): POU2Finding {
  return pou2Finding('POU2-019', 'pou2.evaluation-exception', 'point-of-use evaluation failed unexpectedly', 'evaluation-exception');
}

/**
 * Semantic finding: the configured global capability ceiling denies the
 * requested capability. Committed Finding shape; rule IDs are closed
 * implementation-owned identifiers that sort before every numeric finding
 * under the committed deterministic ordering (capability intersection
 * precedes numeric narrowing per contract Section 18).
 */
export function semanticGlobalCapabilityCeilingDenial(subjectIdentity: string): Finding {
  return mk(
    POU_PHASE,
    AGGREGATE_CATEGORY,
    'pou2.global-capability-ceiling-denial',
    'requested capability is denied by the configured global capability ceiling',
    { ruleIds: ['000-GLOBAL-CAPABILITY-CEILING', 'POU2-020'], subjectIdentity, location: '/capability' },
  );
}

/**
 * Semantic finding: the captured RuntimeGrant model has a record type other
 * than `RuntimeGrant` (grant gate step 2; contract Section 15). Committed
 * Finding shape with the LFC-008 family; deterministic ordering follows the
 * committed sort.
 */
export function semanticGrantRecordTypeDenial(subjectIdentity: string): Finding {
  return mk(
    POU_PHASE,
    'POINT-OF-USE-FAILURE' as FailureCategory,
    'pou2.grant-record-type',
    'runtime grant record type is not RuntimeGrant',
    { ruleIds: ['LFC-008', 'POU2-022'], subjectIdentity, location: '/record_type' },
  );
}

/**
 * Semantic finding: the configured workspace capability ceiling denies the
 * requested capability (same ordering contract as the global variant).
 */
export function semanticWorkspaceCapabilityCeilingDenial(subjectIdentity: string): Finding {
  return mk(
    POU_PHASE,
    AGGREGATE_CATEGORY,
    'pou2.workspace-capability-ceiling-denial',
    'requested capability is denied by the configured workspace capability ceiling',
    { ruleIds: ['000-WORKSPACE-CAPABILITY-CEILING', 'POU2-021'], subjectIdentity, location: '/capability' },
  );
}
