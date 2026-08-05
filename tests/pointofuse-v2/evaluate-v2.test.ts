/**
 * WP-6 Phase 3B: v2 successful evaluation (E) and the mandatory RuntimeGrant
 * gate (F). Every grant denial is a COMPLETE v2 evaluation with both
 * identities; grant absence/invalidity contributes no authority and no numeric
 * limit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePointOfUseEligibilityForConfiguration } from '../../src/pointofuse/index.js';
import {
  genuineConfig,
  validV2EvaluationInput,
  pouGrantModel,
  pouPolicyModel,
  pouBundleModel,
  pouChainRecords,
  pouLifecycleView,
  pouChainRecordsWithoutGrant,
  POU_WORKSPACE_ID,
  POU_CURRENT_TIME,
  POU_CAPABILITY,
} from './helpers.js';

const v2Shell = (inputs: Record<string, unknown>): Record<string, unknown> => ({ routeProtocolVersion: '2', inputs });

const run = (overrides: Record<string, unknown> = {}, configOverrides: Parameters<typeof genuineConfig>[0] = {}) =>
  evaluatePointOfUseEligibilityForConfiguration(genuineConfig(configOverrides), v2Shell(validV2EvaluationInput(overrides)));

function expectV2Denial(result: ReturnType<typeof run>, keyFragment: string): void {
  assert.equal(result.kind, 'eligibility-v2', `expected complete v2 denial for ${keyFragment}`);
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey.includes(keyFragment)), `missing ${keyFragment}`);
}

// ---------------------------------------------------------------------------
// E. v2 successful evaluation
// ---------------------------------------------------------------------------

test('E: fully valid v2 evaluation is eligible with both identities and deep immutability', () => {
  const result = run();
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  const report = result.eligibility;
  assert.equal(report.eligible, true);
  assert.equal(report.workspaceId, POU_WORKSPACE_ID);
  assert.equal(report.capability, POU_CAPABILITY);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.findings), true);
  assert.match(report.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(report.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.notEqual(report.staticInputCorrelationIdentity, report.pointOfUseResultIdentity);
});

test('E: deterministic repeated evaluation', () => {
  const a = run();
  const b = run();
  assert.equal(a.kind, 'eligibility-v2');
  assert.equal(b.kind, 'eligibility-v2');
  if (a.kind !== 'eligibility-v2' || b.kind !== 'eligibility-v2') return;
  assert.equal(a.eligibility.staticInputCorrelationIdentity, b.eligibility.staticInputCorrelationIdentity);
  assert.equal(a.eligibility.pointOfUseResultIdentity, b.eligibility.pointOfUseResultIdentity);
});

// ---------------------------------------------------------------------------
// F. mandatory RuntimeGrant gate
// ---------------------------------------------------------------------------

test('F: grant absent → complete v2 denial (pou.grant-missing), both identities, no numeric contribution', () => {
  // The grant is absent from BOTH the input operand and the lifecycle chain
  // (the committed evaluator would otherwise locate it from the records).
  expectV2Denial(run({ grant: undefined, lifecycle: pouLifecycleView(pouChainRecordsWithoutGrant()) }), 'pou.grant-missing');
});

test('F: grant non-capturable (function member) → router failure model-capture', () => {
  const result = run({ grant: { record_id: 'g', fn: () => 1 } });
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'model-capture');
});

test('F: grant wrong record type → complete v2 denial', () => {
  const grant = pouGrantModel();
  grant['record_type'] = 'IssuanceRecord';
  expectV2Denial(run({ grant }), 'pou2.grant-record-type');
});

test('F: grant wrong bundle → complete v2 denial (pou.grant-bundle-mismatch)', () => {
  const grant = pouGrantModel();
  (grant['bundle'] as Record<string, unknown>)['target_instance_id'] = 'pgw:i:wrong';
  expectV2Denial(run({ grant }), 'pou.grant-bundle-mismatch');
});

test('F: grant wrong workspace → complete v2 denial (pou.grant-workspace-mismatch)', () => {
  const grant = pouGrantModel();
  grant['workspace_id'] = 'pgw:w:otherworkspace00';
  expectV2Denial(run({ grant }), 'pou.grant-workspace-mismatch');
});

test('F: grant wrong registry → complete v2 denial (pou.grant-registry-context)', () => {
  const grant = pouGrantModel();
  (grant['registry_snapshot_reference'] as Record<string, unknown>)['registry_snapshot_id'] = 'pgw:g:wrong';
  expectV2Denial(run({ grant }), 'pou.grant-registry-context');
});

test('F: missing lifecycle record → complete v2 denial (pou.missing-issuance)', () => {
  const records = pouChainRecords().filter((r) => r.recordId !== 'pgw:l:1f861271b89026e10ba7308ff03d913e');
  const result = run({ lifecycle: pouLifecycleView(records) });
  expectV2Denial(result, 'pou.missing-issuance');
});

test('F: grant inactive (validity not yet begun) → complete v2 denial (pou.grant-validity)', () => {
  const grant = pouGrantModel();
  (grant['validity'] as Record<string, unknown>)['not_before'] = '2026-08-05T06:00:00.000Z';
  expectV2Denial(run({ grant }), 'pou.grant-validity');
});

test('F: grant expired → complete v2 denial (pou.grant-validity)', () => {
  const grant = pouGrantModel();
  (grant['validity'] as Record<string, unknown>)['not_after'] = '2026-08-01T06:00:00.000Z';
  expectV2Denial(run({ grant }), 'pou.grant-validity');
});

test('F: grant revoked → complete v2 denial (pou.grant-revoked)', () => {
  const grant = pouGrantModel();
  const grantId = String(grant['record_id']);
  const revocations = {
    revocationsByTarget: (recordId: string) =>
      recordId === grantId ? [{ recordId: grantId, effectiveAt: '2026-08-04T06:00:00.000Z', scope: 'revoke' }] : [],
  };
  expectV2Denial(run({ revocations }), 'pou.grant-revoked');
});

test('F: grant unknown constraint → complete v2 denial (pou.grant-unknown-constraint)', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'bogus-constraint', value: true }];
  expectV2Denial(run({ grant }), 'pou.grant-unknown-constraint');
});

test('F: grant malformed max-actions → complete v2 denial (pou.grant-unknown-constraint)', () => {
  const grant = pouGrantModel();
  grant['narrowed_constraints'] = [{ type: 'max-actions', value: 'not-a-number' }];
  expectV2Denial(run({ grant }), 'pou.grant-unknown-constraint');
});

test('F: every grant denial contributes no authority and no numeric limit (eligible false regardless of ceilings)', () => {
  const grant = pouGrantModel();
  grant['record_type'] = 'IssuanceRecord';
  const result = run({ grant }, { globalCapabilityCeiling: { capabilities: [POU_CAPABILITY] }, globalActionCeiling: 20 });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
});

test('F: unknown workspace for a grant-correlated input is still a router boundary failure', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration(
    genuineConfig(),
    v2Shell(validV2EvaluationInput({ workspaceId: 'pgw:w:notregistered1' })),
  );
  assert.equal(result.kind, 'router-failure');
});
