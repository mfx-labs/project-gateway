/**
 * WP-9 MCP inspection surface — public types (slice 1: transport-free
 * protocol/tool layer).
 *
 * The surface exposes a CLOSED read-only tool vocabulary backed by
 * existing accepted domain APIs only (WP-4 artifact validation, WP-8
 * read/registry inspection). No transport is owned by this slice: the
 * typed envelope below is the adapter's own boundary; a transport shim
 * (MCP server runtime) is a separate decision.
 *
 * AUTHORITY MODEL: the surface is constructed with a host-supplied
 * inspection context (genuine branded trusted configuration + trusted
 * bootstrap input + schema registry). MCP requests carry only logical
 * identifiers and tool names — never paths, roots, capabilities,
 * provenance, or authority-shaped operands. Results are plain frozen
 * data; feeding them into any authority boundary confers zero authority.
 */
import type { SchemaRegistry } from '../../schema/registry.js';

/** Closed MCP inspection tool vocabulary (Slice 1 + Slice 2). */
export const MCP_INSPECTION_TOOLS = ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history'] as const;
export type McpInspectionTool = (typeof MCP_INSPECTION_TOOLS)[number];

/** Narrow public error taxonomy (adapter boundary; never internal errno/stack data). */
export const MCP_ERROR_CODES = [
  'invalid-request',
  'not-found',
  'unsupported',
  'limit-exceeded',
  'invalid-cursor',
  'stale-cursor',
  'integrity-conflict',
  'adapter-error',
] as const;
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

/** One MCP inspection request (closed per-tool params; never authority operands). */
export interface McpInspectionRequest {
  /** Exact tool name from the closed vocabulary. */
  readonly tool: string;
  /** Per-tool closed parameter object; validated strictly, never coerced. */
  readonly params: unknown;
  /** Optional opaque correlation id (bounded; echoed verbatim). */
  readonly requestId?: string;
}

/** One MCP inspection response (deterministic public mapping). */
export interface McpInspectionResponse {
  readonly ok: boolean;
  /** Present only on success: redacted public facts. */
  readonly result?: Readonly<Record<string, unknown>>;
  /** Present only on failure: mapped public error (fixed message; no internals). */
  readonly error?: { readonly code: McpErrorCode; readonly message: string; readonly requestId?: string };
}

/** Host-supplied inspection context (the ONLY targeting authority; never client-supplied). */
export interface McpInspectionContextInput {
  /** Genuine WP-6 validated trusted configuration (runtime-branded; host-supplied). */
  readonly trustedConfiguration: unknown;
  /** Genuine branded `TrustedStorageBootstrapInput` (host-supplied; never minted here). */
  readonly trustedInput: unknown;
  /** WP-4 schema registry; defaults to `createSchemaRegistry()` when omitted. */
  readonly schemaRegistry?: SchemaRegistry;
}

/** Verified inspection context bound to ONE healthy verified store. */
export interface McpInspectionContext {
  readonly trustedConfiguration: unknown;
  readonly trustedInput: unknown;
  readonly schemaRegistry: SchemaRegistry;
  /** Verified store instance (strict verification at construction; re-verified per request by the domain). */
  readonly storeInstance: Readonly<{
    readonly configurationIdentity: string;
    readonly serviceUid: number;
  }>;
}

/** Tool descriptor (advertisement surface for a future transport shim). */
export interface McpToolDescriptor {
  readonly name: McpInspectionTool;
  readonly description: string;
  /** Closed parameter field names for the tool (types enforced by validation). */
  readonly params: readonly string[];
  readonly readOnly: true;
}

/** The inspection surface: one verified store, closed tools, deterministic mapping. */
export interface McpInspectionSurface {
  /** Deterministic dispatch: validate → domain API → public response mapping. */
  readonly inspect: (request: McpInspectionRequest) => McpInspectionResponse;
  /** Immutable closed tool inventory. */
  readonly tools: readonly McpToolDescriptor[];
}
