/**
 * WP-14A — transport-free host/surface-aware stateless changed-context
 * inspection adapter.
 *
 * MODEL: the trusted host registers logical `surfaceId`s, each carrying a
 * host-owned changed-context lane composed from the committed WP-7
 * controlled boundaries: `GitInspectionService` (fresh controlled Git
 * inspection) and `WorkspaceInspectionService` (controlled file reads).
 * MCP clients NEVER supply roots, locators, or trusted-input material: they
 * select a registered surface by its opaque logical `surfaceId` and name an
 * opaque `workspaceId` plus an OPTIONAL requested subset of the changed
 * files whose contents they want read back.
 *
 * FRESHNESS AND MEMBERSHIP CONFINEMENT (ADR-040 Decision B;
 * pre-implementation contract decision §5.1): the current changed-file set
 * is derived from a TRUSTED FRESH WP-7 Git `status` observation at point of
 * use. Optional content reads are limited to a requested subset of that
 * freshly resolved changed-file set: a caller MUST NOT nominate an
 * unrelated workspace path and obtain its contents through this operation.
 * Each requested content read re-runs the WP-7 `read-text` boundary, which
 * independently re-applies ordinary workspace/read containment and
 * point-of-use membership verification; drift that invalidates membership
 * or containment fails closed through the WP-7 typed semantics. Unrelated
 * authorized project files belong to the existing inspection/read surfaces,
 * never this operation.
 *
 * NO DURABLE STATE: no `ActiveContext` lifecycle record, no `HotkeyRecord`,
 * no context database, no persistent selection/event protocol, no global
 * filesystem snapshot transaction. The operation is stateless; every call
 * re-reads the current changed state.
 *
 * BOUNDS: changed-file reporting is capped with truthful truncation;
 * requested content paths are capped per request; each content read is
 * bounded by an explicit byte ceiling (WP-7 returns truncation truthfully);
 * Git status/diff output is bounded by the committed WP-7 limits. Binary/
 * unsupported-file behavior (NUL bytes, non-UTF-8, unsupported kinds)
 * delegates to the existing WP-7 typed semantics — no second content model
 * is invented.
 *
 * BOUNDARY: this module is transport-free (no MCP SDK, no stdio runtime, no
 * network listener) and I/O-free (all filesystem observation happens
 * through the injected WP-7 services). It creates no lifecycle/execution
 * authority: retrieved context is untrusted project data. Results are plain
 * frozen data. Deterministic; no clock, no randomness, no process identity.
 */
import type { GitInspectionService, WorkspaceInspectionService } from '../../reader/index.js';
import type { OperationResult, ReadTextResult, GitStatusRecord, GitDiffResult } from '../../reader/index.js';
import { SURFACE_ID_MAX_LENGTH, SURFACE_ID_RE } from './registry.js';
import { REQUEST_ID_MAX_LENGTH } from './validate.js';

/**
 * Distinct transport-free changed-context tool vocabulary. Exactly one
 * tool: `inspect-changes`. Kept strictly separate from the inspection,
 * drafting, and persistence vocabularies.
 */
export const MCP_CHANGES_TOOLS = ['inspect-changes'] as const;
export type McpChangesTool = (typeof MCP_CHANGES_TOOLS)[number];

/** Closed changed-context outcome vocabulary (adapter boundary; never errno/paths). */
export type ChangesErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'unsupported'
  | 'workspace-unavailable'
  | 'inspection-failed'
  | 'membership-denied'
  | 'content-unreadable'
  | 'limit-exceeded'
  | 'adapter-error';

/** Max reported changed files in one response (truthful truncation beyond). */
export const MAX_CHANGES_REPORTED_FILES = 250;
/** Max requested content-read paths per request. */
export const MAX_CHANGES_CONTENT_PATHS = 8;
/** Max bytes per requested content read (WP-7 truncates truthfully). */
export const MAX_CHANGES_CONTENT_BYTES = 65_536;
/** Max length of one requested content path (UTF-8 characters). */
export const MAX_CHANGES_PATH_LENGTH = 1_024;

/** Closed transport-free changed-context request envelope. */
export interface InspectChangesRequest {
  readonly workspaceId: string;
  /** Include bounded Git diff output for the workspace. */
  readonly diff?: boolean;
  /** Optional requested subset of the fresh changed-file set for content reads. */
  readonly paths?: readonly string[];
  readonly requestId?: string;
}

