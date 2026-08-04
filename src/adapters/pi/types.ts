/**
 * Pi adapter public types (WP-5A).
 *
 * The Pi adapter converts an already validated and point-of-use-eligible
 * ExecutionBundle (plus its four exact resolved prospective members) into a
 * deterministic Pi-compatible invocation plan and observes Pi-compatible
 * completion output. It is a pure projection and observation adapter: it never
 * authorizes, approves, activates, grants, or executes anything.
 */
import type {
  AcceptedRegistryContext,
  EligibilityReport,
  ExactArtifactReferenceModel,
  ImmutableModel,
  RequestedUse,
  ValidatedArtifact,
  ValidationLevel,
} from '../../index.js';

/** Adapter protocol version implemented by this module. */
export const PI_ADAPTER_PROTOCOL_VERSION = '1.0';

/** Stable supported Pi API lane (inspection-derived; see host-compatibility doc). */
export const SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1';

/** Supported project-gateway/pi consumer identity. */
export const PI_CONSUMER_IDENTITY = 'project-gateway.artifact-core';
export const PI_CONSUMER_VERSION = '0.1.0';

/** Plan status: projection-ready only. Authority statuses are never emitted. */
export type PiPlanStatus = 'projection-ready';

/** Observation completeness levels. */
export type PiObservationCompleteness = 'complete' | 'partial' | 'cancelled';

/** Stable adapter finding categories (bounded set). */
export type PiFindingCategory =
  | 'PI-ADAPTER-INPUT-INVALID'
  | 'PI-ADAPTER-BUNDLE-MISMATCH'
  | 'PI-ADAPTER-CONTEXT-MISMATCH'
  | 'PI-ADAPTER-CONTEXT-BOUND-EXCEEDED'
  | 'PI-ADAPTER-UNSUPPORTED-MEDIA'
  | 'PI-ADAPTER-HOST-INCOMPATIBLE'
  | 'PI-ADAPTER-REQUIRED-SEMANTIC-UNSUPPORTED'
  | 'PI-ADAPTER-PROJECTION-FAILURE'
  | 'PI-ADAPTER-HOST-OBSERVATION-FAILURE'
  | 'PI-ADAPTER-CORRELATION-MISMATCH';

/** Stable adapter finding. */
export interface PiFinding {
  readonly category: PiFindingCategory;
  /** Stable machine-readable key. */
  readonly key: string;
  readonly message: string;
  /** JSON-pointer-like location within the projection input where applicable. */
  readonly location?: string;
}

/** Caller-supplied adapter limits (bounded rendering). All textual limits are
 *  measured in UTF-8 bytes (one authoritative text-bound model; see
 *  `internal/unicode.ts`). */
export interface PiAdapterLimits {
  /** Maximum UTF-8 bytes per rendered context data block. */
  readonly maxContextItemBytes: number;
  /** Maximum UTF-8 bytes across all rendered context data blocks. */
  readonly maxTotalContextBytes: number;
  /** Maximum UTF-8 bytes of the entire rendered plan. */
  readonly maxPlanBytes: number;
  /** Maximum number of resolved context items. */
  readonly maxContextItemCount: number;
  /** Whether explicit truncation of oversized text items is allowed. */
  readonly allowTruncation: boolean;
}

/** A caller-supplied resolved context item bound to one ContextManifest entry. */
export interface PiResolvedContextItem {
  /** Must match a ContextManifest entry `context_id`. */
  readonly contextId: string;
  /** Logical display label (never interpreted as instruction). */
  readonly label: string;
  /** IANA-style media type of the content. */
  readonly mediaType: string;
  /** UTF-8 text content when text-representable. */
  readonly text?: string;
  /** Raw bytes when the media type is binary and the host supports a safe representation. */
  readonly bytes?: Uint8Array;
  /** Content length in bytes (caller-declared, cross-checked by the adapter). */
  readonly byteLength: number;
  /** Provenance metadata (caller-supplied, observational only). */
  readonly provenance: Readonly<Record<string, string>>;
  /** Explicit truncation status. */
  readonly truncated: boolean;
  /** Optional content digest when defined by the approved manifest semantics. */
  readonly contentDigest?: string;
}

/**
 * Pi host capability declaration (caller-supplied, verified against the
 * inspected Pi 0.83.0 lane; unknown required semantics fail closed).
 */
