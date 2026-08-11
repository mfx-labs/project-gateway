/**
 * WP-14A — transport-free host/surface-aware controlled proposal
 * persistence adapter (Model B).
 *
 * MODEL: the trusted host registers logical `surfaceId`s, each carrying the
 * EXACT `SchemaRegistry` it also registers for the same surface in the WP-9
 * inspection registry and the WP-10 drafting registry (same-instance
 * composition), plus — when the operator configured workspace lanes for the
 * surface — a host-owned controlled-persistence lane (genuine validated
 * trusted configuration, the injected prospective-destination resolver, and
 * the injected WP-11 host write executor). MCP clients NEVER supply roots,
 * locators, paths, digests, validation flags, or trusted-input material:
 * they select a registered surface ONLY by its opaque logical `surfaceId`
 * and name an opaque `workspaceId` + the exact artifact kind + candidate
 * artifact content.
 *
 * MODEL B — VALIDATION PROVENANCE (ADR-040 Decision A; WP-14 pre-implementation
 * contract decision §4.1): the persistence operation independently performs
 * the required trusted structural and semantic validation at the persistence
 * boundary before invoking WP-11. The remote request is NEVER trusted as a
 * `ValidDraftProposalResult`; the remote caller NEVER establishes validation
 * provenance by supplying `ok`, `valid`, `canonicalUtf8`, digest/correlation
 * assertions, a caller-constructed `ValidDraftProposalResult`, or a
 * reference claiming prior validation. All caller material is candidate
 * material only. The trusted host chain at point of persistence:
 *
 *   candidate artifact
 *   → structural validation
 *   → semantic validation
 *   → canonicalization
 *   → trusted digest/correlation
 *   → construct the internal validated draft representation
 *   → invoke WP-11 controlled write
 *
 * The internal validated result passed to WP-11 is freshly host-produced by
 * `createDraftProposalWithSchemaRegistry` (the SAME accepted WP-10
 * validation composition — no second validator). Continuity is pinned
 * across artifact kind → instance/revision identity → canonical bytes →
 * digest → validation result → WP-11 write request → returned write
 * evidence; the exact bytes persisted are the exact trusted canonical bytes
 * produced/correlated by that validation. Substitution or mismatch fails
 * closed (the WP-11 core re-verifies shape and digest correlation, and the
 * executor writes the accepted canonical bytes verbatim).
 *
 * `draft-artifact` remains an independent in-memory drafting/self-validation
 * UX surface; calling it first is NOT a security prerequisite, and material
 * that originated from `draft-artifact` is still independently revalidated
 * here.
 *
 * DESTINATION: derived deterministically by the adapter from the freshly
 * validated artifact identity — `<kind>.<instanceId>.<revisionId>.json`,
 * a single artifact-root-relative component (the accepted WP-11
 * single-component create invariant; the schema-enforced
 * `pgw:i:`/`pgw:r:` identity patterns guarantee a safe component). The
 * caller never supplies a destination; no path transcription exists.
 *
 * BOUNDARY: this module is transport-free (no MCP SDK, no stdio runtime, no
 * network listener) and I/O-free (all filesystem observation and mutation
 * happen through the injected lane). It creates no lifecycle/execution
 * authority: persistence is proposal data only, never approval, issuance,
 * grant, activation, execution, or receipt. Results are plain frozen data.
 * Deterministic; no clock, no randomness, no process identity.
 */
import { SchemaRegistry } from '../../schema/registry.js';
import { createDraftProposalWithSchemaRegistry } from '../../drafting/proposal.js';
import type { DraftFinding, DraftProposalResult } from '../../drafting/proposal.js';
import { ARTIFACT_DRAFT_LOCATION_KINDS } from '../../trusted/index.js';
import type { ProspectiveDestinationResolver, ValidatedTrustedWorkspaceConfiguration } from '../../trusted/index.js';
import { persistValidatedArtifactDraft } from '../../writing/controlled-write.js';
import type { ControlledWriteResult, DraftWriteExecutor } from '../../writing/types.js';
import { SURFACE_ID_MAX_LENGTH, SURFACE_ID_RE } from './registry.js';
import { REQUEST_ID_MAX_LENGTH } from './validate.js';

