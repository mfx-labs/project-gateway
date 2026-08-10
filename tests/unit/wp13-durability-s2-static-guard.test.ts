/**
 * WP-13 durability S2 — outcome-recorder authority static security guards.
 *
 * Proves the module family (src/outcome/**):
 *   - is filesystem-free (NO node:fs anywhere: the authority publishes ONLY
 *     through the WP-8 `publishRecord` path via the narrow boundary);
 *   - has no network/process/timer/crypto/environment surface;
 *   - imports the WP-8 storage surface ONLY through the exact allowed
 *     modules (store-boundary.ts = the single outcome boundary;
 *     capability.ts = the pure layout/destination derivation for the
 *     exact-record permit), and `publishRecord` itself ONLY in
 *     store-boundary.ts;
 *   - never uses the WP-12 publish path (`publishLifecycleRecord`) and
 *     carries no WP-13D/WP-15 vocabulary (no TrustedReceipt, no
 *     ExecutionRetrospectiveFacts, no privileged publication scopes);
 *   - capability/permit internals are never exported from the package
 *     barrel; the capability creator has ZERO production mint sites
 *     (S3 composition will be the sole future mint owner);
 *   - WP-12's eight-class control-plane allowlist is untouched (no
 *     `execution-outcome-record` anywhere in the WP-12 boundary);
 *   - no S3 code (lock, coordinator, replay/conflict, eligibility,
 *     composition) and no WP-15 receipt authority exist in the family.
 *
 * Future files added under src/outcome/** are automatically covered
 * (the directory is walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const OUTCOME_SRC = join(REPO, 'src', 'outcome');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const outcomeFiles = collectTsFiles(OUTCOME_SRC);
assert.ok(outcomeFiles.length >= 4, 'the outcome source tree must exist');

/** Strip comments so honest prose never trips the guards; imports and code are scanned verbatim. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

test('outcome static guard: filesystem-free; no network/process/timer/crypto/env surface', () => {
  for (const file of outcomeFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'node:fs',
      "from 'fs'",
      "require('fs')",
      'fs/promises',
      'node:crypto',
      'node:net',
      'node:http',
      'node:https',
      'node:tls',
      'node:dgram',
      'node:child_process',
      'child_process',
      'spawn(',
      'exec(',
      'fetch(',
      'WebSocket',
      'process.env',
      'Date.now(',
      'Math.random',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'process.nextTick',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('outcome static guard: WP-8 surface confined to the exact boundary module', () => {
  for (const file of outcomeFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'store-boundary.ts') {
      // The single WP-8 publication/read boundary: publishRecord + read +
      // enumerate live here and nowhere else.
      assert.ok(content.includes("from '../storage/publication/index.js'"), 'store-boundary must own publishRecord');
    } else if (base === 'capability.ts') {
      // The exact-record permit needs the pure layout derivation only.
      assert.ok(!content.includes('../storage/publication/'), `publication surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/read/'), `read surface in ${rel(file)}`);
      assert.ok(content.includes("../storage/layout/layout.js"), 'capability.ts must own the destination derivation');
    } else if (base === 'types.ts') {
      // Type-only vocabulary imports are permitted; no runtime storage surface.
      assert.ok(!content.includes('../storage/publication/'), `publication surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/read/'), `read surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/layout/'), `layout surface in ${rel(file)}`);
      assert.ok(!content.includes('../storage/format/'), `format surface in ${rel(file)}`);
    } else {
      for (const forbidden of ["'../storage/", "'../storage'", "from '../storage/", "from '../storage'"]) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    }
  }
});

test('outcome static guard: no WP-12 publish path, no WP-13D/WP-15 vocabulary, no S3 decision surface', () => {
  for (const file of outcomeFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'publishLifecycleRecord',
      'executeSlice1Command',
      'recordValidation',
      'TrustedReceipt',
      'trusted-receipt',
      'ExecutionRetrospectiveFacts',
      'ExecutionSummaryRecord',
      'completion-status',
      'downstream-automation',
      'authoritative-reporting',
      'SupersessionRecord',
      'decideActivation',
      'issueRuntimeGrant',
      'DecisionCoordinator',
      'withLock',
      'LockContentionError',
      'ValidatedResultHandoff',
      'PiExecutionObservation',
      'PiEnforcementEvidence',
      'newEvidenceId',
      'materiallyExact',
      'attemptLockKey',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

test('outcome static guard: capability/permit internals never exported from the barrel; zero production mint sites', () => {
  const barrel = codeOf(join(OUTCOME_SRC, 'index.ts'));
  for (const forbidden of [
    'createExecutionOutcomeCapability',
    'createExecutionOutcomePermit',
    'isGenuineExecutionOutcomeCapability',
    'isGenuineExecutionOutcomePermit',
    'executionOutcomePermitLive',
    'WeakSet',
    'capabilityBrand',
    'permitBrand',
  ]) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/outcome/index.ts`);
  }
  // The barrel exposes the narrow boundary factory and the closed vocabulary only.
  assert.ok(barrel.includes('createOutcomeStoreBoundary'), 'the boundary factory must be exported');
  // Production mint sites are bounded: the capability creator is referenced
  // ONLY in src/outcome/capability.ts (its definition) and the ONE
  // explicitly authorized S3 host-composition mint site
  // (src/outcome-production/compose.ts) across all of src/** — no second
  // producer, no re-export.
  const capabilityMentions: { file: string }[] = [];
  for (const file of collectTsFiles(join(REPO, 'src'))) {
    if (codeOf(file).includes('createExecutionOutcomeCapability')) capabilityMentions.push({ file: rel(file) });
  }
  assert.deepEqual(
    capabilityMentions,
    [
      { file: 'src/outcome/capability.ts' },
      { file: 'src/outcome-production/compose.ts' },
    ],
    'createExecutionOutcomeCapability must have EXACTLY ONE production mint site (the S3 host composition) outside capability.ts',
  );
  // No generic lifecycle writer is exported from the barrel.
  for (const forbidden of ['publishLifecycleRecord', 'generic', 'writeAction']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/outcome/index.ts`);
  }
});

test('outcome static guard: no raw fs writer and no capability import in the barrel', () => {
  const barrel = codeOf(join(OUTCOME_SRC, 'index.ts'));
  assert.ok(!barrel.includes("from './capability.js'"), 'the barrel must not re-export capability internals');
  assert.ok(!barrel.includes("from './store-boundary.js'") || barrel.includes('createOutcomeStoreBoundary'), 'only the boundary factory may be exported');
});

test('WP-12 isolation guard: the control-plane eight-class allowlist is unchanged', () => {
  const wp12Boundary = readFileSync(join(REPO, 'src', 'control-plane', 'store-boundary.ts'), 'utf8');
  assert.ok(!wp12Boundary.includes('execution-outcome-record'), 'WP-12 must not produce ExecutionOutcomeRecord');
  const allowlistLine = wp12Boundary.split('\n').find((l) => l.includes('CONTROL_PLANE_PUBLISH_CLASSES') && l.includes('new Set'));
  assert.ok(allowlistLine !== undefined, 'the WP-12 publish allowlist must exist');
  const classes = [...allowlistLine.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] ?? '');
  assert.equal(classes.length, 8, 'the WP-12 publish allowlist must remain exactly eight classes');
  for (const id of ['validation-record', 'approval-record', 'issuance-record', 'revocation-record', 'runtime-grant', 'activation-record', 'execution-occurrence-record', 'execution-attempt-record']) {
    assert.ok(classes.includes(id), `WP-12 allowlist must retain ${id}`);
  }
});

test('outcome static guard: no WP-13C result-publication surface inside the outcome family', () => {
  for (const file of outcomeFiles) {
    const content = codeOf(file);
    assert.ok(!content.includes("from '../publication/"), `publication import in ${rel(file)}`);
    assert.ok(!content.includes("result-publication-record"), `result-publication vocabulary in ${rel(file)}`);
  }
});
