/**
 * WP-6 Phase 2A: existing-path resolution and containment (test category D).
 *
 * The injected trusted resolver is the only source of existence evidence;
 * symlink escape, broken links, loops, malformed results, resolver absence
 * or failure, outside-root results, and ambiguity all fail closed. The core
 * performs no filesystem operation and invokes the resolver exactly once per
 * decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExistingPathContainment, type ExistingPathResolver } from '../../src/trusted/index.js';
import { requestFor, validatedConfig, validContainmentOptions, fakeExistingResolver, identityResolver, WORKSPACE_ALPHA, ROOT_ALPHA } from './containment-helpers.js';

test('D: workspace root itself is contained (root token)', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: '.' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.resolvedAbsolutePath, ROOT_ALPHA);
});

test('D: direct and deep children are contained at component boundaries', () => {
  const config = validatedConfig();
  for (const path of ['a', 'a/b', 'a/b/c/d/e']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, true, path);
    assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/${path}`, path);
  }
});

test('D: normalized child paths are contained', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'a/b/../b/c' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.canonicalWorkspaceRelativePath, 'a/b/c');
  assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/a/b/c`);
});

test('D: sibling-prefix paths are NOT contained (component boundary)', () => {
  const config = validatedConfig({ workspaces: [{ workspaceId: 'pgw:w:cccccccccccccccc', root: '/srv/gateway/alpha' }] });
  const report = evaluateExistingPathContainment(
    requestFor(config, { workspaceId: 'pgw:w:cccccccccccccccc', path: 'ab' }),
    validContainmentOptions(config, fakeExistingResolver({ [`${ROOT_ALPHA}/ab`]: '/srv/gateway/alphab' })),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-017');
});

test('D: internal symlink that resolves inside the root is contained', () => {
  const config = validatedConfig();
  const resolver = fakeExistingResolver({ [`${ROOT_ALPHA}/docs/notes.md`]: `${ROOT_ALPHA}/real/notes.md` });
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/real/notes.md`);
});

test('D: symlink escape outside the root fails closed (TCP-017)', () => {
  const config = validatedConfig();
  const resolver = fakeExistingResolver({ [`${ROOT_ALPHA}/docs/notes.md`]: '/srv/outside/notes.md' });
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-017');
  assert.equal(report.decision, undefined);
});

test('D: broken symlink and missing path fail closed (TCP-014)', () => {
  const config = validatedConfig();
  const resolver = fakeExistingResolver({}, new Set([`${ROOT_ALPHA}/docs/notes.md`]));
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-014');
  assert.equal(report.findings[0]!.messageKey, 'containment.path-unresolved');
});

test('D: symlink loop fails closed (TCP-015)', () => {
  const config = validatedConfig();
  const resolver: ExistingPathResolver = () => ({ ok: false, code: 'loop' });
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-015');
});

test('D: resolver-reported error fails closed (TCP-013)', () => {
  const config = validatedConfig();
  const resolver: ExistingPathResolver = () => ({ ok: false, code: 'error' });
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-013');
});

test('D: throwing resolver fails closed (TCP-013), no exception escapes', () => {
  const config = validatedConfig();
  const resolver: ExistingPathResolver = () => {
    throw new Error('resolver boom');
  };
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-013');
});

test('D: missing and non-function resolvers fail closed (TCP-012)', () => {
  const config = validatedConfig();
  const missing = evaluateExistingPathContainment(requestFor(config), { configuration: config } as never);
  assert.equal(missing.ok, false);
  assert.equal(missing.findings[0]!.code, 'TCP-012');
  const nonFunction = evaluateExistingPathContainment(requestFor(config), { configuration: config, resolveExistingPath: '/srv/gateway' } as never);
  assert.equal(nonFunction.ok, false);
  assert.equal(nonFunction.findings[0]!.code, 'TCP-012');
});

test('D: relative, Windows, UNC, NUL, and malformed resolver results fail closed (TCP-016)', () => {
  const config = validatedConfig();
  for (const bad of ['relative/path', 'C:\\srv\\gateway', '\\\\server\\share', '/srv/gateway/alpha/x\u0000y', '/srv/gateway/alpha/x\u001fy', 'srv/gateway']) {
    const resolver = fakeExistingResolver({ [`${ROOT_ALPHA}/docs/notes.md`]: bad });
    const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
    assert.equal(report.ok, false, bad);
    assert.equal(report.findings[0]!.code, 'TCP-016', bad);
  }
});

test('D: resolver results are lexically re-canonicalized before containment', () => {
  // A result with a trailing `..` that stays inside the root recanonicalizes
  // to the root itself and is contained (deterministic canonical form).
  const config = validatedConfig();
  const resolver = fakeExistingResolver({ [`${ROOT_ALPHA}/docs/notes.md`]: `${ROOT_ALPHA}/x/..` });
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, true); // /srv/gateway/alpha/x/.. recanonicalizes to the root itself (inside)
  assert.equal(report.decision!.resolvedAbsolutePath, ROOT_ALPHA);
});

test('D: resolver returning an ancestor of the root fails closed (TCP-017)', () => {
  const config = validatedConfig();
  const resolver = fakeExistingResolver({ [`${ROOT_ALPHA}/docs/notes.md`]: '/srv/gateway' });
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-017');
});

test('D: resolver is invoked exactly once per decision', () => {
  const config = validatedConfig();
  let calls = 0;
  const resolver: ExistingPathResolver = (p) => {
    calls++;
    return { ok: true, canonical: p };
  };
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, resolver));
  assert.equal(report.ok, true);
  assert.equal(calls, 1);
});

test('D: stateful resolver yields deterministic per-call decisions (no repeated evidence)', () => {
  // Each decision performs exactly one resolution; a stateful resolver
  // produces a deterministic decision for the evidence observed on that
  // call, scoped per the accepted stable-operand determinism rule.
  const config = validatedConfig();
  let calls = 0;
  const stateful: ExistingPathResolver = (p) => {
    calls++;
    return { ok: true, canonical: calls === 1 ? p : `${ROOT_ALPHA}/other` };
  };
  const first = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, stateful));
  const second = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config, stateful));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/docs/notes.md`);
  assert.equal(second.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/other`);
  assert.notEqual(first.decision!.decisionIdentity, second.decision!.decisionIdentity);
});

test('D: mutation after evaluation cannot change the decision', () => {
  const config = validatedConfig();
  const request = requestFor(config, { path: 'docs/notes.md' });
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, true);
  const identity = report.decision!.decisionIdentity;
  request['path'] = 'attacker.md';
  request['workspaceId'] = WORKSPACE_ALPHA;
  (request as Record<string, unknown>)['expectedConfigurationIdentity'] = 'sha-256:' + '0'.repeat(64);
  assert.equal(report.decision!.canonicalWorkspaceRelativePath, 'docs/notes.md');
  assert.equal(report.decision!.decisionIdentity, identity);
});

test('D: workspace mismatch via request workspaceId is rejected', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(
    requestFor(config, { workspaceId: 'pgw:w:aaaaaaaaaaaaaaab', path: 'docs/notes.md' }),
    validContainmentOptions(config),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-009');
});

test('D: configuration identity mismatch with the resolver in place fails closed (TCP-010)', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(
    requestFor(config, { expectedConfigurationIdentity: 'sha-256:' + 'a'.repeat(64) }),
    validContainmentOptions(config),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-010');
});

test('D: identity resolver is the default and keeps paths inside the root', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'a/b' }), validContainmentOptions(config, identityResolver()));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/a/b`);
});
