/**
 * WP-8-I external-disposition adjudication foundation tests (contract
 * §16.5 "disposition required"; WP-8-H conflicting-index disposition;
 * WPR-023 (d)): authority gating, exact classification binding per
 * class-specific operation, current-state re-verification, deterministic
 * `disposition-required` results with ZERO mutation, no evidence
 * production, idempotent replay, the fixed stage inventory, and crash
 * safety.
 *
 * The contract defines NO disposition mutation primitive for any supported
 * class (no quarantine-object deletion, no conflicting-index deletion, no
 * WPR-023 (d) transition), so every execution in this slice is the
 * non-mutating adjudication foundation: full authentication and
 * re-verification, then the deterministic `disposition-required` verdict.
 * The object is left byte-identical and the assessment continues to
 * classify it as requires-external-disposition (never downgraded).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, linkSync, unlinkSync, statSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedStorageBootstrapInput, createTrustedRecoveryRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan, executeRecoveryMutation, quarantineObservationId, computeQuarantineEvidenceIdentity, computeDispositionEvidenceIdentity, buildDispositionEvidenceRecord, verifyExistingDispositionEvidence } from '../../../src/storage/recovery/index.js';
import { deriveRegistryView } from '../../../src/storage/registry/index.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { computePayloadDigest, canonicalEnvelopeBytes, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { createRecoveryCapability } from '../../../src/storage/capabilities/authenticity.js';
import { jcsSerialize } from '../../../src/canonical/jcs.js';
import type { RecoveryMutationRequest, RecoveryMutationStage } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'external-disposition-write';
const RECOVERY_ACTION = 'external-disposition-action';
const RECORD_ID = 'pgw:r:11110000000000000000000000000001';
const D_TEMP = 'pub-dddddddddddddddd-0';

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
  /** WP-8-I index fixture: the untampered canonical index bytes. */
  readonly originalIndexBytes?: string;
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8i-disp-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8i-bootstrap',
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

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Recovery assessment for the current store (generation/surface tokens). */
function currentTokens(env: TestEnv): { readonly generation: string; readonly surfaceGeneration: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { generation: result.assessment!.source.generation, surfaceGeneration: result.assessment!.source.surfaceGeneration };
}

/** One requires-external-disposition finding for a classification. */
function dispositionFinding(env: TestEnv, classification: string): { readonly observationId: string; readonly code: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true);
  const finding = result.assessment!.requiresDisposition.find((d) => d.classification === classification);
  assert.ok(finding !== undefined, `the assessment must classify ${classification} as requires-external-disposition`);
  return { observationId: finding.observationId, code: finding.code };
}

interface DispositionFacts {
  readonly observationId: string;
  readonly code: string;
  readonly generation: string;
  readonly surfaceGeneration: string;
}

