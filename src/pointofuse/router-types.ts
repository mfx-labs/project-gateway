/**
 * WP-6 Phase 3A: internal PointOfUse v2 protocol and router types (normative
 * contract Sections 3–5, 14, 19; superseded alternatives in Section 24 are
 * non-normative). This is an internal trusted-layer surface: nothing in this
 * module is exported from the package root, and no Phase-3 type or function
 * may be re-exported through `src/index.ts`.
 *
 * The v2 input carries no nested configuration, no caller capability ceilings,
 * no caller numeric ceilings, no containment decisions, and no caller-supplied
 * correlation or trust-bearing identity fields. The static-input projection is
 * the exact closed fixed-shape projection of contract Section 14: unknown keys
 * are impossible by construction, optional operands use explicit tagged
 * absence, and captured models are embedded as deeply frozen JSON values that
 * are canonicalized when the complete projection is JCS-serialized exactly
 * once.
 */
import type {
  EligibilityReport,
  EligibilityReportV2,
  PointOfUseInputs,
  PointOfUseInputsV2DataAndViews,
  ValidatedLifecycleRecord,
  ValidatedRegistrySnapshot,
} from '../api/types.js';
import type { POU2Finding } from './findings-v2.js';

/** Deeply frozen plain JSON value (the embedded representation of captured models). */
export type ImmutableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ImmutableJsonValue[]
  | { readonly [key: string]: ImmutableJsonValue };

/** Exact router-shell protocol version literals. */
export const ROUTE_PROTOCOL_VERSION_1 = '1' as const;
export const ROUTE_PROTOCOL_VERSION_2 = '2' as const;
/** Exact legacy-compatibility declaration literal (contract Section 3). */
export const LEGACY_COMPATIBILITY_MODE = 'explicit-legacy-test' as const;
/** Exact inner PointOfUseInputs protocol version literal. */
export const POINT_OF_USE_INPUTS_PROTOCOL_VERSION_2 = '2' as const;

export interface V1RouterRequestVariant {
  readonly routeProtocolVersion: typeof ROUTE_PROTOCOL_VERSION_1;
  readonly legacyCompatibilityMode: typeof LEGACY_COMPATIBILITY_MODE;
  readonly inputs: PointOfUseInputs;
}

export interface V2RouterRequestVariant {
  readonly routeProtocolVersion: typeof ROUTE_PROTOCOL_VERSION_2;
  readonly inputs: PointOfUseInputsV2DataAndViews;
}

/** Exact router request union (contract Section 3). */
export type VersionedPointOfUseRouterRequest = V1RouterRequestVariant | V2RouterRequestVariant;

/**
 * Closed router-failure stage vocabulary (contract Section 20). Phase 3A uses
 * the boundary subset; later phases use the remaining stages. The union is
 * closed; a new stage requires an explicit protocol update.
 */
export type RouterFailureStage =
  | 'config-not-genuine'
  | 'shell-structural'
  | 'route-tag'
  | 'legacy-declaration'
  | 'workspace-capture'
  | 'config-version'
  | 'workspace-unknown'
  | 'legacy-not-permitted'
  | 'input-capture'
  | 'view-adaptation'
  | 'lifecycle-snapshot'
  | 'operand-brand'
  | 'model-capture'
  | 'inner-version-missing'
  | 'inner-version-mismatch'
  | 'static-projection'
  | 'static-identity'
  | 'identity-construction'
  | 'evaluation-exception';

/** Exact router result family (contract Section 4); discriminator is the `kind` literal. */
export type PointOfUseRoutingResult =
  | { readonly kind: 'router-failure'; readonly stage: RouterFailureStage; readonly findings: readonly POU2Finding[] }
  | { readonly kind: 'eligibility-v1'; readonly eligibility: EligibilityReport }
  | { readonly kind: 'eligibility-v2'; readonly eligibility: EligibilityReportV2 };

// ---------------------------------------------------------------------------
// Static-input projection (contract Section 14, HCRR-02)
// ---------------------------------------------------------------------------

export type TaggedCapabilitySet =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly capabilities: readonly string[] };

export type TaggedNumericValue =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: number };

export type TaggedCapturedModel =
  | { readonly state: 'present'; readonly capturedModel: ImmutableJsonValue };

