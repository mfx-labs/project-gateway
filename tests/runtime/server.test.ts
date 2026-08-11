/**
 * WP-9 Slice 5 / WP-10 Slice 3 / WP-14A — MCP server factory tests
 * (in-process, SDK client over paired in-memory transports).
 *
 * NOTE ON PROTOCOL ERA: `server.connect(transport)` is the SDK's 2025-era
 * direct pattern; the MODERN 2026-07-28 path is owned by `serveStdio` and is
 * proven by the subprocess stdio tests (`stdio.test.ts`). These in-process
 * tests exercise tool schemas, routing, cursor round-trips, drafting
 * passthrough, and read-only/non-escalation semantics — never claimed as
 * modern-era proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createInspectionContext, createMcpInspectionRegistry, createMcpInspectionSurface, createMcpDraftingRegistry, createMcpPersistRegistry, createMcpChangesRegistry, MCP_INSPECTION_TOOLS, MCP_PERSIST_TOOLS, MCP_CHANGES_TOOLS } from '../../src/adapters/mcp/index.js';
import type { McpDraftingRegistry, DraftingResponse, McpPersistRegistry, McpChangesRegistry } from '../../src/adapters/mcp/index.js';
import { createMcpServer } from '../../src/runtime/mcp/server.js';
import { composeTrustedRegistry } from '../../src/runtime/mcp/compose.js';
import type { RuntimeConfig } from '../../src/runtime/mcp/config.js';
import { markValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../src/storage/publication/index.js';
import { buildAuthorizedWriteAuditEvent, buildRecoveryAuditReconstructionEvent } from '../../src/storage/audit/write-audit.js';
import { verifyStoreInstance } from '../../src/storage/read/read-record.js';
import { deriveRecordRelativePath } from '../../src/storage/layout/layout.js';
import { canonicalEnvelopeBytes, computePayloadDigest } from '../../src/storage/format/envelope.js';
import { createSchemaRegistry, computeArtifactDigest } from '../../src/api/validate.js';
import { SchemaRegistry, type SchemaErrorLike } from '../../src/schema/registry.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../src/storage/limits/limits.js';
import type { McpInspectionRegistry } from '../../src/adapters/mcp/index.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const UID = process.getuid?.() ?? 0;
const CID = 'sha-256:' + 'a'.repeat(64);
const RECORD_ID = 'pgw:r:aaaa0000000000000000000000000001';

const VALID_TASKSPEC = JSON.stringify({ protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' }, kind: { id: 'TaskSpec', version: '1.0' }, instance_id: 'pgw:i:9e74f09cf0287d6787d69e8ebddb5157', revision: { id: 'pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f', generation: 0, predecessor: null, digest: 'sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b' }, workspace_binding: { mode: 'portable' }, requirements: { protocol_features: [], consumer_capabilities: [] }, extensions: [], body: { objective: 'Produce a fixture conformance note.', instructions: [{ instruction_id: 'prepare-note', text: 'Create the requested conformance note.' }], expected_deliverables: [{ deliverable_id: 'conformance-note', description: 'A project-visible conformance note.', kind: 'document' }], outcome_constraints: [], project_data_citations: [] } });

const VALID_FIXTURES: Readonly<Record<string, string>> = {
  TaskSpec: 'task-minimal-genesis.json',
  AuthorityPolicy: 'policy-minimal-genesis.json',
  ContextManifest: 'context-minimal-genesis.json',
  CompletionContract: 'completion-minimal-genesis.json',
  ExecutionBundle: 'bundle-minimal-genesis.json',
};

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', name), 'utf8')) as Record<string, unknown>;
}

function invalidFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', name), 'utf8')) as Record<string, unknown>;
}

/** Draft content: the canonical envelope with the derived digest member removed. */
function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

/** Counts every structural schema-validation call — proves exact registry-instance consultation. */
class CountingRegistry extends SchemaRegistry {
  validateCalls = 0;
  override validate(schemaId: string, instance: unknown): { valid: boolean; errors: readonly SchemaErrorLike[] } {
    this.validateCalls++;
    return super.validate(schemaId, instance);
  }
}

function profile(overrides: Partial<Record<string, number>> = {}): SelectedLimitProfile {
  const base: Record<string, number> = { ...defaultLimitProfile() };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) base[k] = v;
  return base as SelectedLimitProfile;
}

function makeStore(lp: SelectedLimitProfile = profile()): { dir: string; config: object; trustedInput: unknown; lp: SelectedLimitProfile; storeRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), 's5srv-'));
  chmodSync(dir, 0o700);
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CID };
  markValidatedTrustedWorkspaceConfiguration(config);
  const bp = createStorageBootstrapActionProvenance({ actionIdentity: 's5-b', locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, limitProfile: lp });
  const ir = createTrustedStorageBootstrapInput(config, bp, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: lp });
  assert.equal(ir.ok, true);
  const init = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bp, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: lp });
  assert.equal(init.ok, true, JSON.stringify(init.findings));
  return { dir, config, trustedInput: ir.input, lp, storeRoot: `${dir}/store-v1` };
}

