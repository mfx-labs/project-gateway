/**
 * WP-9 MCP inspection surface (slice 1) — focused tests: schema boundary,
 * domain equivalence, read-only proof, target confinement, and error
 * leakage. The MCP layer is exercised ONLY through its public surface
 * (`createInspectionContext` + `createMcpInspectionSurface`); store setup
 * uses the accepted test-only provenance producers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import {
  createStorageBootstrapActionProvenance,
  createStorageWriteActionProvenance,
  createTrustedStorageBootstrapInput,
} from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { readRecord } from '../../../src/storage/read/index.js';
import { deriveRegistryView } from '../../../src/storage/registry/compose.js';
import { validateArtifactInput, createSchemaRegistry } from '../../../src/api/validate.js';
import { computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { createInspectionContext, createMcpInspectionSurface, MCP_INSPECTION_TOOLS, mapDomainError } from '../../../src/adapters/mcp/index.js';
import type { McpInspectionRequest, McpInspectionResponse } from '../../../src/adapters/mcp/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const BOOTSTRAP_ACTION = 'wp9-bootstrap';
const WRITE_ACTION = 'wp9-write';

/** A minimal valid TaskSpec artifact (fixtures/artifacts/valid/task-minimal-genesis.json). */
const VALID_TASKSPEC = JSON.stringify({
  protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' },
  kind: { id: 'TaskSpec', version: '1.0' },
  instance_id: 'pgw:i:9e74f09cf0287d6787d69e8ebddb5157',
  revision: {
    id: 'pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f',
    generation: 0,
    predecessor: null,
    digest: 'sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b',
  },
  workspace_binding: { mode: 'portable' },
  requirements: { protocol_features: [], consumer_capabilities: [] },
  extensions: [],
  body: {
    objective: 'Produce a fixture conformance note.',
    instructions: [{ instruction_id: 'prepare-note', text: 'Create the requested conformance note.' }],
    expected_deliverables: [{ deliverable_id: 'conformance-note', description: 'A project-visible conformance note.', kind: 'document' }],
    outcome_constraints: [],
    project_data_citations: [],
  },
});

function profile(overrides: Partial<Record<string, number>> = {}): SelectedLimitProfile {
  const base: Record<string, number> = { ...defaultLimitProfile() };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface TestEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
  readonly limitProfile: SelectedLimitProfile;
  readonly storeRoot: string;
  readonly configRoot: string;
  readonly surface: ReturnType<typeof createMcpInspectionSurface>;
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp9-mcp-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: BOOTSTRAP_ACTION,
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile,
  });
  const inputResult = createTrustedStorageBootstrapInput(config, bootstrapProvenance, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile });
  assert.equal(inputResult.ok, true);
  const result = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bootstrapProvenance, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const context = createInspectionContext({ trustedConfiguration: config, trustedInput: inputResult.input!, schemaRegistry: createSchemaRegistry() });
  assert.equal(context.ok, true, context.message ?? '');
  return {
    dir,
    config,
    trustedInput: inputResult.input,
    limitProfile,
    storeRoot: `${dir}/store-v1`,
    configRoot: `${dir}/config-v1`,
    surface: createMcpInspectionSurface(context.context!),
  };
}

function inspect(env: TestEnv, tool: string, params: unknown, requestId?: string): McpInspectionResponse {
  const request: McpInspectionRequest = { tool, params, ...(requestId !== undefined ? { requestId } : {}) };
  return env.surface.inspect(request);
}

function approvalRecord(recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }): Readonly<Record<string, unknown>> {
  return {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload,
    payloadDigest: computePayloadDigest(payload),
  };
}

function writeProvenance(locator: string) {
  return createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
}

function publishApproval(env: TestEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }): void {
  const result = publishRecord({
    trustedConfiguration: env.config,
    bootstrapInput: env.trustedInput,
    writeActionProvenance: writeProvenance(env.dir),
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    recordClass: 'approval-record',
    record: approvalRecord(recordId, payload),
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings ?? result));
}