export type StaticGrantProjection =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly capturedModel: ImmutableJsonValue };

export interface RegistryProjection {
  readonly registryProtocolId: string;
  readonly registrySnapshotFormatVersion: string;
  readonly registrySnapshotId: string;
  readonly registrySnapshotDigest: string;
}

export interface StaticLifecycleRecordProjection {
  readonly recordId: string;
  readonly model: ImmutableJsonValue;
}

export interface ConsumerSupportProjection {
  readonly consumerId: string;
  readonly supportedProtocolFeatures: readonly string[];
  readonly supportedConsumerCapabilities: readonly string[];
  readonly supportedExtensionNamespaces: readonly string[];
}

export interface RequestedUseProjection {
  readonly capability: string;
  readonly capabilityVersion?: string;
  readonly operationClass: string;
  readonly resourceClass: string;
  readonly scope: string;
  readonly workspaceId: string;
}

/** Exact fixed-shape static-input projection (contract Section 14). */
export interface PointOfUseStaticInputProjection {
  readonly projectionProtocolVersion: '1';
  readonly outerRouterVersion: '2';
  readonly innerPointOfUseInputsVersion: '2';
  readonly configurationVersion: '1' | '2';
  readonly configurationIdentity: string;
  readonly capabilityVocabularyVersion: string;
  readonly inputWorkspaceId: string;
  readonly requestedUseWorkspaceId: string;
  readonly requestedUse: RequestedUseProjection;
  readonly currentTime: string;
  readonly configuredGlobalCapabilityCeiling: TaggedCapabilitySet;
  readonly configuredWorkspaceCapabilityCeiling: TaggedCapabilitySet;
  readonly configuredGlobalNumericCeiling: TaggedNumericValue;
  readonly configuredWorkspaceNumericCeiling: TaggedNumericValue;
  readonly consumerSupport: ConsumerSupportProjection;
  readonly bundle: TaggedCapturedModel;
  readonly policy: TaggedCapturedModel;
  readonly grant: StaticGrantProjection;
  readonly registry: RegistryProjection;
  readonly lifecycleRecords: readonly StaticLifecycleRecordProjection[];
}

/**
 * Internal builder parameter object for the static projection (contract
 * Section 14: "The builder may consume only already captured values and
 * genuine configuration-derived scalars supplied through an internal parameter
 * object"). The builder never reads hostile input objects.
 */
export interface StaticProjectionInput {
  readonly configurationVersion: '1' | '2';
  readonly configurationIdentity: string;
  readonly capabilityVocabularyVersion: string;
  readonly inputWorkspaceId: string;
  readonly requestedUseWorkspaceId: string;
  readonly requestedUse: RequestedUseProjection;
  readonly currentTime: string;
  readonly configuredGlobalCapabilityCeiling: TaggedCapabilitySet;
  readonly configuredWorkspaceCapabilityCeiling: TaggedCapabilitySet;
  readonly configuredGlobalNumericCeiling: TaggedNumericValue;
  readonly configuredWorkspaceNumericCeiling: TaggedNumericValue;
  readonly consumerSupport: ConsumerSupportProjection;
  /** Required v2 input: always embedded as present. */
  readonly bundle: ImmutableJsonValue;
  /** Required v2 input: always embedded as present. */
  readonly policy: ImmutableJsonValue;
  readonly grant: StaticGrantProjection;
  readonly registry: RegistryProjection;
  readonly lifecycleRecords: readonly StaticLifecycleRecordProjection[];
}

// ---------------------------------------------------------------------------
// Detached v1/v2 input records (internal; contract Sections 5 and 8)
// ---------------------------------------------------------------------------

export interface DetachedRegistryContext {
  readonly registryProtocolId: string;
  readonly registrySnapshotFormatVersion: string;
  readonly registrySnapshotId: string;
  readonly registrySnapshotDigest: string;
  /** Branded registry snapshot wrapper, retained by reference (never deep-cloned). */
  readonly snapshot: ValidatedRegistrySnapshot;
}