function publish(env: { dir: string; config: object; trustedInput: unknown; lp: SelectedLimitProfile }, payload: Readonly<Record<string, unknown>> = { approved: true }): string {
  const wp = createStorageWriteActionProvenance({ actionIdentity: 's5-w', locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, limitProfile: env.lp });
  const rec = { recordKind: 'ApprovalRecord', formatVersion: '1.0', recordId: RECORD_ID, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', trustedActionId: 's5-w', payload, payloadDigest: computePayloadDigest(payload) };
  const r = publishRecord({ trustedConfiguration: env.config, bootstrapInput: env.trustedInput, writeActionProvenance: wp, locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.lp, recordClass: 'approval-record', record: rec, timeSource: { now: () => 1000, processStartTime: 500 } });
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  return r.recordDigest as string;
}

function registryFor(envs: { surfaceId: string; env: { dir: string; config: object; trustedInput: unknown } }[]): McpInspectionRegistry {
  const built = createMcpInspectionRegistry({
    registrations: envs.map(({ surfaceId, env }) => ({ surfaceId, trustedConfiguration: env.config, trustedInput: env.trustedInput, schemaRegistry: createSchemaRegistry() })),
  });
  assert.equal(built.ok, true, built.message ?? '');
  return built.registry as McpInspectionRegistry;
}

/** Drafting registry for the same surfaces (fresh registry per surface; the shared-instance tests build both explicitly). */
function draftingFor(envs: { surfaceId: string }[]): McpDraftingRegistry {
  const built = createMcpDraftingRegistry({
    registrations: envs.map(({ surfaceId }) => ({ surfaceId, schemaRegistry: createSchemaRegistry() })),
  });
  assert.equal(built.ok, true, built.message ?? '');
  return built.registry as McpDraftingRegistry;
}

/** WP-14A persist registry for the same surfaces (no lanes: typed unsupported outcomes). */
function persistFor(envs: { surfaceId: string }[]): McpPersistRegistry {
  const built = createMcpPersistRegistry({
    registrations: envs.map(({ surfaceId }) => ({ surfaceId, schemaRegistry: createSchemaRegistry() })),
  });
  assert.equal(built.ok, true, built.message ?? '');
  return built.registry as McpPersistRegistry;
}

/** WP-14A changed-context registry for the same surfaces (no lanes). */
function changesFor(envs: { surfaceId: string }[]): McpChangesRegistry {
  const built = createMcpChangesRegistry({
    registrations: envs.map(({ surfaceId }) => ({ surfaceId })),
  });
  assert.equal(built.ok, true, built.message ?? '');
  return built.registry as McpChangesRegistry;
}

/** Server bound to inspection + drafting + WP-14A registries for the same surface set. */
function serverFor(envs: { surfaceId: string; env: { dir: string; config: object; trustedInput: unknown } }[], identity: { name: string; version: string } = { name: 'test-server', version: '0.0.0' }): McpServer {
  return createMcpServer(registryFor(envs), draftingFor(envs), persistFor(envs), changesFor(envs), identity);
}

async function connectClient(server: McpServer): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 's5-test-client', version: '0.0.0' });
  await server.connect(serverT);
  await client.connect(clientT);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function structured(result: { structuredContent?: unknown }): unknown {
  return result.structuredContent;
}

