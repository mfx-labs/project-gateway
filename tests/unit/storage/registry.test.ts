/**
 * WP-8-E registry tests: read-only store scan, candidate classification,
 * and registry-view derivation (contract §13 RDS-004/005/007, §14 RGY,
 * §19 LMT, §24 DTM; WP-8-E scope items 1–3).
 *
 * All fixtures are test-created temporary stores; records and audit events
 * are published through the accepted publication path with test-only
 * producers, and tamper fixtures are written directly by the tests. The
 * tests prove: deterministic scan order and reproducibility; exact and
 * limit-plus-one entry/byte bounds; malformed, unsupported-version,
 * digest-mismatch, wrong-location, symlink/special-file, wrong-mode and
 * synthetic wrong-UID classifications; concurrent directory drift
 * fail-closed; duplicate identity and conflicting revisions; revision
 * ordering and the latest resolvable revision; missing and dangling audit;
 * continuation resumption; no mutation during the scan; no raw path
 * disclosure; no authority production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  chmodSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  linkSync,
  unlinkSync,
  statSync,
  readdirSync,
  renameSync,
  copyFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../../src/storage/publication/index.js';
import { deriveRegistryView } from '../../../src/storage/registry/index.js';
import { classifyCandidate, type CandidateFacts } from '../../../src/storage/registry/classify.js';
import { computeScanGeneration, scanStoreSnapshot } from '../../../src/storage/recovery/index.js';
import { createReadCapability } from '../../../src/storage/capabilities/authenticity.js';
import { revalidateStore } from '../../../src/storage/read/index.js';
import { computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';
import { deriveRecordRelativePath } from '../../../src/storage/layout/layout.js';
import { RECORD_CLASS_BY_ID } from '../../../src/storage/format/taxonomy.js';
import { jcsSerialize } from '../../../src/canonical/jcs.js';
import type { ScanBounds, ScanCursor, ScanHooks, ScanMode, ScanObservation, RegistryView, RecordCandidateClassification, StoreScanResult, VerifiedStoreInstance } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const WRITE_ACTION = 'registry-test-action';

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
}

function makeStore(limitProfile: SelectedLimitProfile = profile()): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp8e-reg-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bootstrapProvenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'registry-bootstrap-action',
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
  return { dir, config, trustedInput: inputResult.input, limitProfile };
}

function publish(env: TestEnv, recordId: string, payload: Readonly<Record<string, unknown>> = { approved: true }, revision = 1, extra: Readonly<Record<string, unknown>> = {}, recordClass: string = 'approval-record'): void {
  const provenance = createStorageWriteActionProvenance({
    actionIdentity: WRITE_ACTION,
    locator: env.dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: env.limitProfile,
  });
  const profile = RECORD_CLASS_BY_ID.get(recordClass as never);
  assert.ok(profile !== undefined, `unknown record class ${recordClass}`);
  const record = {
    recordKind: profile.label,
    formatVersion: '1.0',
    recordId,
    revision,
    createdAt: '2026-01-01T00:00:00.000Z',
    trustedActionId: WRITE_ACTION,
    payload,
    payloadDigest: computePayloadDigest(payload),
    ...extra,
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
}

/** Store-records namespace path. */
function storePath(env: TestEnv): string {
  return join(env.dir, 'store-v1');
}

/** Derived record path for an approval record (records surface). */
function approvalPath(env: TestEnv, recordId: string): string {
  const derived = deriveRecordRelativePath('approval-record', recordId);
  assert.equal(derived.ok, true);
  return join(storePath(env), derived.relativePath);
}

