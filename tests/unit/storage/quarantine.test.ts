/**
 * WP-8-F quarantine-temporary tests (ADR-030; §16.5, QRN-001…006):
 * authority, eligibility boundaries, deterministic destination, the
 * hard-link plus unlink mutation, idempotency and collision states,
 * recovery scanner classification, evidence binding, and the fixed
 * 15-stage crash inventory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, linkSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedRecoveryRequest, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan, executeRecoveryMutation, computeQuarantineTemporaryId, computeQuarantineEvidenceIdentity, quarantineDestinationDesignation } from '../../../src/storage/recovery/index.js';
import { deriveRegistryView } from '../../../src/storage/registry/index.js';
import { temporaryObservationId } from '../../../src/storage/recovery/index.js';
import { computePayloadDigest, canonicalEnvelopeBytes, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { createRecoveryCapability } from '../../../src/storage/capabilities/authenticity.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import type { RecoveryMutationRequest, RecoveryMutationStage } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'quarantine-test-write';
const RECOVERY_ACTION = 'quarantine-test-action';
const QTEMP_B = 'pub-bbbbbbbbbbbbbbbb-0';
const QTEMP_C = 'pub-cccccccccccccccc-0';

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

/** Establish the phase-3 top-level state (records/audit/locks) the way a
 * crashed publication would: publish one record first. An orphan temporary
 * can only exist after top-level provisioning (the write path provisions
 * before it creates the temporary). */
function makePublishedStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const env = makeStore(limitProfile);
  publish(env, 'pgw:r:11110000000000000000000000000001');
  return env;
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8f-qtn-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8f-qtn-bootstrap',
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

function canonicalOrphanBytes(): string {
  return canonicalEnvelopeBytes({
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId: 'pgw:r:22220000000000000000000000000002',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload: { approved: true },
    payloadDigest: computePayloadDigest({ approved: true }),
  }).canonicalUtf8;
}

/** Create a WPR-023 (b) source temporary (complete canonical unpublished bytes). */
function createQuarantineSourceB(env: TestEnv, name: string = QTEMP_B): void {
  writeFileSync(join(env.storeRoot, 'tmp', name), canonicalOrphanBytes(), { mode: 0o600 });
  chmodSync(join(env.storeRoot, 'tmp', name), 0o600);
}

/** Create a WPR-023 (c) source temporary (malformed bytes). */
function createQuarantineSourceC(env: TestEnv, name: string = QTEMP_C): void {
  writeFileSync(join(env.storeRoot, 'tmp', name), '{not a record', { mode: 0o600 });
  chmodSync(join(env.storeRoot, 'tmp', name), 0o600);
}

function contentDigestOf(env: TestEnv, name: string): string {
  const raw = readFileSync(join(env.storeRoot, 'tmp', name), 'utf8');
  return computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
}

/** Recovery assessment facts for a (b)/(c) source temporary. */
function quarantineFacts(env: TestEnv, entry: string, expectedClassification: 'incomplete-unpublished' | 'malformed-temporary'): {
  readonly observationId: string;
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly sourceDigest: string;
} {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const assessment = result.assessment!;
  const orphan = assessment.orphanTemporaryObjects.find((o) => o.entry === entry);
  assert.ok(orphan !== undefined, `the source temporary ${entry} must be classified`);
  assert.equal(orphan.classification, expectedClassification);
  assert.ok(orphan.contentDigest !== undefined);
  return {
    observationId: orphan.observationId,
    generation: assessment.source.generation,
    surfaceGeneration: assessment.source.surfaceGeneration,
    sourceDigest: orphan.contentDigest,
  };
}

function quarantineRequest(env: TestEnv, facts: ReturnType<typeof quarantineFacts>, entry: string, classification: 'incomplete-unpublished' | 'malformed-temporary', overrides: Partial<RecoveryMutationRequest['action']> = {}): RecoveryMutationRequest {
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
      category: 'quarantine-temporary',
      targetEntry: entry,
      expectedClassification: classification,
      expectedSourceDigest: facts.sourceDigest,
      expectedObservationIds: [facts.observationId],
      expectedGeneration: facts.generation,
      expectedSurfaceGeneration: facts.surfaceGeneration,
      ...overrides,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
}

