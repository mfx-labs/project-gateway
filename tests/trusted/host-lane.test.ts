/**
 * WP-6 Phase 1 correction F-7: explicit trusted host-lane operand.
 *
 * Validation requires an explicit trusted host-lane compatibility operand;
 * the core never ambiently probes the host (no process, environment, path,
 * or runtime global reads); only the accepted lane identifier
 * (`linux-x86_64-posix-utf8-node22`) can produce a validated configuration,
 * and the accepted lane is bound into the configuration identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import { validConfig, fakeResolver, validOptions } from './helpers.js';

test('F7: accepted lane validates and is bound into the validated configuration', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  assert.equal(report.ok, true);
  assert.equal(report.configuration!.hostLane, TRUSTED_HOST_LANE);
});

test('F7: missing host lane fails closed with a dedicated finding (TCF-027)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig(),
    // @ts-expect-error — lane omission must be a type error; runtime check still fails closed
    { resolveRootPath: fakeResolver() },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-027');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.host-lane-missing');
  assert.equal(report.configuration, undefined);
});

test('F7: non-string host lane fails closed (TCF-027)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig(),
    // @ts-expect-error — lane must be a string; runtime check still fails closed
    { hostLane: 42, resolveRootPath: fakeResolver() },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-027');
});

test('F7: empty host lane fails closed (TCF-027)', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: '' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-027');
});

test('F7: unsupported host lanes fail closed before identity (TCF-028)', () => {
  // Wrong architecture, Windows-style, macOS, non-POSIX, and future lanes.
  for (const lane of [
    'linux-arm64-posix-utf8-node22',
    'linux-x86_64-posix-utf8-node20',
    'windows-x64-win32-utf16-node22',
    'macos-arm64-posix-utf8-node22',
    'darwin-x86_64-posix-utf8-node22',
    'linux-x86_64-nonposix-utf8-node22',
    'linux-x86_64-posix-utf8-node22-beta',
    'trusted-lane-v2',
    'linux-x86_64-posix-utf8-node22 ',
    ' LINUX-X86_64-POSIX-UTF8-NODE22',
  ]) {
    const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane }));
    assert.equal(report.ok, false, lane);
    assert.equal(report.findings[0]!.code, 'TCF-028', lane);
    assert.equal(report.findings[0]!.messageKey, 'trusted-config.host-lane-unsupported', lane);
    assert.equal(report.configuration, undefined, lane);
  }
});

test('F7: no host-lane inference from input fields', () => {
  // A hostLane field inside the input object is an unknown field, never an
  // inferred operand (the lane comes from options only).
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ hostLane: TRUSTED_HOST_LANE }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
});

test('F7: accepted lane is bound into identity bytes', () => {
  const cfg = validateTrustedWorkspaceConfiguration(validConfig(), validOptions()).configuration!;
  const utf8 = computeTrustedConfigurationIdentity(cfg).canonicalUtf8;
  assert.ok(utf8.includes(`"hostLane":"${TRUSTED_HOST_LANE}"`));
  // The lane constant is part of the canonical projection.
  const proj = computeTrustedConfigurationIdentity(cfg).projection as Record<string, unknown>;
  assert.equal(proj['hostLane'], TRUSTED_HOST_LANE);
});

test('F7: unsupported lanes fail before any input handling', () => {
  // Even hostile input cannot change the outcome: the lane is checked first.
  const hostile = validConfig();
  (hostile as Record<string, unknown>)['self'] = hostile; // cyclic input
  const report = validateTrustedWorkspaceConfiguration(hostile, validOptions({ hostLane: 'windows-x64-win32-utf16-node22' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-028');
});

test('F7: resolver contract is interpreted under the accepted lane', () => {
  // Under the accepted lane the resolver is the host-boundary operand; a
  // resolver failure still fails closed (TCF-008).
  const resolver = fakeResolver({}, new Set(['/srv/gateway/broken']));
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/broken' }] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-008');
});
