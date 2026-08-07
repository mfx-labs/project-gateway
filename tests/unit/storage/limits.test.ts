/**
 * WP-8-B tests: the 20-limit normative profile (contract 19.1/19.2,
 * LMT-001…013).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMIT_BY_NAME,
  LIMIT_DEFINITIONS,
  applyRequestLowering,
  bindLimitProfile,
  defaultLimitProfile,
  limitBoundaryBehavior,
  validateLimitSelection,
} from '../../../src/storage/index.js';

const EXPECTED_LIMIT_NAMES = [
  'recordBytes', 'payloadBytes', 'referencesPerRecord', 'pathComponentBytes', 'pathBytes',
  'dirEntries', 'enumerationResults', 'auditEventsPerOperation', 'recordsPerTransaction', 'temporaryBytes',
  'totalScanEntries', 'totalScanBytes', 'recoveryScanEntries', 'retainedVersions', 'lockWait',
  'operationTimeout', 'concurrentReaders', 'writers', 'quarantineEntries', 'indexRebuildWork', 'indexBytes',
];

test('limits: exactly 21 normative limits with unique names', () => {
  assert.equal(LIMIT_DEFINITIONS.length, 21);
  assert.deepEqual(LIMIT_DEFINITIONS.map((l) => l.name), EXPECTED_LIMIT_NAMES);
  assert.equal(new Set(LIMIT_DEFINITIONS.map((l) => l.name)).size, 21);
  assert.equal(LIMIT_BY_NAME.size, 21);
});

test('limits: every definition is internally consistent', () => {
  for (const l of LIMIT_DEFINITIONS) {
    assert.ok(l.hardMin <= l.default, l.name);
    assert.ok(l.default <= l.hardMax, l.name);
    assert.ok(Number.isSafeInteger(l.hardMin) && Number.isSafeInteger(l.hardMax) && Number.isSafeInteger(l.default), l.name);
    assert.equal(l.requestRaiseable, false, l.name);
    if (l.name === 'writers') {
      assert.equal(l.configSelectable, false);
      assert.equal(l.requestLowerable, false);
    }
    if (!l.configSelectable) assert.equal(l.source === 'layout-constant' || l.source === 'contract-constant', true, l.name);
    assert.ok(l.result.length > 0);
  }
});

test('limits: each limit at below-min / min / default / selected / max / max+1', () => {
  for (const l of LIMIT_DEFINITIONS) {
    // below minimum
    assert.equal(validateLimitSelection(l.name, l.hardMin - 1, true).ok, false, `${l.name} below-min`);
    // minimum
    assert.equal(validateLimitSelection(l.name, l.hardMin, true).ok, l.configSelectable, `${l.name} min`);
    // default
    assert.equal(validateLimitSelection(l.name, l.default, true).ok, l.configSelectable, `${l.name} default`);
    // selected value within range
    const mid = Math.floor((l.hardMin + l.hardMax) / 2);
    assert.equal(validateLimitSelection(l.name, mid, true).ok, l.configSelectable, `${l.name} mid`);
    // maximum
    assert.equal(validateLimitSelection(l.name, l.hardMax, true).ok, l.configSelectable, `${l.name} max`);
    // maximum + 1
    assert.equal(validateLimitSelection(l.name, l.hardMax + 1, true).ok, false, `${l.name} max+1`);
  }
});

test('limits: exact-limit and limit-plus-one behavior (LMT-005)', () => {
  const profile = defaultLimitProfile();
  for (const l of LIMIT_DEFINITIONS) {
    const selected = profile[l.name] ?? l.default;
    const exact = limitBoundaryBehavior(l.name, selected, profile);
    assert.equal(exact.accepted, true, `${l.name} exact`);
    const plusOne = limitBoundaryBehavior(l.name, selected + 1, profile);
    if (l.plusOne === 'accepted-continuation') {
      assert.equal(plusOne.accepted, true, l.name);
      assert.equal(plusOne.continuation, true, l.name);
    } else {
      assert.equal(plusOne.accepted, false, l.name);
    }
  }
  assert.equal(limitBoundaryBehavior('no-such-limit', 1, profile).accepted, false);
});

test('limits: enumerationResults is the only continuation limit', () => {
  const profile = defaultLimitProfile();
  const continuation = LIMIT_DEFINITIONS.filter((l) => limitBoundaryBehavior(l.name, (profile[l.name] ?? l.default) + 1, profile).continuation);
  assert.deepEqual(continuation.map((l) => l.name), ['enumerationResults']);
});

test('limits: unknown limits and non-integers rejected (LMT-013)', () => {
  assert.equal(validateLimitSelection('not-a-limit', 1, true).ok, false);
  assert.equal(validateLimitSelection('recordBytes', 1.5, true).ok, false);
  assert.equal(validateLimitSelection('recordBytes', Number.NaN, true).ok, false);
  assert.equal(validateLimitSelection('lockWait', 50, true).ok, false); // below hard min 100
});

test('limits: configuration cannot select layout constants (LMT-013)', () => {
  assert.equal(validateLimitSelection('pathComponentBytes', 64, true).ok, false); // not config-selectable
  assert.equal(validateLimitSelection('pathComponentBytes', 64, false).ok, true); // implementation/layout selection
  assert.equal(validateLimitSelection('writers', 1, true).ok, false); // contract constant
});

test('limits: request may lower but never raise (LMT-002)', () => {
  const profile = defaultLimitProfile();
  const lower = applyRequestLowering(profile, { recordBytes: 1024, lockWait: 100 });
  assert.equal(lower.ok, true);
  if (lower.ok) {
    assert.equal(lower.profile['recordBytes'], 1024);
    assert.equal(lower.profile['lockWait'], 100);
    // other limits unchanged
    assert.equal(lower.profile['payloadBytes'], profile['payloadBytes'] ?? -1);
  }
  const raise = applyRequestLowering(profile, { recordBytes: (profile['recordBytes'] ?? 0) + 1 });
  assert.equal(raise.ok, false);
  if (!raise.ok) assert.equal(raise.reason, 'raise-rejected');
  const writers = applyRequestLowering(profile, { writers: 1 });
  assert.equal(writers.ok, false); // not request-lowerable
  const unknown = applyRequestLowering(profile, { bogus: 5 });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, 'unknown-limit');
  const fractional = applyRequestLowering(profile, { lockWait: 99.5 });
  assert.equal(fractional.ok, false);
  const belowMin = applyRequestLowering(profile, { lockWait: 1 });
  assert.equal(belowMin.ok, false);
  if (!belowMin.ok) assert.equal(belowMin.reason, 'below-hard-minimum');
});

test('limits: no implementation-selected security limit exists (LMT-012)', () => {
  const profile = defaultLimitProfile();
  // The default profile is exactly the contract table defaults.
  for (const l of LIMIT_DEFINITIONS) assert.equal(profile[l.name], l.default);
});

test('limits: profile identity binding is deterministic (LMT-011, 19.2)', () => {
  const profile = defaultLimitProfile();
  const a = bindLimitProfile(profile, '2.0', 'sha-256:' + 'a'.repeat(64), 'sha-256:' + 'b'.repeat(64));
  const b = bindLimitProfile(profile, '2.0', 'sha-256:' + 'a'.repeat(64), 'sha-256:' + 'b'.repeat(64));
  assert.deepEqual(a, b);
  assert.equal(a.configurationVersion, '2.0');
  const c = bindLimitProfile(profile, '2.1', 'sha-256:' + 'a'.repeat(64), 'sha-256:' + 'b'.repeat(64));
  assert.notEqual(c.configurationVersion, a.configurationVersion);
});
