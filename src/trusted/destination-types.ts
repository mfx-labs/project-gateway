/**
 * WP-6 Phase 2B: prospective artifact-draft destination containment —
 * protocol types (TAD protocol v1, Model B alias-aware resolution).
 *
 * The prospective destination is an UNTRUSTED artifact-root-relative
 * request (WP-0 remote-producer zone). Trusted operands (runtime-genuine
 * validated configuration, configuration identity, workspace correlation,
 * the configuration-bound canonical artifact directory, the fixed four-draft
 * scope, and the injected ProspectiveDestinationResolver) come from trusted
 * callers only. The evaluation is prospective trusted-process containment
 * data: it grants NO write, overwrite, persistence, approval, RuntimeGrant,
 * or execution authority, and it requires immediate later point-of-use
 * revalidation by WP-11 before any actual mutation.
 *
 * Model B (alias-aware resolution): the existing directory ancestor is
 * canonical (resolved), the request prefix is lexical, and their correlation
 * is trusted host evidence — the pure core cannot prove alias resolution
 * from path strings alone. The core never requires
 * `canonical ancestor + lexical tail == lexical absolute destination`,
 * which is invalid across aliases.
 *
 * The core performs no filesystem I/O; all host observation occurs through
 * the injected resolver, invoked exactly once.
 */

/** Independent Phase-2B destination-containment protocol version (distinct from trusted-configuration version `2`). */
export const DESTINATION_CONTAINMENT_PROTOCOL_VERSION = '1' as const;

/** Operation class for prospective artifact-draft destination containment. */
export const DESTINATION_CONTAINMENT_OPERATION_CLASS = 'artifact-draft-destination' as const;

/** Purpose: the deferred write-related concept named in the committed Phase-2A report. */
export const DESTINATION_CONTAINMENT_PURPOSE = 'persist-validated-artifact-draft' as const;

/** Allowed prospective draft kinds (fixed four-draft scope; committed constant reused). */
export type ArtifactDraftKind =
  | 'TaskSpec'
  | 'AuthorityPolicy'
  | 'ContextManifest'
  | 'CompletionContract';

/**
 * Untrusted public request shape. Exact own-key set; snapshot-captured via
 * descriptor-derived capture; no caller-supplied roots, resolver evidence,
 * target state, entry kind, authority, approval, write/overwrite mode, or
 * persistence operation.
 */
export interface ProspectiveArtifactDestinationRequest {
  readonly expectedConfigurationIdentity: string;
  readonly workspaceId: string;
  readonly artifactKind: ArtifactDraftKind;
  readonly destination: string;
}

/** Trusted options: supplied by a trusted caller, never by request data. */
export interface ProspectiveArtifactDestinationOptions {
  /** Already validated, deeply immutable runtime-genuine trusted configuration. */
  readonly configuration: import('./types.js').ValidatedTrustedWorkspaceConfiguration;
  /** Injected trusted prospective-destination resolver (host-boundary; the core is I/O-free). */
  readonly resolveProspectiveDestination: ProspectiveDestinationResolver;
}

/**
 * Strict internal resolver request: exactly three own fields, internally
 * constructed, deeply frozen before invocation, primitive values only.
 * `canonicalArtifactRoot` comes only from the runtime-genuine validated
 * configuration; `absoluteProspectiveDestination` comes only from that root
 * plus validated destination components. No artifact kind, authority,
 * write/overwrite policy, approval, or persistence operation is included.
 */
export interface ProspectiveDestinationResolutionRequest {
  readonly destinationContainmentProtocolVersion: typeof DESTINATION_CONTAINMENT_PROTOCOL_VERSION;
  readonly canonicalArtifactRoot: string;
  readonly absoluteProspectiveDestination: string;
}

/** Observed final-target state vocabulary (policy-neutral host observation). */
export type ProspectiveDestinationTargetState =
  | 'missing'
  | 'existing-file'
  | 'existing-directory'
  | 'existing-symlink'
  | 'dangling-symlink'
  | 'unsupported-kind';

/**
 * Model B success evidence: one flat exact eight-own-key shape reporting the
 * complete observed state. The lexical existing-directory prefix and the
 * canonical existing directory ancestor are distinct operands; their
 * correlation is trusted host evidence. No optional alias fields; one exact
 * shape per accepted variant.
 */
