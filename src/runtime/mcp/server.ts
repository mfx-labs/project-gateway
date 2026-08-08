/**
 * WP-9 Slice 5 — MCP server factory for the local stdio runtime.
 *
 * PURE ROUTING LAYER: accepts an already-created trusted
 * `McpInspectionRegistry`, registers exactly the six committed inspection
 * tools, and contains NO storage/domain logic. Trusted startup composition
 * lives in `compose.ts`; protocol framing/negotiation lives in the SDK
 * (`serveStdio`); this module only maps MCP tool arguments onto the
 * committed internal request envelope and routes through the registry.
 *
 * TOOL RESULT MAPPING: every committed adapter response — success
 * (`ok: true`) or expected inspection outcome (`ok: false` with the closed
 * taxonomy: invalid-request / not-found / invalid-cursor / stale-cursor /
 * integrity-conflict / limit-exceeded / unsupported / adapter-error) — is a
 * successful MCP tool result (`isError` absent/false): the tool executed
 * correctly and reported an inspection outcome. Protocol errors
 * (malformed messages, unknown methods, outer argument-shape failures) are
 * owned by the SDK and never carry internal stack material.
 *
 * The SDK input schema is an OUTER syntax/type boundary only (object shape,
 * required fields, primitive types, closed fields). Semantic validation
 * (surface grammar, canonical typed identifiers, record-class vocabulary,
 * path-shaped identifiers, cursor semantics, artifact byte limits, revision
 * semantics) remains owned by the committed adapter/registry.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpInspectionRegistry, McpInspectionResponse } from '../../adapters/mcp/index.js';
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
};

/** Route one tool call through the committed registry and map to an MCP tool result. */
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

/**
 * Create the MCP server bound to one trusted registry.
 *
 * Exactly six tools are registered; no seventh admin/registration/
 * list-stores/health/transport tool exists. Tool names and schemas are
 * stable regardless of which surfaces are registered (only routing data
 * changes), preserving stable ChatGPT tool metadata.
 */
export function createMcpServer(registry: McpInspectionRegistry, identity: McpServerIdentity): McpServer {
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

  return server;
}
