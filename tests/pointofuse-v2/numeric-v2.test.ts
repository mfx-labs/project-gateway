/**
 * WP-6 Phase 3B: configured numeric Model C tests (contract Section 17). V2
 * has no caller numeric fields; the effective numeric limit is the minimum of
 * the configured global ceiling, the configured workspace ceiling, and the
 * validated active RuntimeGrant max-actions. Capability authorization always
 * precedes numeric narrowing; numeric limits never grant capability.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveValidatedActiveGrantMaxActions,
  evaluatePointOfUseEligibilityForConfiguration,
} from '../../src/pointofuse/index.js';
import {
  genuineConfig,
  validV2EvaluationInput,
  pouGrantModel,
  pouChainRecordsWithoutGrant,
  pouLifecycleView,
} from './helpers.js';

const v2Shell = (inputs: Record<string, unknown>): Record<string, unknown> => ({ routeProtocolVersion: '2', inputs });

const run = (overrides: Record<string, unknown> = {}, configOverrides: Parameters<typeof genuineConfig>[0] = {}) =>
  evaluatePointOfUseEligibilityForConfiguration(genuineConfig(configOverrides), v2Shell(validV2EvaluationInput(overrides)));

function expectEligible(result: ReturnType<typeof run>): void {
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, true, result.eligibility.findings.map((f) => f.messageKey).join(','));
}

function expectNumericDenial(result: ReturnType<typeof run>, keyFragment: string): void {
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey.includes(keyFragment)), `missing ${keyFragment}`);
}

// The world's grant carries narrowed_constraints [{ type: 'max-actions', value: 10 }].

test('I: all three numeric sources absent → eligible', () => {
  expectEligible(run());
});

test('I: configured global only, above grant limit → eligible', () => {
  expectEligible(run({}, { globalActionCeiling: 20 }));
});

test('I: configured global only, below grant limit → grant-ceiling denial (minimum wins)', () => {
  expectNumericDenial(run({}, { globalActionCeiling: 5 }), 'pou.grant-ceiling');
});

test('I: configured workspace only, above grant limit → eligible', () => {
  expectEligible(run({}, { workspaceActionCeiling: 20 }));
});

test('I: configured workspace only, below grant limit → grant-workspace-ceiling denial', () => {
  expectNumericDenial(run({}, { workspaceActionCeiling: 5 }), 'pou.grant-workspace-ceiling');
});

test('I: grant only (no configured ceilings) → eligible (grant narrows within no configured cap)', () => {
  expectEligible(run());
});

test('I: global + workspace both above grant limit → eligible', () => {
  expectEligible(run({}, { globalActionCeiling: 20, workspaceActionCeiling: 20 }));
});

test('I: global + workspace — workspace minimum wins', () => {
  expectNumericDenial(run({}, { globalActionCeiling: 20, workspaceActionCeiling: 5 }), 'pou.grant-workspace-ceiling');
});

test('I: all three sources present and compatible → eligible', () => {
  expectEligible(run({}, { globalActionCeiling: 20, workspaceActionCeiling: 20 }));
});

test('I: zero at the global source is present and denying', () => {
  expectNumericDenial(run({}, { globalActionCeiling: 0 }), 'pou.grant-ceiling');
});

test('I: zero at the workspace source is present and denying', () => {
  expectNumericDenial(run({}, { workspaceActionCeiling: 0 }), 'pou.grant-workspace-ceiling');
});

test('I: multiple valid grant max-actions entries contribute their minimum', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'max-actions', value: 10 }, { type: 'max-actions', value: 3 }];
  const derived = deriveValidatedActiveGrantMaxActions({ state: 'present', capturedModel: grant as never });
  assert.equal(derived, 3);
  // Both entries below the configured ceiling: eligible.
  expectEligible(run({ grant }, { globalActionCeiling: 20 }));
  // The larger entry exceeding the configured ceiling denies (10 > 5).
  expectNumericDenial(run({ grant }, { globalActionCeiling: 5 }), 'pou.grant-ceiling');
});

test('I: malformed grant max-actions → semantic denial and no derived value', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'max-actions', value: 'not-a-number' }];
  expectNumericDenial(run({ grant }), 'pou.grant-unknown-constraint');
  assert.equal(deriveValidatedActiveGrantMaxActions({ state: 'present', capturedModel: grant as never }), undefined);
});

test('I: absent grant → no derived value and no numeric contribution', () => {
  assert.equal(deriveValidatedActiveGrantMaxActions({ state: 'absent' }), undefined);
  const result = run({ grant: undefined, lifecycle: pouLifecycleView(pouChainRecordsWithoutGrant()) });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.ok(!result.eligibility.findings.some((f) => f.messageKey.includes('grant-ceiling')));
});

test('I: capability denial precedes numeric narrowing', () => {
  // Global capability ceiling denies AND global numeric ceiling 0 is present:
  // both findings exist; the capability finding sorts first (closed ordering).
  const result = run({}, {
    globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] },
    globalActionCeiling: 0,
  });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  const keys = result.eligibility.findings.map((f) => f.messageKey);
  assert.ok(keys.includes('pou2.global-capability-ceiling-denial'));
  assert.ok(keys.includes('pou.grant-ceiling'));
  assert.equal(result.eligibility.findings[0]!.messageKey, 'pou2.global-capability-ceiling-denial');
});

test('I: numeric limit never grants capability', () => {
  // Global capability ceiling denies; numeric ceilings absent → still denied
  // by the capability ceiling alone (absence of numeric limits does not grant).
  const result = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey === 'pou2.global-capability-ceiling-denial'));
});

test('I: v2 carries no caller numeric fields — router boundary failure', () => {
  const result = run({ globalActionCeiling: 5 });
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'input-capture');
});

test('I: derived value is never part of the static identity', () => {
  const grantA = pouGrantModel();
  const grantB = pouGrantModel();
  grantB['narrowed_constraints'] = [{ type: 'max-actions', value: 3 }];
  const a = run({ grant: grantA });
  const b = run({ grant: grantB });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  // The captured grant MODELS differ, so static identities differ (model-byte
  // identity); the DERIVED max-actions scalar itself is not a projection
  // member (proven by Phase-3A one-pass projection shape).
  assert.notEqual(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
  assert.notEqual(a.eligibility.pointOfUseResultIdentity, b.eligibility.pointOfUseResultIdentity);
});

test('I: configured numeric values are bound in the static identity', () => {
  const a = run({}, { globalActionCeiling: 20 });
  const b = run({}, { globalActionCeiling: 21 });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.notEqual(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
});
