/**
 * WP-8-H persistent registry-index tests (ADR-031; contract 5.2 `index/`,
 * CSA-003/004, ITG-005, RGY-001/007, WPR-009): deterministic canonical
 * index bytes and identity, completeness invariants, exact immutable
 * publication, stale detection and fast-path equivalence, authority
 * confinement, recovery classification, bounds, the stale-build rejection,
 * and the fixed 8-stage crash inventory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedStorageBootstrapInput, createTrustedRecoveryRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan, executeRecoveryMutation, publishRegistryIndex } from '../../../src/storage/recovery/index.js';
import { deriveRegistryView, runRegistrySnapshotScan, buildRegistryIndex, parseRegistryIndex, validateRegistryIndexSelfConsistency, REGISTRY_INDEX_MODEL_VERSION } from '../../../src/storage/registry/index.js';
import { deriveRegistryIndexRelativePath } from '../../../src/storage/layout/layout.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { createRecoveryCapability, createRecoveryPublicationPermit } from '../../../src/storage/capabilities/authenticity.js';
import { publishRecoveryBoundRecord } from '../../../src/storage/publication/publish-record.js';
import { buildAuthorizedWriteAuditEvent } from '../../../src/storage/audit/write-audit.js';
import { computePayloadDigest, canonicalEnvelopeBytes, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../../../src/storage/format/envelope.js';
import { jcsSerialize } from '../../../src/canonical/jcs.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import type { RecoveryMutationRequest, RecoveryMutationStage } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'wp8h-write';
const RECOVERY_ACTION = 'wp8h-recovery';
const RECORD_ID = 'pgw:r:11110000000000000000000000000001';

function profile(overrides: Partial<Record<string, number>> = {}): SelectedLimitProfile {
  const base: Record<string, number> = { ...defaultLimitProfile() };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface TestEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
  readonly limitProfile: SelectedLimitProfile;
  readonly storeRoot: string;
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8h-idx-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8h-bootstrap',
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
  return { dir, config, trustedInput: inputResult.input, limitProfile, storeRoot: `${dir}/store-v1` };
}

function publish(env: TestEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }): void {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const record = {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload,
    payloadDigest: computePayloadDigest(payload),
  };
  const result = publishRecord({
    trustedConfiguration: env.config,
    bootstrapInput: env.trustedInput,
    writeActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    recordClass: 'approval-record',
    record,
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
}

/** Registry-mode generation/surface tokens (the index-rebuild request bindings). */
function registryTokens(env: TestEnv): { readonly generation: string; readonly surfaceGeneration: string } {
  const view = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(view.ok, true, JSON.stringify(view.findings));
  return { generation: view.view!.source.generation, surfaceGeneration: view.view!.source.surfaceGeneration };
}

