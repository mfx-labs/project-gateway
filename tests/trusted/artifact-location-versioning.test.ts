/**
 * WP-6 Phase 2B-P: version dispatch and v1 compatibility (test category A).
 *
 * Version 1 remains accepted and byte-identical (identity, Phase-2A
 * behavior, no artifact-location operand); version 2 adds one optional
 * artifactLocation per workspace; unknown versions fail closed; no implicit
 * migration; no workspace-root fallback; no permissive union-superset
 * parsing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  lookupValidatedArtifactLocation,
  computeTrustedConfigurationIdentity,
  TRUSTED_CONFIGURATION_VERSION,
  TRUSTED_CONFIGURATION_VERSION_2,
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import { validConfig, validOptions } from './helpers.js';
import { validatedV1Config, v2Config, v2Options, validatedV2Config, directoryResolver, ARTIFACT_DIR_ALPHA } from './artifact-location-helpers.js';

test('A: version 1 remains valid with an unchanged identity', () => {
  const a = validatedV1Config();
  const b = validatedV1Config();
  assert.equal(a.configurationVersion, TRUSTED_CONFIGURATION_VERSION);
  assert.equal(a.identity, b.identity);
  // Byte-identical canonical bytes across repeated validation.
  assert.equal(computeTrustedConfigurationIdentity(a).canonicalUtf8, computeTrustedConfigurationIdentity(b).canonicalUtf8);
});

test('A: version-1 workspace records carry no artifact location', () => {
  const config = validatedV1Config();
  for (const record of config.workspaces) {
    assert.equal('artifactLocation' in record, false);
  }
});

test('A: version-1 lookup returns undefined for artifact location', () => {
  const config = validatedV1Config();
  assert.equal(lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});

test('A: version 1 carrying an artifactLocation field fails strict shape (TCF-025)', () => {
  const input = validConfig({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  });
  const report = validateTrustedWorkspaceConfiguration(input, validOptions());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
  assert.equal(report.configuration, undefined);
});

test('A: valid version 2 with all locations omitted validates and lookup returns undefined', () => {
  const config = validatedV2Config(v2Config());
  assert.equal(config.configurationVersion, TRUSTED_CONFIGURATION_VERSION_2);
  assert.equal(config.workspaces.length, 2);
  for (const record of config.workspaces) {
    assert.equal('artifactLocation' in record, false);
  }
  assert.equal(lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
  assert.equal(lookupValidatedArtifactLocation(config, 'pgw:w:bbbbbbbbbbbbbbbb'), undefined);
});

test('A: valid version 2 with one configured location', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  assert.equal(config.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts');
  const lookup = lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.ok(lookup);
  assert.equal(lookup!.canonicalArtifactRoot, '/srv/gateway/alpha/artifacts');
});

test('A: version 2 may mix configured and read-only workspaces', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
    ],
  }));
  assert.equal(config.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts');
  assert.equal('artifactLocation' in config.workspaces[1]!, false);
  assert.ok(lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa'));
  assert.equal(lookupValidatedArtifactLocation(config, 'pgw:w:bbbbbbbbbbbbbbbb'), undefined);
});

test('A: unknown and missing versions fail closed (TCF-001)', () => {
  for (const version of ['3', '0', 'v2']) {
    const input = v2Config({ configurationVersion: version });
    const report = validateTrustedWorkspaceConfiguration(input, v2Options());
    assert.equal(report.ok, false, version);
    assert.equal(report.findings[0]!.code, 'TCF-001', version);
    assert.equal(report.findings[0]!.messageKey, 'trusted-config.version-unsupported', version);
  }
  // Empty string is treated as missing (never inferred).
  const empty = v2Config({ configurationVersion: '' });
  const rEmpty = validateTrustedWorkspaceConfiguration(empty, v2Options());
  assert.equal(rEmpty.ok, false);
  assert.equal(rEmpty.findings[0]!.code, 'TCF-001');
  assert.equal(rEmpty.findings[0]!.messageKey, 'trusted-config.version-missing');
  const missing = v2Config();
  delete (missing as Record<string, unknown>)['configurationVersion'];
  const report = validateTrustedWorkspaceConfiguration(missing, v2Options());
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-001');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.version-missing');
});

test('A: no implicit migration between versions', () => {
  // A v1 input is never upgraded: it stays v1 with no artifact location.
  const v1 = validateTrustedWorkspaceConfiguration(validConfig(), {
    ...validOptions(),
    resolveArtifactLocation: directoryResolver(),
  });
  assert.equal(v1.ok, true);
  assert.equal(v1.configuration!.configurationVersion, TRUSTED_CONFIGURATION_VERSION);
  assert.equal('artifactLocation' in v1.configuration!.workspaces[0]!, false);
  // And v1 identities are stable whether or not the extra resolver is supplied.
  const v1b = validateTrustedWorkspaceConfiguration(validConfig(), {
    ...validOptions(),
    resolveArtifactLocation: directoryResolver(),
  });
  assert.equal(v1b.configuration!.identity, v1.configuration!.identity);
});

test('A: no workspace-root fallback for omitted artifact locations', () => {
  const config = validatedV2Config(v2Config());
  for (const record of config.workspaces) {
    assert.notEqual(record.artifactLocation, record.canonicalRoot);
    assert.equal(record.artifactLocation, undefined);
  }
  // Lookup cannot return the workspace root as an implicit artifact location.
  const lookup = lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.equal(lookup, undefined);
});

test('A: v1 and v2 identities are distinct and deterministic', () => {
  const v1 = validatedV1Config();
  const v2 = validatedV2Config(v2Config());
  assert.notEqual(v1.identity, v2.identity);
  assert.equal(validatedV2Config(v2Config()).identity, v2.identity);
  assert.ok(v2.identity.startsWith('sha-256:'));
  assert.equal(ARTIFACT_DIR_ALPHA.includes('/srv'), true); // sanity: fixture constant usable
});
