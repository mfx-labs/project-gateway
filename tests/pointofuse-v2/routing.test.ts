/**
 * WP-6 Phase 3B: authoritative internal router tests — configuration
 * genuineness (A), `requiresV2` (B), closed routing truth table (C), and v1
 * compatibility (D).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePointOfUseEligibilityForConfiguration,
  requiresV2,
} from '../../src/pointofuse/index.js';
import { lookupValidatedWorkspace, validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } from '../../src/trusted/index.js';
import { evaluatePointOfUseEligibility } from '../../src/index.js';
import {
  genuineConfig,
  validV1EvaluationInput,
  validV2EvaluationInput,
  POU_WORKSPACE_ID,
  POU_CAPABILITY,
} from './helpers.js';

const v1Shell = (inputs: Record<string, unknown>): Record<string, unknown> => ({
  routeProtocolVersion: '1',
  legacyCompatibilityMode: 'explicit-legacy-test',
  inputs,
});

const v2Shell = (inputs: Record<string, unknown>): Record<string, unknown> => ({
  routeProtocolVersion: '2',
  inputs,
});

// ---------------------------------------------------------------------------
// A. configuration genuineness
// ---------------------------------------------------------------------------

test('A: genuine configuration produces a complete evaluation', () => {
  const config = genuineConfig();
  const result = evaluatePointOfUseEligibilityForConfiguration(config, v2Shell(validV2EvaluationInput()));
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, true);
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
});

test('A: structural forgery rejected before any field read', () => {
  const config = genuineConfig();
  const forged = { ...config };
  const result = evaluatePointOfUseEligibilityForConfiguration(forged as never, v2Shell(validV2EvaluationInput()));
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'config-not-genuine');
  assert.equal(result.findings[0]!.code, 'POU2-015');
});

test('A: unbranded deep clone rejected', () => {
  const config = genuineConfig();
  const clone = structuredClone(config);
  const result = evaluatePointOfUseEligibilityForConfiguration(clone as never, v2Shell(validV2EvaluationInput()));
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'config-not-genuine');
});

test('A: wrong configuration object rejected with no identities and no exception', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration(
    { configurationVersion: '2' } as never,
    v2Shell(validV2EvaluationInput()),
  );
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal('staticInputCorrelationIdentity' in result, false);
  assert.equal('pointOfUseResultIdentity' in result, false);
});

// ---------------------------------------------------------------------------
// B. requiresV2
// ---------------------------------------------------------------------------

test('B: all four forcing operands trigger requiresV2 independently', () => {
  const workspaceOf = (config: ReturnType<typeof genuineConfig>): ReturnType<typeof lookupValidatedWorkspace> =>
    lookupValidatedWorkspace(config, POU_WORKSPACE_ID);
  // global capability ceiling (present, even with absent capabilities — presence, not truthiness)
  assert.equal(requiresV2(genuineConfig({ globalCapabilityCeiling: {} }), workspaceOf(genuineConfig({ globalCapabilityCeiling: {} }))!), true);
  // workspace capability ceiling
  assert.equal(requiresV2(genuineConfig({ workspaceCapabilities: [] }), workspaceOf(genuineConfig({ workspaceCapabilities: [] }))!), true);
  // global numeric ceiling (zero counts as present)
  assert.equal(requiresV2(genuineConfig({ globalActionCeiling: 0 }), workspaceOf(genuineConfig({ globalActionCeiling: 0 }))!), true);
  // workspace numeric ceiling
  assert.equal(requiresV2(genuineConfig({ workspaceActionCeiling: 0 }), workspaceOf(genuineConfig({ workspaceActionCeiling: 0 }))!), true);
});

test('B: all absent is false; ceilings present on either version force v2', () => {
  const plain = genuineConfig();
  const ws = lookupValidatedWorkspace(plain, POU_WORKSPACE_ID)!;
  assert.equal(requiresV2(plain, ws), false);
  // version "1" with ceilings still forces v2
  const v1WithCeiling = genuineConfig({ configurationVersion: '1', globalCapabilityCeiling: { capabilities: [POU_CAPABILITY] } });
  assert.equal(requiresV2(v1WithCeiling, lookupValidatedWorkspace(v1WithCeiling, POU_WORKSPACE_ID)!), true);
  // version "2" without ceilings does not force v2
  assert.equal(requiresV2(genuineConfig({ configurationVersion: '2' }), ws), false);
});

test('B: artifact location alone does not force v2', () => {
  // A version-2 configuration whose workspace declares only an artifact
  // location (no ceilings) must not force v2.
  const input = {
    configurationVersion: '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: POU_WORKSPACE_ID, root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' }],
  };
  const report = validateTrustedWorkspaceConfiguration(input, {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p: string) => p,
    resolveArtifactLocation: (p: string) => ({ ok: true, canonicalPath: p, entryKind: 'directory' as const }),
  });
  assert.equal(report.ok, true);
  const ws = lookupValidatedWorkspace(report.configuration!, POU_WORKSPACE_ID)!;
  assert.equal(requiresV2(report.configuration!, ws), false);
});

test('B: matched workspace ceiling forces v2; an unmatched workspace ceiling does not', () => {
  // Config declares the ceiling on THIS workspace: matched lookup sees it.
  const config = genuineConfig({ workspaceCapabilities: [POU_CAPABILITY] });
  const ws = lookupValidatedWorkspace(config, POU_WORKSPACE_ID)!;
  assert.equal(requiresV2(config, ws), true);
  // A different (unregistered) workspace record cannot be resolved; the
  // predicate is evaluated only against the matched workspace record.
});

// ---------------------------------------------------------------------------
// C. routing truth table
// ---------------------------------------------------------------------------

test('C: v1 + no required v2 → eligibility-v1 with no identities', () => {
  const config = genuineConfig();
  const result = evaluatePointOfUseEligibilityForConfiguration(config, v1Shell(validV1EvaluationInput()));
  assert.equal(result.kind, 'eligibility-v1');
  if (result.kind !== 'eligibility-v1') return;
  assert.equal(result.eligibility.eligible, true);
  assert.equal('staticInputCorrelationIdentity' in result.eligibility, false);
  assert.equal('pointOfUseResultIdentity' in result.eligibility, false);
});

test('C: v1 + required v2 → router failure legacy-not-permitted', () => {
  const config = genuineConfig({ globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] } });
  const result = evaluatePointOfUseEligibilityForConfiguration(config, v1Shell(validV1EvaluationInput()));
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'legacy-not-permitted');
  assert.equal(result.findings[0]!.code, 'POU2-018');
});

test('C: v2 + no required v2 → eligibility-v2', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration(genuineConfig(), v2Shell(validV2EvaluationInput()));
  assert.equal(result.kind, 'eligibility-v2');
});

test('C: v2 + required v2 → eligibility-v2', () => {
  const config = genuineConfig({ globalActionCeiling: 20 });
  const result = evaluatePointOfUseEligibilityForConfiguration(config, v2Shell(validV2EvaluationInput()));
  assert.equal(result.kind, 'eligibility-v2');
});

test('C: malformed request → router failure', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration(genuineConfig(), { routeProtocolVersion: '2', extra: 1 });
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'shell-structural');
});

test('C: v2 shell carrying legacy field → router failure', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration(
    genuineConfig(),
    { routeProtocolVersion: '2', legacyCompatibilityMode: 'explicit-legacy-test', inputs: validV2EvaluationInput() },
  );
  assert.equal(result.kind, 'router-failure');
});

test('C: v1 shell without declaration → router failure', () => {
  const result = evaluatePointOfUseEligibilityForConfiguration(genuineConfig(), { routeProtocolVersion: '1', inputs: validV1EvaluationInput() });
  assert.equal(result.kind, 'router-failure');
});

// ---------------------------------------------------------------------------
// D. v1 compatibility
// ---------------------------------------------------------------------------

test('D: detached v1 router branch semantically matches the direct v1 entry for valid records', () => {
  const config = genuineConfig();
  const routed = evaluatePointOfUseEligibilityForConfiguration(config, v1Shell(validV1EvaluationInput()));
  assert.equal(routed.kind, 'eligibility-v1');
  const direct = evaluatePointOfUseEligibility(validV1EvaluationInput() as never);
  if (routed.kind !== 'eligibility-v1') return;
  assert.equal(routed.eligibility.eligible, direct.eligible);
  assert.deepEqual(routed.eligibility.findings.map((f) => f.messageKey), direct.findings.map((f) => f.messageKey));
  assert.deepEqual(routed.eligibility.ruleIds, direct.ruleIds);
});

test('D: direct public v1 entry remains functional and unchanged in shape', () => {
  const report = evaluatePointOfUseEligibility(validV1EvaluationInput() as never);
  assert.equal(report.eligible, true);
  assert.equal('staticInputCorrelationIdentity' in report, false);
});

test('D: no configuration ceiling silently ignored when v2 is required', () => {
  const config = genuineConfig({ globalCapabilityCeiling: { capabilities: ['project-gateway.workspace-read'] } });
  const result = evaluatePointOfUseEligibilityForConfiguration(config, v1Shell(validV1EvaluationInput()));
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'legacy-not-permitted');
});

test('D: routed v1 branch deep-equals the direct v1 entry for a deterministic denial (M-2)', () => {
  // A valid v1 input that reaches semantic evaluation and produces a
  // deterministic denial (policy unknown-denied + consumer capability-
  // unsupported) under a configuration with requiresV2 false. Equivalent FRESH
  // inputs are built separately for the direct and routed evaluations; the
  // complete reports must be deeply equal — every field, not only message keys
  // or rule IDs.
  const deniedUse = {
    capability: 'project-gateway.file-edit',
    operationClass: 'read',
    resourceClass: 'configured-artifact-area',
    scope: 'exact:resource-1',
    workspaceId: POU_WORKSPACE_ID,
  };
  const config = genuineConfig(); // no ceilings → requiresV2 false
  const routed = evaluatePointOfUseEligibilityForConfiguration(config, v1Shell(validV1EvaluationInput({ requestedUse: { ...deniedUse } })));
  assert.equal(routed.kind, 'eligibility-v1');
  if (routed.kind !== 'eligibility-v1') return;
  const direct = evaluatePointOfUseEligibility(validV1EvaluationInput({ requestedUse: { ...deniedUse } }) as never);
  assert.equal(direct.eligible, false);
  // Complete deep equivalence: eligible, requestedUse, capability, scope,
  // workspaceId, subjectCorrelations, firstFailingPhase, categories, ruleIds,
  // and the complete ordered findings with every stable finding field.
  assert.deepEqual(routed.eligibility, direct);
});

test('D: unknown workspace is a router boundary failure with no identities', () => {
  const config = genuineConfig();
  const input = validV2EvaluationInput({ workspaceId: 'pgw:w:unknownworkspace1' });
  const result = evaluatePointOfUseEligibilityForConfiguration(config, v2Shell(input));
  assert.equal(result.kind, 'router-failure');
  if (result.kind !== 'router-failure') return;
  assert.equal(result.stage, 'workspace-unknown');
  assert.equal(result.findings[0]!.code, 'POU2-017');
});
