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
import { readRecord, inspectAuditHistory } from '../../../src/storage/read/index.js';
import { deriveRegistryView } from '../../../src/storage/registry/compose.js';
import { validateArtifactInput, createSchemaRegistry } from '../../../src/api/validate.js';
import { computePayloadDigest, canonicalEnvelopeBytes } from '../../../src/storage/format/envelope.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { buildAuthorizedWriteAuditEvent, buildRecoveryAuditReconstructionEvent } from '../../../src/storage/audit/write-audit.js';
import { buildAuditReconstructionEvidenceRecord } from '../../../src/storage/recovery/index.js';
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
  readonly storeInstance: NonNullable<ReturnType<typeof verifyStoreInstance>['storeInstance']>;
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
  const storeResult = verifyStoreInstance({ locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile });
  assert.equal(storeResult.ok, true, storeResult.message ?? '');
  return {
    dir,
    config,
    trustedInput: inputResult.input,
    limitProfile,
    storeRoot: `${dir}/store-v1`,
    configRoot: `${dir}/config-v1`,
    storeInstance: storeResult.storeInstance!,
    surface: createMcpInspectionSurface(context.context!),
  };
}


// ── WP-9 Slice 2: audit-history fixture helpers (WP-8K accepted builders) ──

function namespaces(env: TestEnv): readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[] {
  return env.storeInstance.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
}

/** Publish one approval record and derive its deterministic original authorized-write audit event. */
function publishHistoryTarget(env: TestEnv, recordId: string): { readonly recordDigest: string; readonly auditEventId: string; readonly auditPath: string; readonly auditCanonicalUtf8: string } {
  // The write provenance must correlate the env's exact limit profile
  // (custom profiles such as enumerationResults: 1 are used by Slice 2).
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
    record: approvalRecord(recordId),
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: namespaces(env),
    primaryClass: 'approval-record',
    primaryRecordId: recordId,
    primaryRevision: 1,
    primaryDigest: result.recordDigest!,
    eventKind: 'authorized-write',
    trustedActionIdentity: WRITE_ACTION,
    primaryCreatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(audit.ok, true);
  const event = audit.event!;
  const derived = deriveRecordRelativePath('authoritative-audit-event', event.recordId);
  assert.equal(derived.ok, true);
  return { recordDigest: result.recordDigest!, auditEventId: event.recordId, auditPath: `${env.storeRoot}/${(derived as { readonly relativePath: string }).relativePath}`, auditCanonicalUtf8: event.canonicalUtf8 };
}