export interface PiHostCapabilityDeclaration {
  /** Pi package identity, e.g. `@earendil-works/pi-coding-agent`. */
  readonly piPackageId: string;
  /** Pi version, e.g. `0.83.0`. */
  readonly piVersion: string;
  /** Adapter API version the host exposes. */
  readonly adapterApiVersion: string;
  /** Supported prompt injection mechanism (`before-agent-start-message`). */
  readonly promptInjection: readonly string[];
  /** Supported context transport (`length-prefixed-data-blocks`). */
  readonly contextTransport: readonly string[];
  /** Maximum prompt or context size accepted by the host, in UTF-8 bytes. */
  readonly maxPromptBytes: number;
  /** Supported text encodings. */
  readonly textEncodings: readonly string[];
  /** Supported media types (bare type/subtype tokens; exact matching after
   *  narrow normalization; `text/plain` is required; wildcards are
   *  unsupported). */
  readonly mediaTypes: readonly string[];
  /** Session lifecycle events the host fires. */
  readonly sessionLifecycleEvents: readonly string[];
  /** Turn lifecycle events the host fires. */
  readonly turnLifecycleEvents: readonly string[];
  /** Result observation events the host fires. */
  readonly resultObservationEvents: readonly string[];
  /** Tool-call observation events the host fires. */
  readonly toolCallObservationEvents: readonly string[];
  /** Cancellation observation events the host fires. */
  readonly cancellationObservationEvents: readonly string[];
  /** Shutdown observation events the host fires. */
  readonly shutdownObservationEvents: readonly string[];
  /** Whether the host supports correlation metadata. */
  readonly correlationMetadataSupported: boolean;
  /** Whether the host provides deterministic ordering guarantees. */
  readonly deterministicOrdering: boolean;
  /** Additional required features; unknown entries fail closed. */
  readonly requiredFeatures: readonly string[];
}

/** Point-of-use eligibility evidence accepted from Artifact Core. */
export type PiEligibilityEvidence = EligibilityReport;

/**
 * Input contract: already validated, use-level Artifact Core subjects plus
 * caller-supplied occurrence/attempt identity, host capability, context items,
 * and limits. Raw artifact JSON is never accepted.
 */
export interface PiProjectionInput {
  /** Exact ExecutionBundle, validated to `point-of-use-eligible`. */
  readonly bundle: ValidatedArtifact;
  /** Exact TaskSpec member, validated to at least `registry-compatible`. */
  readonly taskSpec: ValidatedArtifact;
  /** Exact AuthorityPolicy member (non-operative in WP-5A). */
  readonly authorityPolicy: ValidatedArtifact;
  /** Exact ContextManifest member. */
  readonly contextManifest: ValidatedArtifact;
  /** Exact CompletionContract member. */
  readonly completionContract: ValidatedArtifact;
  /** Point-of-use eligibility evidence; must indicate eligibility. */
  readonly eligibility: PiEligibilityEvidence;
  /** Exact accepted RegistrySnapshot context. */
  readonly registry: AcceptedRegistryContext;
  /** Caller-supplied execution occurrence ID (never generated here). */
  readonly occurrenceId: string;
  /** Caller-supplied execution attempt ID (never generated here). */
  readonly attemptId: string;
  /** Caller-supplied Pi host capability declaration. */
  readonly capability: PiHostCapabilityDeclaration;
  /** Caller-supplied resolved context items bound to ContextManifest entries. */
  readonly contextItems: readonly PiResolvedContextItem[];
  /** Caller-supplied adapter limits. */
  readonly limits: PiAdapterLimits;
  /** Requested use correlated with the eligibility evidence (optional). */
  readonly requestedUse?: RequestedUse;
}

/** Exact subject correlation entry for the plan footer. */
export interface PiSubjectCorrelation {
  readonly role: 'bundle' | 'task' | 'authority-policy' | 'context-manifest' | 'completion-contract';
  readonly reference: ExactArtifactReferenceModel;
  readonly digest: string;
  readonly instanceId: string;
  readonly revisionId: string;
}

/** Rendered context data block metadata. */
export interface PiContextBlockMeta {
  readonly contextId: string;
  readonly label: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly truncated: boolean;
  readonly truncatedFromBytes?: number;
  readonly contentDigest?: string;
}

/** Capability compatibility result. */
export interface PiCapabilityCompatibility {
  readonly compatible: boolean;
  readonly fingerprint: string;
  readonly supportedLane: string;
  readonly observed: Readonly<Record<string, string>>;
  readonly findings: readonly PiFinding[];
}

/**
 * Immutable Pi invocation plan. Status is always `projection-ready`;
 * authority statuses (`authorized`, `approved`, `activated`, `executable`,
 * `granted`) are never emitted, and the plan explicitly states that pi-guard
 * authority enforcement has not yet been applied.
 */
