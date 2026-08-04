/**
 * WP-6 Phase 1 correction F-2: the root resolver is mandatory for trusted
 * production validation. No lexical-only input may produce a normal
 * ValidatedTrustedWorkspaceConfiguration, and duplicate/overlap evaluation
 * always uses resolved canonical roots.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrustedWorkspaceConfiguration } from '../../src/trusted/index.js';
import { validConfig, validWorkspace, fakeResolver, validOptions } from './helpers.js';

test('F2: missing resolver fails closed with a dedicated finding (TCF-026)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig(),
    // @ts-expect-error — resolver omission must be a type error; runtime check still fails closed
    { hostLane: validOptions().hostLane },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-026');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.root-resolver-missing');
  assert.equal(report.configuration, undefined);
});

test('F2: non-function resolver fails closed (TCF-026)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig(),
    // @ts-expect-error — resolver must be a function; runtime check still fails closed
    { hostLane: validOptions().hostLane, resolveRootPath: '/srv/gateway/alpha' },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-026');
});

test('F2: missing resolver cannot produce a trusted configuration under any input', () => {
  // Even a minimal well-formed input must fail: no lexical-only downgrade.
  for (const input of [
    validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/alpha' })] }),
    validConfig(),
  ]) {
    const report = validateTrustedWorkspaceConfiguration(
      input,
      // @ts-expect-error — deliberate runtime omission
      { hostLane: validOptions().hostLane },
    );
    assert.equal(report.ok, false, 'lexical-only validation must never succeed');
    assert.equal(report.findings[0]!.code, 'TCF-026');
  }
});

test('F2: identity resolver supplies every accepted root', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway/alpha' }),
        validWorkspace({ workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' }),
      ],
    }),
    validOptions(),
  );
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.workspaces[0]!.canonicalRoot, '/srv/gateway/alpha');
  assert.equal(report.configuration!.workspaces[1]!.canonicalRoot, '/srv/gateway/beta');
});

test('F2: resolver returning a relative result fails closed (TCF-008)', () => {
  const resolver = fakeResolver({ '/srv/gateway/link': 'relative/result' });
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/link' })] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-008');
});

test('F2: resolver returning a non-POSIX/outside-lane result fails closed (TCF-008)', () => {
  for (const bad of ['C:\\srv\\gateway\\alpha', '\\\\server\\share', 'srv/gateway', '/srv/gateway/\u0000x']) {
    const resolver = fakeResolver({ '/srv/gateway/link': bad });
    const report = validateTrustedWorkspaceConfiguration(
      validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/link' })] }),
      validOptions({ resolveRootPath: resolver }),
    );
    assert.equal(report.ok, false, bad);
    assert.equal(report.findings[0]!.code, 'TCF-008');
  }
});

test('F2: symlink-resolved duplicate uses resolved canonical roots (TCF-009)', () => {
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
  assert.equal(report.findings[0]!.code, 'TCF-009');
});

test('F2: symlink-resolved overlap uses resolved canonical roots (TCF-010)', () => {
  const resolver = fakeResolver({ '/srv/gateway/link': '/srv/gateway' });
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({
      workspaces: [
        validWorkspace({ root: '/srv/gateway', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' }),
        validWorkspace({ root: '/srv/gateway/link/sub', workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb' }),
      ],
    }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-010');
});

test('F2: resolved canonical roots are bound into the configuration identity', () => {
  const identityResolver = validOptions().resolveRootPath;
  const mappingResolver = fakeResolver({ '/srv/gateway/link': '/srv/gateway/real' });
  const input = validConfig({ workspaces: [validWorkspace({ root: '/srv/gateway/link' })] });
  const lexical = validateTrustedWorkspaceConfiguration(input, validOptions({ resolveRootPath: identityResolver })).configuration!;
  const resolved = validateTrustedWorkspaceConfiguration(input, validOptions({ resolveRootPath: mappingResolver })).configuration!;
  assert.notEqual(lexical.identity, resolved.identity);
  assert.equal(resolved.workspaces[0]!.canonicalRoot, '/srv/gateway/real');
});

test('F2: validated model exposes no unresolved-validation mode', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  const config = report.configuration! as unknown as Record<string, unknown>;
  assert.equal(config['mode'], undefined);
  assert.equal(config['resolutionMode'], undefined);
  assert.equal(config['lexicalOnly'], undefined);
});