/** Host-owned changed-context lane (never caller-supplied). */
export interface ChangesLane {
  /** Genuine runtime-branded validated trusted configuration (host composition). */
  readonly configuration: unknown;
  /** Committed WP-7 controlled Git inspection service (host-owned). */
  readonly git: GitInspectionService;
  /** Committed WP-7 controlled workspace read service (host-owned). */
  readonly reader: WorkspaceInspectionService;
}

/** Host-owned changed-context registration (never client-supplied). */
export interface McpChangesRegistration {
  readonly surfaceId: string;
  /** Optional changed-context lane; absent → typed `unsupported` outcome. */
  readonly lane?: ChangesLane;
}

export interface ChangesSuccessResponse {
  readonly ok: true;
  readonly result: {
    /** Freshly resolved changed-file set (Git status records). */
    readonly changedFiles: readonly GitStatusRecord[];
    readonly changedFileCount: number;
    /** Truthful truncation flag when the changed set exceeds the report cap. */
    readonly truncated: boolean;
    /** Bounded Git diff output when requested. */
    readonly diff?: { readonly text: string; readonly byteLength: number; readonly truncated: boolean };
    /** Bounded controlled contents for the requested changed-file subset. */
    readonly contents?: readonly { readonly path: string; readonly text: string; readonly byteLength: number; readonly truncated: boolean }[];
  };
  readonly requestId?: string;
}

export interface ChangesFailureResponse {
  readonly ok: false;
  readonly error: { readonly code: ChangesErrorCode; readonly message: string; readonly requestId?: string };
}

export type ChangesResponse = ChangesSuccessResponse | ChangesFailureResponse;

/** Host-owned changed-context registry (immutable after construction). */
export interface McpChangesRegistry {
  /** Route one changed-context request to the registered surface named by `surfaceId`. */
  readonly changes: (surfaceId: string, request: unknown) => Promise<ChangesResponse>;
  /** Host-side introspection: registered surface ids in canonical sorted order. */
  readonly surfaces: readonly string[];
}

export interface ChangesRegistryResult {
  readonly ok: boolean;
  readonly registry?: McpChangesRegistry;
  readonly code?: string;
  readonly message?: string;
}

const CHANGES_REQUEST_KEYS: ReadonlySet<string> = new Set(['workspaceId', 'diff', 'paths', 'requestId']);

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

function failure(code: ChangesErrorCode, message: string, requestId?: string): ChangesFailureResponse {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, ...(requestId !== undefined ? { requestId } : {}) }),
  });
}

function routingFailure(code: 'invalid-request' | 'not-found' | 'unsupported', message: string, request: unknown): ChangesFailureResponse {
  let requestId: string | undefined;
  if (typeof request === 'object' && request !== null && !Array.isArray(request)) {
    const candidate = (request as Readonly<Record<string, unknown>>)['requestId'];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= REQUEST_ID_MAX_LENGTH) {
      requestId = candidate;
    }
  }
  return failure(code, message, requestId);
}

/** Map a WP-7 operation failure onto the closed changed-context vocabulary. */
function mapOperationFailure(f: { readonly code: string }, requestId?: string): ChangesFailureResponse {
  switch (f.code) {
    case 'ERR-REQ-INVALID':
      return failure('invalid-request', 'the changed-context request is malformed', requestId);
    case 'ERR-WS-UNKNOWN':
      return failure('workspace-unavailable', 'the selected workspace is not available on this surface', requestId);
    case 'ERR-LIMIT-CONCURRENCY':
    case 'ERR-LIMIT-SIZE':
    case 'ERR-LIMIT-ENTRIES':
    case 'ERR-LIMIT-RESULTS':
      return failure('limit-exceeded', 'a controlled inspection limit was exceeded', requestId);
    case 'ERR-OP-CANCELLED':
    case 'ERR-INTERNAL-INVARIANT':
      return failure('adapter-error', 'the changed-context inspection could not be completed; no internal details are exposed', requestId);
    default:
      return failure('inspection-failed', 'the controlled inspection failed; no internal details are exposed', requestId);
  }
}

/**
 * Resolve the fresh changed-file set for one workspace through the WP-7 Git
 * status boundary. The records ARE the fresh changed set (membership source).
 */