/**
 * Distinct transport-free persistence tool vocabulary. Exactly one tool:
 * `persist-artifact`. Kept strictly separate from `MCP_INSPECTION_TOOLS`
 * (WP-9) and `MCP_DRAFT_TOOLS` (WP-10).
 */
export const MCP_PERSIST_TOOLS = ['persist-artifact'] as const;
export type McpPersistTool = (typeof MCP_PERSIST_TOOLS)[number];

/** Closed persistence outcome vocabulary (adapter boundary; never errno/paths). */
export type PersistErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'unsupported'
  | 'unsupported-artifact-kind'
  | 'limit-exceeded'
  | 'validation-failed'
  | 'write-denied'
  | 'write-conflict'
  | 'write-failed'
  | 'write-indeterminate'
  | 'adapter-error';

/** Bounded adapter request bound for the workspace selector. */
export const PERSIST_WORKSPACE_ID_MAX_LENGTH = 128;

/**
 * Closed transport-free persistence request envelope. Own-key set only:
 * `{ workspaceId, kind, content, requestId? }`. `content` is the raw JSON
 * candidate artifact envelope with `revision.digest` ABSENT (the digest is
 * derived by the trusted validation composition, never caller-supplied).
 * No destination, no path, no validation flag, no digest, no overwrite/mode,
 * no resolver/configuration operand, no authority operand exists.
 */
export interface PersistArtifactRequest {
  readonly workspaceId: string;
  readonly kind: string;
  readonly content: string;
  readonly requestId?: string;
}

/** Host-owned controlled-persistence lane (never caller-supplied). */
export interface PersistLane {
  /** Genuine runtime-branded validated trusted configuration (host composition). */
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  /** Injected trusted prospective-destination resolver (host observation boundary). */
  readonly resolveProspectiveDestination: ProspectiveDestinationResolver;
  /** Injected WP-11 host write executor (the ONLY filesystem-mutation boundary). */
  readonly writeDraftFile: DraftWriteExecutor;
}

/** Host-owned persistence registration (never client-supplied). */
export interface McpPersistRegistration {
  /** Opaque logical surface identifier (exact accepted WP-9 grammar). */
  readonly surfaceId: string;
  /** The EXACT schema registry instance registered for the same surface elsewhere. */
  readonly schemaRegistry: SchemaRegistry;
  /** Optional controlled-persistence lane; absent → typed `unsupported` outcome. */
  readonly lane?: PersistLane;
}

/** Successful persistence: bounded redacted evidence plus the fresh validation facts. */
export interface PersistSuccessResponse {
  readonly ok: true;
  readonly result: {
    readonly persisted: {
      readonly artifactKind: string;
      readonly instanceId: string;
      readonly revisionId: string;
      readonly digest: string;
      /** Accepted artifact-root-relative destination (identity-derived; never a caller path). */
      readonly relativeDestination: string;
      readonly persistedByteCount: number;
      readonly transition: 'missing-to-file';
    };
    /** Freshly host-produced validation facts (Model B). */
    readonly validation: { readonly level: string; readonly ruleIds: readonly string[] };
  };
  readonly requestId?: string;
}

/** Persistence failure: closed code, fixed redacted message, bounded extras. */
export interface PersistFailureResponse {
  readonly ok: false;
  readonly error: {
    readonly code: PersistErrorCode;
    readonly message: string;
    /** Bounded validation findings (`validation-failed` only). */
    readonly findings?: readonly DraftFinding[];
    /** Bounded containment findings (`write-denied`/`write-conflict` only). */
    readonly containmentFindings?: readonly { readonly code: string; readonly messageKey: string }[];
    /** Closed executor reason (`write-failed`/`write-indeterminate` only). */
    readonly reason?: string;
    readonly requestId?: string;
  };
}

export type PersistResponse = PersistSuccessResponse | PersistFailureResponse;

