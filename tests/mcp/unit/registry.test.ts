/**
 * WP-9 Slice 4 — multi-store inspection surface registration tests.
 *
 * Host-owned registration, opaque logical surfaceId routing, six-tool
 * equivalence against the committed single-store API, cross-store isolation,
 * per-tool cursor routing semantics, deterministic duplicate/conflict
 * handling, and read-only/non-escalation boundaries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, lstatSync, readFileSync } from 'node:fs';
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
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { buildAuthorizedWriteAuditEvent, buildRecoveryAuditReconstructionEvent } from '../../../src/storage/audit/write-audit.js';
import { canonicalEnvelopeBytes, computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { createSchemaRegistry } from '../../../src/api/validate.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import {
  createInspectionContext,
  createMcpInspectionSurface,
  createMcpInspectionRegistry,
} from '../../../src/adapters/mcp/index.js';
import { createInitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import type { McpInspectionRequest, McpInspectionResponse } from '../../../src/adapters/mcp/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const BOOTSTRAP_ACTION = 'wp9r-bootstrap';
const WRITE_ACTION = 'wp9r-write';

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

interface StoreEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
  readonly limitProfile: SelectedLimitProfile;
  readonly storeRoot: string;
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): StoreEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp9reg-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bp = createStorageBootstrapActionProvenance({ actionIdentity: BOOTSTRAP_ACTION, locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile });
  const ir = createTrustedStorageBootstrapInput(config, bp, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile });
  assert.equal(ir.ok, true);
  const result = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bp, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { dir, config, trustedInput: ir.input, limitProfile, storeRoot: `${dir}/store-v1` };
}

function publishApproval(env: StoreEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }): void {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const result = publishRecord({
    trustedConfiguration: env.config,
    bootstrapInput: env.trustedInput,
    writeActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    recordClass: 'approval-record',
    record: {
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload,
      payloadDigest: computePayloadDigest(payload),
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
}

/** Committed single-store surface for one store. */
function singleSurface(env: StoreEnv): ReturnType<typeof createMcpInspectionSurface> {
  const context = createInspectionContext({ trustedConfiguration: env.config, trustedInput: env.trustedInput, schemaRegistry: createSchemaRegistry() });
  assert.equal(context.ok, true, context.message ?? '');
  return createMcpInspectionSurface(context.context!);
}

function call(surface: { inspect(request: unknown): McpInspectionResponse }, tool: string, params: unknown, requestId?: string): McpInspectionResponse {
  const request: McpInspectionRequest = { tool, params, ...(requestId !== undefined ? { requestId } : {}) };
  return surface.inspect(request);
}

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

function auditDerivedPath(env: StoreEnv, eventId: string): string {
  const derived = deriveRecordRelativePath('authoritative-audit-event', eventId);
  assert.equal(derived.ok, true);
  return `${env.storeRoot}/${(derived as { readonly relativePath: string }).relativePath}`;
}

/** Derive the deterministic original audit event of a published record. */
function auditEventOf(env: StoreEnv, recordId: string, digest: string): { readonly eventId: string; readonly canonicalUtf8: string } {
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance!).namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: 'approval-record',
    primaryRecordId: recordId,
    primaryRevision: 1,
    primaryDigest: digest,
    eventKind: 'authorized-write',
    trustedActionIdentity: WRITE_ACTION,
    primaryCreatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(audit.ok, true);
  return { eventId: audit.event!.recordId, canonicalUtf8: audit.event!.canonicalUtf8 };
}

/** Build a reconstruction event envelope for a missing original audit (WP-8G builder). */
function reconstructionEventOf(env: StoreEnv, digest: string, recoveryActionIdentity: string, recoveryTime: string): { readonly eventId: string; readonly canonicalUtf8: string } {
  const built = buildRecoveryAuditReconstructionEvent({
    storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance!).namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: 'approval-record',
    primaryRecordId: RECORD_ID_A,
    primaryRevision: 1,
    primaryDigest: digest,
    recoveryActionIdentity,
    recoveryTime,
  });
  assert.equal(built.ok, true);
  return { eventId: built.event!.recordId, canonicalUtf8: built.event!.canonicalUtf8 };
}

