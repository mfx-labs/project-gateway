/**
 * WP-6 Phase 2A: request trust and path form (test categories A + B).
 *
 * The candidate path is UNTRUSTED workspace-relative request data: absolute
 * forms are rejected, the path cannot select a root, and the purpose
 * vocabulary is exactly `read` | `inspect` with no mutation classes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExistingPathContainment, CONTAINMENT_PROTOCOL_VERSION } from '../../src/trusted/index.js';
import { parseWorkspaceRelativePath, combineWorkspaceRootAndComponents } from '../../src/trusted/containment-path.js';
import { requestFor, validatedConfig, validRequest, validContainmentOptions, WORKSPACE_ALPHA, ROOT_ALPHA } from './containment-helpers.js';

test('A: valid workspace-relative path yields a contained decision', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.canonicalWorkspaceRelativePath, 'docs/notes.md');
  assert.equal(report.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/docs/notes.md`);
});

test('A: root token "." represents the workspace root exactly', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: '.' }), validContainmentOptions(config));
  assert.equal(report.ok, true);
  assert.equal(report.decision!.canonicalWorkspaceRelativePath, '');
  assert.equal(report.decision!.resolvedAbsolutePath, ROOT_ALPHA);
});

test('A: POSIX absolute request paths are rejected (TCP-005)', () => {
  const config = validatedConfig();
  for (const path of ['/srv/gateway/alpha/notes.md', '/etc/passwd', '//server/share', '/']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.findings[0]!.code, 'TCP-005', path);
    assert.equal(report.decision, undefined, path);
  }
});

test('A: Windows drive-absolute and UNC request paths are rejected (TCP-005)', () => {
  const config = validatedConfig();
  for (const path of ['C:\\srv\\gateway\\alpha\\notes.md', 'C:/srv/gateway/alpha', 'c:foo', '\\\\server\\share', '\\srv\\gateway']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.findings[0]!.code, 'TCP-005', path);
  }
});

test('A: backslash anywhere is malformed on the POSIX lane (TCP-006)', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: 'docs\\notes.md' }), validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-006');
});

test('A: empty path is rejected (TCP-006); the root token is "." only', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config, { path: '' }), validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-006');
});

test('A: interior "." components are rejected as ambiguous (TCP-006)', () => {
  const config = validatedConfig();
  for (const path of ['a/./b', './a', 'a/.']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.findings[0]!.code, 'TCP-006', path);
  }
});

test('A: safe interior ".." pops are normalized; escaping ".." is rejected (TCP-007)', () => {
  const config = validatedConfig();
  const safe = evaluateExistingPathContainment(requestFor(config, { path: 'docs/notes.md/../notes.md' }), validContainmentOptions(config));
  assert.equal(safe.ok, true);
  assert.equal(safe.decision!.canonicalWorkspaceRelativePath, 'docs/notes.md');
  const popped = evaluateExistingPathContainment(requestFor(config, { path: 'a/b/..' }), validContainmentOptions(config));
  assert.equal(popped.ok, true);
  assert.equal(popped.decision!.canonicalWorkspaceRelativePath, 'a');
  // Pops bounded by the workspace root: 'a/..' returns to the root (contained).
  const toRoot = evaluateExistingPathContainment(requestFor(config, { path: 'a/..' }), validContainmentOptions(config));
  assert.equal(toRoot.ok, true);
  assert.equal(toRoot.decision!.canonicalWorkspaceRelativePath, '');
  assert.equal(toRoot.decision!.resolvedAbsolutePath, ROOT_ALPHA);
  for (const path of ['..', '../x', 'a/../../x', 'a/b/../../..']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.findings[0]!.code, 'TCP-007', path);
  }
});

test('A: leading, trailing, and repeated separators are rejected (TCP-006)', () => {
  const config = validatedConfig();
  // Leading '/' is the absolute form (TCP-005).
  for (const path of ['/a', '//a']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.findings[0]!.code, 'TCP-005', path);
  }
  // Trailing and repeated separators are ambiguous empty components (TCP-006).
  for (const path of ['a/', 'a//b', 'a/b//', 'a/b/']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.findings[0]!.code, 'TCP-006', path);
  }
});

test('A: NUL and control characters are rejected (TCP-008)', () => {
  const config = validatedConfig();
  for (const path of ['a\u0000b', 'a\u001fb', '\u0001x']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, JSON.stringify(path));
    assert.equal(report.findings[0]!.code, 'TCP-008', JSON.stringify(path));
  }
});

test('A: NFC and NFD forms remain byte-distinct (no silent normalization)', () => {
  const config = validatedConfig();
  const nfc = evaluateExistingPathContainment(requestFor(config, { path: 'docs/caf\u00e9.md' }), validContainmentOptions(config));
  const nfd = evaluateExistingPathContainment(requestFor(config, { path: 'docs/cafe\u0301.md' }), validContainmentOptions(config));
  assert.equal(nfc.ok, true);
  assert.equal(nfd.ok, true);
  assert.notEqual(nfc.decision!.decisionIdentity, nfd.decision!.decisionIdentity);
  assert.equal(nfc.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/docs/caf\u00e9.md`);
  assert.equal(nfd.decision!.resolvedAbsolutePath, `${ROOT_ALPHA}/docs/cafe\u0301.md`);
});

test('A: repository-derived and prompt-derived strings receive no trusted treatment', () => {
  // A path-shaped string that could have come from a repository file or a
  // prompt is treated exactly like any other untrusted request input.
  const config = validatedConfig();
  for (const path of ['../../etc/passwd', '/srv/gateway/alpha', 'C:\\windows\\system32']) {
    const report = evaluateExistingPathContainment(requestFor(config, { path }), validContainmentOptions(config));
    assert.equal(report.ok, false, path);
    assert.equal(report.decision, undefined, path);
  }
});

test('B: purpose read and inspect are accepted and differ in identity', () => {
  const config = validatedConfig();
  const read = evaluateExistingPathContainment(requestFor(config, { purpose: 'read' }), validContainmentOptions(config));
  const inspect = evaluateExistingPathContainment(requestFor(config, { purpose: 'inspect' }), validContainmentOptions(config));
  assert.equal(read.ok, true);
  assert.equal(inspect.ok, true);
  assert.equal(read.decision!.purpose, 'read');
  assert.equal(inspect.decision!.purpose, 'inspect');
  assert.notEqual(read.decision!.decisionIdentity, inspect.decision!.decisionIdentity);
});

test('B: unsupported purposes and all mutation classes are rejected (TCP-004)', () => {
  const config = validatedConfig();
  for (const purpose of [
    'write', 'create', 'persist', 'delete', 'rename', 'move', 'execute',
    'read-write', 'git-mutate', '', 'READ', 'inspect-extra',
  ]) {
    const report = evaluateExistingPathContainment(requestFor(config, { purpose }), validContainmentOptions(config));
    assert.equal(report.ok, false, purpose);
    assert.equal(report.findings[0]!.code, 'TCP-004', purpose);
    assert.equal(report.decision, undefined, purpose);
  }
});

test('B: no mutation result type exists on a successful decision', () => {
  const config = validatedConfig();
  const report = evaluateExistingPathContainment(requestFor(config), validContainmentOptions(config));
  assert.equal(report.ok, true);
  const decision = report.decision! as unknown as Record<string, unknown>;
  for (const key of ['writeAllowed', 'createAllowed', 'deleteAllowed', 'renameAllowed', 'destination', 'mutation']) {
    assert.equal(key in decision, false, key);
  }
  assert.equal(decision['pointOfUseRevalidationRequired'], true);
});

test('B: parser and combination units behave deterministically', () => {
  assert.deepEqual(parseWorkspaceRelativePath('.'), { ok: true, components: [] });
  assert.deepEqual(parseWorkspaceRelativePath('a/b'), { ok: true, components: ['a', 'b'] });
  assert.equal(parseWorkspaceRelativePath('/a').ok, false);
  assert.equal(parseWorkspaceRelativePath('a/.').ok, false);
  assert.equal(parseWorkspaceRelativePath('').ok, false);
  const combined = combineWorkspaceRootAndComponents(ROOT_ALPHA, ['a', '..', 'b']);
  assert.equal(combined.ok, true);
  if (combined.ok) assert.equal(combined.relative, 'b');
  assert.equal(combineWorkspaceRootAndComponents(ROOT_ALPHA, ['..']).ok, false);
  const root = combineWorkspaceRootAndComponents(ROOT_ALPHA, []);
  assert.equal(root.ok, true);
  if (root.ok) assert.equal(root.relative, '');
});

test('A: request with a missing path field fails closed (TCP-006)', () => {
  const config = validatedConfig();
  const request = requestFor(config);
  delete (request as Record<string, unknown>)['path'];
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-006');
});

test('A: unsupported containment protocol version fails closed (TCP-001)', () => {
  const config = validatedConfig();
  for (const version of ['2', '0', '', 1, 'v1']) {
    const report = evaluateExistingPathContainment(requestFor(config, { containmentProtocolVersion: version }), validContainmentOptions(config));
    assert.equal(report.ok, false, String(version));
    assert.equal(report.findings[0]!.code, 'TCP-001', String(version));
  }
});

test('A: no version inference from fields', () => {
  const config = validatedConfig();
  const request = requestFor(config);
  delete (request as Record<string, unknown>)['containmentProtocolVersion'];
  const report = evaluateExistingPathContainment(request, validContainmentOptions(config));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCP-001');
  assert.equal(report.findings[0]!.messageKey, 'containment.version-missing');
});

test('A: workspaceId is required and validated (TCP-009)', () => {
  const config = validatedConfig();
  const missing = requestFor(config);
  delete (missing as Record<string, unknown>)['workspaceId'];
  const r1 = evaluateExistingPathContainment(missing, validContainmentOptions(config));
  assert.equal(r1.ok, false);
  assert.equal(r1.findings[0]!.code, 'TCP-009');
  const unknown = evaluateExistingPathContainment(requestFor(config, { workspaceId: 'pgw:w:notregistered' }), validContainmentOptions(config));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.findings[0]!.code, 'TCP-009');
  assert.equal(unknown.findings[0]!.messageKey, 'containment.workspace-unknown');
  assert.equal(WORKSPACE_ALPHA.length > 0, true);
});
