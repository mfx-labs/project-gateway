/**
 * WP-8-L retention, legal hold, and exact deletion tests (contract §15.4,
 * RNT-011…020; ADR-035): separate private retention authority domain
 * (recovery authority never performs retention deletion and vice versa),
 * the hold-state generation freshness model (active/unknown/stale/clear
 * adjudications; generation mismatch; hold appearing after intent),
 * WP-8-K history binding eligibility (clean complete lineage only;
 * reconstructed gaps and contested lineages fail closed), exact primary
 * record deletion (no cascade, audits survive, registry no longer shows the
 * primary), stricter audit-event deletion (referenced primary absent +
 * durable primary-deletion completion evidence), durable intent/completion
 * evidence with deterministic identities, the full idempotency table, and
 * the fixed crash inventories for both target classes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, mkdirSync, symlinkSync, unlinkSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import {
  createStorageBootstrapActionProvenance,
  createStorageWriteActionProvenance,
  createRetentionActionProvenance,
  createRecoveryActionProvenance,
  createTrustedStorageBootstrapInput,
  createTrustedRecoveryRequest,
} from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { inspectAuditHistory } from '../../../src/storage/read/index.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { runRecoveryScan, executeRecoveryMutation } from '../../../src/storage/recovery/index.js';
import { computeScanGeneration, recomputeSurfaceGeneration } from '../../../src/storage/recovery/scan.js';
import { executeRetentionMutation, computeRetentionHoldStateGeneration, retentionHistoryBindingDigest, computeRetentionRecordIntentIdentity, computeRetentionRecordCompletionIdentity } from '../../../src/storage/retention/index.js';
import { createRetentionCapability, createRecoveryCapability, createInitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import { buildAuthorizedWriteAuditEvent, buildRecoveryAuditReconstructionEvent } from '../../../src/storage/audit/write-audit.js';
import { computePayloadDigest, canonicalEnvelopeBytes } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import type { AuditHistoryInspectionResult, InspectAuditHistoryRequest, RetentionMutationRequest, RetentionMutationStage, RetentionMutationResult, RetentionHoldResult } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const CONFIG_IDENTITY_B = 'sha-256:' + 'b'.repeat(64);
const WRITE_ACTION = 'wp8l-writer';
const RETENTION_ACTION = 'wp8l-retention';
const RECOVERY_ACTION = 'wp8l-recovery';
const POLICY_IDENTITY = 'wp8l-policy-1';
const POLICY_VERSION = '1.0';
const DECISION_ID = 'wp8l-decision-1';
const RECORD_ID = 'pgw:r:11110000000000000000000000000001';
const OTHER_RECORD_ID = 'pgw:r:22220000000000000000000000000002';

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
  readonly storeInstance: ReturnType<typeof verifyStoreInstance>['storeInstance'];
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8l-rt-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8l-bootstrap',
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
  const storeResult = verifyStoreInstance({ locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile });
  assert.equal(storeResult.ok, true);
  return { dir, config, trustedInput: inputResult.input, limitProfile, storeRoot: `${dir}/store-v1`, storeInstance: storeResult.storeInstance! };
}

function namespaces(env: TestEnv): readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[] {
  return env.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
}

interface PublishedFacts {
  readonly recordId: string;
  readonly revision: number;
  readonly digest: string;
  readonly auditEventId: string;
  readonly auditDigest: string;
  readonly recordPath: string;
  readonly auditPath: string;
}

function publish(env: TestEnv, recordId: string, recordClass: string = 'validation-record'): PublishedFacts {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const payload = { validated: true };
  const createdAt = '2026-01-01T00:00:00.000Z';
  const record = {
    recordKind: 'ValidationRecord',
    formatVersion: '1.0',
    recordId,
    revision: 1,
    createdAt,
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
    recordClass: recordClass as never,
    record,
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: namespaces(env),
    primaryClass: recordClass,
    primaryRecordId: recordId,
    primaryRevision: 1,
    primaryDigest: result.recordDigest!,
    eventKind: 'authorized-write',
    trustedActionIdentity: WRITE_ACTION,
    primaryCreatedAt: createdAt,
  });
  assert.equal(audit.ok, true);
  const event = audit.event!;
  const recordDerived = deriveRecordRelativePath(recordClass as never, recordId);
  const auditDerived = deriveRecordRelativePath('authoritative-audit-event', event.recordId);
  assert.equal(recordDerived.ok && auditDerived.ok, true);
  return {
    recordId,
    revision: 1,
    digest: result.recordDigest!,
    auditEventId: event.recordId,
    auditDigest: event.digest,
    recordPath: `${env.storeRoot}/${(recordDerived as { readonly ok: true; readonly relativePath: string }).relativePath}`,
    auditPath: `${env.storeRoot}/${(auditDerived as { readonly ok: true; readonly relativePath: string }).relativePath}`,
  };
}

function history(env: TestEnv, recordId: string): AuditHistoryInspectionResult {
  const request: InspectAuditHistoryRequest = {
    trustedConfiguration: env.config,
    trustedInput: env.trustedInput,
    recordClass: 'validation-record',
    recordId,
  };
  return inspectAuditHistory(request);
}

/** The trusted decision's history binding (WP-8-K result → deterministic digest). */
function historyBinding(env: TestEnv, recordId: string): { readonly digest: string; readonly status: 'complete' } {
  const result = history(env, recordId);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.status, 'complete', `expected a complete history, got ${result.status}`);
  const digest = retentionHistoryBindingDigest(result);
  assert.ok(digest !== undefined);
  return { digest, status: 'complete' };
}