function destinationPath(env: TestEnv, quarantineId: string): string {
  return join(env.storeRoot, 'quarantine', 'temporary', quarantineId.slice(0, 4), `${quarantineId}.qtn`);
}

function assertQuarantined(env: TestEnv, quarantineId: string, sourceEntry: string, sourceDigest: string): void {
  const path = destinationPath(env, quarantineId);
  const stat = statSync(path);
  assert.equal(stat.nlink, 1);
  const raw = readFileSync(path, 'utf8');
  assert.equal(computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw), sourceDigest, 'destination bytes must be unchanged');
  assert.throws(() => statSync(join(env.storeRoot, 'tmp', sourceEntry)), 'source name must be gone');
  // The quarantine object is scanner-classified with matching evidence.
  const rescan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(rescan.ok, true);
  const q = rescan.assessment!.quarantineObjects.find((o) => o.quarantineId === quarantineId);
  assert.ok(q !== undefined, 'the quarantine object must be scanned');
  assert.equal(q.classification, 'quarantined-valid');
}

// ── Authority ──────────────────────────────────────────────────────────────

test('quarantine: the recovery capability verifies exactly the closed operation set', () => {
  const env = makePublishedStore();
  try {
    const storeResult = verifyStoreInstance({
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      configurationVersion: '1',
      limitProfile: env.limitProfile,
    });
    assert.equal(storeResult.ok, true);
    const provenance = createRecoveryActionProvenance({
      actionIdentity: RECOVERY_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: env.limitProfile,
    });
    const inputResult = createTrustedRecoveryRequest(env.config, provenance, {
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
    });
    assert.equal(inputResult.ok, true);
    const cap = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance: storeResult.storeInstance! });
    assert.ok(cap !== undefined);
    // Implemented operations verify; a generic `quarantine` operation does
    // not exist (QRN-001): an orphan-only capability could never execute
    // quarantine because every boundary verifies its exact operation.
    assert.equal(cap!.verify('orphan-removal').ok, true);
    assert.equal(cap!.verify('quarantine-temporary').ok, true);
    assert.equal(cap!.verify('quarantine' as never).ok, false);
    assert.equal(cap!.verify('quarantine' as never).reason, 'wrong-operation');
    cap!.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('quarantine: forged, cloned, wrong-store, and plan-derived requests are rejected', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const base = quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished');
    const spreadClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: { ...(base.recoveryActionProvenance as object) } });
    assert.equal(spreadClone.ok, false);
    assert.equal(spreadClone.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    const jsonClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: JSON.parse(JSON.stringify(base.recoveryActionProvenance)) });
    assert.equal(jsonClone.ok, false);
    const wrongStore = executeRecoveryMutation({ ...base, locator: '/nonexistent' });
    assert.equal(wrongStore.ok, false);
    const plan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput }).plan!;
    const planAsAction = executeRecoveryMutation({ ...base, action: plan.actions[0] as never });
    assert.equal(planAsAction.ok, false);
    const pathOperand = executeRecoveryMutation({ ...base, action: { ...base.action, targetEntry: '/tmp/evil' } });
    assert.equal(pathOperand.ok, false);
    // The source is untouched.
    assert.equal(statSync(join(env.storeRoot, 'tmp', QTEMP_B)).nlink, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Eligibility ────────────────────────────────────────────────────────────

test('quarantine: WPR-023 (b) and (c) sources are quarantined with evidence', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    createQuarantineSourceC(env);
    const factsB = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    const quarantineIdB = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: factsB.sourceDigest });
    const resultB = executeRecoveryMutation(quarantineRequest(env, factsB, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(resultB.ok, true, JSON.stringify(resultB.findings));
    assert.equal(resultB.outcome, 'quarantined');
    assertQuarantined(env, quarantineIdB, QTEMP_B, factsB.sourceDigest);
    // Fresh assessment after the B mutation (the quarantine structure is
    // part of the recovery-mode surface generation).
    const factsC = quarantineFacts(env, QTEMP_C, 'malformed-temporary');
    const quarantineIdC = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_C, classification: 'malformed-temporary', sourceDigest: factsC.sourceDigest });
    const resultC = executeRecoveryMutation(quarantineRequest(env, factsC, QTEMP_C, 'malformed-temporary'));
    assert.equal(resultC.ok, true, JSON.stringify(resultC.findings));
    assert.equal(resultC.outcome, 'quarantined');
    assertQuarantined(env, quarantineIdC, QTEMP_C, factsC.sourceDigest);
    // Distinct deterministic IDs for (b) vs (c) of the same bytes.
    assert.notEqual(quarantineIdB, quarantineIdC);
    // Evidence is durable for both.
    const rescan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(rescan.assessment!.quarantineObjects.filter((o) => o.classification === 'quarantined-valid').length, 2);
    assert.equal(rescan.assessment!.orphanTemporaryObjects.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('quarantine: ineligible targets fail closed and remain untouched', () => {
  const env = makePublishedStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    // (a) inode twin routed to quarantine: nlink 2 with no destination →
    // uncertain link state, fail closed.
    const derived = deriveRecordRelativePath('approval-record', recordId);
    assert.equal(derived.ok, true);
    rmSync(join(env.storeRoot, 'tmp', QTEMP_B));
    linkSync(join(env.storeRoot, derived.relativePath), join(env.storeRoot, 'tmp', QTEMP_B));
    const twinAsQuarantine = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(twinAsQuarantine.ok, false);
    assert.equal(twinAsQuarantine.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    unlinkSync(join(env.storeRoot, 'tmp', QTEMP_B));
    // Wrong mode.
    createQuarantineSourceB(env);
    chmodSync(join(env.storeRoot, 'tmp', QTEMP_B), 0o644);
    const wrongMode = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(wrongMode.ok, false);
    assert.equal(wrongMode.findings?.[0]?.code, 'ERR-STO-PERM-DENIED');
    chmodSync(join(env.storeRoot, 'tmp', QTEMP_B), 0o600);
    // Symlink source.
    rmSync(join(env.storeRoot, 'tmp', QTEMP_B));
    symlinkSync('/nonexistent', join(env.storeRoot, 'tmp', QTEMP_B));
    const symlinkSource = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(symlinkSource.ok, false);
    assert.equal(symlinkSource.findings?.[0]?.code, 'ERR-STO-FTYPE-UNSUPPORTED');
    rmSync(join(env.storeRoot, 'tmp', QTEMP_B));
    // nlink !== 1 (two unknown links).
    createQuarantineSourceB(env);
    linkSync(join(env.storeRoot, 'tmp', QTEMP_B), join(env.storeRoot, 'tmp', 'pub-dddddddddddddddd-0'));
    const nlinkTwo = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(nlinkTwo.ok, false);
    assert.equal(nlinkTwo.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    unlinkSync(join(env.storeRoot, 'tmp', 'pub-dddddddddddddddd-0'));
    // Canonical record / audit / lock designations are not temp entries.
    const recordTarget = executeRecoveryMutation(quarantineRequest(env, facts, 'writer.lock', 'incomplete-unpublished'));
    assert.equal(recordTarget.ok, false);
    assert.equal(recordTarget.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    const recordIdTarget = executeRecoveryMutation(quarantineRequest(env, facts, '11110000000000000000000000000001.rec', 'incomplete-unpublished'));
    assert.equal(recordIdTarget.ok, false);
    // The durable publication is untouched throughout.
    assert.equal(statSync(join(env.storeRoot, derived.relativePath)).nlink, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Destination and mutation ───────────────────────────────────────────────

test('quarantine: deterministic destination, no raw path, no overwrite, idempotent exact destination', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    const quarantineId = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: facts.sourceDigest });
    // Deterministic ID and destination designation.
    const again = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: facts.sourceDigest });
    assert.equal(quarantineId, again);
    assert.match(quarantineId, /^[0-9a-f]{64}$/);
    assert.equal(quarantineId.slice(0, 4), quarantineDestinationDesignation(quarantineId).split('/')[1]);
    // The result exposes no raw path.
    const result = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.ok(!JSON.stringify(result).includes(env.dir));
    assert.ok(!JSON.stringify(result).includes('quarantine/'));
    // Conflicting destination: replace the destination with different bytes.
    const destPath = destinationPath(env, quarantineId);
    writeFileSync(destPath, 'different bytes', { mode: 0o600 });
    chmodSync(destPath, 0o600);
    const freshB = createQuarantineSourceB(env, QTEMP_B);
    void freshB;
    const facts2 = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const conflicting = executeRecoveryMutation(quarantineRequest(env, facts2, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(conflicting.ok, false);
    assert.equal(conflicting.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.equal(readFileSync(destPath, 'utf8'), 'different bytes', 'the conflicting destination must never be overwritten');
    assert.equal(statSync(join(env.storeRoot, 'tmp', QTEMP_B)).nlink, 1, 'the source must not be unlinked on conflict');
    // Restore the exact destination; the mutation is idempotent with fresh
    // assessment facts (source present + exact destination same inode).
    rmSync(destPath);
    linkSync(join(env.storeRoot, 'tmp', QTEMP_B), destPath);
    const facts3 = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const completed = executeRecoveryMutation(quarantineRequest(env, facts3, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(completed.ok, true, JSON.stringify(completed.findings));
    // The evidence from the first mutation matches; the interrupted-link
    // continuation completes over the matching evidence → already-completed.
    assert.equal(completed.outcome, 'already-completed');
    assert.throws(() => statSync(join(env.storeRoot, 'tmp', QTEMP_B)));
    assert.equal(statSync(destPath).nlink, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Idempotency / recovery states ──────────────────────────────────────────

test('quarantine: interrupted-link continuation and destination-only roll-forward', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    const quarantineId = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: facts.sourceDigest });
    const destPath = destinationPath(env, quarantineId);
    // Simulate a crash after the hard link (before the source unlink).
    mkdirSync(join(env.storeRoot, 'quarantine', 'temporary', quarantineId.slice(0, 4)), { recursive: true, mode: 0o700 });
    linkSync(join(env.storeRoot, 'tmp', QTEMP_B), destPath);
    assert.equal(statSync(destPath).nlink, 2);
    // A fresh scan classifies the interrupted-link state.
    const interruptedScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(interruptedScan.assessment!.quarantineObjects.some((o) => o.classification === 'quarantine-interrupted-link' && o.quarantineId === quarantineId), true);
    // Rerun with fresh assessment facts: continues from the source unlink.
    const facts2 = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const continued = executeRecoveryMutation(quarantineRequest(env, facts2, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(continued.ok, true, JSON.stringify(continued.findings));
    assert.equal(continued.outcome, 'quarantined');
    assertQuarantined(env, quarantineId, QTEMP_B, facts.sourceDigest);
    // Destination-only (source removed, no evidence): roll the evidence forward.
    const sourceC = 'pub-eeeeeeeeeeeeeeee-0';
    createQuarantineSourceC(env, sourceC);
    const factsC = quarantineFacts(env, sourceC, 'malformed-temporary');
    const quarantineIdC = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: sourceC, classification: 'malformed-temporary', sourceDigest: factsC.sourceDigest });
    const destPathC = destinationPath(env, quarantineIdC);
    mkdirSync(join(env.storeRoot, 'quarantine', 'temporary', quarantineIdC.slice(0, 4)), { recursive: true, mode: 0o700 });
    linkSync(join(env.storeRoot, 'tmp', sourceC), destPathC);
    unlinkSync(join(env.storeRoot, 'tmp', sourceC));
    // After the unlink the scan no longer reports the source; use the
    // pre-unlink source facts plus the current scan's generation tokens.
    const currentScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const rolled = executeRecoveryMutation(quarantineRequest(env, { ...factsC, observationId: temporaryObservationId(sourceC), generation: currentScan.assessment!.source.generation, surfaceGeneration: currentScan.assessment!.source.surfaceGeneration }, sourceC, 'malformed-temporary'));
    assert.equal(rolled.ok, true, JSON.stringify(rolled.findings));
    assert.equal(rolled.outcome, 'quarantined');
    assertQuarantined(env, quarantineIdC, sourceC, factsC.sourceDigest);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('quarantine: matching evidence returns already-completed; missing destination and conflicting states fail closed', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    const quarantineId = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: facts.sourceDigest });
    const first = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(first.ok, true);
    // Re-run with the current scan's generation tokens (the source is gone):
    // deterministic already-completed.
    const currentScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const second = executeRecoveryMutation(quarantineRequest(env, { ...facts, observationId: temporaryObservationId(QTEMP_B), generation: currentScan.assessment!.source.generation, surfaceGeneration: currentScan.assessment!.source.surfaceGeneration }, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(second.ok, true, JSON.stringify(second.findings));
    assert.equal(second.outcome, 'already-completed');
    // Matching evidence but the destination is missing → fail closed.
    rmSync(destinationPath(env, quarantineId));
    createQuarantineSourceB(env);
    const factsAfterDelete = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const missingDest = executeRecoveryMutation(quarantineRequest(env, factsAfterDelete, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(missingDest.ok, false);
    assert.equal(missingDest.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(missingDest.findings?.[0]?.message ?? '', /destination is missing/);
    // Both absent → fail closed, no inferred success.
    rmSync(join(env.storeRoot, 'tmp', QTEMP_B));
    const bothAbsent = executeRecoveryMutation(quarantineRequest(env, factsAfterDelete, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(bothAbsent.ok, false);
    assert.equal(bothAbsent.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Evidence ───────────────────────────────────────────────────────────────

test('quarantine: evidence identity is deterministic and replay idempotent; conflicting replay rejected', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    const storeInstance = storeResult.storeInstance!;
    const quarantineId = computeQuarantineTemporaryId({ storeInstance, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: facts.sourceDigest });
    const idA = computeQuarantineEvidenceIdentity({ storeInstance, quarantineId, sourceDigest: facts.sourceDigest, outcome: 'quarantined' });
    const idB = computeQuarantineEvidenceIdentity({ storeInstance, quarantineId, sourceDigest: facts.sourceDigest, outcome: 'quarantined' });
    assert.equal(idA, idB, 'evidence identity must be deterministic');
    const idOther = computeQuarantineEvidenceIdentity({ storeInstance, quarantineId, sourceDigest: 'sha-256:' + '9'.repeat(64), outcome: 'quarantined' });
    assert.notEqual(idA, idOther, 'evidence identity must bind the source digest');
    const first = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(first.ok, true);
    assert.equal(first.evidenceId, idA, 'the mutation evidence must use the deterministic identity');
    // Evidence record + audit are durable.
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', idA);
    assert.equal(evidenceDerived.ok, true);
    const evidenceModel = JSON.parse(readFileSync(join(env.storeRoot, evidenceDerived.relativePath), 'utf8')) as Record<string, unknown>;
    const payload = evidenceModel['payload'] as Record<string, unknown>;
    assert.equal(payload['recoveryOperation'], 'quarantine-temporary');
    assert.equal(payload['quarantineId'], quarantineId);
    assert.equal(payload['sourceDigest'], facts.sourceDigest);
    assert.equal(payload['targetEntry'], QTEMP_B);
    assert.equal(payload['outcome'], 'quarantined');
    assert.deepEqual(payload['resultingState'], { sourceRemoved: true, destinationIntact: true });
    assert.ok(!JSON.stringify(payload).includes(env.dir), 'evidence must not store raw paths');
    // Conflicting replay: rewrite the evidence payload with a different
    // quarantine ID (same record identity).
    payload['quarantineId'] = 'f'.repeat(64);
    evidenceModel['payload'] = payload;
    evidenceModel['payloadDigest'] = computePayloadDigest(payload);
    writeFileSync(join(env.storeRoot, evidenceDerived.relativePath), canonicalEnvelopeBytes(evidenceModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(join(env.storeRoot, evidenceDerived.relativePath), 0o600);
    const currentScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const conflicting = executeRecoveryMutation(quarantineRequest(env, { ...facts, observationId: temporaryObservationId(QTEMP_B), generation: currentScan.assessment!.source.generation, surfaceGeneration: currentScan.assessment!.source.surfaceGeneration }, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(conflicting.ok, false);
    assert.equal(conflicting.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(conflicting.findings?.[0]?.message ?? '', /conflict/);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Scanner ────────────────────────────────────────────────────────────────

test('quarantine: malformed and foreign quarantine objects are classified; recovery surface generation binds quarantine', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const registryViewBefore = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(registryViewBefore.ok, true);
    const registryGenBefore = registryViewBefore.view!.source.surfaceGeneration;
    const first = executeRecoveryMutation(quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'));
    assert.equal(first.ok, true);
    // Malformed and foreign entries at the quarantine surfaces.
    mkdirSync(join(env.storeRoot, 'quarantine', 'temporary', 'aaaa'), { recursive: true, mode: 0o700 });
    writeFileSync(join(env.storeRoot, 'quarantine', 'temporary', 'aaaa', 'nothex.qtn'), 'x', { mode: 0o600 });
    writeFileSync(join(env.storeRoot, 'quarantine', 'temporary', 'aaaa', 'stray.txt'), 'x', { mode: 0o600 });
    writeFileSync(join(env.storeRoot, 'quarantine', 'temporary', 'aaaa', 'a'.repeat(64) + '.qtn'), 'x', { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'quarantine', 'temporary', 'aaaa', 'a'.repeat(64) + '.qtn'), 0o644);
    mkdirSync(join(env.storeRoot, 'quarantine', 'unknown-class'), { recursive: true, mode: 0o700 });
    // A foreign (non-hex) shard directory.
    mkdirSync(join(env.storeRoot, 'quarantine', 'temporary', 'zzzz'), { recursive: true, mode: 0o700 });
    const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true);
    const qObs = scan.assessment!.quarantineObjects;
    assert.equal(qObs.some((o) => o.entry === 'nothex.qtn' && o.classification === 'quarantine-malformed'), true);
    assert.equal(qObs.some((o) => o.entry === 'stray.txt' && o.classification === 'foreign-entry'), true);
    assert.equal(qObs.some((o) => o.entry === 'unknown-class' && o.classification === 'foreign-entry'), true);
    assert.equal(qObs.some((o) => o.entry === 'zzzz' && o.classification === 'foreign-entry'), true);
    assert.equal(qObs.some((o) => o.classification === 'wrong-uid-or-mode'), true);
    // Recovery surface generation changed (quarantine structure bound).
    const registryGenAfter = scan.assessment!.source.surfaceGeneration;
    assert.notEqual(registryGenAfter, registryGenBefore, 'recovery surface generation must bind quarantine structure');
    // Registry mode must not include quarantine structure: a registry scan
    // surface generation is unchanged by quarantine structure.
    const registryViewAfter = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(registryViewAfter.ok, true);
    assert.equal(registryViewAfter.view!.source.surfaceGeneration, registryGenBefore, 'registry surface generation must exclude quarantine structure');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Crash stages ───────────────────────────────────────────────────────────

/** Fixed quarantine crash-stage inventory (asserted by the tests below). */
const QUARANTINE_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-lock-acquisition',
  'after-lock-acquisition',
  'after-source-verification',
  'after-quarantine-directory-provisioning',
  'before-destination-link',
  'after-destination-link',
  'before-destination-directory-fsync',
  'after-destination-directory-fsync',
  'before-source-unlink',
  'after-source-unlink',
  'before-tmp-directory-fsync',
  'after-tmp-directory-fsync',
  'before-evidence-publication',
  'after-evidence-publication',
  'before-lock-release',
];

test('quarantine: the fixed 15-stage crash inventory is asserted', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({ ...quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'), hooks: { stage: (s) => seen.push(s) } });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, QUARANTINE_CRASH_STAGES, 'the fixed quarantine crash-stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('quarantine: a crash at every stage leaves a classifiable state and a safe rerun', () => {
  for (const stage of QUARANTINE_CRASH_STAGES) {
    const env = makePublishedStore();
    try {
      createQuarantineSourceB(env);
      const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
      let crashed = false;
      try {
        executeRecoveryMutation({
          ...quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'),
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
      // Canonical records and audit records are untouched.
      const canonicalDir = join(env.storeRoot, 'records', 'approval');
      const canonicalCount = readdirSync(canonicalDir, { recursive: true }).filter((e) => String(e).endsWith('.rec')).length;
      assert.equal(canonicalCount, 1, 'no canonical record may be created or removed');
      // The scanner classifies the resulting state deterministically.
      const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
      // Rerun: crashes at/after lock acquisition leave the held writer lock
      // (stale-lock breaking out of scope) → deterministic fail-closed lock
      // unavailable; the test releases the crash lock as a fixture step.
      const lockPresent = ((): boolean => {
        try {
          statSync(join(env.storeRoot, 'locks', 'writer.lock'));
          return true;
        } catch {
          return false;
        }
      })();
      if (stage !== 'before-lock-acquisition') {
        assert.equal(lockPresent, true, `crash at ${stage} leaves the writer lock`);
        const lockedScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
        const locked = executeRecoveryMutation(quarantineRequest(env, { ...facts, observationId: temporaryObservationId(QTEMP_B), generation: lockedScan.assessment!.source.generation, surfaceGeneration: lockedScan.assessment!.source.surfaceGeneration }, QTEMP_B, 'incomplete-unpublished'));
        assert.equal(locked.ok, false);
        assert.equal(locked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
        rmSync(join(env.storeRoot, 'locks', 'writer.lock'));
      }
      // Rerun with the current scan's generation tokens (the source may be
      // gone for stages at/after the source unlink).
      const rerunScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      const rerun = executeRecoveryMutation(quarantineRequest(env, { ...facts, observationId: temporaryObservationId(QTEMP_B), generation: rerunScan.assessment!.source.generation, surfaceGeneration: rerunScan.assessment!.source.surfaceGeneration }, QTEMP_B, 'incomplete-unpublished'));
      assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
      // Final state: quarantined, evidence durable, lock released.
      const finalScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      const qObs = finalScan.assessment!.quarantineObjects.filter((o) => o.entry.endsWith('.qtn'));
      assert.equal(qObs.length >= 1, true, `${stage}: a quarantine object must exist`);
      assert.equal(finalScan.assessment!.quarantineObjects.some((o) => o.classification === 'quarantined-valid'), true);
      try {
        statSync(join(env.storeRoot, 'tmp', QTEMP_B));
        assert.fail(`source must be gone after rerun at ${stage}`);
      } catch {
        // expected
      }
      try {
        statSync(join(env.storeRoot, 'locks', 'writer.lock'));
        assert.fail(`lock must be released after rerun at ${stage}`);
      } catch {
        // expected
      }
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

// ── WP-8-F correction: quarantine provisioning parent-fsync sequence ───────

test('quarantine: provisioning fsyncs the parents of created directories in order', () => {
  const env = makePublishedStore();
  try {
    createQuarantineSourceB(env);
    const facts = quarantineFacts(env, QTEMP_B, 'incomplete-unpublished');
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const quarantineId = computeQuarantineTemporaryId({ storeInstance: storeResult.storeInstance!, sourceEntry: QTEMP_B, classification: 'incomplete-unpublished', sourceDigest: facts.sourceDigest });
    const shard = quarantineId.slice(0, 4);
    // The quarantine structure does not exist yet (fresh store): every
    // level is created, so every parent must be fsynced.
    assert.throws(() => statSync(join(env.storeRoot, 'quarantine')));
    const fsynced: string[] = [];
    const result = executeRecoveryMutation({
      ...quarantineRequest(env, facts, QTEMP_B, 'incomplete-unpublished'),
      hooks: { fsyncDirectory: (p) => fsynced.push(p) },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    // Parent-of-created sequence: namespace root, quarantine/, temporary/.
    const rootIdx = fsynced.indexOf(env.storeRoot);
    const qIdx = fsynced.indexOf(join(env.storeRoot, 'quarantine'));
    const tIdx = fsynced.indexOf(join(env.storeRoot, 'quarantine', 'temporary'));
    assert.ok(rootIdx !== -1, `namespace root must be fsynced after creating quarantine/: ${JSON.stringify(fsynced)}`);
    assert.ok(qIdx !== -1, `quarantine/ must be fsynced after creating temporary/: ${JSON.stringify(fsynced)}`);
    assert.ok(tIdx !== -1, `quarantine/temporary/ must be fsynced after creating the shard: ${JSON.stringify(fsynced)}`);
    assert.ok(rootIdx < qIdx && qIdx < tIdx, 'created-parent fsyncs must occur in creation order');
    // The shard directory is fsynced again after the destination link
    // (before the source unlink), covering the .qtn entry.
    const shardIdx = fsynced.indexOf(join(env.storeRoot, 'quarantine', 'temporary', shard));
    assert.ok(shardIdx !== -1, 'the shard directory must be fsynced after the destination link');
    assert.ok(tIdx < shardIdx, 'the shard fsync must follow its parent fsync');
    // The quarantine destination is durable and valid.
    assertQuarantined(env, quarantineId, QTEMP_B, facts.sourceDigest);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