function rebuildRequest(env: TestEnv, tokens: { readonly generation: string; readonly surfaceGeneration: string }, overrides: Partial<RecoveryMutationRequest['action']> = {}): RecoveryMutationRequest {
  const provenance = createRecoveryActionProvenance({
    actionIdentity: RECOVERY_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  return {
    trustedConfiguration: env.config,
    recoveryActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    trustedInput: env.trustedInput,
    action: {
      category: 'registry-index-rebuild',
      expectedRegistryGeneration: tokens.generation,
      expectedRegistrySurfaceGeneration: tokens.surfaceGeneration,
      ...overrides,
    } as RecoveryMutationRequest['action'],
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
}

/** Full rebuild via the authorized mutation; returns the index identity. */
function rebuild(env: TestEnv, overrides: Partial<RecoveryMutationRequest['action']> = {}): { readonly indexId: string; readonly outcome: string | undefined } {
  const result = executeRecoveryMutation(rebuildRequest(env, registryTokens(env), overrides));
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.ok(result.indexId !== undefined, 'rebuild must return the index identity');
  return { indexId: result.indexId!, outcome: result.outcome };
}

function indexPathOf(env: TestEnv, indexId: string): string {
  const derived = deriveRegistryIndexRelativePath(indexId);
  assert.equal(derived.ok, true);
  return join(env.storeRoot, derived.relativePath);
}

function fastPathState(env: TestEnv): { readonly ok: boolean; readonly indexState?: string } {
  const result = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
  return { ok: result.ok, indexState: result.indexState };
}

/** Authoritative view (no fast path). */
function authoritativeView(env: TestEnv) {
  const result = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return result.view!;
}

// ── Determinism ────────────────────────────────────────────────────────────

test('registry-index: identical immutable state yields identical identity and canonical bytes', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    publish(env, 'pgw:r:22220000000000000000000000000002');
    const snapshotA = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(snapshotA.ok, true);
    const builtA = buildRegistryIndex({
      observations: snapshotA.observations!,
      findings: snapshotA.findings ?? [],
      scanFacts: snapshotA.scanFacts!,
      storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!,
      entryLimit: env.limitProfile['totalScanEntries']!,
      byteLimit: env.limitProfile['totalScanBytes']!,
      indexRebuildWork: env.limitProfile['indexRebuildWork']!,
      indexBytes: env.limitProfile['indexBytes']!,
    });
    assert.equal(builtA.ok, true, JSON.stringify(builtA));
    const builtB = buildRegistryIndex({
      observations: snapshotA.observations!,
      findings: snapshotA.findings ?? [],
      scanFacts: snapshotA.scanFacts!,
      storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!,
      entryLimit: env.limitProfile['totalScanEntries']!,
      byteLimit: env.limitProfile['totalScanBytes']!,
      indexRebuildWork: env.limitProfile['indexRebuildWork']!,
      indexBytes: env.limitProfile['indexBytes']!,
    });
    assert.equal(builtB.ok, true);
    assert.equal(builtA.index!.indexId, builtB.index!.indexId, 'identity must be deterministic');
    assert.equal(builtA.index!.canonicalUtf8, builtB.index!.canonicalUtf8, 'canonical bytes must be deterministic');
    assert.equal(builtA.index!.digest, builtB.index!.digest);
    assert.match(builtA.index!.indexId, /^[0-9a-f]{32}$/);
    // The rebuild through the mutation publishes exactly those bytes.
    const rebuilt = rebuild(env);
    assert.equal(rebuilt.indexId, builtA.index!.indexId);
    assert.equal(readFileSync(indexPathOf(env, rebuilt.indexId), 'utf8'), builtA.index!.canonicalUtf8);
    // Host creation order is irrelevant: the builder canonicalizes its
    // input, so a reversed observation order yields identical bytes.
    const reversedInput = buildRegistryIndex({
      observations: [...snapshotA.observations!].reverse(),
      findings: snapshotA.findings ?? [],
      scanFacts: snapshotA.scanFacts!,
      storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!,
      entryLimit: env.limitProfile['totalScanEntries']!,
      byteLimit: env.limitProfile['totalScanBytes']!,
      indexRebuildWork: env.limitProfile['indexRebuildWork']!,
      indexBytes: env.limitProfile['indexBytes']!,
    });
    assert.equal(reversedInput.ok, true);
    assert.equal(reversedInput.index!.canonicalUtf8, builtA.index!.canonicalUtf8, 'creation order must not affect canonical index bytes');
    // Different record state → different identity.
    publish(env, 'pgw:r:33330000000000000000000000000003');
    const snapshotC = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const builtC = buildRegistryIndex({
      observations: snapshotC.observations!,
      findings: snapshotC.findings ?? [],
      scanFacts: snapshotC.scanFacts!,
      storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!,
      entryLimit: env.limitProfile['totalScanEntries']!,
      byteLimit: env.limitProfile['totalScanBytes']!,
      indexRebuildWork: env.limitProfile['indexRebuildWork']!,
      indexBytes: env.limitProfile['indexBytes']!,
    });
    assert.equal(builtC.ok, true);
    assert.notEqual(builtC.index!.indexId, builtA.index!.indexId, 'different record state must yield a different identity');
    assert.notEqual(builtC.index!.canonicalUtf8, builtA.index!.canonicalUtf8);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Completeness ───────────────────────────────────────────────────────────

test('registry-index: truncated and continuation states are rejected; contested identities are preserved', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const snapshot = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(snapshot.ok, true);
    const storeInstance = (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!;
    const base = {
      observations: snapshot.observations!,
      findings: snapshot.findings ?? [],
      storeInstance,
      entryLimit: env.limitProfile['totalScanEntries']!,
      byteLimit: env.limitProfile['totalScanBytes']!,
      indexRebuildWork: env.limitProfile['indexRebuildWork']!,
      indexBytes: env.limitProfile['indexBytes']!,
    };
    const truncated = buildRegistryIndex({ ...base, scanFacts: { ...snapshot.scanFacts!, truncated: true } });
    assert.equal(truncated.ok, false);
    assert.equal(truncated.code, 'ERR-STO-LIMIT-EXCEEDED');
    assert.match(truncated.message ?? '', /COMPLETE/);
    const continued = buildRegistryIndex({
      ...base,
      scanFacts: snapshot.scanFacts!,
      continuation: { generation: 'sha-256:' + '1'.repeat(64), surfaceGeneration: 'sha-256:' + '2'.repeat(64), recordClass: 'approval-record', shard: '1111', entry: 'x.rec' },
    });
    assert.equal(continued.ok, false);
    assert.equal(continued.code, 'ERR-STO-REQ-INVALID');
    assert.match(continued.message ?? '', /COMPLETE/);
    // Contested identity: a wrong-location copy of the record with the same
    // identity contests the derived-location record.
    const component = RECORD_ID.slice('pgw:r:'.length);
    const recDerived = deriveRecordRelativePath('approval-record', RECORD_ID);
    assert.equal(recDerived.ok, true);
    const recordBytes = readFileSync(join(env.storeRoot, recDerived.relativePath), 'utf8');
    mkdirSync(join(env.storeRoot, 'records', 'approval', '0000'), { recursive: true, mode: 0o700 });
    writeFileSync(join(env.storeRoot, 'records', 'approval', '0000', `${component}.rec`), recordBytes, { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'records', 'approval', '0000', `${component}.rec`), 0o600);
    const contestedSnapshot = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(contestedSnapshot.ok, true);
    const built = buildRegistryIndex({
      ...base,
      observations: contestedSnapshot.observations!,
      findings: contestedSnapshot.findings ?? [],
      scanFacts: contestedSnapshot.scanFacts!,
    });
    assert.equal(built.ok, true, JSON.stringify(built));
    const parsed = parseRegistryIndex(built.index!.canonicalUtf8, env.limitProfile['indexBytes']!, 16 * 1024 * 1024);
    assert.equal(parsed.ok, true);
    assert.equal(validateRegistryIndexSelfConsistency(parsed.model!).ok, true);
    // The contested identity is preserved as a conflict (never silently
    // resolved): the authoritative view and the index-derived view agree.
    const authoritative = authoritativeView(env);
    assert.equal(authoritative.duplicateConflicts.some((c) => c.identity === RECORD_ID), true);
    // Publish the index and serve it via the fast path.
    rebuild(env);
    const fast = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
    assert.equal(fast.ok, true, JSON.stringify(fast.findings));
    assert.equal(fast.indexState, 'current-valid');
    assert.deepEqual(fast.view!.duplicateConflicts, authoritative.duplicateConflicts);
    assert.deepEqual(fast.view!.recordsByIdentity, authoritative.recordsByIdentity);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Persistence ────────────────────────────────────────────────────────────

test('registry-index: exact publication, idempotent republish, conflicting final fails closed', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const first = rebuild(env);
    assert.equal(first.outcome, 'rebuilt');
    const indexFile = indexPathOf(env, first.indexId);
    const stat = statSync(indexFile);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.nlink, 1);
    assert.equal(stat.mode & 0o777, 0o600);
    // Identical republish is idempotent (already-completed, same identity).
    const second = rebuild(env);
    assert.equal(second.outcome, 'already-completed');
    assert.equal(second.indexId, first.indexId);
    assert.equal(readdirSync(join(env.storeRoot, 'index', 'registry-index')).flatMap((s) => readdirSync(join(env.storeRoot, 'index', 'registry-index', s))).length, 1, 'exactly one index file');
    // Conflicting final at the derived identity fails closed (no overwrite).
    const original = readFileSync(indexFile, 'utf8');
    writeFileSync(indexFile, original.replace('"modelVersion":"1"', '"modelVersion":"9"'), { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    const conflicting = executeRecoveryMutation(rebuildRequest(env, registryTokens(env)));
    assert.equal(conflicting.ok, false);
    assert.equal(conflicting.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(conflicting.findings?.[0]?.message ?? '', /conflicting registry-index/);
    assert.ok(readFileSync(indexFile, 'utf8').includes('"modelVersion":"9"'), 'the conflicting file must never be overwritten');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Validation / stale detection / fast path ───────────────────────────────

test('registry-index: fast path serves the exact authoritative semantics; every stale state falls back', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    // Missing: fallback with indexState missing.
    let state = fastPathState(env);
    assert.equal(state.ok, true, 'missing index must fall back to the authoritative scan');
    assert.equal(state.indexState, 'missing');
    // Build the index; current-valid serves with deep-equivalent semantics.
    const first = rebuild(env);
    const authoritative = authoritativeView(env);
    const fast = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
    assert.equal(fast.ok, true);
    assert.equal(fast.indexState, 'current-valid');
    assert.deepEqual(fast.view!.recordsByIdentity, authoritative.recordsByIdentity, 'fast path must reproduce the authoritative groups');
    assert.deepEqual(fast.view!.recordsByClass, authoritative.recordsByClass);
    assert.deepEqual(fast.view!.latestResolvableRevision, authoritative.latestResolvableRevision);
    assert.deepEqual(fast.view!.auditByPrimary, authoritative.auditByPrimary);
    assert.deepEqual(fast.view!.missingAudit, authoritative.missingAudit);
    assert.deepEqual(fast.view!.danglingAudit, authoritative.danglingAudit);
    assert.deepEqual(fast.view!.findings, authoritative.findings);
    assert.deepEqual(fast.view!.source.generation, authoritative.source.generation);
    assert.deepEqual(fast.view!.source.surfaceGeneration, authoritative.source.surfaceGeneration);
    // Stale record set: a new record after a fresh rebuild.
    clearIndexes(env);
    rebuild(env);
    publish(env, 'pgw:r:22220000000000000000000000000002');
    state = fastPathState(env);
    assert.equal(state.ok, true);
    assert.equal(state.indexState, 'stale-record-set');
    // Stale audit state: a new audit event after a fresh rebuild.
    clearIndexes(env);
    rebuild(env);
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const danglingAudit = buildAuthorizedWriteAuditEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: 'pgw:r:99990000000000000000000000000009',
      primaryRevision: 1,
      primaryDigest: 'sha-256:' + '9'.repeat(64),
      eventKind: 'authorized-write',
      trustedActionIdentity: WRITE_ACTION,
      primaryCreatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(danglingAudit.ok, true);
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', danglingAudit.event!.recordId);
    assert.equal(auditDerived.ok, true);
    mkdirSync(join(env.storeRoot, auditDerived.relativePath.slice(0, auditDerived.relativePath.lastIndexOf('/'))), { recursive: true, mode: 0o700 });
    writeFileSync(join(env.storeRoot, auditDerived.relativePath), danglingAudit.event!.canonicalUtf8, { mode: 0o600 });
    chmodSync(join(env.storeRoot, auditDerived.relativePath), 0o600);
    state = fastPathState(env);
    assert.equal(state.indexState, 'stale-audit-state');
    rmSync(join(env.storeRoot, auditDerived.relativePath));
    // Stale surface: a new record-class directory after a fresh rebuild.
    clearIndexes(env);
    rebuild(env);
    mkdirSync(join(env.storeRoot, 'records', 'migration'), { mode: 0o700 });
    state = fastPathState(env);
    assert.equal(state.indexState, 'stale-surface');
    rmSync(join(env.storeRoot, 'records', 'migration'), { recursive: true, force: true });
    // Stale generation: a different limit profile changes the registry scan
    // generation (the store metadata pins only the configuration identity).
    clearIndexes(env);
    rebuild(env);
    const otherProfile = profile({ totalScanEntries: 2048 });
    const otherInput = (() => {
      const bp = createStorageBootstrapActionProvenance({ actionIdentity: 'wp8h-bootstrap-2', locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: otherProfile });
      const r = createTrustedStorageBootstrapInput(env.config, bp, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: otherProfile });
      assert.equal(r.ok, true);
      return r.input;
    })();
    const staleGen = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: otherInput, usePersistentIndex: true });
    assert.equal(staleGen.ok, true, 'stale-generation must fall back to the authoritative scan');
    assert.equal(staleGen.indexState, 'stale-generation');
    // Tampering sequence on the single current index file.
    clearIndexes(env);
    const second = rebuild(env);
    const indexFile = indexPathOf(env, second.indexId);
    const good = readFileSync(indexFile, 'utf8');
    writeFileSync(indexFile, '{not an index', { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    assert.equal(fastPathState(env).indexState, 'malformed');
    writeFileSync(indexFile, good.replace('"modelVersion":"1"', '"modelVersion":"2"'), { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    assert.equal(fastPathState(env).indexState, 'unsupported-version');
    writeFileSync(indexFile, good, { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    assert.equal(fastPathState(env).indexState, 'current-valid');
    rmSync(indexFile);
    symlinkSync('/nonexistent', indexFile);
    assert.equal(fastPathState(env).indexState, 'wrong-type');
    rmSync(indexFile);
    writeFileSync(indexFile, good, { mode: 0o644 });
    chmodSync(indexFile, 0o644);
    assert.equal(fastPathState(env).indexState, 'wrong-uid-or-mode');
    chmodSync(indexFile, 0o600);
    // Conflicting index: tampered observation entry with canonical bytes
    // (root mismatch; the canonical-form check must still pass).
    const model = JSON.parse(good) as Record<string, unknown>;
    const entries = model['entries'] as Array<Record<string, unknown>>;
    entries[0] = { ...entries[0]!, code: 'tampered' };
    model['entries'] = entries;
    writeFileSync(indexFile, jcsSerialize(model), { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    assert.equal(fastPathState(env).indexState, 'conflicting-index');
    // Foreign index entry: an index bound to another store identity.
    writeFileSync(indexFile, good, { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    const foreignModel = JSON.parse(good) as Record<string, unknown>;
    (foreignModel['binding'] as Record<string, unknown>)['storeInstance'] = {
      parentIdentity: { dev: 1, ino: 1 },
      namespaces: [
        { kind: 'configuration', dev: 1, ino: 2 },
        { kind: 'store-records', dev: 1, ino: 3 },
      ],
    };
    writeFileSync(indexFile, jcsSerialize(foreignModel), { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    assert.equal(fastPathState(env).indexState, 'foreign-index-entry');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry-index: a corrupted index cannot mask authoritative store errors', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    rebuild(env);
    // Corrupt the RECORD content (same name, different size): the fast path
    // probe detects the change and falls back; the authoritative derivation
    // reports the record as unverified — the store error is never hidden by
    // the older valid-looking index.
    const recordRelative = deriveRecordRelativePath('approval-record', RECORD_ID);
    assert.equal(recordRelative.ok, true);
    const recordFile = join(env.storeRoot, recordRelative.relativePath);
    writeFileSync(recordFile, '{corrupted', { mode: 0o600 });
    chmodSync(recordFile, 0o600);
    const fast = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
    assert.equal(fast.ok, true);
    assert.equal(fast.indexState, 'stale-record-set');
    assert.equal(fast.view!.recordsByIdentity[RECORD_ID], undefined, 'the corrupted record must not appear as verified');
    // The authoritative path reports the same unverified state.
    const authoritative = authoritativeView(env);
    assert.equal(authoritative.recordsByIdentity[RECORD_ID], undefined);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Authority ──────────────────────────────────────────────────────────────

test('registry-index: forged index grants nothing; permit is exact and cannot publish other objects', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    rebuild(env);
    // A forged index (valid parse, wrong store identity) is never served.
    const state = fastPathState(env);
    void state;
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const inputResult = createTrustedRecoveryRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(inputResult.ok, true);
    const cap = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: storeResult.storeInstance! });
    assert.ok(cap !== undefined);
    // The permit binds the exact internally derived destination only.
    const indexId = rebuild(env).indexId;
    const derived = deriveRegistryIndexRelativePath(indexId);
    assert.equal(derived.ok, true);
    const wrongDestination = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'registry-index-rebuild',
      role: 'registry-index',
      recordId: indexId,
      recordDigest: 'sha-256:' + '1'.repeat(64),
      canonicalBytesDigest: 'sha-256:' + '1'.repeat(64),
      destinationDesignation: 'index/evil/x.idx',
    });
    assert.equal(wrongDestination, undefined, 'a caller-selected destination must never mint');
    const arbitraryId = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'registry-index-rebuild',
      role: 'registry-index',
      recordId: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      recordDigest: 'sha-256:' + '1'.repeat(64),
      canonicalBytesDigest: 'sha-256:' + '1'.repeat(64),
      destinationDesignation: derived.relativePath,
    });
    assert.equal(arbitraryId, undefined, 'a non-hex identity must never mint');
    // The publication builder cannot publish another object class: the sink
    // rejects record bytes under an index permit.
    const good = readFileSync(indexPathOf(env, indexId), 'utf8');
    const permit = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'registry-index-rebuild',
      role: 'registry-index',
      recordId: indexId,
      recordDigest: computeDomainDigestOf(good),
      canonicalBytesDigest: computeDomainDigestOf(good),
      destinationDesignation: derived.relativePath,
    });
    assert.ok(permit !== undefined);
    const recordBytes = canonicalEnvelopeBytes({
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId: RECORD_ID,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: true },
      payloadDigest: computePayloadDigest({ approved: true }),
    }).canonicalUtf8;
    const wrongClass = publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8: recordBytes, byteLimit: env.limitProfile['indexBytes']!, serviceUid: UID });
    assert.equal(wrongClass.ok, false, 'an index permit must never publish a primary record');
    // The index itself is never an authority operand for capabilities:
    // capability creators require the branded trusted inputs only.
    assert.equal(cap.verify('registry-index-rebuild').ok, true);
    cap.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Recovery integration ───────────────────────────────────────────────────

test('registry-index: recovery classifies index artifacts; index loss leaves recovery functional', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    // No index: missing state, plan recommends rebuild, recovery works.
    const scanMissing = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanMissing.ok, true);
    assert.equal(scanMissing.assessment!.indexMissing, true);
    assert.ok(scanMissing.plan!.actions.some((a) => a.category === 'registry-index-rebuild' && a.targetKind === 'index-object'));
    // Rebuild: recovery classifies the artifact as current-valid.
    const indexId = rebuild(env).indexId;
    const scanCurrent = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanCurrent.ok, true);
    assert.equal(scanCurrent.assessment!.indexMissing, false);
    const current = scanCurrent.assessment!.indexArtifacts.find((a) => a.indexId === indexId);
    assert.ok(current !== undefined);
    assert.equal(current!.classification, 'index-current-valid');
    assert.equal(scanCurrent.plan!.actions.some((a) => a.category === 'registry-index-rebuild'), false, 'a current index needs no rebuild');
    // Stale index: recovery classifies with the deterministic stale reason.
    publish(env, 'pgw:r:22220000000000000000000000000002');
    const scanStale = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanStale.ok, true);
    const stale = scanStale.assessment!.indexArtifacts.find((a) => a.indexId === indexId);
    assert.ok(stale !== undefined);
    assert.equal(stale!.classification, 'index-stale');
    assert.equal(stale!.staleReason, 'stale-record-set');
    assert.ok(scanStale.plan!.actions.some((a) => a.category === 'registry-index-rebuild' && a.observedEvidence.includes(stale!.id)));
    // Malformed + foreign index artifacts.
    const indexFile = indexPathOf(env, indexId);
    writeFileSync(indexFile, '{garbage', { mode: 0o600 });
    chmodSync(indexFile, 0o600);
    mkdirSync(join(env.storeRoot, 'index', 'registry-index', 'zzzz'), { recursive: true, mode: 0o700 });
    writeFileSync(join(env.storeRoot, 'index', 'registry-index', 'zzzz', 'stray.txt'), 'x', { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'index', 'registry-index', 'zzzz', 'stray.txt'), 0o600);
    const scanBad = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanBad.ok, true, 'index anomalies must never break recovery');
    assert.equal(scanBad.assessment!.indexArtifacts.some((a) => a.classification === 'index-malformed'), true);
    assert.equal(scanBad.assessment!.indexArtifacts.some((a) => a.classification === 'foreign-entry'), true);
    // Loss of the index: authoritative recovery remains fully functional.
    rmSync(join(env.storeRoot, 'index'), { recursive: true, force: true });
    const scanLost = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanLost.ok, true);
    assert.equal(scanLost.assessment!.verifiedDurableRecords.length, 2, 'records are never lost with the index');
    assert.equal(scanLost.assessment!.indexMissing, true);
    // An index-publication temporary is classified as an incomplete index
    // temporary (still a WPR-023 temporary; quarantine-eligible).
    writeFileSync(join(env.storeRoot, 'tmp', 'pub-eeeeeeeeeeeeeeee-0'), goodIndexBytes(env), { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'tmp', 'pub-eeeeeeeeeeeeeeee-0'), 0o600);
    const scanTemp = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanTemp.ok, true);
    const temp = scanTemp.assessment!.orphanTemporaryObjects.find((o) => o.entry === 'pub-eeeeeeeeeeeeeeee-0');
    assert.ok(temp !== undefined);
    // Index bytes are not record bytes: the temp classifies as a WPR-023 (c)
    // malformed temporary, still marked as an index-publication artifact.
    assert.equal(temp!.classification, 'malformed-temporary');
    assert.ok(scanTemp.assessment!.findings.some((f) => f.message.includes('incomplete registry-index temporary')));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Bounds ─────────────────────────────────────────────────────────────────

test('registry-index: bounds fail the build deterministically; the authoritative scan stays usable', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const snapshot = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(snapshot.ok, true);
    const storeInstance = (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!;
    const base = {
      observations: snapshot.observations!,
      findings: snapshot.findings ?? [],
      scanFacts: snapshot.scanFacts!,
      storeInstance,
      entryLimit: env.limitProfile['totalScanEntries']!,
      byteLimit: env.limitProfile['totalScanBytes']!,
      indexRebuildWork: env.limitProfile['indexRebuildWork']!,
      indexBytes: env.limitProfile['indexBytes']!,
    };
    const tooSmall = buildRegistryIndex({ ...base, indexBytes: 1024 });
    assert.equal(tooSmall.ok, false);
    assert.equal(tooSmall.code, 'ERR-STO-LIMIT-EXCEEDED');
    assert.match(tooSmall.message ?? '', /indexBytes/);
    const tooFew = buildRegistryIndex({ ...base, indexRebuildWork: 1 });
    assert.equal(tooFew.ok, false);
    assert.equal(tooFew.code, 'ERR-STO-LIMIT-EXCEEDED');
    // The authoritative scan remains fully usable regardless.
    const view = authoritativeView(env);
    assert.equal(view.recordsByIdentity[RECORD_ID]?.length, 1);
    // The rebuild through the mutation with a tiny indexBytes bound fails
    // closed and publishes nothing.
    const tinyProfileEnv = makeStore(profile({ indexBytes: 1024 }));
    try {
      publish(tinyProfileEnv, RECORD_ID);
      const tokens = registryTokens(tinyProfileEnv);
      const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: tinyProfileEnv.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: tinyProfileEnv.limitProfile });
      const failed = executeRecoveryMutation({
        trustedConfiguration: tinyProfileEnv.config,
        recoveryActionProvenance: provenance,
        locator: tinyProfileEnv.dir,
        serviceUid: UID,
        forbiddenRoots: [],
        limitProfile: tinyProfileEnv.limitProfile,
        trustedInput: tinyProfileEnv.trustedInput,
        action: { category: 'registry-index-rebuild', expectedRegistryGeneration: tokens.generation, expectedRegistrySurfaceGeneration: tokens.surfaceGeneration },
        timeSource: { now: () => 1000, processStartTime: 500 },
      });
      assert.equal(failed.ok, false);
      assert.equal(failed.findings?.[0]?.code, 'ERR-STO-LIMIT-EXCEEDED');
      assert.equal(existsSync(join(tinyProfileEnv.storeRoot, 'index')), false, 'nothing may be published for an over-bound build');
    } finally {
      rmSync(tinyProfileEnv.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Concurrency / stale build ──────────────────────────────────────────────

test('registry-index: store changes between build and publication fail closed as a stale build', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const tokens = registryTokens(env);
    const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    // A stage hook publishes a new record file between the build scan and
    // the under-lock recheck (fixture-level write; the writer lock is held
    // by the rebuild, so the write path itself cannot run).
    let injected = false;
    const result = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: provenance,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      trustedInput: env.trustedInput,
      action: { category: 'registry-index-rebuild', expectedRegistryGeneration: tokens.generation, expectedRegistrySurfaceGeneration: tokens.surfaceGeneration },
      timeSource: { now: () => 1000, processStartTime: 500 },
      hooks: {
        stage: (s) => {
          if (s === 'after-lock-acquisition' && !injected) {
            injected = true;
            const component = '22220000000000000000000000000002';
            mkdirSync(join(env.storeRoot, 'records', 'approval', component.slice(0, 4)), { recursive: true, mode: 0o700 });
            writeFileSync(join(env.storeRoot, 'records', 'approval', component.slice(0, 4), `${component}.rec`), canonicalEnvelopeBytes({
              recordKind: 'ApprovalRecord',
              formatVersion: '1.0',
              recordId: 'pgw:r:' + component,
              revision: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              trustedActionId: WRITE_ACTION,
              payload: { approved: true },
              payloadDigest: computePayloadDigest({ approved: true }),
            }).canonicalUtf8, { mode: 0o600 });
          }
        },
      },
    });
    assert.equal(injected, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(result.findings?.[0]?.message ?? '', /stale build/);
    // Nothing was published for the old snapshot; the lock was released.
    assert.equal(existsSync(join(env.storeRoot, 'locks', 'writer.lock')), false);
    // A fresh rebuild from the current state succeeds.
    const fresh = rebuild(env);
    assert.equal(fresh.outcome, 'rebuilt');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Crash model ────────────────────────────────────────────────────────────

/** Fixed registry-index-rebuild crash-stage inventory (WP-8-H §16). */
const INDEX_REBUILD_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-lock-acquisition',
  'after-lock-acquisition',
  'after-generation-recheck',
  'before-index-publication',
  'after-index-publication',
  'before-directory-durability',
  'after-directory-durability',
  'before-lock-release',
];

test('registry-index: the fixed 8-stage crash inventory is asserted', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const tokens = registryTokens(env);
    const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: provenance,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      trustedInput: env.trustedInput,
      action: { category: 'registry-index-rebuild', expectedRegistryGeneration: tokens.generation, expectedRegistrySurfaceGeneration: tokens.surfaceGeneration },
      timeSource: { now: () => 1000, processStartTime: 500 },
      hooks: { stage: (s) => seen.push(s) },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, INDEX_REBUILD_CRASH_STAGES, 'the fixed registry-index-rebuild crash-stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry-index: a crash at every stage leaves a classifiable state and a safe rerun', () => {
  for (const stage of INDEX_REBUILD_CRASH_STAGES) {
    const env = makeStore();
    try {
      publish(env, RECORD_ID);
      const tokens = registryTokens(env);
      const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
      const request = (): RecoveryMutationRequest => ({
        trustedConfiguration: env.config,
        recoveryActionProvenance: provenance,
        locator: env.dir,
        serviceUid: UID,
        forbiddenRoots: [],
        limitProfile: env.limitProfile,
        trustedInput: env.trustedInput,
        action: { category: 'registry-index-rebuild', expectedRegistryGeneration: tokens.generation, expectedRegistrySurfaceGeneration: tokens.surfaceGeneration },
        timeSource: { now: () => 1000, processStartTime: 500 },
      });
      let crashed = false;
      try {
        executeRecoveryMutation({
          ...request(),
          hooks: {
            stage: (s) => {
              if (s === stage) {
                crashed = true;
                throw new Error(`simulated crash at ${stage}`);
              }
            },
          },
        });
      } catch {
        assert.equal(crashed, true, `crash must fire at ${stage}`);
      }
      // The authoritative store is untouched: exactly one record remains.
      const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
      assert.equal(scanAfterCrash.assessment!.verifiedDurableRecords.length, 1, `${stage}: records must be untouched`);
      const lockPresent = existsSync(join(env.storeRoot, 'locks', 'writer.lock'));
      if (stage !== 'before-lock-acquisition') {
        assert.equal(lockPresent, true, `crash at ${stage} leaves the writer lock`);
        const locked = executeRecoveryMutation(request());
        assert.equal(locked.ok, false);
        assert.equal(locked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
        rmSync(join(env.storeRoot, 'locks', 'writer.lock'));
      }
      // Rerun: completes (rebuild or already-completed) and never publishes
      // a second index for the same state.
      const rerun = executeRecoveryMutation(request());
      assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
      assert.ok(rerun.outcome === 'rebuilt' || rerun.outcome === 'already-completed', `${stage}: deterministic outcome`);
      assert.ok(rerun.indexId !== undefined);
      const indexCount = readdirSync(join(env.storeRoot, 'index', 'registry-index')).flatMap((s) => readdirSync(join(env.storeRoot, 'index', 'registry-index', s))).filter((f) => f.endsWith('.idx')).length;
      assert.equal(indexCount, 1, `${stage}: exactly one index file`);
      assert.equal(existsSync(join(env.storeRoot, 'locks', 'writer.lock')), false, `${stage}: the lock must be released`);
      // The published index validates as current.
      const fast = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
      assert.equal(fast.ok, true);
      assert.equal(fast.indexState, 'current-valid', `${stage}: the published index must be current-valid`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Remove every published index file (fixture; keeps the fast-path
 * diagnostic state deterministic when only the current index may remain). */
function clearIndexes(env: TestEnv): void {
  const family = join(env.storeRoot, 'index', 'registry-index');
  if (!existsSync(family)) return;
  for (const shard of readdirSync(family)) {
    const shardDir = join(family, shard);
    for (const entry of readdirSync(shardDir)) rmSync(join(shardDir, entry));
  }
}

function existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function computeDomainDigestOf(raw: string): string {
  return computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
}

/** Canonical index bytes of the current store state (fixture). */
function goodIndexBytes(env: TestEnv): string {
  const snapshot = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(snapshot.ok, true);
  const built = buildRegistryIndex({
    observations: snapshot.observations!,
    findings: snapshot.findings ?? [],
    scanFacts: snapshot.scanFacts!,
    storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance)!,
    entryLimit: env.limitProfile['totalScanEntries']!,
    byteLimit: env.limitProfile['totalScanBytes']!,
    indexRebuildWork: env.limitProfile['indexRebuildWork']!,
    indexBytes: env.limitProfile['indexBytes']!,
  });
  assert.equal(built.ok, true);
  return built.index!.canonicalUtf8;
}