async function resolveFreshChangedSet(
  lane: ChangesLane,
  workspaceId: string,
  requestId?: string,
): Promise<{ readonly ok: true; readonly records: readonly GitStatusRecord[] } | ChangesFailureResponse> {
  const statusResult = await lane.git.status({ operation: 'git-status', workspaceId }, {});
  if (statusResult.ok !== true) {
    return mapOperationFailure(statusResult.failure, requestId);
  }
  const value = statusResult.value as { readonly records: readonly GitStatusRecord[] };
  return { ok: true, records: value.records };
}

/**
 * One stateless changed-context inspection. Fresh Git status at point of
 * use; optional bounded diff; optional content reads confined to the fresh
 * changed-file set with WP-7 point-of-use containment rechecks.
 */
export async function inspectProjectChanges(
  surfaceId: string,
  request: unknown,
  lane: ChangesLane | undefined,
): Promise<ChangesResponse> {
  const invalid = validateSurfaceId(surfaceId);
  if (invalid !== undefined) {
    return routingFailure('invalid-request', invalid, request);
  }
  if (lane === undefined) {
    return routingFailure('unsupported', 'the selected surface has no changed-context lane configured', request);
  }
  let requestId: string | undefined;
  if (!isRecord(request)) {
    return routingFailure('invalid-request', 'changed-context request must be an object', request);
  }
  for (const key of Object.keys(request)) {
    if (!CHANGES_REQUEST_KEYS.has(key)) {
      return routingFailure('invalid-request', `unknown changed-context request field: ${key}`, request);
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
  if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspaceId.length > 128) {
    return routingFailure('invalid-request', 'workspaceId must be a bounded non-empty string', request);
  }
  const diffRequested = request['diff'] ?? false;
  if (typeof diffRequested !== 'boolean') {
    return routingFailure('invalid-request', 'diff must be a boolean when present', request);
  }
  let requestedPaths: readonly string[] = [];
  const rawPaths = request['paths'];
  if (rawPaths !== undefined) {
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
      return routingFailure('invalid-request', 'paths must be a non-empty array of bounded strings', request);
    }
    if (rawPaths.length > MAX_CHANGES_CONTENT_PATHS) {
      return failure('limit-exceeded', `at most ${MAX_CHANGES_CONTENT_PATHS} content paths may be requested per call`, requestId);
    }
    for (const raw of rawPaths) {
      if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CHANGES_PATH_LENGTH) {
        return routingFailure('invalid-request', 'each content path must be a bounded non-empty string', request);
      }
    }
    requestedPaths = rawPaths as readonly string[];
  }

  // Fresh changed set: trusted WP-7 Git status at point of use (never cached).
  const fresh = await resolveFreshChangedSet(lane, workspaceId, requestId);
  if (!fresh.ok) return fresh;
  const records = fresh.records;
  const changedSet = new Set(records.map((r) => r.path));

  // Optional bounded diff.
  let diffResult: { readonly text: string; readonly byteLength: number; readonly truncated: boolean } | undefined;
  if (diffRequested) {
    const diff = await lane.git.diff({ operation: 'git-diff', workspaceId }, {});
    if (diff.ok !== true) {
      return mapOperationFailure(diff.failure, requestId);
    }
    const value = diff.value as GitDiffResult;
    diffResult = { text: value.text, byteLength: value.byteLength, truncated: value.truncated };
  }

  // Optional content reads: confined to the fresh changed set, re-checked
  // at point of use by the WP-7 read boundary (containment + membership).
  let contents: readonly { readonly path: string; readonly text: string; readonly byteLength: number; readonly truncated: boolean }[] | undefined;
  if (requestedPaths.length > 0) {
    const built: { readonly path: string; readonly text: string; readonly byteLength: number; readonly truncated: boolean }[] = [];
    for (const path of requestedPaths) {
      // Membership: the requested path MUST belong to the freshly resolved
      // changed set; anything else fails closed (no silent partial success).
      if (!changedSet.has(path)) {
        return failure('membership-denied', `the requested path is not in the fresh changed set: ${path}`, requestId);
      }
      const read = await lane.reader.readText(
        { operation: 'read-text', workspaceId, path, maxBytes: MAX_CHANGES_CONTENT_BYTES },
        {},
      );
      if (read.ok !== true) {
        return mapContentFailure(read, requestId);
      }
      const value = read.value as ReadTextResult;
      built.push(Object.freeze({ path, text: value.text, byteLength: value.byteLength, truncated: value.truncated }));
    }
    contents = Object.freeze(built);
  }

  const reported = records.length > MAX_CHANGES_REPORTED_FILES ? records.slice(0, MAX_CHANGES_REPORTED_FILES) : records;
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      changedFiles: Object.freeze([...reported]),
      changedFileCount: records.length,
      truncated: records.length > MAX_CHANGES_REPORTED_FILES,
      ...(diffResult !== undefined ? { diff: Object.freeze(diffResult) } : {}),
      ...(contents !== undefined ? { contents } : {}),
    }),
    ...(requestId !== undefined ? { requestId } : {}),
  });
}