/** Registry-mode decision tokens (the trusted decision's snapshot bindings). */
function decisionTokens(env: TestEnv): { readonly generation: string; readonly surfaceGeneration: string } {
  const p = env.limitProfile;
  const generation = computeScanGeneration({
    storeInstance: env.storeInstance!,
    mode: 'registry',
    entryLimit: p['totalScanEntries'] ?? 1024 * 1024,
    byteLimit: p['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
    failClosed: true,
  });
  const surface = recomputeSurfaceGeneration({ namespaceRoot: env.storeRoot, serviceUid: UID, mode: 'registry' });
  assert.equal(surface.ok, true, surface.message ?? 'surface recomputation failed');
  return { generation, surfaceGeneration: surface.generation! };
}

function holdGeneration(identity: string = CONFIG_IDENTITY, version = '1'): string {
  return computeRetentionHoldStateGeneration({ configurationIdentity: identity, configurationVersion: version });
}

function retentionProvenance(env: TestEnv, actionIdentity: string = RETENTION_ACTION, identity: string = CONFIG_IDENTITY): ReturnType<typeof createRetentionActionProvenance> {
  return createRetentionActionProvenance({
    actionIdentity,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: identity,
    limitProfile: env.limitProfile,
  });
}

interface RecordDeleteRequestFacts {
  readonly targetRecordId: string;
  readonly targetRecordDigest: string;
  readonly targetRevision: number;
  readonly historyDigest: string;
  readonly holdResult?: RetentionHoldResult;
  readonly holdStateGeneration?: string;
  readonly policyIdentity?: string;
  readonly policyVersion?: string;
  readonly decisionId?: string;
  readonly generation?: string;
  readonly surfaceGeneration?: string;
}

function recordDeleteRequest(env: TestEnv, facts: RecordDeleteRequestFacts, overrides: Partial<RetentionMutationRequest> = {}): RetentionMutationRequest {
  const tokens = decisionTokens(env);
  const action = {
    category: 'retention-delete-record' as const,
    targetRecordClass: 'validation-record' as const,
    targetRecordId: facts.targetRecordId,
    expectedTargetRevision: facts.targetRevision,
    targetRecordDigest: facts.targetRecordDigest,
    expectedPolicyIdentity: facts.policyIdentity ?? POLICY_IDENTITY,
    expectedPolicyVersion: facts.policyVersion ?? POLICY_VERSION,
    expectedDecisionId: facts.decisionId ?? DECISION_ID,
    expectedHoldStateGeneration: facts.holdStateGeneration ?? holdGeneration(),
    expectedHoldResult: facts.holdResult ?? 'clear-current-hold-state',
    expectedHistoryDigest: facts.historyDigest,
    expectedHistoryStatus: 'complete' as const,
    expectedGeneration: facts.generation ?? tokens.generation,
    expectedSurfaceGeneration: facts.surfaceGeneration ?? tokens.surfaceGeneration,
  };
  return {
    trustedConfiguration: env.config,
    retentionActionProvenance: retentionProvenance(env),
    trustedInput: env.trustedInput,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    action,
    timeSource: { now: () => 1000, processStartTime: 500 },
    ...overrides,
  };
}

function deleteRecord(env: TestEnv, facts: RecordDeleteRequestFacts, overrides: Partial<RetentionMutationRequest> = {}): RetentionMutationResult {
  return executeRetentionMutation(recordDeleteRequest(env, facts, overrides));
}

/** Happy-path facts for a freshly published record (publishes it). */
function defaultDeleteFacts(env: TestEnv, recordId: string = RECORD_ID): { readonly published: PublishedFacts } & RecordDeleteRequestFacts {
  const published = publish(env, recordId);
  const binding = historyBinding(env, recordId);
  return { published, targetRecordId: recordId, targetRecordDigest: published.digest, targetRevision: published.revision, historyDigest: binding.digest };
}

/** Intent identity helper (deterministic; matches the mutation's derivation). */
function intentIdOf(env: TestEnv, facts: RecordDeleteRequestFacts): string {
  return computeRetentionRecordIntentIdentity({
    storeInstance: env.storeInstance!,
    retentionOperation: 'retention-delete-record',
    targetRecordClass: 'validation-record',
    targetRecordId: facts.targetRecordId,
    targetRecordRevision: facts.targetRevision,
    targetRecordDigest: facts.targetRecordDigest,
    policyIdentity: facts.policyIdentity ?? POLICY_IDENTITY,
    policyVersion: facts.policyVersion ?? POLICY_VERSION,
    decisionId: facts.decisionId ?? DECISION_ID,
    holdStateGeneration: facts.holdStateGeneration ?? holdGeneration(),
    holdResult: facts.holdResult ?? 'clear-current-hold-state',
    historyDigest: facts.historyDigest,
    historyStatus: 'complete',
  });
}

function completionIdOf(env: TestEnv, facts: RecordDeleteRequestFacts): string {
  return computeRetentionRecordCompletionIdentity({
    storeInstance: env.storeInstance!,
    retentionOperation: 'retention-delete-record',
    intentEvidenceId: intentIdOf(env, facts),
    targetRecordClass: 'validation-record',
    targetRecordId: facts.targetRecordId,
    targetRecordRevision: facts.targetRevision,
    targetRecordDigest: facts.targetRecordDigest,
    outcome: 'deleted',
  });
}

function evidencePath(env: TestEnv, evidenceId: string): string {
  const derived = deriveRecordRelativePath('store-evidence-record', evidenceId);
  assert.equal(derived.ok, true);
  return `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
}

interface AuditDeleteRequestFacts {
  readonly targetRecordId: string;
  readonly targetRecordDigest: string;
  readonly targetRevision: number;
  readonly referencedRecordId: string;
  readonly referencedRecordDigest: string;
  readonly referencedRecordClass: 'validation-record';
  readonly primaryDeletionCompletionEvidenceId: string;
  readonly holdResult?: RetentionHoldResult;
}

function auditDeleteRequest(env: TestEnv, facts: AuditDeleteRequestFacts, overrides: Partial<RetentionMutationRequest> = {}): RetentionMutationRequest {
  const tokens = decisionTokens(env);
  const action = {
    category: 'retention-delete-audit' as const,
    targetRecordClass: 'authoritative-audit-event' as const,
    targetRecordId: facts.targetRecordId,
    expectedTargetRevision: facts.targetRevision,
    targetRecordDigest: facts.targetRecordDigest,
    referencedRecordId: facts.referencedRecordId,
    referencedRecordDigest: facts.referencedRecordDigest,
    referencedRecordClass: facts.referencedRecordClass,
    expectedPrimaryDeletionCompletionEvidenceId: facts.primaryDeletionCompletionEvidenceId,
    expectedPolicyIdentity: POLICY_IDENTITY,
    expectedPolicyVersion: POLICY_VERSION,
    expectedDecisionId: DECISION_ID,
    expectedHoldStateGeneration: holdGeneration(),
    expectedHoldResult: facts.holdResult ?? 'clear-current-hold-state',
    expectedGeneration: tokens.generation,
    expectedSurfaceGeneration: tokens.surfaceGeneration,
  };
  return {
    trustedConfiguration: env.config,
    retentionActionProvenance: retentionProvenance(env),
    trustedInput: env.trustedInput,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    action,
    timeSource: { now: () => 1000, processStartTime: 500 },
    ...overrides,
  };
}

function deleteAudit(env: TestEnv, facts: AuditDeleteRequestFacts, overrides: Partial<RetentionMutationRequest> = {}): RetentionMutationResult {
  return executeRetentionMutation(auditDeleteRequest(env, facts, overrides));
}

function reconstructAudit(env: TestEnv): void {
  const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(scan.ok, true, JSON.stringify(scan.findings));
  const candidate = scan.assessment!.reconstructionCandidates.find((c) => c.recordId === RECORD_ID);
  assert.ok(candidate !== undefined);
  const provenance = createRecoveryActionProvenance({
    actionIdentity: RECOVERY_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const result = executeRecoveryMutation({
    trustedConfiguration: env.config,
    recoveryActionProvenance: provenance,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: env.limitProfile,
    action: {
      category: 'audit-reconstruction',
      targetRecordClass: 'validation-record',
      targetRecordId: RECORD_ID,
      targetRecordDigest: candidate.recordDigest,
      expectedOriginalActionIdentity: WRITE_ACTION,
      expectedObservationIds: [candidate.observationId],
      expectedMissingAuditFindingId: candidate.observationId,
      expectedGeneration: scan.assessment!.source.generation,
      expectedSurfaceGeneration: scan.assessment!.source.surfaceGeneration,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
}

/** Run a request with a simulated crash at one stage (throws inside the hook). */
function crashAt(request: () => RetentionMutationRequest, stage: RetentionMutationStage): boolean {
  let crashed = false;
  try {
    executeRetentionMutation({
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
  return crashed;
}

// ── Authority ──────────────────────────────────────────────────────────────

test('retention: genuine exact retention authority deletes the exact record', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const result = deleteRecord(env, facts);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'deleted');
    assert.ok(result.intentEvidenceId !== undefined && result.completionEvidenceId !== undefined);
    assert.equal(existsSync(published.recordPath), false);
    assert.equal(existsSync(published.auditPath), true, 'audits survive primary deletion');
    assert.equal(existsSync(evidencePath(env, result.intentEvidenceId!)), true);
    assert.equal(existsSync(evidencePath(env, result.completionEvidenceId!)), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: recovery authority is rejected and cannot perform retention deletion', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const recoveryProvenance = createRecoveryActionProvenance({
      actionIdentity: RECOVERY_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: env.limitProfile,
    });
    const request = recordDeleteRequest(env, { targetRecordId: RECORD_ID, targetRecordDigest: 'sha-256:' + 'c'.repeat(64), targetRevision: 1, historyDigest: 'sha-256:' + 'd'.repeat(64) }, {
      retentionActionProvenance: recoveryProvenance,
    } as Partial<RetentionMutationRequest>);
    const result = executeRetentionMutation(request);
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // The recovery mutation boundary never accepts a retention operation.
    const recoveryResult = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: recoveryProvenance,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      action: { category: 'retention-delete-record' },
      timeSource: { now: () => 1000, processStartTime: 500 },
    } as never);
    assert.equal(recoveryResult.ok, false);
    assert.equal(recoveryResult.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // The record is untouched.
    const derived = deriveRecordRelativePath('validation-record', RECORD_ID);
    assert.equal(derived.ok, true);
    assert.equal(existsSync(`${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: forged, cloned, and structural retention provenance is rejected', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const genuine = retentionProvenance(env);
    const clones: unknown[] = [
      { ...genuine },
      JSON.parse(JSON.stringify(genuine)),
      { actionIdentity: RETENTION_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile },
      Object.create(genuine),
    ];
    for (const clone of clones) {
      const request = recordDeleteRequest(env, { targetRecordId: RECORD_ID, targetRecordDigest: 'sha-256:' + 'c'.repeat(64), targetRevision: 1, historyDigest: 'sha-256:' + 'd'.repeat(64) }, {
        retentionActionProvenance: clone,
      } as Partial<RetentionMutationRequest>);
      const result = executeRetentionMutation(request);
      assert.equal(result.ok, false, 'a structural provenance clone must never establish retention authority');
      assert.equal(result.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    }
    // A structural "history result" grants nothing.
    const fake = { actionIdentity: RETENTION_ACTION, history: { status: 'complete' }, hold: { clear: true }, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile };
    const request = recordDeleteRequest(env, { targetRecordId: RECORD_ID, targetRecordDigest: 'sha-256:' + 'c'.repeat(64), targetRevision: 1, historyDigest: 'sha-256:' + 'd'.repeat(64) }, {
      retentionActionProvenance: fake,
    } as Partial<RetentionMutationRequest>);
    const result = executeRetentionMutation(request);
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: wrong store, wrong configuration correlation, and wrong history digest are rejected', () => {
  const env = makeStore();
  const other = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    // Wrong store: the request points at a different trusted parent.
    const wrongStore = deleteRecord(env, facts, { locator: other.dir } as Partial<RetentionMutationRequest>);
    assert.equal(wrongStore.ok, false);
    // Wrong configuration correlation: provenance bound to another identity.
    const wrongConfig = executeRetentionMutation({
      ...recordDeleteRequest(env, facts),
      retentionActionProvenance: retentionProvenance(env, RETENTION_ACTION, CONFIG_IDENTITY_B),
    });
    assert.equal(wrongConfig.ok, false);
    assert.equal(wrongConfig.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    // Wrong history digest: the decision bound a different history state.
    const wrongHistory = deleteRecord(env, { ...facts, historyDigest: 'sha-256:' + 'd'.repeat(64) });
    assert.equal(wrongHistory.ok, false);
    assert.equal(wrongHistory.outcome, 'history-incomplete');
    assert.equal(existsSync(published.recordPath), true, 'nothing may be deleted under a rejected decision');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test('retention: a recovery capability never verifies as a retention capability', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const provenance = createRecoveryActionProvenance({
      actionIdentity: RECOVERY_ACTION,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      configurationIdentity: CONFIG_IDENTITY,
      limitProfile: env.limitProfile,
    });
    const recoveryInput = createTrustedRecoveryRequest(env.config, provenance, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
    assert.equal(recoveryInput.ok, true);
    const recoveryCapability = createRecoveryCapability({ trustedRecoveryRequest: recoveryInput.request, storeInstance: env.storeInstance! });
    assert.ok(recoveryCapability !== undefined);
    // The retention creator rejects the recovery request operand outright.
    assert.equal(createRetentionCapability({ trustedRetentionRequest: recoveryInput.request, storeInstance: env.storeInstance! }), undefined);
    assert.equal((recoveryCapability.verify as (op: string) => { readonly ok: boolean; readonly reason?: string })('retention-delete-record').ok, false, 'the recovery capability operation set contains no retention operation');
    recoveryCapability.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Legal hold ─────────────────────────────────────────────────────────────

test('retention: active, unknown, and stale hold adjudications block deletion', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    for (const holdResult of ['active-hold', 'unknown-hold-state', 'stale-hold-decision'] as const) {
      const result = deleteRecord(env, { ...facts, holdResult });
      assert.equal(result.ok, false, holdResult);
      assert.equal(result.outcome, 'hold-blocked', holdResult);
      assert.equal(result.findings?.[0]?.code, 'ERR-STO-RETENTION-DENIED');
    }
    assert.equal(existsSync(published.recordPath), true, 'the record must remain');
    assert.equal(existsSync(evidencePath(env, intentIdOf(env, facts))), false, 'no intent may be published under a hold');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: hold-state generation mismatch (stale decision) blocks deletion', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const result = deleteRecord(env, { ...facts, holdStateGeneration: holdGeneration(CONFIG_IDENTITY_B) });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'hold-blocked');
    assert.equal(existsSync(published.recordPath), true, 'the record must remain');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: clear current hold state permits evaluation and deletion proceeds', () => {
  const env = makeStore();
  try {
    const { ...facts } = defaultDeleteFacts(env);
    const result = deleteRecord(env, { ...facts, holdResult: 'clear-current-hold-state' });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'deleted');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: a hold appearing after intent blocks the unlink (freshness race)', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    // Run 1: the intent becomes durable, then the trusted configuration
    // advances (a new hold) before the unlink — the capability generation
    // registry advances and the post-intent revalidation fails closed.
    let advanced = false;
    const run1 = deleteRecord(env, facts, {
      hooks: {
        stage: (s) => {
          if (s === 'after-intent-audit-publication' && !advanced) {
            advanced = true;
            // Simulate the control plane processing a new configuration
            // (new hold): a new initialization capability for the same
            // store identity with a different configuration identity
            // advances the in-process generation registry.
            const configB = genuineConfig(CONFIG_IDENTITY_B);
            const provenanceB = createStorageBootstrapActionProvenance({
              actionIdentity: 'wp8l-bootstrap-b',
              locator: env.dir,
              serviceUid: UID,
              forbiddenRoots: [],
              configurationIdentity: CONFIG_IDENTITY_B,
              limitProfile: env.limitProfile,
            });
            const inputB = createTrustedStorageBootstrapInput(configB, provenanceB, { locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: env.limitProfile });
            assert.equal(inputB.ok, true);
            const initCap = createInitializationCapability({ trustedInput: inputB.input, parentIdentity: env.storeInstance!.parentIdentity });
            assert.ok(initCap !== undefined);
            assert.equal(initCap.verify('namespace-initialize').ok, true);
            initCap.dispose();
          }
        },
      },
    });
    assert.equal(run1.ok, false, 'the unlink must fail when the hold state advances after intent');
    assert.equal(existsSync(published.recordPath), true, 'the record must not be deleted');
    assert.equal(existsSync(evidencePath(env, intentIdOf(env, facts))), true, 'the intent remains durable as historical evidence');
    assert.equal(existsSync(evidencePath(env, completionIdOf(env, facts))), false, 'no completion may exist');
    // The invalidated capability cannot release the identity-bound lock: the
    // lock remains for external recovery and is never auto-broken (fixture
    // release for the rerun, matching the accepted crash harness).
    const lockPath = `${env.storeRoot}/locks/writer.lock`;
    assert.equal(existsSync(lockPath), true, 'the mid-flight invalidation leaves the writer lock held');
    rmSync(lockPath);
    // Run 2 with the same decision and configuration: the matching durable
    // intent is continued (reverify → unlink → completion).
    const run2 = deleteRecord(env, facts);
    assert.equal(run2.ok, true, JSON.stringify(run2.findings));
    assert.equal(run2.outcome, 'deleted');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── History binding ────────────────────────────────────────────────────────

test('retention: incomplete, ambiguous, and reconstructed-gap histories fail closed', () => {
  const env = makeStore();
  try {
    const published = publish(env, RECORD_ID);
    const binding = historyBinding(env, RECORD_ID);
    const facts = { targetRecordId: RECORD_ID, targetRecordDigest: published.digest, targetRevision: published.revision, historyDigest: binding.digest };
    // Incomplete: the original audit is missing.
    unlinkSync(published.auditPath);
    let result = deleteRecord(env, facts);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'history-incomplete');
    // Reconstructed gap: the WP-8-G reconstruction is durable.
    reconstructAudit(env);
    const bindingAfter = history(env, RECORD_ID);
    assert.equal(bindingAfter.status, 'reconstructed-gap');
    result = deleteRecord(env, facts);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'history-incomplete', 'reconstructed gaps are not retention-eligible in this slice');
    assert.equal(existsSync(published.recordPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: truncated history (continuation required) is rejected', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const published = publish(env, RECORD_ID);
    // Two reconstruction events for the same target force a continuation at
    // a results budget of 1 (two verified events).
    unlinkSync(published.auditPath);
    const writeReconstruction = (recoveryAction: string, recoveryTime: string): void => {
      const built = buildRecoveryAuditReconstructionEvent({
        storeInstance: namespaces(env),
        primaryClass: 'validation-record',
        primaryRecordId: RECORD_ID,
        primaryRevision: 1,
        primaryDigest: published.digest,
        recoveryActionIdentity: recoveryAction,
        recoveryTime,
      });
      assert.equal(built.ok, true);
      const derived = deriveRecordRelativePath('authoritative-audit-event', built.event!.recordId);
      assert.equal(derived.ok, true);
      const path = `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
      mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
      writeFileSync(path, built.event!.canonicalUtf8, { mode: 0o600 });
      chmodSync(path, 0o600);
    };
    writeReconstruction('recovery-one', '2026-01-02T00:00:00.000Z');
    writeReconstruction('recovery-two', '2026-01-03T00:00:00.000Z');
    const inspected = history(env, RECORD_ID);
    assert.equal(inspected.completeness?.truncated, true, 'the results budget must force a continuation');
    const result = deleteRecord(env, { targetRecordId: RECORD_ID, targetRecordDigest: published.digest, targetRevision: 1, historyDigest: 'sha-256:' + 'f'.repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'history-incomplete');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: history changed after intent fails closed before unlink', () => {
  const env = makeStore();
  try {
    const published = publish(env, RECORD_ID);
    const binding = historyBinding(env, RECORD_ID);
    const facts = { targetRecordId: RECORD_ID, targetRecordDigest: published.digest, targetRevision: published.revision, historyDigest: binding.digest };
    let changed = false;
    const result = deleteRecord(env, facts, {
      hooks: {
        stage: (s) => {
          if (s === 'after-intent-audit-publication' && !changed) {
            changed = true;
            // A target-affecting audit event disappears after intent.
            unlinkSync(published.auditPath);
          }
        },
      },
    });
    assert.equal(result.ok, false, 'a history change after intent must fail closed before unlink');
    assert.equal(existsSync(published.recordPath), true, 'the target must remain');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: conflicting audit lineages are rejected', () => {
  const env = makeStore();
  try {
    const published = publish(env, RECORD_ID);
    // A second authorized-write claim with the same target but a different
    // action (a contested lineage).
    const dup = buildAuthorizedWriteAuditEvent({
      storeInstance: namespaces(env),
      primaryClass: 'validation-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: published.digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: 'another-action',
      primaryCreatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(dup.ok, true);
    const dupDerived = deriveRecordRelativePath('authoritative-audit-event', dup.event!.recordId);
    assert.equal(dupDerived.ok, true);
    const dupPath = `${env.storeRoot}/${(dupDerived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
    mkdirSync(dupPath.slice(0, dupPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(dupPath, dup.event!.canonicalUtf8, { mode: 0o600 });
    chmodSync(dupPath, 0o600);
    const inspected = history(env, RECORD_ID);
    assert.equal(inspected.status, 'ambiguous-history');
    const result = deleteRecord(env, { targetRecordId: RECORD_ID, targetRecordDigest: published.digest, targetRevision: published.revision, historyDigest: 'sha-256:' + 'f'.repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'history-incomplete');
    assert.equal(existsSync(published.recordPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Primary deletion ───────────────────────────────────────────────────────

test('retention: exact record only — unrelated records and all audits survive', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const other = publish(env, OTHER_RECORD_ID);
    const result = deleteRecord(env, facts);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(existsSync(published.recordPath), false);
    assert.equal(existsSync(other.recordPath), true, 'unrelated records survive');
    assert.equal(existsSync(published.auditPath), true, 'the deleted record audits survive (no cascade)');
    assert.equal(existsSync(other.auditPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: a replacement target after intent is never deleted', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    let replaced = false;
    const result = deleteRecord(env, facts, {
      hooks: {
        stage: (s) => {
          if (s === 'after-intent-audit-publication' && !replaced) {
            replaced = true;
            const replacement = canonicalEnvelopeBytes({
              recordKind: 'ValidationRecord',
              formatVersion: '1.0',
              recordId: RECORD_ID,
              revision: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              trustedActionId: WRITE_ACTION,
              payload: { validated: true, replacement: true },
              payloadDigest: computePayloadDigest({ validated: true, replacement: true }),
            }).canonicalUtf8;
            rmSync(published.recordPath);
            writeFileSync(published.recordPath, replacement, { mode: 0o600 });
            chmodSync(published.recordPath, 0o600);
          }
        },
      },
    });
    assert.equal(result.ok, false, 'a replaced target must never be deleted');
    assert.equal(existsSync(published.recordPath), true, 'the replacement remains untouched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: a symlink replacement after intent fails closed', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    let replaced = false;
    const result = deleteRecord(env, facts, {
      hooks: {
        stage: (s) => {
          if (s === 'after-intent-audit-publication' && !replaced) {
            replaced = true;
            rmSync(published.recordPath);
            symlinkSync(`${env.dir}/outside`, published.recordPath);
          }
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(lstatSync(published.recordPath).isSymbolicLink(), true, 'the symlink remains (no follow, no delete)');
    assert.equal(existsSync(`${env.dir}/outside`), false, 'nothing outside the store may be touched');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: wrong digest, mode, and type reject the unlink', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    // Wrong digest in the trusted decision.
    let result = deleteRecord(env, { ...facts, targetRecordDigest: 'sha-256:' + 'f'.repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.equal(existsSync(published.recordPath), true);
    // Wrong mode: a permissive target fails the descriptor check.
    chmodSync(published.recordPath, 0o644);
    result = deleteRecord(env, facts);
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-PERM-DENIED');
    chmodSync(published.recordPath, 0o600);
    // Wrong type: a directory at the target location.
    rmSync(published.recordPath);
    mkdirSync(published.recordPath, { mode: 0o700 });
    result = deleteRecord(env, facts);
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-MALFORMED', 'the descriptor verification rejects a non-regular target');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: intent precedes unlink and completion follows directory fsync', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    let intentDurableAtIntent: boolean | undefined;
    let targetAtIntent: boolean | undefined;
    let completionAtFsync: boolean | undefined;
    const seen: RetentionMutationStage[] = [];
    const result = deleteRecord(env, facts, {
      hooks: {
        stage: (s) => {
          seen.push(s);
          if (s === 'after-intent-publication') {
            intentDurableAtIntent = existsSync(evidencePath(env, intentIdOf(env, facts)));
            targetAtIntent = existsSync(published.recordPath);
          }
          if (s === 'after-directory-fsync') {
            completionAtFsync = existsSync(evidencePath(env, completionIdOf(env, facts)));
          }
        },
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(intentDurableAtIntent, true, 'intent must be durable before the unlink');
    assert.equal(targetAtIntent, true, 'the target must still exist when the intent is durable');
    assert.equal(completionAtFsync, false, 'completion must not precede the directory fsync');
    assert.equal(existsSync(evidencePath(env, completionIdOf(env, facts))), true, 'completion is durable after the fsync');
    assert.deepEqual(seen, [
      'before-writer-lock', 'after-writer-lock', 'before-intent-publication', 'after-intent-publication', 'after-intent-audit-publication',
      'after-post-intent-revalidation', 'before-target-unlink', 'after-target-unlink', 'before-directory-fsync', 'after-directory-fsync',
      'before-completion-publication', 'after-completion-publication', 'after-completion-audit-publication', 'before-writer-lock-release',
    ] satisfies RetentionMutationStage[]);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: the registry no longer shows the deleted primary; audits remain observable', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const result = deleteRecord(env, facts);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true, JSON.stringify(scan.findings));
    assert.equal(scan.assessment!.verifiedDurableRecords.some((r) => r.recordId === RECORD_ID), false, 'the registry record set no longer shows the primary');
    assert.equal(scan.assessment!.verifiedAuditEvidence.some((e) => e.eventId === published.auditEventId), true, 'the surviving audit event remains observable');
    assert.equal(scan.assessment!.retentionSurvivors.some((s) => s.eventId === published.auditEventId), true, 'the audit is an intentional retention survivor');
    assert.equal(scan.assessment!.requiresDisposition.some((d) => d.observationId === published.auditEventId), false, 'the survivor is never a disposition candidate');
    assert.equal(scan.assessment!.retentionEvidenceStates.some((s) => s.state === 'completed' && s.targetRecordId === RECORD_ID), true, 'the deletion is classified completed');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Audit deletion ─────────────────────────────────────────────────────────

test('retention: audit deletion is prohibited while the referenced primary is present', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    // A completion evidence exists (from a prior deletion), but the primary
    // is live again — the audit gate must refuse on the live primary.
    const completionId = completionIdOf(env, facts);
    const completionBytes = canonicalEnvelopeBytes({
      recordKind: 'StoreEvidenceRecord',
      formatVersion: '1.0',
      recordId: completionId,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: RETENTION_ACTION,
      payload: {
        evidenceKind: 'retention-evidence',
        retentionOperation: 'retention-delete-record',
        intentEvidenceId: intentIdOf(env, facts),
        intentEvidenceDigest: 'sha-256:' + '1'.repeat(64),
        targetRecordClass: 'validation-record',
        targetRecordId: RECORD_ID,
        targetRecordRevision: 1,
        targetRecordDigest: published.digest,
        policyIdentity: POLICY_IDENTITY,
        policyVersion: POLICY_VERSION,
        decisionId: DECISION_ID,
        holdStateGeneration: holdGeneration(),
        holdResult: 'clear-current-hold-state',
        historyDigest: facts.historyDigest,
        outcome: 'deleted',
        generation: decisionTokens(env).generation,
        surfaceGeneration: decisionTokens(env).surfaceGeneration,
        resultingState: { recordAbsent: true },
      },
      payloadDigest: computePayloadDigest({}),
      referenceDigests: [published.digest],
    }).canonicalUtf8;
    const completionPath = evidencePath(env, completionId);
    mkdirSync(completionPath.slice(0, completionPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(completionPath, completionBytes, { mode: 0o600 });
    chmodSync(completionPath, 0o600);
    const result = deleteAudit(env, {
      targetRecordId: published.auditEventId,
      targetRecordDigest: published.auditDigest,
      targetRevision: 1,
      referencedRecordId: RECORD_ID,
      referencedRecordDigest: published.digest,
      referencedRecordClass: 'validation-record',
      primaryDeletionCompletionEvidenceId: completionId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-RETENTION-DENIED');
    assert.equal(existsSync(published.auditPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: audit deletion is prohibited when the primary is absent without completion evidence', () => {
  const env = makeStore();
  try {
    const published = publish(env, RECORD_ID);
    // Remove the primary WITHOUT any retention evidence (unexplained loss).
    rmSync(published.recordPath);
    const result = deleteAudit(env, {
      targetRecordId: published.auditEventId,
      targetRecordDigest: published.auditDigest,
      targetRevision: 1,
      referencedRecordId: RECORD_ID,
      referencedRecordDigest: published.digest,
      referencedRecordClass: 'validation-record',
      primaryDeletionCompletionEvidenceId: 'pgw:r:' + '0'.repeat(32),
    });
    assert.equal(result.ok, false);
    assert.equal(existsSync(published.auditPath), true, 'primary absence alone never authorizes audit deletion');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: exact audit deletion with the referenced primary completion evidence', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const other = publish(env, OTHER_RECORD_ID);
    const primary = deleteRecord(env, facts);
    assert.equal(primary.ok, true, JSON.stringify(primary.findings));
    const result = deleteAudit(env, {
      targetRecordId: published.auditEventId,
      targetRecordDigest: published.auditDigest,
      targetRevision: 1,
      referencedRecordId: RECORD_ID,
      referencedRecordDigest: published.digest,
      referencedRecordClass: 'validation-record',
      primaryDeletionCompletionEvidenceId: primary.completionEvidenceId!,
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'deleted');
    assert.equal(existsSync(published.auditPath), false, 'the exact audit event is deleted');
    assert.equal(existsSync(other.auditPath), true, 'unrelated audits survive');
    assert.equal(existsSync(other.recordPath), true, 'unrelated records survive');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: an audit replacement after intent is never deleted', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const primary = deleteRecord(env, facts);
    assert.equal(primary.ok, true, JSON.stringify(primary.findings));
    const auditFacts = {
      targetRecordId: published.auditEventId,
      targetRecordDigest: published.auditDigest,
      targetRevision: 1,
      referencedRecordId: RECORD_ID,
      referencedRecordDigest: published.digest,
      referencedRecordClass: 'validation-record' as const,
      primaryDeletionCompletionEvidenceId: primary.completionEvidenceId!,
    };
    let replaced = false;
    const result = deleteAudit(env, auditFacts, {
      hooks: {
        stage: (s) => {
          if (s === 'after-intent-audit-publication' && !replaced) {
            replaced = true;
            rmSync(published.auditPath);
            const replacement = canonicalEnvelopeBytes({
              recordKind: 'AuthoritativeAuditEvent',
              formatVersion: '1.0',
              recordId: published.auditEventId,
              revision: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              trustedActionId: WRITE_ACTION,
              payload: { eventKind: 'authorized-write', recordId: RECORD_ID, recordDigest: published.digest, tampered: true },
              payloadDigest: computePayloadDigest({ eventKind: 'authorized-write', recordId: RECORD_ID, recordDigest: published.digest, tampered: true }),
              referenceDigests: [published.digest],
            }).canonicalUtf8;
            mkdirSync(published.auditPath.slice(0, published.auditPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
            writeFileSync(published.auditPath, replacement, { mode: 0o600 });
            chmodSync(published.auditPath, 0o600);
          }
        },
      },
    });
    assert.equal(result.ok, false, 'a replaced audit target must never be deleted');
    assert.equal(existsSync(published.auditPath), true, 'the replacement remains');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Intent/completion idempotency ──────────────────────────────────────────

test('retention: deterministic identities and already-completed replay', () => {
  const env = makeStore();
  try {
    const { ...facts } = defaultDeleteFacts(env);
    const first = deleteRecord(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    const second = deleteRecord(env, facts);
    assert.equal(second.ok, true, JSON.stringify(second.findings));
    assert.equal(second.outcome, 'already-completed');
    assert.equal(second.intentEvidenceId, first.intentEvidenceId, 'the intent identity is deterministic');
    assert.equal(second.completionEvidenceId, first.completionEvidenceId, 'the completion identity is deterministic');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: crash roll-forward — target absent with matching intent completes safely', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    crashAt(() => recordDeleteRequest(env, facts), 'after-target-unlink');
    assert.equal(existsSync(published.recordPath), false);
    assert.equal(existsSync(evidencePath(env, intentIdOf(env, facts))), true, 'the intent is durable');
    rmSync(`${env.storeRoot}/locks/writer.lock`);
    const rerun = deleteRecord(env, facts);
    assert.equal(rerun.ok, true, JSON.stringify(rerun.findings));
    assert.equal(rerun.outcome, 'deleted', 'the rerun completes the deletion (roll-forward)');
    assert.ok(rerun.completionEvidenceId !== undefined);
    assert.equal(existsSync(evidencePath(env, rerun.completionEvidenceId!)), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: target absent without intent fails closed (no inference)', () => {
  const env = makeStore();
  try {
    const published = publish(env, RECORD_ID);
    const binding = historyBinding(env, RECORD_ID);
    rmSync(published.recordPath);
    const result = deleteRecord(env, { targetRecordId: RECORD_ID, targetRecordDigest: published.digest, targetRevision: published.revision, historyDigest: binding.digest });
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.equal(result.outcome, undefined, 'absence without intent never yields a completion outcome');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: conflicting durable intent (hold changed after intent) fails closed as hold-blocked', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    crashAt(() => recordDeleteRequest(env, facts), 'after-intent-audit-publication');
    rmSync(`${env.storeRoot}/locks/writer.lock`);
    // Tamper the durable intent's hold binding (a newer hold generation).
    const intentPath = evidencePath(env, intentIdOf(env, facts));
    const model = JSON.parse(readFileSync(intentPath, 'utf8')) as Record<string, unknown>;
    const payload = model['payload'] as Record<string, unknown>;
    payload['holdStateGeneration'] = holdGeneration(CONFIG_IDENTITY_B);
    model['payloadDigest'] = computePayloadDigest(payload);
    const envelope = canonicalEnvelopeBytes(model).canonicalUtf8;
    rmSync(intentPath);
    writeFileSync(intentPath, envelope, { mode: 0o600 });
    chmodSync(intentPath, 0o600);
    const rerun = deleteRecord(env, facts);
    assert.equal(rerun.ok, false);
    assert.equal(rerun.outcome, 'hold-blocked', 'a hold change after intent is a durable freshness failure');
    assert.equal(existsSync(published.recordPath), true, 'the record must remain');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: conflicting durable intent (policy changed after intent) fails closed as policy-blocked', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    crashAt(() => recordDeleteRequest(env, facts), 'after-intent-audit-publication');
    rmSync(`${env.storeRoot}/locks/writer.lock`);
    const intentPath = evidencePath(env, intentIdOf(env, facts));
    const model = JSON.parse(readFileSync(intentPath, 'utf8')) as Record<string, unknown>;
    const payload = model['payload'] as Record<string, unknown>;
    payload['policyIdentity'] = 'wp8l-policy-2';
    model['payloadDigest'] = computePayloadDigest(payload);
    const envelope = canonicalEnvelopeBytes(model).canonicalUtf8;
    rmSync(intentPath);
    writeFileSync(intentPath, envelope, { mode: 0o600 });
    chmodSync(intentPath, 0o600);
    const rerun = deleteRecord(env, facts);
    assert.equal(rerun.ok, false);
    assert.equal(rerun.outcome, 'policy-blocked', 'a policy change after intent is a durable policy freshness failure');
    assert.equal(existsSync(published.recordPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: target live with durable completion is an integrity inconsistency', () => {
  const env = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env);
    const first = deleteRecord(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    // Restore the record at its derived path (tamper/loss-undo).
    const original = canonicalEnvelopeBytes({
      recordKind: 'ValidationRecord',
      formatVersion: '1.0',
      recordId: RECORD_ID,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { validated: true },
      payloadDigest: computePayloadDigest({ validated: true }),
    }).canonicalUtf8;
    mkdirSync(published.recordPath.slice(0, published.recordPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(published.recordPath, original, { mode: 0o600 });
    chmodSync(published.recordPath, 0o600);
    const rerun = deleteRecord(env, facts);
    assert.equal(rerun.ok, false, 'completion evidence with a live target is an integrity inconsistency');
    assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('retention: conflicting completion evidence fails closed', () => {
  const env = makeStore();
  try {
    const { ...facts } = defaultDeleteFacts(env);
    const first = deleteRecord(env, facts);
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    const completionPath = evidencePath(env, first.completionEvidenceId!);
    const model = JSON.parse(readFileSync(completionPath, 'utf8')) as Record<string, unknown>;
    const payload = model['payload'] as Record<string, unknown>;
    payload['targetRecordId'] = OTHER_RECORD_ID;
    model['payloadDigest'] = computePayloadDigest(payload);
    const envelope = canonicalEnvelopeBytes(model).canonicalUtf8;
    rmSync(completionPath);
    writeFileSync(completionPath, envelope, { mode: 0o600 });
    chmodSync(completionPath, 0o600);
    const rerun = deleteRecord(env, facts);
    assert.equal(rerun.ok, false, 'conflicting completion evidence fails closed');
    assert.equal(rerun.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Crash model ────────────────────────────────────────────────────────────

const RETENTION_CRASH_STAGES: readonly RetentionMutationStage[] = [
  'before-writer-lock',
  'after-writer-lock',
  'before-intent-publication',
  'after-intent-publication',
  'after-intent-audit-publication',
  'after-post-intent-revalidation',
  'before-target-unlink',
  'after-target-unlink',
  'before-directory-fsync',
  'after-directory-fsync',
  'before-completion-publication',
  'after-completion-publication',
  'after-completion-audit-publication',
  'before-writer-lock-release',
];

test('retention: the fixed crash-stage inventory is exercised in order for both target classes', () => {
  const env = makeStore();
  try {
    const { ...facts } = defaultDeleteFacts(env);
    const seen: RetentionMutationStage[] = [];
    const result = deleteRecord(env, facts, { hooks: { stage: (s) => seen.push(s) } });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, RETENTION_CRASH_STAGES, 'the fixed retention crash-stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
  const env2 = makeStore();
  try {
    const { published, ...facts } = defaultDeleteFacts(env2);
    const primary = deleteRecord(env2, facts);
    assert.equal(primary.ok, true, JSON.stringify(primary.findings));
    const seen: RetentionMutationStage[] = [];
    const result = deleteAudit(env2, {
      targetRecordId: published.auditEventId,
      targetRecordDigest: published.auditDigest,
      targetRevision: 1,
      referencedRecordId: RECORD_ID,
      referencedRecordDigest: published.digest,
      referencedRecordClass: 'validation-record',
      primaryDeletionCompletionEvidenceId: primary.completionEvidenceId!,
    }, { hooks: { stage: (s) => seen.push(s) } });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, RETENTION_CRASH_STAGES, 'the audit flow exercises the same fixed inventory in order');
  } finally {
    rmSync(env2.dir, { recursive: true, force: true });
  }
});

test('retention: a crash at every fixed stage leaves a classifiable state and a safe fresh rerun (primary)', () => {
  for (const stage of RETENTION_CRASH_STAGES) {
    const env = makeStore();
    try {
      const { published, ...facts } = defaultDeleteFacts(env);
      const intentStage = RETENTION_CRASH_STAGES.indexOf('before-intent-publication');
      const unlinkStage = RETENTION_CRASH_STAGES.indexOf('before-target-unlink');
      const completionStage = RETENTION_CRASH_STAGES.indexOf('before-completion-publication');
      const stageIndex = RETENTION_CRASH_STAGES.indexOf(stage);
      crashAt(() => recordDeleteRequest(env, facts), stage);
      const intentDurable = stageIndex > intentStage;
      const targetAbsent = stageIndex > unlinkStage;
      assert.equal(existsSync(evidencePath(env, intentIdOf(env, facts))), intentDurable, `${stage}: intent durability`);
      assert.equal(existsSync(published.recordPath), !targetAbsent, `${stage}: target presence`);
      const lockPath = `${env.storeRoot}/locks/writer.lock`;
      if (stageIndex >= 1) {
        assert.equal(existsSync(lockPath), true, `${stage}: the crash leaves the writer lock held`);
        rmSync(lockPath);
      }
      const rerun = deleteRecord(env, facts);
      if (stageIndex <= completionStage) {
        assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'deleted', `${stage}: rerun outcome`);
      } else {
        assert.equal(rerun.ok, true, `${stage}: rerun must resolve already-completed: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'already-completed', `${stage}: already-completed outcome`);
      }
      assert.equal(existsSync(published.recordPath), false, `${stage}: the target is gone after the rerun`);
      assert.equal(existsSync(lockPath), false, `${stage}: the lock is released after the rerun`);
      const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scan.ok, true, `${stage}: ${JSON.stringify(scan.findings)}`);
      assert.equal(scan.assessment!.retentionEvidenceStates.some((s) => s.state === 'completed' && s.targetRecordId === RECORD_ID), true, `${stage}: completed classification`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

test('retention: a crash at every fixed stage leaves a classifiable state and a safe fresh rerun (audit)', () => {
  for (const stage of RETENTION_CRASH_STAGES) {
    const env = makeStore();
    try {
      const { published, ...facts } = defaultDeleteFacts(env);
      const primary = deleteRecord(env, facts);
      assert.equal(primary.ok, true, JSON.stringify(primary.findings));
      const auditFacts = {
        targetRecordId: published.auditEventId,
        targetRecordDigest: published.auditDigest,
        targetRevision: 1,
        referencedRecordId: RECORD_ID,
        referencedRecordDigest: published.digest,
        referencedRecordClass: 'validation-record' as const,
        primaryDeletionCompletionEvidenceId: primary.completionEvidenceId!,
      };
      const unlinkStage = RETENTION_CRASH_STAGES.indexOf('before-target-unlink');
      const completionStage = RETENTION_CRASH_STAGES.indexOf('before-completion-publication');
      const stageIndex = RETENTION_CRASH_STAGES.indexOf(stage);
      crashAt(() => auditDeleteRequest(env, auditFacts), stage);
      assert.equal(existsSync(published.auditPath), stageIndex <= unlinkStage, `${stage}: audit target presence`);
      const lockPath = `${env.storeRoot}/locks/writer.lock`;
      if (stageIndex >= 1) {
        assert.equal(existsSync(lockPath), true, `${stage}: the crash leaves the writer lock held`);
        rmSync(lockPath);
      }
      const rerun = deleteAudit(env, auditFacts);
      if (stageIndex <= completionStage) {
        assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'deleted', `${stage}: rerun outcome`);
      } else {
        assert.equal(rerun.ok, true, `${stage}: rerun must resolve already-completed: ${JSON.stringify(rerun.findings)}`);
        assert.equal(rerun.outcome, 'already-completed', `${stage}: already-completed outcome`);
      }
      assert.equal(existsSync(published.auditPath), false, `${stage}: the audit target is gone after the rerun`);
      assert.equal(existsSync(lockPath), false, `${stage}: the lock is released after the rerun`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});