export interface ProspectiveDestinationResolutionSuccess {
  readonly ok: true;
  /** Current canonical artifact root as observed by the host (must equal the configuration-bound root). */
  readonly currentCanonicalArtifactRoot: string;
  /** Exact literal; anything else is malformed evidence (root-kind failures use subject-aware failure evidence). */
  readonly artifactRootEntryKind: 'directory';
  /** Longest lexical prefix of the validated request components whose entry exists and resolves to a directory. */
  readonly lexicalExistingDirectoryPrefixComponents: readonly string[];
  /** Resolved canonical existing directory ancestor (trusted host evidence). */
  readonly canonicalExistingDirectoryAncestor: string;
  /** Exact literal. */
  readonly existingAncestorEntryKind: 'directory';
  /** Exact remaining request suffix after the lexical prefix. */
  readonly destinationTailComponents: readonly string[];
  /** Observed final-target state; only `missing` may produce a decision. */
  readonly targetState: ProspectiveDestinationTargetState;
}

/** Failure evidence subjects: which filesystem subject failed. */
export type ProspectiveDestinationResolutionFailureSubject =
  | 'artifact-root'
  | 'existing-ancestor'
  | 'final-target'
  | 'resolution';

/** Failure evidence codes (subject/code compatibility is a closed core-side table). */
export type ProspectiveDestinationResolutionFailureCode =
  | 'not-found'
  | 'not-directory'
  | 'unsupported-kind'
  | 'loop'
  | 'inaccessible'
  | 'ambiguous'
  | 'dangling-symlink'
  | 'observation-failed'
  | 'error';

/** Subject-aware failure evidence: exactly three own keys. */
export interface ProspectiveDestinationResolutionFailure {
  readonly ok: false;
  readonly subject: ProspectiveDestinationResolutionFailureSubject;
  readonly code: ProspectiveDestinationResolutionFailureCode;
}

export type ProspectiveDestinationResolution =
  | ProspectiveDestinationResolutionSuccess
  | ProspectiveDestinationResolutionFailure;

/**
 * One dedicated trusted resolver contract (not merged with RootPathResolver,
 * ExistingPathResolver, or ArtifactLocationResolver). Trusted host code owns
 * all current filesystem observation; receives the internal request exactly
 * once; revalidates the explicit canonical artifact-root path; walks the
 * exact prospective destination; identifies the longest lexical
 * existing-directory prefix; resolves it to a canonical existing directory;
 * observes the final target state; returns one strict success or failure
 * record. The resolver never decides containment acceptance or write
 * authority.
 */
export type ProspectiveDestinationResolver = (
  request: Readonly<ProspectiveDestinationResolutionRequest>,
) => ProspectiveDestinationResolution;

/**
 * Prospective trusted-process containment decision for a successful missing
 * target. Deeply frozen; grants no authority; requires immediate point-of-use
 * revalidation. Raw canonical paths (current root, canonical ancestor) are
 * trusted-process-internal and must never cross the package root, MCP,
 * ChatGPT-facing, finding, or public-identity boundary.
 */
export interface ProspectiveArtifactDestinationDecision {
  readonly destinationContainmentProtocolVersion: typeof DESTINATION_CONTAINMENT_PROTOCOL_VERSION;
  readonly operationClass: typeof DESTINATION_CONTAINMENT_OPERATION_CLASS;
  readonly purpose: typeof DESTINATION_CONTAINMENT_PURPOSE;
  readonly decisionIdentity: string;
  readonly configurationIdentity: string;
  readonly hostLane: string;
  readonly workspaceId: string;
  readonly artifactKind: ArtifactDraftKind;
  readonly canonicalArtifactRelativeDestination: string;
  readonly currentCanonicalArtifactRoot: string;
  readonly lexicalExistingDirectoryPrefixComponents: readonly string[];
  readonly canonicalExistingDirectoryAncestor: string;
  readonly destinationTailComponents: readonly string[];
  readonly targetState: 'missing';
  readonly pointOfUseRevalidationRequired: true;
}
