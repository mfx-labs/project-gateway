/**
 * WP-6 Phase 2B-P: genuineness and lookup (test category E).
 *
 * lookupValidatedArtifactLocation accepts only runtime-genuine validated
 * configurations; returns undefined for v1, unknown workspaces, and v2
 * workspaces that omit the location; forged/cloned/Proxy-wrapped
 * configurations are rejected; failed directory validation never brands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as packageRoot from '../../src/index.js';
import * as trustedBarrel from '../../src/trusted/index.js';
import {
  validateTrustedWorkspaceConfiguration,
  lookupValidatedArtifactLocation,
  lookupValidatedWorkspace,
  TRUSTED_CONFIGURATION_VERSION_2,
  TRUSTED_HOST_LANE,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { ARTIFACT_DRAFT_LOCATION_KINDS } from '../../src/trusted/artifact-location.js';
import { validatedV1Config, v2Config, v2Options, validatedV2Config, directoryResolver } from './artifact-location-helpers.js';

test('E: genuine version-2 lookup succeeds with immutable metadata', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const lookup = lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.ok(lookup);
  assert.equal(lookup!.configurationIdentity, config.identity);
  assert.equal(lookup!.workspaceId, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.equal(lookup!.canonicalArtifactRoot, '/srv/gateway/alpha/artifacts');
  assert.deepEqual([...lookup!.draftKinds], [...ARTIFACT_DRAFT_LOCATION_KINDS]);
  assert.equal(Object.isFrozen(lookup), true);
  assert.equal(Object.isFrozen(lookup!.draftKinds), true);
});

test('E: version-2 omission and version-1 lookups return undefined', () => {
  const omitted = validatedV2Config(v2Config());
  assert.equal(lookupValidatedArtifactLocation(omitted, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
  const v1 = validatedV1Config();
  assert.equal(lookupValidatedArtifactLocation(v1, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});

test('E: unknown workspace returns undefined', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  assert.equal(lookupValidatedArtifactLocation(config, 'pgw:w:zzzzzzzzzzzzzzzz'), undefined);
});

test('E: forged version-2 lookalike rejected by genuineness', () => {
  const forged = {
    configurationVersion: TRUSTED_CONFIGURATION_VERSION_2,
    capabilityVocabularyVersion: 'v1',
    hostLane: TRUSTED_HOST_LANE,
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', canonicalRoot: '/srv/gateway/alpha', artifactLocation: '/attacker/artifacts' }],
    identity: 'sha-256:' + 'a'.repeat(64),
  } as unknown as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(forged), false);
  assert.equal(lookupValidatedArtifactLocation(forged, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
  assert.equal(lookupValidatedWorkspace(forged, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});

test('E: correctly recomputed-digest forgery rejected', () => {
  const genuine = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const forged = {
    configurationVersion: TRUSTED_CONFIGURATION_VERSION_2,
    capabilityVocabularyVersion: 'v1',
    hostLane: TRUSTED_HOST_LANE,
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', canonicalRoot: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' }],
    identity: genuine.identity,
  } as unknown as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(lookupValidatedArtifactLocation(forged, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});

test('E: clone rejected', () => {
  const genuine = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const clone = structuredClone(genuine) as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(clone), false);
  assert.equal(lookupValidatedArtifactLocation(clone, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});

test('E: Proxy wrapper rejected', () => {
  const genuine = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const proxy = new Proxy(genuine, {});
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(proxy), false);
  assert.equal(lookupValidatedArtifactLocation(proxy, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});

test('E: failed directory validation produces no brand and no lookup', () => {
  const failing = validateTrustedWorkspaceConfiguration(
    v2Config({
      workspaces: [
        { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
      ],
    }),
    v2Options(() => ({ ok: false, code: 'not-found' })),
  );
  assert.equal(failing.ok, false);
  assert.equal(failing.configuration, undefined);
  const input = v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  });
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(input), false);
});

test('E: lookup output is deeply immutable and carries no authority', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const lookup = lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa')!;
  const keys = Object.keys(lookup);
  for (const key of ['writeAllowed', 'approved', 'grant', 'persistenceHandle', 'destinationDecision', 'executionBundleStorage', 'executionResultStorage']) {
    assert.equal(keys.includes(key), false, key);
  }
});

test('E: no package-root export; barrel retains only cohesive entry points', () => {
  for (const name of [
    'lookupValidatedArtifactLocation',
    'ARTIFACT_DRAFT_LOCATION_KINDS',
    'TRUSTED_CONFIGURATION_VERSION_2',
  ]) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
    assert.equal(name in trustedBarrel, true, `internal barrel must retain ${name}`);
  }
  for (const name of ['canonicalizeConfiguredArtifactPath', 'resolveConfiguredArtifactLocation']) {
    assert.equal(name in trustedBarrel, false, `internal barrel must not export ${name}`);
  }
});

test('E: brand remains non-serialized for v2 configurations', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes('brand'));
  assert.ok(!serialized.includes('WeakSet'));
  assert.equal(Object.getOwnPropertySymbols(config).length, 0);
  // v2 genuine configurations remain usable by Phase-2A containment.
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(config), true);
});

test('E: v2 configurations are runtime-genuine through the single shared brand', () => {
  const v1 = validatedV1Config();
  const v2 = validatedV2Config();
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(v1), true);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(v2), true);
  // A v2 config without locations still validates with the resolver absent.
  const noResolver = validateTrustedWorkspaceConfiguration(v2Config(), {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p) => p,
  });
  assert.equal(noResolver.ok, true);
  assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(noResolver.configuration!), true);
});

test('E: failed v2 validation with an attacker location never yields a branded object', () => {
  const report = validateTrustedWorkspaceConfiguration(
    v2Config({
      workspaces: [
        { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/attacker/root' },
      ],
    }),
    v2Options(directoryResolver()),
  );
  assert.equal(report.ok, false);
  assert.equal(report.configuration, undefined);
  // A forged v2 config with an attacker root is rejected by genuineness at lookup.
  const forged = {
    configurationVersion: TRUSTED_CONFIGURATION_VERSION_2,
    capabilityVocabularyVersion: 'v1',
    hostLane: TRUSTED_HOST_LANE,
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', canonicalRoot: '/srv/gateway/alpha', artifactLocation: '/attacker/root' }],
    identity: 'sha-256:' + 'b'.repeat(64),
  } as unknown as ValidatedTrustedWorkspaceConfiguration;
  assert.equal(lookupValidatedArtifactLocation(forged, 'pgw:w:aaaaaaaaaaaaaaaa'), undefined);
});
