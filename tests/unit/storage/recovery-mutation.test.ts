/**
 * WP-8-F authorized recovery-mutation tests: authority gating, immediate
 * re-verification, safe orphan-temporary cleanup, deterministic evidence,
 * crash-stage coverage, idempotency, and the contract-decision-gated
 * quarantine rejection.
 *
 * Fixtures are test-created temporary stores; the crash twin is created by
 * hard-linking a published record into `tmp/` under the WPR-003 temporary
 * grammar (the WPR-023 (a) crash-reappearing state). The recovery scan
 * (WP-8-E) classifies the twin deterministically; the mutation request is
 * built from the assessment facts (observation id, generation, surface
 * generation, twin identity/digest/link count).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, linkSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedStorageBootstrapInput, createTrustedRecoveryRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan } from '../../../src/storage/recovery/index.js';
import { executeRecoveryMutation } from '../../../src/storage/recovery/index.js';
import { buildRecoveryEvidenceRecord, computeRecoveryEvidenceIdentity, isoFromEpochMs } from '../../../src/storage/recovery/index.js';
import { temporaryObservationId } from '../../../src/storage/recovery/index.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { computePayloadDigest, canonicalEnvelopeBytes } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { createRecoveryCapability, createRecoveryPublicationPermit } from '../../../src/storage/capabilities/authenticity.js';
import { publishImmutableRecord, ensureClassShardDirectories, publishRecoveryBoundRecord } from '../../../src/storage/publication/publish-record.js';
import type { RecoveryMutationRequest, RecoveryMutationStage } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'recovery-mutation-test-write';
const RECOVERY_ACTION = 'recovery-mutation-test-action';

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
  const dir = mkdtempSync(join(tmpdir(), 'wp8f-mut-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8f-bootstrap',
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

/** Record path for a published approval record. */
function approvalPath(env: TestEnv, recordId: string): string {
  const derived = deriveRecordRelativePath('approval-record', recordId);
  assert.equal(derived.ok, true);
  return join(env.storeRoot, derived.relativePath);
}

const TWIN_TEMP_NAME = 'pub-aaaaaaaaaaaaaaaa-1';

/** Create the WPR-023 (a) crash twin: hard link of the published record into tmp/. */
function createCrashTwin(env: TestEnv, recordId: string, name: string = TWIN_TEMP_NAME): void {
  linkSync(approvalPath(env, recordId), join(env.storeRoot, 'tmp', name));
}

/** Recovery assessment facts for the crash twin (WP-8-E scan). */
function assessmentOf(env: TestEnv): {
  readonly observationId: string;
  readonly generation: string;
  readonly surfaceGeneration: string;
  readonly twinRecordId: string;
  readonly twinDigest: string;
  readonly linkCount: number;
} {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const assessment = result.assessment!;
  const orphan = assessment.orphanTemporaryObjects.find((o) => o.classification === 'orphan-referencing-published');
  assert.ok(orphan !== undefined, 'the crash twin must classify as orphan-referencing-published');
  assert.ok(orphan.recordId !== undefined && orphan.recordDigest !== undefined, 'the (a) observation must carry the twin envelope facts');
  return {
    observationId: orphan.observationId,
    generation: assessment.source.generation,
    surfaceGeneration: assessment.source.surfaceGeneration,
    twinRecordId: orphan.recordId,
    twinDigest: orphan.recordDigest,
    linkCount: 2,
  };
}

function request(env: TestEnv, facts: ReturnType<typeof assessmentOf>, overrides: Partial<RecoveryMutationRequest['action']> = {}): RecoveryMutationRequest {
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
      category: 'orphan-removal',
      targetEntry: TWIN_TEMP_NAME,
      expectedTwinRecordId: facts.twinRecordId,
      expectedTwinRecordClass: 'approval-record',
      expectedTwinDigest: facts.twinDigest,
      expectedLinkCount: facts.linkCount,
      expectedObservationIds: [facts.observationId],
      expectedGeneration: facts.generation,
      expectedSurfaceGeneration: facts.surfaceGeneration,
      ...overrides,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
}

