/**
 * WP-14C — proposal-context load types (transport-free core).
 *
 * The normative load unit is the RESOLVED PROPOSAL SET: any non-empty
 * subset of TaskSpec, AuthorityPolicy, ContextManifest, CompletionContract.
 * It is NEVER an ExecutionBundle; WP-14C never constructs or persists an
 * ExecutionBundle and never uses bundle lifecycle semantics.
 *
 * Selection is Model C (ADR-040 Decision C; WP-14C pre-implementation
 * contract decision §5): trusted/operator-local explicit pins are exact and
 * REQUIRED; unpinned kinds use uniqueness-only fallback (0 → omit, 1 →
 * include, >1 → `ambiguous-selection`); zero included overall →
 * `no-candidate`. mtime/ctime, lexical revision ordering, "latest"
 * semantics, filesystem enumeration order, and any durable
 * `CurrentSelectionRecord` are never used.
 *
 * BOUNDARY: this module family is transport-free and I/O-free — all
 * filesystem observation happens through the injected WP-7 controlled
 * reader lane, and all Pi host interaction happens through the injected
 * host surface (see bridge.ts). It creates no lifecycle/execution
 * authority: loading prepares Pi context; it does not authorize Pi
 * execution. Results are plain frozen data.
 */
import type { SchemaRegistry } from '../schema/registry.js';
import type { ValidatedTrustedWorkspaceConfiguration } from '../trusted/index.js';
import type { WorkspaceInspectionService } from '../reader/index.js';
import { INPUT_BYTE_LIMITS } from '../internal/phase.js';

/** Exact supported proposal kinds (WP-14C load vocabulary; never ExecutionBundle). */
export const PROPOSAL_LOAD_KINDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract'] as const;
export type ProposalLoadKindId = (typeof PROPOSAL_LOAD_KINDS)[number];

/** Schema-enforced identity patterns (same source semantics as the artifact schemas). */
export const PROPOSAL_INSTANCE_ID_RE = /^pgw:i:[0-9a-f]{32}$/;
export const PROPOSAL_REVISION_ID_RE = /^pgw:r:[0-9a-f]{32}$/;

/**
 * Committed WP-14A destination convention:
 * `<kind>.<instanceId>.<revisionId>.json` (single artifact-root-relative
 * component; identity patterns guarantee a safe component).
 */
export const PROPOSAL_CANDIDATE_FILE_RE = /^(TaskSpec|AuthorityPolicy|ContextManifest|CompletionContract)\.(pgw:i:[0-9a-f]{32})\.(pgw:r:[0-9a-f]{32})\.json$/;

/** Maximum explicit pins (one per supported kind). */
export const MAX_LOAD_PINS = 4;
/** Maximum candidate files scanned per kind; beyond this the kind is ambiguous (fail closed). */
export const MAX_CANDIDATES_PER_KIND = 250;
/** Per-candidate read bound: the accepted WP-3 artifact input byte limit (single source). */
export const MAX_CANDIDATE_BYTES = INPUT_BYTE_LIMITS.artifact;
/** Per-artifact rendered context-block bound (bytes; truncation is explicit and surfaced). */
export const MAX_LOAD_BLOCK_BYTES = 128 * 1024;

/** One exact explicit pin (trusted/operator-local selection input). */
export interface ProposalLoadPin {
  readonly kind: ProposalLoadKindId;
  readonly instanceId: string;
  readonly revisionId: string;
}

/**
 * Closed host-owned load options. No artifact paths, no content, no
 * validation flags, no authority operands exist. All fields are host/
 * operator selection inputs only.
 */
export interface ProposalLoadOptions {
  /** Opaque workspace selector (must match a validated workspace on the lane). */
  readonly workspaceId: string;
  /** Optional exact per-kind pins (Model C explicit selection). */
  readonly pins?: readonly ProposalLoadPin[];
}

/** Host-owned load lane (never caller-supplied). */
export interface ProposalLoadLane {
  /** Runtime-genuine validated trusted workspace configuration (host composition). */
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  /** Committed WP-7 controlled workspace reader (host-owned observation boundary). */
  readonly reader: WorkspaceInspectionService;
  /** The surface's exact registered SchemaRegistry (WP-4/WP-10 validation context). */
  readonly schemaRegistry: SchemaRegistry;
}

/** One included artifact of the resolved proposal set. */
export interface ProposalLoadedArtifact {
  readonly kind: ProposalLoadKindId;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly digest: string;
}

/** Closed load-failure vocabulary (WP-14C contract §11). */
export type ProposalLoadErrorCode =
  | 'no-candidate'
  | 'ambiguous-selection'
  | 'missing-required'
  | 'invalid-artifact'
  | 'incompatible-set'
  | 'unsupported-kind-version'
  | 'controlled-read-failure'
  /** Host-options boundary (malformed host/operator selection input). */
  | 'invalid-options';

/** Bounded redacted failure: no absolute roots, no trusted config values, no errno. */
export interface ProposalLoadFailure {
  readonly ok: false;
  readonly code: ProposalLoadErrorCode;
  readonly message: string;
}

export type ProposalLoadResult = ProposalLoadSuccess | ProposalLoadFailure;

/** Successful load: the immutable proposal-context load plan (distinct from PiInvocationPlan). */
export interface ProposalLoadSuccess {
  readonly ok: true;
  readonly plan: ProposalLoadPlan;
}

/**
 * Immutable proposal-context load plan. NOT a `PiInvocationPlan`: it
 * carries proposal-level validation facts only, no eligibility evidence,
 * no registry context, no lifecycle claims. Loading prepares Pi context;
 * it does not authorize Pi execution.
 */
export interface ProposalLoadPlan {
  /** Distinct plan class (never the execution-authorized projection plan class). */
  readonly planClass: 'proposal-context-load';
  /** Deterministic load identity over the resolved set (in-memory session only). */
  readonly loadId: string;
  readonly workspaceId: string;
  /** The resolved proposal set (non-empty; canonical kind order). */
  readonly loaded: readonly ProposalLoadedArtifact[];
  /** Unpinned kinds with zero valid candidates (visible omissions). */
  readonly omittedKinds: readonly ProposalLoadKindId[];
  /** Prior Gateway load superseded by this load (in-memory session only; never durable). */
  readonly supersedesLoadId?: string;
  /** Rendered proposal-context prompt (single immutable injected message). */
  readonly renderedPrompt: string;
  readonly preamble: string;
  readonly taskSection: string;
  readonly contextInventory: string;
  readonly contextBlocks: readonly { readonly contextId: string; readonly label: string; readonly mediaType: string; readonly byteLength: number; readonly truncated: boolean }[];
  readonly completionCriteriaSection: string;
  readonly correlationFooter: string;
}