/** Host-owned persistence registry (immutable after construction). */
export interface McpPersistRegistry {
  /** Route one persistence request to the registered surface named by `surfaceId`. */
  readonly persist: (surfaceId: string, request: unknown) => PersistResponse;
  /** Host-side introspection: registered surface ids in canonical sorted order. */
  readonly surfaces: readonly string[];
}

export interface PersistRegistryResult {
  readonly ok: boolean;
  readonly registry?: McpPersistRegistry;
  readonly code?: string;
  readonly message?: string;
}

const PERSIST_REQUEST_KEYS: ReadonlySet<string> = new Set(['workspaceId', 'kind', 'content', 'requestId']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSurfaceId(surfaceId: string): string | undefined {
  if (typeof surfaceId !== 'string' || surfaceId.length === 0 || surfaceId.length > SURFACE_ID_MAX_LENGTH) {
    return 'surfaceId must be a bounded non-empty string';
  }
  if (!SURFACE_ID_RE.test(surfaceId)) {
    return 'surfaceId is outside the closed logical identifier pattern; paths, locators, and trusted-input material are rejected';
  }
  return undefined;
}

function freezeFindings(findings: readonly DraftFinding[]): readonly DraftFinding[] {
  return Object.freeze([...findings]);
}

function failure(
  code: PersistErrorCode,
  message: string,
  extras: { readonly findings?: readonly DraftFinding[]; readonly containmentFindings?: readonly { readonly code: string; readonly messageKey: string }[]; readonly reason?: string; readonly requestId?: string } = {},
): PersistFailureResponse {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message,
      ...(extras.findings !== undefined ? { findings: freezeFindings(extras.findings) } : {}),
      ...(extras.containmentFindings !== undefined ? { containmentFindings: Object.freeze([...extras.containmentFindings]) } : {}),
      ...(extras.reason !== undefined ? { reason: extras.reason } : {}),
      ...(extras.requestId !== undefined ? { requestId: extras.requestId } : {}),
    }),
  });
}

function routingFailure(code: 'invalid-request' | 'not-found' | 'unsupported', message: string, request: unknown): PersistFailureResponse {
  let requestId: string | undefined;
  if (typeof request === 'object' && request !== null && !Array.isArray(request)) {
    const candidate = (request as Readonly<Record<string, unknown>>)['requestId'];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= REQUEST_ID_MAX_LENGTH) {
      requestId = candidate;
    }
  }
  return failure(code, message, { requestId });
}

/** Defensive component guard for the derived single-component destination. */
function isSafeSingleComponent(component: string): boolean {
  return component.length > 0
    && component !== '.'
    && component !== '..'
    && !component.includes('/')
    && !component.includes('\\')
    && !component.includes('\u0000');
}

/**
 * Deterministic identity-derived destination: one artifact-root-relative
 * component. The schema-enforced `pgw:i:`/`pgw:r:` identity patterns make
 * the component safe; the defensive guard fails closed on any deviation.
 */
function deriveDestination(kind: string, instanceId: string, revisionId: string): { readonly ok: true; readonly destination: string } | { readonly ok: false } {
  const destination = `${kind}.${instanceId}.${revisionId}.json`;
  if (!isSafeSingleComponent(destination)) return { ok: false };
  return { ok: true, destination };
}

/** Map the draft-core outcome taxonomy onto the closed persistence vocabulary. */
function mapDraftCoreError(result: Extract<DraftProposalResult, { readonly ok: false }>): PersistFailureResponse {
  switch (result.error.code) {
    case 'unsupported-artifact-kind':
      return failure('unsupported-artifact-kind', result.error.message);
    case 'limit-exceeded':
      return failure('limit-exceeded', result.error.message);
    case 'internal-adapter-failure':
      return failure('adapter-error', result.error.message);
    default:
      return failure('invalid-request', result.error.message);
  }
}