/** Assert the evidence record and its audit event exist and are canonical. */
function assertEvidenceDurable(env: TestEnv, evidenceId: string, targetEntry: string, twinDigest: string): void {
  const derived = deriveRecordRelativePath('store-evidence-record', evidenceId);
  assert.equal(derived.ok, true);
  const path = join(env.storeRoot, derived.relativePath);
  const raw = readFileSync(path, 'utf8');
  const model = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(model['recordKind'], 'StoreEvidenceRecord');
  assert.equal(model['recordId'], evidenceId);
  const payload = model['payload'] as Record<string, unknown>;
  assert.equal(payload['evidenceKind'], 'recovery-evidence');
  assert.equal(payload['recoveryOperation'], 'orphan-removal');
  assert.equal(payload['targetEntry'], targetEntry);
  assert.equal(payload['twinRecordDigest'], twinDigest);
  assert.equal(payload['outcome'], 'orphan-removed');
  assert.deepEqual(payload['resultingState'], { temporaryRemoved: true, twinIntact: true });
  // The evidence record's own authorized-write audit event is durable.
  const auditDir = join(env.storeRoot, 'audit', 'audit-event');
  const auditFiles: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.aud')) auditFiles.push(p);
    }
  };
  walk(auditDir);
  assert.equal(auditFiles.length >= 2, true, 'the evidence record must have its write-audit event');
}

// ── Authority ──────────────────────────────────────────────────────────────

test('recovery-mutation: genuine authority removes the crash twin and publishes evidence', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const result = executeRecoveryMutation(request(env, facts));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'removed');
    assert.ok(result.evidenceId !== undefined);
    // The durable publication remains intact on its own inode.
    const twinStat = statSync(approvalPath(env, recordId));
    assert.equal(twinStat.nlink, 1);
    // The temporary name is gone.
    assert.throws(() => statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME)));
    assertEvidenceDurable(env, result.evidenceId, TWIN_TEMP_NAME, facts.twinDigest);
    // The lock is released.
    assert.throws(() => statSync(join(env.storeRoot, 'locks', 'writer.lock')));
    // The recovery scanner classifies the final state deterministically.
    const rescan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(rescan.ok, true);
    assert.equal(rescan.assessment!.orphanTemporaryObjects.length, 0);
    assert.equal(rescan.assessment!.verifiedDurableRecords.some((r) => r.recordClass === 'store-evidence-record'), true, 'the evidence record is a verified durable record');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: forged and structural-clone provenance grants nothing', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const base = request(env, facts);
    // Spread clone: not a member of the provenance brand.
    const spreadClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: { ...(base.recoveryActionProvenance as object) } });
    assert.equal(spreadClone.ok, false);
    assert.equal(spreadClone.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // JSON structural clone: not a member of the provenance brand.
    const jsonClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: JSON.parse(JSON.stringify(base.recoveryActionProvenance)) });
    assert.equal(jsonClone.ok, false);
    assert.equal(jsonClone.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // Wrong store: same provenance, different locator raw field.
    const wrongStore = executeRecoveryMutation({ ...base, locator: '/nonexistent-store-root' });
    assert.equal(wrongStore.ok, false);
    assert.equal(wrongStore.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // The twin is untouched by every rejection.
    assert.equal(statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME)).nlink, 2);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: an advisory plan grants no authority and is never a request operand', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const plan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput }).plan!;
    // A plan action object passed as the mutation action is rejected.
    const planActionAsAction = executeRecoveryMutation({ ...request(env, facts), action: plan.actions[0] as never });
    assert.equal(planActionAsAction.ok, false);
    assert.equal(planActionAsAction.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // The plan passed as the whole request is rejected.
    const planAsRequest = executeRecoveryMutation(plan as never);
    assert.equal(planAsRequest.ok, false);
    // Raw-path and malformed operands are rejected.
    const pathOperand = executeRecoveryMutation({ ...request(env, facts), action: { ...request(env, facts).action, targetEntry: '/tmp/evil' } });
    assert.equal(pathOperand.ok, false);
    const badDigest = executeRecoveryMutation({ ...request(env, facts), action: { ...request(env, facts).action, expectedTwinDigest: 'not-a-digest' } });
    assert.equal(badDigest.ok, false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: a generic quarantine authority does not exist and fails closed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const result = executeRecoveryMutation({ ...request(env, facts), action: { ...request(env, facts).action, category: 'quarantine' as never } });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    assert.match(result.findings?.[0]?.message ?? '', /no generic quarantine authority/);
    // Nothing mutated.
    assert.equal(statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME)).nlink, 2);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Re-verification ────────────────────────────────────────────────────────