export interface PiInvocationPlan {
  readonly protocolVersion: string;
  readonly consumerIdentity: string;
  readonly consumerVersion: string;
  readonly supportedPiLane: string;
  readonly bundleReference: ExactArtifactReferenceModel;
  readonly taskReference: ExactArtifactReferenceModel;
  readonly authorityPolicyReference: ExactArtifactReferenceModel;
  readonly contextManifestReference: ExactArtifactReferenceModel;
  readonly completionContractReference: ExactArtifactReferenceModel;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly preamble: string;
  readonly taskSection: string;
  readonly contextSections: readonly PiContextBlockMeta[];
  readonly completionCriteriaSection: string;
  readonly correlationFooter: string;
  readonly contextInventory: readonly {
    readonly contextId: string;
    readonly label: string;
    readonly mediaType: string;
    readonly provenance: Readonly<Record<string, string>>;
    readonly truncated: boolean;
  }[];
  readonly subjectCorrelations: readonly PiSubjectCorrelation[];
  readonly expectedObservationContract: Readonly<Record<string, string>>;
  readonly capabilityCompatibility: PiCapabilityCompatibility;
  readonly findings: readonly PiFinding[];
  readonly status: PiPlanStatus;
  /** Explicit statement that pi-guard enforcement is pending. */
  readonly piGuardEnforcementPending: true;
  /** Deep-frozen, null-prototype rendered prompt text. */
  readonly renderedPrompt: string;
}

/** Ordered tool-call observation (host-supplied sequence data). */
export interface PiToolCallObservation {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly sequence: number;
  readonly observed: boolean;
}

/** Model metadata and usage supplied by Pi (observational only). */
export interface PiModelObservation {
  readonly modelId?: string;
  readonly providerId?: string;
  readonly usage?: Readonly<Record<string, unknown>>;
}

/**
 * Immutable Pi execution observation. It is an adapter observation only:
 * never an ExecutionResult, never a TrustedReceipt, never proof of
 * authorization; tool-call observation does not imply permission.
 */
export interface PiExecutionObservation {
  readonly protocolVersion: string;
  readonly piHostIdentity: string;
  readonly piHostVersion: string;
  readonly bundleReference: ExactArtifactReferenceModel;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly sessionCorrelationId?: string;
  readonly turnCorrelationId?: string;
  readonly startObservedAt?: string;
  readonly endObservedAt?: string;
  readonly completionText?: string;
  readonly completionStatus: 'completed' | 'cancelled' | 'error' | 'not-observed';
  readonly cancellationObserved: boolean;
  readonly hostErrors: readonly string[];
  readonly toolCalls: readonly PiToolCallObservation[];
  readonly model?: PiModelObservation;
  readonly findings: readonly PiFinding[];
  readonly completeness: PiObservationCompleteness;
  readonly isAdapterObservation: true;
  readonly isExecutionResult: false;
  readonly isTrustedReceipt: false;
  readonly impliesAuthorization: false;
  readonly toolObservationImpliesPermission: false;
}

/** Narrow structural Pi host surface used by the bridge (subset of the public
 *  `@earendil-works/pi-coding-agent` ExtensionAPI). WP-5A never reads the Pi
 *  tool inventory: tool inventory and authority projection are reserved for
 *  WP-5B, and tool-call attempts are observed only through lifecycle events. */
export interface PiHostSurface {
  readonly hostIdentity: string;
  readonly hostVersion: string;
  readonly on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void;
}

/** Bridge-internal captured host event (untrusted observation). */
export interface PiCapturedEvent {
  readonly kind: string;
  readonly sequence: number;
  readonly data: ImmutableModel;
  /** True when the event arrived after `session_shutdown` (classified late). */
  readonly late?: boolean;
}

/** Narrow Pi host bridge over one immutable plan. */
export interface PiHostBridge {
  readonly plan: PiInvocationPlan;
  readonly hostIdentity: string;
  readonly hostVersion: string;
  /** Whether the plan has been armed for hook-driven injection (idempotent). */
  readonly armed: boolean;
  readonly capturedEvents: readonly PiCapturedEvent[];
  readonly sessionCorrelationId?: string;
  readonly turnCorrelationId?: string;
  readonly cancellationObserved: boolean;
  /**
   * Arm the plan for hook-driven injection. The actual injection occurs
   * through the registered `before_agent_start` handler on each host event;
   * this method only marks the bridge armed and is idempotent.
   */
  armInjection(): PiHostBridgeResult;
  /** Record a host-reported cancellation observation (integration layer only). */
  recordCancellation(): void;
  /** Observe execution; returns an immutable branded observation. */
  observe(opts?: { sessionCorrelationId?: string; turnCorrelationId?: string; cancelled?: boolean }): PiExecutionObservation;
}

export type PiHostBridgeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly findings: readonly PiFinding[] };

export type { ImmutableModel, ValidationLevel };
