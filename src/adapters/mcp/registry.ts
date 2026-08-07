/**
 * WP-9 Slice 4 — host-owned multi-store inspection surface registration.
 *
 * MODEL: the trusted host registers logical `surfaceId`s, each derived from
 * the SAME genuine trusted composition inputs as the committed single-store
 * `createInspectionContext` (genuine branded trusted configuration + genuine
 * branded `TrustedStorageBootstrapInput` + optional schema registry; strict
 * `verifyStoreInstance` at construction). MCP clients NEVER supply roots,
 * locators, paths, or trusted-input material: they select a registered
 * surface ONLY by its opaque logical `surfaceId`, which resolves through the
 * host-owned registry.
 *
 * ROUTING: `registry.inspect(surfaceId, request)` validates the logical
 * selector, resolves it, and delegates to the committed per-surface
 * `McpInspectionSurface` — the six-tool semantics and the request envelope
 * `{ tool, params, requestId? }` are byte-identical to the single-store API.
 * The committed single-store surface/context APIs are unchanged.
 *
 * FRESHNESS: registration is NOT cached authority. Every routed store-backed
 * request re-runs the domain's own per-request store revalidation and
 * capability issuance, so a tampered/replaced store, a store-root
 * substitution, or an in-process trusted-generation advance fails closed per
 * request; an independent healthy store is never poisoned.
 *
 * WP-9 GENERATION SEEDING: NOT implemented in this slice. No normative
 * definition of a WP-9 generation seed exists anywhere in the repository
 * (all references are later-work list items), and registration correctness
 * does not require it (existing per-store verification + per-request
 * revalidation provide identity/freshness). It remains explicitly remaining
 * WP-9 work.
 *
 * AUTHORITY: registration objects, surfaceIds, and the registry itself are
 * routing data. Nothing here mints or reaches capabilities, provenance,
 * trusted inputs, permits, or any mutation surface; results are plain frozen
 * data.
 */
import { createInspectionContext } from './context.js';
import { createMcpInspectionSurface } from './inspect.js';
import type { McpInspectionRequest, McpInspectionResponse, McpInspectionSurface } from './types.js';
import type { SchemaRegistry } from '../../schema/registry.js';

/**
 * Closed logical surface identifier: 1-64 lowercase alphanumeric characters
 * with interior hyphens. Never a path, never a locator, never a trusted-input
 * serialization. Host-chosen; resolved only through host-owned registration.
 */
export const SURFACE_ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const SURFACE_ID_MAX_LENGTH = 64;

/** Host-owned registration input (never client-supplied). */
export interface McpStoreRegistrationInput {
  /** Opaque logical surface identifier (closed pattern above). */
  readonly surfaceId: string;
  /** Genuine WP-6 validated trusted configuration (runtime-branded). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput`. */
  readonly trustedInput: unknown;
  /** WP-4 schema registry for this surface; defaults per context. */
  readonly schemaRegistry?: SchemaRegistry;
}

/** Host-owned multi-store inspection registry (immutable after construction). */
export interface McpInspectionRegistry {
  /**
   * Route one inspection request to the registered surface named by
   * `surfaceId`. Malformed selectors fail as `invalid-request`; well-formed
   * but unregistered selectors fail as `not-found` (no inventory or path
   * leakage). On success the response is exactly the committed per-surface
   * response for the same request.
   */
  readonly inspect: (surfaceId: string, request: unknown) => McpInspectionResponse;
  /** Host-side introspection: registered surface ids in canonical sorted order. */
  readonly surfaces: readonly string[];
}

export interface RegistryResult {
  readonly ok: boolean;
  readonly registry?: McpInspectionRegistry;
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

function routingError(code: 'invalid-request' | 'not-found', message: string, request: unknown): McpInspectionResponse {
  let requestId: string | undefined;
  if (typeof request === 'object' && request !== null && !Array.isArray(request)) {
    const candidate = (request as Readonly<Record<string, unknown>>)['requestId'];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128) {
      requestId = candidate;
    }
  }
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, ...(requestId !== undefined ? { requestId } : {}) }) });
}

/**
 * Build the host-owned registry. Every registration must pass the exact
 * single-store trust and verification requirements; a failed registration
 * fails construction deterministically (duplicate or conflicting surfaceId
 * ownership is never silently overwritten).
 */
export function createMcpInspectionRegistry(input: { readonly registrations: readonly McpStoreRegistrationInput[] }): RegistryResult {
  const seen = new Map<string, string>();
  const surfaces = new Map<string, McpInspectionSurface>();
  for (const registration of input.registrations) {
    const invalid = validateSurfaceId(registration.surfaceId);
    if (invalid !== undefined) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: invalid };
    }
    const prior = seen.get(registration.surfaceId);
    if (prior !== undefined) {
      // Exact duplicate and conflicting duplicate both fail closed: one
      // logical surface owns exactly one verified registration.
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: `surfaceId is registered more than once: ${registration.surfaceId}` };
    }
    const context = createInspectionContext({
      trustedConfiguration: registration.trustedConfiguration,
      trustedInput: registration.trustedInput,
      ...(registration.schemaRegistry !== undefined ? { schemaRegistry: registration.schemaRegistry } : {}),
    });
    if (!context.ok || context.context === undefined) {
      return { ok: false, code: context.code ?? 'ERR-STO-REQ-INVALID', message: context.message ?? `surface ${registration.surfaceId} could not be verified` };
    }
    seen.set(registration.surfaceId, registration.surfaceId);
    surfaces.set(registration.surfaceId, createMcpInspectionSurface(context.context));
  }
  const sortedIds: readonly string[] = Object.freeze([...surfaces.keys()].sort());
  const registry: McpInspectionRegistry = {
    inspect(surfaceId: string, request: unknown): McpInspectionResponse {
      const invalid = validateSurfaceId(surfaceId);
      if (invalid !== undefined) {
        return routingError('invalid-request', invalid, request);
      }
      const surface = surfaces.get(surfaceId);
      if (surface === undefined) {
        return routingError('not-found', 'the selected inspection surface is not registered', request);
      }
      // The committed surface re-validates the raw request envelope itself
      // (closed-field validation; never coerced); the registry only routes.
      return surface.inspect(request as McpInspectionRequest);
    },
    surfaces: sortedIds,
  };
  return { ok: true, registry: Object.freeze(registry) };
}
