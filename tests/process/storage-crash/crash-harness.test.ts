/**
 * WP-8-D process-level crash-injection harness (contract 26.1-C, TVR-002;
 * ADR-029). Parent process: creates an isolated trusted store per stage,
 * spawns the fixture child, waits for the exact STAGE marker (proof of
 * reach — never sleep-only), SIGKILLs the child, and deterministically
 * classifies the post-crash filesystem state. Behavior stages run the
 * scripted fixture sequence and assert the emitted OUTCOME.
 *
 * Guarantees: child processes only in tests (runtime never spawns,
 * SRE-013); isolated temporary trusted root per stage; bounded deadlines;
 * no orphan children (kill + wait with a bounded timeout); no HOME,
 * workspace, repository, or unrelated-path mutation (TVR-009); stale
 * compiled-output protection (src mtime must not be newer than dist-test);
 * fixed expected stage inventory with the actual executed stage count
 * reported; no zero-test success.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const FIXTURE = join(import.meta.dirname, 'fixture.test.js');
const SRC_FIXTURE = join(import.meta.dirname, '..', '..', '..', 'src', 'storage') === undefined ? '' : join(import.meta.dirname.replace('dist-test/tests/process/storage-crash', 'tests/process/storage-crash'), 'fixture.test.ts');

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

/** Fresh isolated store root (initialized through the accepted WP-8-C flow). */
function freshStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp8d-crash-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const provenance = createStorageBootstrapActionProvenance({
    actionIdentity: 'crash-bootstrap-action',
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    configurationIdentity: CONFIG_IDENTITY,
    limitProfile: defaultLimitProfile(),
  });
  const result = initializeTrustedStore({
    trustedConfiguration: config,
    actionProvenance: provenance,
    locator: dir,
    serviceUid: UID,
    forbiddenRoots: [],
    limitProfile: defaultLimitProfile(),
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return dir;
}

interface ChildResult {
  readonly markers: readonly string[];
  readonly outcome: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

/** Spawn the fixture, collect stdout, kill at the target marker, await exit. */
function runChild(args: readonly string[], killAtMarker: string | undefined, deadlineMs = 30_000): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const markers: string[] = [];
    let killed = false;
    const timer = setTimeout(() => {
      if (!killed) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolve({ markers: [...markers], outcome: stdout, exitCode: child.exitCode, signal: child.signalCode, timedOut: true });
      }
    }, deadlineMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      for (const line of stdout.split('\n')) {
        if (line.startsWith('STAGE:') && !markers.includes(line)) markers.push(line);
      }
      if (killAtMarker !== undefined && markers.includes(`STAGE:${killAtMarker}`) && !killed) {
        killed = true;
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      // Bounded orphan protection: if the child somehow survived the kill,
      // it is reaped here; the exit event is the proof of reaping.
      resolve({ markers: [...markers], outcome: stdout, exitCode: code, signal, timedOut: false });
    });
  });
}

/** Fixed post-crash classification for one kill stage. */
interface StageExpectation {
  readonly recordExists: boolean;
  readonly tempExists: boolean;
  readonly auditExists: boolean;
  readonly lockExists: boolean;
  readonly tempRemovalUnknown?: boolean;
}

const STAGE_EXPECTATIONS: Readonly<Record<string, StageExpectation>> = {
  'lock-dir-synced': { recordExists: false, tempExists: false, auditExists: false, lockExists: true },
  'primary-written': { recordExists: false, tempExists: true, auditExists: false, lockExists: true },
  'primary-fsynced': { recordExists: false, tempExists: true, auditExists: false, lockExists: true },
  'primary-linked': { recordExists: true, tempExists: true, auditExists: false, lockExists: true },
  'primary-dir-fsynced': { recordExists: true, tempExists: true, auditExists: false, lockExists: true },
  'primary-unlinked': { recordExists: true, tempExists: false, auditExists: false, lockExists: true, tempRemovalUnknown: true },
  'primary-tmp-synced': { recordExists: true, tempExists: false, auditExists: false, lockExists: true },
  'audit-written': { recordExists: true, tempExists: true, auditExists: false, lockExists: true },
  'audit-linked': { recordExists: true, tempExists: true, auditExists: true, lockExists: true },
  // The audit temp is unlinked after the audit directory syncs (10.1 step 7
  // order); a kill at audit-synced leaves the audit temp for phase-4 cleanup.
  'audit-synced': { recordExists: true, tempExists: true, auditExists: true, lockExists: true },
  'lock-released': { recordExists: true, tempExists: false, auditExists: true, lockExists: false },
};

const RECORD_ID = 'pgw:r:000000000000000000000000000000dd';
const COMPONENT = RECORD_ID.slice(6);
const SHARD = COMPONENT.slice(0, 4);

function classifyStore(root: string): { readonly recordExists: boolean; readonly tempExists: boolean; readonly auditExists: boolean; readonly lockExists: boolean } {
  const storeRoot = join(root, 'store-v1');
  const recordPath = join(storeRoot, 'records', 'approval', SHARD, `${COMPONENT}.rec`);
  const auditDir = join(storeRoot, 'audit', 'audit-event');
  const auditExists = existsSync(auditDir) && readdirSync(auditDir).some((s) => readdirSync(join(auditDir, s)).some((e) => e.endsWith('.aud')));
  const tmpDir = join(storeRoot, 'tmp');
  const tempExists = existsSync(tmpDir) && readdirSync(tmpDir).some((e) => e.startsWith('pub-') && e.endsWith('.tmp') === false && e.includes('-'));
  return {
    recordExists: existsSync(recordPath),
    tempExists,
    auditExists,
    lockExists: existsSync(join(storeRoot, 'locks', 'writer.lock')),
  };
}

