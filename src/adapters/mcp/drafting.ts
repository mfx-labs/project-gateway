/**
 * WP-10 Slice 2 — transport-free host/surface-aware drafting adapter.
 *
 * MODEL: the trusted host registers logical `surfaceId`s, each carrying the
 * EXACT `SchemaRegistry` instance it also registers for the same surface in
 * the WP-9 inspection registry (same-instance composition: the accepted
 * DRAFT/VALIDATE SURFACE CONSISTENCY invariant). MCP clients NEVER supply
 * roots, locators, paths, or trusted-input material: they select a registered
 * surface ONLY by its opaque logical `surfaceId`. `surfaceId` selects
 * host-owned validation context — it is NEVER a persistence destination,
 * workspace write target, or storage authority (WP-11 remains the
 * persistence boundary).
 *
 * ROUTING: `registry.draft(surfaceId, request)` validates the logical
 * selector (exact accepted WP-9 `SURFACE_ID_RE` grammar), resolves the
 * registered surface, validates the closed transport-free request envelope
 * `{ kind, content, requestId? }`, and delegates to the accepted Slice 1
 * core under the surface's EXACT registered schema registry via the
 * `createDraftProposalWithSchemaRegistry` injection seam. The complete
 * Slice 1 `DraftProposalResult` is preserved VERBATIM inside the successful
 * outer response — the inner drafting taxonomy (`invalid-draft-request`,
 * `unsupported-artifact-kind`, `limit-exceeded`,
 * `internal-adapter-failure`, and `valid:false` conclusions) is never
 * remapped into inspection/storage codes. Routing failures (malformed
 * selector, unknown selector, malformed envelope) are outer routing errors
 * and stay distinct from inner drafting outcomes.
 *
 * REGISTRATION: host-owned, immutable after construction,
 * insertion-order-independent, no client mutation API, no inventory tool.
 * Exact duplicate/conflicting duplicate surfaceIds fail construction
 * deterministically. An empty registry is legal (every selector routes
 * not-found), consistent with the WP-9 host registration contract.
 *
 * BOUNDARY: this module is transport-free (no MCP SDK, no stdio runtime, no
 * network listener). Drafting selects validation context only: it does NOT
 * grant persistence, approval, issuance, activation, execution, workspace
 * access, or any trusted brand. Results are plain frozen data conferring
 * zero authority at any trusted boundary. Deterministic: no clock, no
 * randomness, no process identity. No filesystem access.
 */
import { SchemaRegistry } from '../../schema/registry.js';
import { createDraftProposalWithSchemaRegistry } from '../../drafting/proposal.js';
import type { DraftProposalRequest, DraftProposalResult } from '../../drafting/proposal.js';
import { SURFACE_ID_MAX_LENGTH, SURFACE_ID_RE } from './registry.js';
import { REQUEST_ID_MAX_LENGTH } from './validate.js';

/**
 * Distinct transport-free drafting tool vocabulary for the LATER stdio
 * registration slice. Exactly one tool: `draft-artifact`. Kept strictly
 * separate from `MCP_INSPECTION_TOOLS` (WP-9's closed six-tool inspection
 * inventory remains untouched); nothing is registered in this slice.
 */
export const MCP_DRAFT_TOOLS = ['draft-artifact'] as const;
export type McpDraftTool = (typeof MCP_DRAFT_TOOLS)[number];

/** Closed drafting routing error vocabulary (outer envelope only; never inner drafting codes). */
export type DraftingRoutingErrorCode = 'invalid-request' | 'not-found';

/** Successful routing: the complete accepted Slice 1 `DraftProposalResult`, verbatim. */
export interface DraftingSuccessResponse {
  readonly ok: true;
  readonly result: DraftProposalResult;
  readonly requestId?: string;
}

/** Outer routing failure: malformed/unknown surface selector or malformed envelope. */
export interface DraftingRoutingErrorResponse {
  readonly ok: false;
  readonly error: { readonly code: DraftingRoutingErrorCode; readonly message: string; readonly requestId?: string };
}

export type DraftingResponse = DraftingSuccessResponse | DraftingRoutingErrorResponse;

/** Narrowest transport-free drafting context: only what draft self-validation requires. */
export interface DraftingContext {
  /** The surface's exact host-registered schema registry (validation context only). */
  readonly schemaRegistry: SchemaRegistry;
}

export interface DraftingContextResult {
  readonly ok: boolean;
  readonly context?: DraftingContext;
  readonly code?: string;
  readonly message?: string;
}

/** Host-owned drafting registration (never client-supplied). */
export interface McpDraftingRegistration {
  /** Opaque logical surface identifier (exact accepted WP-9 grammar). */
  readonly surfaceId: string;
  /** The EXACT schema registry instance registered for the same surface in the inspection registry. */
  readonly schemaRegistry: SchemaRegistry;
}

/** Host-owned drafting registry (immutable after construction). */
export interface McpDraftingRegistry {
  /**
   * Route one drafting request to the registered surface named by
   * `surfaceId`. Malformed selectors/envelopes fail as `invalid-request`;
   * well-formed but unregistered selectors fail as `not-found` (no inventory
   * or path leakage). On success the response carries the complete accepted
   * Slice 1 `DraftProposalResult` under the surface's exact registered
   * schema registry — never remapped.
   */
  readonly draft: (surfaceId: string, request: unknown) => DraftingResponse;
  /** Host-side introspection: registered surface ids in canonical sorted order. */
  readonly surfaces: readonly string[];
}