/** Recursive store snapshot (paths, sizes, mtimes, modes; lstat — no follow). */
function snapshotStore(root: string): string {
  const entries: { rel: string; size: number; mtimeMs: number; mode: number; type: string }[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(full);
      entries.push({ rel: childRel, size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777, type: st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file' });
      if (st.isDirectory()) walk(full, childRel);
    }
  };
  walk(root, '');
  return JSON.stringify(entries);
}

const RECORD_ID_A = 'pgw:r:' + 'a'.repeat(32);
const RECORD_ID_B = 'pgw:r:' + 'b'.repeat(32);

// ── Tool inventory ─────────────────────────────────────────────────────────

test('mcp: the surface exposes exactly the closed read-only tool inventory', () => {
  const env = makeStore();
  try {
    assert.deepEqual(env.surface.tools.map((t) => t.name), [...MCP_INSPECTION_TOOLS]);
    for (const tool of env.surface.tools) {
      assert.equal(tool.readOnly, true);
      assert.ok(tool.params.length > 0);
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Envelope / schema boundary ─────────────────────────────────────────────

test('mcp: envelope rejects unknown tools, missing params, malformed shapes, and oversized requestId', () => {
  const env = makeStore();
  try {
    let r = inspect(env, 'write-file', {});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    r = inspect(env, 'validate-artifact', undefined as never);
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    r = inspect(env, 'validate-artifact', [1, 2]);
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    r = inspect(env, 'validate-artifact', { content: VALID_TASKSPEC }, 'x'.repeat(129));
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    r = inspect(env, 'validate-artifact', { content: VALID_TASKSPEC }, 'req-1');
    assert.equal(r.ok, true);
    assert.equal(r.error, undefined);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: validate-artifact schema boundary (missing/unknown/wrong-type/oversize) and pure conclusion', () => {
  const env = makeStore();
  try {
    // Missing required field.
    let r = inspect(env, 'validate-artifact', {});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Unknown field.
    r = inspect(env, 'validate-artifact', { content: VALID_TASKSPEC, kind: 'TaskSpec' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Wrong type.
    r = inspect(env, 'validate-artifact', { content: 42 });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Oversized content (over the 1 MiB artifact bound).
    r = inspect(env, 'validate-artifact', { content: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'limit-exceeded');
    // Valid artifact: the adapter status is ok; validity is a result fact.
    r = inspect(env, 'validate-artifact', { content: VALID_TASKSPEC });
    assert.equal(r.ok, true);
    assert.equal((r.result as { valid: boolean }).valid, true);
    assert.equal((r.result as { kind?: string }).kind, 'TaskSpec');
    // Malformed JSON: a validation conclusion, never an adapter crash.
    r = inspect(env, 'validate-artifact', { content: '{not json' });
    assert.equal(r.ok, true);
    assert.equal((r.result as { valid: boolean }).valid, false);
    assert.ok(((r.result as { findings: unknown[] }).findings.length) > 0);
    // Schema-invalid artifact: bounded diagnostics, no storage implication.
    const invalid = JSON.parse(VALID_TASKSPEC) as Record<string, unknown>;
    invalid['body'] = { objective: 42 };
    r = inspect(env, 'validate-artifact', { content: JSON.stringify(invalid) });
    assert.equal(r.ok, true);
    assert.equal((r.result as { valid: boolean }).valid, false);
    assert.ok(((r.result as { findings: unknown[] }).findings.length) > 0, 'schema violations must produce bounded diagnostics');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: inspect-stored-record schema boundary (closed class, canonical identity, no paths)', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    // Valid inspection.
    let r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal((r.result as { recordId: string }).recordId, RECORD_ID_A);
    // Missing field.
    r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Unknown field (path-shaped or locator-shaped operands are rejected).
    r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A, path: '/etc/passwd' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A, locator: env.dir });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Wrong type.
    r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: 42 });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Unsupported record class (including a namespace-kind lookalike).
    r = inspect(env, 'inspect-stored-record', { recordClass: 'configuration', recordId: RECORD_ID_A });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    r = inspect(env, 'inspect-stored-record', { recordClass: 'not-a-class', recordId: RECORD_ID_A });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Malformed logical identifiers (path-shaped / traversal / non-canonical).
    for (const bad of ['/abs/path', '../escape', 'a/b', 'pgw:r:' + 'Z'.repeat(32), 'pgw:r:' + 'a'.repeat(31), 'pgw:r:', 'not-an-id', 'sha-256:' + 'a'.repeat(64)]) {
      r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: bad });
      assert.equal(r.ok, false, `recordId ${bad} must be rejected`);
      assert.equal(r.error?.code, 'invalid-request');
    }
    // Well-formed but absent identity → not-found.
    r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: inspect-registry schema boundary (closed params, opaque cursor validation)', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    // Valid empty request.
    let r = inspect(env, 'inspect-registry', {});
    assert.equal(r.ok, true, JSON.stringify(r.error));
    // Unknown field.
    r = inspect(env, 'inspect-registry', { class: 'approval-record' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Wrong continuation type.
    r = inspect(env, 'inspect-registry', { continuation: 42 });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor');
    // Malformed opaque cursor payload.
    r = inspect(env, 'inspect-registry', { continuation: '!!!!' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor');
    r = inspect(env, 'inspect-registry', { continuation: Buffer.from('not json at all', 'utf8').toString('base64url') });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor');
    r = inspect(env, 'inspect-registry', { continuation: Buffer.from('[]', 'utf8').toString('base64url') });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor');
    // Oversized encoded cursor.
    r = inspect(env, 'inspect-registry', { continuation: 'x'.repeat(5000) });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor');
    // Wrong usePersistentIndex type.
    r = inspect(env, 'inspect-registry', { usePersistentIndex: 'yes' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // usePersistentIndex with no index present: authoritative fallback, indexState reported.
    r = inspect(env, 'inspect-registry', { usePersistentIndex: true });
    assert.equal(r.ok, true);
    assert.equal((r.result as { indexState: string }).indexState, 'missing');
    assert.ok(((r.result as { recordsByClass: Record<string, unknown[]> }).recordsByClass['approval-record'] ?? []).length >= 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Cursor semantics ───────────────────────────────────────────────────────

test('mcp: registry continuation round-trip, tamper, and staleness map to the closed taxonomy', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    const first = inspect(env, 'inspect-registry', {});
    assert.equal(first.ok, true);
    const view = first.result as { source: { generation: string; surfaceGeneration: string }; recordsByClass: Record<string, { shard: string; entry: string }[]> };
    const record = view.recordsByClass['approval-record']![0]!;
    // Fabricate a well-formed cursor with the CURRENT tokens (the domain's
    // generation binding is the anti-forgery mechanism; a correct-token
    // cursor resumes; a tampered one fails closed).
    const goodCursor = Buffer.from(
      JSON.stringify({ generation: view.source.generation, surfaceGeneration: view.source.surfaceGeneration, recordClass: 'approval-record', shard: record.shard, entry: record.entry }),
      'utf8',
    ).toString('base64url');
    const resumed = inspect(env, 'inspect-registry', { continuation: goodCursor });
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
    // Tampered generation token → invalid-cursor (query-bound cursor).
    const tampered = Buffer.from(
      JSON.stringify({ generation: 'sha-256:' + '0'.repeat(64), surfaceGeneration: view.source.surfaceGeneration, recordClass: 'approval-record', shard: record.shard, entry: record.entry }),
      'utf8',
    ).toString('base64url');
    const tamperedResult = inspect(env, 'inspect-registry', { continuation: tampered });
    assert.equal(tamperedResult.ok, false);
    assert.equal(tamperedResult.error?.code, 'invalid-cursor');
    // Surface change after the cursor was issued → stale-cursor (snapshot-bound).
    rmSync(`${env.storeRoot}/audit/audit-event`, { recursive: true, force: true });
    const staleResult = inspect(env, 'inspect-registry', { continuation: goodCursor });
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.error?.code, 'stale-cursor');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: requestId is echoed verbatim on success across all three tools (F1 correction) and on error paths', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    // A. Valid artifact conclusion + requestId.
    let r = inspect(env, 'validate-artifact', { content: VALID_TASKSPEC }, 'req-valid');
    assert.equal(r.ok, true);
    assert.equal((r.result as { valid: boolean }).valid, true);
    assert.equal((r as { requestId?: string }).requestId, 'req-valid');
    // B. Invalid-artifact validation conclusion (still an MCP success) + requestId.
    r = inspect(env, 'validate-artifact', { content: '{not json' }, 'req-invalid-artifact');
    assert.equal(r.ok, true);
    assert.equal((r.result as { valid: boolean }).valid, false);
    assert.equal((r as { requestId?: string }).requestId, 'req-invalid-artifact');
    // C. No requestId: no placeholder is invented.
    r = inspect(env, 'validate-artifact', { content: VALID_TASKSPEC });
    assert.equal(r.ok, true);
    assert.equal('requestId' in r, false);
    // D. Error path (invalid request) + requestId.
    r = inspect(env, 'validate-artifact', { content: 42 }, 'req-invalid');
    assert.equal(r.ok, false);
    assert.equal(r.error?.requestId, 'req-invalid');
    // E. Error path (limit exceeded) + requestId.
    r = inspect(env, 'validate-artifact', { content: 'x'.repeat(1024 * 1024 + 1) }, 'req-limit');
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'limit-exceeded');
    assert.equal(r.error?.requestId, 'req-limit');
    // F. Stored-record success + requestId.
    r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A }, 'req-record');
    assert.equal(r.ok, true);
    assert.equal((r as { requestId?: string }).requestId, 'req-record');
    // G. Registry success + requestId.
    r = inspect(env, 'inspect-registry', {}, 'req-registry');
    assert.equal(r.ok, true);
    assert.equal((r as { requestId?: string }).requestId, 'req-registry');
    // requestId is opaque correlation only: it never appears inside results.
    const serialized = JSON.stringify(r.result);
    assert.equal(serialized.includes('req-registry'), false, 'requestId must never enter the result payload');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Domain equivalence ─────────────────────────────────────────────────────

test('mcp: validate-artifact conclusion equals the direct WP-4 API for the same content', () => {
  const env = makeStore();
  try {
    const registry = createSchemaRegistry();
    for (const content of [VALID_TASKSPEC, '{broken', JSON.stringify({ kind: { id: 'TaskSpec', version: '1.0' } })]) {
      const direct = validateArtifactInput(content, registry);
      const r = inspect(env, 'validate-artifact', { content });
      assert.equal(r.ok, true);
      assert.equal((r.result as { valid: boolean }).valid, direct.ok, 'the MCP conclusion must equal the domain conclusion');
      const mcpRules = (r.result as { ruleIds: string[] }).ruleIds;
      assert.deepEqual([...mcpRules].sort(), [...direct.ruleIds].sort(), 'rule identifiers must match the domain');
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: inspect-stored-record equals the direct WP-8 read API (identity, digest, bytes)', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A, { approved: true, note: 'wp9-equivalence' });
    const direct = readRecord({
      trustedConfiguration: env.config,
      trustedInput: env.trustedInput,
      recordClass: 'approval-record',
      recordId: RECORD_ID_A,
    });
    assert.equal(direct.ok, true);
    const r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A });
    assert.equal(r.ok, true);
    const result = r.result as { recordId: string; digest?: string; byteLength?: number; record: Record<string, unknown> };
    assert.equal(result.recordId, RECORD_ID_A);
    assert.equal(result.digest, direct.digest, 'digest must equal the domain digest');
    assert.equal(result.byteLength, direct.byteLength, 'byte length must equal the domain byte length');
    assert.deepEqual(result.record, direct.record, 'the verified record model must equal the domain record model');
    // No path, descriptor, capability, or provenance material in the response.
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(env.dir), false, 'no host path may leak');
    assert.equal(/capability|provenance|descriptor|nonce/i.test(serialized), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: inspect-registry preserves the authoritative registry view semantics', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A, { approved: true });
    publishApproval(env, RECORD_ID_B, { approved: false });
    const direct = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(direct.ok, true);
    const r = inspect(env, 'inspect-registry', {});
    assert.equal(r.ok, true);
    const result = r.result as {
      source: { generation: string; scannedEntries: number; scannedBytes: number; truncated: boolean };
      recordsByClass: Record<string, { recordId: string; recordDigest: string }[]>;
      duplicateConflicts: unknown[];
      missingAudit: unknown[];
      danglingAudit: unknown[];
    };
    const directIds = (direct.view!.recordsByClass['approval-record'] ?? []).map((v) => v.recordId).sort();
    const mcpIds = (result.recordsByClass['approval-record'] ?? []).map((v) => v.recordId).sort();
    assert.deepEqual(mcpIds, directIds, 'the class membership must equal the domain view');
    assert.deepEqual(result.duplicateConflicts, direct.view!.duplicateConflicts);
    assert.deepEqual(result.missingAudit, direct.view!.missingAudit);
    assert.deepEqual(result.danglingAudit, direct.view!.danglingAudit);
    assert.equal(result.source.generation, direct.view!.source.generation);
    assert.equal(result.source.truncated, direct.view!.source.truncated);
    assert.deepEqual(result.recordsByClass['approval-record']!.map((v) => v.recordDigest).sort(), (direct.view!.recordsByClass['approval-record'] ?? []).map((v) => v.recordDigest).sort());
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Read-only proof ────────────────────────────────────────────────────────

test('mcp: inspection never mutates the store (byte/mode/mtime-identical before and after)', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    publishApproval(env, RECORD_ID_B);
    const before = snapshotStore(env.storeRoot) + snapshotStore(env.configRoot);
    // Exercise every tool, including a failing call and a cursor round-trip.
    inspect(env, 'validate-artifact', { content: VALID_TASKSPEC });
    inspect(env, 'validate-artifact', { content: '{bad' });
    inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A });
    inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) });
    const reg = inspect(env, 'inspect-registry', {});
    assert.equal(reg.ok, true);
    const result = reg.result as { source: { generation: string; surfaceGeneration: string }; recordsByClass: Record<string, { shard: string; entry: string }[]> };
    const record = result.recordsByClass['approval-record']![0]!;
    const cursor = Buffer.from(JSON.stringify({ generation: result.source.generation, surfaceGeneration: result.source.surfaceGeneration, recordClass: 'approval-record', shard: record.shard, entry: record.entry }), 'utf8').toString('base64url');
    inspect(env, 'inspect-registry', { continuation: cursor });
    inspect(env, 'inspect-registry', { continuation: 'tampered!' });
    const after = snapshotStore(env.storeRoot) + snapshotStore(env.configRoot);
    assert.equal(after, before, 'no store object may be created, modified, or removed by inspection');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Target confinement ─────────────────────────────────────────────────────

test('mcp: context construction rejects forged trusted input, mismatched configuration, and unhealthy stores', () => {
  const env = makeStore();
  try {
    // Structural trusted input lookalike.
    let context = createInspectionContext({
      trustedConfiguration: env.config,
      trustedInput: { configurationIdentity: CONFIG_IDENTITY, serviceUid: UID, forbiddenRoots: [], locator: env.dir, limitProfile: env.limitProfile },
    });
    assert.equal(context.ok, false);
    // Trusted input bound to another configuration identity.
    const otherConfig = genuineConfig('sha-256:' + 'b'.repeat(64));
    const otherProvenance = createStorageBootstrapActionProvenance({
      actionIdentity: 'other-bootstrap',
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: 'sha-256:' + 'b'.repeat(64),
      limitProfile: env.limitProfile,
    });
    const otherInput = createTrustedStorageBootstrapInput(otherConfig, otherProvenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(otherInput.ok, true);
    context = createInspectionContext({ trustedConfiguration: env.config, trustedInput: otherInput.input });
    assert.equal(context.ok, false);
    // Uninitialized directory (no healthy store).
    const empty = mkdtempSync(join(tmpdir(), 'wp9-empty-'));
    chmodSync(empty, 0o700);
    try {
      const emptyProvenance = createStorageBootstrapActionProvenance({
        actionIdentity: 'empty-bootstrap',
        locator: empty,
        serviceUid: UID,
        forbiddenRoots: [],
        configurationIdentity: CONFIG_IDENTITY,
        limitProfile: env.limitProfile,
      });
      const emptyInput = createTrustedStorageBootstrapInput(env.config, emptyProvenance, { locator: empty, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
      assert.equal(emptyInput.ok, true);
      context = createInspectionContext({ trustedConfiguration: env.config, trustedInput: emptyInput.input });
      assert.equal(context.ok, false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: requests cannot cross stores and store-root substitution fails closed', () => {
  const env = makeStore();
  const other = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    publishApproval(other, RECORD_ID_B);
    // A record that exists in the OTHER store is not visible through this surface.
    const r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_B });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
    // Namespace substitution: the store-records namespace root becomes a symlink.
    const outside = mkdtempSync(join(tmpdir(), 'wp9-outside-'));
    chmodSync(outside, 0o700);
    try {
      rmSync(env.storeRoot, { recursive: true, force: true });
      symlinkSync(outside, env.storeRoot);
      const swapped = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A });
      assert.equal(swapped.ok, false);
      assert.equal(swapped.error?.code, 'integrity-conflict', 'a symlinked namespace root must fail closed, never be followed');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

// ── Error leakage ──────────────────────────────────────────────────────────

test('mcp: internal failures map to the closed taxonomy without leaking paths, stacks, or internals', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    // Corrupt the store-records metadata after context creation: the domain
    // revalidation fails closed and the adapter maps it without internals.
    const metadataPath = `${env.storeRoot}/metadata/metadata.json`;
    writeFileSync(metadataPath, '{corrupted', { mode: 0o600 });
    chmodSync(metadataPath, 0o600);
    const r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'integrity-conflict');
    const serialized = JSON.stringify(r);
    assert.equal(serialized.includes(env.dir), false, 'no host path may leak in error responses');
    assert.equal(/stack|at \w|node:fs|Error:/.test(serialized), false, 'no stack or internal error material may leak');
    assert.equal(serialized.includes('{corrupted'), false, 'no raw stored content may leak through errors');
    // Fixed adapter-error mapping for internal failures.
    for (const code of ['ERR-STO-IO-FAILURE', 'ERR-STO-INTERNAL-INVARIANT', 'ERR-STO-CONFIG-UNAVAILABLE', undefined]) {
      const mapped = mapDomainError(code, false);
      assert.equal(mapped.code, 'adapter-error');
      assert.ok(mapped.message.length > 0);
    }
    assert.equal(mapDomainError('ERR-STO-NOT-FOUND', false).code, 'not-found');
    assert.equal(mapDomainError('ERR-STO-LIMIT-EXCEEDED', false).code, 'limit-exceeded');
    assert.equal(mapDomainError('ERR-STO-UNSUPPORTED-VERSION', false).code, 'unsupported');
    assert.equal(mapDomainError('ERR-STO-MALFORMED', false).code, 'integrity-conflict');
    assert.equal(mapDomainError('ERR-STO-ROOT-IDENTITY-CHANGED', false).code, 'integrity-conflict');
    assert.equal(mapDomainError('ERR-STO-ROOT-IDENTITY-CHANGED', true).code, 'stale-cursor');
    assert.equal(mapDomainError('ERR-STO-REQ-INVALID', false).code, 'invalid-request');
    assert.equal(mapDomainError('ERR-STO-REQ-INVALID', true).code, 'invalid-cursor');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: results are immutable plain data (deep-frozen; no live internals)', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    const r = inspect(env, 'inspect-stored-record', { recordClass: 'approval-record', recordId: RECORD_ID_A });
    assert.equal(r.ok, true);
    assert.equal(Object.isFrozen(r), true);
    assert.equal(Object.isFrozen(r.result), true);
    assert.equal(Object.isFrozen((r.result as { record: unknown }).record), true);
    const reg = inspect(env, 'inspect-registry', {});
    assert.equal(reg.ok, true);
    assert.equal(Object.isFrozen(reg.result), true);
    assert.equal(Object.isFrozen((reg.result as { recordsByClass: unknown }).recordsByClass), true);
    // Tampering with the result must fail (frozen) or be ineffective.
    const result = r.result as { recordId: string };
    try {
      (result as { recordId: string }).recordId = 'changed';
    } catch {
      // frozen in strict mode
    }
    assert.equal(result.recordId, RECORD_ID_A, 'results are immutable copies');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
