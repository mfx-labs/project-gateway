/**
 * WP-8-E recovery tests: bounded recovery assessment and advisory recovery
 * plan (contract §16 CSA-001…015, §12 LOK-004…009, §19 LMT-006/010; WP-8-E
 * scope items 4–5).
 *
 * The tests prove: WPR-023 orphan-temporary classification (inode twin,
 * incomplete unpublished, malformed, other); persistent writer-lock
 * observation (present/foreign/malformed; nonce never disclosed);
 * incomplete primary/audit publication states; reconstruction candidates;
 * quarantine-eligible and disposition-required objects; recovery-plan
 * determinism and advisory-only structure; recovery fail-closed on limit
 * overrun; no mutation during the recovery scan; no raw path disclosure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, linkSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan } from '../../../src/storage/recovery/index.js';
import { canonicalEnvelopeBytes, computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { buildLockRecord, canonicalLockRecordBytes } from '../../../src/storage/locks/index.js';
import { jcsSerialize } from '../../../src/canonical/jcs.js';
import type { RecoveryAssessment, RecoveryPlan } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'recovery-test-action';

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
  readonly namespaceIdentities: readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[];
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8e-rec-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'recovery-bootstrap-action',
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
  const namespaceIdentities = (result.namespaceIdentities ?? []).map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
  assert.equal(namespaceIdentities.length, 2);
  return { dir, config, trustedInput: inputResult.input, limitProfile, namespaceIdentities };
}

function publish(env: TestEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }, revision = 1): void {
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
    revision,
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

function storePath(env: TestEnv): string {
  return join(env.dir, 'store-v1');
}

function scanRecovery(env: TestEnv): { readonly ok: boolean; readonly assessment?: RecoveryAssessment; readonly plan?: RecoveryPlan; readonly findings?: readonly { code: string; message: string }[] } {
  return runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
}

function treeSnapshot(root: string): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      const st = statSync(p);
      out.push(`${entry.name}|${st.size}|${st.mtimeMs}|${st.dev}|${st.ino}|${st.mode & 0o777}|${st.nlink}`);
      if (entry.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort().join('\n');
}

/** Write a canonical record envelope as a temporary object under tmp/. */
function writeTempRecord(env: TestEnv, name: string, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }): void {
  const model = {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload,
    payloadDigest: computePayloadDigest(payload),
  };
  writeFileSync(join(storePath(env), 'tmp', name), jcsSerialize(model), { mode: 0o600 });
}