export interface DraftingRegistryResult {
  readonly ok: boolean;
  readonly registry?: McpDraftingRegistry;
  readonly code?: string;
  readonly message?: string;
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

function routingError(code: DraftingRoutingErrorCode, message: string, request: unknown): DraftingRoutingErrorResponse {
  let requestId: string | undefined;
  if (typeof request === 'object' && request !== null && !Array.isArray(request)) {
    const candidate = (request as Readonly<Record<string, unknown>>)['requestId'];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= REQUEST_ID_MAX_LENGTH) {
      requestId = candidate;
    }
  }
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, ...(requestId !== undefined ? { requestId } : {}) }) });
}

function successResponse(result: DraftProposalResult, requestId?: string): DraftingSuccessResponse {
  // The Slice 1 core result is already deeply frozen plain data.
  return Object.freeze({ ok: true, result, ...(requestId !== undefined ? { requestId } : {}) });
}

/**
 * Establish the drafting context for one surface. The ONLY essential fact is
 * the exact host-supplied schema registry; the registry must be a genuine
 * `SchemaRegistry` (host composition error otherwise). No store, trusted
 * configuration, workspace root, locator, or reader is required for pure
 * draft self-validation (WP-6/WP-7 non-use, accepted Slice-2 decision).
 */
export function createDraftingContext(input: { readonly schemaRegistry: unknown }): DraftingContextResult {
  const registry = input.schemaRegistry;
  if (!(registry instanceof SchemaRegistry)) {
    return { ok: false, code: 'ERR-DRAFT-REQ-INVALID', message: 'the drafting context requires a genuine host-supplied SchemaRegistry' };
  }
  return { ok: true, context: Object.freeze({ schemaRegistry: registry }) };
}

/**
 * Build the host-owned drafting registry. Every registration must carry a
 * genuine `SchemaRegistry`; a failed registration fails construction
 * deterministically (duplicate or conflicting surfaceId ownership is never
 * silently overwritten). Insertion order never affects routing or
 * introspection (surfaces are sorted canonically).
 */
export function createMcpDraftingRegistry(input: { readonly registrations: readonly McpDraftingRegistration[] }): DraftingRegistryResult {
  const seen = new Set<string>();
  const surfaces = new Map<string, DraftingContext>();
  for (const registration of input.registrations) {
    const invalid = validateSurfaceId(registration.surfaceId);
    if (invalid !== undefined) {
      return { ok: false, code: 'ERR-DRAFT-REQ-INVALID', message: invalid };
    }
    if (seen.has(registration.surfaceId)) {
      // Exact duplicate and conflicting duplicate both fail closed: one
      // logical surface owns exactly one verified registration.
      return { ok: false, code: 'ERR-DRAFT-REQ-INVALID', message: `surfaceId is registered more than once: ${registration.surfaceId}` };
    }
    const contextResult = createDraftingContext({ schemaRegistry: registration.schemaRegistry });
    if (!contextResult.ok || contextResult.context === undefined) {
      return { ok: false, code: contextResult.code ?? 'ERR-DRAFT-REQ-INVALID', message: contextResult.message ?? `surface ${registration.surfaceId} has no genuine drafting context` };
    }
    seen.add(registration.surfaceId);
    surfaces.set(registration.surfaceId, contextResult.context);
  }
  const sortedIds: readonly string[] = Object.freeze([...surfaces.keys()].sort());
  const registry: McpDraftingRegistry = {
    draft(surfaceId: string, request: unknown): DraftingResponse {
      const invalid = validateSurfaceId(surfaceId);
      if (invalid !== undefined) {
        return routingError('invalid-request', invalid, request);
      }
      const context = surfaces.get(surfaceId);
      if (context === undefined) {
        return routingError('not-found', 'the selected drafting surface is not registered', request);
      }
      // Closed transport-free request envelope: { kind, content, requestId? }.
      // kind/content SEMANTICS stay fully owned by the accepted Slice 1 core
      // (its closed taxonomy is preserved verbatim); only envelope mechanics
      // are validated here.
      if (typeof request !== 'object' || request === null || Array.isArray(request)) {
        return routingError('invalid-request', 'draft request must be an object', request);
      }
      const record = request as Readonly<Record<string, unknown>>;
      for (const key of Object.keys(record)) {
        if (key !== 'kind' && key !== 'content' && key !== 'requestId') {
          return routingError('invalid-request', `unknown draft request field: ${key}`, request);
        }
      }
      let requestId: string | undefined;
      if (record['requestId'] !== undefined) {
        const candidate = record['requestId'];
        if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > REQUEST_ID_MAX_LENGTH) {
          return routingError('invalid-request', 'requestId must be a bounded non-empty string', request);
        }
        requestId = candidate;
      }
      const inner: DraftProposalRequest = { kind: record['kind'] as never, content: record['content'] as string };
      const result = createDraftProposalWithSchemaRegistry(inner, context.schemaRegistry);
      return successResponse(result, requestId);
    },
    surfaces: sortedIds,
  };
  return { ok: true, registry: Object.freeze(registry) };
}