function writeAuditEnvelope(env: StoreEnv, eventId: string, canonicalUtf8: string): void {
  const model = JSON.parse(canonicalUtf8) as Record<string, unknown>;
  const canonical = canonicalEnvelopeBytes(model);
  const derived = deriveRecordRelativePath('authoritative-audit-event', eventId);
  assert.equal(derived.ok, true);
  const path = `${env.storeRoot}/${(derived as { readonly relativePath: string }).relativePath}`;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(path, canonical.canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// ── Registration / selector boundary ───────────────────────────────────────

test('registry: malformed and path-shaped selectors fail as invalid-request without coercion', () => {
  const env = makeStore();
  try {
    const built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: env.trustedInput }] });
    assert.equal(built.ok, true, built.message ?? '');
    const registry = built.registry!;
    for (const bad of ['', '/abs/path', '../escape', 'a/b', 'a\\b', 'a b', 'UPPER', '-lead', 'trail-', 'a'.repeat(65), 'store-a/extra', '.', '..']) {
      const r = registry.inspect(bad, { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
      assert.equal(r.ok, false, `selector ${JSON.stringify(bad)} must be rejected`);
      assert.equal(r.error?.code, 'invalid-request');
    }
    // The valid selector works.
    const ok = registry.inspect('store-a', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
    assert.equal(ok.ok, true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: unknown selector fails as not-found without leaking inventory, paths, or similar stores', () => {
  const env = makeStore();
  const other = makeStore();
  try {
    const built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: env.trustedInput }] });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    const r = registry.inspect('store-b', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
    const serialized = JSON.stringify(r);
    assert.equal(serialized.includes('store-a'), false, 'no registered selector inventory may leak');
    assert.equal(serialized.includes(env.dir), false, 'no host path may leak');
    assert.equal(serialized.includes(other.dir), false);
    // Deterministic: same result every time; no fuzzy matching.
    for (let i = 0; i < 3; i++) {
      const again = registry.inspect('store-b', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
      assert.equal(again.ok, false);
      assert.equal(again.error?.code, 'not-found');
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test('registry: duplicate and conflicting duplicate registrations fail closed deterministically', () => {
  const env = makeStore();
  try {
    const registration = { surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: env.trustedInput };
    // Exact duplicate.
    let built = createMcpInspectionRegistry({ registrations: [registration, registration] });
    assert.equal(built.ok, false, 'an exact duplicate registration must fail closed');
    assert.equal(built.code, 'ERR-STO-REQ-INVALID');
    // Conflicting duplicate (same selector, different trusted input object).
    const otherInput = createTrustedStorageBootstrapInput(
      genuineConfig(),
      createStorageBootstrapActionProvenance({ actionIdentity: 'other-bootstrap', locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile }),
      { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile },
    );
    assert.equal(otherInput.ok, true);
    built = createMcpInspectionRegistry({ registrations: [{ ...registration }, { surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: otherInput.input }] });
    assert.equal(built.ok, false, 'a conflicting duplicate must fail closed; never silently overwritten');
    // Malformed registration input fails construction with a deterministic error.
    built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'bad/selector', trustedConfiguration: env.config, trustedInput: env.trustedInput }] });
    assert.equal(built.ok, false);
    assert.equal(built.code, 'ERR-STO-REQ-INVALID');
    // Registration with a non-genuine trusted input fails construction (same
    // trust gate as the single-store context).
    built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: { configurationIdentity: CONFIG_IDENTITY } }] });
    assert.equal(built.ok, false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: empty registration set constructs; every selection fails closed', () => {
  const built = createMcpInspectionRegistry({ registrations: [] });
  assert.equal(built.ok, true, built.message ?? '');
  assert.deepEqual(built.registry!.surfaces, []);
  const r = built.registry!.inspect('anything', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'not-found');
});