function dispositionRequest(env: TestEnv, facts: DispositionFacts, overrides: Partial<RecoveryMutationRequest['action']>): RecoveryMutationRequest {
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
    action: {
      category: 'dispose-wpr023d-temporary',
      targetEntry: D_TEMP,
      expectedDispositionClassification: 'temporary-other',
      expectedCode: facts.code,
      expectedEntryType: 'symlink',
      expectedObservationIds: [facts.observationId],
      expectedDispositionFindingId: facts.observationId,
      expectedGeneration: facts.generation,
      expectedSurfaceGeneration: facts.surfaceGeneration,
      ...overrides,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
}

// ── Fixtures: WPR-023 (d) temporaries ──────────────────────────────────────

function makeStoreWithD(entryType: 'symlink' | 'wrong-mode' | 'directory'): TestEnv {
  const env = makeStore();
  publish(env, RECORD_ID);
  const tmpPath = join(env.storeRoot, 'tmp', D_TEMP);
  if (entryType === 'symlink') {
    symlinkSync('/nonexistent-disposition-target', tmpPath);
  } else if (entryType === 'directory') {
    mkdirSync(tmpPath, { mode: 0o700 });
  } else {
    writeFileSync(tmpPath, 'x', { mode: 0o644 });
    chmodSync(tmpPath, 0o644);
  }
  return env;
}

function dFacts(env: TestEnv, entryType: 'symlink' | 'wrong-mode' | 'directory'): DispositionFacts & { readonly code: string } {
  const finding = dispositionFinding(env, 'temporary-other');
  const tokens = currentTokens(env);
  return { ...finding, ...tokens, code: finding.code };
}

// ── Fixtures: quarantine-object disposition classes ────────────────────────

function quarantineDir(env: TestEnv, shard: string): string {
  const dir = join(env.storeRoot, 'quarantine', 'temporary', shard);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function qtnPath(env: TestEnv, shard: string, name: string): string {
  return join(quarantineDir(env, shard), name);
}

/** Build a quarantine-object store containing every disposition class. */
function makeStoreWithQuarantineClasses(): TestEnv {
  const env = makeStore();
  publish(env, RECORD_ID);
  const shard = 'abcd';
  const dir = quarantineDir(env, shard);
  // malformed: .qtn name grammar failure.
  writeFileSync(join(dir, 'nothex.qtn'), 'x', { mode: 0o600 });
  chmodSync(join(dir, 'nothex.qtn'), 0o600);
  // foreign: non-.qtn entry.
  writeFileSync(join(dir, 'stray.txt'), 'x', { mode: 0o600 });
  chmodSync(join(dir, 'stray.txt'), 0o600);
  // conflicting: valid .qtn object whose derived evidence record mismatches.
  const conflictId = 'b'.repeat(64);
  writeFileSync(join(dir, `${conflictId}.qtn`), 'conflict-bytes', { mode: 0o600 });
  chmodSync(join(dir, `${conflictId}.qtn`), 0o600);
  const modeId = 'e'.repeat(64);
  writeFileSync(join(dir, `${modeId}.qtn`), 'mode-bytes', { mode: 0o644 });
  chmodSync(join(dir, `${modeId}.qtn`), 0o644);
  // wrong-type: symlink at a .qtn name.
  const typeId = 'd'.repeat(64);
  symlinkSync('/nonexistent-quarantine-target', join(dir, `${typeId}.qtn`));
  // unexpected-hard-link: nlink 2 object.
  const linkId = 'f'.repeat(64);
  writeFileSync(join(dir, `${linkId}.qtn`), 'link-bytes', { mode: 0o600 });
  chmodSync(join(dir, `${linkId}.qtn`), 0o600);
  linkSync(join(dir, `${linkId}.qtn`), join(dir, `${'f'.repeat(62)}ee.qtn`));
  // A valid quarantined object (complete evidence) must NOT be disposable.
  const validId = 'a'.repeat(64);
  writeFileSync(join(dir, `${validId}.qtn`), 'valid-bytes', { mode: 0o600 });
  chmodSync(join(dir, `${validId}.qtn`), 0o600);
  // Publish the valid object's matching evidence (WP-8-F evidence shape).
  const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
  assert.equal(storeResult.ok, true);
  // The conflicting object's derived evidence record with MISMATCHED facts
  // (wrong source digest) → the committed scanner classifies the object as
  // quarantine-conflict (evidence present but conflicting).
  const conflictDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'conflict-bytes');
  const conflictEvidenceId = computeQuarantineEvidenceIdentity({ storeInstance: storeResult.storeInstance!, quarantineId: conflictId, sourceDigest: conflictDigest, outcome: 'quarantined' });
  const conflictEvidenceDerived = deriveRecordRelativePath('store-evidence-record', conflictEvidenceId);
  assert.equal(conflictEvidenceDerived.ok, true);
  const conflictPayload = {
    evidenceKind: 'recovery-evidence',
    recoveryOperation: 'quarantine-temporary',
    quarantineId: conflictId,
    targetEntry: 'pub-0000000000000000-0',
    sourceClassification: 'incomplete-unpublished',
    sourceDigest: 'sha-256:' + '9'.repeat(64),
    observationIds: ['obs-0000000000000000'],
    outcome: 'quarantined',
    generation: 'sha-256:' + '1'.repeat(64),
    surfaceGeneration: 'sha-256:' + '2'.repeat(64),
    destination: `temporary/bbbb/${conflictId}.qtn`,
    resultingState: { sourceRemoved: true, destinationIntact: true },
  };
  const conflictEvidenceModel = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId: conflictEvidenceId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: RECOVERY_ACTION,
    payload: conflictPayload,
    payloadDigest: computePayloadDigest(conflictPayload),
    referenceDigests: [conflictDigest],
    retentionClass: 'indefinite',
  };
  const conflictEvidencePath = join(env.storeRoot, conflictEvidenceDerived.relativePath);
  mkdirSync(conflictEvidencePath.slice(0, conflictEvidencePath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(conflictEvidencePath, canonicalEnvelopeBytes(conflictEvidenceModel).canonicalUtf8, { mode: 0o600 });
  chmodSync(conflictEvidencePath, 0o600);
  const validDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'valid-bytes');
  const evidenceId = computeQuarantineEvidenceIdentity({ storeInstance: storeResult.storeInstance!, quarantineId: validId, sourceDigest: validDigest, outcome: 'quarantined' });
  const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceId);
  assert.equal(evidenceDerived.ok, true);
  const evidencePayload = {
    evidenceKind: 'recovery-evidence',
    recoveryOperation: 'quarantine-temporary',
    quarantineId: validId,
    targetEntry: 'pub-0000000000000000-0',
    sourceClassification: 'incomplete-unpublished',
    sourceDigest: validDigest,
    observationIds: ['obs-0000000000000000'],
    outcome: 'quarantined',
    generation: 'sha-256:' + '1'.repeat(64),
    surfaceGeneration: 'sha-256:' + '2'.repeat(64),
    destination: `temporary/${validId.slice(0, 4)}/${validId}.qtn`,
    resultingState: { sourceRemoved: true, destinationIntact: true },
  };
  const evidenceModel = {
    recordKind: 'StoreEvidenceRecord',
    formatVersion: '1.0',
    recordId: evidenceId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: RECOVERY_ACTION,
    payload: evidencePayload,
    payloadDigest: computePayloadDigest(evidencePayload),
    referenceDigests: [validDigest],
    retentionClass: 'indefinite',
  };
  const evidencePath = join(env.storeRoot, evidenceDerived.relativePath);
  mkdirSync(evidencePath.slice(0, evidencePath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(evidencePath, canonicalEnvelopeBytes(evidenceModel).canonicalUtf8, { mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  return env;
}

/** Quarantine-object disposition facts for one exact entry. */
function quarantineFactsFor(env: TestEnv, shard: string, entry: string, classification: string): DispositionFacts {
  const expectedObservationId = quarantineObservationId(shard, entry);
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true);
  const finding = result.assessment!.requiresDisposition.find((d) => d.classification === classification && d.observationId === expectedObservationId);
  assert.ok(finding !== undefined, `the assessment must classify ${entry} as ${classification} (requires-external-disposition)`);
  return {
    observationId: finding.observationId,
    code: finding.code,
    generation: result.assessment!.source.generation,
    surfaceGeneration: result.assessment!.source.surfaceGeneration,
  };
}

function quarantineFacts(env: TestEnv, classification: string): DispositionFacts {
  const finding = dispositionFinding(env, classification);
  const tokens = currentTokens(env);
  return { ...finding, ...tokens };
}

function makeStoreWithConflictingIndex(): TestEnv {
  const env = makeStore();
  publish(env, RECORD_ID);
  // Rebuild the index (WP-8-H), then corrupt it into the conflicting state.
  const provenance = createRecoveryActionProvenance({
    actionIdentity: RECOVERY_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  // Registry-mode tokens (the index-rebuild request bindings; WP-8-H).
  const view = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(view.ok, true, JSON.stringify(view.findings));
  const rebuild = executeRecoveryMutation({
    trustedConfiguration: env.config,
    recoveryActionProvenance: provenance,
    trustedInput: env.trustedInput,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    action: {
      category: 'registry-index-rebuild',
      expectedRegistryGeneration: view.view!.source.generation,
      expectedRegistrySurfaceGeneration: view.view!.source.surfaceGeneration,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(rebuild.ok, true, JSON.stringify(rebuild.findings));
  const indexId = rebuild.indexId!;
  const indexPath = join(env.storeRoot, 'index', 'registry-index', indexId.slice(0, 4), `${indexId}.idx`);
  const good = readFileSync(indexPath, 'utf8');
  // Conflicting state (WP-8-H fixture): tamper an entry root with
  // canonical bytes and a supported model version (identity/root
  // re-digest fails; unsupported-version would be a different state).
  const model = JSON.parse(good) as Record<string, unknown>;
  const entries = model['entries'] as Array<Record<string, unknown>>;
  entries[0] = { ...entries[0]!, code: 'tampered' };
  model['entries'] = entries;
  writeFileSync(indexPath, jcsSerialize(model), { mode: 0o600 });
  chmodSync(indexPath, 0o600);
  // The recovery assessment must now classify the artifact as conflicting.
  const rescan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(rescan.ok, true);
  const artifact = rescan.assessment!.indexArtifacts.find((a) => a.classification === 'index-conflicting');
  assert.ok(artifact !== undefined, 'the corrupted index must classify as index-conflicting');
  return { ...env, originalIndexBytes: good };
}

function indexFacts(env: TestEnv): DispositionFacts & { readonly indexId: string; readonly shard: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true);
  const artifact = result.assessment!.indexArtifacts.find((a) => a.classification === 'index-conflicting');
  assert.ok(artifact !== undefined);
  const finding = result.assessment!.requiresDisposition.find((d) => d.classification === 'index-conflicting');
  assert.ok(finding !== undefined, 'index-conflicting must be a requires-external-disposition state');
  return {
    observationId: artifact.id,
    code: finding.code,
    generation: result.assessment!.source.generation,
    surfaceGeneration: result.assessment!.source.surfaceGeneration,
    indexId: artifact.indexId!,
    shard: artifact.shard,
  };
}

/**
 * Evidence builder import kept local to the fixture section.
 */

// ── Authority ──────────────────────────────────────────────────────────────

test('external-disposition: genuine exact disposition authority adjudicates unbound-digest requests as disposition-required', () => {
  // WPR-023 (d) symlink.
  const envD = makeStoreWithD('symlink');
  try {
    const facts = dFacts(envD, 'symlink');
    const result = executeRecoveryMutation(dispositionRequest(envD, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'disposition-required');
    // Untouched: still a symlink, no evidence, still classified (d).
    assert.equal(lstatSync(join(envD.storeRoot, 'tmp', D_TEMP)).isSymbolicLink(), true);
    const rescan = runRecoveryScan({ trustedConfiguration: envD.config, trustedInput: envD.trustedInput });
    assert.equal(rescan.assessment!.requiresDisposition.some((d) => d.classification === 'temporary-other'), true, 'the (d) target must remain requires-external-disposition');
    assert.equal(rescan.assessment!.orphanTemporaryObjects.some((o) => o.classification === 'temporary-other'), true);
  } finally {
    rmSync(envD.dir, { recursive: true, force: true });
  }
  // Quarantine malformed object.
  const envQ = makeStoreWithQuarantineClasses();
  try {
    const facts = quarantineFactsFor(envQ, 'abcd', 'nothex.qtn', 'quarantine-malformed');
    const result = executeRecoveryMutation(dispositionRequest(envQ, facts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'nothex.qtn',
      targetShard: 'abcd',
      expectedDispositionClassification: 'quarantine-malformed',
      expectedCode: facts.code,
    }));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'disposition-required');
    assert.equal(readFileSync(qtnPath(envQ, 'abcd', 'nothex.qtn'), 'utf8'), 'x', 'the malformed quarantine object must remain untouched');
  } finally {
    rmSync(envQ.dir, { recursive: true, force: true });
  }
  // Conflicting registry index.
  const envI = makeStoreWithConflictingIndex();
  try {
    const facts = indexFacts(envI);
    const result = executeRecoveryMutation(dispositionRequest(envI, facts, {
      category: 'dispose-conflicting-index',
      targetEntry: `${facts.indexId}.idx`,
      targetShard: facts.shard,
      expectedDispositionClassification: 'index-conflicting',
      expectedCode: 'ERR-STO-INTEGRITY',
    }));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'disposition-required');
    assert.equal(exists(join(envI.storeRoot, 'index', 'registry-index', facts.shard, `${facts.indexId}.idx`)), true, 'the conflicting index must remain untouched');
    // The authoritative registry remains fully usable (RGY-007).
    const view = deriveRegistryView({ trustedConfiguration: envI.config, trustedInput: envI.trustedInput });
    assert.equal(view.ok, true, JSON.stringify(view.findings));
    assert.ok(view.view!.recordsByIdentity[RECORD_ID] !== undefined, 'records remain the source of truth');
  } finally {
    rmSync(envI.dir, { recursive: true, force: true });
  }
});

test('external-disposition: wrong operation, reduced authority, and generic operations are rejected', () => {
  const env = makeStoreWithD('wrong-mode');
  try {
    const facts = dFacts(env, 'wrong-mode');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const provenance = createRecoveryActionProvenance({
      actionIdentity: RECOVERY_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: env.limitProfile,
    });
    const inputResult = createTrustedRecoveryRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(inputResult.ok, true);
    const full = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: storeResult.storeInstance! });
    assert.ok(full !== undefined);
    for (const op of ['dispose-wpr023d-temporary', 'dispose-quarantined-temporary', 'dispose-conflicting-index'] as const) {
      assert.equal(full!.verify(op).ok, true, `${op} must verify on the genuine authority`);
    }
    const orphanOnly = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: storeResult.storeInstance!, operationSet: ['orphan-removal'] });
    assert.ok(orphanOnly !== undefined);
    assert.equal(orphanOnly!.verify('dispose-wpr023d-temporary').ok, false, 'an orphan-only authority must never verify a disposition operation');
    assert.equal(orphanOnly!.verify('dispose-wpr023d-temporary').reason, 'wrong-operation');
    for (const op of ['disposition', 'delete-object', 'dispose-any', 'repair-storage', 'recovery-admin', 'filesystem-cleanup']) {
      assert.equal(full!.verify(op as never).ok, false, `the generic operation ${op} must not exist`);
    }
    // The generic 'disposition' category is rejected at the boundary.
    const generic = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'disposition' as never }));
    assert.equal(generic.ok, false);
    // A (d) target routed under the quarantine disposition operation fails
    // closed (exact surface/observation binding).
    const wrongSurface = executeRecoveryMutation(dispositionRequest(env, facts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: D_TEMP,
      targetShard: '',
      expectedDispositionClassification: 'foreign-entry',
      expectedCode: 'ERR-STO-MALFORMED',
    }));
    assert.equal(wrongSurface.ok, false);
    assert.equal(wrongSurface.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    full!.dispose();
    orphanOnly!.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: forged, cloned, wrong-store, and plan-derived requests are rejected', () => {
  const env = makeStoreWithD('symlink');
  try {
    const facts = dFacts(env, 'symlink');
    const base = dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' });
    const spreadClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: { ...(base.recoveryActionProvenance as object) } });
    assert.equal(spreadClone.ok, false);
    assert.equal(spreadClone.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    const jsonClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: JSON.parse(JSON.stringify(base.recoveryActionProvenance)) });
    assert.equal(jsonClone.ok, false);
    const wrongStore = executeRecoveryMutation({ ...base, locator: '/nonexistent' });
    assert.equal(wrongStore.ok, false);
    // A recovery plan action grants nothing: passing it as the action fails.
    const plan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput }).plan!;
    const planAsAction = executeRecoveryMutation({ ...base, action: plan.actions[0] as never });
    assert.equal(planAsAction.ok, false);
    // Wrong observation / finding bindings are rejected before any access.
    const wrongObs = executeRecoveryMutation({ ...base, action: { ...base.action, expectedObservationIds: ['obs-ffffffffffffffff'] } });
    assert.equal(wrongObs.ok, false);
    assert.equal(wrongObs.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    const wrongFinding = executeRecoveryMutation({ ...base, action: { ...base.action, expectedDispositionFindingId: 'obs-ffffffffffffffff' } });
    assert.equal(wrongFinding.ok, false);
    // Path operands are never accepted.
    const pathOperand = executeRecoveryMutation({ ...base, action: { ...base.action, targetEntry: '/tmp/evil' } });
    assert.equal(pathOperand.ok, false);
    // The target is untouched.
    assert.equal(lstatSync(join(env.storeRoot, "tmp", D_TEMP)).isSymbolicLink(), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Classification ─────────────────────────────────────────────────────────

test('external-disposition: automatic-recovery classes and valid records are rejected by disposition operations', () => {
  const env = makeStoreWithD('symlink');
  try {
    const facts = dFacts(env, 'symlink');
    // Automatic-recovery classes under the (d) operation: replace the
    // symlink with a WPR-023 (b) twin-like canonical temporary (nlink 1,
    // valid canonical bytes) — classification changed → fail closed.
    rmSync(join(env.storeRoot, 'tmp', D_TEMP));
    const canonicalTemp = canonicalEnvelopeBytes({
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId: 'pgw:r:33330000000000000000000000000003',
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: true },
      payloadDigest: computePayloadDigest({ approved: true }),
    }).canonicalUtf8;
    writeFileSync(join(env.storeRoot, 'tmp', D_TEMP), canonicalTemp, { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'tmp', D_TEMP), 0o600);
    const nowB = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }));
    assert.equal(nowB.ok, false);
    assert.equal(nowB.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(nowB.findings?.[0]?.message ?? '', /changed/);
    // Valid canonical records/audits are never disposition targets: record
    // and audit filenames fail every disposition surface grammar.
    const recordTarget = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', targetEntry: '11110000000000000000000000000001.rec', expectedEntryType: 'regular' }));
    assert.equal(recordTarget.ok, false);
    assert.equal(recordTarget.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    const lockTarget = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', targetEntry: 'writer.lock', expectedEntryType: 'regular' }));
    assert.equal(lockTarget.ok, false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: WPR-023 (d) variants stay distinct and changed states fail closed', () => {
  const env = makeStoreWithD('symlink');
  try {
    const facts = dFacts(env, 'symlink');
    // Wrong expected entry type: the current object is a symlink but the
    // request binds a regular file → fail closed.
    const wrongType = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'regular' }));
    assert.equal(wrongType.ok, false);
    assert.equal(wrongType.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Wrong expected code: bind PERM-DENIED for a symlink (FTYPE) → fail.
    const wrongCode = executeRecoveryMutation(dispositionRequest(env, { ...facts, code: 'ERR-STO-PERM-DENIED' }, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }));
    assert.equal(wrongCode.ok, false);
    assert.equal(wrongCode.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Directory variant: exact binding accepted under its own request.
    const envDir = makeStoreWithD('directory');
    try {
      const dirFacts = dFacts(envDir, 'directory');
      const dirResult = executeRecoveryMutation(dispositionRequest(envDir, dirFacts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'directory' }));
      assert.equal(dirResult.ok, true, JSON.stringify(dirResult.findings));
      assert.equal(dirResult.outcome, 'disposition-required');
      assert.equal(statSync(join(envDir.storeRoot, 'tmp', D_TEMP)).isDirectory(), true, 'the directory must remain untouched');
    } finally {
      rmSync(envDir.dir, { recursive: true, force: true });
    }
    // Target replaced by a different symlink target: entry type unchanged
    // but the object was replaced between assessment and execution — the
    // observation id/classification remain identical (a symlink is a
    // symlink), so the adjudication still reports disposition-required:
    // the WPR-023 (d) state is type-bound, not target-bound. Deletion is
    // the fail-closed case.
    rmSync(join(env.storeRoot, 'tmp', D_TEMP));
    const missing = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }));
    assert.equal(missing.ok, false);
    assert.equal(missing.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: quarantine disposition classes stay distinct; only the exact classification adjudicates', () => {
  const env = makeStoreWithQuarantineClasses();
  try {
    const shard = 'abcd';
    const cases: ReadonlyArray<{ readonly entry: string; readonly classification: string; readonly code: string; readonly expectOk: boolean }> = [
      { entry: 'nothex.qtn', classification: 'quarantine-malformed', code: 'ERR-STO-MALFORMED', expectOk: true },
      { entry: 'stray.txt', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', expectOk: true },
      { entry: 'b'.repeat(64) + '.qtn', classification: 'quarantine-conflict', code: 'ERR-STO-INTEGRITY', expectOk: true },
      { entry: 'e'.repeat(64) + '.qtn', classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', expectOk: true },
      { entry: 'd'.repeat(64) + '.qtn', classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', expectOk: true },
      { entry: 'f'.repeat(64) + '.qtn', classification: 'unexpected-hard-link', code: 'ERR-STO-INTEGRITY', expectOk: true },
    ];
    for (const c of cases) {
      const facts = quarantineFactsFor(env, shard, c.entry, c.classification);
      const result = executeRecoveryMutation(dispositionRequest(env, facts, {
        category: 'dispose-quarantined-temporary',
        targetEntry: c.entry,
        targetShard: shard,
        expectedDispositionClassification: c.classification,
        expectedCode: c.code,
      }));
      assert.equal(result.ok, true, `${c.classification}: ${JSON.stringify(result.findings)}`);
      assert.equal(result.outcome, 'disposition-required');
    }
    // A valid quarantined object with complete evidence is NOT disposable:
    // requesting a disposition classification on it fails closed with
    // classification changed (never accidentally disposed).
    const validEntry = 'a'.repeat(64) + '.qtn';
    const tokens = currentTokens(env);
    const validResult = executeRecoveryMutation(dispositionRequest(env, { observationId: quarantineObservationId(shard, validEntry), code: 'ERR-STO-MALFORMED', ...tokens }, {
      category: 'dispose-quarantined-temporary',
      targetEntry: validEntry,
      targetShard: shard,
      expectedDispositionClassification: 'quarantine-malformed',
      expectedCode: 'ERR-STO-MALFORMED',
    }));
    assert.equal(validResult.ok, false, 'a valid completed quarantine must never be disposable');
    assert.equal(validResult.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(validResult.findings?.[0]?.message ?? '', /classification changed/);
    // Cross-class requests fail closed: expecting malformed on the foreign
    // entry.
    const crossed = executeRecoveryMutation(dispositionRequest(env, quarantineFactsFor(env, shard, 'stray.txt', 'foreign-entry'), {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'stray.txt',
      targetShard: shard,
      expectedDispositionClassification: 'quarantine-malformed',
      expectedCode: 'ERR-STO-MALFORMED',
    }));
    assert.equal(crossed.ok, false);
    assert.equal(crossed.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // quarantined-missing-evidence is NOT in the disposition vocabulary
    // (it is a roll-forward state, never a disposition class).
    const missingEntry = 'f'.repeat(64) + '.qtn';
    const missingEvidence = executeRecoveryMutation(dispositionRequest(env, {
      observationId: quarantineObservationId(shard, missingEntry),
      code: 'ERR-STO-INTEGRITY',
      generation: currentTokens(env).generation,
      surfaceGeneration: currentTokens(env).surfaceGeneration,
    }, {
      category: 'dispose-quarantined-temporary',
      targetEntry: missingEntry,
      targetShard: shard,
      expectedDispositionClassification: 'quarantined-missing-evidence',
      expectedCode: 'ERR-STO-INTEGRITY',
    }));
    assert.equal(missingEvidence.ok, false);
    assert.equal(missingEvidence.findings?.[0]?.code, 'ERR-STO-REQ-INVALID', 'missing-evidence is a roll-forward state, never a disposition class');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: quarantine content digest binding and replacement rejection', () => {
  const env = makeStoreWithQuarantineClasses();
  try {
    // unexpected-hard-link carries a content digest in the committed
    // observation; bind it exactly.
    const linkFacts = quarantineFacts(env, 'unexpected-hard-link');
    const linkDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'link-bytes');
    const ok = executeRecoveryMutation(dispositionRequest(env, linkFacts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'f'.repeat(64) + '.qtn',
      targetShard: 'abcd',
      expectedDispositionClassification: 'unexpected-hard-link',
      expectedCode: 'ERR-STO-INTEGRITY',
      expectedContentDigest: linkDigest,
    }));
    assert.equal(ok.ok, true, JSON.stringify(ok.findings));
    // Wrong digest binding fails closed.
    const wrongDigest = executeRecoveryMutation(dispositionRequest(env, linkFacts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'f'.repeat(64) + '.qtn',
      targetShard: 'abcd',
      expectedDispositionClassification: 'unexpected-hard-link',
      expectedCode: 'ERR-STO-INTEGRITY',
      expectedContentDigest: 'sha-256:' + '9'.repeat(64),
    }));
    assert.equal(wrongDigest.ok, false);
    assert.equal(wrongDigest.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(wrongDigest.findings?.[0]?.message ?? '', /digest changed/);
    // Replacement: change the conflicting object's bytes → the evidence
    // mismatch persists (still quarantine-conflict) but the content digest
    // is not bound for that class here; instead replace with bytes that
    // make the evidence match → quarantined-valid → classification changed.
    const conflictPath = qtnPath(env, 'abcd', 'b'.repeat(64) + '.qtn');
    const conflictBytes = 'conflict-bytes';
    const conflictDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, conflictBytes);
    void conflictPath;
    // Replace the conflicting object with a valid one whose derived
    // evidence id matches the EXISTING mismatched evidence? No — instead
    // publish matching evidence for the current bytes, flipping the
    // classification to quarantined-valid.
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const conflictEvidenceId = computeQuarantineEvidenceIdentity({ storeInstance: storeResult.storeInstance!, quarantineId: 'b'.repeat(64), sourceDigest: conflictDigest, outcome: 'quarantined' });
    const conflictEvidenceDerived = deriveRecordRelativePath('store-evidence-record', conflictEvidenceId);
    assert.equal(conflictEvidenceDerived.ok, true);
    const conflictPayload = {
      evidenceKind: 'recovery-evidence',
      recoveryOperation: 'quarantine-temporary',
      quarantineId: 'b'.repeat(64),
      targetEntry: 'pub-0000000000000000-0',
      sourceClassification: 'incomplete-unpublished',
      sourceDigest: conflictDigest,
      observationIds: ['obs-0000000000000000'],
      outcome: 'quarantined',
      generation: 'sha-256:' + '1'.repeat(64),
      surfaceGeneration: 'sha-256:' + '2'.repeat(64),
      destination: `temporary/bbbb/${'b'.repeat(64)}.qtn`,
      resultingState: { sourceRemoved: true, destinationIntact: true },
    };
    const conflictEvidenceModel = {
      recordKind: 'StoreEvidenceRecord',
      formatVersion: '1.0',
      recordId: conflictEvidenceId,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: RECOVERY_ACTION,
      payload: conflictPayload,
      payloadDigest: computePayloadDigest(conflictPayload),
      referenceDigests: [conflictDigest],
      retentionClass: 'indefinite',
    };
    const conflictEvidencePath = join(env.storeRoot, conflictEvidenceDerived.relativePath);
    mkdirSync(conflictEvidencePath.slice(0, conflictEvidencePath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(conflictEvidencePath, canonicalEnvelopeBytes(conflictEvidenceModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(conflictEvidencePath, 0o600);
    const conflictFacts = { observationId: quarantineObservationId('abcd', 'b'.repeat(64) + '.qtn'), code: 'ERR-STO-INTEGRITY', ...currentTokens(env) };
    const nowValid = executeRecoveryMutation(dispositionRequest(env, conflictFacts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'b'.repeat(64) + '.qtn',
      targetShard: 'abcd',
      expectedDispositionClassification: 'quarantine-conflict',
      expectedCode: 'ERR-STO-INTEGRITY',
      expectedContentDigest: conflictDigest,
    }));
    assert.equal(nowValid.ok, false, 'the object is now quarantined-valid; disposition must fail closed');
    assert.equal(nowValid.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Index ──────────────────────────────────────────────────────────────────

test('external-disposition: conflicting index recognized; registry stays authoritative; no deletion', () => {
  const env = makeStoreWithConflictingIndex();
  try {
    const facts = indexFacts(env);
    // Rebuild still fails closed against the conflicting artifact (WP-8-H).
    const provenance = createRecoveryActionProvenance({
      actionIdentity: RECOVERY_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: env.limitProfile,
    });
    const view = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(view.ok, true);
    const rebuild = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: provenance,
      trustedInput: env.trustedInput,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      action: { category: 'registry-index-rebuild', expectedRegistryGeneration: view.view!.source.generation, expectedRegistrySurfaceGeneration: view.view!.source.surfaceGeneration },
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(rebuild.ok, false);
    assert.match(rebuild.findings?.[0]?.message ?? '', /conflicting registry-index/);
    // The disposition adjudication recognizes the exact state.
    const result = executeRecoveryMutation(dispositionRequest(env, facts, {
      category: 'dispose-conflicting-index',
      targetEntry: `${facts.indexId}.idx`,
      targetShard: facts.shard,
      expectedDispositionClassification: 'index-conflicting',
      expectedCode: 'ERR-STO-INTEGRITY',
    }));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'disposition-required');
    // The fast path reports the conflicting state and falls back to the
    // authoritative derivation; records stay fully readable.
    const fastView = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
    assert.equal(fastView.ok, true, JSON.stringify(fastView.findings));
    assert.equal(fastView.indexState, 'conflicting-index');
    assert.ok(fastView.view!.recordsByIdentity[RECORD_ID] !== undefined);
    // Nothing was deleted: exactly one index artifact remains.
    const indexFiles = readdirSync(join(env.storeRoot, 'index', 'registry-index', facts.shard)).filter((e) => e.endsWith('.idx'));
    assert.deepEqual(indexFiles, [`${facts.indexId}.idx`]);
    // A self-consistent (current-valid) index is NOT disposition-required.
    const indexPath = join(env.storeRoot, 'index', 'registry-index', facts.shard, `${facts.indexId}.idx`);
    writeFileSync(indexPath, env.originalIndexBytes!, { mode: 0o600 });
    chmodSync(indexPath, 0o600);
    const tokens = currentTokens(env);
    const restored = executeRecoveryMutation(dispositionRequest(env, { ...facts, ...tokens }, {
      category: 'dispose-conflicting-index',
      targetEntry: `${facts.indexId}.idx`,
      targetShard: facts.shard,
      expectedDispositionClassification: 'index-conflicting',
      expectedCode: 'ERR-STO-INTEGRITY',
    }));
    assert.equal(restored.ok, false, 'a self-consistent index must never be disposition-required');
    assert.equal(restored.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Mutation safety / postcondition ────────────────────────────────────────

test('external-disposition: no mutation, no evidence, no raw path, deterministic replay', () => {
  const env = makeStoreWithD('wrong-mode');
  try {
    const facts = dFacts(env, 'wrong-mode');
    const before = readFileSync(join(env.storeRoot, 'tmp', D_TEMP), 'utf8');
    const evidenceCountBefore = countFiles(join(env.storeRoot, 'records', 'evidence'));
    const first = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'regular' }));
    assert.equal(first.ok, true);
    assert.ok(!JSON.stringify(first).includes(env.dir), 'the result must not disclose raw paths');
    // Replay is deterministic.
    const second = executeRecoveryMutation(dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'regular' }));
    assert.equal(second.ok, true);
    assert.equal(second.outcome, 'disposition-required');
    assert.equal(first.outcome, second.outcome);
    // Postcondition: the object is byte-identical; no evidence was created;
    // no new files anywhere on the target surfaces.
    assert.equal(readFileSync(join(env.storeRoot, 'tmp', D_TEMP), 'utf8'), before, 'the target must be byte-identical');
    assert.equal(countFiles(join(env.storeRoot, 'records', 'evidence')), evidenceCountBefore, 'no disposition evidence may be created');
    assert.equal(countFiles(join(env.storeRoot, 'audit', 'audit-event')), 1, 'no audit events may be created');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

function countFiles(dir: string): number {
  if (!exists(dir)) return 0;
  let n = 0;
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else n++;
    }
  };
  walk(dir);
  return n;
}

// ── Crash stages ───────────────────────────────────────────────────────────

/** Fixed external-disposition adjudication stage inventory (WP-8-I §11). */
const DISPOSITION_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-lock-acquisition',
  'after-lock-acquisition',
  'after-target-verification',
  'after-classification-recomputation',
  'before-lock-release',
];

test('external-disposition: the fixed stage inventory is asserted', () => {
  const env = makeStoreWithD('symlink');
  try {
    const facts = dFacts(env, 'symlink');
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({
      ...dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }),
      hooks: { stage: (s) => seen.push(s) },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, DISPOSITION_CRASH_STAGES, 'the fixed external-disposition stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: a crash at every stage leaves a classifiable state and a safe fresh rerun', () => {
  for (const stage of DISPOSITION_CRASH_STAGES) {
    const env = makeStoreWithD('symlink');
    try {
      const facts = dFacts(env, 'symlink');
      let crashed = false;
      try {
        executeRecoveryMutation({
          ...dispositionRequest(env, facts, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }),
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
      // The target is untouched and no evidence was created.
      assert.equal(lstatSync(join(env.storeRoot, "tmp", D_TEMP)).isSymbolicLink(), true, `${stage}: the (d) target must remain untouched`);
      assert.equal(countFiles(join(env.storeRoot, 'records', 'evidence')), 0, `${stage}: no evidence may be created`);
      // The scanner still classifies the state deterministically.
      const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
      assert.equal(scanAfterCrash.assessment!.requiresDisposition.some((d) => d.classification === 'temporary-other'), true, `${stage}: the state must remain requires-external-disposition`);
      // Held crash locks fail closed (stale-lock breaking is out of scope);
      // the test releases the crash lock as a fixture step.
      const lockPresent = exists(join(env.storeRoot, 'locks', 'writer.lock'));
      if (stage !== 'before-lock-acquisition') {
        assert.equal(lockPresent, true, `crash at ${stage} leaves the writer lock`);
        const lockedScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
        const locked = executeRecoveryMutation(dispositionRequest(env, { ...facts, generation: lockedScan.assessment!.source.generation, surfaceGeneration: lockedScan.assessment!.source.surfaceGeneration }, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }));
        assert.equal(locked.ok, false);
        assert.equal(locked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
        rmSync(join(env.storeRoot, 'locks', 'writer.lock'));
      }
      // Fresh rerun with fresh assessment tokens: deterministic
      // disposition-required, no mutation.
      const rerunScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      const rerun = executeRecoveryMutation(dispositionRequest(env, { ...facts, generation: rerunScan.assessment!.source.generation, surfaceGeneration: rerunScan.assessment!.source.surfaceGeneration }, { category: 'dispose-wpr023d-temporary', expectedEntryType: 'symlink' }));
      assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
      assert.equal(rerun.outcome, 'disposition-required');
      assert.equal(lstatSync(join(env.storeRoot, "tmp", D_TEMP)).isSymbolicLink(), true, `${stage}: the target must still be untouched after the rerun`);
      assert.equal(exists(join(env.storeRoot, 'locks', 'writer.lock')), false, `${stage}: the lock must be released`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

// ── WPR-023 (d) preservation (ADR-032 §A) ─────────────────────────────────

test('external-disposition: WPR-023 (d) remains adjudication-only for regular, symlink, and directory targets', () => {
  for (const entryType of ['symlink', 'directory', 'wrong-mode'] as const) {
    const env = makeStoreWithD(entryType);
    try {
      const finding = dispositionFinding(env, 'temporary-other');
      const tokens = currentTokens(env);
      const expectedEntryType = entryType === 'wrong-mode' ? 'regular' : entryType;
      // The (d) flow performs no mutation and no evidence: fsync hooks must
      // only ever see the locks directory (lock acquisition), never a
      // surface directory.
      const fsynced: string[] = [];
      const result = executeRecoveryMutation({
        ...dispositionRequest(env, { ...finding, ...tokens }, {
          category: 'dispose-wpr023d-temporary',
          targetEntry: D_TEMP,
          expectedDispositionClassification: 'temporary-other',
          expectedCode: finding.code,
          expectedEntryType,
        }),
        hooks: { fsyncDirectory: (p) => fsynced.push(p) },
      });
      assert.equal(result.ok, true, `${entryType}: ${JSON.stringify(result.findings)}`);
      assert.equal(result.outcome, 'disposition-required', `${entryType} must remain adjudication-only`);
      assert.ok(fsynced.every((p) => p.endsWith('/locks')), `${entryType}: no surface directory may be fsynced: ${JSON.stringify(fsynced)}`);
      // Untouched and still requires disposition.
      const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scan.assessment!.requiresDisposition.some((d) => d.classification === 'temporary-other'), true, `${entryType}: must remain requires-external-disposition`);
      assert.equal(countFiles(join(env.storeRoot, 'records', 'evidence')), 0, `${entryType}: no disposition evidence may exist`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

// ── Executable quarantine disposition (ADR-032 §B) ─────────────────────────

test('external-disposition: eligible quarantine regular files are disposed with durable evidence', () => {
  const env = makeStoreWithQuarantineClasses();
  try {
    const shard = 'abcd';
    const cases: ReadonlyArray<{ readonly entry: string; readonly classification: string; readonly code: string; readonly bytes: string }> = [
      { entry: 'nothex.qtn', classification: 'quarantine-malformed', code: 'ERR-STO-MALFORMED', bytes: 'x' },
      { entry: 'stray.txt', classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', bytes: 'x' },
      { entry: 'b'.repeat(64) + '.qtn', classification: 'quarantine-conflict', code: 'ERR-STO-INTEGRITY', bytes: 'conflict-bytes' },
    ];
    for (const c of cases) {
      const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, c.bytes);
      const facts = quarantineFactsFor(env, shard, c.entry, c.classification);
      const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
      assert.equal(storeResult.ok, true);
      const evidenceId = computeDispositionEvidenceIdentity({
        storeInstance: storeResult.storeInstance!,
        evidenceKind: 'recovery-evidence',
        recoveryOperation: 'dispose-quarantined-temporary',
        targetEntry: c.entry,
        targetShard: shard,
        targetClassification: c.classification,
        targetDigest: digest,
        observationId: facts.observationId,
        outcome: 'disposed',
      });
      const result = executeRecoveryMutation(dispositionRequest(env, facts, {
        category: 'dispose-quarantined-temporary',
        targetEntry: c.entry,
        targetShard: shard,
        expectedDispositionClassification: c.classification,
        expectedCode: c.code,
        expectedContentDigest: digest,
      }));
      assert.equal(result.ok, true, `${c.classification}: ${JSON.stringify(result.findings)}`);
      assert.equal(result.outcome, 'disposed', `${c.classification} must be disposed`);
      assert.equal(result.evidenceId, evidenceId, `${c.classification}: deterministic evidence identity`);
      assert.equal(exists(qtnPath(env, shard, c.entry)), false, `${c.classification}: the target must be unlinked`);
      // Durable evidence with the existing recovery-evidence kind.
      const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceId);
      assert.equal(evidenceDerived.ok, true);
      const rawEvidence = readFileSync(join(env.storeRoot, evidenceDerived.relativePath), 'utf8');
      const evidenceModel = JSON.parse(rawEvidence) as Record<string, unknown>;
      const payload = evidenceModel['payload'] as Record<string, unknown>;
      assert.equal(evidenceModel['recordKind'], 'StoreEvidenceRecord');
      assert.equal(payload['evidenceKind'], 'recovery-evidence', 'no new evidence kind may exist');
      assert.equal(payload['recoveryOperation'], 'dispose-quarantined-temporary');
      assert.equal(payload['targetClassification'], c.classification);
      assert.equal(payload['targetDigest'], digest);
      assert.equal(payload['targetEntry'], c.entry);
      assert.equal(payload['outcome'], 'disposed');
      assert.deepEqual(payload['resultingState'], { targetRemoved: true });
      assert.ok(!rawEvidence.includes(env.dir), 'evidence must not contain raw paths');
      // Scanner: completed disposition.
      const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scan.assessment!.dispositionStates.some((s) => s.state === 'completed-disposition' && s.recoveryOperation === 'dispose-quarantined-temporary'), true);
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: quarantine executable eligibility is exact; changed targets fail closed', () => {
  const env = makeStoreWithQuarantineClasses();
  try {
    const shard = 'abcd';
    // Hard-linked malformed file (nlink 2): not executable → adjudication.
    // Non-hex names so the objects classify as quarantine-malformed by name
    // while carrying nlink 2 from the descriptor read.
    const linkedName = 'nope2.qtn';
    writeFileSync(qtnPath(env, shard, linkedName), 'z', { mode: 0o600 });
    chmodSync(qtnPath(env, shard, linkedName), 0o600);
    linkSync(qtnPath(env, shard, linkedName), qtnPath(env, shard, 'nope3.qtn'));
    const linkedFacts = quarantineFactsFor(env, shard, linkedName, 'quarantine-malformed');
    const linkedResult = executeRecoveryMutation(dispositionRequest(env, { ...linkedFacts, observationId: quarantineObservationId(shard, linkedName) }, {
      category: 'dispose-quarantined-temporary',
      targetEntry: linkedName,
      targetShard: shard,
      expectedDispositionClassification: 'quarantine-malformed',
      expectedCode: 'ERR-STO-MALFORMED',
      expectedContentDigest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'z'),
    }));
    assert.equal(linkedResult.ok, true, JSON.stringify(linkedResult.findings));
    assert.equal(linkedResult.outcome, 'disposition-required', 'a hard-linked malformed file must remain adjudication-only');
    assert.equal(exists(qtnPath(env, shard, linkedName)), true);
    // Wrong-mode foreign file (0644): unreadable under policy → no digest →
    // adjudication-only.
    const modeName = 'modebad.qtn';
    writeFileSync(qtnPath(env, shard, modeName), 'm', { mode: 0o644 });
    chmodSync(qtnPath(env, shard, modeName), 0o644);
    const modeFacts = quarantineFactsFor(env, shard, modeName, 'quarantine-malformed');
    const modeResult = executeRecoveryMutation(dispositionRequest(env, { ...modeFacts, observationId: quarantineObservationId(shard, modeName) }, {
      category: 'dispose-quarantined-temporary',
      targetEntry: modeName,
      targetShard: shard,
      expectedDispositionClassification: 'quarantine-malformed',
      expectedCode: 'ERR-STO-MALFORMED',
    }));
    assert.equal(modeResult.ok, true, JSON.stringify(modeResult.findings));
    assert.equal(modeResult.outcome, 'disposition-required', 'a wrong-mode object must remain adjudication-only');
    // Digest mismatch → fail closed.
    const foreignFacts = quarantineFactsFor(env, shard, 'stray.txt', 'foreign-entry');
    const wrongDigest = executeRecoveryMutation(dispositionRequest(env, foreignFacts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'stray.txt',
      targetShard: shard,
      expectedDispositionClassification: 'foreign-entry',
      expectedCode: 'ERR-STO-MALFORMED',
      expectedContentDigest: 'sha-256:' + '9'.repeat(64),
    }));
    assert.equal(wrongDigest.ok, false);
    assert.equal(wrongDigest.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Symlink replacement after the assessment: fail closed (no longer a
    // readable policy-compliant object).
    const strayPath = qtnPath(env, shard, 'stray.txt');
    rmSync(strayPath);
    symlinkSync('/nonexistent-disposition-target', strayPath);
    const symlinkResult = executeRecoveryMutation(dispositionRequest(env, foreignFacts, {
      category: 'dispose-quarantined-temporary',
      targetEntry: 'stray.txt',
      targetShard: shard,
      expectedDispositionClassification: 'foreign-entry',
      expectedCode: 'ERR-STO-MALFORMED',
      expectedContentDigest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'x'),
    }));
    assert.equal(symlinkResult.ok, false, 'a symlink replacement must fail closed');
    assert.equal(symlinkResult.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.equal(lstatSync(strayPath).isSymbolicLink(), true, 'the symlink must remain untouched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: quarantine idempotency and evidence states (already-completed, no-evidence, live-target, conflict)', () => {
  const env = makeStoreWithQuarantineClasses();
  try {
    const shard = 'abcd';
    const entry = 'nothex.qtn';
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'x');
    const facts = quarantineFactsFor(env, shard, entry, 'quarantine-malformed');
    const request = (overrides: Partial<RecoveryMutationRequest['action']> = {}): RecoveryMutationRequest =>
      dispositionRequest(env, { ...facts, observationId: quarantineObservationId(shard, entry) }, {
        category: 'dispose-quarantined-temporary',
        targetEntry: entry,
        targetShard: shard,
        expectedDispositionClassification: 'quarantine-malformed',
        expectedCode: 'ERR-STO-MALFORMED',
        expectedContentDigest: digest,
        ...overrides,
      });
    const first = executeRecoveryMutation(request());
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    assert.equal(first.outcome, 'disposed');
    // TARGET ABSENT + MATCHING EVIDENCE → already-completed.
    const tokens = currentTokens(env);
    const rerun = executeRecoveryMutation(request({ expectedGeneration: tokens.generation, expectedSurfaceGeneration: tokens.surfaceGeneration }));
    assert.equal(rerun.ok, true, JSON.stringify(rerun.findings));
    assert.equal(rerun.outcome, 'already-completed');
    assert.equal(rerun.evidenceId, first.evidenceId);
    // TARGET ABSENT + NO EVIDENCE → fail closed (no inference): a target
    // that was never disposed, then manually removed.
    const neverEntry = 'neverbad.qtn';
    writeFileSync(qtnPath(env, shard, neverEntry), 'n', { mode: 0o600 });
    chmodSync(qtnPath(env, shard, neverEntry), 0o600);
    const neverFacts = quarantineFactsFor(env, shard, neverEntry, 'quarantine-malformed');
    const neverDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'n');
    rmSync(qtnPath(env, shard, neverEntry));
    const tokens3 = currentTokens(env);
    const absent = executeRecoveryMutation(dispositionRequest(env, { ...neverFacts, observationId: quarantineObservationId(shard, neverEntry) }, {
      category: 'dispose-quarantined-temporary',
      targetEntry: neverEntry,
      targetShard: shard,
      expectedDispositionClassification: 'quarantine-malformed',
      expectedCode: 'ERR-STO-MALFORMED',
      expectedContentDigest: neverDigest,
      expectedGeneration: tokens3.generation,
      expectedSurfaceGeneration: tokens3.surfaceGeneration,
    }));
    assert.equal(absent.ok, false, 'target absent without evidence must fail closed');
    assert.equal(absent.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
    // EVIDENCE PRESENT + TARGET STILL EXISTS → fail closed (integrity).
    writeFileSync(qtnPath(env, shard, entry), 'x', { mode: 0o600 });
    chmodSync(qtnPath(env, shard, entry), 0o600);
    const tokens4 = currentTokens(env);
    const liveTarget = executeRecoveryMutation(request({ expectedGeneration: tokens4.generation, expectedSurfaceGeneration: tokens4.surfaceGeneration }));
    assert.equal(liveTarget.ok, false, 'evidence with a live target must fail closed');
    assert.equal(liveTarget.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(liveTarget.findings?.[0]?.message ?? '', /evidence exists while the target is still present/);
    // CONFLICTING EVIDENCE → fail closed.
    rmSync(qtnPath(env, shard, entry));
    const evidenceId = first.evidenceId!;
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceId);
    assert.equal(evidenceDerived.ok, true);
    const evidenceFile = join(env.storeRoot, evidenceDerived.relativePath);
    const evidenceModel = JSON.parse(readFileSync(evidenceFile, 'utf8')) as Record<string, unknown>;
    const payload = evidenceModel['payload'] as Record<string, unknown>;
    payload['targetEntry'] = 'tampered-entry';
    evidenceModel['payload'] = payload;
    evidenceModel['payloadDigest'] = computePayloadDigest(payload);
    writeFileSync(evidenceFile, canonicalEnvelopeBytes(evidenceModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(evidenceFile, 0o600);
    const tokens5 = currentTokens(env);
    const conflicting = executeRecoveryMutation(request({ expectedGeneration: tokens5.generation, expectedSurfaceGeneration: tokens5.surfaceGeneration }));
    assert.equal(conflicting.ok, false, 'conflicting evidence must fail closed');
    assert.equal(conflicting.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Executable conflicting-index disposition (ADR-032 §C) ──────────────────

test('external-disposition: the exact conflicting index artifact is disposed; historical and unrelated artifacts remain; rebuild succeeds', () => {
  const env = makeStoreWithConflictingIndex();
  try {
    const facts = indexFacts(env);
    const indexPath = join(env.storeRoot, 'index', 'registry-index', facts.shard, `${facts.indexId}.idx`);
    const tampered = readFileSync(indexPath, 'utf8');
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, tampered);
    // A stale historical index (older derived identity) and a foreign entry
    // must never be selected.
    const staleIndex = join(env.storeRoot, 'index', 'registry-index', facts.shard, `${'0'.repeat(32)}.idx`);
    writeFileSync(staleIndex, tampered, { mode: 0o600 });
    chmodSync(staleIndex, 0o600);
    writeFileSync(join(env.storeRoot, 'index', 'registry-index', facts.shard, 'stray.txt'), 'x', { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'index', 'registry-index', facts.shard, 'stray.txt'), 0o600);
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const evidenceId = computeDispositionEvidenceIdentity({
      storeInstance: storeResult.storeInstance!,
      evidenceKind: 'recovery-evidence',
      recoveryOperation: 'dispose-conflicting-index',
      targetEntry: `${facts.indexId}.idx`,
      targetIndexId: facts.indexId,
      targetClassification: 'index-conflicting',
      targetDigest: digest,
      observationId: facts.observationId,
      outcome: 'disposed',
    });
    const result = executeRecoveryMutation(dispositionRequest(env, facts, {
      category: 'dispose-conflicting-index',
      targetEntry: `${facts.indexId}.idx`,
      targetShard: facts.shard,
      expectedDispositionClassification: 'index-conflicting',
      expectedCode: 'ERR-STO-INTEGRITY',
      expectedContentDigest: digest,
    }));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'disposed');
    assert.equal(result.evidenceId, evidenceId);
    assert.equal(exists(indexPath), false, 'the exact conflicting artifact must be unlinked');
    assert.equal(exists(staleIndex), true, 'stale historical indexes must never be deleted');
    assert.equal(exists(join(env.storeRoot, 'index', 'registry-index', facts.shard, 'stray.txt')), true, 'unrelated foreign entries must never be deleted');
    // Authoritative registry remains usable; the fast path falls back.
    const view = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput, usePersistentIndex: true });
    assert.equal(view.ok, true);
    assert.ok(view.view!.recordsByIdentity[RECORD_ID] !== undefined);
    // Rebuild succeeds afterward (disposition does not auto-rebuild).
    const registry = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(registry.ok, true);
    const provenance = createRecoveryActionProvenance({
      actionIdentity: RECOVERY_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: env.limitProfile,
    });
    const rebuild = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: provenance,
      trustedInput: env.trustedInput,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      action: { category: 'registry-index-rebuild', expectedRegistryGeneration: registry.view!.source.generation, expectedRegistrySurfaceGeneration: registry.view!.source.surfaceGeneration },
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(rebuild.ok, true, JSON.stringify(rebuild.findings));
    assert.equal(rebuild.outcome, 'rebuilt');
    // The scanner reports the completed disposition (post-rebuild
    // coexistence with a current-valid index is not a conflict).
    const finalScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(finalScan.assessment!.dispositionStates.some((s) => s.state === 'completed-disposition' && s.recoveryOperation === 'dispose-conflicting-index'), true);
    assert.equal(finalScan.assessment!.indexArtifacts.some((a) => a.classification === 'index-current-valid'), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('external-disposition: index idempotency and evidence states', () => {
  const env = makeStoreWithConflictingIndex();
  try {
    const facts = indexFacts(env);
    const indexPath = join(env.storeRoot, 'index', 'registry-index', facts.shard, `${facts.indexId}.idx`);
    const tampered = readFileSync(indexPath, 'utf8');
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, tampered);
    const request = (overrides: Partial<RecoveryMutationRequest['action']> = {}): RecoveryMutationRequest =>
      dispositionRequest(env, { ...facts, ...currentTokens(env) }, {
        category: 'dispose-conflicting-index',
        targetEntry: `${facts.indexId}.idx`,
        targetShard: facts.shard,
        expectedDispositionClassification: 'index-conflicting',
        expectedCode: 'ERR-STO-INTEGRITY',
        expectedContentDigest: digest,
        ...overrides,
      });
    const first = executeRecoveryMutation(request());
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    assert.equal(first.outcome, 'disposed');
    // Target absent + matching evidence → already-completed.
    const rerun = executeRecoveryMutation(request());
    assert.equal(rerun.ok, true, JSON.stringify(rerun.findings));
    assert.equal(rerun.outcome, 'already-completed');
    // Evidence-with-live-target: re-create the conflicting artifact at the
    // derived identity → fail closed (integrity inconsistency).
    writeFileSync(indexPath, tampered, { mode: 0o600 });
    chmodSync(indexPath, 0o600);
    const liveTarget = executeRecoveryMutation(request());
    assert.equal(liveTarget.ok, false);
    assert.equal(liveTarget.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(liveTarget.findings?.[0]?.message ?? '', /evidence exists while the target is still present/);
    // Remove it again; tamper the evidence facts → conflicting evidence.
    rmSync(indexPath);
    const evidenceId = first.evidenceId!;
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', evidenceId);
    assert.equal(evidenceDerived.ok, true);
    const evidenceFile = join(env.storeRoot, evidenceDerived.relativePath);
    const evidenceModel = JSON.parse(readFileSync(evidenceFile, 'utf8')) as Record<string, unknown>;
    const payload = evidenceModel['payload'] as Record<string, unknown>;
    payload['targetIndexId'] = 'f'.repeat(32);
    evidenceModel['payload'] = payload;
    evidenceModel['payloadDigest'] = computePayloadDigest(payload);
    writeFileSync(evidenceFile, canonicalEnvelopeBytes(evidenceModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(evidenceFile, 0o600);
    const conflicting = executeRecoveryMutation(request());
    assert.equal(conflicting.ok, false, 'conflicting evidence must fail closed');
    assert.equal(conflicting.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Executable crash inventories (ADR-032 §9) ──────────────────────────────

/** Fixed executable-disposition crash-stage inventory (ADR-032 §9). */
const EXECUTABLE_DISPOSITION_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-lock-acquisition',
  'after-lock-acquisition',
  'after-target-verification',
  'after-classification-recomputation',
  'before-unlink',
  'after-unlink',
  'before-directory-fsync',
  'after-directory-fsync',
  'before-evidence-publication',
  'after-evidence-publication',
  'after-evidence-audit-publication',
  'before-lock-release',
];

test('external-disposition: the executable 12-stage crash inventory is asserted for quarantine and index', () => {
  // Quarantine.
  const envQ = makeStoreWithQuarantineClasses();
  try {
    const shard = 'abcd';
    const entry = 'nothex.qtn';
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'x');
    const facts = quarantineFactsFor(envQ, shard, entry, 'quarantine-malformed');
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({
      ...dispositionRequest(envQ, { ...facts, observationId: quarantineObservationId(shard, entry) }, {
        category: 'dispose-quarantined-temporary',
        targetEntry: entry,
        targetShard: shard,
        expectedDispositionClassification: 'quarantine-malformed',
        expectedCode: 'ERR-STO-MALFORMED',
        expectedContentDigest: digest,
      }),
      hooks: { stage: (s) => seen.push(s) },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, EXECUTABLE_DISPOSITION_CRASH_STAGES, 'the fixed executable-disposition crash inventory must be exercised in order');
  } finally {
    rmSync(envQ.dir, { recursive: true, force: true });
  }
  // Index.
  const envI = makeStoreWithConflictingIndex();
  try {
    const facts = indexFacts(envI);
    const indexPath = join(envI.storeRoot, 'index', 'registry-index', facts.shard, `${facts.indexId}.idx`);
    const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, readFileSync(indexPath, 'utf8'));
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({
      ...dispositionRequest(envI, facts, {
        category: 'dispose-conflicting-index',
        targetEntry: `${facts.indexId}.idx`,
        targetShard: facts.shard,
        expectedDispositionClassification: 'index-conflicting',
        expectedCode: 'ERR-STO-INTEGRITY',
        expectedContentDigest: digest,
      }),
      hooks: { stage: (s) => seen.push(s) },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, EXECUTABLE_DISPOSITION_CRASH_STAGES);
  } finally {
    rmSync(envI.dir, { recursive: true, force: true });
  }
});

test('external-disposition: a crash at every executable stage leaves a classifiable state and a safe fresh rerun', () => {
  for (const surface of ['quarantine', 'index'] as const) {
    for (const stage of EXECUTABLE_DISPOSITION_CRASH_STAGES) {
      const env = surface === 'quarantine' ? makeStoreWithQuarantineClasses() : makeStoreWithConflictingIndex();
      try {
        const shard = 'abcd';
        const indexFactSet = surface === 'index' ? indexFacts(env) : undefined;
        const entry = surface === 'quarantine' ? 'nothex.qtn' : (indexFactSet!.indexId + '.idx');
        const indexShard = indexFactSet?.shard ?? shard;
        const facts: DispositionFacts = surface === 'quarantine' ? quarantineFactsFor(env, shard, entry, 'quarantine-malformed') : { ...indexFactSet! };
        const digest =
          surface === 'quarantine'
            ? computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, 'x')
            : computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, readFileSync(join(env.storeRoot, 'index', 'registry-index', indexShard, `${indexFactSet!.indexId}.idx`), 'utf8'));
        const targetPath =
          surface === 'quarantine'
            ? qtnPath(env, shard, entry)
            : join(env.storeRoot, 'index', 'registry-index', indexShard, entry);
        const request = (tokens: { readonly generation: string; readonly surfaceGeneration: string }): RecoveryMutationRequest =>
          dispositionRequest(env, { ...facts, observationId: surface === 'quarantine' ? quarantineObservationId(shard, entry) : facts.observationId, ...tokens }, {
            category: surface === 'quarantine' ? 'dispose-quarantined-temporary' : 'dispose-conflicting-index',
            targetEntry: entry,
            targetShard: surface === 'quarantine' ? shard : indexShard,
            expectedDispositionClassification: surface === 'quarantine' ? 'quarantine-malformed' : 'index-conflicting',
            expectedCode: surface === 'quarantine' ? 'ERR-STO-MALFORMED' : 'ERR-STO-INTEGRITY',
            expectedContentDigest: digest,
          });
        let crashed = false;
        try {
          executeRecoveryMutation({
            ...request(currentTokens(env)),
            hooks: {
              stage: (s) => {
                if (s === stage) {
                  crashed = true;
                  throw new Error(`simulated crash at ${surface}/${stage}`);
                }
              },
            },
          });
        } catch {
          assert.equal(crashed, true, `crash must fire at ${surface}/${stage}`);
        }
        // The scanner classifies the resulting state deterministically.
        const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
        assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
        // Held crash locks fail closed (stale-lock breaking out of scope).
        const lockPresent = exists(join(env.storeRoot, 'locks', 'writer.lock'));
        if (stage !== 'before-lock-acquisition') {
          assert.equal(lockPresent, true, `${surface}/${stage} leaves the writer lock`);
          const locked = executeRecoveryMutation(request(currentTokens(env)));
          assert.equal(locked.ok, false);
          assert.equal(locked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
          rmSync(join(env.storeRoot, 'locks', 'writer.lock'));
        }
        // Fresh rerun: stages before the unlink complete the disposition;
        // stages between the unlink and the evidence publication fail
        // closed (target absent without evidence, no inference); stages
        // after the evidence publication resolve to already-completed.
        const rerun = executeRecoveryMutation(request(currentTokens(env)));
        const unlinkIndex = EXECUTABLE_DISPOSITION_CRASH_STAGES.indexOf('after-unlink');
        const evidenceIndex = EXECUTABLE_DISPOSITION_CRASH_STAGES.indexOf('after-evidence-publication');
        const stageIndex = EXECUTABLE_DISPOSITION_CRASH_STAGES.indexOf(stage);
        if (stageIndex < unlinkIndex) {
          assert.equal(rerun.ok, true, `${surface}/${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
          assert.equal(rerun.outcome, 'disposed');
          assert.equal(exists(targetPath), false, `${surface}/${stage}: the target must be gone after the rerun`);
        } else if (stageIndex < evidenceIndex) {
          assert.equal(rerun.ok, false, `${surface}/${stage}: target absent without evidence must fail closed (no inference)`);
          assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
        } else {
          assert.equal(rerun.ok, true, `${surface}/${stage}: rerun must resolve already-completed: ${JSON.stringify(rerun.findings)}`);
          assert.equal(rerun.outcome, 'already-completed');
        }
        assert.equal(exists(join(env.storeRoot, 'locks', 'writer.lock')), false, `${surface}/${stage}: the lock must be released`);
      } finally {
        rmSync(env.dir, { recursive: true, force: true });
      }
    }
  }
});