/** Map a WP-7 content-read failure: containment/type semantics stay typed. */
function mapContentFailure(read: Extract<OperationResult, { readonly ok: false }>, requestId?: string): ChangesFailureResponse {
  switch (read.failure.code) {
    case 'ERR-REQ-INVALID':
      return failure('invalid-request', 'the content read request is malformed', requestId);
    case 'ERR-WS-UNKNOWN':
      return failure('workspace-unavailable', 'the selected workspace is not available on this surface', requestId);
    case 'ERR-CON-DENIED':
    case 'ERR-SYM-ESCAPE':
    case 'ERR-PAT-TRAVERSAL':
      // Point-of-use containment recheck failed: drift/escape fails closed.
      return failure('membership-denied', 'the requested path is no longer a contained changed-set member at point of use', requestId);
    case 'ERR-FTYPE-UNSUPPORTED':
    case 'ERR-TEXT-MALFORMED':
    case 'ERR-NOT-FOUND':
    case 'ERR-PERM-DENIED':
      // Binary/unsupported/malformed/missing content: existing WP-7 typed
      // semantics surface as a typed content failure (delegation, not a
      // second content model).
      return failure('content-unreadable', 'the changed file content could not be read through the controlled read boundary', requestId);
    case 'ERR-LIMIT-CONCURRENCY':
    case 'ERR-LIMIT-SIZE':
    case 'ERR-LIMIT-ENTRIES':
    case 'ERR-LIMIT-RESULTS':
      return failure('limit-exceeded', 'a controlled inspection limit was exceeded', requestId);
    case 'ERR-OP-CANCELLED':
    case 'ERR-INTERNAL-INVARIANT':
      return failure('adapter-error', 'the content read could not be completed; no internal details are exposed', requestId);
    default:
      return failure('content-unreadable', 'the changed file content could not be read through the controlled read boundary', requestId);
  }
}

/** Host-owned changed-context registration context (immutable after construction). */
interface ChangesContext {
  readonly lane?: ChangesLane;
}

/**
 * Build the host-owned changed-context registry. Duplicate/conflicting
 * surfaceIds fail construction deterministically. Insertion order never
 * affects routing (surfaces are sorted canonically).
 */
export function createMcpChangesRegistry(input: { readonly registrations: readonly McpChangesRegistration[] }): ChangesRegistryResult {
  const seen = new Set<string>();
  const surfaces = new Map<string, ChangesContext>();
  for (const registration of input.registrations) {
    const invalid = validateSurfaceId(registration.surfaceId);
    if (invalid !== undefined) {
      return { ok: false, code: 'ERR-CHANGES-REQ-INVALID', message: invalid };
    }
    if (seen.has(registration.surfaceId)) {
      return { ok: false, code: 'ERR-CHANGES-REQ-INVALID', message: `surfaceId is registered more than once: ${registration.surfaceId}` };
    }
    if (registration.lane !== undefined) {
      const lane = registration.lane;
      if (typeof lane.git?.status !== 'function' || typeof lane.reader?.readText !== 'function') {
        return { ok: false, code: 'ERR-CHANGES-REQ-INVALID', message: `surface ${registration.surfaceId} has an incomplete changed-context lane` };
      }
    }
    seen.add(registration.surfaceId);
    surfaces.set(registration.surfaceId, Object.freeze(registration.lane !== undefined ? { lane: registration.lane } : {}));
  }
  const sortedIds: readonly string[] = Object.freeze([...surfaces.keys()].sort());
  const registry: McpChangesRegistry = {
    async changes(surfaceId: string, request: unknown): Promise<ChangesResponse> {
      const invalid = validateSurfaceId(surfaceId);
      if (invalid !== undefined) {
        return routingFailure('invalid-request', invalid, request);
      }
      const context = surfaces.get(surfaceId);
      if (context === undefined) {
        return routingFailure('not-found', 'the selected changed-context surface is not registered', request);
      }
      return inspectProjectChanges(surfaceId, request, context.lane);
    },
    surfaces: sortedIds,
  };
  return { ok: true, registry: Object.freeze(registry) };
}
