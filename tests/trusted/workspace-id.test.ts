/**
 * WP-6 Phase 1: workspace identifiers (test category C).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { isValidWorkspaceId } from '../../src/trusted/workspace-id.js';
import { validConfig, validWorkspace, validOptions } from './helpers.js';

test('C: valid opaque identifiers accepted', () => {
  for (const id of ['pgw:w:aaaaaaaaaaaaaaaa', 'pgw:w:abc123_def-ghi9', 'pgw:w:' + 'a'.repeat(128)]) {
    assert.equal(isValidWorkspaceId(id), true);
    const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: [validWorkspace({ workspaceId: id })] }), validOptions());
    assert.equal(report.ok, true, id);
  }
});

test('C: malformed identifiers rejected', () => {
  for (const id of [
    'workspace-1', // no prefix
    'PGW:W:aaaaaaaaaaaaaaaa', // wrong case
    'pgw:w:', // empty opaque
    'pgw:w:abc', // opaque too short
    'pgw:w:' + 'a'.repeat(129), // opaque too long
    'pgw:w:aaa/bbb', // path separator
    'pgw:w:aaa.bbb', // dot
    'pgw:w:AAAABBBB', // uppercase
    'pgw:w:aaa bbb', // whitespace
    '/srv/gateway/alpha', // absolute path must never be a valid identifier
  ]) {
    assert.equal(isValidWorkspaceId(id), false, id);
  }
});

test('C: empty and non-string identifiers fail closed', () => {
  const empty = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: [validWorkspace({ workspaceId: '' })] }), validOptions());
  assert.equal(empty.ok, false);
  assert.equal(empty.findings[0]!.code, 'TCF-005');
  const missingWs = validWorkspace() as Record<string, unknown>;
  delete missingWs['workspaceId'];
  const missing = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: [missingWs] }), validOptions());
  assert.equal(missing.ok, false);
  assert.equal(missing.findings[0]!.code, 'TCF-005');
});

test('C: duplicate identifiers fail the entire configuration load', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/alpha' }),
        validWorkspace({ root: '/srv/gateway/beta' }), // same ID, different root
      ],
    }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-006');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.workspace-id-duplicate');
});

test('C: duplicate detection is registration-order independent', () => {
  const first = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/a' }), validWorkspace({ root: '/b' })] }),
    validOptions(),
  );
  const second = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/b' }), validWorkspace({ root: '/a' })] }),
    validOptions(),
  );
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(first.findings[0]!.code, 'TCF-006');
  assert.equal(second.findings[0]!.code, 'TCF-006');
});

test('C: no root leakage through the identifier or public findings', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig({ workspaces: [validWorkspace({ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' })] }), validOptions());
  assert.equal(report.ok, true);
  // The identifier carries no root material by grammar.
  assert.ok(!report.configuration!.workspaces[0]!.workspaceId.includes('srv'));
  assert.ok(!report.configuration!.workspaces[0]!.workspaceId.includes('/'));
  // Findings for malformed identifiers never echo the offending value.
  const bad = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ workspaceId: 'pgw:w:/etc/passwd/../../x' })] }),
    validOptions(),
  );
  assert.equal(bad.ok, false);
  for (const f of bad.findings) {
    assert.ok(!f.message.includes('etc'), f.message);
  }
});