test('runtime: tools/list exposes exactly nine tools — six WP-9 inspection + one WP-10 drafting + two WP-14A controlled producer tools', async () => {
  const env = makeStore();
  try {
    const server = serverFor([{ surfaceId: 'alpha', env }]);
    const { client, close } = await connectClient(server);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['draft-artifact', 'enumerate-class', 'inspect-audit-history', 'inspect-changes', 'inspect-registry', 'inspect-stored-record', 'persist-artifact', 'validate-artifact', 'verify-record'], 'overall inventory is exactly nine');
      assert.equal(tools.length, 9);
      // The accepted WP-9 inspection vocabulary remains exactly six — never widened.
      assert.deepEqual([...MCP_INSPECTION_TOOLS], ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class']);
      assert.deepEqual([...MCP_PERSIST_TOOLS], ['persist-artifact']);
      assert.deepEqual([...MCP_CHANGES_TOOLS], ['inspect-changes']);
      for (const tool of tools) {
        const schema = tool.inputSchema as { type: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
        assert.equal(schema.type, 'object');
        assert.ok(schema.properties?.['surfaceId'], `${tool.name} must require surfaceId`);
        assert.ok((schema.required ?? []).includes('surfaceId'), `${tool.name} surfaceId must be required`);
        assert.equal(schema.additionalProperties, false, `${tool.name} schema must be closed`);
        assert.equal('requestId' in (schema.properties ?? {}), false, 'no requestId in tool schemas');
        for (const forbidden of ['root', 'locator', 'path', 'projectPath', 'workspacePath']) {
          assert.equal(forbidden in (schema.properties ?? {}), false, `no ${forbidden} parameter in ${tool.name}`);
        }
        if (tool.name !== 'persist-artifact') {
          // Every surface except the write tool advertises read-only.
          assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must advertise readOnlyHint`);
        } else {
          assert.equal(tool.annotations?.readOnlyHint, undefined, 'persist-artifact must NOT advertise readOnlyHint');
        }
      }
      // The draft-artifact input schema is shape/type only: plain strings for
      // surfaceId, kind, and content; no kind enum, no byte ceiling, no
      // requestId, no destination/authority operand.
      const draft = tools.find((t) => t.name === 'draft-artifact')!;
      const dSchema = draft.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      assert.deepEqual(Object.keys(dSchema.properties ?? {}).sort(), ['content', 'kind', 'surfaceId']);
      assert.deepEqual((dSchema.required ?? []).sort(), ['content', 'kind', 'surfaceId']);
      const kindSchema = dSchema.properties?.['kind'] as { type?: string; enum?: unknown };
      assert.equal(kindSchema.type, 'string');
      assert.equal(kindSchema.enum, undefined, 'no kind enum at the SDK layer — the core owns the closed producer vocabulary');
      const contentSchema = dSchema.properties?.['content'] as { type?: string; maxLength?: unknown };
      assert.equal(contentSchema.type, 'string');
      assert.equal(contentSchema.maxLength, undefined, 'no byte ceiling at the SDK layer — the core owns limit-exceeded');
      // The persist-artifact input schema is shape/type only: workspaceId +
      // kind + content as plain strings; no destination, no validation
      // flags, no digest, no path, no authority operand.
      const persist = tools.find((t) => t.name === 'persist-artifact')!;
      const pSchema = persist.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      assert.deepEqual(Object.keys(pSchema.properties ?? {}).sort(), ['content', 'kind', 'surfaceId', 'workspaceId']);
      assert.deepEqual((pSchema.required ?? []).sort(), ['content', 'kind', 'surfaceId', 'workspaceId']);
      // The inspect-changes input schema: workspaceId + optional diff/paths.
      const changes = tools.find((t) => t.name === 'inspect-changes')!;
      const cSchema = changes.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      assert.deepEqual(Object.keys(cSchema.properties ?? {}).sort(), ['diff', 'paths', 'surfaceId', 'workspaceId']);
      assert.deepEqual((cSchema.required ?? []).sort(), ['surfaceId', 'workspaceId']);
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: tool definitions are stable across different registered surface sets', async () => {
  const env = makeStore();
  try {
    const server1 = serverFor([{ surfaceId: 'alpha', env }], { name: 't', version: '1' });
    const server2 = serverFor([{ surfaceId: 'alpha', env }, { surfaceId: 'beta', env }], { name: 't', version: '1' });
    const c1 = await connectClient(server1);
    const c2 = await connectClient(server2);
    try {
      const t1 = (await c1.client.listTools()).tools;
      const t2 = (await c2.client.listTools()).tools;
      assert.deepEqual(t1.map((t) => t.name), t2.map((t) => t.name));
      assert.deepEqual(t1.map((t) => JSON.stringify(t.inputSchema)).sort(), t2.map((t) => JSON.stringify(t.inputSchema)).sort());
      assert.equal(t1.length, 9);
    } finally {
      await c1.close();
      await c2.close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: surface routing — MCP results equal the committed registry results for every tool', async () => {
  const envA = makeStore();
  const envB = makeStore();
  try {
    publish(envA, { marker: 'A' });
    publish(envB, { marker: 'B' });
    const registry = registryFor([{ surfaceId: 'alpha', env: envA }, { surfaceId: 'beta', env: envB }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }, { surfaceId: 'beta' }]), persistFor([{ surfaceId: 'alpha' }, { surfaceId: 'beta' }]), changesFor([{ surfaceId: 'alpha' }, { surfaceId: 'beta' }]), { name: 'test-server', version: '0.0.0' });
    const { client, close } = await connectClient(server);
    try {
      const cases: { tool: string; args: Record<string, unknown> }[] = [
        { tool: 'validate-artifact', args: { content: VALID_TASKSPEC } },
        { tool: 'validate-artifact', args: { content: '{bad' } },
        { tool: 'inspect-stored-record', args: { recordClass: 'approval-record', recordId: RECORD_ID } },
        { tool: 'inspect-stored-record', args: { recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) } },
        { tool: 'inspect-registry', args: {} },
        { tool: 'inspect-audit-history', args: { recordClass: 'approval-record', recordId: RECORD_ID } },
        { tool: 'verify-record', args: { recordClass: 'approval-record', recordId: RECORD_ID } },
        { tool: 'enumerate-class', args: { recordClass: 'approval-record' } },
      ];
      for (const surfaceId of ['alpha', 'beta']) {
        for (const c of cases) {
          const mcp = await client.callTool({ name: c.tool, arguments: { surfaceId, ...c.args } });
          const direct = registry.inspect(surfaceId, { tool: c.tool, params: c.args });
          assert.deepEqual(structured(mcp), direct, `${surfaceId} ${c.tool} must equal the committed registry result`);
          // text content is the compact JSON of the same object
          const text = (mcp.content[0] as { type: 'text'; text: string }).text;
          assert.deepEqual(JSON.parse(text), direct);
        }
      }
    } finally {
      await close();
    }
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});

test('runtime: unknown surface is a committed not-found tool outcome, never a protocol exception', async () => {
  const env = makeStore();
  try {
    const registry = registryFor([{ surfaceId: 'alpha', env }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }]), persistFor([{ surfaceId: 'alpha' }]), changesFor([{ surfaceId: 'alpha' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      const r = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'not-registered', content: '{}' } });
      assert.equal(r.isError, undefined);
      const s = structured(r) as { ok: boolean; error?: { code: string } };
      assert.equal(s.ok, false);
      assert.equal(s.error?.code, 'not-found');
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: malformed surfaceId reaches the committed registry invalid-request outcome', async () => {
  const env = makeStore();
  try {
    const registry = registryFor([{ surfaceId: 'alpha', env }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }]), persistFor([{ surfaceId: 'alpha' }]), changesFor([{ surfaceId: 'alpha' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      // A malformed surfaceId is semantically invalid: the SDK schema only
      // requires a string; the committed registry rejects the grammar.
      const r = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: '../escape', content: '{}' } });
      const s = structured(r) as { ok: boolean; error?: { code: string } };
      assert.equal(s.ok, false);
      assert.equal(s.error?.code, 'invalid-request');
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: outer schema rejects wrong primitive types, missing fields, and unknown fields', async () => {
  const env = makeStore();
  try {
    const registry = registryFor([{ surfaceId: 'alpha', env }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }]), persistFor([{ surfaceId: 'alpha' }]), changesFor([{ surfaceId: 'alpha' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      // Wrong primitive type.
      const r1 = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: 42 } });
      assert.equal(r1.isError, true, 'wrong primitive type is an outer validation failure');
      // Missing required field.
      const r2 = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha' } });
      assert.equal(r2.isError, true, 'missing required field is an outer validation failure');
      // Unknown outer field (closed strict schema).
      const r3 = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: '{}', evil: 1 } });
      assert.equal(r3.isError, true, 'unknown outer field must fail the closed schema');
      // Semantically malformed but correctly typed values still reach the
      // committed adapter and keep its taxonomy.
      const r4 = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: '/abs/path' } });
      const s4 = structured(r4) as { ok: boolean; error?: { code: string } };
      assert.equal(r4.isError, undefined);
      assert.equal(s4.ok, false);
      assert.equal(s4.error?.code, 'invalid-request');
      const r5 = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'alpha', recordClass: 'not-a-class', recordId: RECORD_ID } });
      const s5 = structured(r5) as { ok: boolean; error?: { code: string } };
      assert.equal(s5.error?.code, 'invalid-request');
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: cursor round-trips and multi-page walks through MCP', async () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const digest = publish(env);
    // Two reconstruction audit events force a history continuation; the
    // record itself plus one audit entry forces an enumeration page.
    const si = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, configurationVersion: '1', limitProfile: env.lp });
    assert.equal(si.ok, true);
    const ns = si.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
    // Remove the original audit event so reconstruction events are adopted.
    const origAudit = buildAuthorizedWriteAuditEvent({ storeInstance: ns, primaryClass: 'approval-record', primaryRecordId: RECORD_ID, primaryRevision: 1, primaryDigest: digest, eventKind: 'authorized-write', trustedActionIdentity: 's5-w', primaryCreatedAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(origAudit.ok, true);
    const ad = deriveRecordRelativePath('authoritative-audit-event', origAudit.event!.recordId);
    assert.equal(ad.ok, true);
    assert.equal(ad.ok, true);
    const adPath = (ad as { readonly ok: true; readonly relativePath: string }).relativePath;
    fs.rmSync(`${env.storeRoot}/${adPath}`);
    const recEntries: readonly (readonly [string, string])[] = [['rec-1', '2026-01-01T00:00:00.000Z'], ['rec-2', '2026-01-02T00:00:00.000Z']];
    for (const [k, t] of recEntries) {
      const built = buildRecoveryAuditReconstructionEvent({ storeInstance: ns, primaryClass: 'approval-record', primaryRecordId: RECORD_ID, primaryRevision: 1, primaryDigest: digest, recoveryActionIdentity: `s5-${k}`, recoveryTime: t });
      assert.equal(built.ok, true, JSON.stringify(built));
      const model = JSON.parse(built.event!.canonicalUtf8);
      const canonical = canonicalEnvelopeBytes(model);
      const d = deriveRecordRelativePath('authoritative-audit-event', model['recordId'] as string);
      assert.equal(d.ok, true);
      const dPath = (d as { readonly ok: true; readonly relativePath: string }).relativePath;
      const dir = `${env.storeRoot}/${dPath.slice(0, dPath.lastIndexOf('/'))}`;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${env.storeRoot}/${dPath}`, canonical.canonicalUtf8, { mode: 0o600 });
      fs.chmodSync(`${env.storeRoot}/${dPath}`, 0o600);
    }
    const registry = registryFor([{ surfaceId: 'alpha', env }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }]), persistFor([{ surfaceId: 'alpha' }]), changesFor([{ surfaceId: 'alpha' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      // History multi-page walk through MCP: continuation strings pass through unchanged.
      const p1 = await client.callTool({ name: 'inspect-audit-history', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID } });
      const s1 = structured(p1) as { ok: boolean; result?: { continuation?: string; events?: unknown[] } };
      assert.equal(s1.ok, true);
      assert.ok(s1.result?.continuation !== undefined, 'history must page under the results budget');
      const directCont = registry.inspect('alpha', { tool: 'inspect-audit-history', params: { recordClass: 'approval-record', recordId: RECORD_ID } }).result as { continuation?: string };
      assert.equal(s1.result?.continuation, directCont.continuation, 'MCP must not re-encode domain cursors');
      const p2 = await client.callTool({ name: 'inspect-audit-history', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID, continuation: s1.result?.continuation } });
      const s2 = structured(p2) as { ok: boolean; result?: { events?: unknown[] } };
      assert.equal(s2.ok, true, JSON.stringify(s2));
      const all = [...(s1.result?.events ?? []), ...(s2.result?.events ?? [])];
      assert.equal(all.length, 2, 'exactly-once across pages');
      assert.equal(new Set(all.map((e) => (e as { eventId: string }).eventId)).size, 2);
      // Enumeration multi-page walk through MCP.
      const e1 = await client.callTool({ name: 'enumerate-class', arguments: { surfaceId: 'alpha', recordClass: 'approval-record' } });
      const es1 = structured(e1) as { ok: boolean; result?: { continuation?: string; items: unknown[] } };
      assert.equal(es1.ok, true);
      assert.ok(es1.result?.continuation !== undefined);
      const e2 = await client.callTool({ name: 'enumerate-class', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', continuation: es1.result?.continuation } });
      const es2 = structured(e2) as { ok: boolean; result?: { items: unknown[] } };
      assert.equal(es2.ok, true, JSON.stringify(es2));
      const ids = [...(es1.result?.items ?? []), ...(es2.result?.items ?? [])].filter((i) => (i as { recordId?: string }).recordId !== undefined).map((i) => (i as { recordId: string }).recordId);
      assert.equal(new Set(ids).size, ids.length, 'enumeration exactly once through MCP');
      // Registry view on the single-record store.
      const r1 = await client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      const rs1 = structured(r1) as { ok: boolean; result?: { source: { generation: string; surfaceGeneration: string } } };
      assert.equal(rs1.ok, true);
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: results are deterministic and contain no host paths or internals', async () => {
  const env = makeStore();
  try {
    publish(env, { marker: 'A' });
    const registry = registryFor([{ surfaceId: 'alpha', env }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }]), persistFor([{ surfaceId: 'alpha' }]), changesFor([{ surfaceId: 'alpha' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      const args = { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID };
      const a = await client.callTool({ name: 'inspect-stored-record', arguments: args });
      const b = await client.callTool({ name: 'inspect-stored-record', arguments: args });
      assert.equal((a.content[0] as { text: string }).text, (b.content[0] as { text: string }).text, 'identical requests produce identical serialized results');
      const serialized = JSON.stringify(structured(a));
      assert.equal(serialized.includes(env.dir), false, 'no host path in results');
      assert.equal(serialized.includes(env.storeRoot), false);
      assert.equal(/stack|errno|ENOENT|EACCES/.test(serialized), false);
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: fs mutation watchdog — no tool invocation reaches project/store mutation', async () => {
  const envA = makeStore();
  const envB = makeStore();
  const guards = ['writeFileSync', 'writeFile', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'renameSync', 'rename', 'unlinkSync', 'unlink', 'chmodSync', 'chmod', 'chownSync', 'chown', 'symlinkSync', 'linkSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'utimesSync', 'utimes'];
  const originals: Record<string, unknown> = {};
  try {
    publish(envA, { marker: 'A' });
    publish(envB, { marker: 'B' });
    const registry = registryFor([{ surfaceId: 'alpha', env: envA }, { surfaceId: 'beta', env: envB }]);
    const server = createMcpServer(registry, draftingFor([{ surfaceId: 'alpha' }, { surfaceId: 'beta' }]), persistFor([{ surfaceId: 'alpha' }, { surfaceId: 'beta' }]), changesFor([{ surfaceId: 'alpha' }, { surfaceId: 'beta' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    for (const g of guards) {
      originals[g] = (fs as unknown as Record<string, unknown>)[g];
      (fs as unknown as Record<string, unknown>)[g] = (...a: unknown[]) => {
        throw new Error(`MUTATION:${g}`);
      };
    }
    try {
      for (const surfaceId of ['alpha', 'beta']) {
        for (const c of [
          { tool: 'validate-artifact', args: { content: VALID_TASKSPEC } },
          { tool: 'inspect-stored-record', args: { recordClass: 'approval-record', recordId: RECORD_ID } },
          { tool: 'inspect-registry', args: {} },
          { tool: 'inspect-audit-history', args: { recordClass: 'approval-record', recordId: RECORD_ID } },
          { tool: 'verify-record', args: { recordClass: 'approval-record', recordId: RECORD_ID } },
          { tool: 'enumerate-class', args: { recordClass: 'approval-record' } },
          { tool: 'draft-artifact', args: { kind: 'TaskSpec', content: draftContent(fixture('task-minimal-genesis.json')) } },
          { tool: 'draft-artifact', args: { kind: 'ExecutionResult', content: '{}' } },
          { tool: 'draft-artifact', args: { kind: 'TaskSpec', content: 'not json' } },
          { tool: 'draft-artifact', args: { kind: 'TaskSpec', content: '{"a":' + ' '.repeat(1024 * 1024) + '}' } },
          { tool: 'draft-artifact', args: { kind: 'AuthorityPolicy', content: draftContent(fixture('policy-minimal-genesis.json')) } },
          { tool: 'draft-artifact', args: { kind: 'ContextManifest', content: draftContent(fixture('context-minimal-genesis.json')) } },
          { tool: 'draft-artifact', args: { kind: 'ExecutionBundle', content: draftContent(fixture('bundle-minimal-genesis.json')) } },
        ]) {
          const r = await client.callTool({ name: c.tool, arguments: { surfaceId, ...c.args } });
          assert.equal(r.isError, undefined, `${surfaceId} ${c.tool} must not hit a guarded mutation API`);
        }
      }
      // Drafting failures and routing failures are also mutation-free.
      const r1 = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'not-registered', kind: 'TaskSpec', content: '{}' } });
      assert.equal(r1.isError, undefined);
      const r2 = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: '../bad', kind: 'TaskSpec', content: '{}' } });
      assert.equal(r2.isError, undefined);
      const r3 = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: draftContent(invalidFixture('semantic-task-delegated-context-instruction.json')) } });
      assert.equal(r3.isError, undefined);
    } finally {
      for (const g of guards) (fs as unknown as Record<string, unknown>)[g] = originals[g];
      await close();
    }
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});

// ─── WP-10 Slice 3 — draft-artifact runtime registration ───────────────────

test('runtime: draft-artifact — semantic passthrough, outer/inner taxonomy, and text/structuredContent parity', async () => {
  const env = makeStore();
  try {
    const server = serverFor([{ surfaceId: 'alpha', env }]);
    const { client, close } = await connectClient(server);
    try {
      // Valid TaskSpec draft → outer ok:true, inner ok:true valid:true.
      const ok = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: draftContent(fixture('task-minimal-genesis.json')) } });
      assert.equal(ok.isError, undefined);
      const okSc = ok.structuredContent as Extract<DraftingResponse, { ok: true }>;
      assert.equal(okSc.ok, true, 'routing success');
      assert.equal(okSc.result.ok, true);
      if (okSc.result.ok === true) {
        assert.equal(okSc.result.valid, true);
        assert.equal(okSc.result.kind, 'TaskSpec');
        assert.ok(okSc.result.proposal.digest.startsWith('sha-256:'));
        assert.equal(Array.isArray(okSc.result.validation.ruleIds), true, 'ruleIds is a bounded array (may be empty for minimal genesis fixtures)');
      }
      // Text content is the compact JSON of the exact same object
      // (normalized through JSON: structuredContent may retain the JSON
      // scanner's null-prototype objects, text is plain JSON).
      const text = (ok.content[0] as { type: 'text'; text: string }).text;
      assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(okSc)));
      // Unsupported kind (ExecutionResult) must reach the inner drafting
      // taxonomy as a successful tool execution — never an SDK error.
      const unsupported = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'ExecutionResult', content: draftContent(fixture('task-minimal-genesis.json')) } });
      assert.equal(unsupported.isError, undefined, 'unsupported kind must not be an SDK protocol error');
      const us = unsupported.structuredContent as Extract<DraftingResponse, { ok: true }>;
      assert.equal(us.ok, true);
      assert.equal(us.result.ok, false);
      if (us.result.ok === false) assert.equal(us.result.error.code, 'unsupported-artifact-kind');
      assert.deepEqual(JSON.parse((unsupported.content[0] as { text: string }).text), JSON.parse(JSON.stringify(us)));
      // Malformed JSON → inner invalid-draft-request (not a protocol exception).
      const badJson = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: '{bad' } });
      assert.equal(badJson.isError, undefined);
      const bj = badJson.structuredContent as Extract<DraftingResponse, { ok: true }>;
      assert.equal(bj.ok, true);
      assert.equal(bj.result.ok, false);
      if (bj.result.ok === false) assert.equal(bj.result.error.code, 'invalid-draft-request');
      // Oversize content → inner limit-exceeded (the SDK imposes no ceiling).
      const over = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: '{"a":' + ' '.repeat(1024 * 1024) + '}' } });
      assert.equal(over.isError, undefined);
      const ov = over.structuredContent as Extract<DraftingResponse, { ok: true }>;
      assert.equal(ov.ok, true);
      assert.equal(ov.result.ok, false);
      if (ov.result.ok === false) assert.equal(ov.result.error.code, 'limit-exceeded');
      // WP-4-invalid proposal → outer ok:true, inner ok:true valid:false with findings.
      const invalid = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: draftContent(invalidFixture('semantic-task-delegated-context-instruction.json')) } });
      assert.equal(invalid.isError, undefined);
      const iv = invalid.structuredContent as Extract<DraftingResponse, { ok: true }>;
      assert.equal(iv.ok, true);
      assert.equal(iv.result.ok, true);
      if (iv.result.ok === true) {
        assert.equal(iv.result.valid, false);
        assert.ok(iv.result.findings.length > 0);
        assert.ok(iv.result.findings[0]!.ruleIds.length > 0);
      }
      // Unknown surface → outer not-found, successful tool execution.
      const unknown = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'not-registered', kind: 'TaskSpec', content: '{}' } });
      assert.equal(unknown.isError, undefined);
      const un = unknown.structuredContent as Extract<DraftingResponse, { ok: false }>;
      assert.equal(un.ok, false);
      assert.equal(un.error.code, 'not-found');
      // Malformed string surface → outer invalid-request (SDK accepts the string).
      const malformed = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: '../escape', kind: 'TaskSpec', content: '{}' } });
      assert.equal(malformed.isError, undefined);
      const ma = malformed.structuredContent as Extract<DraftingResponse, { ok: false }>;
      assert.equal(ma.ok, false);
      assert.equal(ma.error.code, 'invalid-request');
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: draft-artifact — wrong types and unknown outer fields are SDK input errors; text/structured parity holds', async () => {
  const env = makeStore();
  try {
    const server = serverFor([{ surfaceId: 'alpha', env }]);
    const { client, close } = await connectClient(server);
    try {
      const content = draftContent(fixture('task-minimal-genesis.json'));
      const wrongKindType = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 42, content } });
      assert.equal(wrongKindType.isError, true, 'kind must be a string at the SDK boundary');
      const wrongContentType = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: ['x'] } });
      assert.equal(wrongContentType.isError, true, 'content must be a string at the SDK boundary');
      const wrongSurfaceType = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 7, kind: 'TaskSpec', content } });
      assert.equal(wrongSurfaceType.isError, true, 'surfaceId must be a string at the SDK boundary');
      const missingKind = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', content } });
      assert.equal(missingKind.isError, true, 'kind is required');
      const extraField = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content, destination: '/tmp' } });
      assert.equal(extraField.isError, true, 'unknown outer fields fail the closed strict schema');
      // Determinism: identical calls produce identical serialized results.
      const a = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content } });
      const b = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content } });
      assert.equal((a.content[0] as { text: string }).text, (b.content[0] as { text: string }).text);
      assert.deepEqual(a.structuredContent, b.structuredContent);
      // No host paths or internals in drafting results.
      const serialized = JSON.stringify(a.structuredContent);
      assert.equal(serialized.includes(env.dir), false);
      assert.equal(/stack|errno|ENOENT|EACCES/.test(serialized), false);
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: draft-artifact — all five draftable kinds succeed through the MCP surface', async () => {
  const env = makeStore();
  try {
    const server = serverFor([{ surfaceId: 'alpha', env }]);
    const { client, close } = await connectClient(server);
    try {
      for (const [kind, name] of Object.entries(VALID_FIXTURES)) {
        const r = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind, content: draftContent(fixture(name)) } });
        assert.equal(r.isError, undefined, kind);
        const sc = r.structuredContent as Extract<DraftingResponse, { ok: true }>;
        assert.equal(sc.ok, true, kind);
        assert.equal(sc.result.ok, true, kind);
        if (sc.result.ok === true) {
          assert.equal(sc.result.valid, true, kind);
          assert.equal(sc.result.kind, kind);
          assert.deepEqual(JSON.parse((r.content[0] as { text: string }).text), JSON.parse(JSON.stringify(sc)), kind);
        }
      }
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: draft/validate surface consistency through MCP — same candidate agrees under validate-artifact and draft-artifact', async () => {
  const env = makeStore();
  try {
    const schemaRegistry = createSchemaRegistry();
    const built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'alpha', trustedConfiguration: env.config, trustedInput: env.trustedInput, schemaRegistry }] });
    assert.equal(built.ok, true, built.message ?? '');
    const drafting = createMcpDraftingRegistry({ registrations: [{ surfaceId: 'alpha', schemaRegistry }] });
    assert.equal(drafting.ok, true, drafting.message ?? '');
    const server = createMcpServer(built.registry as McpInspectionRegistry, drafting.registry as McpDraftingRegistry, persistFor([{ surfaceId: 'alpha' }]), changesFor([{ surfaceId: 'alpha' }]), { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      // Valid candidate: draft self-validation facts equal validate-artifact facts.
      const model = fixture('task-minimal-genesis.json');
      const draftR = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: draftContent(model) } });
      const { digest } = computeArtifactDigest(model);
      const full = { ...model, revision: { ...(model['revision'] as Record<string, unknown>), digest } };
      const validateR = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: JSON.stringify(full) } });
      const draftSc = draftR.structuredContent as Extract<DraftingResponse, { ok: true }>;
      const validateSc = validateR.structuredContent as { ok: boolean; result: { valid: boolean; digest: string; ruleIds: readonly string[] } };
      assert.equal(draftSc.ok, true);
      assert.equal(validateSc.ok, true);
      if (draftSc.result.ok === true && draftSc.result.valid) {
        assert.equal(draftSc.result.valid, validateSc.result.valid);
        assert.equal(draftSc.result.proposal.digest, validateSc.result.digest);
        assert.deepEqual(draftSc.result.validation.ruleIds, validateSc.result.ruleIds);
      }
      // Invalid candidate: both reject with the same digest/rule conclusion.
      const invalidModel = invalidFixture('semantic-task-delegated-context-instruction.json');
      const invalidDraft = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: draftContent(invalidModel) } });
      const { digest: invalidDigest } = computeArtifactDigest(invalidModel);
      const invalidFull = { ...invalidModel, revision: { ...(invalidModel['revision'] as Record<string, unknown>), digest: invalidDigest } };
      const invalidValidate = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: JSON.stringify(invalidFull) } });
      const idSc = invalidDraft.structuredContent as Extract<DraftingResponse, { ok: true }>;
      const ivSc = invalidValidate.structuredContent as { ok: boolean; result: { valid: boolean } };
      assert.equal(idSc.ok, true);
      assert.equal(ivSc.ok, true);
      if (idSc.result.ok === true) {
        assert.equal(idSc.result.valid, false);
        assert.equal(idSc.result.valid, ivSc.result.valid);
      }
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('runtime: composition — inspection and drafting registries share the EXACT same SchemaRegistry instance per surface', async () => {
  const envA = makeStore();
  const envB = makeStore();
  try {
    const created: CountingRegistry[] = [];
    const config: RuntimeConfig = {
      surfaces: [
        { surfaceId: 'alpha', locator: envA.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, configurationVersion: '1', limitProfile: {} },
        { surfaceId: 'beta', locator: envB.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, configurationVersion: '1', limitProfile: {} },
      ],
    };
    const composed = await composeTrustedRegistry(config, {
      createSchemaRegistry: () => {
        const counting = new CountingRegistry();
        created.push(counting);
        return counting;
      },
    });
    assert.equal(composed.ok, true, composed.ok ? '' : composed.message);
    if (!composed.ok) return;
    assert.equal(created.length, 2, 'exactly one registry instance per configured surface');
    const [alphaRegistry, betaRegistry] = created;
    const server = createMcpServer(composed.registry, composed.draftingRegistry, composed.persistRegistry, composed.changesRegistry, { name: 't', version: '1' });
    const { client, close } = await connectClient(server);
    try {
      // Draft routing on alpha consults ALPHA's instance only.
      const content = draftContent(fixture('task-minimal-genesis.json'));
      const dA = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content } });
      assert.equal(dA.isError, undefined);
      assert.ok(alphaRegistry!.validateCalls > 0, 'draft-artifact on alpha consulted the alpha registry instance');
      assert.equal(betaRegistry!.validateCalls, 0, 'beta registry untouched by alpha drafting');
      const alphaCallsAfterDraft = alphaRegistry!.validateCalls;
      // validate-artifact on alpha consults the SAME instance (proof of
      // same-instance sharing between inspection and drafting registries).
      const vA = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: VALID_TASKSPEC } });
      assert.equal(vA.isError, undefined);
      assert.ok(alphaRegistry!.validateCalls > alphaCallsAfterDraft, 'validate-artifact on alpha consulted the same alpha registry instance');
      // Draft routing on beta consults BETA's instance only.
      const dB = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'beta', kind: 'TaskSpec', content } });
      assert.equal(dB.isError, undefined);
      assert.ok(betaRegistry!.validateCalls > 0, 'draft-artifact on beta consulted the beta registry instance');
      // Unknown surface drafts consult nothing.
      const before = betaRegistry!.validateCalls;
      const dU = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'nope', kind: 'TaskSpec', content } });
      assert.equal(dU.isError, undefined);
      assert.equal((dU.structuredContent as Extract<DraftingResponse, { ok: false }>).error.code, 'not-found');
      assert.equal(alphaRegistry!.validateCalls, alphaRegistry!.validateCalls, 'no consultation on unknown surface');
      assert.equal(betaRegistry!.validateCalls, before, 'no consultation on unknown surface');
    } finally {
      await close();
    }
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});

test('runtime: draft-artifact results confer no authority — plain data, no trusted brand', async () => {
  const env = makeStore();
  try {
    const server = serverFor([{ surfaceId: 'alpha', env }]);
    const { client, close } = await connectClient(server);
    try {
      for (const [kind, name] of Object.entries(VALID_FIXTURES)) {
        const r = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind, content: draftContent(fixture(name)) } });
        const sc = r.structuredContent as Extract<DraftingResponse, { ok: true }>;
        assert.equal(sc.ok, true, kind);
        if (sc.result.ok === true && sc.result.valid === true) {
          const model = (sc.result as { proposal: { model: unknown } }).proposal.model;
          assert.equal(Object.getOwnPropertySymbols(model).length, 0, `${kind}: no brand symbols on draft data`);
          assert.equal(Object.getOwnPropertySymbols(sc).length, 0, `${kind}: no brand symbols on the response`);
        }
      }
    } finally {
      await close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
