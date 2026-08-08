/**
 * WP-9 Slice 5 / WP-10 Slice 3 — MCP server factory for the local stdio
 * runtime.
 *
 * PURE ROUTING LAYER: accepts an already-created trusted
 * `McpInspectionRegistry` (WP-9) and the host-owned `McpDraftingRegistry`
 * (WP-10 Slice 2 adapter), registers exactly the six committed inspection
 * tools plus the one WP-10 drafting tool (`draft-artifact`), and contains
 * NO storage/domain/drafting logic. Trusted startup composition lives in
 * `compose.ts`; protocol framing/negotiation lives in the SDK
 * (`serveStdio`); this module only maps MCP tool arguments onto the
 * committed internal request envelopes and routes through the registries.
 *
 * TOOL RESULT MAPPING: every committed adapter response — success
 * (`ok: true`) or expected inspection/drafting outcome (`ok: false` with
 * the closed taxonomy) — is a successful MCP tool result (`isError`
 * absent/false): the tool executed correctly and reported an outcome.
 * For `draft-artifact`, routing success carries the complete Slice 1
 * `DraftProposalResult` VERBATIM (including inner `ok:false` drafting
 * outcomes such as `invalid-draft-request`, `unsupported-artifact-kind`,
 * `limit-exceeded`, and `valid:false` conclusions); only the outer
 * adapter routing failures (`invalid-request`, `not-found`) surface as
 * outer `ok:false` tool results. Protocol errors (malformed messages,
 * unknown methods, outer argument-shape failures) are owned by the SDK
 * and never carry internal stack material.
 *
 * The SDK input schema is an OUTER syntax/type boundary only (object shape,
 * required fields, primitive types, closed fields). Semantic validation
 * (surface grammar, artifact kind vocabulary, artifact byte limits, raw
 * JSON intake, WP-4 semantics) remains owned by the committed
 * adapter/registry/core: the SDK must NOT preempt `unsupported-artifact-kind`
 * (no kind enum), `limit-exceeded` (no byte ceiling), or outer
 * `invalid-request` for malformed selectors (plain string surfaceId).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpInspectionRegistry, McpInspectionResponse, McpDraftingRegistry, DraftingResponse } from '../../adapters/mcp/index.js';
import { writeDiagnostic } from './diagnostics.js';

/** Informational server identity (never trust/authorization/cursor material). */
export interface McpServerIdentity {
  readonly name: string;
  readonly version: string;
}

/**
 * Closed output envelope for every tool result: the committed
 * `McpInspectionResponse` shape. The SDK validates `structuredContent`
 * against this schema on the modern 2026-07-28 path (a loose `z.unknown()`
 * output schema caused the SDK to rebuild the object and drop keys); inner
 * result/error shapes remain SDK-unknown — the committed adapter is the
 * semantic authority. `passthrough()` keeps the schema open to additive
 * top-level fields without weakening the committed closed response.
 */
const RESPONSE_OUTPUT_SCHEMA = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
    requestId: z.string().optional(),
  })
  .passthrough();

const TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'validate-artifact':
    'Validate supplied artifact content through the pure WP-4 validation pipeline. Answers valid/invalid, artifact kind, schema and rule identifiers, and bounded diagnostics. Never implies stored, approved, issued, active, or authorized. The required surfaceId selects the registered host-owned inspection surface (its trusted schema registry is authoritative).',
  'inspect-stored-record':
    'Inspect one exact verified stored record by logical class and canonical typed identity on the selected surface. Returns only verified public facts (envelope model, digest, byte length); malformed or conflicting stored content is never returned as verified data. The required surfaceId selects the registered host-owned inspection surface.',
  'inspect-registry':
    'Authoritative read-only registry view of the selected surface through the WP-8 registry derivation. Optional verified persistent-index fast path with automatic authoritative fallback; opaque self-validating continuation preserves bounded paging. The required surfaceId selects the registered host-owned inspection surface.',
  'inspect-audit-history':
    'Bounded read-only audit-history inspection for one exact store record on the selected surface through the WP-8K history API. Preserves normative event ordering, snapshot-bound continuation, status/completeness, reconstruction and event-without-evidence findings exactly as the domain reports them. Never a reconstruction authority. The required surfaceId selects the registered host-owned inspection surface.',
  'verify-record':
    'Verify one exact stored record by logical class and canonical typed identity on the selected surface through the WP-8 verify-by-identity API. Answers verified exact match or a mapped fail-closed condition (not-found, integrity-conflict, limit-exceeded, unsupported); never returns record content; never implies approval, issuance, activation, or lifecycle validity. The required surfaceId selects the registered host-owned inspection surface.',
  'enumerate-class':
    'Bounded deterministic enumeration of one record class on the selected surface through the WP-8 enumeration API: verified record identities and bounded findings, deterministic shard order, opaque position continuation, truncation reported truthfully. Not a registry view and not a filesystem listing. The required surfaceId selects the registered host-owned inspection surface.',
  'draft-artifact':
    'Create an in-memory draft proposal for one prospective artifact kind and self-validate it under the selected surface host-owned schema context. The draft is plain in-memory data only: nothing is persisted, approved, issued, activated, or executed, and the result confers no authority. The required surfaceId selects host-owned validation context only — it is never a destination, write target, or authority grant.',
};

