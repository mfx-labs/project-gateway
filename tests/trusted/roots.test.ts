/**
 * WP-6 Phase 1: root registration uniqueness (test category D).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import {
  canonicalizeRoot,
  canonicalizeRootLexically,
  isRootAncestorOrEqual,
} from '../../src/trusted/roots.js';
import { validConfig, validWorkspace, fakeResolver, validOptions } from './helpers.js';

test('D: distinct roots validate', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
});

test('D: lexical normalization (trailing slash, dot segments, repeated separators)', () => {
  assert.deepEqual(canonicalizeRootLexically('/srv/gateway/alpha/'), { ok: true, canonical: '/srv/gateway/alpha' });
  assert.deepEqual(canonicalizeRootLexically('/srv/./gateway//alpha'), { ok: true, canonical: '/srv/gateway/alpha' });
  assert.deepEqual(canonicalizeRootLexically('/srv/gateway/alpha/..'), { ok: true, canonical: '/srv/gateway' });
  assert.deepEqual(canonicalizeRootLexically('/'), { ok: true, canonical: '/' });
});

test('D: invalid roots rejected (not absolute, escape, control characters)', () => {
  assert.equal(canonicalizeRootLexically('srv/gateway').ok, false);
  assert.equal(canonicalizeRootLexically('/..').ok, false);
  assert.equal(canonicalizeRootLexically('/srv/../..').ok, false);
  assert.equal(canonicalizeRootLexically('/srv/\u0000gateway').ok, false);
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: 'relative/path' })] }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-007');
});

test('D: exact duplicate canonical roots fail the entire load', () => {
  for (const roots of [
    ['/srv/gateway/alpha', '/srv/gateway/alpha'],
    ['/srv/gateway/alpha', '/srv/gateway/alpha/'], // normalization collapse
    ['/srv/gateway/alpha', '/srv/./gateway/alpha'],
  ]) {
    const report = validateTrustedWorkspaceConfiguration(
      validConfig({
        workspaces: [
          validWorkspace({ root: roots[0]!, workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
          validWorkspace({ root: roots[1]!, workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
        ],
      }),
      validOptions(),
    );
    assert.equal(report.ok, false, roots.join(' | '));
    assert.equal(report.findings[0]!.code, 'TCF-009');
  }
});

test('D: lexical parent-child and containment roots fail the entire load', () => {
  for (const roots of [
    ['/srv/gateway', '/srv/gateway/alpha'], // parent-child
    ['/srv/gateway/alpha', '/srv/gateway/alpha/sub'], // containment
    ['/srv', '/srv/gateway/alpha'], // root contains all
  ]) {
    const report = validateTrustedWorkspaceConfiguration(
      validConfig({
        workspaces: [
          validWorkspace({ root: roots[0]!, workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
          validWorkspace({ root: roots[1]!, workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
        ],
      }),
      validOptions(),
    );
    assert.equal(report.ok, false, roots.join(' | '));
    assert.equal(report.findings[0]!.code, 'TCF-010');
  }
});

test('D: sibling roots with a common prefix are NOT overlapping (component boundary)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/alpha', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
        validWorkspace({ root: '/srv/gateway/alphabeta', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions(),
  );
  assert.equal(report.ok, true);
});

test('D: symlink-resolved overlap fails closed when a resolver is supplied', () => {
  // /srv/gateway/link resolves to /srv/gateway/alpha (simulated symlink).
  const resolver = fakeResolver({ '/srv/gateway/link': '/srv/gateway/alpha' });
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/alpha', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
        validWorkspace({ root: '/srv/gateway/link', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-009'); // duplicate after resolution
});

test('D: symlink-resolved containment fails closed when a resolver is supplied', () => {
  const resolver = fakeResolver({ '/srv/gateway/link/sub': '/srv/gateway/alpha/sub' });
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/alpha', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
        validWorkspace({ root: '/srv/gateway/link/sub', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-010');
});

test('D: broken symlink fails closed (root-resolution failure)', () => {
  const resolver = fakeResolver({}, new Set(['/srv/gateway/broken']));
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/broken' })] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-008');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.root-resolution-failed');
});

test('D: symlink loop fails closed (resolution failure)', () => {
  const resolver = (p: string): string | null => {
    if (p === '/srv/gateway/loop') return null; // resolver cannot terminate
    return p;
  };
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/loop' })] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-008');
});

test('D: throwing resolver fails closed (no exception escapes)', () => {
  const resolver = (): string | null => {
    throw new Error('boom');
  };
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/alpha' })] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-008');
});

test('D: resolver result is lexically re-canonicalized', () => {
  const resolver = fakeResolver({ '/srv/gateway/link': '/srv/./gateway/alpha/' });
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/link' })] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.workspaces[0]!.canonicalRoot, '/srv/gateway/alpha');
});

test('D: case-sensitive semantics on the supported lane (no case folding)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/Alpha', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
        validWorkspace({ root: '/srv/gateway/alpha', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions(),
  );
  assert.equal(report.ok, true); // distinct byte-exact roots on the Linux lane
});

test('D: first-match and longest-prefix routing are absent', () => {
  // A later registration can never change the outcome: overlapping roots fail
  // regardless of registration order.
  const a = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
        validWorkspace({ root: '/srv/gateway/alpha', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions(),
  );
  const b = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/alpha', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
        validWorkspace({ root: '/srv/gateway', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
      ],
    }),
    validOptions(),
  );
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(a.findings[0]!.code, 'TCF-010');
  assert.equal(b.findings[0]!.code, 'TCF-010');
});

test('D: root helper predicates behave deterministically', () => {
  assert.equal(isRootAncestorOrEqual('/a', '/a'), true);
  assert.equal(isRootAncestorOrEqual('/a', '/a/b'), true);
  assert.equal(isRootAncestorOrEqual('/a/b', '/a'), false);
  assert.equal(isRootAncestorOrEqual('/a/b', '/a/bc'), false);
  assert.equal(isRootAncestorOrEqual('/', '/anything'), true);
});

test('D: findings never disclose the root value', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/secret-root-42' }), validWorkspace({ root: '/srv/secret-root-42', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' })] }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  for (const f of report.findings) {
    assert.ok(!f.message.includes('secret-root-42'), f.message);
  }
});