export interface DetachedLifecycleView {
  /** Fresh frozen array of the exact branded wrapper references (Model A). */
  readonly records: readonly ValidatedLifecycleRecord[];
  /** Deterministic lookup built only from the frozen snapshot (the sole semantic source). */
  readonly lookup: ReadonlyMap<string, ValidatedLifecycleRecord>;
  /**
   * Interface-fidelity member backed by the deterministic lookup. The caller's
   * live `findRecord` is never consulted as a semantic source.
   */
  readonly findRecord: (recordId: string) => ValidatedLifecycleRecord | undefined;
}

/** V2 consumer support after canonicalization (sorted; duplicates rejected). */
export type DetachedConsumerSupportV2 = ConsumerSupportProjection;

/** V1 consumer support: captured order preserved, duplicates tolerated (v1 semantics). */
export interface DetachedConsumerSupportV1 {
  readonly consumerId: string;
  readonly supportedProtocolFeatures: readonly string[];
  readonly supportedConsumerCapabilities: readonly string[];
  readonly supportedExtensionNamespaces: readonly string[];
}

export interface DetachedV2Input {
  readonly pointOfUseInputsProtocolVersion: '2';
  readonly workspaceId: string;
  readonly requestedUse: RequestedUseProjection;
  readonly currentTime: string;
  readonly consumerSupport: DetachedConsumerSupportV2;
  readonly identity: IdentityViewAdapter;
  readonly resolver: ResolverViewAdapter;
  readonly registry: DetachedRegistryContext;
  readonly lifecycle: DetachedLifecycleView;
  readonly revocations: RevocationsViewAdapter;
  readonly bundle: ImmutableJsonValue;
  readonly policy: ImmutableJsonValue;
  readonly grant: StaticGrantProjection;
}

export interface DetachedV1Input {
  readonly currentTime: string;
  readonly workspaceId: string;
  readonly requestedUse: RequestedUseProjection;
  readonly globalActionCeiling?: number;
  readonly workspaceActionCeiling?: number;
  readonly consumerSupport: DetachedConsumerSupportV1;
  readonly identity: IdentityViewAdapter;
  readonly resolver: ResolverViewAdapter;
  readonly registry: DetachedRegistryContext;
  readonly lifecycle: DetachedLifecycleView;
  readonly revocations: RevocationsViewAdapter;
  readonly bundle: ImmutableJsonValue;
  readonly policy: ImmutableJsonValue;
  readonly grant: StaticGrantProjection;
}

// ---------------------------------------------------------------------------
// Receiver-bound callable-view adapters (contract Section 7)
// ---------------------------------------------------------------------------

export interface IdentityViewAdapter {
  readonly findInstance: (instanceId: string) => unknown;
  readonly findRevision: (revisionId: string) => unknown;
  readonly findPredecessor: (instanceId: string, revisionId: string) => unknown;
  readonly verifyRegistration: (instanceId: string, revisionId: string, digest: string) => boolean;
}

export interface ResolverViewAdapter {
  readonly resolve: (reference: unknown) => unknown;
}

export interface RevocationsViewAdapter {
  readonly revocationsByTarget: (recordId: string) => readonly { recordId: string; effectiveAt: string; scope: string }[];
}

// ---------------------------------------------------------------------------
// Result identity projection (contract Section 19)
// ---------------------------------------------------------------------------

export interface NormalizedResultFindingProjection {
  readonly phase: string;
  readonly category: string;
  readonly messageKey: string;
  readonly ruleIds: readonly string[];
  readonly subjectIdentity?: string;
  readonly location?: string;
}

export interface NormalizedEligibilityReportWithoutResultIdentity {
  readonly eligible: boolean;
  readonly requestedUse: RequestedUseProjection;
  readonly capability: string;
  readonly scope: string;
  readonly workspaceId: string;
  readonly subjectCorrelations: Readonly<Record<string, string>>;
  readonly firstFailingPhase?: string;
  readonly categories: readonly string[];
  readonly ruleIds: readonly string[];
  readonly findings: readonly NormalizedResultFindingProjection[];
}

/** Non-circular result-identity projection (contract Section 19). */
export interface PointOfUseResultIdentityProjection {
  readonly pointOfUseResultIdentityProtocolVersion: '1';
  readonly routingVariant: 'v2';
  readonly staticInputCorrelationIdentity: string;
  readonly normalizedReport: NormalizedEligibilityReportWithoutResultIdentity;
}
