/**
 * WP-6 Phase 3A: package and scope boundary tests. The package root must
 * remain byte-identical with no Phase-3 exports; the new modules must perform
 * no filesystem, network, process, clock, or randomness I/O (deterministic
 * node:crypto hashing is permitted only in the identity module); no schema,
 * conformance, generated-corpus, package, adapter, or trusted-module changes
 * exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as packageRoot from '../../src/index.js';
import {
  captureV2Input,
  findingInnerVersionMismatch,
  findingInnerVersionMissing,
  findingLegacyDeclaration,
  findingLifecycleSnapshot,
  findingModelCapture,
  findingNestedInputCapture,
  findingOperandBrand,
  findingResultIdentity,
  findingRouteTag,
  findingShellStructural,
  findingStaticIdentity,
  findingStaticProjection,
  findingViewAdaptation,
  findingWorkspaceCapture,
  sortPou2Findings,
} from '../../src/pointofuse/index.js';
import { validV2Input } from './helpers.js';

const POINT_OF_USE_DIR = fileURLToPath(new URL('../../../src/pointofuse/', import.meta.url));

const PHASE_3A_FILES = [
  'router-types.ts',
  'router-capture.ts',
  'input-capture.ts',
  'view-capture.ts',
  'lifecycle-snapshot.ts',
  'model-capture.ts',
  'identity-v2.ts',
  'findings-v2.ts',
  'index.ts',
];

const PHASE_3_ROOT_NAMES = [
  'evaluatePointOfUseEligibilityForConfiguration',
  'PointOfUseInputsV2DataAndViews',
  'EligibilityReportV2',
  'VersionedPointOfUseRouterRequest',
  'PointOfUseRoutingResult',
  'RouterFailureStage',
  'PointOfUseStaticInputProjection',
  'POU2Finding',
  'captureRouterRequest',
  'captureV2Input',
  'captureV1Input',
  'buildStaticInputProjection',
  'computeStaticInputCorrelationIdentity',
  'computePointOfUseResultIdentity',
];

test('I: package root exposes no Phase-3 surface', () => {
  for (const name of PHASE_3_ROOT_NAMES) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('I: package root still exposes the direct v1 entry', () => {
  assert.equal(typeof packageRoot.evaluatePointOfUseEligibility, 'function');
});

test('I: no filesystem/network/process/clock/randomness usage in new Phase-3A modules', () => {
  const forbidden = ['node:fs', 'node:net', 'node:http', 'node:https', 'node:child_process', 'process.env', 'process.cwd', 'Date.now', 'Math.random', 'fetch('];
  for (const file of PHASE_3A_FILES) {
    const src = readFileSync(join(POINT_OF_USE_DIR, file), 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${file}`);
    }
  }
});

test('I: node:crypto used only in identity-v2 (deterministic hashing)', () => {
  for (const file of PHASE_3A_FILES.filter((f) => f !== 'identity-v2.ts')) {
    const src = readFileSync(join(POINT_OF_USE_DIR, file), 'utf8');
    assert.ok(!src.includes('node:crypto'), `node:crypto forbidden in ${file}`);
  }
  const identity = readFileSync(join(POINT_OF_USE_DIR, 'identity-v2.ts'), 'utf8');
  assert.ok(identity.includes('node:crypto'));
});

test('I: no generic write/mutation tokens in new modules', () => {
  const forbidden = ['writeFile', 'mkdir', 'rename(', 'unlink', 'appendFile', 'createWriteStream', 'rmSync', 'copyFile', 'execSync', 'spawnSync'];
  for (const file of PHASE_3A_FILES) {
    const src = readFileSync(join(POINT_OF_USE_DIR, file), 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${file}`);
    }
  }
});

test('I: findings are static, root-safe, path-safe, and secret-free', () => {
  const findings = [
    findingShellStructural(), findingRouteTag(), findingLegacyDeclaration(), findingNestedInputCapture(),
    findingInnerVersionMissing(), findingInnerVersionMismatch(), findingWorkspaceCapture(), findingViewAdaptation(),
    findingLifecycleSnapshot(), findingOperandBrand(), findingModelCapture(), findingStaticProjection(),
    findingStaticIdentity(), findingResultIdentity(),
  ];
  for (const f of findings) {
    assert.equal(Object.isFrozen(f), true);
    assert.match(f.code, /^POU2-\d{3}$/);
    assert.ok(!f.message.includes('srv'), f.code);
    assert.ok(!f.message.includes('/'), `finding ${f.code} must not contain path text`);
  }
  const sorted = sortPou2Findings([...findings].reverse());
  assert.deepEqual(sorted.map((f) => f.code), findings.map((f) => f.code));
});

test('I: v2 input shape forbids caller correlation and trust-bearing fields', () => {
  for (const forbidden of [
    'staticInputCorrelationIdentity',
    'pointOfUseResultIdentity',
    'configurationIdentity',
  ]) {
    const r = captureV2Input(validV2Input({ [forbidden]: 'sha-256:' + '0'.repeat(64) }));
    assert.equal(r.ok, false, forbidden);
  }
});