test('recovery: verified records, verified audit, and a clean store produce an empty plan', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const result = scanRecovery(env);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    const assessment = result.assessment!;
    assert.equal(assessment.verifiedDurableRecords.length, 1);
    assert.equal(assessment.verifiedAuditEvidence.length, 1);
    assert.equal(assessment.orphanTemporaryObjects.length, 0);
    assert.equal(assessment.persistentLockObservations.length, 0);
    assert.equal(assessment.reconstructionCandidates.length, 0);
    assert.equal(assessment.quarantineEligible.length, 0);
    assert.equal(assessment.requiresDisposition.length, 0);
    assert.equal(assessment.findings.length, 0);
    // Parent-level report (F3): the 15 record-class directories that do not
    // exist (approval and audit-event exist — the store holds one record).
    assert.equal(result.findings?.length, 15);
    assert.ok(result.findings!.every((f) => f.code === 'ERR-STO-INTEGRITY' && f.message.startsWith('required record-class directory is absent: ')));
    assert.equal(result.findings!.some((f) => f.message === 'required audit class directory is absent: authoritative-audit-event'), false);
    const plan = result.plan!;
    assert.equal(plan.advisoryOnly, true);
    // WP-8-H: a store without a persistent registry index is a rebuild
    // candidate (missing → rebuild; derived cache, never a storage failure).
    assert.equal(plan.actions.length, 1);
    const rebuild = plan.actions[0]!;
    assert.equal(rebuild.category, 'registry-index-rebuild');
    assert.equal(rebuild.targetKind, 'index-object');
    assert.equal(rebuild.safety, 'safe');
    assert.equal(rebuild.requiredCapability, 'recovery');
    assert.equal(rebuild.requiredOperation, 'registry-index-rebuild');
    assert.equal(plan.summary.total, 1);
    assert.equal(plan.summary.safe, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: orphan temporaries classify per WPR-023 (a)-(d)', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    const derived = deriveRecordRelativePath('approval-record', recordId);
    assert.equal(derived.ok, true);
    const recordPath = join(storePath(env), derived.relativePath);
    // (a) inode twin of the published record (crash after link, before unlink).
    const twinName = 'pub-aaaaaaaaaaaaaaaa-1';
    linkSync(recordPath, join(storePath(env), 'tmp', twinName));
    // (b) complete unpublished temporary (canonical record bytes, no twin).
    writeTempRecord(env, 'pub-bbbbbbbbbbbbbbbb-0', 'pgw:r:22220000000000000000000000000002');
    // (c) malformed temporary.
    writeFileSync(join(storePath(env), 'tmp', 'pub-cccccccccccccccc-0'), '{broken', { mode: 0o600 });
    // (d) non-regular temporary.
    symlinkSync('does-not-exist', join(storePath(env), 'tmp', 'pub-dddddddddddddddd-0'));

    const result = scanRecovery(env);
    assert.equal(result.ok, true);
    const assessment = result.assessment!;
    const byEntry = new Map(assessment.orphanTemporaryObjects.map((o) => [o.entry, o.classification]));
    assert.equal(byEntry.get(twinName), 'orphan-referencing-published');
    assert.equal(byEntry.get('pub-bbbbbbbbbbbbbbbb-0'), 'incomplete-unpublished');
    assert.equal(byEntry.get('pub-cccccccccccccccc-0'), 'malformed-temporary');
    assert.equal(byEntry.get('pub-dddddddddddddddd-0'), 'temporary-other');
    const twin = assessment.orphanTemporaryObjects.find((o) => o.entry === twinName);
    assert.equal(twin?.sharesInodeWithPublished, true);
    // Quarantine-eligible: the four temporaries PLUS the twin-linked record
    // itself (its link count is unexpected, so it fails verification);
    // (d) requires disposition.
    assert.equal(assessment.quarantineEligible.length, 5);
    assert.ok(assessment.quarantineEligible.some((q) => q.classification === 'unexpected-hard-link'));
    assert.ok(assessment.requiresDisposition.some((d) => d.classification === 'temporary-other'));
    // Plan: (a) safe orphan-removal; (b)/(c) safe quarantine; (d) disposition-led.
    const plan = result.plan!;
    const removal = plan.actions.find((a) => a.category === 'orphan-removal');
    assert.ok(removal !== undefined);
    assert.equal(removal.safety, 'safe');
    assert.equal(removal.requiredCapability, 'recovery');
    assert.equal(removal.verifyImmediatelyBeforeMutation, true);
    // WP-8-F: the (a) observation now carries the twin's envelope facts, so
    // the plan target is the twin's logical identity (never a path).
    assert.equal(removal.targetLogicalIdentity, 'pgw:r:11110000000000000000000000000001');
    // (b) and (c) quarantine safely; (d) is disposition-led quarantine.
    const quarantines = plan.actions.filter((a) => a.category === 'quarantine');
    assert.equal(quarantines.length, 3);
    assert.equal(quarantines.filter((a) => a.safety === 'safe').length, 2);
    assert.ok(plan.actions.some((a) => a.category === 'disposition' && a.safety === 'requires-external-disposition'));
    assert.ok(quarantines.some((a) => a.safety === 'requires-external-disposition' && a.requiredOperation === 'dispose-wpr023d-temporary'));
    // Every action carries the full required shape (the missing-index
    // rebuild action has no observation evidence by construction; WP-8-H).
    for (const action of plan.actions) {
      if (action.category === 'registry-index-rebuild' && action.targetLogicalIdentity === 'registry-index') continue;
      assert.ok(action.targetLogicalIdentity.length > 0);
      assert.ok(action.observedEvidence.length >= 1);
      assert.ok(action.reason.length > 0);
      assert.ok(['recovery', 'control-plane'].includes(action.requiredCapability));
      assert.equal(typeof action.verifyImmediatelyBeforeMutation, 'boolean');
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: persistent writer-lock observations are never liveness-assumed', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const lock = buildLockRecord({
      storeInstance: env.namespaceIdentities,
      actionIdentity: WRITE_ACTION,
      serviceUid: UID,
      lockWaitMs: 5000,
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    writeFileSync(join(storePath(env), 'locks', 'writer.lock'), canonicalLockRecordBytes(lock), { mode: 0o600 });
    const result = scanRecovery(env);
    assert.equal(result.ok, true);
    const assessment = result.assessment!;
    assert.equal(assessment.persistentLockObservations.length, 1);
    const lockObs = assessment.persistentLockObservations[0]!;
    assert.equal(lockObs.classification, 'writer-lock-present');
    assert.equal(lockObs.parseable, true);
    assert.equal(lockObs.storeInstanceMatches, true);
    assert.equal(lockObs.bootIdentityPresent, false);
    const serialized = JSON.stringify(assessment);
    assert.ok(!serialized.includes(lock.nonce), 'the lock nonce must never be disclosed');
    // Plan: lock recovery is unsafe and requires explicit external
    // adjudication through the exact break-writer-lock operation (WP-8-J).
    const plan = result.plan!;
    const lockAction = plan.actions.find((a) => a.category === 'lock-recovery');
    assert.ok(lockAction !== undefined);
    assert.equal(lockAction.safety, 'unsafe');
    assert.equal(lockAction.requiredCapability, 'recovery');
    assert.equal(lockAction.requiredOperation, 'break-writer-lock');
    assert.equal(lockAction.verifyImmediatelyBeforeMutation, true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: foreign and malformed locks require disposition', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    // Foreign: lock record naming a different store instance.
    const foreign = buildLockRecord({
      storeInstance: [{ kind: 'configuration', dev: 1, ino: 1 }, { kind: 'store-records', dev: 1, ino: 1 }],
      actionIdentity: WRITE_ACTION,
      serviceUid: UID,
      lockWaitMs: 5000,
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    writeFileSync(join(storePath(env), 'locks', 'writer.lock'), canonicalLockRecordBytes(foreign), { mode: 0o600 });
    let result = scanRecovery(env);
    assert.equal(result.ok, true);
    assert.equal(result.assessment!.persistentLockObservations[0]?.classification, 'writer-lock-foreign');
    assert.equal(result.assessment!.persistentLockObservations[0]?.storeInstanceMatches, false);
    // Malformed: non-canonical bytes.
    writeFileSync(join(storePath(env), 'locks', 'writer.lock'), 'not json', { mode: 0o600 });
    result = scanRecovery(env);
    assert.equal(result.ok, true);
    assert.equal(result.assessment!.persistentLockObservations[0]?.classification, 'writer-lock-malformed');
    assert.ok(result.plan!.actions.some((a) => a.category === 'disposition' && a.safety === 'requires-external-disposition'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: missing audit produces reconstruction candidates; dangling audit requires disposition', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    // Remove the audit event: durable primary without audit evidence.
    const auditFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.aud')) auditFiles.push(p);
      }
    };
    walk(join(storePath(env), 'audit'));
    assert.equal(auditFiles.length, 1);
    const auditPath = auditFiles[0]!;
    const auditBytes = readFileSync(auditPath);
    rmSync(auditPath);
    const result = scanRecovery(env);
    assert.equal(result.ok, true);
    const assessment = result.assessment!;
    assert.equal(assessment.reconstructionCandidates.length, 1);
    assert.equal(assessment.reconstructionCandidates[0]?.recordId, recordId);
    assert.ok(assessment.incompletePublicationStates.some((s) => s.kind === 'missing-audit'));
    const plan = result.plan!;
    const reconstruction = plan.actions.find((a) => a.category === 'audit-reconstruction');
    assert.ok(reconstruction !== undefined);
    assert.equal(reconstruction.safety, 'safe');
    assert.equal(reconstruction.requiredCapability, 'recovery');
    assert.equal(reconstruction.requiredOperation, 'audit-reconstruction');
    // Dangling audit: rewrite the event in place with a payload referencing a
    // primary that does not exist. The event identity is unchanged, so its
    // derived path is the original path; the payload digest is recomputed so
    // the event itself verifies (association is what dangles).
    const auditModel = JSON.parse(auditBytes.toString('utf8')) as Record<string, unknown>;
    const payload = auditModel['payload'] as Record<string, unknown>;
    payload['recordId'] = 'pgw:r:99990000000000000000000000000009';
    payload['recordDigest'] = 'sha-256:' + 'f'.repeat(64);
    auditModel['payload'] = payload;
    auditModel['payloadDigest'] = computePayloadDigest(payload);
    const canonical = canonicalEnvelopeBytes(auditModel);
    writeFileSync(auditPath, canonical.canonicalUtf8, { mode: 0o600 });
    const result2 = scanRecovery(env);
    assert.equal(result2.ok, true);
    const assessment2 = result2.assessment!;
    assert.ok(assessment2.incompletePublicationStates.some((s) => s.kind === 'dangling-audit'));
    assert.ok(assessment2.requiresDisposition.some((d) => d.classification === 'dangling-audit'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: recovery scan fails closed on entry-limit overrun', () => {
  const env = makeStore(profile({ recoveryScanEntries: 2 }));
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-LIMIT-EXCEEDED');
    assert.equal(result.assessment, undefined);
    assert.equal(result.plan, undefined);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: no mutation during the recovery scan; no raw path disclosure', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    writeFileSync(join(storePath(env), 'tmp', 'pub-aaaaaaaaaaaaaaaa-0'), '{broken', { mode: 0o600 });
    const before = treeSnapshot(storePath(env));
    const result = scanRecovery(env);
    assert.equal(result.ok, true);
    const after = treeSnapshot(storePath(env));
    assert.equal(after, before, 'the recovery scan must not mutate the store');
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(env.dir), 'recovery output discloses the store path');
    assert.ok(!serialized.includes('store-v1'), 'recovery output discloses a namespace path segment');
    assert.ok(!serialized.includes('sha-256:' + 'f'.repeat(64)), 'no fabricated digest material');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: assessment and plan are deterministic and advisory data', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
    writeFileSync(join(storePath(env), 'tmp', 'pub-aaaaaaaaaaaaaaaa-0'), '{broken', { mode: 0o600 });
    const a = scanRecovery(env);
    const b = scanRecovery(env);
    assert.deepEqual(a.assessment, b.assessment, 'assessments must be reproducible');
    assert.deepEqual(a.plan, b.plan, 'plans must be reproducible');
    assert.equal(a.plan!.advisoryOnly, true);
    const roundTripped = JSON.parse(JSON.stringify(a.plan!)) as RecoveryPlan;
    assert.deepEqual(roundTripped, a.plan);
    assert.equal(typeof (a.plan as unknown as Record<string, unknown>)['execute'], 'undefined');
    assert.ok(a.plan!.summary.total >= 1);
    assert.equal(a.plan!.summary.safe + a.plan!.summary.unsafe + a.plan!.summary.requiresExternalDisposition, a.plan!.summary.total);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
