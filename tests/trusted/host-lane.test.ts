/**
 * WP-6 Phase 1 correction F-7 / PS-6 closed accepted-lane set:
 * explicit trusted host-lane operand.
 *
 * Validation requires an explicit trusted host-lane compatibility operand;
 * the core never ambiently probes the host (no process, environment, path,
 * or runtime global reads); only an accepted lane identifier can produce a
 * validated configuration, and the accepted lane is bound into the
 * configuration identity. PS-6 closes the accepted set to exactly
 * `linux-x86_64-posix-utf8-node22` and `darwin-arm64-posix-utf8-node22`;
 * macOS Intel, any `macos-*` spelling, Windows, and unknown lanes fail
 * closed (ADR-042).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  TRUSTED_HOST_LANE,
  DARWIN_ARM64_HOST_LANE,
  ACCEPTED_HOST_LANES,
  isSupportedHostLane,
  trustedHostLaneForPlatformArch,
} from '../../src/trusted/index.js';
import { validConfig, fakeResolver, validOptions } from './helpers.js';

test('PS6/F7: the closed accepted-lane set is exactly linux x86_64 + darwin arm64', () => {
  assert.deepEqual([...ACCEPTED_HOST_LANES], [TRUSTED_HOST_LANE, DARWIN_ARM64_HOST_LANE]);
  assert.equal(isSupportedHostLane(TRUSTED_HOST_LANE), true);
  assert.equal(isSupportedHostLane(DARWIN_ARM64_HOST_LANE), true);
});

test('PS6/F7: both accepted lanes validate and the validated configuration retains the ACTUAL lane operand', () => {
  for (const lane of ACCEPTED_HOST_LANES) {
    const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane }));
    assert.equal(report.ok, true, lane);
    // The validated configuration must carry the validated operand — never
    // a hardcoded Linux value (PS-6 corrected the constant stamp).
    assert.equal(report.configuration!.hostLane, lane, lane);
  }
});

test('PS6/F7: missing host lane fails closed with a dedicated finding (TCF-027)', () => {
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

test('PS6/F7: unsupported host lanes fail closed before identity (TCF-028)', () => {
  // macOS Intel, the rejected `macos-*` spelling, Windows, wrong arch /
  // node / non-POSIX, future, and malformed lanes.
  for (const lane of [
    'macos-arm64-posix-utf8-node22',
    'darwin-x86_64-posix-utf8-node22',
    'darwin-arm64-posix-utf8-node20',
    'darwin-arm64-nonposix-utf8-node22',
    'linux-arm64-posix-utf8-node22',
    'linux-x86_64-posix-utf8-node20',
    'windows-x64-win32-utf16-node22',
    'linux-x86_64-nonposix-utf8-node22',
    'linux-x86_64-posix-utf8-node22-beta',
    'trusted-lane-v2',
    'linux-x86_64-posix-utf8-node22 ',
    ' LINUX-X86_64-POSIX-UTF8-NODE22',
    'DARWIN-ARM64-POSIX-UTF8-NODE22',
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

test('PS6/F7: the accepted lane is bound into identity bytes (both lanes)', () => {
  for (const lane of ACCEPTED_HOST_LANES) {
    const cfg = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane })).configuration!;
    const utf8 = computeTrustedConfigurationIdentity(cfg).canonicalUtf8;
    assert.ok(utf8.includes(`"hostLane":"${lane}"`), lane);
    // The lane constant is part of the canonical projection.
    const proj = computeTrustedConfigurationIdentity(cfg).projection as Record<string, unknown>;
    assert.equal(proj['hostLane'], lane);
  }
});

test('PS6/F7: identity differs across the linux and darwin-arm64 lanes for otherwise identical inputs', () => {
  const linux = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: TRUSTED_HOST_LANE })).configuration!;
  const darwin = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_ARM64_HOST_LANE })).configuration!;
  const linuxIdentity = computeTrustedConfigurationIdentity(linux);
  const darwinIdentity = computeTrustedConfigurationIdentity(darwin);
  assert.notEqual(linuxIdentity.digest, darwinIdentity.digest);
  assert.equal(linux.identity, linuxIdentity.digest);
  assert.equal(darwin.identity, darwinIdentity.digest);
});

test('PS6: the shared platform/arch → lane mapping is the one derivation for bootstrap AND runtime', () => {
  // The mapping is pure and shared; the CLI boundary supplies the observed
  // platform/arch exactly once. Supported mappings only.
  assert.equal(trustedHostLaneForPlatformArch('linux', 'x64'), TRUSTED_HOST_LANE);
  assert.equal(trustedHostLaneForPlatformArch('darwin', 'arm64'), DARWIN_ARM64_HOST_LANE);
  // Everything else fails closed as unsupported: macOS Intel, Windows,
  // unknown platforms/arches.
  assert.equal(trustedHostLaneForPlatformArch('darwin', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('linux', 'arm64'), null);
  assert.equal(trustedHostLaneForPlatformArch('win32', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('darwin', ''), null);
  assert.equal(trustedHostLaneForPlatformArch('freebsd', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('', ''), null);
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