/** Write one canonical audit event envelope at its derived path (test fixture). */
function writeAuditEnvelope(env: TestEnv, model: Readonly<Record<string, unknown>>): void {
  const canonical = canonicalEnvelopeBytes(model);
  const derived = deriveRecordRelativePath('authoritative-audit-event', model['recordId'] as string);
  assert.equal(derived.ok, true);
  const path = `${env.storeRoot}/${(derived as { readonly relativePath: string }).relativePath}`;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(path, canonical.canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Write one canonical store-evidence envelope at its derived path (test fixture). */
function writeEvidenceEnvelope(env: TestEnv, model: Readonly<Record<string, unknown>>): void {
  const canonical = canonicalEnvelopeBytes(model);
  const derived = deriveRecordRelativePath('store-evidence-record', model['recordId'] as string);
  assert.equal(derived.ok, true);
  const path = `${env.storeRoot}/${(derived as { readonly relativePath: string }).relativePath}`;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(path, canonical.canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** One reconstruction event built through the committed WP-8G builder. */
function reconstructionEvent(env: TestEnv, digest: string, recoveryActionIdentity: string, recoveryTime: string): NonNullable<ReturnType<typeof buildRecoveryAuditReconstructionEvent>['event']> {
  const built = buildRecoveryAuditReconstructionEvent({
    storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
    primaryClass: 'approval-record',
    primaryRecordId: RECORD_ID_A,
    primaryRevision: 1,
    primaryDigest: digest,
    recoveryActionIdentity,
    recoveryTime,
  });
  assert.equal(built.ok, true);
  return built.event!;
}

/** Canonical reconstruction-evidence model for one reconstruction event (WP-8G builder). */
function evidenceModelFor(env: TestEnv, targetDigest: string, event: { readonly recordId: string; readonly digest: string }, actionIdentity: string): Readonly<Record<string, unknown>> {
  const built = buildAuditReconstructionEvidenceRecord({
    storeInstance: env.storeInstance,
    actionIdentity,
    evidenceKind: 'recovery-evidence',
    recoveryOperation: 'audit-reconstruction',
    targetRecordClass: 'approval-record',
    targetRecordId: RECORD_ID_A,
    targetRecordDigest: targetDigest,
    originalActionIdentity: WRITE_ACTION,
    reconstructionAuditId: event.recordId,
    reconstructionAuditDigest: event.digest,
    missingAuditObservationId: 'obs-wp9-fixture',
    generation: 'sha-256:' + 'a'.repeat(64),
    surfaceGeneration: 'sha-256:' + 'b'.repeat(64),
    outcome: 'reconstructed',
    createdAt: '2026-01-01T00:00:01.000Z',
  });
  assert.equal(built.ok, true);
  return JSON.parse(built.record!.canonicalUtf8) as Readonly<Record<string, unknown>>;
}

function eventModelOf(event: { readonly recordId: string; readonly canonicalUtf8: string }): Readonly<Record<string, unknown>> {
  return JSON.parse(event.canonicalUtf8) as Readonly<Record<string, unknown>>;
}

/** MCP inspect-audit-history call. */
function historyInspect(env: TestEnv, recordId: string, overrides: { readonly revision?: number; readonly continuation?: string } = {}, requestId?: string): McpInspectionResponse {
  return inspect(env, 'inspect-audit-history', { recordClass: 'approval-record', recordId, ...overrides }, requestId);
}

/** Walk MCP continuation pages to completion; concatenate reported collections. */
function walkHistoryPages(env: TestEnv, recordId: string): {
  readonly pages: McpInspectionResponse[];
  readonly events: Array<{ readonly eventId: string; readonly createdAt: string; readonly eventKind: string; readonly isOriginalWrite: boolean }>;
  readonly findings: Array<{ readonly kind: string; readonly reason: string }>;
  readonly annotations: unknown[];
  readonly snapshotIdentities: string[];
  readonly statuses: Array<string | undefined>;
} {
  const pages: McpInspectionResponse[] = [];
  const events: Array<{ readonly eventId: string; readonly createdAt: string; readonly eventKind: string; readonly isOriginalWrite: boolean }> = [];
  const findings: Array<{ readonly kind: string; readonly reason: string }> = [];
  const annotations: unknown[] = [];
  const snapshotIdentities: string[] = [];
  const statuses: Array<string | undefined> = [];
  let cursor: string | undefined;
  for (let i = 0; i < 64; i++) {
    const page = historyInspect(env, recordId, cursor === undefined ? {} : { continuation: cursor });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    pages.push(page);
    const result = page.result as {
      events?: Array<{ readonly eventId: string; readonly createdAt: string; readonly eventKind: string; readonly isOriginalWrite: boolean }>;
      auditFindings?: Array<{ readonly kind: string; readonly reason: string }>;
      reconstructionEvidence?: unknown[];
      snapshot?: { readonly historySnapshotIdentity: string };
      status?: string;
      continuation?: string;
    };
    events.push(...(result.events ?? []));
    findings.push(...(result.auditFindings ?? []));
    annotations.push(...(result.reconstructionEvidence ?? []));
    if (result.snapshot !== undefined) snapshotIdentities.push(result.snapshot.historySnapshotIdentity);
    statuses.push(result.status);
    if (result.continuation === undefined) break;
    cursor = result.continuation;
  }
  return { pages, events, findings, annotations, snapshotIdentities, statuses };
}

/** Direct WP-8K history walk (domain equivalence reference). */
function walkHistoryDomain(env: TestEnv, recordId: string): { readonly events: Array<{ readonly eventId: string; readonly createdAt: string; readonly eventKind: string; readonly isOriginalWrite: boolean }>; readonly findings: Array<{ readonly kind: string; readonly reason: string }> } {
  const events: Array<{ readonly eventId: string; readonly createdAt: string; readonly eventKind: string; readonly isOriginalWrite: boolean }> = [];
  const findings: Array<{ readonly kind: string; readonly reason: string }> = [];
  let cursor: { readonly formatVersion: number } | undefined;
  for (let i = 0; i < 64; i++) {
    const page = inspectAuditHistory({
      trustedConfiguration: env.config,
      trustedInput: env.trustedInput,
      recordClass: 'approval-record',
      recordId,
      ...(cursor !== undefined ? { continuation: cursor as never } : {}),
    });
    assert.equal(page.ok, true, JSON.stringify(page.findings));
    events.push(...(page.events ?? []));
    findings.push(...(page.auditFindings ?? []));
    if (page.continuation === undefined) break;
    cursor = page.continuation;
  }
  return { events, findings };
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

// ── WP-9 Slice 2: inspect-audit-history ────────────────────────────────────

test('mcp: single-page clean audit history preserves event order, status, completeness, and requestId echo', () => {
  const env = makeStore();
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    const r = historyInspect(env, RECORD_ID_A, {}, 'req-history-clean');
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const result = r.result as {
      status: string;
      originalAuthorizedWrite: { present: boolean; eventId?: string };
      reconstruction: { present: boolean };
      events: Array<{ eventId: string; eventKind: string; isOriginalWrite: boolean; trustedActionId: string }>;
      completeness: { complete: boolean; truncated: boolean };
      snapshot: { historySnapshotIdentity: string };
    };
    assert.equal((r as { requestId?: string }).requestId, 'req-history-clean');
    assert.equal(result.status, 'complete');
    assert.equal(result.originalAuthorizedWrite.present, true);
    assert.equal(result.originalAuthorizedWrite.eventId, facts.auditEventId);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.eventId, facts.auditEventId);
    assert.equal(result.events[0]!.eventKind, 'authorized-write');
    assert.equal(result.events[0]!.isOriginalWrite, true);
    assert.equal(result.events[0]!.trustedActionId, WRITE_ACTION);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.truncated, false);
    assert.ok(result.snapshot.historySnapshotIdentity.startsWith('pgw:h:'));
    assert.equal((result as { auditFindings?: unknown[] }).auditFindings?.length ?? 0, 0, 'a clean history reports no findings');
    assert.equal((result as { reconstructionEvidence?: unknown[] }).reconstructionEvidence?.length ?? 0, 0, 'a clean history has no reconstruction annotations');
    assert.equal(result.reconstruction.present, false, 'a clean history has no reconstruction claim');
    assert.equal((result as { continuation?: unknown }).continuation, undefined, 'a completed walk carries no continuation');
    // Domain equivalence: identical semantic conclusions.
    const direct = inspectAuditHistory({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId: RECORD_ID_A });
    assert.equal(direct.ok, true);
    assert.equal(direct.status, result.status);
    assert.deepEqual((direct.events ?? []).map((e) => e.eventId), result.events.map((e) => e.eventId));
    assert.equal(direct.completeness?.complete, result.completeness.complete);
    assert.equal(direct.snapshot?.historySnapshotIdentity, result.snapshot.historySnapshotIdentity);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: multi-page history walk reports every event exactly once in normative tuple order with one snapshot', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    const first = reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z');
    writeAuditEnvelope(env, eventModelOf(first));
    const second = reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-04T00:00:00.000Z');
    writeAuditEnvelope(env, eventModelOf(second));
    const walk = walkHistoryPages(env, RECORD_ID_A);
    assert.ok(walk.pages.length >= 2, 'the results budget must force a multi-page walk');
    const expectedIds = [first.recordId, second.recordId].sort();
    const walkedIds = walk.events.map((e) => e.eventId).sort();
    assert.deepEqual(walkedIds, expectedIds, 'every event is reported exactly once');
    assert.equal(walk.events.length, 2);
    // Normative tuple order (createdAt, eventId) — never filename/directory order.
    for (let i = 1; i < walk.events.length; i++) {
      const prev = walk.events[i - 1]!;
      const cur = walk.events[i]!;
      assert.ok(prev.createdAt < cur.createdAt || (prev.createdAt === cur.createdAt && prev.eventId <= cur.eventId), 'events must follow the normative tuple order');
    }
    // Truncated pages carry no definitive status; the final page does.
    for (let i = 0; i < walk.pages.length - 1; i++) {
      assert.equal(walk.statuses[i], undefined, 'a truncated page carries no definitive status');
    }
    assert.equal(walk.statuses[walk.statuses.length - 1], 'ambiguous-history', 'two reconstruction events for one gap are ambiguous');
    // One snapshot identity across the whole walk.
    assert.equal(new Set(walk.snapshotIdentities).size, 1, 'a continuation walk must not merge two history snapshots');
    // Concatenated MCP walk equals a fresh direct-domain walk.
    const direct = walkHistoryDomain(env, RECORD_ID_A);
    assert.deepEqual(walk.events, direct.events, 'MCP events must equal the direct domain walk');
    assert.deepEqual([...walk.findings].sort((a, b) => (a.kind < b.kind ? -1 : 1)), [...direct.findings].sort((a, b) => (a.kind < b.kind ? -1 : 1)), 'findings must match the direct domain walk exactly once');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: reconstructed-gap history preserves the reconstruction event, gap marker, and evidence annotation', () => {
  const env = makeStore();
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    const event = reconstructionEvent(env, facts.recordDigest, 'recovery-action', '2026-01-01T00:00:01.000Z');
    writeAuditEnvelope(env, eventModelOf(event));
    writeEvidenceEnvelope(env, evidenceModelFor(env, facts.recordDigest, { recordId: event.recordId, digest: event.digest }, 'recovery-action'));
    const r = historyInspect(env, RECORD_ID_A);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const result = r.result as {
      status: string;
      reconstruction: { present: boolean };
      originalAuthorizedWrite: { present: boolean };
      events: Array<{ eventId: string; eventKind: string; isOriginalWrite: boolean; trustedActionId: string; gapMarker?: { missingEventKind: string } }>;
      reconstructionEvidence: Array<{ evidenceId: string; verified: boolean; linkedReconstructionEventId?: string }>;
    };
    assert.equal(result.status, 'reconstructed-gap');
    assert.equal(result.originalAuthorizedWrite.present, false);
    assert.equal(result.reconstruction.present, true);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.eventKind, 'recovery-audit-reconstruction');
    assert.equal(result.events[0]!.isOriginalWrite, false);
    assert.deepEqual(result.events[0]!.gapMarker, { missingEventKind: 'authorized-write' });
    assert.equal(result.events[0]!.trustedActionId, 'recovery-action');
    assert.equal(result.reconstructionEvidence.length, 1);
    assert.equal(result.reconstructionEvidence[0]!.verified, true);
    assert.equal(result.reconstructionEvidence[0]!.linkedReconstructionEventId, event.recordId, 'the annotation links the durable reconstruction event');
    // No fabricated original; no clean-history claim.
    assert.equal(result.events.some((e) => e.eventKind === 'authorized-write'), false);
    assert.equal(result.events.some((e) => e.isOriginalWrite), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: event-without-evidence keeps the integrity finding and fail-closed status', () => {
  const env = makeStore();
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    const event = reconstructionEvent(env, facts.recordDigest, 'recovery-action', '2026-01-01T00:00:00.000Z');
    writeAuditEnvelope(env, eventModelOf(event));
    const r = historyInspect(env, RECORD_ID_A);
    assert.equal(r.ok, true);
    const result = r.result as { status: string; auditFindings?: Array<{ kind: string }>; reconstructionEvidence?: unknown[]; events?: unknown[] };
    assert.equal(result.status, 'reconstructed-gap');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'event-without-evidence'), true, 'the event-without-evidence finding must remain visible');
    assert.equal(result.reconstructionEvidence?.length ?? 0, 0, 'no evidence is fabricated');
    assert.equal(result.events?.length, 1);
    // Direct-domain equivalence of the integrity signal.
    const direct = inspectAuditHistory({ trustedConfiguration: env.config, trustedInput: env.trustedInput, recordClass: 'approval-record', recordId: RECORD_ID_A });
    assert.equal(direct.ok, true);
    assert.equal(direct.auditFindings?.some((f) => f.kind === 'event-without-evidence'), true);
    assert.equal(direct.status, result.status);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: conflicting reconstruction history is never reported as complete', () => {
  const env = makeStore();
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    const first = reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z');
    writeAuditEnvelope(env, eventModelOf(first));
    const second = reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-02T00:00:00.000Z');
    writeAuditEnvelope(env, eventModelOf(second));
    const r = historyInspect(env, RECORD_ID_A);
    assert.equal(r.ok, true);
    const result = r.result as { status: string; events: unknown[]; auditFindings?: Array<{ kind: string }>; completeness: { complete: boolean } };
    assert.equal(result.status, 'ambiguous-history');
    assert.equal(result.events.length, 2, 'both reconstruction events are reported, never discarded');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'conflicting-audit'), true);
    assert.equal(result.completeness.complete, false, 'a conflicting history is never complete');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: stale continuation fails closed after a history-surface change; an irrelevant index change does not', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-04T00:00:00.000Z')));
    const page1 = historyInspect(env, RECORD_ID_A);
    assert.equal(page1.ok, true);
    const page1Result = page1.result as { completeness: { truncated: boolean }; continuation: string };
    assert.equal(page1Result.completeness.truncated, true);
    assert.ok(page1Result.continuation !== undefined, 'the two-event fixture must truncate the first page');
    const cursor = page1Result.continuation;
    // An irrelevant non-authoritative index object must NOT invalidate the cursor.
    mkdirSync(`${env.storeRoot}/index`, { recursive: true, mode: 0o700 });
    writeFileSync(`${env.storeRoot}/index/registry-index`, 'not authoritative', { mode: 0o600 });
    chmodSync(`${env.storeRoot}/index/registry-index`, 0o600);
    const afterIndex = historyInspect(env, RECORD_ID_A, { continuation: cursor });
    assert.equal(afterIndex.ok, true, 'a non-authoritative index change must not invalidate the history cursor');
    // A real history-surface change (a NEW audit event) invalidates the snapshot.
    const third = reconstructionEvent(env, facts.recordDigest, 'recovery-three', '2026-01-05T00:00:00.000Z');
    writeAuditEnvelope(env, eventModelOf(third));
    const stale = historyInspect(env, RECORD_ID_A, { continuation: cursor });
    assert.equal(stale.ok, false);
    assert.equal(stale.error?.code, 'stale-cursor', 'a changed history snapshot maps to stale-cursor, never a mixed-snapshot success');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: history cursor tamper matrix fails closed through WP-8K validation', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-04T00:00:00.000Z')));
    const page1 = historyInspect(env, RECORD_ID_A);
    assert.equal(page1.ok, true);
    const page1Result = page1.result as { continuation: string };
    assert.ok(page1Result.continuation !== undefined, 'the two-event fixture must truncate the first page');
    const cursor = page1Result.continuation;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    const reencode = (patch: (c: Record<string, unknown>) => Record<string, unknown>): string => Buffer.from(JSON.stringify(patch({ ...decoded })), 'utf8').toString('base64url');
    const cases: Array<{ name: string; encoded: string; expectedStale?: boolean }> = [
      { name: 'future format version', encoded: reencode((c) => ({ ...c, formatVersion: 2 })) },
      { name: 'malformed snapshot identity', encoded: reencode((c) => ({ ...c, historySnapshotIdentity: 'not-a-snapshot' })) },
      { name: 'well-formed foreign snapshot identity', encoded: reencode((c) => ({ ...c, historySnapshotIdentity: 'pgw:h:' + '0'.repeat(32) })), expectedStale: true },
      { name: 'changed target identity', encoded: reencode((c) => ({ ...c, recordId: RECORD_ID_B })) },
      { name: 'changed revision', encoded: reencode((c) => ({ ...c, revision: 2 })) },
      { name: 'changed generation', encoded: reencode((c) => ({ ...c, generation: 'sha-256:' + '1'.repeat(64) })) },
      { name: 'changed surface generation', encoded: reencode((c) => ({ ...c, surfaceGeneration: 'sha-256:' + '2'.repeat(64) })) },
      { name: 'changed query shape', encoded: reencode((c) => ({ ...c, queryShape: 'sha-256:' + '3'.repeat(64) })) },
      { name: 'invalid phase', encoded: reencode((c) => ({ ...c, phase: 'bogus' })) },
      { name: 'missing resume position', encoded: reencode((c) => { const next = { ...c }; delete next['lastAuditEntry']; return next; }) },
      { name: 'array payload', encoded: Buffer.from('[]', 'utf8').toString('base64url') },
    ];
    for (const c of cases) {
      const r = historyInspect(env, RECORD_ID_A, { continuation: c.encoded });
      assert.equal(r.ok, false, `${c.name} must fail closed`);
      // WP-8K semantics: malformed bindings fail as invalid-cursor; a
      // WELL-FORMED snapshot identity that differs from the current
      // snapshot is indistinguishable from a changed history and maps to
      // stale-cursor (the domain's resume-time snapshot comparison).
      assert.equal(r.error?.code, (c as { expectedStale?: boolean }).expectedStale === true ? 'stale-cursor' : 'invalid-cursor', `${c.name} maps per the domain distinction`);
    }
    // A changed resume position within the SAME snapshot is a resume hint,
    // not an authenticated token: the snapshot identity is the anti-tamper
    // binding and it is unchanged, so the domain resumes (documented WP-8K
    // semantics; the adapter passes domain facts through unchanged).
    const movedPosition = reencode((c) => ({ ...c, lastAuditEntry: 'ffffffffffffffffffffffffffffffff.aud' }));
    const resumed = historyInspect(env, RECORD_ID_A, { continuation: movedPosition });
    assert.equal(resumed.ok, true, 'a resume-position hint within the same bound snapshot is domain-owned data');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: a history cursor from another store fails closed', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  const other = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-04T00:00:00.000Z')));
    const page1 = historyInspect(env, RECORD_ID_A);
    assert.equal(page1.ok, true);
    const page1Result = page1.result as { continuation: string };
    assert.ok(page1Result.continuation !== undefined, 'the two-event fixture must truncate the first page');
    const cursor = page1Result.continuation;
    const r = historyInspect(other, RECORD_ID_A, { continuation: cursor });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor', 'a cross-store cursor must fail closed through the store-identity binding');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test('mcp: genuine target absence is not-found; a missing audit is a history gap, never not-found', () => {
  const env = makeStore();
  try {
    // Target genuinely absent.
    let r = historyInspect(env, 'pgw:r:' + 'c'.repeat(32));
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
    // Target present, original audit missing.
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    r = historyInspect(env, RECORD_ID_A);
    assert.equal(r.ok, true, 'a history gap is a status/finding inside an ok result, never an adapter failure');
    const result = r.result as { status: string; originalAuthorizedWrite: { present: boolean }; events: unknown[] };
    assert.equal(result.status, 'missing-authorized-write');
    assert.equal(result.originalAuthorizedWrite.present, false);
    assert.equal(result.events.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: inspect-audit-history schema boundary (revision form, cross-class substitution, paths, unknown fields)', () => {
  const env = makeStore();
  try {
    publishHistoryTarget(env, RECORD_ID_A);
    // Unknown field.
    let r = inspect(env, 'inspect-audit-history', { recordClass: 'approval-record', recordId: RECORD_ID_A, scope: 'all' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Missing required field.
    r = inspect(env, 'inspect-audit-history', { recordClass: 'approval-record' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Wrong types.
    r = inspect(env, 'inspect-audit-history', { recordClass: 'approval-record', recordId: 42 });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Revision form: string, zero, fractional, negative — all rejected; absent defaults to 1.
    for (const bad of ['1', 0, 1.5, -1]) {
      r = inspect(env, 'inspect-audit-history', { recordClass: 'approval-record', recordId: RECORD_ID_A, revision: bad });
      assert.equal(r.ok, false, `revision ${String(bad)} must be rejected`);
      assert.equal(r.error?.code, 'invalid-request');
    }
    r = historyInspect(env, RECORD_ID_A, { revision: 1 });
    assert.equal(r.ok, true, 'revision 1 (the default) is accepted');
    // Cross-class substitution: internal/non-history targets are rejected.
    for (const badClass of ['authoritative-audit-event', 'store-metadata', 'configuration-snapshot-record', 'not-a-class']) {
      r = inspect(env, 'inspect-audit-history', { recordClass: badClass, recordId: RECORD_ID_A });
      assert.equal(r.ok, false, `class ${badClass} must be rejected`);
      assert.equal(r.error?.code, 'invalid-request');
    }
    // Path-shaped operands.
    r = inspect(env, 'inspect-audit-history', { recordClass: 'approval-record', recordId: '/abs/path' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    // Exact-revision mismatch: the revision-1 object exists at the derived
    // location, so the domain reports an integrity mismatch, never absence
    // (WP-8K exact-revision semantics; HST-001).
    r = historyInspect(env, RECORD_ID_A, { revision: 2 });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'integrity-conflict');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: history requestId echo on success and error paths', () => {
  const env = makeStore();
  try {
    publishHistoryTarget(env, RECORD_ID_A);
    // Success.
    let r = historyInspect(env, RECORD_ID_A, {}, 'req-history');
    assert.equal(r.ok, true);
    assert.equal((r as { requestId?: string }).requestId, 'req-history');
    // Not-found error.
    r = historyInspect(env, 'pgw:r:' + 'c'.repeat(32), {}, 'req-notfound');
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not-found');
    assert.equal(r.error?.requestId, 'req-notfound');
    // Invalid-cursor error.
    r = historyInspect(env, RECORD_ID_A, { continuation: '!!!!' }, 'req-badcursor');
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-cursor');
    assert.equal(r.error?.requestId, 'req-badcursor');
    // Invalid-request error.
    r = inspect(env, 'inspect-audit-history', { recordClass: 'approval-record', recordId: RECORD_ID_A, revision: 0 }, 'req-badrev');
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'invalid-request');
    assert.equal(r.error?.requestId, 'req-badrev');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: history responses are redacted and history facts/cursors grant zero authority', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-04T00:00:00.000Z')));
    const page1 = historyInspect(env, RECORD_ID_A);
    assert.equal(page1.ok, true);
    const page1Result = page1.result as { continuation: string };
    assert.ok(page1Result.continuation !== undefined, 'the two-event fixture must truncate the first page');
    const serialized = JSON.stringify(page1);
    assert.equal(serialized.includes(env.dir), false, 'no absolute project/store path may leak');
    assert.equal(/node:fs|Error:|at \w|ETIMEDOUT|ENOENT|EACCES/.test(serialized), false, 'no stack/errno material may leak');
    assert.ok(serialized.includes('pgw:l:'), 'normative event identities remain public facts');
    const cursor = page1Result.continuation;
    // Replaying result or cursor data into genuine-brand boundaries grants nothing.
    const asInput = { configurationIdentity: CONFIG_IDENTITY, serviceUid: UID, forbiddenRoots: [], locator: env.dir, limitProfile: env.limitProfile, actionIdentity: 'replay', cursor };
    const context = createInspectionContext({ trustedConfiguration: env.config, trustedInput: asInput });
    assert.equal(context.ok, false, 'structural replay of history data must never become a trusted input');
    const decodedCursor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const context2 = createInspectionContext({ trustedConfiguration: env.config, trustedInput: decodedCursor });
    assert.equal(context2.ok, false, 'a decoded history cursor must never become a trusted input');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('mcp: history inspection never mutates the store (clean, paginated, stale, malformed, conflicting)', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  const plain = makeStore();
  try {
    // Fixtures for both stores are set up BEFORE the before-snapshot.
    const facts = publishHistoryTarget(env, RECORD_ID_A);
    rmSync(facts.auditPath);
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModelOf(reconstructionEvent(env, facts.recordDigest, 'recovery-two', '2026-01-04T00:00:00.000Z')));
    const plainFacts = publishHistoryTarget(plain, RECORD_ID_A);
    rmSync(plainFacts.auditPath);
    writeAuditEnvelope(plain, eventModelOf(reconstructionEvent(plain, plainFacts.recordDigest, 'recovery-one', '2026-01-01T00:00:00.000Z')));
    writeAuditEnvelope(plain, eventModelOf(reconstructionEvent(plain, plainFacts.recordDigest, 'recovery-two', '2026-01-02T00:00:00.000Z')));
    const before = snapshotStore(env.storeRoot) + snapshotStore(env.configRoot) + snapshotStore(plain.storeRoot) + snapshotStore(plain.configRoot);
    // Paginated walk + stale cursor + malformed cursor on env.
    const page1 = historyInspect(env, RECORD_ID_A);
    assert.equal(page1.ok, true);
    const cursor = (page1.result as { continuation: string }).continuation;
    historyInspect(env, RECORD_ID_A, { continuation: cursor });
    historyInspect(env, RECORD_ID_A, { continuation: 'tampered!' });
    // Conflicting single-page on plain env.
    historyInspect(plain, RECORD_ID_A);
    historyInspect(plain, 'pgw:r:' + 'c'.repeat(32));
    const after = snapshotStore(env.storeRoot) + snapshotStore(env.configRoot) + snapshotStore(plain.storeRoot) + snapshotStore(plain.configRoot);
    assert.equal(after, before, 'no store object may be created, modified, or removed by history inspection');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
    rmSync(plain.dir, { recursive: true, force: true });
  }
});
