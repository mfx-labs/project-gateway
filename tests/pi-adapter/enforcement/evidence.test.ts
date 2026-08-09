/**
 * WP-5B unit tests — PiEnforcementEvidence canonicalization (Part E;
 * F-02/F-R2/F-R4): projectionIdentity vs evidenceFingerprint distinction,
 * determinism, and no timestamp/outcome leakage into projectionIdentity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProjectionIdentity,
  computePlanFingerprint,
  computePlanIdentity,
  computeEffectiveAuthorityIdentity,
  computeConsumerDeclarationIdentity,
  computeEnforcementConfigurationIdentity,
  computeEvidenceFingerprint,
  canonicalizeEvidence,
  buildEvidence,
  type EvidenceFacts,
  type ProjectionIdentityInput,
} from '../../../src/adapters/pi/enforcement/evidence.js';

const IDENTITY_INPUT: ProjectionIdentityInput = {
  planFingerprint: 'pf1',
  authorityInputIdentities: {
    globalCeilingsIdentity: 'g1',
    workspaceCeilingsIdentity: 'w1',
    policyRevisionId: 'p1',
    grantIdentity: 'grant1',
    consumerDeclarationIdentity: 'c1',
  },
  effectiveAuthorityIdentity: 'e1',
  compatibilityResultIdentity: 'comp1',
  observedToolInventoryIdentity: 'inv1',
  enforcementConfigurationIdentity: 'cfg1',
  workspaceIdentity: 'ws1',
  capabilityVocabularyVersion: '1',
  evaluatorInterfaceVersion: '2',
};

function facts(over: Partial<EvidenceFacts> = {}): EvidenceFacts {
  return {
    inputPlanIdentity: 'plan-identity',
    planFingerprint: 'pf1',
    projectionIdentity: computeProjectionIdentity(IDENTITY_INPUT),
    authorityInputIdentities: IDENTITY_INPUT.authorityInputIdentities,
    effectiveAuthorityIdentity: 'e1',
    piGuardIdentity: 'pi-guard',
    piGuardVersion: '0.1.2',
    piIdentity: 'pi',
    piVersion: '0.83.0',
    observedToolInventoryIdentity: 'inv1',
    projectedAllowedTools: ['read', 'grep'],
    projectedDeniedTools: ['bash', 'edit'],
    unsupportedRequiredCapabilities: [],
    activationOutcome: 'applied',
    restorationOutcome: 'not-applicable',
    compatibilityFindings: [],
    timestampSource: 'pgw:host:clock',
    observedAt: '2026-08-04T06:20:00.000Z',
    ...over,
  };
}

test('projectionIdentity is deterministic and independent of evidence change', () => {
  const a = computeProjectionIdentity(IDENTITY_INPUT);
  const b = computeProjectionIdentity(JSON.parse(JSON.stringify(IDENTITY_INPUT)) as ProjectionIdentityInput);
  assert.equal(a, b);
  assert.match(a, /^sha-256:[0-9a-f]{64}$/);
});

test('projectionIdentity does not include timestamps or outcomes (F-R4)', () => {
  // identical member set -> identical projection identity regardless of the
  // activation/restoration outcome and timestamp carried by the evidence record
  const applied = buildEvidence(facts({ activationOutcome: 'applied', restorationOutcome: 'not-applicable', observedAt: 'T0' }));
  const restored = buildEvidence(facts({ activationOutcome: 'applied', restorationOutcome: 'verified', observedAt: 'T1' }));
  assert.equal(applied.projectionIdentity, restored.projectionIdentity);
  // ...but the evidence fingerprints differ (complete record, incl. timestamps/outcomes)
  assert.notEqual(applied.evidenceFingerprint, restored.evidenceFingerprint);
});

test('evidenceFingerprint includes the timestamp; changing it changes the fingerprint only', () => {
  const base = buildEvidence(facts());
  const later = buildEvidence(facts({ observedAt: '2026-08-04T06:21:00.000Z' }));
  assert.equal(base.projectionIdentity, later.projectionIdentity);
  assert.notEqual(base.evidenceFingerprint, later.evidenceFingerprint);
  assert.notEqual(canonicalizeEvidence(base as never), canonicalizeEvidence(later as never));
});

test('buildEvidence is fully deterministic over identical facts', () => {
  const a = buildEvidence(facts());
  const b = buildEvidence(facts());
  assert.deepEqual(a, b);
  assert.equal(a.evidenceFingerprint, b.evidenceFingerprint);
  // fingerprint over the canonical record WITHOUT the fingerprint field matches
  const { evidenceFingerprint: _fp, ...rest } = a;
  assert.equal(computeEvidenceFingerprint(rest as never), a.evidenceFingerprint);
});

test('authority-input identities and enforcement-config identity are deterministic + order-independent', () => {
  const consumerA = computeConsumerDeclarationIdentity({ consumerId: 'c', supportedConsumerCapabilities: ['x', 'y'] });
  const consumerB = computeConsumerDeclarationIdentity({ consumerId: 'c', supportedConsumerCapabilities: ['y', 'x'] });
  assert.equal(consumerA, consumerB);
  const cfgA = computeEnforcementConfigurationIdentity(['b', 'a'], ['d', 'c'], []);
  const cfgB = computeEnforcementConfigurationIdentity(['a', 'b'], ['c', 'd'], []);
  assert.equal(cfgA, cfgB);
});

test('effective-authority identity uses the WP-6 result identity when present, else a deterministic linkage', () => {
  const withV2 = computeEffectiveAuthorityIdentity({ eligible: true, capability: 'project-gateway.workspace-read', scope: 's', workspaceId: 'ws', subjectCorrelations: {}, pointOfUseResultIdentity: 'pou-result-1' } as never);
  assert.equal(withV2, 'pou-result-1');
  const v1 = computeEffectiveAuthorityIdentity({ eligible: true, capability: 'project-gateway.workspace-read', scope: 's', workspaceId: 'ws', subjectCorrelations: {} } as never);
  const v1again = computeEffectiveAuthorityIdentity({ eligible: true, capability: 'project-gateway.workspace-read', scope: 's', workspaceId: 'ws', subjectCorrelations: {} } as never);
  assert.match(v1, /^sha-256:[0-9a-f]{64}$/);
  assert.equal(v1, v1again);
});

test('plan identity and fingerprint are deterministic', () => {
  const planA = { occurrenceId: 'o', attemptId: 'a', bundleReference: { target_instance_id: 'b' }, protocolVersion: '1.0', consumerIdentity: 'c', consumerVersion: '0.1.0', supportedPiLane: 'lane', taskReference: {}, authorityPolicyReference: {}, contextManifestReference: {}, completionContractReference: {}, subjectCorrelations: [], capabilityCompatibility: { fingerprint: 'f' }, status: 'projection-ready', piGuardEnforcementPending: true } as never;
  assert.equal(computePlanIdentity(planA), computePlanIdentity(planA));
  assert.equal(computePlanFingerprint(planA), computePlanFingerprint(planA));
  assert.match(computePlanIdentity(planA), /^sha-256:[0-9a-f]{64}$/);
});
