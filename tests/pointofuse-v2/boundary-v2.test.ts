/**
 * WP-6 Phase 3B: package and scope boundary tests (M). The package root is
 * unchanged; the authoritative router and all Phase-3B names are internal
 * only; no filesystem/network/process/clock/randomness usage exists in the new
 * modules; no conformance, package, or script changes exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as packageRoot from '../../src/index.js';

const POINT_OF_USE_DIR = fileURLToPath(new URL('../../../src/pointofuse/', import.meta.url));

const PHASE_3B_NAMES = [
  // routing.ts
  'evaluatePointOfUseEligibilityForConfiguration',
  'requiresV2',
  // evaluate-v2.ts
  'evaluateV2Semantics',
  'evaluateDetachedV1',
  'finalizeV2Report',
  'bridgeV1Input',
  'bridgeV2Input',
  'deriveValidatedActiveGrantMaxActions',
  'capabilityDenialFindings',
  'grantGateFindings',
  // findings-v2.ts Phase-3B factories (POU2-015 … POU2-022 family)
  'findingConfigNotGenuine',
  'findingConfigVersion',
  'findingWorkspaceUnknown',
  'findingLegacyNotPermitted',
  'findingEvaluationException',
  'semanticGlobalCapabilityCeilingDenial',
  'semanticWorkspaceCapabilityCeilingDenial',
  'semanticGrantRecordTypeDenial',
];

const PHASE_3B_FILES = ['routing.ts', 'evaluate-v2.ts'];

test('M: package root exposes no Phase-3B surface (complete 18-name inventory, m-2)', () => {
  for (const name of PHASE_3B_NAMES) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('M: src/index.ts contains no Phase-3B name at the source level (m-2)', () => {
  const root = readFileSync(fileURLToPath(new URL('../../../src/index.ts', import.meta.url)), 'utf8');
  for (const name of PHASE_3B_NAMES) {
    assert.ok(!root.includes(name), `src/index.ts must not reference ${name}`);
  }
});

test('M: package exports map unchanged — no deep-import subpath (m-2)', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'));
  // The committed export surface is exactly four subpaths: `.` (root), the
  // WP-9 `./mcp` inspection subpath, `./pi-adapter`, and the WP-14C
  // `./loading` subpath.
  assert.deepEqual(Object.keys(pkg['exports']).sort(), ['.', './loading', './mcp', './pi-adapter']);
  for (const subpath of Object.keys(pkg['exports'])) {
    assert.ok(!subpath.includes('*'), `no wildcard subpath allowed: ${subpath}`);
    assert.ok(!subpath.startsWith('./src'), `no deep-import subpath allowed: ${subpath}`);
    assert.ok(!subpath.includes('pointofuse'), `no pointofuse subpath allowed: ${subpath}`);
    assert.ok(!subpath.includes('api/'), `no api subpath allowed: ${subpath}`);
  }
});

test('M: package root still exposes the direct v1 entry and no Phase-3A names', () => {
  assert.equal(typeof packageRoot.evaluatePointOfUseEligibility, 'function');
  for (const name of ['PointOfUseInputsV2DataAndViews', 'EligibilityReportV2', 'PointOfUseStaticInputProjection', 'captureRouterRequest', 'captureV2Input']) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('M: internal router reachable only through the internal point-of-use barrel', async () => {
  const barrel = await import('../../src/pointofuse/index.js') as typeof import('../../src/pointofuse/index.js');
  assert.equal(typeof barrel.evaluatePointOfUseEligibilityForConfiguration, 'function');
  assert.equal(typeof barrel.requiresV2, 'function');
  assert.equal(typeof barrel.evaluateV2Semantics, 'function');
});

test('M: no filesystem/network/process/clock/randomness usage in Phase-3B modules', () => {
  const forbidden = ['node:fs', 'node:net', 'node:http', 'node:https', 'node:child_process', 'process.env', 'process.cwd', 'Date.now', 'Math.random', 'fetch('];
  for (const file of PHASE_3B_FILES) {
    const src = readFileSync(join(POINT_OF_USE_DIR, file), 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${file}`);
    }
  }
});

test('M: node:crypto is not introduced in Phase-3B modules', () => {
  for (const file of PHASE_3B_FILES) {
    const src = readFileSync(join(POINT_OF_USE_DIR, file), 'utf8');
    assert.ok(!src.includes('node:crypto'), `node:crypto forbidden in ${file}`);
  }
});

test('M: no generic write/mutation tokens in Phase-3B modules', () => {
  const forbidden = ['writeFile', 'mkdir', 'rename(', 'unlink', 'appendFile', 'createWriteStream', 'rmSync', 'copyFile', 'execSync', 'spawnSync'];
  for (const file of PHASE_3B_FILES) {
    const src = readFileSync(join(POINT_OF_USE_DIR, file), 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${file}`);
    }
  }
});

test('M: router failure findings are static, root-safe, path-safe, and secret-free', async () => {
  const {
    findingConfigNotGenuine, findingLegacyNotPermitted, findingWorkspaceUnknown, findingEvaluationException, findingConfigVersion,
  } = await import('../../src/pointofuse/index.js');
  for (const finding of [findingConfigNotGenuine(), findingLegacyNotPermitted(), findingWorkspaceUnknown(), findingEvaluationException(), findingConfigVersion()]) {
    assert.equal(Object.isFrozen(finding), true);
    assert.ok(!finding.message.includes('/'), finding.code);
    assert.ok(!finding.message.includes('Error'), finding.code);
  }
});