test('registry: registration order does not affect routing or the canonical surface listing', () => {
  const a = makeStore();
  const b = makeStore();
  try {
    publishApproval(a, RECORD_ID_A, { approved: true, origin: 'a' });
    publishApproval(b, RECORD_ID_A, { approved: true, origin: 'b' });
    const regOf = (registrations: Array<{ surfaceId: string; trustedConfiguration: object; trustedInput: unknown }>) => createMcpInspectionRegistry({ registrations });
    const r1 = regOf([
      { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
      { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
    ]);
    const r2 = regOf([
      { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
    ]);
    assert.equal(r1.ok && r2.ok, true);
    assert.deepEqual(r1.registry!.surfaces, ['store-a', 'store-b'], 'canonical sorted listing, never insertion order');
    assert.deepEqual(r2.registry!.surfaces, ['store-a', 'store-b']);
    const req = { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } };
    assert.deepEqual(r1.registry!.inspect('store-a', req), r2.registry!.inspect('store-a', req), 'routing is order-independent');
    assert.deepEqual(r1.registry!.inspect('store-b', req), r2.registry!.inspect('store-b', req));
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

// ── Six-tool equivalence and isolation ─────────────────────────────────────

test('registry: one-store composition is equivalent to the committed single-store surface across all six tools', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    const single = singleSurface(env);
    const built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'only', trustedConfiguration: env.config, trustedInput: env.trustedInput }] });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    const requests: Array<{ tool: string; params: unknown; requestId?: string }> = [
      { tool: 'validate-artifact', params: { content: VALID_TASKSPEC }, requestId: 'r1' },
      { tool: 'validate-artifact', params: { content: '{bad' } },
      { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A }, requestId: 'r2' },
      { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) } },
      { tool: 'inspect-registry', params: {} },
      { tool: 'inspect-audit-history', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } },
      { tool: 'verify-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A }, requestId: 'r3' },
      { tool: 'verify-record', params: { recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) } },
      { tool: 'enumerate-class', params: { recordClass: 'approval-record' } },
    ];
    for (const request of requests) {
      const viaSingle = call(single, request.tool, request.params, request.requestId);
      const viaRegistry = registry.inspect('only', { tool: request.tool, params: request.params, ...(request.requestId !== undefined ? { requestId: request.requestId } : {}) });
      assert.deepEqual(viaRegistry, viaSingle, `tool ${request.tool} must be byte-identical through the registry`);
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: same logical record id in stores A and B returns only the selected store content', () => {
  const a = makeStore();
  const b = makeStore();
  try {
    publishApproval(a, RECORD_ID_A, { approved: true, origin: 'a' });
    publishApproval(b, RECORD_ID_A, { approved: false, origin: 'b' });
    const singleA = singleSurface(a);
    const singleB = singleSurface(b);
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    const req = { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } };
    const ra = registry.inspect('store-a', req);
    const rb = registry.inspect('store-b', req);
    assert.equal(ra.ok && rb.ok, true);
    assert.deepEqual(ra, singleA.inspect(req), 'store-a routing equals the A single-store surface');
    assert.deepEqual(rb, singleB.inspect(req), 'store-b routing equals the B single-store surface');
    const payloadA = (ra.result as { record: { payload: { origin: string } } }).record.payload;
    const payloadB = (rb.result as { record: { payload: { origin: string } } }).record.payload;
    assert.equal(payloadA.origin, 'a');
    assert.equal(payloadB.origin, 'b');
    assert.notDeepEqual(ra, rb, 'distinct stores with the same logical id are never conflated');
    // Registry view isolation: only the selected store's records appear.
    const regA = registry.inspect('store-a', { tool: 'inspect-registry', params: {} });
    const regB = registry.inspect('store-b', { tool: 'inspect-registry', params: {} });
    const idsA = (regA.result as { recordsByClass: Record<string, Array<{ recordId: string }>> }).recordsByClass['approval-record']?.map((v) => v.recordId) ?? [];
    const idsB = (regB.result as { recordsByClass: Record<string, Array<{ recordId: string }>> }).recordsByClass['approval-record']?.map((v) => v.recordId) ?? [];
    assert.equal(idsA.includes(RECORD_ID_A) && !idsA.includes(RECORD_ID_B), true);
    assert.equal(idsB.includes(RECORD_ID_A) && !idsB.includes(RECORD_ID_B), true);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: verify and enumerate route to the selected store only', () => {
  const a = makeStore();
  const b = makeStore();
  try {
    publishApproval(a, RECORD_ID_A, { origin: 'a' });
    publishApproval(b, RECORD_ID_B, { origin: 'b' });
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    // verify-record: A's record verifies under A, is not-found under B.
    const va = registry.inspect('store-a', { tool: 'verify-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
    assert.equal(va.ok, true);
    const vb = registry.inspect('store-b', { tool: 'verify-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
    assert.equal(vb.ok, false);
    assert.equal(vb.error?.code, 'not-found');
    // enumerate-class: each surface enumerates only its own records.
    const ea = registry.inspect('store-a', { tool: 'enumerate-class', params: { recordClass: 'approval-record' } });
    const eb = registry.inspect('store-b', { tool: 'enumerate-class', params: { recordClass: 'approval-record' } });
    const idsA = (ea.result as { items: Array<{ recordId?: string }> }).items.map((i) => i.recordId);
    const idsB = (eb.result as { items: Array<{ recordId?: string }> }).items.map((i) => i.recordId);
    assert.deepEqual(idsA, [RECORD_ID_A]);
    assert.deepEqual(idsB, [RECORD_ID_B]);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: audit-history cursors are store-bound — an A cursor fails closed against B', () => {
  const a = makeStore(profile({ enumerationResults: 1 }));
  const b = makeStore(profile({ enumerationResults: 1 }));
  try {
    // A: two reconstruction events so page 1 truncates with a cursor.
    const pub = publishRecord({
      trustedConfiguration: a.config,
      bootstrapInput: a.trustedInput,
      writeActionProvenance: createStorageWriteActionProvenance({ actionIdentity: WRITE_ACTION, locator: a.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: a.limitProfile }),
      locator: a.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: a.limitProfile,
      recordClass: 'approval-record',
      record: { recordKind: 'ApprovalRecord', formatVersion: '1.0', recordId: RECORD_ID_A, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', trustedActionId: WRITE_ACTION, payload: { approved: true }, payloadDigest: computePayloadDigest({ approved: true }) },
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(pub.ok, true);
    const original = auditEventOf(a, RECORD_ID_A, pub.recordDigest!);
    rmSync(auditDerivedPath(a, original.eventId));
    const r1 = reconstructionEventOf(a, pub.recordDigest!, 'recovery-one', '2026-01-01T00:00:00.000Z');
    writeAuditEnvelope(a, r1.eventId, r1.canonicalUtf8);
    const r2 = reconstructionEventOf(a, pub.recordDigest!, 'recovery-two', '2026-01-04T00:00:00.000Z');
    writeAuditEnvelope(a, r2.eventId, r2.canonicalUtf8);
    publishApproval(b, RECORD_ID_B);
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    const page1 = registry.inspect('store-a', { tool: 'inspect-audit-history', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
    assert.equal(page1.ok, true);
    const cursor = (page1.result as { continuation: string }).continuation;
    assert.ok(cursor !== undefined);
    // A's history cursor against B: the WP-8K store/target binding fails closed.
    const cross = registry.inspect('store-b', { tool: 'inspect-audit-history', params: { recordClass: 'approval-record', recordId: RECORD_ID_A, continuation: cursor } });
    assert.equal(cross.ok, false);
    assert.equal(cross.error?.code, 'invalid-cursor', 'a store-bound history cursor must never continue against another surface');
    assert.equal(JSON.stringify(cross).includes(a.dir), false, 'no host path leaks through the routing error');
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: enumeration position cursors resume the SELECTED surface only — no A data via B', () => {
  const a = makeStore(profile({ enumerationResults: 1 }));
  const b = makeStore(profile({ enumerationResults: 1 }));
  try {
    publishApproval(a, 'pgw:r:' + 'a'.repeat(32));
    publishApproval(a, 'pgw:r:' + 'b'.repeat(32));
    publishApproval(b, 'pgw:r:' + 'f'.repeat(32));
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    const page1 = registry.inspect('store-a', { tool: 'enumerate-class', params: { recordClass: 'approval-record' } });
    assert.equal(page1.ok, true);
    const cursor = (page1.result as { continuation: string }).continuation;
    assert.ok(cursor !== undefined);
    // The committed enumeration cursor is position-only (RDS-004): routed to
    // B it resumes B's walk at the same position. The OUTER semantics must
    // stay truthful: only B's own records appear — never A's.
    const cross = registry.inspect('store-b', { tool: 'enumerate-class', params: { recordClass: 'approval-record', continuation: cursor } });
    assert.equal(cross.ok, true);
    const items = (cross.result as { items: Array<{ recordId?: string }> }).items.map((i) => i.recordId);
    for (const id of items) {
      assert.equal(id !== undefined && id.startsWith('pgw:r:f'), true, 'only B records may be returned; no A data may leak through a B-routed request');
    }
    assert.equal(items.includes('pgw:r:' + 'a'.repeat(32)), false);
    assert.equal(items.includes('pgw:r:' + 'b'.repeat(32)), false);
    // The same walk under A still returns only A data.
    const resumeA = registry.inspect('store-a', { tool: 'enumerate-class', params: { recordClass: 'approval-record', continuation: cursor } });
    assert.equal(resumeA.ok, true);
    const idsA = (resumeA.result as { items: Array<{ recordId?: string }> }).items.map((i) => i.recordId);
    assert.equal(idsA.includes('pgw:r:' + 'b'.repeat(32)), true);
    assert.equal(idsA.includes('pgw:r:' + 'f'.repeat(32)), false);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: a tampered store fails closed per request while an independent store stays healthy', () => {
  const a = makeStore();
  const b = makeStore();
  try {
    publishApproval(a, RECORD_ID_A, { origin: 'a' });
    publishApproval(b, RECORD_ID_B, { origin: 'b' });
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    // Tamper A's store-records metadata (simulate root/state replacement).
    writeFileSync(`${a.storeRoot}/metadata/metadata.json`, '{corrupted', { mode: 0o600 });
    chmodSync(`${a.storeRoot}/metadata/metadata.json`, 0o600);
    // A fails closed across store-backed tools; no construction-time 'healthy'
    // conclusion is cached as authority.
    for (const tool of ['inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class']) {
      const params = tool === 'inspect-stored-record' || tool === 'verify-record' ? { recordClass: 'approval-record', recordId: RECORD_ID_A } : tool === 'inspect-audit-history' ? { recordClass: 'approval-record', recordId: RECORD_ID_A } : { recordClass: 'approval-record' };
      const r = registry.inspect('store-a', { tool, params });
      assert.equal(r.ok, false, `${tool} must fail closed on a tampered store`);
    }
    // Pure validation remains available on the tampered surface (no store read).
    const v = registry.inspect('store-a', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
    assert.equal(v.ok, true);
    // B stays fully usable — one bad store never poisons another.
    const rb = registry.inspect('store-b', { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_B } });
    assert.equal(rb.ok, true, 'an independent healthy store must remain usable');
    // Symlink substitution on A also fails closed per request.
    const outside = mkdtempSync(join(tmpdir(), 'wp9reg-out-'));
    chmodSync(outside, 0o700);
    try {
      rmSync(a.storeRoot, { recursive: true, force: true });
      symlinkSync(outside, a.storeRoot);
      const swapped = registry.inspect('store-a', { tool: 'inspect-registry', params: {} });
      assert.equal(swapped.ok, false, 'a symlink-substituted store root must fail closed');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: persistent registry-index state is isolated per surface', () => {
  const a = makeStore();
  const b = makeStore();
  try {
    publishApproval(a, RECORD_ID_A);
    publishApproval(b, RECORD_ID_B);
    // A gets a stale/junk index; B has none.
    mkdirSync(`${a.storeRoot}/index`, { recursive: true, mode: 0o700 });
    writeFileSync(`${a.storeRoot}/index/registry-index`, 'stale junk', { mode: 0o600 });
    chmodSync(`${a.storeRoot}/index/registry-index`, 0o600);
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    // Authoritative conclusions are never affected across surfaces: A's index
    // state is reported only on A; B's authoritative view is independent.
    const ra = registry.inspect('store-a', { tool: 'inspect-registry', params: { usePersistentIndex: true } });
    const rb = registry.inspect('store-b', { tool: 'inspect-registry', params: { usePersistentIndex: true } });
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
    assert.equal((ra.result as { indexState: string }).indexState, 'unreadable', 'A reports its own index state');
    assert.equal((rb.result as { indexState: string }).indexState, 'missing', 'B reports its own index state');
    const idsA = (ra.result as { recordsByClass: Record<string, Array<{ recordId: string }>> }).recordsByClass['approval-record']?.map((v) => v.recordId) ?? [];
    const idsB = (rb.result as { recordsByClass: Record<string, Array<{ recordId: string }>> }).recordsByClass['approval-record']?.map((v) => v.recordId) ?? [];
    assert.deepEqual(idsA, [RECORD_ID_A]);
    assert.deepEqual(idsB, [RECORD_ID_B], 'authoritative fallback conclusions stay per-surface');
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: requestId echo on routed success and routing errors', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    const built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: env.trustedInput }] });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    // Success.
    let r = registry.inspect('store-a', { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A }, requestId: 'req-ok' });
    assert.equal(r.ok, true);
    assert.equal((r as { requestId?: string }).requestId, 'req-ok');
    // Unknown selector.
    r = registry.inspect('store-unknown', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC }, requestId: 'req-miss' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
    assert.equal(r.error?.requestId, 'req-miss');
    // Malformed selector.
    r = registry.inspect('bad/selector', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC }, requestId: 'req-mal' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    assert.equal(r.error?.requestId, 'req-mal');
    // Underlying tool error still echoes (routed through the committed surface).
    r = registry.inspect('store-a', { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) }, requestId: 'req-nf' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
    assert.equal(r.error?.requestId, 'req-nf');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: routing data grants zero authority and inspection never mutates stores', () => {
  const a = makeStore();
  const b = makeStore();
  try {
    publishApproval(a, RECORD_ID_A);
    publishApproval(b, RECORD_ID_B);
    const before = snapshotStore(a.storeRoot) + snapshotStore(b.storeRoot) + snapshotStore(`${a.dir}/config-v1`) + snapshotStore(`${b.dir}/config-v1`);
    const built = createMcpInspectionRegistry({
      registrations: [
        { surfaceId: 'store-a', trustedConfiguration: a.config, trustedInput: a.trustedInput },
        { surfaceId: 'store-b', trustedConfiguration: b.config, trustedInput: b.trustedInput },
      ],
    });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    // Exercise all six tools through both selectors, plus routing errors.
    for (const surfaceId of ['store-a', 'store-b']) {
      registry.inspect(surfaceId, { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
      registry.inspect(surfaceId, { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
      registry.inspect(surfaceId, { tool: 'inspect-registry', params: {} });
      registry.inspect(surfaceId, { tool: 'inspect-audit-history', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
      registry.inspect(surfaceId, { tool: 'verify-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
      registry.inspect(surfaceId, { tool: 'enumerate-class', params: { recordClass: 'approval-record' } });
    }
    registry.inspect('store-unknown', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
    registry.inspect('bad/selector', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
    const after = snapshotStore(a.storeRoot) + snapshotStore(b.storeRoot) + snapshotStore(`${a.dir}/config-v1`) + snapshotStore(`${b.dir}/config-v1`);
    assert.equal(after, before, 'no registered store may be mutated by routed inspection');
    // Non-escalation: the registry object, a selector, and routed responses
    // are data; replay against the trusted-input brand boundary grants nothing.
    const response = registry.inspect('store-a', { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
    for (const candidate of [registry, registry.surfaces, 'store-a', response, (response.result as { record: unknown }).record]) {
      const context = createInspectionContext({ trustedConfiguration: a.config, trustedInput: candidate });
      assert.equal(context.ok, false, 'routing/registration/result data must never become a trusted input');
    }
    // The registry never exposes trusted operands or contexts.
    const serialized = JSON.stringify(registry);
    assert.equal(serialized.includes(a.dir), false, 'the registry object must not expose host paths');
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('registry: in-process trusted-generation advance fails routed store-backed requests closed', () => {
  const env = makeStore();
  try {
    publishApproval(env, RECORD_ID_A);
    const built = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'store-a', trustedConfiguration: env.config, trustedInput: env.trustedInput }] });
    assert.equal(built.ok, true);
    const registry = built.registry!;
    // Baseline works.
    assert.equal(registry.inspect('store-a', { tool: 'inspect-stored-record', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } }).ok, true);
    // Advance the in-process trusted generation with a DIFFERENT configuration
    // identity for the same store root (the WP-8 per-process generation
    // registry; the trusted configuration state changed).
    const configB = genuineConfig('sha-256:' + 'b'.repeat(64));
    const provenanceB = createStorageBootstrapActionProvenance({
      actionIdentity: 'wp9reg-b',
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: 'sha-256:' + 'b'.repeat(64),
      limitProfile: env.limitProfile,
    });
    const inputB = createTrustedStorageBootstrapInput(configB, provenanceB, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(inputB.ok, true);
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const initCap = createInitializationCapability({ trustedInput: inputB.input, parentIdentity: storeResult.storeInstance!.parentIdentity });
    assert.ok(initCap !== undefined);
    assert.equal(initCap.verify('namespace-initialize').ok, true);
    initCap.dispose();
    // Capability-gated store-backed routed requests now fail closed (fresh
    // read/verify capability issuance fails under the advanced generation).
    for (const tool of ['inspect-stored-record', 'inspect-registry', 'verify-record', 'enumerate-class']) {
      const params = tool === 'inspect-stored-record' || tool === 'verify-record' ? { recordClass: 'approval-record', recordId: RECORD_ID_A } : { recordClass: 'approval-record' };
      const r = registry.inspect('store-a', { tool, params });
      assert.equal(r.ok, false, `${tool} must fail closed after the trusted generation advances`);
    }
    // inspect-audit-history is capability-free by design (WP-8K): the
    // in-process generation registry gates CAPABILITY issuance; history keeps
    // its own per-request store revalidation, which still passes because the
    // store itself is unchanged. The adapter mirrors the domain exactly.
    const h = registry.inspect('store-a', { tool: 'inspect-audit-history', params: { recordClass: 'approval-record', recordId: RECORD_ID_A } });
    assert.equal(h.ok, true, 'the capability-free history API keeps its own accepted freshness model');
    const v = registry.inspect('store-a', { tool: 'validate-artifact', params: { content: VALID_TASKSPEC } });
    assert.equal(v.ok, true, 'pure validation is generation-independent');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