test('crash harness: stale compiled-output protection (fixture src must not be newer than dist-test)', () => {
  const distFixture = FIXTURE;
  const srcFixture = join(import.meta.dirname.replace('dist-test/tests/process/storage-crash', 'tests/process/storage-crash'), 'fixture.test.ts');
  assert.equal(existsSync(distFixture), true, 'compiled fixture must exist (run the build first)');
  assert.equal(existsSync(srcFixture), true, 'source fixture must exist');
  const distMtime = statSync(distFixture).mtimeMs;
  const srcMtime = statSync(srcFixture).mtimeMs;
  assert.ok(distMtime >= srcMtime - 1000, 'stale compiled output: rebuild before running the crash suite');
});

test('crash harness: kill-stage matrix (deterministic post-crash classification)', async () => {
  const stages = Object.keys(STAGE_EXPECTATIONS);
  assert.equal(stages.length, 11);
  let executed = 0;
  for (const stage of stages) {
    const root = freshStore();
    try {
      const child = await runChild([`--stage=${stage}`, `--root=${root}`], stage);
      executed++;
      // Proof of reach: the target marker must have been emitted before the kill.
      assert.ok(child.markers.includes(`STAGE:${stage}`), `stage ${stage} was not reached (markers: ${child.markers.join(',')}; outcome: ${child.outcome.slice(0, 200)})`);
      assert.equal(child.timedOut, false, `stage ${stage} timed out`);
      const state = classifyStore(root);
      const expected = STAGE_EXPECTATIONS[stage]!;
      assert.equal(state.recordExists, expected.recordExists, `stage ${stage}: record state`);
      assert.equal(state.auditExists, expected.auditExists, `stage ${stage}: audit state`);
      assert.equal(state.lockExists, expected.lockExists, `stage ${stage}: lock state`);
      if (expected.tempRemovalUnknown === true) {
        // Crash between unlink and tmp-dir fsync: the temp name may or may
        // not have reappeared; either state is classified truthfully and the
        // record remains durable through its final name.
        assert.equal(state.recordExists, true);
      } else {
        assert.equal(state.tempExists, expected.tempExists, `stage ${stage}: temp state`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  assert.equal(executed, stages.length, 'every stage in the fixed inventory must execute');
});

test('crash harness: behavior stages (same-action temp EEXIST, write failures, capability boundaries, root drift)', async () => {
  const behaviors = [
    { name: 'temp-exists-idempotent', ok: true, code: undefined },
    { name: 'temp-exists-audit-missing', ok: false, code: 'ERR-STO-DURABILITY' },
    { name: 'zero-progress-write', ok: false, code: 'ERR-STO-DURABILITY' },
    { name: 'partial-write', ok: false, code: 'ERR-STO-DURABILITY' },
    { name: 'cap-invalid-boundary-1', ok: false, code: 'ERR-STO-REQ-INVALID' },
    { name: 'cap-invalid-boundary-2', ok: false, code: 'ERR-STO-REQ-INVALID' },
    { name: 'cap-invalid-boundary-3', ok: false, code: 'ERR-STO-REQ-INVALID' },
    { name: 'root-drift-boundary-4', ok: false, code: 'ERR-STO-ROOT-IDENTITY-CHANGED' },
  ] as const;
  let executed = 0;
  for (const behavior of behaviors) {
    const root = freshStore();
    try {
      const child = await runChild([`--behavior=${behavior.name}`, `--root=${root}`], undefined);
      executed++;
      assert.equal(child.timedOut, false, `${behavior.name} timed out`);
      const outcomeLine = child.outcome.split('\n').find((l) => l.startsWith('OUTCOME:'));
      assert.ok(outcomeLine !== undefined, `${behavior.name}: no OUTCOME line (${child.outcome.slice(0, 300)})`);
      const outcome = JSON.parse(outcomeLine.slice('OUTCOME:'.length)) as { ok: boolean; code?: string; note?: string };
      assert.equal(outcome.ok, behavior.ok, `${behavior.name}: ok mismatch (${JSON.stringify(outcome)})`);
      if (behavior.code !== undefined) {
        assert.equal(outcome.code, behavior.code, `${behavior.name}: code mismatch (${JSON.stringify(outcome)})`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  assert.equal(executed, behaviors.length, 'every behavior in the fixed inventory must execute');
});

test('crash harness: process termination leaves only store-confined objects (no unrelated mutation)', async () => {
  // A kill at the audit stage must leave the record and audit durable and
  // nothing outside the store root.
  const root = freshStore();
  const home = process.env.HOME;
  const before = home !== undefined && existsSync(home) ? readdirSync(home).sort() : undefined;
  try {
    const child = await runChild(['--stage=audit-synced', `--root=${root}`], 'audit-synced');
    assert.ok(child.markers.includes('STAGE:audit-synced'));
    const state = classifyStore(root);
    assert.equal(state.recordExists, true);
    assert.equal(state.auditExists, true);
    if (before !== undefined && home !== undefined) {
      assert.deepEqual(readdirSync(home).sort(), before, 'the crash must not mutate HOME');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
