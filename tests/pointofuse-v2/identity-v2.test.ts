/**
 * WP-6 Phase 3A: static-input projection, one-pass static identity, and
 * non-circular result identity tests (contract Sections 14 and 19; HCRR-01 and
 * HCRR-02). The projection is the exact closed fixed shape with exact `"2"`
 * version literals; captured models are embedded as deeply frozen JSON values
 * and the complete projection is JCS-serialized exactly once; independent
 * recomputation must reproduce the digest without the production constructor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildPointOfUseResultIdentityProjection,
  buildStaticInputProjection,
  computePointOfUseResultIdentity,
  computeStaticInputCorrelationIdentity,
  RESULT_IDENTITY_DOMAIN,
  STATIC_INPUT_IDENTITY_DOMAIN,
} from '../../src/pointofuse/index.js';
import type { EligibilityReport } from '../../src/api/types.js';
import type { StaticProjectionInput } from '../../src/pointofuse/index.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';

const DOMAIN_STATIC = STATIC_INPUT_IDENTITY_DOMAIN;
const DOMAIN_RESULT = RESULT_IDENTITY_DOMAIN;

function manualDigest(domain: string, projection: unknown): string {
  const canonicalUtf8 = jcsSerialize(projection);
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

function baseProjectionInput(overrides: Partial<StaticProjectionInput> = {}): StaticProjectionInput {
  return {
    configurationVersion: '2',
    configurationIdentity: 'sha-256:' + 'c'.repeat(64),
    capabilityVocabularyVersion: 'v1',
    inputWorkspaceId: 'ws-a',
    requestedUseWorkspaceId: 'ws-a',
    requestedUse: {
      capability: 'project-gateway.workspace-read',
      operationClass: 'read',
      resourceClass: 'artifact',
      scope: 'exact:task-1',
      workspaceId: 'ws-a',
    },
    currentTime: '2026-01-01T00:00:00Z',
    configuredGlobalCapabilityCeiling: { state: 'absent' },
    configuredWorkspaceCapabilityCeiling: { state: 'absent' },
    configuredGlobalNumericCeiling: { state: 'absent' },
    configuredWorkspaceNumericCeiling: { state: 'absent' },
    consumerSupport: {
      consumerId: 'consumer-1',
      supportedProtocolFeatures: ['feature-a'],
      supportedConsumerCapabilities: ['project-gateway.workspace-read'],
      supportedExtensionNamespaces: [],
    },
    bundle: { instanceId: 'bundle-1' },
    policy: { instanceId: 'policy-1' },
    grant: { state: 'absent' },
    registry: {
      registryProtocolId: 'proto-1',
      registrySnapshotFormatVersion: '1',
      registrySnapshotId: 'reg-1',
      registrySnapshotDigest: 'sha-256:' + 'b'.repeat(64),
    },
    lifecycleRecords: [
      { recordId: 'rec-1', model: { record_id: 'rec-1' } },
      { recordId: 'rec-2', model: { record_id: 'rec-2' } },
    ],
    ...overrides,
  };
}

function baseReport(overrides: Partial<EligibilityReport> = {}): EligibilityReport {
  return {
    eligible: true,
    requestedUse: {
      capability: 'project-gateway.workspace-read',
      operationClass: 'read',
      resourceClass: 'artifact',
      scope: 'exact:task-1',
      workspaceId: 'ws-a',
    },
    capability: 'project-gateway.workspace-read',
    scope: 'exact:task-1',
    workspaceId: 'ws-a',
    subjectCorrelations: { workspace: 'ws-a' },
    categories: ['POINT-OF-USE-FAILURE'],
    ruleIds: ['AUT-001'],
    findings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// static projection shape
// ---------------------------------------------------------------------------

test('G: exact fixed shape with exact version literals', () => {
  const projection = buildStaticInputProjection(baseProjectionInput());
  assert.equal(projection.projectionProtocolVersion, '1');
  assert.equal(projection.outerRouterVersion, '2');
  assert.equal(projection.innerPointOfUseInputsVersion, '2');
  assert.equal(projection.configurationVersion, '2');
  assert.deepEqual(Object.keys(projection).sort(), [
    'bundle', 'capabilityVocabularyVersion', 'configurationIdentity', 'configurationVersion',
    'configuredGlobalCapabilityCeiling', 'configuredGlobalNumericCeiling',
    'configuredWorkspaceCapabilityCeiling', 'configuredWorkspaceNumericCeiling',
    'consumerSupport', 'currentTime', 'grant', 'innerPointOfUseInputsVersion',
    'inputWorkspaceId', 'lifecycleRecords', 'outerRouterVersion', 'policy',
    'projectionProtocolVersion', 'registry', 'requestedUse',
    'requestedUseWorkspaceId',
  ].sort());
});

test('G: tagged absence used for every optional operand; no omission-based absence', () => {
  const projection = buildStaticInputProjection(baseProjectionInput());
  assert.deepEqual(projection.configuredGlobalCapabilityCeiling, { state: 'absent' });
  assert.deepEqual(projection.configuredGlobalNumericCeiling, { state: 'absent' });
  assert.deepEqual(projection.grant, { state: 'absent' });
});

test('G: configuration ceiling absence versus zero are distinct', () => {
  const absent = buildStaticInputProjection(baseProjectionInput());
  const zero = buildStaticInputProjection(baseProjectionInput({
    configuredGlobalNumericCeiling: { state: 'present', value: 0 },
  }));
  const present = buildStaticInputProjection(baseProjectionInput({
    configuredGlobalNumericCeiling: { state: 'present', value: 5 },
  }));
  assert.notEqual(computeStaticInputCorrelationIdentity(absent), computeStaticInputCorrelationIdentity(zero));
  assert.notEqual(computeStaticInputCorrelationIdentity(absent), computeStaticInputCorrelationIdentity(present));
  assert.notEqual(computeStaticInputCorrelationIdentity(zero), computeStaticInputCorrelationIdentity(present));
});

test('G: grant absent versus present differ', () => {
  const absent = buildStaticInputProjection(baseProjectionInput());
  const present = buildStaticInputProjection(baseProjectionInput({
    grant: { state: 'present', capturedModel: { record_id: 'grant-1' } },
  }));
  assert.notEqual(computeStaticInputCorrelationIdentity(absent), computeStaticInputCorrelationIdentity(present));
});

test('G: one-pass JCS — captured models embedded as JSON values, not pre-serialized members', () => {
  const projection = buildStaticInputProjection(baseProjectionInput());
  const bundle = projection.bundle;
  assert.equal(bundle.state, 'present');
  // The captured model is a plain JSON value member, not a string/bytes member.
  assert.equal(typeof bundle.capturedModel, 'object');
  assert.equal(typeof (bundle.capturedModel as Record<string, unknown>)['instanceId'], 'string');
  // The whole projection serializes once: the manual single-pass digest matches.
  const expected = manualDigest(DOMAIN_STATIC, projection);
  assert.equal(computeStaticInputCorrelationIdentity(projection), expected);
});

test('G: independent recomputation and digest format', () => {
  const projection = buildStaticInputProjection(baseProjectionInput());
  const digest = computeStaticInputCorrelationIdentity(projection);
  assert.match(digest, /^sha-256:[0-9a-f]{64}$/);
  assert.equal(digest, manualDigest(DOMAIN_STATIC, projection));
});

test('G: one-operand differences change the identity for every projection member', () => {
  const base = buildStaticInputProjection(baseProjectionInput());
  const baseDigest = computeStaticInputCorrelationIdentity(base);
  const variants: StaticProjectionInput[] = [
    baseProjectionInput({ configurationVersion: '1' }),
    baseProjectionInput({ configurationIdentity: 'sha-256:' + 'd'.repeat(64) }),
    baseProjectionInput({ capabilityVocabularyVersion: 'v2' }),
    baseProjectionInput({ inputWorkspaceId: 'ws-b' }),
    baseProjectionInput({ requestedUseWorkspaceId: 'ws-b' }),
    baseProjectionInput({ requestedUse: { ...baseProjectionInput().requestedUse, scope: 'exact:task-2' } }),
    baseProjectionInput({ currentTime: '2026-01-02T00:00:00Z' }),
    baseProjectionInput({ configuredGlobalCapabilityCeiling: { state: 'present', capabilities: ['x'] } }),
    baseProjectionInput({ configuredWorkspaceCapabilityCeiling: { state: 'present', capabilities: ['y'] } }),
    baseProjectionInput({ configuredWorkspaceNumericCeiling: { state: 'present', value: 7 } }),
    baseProjectionInput({ consumerSupport: { ...baseProjectionInput().consumerSupport, consumerId: 'consumer-2' } }),
    baseProjectionInput({ bundle: { instanceId: 'bundle-2' } }),
    baseProjectionInput({ policy: { instanceId: 'policy-2' } }),
    baseProjectionInput({ grant: { state: 'present', capturedModel: { record_id: 'grant-1' } } }),
    baseProjectionInput({ registry: { ...baseProjectionInput().registry, registrySnapshotId: 'reg-2' } }),
    baseProjectionInput({ lifecycleRecords: [{ recordId: 'rec-1', model: { record_id: 'rec-1' } }] }),
  ];
  for (const variant of variants) {
    const digest = computeStaticInputCorrelationIdentity(buildStaticInputProjection(variant));
    assert.notEqual(digest, baseDigest, 'identity must differ for every one-operand change');
  }
});

test('G: lifecycle projection ordering canonicalization', () => {
  const a = buildStaticInputProjection(baseProjectionInput({
    lifecycleRecords: [
      { recordId: 'rec-b', model: { record_id: 'rec-b' } },
      { recordId: 'rec-a', model: { record_id: 'rec-a' } },
    ],
  }));
  const b = buildStaticInputProjection(baseProjectionInput({
    lifecycleRecords: [
      { recordId: 'rec-a', model: { record_id: 'rec-a' } },
      { recordId: 'rec-b', model: { record_id: 'rec-b' } },
    ],
  }));
  assert.equal(computeStaticInputCorrelationIdentity(a), computeStaticInputCorrelationIdentity(b));
});

test('G: live callable state excluded — projection contains no function members', () => {
  const projection = buildStaticInputProjection(baseProjectionInput());
  const serialized = JSON.stringify(projection);
  assert.ok(!serialized.includes('function'));
  assert.ok(!serialized.includes('undefined'));
});

test('G: no root or canonical path material in the projection or digest', () => {
  const projection = buildStaticInputProjection(baseProjectionInput({
    bundle: { instanceId: 'bundle-secret' },
  }));
  const digest = computeStaticInputCorrelationIdentity(projection);
  assert.ok(!digest.includes('bundle-secret'));
  assert.ok(!digest.includes('srv'));
});

// ---------------------------------------------------------------------------
// result identity
// ---------------------------------------------------------------------------

test('H: non-circular — projection excludes pointOfUseResultIdentity itself', () => {
  const staticIdentity = computeStaticInputCorrelationIdentity(buildStaticInputProjection(baseProjectionInput()));
  const projection = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: baseReport() });
  assert.equal('pointOfUseResultIdentity' in projection, false);
  assert.equal(projection.pointOfUseResultIdentityProtocolVersion, '1');
  assert.equal(projection.routingVariant, 'v2');
  assert.equal(projection.staticInputCorrelationIdentity, staticIdentity);
});

test('H: independent recomputation without the production constructor', () => {
  const staticIdentity = computeStaticInputCorrelationIdentity(buildStaticInputProjection(baseProjectionInput()));
  const report = baseReport();
  const projection = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report });
  const digest = computePointOfUseResultIdentity(projection);
  assert.match(digest, /^sha-256:[0-9a-f]{64}$/);
  assert.equal(digest, manualDigest(DOMAIN_RESULT, projection));
});

test('H: finding sequence sensitivity and set canonicalization', () => {
  const staticIdentity = 'sha-256:' + 'e'.repeat(64);
  const finding = (phase: string, category: string, key: string, ruleId: string) => ({
    phase, category, messageKey: key, ruleIds: [ruleId], subjectIdentity: 'sub-1', location: '/x',
  }) as unknown as EligibilityReport['findings'][number];
  const reportA = baseReport({
    eligible: false,
    findings: [finding('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'pou.deny', 'AUT-002')],
  });
  const reportB = baseReport({
    eligible: false,
    findings: [finding('point-of-use-eligibility', 'POINT-OF-USE-FAILURE', 'pou.unknown-denied', 'AUT-003')],
  });
  const a = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: reportA });
  const b = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: reportB });
  assert.notEqual(computePointOfUseResultIdentity(a), computePointOfUseResultIdentity(b));
  // ruleIds are canonicalized sorted; a reordered input set yields the same projection.
  const reportC = baseReport({ ruleIds: ['AUT-003', 'AUT-001', 'AUT-003'] });
  const reportD = baseReport({ ruleIds: ['AUT-001', 'AUT-003'] });
  const c = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: reportC });
  const d = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: reportD });
  assert.deepEqual(c.normalizedReport.ruleIds, ['AUT-001', 'AUT-003']);
  assert.equal(computePointOfUseResultIdentity(c), computePointOfUseResultIdentity(d));
});

test('H: subject-correlation object-key order independence', () => {
  const staticIdentity = 'sha-256:' + 'f'.repeat(64);
  const reportA = baseReport({ subjectCorrelations: { a: '1', b: '2' } });
  const reportB = baseReport({ subjectCorrelations: { b: '2', a: '1' } });
  const a = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: reportA });
  const b = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: reportB });
  assert.equal(computePointOfUseResultIdentity(a), computePointOfUseResultIdentity(b));
});

test('H: report change changes result identity', () => {
  const staticIdentity = 'sha-256:' + 'a'.repeat(64);
  const a = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: baseReport() });
  const b = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: baseReport({ scope: 'exact:task-9' }) });
  assert.notEqual(computePointOfUseResultIdentity(a), computePointOfUseResultIdentity(b));
});

test('H: same static identity with changed live outcome changes result identity only', () => {
  const staticIdentity = 'sha-256:' + 'b'.repeat(64);
  const eligible = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: baseReport() });
  const denied = buildPointOfUseResultIdentityProjection({
    staticInputCorrelationIdentity: staticIdentity,
    report: baseReport({ eligible: false, findings: [] }),
  });
  assert.notEqual(computePointOfUseResultIdentity(eligible), computePointOfUseResultIdentity(denied));
  assert.equal(eligible.staticInputCorrelationIdentity, denied.staticInputCorrelationIdentity);
});

test('H: optional fields use explicit omission', () => {
  const staticIdentity = 'sha-256:' + 'c'.repeat(64);
  const projection = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report: baseReport() });
  assert.equal('firstFailingPhase' in projection.normalizedReport, false);
  assert.deepEqual(projection.normalizedReport.categories, ['POINT-OF-USE-FAILURE']);
});

test('H: base report is not mutated', () => {
  const staticIdentity = 'sha-256:' + 'd'.repeat(64);
  const report = baseReport();
  const snapshot = JSON.stringify(report);
  buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report });
  computePointOfUseResultIdentity(buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report }));
  assert.equal(JSON.stringify(report), snapshot);
});

test('H: findings project stable protocol fields, never message prose', () => {
  const staticIdentity = 'sha-256:' + 'e'.repeat(64);
  const report = baseReport({
    eligible: false,
    findings: [{
      phase: 'point-of-use-eligibility' as never,
      category: 'POINT-OF-USE-FAILURE' as never,
      messageKey: 'pou.deny',
      message: 'localized prose that must never be hashed',
      ruleIds: ['AUT-002'],
      subjectIdentity: 'sub-1',
      location: '/rules',
    }],
  });
  const projection = buildPointOfUseResultIdentityProjection({ staticInputCorrelationIdentity: staticIdentity, report });
  const serialized = JSON.stringify(projection);
  assert.ok(!serialized.includes('localized prose'));
  assert.equal(projection.normalizedReport.findings[0]!.messageKey, 'pou.deny');
});
