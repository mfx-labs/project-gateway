/**
 * PS-6 — containment accepts both accepted host lanes (TCP-011 boundary).
 *
 * The containment contract is lane-independent across the closed accepted
 * set: a genuinely validated configuration carrying either
 * `linux-x86_64-posix-utf8-node22` or `darwin-arm64-posix-utf8-node22`
 * passes the same containment evaluation with identical decisions; a
 * genuinely branded configuration carrying an unsupported lane (the only
 * way such an object can exist — the public validator can never produce
 * one) fails closed at TCP-011, and a forged object fails at TCP-021
 * before any lane field is read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateExistingPathContainment,
  TRUSTED_HOST_LANE,
  DARWIN_ARM64_HOST_LANE,
  validateTrustedWorkspaceConfiguration,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { markValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { validConfig, validOptions } from './helpers.js';
import { requestFor, validContainmentOptions, identityResolver, WORKSPACE_ALPHA } from './containment-helpers.js';

function validatedForLane(lane: typeof TRUSTED_HOST_LANE | typeof DARWIN_ARM64_HOST_LANE): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane }));
  if (!report.ok) {
    throw new Error(`fixture configuration invalid under ${lane}: ${report.findings.map((f) => f.code).join(',')}`);
  }
  return report.configuration!;
}

test('PS6: containment accepts both supported host lanes with identical decisions', () => {
  const linux = validatedForLane(TRUSTED_HOST_LANE);
  const darwin = validatedForLane(DARWIN_ARM64_HOST_LANE);
  assert.notEqual(linux.identity, darwin.identity, 'lanes are identity-bound');
  const r1 = evaluateExistingPathContainment(requestFor(linux, { path: 'docs/notes.md' }), validContainmentOptions(linux));
  const r2 = evaluateExistingPathContainment(requestFor(darwin, { path: 'docs/notes.md' }), validContainmentOptions(darwin));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r1.decision!.workspaceId, WORKSPACE_ALPHA);
  assert.equal(r2.decision!.workspaceId, WORKSPACE_ALPHA);
  assert.equal(r1.decision!.resolvedAbsolutePath, r2.decision!.resolvedAbsolutePath);
  // Decision identity is lane-bound (host lane participates), like the
  // configuration identity.
  assert.notEqual(r1.decision!.decisionIdentity, r2.decision!.decisionIdentity);
});

test('PS6: a branded configuration with an unsupported host lane fails closed at TCP-011', () => {
  // The public validator can never produce an unsupported-lane
  // configuration; this exercises the defense-in-depth boundary with the
  // same in-process brand the runtime marker path uses.
  const config = validatedForLane(TRUSTED_HOST_LANE);
  const forged = { ...config, hostLane: 'darwin-x86_64-posix-utf8-node22' } as unknown as ValidatedTrustedWorkspaceConfiguration;
  markValidatedTrustedWorkspaceConfiguration(forged);
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(forged));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-011');
  assert.equal(report.findings[0]!.messageKey, 'containment.host-lane-unsupported');
});

test('PS6: a forged (unbranded) configuration fails closed at TCP-021 before the lane is read', () => {
  const config = validatedForLane(TRUSTED_HOST_LANE);
  const forged = { ...config, hostLane: DARWIN_ARM64_HOST_LANE } as ValidatedTrustedWorkspaceConfiguration;
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(forged, identityResolver()));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-021');
});
