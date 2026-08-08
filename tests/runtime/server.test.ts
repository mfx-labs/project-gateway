/**
 * WP-9 Slice 5 — MCP server factory tests (in-process, SDK client over
 * paired in-memory transports).
 *
 * NOTE ON PROTOCOL ERA: `server.connect(transport)` is the SDK's 2025-era
 * direct pattern; the MODERN 2026-07-28 path is owned by `serveStdio` and is
 * proven by the subprocess stdio tests (`stdio.test.ts`). These in-process
 * tests exercise tool schemas, routing, cursor round-trips, and
 * read-only/non-escalation semantics — never claimed as modern-era proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createInspectionContext, createMcpInspectionRegistry, createMcpInspectionSurface } from '../../src/adapters/mcp/index.js';
import { createMcpServer } from '../../src/runtime/mcp/server.js';
import { markValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../src/storage/publication/index.js';
import { buildAuthorizedWriteAuditEvent, buildRecoveryAuditReconstructionEvent } from '../../src/storage/audit/write-audit.js';
import { verifyStoreInstance } from '../../src/storage/read/read-record.js';
import { deriveRecordRelativePath } from '../../src/storage/layout/layout.js';
import { canonicalEnvelopeBytes, computePayloadDigest } from '../../src/storage/format/envelope.js';
import { createSchemaRegistry } from '../../src/api/validate.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../src/storage/limits/limits.js';
import type { McpInspectionRegistry } from '../../src/adapters/mcp/index.js';

const UID = process.getuid?.() ?? 0;
const CID = 'sha-256:' + 'a'.repeat(64);
const RECORD_ID = 'pgw:r:aaaa0000000000000000000000000001';

const VALID_TASKSPEC = JSON.stringify({ protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' }, kind: { id: 'TaskSpec', version: '1.0' }, instance_id: 'pgw:i:9e74f09cf0287d6787d69e8ebddb5157', revision: { id: 'pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f', generation: 0, predecessor: null, digest: 'sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b' }, workspace_binding: { mode: 'portable' }, requirements: { protocol_features: [], consumer_capabilities: [] }, extensions: [], body: { objective: 'Produce a fixture conformance note.', instructions: [{ instruction_id: 'prepare-note', text: 'Create the requested conformance note.' }], expected_deliverables: [{ deliverable_id: 'conformance-note', description: 'A project-visible conformance note.', kind: 'document' }], outcome_constraints: [], project_data_citations: [] } });

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

test('runtime: tools/list exposes exactly six tools with required surfaceId and readOnlyHint', async () => {
  const env = makeStore();
  try {
    const registry = registryFor([{ surfaceId: 'alpha', env }]);
    const server = createMcpServer(registry, { name: 'test-server', version: '0.0.0' });
    const { client, close } = await connectClient(server);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['enumerate-class', 'inspect-audit-history', 'inspect-registry', 'inspect-stored-record', 'validate-artifact', 'verify-record']);
      for (const tool of tools) {
        const schema = tool.inputSchema as { type: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
        assert.equal(schema.type, 'object');
        assert.ok(schema.properties?.['surfaceId'], `${tool.name} must require surfaceId`);
        assert.ok((schema.required ?? []).includes('surfaceId'), `${tool.name} surfaceId must be required`);
        assert.equal(schema.additionalProperties, false, `${tool.name} schema must be closed`);
        assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must advertise readOnlyHint`);
        assert.equal('requestId' in (schema.properties ?? {}), false, 'no requestId in tool schemas');
        for (const forbidden of ['root', 'locator', 'path', 'projectPath', 'workspacePath']) {
          assert.equal(forbidden in (schema.properties ?? {}), false, `no ${forbidden} parameter in ${tool.name}`);
        }
      }
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
    const registry1 = registryFor([{ surfaceId: 'alpha', env }]);
    const registry2 = registryFor([{ surfaceId: 'alpha', env }, { surfaceId: 'beta', env }]);
    const server1 = createMcpServer(registry1, { name: 't', version: '1' });
    const server2 = createMcpServer(registry2, { name: 't', version: '1' });
    const c1 = await connectClient(server1);
    const c2 = await connectClient(server2);
    try {
      const t1 = (await c1.client.listTools()).tools;
      const t2 = (await c2.client.listTools()).tools;
      assert.deepEqual(t1.map((t) => t.name), t2.map((t) => t.name));
      assert.deepEqual(t1.map((t) => JSON.stringify(t.inputSchema)).sort(), t2.map((t) => JSON.stringify(t.inputSchema)).sort());
      assert.equal(t1.length, 6);
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
    const server = createMcpServer(registry, { name: 'test-server', version: '0.0.0' });
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
    const server = createMcpServer(registry, { name: 't', version: '1' });
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
    const server = createMcpServer(registry, { name: 't', version: '1' });
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
    const server = createMcpServer(registry, { name: 't', version: '1' });
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
    const server = createMcpServer(registry, { name: 't', version: '1' });
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
    const server = createMcpServer(registry, { name: 't', version: '1' });
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
    const server = createMcpServer(registry, { name: 't', version: '1' });
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
        ]) {
          const r = await client.callTool({ name: c.tool, arguments: { surfaceId, ...c.args } });
          assert.equal(r.isError, undefined, `${surfaceId} ${c.tool} must not hit a guarded mutation API`);
        }
      }
    } finally {
      for (const g of guards) (fs as unknown as Record<string, unknown>)[g] = originals[g];
      await close();
    }
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});
