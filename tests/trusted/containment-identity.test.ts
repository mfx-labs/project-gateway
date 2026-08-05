/**
 * WP-6 Phase 2A: containment-decision identity (test category E).
 *
 * The decision identity is deterministic, binds every behaviorally relevant
 * operand, is registration-order independent, is never produced on failure,
 * and discloses no raw path in its digest representation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  evaluateExistingPathContainment,
  computeContainmentDecisionIdentity,
  containmentDecisionProjection,
} from '../../src/trusted/index.js';
import { CONTAINMENT_DECISION_DIGEST_DOMAIN } from '../../src/trusted/containment-identity.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';
import { requestFor, validatedConfig, validContainmentOptions, fakeExistingResolver, WORKSPACE_ALPHA, ROOT_ALPHA } from './containment-helpers.js';

const identityOf = (config: ReturnType<typeof validatedConfig>, request: Record<string, unknown>, resolver = fakeExistingResolver()): string => {
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config, resolver));
  if (!report.ok) throw new Error(`fixture decision invalid: ${report.findings.map((f) => f.code).join(',')}`);
  return report.decision!.decisionIdentity;
};

test('E: deterministic repeated decisions share one identity', () => {
  const config = validatedConfig();
  const a = identityOf(config, requestFor(config, { path: 'docs/notes.md' }));
  const b = identityOf(config, requestFor(config, { path: 'docs/notes.md' }));
  assert.equal(a, b);
});

test('E: changed purpose changes the identity', () => {
  const config = validatedConfig();
  assert.notEqual(
    identityOf(config, requestFor(config, { purpose: 'read' })),
    identityOf(config, requestFor(config, { purpose: 'inspect' })),
  );
});

test('E: changed path changes the identity', () => {
  const config = validatedConfig();
  assert.notEqual(
    identityOf(config, requestFor(config, { path: 'docs/notes.md' })),
    identityOf(config, requestFor(config, { path: 'docs/other.md' })),
  );
});

test('E: changed workspace changes the identity', () => {
  const config = validatedConfig();
  assert.notEqual(
    identityOf(config, requestFor(config, { workspaceId: WORKSPACE_ALPHA, path: 'x' })),
    identityOf(config, requestFor(config, { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', path: 'x' })),
  );
});

test('E: changed configuration changes the identity', () => {
  const a = validatedConfig();
  const b = validatedConfig({ globalActionCeiling: 9 });
  assert.notEqual(identityOf(a, requestFor(a, { path: 'x' })), identityOf(b, requestFor(b, { path: 'x' })));
});

test('E: changed resolver result changes the identity', () => {
  const config = validatedConfig();
  const plain = identityOf(config, requestFor(config, { path: 'docs/notes.md' }));
  const mapped = identityOf(
    config,
    requestFor(config, { path: 'docs/notes.md' }),
    fakeExistingResolver({ [`${ROOT_ALPHA}/docs/notes.md`]: `${ROOT_ALPHA}/real/notes.md` }),
  );
  assert.notEqual(plain, mapped);
});

test('E: protocol version is bound into the identity', () => {
  const config = validatedConfig();
  const decision = evaluateExistingPathContainment(requestFor(config, { path: 'x' }), validContainmentOptions(config)).decision!;
  const projection = containmentDecisionProjection({
    containmentProtocolVersion: '1',
    operationClass: decision.operationClass,
    purpose: decision.purpose,
    configurationIdentity: decision.configurationIdentity,
    hostLane: config.hostLane,
    workspaceId: decision.workspaceId,
    canonicalWorkspaceRelativePath: decision.canonicalWorkspaceRelativePath,
    resolvedAbsolutePath: decision.resolvedAbsolutePath,
    pointOfUseRevalidationRequired: true,
  });
  const recomputed = computeContainmentDecisionIdentity({
    containmentProtocolVersion: '1',
    operationClass: decision.operationClass,
    purpose: decision.purpose,
    configurationIdentity: decision.configurationIdentity,
    hostLane: config.hostLane,
    workspaceId: decision.workspaceId,
    canonicalWorkspaceRelativePath: decision.canonicalWorkspaceRelativePath,
    resolvedAbsolutePath: decision.resolvedAbsolutePath,
    pointOfUseRevalidationRequired: true,
  });
  assert.equal(recomputed.digest, decision.decisionIdentity);
  assert.equal(projection['containmentProtocolVersion'], '1');
});

test('E: workspace registration order is non-semantic for identity', () => {
  const forward = validatedConfig();
  const reversed = validatedConfig({
    workspaces: [
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' },
    ],
  });
  assert.equal(identityOf(forward, requestFor(forward, { path: 'x' })), identityOf(reversed, requestFor(reversed, { path: 'x' })));
});

test('E: identity bytes are independently recomputed and match', () => {
  const config = validatedConfig();
  const decision = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config)).decision!;
  const canonicalUtf8 = jcsSerialize(containmentDecisionProjection({
    containmentProtocolVersion: decision.containmentProtocolVersion,
    operationClass: decision.operationClass,
    purpose: decision.purpose,
    configurationIdentity: decision.configurationIdentity,
    hostLane: config.hostLane,
    workspaceId: decision.workspaceId,
    canonicalWorkspaceRelativePath: decision.canonicalWorkspaceRelativePath,
    resolvedAbsolutePath: decision.resolvedAbsolutePath,
    pointOfUseRevalidationRequired: decision.pointOfUseRevalidationRequired,
  }));
  const digest = 'sha-256:' + createHash('sha256')
    .update(CONTAINMENT_DECISION_DIGEST_DOMAIN, 'utf8')
    .update(canonicalUtf8, 'utf8')
    .digest('hex');
  assert.equal(digest, decision.decisionIdentity);
});

test('E: no identity on failure and no partial decision', () => {
  const config = validatedConfig();
  const cases = [
    requestFor(config, { path: '/etc/passwd' }),
    requestFor(config, { path: '../x' }),
    requestFor(config, { purpose: 'delete' }),
    requestFor(config, { workspaceId: 'pgw:w:unknown123456' }),
    requestFor(config, { expectedConfigurationIdentity: 'sha-256:' + '0'.repeat(64) }),
  ];
  for (const request of cases) {
    const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
    assert.equal(report.ok, false);
    assert.equal(report.decision, undefined);
  }
});

test('E: the digest representation discloses no raw path', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/secret-notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  const digest = report.decision!.decisionIdentity;
  assert.match(digest, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(!digest.includes('secret'), digest);
  assert.ok(!digest.includes('srv'), digest);
  assert.ok(!digest.includes('docs'), digest);
});

test('E: canonical ordering is locale-independent and stable', () => {
  const config = validatedConfig();
  const decision = evaluateExistingPathContainment(requestFor(config, { path: '_x/-y/0z' }), validContainmentOptions(config)).decision!;
  const utf8 = computeContainmentDecisionIdentity({
    containmentProtocolVersion: decision.containmentProtocolVersion,
    operationClass: decision.operationClass,
    purpose: decision.purpose,
    configurationIdentity: decision.configurationIdentity,
    hostLane: config.hostLane,
    workspaceId: decision.workspaceId,
    canonicalWorkspaceRelativePath: decision.canonicalWorkspaceRelativePath,
    resolvedAbsolutePath: decision.resolvedAbsolutePath,
    pointOfUseRevalidationRequired: true,
  }).canonicalUtf8;
  // JCS canonical key order is deterministic; the same input yields the same bytes.
  assert.equal(utf8, computeContainmentDecisionIdentity({
    containmentProtocolVersion: decision.containmentProtocolVersion,
    operationClass: decision.operationClass,
    purpose: decision.purpose,
    configurationIdentity: decision.configurationIdentity,
    hostLane: config.hostLane,
    workspaceId: decision.workspaceId,
    canonicalWorkspaceRelativePath: decision.canonicalWorkspaceRelativePath,
    resolvedAbsolutePath: decision.resolvedAbsolutePath,
    pointOfUseRevalidationRequired: true,
  }).canonicalUtf8);
  assert.ok(utf8.includes('"canonicalWorkspaceRelativePath":"_x/-y/0z"'));
});

test('E: identity is prospective correlation data, not authority', () => {
  const config = validatedConfig();
  const decision = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config)).decision!;
  const keys = Object.keys(decision as unknown as Record<string, unknown>);
  for (const key of ['approval', 'grant', 'authority', 'receipt', 'execution']) {
    assert.equal(keys.some((k) => k.includes(key)), false, key);
  }
  assert.equal(decision.pointOfUseRevalidationRequired, true);
});
