/**
 * WP-6 Phase 2A: configuration and workspace correlation (test category C).
 *
 * The request can never supply trusted operands: the canonical root, host
 * lane, ceilings, provenance, and configuration version come exclusively
 * from the validated configuration; the expected configuration identity must
 * match exactly; unknown workspaces fail closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExistingPathContainment, CONTAINMENT_PROTOCOL_VERSION, TRUSTED_HOST_LANE } from '../../src/trusted/index.js';
import { requestFor, validatedConfig, validRequest, validContainmentOptions, WORKSPACE_ALPHA, WORKSPACE_BETA, ROOT_ALPHA } from './containment-helpers.js';

test('C: exact configuration identity is required and never inferred', () => {
  const config = validatedConfig();
  // Missing expected identity fails closed.
  const missing = validRequest({ path: 'docs/notes.md' });
  const r1 = evaluateExistingPathContainment(missing, validContainmentOptions(config));
  assert.equal(r1.ok, false);
  assert.equal(r1.findings[0]!.code, 'TCP-010');
  assert.equal(r1.findings[0]!.messageKey, 'containment.configuration-identity-mismatch');
  // A wrong digest fails closed.
  const wrong = requestFor(config, { expectedConfigurationIdentity: 'sha-256:' + '0'.repeat(64) });
  const r2 = evaluateExistingPathContainment(wrong, validContainmentOptions(config));
  assert.equal(r2.ok, false);
  assert.equal(r2.findings[0]!.code, 'TCP-010');
  // Non-string expected identity fails closed.
  const nonString = requestFor(config, { expectedConfigurationIdentity: 42 });
  const r3 = evaluateExistingPathContainment(nonString, validContainmentOptions(config));
  assert.equal(r3.ok, false);
  assert.equal(r3.findings[0]!.code, 'TCP-010');
});

test('C: stale configuration identity fails closed', () => {
  const fresh = validatedConfig();
  // A second, semantically identical configuration has the same identity; a
  // configuration that differs (extra workspace ceiling) has a different
  // identity and must be rejected when the request binds the old one.
  const changed = validatedConfig({
    globalActionCeiling: 7,
  });
  assert.notEqual(fresh.identity, changed.identity);
  const request = requestFor(fresh, { path: 'docs/notes.md' });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(changed));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-010');
});

test('C: unknown workspace fails closed; valid workspace resolves', () => {
  const config = validatedConfig();
  const unknown = evaluateExistingPathContainment(requestFor(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' }), validContainmentOptions(config));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.findings[0]!.code, 'TCP-009');
  const known = evaluateExistingPathContainment(requestFor(config, { workspaceId: WORKSPACE_ALPHA }), validContainmentOptions(config));
  assert.equal(known.ok, true);
  assert.equal(known.decision!.workspaceId, WORKSPACE_ALPHA);
});

test('C: decisions correlate with the exact workspace record root', () => {
  const config = validatedConfig();
  const alpha = evaluateExistingPathContainment(requestFor(config, { workspaceId: WORKSPACE_ALPHA, path: 'x/y' }), validContainmentOptions(config));
  const beta = evaluateExistingPathContainment(requestFor(config, { workspaceId: WORKSPACE_BETA, path: 'x/y' }), validContainmentOptions(config));
  assert.equal(alpha.ok, true);
  assert.equal(beta.ok, true);
  assert.equal(alpha.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/x/y`);
  assert.equal(beta.decision!.resolvedAbsolutePath, '/srv/gateway/beta/x/y');
  assert.notEqual(alpha.decision!.decisionIdentity, beta.decision!.decisionIdentity);
});

test('C: workspace registration order is non-semantic for decisions', () => {
  const forward = validatedConfig();
  const reversed = validatedConfig({
    workspaces: [
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' },
    ],
  });
  const a = evaluateExistingPathContainment(requestFor(forward, { path: 'docs/notes.md' }), validContainmentOptions(forward));
  const b = evaluateExistingPathContainment(requestFor(reversed, { path: 'docs/notes.md' }), validContainmentOptions(reversed));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('C: request cannot supply the canonical root (strict unknown-field rejection)', () => {
  const config = validatedConfig();
  for (const extra of [
    { root: '/srv/attacker' },
    { canonicalRoot: '/srv/attacker' },
    { hostLane: TRUSTED_HOST_LANE },
    { hostLane: 'linux-x86_64-posix-utf8-node22' },
    { capabilities: ['project-gateway.shell-execute'] },
    { actionCeiling: 0 },
    { provenance: { sourceKind: 'trusted-local-control-plane' } },
    { trustedExtensionSet: { version: '1' } },
    { configurationVersion: CONTAINMENT_PROTOCOL_VERSION },
    { lane: 'linux-x86_64-posix-utf8-node22' },
    { absolutePath: '/srv/attacker/x' },
  ]) {
    const request = requestFor(config, extra);
    const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
    assert.equal(report.ok, false, JSON.stringify(extra));
    assert.equal(report.findings[0]!.code, 'TCP-003', JSON.stringify(extra));
    assert.equal(report.decision, undefined, JSON.stringify(extra));
  }
});

test('C: request cannot select another workspace through path content', () => {
  // Path content cannot change which workspace record is used; only the
  // workspaceId operand does.
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(
    requestFor(config, { workspaceId: WORKSPACE_ALPHA, path: 'beta/../alpha.md' }),
    validContainmentOptions(config),
  );
  assert.equal(report.ok, true);
  assert.equal(report.decision!.workspaceId, WORKSPACE_ALPHA);
  assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/alpha.md`);
});

test('C: decisions bind the validated configuration identity', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.configurationIdentity, config.identity);
});