function view(env: TestEnv): RegistryView {
  const result = deriveRegistryView({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return result.view!;
}

function revalidatedStore(env: TestEnv): VerifiedStoreInstance {
  const store = revalidateStore({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
  assert.equal(store.ok, true);
  return store.storeInstance!;
}

function scanWithBounds(env: TestEnv, bounds: ScanBounds, continuation?: ScanCursor, hooks?: ScanHooks): StoreScanResult {
  const capability = createReadCapability({ trustedInput: env.trustedInput, storeInstance: revalidatedStore(env) });
  assert.ok(capability !== undefined);
  return scanStoreSnapshot({
    capability,
    namespaceRoot: storePath(env),
    bounds,
    ...(continuation !== undefined ? { continuation } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
  });
}

function scanOf(env: TestEnv, overrides: Partial<SelectedLimitProfile> = {}, mode: ScanMode = 'registry'): StoreScanResult {
  const merged = { ...env.limitProfile, ...overrides };
  const failClosed = mode === 'recovery';
  return scanWithBounds(env, {
    mode,
    entryLimit: failClosed ? (merged['recoveryScanEntries'] ?? 1024 * 1024) : (merged['totalScanEntries'] ?? 1024 * 1024),
    byteLimit: merged['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
    failClosed,
  });
}

/** Page through a store with identical bounds until the scan terminates. */
function pageAll(env: TestEnv, bounds: ScanBounds): readonly ScanObservation[] {
  const out: ScanObservation[] = [];
  let cursor: ScanCursor | undefined;
  let guard = 0;
  for (;;) {
    guard++;
    assert.ok(guard <= 100, 'paging must terminate');
    const page = scanWithBounds(env, bounds, cursor);
    assert.equal(page.ok, true, JSON.stringify(page.findings));
    out.push(...page.observations);
    if (!page.truncated) return out;
    assert.ok(page.continuation !== undefined, 'truncated pages must return a continuation');
    if (cursor !== undefined) {
      const next = page.continuation!;
      const advances = next.recordClass !== cursor.recordClass || next.shard !== cursor.shard || next.entry !== cursor.entry;
      assert.equal(advances, true, 'cursor must advance strictly beyond the previous cursor');
    }
    cursor = page.continuation;
  }
}

/** Missing record-class directory findings (F3 parent report). */
function missingClassFindings(findings: readonly { readonly code: string; readonly message: string }[]): readonly { readonly code: string; readonly message: string }[] {
  return findings.filter((f) => f.code === 'ERR-STO-INTEGRITY' && f.message.startsWith('required record-class directory is absent: '));
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

function classificationOf(obs: readonly ScanObservation[], entry: string): string | undefined {
  return obs.find((o) => o.entry === entry)?.classification;
}

/** Create a listening Unix-domain socket file; keeps listening until closed. */
function makeSocket(path: string): Promise<{ close(): void }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(path, () => resolve({ close: () => server.close() }));
  });
}

test('registry: deterministic scan order and reproducible view', () => {
  const env = makeStore();
  try {
    // Three records across classes and shards (shard = first 4 opaque chars).
    publish(env, 'pgw:r:11110000000000000000000000000001');
    publish(env, 'pgw:r:22220000000000000000000000000002');
    publish(env, 'pgw:r:33330000000000000000000000000003');
    const a = view(env);
    const b = view(env);
    assert.deepEqual(a, b, 'views must be reproducible from the same bytes');
    // recordsByClass: approval group in deterministic (shard, entry) order.
    const approvals = a.recordsByClass['approval-record'];
    assert.equal(approvals?.length, 3);
    assert.deepEqual(
      approvals?.map((v) => v.recordId),
      ['pgw:r:11110000000000000000000000000001', 'pgw:r:22220000000000000000000000000002', 'pgw:r:33330000000000000000000000000003'],
    );
    // Every verified record has its audit event; no missing/dangling audit.
    assert.equal(a.missingAudit.length, 0, JSON.stringify(a.missingAudit));
    assert.equal(a.danglingAudit.length, 0);
    assert.equal(a.findings.length, 0);
    for (const recordId of ['pgw:r:11110000000000000000000000000001', 'pgw:r:22220000000000000000000000000002', 'pgw:r:33330000000000000000000000000003']) {
      assert.ok(a.auditByPrimary[recordId] !== undefined && a.auditByPrimary[recordId]!.length >= 1, `audit missing for ${recordId}`);
    }
    // Scan order determinism at the observation level.
    const scanA = scanOf(env);
    const scanB = scanOf(env);
    assert.deepEqual(scanA.observations, scanB.observations);
    const entries = scanA.observations.map((o) => o.entry);
    assert.equal(entries.length, 6); // 3 records + 3 audit events
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: entry limit exact and +1', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    // Entries examined: approval shard name (1) + record (1) + audit shard
    // name (1) + audit event (1) = 4.
    const exact = scanOf(env, { totalScanEntries: 4 });
    assert.equal(exact.ok, true);
    assert.equal(exact.truncated, false);
    assert.equal(exact.scannedEntries, 4);
    assert.equal(exact.observations.length, 2);
    // Parent-level report: exactly the 15 absent record-class directories
    // (approval and audit-event exist); budget-free (F3).
    assert.equal(missingClassFindings(exact.findings).length, 15);
    assert.equal(exact.findings.length, 15);
    const plusOne = scanOf(env, { totalScanEntries: 3 });
    assert.equal(plusOne.ok, true);
    assert.equal(plusOne.truncated, true);
    assert.equal(plusOne.scannedEntries, 4);
    assert.equal(plusOne.observations.length, 1); // only the approval record processed
    assert.ok(plusOne.findings.some((f) => f.code === 'ERR-STO-LIMIT-EXCEEDED'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: byte limit exact and +1', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const recSize = statSync(approvalPath(env, 'pgw:r:11110000000000000000000000000001')).size;
    const auditDerived = deriveRecordRelativePath('authoritative-audit-event', 'pgw:r:11110000000000000000000000000001');
    // The audit event identity is deterministic but unknown here; find the
    // single .aud file under audit/audit-event/.
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
    const audSize = statSync(auditFiles[0]!).size;
    assert.ok(auditDerived.ok);
    const exact = scanOf(env, { totalScanBytes: recSize + audSize });
    assert.equal(exact.ok, true);
    assert.equal(exact.truncated, false);
    assert.equal(exact.scannedBytes, recSize + audSize);
    assert.equal(exact.observations.length, 2);
    assert.equal(missingClassFindings(exact.findings).length, 15);
    const plusOne = scanOf(env, { totalScanBytes: recSize + audSize - 1 });
    assert.equal(plusOne.ok, true);
    assert.equal(plusOne.truncated, true);
    assert.equal(plusOne.scannedBytes, recSize); // stopped before the audit file
    assert.equal(plusOne.observations.length, 1);
    assert.ok(plusOne.findings.some((f) => f.code === 'ERR-STO-LIMIT-EXCEEDED'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: continuation resumes strictly after the cursor with identical bounds (F1/F2)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 4 * 1024 * 1024 * 1024, failClosed: false };
    const first = scanWithBounds(env, bounds);
    assert.equal(first.truncated, true);
    assert.ok(first.continuation !== undefined);
    // Full scan with default bounds is the reference set.
    const reference = scanOf(env);
    assert.equal(reference.truncated, false);
    // Resume with the SAME bounds: the cursor generation must match.
    const resumed = scanWithBounds(env, bounds, first.continuation);
    assert.equal(resumed.ok, true, JSON.stringify(resumed.findings));
    const combined = [...first.observations, ...resumed.observations];
    assert.deepEqual(
      combined.map((o) => o.entry).sort(),
      reference.observations.map((o) => o.entry).sort(),
    );
    assert.equal(resumed.truncated, false);
    // No observation is reported twice across the pages.
    assert.equal(new Set(combined.map((o) => o.id)).size, combined.length);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: malformed, unsupported version, digest mismatch and wrong location', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001'); // valid
    // Malformed: garbage bytes.
    const malformedPath = approvalPath(env, 'pgw:r:22220000000000000000000000000002');
    mkdirSync(join(storePath(env), 'records', 'approval', '2222'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', '2222'), 0o700);
    writeFileSync(malformedPath, '{broken', { mode: 0o600 });
    // Unsupported version: canonical bytes with formatVersion 9.9.
    const unsupportedPath = approvalPath(env, 'pgw:r:33330000000000000000000000000003');
    mkdirSync(join(storePath(env), 'records', 'approval', '3333'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', '3333'), 0o700);
    const unsupported = {
      recordKind: 'ApprovalRecord',
      formatVersion: '9.9',
      recordId: 'pgw:r:33330000000000000000000000000003',
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: true },
      payloadDigest: computePayloadDigest({ approved: true }),
    };
    writeFileSync(unsupportedPath, jcsSerialize(unsupported), { mode: 0o600 });
    // Digest mismatch: valid envelope with a stale payload digest.
    publish(env, 'pgw:r:44440000000000000000000000000004');
    const digestPath = approvalPath(env, 'pgw:r:44440000000000000000000000000004');
    const digestModel = JSON.parse(readFileSync(digestPath, 'utf8')) as Record<string, unknown>;
    digestModel['payload'] = { approved: false };
    writeFileSync(digestPath, jcsSerialize(digestModel), { mode: 0o600 });
    // Wrong location: identical bytes at a non-derived shard.
    const wrongPath = join(storePath(env), 'records', 'approval', 'ffff', '11110000000000000000000000000001.rec');
    mkdirSync(join(storePath(env), 'records', 'approval', 'ffff'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', 'ffff'), 0o700);
    copyFileSync(approvalPath(env, 'pgw:r:11110000000000000000000000000001'), wrongPath);
    chmodSync(wrongPath, 0o600);

    const v = view(env);
    const scan = scanOf(env);
    assert.equal(classificationOf(scan.observations, '22220000000000000000000000000002.rec'), 'malformed');
    assert.equal(classificationOf(scan.observations, '33330000000000000000000000000003.rec'), 'unsupported-version');
    assert.equal(classificationOf(scan.observations, '44440000000000000000000000000004.rec'), 'digest-mismatch');
    assert.equal(classificationOf(scan.observations, '11110000000000000000000000000001.rec'), 'valid-immutable-record');
    // The wrong-location copy keeps wrong-derived-location (precedence), and
    // the derived-location record is contested: it never enters the view
    // groups and never resolves to a latest revision.
    const wrong = scan.observations.find((o) => o.kind === 'record' && o.entry === '11110000000000000000000000000001.rec' && o.shard === 'ffff');
    assert.equal(wrong?.classification, 'wrong-derived-location');
    assert.ok(v.duplicateConflicts.some((d) => d.identity === 'pgw:r:11110000000000000000000000000001' && d.kind === 'duplicate-identity'));
    assert.equal(v.latestResolvableRevision['pgw:r:11110000000000000000000000000001'], undefined);
    assert.equal(v.recordsByIdentity['pgw:r:11110000000000000000000000000001'], undefined);
    // The contested record does not appear in recordsByClass (views derive
    // from verified records only; the contest is reported, never resolved).
    assert.ok(!(v.recordsByClass['approval-record'] ?? []).some((r) => r.recordId === 'pgw:r:11110000000000000000000000000001'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: conflicting revisions fail closed', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001', { approved: true }, 1);
    // Same identity, same revision, different payload at a wrong shard.
    const conflictModel = {
      recordKind: 'ApprovalRecord',
      formatVersion: '1.0',
      recordId: 'pgw:r:11110000000000000000000000000001',
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trustedActionId: WRITE_ACTION,
      payload: { approved: false },
      payloadDigest: computePayloadDigest({ approved: false }),
    };
    const wrongPath = join(storePath(env), 'records', 'approval', 'ffff', '11110000000000000000000000000001.rec');
    mkdirSync(join(storePath(env), 'records', 'approval', 'ffff'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', 'ffff'), 0o700);
    writeFileSync(wrongPath, jcsSerialize(conflictModel), { mode: 0o600 });
    const v = view(env);
    const conflict = v.duplicateConflicts.find((d) => d.identity === 'pgw:r:11110000000000000000000000000001');
    assert.ok(conflict !== undefined);
    assert.equal(conflict.kind, 'conflict-revision');
    assert.equal(conflict.code, 'ERR-STO-CONFLICT-REVISION');
    assert.ok(v.findings.some((f) => f.code === 'ERR-STO-CONFLICT-REVISION'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: revision ordering, latest resolvable revision and chain breaks', () => {
  const env = makeStore();
  try {
    const first = 'pgw:r:55550000000000000000000000000005';
    const second = 'pgw:r:55560000000000000000000000000006';
    publish(env, first, { approved: true }, 1);
    // Chained record: previousRecordDigest is the record-bytes digest of the
    // first record (chains link records by digest; RFM-007/ITG-002).
    const firstScan = scanOf(env);
    const firstObs = firstScan.observations.find((o): o is Extract<ScanObservation, { kind: 'record' }> => o.kind === 'record' && o.entry.startsWith('5555'));
    const firstDigest = firstObs?.envelope?.recordDigest;
    assert.ok(firstDigest !== undefined);
    publish(env, second, { approved: true, note: 'chained' }, 2, { previousRecordDigest: firstDigest });
    const v = view(env);
    // Revision ordering: each identity group is sorted by (revision, digest);
    // latest resolvable revision per identity is the highest verified record.
    assert.equal(v.recordsByIdentity[first]?.length, 1);
    assert.equal(v.recordsByIdentity[second]?.length, 1);
    assert.equal(v.latestResolvableRevision[first]?.revision, 1);
    assert.equal(v.latestResolvableRevision[second]?.revision, 2);
    assert.equal(v.latestResolvableRevision[second]?.previousRecordDigest, firstDigest);
    assert.equal(v.findings.length, 0);
    // Break the first record: the chained record's chain reference stops
    // resolving and fails closed (ITG-002).
    const firstPath = approvalPath(env, first);
    const tamper = JSON.parse(readFileSync(firstPath, 'utf8')) as Record<string, unknown>;
    tamper['payload'] = { approved: true, tampered: true };
    writeFileSync(firstPath, jcsSerialize(tamper), { mode: 0o600 });
    const v2 = view(env);
    assert.equal(v2.latestResolvableRevision[second], undefined);
    assert.ok(v2.findings.some((f) => f.message === 'record chain reference does not resolve within the scanned snapshot'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: symlinks, special files, wrong mode and hard links', async () => {
  const env = makeStore();
  let socket: { close(): void } | undefined;
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    publish(env, 'pgw:r:66660000000000000000000000000006');
    // Wrong mode on the published record.
    chmodSync(approvalPath(env, 'pgw:r:11110000000000000000000000000001'), 0o644);
    // Symlink named like a record at its derived shard.
    mkdirSync(join(storePath(env), 'records', 'approval', '2222'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', '2222'), 0o700);
    symlinkSync('../../tmp/does-not-exist', join(storePath(env), 'records', 'approval', '2222', '22220000000000000000000000000002.rec'));
    // Unix-domain socket (special file) named like a record at its derived
    // shard; the server stays listening so the socket path persists.
    mkdirSync(join(storePath(env), 'records', 'approval', '3333'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', '3333'), 0o700);
    const socketRef = await makeSocket(join(storePath(env), 'records', 'approval', '3333', '33330000000000000000000000000003.rec'));
    socket = socketRef;
    // A directory named like a record at its derived shard.
    mkdirSync(join(storePath(env), 'records', 'approval', '5555', '55550000000000000000000000000005.rec'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', '5555'), 0o700);
    // Unexpected hard link: second name for the published 6666 inode at the
    // 7777 derived shard (both entries then carry nlink 2).
    mkdirSync(join(storePath(env), 'records', 'approval', '7777'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'approval', '7777'), 0o700);
    linkSync(approvalPath(env, 'pgw:r:66660000000000000000000000000006'), join(storePath(env), 'records', 'approval', '7777', '77770000000000000000000000000007.rec'));

    const scan = scanOf(env);
    assert.equal(classificationOf(scan.observations, '11110000000000000000000000000001.rec'), 'wrong-uid-or-mode');
    assert.equal(classificationOf(scan.observations, '22220000000000000000000000000002.rec'), 'wrong-type');
    assert.equal(classificationOf(scan.observations, '33330000000000000000000000000003.rec'), 'wrong-type');
    assert.equal(classificationOf(scan.observations, '55550000000000000000000000000005.rec'), 'wrong-type');
    assert.equal(classificationOf(scan.observations, '66660000000000000000000000000006.rec'), 'unexpected-hard-link');
    assert.equal(classificationOf(scan.observations, '77770000000000000000000000000007.rec'), 'unexpected-hard-link');
  } finally {
    socket?.close();
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: concurrent directory drift fails closed', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const store = revalidateStore({ trustedConfiguration: env.config, trustedInput: env.trustedInput });
    const capability = createReadCapability({ trustedInput: env.trustedInput, storeInstance: store.storeInstance! });
    let fired = false;
    const result = scanStoreSnapshot({
      capability: capability!,
      namespaceRoot: storePath(env),
      bounds: { mode: 'registry', entryLimit: 4096, byteLimit: 1024 * 1024 * 1024, failClosed: false },
      hooks: {
        afterReaddir(location) {
          if (fired || location.surface !== 'records' || location.shard === undefined) return;
          fired = true;
          const shardDir = join(storePath(env), 'records', 'approval', location.shard);
          renameSync(shardDir, `${shardDir}-drift`);
          mkdirSync(shardDir, { mode: 0o700 });
          chmodSync(shardDir, 0o700);
        },
      },
    });
    assert.equal(fired, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: no mutation during the scan and no raw path disclosure', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const before = treeSnapshot(storePath(env));
    const v = view(env);
    const after = treeSnapshot(storePath(env));
    assert.equal(after, before, 'the scan must not mutate the store');
    const serialized = JSON.stringify(v);
    assert.ok(!serialized.includes(env.dir), 'view discloses the store path');
    assert.ok(!serialized.includes('store-v1'), 'view discloses a namespace path segment');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: view is plain data with no authority production', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const v = view(env);
    const roundTripped = JSON.parse(JSON.stringify(v)) as RegistryView;
    assert.deepEqual(roundTripped, v);
    assert.equal(typeof (v as unknown as Record<string, unknown>)['verify'], 'undefined');
    assert.equal(Object.keys(v.recordsByClass).length >= 1, true);
    assert.ok(v.source.generation.startsWith('sha-256:'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: pure classifier handles wrong UID and wrong type via synthetic facts', () => {
  const base: CandidateFacts = {
    entryName: '11110000000000000000000000000001.rec',
    recordClass: 'approval-record',
    shard: '1111',
    derived: { ok: true, shard: '1111', filename: '11110000000000000000000000000001.rec' },
    fileType: 'regular',
    uidOk: true,
    modeOk: true,
    nlink: 1,
    size: 100,
    byteLimit: 1024,
    nameGrammarOk: true,
    rawParses: true,
    canonicalOk: true,
    minimumEnvelopeParses: true,
    versionStructurallyValid: true,
    versionSupported: true,
    envelopeDeferredOk: true,
    digestOk: true,
    identityComponentMatches: true,
    classLabelMatches: true,
  };
  assert.equal(classifyCandidate(base).classification, 'valid-immutable-record');
  assert.equal(classifyCandidate({ ...base, uidOk: false }).classification, 'wrong-uid-or-mode');
  assert.equal(classifyCandidate({ ...base, uidOk: false, modeOk: false }).code, 'ERR-STO-PERM-DENIED');
  assert.equal(classifyCandidate({ ...base, fileType: 'symlink' }).classification, 'wrong-type');
  assert.equal(classifyCandidate({ ...base, fileType: 'special' }).code, 'ERR-STO-FTYPE-UNSUPPORTED');
  assert.equal(classifyCandidate({ ...base, nlink: 2 }).classification, 'unexpected-hard-link');
  assert.equal(classifyCandidate({ ...base, size: 2048 }).classification, 'malformed');
  assert.equal(classifyCandidate({ ...base, size: 2048 }).code, 'ERR-STO-LIMIT-EXCEEDED');
  assert.equal(classifyCandidate({ ...base, digestOk: false }).classification, 'digest-mismatch');
  assert.equal(classifyCandidate({ ...base, versionSupported: false, versionStructurallyValid: true }).classification, 'unsupported-version');
  assert.equal(classifyCandidate({ ...base, versionStructurallyValid: false }).classification, 'malformed');
  assert.equal(classifyCandidate({ ...base, minimumEnvelopeParses: false }).classification, 'malformed');
  assert.equal(classifyCandidate({ ...base, nameGrammarOk: false }).classification, 'foreign-entry');
  assert.equal(classifyCandidate({ ...base, derived: { ok: true, shard: 'ffff', filename: '11110000000000000000000000000001.rec' } }).classification, 'wrong-derived-location');
  assert.equal(classifyCandidate({ ...base, identityComponentMatches: false }).classification, 'wrong-derived-location');
  assert.equal(classifyCandidate({ ...base, classLabelMatches: false }).classification, 'wrong-derived-location');
});

test('registry: malformed continuation is rejected fail-closed (F2)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    // Missing generation token.
    const missingGeneration = deriveRegistryView({
      trustedConfiguration: env.config,
      trustedInput: env.trustedInput,
      continuation: { recordClass: 'approval-record', shard: '1111', entry: 'x' } as unknown as ScanCursor,
    });
    assert.equal(missingGeneration.ok, false);
    assert.equal(missingGeneration.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Generation token with non-digest syntax.
    const badGeneration = deriveRegistryView({
      trustedConfiguration: env.config,
      trustedInput: env.trustedInput,
      continuation: { generation: 'not-a-digest', recordClass: 'approval-record', shard: '1111', entry: 'x' } as unknown as ScanCursor,
    });
    assert.equal(badGeneration.ok, false);
    assert.equal(badGeneration.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Missing surface-generation token (previous cursor model).
    const missingSurface = deriveRegistryView({
      trustedConfiguration: env.config,
      trustedInput: env.trustedInput,
      continuation: { generation: 'sha-256:' + 'a'.repeat(64), recordClass: 'approval-record', shard: '1111', entry: 'x' } as unknown as ScanCursor,
    });
    assert.equal(missingSurface.ok, false);
    assert.equal(missingSurface.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
    // Structurally malformed cursor.
    const badShape = deriveRegistryView({
      trustedConfiguration: env.config,
      trustedInput: env.trustedInput,
      continuation: { generation: 'sha-256:' + 'a'.repeat(64), surfaceGeneration: 'sha-256:' + 'a'.repeat(64), recordClass: 'approval-record', shard: 'zzzz', entry: 'x' },
    });
    assert.equal(badShape.ok, false);
    assert.equal(badShape.findings?.[0]?.code, 'ERR-STO-REQ-INVALID');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: unlink of audit evidence produces missing-audit findings', () => {
  const env = makeStore();
  try {
    const recordId = 'pgw:r:11110000000000000000000000000001';
    publish(env, recordId);
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
    unlinkSync(auditFiles[0]!);
    const v = view(env);
    assert.ok(v.missingAudit.some((m) => m.recordId === recordId));
    assert.ok(v.findings.some((f) => f.code === 'ERR-STO-DURABILITY'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: paging advances with identical bounds and terminates (F1)', () => {
  const env = makeStore();
  try {
    const ids = ['1111', '2222', '3333', '4444', '5555', '6666'].map((s) => `pgw:r:${s}0000000000000000000000000000`);
    for (const id of ids) publish(env, id);
    const oneShot = scanOf(env);
    assert.equal(oneShot.truncated, false);
    assert.equal(oneShot.observations.length, 12); // 6 records + 6 audit events
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 4, byteLimit: oneShot.scannedBytes + 1024 * 1024, failClosed: false };
    const pages: StoreScanResult[] = [];
    let cursor: ScanCursor | undefined;
    let guard = 0;
    for (;;) {
      guard++;
      assert.ok(guard <= 100, 'repeated same-bounds paging must terminate');
      const page = scanWithBounds(env, bounds, cursor);
      assert.equal(page.ok, true, JSON.stringify(page.findings));
      pages.push(page);
      if (!page.truncated) break;
      assert.ok(page.continuation !== undefined, 'truncated pages must return a continuation');
      assert.ok(page.continuation!.generation === page.generation, 'cursor generation must match the page generation');
      if (cursor !== undefined) {
        const next = page.continuation!;
        const advances = next.recordClass !== cursor.recordClass || next.shard !== cursor.shard || next.entry !== cursor.entry;
        assert.equal(advances, true, 'cursor must advance strictly beyond the previous cursor');
      }
      cursor = page.continuation;
    }
    assert.ok(pages.length > 1, 'entryLimit 4 on 24 entries must span multiple pages');
    const unionIds = pages.flatMap((p) => p.observations.map((o) => o.id));
    assert.equal(new Set(unionIds).size, unionIds.length, 'no duplicate observation ids across pages');
    const oneShotIds = oneShot.observations.map((o) => o.id).sort();
    assert.deepEqual([...unionIds].sort(), oneShotIds, 'paging union must equal the one-shot scan (no missing entries)');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: host directory order does not alter paging results (F1)', () => {
  const envA = makeStore();
  const envB = makeStore();
  try {
    const ids = ['1111', '2222', '3333', '4444', '5555', '6666'].map((s) => `pgw:r:${s}0000000000000000000000000000`);
    for (const id of ids) publish(envA, id);
    for (const id of [...ids].reverse()) publish(envB, id); // opposite creation order
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 4, byteLimit: 1 << 30, failClosed: false };
    // Record entries are content-derived and store-independent; audit-event
    // identities are store-instance-bound (dev/ino), so only their per-page
    // counts and positions are compared across stores.
    const recordsA: string[][] = [];
    const recordsB: string[][] = [];
    const auditsA: number[] = [];
    const auditsB: number[] = [];
    for (const [env, records, audits] of [[envA, recordsA, auditsA], [envB, recordsB, auditsB]] as const) {
      let cursor: ScanCursor | undefined;
      for (;;) {
        const page = scanWithBounds(env, bounds, cursor);
        assert.equal(page.ok, true, JSON.stringify(page.findings));
        records.push(page.observations.filter((o) => o.kind === 'record').map((o) => o.entry));
        audits.push(page.observations.filter((o) => o.kind === 'audit-event').length);
        if (!page.truncated) break;
        assert.ok(page.continuation !== undefined);
        cursor = page.continuation;
      }
    }
    assert.deepEqual(recordsA, recordsB, 'host directory order must not alter per-page record results');
    assert.deepEqual(auditsA, auditsB, 'host directory order must not alter per-page audit counts');
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});

test('registry: generation-bound cursors accept same-store same-bounds and reject mismatches (F2)', () => {
  const envA = makeStore();
  const envB = makeStore();
  try {
    publish(envA, 'pgw:r:11110000000000000000000000000001');
    publish(envA, 'pgw:r:22220000000000000000000000000002');
    publish(envB, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(envA, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    // Same store, same bounds → accepted.
    const page2 = scanWithBounds(envA, bounds, page1.continuation);
    assert.equal(page2.ok, true, JSON.stringify(page2.findings));
    // Cross-store cursor → rejected before any candidate content.
    const crossStore = scanWithBounds(envB, bounds, page1.continuation);
    assert.equal(crossStore.ok, false);
    assert.equal(crossStore.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    assert.equal(crossStore.observations.length, 0, 'rejected cursor must produce no partial observations');
    // Changed entry limit → rejected.
    const entryChanged = scanWithBounds(envA, { ...bounds, entryLimit: 3 }, page1.continuation);
    assert.equal(entryChanged.ok, false);
    assert.equal(entryChanged.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    assert.equal(entryChanged.observations.length, 0);
    // Changed byte limit → rejected.
    const byteChanged = scanWithBounds(envA, { ...bounds, byteLimit: 1 << 20 }, page1.continuation);
    assert.equal(byteChanged.ok, false);
    assert.equal(byteChanged.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    assert.equal(byteChanged.observations.length, 0);
    // Changed mode (registry cursor into recovery mode) → rejected.
    const modeChanged = scanWithBounds(envA, { mode: 'recovery', entryLimit: 2, byteLimit: 1 << 30, failClosed: true }, page1.continuation);
    assert.equal(modeChanged.ok, false);
    assert.equal(modeChanged.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    assert.equal(modeChanged.observations.length, 0);
    // Missing generation token → rejected.
    const { generation: _generation, ...withoutGeneration } = page1.continuation;
    const missingGeneration = scanWithBounds(envA, bounds, withoutGeneration as ScanCursor);
    assert.equal(missingGeneration.ok, false);
    assert.equal(missingGeneration.findings[0]?.code, 'ERR-STO-REQ-INVALID');
    // Registry and recovery generation tokens differ for identical numeric limits.
    const storeInstance = revalidatedStore(envA);
    const registryToken = computeScanGeneration({ storeInstance, mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false });
    const recoveryToken = computeScanGeneration({ storeInstance, mode: 'recovery', entryLimit: 2, byteLimit: 1 << 30, failClosed: true });
    assert.notEqual(registryToken, recoveryToken);
    assert.match(registryToken, /^sha-256:[0-9a-f]{64}$/);
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});

test('registry: parent-level anomalies under records/ are reported (F3)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001'); // approval-record
    publish(env, 'pgw:r:aaaa00000000000000000000000000aa', { issued: true }, 1, {}, 'issuance-record');
    // Remove a required class directory that existed.
    rmSync(join(storePath(env), 'records', 'issuance'), { recursive: true, force: true });
    // Unknown class directory, stray file, and symlink under records/.
    mkdirSync(join(storePath(env), 'records', 'evil'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'evil'), 0o700);
    writeFileSync(join(storePath(env), 'records', 'stray.txt'), 'x', { mode: 0o600 });
    symlinkSync('does-not-exist', join(storePath(env), 'records', 'link'));
    const scan = scanOf(env);
    assert.equal(scan.ok, true);
    // Missing-class findings: issuance (removed) plus the 14 classes that
    // never existed (approval and audit-event present) = 15.
    const missing = missingClassFindings(scan.findings);
    assert.equal(missing.length, 15);
    const missingIds = missing.map((f) => f.message.slice('required record-class directory is absent: '.length)).sort();
    assert.equal(missingIds.includes('issuance-record'), true);
    assert.equal(missingIds.includes('approval-record'), false);
    // Deterministic finding order: (code, message) sorted.
    const messages = missing.map((f) => f.message);
    assert.deepEqual(messages, [...messages].sort());
    assert.equal(scan.findings.length, 15, 'no non-missing-class findings');
    // Parent-level foreign entries are reported as foreign observations with
    // best-effort descriptor facts, never promoted to records.
    const foreign = scan.observations.filter((o) => o.kind === 'foreign-object' && o.entry !== undefined && ['evil', 'stray.txt', 'link'].includes(o.entry));
    assert.equal(foreign.length, 3);
    const byName = new Map(foreign.map((o) => [o.entry, o]));
    assert.equal(byName.get('evil')?.classification, 'foreign-entry');
    assert.equal(byName.get('evil')?.stat?.fileType, 'directory');
    assert.equal(byName.get('stray.txt')?.classification, 'foreign-entry');
    assert.equal(byName.get('stray.txt')?.stat?.fileType, 'regular');
    assert.equal(byName.get('link')?.classification, 'foreign-entry');
    assert.equal(byName.get('link')?.stat, undefined); // symlinks cannot be opened
    // Foreign observations appear before class observations in the listing
    // order (sorted names: evil, link, stray.txt).
    const foreignEntries = scan.observations.filter((o) => o.kind === 'foreign-object').map((o) => o.entry);
    assert.deepEqual(foreignEntries.slice(0, 3), ['evil', 'link', 'stray.txt']);
    // The verified record and its audit are unaffected.
    assert.ok(scan.observations.some((o) => o.kind === 'record' && o.classification === 'valid-immutable-record'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: parent-level anomalies under audit/ and missing audit-event are reported (F3)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    // Remove the expected audit class directory.
    rmSync(join(storePath(env), 'audit', 'audit-event'), { recursive: true, force: true });
    // Unknown directory and stray file under audit/.
    mkdirSync(join(storePath(env), 'audit', 'evil'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'audit', 'evil'), 0o700);
    writeFileSync(join(storePath(env), 'audit', 'stray.txt'), 'x', { mode: 0o600 });
    const scan = scanOf(env);
    assert.equal(scan.ok, true);
    const auditMissing = scan.findings.filter((f) => f.message === 'required audit class directory is absent: authoritative-audit-event');
    assert.equal(auditMissing.length, 1);
    assert.equal(auditMissing[0]?.code, 'ERR-STO-INTEGRITY');
    const foreign = scan.observations.filter((o) => o.kind === 'foreign-object');
    const auditForeign = foreign.filter((o) => ['evil', 'stray.txt'].includes(o.entry));
    assert.equal(auditForeign.length, 2);
    assert.equal(auditForeign.find((o) => o.entry === 'evil')?.stat?.fileType, 'directory');
    assert.equal(auditForeign.find((o) => o.entry === 'stray.txt')?.stat?.fileType, 'regular');
    // The record whose audit class directory is gone now has no verified
    // audit evidence: the audit association reports the missing event.
    const v = view(env);
    assert.ok(v.missingAudit.some((m) => m.recordId === 'pgw:r:11110000000000000000000000000001'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: record class directory disappearance is drift, not absence (F4)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    let fired = false;
    const result = scanWithBounds(
      env,
      { mode: 'registry', entryLimit: 4096, byteLimit: 1 << 30, failClosed: false },
      undefined,
      {
        afterReaddir(location) {
          if (fired || location.surface !== 'records' || location.recordClass === undefined || location.shard !== undefined) return;
          fired = true;
          const classDir = join(storePath(env), 'records', 'approval');
          renameSync(classDir, `${classDir}-drift`);
        },
      },
    );
    assert.equal(fired, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(result.observations.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: audit class directory disappearance is drift, not absence (F4)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    let fired = false;
    const result = scanWithBounds(
      env,
      { mode: 'registry', entryLimit: 4096, byteLimit: 1 << 30, failClosed: false },
      undefined,
      {
        afterReaddir(location) {
          if (fired || location.surface !== 'audit' || location.recordClass === undefined || location.shard !== undefined) return;
          fired = true;
          const classDir = join(storePath(env), 'audit', 'audit-event');
          renameSync(classDir, `${classDir}-drift`);
        },
      },
    );
    assert.equal(fired, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: tmp directory disappearance is drift, not absence (F4)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    let fired = false;
    const result = scanWithBounds(
      env,
      { mode: 'recovery', entryLimit: 4096, byteLimit: 1 << 30, failClosed: true },
      undefined,
      {
        afterReaddir(location) {
          if (fired || location.surface !== 'tmp') return;
          fired = true;
          const tmpDir = join(storePath(env), 'tmp');
          renameSync(tmpDir, `${tmpDir}-drift`);
        },
      },
    );
    assert.equal(fired, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('recovery: locks directory disappearance is drift, not absence (F4)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    let fired = false;
    const result = scanWithBounds(
      env,
      { mode: 'recovery', entryLimit: 4096, byteLimit: 1 << 30, failClosed: true },
      undefined,
      {
        afterReaddir(location) {
          if (fired || location.surface !== 'locks') return;
          fired = true;
          const locksDir = join(storePath(env), 'locks');
          renameSync(locksDir, `${locksDir}-drift`);
        },
      },
    );
    assert.equal(fired, true);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: first-page byte no-progress never advances past the unread record (F1-B A)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const recSize = statSync(approvalPath(env, 'pgw:r:11110000000000000000000000000001')).size;
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 4096, byteLimit: recSize - 1, failClosed: false };
    const page = scanWithBounds(env, bounds);
    assert.equal(page.ok, true);
    assert.equal(page.truncated, true, 'the insufficient byte profile must report truncation');
    assert.equal(page.continuation, undefined, 'no cursor may pass or reach the unread candidate');
    assert.equal(page.observations.length, 0, 'no observation for the unread candidate may be emitted');
    assert.equal(page.scannedBytes, 0);
    assert.ok(page.findings.some((f) => f.code === 'ERR-STO-LIMIT-EXCEEDED'));
    // Repeating the same insufficient profile must not claim progress.
    const again = scanWithBounds(env, bounds);
    assert.equal(again.truncated, true);
    assert.equal(again.continuation, undefined);
    assert.equal(again.observations.length, 0);
    // Restart WITHOUT the cursor with a larger byte profile observes X.
    const restarted = scanWithBounds(env, { mode: 'registry', entryLimit: 4096, byteLimit: 1 << 30, failClosed: false });
    assert.equal(restarted.truncated, false);
    assert.ok(restarted.observations.some((o) => o.kind === 'record' && o.classification === 'valid-immutable-record'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: resumed-page byte no-progress keeps X reachable (F1-B B/D)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    publish(env, 'pgw:r:22220000000000000000000000000002');
    // Third record is large enough that it cannot fit in any page whose
    // budget fits the first two records.
    publish(env, 'pgw:r:33330000000000000000000000000003', { approved: true, blob: 'x'.repeat(3000) });
    const r1 = statSync(approvalPath(env, 'pgw:r:11110000000000000000000000000001')).size;
    const r2 = statSync(approvalPath(env, 'pgw:r:22220000000000000000000000000002')).size;
    const r3 = statSync(approvalPath(env, 'pgw:r:33330000000000000000000000000003')).size;
    assert.ok(r3 > r1 + r2, 'fixture requires the third record to exceed the first two combined');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 4096, byteLimit: r1 + r2 + 1, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.equal(page1.observations.length, 2);
    // D: the cursor points at the final successfully processed candidate
    // before X (rec3333), never at or after X.
    assert.ok(page1.continuation !== undefined);
    assert.equal(page1.continuation!.recordClass, 'approval-record');
    assert.equal(page1.continuation!.shard, '2222');
    assert.equal(page1.continuation!.entry, '22220000000000000000000000000002.rec');
    // Resumed page: rec3333 is the first unread candidate and cannot fit.
    const resumed = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.truncated, true);
    assert.equal(resumed.continuation, undefined, 'no manufactured progress past the unread candidate');
    assert.equal(resumed.observations.length, 0);
    // The paging union never silently excludes X: it contains only the
    // processed candidates and the no-progress signal marks X as pending.
    const unionIds = [...page1.observations, ...resumed.observations].map((o) => o.entry);
    assert.equal(unionIds.includes('33330000000000000000000000000003.rec'), false);
    // X remains observable after a larger-bound restart WITHOUT the cursor.
    const restarted = scanWithBounds(env, { mode: 'registry', entryLimit: 4096, byteLimit: 1 << 30, failClosed: false });
    assert.equal(restarted.truncated, false);
    assert.ok(restarted.observations.some((o) => o.kind === 'record' && o.entry === '33330000000000000000000000000003.rec' && o.classification === 'valid-immutable-record'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: audit candidate as first unread candidate is never skipped (F1-B C)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const recSize = statSync(approvalPath(env, 'pgw:r:11110000000000000000000000000001')).size;
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
    const audSize = statSync(auditFiles[0]!).size;
    assert.ok(audSize > recSize, 'fixture requires the audit event to exceed the record size');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 4096, byteLimit: recSize, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.equal(page1.observations.length, 1); // only the record
    assert.ok(page1.continuation !== undefined);
    assert.equal(page1.continuation!.recordClass, 'approval-record');
    // Resumed page: the audit is the first unread candidate and cannot fit.
    const resumed = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.truncated, true);
    assert.equal(resumed.continuation, undefined);
    assert.equal(resumed.observations.length, 0);
    // Restart without the cursor with a larger byte profile observes the audit.
    const restarted = scanWithBounds(env, { mode: 'registry', entryLimit: 4096, byteLimit: recSize + audSize, failClosed: false });
    assert.equal(restarted.truncated, false);
    assert.ok(restarted.observations.some((o) => o.kind === 'audit-event' && o.classification === 'valid-immutable-record'));
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: foreign shard names never become cursors and paging terminates (F1-S)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    publish(env, 'pgw:r:22220000000000000000000000000002');
    // A non-hex shard-name anomaly that sorts BEFORE the valid shards.
    const foreignShard = join(storePath(env), 'records', 'approval', '0000x');
    mkdirSync(foreignShard, { recursive: true, mode: 0o700 });
    chmodSync(foreignShard, 0o700);
    const oneShot = scanOf(env);
    assert.equal(oneShot.truncated, false);
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const union: ScanObservation[] = [];
    let cursor: ScanCursor | undefined;
    let guard = 0;
    for (;;) {
      guard++;
      assert.ok(guard <= 50, 'paging must terminate');
      const page = scanWithBounds(env, bounds, cursor);
      assert.equal(page.ok, true, JSON.stringify(page.findings));
      union.push(...page.observations);
      if (!page.truncated) break;
      assert.ok(page.continuation !== undefined, 'truncated pages must return a continuation');
      // Every emitted cursor must pass the scanner's own validator.
      assert.match(page.continuation!.generation, /^sha-256:[0-9a-f]{64}$/);
      assert.match(page.continuation!.surfaceGeneration, /^sha-256:[0-9a-f]{64}$/);
      assert.match(page.continuation!.shard, /^[0-9a-f]{4}$/);
      // The cursor may never be a foreign shard position.
      assert.notEqual(page.continuation!.shard, '0000x');
      cursor = page.continuation;
    }
    // The foreign shard observation appears exactly once; the union equals
    // the one-shot scan (no duplicates, no missing valid observations).
    const foreignCount = union.filter((o) => o.entry === '0000x' && o.kind === 'foreign-object').length;
    assert.equal(foreignCount, 1, 'foreign shard anomaly must be reported exactly once');
    const unionIds = union.map((o) => o.id);
    assert.equal(new Set(unionIds).size, unionIds.length);
    const oneShotIds = oneShot.observations.map((o) => o.id).sort();
    assert.deepEqual([...unionIds].sort(), oneShotIds, 'paging union must equal the one-shot scan');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: cross-page class deletion is drift (F3-G)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    publish(env, 'pgw:r:aaaa00000000000000000000000000aa', { issued: true }, 1, {}, 'issuance-record');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    rmSync(join(storePath(env), 'records', 'issuance'), { recursive: true, force: true });
    const page2 = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(page2.ok, false);
    assert.equal(page2.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(page2.observations.length, 0, 'drift must return zero accepted partial observations');
    // A fresh scan without the cursor works on the changed store.
    const fresh = scanWithBounds(env, { mode: 'registry', entryLimit: 4096, byteLimit: 1 << 30, failClosed: false });
    assert.equal(fresh.ok, true);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: records/ parent deletion between pages is drift (F3-G)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    rmSync(join(storePath(env), 'records'), { recursive: true, force: true });
    const page2 = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(page2.ok, false);
    assert.equal(page2.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(page2.observations.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: audit/ parent deletion between pages is drift (F3-G)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    rmSync(join(storePath(env), 'audit'), { recursive: true, force: true });
    const page2 = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(page2.ok, false);
    assert.equal(page2.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(page2.observations.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: audit-event deletion between pages is drift (F3-G)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    rmSync(join(storePath(env), 'audit', 'audit-event'), { recursive: true, force: true });
    const page2 = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(page2.ok, false);
    assert.equal(page2.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(page2.observations.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: class absent on both pages is stable, class added is drift (F3-G)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    // issuance-record is absent on both pages: unchanged, not drift.
    const stable = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(stable.ok, true, JSON.stringify(stable.findings));
    // Now add the class between pages: snapshot change → drift.
    const page1b = scanWithBounds(env, bounds);
    assert.equal(page1b.truncated, true);
    assert.ok(page1b.continuation !== undefined);
    mkdirSync(join(storePath(env), 'records', 'issuance'), { recursive: true, mode: 0o700 });
    chmodSync(join(storePath(env), 'records', 'issuance'), 0o700);
    const drifted = scanWithBounds(env, bounds, page1b.continuation);
    assert.equal(drifted.ok, false);
    assert.equal(drifted.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(drifted.observations.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('registry: present class replaced by another directory identity is drift (F3-G)', () => {
  const env = makeStore();
  try {
    publish(env, 'pgw:r:11110000000000000000000000000001');
    const bounds: ScanBounds = { mode: 'registry', entryLimit: 2, byteLimit: 1 << 30, failClosed: false };
    const page1 = scanWithBounds(env, bounds);
    assert.equal(page1.truncated, true);
    assert.ok(page1.continuation !== undefined);
    const approvalDir = join(storePath(env), 'records', 'approval');
    renameSync(approvalDir, `${approvalDir}-old`);
    mkdirSync(approvalDir, { mode: 0o700 });
    chmodSync(approvalDir, 0o700);
    const page2 = scanWithBounds(env, bounds, page1.continuation);
    assert.equal(page2.ok, false);
    assert.equal(page2.findings[0]?.code, 'ERR-STO-ROOT-IDENTITY-CHANGED');
    assert.equal(page2.observations.length, 0);
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});
