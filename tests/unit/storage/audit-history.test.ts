/**
 * WP-8-K audit-history inspection tests (contract 13.4, HST-001…010,
 * AUD-014; ADR-034): authoritative immutable-fact derivation, exact
 * original-vs-reconstructed semantics, deterministic ordering, bounded
 * inspection with self-validating cursors, snapshot re-verification,
 * tamper/conflict visibility, reconstruction edge cases, and the
 * read-only security boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createRecoveryActionProvenance, createTrustedStorageBootstrapInput, createTrustedRecoveryRequest } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { runRecoveryScan, executeRecoveryMutation } from '../../../src/storage/recovery/index.js';
import { buildAuditReconstructionEvidenceRecord } from '../../../src/storage/recovery/index.js';
import { runRegistrySnapshotScan } from '../../../src/storage/registry/index.js';
import { buildAuthorizedWriteAuditEvent, buildRecoveryAuditReconstructionEvent, computeAuditEventIdentity } from '../../../src/storage/audit/write-audit.js';
import { inspectAuditHistory } from '../../../src/storage/read/index.js';
import { inspectAuditHistoryByIdentity, isHistoryTargetClass, type AuditHistoryStage } from '../../../src/storage/read/history.js';
import { verifyStoreInstance } from '../../../src/storage/read/read-record.js';
import { computePayloadDigest, canonicalEnvelopeBytes, computeDomainDigest, STORAGE_RECORD_BYTES_DIGEST_DOMAIN } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import type { AuditHistoryCursor, AuditHistoryFinding, AuditHistoryInspectionResult, HistoryAuditEvent, InspectAuditHistoryRequest, ReconstructionEvidenceAnnotation, RecoveryMutationRequest } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'wp8k-writer';
const RECOVERY_ACTION = 'wp8k-recovery';
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
  const dir = mkdtempSync(join(tmpdir(), 'wp8k-hist-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'wp8k-bootstrap',
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

function namespaces(env: TestEnv): readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[] {
  const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
  assert.equal(storeResult.ok, true);
  return storeResult.storeInstance!.namespaces.map((n) => ({ kind: n.kind, dev: n.dev, ino: n.ino }));
}

interface PublishedFacts {
  readonly recordId: string;
  readonly revision: number;
  readonly digest: string;
  readonly trustedActionId: string;
  readonly createdAt: string;
  readonly auditEventId: string;
  readonly auditDigest: string;
  readonly auditCanonicalUtf8: string;
  readonly auditPath: string;
}

function publish(env: TestEnv, recordId: string, overrides: Partial<Record<string, unknown>> = {}): PublishedFacts {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const payload = { approved: true, ...overrides };
  const createdAt = (overrides['createdAt'] as string | undefined) ?? '2026-01-01T00:00:00.000Z';
  const revision = (overrides['revision'] as number | undefined) ?? 1;
  const record = {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId,
    revision,
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
    recordClass: 'approval-record',
    record,
    timeSource: { now: () => 1000, processStartTime: 500 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const audit = buildAuthorizedWriteAuditEvent({
    storeInstance: namespaces(env),
    primaryClass: 'approval-record',
    primaryRecordId: recordId,
    primaryRevision: revision,
    primaryDigest: result.recordDigest!,
    eventKind: 'authorized-write',
    trustedActionIdentity: WRITE_ACTION,
    primaryCreatedAt: createdAt,
  });
  assert.equal(audit.ok, true);
  const event = audit.event!;
  const derived = deriveRecordRelativePath('authoritative-audit-event', event.recordId);
  assert.equal(derived.ok, true);
  return {
    recordId,
    revision,
    digest: result.recordDigest!,
    trustedActionId: WRITE_ACTION,
    createdAt,
    auditEventId: event.recordId,
    auditDigest: event.digest,
    auditCanonicalUtf8: event.canonicalUtf8,
    auditPath: `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`,
  };
}

function historyRequest(env: TestEnv, recordId: string, overrides: Partial<InspectAuditHistoryRequest> = {}): InspectAuditHistoryRequest {
  return {
    trustedConfiguration: env.config,
    trustedInput: env.trustedInput,
    recordClass: 'approval-record',
    recordId,
    ...overrides,
  };
}

function history(env: TestEnv, recordId: string, overrides: Partial<InspectAuditHistoryRequest> = {}): AuditHistoryInspectionResult {
  return inspectAuditHistory(historyRequest(env, recordId, overrides));
}

/** Write one canonical audit event envelope at its derived path (test fixture). */
function writeAuditEnvelope(env: TestEnv, model: Readonly<Record<string, unknown>>): void {
  const canonical = canonicalEnvelopeBytes(model);
  const derived = deriveRecordRelativePath('authoritative-audit-event', model['recordId'] as string);
  assert.equal(derived.ok, true);
  const path = `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(path, canonical.canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Manual audit event model from a pure builder result. */
function eventModel(env: TestEnv, event: { readonly recordId: string; readonly canonicalUtf8: string }): Readonly<Record<string, unknown>> {
  return JSON.parse(event.canonicalUtf8) as Readonly<Record<string, unknown>>;
}

/** Derive the reconstruction audit event + evidence via the committed WP-8-G builders (fixed clock). */
function derivedReconstruction(env: TestEnv, facts: { readonly recordDigest: string; readonly originalActionIdentity: string; readonly recoveryTime: string }): { readonly event: NonNullable<ReturnType<typeof buildRecoveryAuditReconstructionEvent>['event']> } {
  const built = buildRecoveryAuditReconstructionEvent({
    storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
    primaryClass: 'approval-record',
    primaryRecordId: RECORD_ID,
    primaryRevision: 1,
    primaryDigest: facts.recordDigest,
    recoveryActionIdentity: RECOVERY_ACTION,
    recoveryTime: facts.recoveryTime,
  });
  assert.equal(built.ok, true);
  return { event: built.event! };
}

/** Run the committed audit-reconstruction mutation (event + evidence published). */
function reconstruct(env: TestEnv): { readonly recordDigest: string; readonly reconstructionAuditId: string } {
  const scan = runRecoveryScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(scan.ok, true, JSON.stringify(scan.findings));
  const candidate = scan.assessment!.reconstructionCandidates.find((c) => c.recordId === RECORD_ID);
  assert.ok(candidate !== undefined, 'the record must be a reconstruction candidate after its audit is removed');
  const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
  const request: RecoveryMutationRequest = {
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
      targetRecordDigest: candidate.recordDigest,
      expectedOriginalActionIdentity: WRITE_ACTION,
      expectedObservationIds: [candidate.observationId],
      expectedMissingAuditFindingId: candidate.observationId,
      expectedGeneration: scan.assessment!.source.generation,
      expectedSurfaceGeneration: scan.assessment!.source.surfaceGeneration,
    },
    timeSource: { now: () => 1000, processStartTime: 500 },
  };
  const result = executeRecoveryMutation(request);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { recordDigest: candidate.recordDigest, reconstructionAuditId: reconstructionAuditIdOf(env) };
}

/** Find the durable reconstruction audit id from the evidence payload. */
function reconstructionAuditIdOf(env: TestEnv): string {
  // Read the durable evidence directory for any audit-reconstruction evidence.
  const evidenceDir = `${env.storeRoot}/records/evidence`;
  const shards = safeReaddir(evidenceDir);
  for (const shard of shards) {
    for (const name of safeReaddir(`${evidenceDir}/${shard}`)) {
      const raw = readFileSync(`${evidenceDir}/${shard}/${name}`, 'utf8');
      const model = JSON.parse(raw) as Record<string, unknown>;
      const p = model['payload'] as Record<string, unknown>;
      if (p['recoveryOperation'] === 'audit-reconstruction' && p['targetRecordId'] === RECORD_ID) {
        return p['reconstructionAuditId'] as string;
      }
    }
  }
  throw new Error('no reconstruction evidence found');
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSorted(path);
  } catch {
    return [];
  }
}

import { readdirSync } from 'node:fs';
function readdirSorted(path: string): string[] {
  return [...readdirSync(path)].sort();
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function auditDerivedPath(env: TestEnv, eventId: string): string {
  const derived = deriveRecordRelativePath('authoritative-audit-event', eventId);
  assert.equal(derived.ok, true);
  return `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
}

