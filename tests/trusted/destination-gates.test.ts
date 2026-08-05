/**
 * WP-6 Phase 2B: configuration, workspace, identity-correlation, artifact-
 * kind, and resolver-presence gates (test categories A + B).
 *
 * The evaluator performs zero resolver invocations for any failure before
 * the resolver stage. Configuration genuineness, version, workspace,
 * artifact-location presence, expected-identity correlation, and artifact
 * kind are all evaluated before any resolver call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProspectiveArtifactDestination } from '../../src/trusted/index.js';
import {
  validatedConfig,
  validatedV1Config,
  v2ConfigTwoWorkspaces,
  v2ConfigWithoutLocation,
  destinationRequest,
  successResolver,
  countingResolver,
} from './destination-helpers.js';

const evaluate = (config: unknown, input: unknown, resolver = successResolver('missing')) =>
  evaluateProspectiveArtifactDestination(input, { configuration: config as never, resolveProspectiveDestination: resolver });

test('A: genuine version-2 configuration with artifact location passes the configuration gates', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config));
  assert.equal(report.ok, true);
});

test('A: forged configuration rejected (TAD-001), zero resolver calls', () => {
  const config = validatedConfig();
  const forged = { ...config };
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(forged, destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
  assert.equal(report.findings[0]!.messageKey, 'destination.configuration-not-genuine');
  assert.equal(report.decision, undefined);
  assert.equal(counted.calls(), 0);
});

test('A: cloned configuration rejected (TAD-001)', () => {
  const config = validatedConfig();
  const report = evaluate(structuredClone(config), destinationRequest(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
});

test('A: spread configuration rejected (TAD-001)', () => {
  const config = validatedConfig();
  const report = evaluate({ ...config, workspaces: [...config.workspaces] }, destinationRequest(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
});

test('A: JSON-reconstructed configuration rejected (TAD-001)', () => {
  const config = validatedConfig();
  const report = evaluate(JSON.parse(JSON.stringify(config)), destinationRequest(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
});

test('A: structured-clone configuration rejected (TAD-001)', () => {
  const config = validatedConfig();
  const report = evaluate(structuredClone(config), destinationRequest(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
});

test('A: Proxy-wrapped configuration rejected (TAD-001)', () => {
  const config = validatedConfig();
  const report = evaluate(new Proxy(config, {}), destinationRequest(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
});

test('A: manually frozen lookalike rejected (TAD-001)', () => {
  const config = validatedConfig();
  const lookalike = Object.freeze({ ...config });
  const report = evaluate(lookalike, destinationRequest(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
});

test('A: genuine version-1 configuration rejected (TAD-002), zero resolver calls', () => {
  const v1 = validatedV1Config();
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(v1, { expectedConfigurationIdentity: v1.identity, workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', artifactKind: 'TaskSpec', destination: 'task.json' }, counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-002');
  assert.equal(counted.calls(), 0);
});

test('A: unknown workspace rejected (TAD-003), zero resolver calls', () => {
  const config = validatedConfig();
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(config, destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' }), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-003');
  assert.equal(counted.calls(), 0);
});

test('A: non-string workspace identifier rejected (TAD-003)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { workspaceId: 42 }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-003');
});

test('A: missing artifact location rejected (TAD-004), zero resolver calls', () => {
  const config = validatedConfig(v2ConfigWithoutLocation());
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(config, destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-004');
  assert.equal(report.findings[0]!.messageKey, 'destination.artifact-location-missing');
  assert.equal(counted.calls(), 0);
});

test('A: expected configuration identity mismatch rejected (TAD-005), zero resolver calls', () => {
  const config = validatedConfig();
  const other = validatedConfig(v2ConfigTwoWorkspaces());
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(config, destinationRequest(other), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-005');
  assert.equal(report.findings[0]!.messageKey, 'destination.configuration-identity-mismatch');
  assert.equal(counted.calls(), 0);
});

test('A: missing expected configuration identity rejected (TAD-005)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { expectedConfigurationIdentity: '' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-005');
});

test('B: all four permitted artifact kinds are accepted', () => {
  for (const kind of ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract']) {
    const config = validatedConfig();
    const report = evaluate(config, destinationRequest(config, { artifactKind: kind }));
    assert.equal(report.ok, true, kind);
    assert.equal(report.decision!.artifactKind, kind);
  }
});

test('B: ExecutionBundle rejected (TAD-006), zero resolver calls', () => {
  const config = validatedConfig();
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(config, destinationRequest(config, { artifactKind: 'ExecutionBundle' }), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-006');
  assert.equal(counted.calls(), 0);
});

test('B: ExecutionResult rejected (TAD-006)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { artifactKind: 'ExecutionResult' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-006');
});

test('B: TrustedReceipt rejected (TAD-006)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { artifactKind: 'TrustedReceipt' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-006');
});

test('B: unknown string artifact kind rejected (TAD-006)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { artifactKind: 'TaskSpec2' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-006');
});

test('B: non-string artifact kind rejected (TAD-006)', () => {
  const config = validatedConfig();
  const report = evaluate(config, destinationRequest(config, { artifactKind: 7 }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-006');
});

test('B: artifact-kind identity difference', () => {
  const config = validatedConfig();
  const a = evaluate(config, destinationRequest(config, { artifactKind: 'TaskSpec' }));
  const b = evaluate(config, destinationRequest(config, { artifactKind: 'AuthorityPolicy' }));
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('A: missing resolver rejected (TAD-013), no decision', () => {
  const config = validatedConfig();
  const report = evaluateProspectiveArtifactDestination(destinationRequest(config), {
    configuration: config,
    resolveProspectiveDestination: undefined as never,
  });
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-013');
  assert.equal(report.findings[0]!.messageKey, 'destination.resolver-missing');
  assert.equal(report.decision, undefined);
});

test('A: zero resolver calls for every early failure', () => {
  const config = validatedConfig();
  const cases: Record<string, unknown>[] = [
    { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' },
    { expectedConfigurationIdentity: 'sha-256:' + '0'.repeat(64) },
    { artifactKind: 'ExecutionBundle' },
    { artifactKind: 7 },
    { destination: 'a/b' , extra: 1 },
  ];
  for (const overrides of cases) {
    const counted = countingResolver(successResolver('missing'));
    const report = evaluate(config, destinationRequest(config, overrides), counted.resolver);
    assert.equal(report.ok, false);
    assert.equal(counted.calls(), 0, JSON.stringify(overrides));
  }
});
