/**
 * Shared test fixtures for WP-6 Phase 1 trusted-configuration tests.
 * Returns fresh plain objects per call so hostile-mutation tests are isolated.
 *
 * `validOptions` supplies the mandatory trusted caller operands (corrections
 * F-2/F-7): the accepted host lane and a deterministic identity root
 * resolver. Tests that exercise host resolution override `resolveRootPath`
 * with a targeted resolver.
 */
import {
  TRUSTED_HOST_LANE,
} from '../../src/trusted/index.js';
import type {
  TrustedConfigurationValidationOptions,
  RootPathResolver,
} from '../../src/trusted/index.js';

export function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configurationVersion: '1',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
    ],
    ...overrides,
  };
}

export function validWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', ...overrides };
}

/** Fake root resolver: simulates symlink resolution on a small map. */
export function fakeResolver(map: Record<string, string> = {}, fail: ReadonlySet<string> = new Set()): RootPathResolver {
  return (p: string) => {
    if (fail.has(p)) return null;
    const target = map[p];
    return target !== undefined ? target : p;
  };
}

/** Mandatory trusted validation options for tests: accepted lane + identity resolver. */
export function validOptions(
  overrides: Partial<TrustedConfigurationValidationOptions> = {},
): TrustedConfigurationValidationOptions {
  return {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: fakeResolver(),
    ...overrides,
  };
}