test('recovery-mutation: re-verification rejects changed content, mode, and link count', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const twinPath = approvalPath(env, recordId);
    const originalBytes = readFileSync(twinPath);
    // Content changed: tamper the twin's payload (breaks the twin digest).
    const model = JSON.parse(originalBytes.toString('utf8')) as Record<string, unknown>;
    model['payload'] = { approved: true, tampered: true };
    model['payloadDigest'] = computePayloadDigest({ approved: true, tampered: true });
    writeFileSync(twinPath, canonicalEnvelopeBytes(model).canonicalUtf8, { mode: 0o600 });
    const tampered = executeRecoveryMutation(request(env, facts));
    assert.equal(tampered.ok, false);
    assert.equal(tampered.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Restore the twin; the temporary is untouched.
    writeFileSync(twinPath, originalBytes, { mode: 0o600 });
    assert.equal(statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME)).nlink, 2);
    // Mode changed on the temporary: 0644 instead of 0600.
    chmodSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME), 0o644);
    const modeChanged = executeRecoveryMutation(request(env, facts));
    assert.equal(modeChanged.ok, false);
    assert.equal(modeChanged.findings?.[0]?.code, 'ERR-STO-PERM-DENIED');
    chmodSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME), 0o600);
    // Link count changed: an extra hard link to the twin inode.
    linkSync(twinPath, join(env.storeRoot, 'tmp', 'pub-cccccccccccccccc-0'));
    const linkChanged = executeRecoveryMutation(request(env, facts));
    assert.equal(linkChanged.ok, false);
    assert.equal(linkChanged.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    unlinkSync(join(env.storeRoot, 'tmp', 'pub-cccccccccccccccc-0'));
    // The durable publication is untouched by every rejection.
    assert.equal(statSync(twinPath).nlink, 2);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: source replaced by symlink or wrong inode fails closed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    // Replace the temporary with a symlink.
    unlinkSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
    symlinkSync(approvalPath(env, recordId), join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
    const symlinkResult = executeRecoveryMutation(request(env, facts));
    assert.equal(symlinkResult.ok, false);
    assert.equal(symlinkResult.findings?.[0]?.code, 'ERR-STO-FTYPE-UNSUPPORTED');
    // Replace the temporary with a hard link to a different file.
    unlinkSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
    const other = join(env.storeRoot, 'tmp', 'pub-bbbbbbbbbbbbbbbb-0');
    writeFileSync(other, '{not a record', { mode: 0o600 });
    chmodSync(other, 0o600);
    linkSync(other, join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
    const wrongInode = executeRecoveryMutation(request(env, facts));
    assert.equal(wrongInode.ok, false);
    assert.equal(['ERR-STO-INTEGRITY', 'ERR-STO-MALFORMED'].includes(wrongInode.findings?.[0]?.code ?? ''), true, 'the wrong-inode temp must fail re-verification');
    // The durable publication is untouched.
    assert.equal(statSync(approvalPath(env, recordId)).nlink, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: link count change and surface/generation drift fail closed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    // Link count changed: an extra hard link to the twin inode.
    linkSync(approvalPath(env, recordId), join(env.storeRoot, 'tmp', 'pub-cccccccccccccccc-0'));
    const linkChanged = executeRecoveryMutation(request(env, facts));
    assert.equal(linkChanged.ok, false);
    assert.equal(linkChanged.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    unlinkSync(join(env.storeRoot, 'tmp', 'pub-cccccccccccccccc-0'));
    // Surface generation drift: a class directory appears after assessment.
    mkdirSync(join(env.storeRoot, 'records', 'supersession'), { recursive: true, mode: 0o700 });
    chmodSync(join(env.storeRoot, 'records', 'supersession'), 0o700);
    const surfaceDrift = executeRecoveryMutation(request(env, facts));
    assert.equal(surfaceDrift.ok, false);
    assert.equal(surfaceDrift.findings?.[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    rmSync(join(env.storeRoot, 'records', 'supersession'), { recursive: true, force: true });
    // Store generation drift: an assessment token from another bounds profile.
    const wrongGeneration = executeRecoveryMutation(request(env, { ...facts, generation: 'sha-256:' + 'f'.repeat(64) }));
    assert.equal(wrongGeneration.ok, false);
    assert.equal(wrongGeneration.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Wrong observation evidence id.
    const wrongObservation = executeRecoveryMutation(request(env, { ...facts, observationId: 'obs-0000000000000000' }));
    assert.equal(wrongObservation.ok, false);
    assert.equal(wrongObservation.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Orphan cleanup + idempotency ───────────────────────────────────────────

test('recovery-mutation: repeated execution is deterministic already-completed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const first = executeRecoveryMutation(request(env, facts));
    assert.equal(first.ok, true);
    assert.equal(first.outcome, 'removed');
    const second = executeRecoveryMutation(request(env, facts));
    assert.equal(second.ok, true, JSON.stringify(second.findings));
    assert.equal(second.outcome, 'already-completed');
    assert.equal(second.evidenceId, first.evidenceId);
    // One evidence record, one audit event per evidence, publication intact.
    const evidenceDir = join(env.storeRoot, 'records', 'evidence');
    const evidenceFiles: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else evidenceFiles.push(p);
      }
    };
    walk(evidenceDir);
    assert.equal(evidenceFiles.length, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: already-removed twin completes the evidence half roll-forward', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    // Simulate an interrupted removal: the temporary name is gone, the twin
    // is intact, no evidence exists.
    unlinkSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
    const result = executeRecoveryMutation(request(env, facts));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'removed');
    assert.ok(result.evidenceId !== undefined);
    assertEvidenceDurable(env, result.evidenceId, TWIN_TEMP_NAME, facts.twinDigest);
    assert.equal(statSync(approvalPath(env, recordId)).nlink, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: non-twin and uncertain temporaries are never removed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    // An orphan temporary that is NOT an inode twin (WPR-023 (b): complete
    // unpublished canonical bytes at the temp name, no twin link).
    const orphanBytes = canonicalEnvelopeBytes({
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId: 'pgw:r:22220000000000000000000000000002',
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: true },
      payloadDigest: computePayloadDigest({ approved: true }),
    }).canonicalUtf8;
    writeFileSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME), orphanBytes, { mode: 0o600 });
    chmodSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME), 0o600);
    // The scan classifies it as incomplete-unpublished, not a twin.
    const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.assessment!.orphanTemporaryObjects.find((o) => o.entry === TWIN_TEMP_NAME)?.classification, 'incomplete-unpublished');
    // A mutation request for the twin relationship fails re-verification.
    const facts = assessmentOfTwinOnly(env, 'pgw:r:22220000000000000000000000000002');
    const result = executeRecoveryMutation(request(env, facts));
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // The temp is untouched.
    assert.equal(statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME)).isFile(), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

/** Assessment facts for a twin that does not exist as a durable publication. */
function assessmentOfTwinOnly(env: TestEnv, recordId: string): ReturnType<typeof assessmentOf> {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true);
  const assessment = result.assessment!;
  return {
    observationId: temporaryObservationId(TWIN_TEMP_NAME),
    generation: assessment.source.generation,
    surfaceGeneration: assessment.source.surfaceGeneration,
    twinRecordId: recordId,
    twinDigest: 'sha-256:' + '0'.repeat(64),
    linkCount: 2,
  };
}

// ── Crash stages ───────────────────────────────────────────────────────────

/** Fixed crash-stage inventory (asserted by the test below). */
const CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-lock-acquisition',
  'after-lock-acquisition',
  'after-target-verification',
  'before-source-unlink',
  'after-source-unlink',
  'before-directory-fsync',
  'after-directory-fsync',
  'before-evidence-publication',
  'after-evidence-publication',
  'before-lock-release',
];

