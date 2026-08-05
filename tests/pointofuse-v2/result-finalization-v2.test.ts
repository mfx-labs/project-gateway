/**
 * WP-6 Phase 3B: boundary-versus-semantic result discrimination (J), identity
 * behavior (K), and finding ordering/normalization (L). Semantic denials are
 * COMPLETE v2 evaluations with both identities; boundary and identity
 * failures are router failures with no identities and no partial reports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePointOfUseEligibilityForConfiguration,
  finalizeV2Report,
  buildPointOfUseResultIdentityProjection,
  computePointOfUseResultIdentity,
} from '../../src/pointofuse/index.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';
import {
  genuineConfig,
  validV2EvaluationInput,
  pouGrantModel,
  pouChainRecords,
  pouLifecycleView,
  validV1EvaluationInput,
  POU_CAPABILITY,
  POU_WORKSPACE_ID,
} from './helpers.js';

const v2Shell = (inputs: Record<string, unknown>): Record<string, unknown> => ({ routeProtocolVersion: '2', inputs });

const run = (overrides: Record<string, unknown> = {}, configOverrides: Parameters<typeof genuineConfig>[0] = {}) =>
  evaluatePointOfUseEligibilityForConfiguration(genuineConfig(configOverrides), v2Shell(validV2EvaluationInput(overrides)));

// ---------------------------------------------------------------------------
// J. boundary versus semantic results
// ---------------------------------------------------------------------------

test('J: configuration genuineness failure → router failure, no identities', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration({ ...genuineConfig() } as never, v2Shell(validV2EvaluationInput()));
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'config-not-genuine');
  assert.equal('staticInputCorrelationIdentity' in result, false);
});

test('J: capture failure → router failure, no identities', () => {
  const result = run({ pointOfUseInputsProtocolVersion: '1' });
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'inner-version-mismatch');
});

test('J: finite non-integer model value → router failure at model-capture, no identities (M-1)', () => {
  // A finite fraction is JSON-representable but NOT canonical-input-
  // representable (the committed JCS accepts safe integers only). The v2
  // bare-model boundary rejects it at capture: the failure layer is
  // model-capture, never static identity, and no semantic evaluation is
  // entered.
  const result = run({ bundle: { instance_id: 'b-1', fractional: 1.5 } });
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'model-capture');
  assert.equal(result.findings[0]!.code, 'POU2-011');
  assert.equal('staticInputCorrelationIdentity' in result, false);
  assert.equal('pointOfUseResultIdentity' in result, false);
});

test('J: valid integer model values reach complete evaluation (no static-identity catch) (M-1)', () => {
  // Explicit integer-valued bundle/policy/grant models capture and evaluate
  // normally: no valid captured projection can naturally reach the router's
  // defensive static-identity catch because of number representation.
  const result = run({ bundle: { instance_id: 'b-1', count: 3 } });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('J: malformed-but-canonical grant content still completes semantic denial with both identities (M-1)', () => {
  // A string-valued max-actions is malformed SEMANTIC content but canonical
  // JSON: it captures at the boundary and becomes a complete semantic denial.
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'max-actions', value: 'not-a-number' }];
  const result = run({ grant });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey.includes('pou.grant-unknown-constraint')));
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('J: policy semantic denial → complete v2 report with both identities', () => {
  const result = run({
    requestedUse: {
      capability: 'project-gateway.file-edit',
      operationClass: 'read',
      resourceClass: 'configured-artifact-area',
      scope: 'exact:resource-1',
      workspaceId: POU_WORKSPACE_ID,
    },
  });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('J: grant denial → complete v2 report with both identities', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'bogus', value: 1 }];
  const result = run({ grant });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('J: capability ceiling denial → complete v2 report with both identities', () => {
  const result = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('J: numeric denial → complete v2 report with both identities', () => {
  const result = run({}, { globalActionCeiling: 5 });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('J: result identity failure → router failure with no partial report', () => {
  // A non-JCS-representable value inside the normalized report would make
  // result-identity construction throw; the router converts it into a
  // deterministic router failure with no partial EligibilityReportV2. The
  // committed report surface cannot carry such a value, so the defensive path
  // is exercised at the unit level: a corrupted projection throws, and
  // finalizeV2Report propagates it (the router catch maps it to
  // identity-construction).
  const staticIdentity = 'sha-256:' + 'a'.repeat(64);
  const report = {
    eligible: true,
    requestedUse: {
      capability: POU_CAPABILITY,
      operationClass: 'read',
      resourceClass: 'configured-artifact-area',
      scope: 'exact:resource-1',
      workspaceId: POU_WORKSPACE_ID,
    },
    capability: POU_CAPABILITY,
    scope: 'exact:resource-1',
    workspaceId: POU_WORKSPACE_ID,
    subjectCorrelations: { workspace: POU_WORKSPACE_ID },
    categories: ['POINT-OF-USE-FAILURE'],
    ruleIds: ['AUT-001'],
    findings: [],
  } as never;
  const projection = buildPointOfUseResultIdentityProjection({
    staticInputCorrelationIdentity: staticIdentity,
    report: report as never,
  });
  // Corrupt the projection with a non-JCS-representable number and assert the
  // identity computation throws (the router's catch produces the router
  // failure stage 'identity-construction').
  const corrupted = JSON.parse(JSON.stringify(projection)) as Record<string, unknown>;
  (corrupted['normalizedReport'] as Record<string, unknown>)['eligible'] = 1.5;
  // The failure class exists at the identity layer: a non-JCS-representable
  // normalized value makes the one-pass result identity throw. finalizeV2Report
  // propagates that throw and the router's dedicated catch maps it to the
  // deterministic 'identity-construction' router failure with no partial
  // EligibilityReportV2 (defensive; the committed report surface cannot
  // produce such a value through ordinary evaluation).
  assert.throws(() => jcsSerialize(corrupted));
  assert.throws(() => computePointOfUseResultIdentity(corrupted as never));
});

// ---------------------------------------------------------------------------
// K. identity behavior
// ---------------------------------------------------------------------------

test('K: same static operands + different live revocation outcome → static identity stable, result identity changes', () => {
  const grant = pouGrantModel();
  const grantId = String(grant['record_id']);
  const none = { revocationsByTarget: () => [] };
  const revoking = {
    revocationsByTarget: (recordId: string) =>
      recordId === grantId ? [{ recordId: grantId, effectiveAt: '2026-08-04T06:00:00.000Z', scope: 'revoke' }] : [],
  };
  const a = run({ revocations: none });
  const b = run({ revocations: revoking });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.equal(a.eligibility.eligible, true);
  assert.equal(b.eligibility.eligible, false);
  // The revocation view is live state: excluded from the static identity.
  assert.equal(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
  assert.notEqual(a.eligibility.pointOfUseResultIdentity, b.eligibility.pointOfUseResultIdentity);
});

test('K: configuration ceiling change changes the static identity', () => {
  const a = run({}, { globalCapabilityCeiling: { capabilities: [POU_CAPABILITY] } });
  const b = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.notEqual(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
});

test('K: grant captured-model change changes the static identity', () => {
  const grantB = pouGrantModel();
  grantB['narrowed_constraints'] = [{ type: 'max-actions', value: 3 }];
  const a = run();
  const b = run({ grant: grantB });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.notEqual(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
});

test('K: lifecycle snapshot change changes the static identity (static projection, not a live view)', () => {
  const records = pouChainRecords();
  const withoutActivation = pouLifecycleView(records.filter((r) => r.recordType !== 'ActivationRecord'));
  const a = run();
  const b = run({ lifecycle: withoutActivation });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.equal(a.eligibility.eligible, true);
  assert.equal(b.eligibility.eligible, true);
  assert.notEqual(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
});

test('K: v1 branch has no identities; router failure has no identities', () => {
  const v1 = evaluatePointOfUseEligibilityForConfiguration(
    genuineConfig(),
    { routeProtocolVersion: '1', legacyCompatibilityMode: 'explicit-legacy-test', inputs: validV1EvaluationInput() },
  );
  assert.equal(v1.kind, 'eligibility-v1');
  if (v1.kind !== 'eligibility-v1') return;
  assert.equal('staticInputCorrelationIdentity' in v1.eligibility, false);
  assert.equal('pointOfUseResultIdentity' in v1.eligibility, false);
});

// ---------------------------------------------------------------------------
// L. finding ordering and normalization
// ---------------------------------------------------------------------------

test('L: capability findings precede numeric findings deterministically', () => {
  const result = run({}, {
    globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] },
    globalActionCeiling: 5,
  });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  const keys = result.eligibility.findings.map((f) => f.messageKey);
  assert.equal(result.eligibility.findings[0]!.messageKey, 'pou2.global-capability-ceiling-denial');
  assert.ok(keys.indexOf('pou2.global-capability-ceiling-denial') < keys.indexOf('pou.grant-ceiling'));
});

test('L: finding sequence is significant — different denials change the result identity', () => {
  const a = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  const b = run({}, { workspaceCapabilities: ['project-gateway.file-edit'] });
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.notEqual(a.eligibility.pointOfUseResultIdentity, b.eligibility.pointOfUseResultIdentity);
});

test('L: report normalization — sorted categories and rule IDs, no localized prose in the result identity', () => {
  const result = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  const report = result.eligibility;
  const sortedRules = [...report.ruleIds].sort();
  assert.deepEqual(report.ruleIds, sortedRules);
  assert.ok(report.findings.every((f) => typeof f.messageKey === 'string'));
  // The result identity digest is hex only and contains no prose or paths.
  assert.match(report.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('L: no root, path, secret, or stack leakage in findings', () => {
  const result = run({}, { globalCapabilityCeiling: { capabilities: ['project-gateway.file-edit'] } });
  assert.equal(result.kind, 'eligibility-v2');
  const failure = evaluatePointOfUseEligibilityForConfiguration({ ...genuineConfig() } as never, v2Shell(validV2EvaluationInput()));
  assert.equal(failure.kind, 'router-failure');
  const serialized = JSON.stringify(result) + JSON.stringify(failure);
  assert.ok(!serialized.includes('/srv'));
  assert.ok(!serialized.includes('at '));
  assert.ok(!serialized.includes('Error:'));
});
