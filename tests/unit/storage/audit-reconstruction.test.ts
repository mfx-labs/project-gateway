/**
 * WP-8-G audit-reconstruction tests (contract 16.3, W8A-C11; AUD-011/012;
 * CSA-013/014): authority gating, eligible-target boundaries, deterministic
 * derivation of the `recovery-audit-reconstruction` event and its evidence,
 * exact-permit publication confinement, idempotency and conflict states,
 * scanner classification, and the fixed 12-stage crash inventory.
 *
 * The reconstructed event is the contract's DISTINCT
 * `recovery-audit-reconstruction` kind bound to the trusted RECOVERY action
 * identity and the recovery time (16.3/AUD-011/012); the original trusted
 * action identity is a verified durable-record fact recorded only in the
 * reconstruction evidence. The work-package §5/§6 requirement of an exact
 * `authorized-write` event with the original action identity contradicts
 * the contract and is NOT implemented (see the implementation report).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedStorageBootstrapInput, createTrustedRecoveryRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import {
  runRecoveryScan,
  executeRecoveryMutation,
  computeAuditReconstructionEvidenceIdentity,
  recordObservationId,
  isoFromEpochMs,
  buildRecoveryAuditReconstructionEvent,
  RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND,
} from '../../../src/storage/recovery/index.js';
import { buildAuthorizedWriteAuditEvent } from '../../../src/storage/audit/write-audit.js';
import { deriveRegistryView } from '../../../src/storage/registry/index.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { computePayloadDigest, canonicalEnvelopeBytes, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { createRecoveryCapability, createRecoveryPublicationPermit } from '../../../src/storage/capabilities/authenticity.js';
import { publishRecoveryBoundRecord } from '../../../src/storage/publication/publish-record.js';
import type { RecoveryMutationRequest, RecoveryMutationStage } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'audit-recon-test-write';
const RECOVERY_ACTION = 'audit-recon-test-action';
const RECORD_ID = 'pgw:r:11110000000000000000000000000001';
const OTHER_RECORD_ID = 'pgw:r:22220000000000000000000000000002';

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
  const dir = mkdtempSync(join(tmpdir(), 'wp8g-recon-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8g-bootstrap',
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

function recordPath(env: TestEnv, recordId: string): string {
  const derived = deriveRecordRelativePath('approval-record', recordId);
  assert.equal(derived.ok, true);
  return join(env.storeRoot, derived.relativePath);
}

function recordDigestOf(env: TestEnv, recordId: string): string {
  const raw = readFileSync(recordPath(env, recordId), 'utf8');
  return computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, raw);
}

/** Remove every durable audit event (the crash state: record durable, audit absent). */
function removeAllAuditEvents(env: TestEnv): void {
  const auditDir = join(env.storeRoot, 'audit', 'audit-event');
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.aud')) unlinkSync(p);
    }
  };
  if (exists(auditDir)) walk(auditDir);
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Write a canonical envelope at a derived record/audit path (fixture helper). */
function writeCanonicalAt(env: TestEnv, recordClass: 'approval-record' | 'authoritative-audit-event' | 'store-evidence-record', envelope: Readonly<Record<string, unknown>>): string {
  const recordId = envelope['recordId'] as string;
  const derived = deriveRecordRelativePath(recordClass, recordId);
  assert.equal(derived.ok, true);
  const path = join(env.storeRoot, derived.relativePath);
  mkdirSync(join(env.storeRoot, derived.relativePath.slice(0, derived.relativePath.lastIndexOf('/'))), { recursive: true, mode: 0o700 });
  writeFileSync(path, canonicalEnvelopeBytes(envelope).canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Recovery assessment facts for a missing-audit reconstruction candidate. */
function candidateFacts(env: TestEnv, recordId: string): { readonly observationId: string; readonly generation: string; readonly surfaceGeneration: string; readonly recordDigest: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const assessment = result.assessment!;
  const candidate = assessment.reconstructionCandidates.find((c) => c.recordId === recordId);
  assert.ok(candidate !== undefined, `the durable record ${recordId} must be a reconstruction candidate`);
  assert.equal(candidate.recordClass, 'approval-record');
  return {
    observationId: candidate.observationId,
    generation: assessment.source.generation,
    surfaceGeneration: assessment.source.surfaceGeneration,
    recordDigest: candidate.recordDigest,
  };
}

/** Deterministic record observation id (recomputed; used after the candidate disappears). */
function observationIdOf(env: TestEnv, recordId: string): string {
  const derived = deriveRecordRelativePath('approval-record', recordId);
  assert.equal(derived.ok, true);
  return recordObservationId('approval-record', derived.shard!, derived.filename!);
}

/** Current scan generation/surface tokens. */
function currentTokens(env: TestEnv): { readonly generation: string; readonly surfaceGeneration: string } {
  const result = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { generation: result.assessment!.source.generation, surfaceGeneration: result.assessment!.source.surfaceGeneration };
}

function reconstructionRequest(
  env: TestEnv,
  facts: { readonly observationId: string; readonly generation: string; readonly surfaceGeneration: string; readonly recordDigest: string },
  overrides: Partial<RecoveryMutationRequest['action']> = {},
): RecoveryMutationRequest {
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
      category: 'audit-reconstruction',
      targetRecordClass: 'approval-record',
      targetRecordId: RECORD_ID,
      targetRecordDigest: facts.recordDigest,
      expectedOriginalActionIdentity: WRITE_ACTION,
      expectedObservationIds: [facts.observationId],
      expectedMissingAuditFindingId: facts.observationId,
      expectedGeneration: facts.generation,
      expectedSurfaceGeneration: facts.surfaceGeneration,
      ...overrides,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
}

/** Derived reconstruction-audit facts exactly as the boundary derives them (fixed test clock). */
function derivedAudit(env: TestEnv, recordDigest: string): NonNullable<ReturnType<typeof buildRecoveryAuditReconstructionEvent>['event']> {
  const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
  assert.equal(storeResult.ok, true);
  const built = buildRecoveryAuditReconstructionEvent({
    storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
    primaryClass: 'approval-record',
    primaryRecordId: RECORD_ID,
    primaryRevision: 1,
    primaryDigest: recordDigest,
    recoveryActionIdentity: RECOVERY_ACTION,
    recoveryTime: isoFromEpochMs(1000),
  });
  assert.equal(built.ok, true);
  return built.event!;
}

/** Derived reconstruction-evidence id exactly as the boundary derives it. */
function derivedEvidenceId(env: TestEnv, recordDigest: string, reconstructionAuditId: string, observationId: string): string {
  const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
  assert.equal(storeResult.ok, true);
  return computeAuditReconstructionEvidenceIdentity({
    storeInstance: storeResult.storeInstance!,
    targetRecordClass: 'approval-record',
    targetRecordId: RECORD_ID,
    targetRecordDigest: recordDigest,
    originalActionIdentity: WRITE_ACTION,
    reconstructionAuditId,
    missingAuditObservationId: observationId,
    outcome: 'reconstructed',
  });
}

function auditPath(env: TestEnv, auditEventId: string): string {
  const derived = deriveRecordRelativePath('authoritative-audit-event', auditEventId);
  assert.equal(derived.ok, true);
  return join(env.storeRoot, derived.relativePath);
}

function evidencePath(env: TestEnv, evidenceId: string): string {
  const derived = deriveRecordRelativePath('store-evidence-record', evidenceId);
  assert.equal(derived.ok, true);
  return join(env.storeRoot, derived.relativePath);
}

/** A store whose durable record is missing its write audit (the WP-8-G target state). */
function makeMissingAuditStore(): TestEnv {
  const env = makeStore();
  publish(env, RECORD_ID);
  removeAllAuditEvents(env);
  const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(scan.ok, true);
  assert.equal(scan.assessment!.reconstructionCandidates.some((c) => c.recordId === RECORD_ID), true, 'the record must be a reconstruction candidate');
  return env;
}

function assertReconstructed(env: TestEnv, facts: ReturnType<typeof candidateFacts>): { readonly auditEventId: string; readonly evidenceId: string } {
  const audit = derivedAudit(env, facts.recordDigest);
  const auditFile = auditPath(env, audit.recordId);
  const rawAudit = readFileSync(auditFile, 'utf8');
  const auditModel = JSON.parse(rawAudit) as Record<string, unknown>;
  const auditPayload = auditModel['payload'] as Record<string, unknown>;
  assert.equal(auditModel['recordKind'], 'AuthoritativeAuditEvent');
  assert.equal(auditPayload['eventKind'], RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND);
  assert.equal(auditPayload['recordId'], RECORD_ID, 'the reconstructed audit must bind the exact target identity');
  assert.equal(auditPayload['recordDigest'], facts.recordDigest, 'the reconstructed audit must bind the exact target digest');
  assert.deepEqual(auditPayload['gapMarker'], { missingEventKind: 'authorized-write' }, 'the gap marker must name the missing original event');
  assert.equal(auditModel['trustedActionId'], RECOVERY_ACTION, 'the event carries the trusted RECOVERY action identity');
  assert.notEqual(auditModel['trustedActionId'], WRITE_ACTION, 'the original write action identity must never be substituted into the event');
  assert.ok(!rawAudit.includes(env.dir), 'the audit must not contain raw paths');
  const evidenceId = derivedEvidenceId(env, facts.recordDigest, audit.recordId, facts.observationId);
  const rawEvidence = readFileSync(evidencePath(env, evidenceId), 'utf8');
  const evidenceModel = JSON.parse(rawEvidence) as Record<string, unknown>;
  const evidencePayload = evidenceModel['payload'] as Record<string, unknown>;
  assert.equal(evidenceModel['recordKind'], 'StoreEvidenceRecord');
  assert.equal(evidencePayload['recoveryOperation'], 'audit-reconstruction');
  assert.equal(evidencePayload['targetRecordId'], RECORD_ID);
  assert.equal(evidencePayload['targetRecordDigest'], facts.recordDigest);
  assert.equal(evidencePayload['originalActionIdentity'], WRITE_ACTION, 'the evidence binds the original trusted action identity as a fact');
  assert.equal(evidencePayload['reconstructionAuditId'], audit.recordId);
  assert.equal(evidencePayload['outcome'], 'reconstructed');
  assert.ok(!rawEvidence.includes(env.dir), 'the evidence must not contain raw paths');
  return { auditEventId: audit.recordId, evidenceId };
}

// ── Authority ──────────────────────────────────────────────────────────────

test('audit-reconstruction: genuine authority executes the full reconstruction', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const result = executeRecoveryMutation(reconstructionRequest(env, facts));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'reconstructed');
    assertReconstructed(env, facts);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: orphan-only and quarantine-only authority is rejected', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
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
    const orphanOnly = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: storeResult.storeInstance!, operationSet: ['orphan-removal'] });
    const quarantineOnly = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: storeResult.storeInstance!, operationSet: ['quarantine-temporary'] });
    assert.ok(orphanOnly !== undefined && quarantineOnly !== undefined);
    assert.equal(orphanOnly!.verify('audit-reconstruction').ok, false, 'an orphan-only authority must never verify audit-reconstruction');
    assert.equal(orphanOnly!.verify('audit-reconstruction').reason, 'wrong-operation');
    assert.equal(quarantineOnly!.verify('audit-reconstruction').ok, false);
    // The exact-record permit creator refuses an authority whose operation
    // set excludes the reconstruction operation (mint-time check).
    const audit = derivedAudit(env, recordDigestOf(env, RECORD_ID));
    const derived = deriveRecordRelativePath('authoritative-audit-event', audit.recordId);
    assert.equal(derived.ok, true);
    const permit = createRecoveryPublicationPermit({
      capability: orphanOnly,
      operation: 'audit-reconstruction',
      role: 'reconstructed-recovery-audit',
      recordId: audit.recordId,
      recordDigest: audit.digest,
      canonicalBytesDigest: audit.digest,
      destinationDesignation: derived.relativePath,
      audit: { referencedRecordId: RECORD_ID, referencedRecordDigest: recordDigestOf(env, RECORD_ID), eventKind: 'recovery-audit-reconstruction', trustedActionIdentity: RECOVERY_ACTION },
    });
    assert.equal(permit, undefined, 'an orphan-only authority must never mint a reconstruction permit');
    orphanOnly!.dispose();
    quarantineOnly!.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: forged, cloned, wrong-store, wrong-action, and plan-derived requests are rejected', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const base = reconstructionRequest(env, facts);
    const spreadClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: { ...(base.recoveryActionProvenance as object) } });
    assert.equal(spreadClone.ok, false);
    assert.equal(spreadClone.findings?.[0]?.code, 'ERR-STO-CONFIG-UNAVAILABLE');
    const jsonClone = executeRecoveryMutation({ ...base, recoveryActionProvenance: JSON.parse(JSON.stringify(base.recoveryActionProvenance)) });
    assert.equal(jsonClone.ok, false);
    const wrongStore = executeRecoveryMutation({ ...base, locator: '/nonexistent' });
    assert.equal(wrongStore.ok, false);
    const wrongAction = executeRecoveryMutation({ ...base, action: { ...base.action, expectedOriginalActionIdentity: 'someone-else' } });
    assert.equal(wrongAction.ok, false);
    assert.equal(wrongAction.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    const plan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput }).plan!;
    const planAsAction = executeRecoveryMutation({ ...base, action: plan.actions[0] as never });
    assert.equal(planAsAction.ok, false);
    // A path operand is never accepted.
    const pathOperand = executeRecoveryMutation({ ...base, action: { ...base.action, targetRecordId: '/tmp/evil' } });
    assert.equal(pathOperand.ok, false);
    // The durable record is untouched.
    assert.equal(readFileSync(recordPath(env, RECORD_ID), 'utf8').length > 0, true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Eligibility ────────────────────────────────────────────────────────────

test('audit-reconstruction: ineligible classes and operands are rejected', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const base = reconstructionRequest(env, facts);
    // Registry/index and metadata classes are never reconstructable.
    const registryClass = executeRecoveryMutation({ ...base, action: { ...base.action, targetRecordClass: 'registry-snapshot' } });
    assert.equal(registryClass.ok, false);
    assert.equal(registryClass.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    const metadataClass = executeRecoveryMutation({ ...base, action: { ...base.action, targetRecordClass: 'store-metadata' } });
    assert.equal(metadataClass.ok, false);
    const auditClass = executeRecoveryMutation({ ...base, action: { ...base.action, targetRecordClass: 'authoritative-audit-event' } });
    assert.equal(auditClass.ok, false);
    // Malformed digest / identity operands fail closed.
    const badDigest = executeRecoveryMutation({ ...base, action: { ...base.action, targetRecordDigest: 'not-a-digest' } });
    assert.equal(badDigest.ok, false);
    const badId = executeRecoveryMutation({ ...base, action: { ...base.action, targetRecordId: 'pgw:x:zzzz' } });
    assert.equal(badId.ok, false);
    // Generic operation names do not exist.
    const genericOps = ['audit-write', 'audit-repair', 'recovery-write', 'publish-audit'];
    for (const op of genericOps) {
      const generic = executeRecoveryMutation({ ...base, action: { ...base.action, category: op as never } });
      assert.equal(generic.ok, false, `${op} must not exist`);
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: conflicting audit for the target fails closed', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    // Craft a valid authorized-write audit referencing the target with a
    // DIFFERENT digest (conflicting audit state).
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const conflicting = buildAuthorizedWriteAuditEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: 'sha-256:' + '9'.repeat(64),
      eventKind: 'authorized-write',
      trustedActionIdentity: WRITE_ACTION,
      primaryCreatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(conflicting.ok, true);
    writeCanonicalAt(env, 'authoritative-audit-event', conflicting.event!.envelope);
    const result = executeRecoveryMutation(reconstructionRequest(env, facts));
    assert.equal(result.ok, false);
    assert.equal(result.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(result.findings?.[0]?.message ?? '', /conflict/);
    // No audit was reconstructed and no evidence was published.
    assert.equal(exists(evidencePath(env, derivedEvidenceId(env, facts.recordDigest, derivedAudit(env, facts.recordDigest).recordId, facts.observationId))), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: contested, malformed, wrong-location, changed, and missing targets fail closed', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const base = reconstructionRequest(env, facts);
    // Contested target: nlink 2 (an extra hard link).
    linkSync(recordPath(env, RECORD_ID), join(env.storeRoot, 'tmp', 'pub-aaaaaaaaaaaaaaaa-0'));
    const contested = executeRecoveryMutation(base);
    assert.equal(contested.ok, false);
    assert.equal(contested.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    unlinkSync(join(env.storeRoot, 'tmp', 'pub-aaaaaaaaaaaaaaaa-0'));
    // Malformed target: garbage at the derived location.
    writeFileSync(recordPath(env, RECORD_ID), '{not a record', { mode: 0o600 });
    chmodSync(recordPath(env, RECORD_ID), 0o600);
    const malformed = executeRecoveryMutation(base);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.findings?.[0]?.code, 'ERR-STO-MALFORMED');
    // Wrong-location target: a valid record of a DIFFERENT identity written
    // at the derived location of the requested identity.
    const otherEnvelope = {
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId: OTHER_RECORD_ID,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: true },
      payloadDigest: computePayloadDigest({ approved: true }),
    };
    writeFileSync(recordPath(env, RECORD_ID), canonicalEnvelopeBytes(otherEnvelope).canonicalUtf8, { mode: 0o600 });
    chmodSync(recordPath(env, RECORD_ID), 0o600);
    const wrongLocation = executeRecoveryMutation(reconstructionRequest(env, { ...facts, recordDigest: recordDigestOf(env, RECORD_ID) }));
    assert.equal(wrongLocation.ok, false);
    assert.equal(wrongLocation.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    // Missing target: delete the record.
    rmSync(recordPath(env, RECORD_ID));
    const missing = executeRecoveryMutation(base);
    assert.equal(missing.ok, false);
    assert.equal(missing.findings?.[0]?.code, 'ERR-STO-NOT-FOUND');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Derivation ─────────────────────────────────────────────────────────────

test('audit-reconstruction: derivation is deterministic and binds the exact durable facts', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const auditA = derivedAudit(env, facts.recordDigest);
    const auditB = derivedAudit(env, facts.recordDigest);
    assert.equal(auditA.recordId, auditB.recordId, 'audit identity must be deterministic');
    assert.equal(auditA.canonicalUtf8, auditB.canonicalUtf8, 'audit bytes must be deterministic');
    const auditOtherDigest = derivedAudit(env, 'sha-256:' + '9'.repeat(64));
    assert.notEqual(auditA.recordId, auditOtherDigest.recordId, 'audit identity must bind the target digest');
    // The evidence identity is deterministic and domain separated.
    const evidenceIdA = derivedEvidenceId(env, facts.recordDigest, auditA.recordId, facts.observationId);
    const evidenceIdB = derivedEvidenceId(env, facts.recordDigest, auditA.recordId, facts.observationId);
    assert.equal(evidenceIdA, evidenceIdB);
    assert.match(evidenceIdA, /^pgw:r:[0-9a-f]{32}$/);
    const evidenceOtherAudit = derivedEvidenceId(env, facts.recordDigest, auditOtherDigest.recordId, facts.observationId);
    assert.notEqual(evidenceIdA, evidenceOtherAudit, 'evidence identity must bind the reconstructed audit identity');
    const result = executeRecoveryMutation(reconstructionRequest(env, facts));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    const durable = assertReconstructed(env, facts);
    assert.equal(durable.auditEventId, auditA.recordId, 'the durable audit must use the deterministic identity');
    assert.equal(durable.evidenceId, evidenceIdA, 'the durable evidence must use the deterministic identity');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Publication confinement ────────────────────────────────────────────────

test('audit-reconstruction: the exact-record permit cannot publish any substituted audit, evidence, or primary', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const recordDigest = recordDigestOf(env, RECORD_ID);
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
    const cap = createRecoveryCapability({ trustedRecoveryRequest: inputResult.request!, storeInstance: storeResult.storeInstance! });
    assert.ok(cap !== undefined);
    const byteLimit = 1024 * 1024;
    const audit = derivedAudit(env, recordDigest);
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', audit.recordId);
    assert.equal(auditDerived.ok, true);
    const mint = (auditBinding: Parameters<typeof createRecoveryPublicationPermit>[0]['audit']): ReturnType<typeof createRecoveryPublicationPermit> =>
      createRecoveryPublicationPermit({
        capability: cap,
        operation: 'audit-reconstruction',
        role: 'reconstructed-recovery-audit',
        recordId: audit.recordId,
        recordDigest: audit.digest,
        canonicalBytesDigest: audit.digest,
        destinationDesignation: auditDerived.relativePath,
        audit: auditBinding,
      });
    // Role/kind pairing: a reconstruction permit can never bind the
    // authorized-write kind or an arbitrary kind.
    assert.equal(mint({ referencedRecordId: RECORD_ID, referencedRecordDigest: recordDigest, eventKind: 'authorized-write', trustedActionIdentity: RECOVERY_ACTION }), undefined);
    assert.equal(mint({ referencedRecordId: RECORD_ID, referencedRecordDigest: recordDigest, eventKind: 'idempotent-duplicate' as never, trustedActionIdentity: RECOVERY_ACTION }), undefined);
    const permit = mint({ referencedRecordId: RECORD_ID, referencedRecordDigest: recordDigest, eventKind: 'recovery-audit-reconstruction', trustedActionIdentity: RECOVERY_ACTION });
    assert.ok(permit !== undefined);
    const publishProbe = (canonicalUtf8: string): ReturnType<typeof publishRecoveryBoundRecord> =>
      publishRecoveryBoundRecord({ permit: permit!, canonicalUtf8, byteLimit, serviceUid: UID });
    // Exact bytes publish.
    assert.equal(publishProbe(audit.canonicalUtf8).ok, true);
    // Modified bytes fail before mutation (the audit payload carries no
    // record payload fields, so a digest character is changed).
    const modified = publishProbe(audit.canonicalUtf8.replace('"recovery-audit-reconstruction"', '"recovery-audit-reconstructionX"'));
    assert.equal(modified.ok, false);
    // Wrong event kind payload (authorized-write event bytes) fails.
    const wrongKindBytes = canonicalEnvelopeBytes({
      recordKind: 'AuthoritativeAuditEvent',
      formatVersion: '1.0',
      recordId: 'pgw:l:' + 'e'.repeat(32),
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: RECOVERY_ACTION,
      payload: { eventKind: 'authorized-write', recordId: RECORD_ID, recordDigest: recordDigest },
      payloadDigest: computePayloadDigest({ eventKind: 'authorized-write', recordId: RECORD_ID, recordDigest: recordDigest }),
    }).canonicalUtf8;
    assert.equal(publishProbe(wrongKindBytes).ok, false);
    // Wrong referenced target: audit bytes for a different record fail.
    const otherTargetAudit = buildRecoveryAuditReconstructionEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: OTHER_RECORD_ID,
      primaryRevision: 1,
      primaryDigest: recordDigest,
      recoveryActionIdentity: RECOVERY_ACTION,
      recoveryTime: isoFromEpochMs(1000),
    });
    assert.equal(otherTargetAudit.ok, true);
    assert.equal(publishProbe(otherTargetAudit.event!.canonicalUtf8).ok, false, 'an audit for another target must never publish');
    // Wrong referenced digest: audit bytes built for another digest fail.
    const otherDigestAudit = buildRecoveryAuditReconstructionEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: 'sha-256:' + '9'.repeat(64),
      recoveryActionIdentity: RECOVERY_ACTION,
      recoveryTime: isoFromEpochMs(1000),
    });
    assert.equal(otherDigestAudit.ok, true);
    assert.equal(publishProbe(otherDigestAudit.event!.canonicalUtf8).ok, false, 'an audit for another digest must never publish');
    // Wrong trusted action identity: audit bytes bound to another recovery
    // action fail.
    const otherActionAudit = buildRecoveryAuditReconstructionEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: recordDigest,
      recoveryActionIdentity: 'other-recovery-action',
      recoveryTime: isoFromEpochMs(1000),
    });
    assert.equal(otherActionAudit.ok, true);
    assert.equal(publishProbe(otherActionAudit.event!.canonicalUtf8).ok, false, 'audit bytes for another action identity must never publish');
    // Gap-marker removal fails the sink binding.
    const noGapMarker = canonicalEnvelopeBytes({
      recordKind: 'AuthoritativeAuditEvent',
      formatVersion: '1.0',
      recordId: 'pgw:l:' + 'd'.repeat(32),
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: RECOVERY_ACTION,
      payload: { eventKind: 'recovery-audit-reconstruction', recordId: RECORD_ID, recordDigest: recordDigest },
      payloadDigest: computePayloadDigest({ eventKind: 'recovery-audit-reconstruction', recordId: RECORD_ID, recordDigest: recordDigest }),
    }).canonicalUtf8;
    assert.equal(publishProbe(noGapMarker).ok, false);
    // Role substitution: an evidence permit can never publish the
    // reconstruction audit, and the reconstruction permit can never publish
    // a primary record or an evidence record.
    const evidenceDerived = deriveRecordRelativePath('store-evidence-record', 'pgw:r:' + 'c'.repeat(32));
    assert.equal(evidenceDerived.ok, true);
    const evidencePermit = createRecoveryPublicationPermit({
      capability: cap,
      operation: 'audit-reconstruction',
      role: 'recovery-evidence',
      recordId: 'pgw:r:' + 'c'.repeat(32),
      recordDigest: 'sha-256:' + '1'.repeat(64),
      canonicalBytesDigest: 'sha-256:' + '1'.repeat(64),
      destinationDesignation: evidenceDerived.relativePath,
    });
    assert.ok(evidencePermit !== undefined);
    const auditViaEvidencePermit = publishRecoveryBoundRecord({ permit: evidencePermit!, canonicalUtf8: audit.canonicalUtf8, byteLimit, serviceUid: UID });
    assert.equal(auditViaEvidencePermit.ok, false, 'an evidence permit must never publish the reconstructed audit');
    const primaryBytes = canonicalEnvelopeBytes({
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId: RECORD_ID,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: true },
      payloadDigest: computePayloadDigest({ approved: true }),
    }).canonicalUtf8;
    assert.equal(publishProbe(primaryBytes).ok, false, 'the reconstruction permit must never publish a primary record');
    cap.dispose();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Idempotency / conflict states ──────────────────────────────────────────

test('audit-reconstruction: exact audit + exact evidence returns already-completed; audit only rolls the evidence forward', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const first = executeRecoveryMutation(reconstructionRequest(env, facts));
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    assert.equal(first.outcome, 'reconstructed');
    // Rerun with fresh tokens: exact audit + exact evidence → already-completed.
    const tokens = currentTokens(env);
    const rerun = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), ...tokens }));
    assert.equal(rerun.ok, true, JSON.stringify(rerun.findings));
    assert.equal(rerun.outcome, 'already-completed');
    assert.equal(rerun.evidenceId, first.evidenceId, 'already-completed must identify the existing evidence');
    // Interrupted-after-audit state: remove the evidence and its audit,
    // rerun → the evidence half rolls forward (outcome reconstructed).
    const audit = derivedAudit(env, facts.recordDigest);
    rmSync(evidencePath(env, first.evidenceId!));
    // Find and remove the evidence's authorized-write audit (the only .aud
    // file that is not the reconstruction audit).
    const auditDir = join(env.storeRoot, 'audit', 'audit-event');
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.aud') && !p.includes(audit.recordId.slice('pgw:l:'.length))) unlinkSync(p);
      }
    };
    walk(auditDir);
    const tokens2 = currentTokens(env);
    const rolled = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), ...tokens2 }));
    assert.equal(rolled.ok, true, JSON.stringify(rolled.findings));
    assert.equal(rolled.outcome, 'reconstructed');
    assert.equal(rolled.evidenceId, first.evidenceId, 'the rolled-forward evidence must use the deterministic identity');
    assertReconstructed(env, facts);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: evidence without the reconstructed audit is an integrity failure; conflicting evidence fails closed', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const first = executeRecoveryMutation(reconstructionRequest(env, facts));
    assert.equal(first.ok, true);
    const audit = derivedAudit(env, facts.recordDigest);
    const auditFile = auditPath(env, audit.recordId);
    // Evidence present, reconstructed audit missing: never republish from
    // evidence alone.
    rmSync(auditFile);
    const tokens = currentTokens(env);
    const missingAudit = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), ...tokens }));
    assert.equal(missingAudit.ok, false);
    assert.equal(missingAudit.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(missingAudit.findings?.[0]?.message ?? '', /evidence exists without its reconstructed audit/);
    // Conflicting evidence: tamper the evidence payload facts (same record
    // identity), restore the audit, rerun → fail closed.
    const auditRecreated = buildRecoveryAuditReconstructionEvent({
      storeInstance: (verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile }).storeInstance!).namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.recordDigest,
      recoveryActionIdentity: RECOVERY_ACTION,
      recoveryTime: isoFromEpochMs(1000),
    });
    assert.equal(auditRecreated.ok, true);
    writeCanonicalAt(env, 'authoritative-audit-event', auditRecreated.event!.envelope);
    // Tamper the evidence payload so its facts no longer match the durable
    // audit binding.
    const evidenceFile = evidencePath(env, first.evidenceId!);
    const evidenceModel = JSON.parse(readFileSync(evidenceFile, 'utf8')) as Record<string, unknown>;
    const payload = evidenceModel['payload'] as Record<string, unknown>;
    payload['targetRecordId'] = OTHER_RECORD_ID;
    evidenceModel['payload'] = payload;
    evidenceModel['payloadDigest'] = computePayloadDigest(payload);
    writeFileSync(evidenceFile, canonicalEnvelopeBytes(evidenceModel).canonicalUtf8, { mode: 0o600 });
    chmodSync(evidenceFile, 0o600);
    const tokens3 = currentTokens(env);
    const conflicting = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), ...tokens3 }));
    assert.equal(conflicting.ok, false);
    assert.equal(conflicting.findings?.[0]?.code, 'ERR-STO-INTEGRITY');
    assert.match(conflicting.findings?.[0]?.message ?? '', /conflict/);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: original authorized-write audit present → already-completed without invented evidence', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    // The write path itself fills the gap (CSA-014): publish the original
    // authorized-write audit for the exact target digest.
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const original = buildAuthorizedWriteAuditEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.recordDigest,
      eventKind: 'authorized-write',
      trustedActionIdentity: WRITE_ACTION,
      primaryCreatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(original.ok, true);
    writeCanonicalAt(env, 'authoritative-audit-event', original.event!.envelope);
    const tokens = currentTokens(env);
    const result = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), ...tokens }));
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.outcome, 'already-completed');
    assert.equal(result.evidenceId, undefined, 'no reconstruction evidence may be invented when the original audit exists');
    // No reconstruction event was published.
    const audit = derivedAudit(env, facts.recordDigest);
    assert.equal(exists(auditPath(env, audit.recordId)), false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Scanner ────────────────────────────────────────────────────────────────

test('audit-reconstruction: every interrupted and completed state is classified by the scanner', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const audit = derivedAudit(env, facts.recordDigest);
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const stateOf = (recordId: string): string | undefined => {
      const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scan.ok, true);
      return scan.assessment!.reconstructionStates.find((s) => s.recordId === recordId)?.state;
    };
    // Interrupted after audit publication: exact audit, no evidence.
    writeCanonicalAt(env, 'authoritative-audit-event', audit.envelope);
    assert.equal(stateOf(RECORD_ID), 'audit-without-evidence');
    // Complete: audit + evidence.
    const first = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), ...currentTokens(env) }));
    assert.equal(first.ok, true, JSON.stringify(first.findings));
    assert.equal(stateOf(RECORD_ID), 'complete');
    // Evidence present, audit missing → evidence-without-audit.
    rmSync(auditPath(env, audit.recordId));
    assert.equal(stateOf(RECORD_ID), 'evidence-without-audit');
    // Conflicting reconstruction audit (wrong digest): dangling → conflict.
    const conflictingAudit = buildRecoveryAuditReconstructionEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: 'sha-256:' + '9'.repeat(64),
      recoveryActionIdentity: RECOVERY_ACTION,
      recoveryTime: isoFromEpochMs(1000),
    });
    assert.equal(conflictingAudit.ok, true);
    writeCanonicalAt(env, 'authoritative-audit-event', conflictingAudit.event!.envelope);
    const scanConflicting = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanConflicting.assessment!.reconstructionStates.some((s) => s.state === 'conflicting-audit'), true);
    // Duplicate reconstruction audits (exact digest, two events).
    rmSync(auditPath(env, conflictingAudit.event!.recordId));
    const secondAudit = buildRecoveryAuditReconstructionEvent({
      storeInstance: storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino })),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.recordDigest,
      recoveryActionIdentity: 'other-recovery-action',
      recoveryTime: isoFromEpochMs(1000),
    });
    assert.equal(secondAudit.ok, true);
    writeCanonicalAt(env, 'authoritative-audit-event', secondAudit.event!.envelope);
    writeCanonicalAt(env, 'authoritative-audit-event', audit.envelope);
    const scanDuplicate = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanDuplicate.assessment!.reconstructionStates.some((s) => s.recordId === RECORD_ID && s.state === 'duplicate-audit'), true);
    // Dangling evidence (references an absent target).
    rmSync(auditPath(env, audit.recordId));
    rmSync(auditPath(env, secondAudit.event!.recordId));
    const danglingEvidenceId = derivedEvidenceId(env, facts.recordDigest, audit.recordId, facts.observationId);
    const danglingModel = JSON.parse(readFileSync(evidencePath(env, danglingEvidenceId), 'utf8')) as Record<string, unknown>;
    const danglingPayload = { ...(danglingModel['payload'] as Record<string, unknown>) };
    danglingPayload['targetRecordId'] = 'pgw:r:99990000000000000000000000000009';
    danglingModel['payload'] = danglingPayload;
    danglingModel['payloadDigest'] = computePayloadDigest(danglingPayload);
    writeCanonicalAt(env, 'store-evidence-record', danglingModel as Record<string, unknown>);
    const scanDangling = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanDangling.assessment!.reconstructionStates.some((s) => s.state === 'dangling-evidence'), true);
    // Malformed evidence (audit-reconstruction claim with incomplete facts).
    const malformedModel = {
      recordKind: 'StoreEvidenceRecord',
      formatVersion: '1.0',
      recordId: 'pgw:r:' + 'bb'.repeat(16),
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: RECOVERY_ACTION,
      payload: { evidenceKind: 'recovery-evidence', recoveryOperation: 'audit-reconstruction', targetRecordId: RECORD_ID },
      payloadDigest: computePayloadDigest({ evidenceKind: 'recovery-evidence', recoveryOperation: 'audit-reconstruction', targetRecordId: RECORD_ID }),
      referenceDigests: ['sha-256:' + '1'.repeat(64)],
      retentionClass: 'indefinite',
    };
    writeCanonicalAt(env, 'store-evidence-record', malformedModel);
    const scanMalformed = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scanMalformed.assessment!.reconstructionStates.some((s) => s.state === 'malformed-evidence'), true);
    // Registry views keep treating the target by its durable record facts
    // (RGY-010): reconstruction artifacts grant no registry authority.
    const view = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(view.ok, true, JSON.stringify(view.findings));
    assert.ok(view.view!.recordsByIdentity[RECORD_ID] !== undefined, 'the target remains a registry record by its durable facts');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Crash stages ───────────────────────────────────────────────────────────