/** Map one WP-11 controlled-write failure onto the closed persistence vocabulary. */
function mapWriteFailure(result: Extract<ControlledWriteResult, { readonly ok: false }>): PersistFailureResponse {
  switch (result.category) {
    case 'request-invalid':
      return failure('invalid-request', result.message);
    case 'draft-not-writeable':
      // A freshly host-produced validated draft failing the WP-11 shape or
      // digest gate is an internal consistency failure (fail closed); the
      // kind gate is unreachable (the four-kind gate runs before WP-11).
      return failure('adapter-error', result.message);
    case 'containment-denied':
      return failure('write-denied', result.message, {
        containmentFindings: result.findings?.map((f) => ({ code: f.code, messageKey: f.messageKey })) ?? [],
      });
    case 'point-of-use-conflict':
      return failure('write-conflict', result.message, {
        containmentFindings: result.findings?.map((f) => ({ code: f.code, messageKey: f.messageKey })) ?? [],
      });
    case 'executor-failure':
      return failure('write-failed', result.message, { reason: result.reason });
    case 'cleanup-indeterminate':
      return failure('write-indeterminate', result.message, { reason: result.reason });
  }
}

/**
 * Persist one candidate proposal artifact under Model B. Deterministic;
 * the only allowed mutation is the single newly-created artifact draft file
 * through the injected WP-11 lane. Returns a bounded typed result.
 */
export function persistProposalArtifact(
  surfaceId: string,
  request: unknown,
  context: { readonly schemaRegistry: SchemaRegistry; readonly lane?: PersistLane },
): PersistResponse {
  const invalid = validateSurfaceId(surfaceId);
  if (invalid !== undefined) {
    return routingFailure('invalid-request', invalid, request);
  }
  if (context.lane === undefined) {
    return routingFailure('unsupported', 'the selected surface has no controlled-persistence lane configured', request);
  }
  const lane = context.lane;
  let requestId: string | undefined;
  if (!isRecord(request)) {
    return routingFailure('invalid-request', 'persist request must be an object', request);
  }
  for (const key of Object.keys(request)) {
    if (!PERSIST_REQUEST_KEYS.has(key)) {
      return routingFailure('invalid-request', `unknown persist request field: ${key}`, request);
    }
  }
  if (request['requestId'] !== undefined) {
    const candidate = request['requestId'];
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > REQUEST_ID_MAX_LENGTH) {
      return routingFailure('invalid-request', 'requestId must be a bounded non-empty string', request);
    }
    requestId = candidate;
  }
  const workspaceId = request['workspaceId'];
  if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspaceId.length > PERSIST_WORKSPACE_ID_MAX_LENGTH) {
    return routingFailure('invalid-request', 'workspaceId must be a bounded non-empty string', request);
  }
  const kind = request['kind'];
  if (typeof kind !== 'string' || kind.length === 0) {
    return routingFailure('invalid-request', 'kind must be a non-empty string', request);
  }
  // Fixed four-kind scope BEFORE validation (ExecutionBundle is draftable but
  // never persistable — WP-11's ARTIFACT_DRAFT_LOCATION_KINDS is the exact
  // four-kind vocabulary; ADR-040 Decision A / SCR-WP14-UX-005 closure).
  if (!(ARTIFACT_DRAFT_LOCATION_KINDS as readonly string[]).includes(kind)) {
    return failure('unsupported-artifact-kind', 'the requested artifact kind is outside the closed persistable proposal vocabulary');
  }
  const content = request['content'];
  if (typeof content !== 'string' || content.length === 0) {
    return routingFailure('invalid-request', 'content must be a non-empty JSON string', request);
  }

  // Model B: independent trusted validation at the persistence boundary via
  // the accepted WP-10 validation composition (structural → semantic →
  // canonicalization → trusted digest/correlation). The result is freshly
  // host-produced; no caller assertion participates.
  const result = createDraftProposalWithSchemaRegistry(
    { kind: kind as never, content },
    context.schemaRegistry,
  );
  if (result.ok !== true) {
    return mapDraftCoreError(result);
  }
  if (result.valid !== true) {
    return failure('validation-failed', 'the candidate artifact failed trusted validation and was not persisted', {
      findings: result.findings,
      requestId,
    });
  }
  const draft = result;

  // Identity-derived destination (single component; zero path transcription).
  const derived = deriveDestination(draft.kind, draft.proposal.instanceId, draft.proposal.revisionId);
  if (!derived.ok) {
    return failure('adapter-error', 'the derived artifact destination is not a safe single component; the write was not attempted');
  }

  // WP-11 controlled write: create-only, containment-bound, point-of-use
  // revalidated, host-executor-confined. The exact trusted canonical bytes
  // produced by the validation above are the bytes handed to WP-11.
  const writeResult = persistValidatedArtifactDraft(
    {
      workspaceId,
      destination: derived.destination,
      expectedConfigurationIdentity: lane.configuration.identity,
      draft,
    },
    {
      configuration: lane.configuration,
      resolveProspectiveDestination: lane.resolveProspectiveDestination,
      writeDraftFile: lane.writeDraftFile,
    },
  );
  if (writeResult.ok !== true) {
    const mapped = mapWriteFailure(writeResult);
    return mapped.error.requestId === undefined && requestId !== undefined
      ? Object.freeze({ ...mapped, error: Object.freeze({ ...mapped.error, requestId }) })
      : mapped;
  }
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      persisted: Object.freeze({
        artifactKind: writeResult.evidence.artifactKind,
        instanceId: writeResult.evidence.instanceId,
        revisionId: writeResult.evidence.revisionId,
        digest: writeResult.evidence.digest,
        relativeDestination: writeResult.evidence.relativeDestination,
        persistedByteCount: writeResult.evidence.persistedByteCount,
        transition: writeResult.evidence.transition,
      }),
      validation: Object.freeze({ level: draft.validation.level, ruleIds: Object.freeze([...draft.validation.ruleIds]) }),
    }),
    ...(requestId !== undefined ? { requestId } : {}),
  });
}

