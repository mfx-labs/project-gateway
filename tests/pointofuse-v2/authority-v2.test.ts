/**
 * WP-6 Phase 3B: capability ceilings (G) and RuntimeGrant deny-only
 * constraints (H). No operand expands another; the grant is a mandatory gate
 * and deny-only constraint source, never a capability set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePointOfUseEligibilityForConfiguration } from '../../src/pointofuse/index.js';
import {
  genuineConfig,
  validV2EvaluationInput,
  pouGrantModel,
  POU_CAPABILITY,
  POU_WORKSPACE_ID,
} from './helpers.js';

const v2Shell = (inputs: Record<string, unknown>): Record<string, unknown> => ({ routeProtocolVersion: '2', inputs });

const run = (overrides: Record<string, unknown> = {}, configOverrides: Parameters<typeof genuineConfig>[0] = {}) =>
  evaluatePointOfUseEligibilityForConfiguration(genuineConfig(configOverrides), v2Shell(validV2EvaluationInput(overrides)));

function expectEligible(result: ReturnType<typeof run>): void {
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, true, result.eligibility.findings.map((f) => f.messageKey).join(','));
}

function expectDeniedWith(result: ReturnType<typeof run>, keyFragment: string): void {
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey.includes(keyFragment)), `missing ${keyFragment}: ${result.eligibility.findings.map((f) => f.messageKey).join(',')}`);
}

// ---------------------------------------------------------------------------
// G. capability ceilings
// ---------------------------------------------------------------------------

test('G: both ceilings absent → eligible', () => {
  expectEligible(run());
});

test('G: global permits → eligible', () => {
  expectEligible(run({}, { globalCapabilityCeiling: { capabilities: [POU_CAPABILITY] } }));
});

test('G: global denies → denied with global ceiling finding', () => {
  const result = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  expectDeniedWith(result, 'pou2.global-capability-ceiling-denial');
});

test('G: workspace permits → eligible', () => {
  expectEligible(run({}, { workspaceCapabilities: [POU_CAPABILITY] }));
});

test('G: workspace denies → denied with workspace ceiling finding', () => {
  const result = run({}, { workspaceCapabilities: ['project-gateway.file-edit'] });
  expectDeniedWith(result, 'pou2.workspace-capability-ceiling-denial');
});

test('G: global present empty (deny all) → denied', () => {
  const result = run({}, { globalCapabilityCeiling: { capabilities: [] } });
  expectDeniedWith(result, 'pou2.global-capability-ceiling-denial');
});

test('G: global present with absent capabilities (deny all per Phase-1 semantics) → denied', () => {
  const result = run({}, { globalCapabilityCeiling: {} });
  expectDeniedWith(result, 'pou2.global-capability-ceiling-denial');
});

test('G: workspace present empty (deny all) → denied', () => {
  const result = run({}, { workspaceCapabilities: [] });
  expectDeniedWith(result, 'pou2.workspace-capability-ceiling-denial');
});

test('G: global permits but workspace denies → denied with workspace finding', () => {
  const result = run({}, {
    globalCapabilityCeiling: { capabilities: [POU_CAPABILITY] },
    workspaceCapabilities: ['project-gateway.file-edit'],
  });
  expectDeniedWith(result, 'pou2.workspace-capability-ceiling-denial');
  if (result.kind !== 'eligibility-v2') return;
  assert.ok(!result.eligibility.findings.some((f) => f.messageKey.includes('global-capability')));
});

test('G: policy denies despite configuration permit', () => {
  // Configuration ceilings permit file-edit, but the approved policy allows
  // only workspace-read: the base evaluator denies (unknown-denied) and the
  // configuration ceiling contributes no denial (no operand expands another).
  const result = run(
    {
      requestedUse: {
        capability: 'project-gateway.file-edit',
        operationClass: 'read',
        resourceClass: 'configured-artifact-area',
        scope: 'exact:resource-1',
        workspaceId: POU_WORKSPACE_ID,
      },
    },
    { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } },
  );
  expectDeniedWith(result, 'pou.unknown-denied');
  if (result.kind !== 'eligibility-v2') return;
  assert.ok(!result.eligibility.findings.some((f) => f.messageKey.includes('capability-ceiling-denial')));
});

test('G: consumer denies despite configuration and policy permit', () => {
  const result = run({
    consumerSupport: {
      consumerId: 'test-consumer',
      supportedProtocolFeatures: ['project-gateway.conformance-fixture'],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: ['project-gateway.conformance-tag'],
    },
  });
  expectDeniedWith(result, 'pou.capability-unsupported');
});

test('G: grant gate denies despite capability-set permit', () => {
  const result = run({ grant: undefined, lifecycle: { records: [] } });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey.includes('pou.missing-')), 'missing lifecycle findings');
});

test('G: no operand expands another — absent configuration ceiling does not grant', () => {
  // Policy denies an unsupported capability; the absent configuration ceiling
  // contributes nothing (absence is not an empty set and never grants).
  const result = run({
    requestedUse: {
      capability: 'project-gateway.file-edit',
      operationClass: 'read',
      resourceClass: 'configured-artifact-area',
      scope: 'exact:resource-1',
      workspaceId: POU_WORKSPACE_ID,
    },
  });
  expectDeniedWith(result, 'pou.unknown-denied');
});

// ---------------------------------------------------------------------------
// H. RuntimeGrant deny-only constraints
// ---------------------------------------------------------------------------

test('H: read-only constraint — committed fail-closed semantics for a passing read', () => {
  // The committed evaluator's read-only branch denies non-read operations and
  // treats a PASSING read-only constraint as unsupported constraint semantics
  // (fail closed, pou.grant-unknown-constraint). This committed behavior is
  // preserved; the v2 path does not alter it.
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'read-only', value: true }];
  expectDeniedWith(run({ grant }), 'pou.grant-unknown-constraint');
});

test('H: operation-class narrowing denies read when read is excluded', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'operation-class', value: 'write' }];
  expectDeniedWith(run({ grant }), 'pou.grant-operation-narrowing');
});

test('H: resource-class narrowing denies', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'resource-class', value: 'other-area' }];
  expectDeniedWith(run({ grant }), 'pou.grant-resource-narrowing');
});

test('H: scope narrowing denies', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'scope', value: 'exact:other' }];
  expectDeniedWith(run({ grant }), 'pou.grant-scope-narrowing');
});

test('H: require-exact-resource — committed fail-closed semantics for a passing exact scope', () => {
  // Same committed fail-closed behavior as read-only: the violation-only
  // branch falls through to unknown-constraint for a passing constraint.
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'require-exact-resource', value: true }];
  expectDeniedWith(run({ grant }), 'pou.grant-unknown-constraint');
});

test('H: unknown constraint denies', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'mystery', value: 1 }];
  expectDeniedWith(run({ grant }), 'pou.grant-unknown-constraint');
});

test('H: multiple passing constraints still eligible (constraints only narrow)', () => {
  // scope/operation-class/resource-class/max-actions are the committed
  // vocabulary branches that pass cleanly when their values match the request.
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [
    { type: 'scope', value: 'exact:resource-1' },
    { type: 'operation-class', value: 'read' },
    { type: 'resource-class', value: 'configured-artifact-area' },
    { type: 'max-actions', value: 10 },
  ];
  expectEligible(run({ grant }));
});

test('H: reordered constraint array — model-byte static identity semantics', () => {
  const grantA = pouGrantModel();
  grantA['narrowed_constraints'] = [{ type: 'scope', value: 'exact:resource-1' }, { type: 'max-actions', value: 10 }];
  const grantB = pouGrantModel();
  grantB['narrowed_constraints'] = [{ type: 'max-actions', value: 10 }, { type: 'scope', value: 'exact:resource-1' }];
  const a = run({ grant: grantA });
  const b = run({ grant: grantB });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.equal(a.eligibility.eligible, true);
  assert.equal(b.eligibility.eligible, true);
  // Static identity is model-byte identity: reordered constraint arrays are
  // different captured models and therefore different static identities
  // (documented Phase-3A array-order semantics).
  assert.notEqual(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
});

test('H: constraints can only narrow — a passing grant never grants a denied capability', () => {
  // Consumer denies the capability; the grant is valid but cannot expand.
  const result = run({
    consumerSupport: {
      consumerId: 'test-consumer',
      supportedProtocolFeatures: ['project-gateway.conformance-fixture'],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: ['project-gateway.conformance-tag'],
    },
  });
  expectDeniedWith(result, 'pou.capability-unsupported');
});