/** Fixed audit-reconstruction crash-stage inventory (WP-8-G §10; asserted by the tests below). */
const RECONSTRUCTION_CRASH_STAGES: readonly RecoveryMutationStage[] = [
  'before-lock-acquisition',
  'after-lock-acquisition',
  'after-target-verification',
  'after-audit-absence-verification',
  'before-reconstructed-audit-publication',
  'after-reconstructed-audit-publication',
  'before-reconstructed-audit-durability-confirmation',
  'after-reconstructed-audit-durability-confirmation',
  'before-evidence-publication',
  'after-evidence-publication',
  'after-evidence-audit-publication',
  'before-lock-release',
];

test('audit-reconstruction: the fixed 12-stage crash inventory is asserted', () => {
  const env = makeMissingAuditStore();
  try {
    const facts = candidateFacts(env, RECORD_ID);
    const seen: RecoveryMutationStage[] = [];
    const result = executeRecoveryMutation({ ...reconstructionRequest(env, facts), hooks: { stage: (s) => seen.push(s) } });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(seen, RECONSTRUCTION_CRASH_STAGES, 'the fixed audit-reconstruction crash-stage inventory must be exercised in order');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-reconstruction: a crash at every stage leaves a classifiable state and a safe rerun', () => {
  for (const stage of RECONSTRUCTION_CRASH_STAGES) {
    const env = makeMissingAuditStore();
    try {
      const facts = candidateFacts(env, RECORD_ID);
      const recordBytesBefore = readFileSync(recordPath(env, RECORD_ID), 'utf8');
      let crashed = false;
      try {
        executeRecoveryMutation({
          ...reconstructionRequest(env, facts),
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
      // The target record remains untouched.
      assert.equal(readFileSync(recordPath(env, RECORD_ID), 'utf8'), recordBytesBefore, `${stage}: the target record must never change`);
      // The scanner classifies the resulting state deterministically.
      const scanAfterCrash = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(scanAfterCrash.ok, true, JSON.stringify(scanAfterCrash.findings));
      // Held crash locks fail closed (stale-lock breaking is out of scope).
      const lockPresent = exists(join(env.storeRoot, 'locks', 'writer.lock'));
      if (stage !== 'before-lock-acquisition') {
        assert.equal(lockPresent, true, `crash at ${stage} leaves the writer lock`);
        const lockedScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
        const locked = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), generation: lockedScan.assessment!.source.generation, surfaceGeneration: lockedScan.assessment!.source.surfaceGeneration }));
        assert.equal(locked.ok, false);
        assert.equal(locked.findings?.[0]?.code, 'ERR-STO-LOCK-UNAVAILABLE');
        rmSync(join(env.storeRoot, 'locks', 'writer.lock'));
      }
      // Rerun with fresh assessment facts: completes safely (roll forward or
      // already-completed) — never a second audit, never an overwrite.
      const rerunScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      const rerun = executeRecoveryMutation(reconstructionRequest(env, { ...facts, observationId: observationIdOf(env, RECORD_ID), generation: rerunScan.assessment!.source.generation, surfaceGeneration: rerunScan.assessment!.source.surfaceGeneration }));
      assert.equal(rerun.ok, true, `${stage}: rerun must complete: ${JSON.stringify(rerun.findings)}`);
      assert.ok(rerun.outcome === 'reconstructed' || rerun.outcome === 'already-completed', `${stage}: deterministic outcome`);
      // Exactly one reconstruction audit and one evidence record exist.
      const audit = derivedAudit(env, facts.recordDigest);
      assert.equal(exists(auditPath(env, audit.recordId)), true, `${stage}: the reconstruction audit must be durable`);
      const finalScan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
      assert.equal(finalScan.assessment!.reconstructionStates.some((s) => s.recordId === RECORD_ID && s.state === 'complete'), true, `${stage}: final state must be complete`);
      assert.equal(exists(join(env.storeRoot, 'locks', 'writer.lock')), false, `${stage}: the lock must be released`);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