/** Route one inspection tool call through the committed registry and map to an MCP tool result. */
function runTool(registry: McpInspectionRegistry, tool: string, args: Readonly<Record<string, unknown>>): { content: { type: 'text'; text: string }[]; structuredContent: McpInspectionResponse } {
  try {
    const { surfaceId, ...params } = args;
    const response = registry.inspect(surfaceId as string, { tool, params });
    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      structuredContent: response,
    };
  } catch (err) {
    // Unexpected runtime failure: bounded stderr diagnostic; generic tool
    // error to the client (the SDK surfaces it without internal details).
    const detail = err instanceof Error ? err.message : 'unknown error';
    writeDiagnostic(`unexpected failure while executing tool ${tool}: ${detail}`);
    throw new Error('inspection failed unexpectedly');
  }
}

/** Route one draft tool call through the committed drafting registry and map to an MCP tool result. */
function runDraftTool(draftingRegistry: McpDraftingRegistry, args: Readonly<Record<string, unknown>>): { content: { type: 'text'; text: string }[]; structuredContent: DraftingResponse } {
  try {
    const { surfaceId, kind, content } = args;
    // No invented requestId: the runtime calls the transport-free adapter
    // with the closed drafting envelope only.
    const response = draftingRegistry.draft(surfaceId as string, { kind, content });
    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      structuredContent: response,
    };
  } catch (err) {
    // Unexpected runtime failure: bounded stderr diagnostic; generic tool
    // error to the client (the SDK surfaces it without internal details).
    const detail = err instanceof Error ? err.message : 'unknown error';
    writeDiagnostic(`unexpected failure while executing drafting tool: ${detail}`);
    throw new Error('drafting failed unexpectedly');
  }
}

/**
 * Create the MCP server bound to one trusted inspection registry and one
 * host-owned drafting registry.
 *
 * Exactly seven tools are registered: the six WP-9 inspection tools plus the
 * one WP-10 drafting tool (`draft-artifact`); no eighth admin/registration/
 * list-stores/health/transport tool exists. Tool names and schemas are
 * stable regardless of which surfaces are registered (only routing data
 * changes), preserving stable ChatGPT tool metadata.
 */
export function createMcpServer(registry: McpInspectionRegistry, draftingRegistry: McpDraftingRegistry, identity: McpServerIdentity): McpServer {
  const server = new McpServer({ name: identity.name, version: identity.version }, { capabilities: { tools: {} } });

  server.registerTool(
    'validate-artifact',
    {
      description: TOOL_DESCRIPTIONS['validate-artifact'],
      inputSchema: z.object({ surfaceId: z.string(), content: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runTool(registry, 'validate-artifact', args),
  );

  server.registerTool(
    'inspect-stored-record',
    {
      description: TOOL_DESCRIPTIONS['inspect-stored-record'],
      inputSchema: z.object({ surfaceId: z.string(), recordClass: z.string(), recordId: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runTool(registry, 'inspect-stored-record', args),
  );

  server.registerTool(
    'inspect-registry',
    {
      description: TOOL_DESCRIPTIONS['inspect-registry'],
      inputSchema: z.object({ surfaceId: z.string(), continuation: z.string().optional(), usePersistentIndex: z.boolean().optional() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runTool(registry, 'inspect-registry', args),
  );

  server.registerTool(
    'inspect-audit-history',
    {
      description: TOOL_DESCRIPTIONS['inspect-audit-history'],
      inputSchema: z.object({ surfaceId: z.string(), recordClass: z.string(), recordId: z.string(), revision: z.number().optional(), continuation: z.string().optional() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runTool(registry, 'inspect-audit-history', args),
  );

  server.registerTool(
    'verify-record',
    {
      description: TOOL_DESCRIPTIONS['verify-record'],
      inputSchema: z.object({ surfaceId: z.string(), recordClass: z.string(), recordId: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runTool(registry, 'verify-record', args),
  );

  server.registerTool(
    'enumerate-class',
    {
      description: TOOL_DESCRIPTIONS['enumerate-class'],
      inputSchema: z.object({ surfaceId: z.string(), recordClass: z.string(), continuation: z.string().optional() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runTool(registry, 'enumerate-class', args),
  );

  // WP-10 Slice 3 — the ONE drafting tool. The SDK schema is shape/type only:
  // `kind` is a plain string (the core owns the closed producer vocabulary,
  // so `ExecutionResult` must reach the inner `unsupported-artifact-kind`
  // outcome, never an SDK error); `content` is a plain string with no byte
  // ceiling (the core owns the accepted `limit-exceeded` bound); `surfaceId`
  // is a plain string (the outer adapter owns the selector grammar, so
  // malformed selectors reach the outer `invalid-request` outcome).
  server.registerTool(
    'draft-artifact',
    {
      description: TOOL_DESCRIPTIONS['draft-artifact'],
      inputSchema: z.object({ surfaceId: z.string(), kind: z.string(), content: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      outputSchema: RESPONSE_OUTPUT_SCHEMA,
    },
    (args) => runDraftTool(draftingRegistry, args),
  );

  return server;
}
