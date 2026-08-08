/**
 * WP-11 Slice 1 — transport-free create-only controlled-write core (protocol
 * types).
 *
 * BOUNDARY: this module family persists ONE already-accepted WP-10
 * `ValidDraftProposalResult` (ok:true, valid:true) as a new structured
 * artifact draft file inside the host-configured `artifactLocation` region
 * of one version-2 workspace. The operation is transport-free, create-only,
 * fail-closed, containment-bound, point-of-use revalidated, and performed
 * through an injected host write executor. It implements NO broader write
 * capability: no replace/update/create-or-replace/CAS, no directory
 * creation, no canonical filename/layout convention, no ExecutionBundle or
 * ExecutionResult persistence, no lifecycle/store/audit/Git side effects.
 *
 * AUTHORITY: persistence is permitted only by the conjunction of (1) a
 * runtime-genuine trusted version-2 workspace configuration, (2) a
 * configured artifactLocation region, (3) an accepted writeable validated
 * draft, (4) a contract-conformant destination request, (5) an accepted
 * prospective containment decision, (6) successful point-of-use
 * revalidation, and (7) the injected host executor. No single item is
 * sufficient authority; a `ValidDraftProposalResult` is proposal data, not
 * write authority.
 *
 * The core is I/O-free: all filesystem observation happens through the
 * accepted WP-6 Phase 2B `ProspectiveDestinationResolver`, and all
 * filesystem mutation happens through the injected host write executor.
 */
import { INPUT_BYTE_LIMITS } from '../internal/phase.js';
import type { ValidDraftProposalResult } from '../drafting/proposal.js';
import {
  DESTINATION_CONTAINMENT_OPERATION_CLASS,
  DESTINATION_CONTAINMENT_PURPOSE,
} from '../trusted/index.js';
import type {
  ArtifactDraftKind,
  DestinationContainmentFinding,
  ProspectiveDestinationResolver,
  ValidatedTrustedWorkspaceConfiguration,
} from '../trusted/index.js';

/** Bounded canonical byte payload: the accepted WP-3 artifact input byte limit (single source). */
export const WRITE_CANONICAL_UTF8_MAX_BYTES = INPUT_BYTE_LIMITS.artifact;

/**
 * Untrusted public write request. Exact own-key set; the caller supplies
 * ONLY the accepted draft object, the workspace selector, the
 * artifact-root-relative destination string, and the expected
 * configuration identity. Never accepted from the caller: absolute
 * destination paths, artifact roots, arbitrary filesystem paths, write or
 * overwrite mode, file mode, resolver evidence, trusted configuration,
 * lifecycle authority operands, surfaceId, or execution operands.
 */
export interface ControlledWriteRequest {
  /** Complete accepted WP-10 `ValidDraftProposalResult` (ok:true, valid:true). */
  readonly draft: ValidDraftProposalResult;
  /** Host/configuration-bound workspace selector. */
  readonly workspaceId: string;
  /** Untrusted artifact-root-relative destination request (Phase 2B grammar). */
  readonly destination: string;
  /** Configuration-correlation value required by the accepted Phase 2B contract. */
  readonly expectedConfigurationIdentity: string;
}

/** Trusted injected context (host-owned; never caller-supplied). */
export interface ControlledWriteOptions {
  /** Runtime-genuine validated version-2 trusted workspace configuration. */
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  /** Accepted WP-6 Phase 2B prospective-destination resolver (host observation boundary). */
  readonly resolveProspectiveDestination: ProspectiveDestinationResolver;
  /** Injected host write executor (the ONLY filesystem-mutation boundary). */
  readonly writeDraftFile: DraftWriteExecutor;
}

/**
 * Already-correlated trusted destination evidence passed to the host write
 * executor. Derived ONLY from the accepted containment/revalidation flow
 * (the point-of-use decision plus the accepted draft payload); never from
 * arbitrary caller input. The executor anchors the actual mutation to a
 * retained artifact-root descriptor (accepted /proc/self/fd lane pattern)
 * and builds the parent/target paths relative to that descriptor from the
 * decision's RESOLVED canonical existing-directory ancestor plus the
 * missing destination tail — it never re-walks a caller lexical absolute
 * path.
 */