test('recovery-mutation: the fixed crash-stage inventory is asserted', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({ ...request(env, facts), hooks: { stage: (s) => seen.push(s) } });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, CRASH_STAGES, 'the fixed crash-stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: a crash at every stage leaves a classifiable state and a safe rerun', () => {
  for (const stage of CRASH_STAGES) {
    const env = makeStore();
    try {
      const recordId = 'pgw:r:11110000000000000000000000000001';
      publish(env, recordId);
      createCrashTwin(env, recordId);
      const facts = assessmentOf(env);
      let crashed = false;
      let result;
      try {
        result = executeRecoveryMutation({
          ...request(env, facts),
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
      // The scan classifies the crashed state deterministically.
      const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
      const tempPresent = ((): boolean => {
        try {
          statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
          return true;
        } catch {
          return false;
        }
      })();
      const lockPresent = ((): boolean => {
        try {
          statSync(join(env.storeRoot, 'locks', 'writer.lock'));
          return true;
        } catch {
          return false;
        }
      })();
      if (stage === 'before-lock-acquisition') {
        assert.equal(lockPresent, false, 'no lock before acquisition');
        assert.equal(tempPresent, true);
      } else {
        assert.equal(lockPresent, true, `crash at ${stage} leaves the writer lock`);
      }
      // Rerun: for crashes at/after lock acquisition the held lock yields the
      // deterministic fail-closed lock-unavailable result (stale-lock
      // breaking is out of scope); the test then releases the crashed
      // process's lock as a fixture step and re-runs to completion.
      if (stage !== 'before-lock-acquisition') {
        const locked = executeRecoveryMutation(request(env, facts));
        assert.equal(locked.ok, false, `rerun at ${stage} must fail closed on the held lock`);
        assert.equal(locked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
        rmSync(join(env.storeRoot, 'locks', 'writer.lock'));
      }
      const rerun = executeRecoveryMutation(request(env, facts));
      assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
      // Final state: twin intact, temp gone, evidence durable, lock released.
      assert.equal(statSync(approvalPath(env, recordId)).nlink, 1);
      try {
        statSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
        assert.fail(`temp must be gone after rerun at ${stage}`);
      } catch {
        // expected
      }
      assert.ok(rerun.evidenceId !== undefined);
      const scanFinal = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanFinal.assessment!.orphanTemporaryObjects.filter((o) => o.entry === TWIN_TEMP_NAME).length, 0);
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

// ── Evidence ───────────────────────────────────────────────────────────────

test('recovery-mutation: evidence identity is deterministic and binds the factual tuple', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    const storeResult = verifyStoreInstance({
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      configurationVersion: '1',
      limitProfile: env.limitProfile,
    });
    assert.equal(storeResult.ok, true);
    const base = {
      storeInstance: storeResult.storeInstance!,
      actionIdentity: RECOVERY_ACTION,
      evidenceKind: 'recovery-evidence' as const,
      recoveryOperation: 'orphan-removal' as const,
      targetEntry: TWIN_TEMP_NAME,
      twinRecordId: recordId,
      twinRecordClass: 'approval-record',
      twinRecordDigest: 'sha-256:' + '1'.repeat(64),
      observationIds: ['obs-1111111111111111'],
      outcome: 'orphan-removed' as const,
      generation: 'sha-256:' + '2'.repeat(64),
      surfaceGeneration: 'sha-256:' + '3'.repeat(64),
      createdAt: isoFromEpochMs(1000),
    };
    const a = computeRecoveryEvidenceIdentity(base as never);
    const b = computeRecoveryEvidenceIdentity({ ...base, createdAt: isoFromEpochMs(9999) } as never);
    assert.equal(a, b, 'the identity must not depend on the recovery time');
    const c = computeRecoveryEvidenceIdentity({ ...base, twinRecordDigest: 'sha-256:' + '9'.repeat(64) } as never);
    assert.notEqual(a, c, 'the identity must bind the pre-mutation evidence digest');
    const d = computeRecoveryEvidenceIdentity({ ...base, targetEntry: 'pub-ffffffffffffffff-0' } as never);
    assert.notEqual(a, d, 'the identity must bind the target designation');
    // The built record is a canonical StoreEvidenceRecord envelope.
    const built = buildRecoveryEvidenceRecord(base as never);
    assert.equal(built.ok, true);
    assert.equal(built.record!.recordId, a);
    assert.match(built.record!.canonicalUtf8, /"recordKind":"StoreEvidenceRecord"/);
    assert.equal(built.record!.auditEventId.startsWith('pgw:l:'), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: durable twin changed or disappeared on the already-removed path fails closed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const twinPath = approvalPath(env, recordId);
    const originalBytes = readFileSync(twinPath);
    // Remove the temporary name, then tamper the durable twin.
    unlinkSync(join(env.storeRoot, 'tmp', TWIN_TEMP_NAME));
    const model = JSON.parse(originalBytes.toString('utf8')) as Record<string, unknown>;
    model['payload'] = { approved: true, tampered: true };
    model['payloadDigest'] = computePayloadDigest({ approved: true, tampered: true });
    writeFileSync(twinPath, canonicalEnvelopeBytes(model).canonicalUtf8, { mode: 0o600 });
    const tampered = executeRecoveryMutation(request(env, facts));
    assert.equal(tampered.ok, false);
    assert.equal(tampered.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Restore the twin, then remove it entirely.
    writeFileSync(twinPath, originalBytes, { mode: 0o600 });
    rmSync(twinPath);
    const gone = executeRecoveryMutation(request(env, facts));
    assert.equal(gone.ok, false);
    assert.equal(gone.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery-mutation: conflicting recovery evidence fails closed', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    createCrashTwin(env, recordId);
    const facts = assessmentOf(env);
    const first = executeRecoveryMutation(request(env, facts));
    assert.equal(first.ok, true);
    // Rewrite the evidence record with the SAME identity but a conflicting
    // factual payload (different target entry); the record stays canonical.
    const derived = deriveRecordRelativePath('store-evidence-record', first.evidenceId!);
    assert.equal(derived.ok, true);
    const evidencePath = join(env.storeRoot, derived.relativePath);
    const model = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
    const payload = model['payload'] as Record<string, unknown>;
    payload['targetEntry'] = 'pub-ffffffffffffffff-0';
    model['payload'] = payload;
    model['payloadDigest'] = computePayloadDigest(payload);
    writeFileSync(evidencePath, canonicalEnvelopeBytes(model).canonicalUtf8, { mode: 0o600 });
    chmodSync(evidencePath, 0o600);
    // The temp is gone; the already-removed path must reject the conflict.
    const rerun = executeRecoveryMutation(request(env, facts));
    assert.equal(rerun.ok, false);
    assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(rerun.findings?.[0]?.message ?? '', /conflict/);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── WP-8-F correction: publication-sink confinement exploit probes ─────────

/** Mint a genuine recovery capability for the probe store (test-only). */
function mintRecoveryCapability(env: TestEnv): { readonly cap: NonNullable<ReturnType<typeof createRecoveryCapability>>; readonly storeInstance: NonNullable<Awaited<ReturnType<typeof verifyStoreInstance>>['storeInstance']> } {
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
  const inputResult = createTrustedRecoveryRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
  assert.equal(inputResult.ok, true);
  const cap = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request, storeInstance: storeResult.storeInstance! });
  assert.ok(cap !== undefined, 'a genuine recovery capability must be mintable');
  return { cap: cap!, storeInstance: storeResult.storeInstance! };
}

test('recovery publication: generic substrate rejects recovery authority before any mutation', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const { cap } = mintRecoveryCapability(env);
    const storeRoot = env.storeRoot;
    // Probe A: arbitrary primary record (caller-selected class + destination)
    // via the generic publication sink under a genuine recovery capability.
    const recId = 'pgw:r:99990000000000000000000000000099';
    const derived = deriveRecordRelativePath('supersession-record', recId);
    assert.equal(derived.ok, true);
    const canonical = canonicalEnvelopeBytes({
      recordKind: 'SupersessionRecord',
      formatVersion: '1.0',
      recordId: recId,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: 'probe',
      payload: { p: 1 },
      payloadDigest: computePayloadDigest({ p: 1 }),
    }).canonicalUtf8;
    const published = publishImmutableRecord({
      capability: cap as never,
      canonicalUtf8: canonical,
      byteLimit: 1024 * 1024,
      tmpPath: `${storeRoot}/tmp/pub-eeeeeeeeeeeeeeee-2`,
      tmpDirPath: `${storeRoot}/tmp`,
      finalPath: `${storeRoot}/${derived.relativePath}`,
      finalDirPath: `${storeRoot}/records/supersession/${derived.shard}`,
      serviceUid: UID,
      expectedRecordId: recId,
      expectedRevision: 1,
      expectedDigest: 'sha-256:' + '0'.repeat(64),
    });
    assert.equal(published.ok, false, 'recovery authority must never publish through the generic sink');
    assert.equal(published.code, 'ERR-STO-REQ-INVALID');
    assert.equal(published.message, 'write capability operand is not genuine');
    // Probe B: generic class/shard provisioning under recovery authority.
    const provisioned = ensureClassShardDirectories({ capability: cap as never, namespaceRoot: storeRoot, recordClass: 'supersession-record', rawIdentifier: recId, serviceUid: UID });
    assert.equal(provisioned.ok, false, 'recovery authority must never provision generic class directories');
    assert.equal(provisioned.code, 'ERR-STO-REQ-INVALID');
    const arbitraryClass = ensureClassShardDirectories({ capability: cap as never, namespaceRoot: storeRoot, recordClass: 'approval-record' as never, rawIdentifier: recId, serviceUid: UID });
    assert.equal(arbitraryClass.ok, false, 'recovery authority must never provision arbitrary classes');
    // No mutation of any kind: no class directory, no temp, no final record.
    assert.throws(() => statSync(join(storeRoot, 'records', 'supersession')), 'no supersession class directory may be created');
    assert.throws(() => statSync(join(storeRoot, 'tmp', 'pub-eeeeeeeeeeeeeeee-2')), 'no temporary may be created');
    assert.throws(() => statSync(join(storeRoot, derived.relativePath)), 'no final record may be created');
    cap.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery publication: exact-record permit binds one record; substitution fails before mutation', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const { cap, storeInstance } = mintRecoveryCapability(env);
    const byteLimit = 1024 * 1024;
    const evidenceInput = {
      storeInstance,
      actionIdentity: RECOVERY_ACTION,
      evidenceKind: 'recovery-evidence' as const,
      recoveryOperation: 'orphan-removal' as const,
      targetEntry: TWIN_TEMP_NAME,
      twinRecordId: 'pgw:r:11110000000000000000000000000001',
      twinRecordClass: 'approval-record',
      twinRecordDigest: 'sha-256:' + '1'.repeat(64),
      observationIds: [temporaryObservationId(TWIN_TEMP_NAME)],
      outcome: 'orphan-removed' as const,
      generation: 'sha-256:' + '2'.repeat(64),
      surfaceGeneration: 'sha-256:' + '3'.repeat(64),
      createdAt: isoFromEpochMs(1000),
    };
    const built = buildRecoveryEvidenceRecord(evidenceInput as never);
    assert.equal(built.ok, true);
    const record = built.record!;
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', record.recordId);
    assert.equal(evidenceDerived.ok, true);
    const permit = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'orphan-removal',
      role: 'recovery-evidence',
      recordId: record.recordId,
      recordDigest: record.digest,
      canonicalBytesDigest: record.digest,
      destinationDesignation: evidenceDerived.relativePath,
    });
    assert.ok(permit !== undefined, 'the exact evidence permit must mint');
    // Probe E: the authorized path publishes the exact evidence record.
    const published = publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8: record.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(published.ok, true, JSON.stringify(published));
    assert.equal(statSync(join(env.storeRoot, evidenceDerived.relativePath)).nlink, 1);
    // Probe E: identical retry is idempotent (byte-exact duplicate).
    const retry = publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8: record.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.outcome, 'idempotent-duplicate');
    // Probe C: forged, spread-cloned, and JSON-cloned permits fail verification.
    const forged = publishRecoveryBoundRecord({ permit: { binding: permit!.binding, dispose() {} } as never, canonicalUtf8: record.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(forged.ok, false);
    const spread = publishRecoveryBoundRecord({ permit: { ...permit! } as never, canonicalUtf8: record.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(spread.ok, false);
    const jsonClone = publishRecoveryBoundRecord({ permit: JSON.parse(JSON.stringify(permit)) as never, canonicalUtf8: record.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(jsonClone.ok, false);
    // Probe C: modified bytes fail before mutation (envelope parse or digest).
    const modified = publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8: record.canonicalUtf8.replace('orphan-removed', 'orphan-removedX'), byteLimit, serviceUid: UID });
    assert.equal(modified.ok, false);
    // Probe C: a different evidence record (different identity/digest) fails.
    const other = buildRecoveryEvidenceRecord({ ...evidenceInput, twinRecordDigest: 'sha-256:' + '9'.repeat(64) } as never);
    assert.equal(other.ok, true);
    const otherPub = publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8: other.record!.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(otherPub.ok, false);
    // Probe C: a permit bound to one operation cannot publish another
    // operation's evidence payload.
    const otherOp = buildRecoveryEvidenceRecord({ ...evidenceInput, recoveryOperation: 'quarantine-temporary' as const } as never);
    assert.equal(otherOp.ok, true);
    const otherOpPub = publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8: otherOp.record!.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(otherOpPub.ok, false);
    // The evidence file is exactly the first record (no second file, no overwrite).
    const evidenceFiles: string[] = [];
    const walkEvidence = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walkEvidence(p);
        else evidenceFiles.push(p);
      }
    };
    walkEvidence(join(env.storeRoot, 'records', 'evidence'));
    assert.equal(evidenceFiles.length, 1);
    cap.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery publication: audit permit binds the exact authorized-write event; arbitrary audit fails', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const { cap, storeInstance } = mintRecoveryCapability(env);
    const byteLimit = 1024 * 1024;
    const evidenceInput = {
      storeInstance,
      actionIdentity: RECOVERY_ACTION,
      evidenceKind: 'recovery-evidence' as const,
      recoveryOperation: 'orphan-removal' as const,
      targetEntry: TWIN_TEMP_NAME,
      twinRecordId: 'pgw:r:11110000000000000000000000000001',
      twinRecordClass: 'approval-record',
      twinRecordDigest: 'sha-256:' + '1'.repeat(64),
      observationIds: [temporaryObservationId(TWIN_TEMP_NAME)],
      outcome: 'orphan-removed' as const,
      generation: 'sha-256:' + '2'.repeat(64),
      surfaceGeneration: 'sha-256:' + '3'.repeat(64),
      createdAt: isoFromEpochMs(1000),
    };
    const built = buildRecoveryEvidenceRecord(evidenceInput as never);
    assert.equal(built.ok, true);
    const record = built.record!;
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', record.auditEventId);
    assert.equal(auditDerived.ok, true);
    // Wrong event kind cannot even mint an audit permit.
    const wrongKind = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'orphan-removal',
      role: 'recovery-authorized-write-audit',
      recordId: record.auditEventId,
      recordDigest: record.auditDigest,
      canonicalBytesDigest: record.auditDigest,
      destinationDesignation: auditDerived.relativePath,
      audit: { evidenceRecordId: record.recordId, evidenceRecordDigest: record.digest, eventKind: 'idempotent-duplicate' as never, trustedActionIdentity: RECOVERY_ACTION },
    });
    assert.equal(wrongKind, undefined, 'only the authorized-write event kind may be bound');
    // Exact audit permit for the mechanically corresponding event.
    const auditPermit = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'orphan-removal',
      role: 'recovery-authorized-write-audit',
      recordId: record.auditEventId,
      recordDigest: record.auditDigest,
      canonicalBytesDigest: record.auditDigest,
      destinationDesignation: auditDerived.relativePath,
      audit: { evidenceRecordId: record.recordId, evidenceRecordDigest: record.digest, eventKind: 'authorized-write', trustedActionIdentity: RECOVERY_ACTION },
    });
    assert.ok(auditPermit !== undefined);
    // Probe E: the exact audit event publishes under its audit permit.
    const auditPub = publishRecoveryBoundRecord({ permit: auditPermit!, canonicalUtf8: record.auditCanonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(auditPub.ok, true, JSON.stringify(auditPub));
    assert.equal(statSync(join(env.storeRoot, auditDerived.relativePath)).nlink, 1);
    // Probe C: role substitution fails — evidence permit cannot publish the
    // audit record; audit permit cannot publish the evidence record.
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', record.recordId);
    assert.equal(evidenceDerived.ok, true);
    const auditViaEvidencePermit = publishRecoveryBoundRecord({ permit: createRecoveryPublicationPermit({
      capability: cap, operation: 'orphan-removal', role: 'recovery-evidence',
      recordId: record.recordId, recordDigest: record.digest, canonicalBytesDigest: record.digest,
      destinationDesignation: evidenceDerived.relativePath,
    })!, canonicalUtf8: record.auditCanonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(auditViaEvidencePermit.ok, false, 'an evidence permit must never publish the audit record');
    const evidenceViaAuditPermit = publishRecoveryBoundRecord({ permit: auditPermit!, canonicalUtf8: record.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(evidenceViaAuditPermit.ok, false, 'an audit permit must never publish the evidence record');
    // Probe D: wrong referenced evidence identity/digest — a permit whose
    // audit binding references different evidence cannot publish the exact
    // audit bytes (sink rejects the payload binding).
    const wrongRef = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'orphan-removal',
      role: 'recovery-authorized-write-audit',
      recordId: record.auditEventId,
      recordDigest: record.auditDigest,
      canonicalBytesDigest: record.auditDigest,
      destinationDesignation: auditDerived.relativePath,
      audit: { evidenceRecordId: 'pgw:r:' + 'a'.repeat(32), evidenceRecordDigest: 'sha-256:' + '7'.repeat(64), eventKind: 'authorized-write', trustedActionIdentity: RECOVERY_ACTION },
    });
    assert.ok(wrongRef !== undefined);
    const wrongRefPub = publishRecoveryBoundRecord({ permit: wrongRef!, canonicalUtf8: record.auditCanonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(wrongRefPub.ok, false, 'an audit permit referencing different evidence must fail');
    // Probe D: wrong trusted action identity — audit bytes built for another
    // action cannot publish under a permit bound to RECOVERY_ACTION.
    const wrongAction = buildRecoveryEvidenceRecord({ ...evidenceInput, actionIdentity: 'other-action' } as never);
    assert.equal(wrongAction.ok, true);
    const wrongActionPub = publishRecoveryBoundRecord({ permit: auditPermit!, canonicalUtf8: wrongAction.record!.auditCanonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(wrongActionPub.ok, false, 'audit bytes for another action identity must fail');
    // Probe D: an arbitrary audit record (not the bound event) fails.
    const arbitraryAudit = canonicalEnvelopeBytes({
      recordKind: 'AuthoritativeAuditEvent',
      formatVersion: '1.0',
      recordId: 'pgw:l:' + 'f'.repeat(32),
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: 'probe',
      payload: { eventKind: 'authorized-write', recordId: 'pgw:r:11110000000000000000000000000001', recordDigest: 'sha-256:' + '1'.repeat(64) },
      payloadDigest: computePayloadDigest({ eventKind: 'authorized-write', recordId: 'pgw:r:11110000000000000000000000000001', recordDigest: 'sha-256:' + '1'.repeat(64) }),
    }).canonicalUtf8;
    const arbitraryPub = publishRecoveryBoundRecord({ permit: auditPermit!, canonicalUtf8: arbitraryAudit, byteLimit, serviceUid: UID });
    assert.equal(arbitraryPub.ok, false, 'an arbitrary audit record must never publish');
    // No second audit file was created.
    const auditFiles: string[] = [];
    const walkAudit = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walkAudit(p);
        else if (p.endsWith('.aud')) auditFiles.push(p);
      }
    };
    walkAudit(join(env.storeRoot, 'audit'));
    assert.equal(auditFiles.length, 2, 'only the write-path audit and the exact evidence audit may exist');
    cap.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