/** Host-owned persistence registration context (immutable after construction). */
interface PersistContext {
  readonly schemaRegistry: SchemaRegistry;
  readonly lane?: PersistLane;
}

/**
 * Build the host-owned persistence registry. Every registration must carry
 * a genuine `SchemaRegistry`; duplicate/conflicting surfaceIds fail
 * construction deterministically. Insertion order never affects routing
 * (surfaces are sorted canonically).
 */
export function createMcpPersistRegistry(input: { readonly registrations: readonly McpPersistRegistration[] }): PersistRegistryResult {
  const seen = new Set<string>();
  const surfaces = new Map<string, PersistContext>();
  for (const registration of input.registrations) {
    const invalid = validateSurfaceId(registration.surfaceId);
    if (invalid !== undefined) {
      return { ok: false, code: 'ERR-PERSIST-REQ-INVALID', message: invalid };
    }
    if (seen.has(registration.surfaceId)) {
      return { ok: false, code: 'ERR-PERSIST-REQ-INVALID', message: `surfaceId is registered more than once: ${registration.surfaceId}` };
    }
    if (!(registration.schemaRegistry instanceof SchemaRegistry)) {
      return { ok: false, code: 'ERR-PERSIST-REQ-INVALID', message: `surface ${registration.surfaceId} has no genuine schema registry` };
    }
    if (registration.lane !== undefined) {
      const lane = registration.lane;
      if (typeof lane.resolveProspectiveDestination !== 'function' || typeof lane.writeDraftFile !== 'function') {
        return { ok: false, code: 'ERR-PERSIST-REQ-INVALID', message: `surface ${registration.surfaceId} has an incomplete persistence lane` };
      }
    }
    seen.add(registration.surfaceId);
    surfaces.set(registration.surfaceId, Object.freeze({ schemaRegistry: registration.schemaRegistry, ...(registration.lane !== undefined ? { lane: registration.lane } : {}) }));
  }
  const sortedIds: readonly string[] = Object.freeze([...surfaces.keys()].sort());
  const registry: McpPersistRegistry = {
    persist(surfaceId: string, request: unknown): PersistResponse {
      const invalid = validateSurfaceId(surfaceId);
      if (invalid !== undefined) {
        return routingFailure('invalid-request', invalid, request);
      }
      const context = surfaces.get(surfaceId);
      if (context === undefined) {
        return routingFailure('not-found', 'the selected persistence surface is not registered', request);
      }
      return persistProposalArtifact(surfaceId, request, context);
    },
    surfaces: sortedIds,
  };
  return { ok: true, registry: Object.freeze(registry) };
}