export interface DraftWriteExecutorInput {
  readonly operationClass: typeof DESTINATION_CONTAINMENT_OPERATION_CLASS;
  readonly purpose: typeof DESTINATION_CONTAINMENT_PURPOSE;
  readonly configurationIdentity: string;
  readonly workspaceId: string;
  readonly artifactKind: ArtifactDraftKind;
  /** Canonical artifact root from the accepted point-of-use decision (anchor source). */
  readonly canonicalArtifactRoot: string;
  /** Resolved canonical existing-directory ancestor (accepted decision evidence; descriptor-identity reference). */
  readonly canonicalExistingDirectoryAncestor: string;
  /** Ancestor relative to the artifact root ('' = the root itself); derived from the accepted decision. */
  readonly canonicalAncestorRelativePath: string;
  /** Missing destination tail (accepted decision evidence); the create appends it to the verified ancestor. */
  readonly destinationTailComponents: readonly string[];
  /** Exact bytes to persist (verbatim `draft.proposal.canonicalUtf8`). */
  readonly canonicalUtf8: string;
  /** `Buffer.byteLength(canonicalUtf8, 'utf8')` — internal consistency bound. */
  readonly expectedByteCount: number;
  /** Optional host/test seam (production callers omit it). */
  readonly hooks?: DraftWriteHooks;
}

/**
 * Optional executor seams (host/test only; never caller-controlled through
 * the controlled-write request). Each is a narrow callback with no
 * filesystem authority of its own: after the artifact-root descriptor is
 * retained/verified (root-replacement race tests), after the exclusive
 * create before the byte write (WPR-022-style deterministic failure
 * injection), and after the full write before the final close (receives the
 * created target fd; close-failure injection).
 */
export interface DraftWriteHooks {
  readonly afterRootOpen?: () => void;
  readonly beforeWrite?: () => void;
  readonly afterWrite?: (fd: number) => void;
}

/**
 * Closed executor failure vocabulary (never raw errno, paths, or stacks).
 * `cleanup` reports the partial-write disposition: `not-needed` (no target
 * was created by this operation), `removed` (created target was removed by
 * the single best-effort cleanup attempt), `failed` (created target could
 * not be confirmed removed — indeterminate state).
 */
export type DraftWriteExecutorFailureCode =
  | 'invalid-evidence'
  | 'artifact-root-unavailable'
  | 'exclusive-create-conflict'
  | 'missing-parent'
  | 'parent-not-directory'
  | 'parent-not-verified'
  | 'readonly-filesystem'
  | 'no-space'
  | 'quota-exceeded'
  | 'permission-denied'
  | 'symlink-loop'
  | 'unsupported-filesystem'
  | 'write-failed'
  | 'verify-failed'
  | 'close-failed'
  | 'io-failure';

export type DraftWriteExecutorResult =
  | { readonly ok: true; readonly outcome: 'created'; readonly persistedByteCount: number }
  | { readonly ok: false; readonly code: DraftWriteExecutorFailureCode; readonly cleanup: 'not-needed' | 'removed' | 'failed' };

/** Injected host write executor contract. */
export type DraftWriteExecutor = (input: DraftWriteExecutorInput) => DraftWriteExecutorResult;

/** Distinct typed failure categories (never collapsed). */
export type ControlledWriteFailureCategory =
  | 'request-invalid'
  | 'draft-not-writeable'
  | 'containment-denied'
  | 'point-of-use-conflict'
  | 'executor-failure'
  | 'cleanup-indeterminate';

/** Typed failure: deterministic, bounded, redacted. */
export interface ControlledWriteFailure {
  readonly ok: false;
  readonly category: ControlledWriteFailureCategory;
  readonly code: string;
  /** Fixed redacted message: no absolute roots, no caller destination echo, no errno, no stacks, no host details. */
  readonly message: string;
  /** Accepted TAD containment findings (containment categories only). */
  readonly findings?: readonly DestinationContainmentFinding[];
  /** Closed executor code (executor categories only; never raw errno). */
  readonly reason?: DraftWriteExecutorFailureCode;
}

/** Successful persistence evidence: fields permitted by the write contract only. */
export interface ControlledWriteSuccess {
  readonly ok: true;
  readonly outcome: 'created';
  readonly evidence: {
    readonly artifactKind: ArtifactDraftKind;
    readonly instanceId: string;
    readonly revisionId: string;
    readonly digest: string;
    /** Accepted relative destination (permitted success field). */
    readonly relativeDestination: string;
    readonly persistedByteCount: number;
    readonly transition: 'missing-to-file';
  };
}

export type ControlledWriteResult = ControlledWriteSuccess | ControlledWriteFailure;