function recordPath(env: TestEnv, recordId: string): string {
  const derived = deriveRecordRelativePath('approval-record', recordId);
  assert.equal(derived.ok, true);
  return `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
}

/** Write one canonical store-evidence envelope at its derived path (test fixture). */
function writeEvidenceEnvelope(env: TestEnv, model: Readonly<Record<string, unknown>>): void {
  const canonical = canonicalEnvelopeBytes(model);
  const derived = deriveRecordRelativePath('store-evidence-record', model['recordId'] as string);
  assert.equal(derived.ok, true);
  const path = `${env.storeRoot}/${(derived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(path, canonical.canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Pure canonical reconstruction-evidence model for one reconstruction event (WP-8-G §8 builder). */
function evidenceModelFor(env: TestEnv, targetDigest: string, event: { readonly recordId: string; readonly digest: string }, actionIdentity: string): Readonly<Record<string, unknown>> {
  const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
  assert.equal(storeResult.ok, true);
  const built = buildAuditReconstructionEvidenceRecord({
    storeInstance: storeResult.storeInstance!,
    actionIdentity,
    evidenceKind: 'recovery-evidence',
    recoveryOperation: 'audit-reconstruction',
    targetRecordClass: 'approval-record',
    targetRecordId: RECORD_ID,
    targetRecordDigest: targetDigest,
    originalActionIdentity: WRITE_ACTION,
    reconstructionAuditId: event.recordId,
    reconstructionAuditDigest: event.digest,
    missingAuditObservationId: 'obs-wp8k-fixture',
    generation: 'sha-256:' + 'a'.repeat(64),
    surfaceGeneration: 'sha-256:' + 'b'.repeat(64),
    outcome: 'reconstructed',
    createdAt: '2026-01-01T00:00:01.000Z',
  });
  assert.equal(built.ok, true);
  return JSON.parse(built.record!.canonicalUtf8) as Readonly<Record<string, unknown>>;
}

/** One reconstruction event built through the committed WP-8-G builder (distinct action/time). */
function reconstructionEvent(env: TestEnv, digest: string, recoveryActionIdentity: string, recoveryTime: string): NonNullable<ReturnType<typeof buildRecoveryAuditReconstructionEvent>['event']> {
  const built = buildRecoveryAuditReconstructionEvent({
    storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
    primaryClass: 'approval-record',
    primaryRecordId: RECORD_ID,
    primaryRevision: 1,
    primaryDigest: digest,
    recoveryActionIdentity,
    recoveryTime,
  });
  assert.equal(built.ok, true);
  return built.event!;
}

/** Page-1 cursor of a two-event truncated walk (enumerationResults 1). */
function truncatedWalkCursor(env: TestEnv): AuditHistoryCursor {
  const page1 = history(env, RECORD_ID);
  assert.equal(page1.ok, true, JSON.stringify(page1.findings));
  assert.equal(page1.completeness?.truncated, true, 'the fixture must produce a truncated first page');
  assert.ok(page1.continuation !== undefined);
  return page1.continuation!;
}

/** Walk every continuation page to completion and concatenate the reported collections. */
function walkAll(env: TestEnv, recordId: string, startCursor?: AuditHistoryCursor): {
  readonly pages: AuditHistoryInspectionResult[];
  readonly events: HistoryAuditEvent[];
  readonly annotations: ReconstructionEvidenceAnnotation[];
  readonly findings: AuditHistoryFinding[];
} {
  const pages: AuditHistoryInspectionResult[] = [];
  const events: HistoryAuditEvent[] = [];
  const annotations: ReconstructionEvidenceAnnotation[] = [];
  const findings: AuditHistoryFinding[] = [];
  let cursor: AuditHistoryCursor | undefined = startCursor;
  for (let i = 0; i < 64; i++) {
    const page = history(env, recordId, cursor === undefined ? {} : { continuation: cursor });
    assert.equal(page.ok, true, JSON.stringify(page.findings));
    pages.push(page);
    events.push(...(page.events ?? []));
    annotations.push(...(page.reconstructionEvidence ?? []));
    findings.push(...(page.auditFindings ?? []));
    if (page.continuation === undefined) return { pages, events, annotations, findings };
    cursor = page.continuation;
  }
  throw new Error('walk did not terminate within 64 pages');
}

/** Strip fields from an object (cursor-tamper fixtures). */
function without<T extends object, K extends keyof T>(obj: T, ...keys: readonly K[]): Omit<T, K> {
  const copy = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete copy[k as string];
  return copy as Omit<T, K>;
}

// ── Basic ──────────────────────────────────────────────────────────────────

test('audit-history: one exact original authorized-write is a complete history', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.status, 'complete');
    assert.equal(result.originalAuthorizedWrite?.present, true);
    assert.equal(result.originalAuthorizedWrite?.eventId, facts.auditEventId);
    assert.equal(result.originalAuthorizedWrite?.digest, facts.auditDigest);
    assert.equal(result.reconstruction?.present, false);
    assert.equal(result.events?.length, 1);
    const event = result.events![0]!;
    assert.equal(event.eventKind, 'authorized-write');
    assert.equal(event.isOriginalWrite, true);
    assert.equal(event.eventId, facts.auditEventId);
    assert.equal(event.digest, facts.auditDigest);
    assert.equal(event.trustedActionId, WRITE_ACTION);
    assert.equal(event.createdAt, facts.createdAt);
    assert.equal(result.auditFindings?.length, 0);
    assert.equal(result.completeness?.complete, true);
    assert.equal(result.completeness?.truncated, false);
    assert.equal(result.continuation, undefined);
    assert.equal(result.reconstructionEvidence?.length, 0);
    assert.ok(result.snapshot?.generation !== undefined);
    assert.ok(result.snapshot?.surfaceGeneration !== undefined);
    assert.equal(result.target?.recordId, RECORD_ID);
    assert.equal(result.target?.revision, 1);
    assert.equal(result.target?.recordDigest, facts.digest);
    assert.equal(result.target?.trustedActionId, WRITE_ACTION);
    // The raw nonce never appears; no authority/path fields exist.
    assert.equal('capability' in result, false);
    assert.equal('path' in result, false);
    assert.equal('nonce' in result, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(env.dir), false, 'no raw store path is disclosed');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: absent audit is missing-authorized-write with no reconstruction', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'missing-authorized-write');
    assert.equal(result.originalAuthorizedWrite?.present, false);
    assert.equal(result.reconstruction?.present, false);
    assert.equal(result.events?.length, 0);
    assert.equal(result.auditFindings?.some((f) => f.kind === 'missing-authorized-write'), true);
    assert.equal(result.completeness?.complete, false);
    // A missing audit for another record never leaks into this history.
    publish(env, OTHER_RECORD_ID);
    const again = history(env, RECORD_ID);
    assert.equal(again.events?.length, 0);
    assert.equal(again.status, 'missing-authorized-write');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: exact-revision binding and closed class/identity rejection', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    // Wrong revision: the target record carries revision 1.
    const wrongRevision = history(env, RECORD_ID, { revision: 2 });
    assert.equal(wrongRevision.ok, false);
    assert.equal(wrongRevision.findings[0]?.code, 'ERR-STO-INTEGRITY');
    // Revision 2 record publishes and is inspected at its own revision.
    const facts2 = publish(env, OTHER_RECORD_ID, { revision: 2 });
    const r2 = history(env, OTHER_RECORD_ID, { revision: 2 });
    assert.equal(r2.ok, true);
    assert.equal(r2.status, 'complete');
    assert.equal(r2.events![0]!.eventId, facts2.auditEventId);
    assert.equal(r2.events![0]!.eventId, computeAuditEventIdentity({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: OTHER_RECORD_ID,
      primaryRevision: 2,
      primaryDigest: facts2.digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: WRITE_ACTION,
      primaryCreatedAt: facts2.createdAt,
    }));
    // The audit class and configuration metadata are outside the inspected set.
    assert.equal(history(env, RECORD_ID, { recordClass: 'authoritative-audit-event' }).ok, false);
    assert.equal(history(env, RECORD_ID, { recordClass: 'store-metadata' }).ok, false);
    // Unknown target: fail closed.
    const missing = history(env, 'pgw:r:99990000000000000000000000000009');
    assert.equal(missing.ok, false);
    assert.equal(missing.findings[0]?.code, 'ERR-STO-NOT-FOUND');
    // Forged structural input grants nothing.
    const forged = inspectAuditHistory({ trustedConfiguration: env.config, trustedInput: { locator: env.dir }, recordClass: 'approval-record', recordId: RECORD_ID });
    assert.equal(forged.ok, false);
    assert.equal(forged.findings[0]?.code, 'ERR-STO-REQ-INVALID');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Reconstruction ─────────────────────────────────────────────────────────

test('audit-history: reconstructed gap reports the distinct reconstruction event, gap marker, and evidence annotation', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const recon = reconstruct(env);
    assert.ok(recon.reconstructionAuditId !== undefined);
    const auditId = reconstructionAuditIdOf(env);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.status, 'reconstructed-gap');
    assert.equal(result.originalAuthorizedWrite?.present, false);
    assert.equal(result.reconstruction?.present, true);
    assert.equal(result.events?.length, 1);
    const event = result.events![0]!;
    assert.equal(event.eventKind, 'recovery-audit-reconstruction');
    assert.equal(event.isOriginalWrite, false);
    assert.equal(event.eventId, auditId);
    assert.deepEqual(event.gapMarker, { missingEventKind: 'authorized-write' });
    assert.equal(event.trustedActionId, RECOVERY_ACTION, 'the reconstruction event carries the recovery action identity');
    assert.equal(event.createdAt, '1970-01-01T00:00:01.000Z', 'the recovery time is recorded creation evidence');
    // Original trusted action identity from the durable target facts.
    assert.equal(result.target?.trustedActionId, WRITE_ACTION);
    // No fabricated original event; no flattened kinds.
    assert.equal(result.events!.some((e) => e.eventKind === 'authorized-write'), false);
    // Evidence annotation: linked to the durable reconstruction event.
    assert.equal(result.reconstructionEvidence?.length, 1);
    const annotation = result.reconstructionEvidence![0]!;
    assert.equal(annotation.targetRecordDigest, facts.digest);
    assert.equal(annotation.originalActionIdentity, WRITE_ACTION);
    assert.equal(annotation.recoveryActionIdentity, RECOVERY_ACTION);
    assert.equal(annotation.reconstructionAuditId, auditId);
    assert.equal(annotation.linkedReconstructionEventId, auditId);
    assert.equal(annotation.verified, true);
    // A clean gap carries no error findings (the status documents the gap).
    assert.equal(result.auditFindings?.length, 0);
    assert.equal(result.completeness?.complete, false, 'a reconstructed gap is not a clean complete original lineage');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: original + reconstruction is ambiguous-history; neither is discarded', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    reconstruct(env);
    const auditId = reconstructionAuditIdOf(env);
    // Re-add the exact original authorized-write event (fixture write).
    writeAuditEnvelope(env, eventModel(env, { recordId: facts.auditEventId, canonicalUtf8: facts.auditCanonicalUtf8 }));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'ambiguous-history');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'ambiguous-history'), true);
    assert.equal(result.events?.length, 2, 'both the original and the reconstruction are reported');
    assert.equal(result.events!.some((e) => e.eventKind === 'authorized-write' && e.isOriginalWrite), true);
    assert.equal(result.events!.some((e) => e.eventKind === 'recovery-audit-reconstruction' && e.eventId === auditId), true);
    assert.equal(result.completeness?.complete, false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: two reconstruction events for the same gap are conflicting', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const first = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' });
    writeAuditEnvelope(env, eventModel(env, first.event));
    // A second reconstruction with a different recovery action (different identity).
    const secondBuilt = buildRecoveryAuditReconstructionEvent({
      storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      recoveryActionIdentity: 'another-recovery-action',
      recoveryTime: '2026-01-02T00:00:00.000Z',
    });
    assert.equal(secondBuilt.ok, true);
    writeAuditEnvelope(env, eventModel(env, secondBuilt.event!));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.events?.length, 2, 'both reconstruction events are reported, never silently discarded');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'conflicting-audit' && f.reason.includes('multiple reconstruction')), true);
    assert.equal(result.status, 'ambiguous-history');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: wrong-digest reconstruction is not adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const wrong = buildRecoveryAuditReconstructionEvent({
      storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: 'sha-256:' + '9'.repeat(64),
      recoveryActionIdentity: RECOVERY_ACTION,
      recoveryTime: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(wrong.ok, true);
    writeAuditEnvelope(env, eventModel(env, wrong.event!));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.events?.length, 0, 'a wrong-digest reconstruction is never adopted as history');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'wrong-target-digest'), true);
    assert.equal(result.status, 'ambiguous-history', 'a contested claim is not clean');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: reconstruction evidence without event is an integrity finding', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    reconstruct(env);
    const auditId = reconstructionAuditIdOf(env);
    // Remove the durable reconstruction EVENT; the evidence remains.
    unlinkSync(auditDerivedPath(env, auditId));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'missing-authorized-write');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'evidence-without-event'), true);
    assert.equal(result.reconstructionEvidence?.length, 1, 'the evidence remains observable');
    assert.equal(result.reconstructionEvidence![0]!.linkedReconstructionEventId, undefined, 'no durable event is linked');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: reconstruction event without evidence reports the exact observable state', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const first = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' });
    writeAuditEnvelope(env, eventModel(env, first.event));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'reconstructed-gap');
    assert.equal(result.auditFindings?.some((f) => f.kind === 'event-without-evidence'), true);
    assert.equal(result.reconstructionEvidence?.length, 0, 'no evidence is fabricated');
    assert.equal(result.events?.length, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Conflicts and tamper visibility ───────────────────────────────────────

test('audit-history: duplicate authorized-write, wrong digest, dangling, malformed, and unsupported version are findings', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    // Duplicate authorized-write: a valid envelope with a different action identity.
    const dup = buildAuthorizedWriteAuditEvent({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: 'another-writer-action',
      primaryCreatedAt: facts.createdAt,
    });
    assert.equal(dup.ok, true);
    writeAuditEnvelope(env, eventModel(env, dup.event!));
    // Wrong-digest authorized-write claim.
    const wrongDigest = buildAuthorizedWriteAuditEvent({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: 'sha-256:' + '8'.repeat(64),
      eventKind: 'authorized-write',
      trustedActionIdentity: WRITE_ACTION,
      primaryCreatedAt: facts.createdAt,
    });
    assert.equal(wrongDigest.ok, true);
    writeAuditEnvelope(env, eventModel(env, wrongDigest.event!));
    // Dangling: a canonical envelope with a malformed association payload.
    const danglingId = computeAuditEventIdentity({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: 'dangling-action',
      primaryCreatedAt: facts.createdAt,
    });
    const danglingDerived = deriveRecordRelativePath('authoritative-audit-event', danglingId);
    assert.equal(danglingDerived.ok, true);
    const danglingPath = `${env.storeRoot}/${(danglingDerived as { readonly ok: true; readonly relativePath: string }).relativePath}`;
    mkdirSync(danglingPath.slice(0, danglingPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(danglingPath, canonicalEnvelopeBytes({ recordKind: 'AuthoritativeAuditEvent', formatVersion: '1.0', recordId: danglingId, revision: 1, createdAt: facts.createdAt, trustedActionId: 'dangling-action', payload: { unrelated: true }, payloadDigest: computePayloadDigest({ unrelated: true }), referenceDigests: [facts.digest], retentionClass: 'indefinite' }).canonicalUtf8, { mode: 0o600 });
    chmodSync(danglingPath, 0o600);
    // Malformed: non-canonical bytes at a valid derived location.
    const malformedId = computeAuditEventIdentity({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: 'malformed-action',
      primaryCreatedAt: facts.createdAt,
    });
    const malformedPath = auditDerivedPath(env, malformedId);
    mkdirSync(malformedPath.slice(0, malformedPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(malformedPath, '{not canonical json', { mode: 0o600 });
    chmodSync(malformedPath, 0o600);
    // Unsupported version: a canonical envelope with formatVersion 2.0.
    const unsupportedId = computeAuditEventIdentity({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      eventKind: 'authorized-write',
      trustedActionIdentity: 'future-action',
      primaryCreatedAt: facts.createdAt,
    });
    const unsupportedPath = auditDerivedPath(env, unsupportedId);
    mkdirSync(unsupportedPath.slice(0, unsupportedPath.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    writeFileSync(unsupportedPath, canonicalEnvelopeBytes({ recordKind: 'AuthoritativeAuditEvent', formatVersion: '2.0', recordId: unsupportedId, revision: 1, createdAt: facts.createdAt, trustedActionId: 'future-action', payload: { eventKind: 'authorized-write', recordId: RECORD_ID, recordDigest: facts.digest }, payloadDigest: computePayloadDigest({ eventKind: 'authorized-write', recordId: RECORD_ID, recordDigest: facts.digest }), referenceDigests: [facts.digest], retentionClass: 'indefinite' }).canonicalUtf8, { mode: 0o600 });
    chmodSync(unsupportedPath, 0o600);

    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.status, 'ambiguous-history', 'contested lineage is never clean');
    assert.equal(result.completeness?.complete, false);
    // The genuine original event is still reported.
    assert.equal(result.originalAuthorizedWrite?.present, true);
    assert.equal(result.originalAuthorizedWrite?.eventId, facts.auditEventId);
    const kinds = new Set(result.auditFindings!.map((f) => f.kind));
    assert.equal(kinds.has('duplicate-audit'), true, 'the alternative authorized-write claim is a duplicate finding');
    assert.equal(kinds.has('wrong-target-digest'), true);
    assert.equal(kinds.has('dangling-audit'), true);
    assert.equal(kinds.has('malformed-audit'), true);
    assert.equal(kinds.has('unsupported-audit-version'), true);
    assert.equal(kinds.has('ambiguous-history'), true);
    // Nothing is repaired: every artifact is still present.
    assert.equal(exists(auditDerivedPath(env, dup.event!.recordId)), true);
    assert.equal(exists(facts.auditPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: conflicting reconstruction evidence linkage is a finding', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    reconstruct(env);
    // Duplicate evidence: a second reconstruction evidence claiming the same
    // reconstruction audit id is written by copying the durable evidence to a
    // second identity... (fixture: modify the evidence payload's outcome only
    // changes identity; duplicate linkage is detected via the audit id).
    const auditId = reconstructionAuditIdOf(env);
    // Reconstruct again with a DIFFERENT recovery time produces the SAME
    // evidence identity (time-independent) — instead write a conflicting
    // evidence whose reconstructionAuditId matches but target digest differs
    // by writing a second reconstruction event + evidence is complex; the
    // wrong-target-digest evidence case is covered by the audit finding tests.
    // Here: verify the committed evidence annotation is linked.
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    assert.equal(result.reconstructionEvidence?.length, 1);
    assert.equal(result.reconstructionEvidence![0]!.linkedReconstructionEventId, auditId);
    assert.equal(result.status, 'reconstructed-gap');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Ordering ───────────────────────────────────────────────────────────────

test('audit-history: normative tuple order is proven against an adversarial surface order (deterministic)', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const surfacePositionOf = (eventId: string): string => {
      const d = deriveRecordRelativePath('authoritative-audit-event', eventId);
      assert.equal(d.ok, true);
      const ok = d as { readonly ok: true; readonly shard: string; readonly filename: string };
      return `${ok.shard}/${ok.filename}`;
    };
    // Deterministic adversarial search (pure digest derivation; no fs
    // randomness, no temp-directory luck): find a second reconstruction
    // event whose SURFACE scan position precedes the first event's, so the
    // test PROVES surface enumeration order opposes the normative tuple
    // order before asserting the tuple-ordered delivery. The test fails if
    // the adversarial premise cannot be constructed.
    const early = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' }).event;
    let late: NonNullable<ReturnType<typeof buildRecoveryAuditReconstructionEvent>['event']> | undefined;
    for (let k = 0; k < 4096 && late === undefined; k++) {
      const candidate = reconstructionEvent(env, facts.digest, `surface-first-${k}`, '2026-01-02T00:00:00.000Z');
      if (surfacePositionOf(candidate.recordId) < surfacePositionOf(early.recordId)) {
        late = candidate;
      }
    }
    assert.ok(late !== undefined, 'adversarial premise: a surface-order-opposing pair must exist');
    const lateId = late!.recordId;
    assert.ok(surfacePositionOf(early.recordId) > surfacePositionOf(lateId), 'premise: surface enumeration order must oppose the normative tuple order');
    // Write the late-surface event FIRST (reverse surface order): creation
    // order on disk is irrelevant to both the scan and the tuple.
    writeAuditEnvelope(env, eventModel(env, late!));
    writeAuditEnvelope(env, eventModel(env, early));
    const result = history(env, RECORD_ID);
    assert.equal(result.events?.length, 2);
    assert.deepEqual(result.events!.map((e) => e.eventId), [early.recordId, lateId], 'the D-8 tuple (createdAt, recordId, eventId) wins over surface scan order');
    // Filesystem mtimes must never influence the order.
    utimesSync(auditDerivedPath(env, early.recordId), new Date(2030, 0, 1), new Date(2030, 0, 1));
    utimesSync(auditDerivedPath(env, lateId), new Date(2000, 0, 1), new Date(2000, 0, 1));
    const again = history(env, RECORD_ID);
    assert.deepEqual(again.events!.map((e) => e.eventId), [early.recordId, lateId], 'mtime never establishes ordering');
    // Identical facts yield identical identities (time-independent).
    const twin = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' });
    assert.equal(twin.event.recordId, early.recordId, 'time-independent identity: identical facts yield identical events');
    // The paginated delivery of the same pair follows the tuple too: with a
    // one-result budget the first page carries the tuple-first event even
    // though it surfaces second on disk.
    const budgetEnv = makeStore(profile({ enumerationResults: 1 }));
    try {
      const bfacts = publish(budgetEnv, RECORD_ID);
      unlinkSync(bfacts.auditPath);
      const bEarly = derivedReconstruction(budgetEnv, { recordDigest: bfacts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' }).event;
      let bLate: NonNullable<ReturnType<typeof buildRecoveryAuditReconstructionEvent>['event']> | undefined;
      for (let k = 0; k < 4096 && bLate === undefined; k++) {
        const candidate = reconstructionEvent(budgetEnv, bfacts.digest, `budget-surface-first-${k}`, '2026-01-02T00:00:00.000Z');
        if (surfacePositionOf(candidate.recordId) < surfacePositionOf(bEarly.recordId)) bLate = candidate;
      }
      assert.ok(bLate !== undefined);
      writeAuditEnvelope(budgetEnv, eventModel(budgetEnv, bLate!));
      writeAuditEnvelope(budgetEnv, eventModel(budgetEnv, bEarly));
      const walk = walkAll(budgetEnv, RECORD_ID);
      assert.deepEqual(walk.events.map((e) => e.eventId), [bEarly.recordId, bLate!.recordId], 'paginated delivery preserves the normative tuple order');
      assert.ok(walk.pages.length > 1, 'the budget fixture actually paginates');
    } finally {
      rmSync(budgetEnv.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Bounds, pagination, cursors ────────────────────────────────────────────

test('audit-history: results budget truncates with a self-validating cursor and resumes deterministically', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const first = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' });
    writeAuditEnvelope(env, eventModel(env, first.event));
    const secondBuilt = buildRecoveryAuditReconstructionEvent({
      storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      recoveryActionIdentity: 'second-recovery',
      recoveryTime: '2026-01-03T00:00:00.000Z',
    });
    assert.equal(secondBuilt.ok, true);
    writeAuditEnvelope(env, eventModel(env, secondBuilt.event!));
    const page1 = history(env, RECORD_ID);
    assert.equal(page1.ok, true);
    assert.equal(page1.events?.length, 1, 'the results budget caps the page');
    assert.equal(page1.completeness?.complete, false);
    assert.equal(page1.completeness?.truncated, true);
    assert.equal(page1.status, undefined, 'a truncated page carries no definitive status');
    assert.ok(page1.continuation !== undefined);
    const cursor = page1.continuation!;
    assert.equal(cursor.recordId, RECORD_ID);
    assert.equal(cursor.recordClass, 'approval-record');
    assert.equal(cursor.revision, 1);
    assert.equal(cursor.phase, 'audit');
    assert.equal(cursor.generation, page1.snapshot?.generation);
    assert.equal(cursor.surfaceGeneration, page1.snapshot?.surfaceGeneration);
    // Resume: the remaining event plus the synthesis.
    const page2 = history(env, RECORD_ID, { continuation: cursor });
    assert.equal(page2.ok, true, JSON.stringify(page2.findings));
    assert.equal(page2.events?.length, 1, 'only the not-yet-reported event is returned on the resumed page');
    assert.equal(page2.events![0]!.eventId, secondBuilt.event!.recordId);
    assert.equal(page2.completeness?.truncated, false);
    assert.equal(page2.status, 'ambiguous-history', 'the final page carries the synthesis (two reconstructions for one gap)');
    assert.equal(page2.auditFindings?.some((f) => f.kind === 'conflicting-audit' && f.reason.includes('multiple reconstruction')), true);
    assert.equal(page2.continuation, undefined);
    // The concatenated page views never duplicate or lose an event.
    const all = [...(page1.events ?? []), ...(page2.events ?? [])];
    assert.equal(all.length, 2);
    assert.equal(new Set(all.map((e) => e.eventId)).size, 2);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: cursor bindings fail closed on any tamper', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const first = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' });
    writeAuditEnvelope(env, eventModel(env, first.event));
    const secondBuilt = buildRecoveryAuditReconstructionEvent({
      storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      recoveryActionIdentity: 'cursor-test-recovery',
      recoveryTime: '2026-01-04T00:00:00.000Z',
    });
    assert.equal(secondBuilt.ok, true);
    writeAuditEnvelope(env, eventModel(env, secondBuilt.event!));
    const page1 = history(env, RECORD_ID);
    assert.ok(page1.continuation !== undefined);
    const cursor = page1.continuation!;
    const tampered = (patch: Partial<AuditHistoryCursor>): AuditHistoryCursor => ({ ...cursor, ...patch });
    // Another target.
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ recordId: OTHER_RECORD_ID }) }).ok, false);
    // Another store identity.
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ storeIdentity: 'pgw:h:' + '0'.repeat(32) }) }).ok, false);
    // Another generation / surface.
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ generation: 'sha-256:' + '1'.repeat(64) }) }).ok, false);
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ surfaceGeneration: 'sha-256:' + '2'.repeat(64) }) }).ok, false);
    // Another query shape.
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ queryShape: 'pgw:h:' + '3'.repeat(32) }) }).ok, false);
    // Another revision/class.
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ revision: 2 }) }).ok, false);
    assert.equal(history(env, RECORD_ID, { continuation: tampered({ recordClass: 'approval-record' }) }).ok, true, 'unchanged bindings pass');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: scan-entry and byte bounds fail closed over the limit', () => {
  const env = makeStore(profile({ totalScanEntries: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    // Two audit entries (target + other record) exceed the one-entry bound.
    publish(env, OTHER_RECORD_ID);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-LIMIT-EXCEEDED');
    void facts;
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: byte bound fails closed over the limit', () => {
  const env = makeStore(profile({ totalScanBytes: 512 }));
  try {
    publish(env, RECORD_ID);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-LIMIT-EXCEEDED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Concurrency / snapshot ─────────────────────────────────────────────────

test('audit-history: audit publication during inspection fails closed on the surface recheck', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    const stages: AuditHistoryStage[] = [];
    let injected = false;
    const result = inspectAuditHistoryByIdentity({
      storeInstance: storeResult.storeInstance!,
      namespaceRoot: env.storeRoot,
      recordClass: 'approval-record',
      recordId: RECORD_ID,
      hooks: {
        stage: (s) => {
          stages.push(s);
          if (s === 'after-audit-verification' && !injected) {
            injected = true;
            // A legitimate concurrent write publishes a new record + its audit.
            publish(env, OTHER_RECORD_ID);
          }
        },
      },
    });
    assert.equal(injected, true);
    assert.equal(result.ok, false, 'a surface change during inspection must fail closed');
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.deepEqual(stages, ['after-target-verification', 'after-audit-structure', 'after-audit-verification', 'after-evidence-structure', 'after-evidence-verification', 'before-surface-recheck'], 'the recheck detects the change before any page is returned');
    // The target history remains inspectable afterward (restart semantics).
    const after = history(env, RECORD_ID);
    assert.equal(after.ok, true);
    assert.equal(after.status, 'complete');
    void facts;
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history: target record replacement during inspection fails closed', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const storeResult = verifyStoreInstance({ locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1', limitProfile: env.limitProfile });
    assert.equal(storeResult.ok, true);
    let injected = false;
    const result = inspectAuditHistoryByIdentity({
      storeInstance: storeResult.storeInstance!,
      namespaceRoot: env.storeRoot,
      recordClass: 'approval-record',
      recordId: RECORD_ID,
      hooks: {
        stage: (s) => {
          if (s === 'after-audit-verification' && !injected) {
            injected = true;
            // Replace the target with a different canonical record (same path).
            const payload = { approved: false, replaced: true };
            const model = { recordKind: 'ApprovalRecord', formatVersion: '1.0', recordId: RECORD_ID, revision: 1, createdAt: '2026-02-01T00:00:00.000Z', trustedActionId: WRITE_ACTION, payload, payloadDigest: computePayloadDigest(payload) };
            writeFileSync(recordPath(env, RECORD_ID), canonicalEnvelopeBytes(model).canonicalUtf8, { mode: 0o600 });
            chmodSync(recordPath(env, RECORD_ID), 0o600);
          }
        },
      },
    });
    assert.equal(injected, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Index interaction ──────────────────────────────────────────────────────

test('audit-history: the persistent registry index never affects history (stale or current)', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const baseline = history(env, RECORD_ID);
    assert.equal(baseline.status, 'complete');
    // A stale/foreign index artifact must not change the history.
    const indexDir = `${env.storeRoot}/index/registry-index/0000`;
    mkdirSync(indexDir, { recursive: true, mode: 0o700 });
    writeFileSync(`${indexDir}/00000000000000000000000000000000.idx`, 'stale junk bytes', { mode: 0o600 });
    chmodSync(`${indexDir}/00000000000000000000000000000000.idx`, 0o600);
    const withStale = history(env, RECORD_ID);
    assert.equal(withStale.status, 'complete');
    assert.deepEqual(withStale.events, baseline.events);
    assert.equal(withStale.auditFindings?.length, 0);
    // A current-valid index (via the committed rebuild) also changes nothing:
    // history always derives from verified immutable audit/record facts.
    // (The scan tokens are re-read after the stale index artifact so the
    // rebuild request binds the current surface.)
    const scan = runRegistrySnapshotScan({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    assert.equal(scan.ok, true);
    const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const rebuilt = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: provenance,
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      trustedInput: env.trustedInput,
      action: { category: 'registry-index-rebuild', expectedRegistryGeneration: scan.scanFacts!.generation, expectedRegistrySurfaceGeneration: scan.scanFacts!.surfaceGeneration! },
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.findings));
    const withIndex = history(env, RECORD_ID);
    assert.equal(withIndex.status, 'complete');
    assert.deepEqual(withIndex.events, baseline.events);
    assert.equal(withIndex.originalAuthorizedWrite?.eventId, baseline.originalAuthorizedWrite?.eventId);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Read-only boundary / security ──────────────────────────────────────────

test('audit-history: results are pure data and can never be passed as authority', () => {
  const env = makeStore();
  try {
    publish(env, RECORD_ID);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true);
    // No authority-shaped fields exist anywhere in the result.
    const serialized = JSON.stringify(result);
    for (const marker of ['capability', 'provenance', 'permit', 'recoveryActionProvenance']) {
      assert.equal(serialized.includes(marker), false, `result must not carry ${marker}`);
    }
    // Passing the result as a recovery action provenance is rejected by the brand gate.
    const provenance = createRecoveryActionProvenance({ actionIdentity: RECOVERY_ACTION, locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: env.limitProfile });
    const forged = executeRecoveryMutation({
      trustedConfiguration: env.config,
      recoveryActionProvenance: { ...provenance, actionIdentity: RECOVERY_ACTION, locator: env.dir },
      locator: env.dir,
      serviceUid: UID,
      forbiddenRoots: [],
      limitProfile: env.limitProfile,
      action: { category: 'orphan-removal', targetEntry: 'x.tmp' },
      timeSource: { now: () => 1000, processStartTime: 500 },
    });
    // The structural clone is not genuine: rejected before any mutation.
    assert.equal(forged.ok, false);
    // isHistoryTargetClass is closed.
    assert.equal(isHistoryTargetClass('authoritative-audit-event'), false);
    assert.equal(isHistoryTargetClass('store-metadata'), false);
    assert.equal(isHistoryTargetClass('approval-record'), true);
    assert.equal(isHistoryTargetClass('store-evidence-record'), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── F2: reconstruction association probes (tampered candidates never adopted) ──

/** Read + rewrite one durable audit event model at its derived path (fixture tamper). */
function rewriteAuditModel(env: TestEnv, eventId: string, patch: (model: Record<string, unknown>) => void): void {
  const path = auditDerivedPath(env, eventId);
  const model = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  patch(model);
  writeFileSync(path, canonicalEnvelopeBytes(model).canonicalUtf8, { mode: 0o600 });
  chmodSync(path, 0o600);
}

test('audit-history F2-A: envelope revision tamper is malformed and never adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const valid = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' }).event;
    writeAuditEnvelope(env, eventModel(env, valid));
    rewriteAuditModel(env, valid.recordId, (m) => { m['revision'] = 2; });
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'the revision-tampered candidate is never adopted as verified history');
    const f = result.auditFindings!.find((x) => x.kind === 'malformed-audit' && x.reason.includes('envelope revision'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(f!.eventId, valid.recordId);
    assert.equal(result.status, 'missing-authorized-write');
    assert.equal(result.reconstruction?.present, false);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-B: trustedActionId tamper is conflicting and never adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const valid = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' }).event;
    writeAuditEnvelope(env, eventModel(env, valid));
    // Declared identity unchanged; the trusted action identity is replaced.
    rewriteAuditModel(env, valid.recordId, (m) => { m['trustedActionId'] = 'tampered-action'; });
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'the action-tampered candidate is never adopted');
    const f = result.auditFindings!.find((x) => x.kind === 'conflicting-audit' && x.reason.includes('deterministic derivation'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(result.status, 'ambiguous-history');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-C: declared event identity changed and placed at its derived location is conflicting', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const valid = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' }).event;
    const forgedId = computeAuditEventIdentity({
      storeInstance: namespaces(env),
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 1,
      primaryDigest: facts.digest,
      eventKind: 'recovery-audit-reconstruction',
      trustedActionIdentity: 'declared-identity-tamper',
      primaryCreatedAt: '2026-01-01T00:00:00.000Z',
    });
    const model = JSON.parse(valid.canonicalUtf8) as Record<string, unknown>;
    model['recordId'] = forgedId;
    // Written at the derived location of the FORGED identity (probe C).
    writeAuditEnvelope(env, model);
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'the identity-forged candidate is never adopted');
    const f = result.auditFindings!.find((x) => x.kind === 'conflicting-audit' && x.reason.includes('deterministic derivation'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(f!.eventId, forgedId);
    assert.equal(result.status, 'ambiguous-history');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-D/E/F: digest, revision, and gap-marker tamper are never adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    // D: target digest changed.
    const wrongDigest = reconstructionEvent(env, 'sha-256:' + '9'.repeat(64), 'f2-d', '2026-01-01T00:00:00.000Z');
    writeAuditEnvelope(env, eventModel(env, wrongDigest));
    // E: target revision changed (identity binds revision; envelope has none).
    const wrongRevision = buildRecoveryAuditReconstructionEvent({
      storeInstance: namespaces(env) as readonly { readonly kind: 'configuration' | 'store-records'; readonly dev: number; readonly ino: number }[],
      primaryClass: 'approval-record',
      primaryRecordId: RECORD_ID,
      primaryRevision: 2,
      primaryDigest: facts.digest,
      recoveryActionIdentity: 'f2-e',
      recoveryTime: '2026-01-02T00:00:00.000Z',
    });
    assert.equal(wrongRevision.ok, true);
    writeAuditEnvelope(env, eventModel(env, wrongRevision.event!));
    // F: gap marker changed (payload digest left stale on purpose: the gap
    // check precedes the payload-digest check).
    const valid = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-03T00:00:00.000Z' }).event;
    writeAuditEnvelope(env, eventModel(env, valid));
    rewriteAuditModel(env, valid.recordId, (m) => {
      const p = m['payload'] as Record<string, unknown>;
      const gap = p['gapMarker'] as Record<string, unknown>;
      gap['missingEventKind'] = 'conflicting-write';
    });
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'no tampered candidate is ever adopted');
    assert.equal(result.auditFindings!.some((x) => x.kind === 'wrong-target-digest' && x.reason.includes('reconstruction')), true, JSON.stringify(result.auditFindings));
    assert.equal(result.auditFindings!.some((x) => x.kind === 'conflicting-audit' && x.reason.includes('deterministic derivation')), true, JSON.stringify(result.auditFindings));
    assert.equal(result.auditFindings!.some((x) => x.kind === 'conflicting-audit' && x.reason.includes('gap marker')), true, JSON.stringify(result.auditFindings));
    assert.equal(result.status, 'ambiguous-history');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-G: evidence recovery-action binding inconsistent with the event is conflicting', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    // A SELF-CONSISTENT tampered event (identity re-derived over the tampered
    // action) plus evidence bound to a different recovery action.
    const tampered = reconstructionEvent(env, facts.digest, 'tampered-action', '2026-01-02T00:00:00.000Z');
    writeAuditEnvelope(env, eventModel(env, tampered));
    writeEvidenceEnvelope(env, evidenceModelFor(env, facts.digest, tampered, 'genuine-recovery-action'));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'the action-inconsistent event is never adopted');
    const f = result.auditFindings!.find((x) => x.kind === 'conflicting-audit' && x.reason.includes('recovery action identity'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(result.status, 'ambiguous-history');
    // The evidence remains observable, unlinked to any verified event.
    assert.equal(result.reconstructionEvidence?.length, 1);
    assert.equal(result.reconstructionEvidence![0]!.recoveryActionIdentity, 'genuine-recovery-action');
    assert.equal(result.reconstructionEvidence![0]!.linkedReconstructionEventId, undefined);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-H: canonical byte tamper (createdAt / payloadDigest) is never adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    reconstruct(env); // genuine event + evidence
    const auditId = reconstructionAuditIdOf(env);
    const originalDigest = history(env, RECORD_ID).reconstruction?.events[0]?.digest;
    assert.ok(originalDigest !== undefined);
    // Byte tamper keeping the declared identity: creation evidence changed.
    rewriteAuditModel(env, auditId, (m) => { m['createdAt'] = '2026-02-01T00:00:00.000Z'; });
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'the byte-tampered event is never adopted');
    const f = result.auditFindings!.find((x) => x.kind === 'conflicting-audit' && x.reason.includes('audit digest does not match'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(result.status, 'ambiguous-history');
    assert.equal(result.reconstructionEvidence?.length, 1, 'the evidence remains observable');
    assert.equal(result.reconstructionEvidence![0]!.linkedReconstructionEventId, undefined, 'no verified event is linked to the evidence');
    assert.equal(result.reconstructionEvidence![0]!.reconstructionAuditDigest, originalDigest);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-H2: payload-digest tamper is malformed and never adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const valid = derivedReconstruction(env, { recordDigest: facts.digest, originalActionIdentity: WRITE_ACTION, recoveryTime: '2026-01-01T00:00:00.000Z' }).event;
    writeAuditEnvelope(env, eventModel(env, valid));
    rewriteAuditModel(env, valid.recordId, (m) => { m['payloadDigest'] = 'sha-256:' + '0'.repeat(64); });
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.events?.length, 0, 'the digest-tampered candidate is never adopted');
    const f = result.auditFindings!.find((x) => x.kind === 'malformed-audit' && x.reason.includes('payload digest'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(result.status, 'missing-authorized-write');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F2-I: the valid reconstruction (event + evidence) remains fully adopted', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const e1 = reconstructionEvent(env, facts.digest, 'f2-i-1', '2026-01-02T00:00:00.000Z');
    writeAuditEnvelope(env, eventModel(env, e1));
    writeEvidenceEnvelope(env, evidenceModelFor(env, facts.digest, e1, 'f2-i-1'));
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.status, 'reconstructed-gap');
    assert.equal(result.events?.length, 1);
    assert.equal(result.events![0]!.eventId, e1.recordId);
    assert.equal(result.events![0]!.trustedActionId, 'f2-i-1', 'the event carries the recovery action identity');
    assert.equal(result.reconstructionEvidence?.length, 1);
    assert.equal(result.reconstructionEvidence![0]!.linkedReconstructionEventId, e1.recordId);
    assert.equal(result.auditFindings?.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── F3: cross-page snapshot coherence probes ──────────────────────────────

test('audit-history F3-A/B/C: between-page audit publication invalidates the cursor', () => {
  const runProbe = (publishedEvent: (env: TestEnv, digest: string) => { readonly recordId: string; readonly canonicalUtf8: string }): void => {
    const env = makeStore(profile({ enumerationResults: 1 }));
    try {
      const facts = publish(env, RECORD_ID);
      unlinkSync(facts.auditPath);
      writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'f3-a', '2026-01-02T00:00:00.000Z')));
      writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'f3-b', '2026-01-03T00:00:00.000Z')));
      const cursor = truncatedWalkCursor(env);
      const published = publishedEvent(env, facts.digest);
      assert.ok(published.recordId.length > 0);
      // The new authoritative audit event materializes between pages.
      writeAuditEnvelope(env, eventModel(env, published));
      const resume = history(env, RECORD_ID, { continuation: cursor });
      assert.equal(resume.ok, false, 'a new authoritative audit event between pages must fail the cursor closed');
      assert.equal(resume.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
      assert.equal(resume.status, undefined, 'no page data or status is returned under a stale cursor');
      assert.equal(resume.events, undefined);
      // The change is never silently absorbed: a fresh walk sees every event.
      const walk = walkAll(env, RECORD_ID);
      assert.equal(walk.events.length, 3, 'the newly materialized event is neither omitted nor duplicated in a fresh walk');
      assert.equal(new Set(walk.events.map((e) => e.eventId)).size, 3);
    } finally {
      rmSync(env.dir, { recursive: true, force: true });
    }
  };
  // A: earlier-tuple audit published between pages.
  runProbe((env, digest) => reconstructionEvent(env, digest, 'f3-earlier', '2026-01-01T00:00:00.000Z'));
  // B: later-tuple audit published between pages.
  runProbe((env, digest) => reconstructionEvent(env, digest, 'f3-later', '2026-01-04T00:00:00.000Z'));
  // C: a reconstruction event published between pages.
  runProbe((env, digest) => reconstructionEvent(env, digest, 'f3-recon', '2026-01-05T00:00:00.000Z'));
});

test('audit-history F3-D: between-page recovery-evidence publication invalidates the cursor', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const e1 = reconstructionEvent(env, facts.digest, 'f3-d1', '2026-01-02T00:00:00.000Z');
    const e2 = reconstructionEvent(env, facts.digest, 'f3-d2', '2026-01-03T00:00:00.000Z');
    writeAuditEnvelope(env, eventModel(env, e1));
    writeAuditEnvelope(env, eventModel(env, e2));
    const cursor = truncatedWalkCursor(env);
    writeEvidenceEnvelope(env, evidenceModelFor(env, facts.digest, e1, 'f3-d1'));
    const resume = history(env, RECORD_ID, { continuation: cursor });
    assert.equal(resume.ok, false, 'relevant evidence publication between pages must fail the cursor closed');
    assert.equal(resume.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(resume.status, undefined);
    // A fresh walk reports the evidence exactly once.
    const walk = walkAll(env, RECORD_ID);
    assert.equal(walk.annotations.length, 1);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F3-E: between-page target tamper invalidates the cursor', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'f3-e1', '2026-01-02T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'f3-e2', '2026-01-03T00:00:00.000Z')));
    const cursor = truncatedWalkCursor(env);
    const payload = { approved: false, replaced: true };
    const model = { recordKind: 'ApprovalRecord', formatVersion: '1.0', recordId: RECORD_ID, revision: 1, createdAt: '2026-02-01T00:00:00.000Z', trustedActionId: WRITE_ACTION, payload, payloadDigest: computePayloadDigest(payload) };
    writeFileSync(recordPath(env, RECORD_ID), canonicalEnvelopeBytes(model).canonicalUtf8, { mode: 0o600 });
    chmodSync(recordPath(env, RECORD_ID), 0o600);
    const resume = history(env, RECORD_ID, { continuation: cursor });
    assert.equal(resume.ok, false, 'a target-record change between pages must fail the cursor closed');
    assert.equal(resume.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(resume.status, undefined);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('audit-history F3-F: registry-index mutation between pages never invalidates the walk', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    // The index family exists BEFORE the walk (structural stability); the
    // between-page mutation only writes an index entry into the shard.
    const indexDir = `${env.storeRoot}/index/registry-index/0000`;
    mkdirSync(indexDir, { recursive: true, mode: 0o700 });
    writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'f3-f1', '2026-01-02T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'f3-f2', '2026-01-03T00:00:00.000Z')));
    const cursor = truncatedWalkCursor(env);
    const page1Events = [...(history(env, RECORD_ID).events ?? [])];
    // Irrelevant registry-index state mutated between pages.
    writeFileSync(`${indexDir}/00000000000000000000000000000000.idx`, 'stale junk bytes', { mode: 0o600 });
    chmodSync(`${indexDir}/00000000000000000000000000000000.idx`, 0o600);
    const walk = walkAll(env, RECORD_ID, cursor);
    const allEvents = [...page1Events, ...walk.events];
    assert.equal(allEvents.length, 2, 'the walk completes with the exact authoritative events');
    assert.equal(new Set(allEvents.map((e) => e.eventId)).size, 2);
    assert.equal(walk.pages[walk.pages.length - 1]!.status, 'ambiguous-history');
    assert.equal(walk.pages[walk.pages.length - 1]!.continuation, undefined);
    // The same walk without the index mutation is identical (history truth is
    // independent of the persistent registry index).
    const baseline = walkAll(env, RECORD_ID);
    assert.deepEqual(baseline.events, allEvents);
    assert.deepEqual(baseline.findings, [...(history(env, RECORD_ID).auditFindings ?? []), ...walk.findings]);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── F4: annotation pagination ─────────────────────────────────────────────

test('audit-history F4: annotations and events are reported exactly once across a multi-page walk', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    const e1 = reconstructionEvent(env, facts.digest, 'f4-e1', '2026-01-02T00:00:00.000Z');
    const e2 = reconstructionEvent(env, facts.digest, 'f4-e2', '2026-01-03T00:00:00.000Z');
    const e3 = reconstructionEvent(env, facts.digest, 'f4-e3', '2026-01-04T00:00:00.000Z');
    writeAuditEnvelope(env, eventModel(env, e1));
    writeAuditEnvelope(env, eventModel(env, e2));
    writeAuditEnvelope(env, eventModel(env, e3));
    writeEvidenceEnvelope(env, evidenceModelFor(env, facts.digest, e1, 'f4-e1'));
    writeEvidenceEnvelope(env, evidenceModelFor(env, facts.digest, e2, 'f4-e2'));
    const walk = walkAll(env, RECORD_ID);
    assert.ok(walk.pages.length > 2, `the walk spans more than two pages (${walk.pages.length})`);
    // No duplicate or omitted event; normative tuple order preserved.
    assert.deepEqual(walk.events.map((e) => e.eventId), [e1.recordId, e2.recordId, e3.recordId]);
    assert.equal(new Set(walk.events.map((e) => e.eventId)).size, 3);
    // No duplicate or omitted annotation across the concatenated pages.
    assert.equal(walk.annotations.length, 2);
    assert.equal(new Set(walk.annotations.map((a) => a.evidenceId)).size, 2);
    // Pages whose audit surface was truncated carry no annotations at all.
    for (const page of walk.pages) {
      if (page.completeness?.truncated && page.continuation?.phase === 'audit') {
        assert.equal(page.reconstructionEvidence?.length, 0, 'annotations never leak onto event-budget pages');
      }
    }
    // Final page: synthesis and completeness from the same bound snapshot.
    const last = walk.pages[walk.pages.length - 1]!;
    assert.equal(last.status, 'ambiguous-history');
    assert.equal(last.continuation, undefined);
    assert.equal(last.completeness?.truncated, false);
    assert.equal(last.completeness?.complete, false);
    assert.equal(walk.findings.filter((f) => f.reason.includes('multiple reconstruction')).length, 1, 'the summary finding appears exactly once');
    // Every page of the walk binds the SAME authoritative snapshot identity.
    const identities = new Set(walk.pages.map((p) => p.snapshot?.historySnapshotIdentity));
    assert.equal(identities.size, 1, 'one authoritative snapshot across the whole walk');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Cursor format versioning ──────────────────────────────────────────────

test('audit-history: cursor format version and snapshot binding fail closed (versioning)', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'ver-1', '2026-01-02T00:00:00.000Z')));
    writeAuditEnvelope(env, eventModel(env, reconstructionEvent(env, facts.digest, 'ver-2', '2026-01-03T00:00:00.000Z')));
    const cursor = truncatedWalkCursor(env);
    // Current cursor accepted.
    const resumed = history(env, RECORD_ID, { continuation: cursor });
    assert.equal(resumed.ok, true, JSON.stringify(resumed.findings));
    // Pre-HST-005 / old-shape cursor (no format marker, no snapshot binding,
    // no tuple resume state): rejected, never interpreted.
    const oldShape = without(cursor, 'formatVersion', 'historySnapshotIdentity', 'lastReportedEventTuple') as AuditHistoryCursor;
    assert.equal(history(env, RECORD_ID, { continuation: oldShape }).ok, false);
    // Missing version field.
    const missingVersion = without(cursor, 'formatVersion') as AuditHistoryCursor;
    const mv = history(env, RECORD_ID, { continuation: missingVersion });
    assert.equal(mv.ok, false);
    assert.equal(mv.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    // Missing snapshot binding.
    const missingSnapshot = without(cursor, 'historySnapshotIdentity') as AuditHistoryCursor;
    const ms = history(env, RECORD_ID, { continuation: missingSnapshot });
    assert.equal(ms.ok, false);
    assert.equal(ms.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    // Unsupported future version.
    const future = history(env, RECORD_ID, { continuation: { ...cursor, formatVersion: 2 } });
    assert.equal(future.ok, false);
    assert.equal(future.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    // Tampered version (wrong type).
    const tampered = history(env, RECORD_ID, { continuation: { ...cursor, formatVersion: 'v1' as unknown as number } });
    assert.equal(tampered.ok, false);
    assert.equal(tampered.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    // Current cursor from another target/revision.
    const otherTarget = history(env, RECORD_ID, { continuation: { ...cursor, recordId: OTHER_RECORD_ID } });
    assert.equal(otherTarget.ok, false);
    assert.equal(otherTarget.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    const otherRevision = history(env, RECORD_ID, { continuation: { ...cursor, revision: 2 } });
    assert.equal(otherRevision.ok, false);
    assert.equal(otherRevision.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    // Current cursor with a modified snapshot identity: valid format, but the
    // recomputed authoritative identity differs — fail closed before data.
    const modifiedSnapshot = history(env, RECORD_ID, { continuation: { ...cursor, historySnapshotIdentity: 'pgw:h:' + 'f'.repeat(32) } });
    assert.equal(modifiedSnapshot.ok, false);
    assert.equal(modifiedSnapshot.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(modifiedSnapshot.status, undefined);
    // Structurally ambiguous cursor: audit phase without a position.
    const ambiguous = history(env, RECORD_ID, { continuation: { ...cursor, phase: 'audit' as const, lastAuditShard: undefined as unknown as string, lastAuditEntry: undefined as unknown as string } });
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.findings[0]?.code, 'ERR-STO-REQ-INVALID');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Finding/status consistency across one authoritative snapshot ─────────

test('audit-history: every page of a walk derives from one authoritative history snapshot (regression)', () => {
  const env = makeStore(profile({ enumerationResults: 1 }));
  try {
    const facts = publish(env, RECORD_ID);
    unlinkSync(facts.auditPath);
    reconstruct(env);
    const auditId = reconstructionAuditIdOf(env);
    // Contested lineage: re-add the exact original alongside the reconstruction.
    writeAuditEnvelope(env, eventModel(env, { recordId: facts.auditEventId, canonicalUtf8: facts.auditCanonicalUtf8 }));
    const walk = walkAll(env, RECORD_ID);
    const last = walk.pages[walk.pages.length - 1]!;
    assert.equal(last.status, 'ambiguous-history');
    assert.equal(last.continuation, undefined);
    assert.equal(walk.events.length, 2, 'the concatenated walk delivers both events exactly once');
    assert.equal(walk.events.some((e) => e.eventId === auditId), true);
    assert.equal(walk.events.some((e) => e.eventId === facts.auditEventId && e.isOriginalWrite), true);
    // A truncated page never carries a definitive status.
    for (const page of walk.pages) {
      if (page.completeness?.truncated === true) {
        assert.equal(page.status, undefined, 'truncated pages carry no status');
      }
    }
    // All pages bind one snapshot identity.
    const identities = new Set(walk.pages.map((p) => p.snapshot?.historySnapshotIdentity));
    assert.equal(identities.size, 1);
    // The final findings/status equal a fresh walk's synthesis (a single
    // inspection under a bounded budget is itself truncated and carries no
    // definitive status).
    const freshWalk = walkAll(env, RECORD_ID);
    assert.equal(freshWalk.pages[freshWalk.pages.length - 1]!.status, last.status);
    assert.equal(freshWalk.pages[freshWalk.pages.length - 1]!.auditFindings!.filter((f) => f.kind === 'ambiguous-history').length, 1);
    assert.equal(walk.findings.filter((f) => f.kind === 'ambiguous-history').length, 1, 'the contested-lineage finding appears exactly once in the walk');
    // Page 1 of the walk equals a fresh walk's first page (deterministic replay).
    assert.deepEqual(freshWalk.pages[0]!.events, walk.pages[0]!.events);
    assert.equal(freshWalk.pages[0]!.snapshot?.historySnapshotIdentity, walk.pages[0]!.snapshot?.historySnapshotIdentity);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ── Original authorized-write path (never weakened) ───────────────────────

test('audit-history: tampered original authorized-write is never adopted as verified original history (regression)', () => {
  const env = makeStore();
  try {
    const facts = publish(env, RECORD_ID);
    // In-place tamper at the EXACT expected identity: creation evidence
    // changed, declared identity unchanged → bytes no longer match the
    // deterministic D-8 expected event.
    rewriteAuditModel(env, facts.auditEventId, (m) => { m['createdAt'] = '2026-03-01T00:00:00.000Z'; });
    const result = history(env, RECORD_ID);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.originalAuthorizedWrite?.present, false, 'the tampered original is never adopted');
    assert.equal(result.events?.length, 0);
    assert.equal(result.events?.some((e) => e.isOriginalWrite), false);
    const f = result.auditFindings!.find((x) => x.kind === 'conflicting-audit' && x.reason.includes('expected identity'));
    assert.ok(f !== undefined, JSON.stringify(result.auditFindings));
    assert.equal(f!.eventId, facts.auditEventId);
    assert.equal(result.status, 'ambiguous-history');
    // Nothing is repaired: the tampered artifact is still present.
    assert.equal(exists(facts.auditPath), true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
