/**
 * Shared fixtures for WP-6 Phase 2B-P artifact-location tests.
 * Returns fresh plain objects per call so hostile-mutation tests are isolated.
 */
import {
  validateTrustedWorkspaceConfiguration,
  TRUSTED_CONFIGURATION_VERSION_2,
  TRUSTED_HOST_LANE,
  type ArtifactLocationResolution,
  type ArtifactLocationResolver,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { validConfig, validOptions } from './helpers.js';

/** A validated version-1 configuration (Phase-1 fixtures). */
export function validatedV1Config(): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  if (!report.ok) throw new Error('fixture v1 configuration invalid');
  return report.configuration!;
}

/** Version-2 configuration input: v1 shape plus optional per-workspace artifactLocation. */
export function v2Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configurationVersion: TRUSTED_CONFIGURATION_VERSION_2,
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha' },
      { workspaceId: 'pgw:w:bbbbbbbbbbbbbbbb', root: '/srv/gateway/beta' },
    ],
    ...overrides,
  };
}

/** Version-2 options: host lane + identity root resolver + artifact-location resolver. */
export function v2Options(
  artifactResolver: ArtifactLocationResolver = directoryResolver(),
): { hostLane: string; resolveRootPath: (p: string) => string; resolveArtifactLocation: ArtifactLocationResolver } {
  return {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p) => p,
    resolveArtifactLocation: artifactResolver,
  };
}

/** Validate a version-2 configuration with the standard directory resolver. */
export function validatedV2Config(
  input: Record<string, unknown> = v2Config(),
  artifactResolver: ArtifactLocationResolver = directoryResolver(),
): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(input, v2Options(artifactResolver));
  if (!report.ok) {
    throw new Error(`fixture v2 configuration invalid: ${report.findings.map((f) => `${f.code}:${f.messageKey}`).join(',')}`);
  }
  return report.configuration!;
}

export const ARTIFACT_DIR_ALPHA = '/srv/gateway/alpha/artifacts';
export const ARTIFACT_DIR_BETA = '/srv/gateway/beta/artifacts';

/** Directory resolver: every path resolves to itself as an existing directory. */
export function directoryResolver(): ArtifactLocationResolver {
  return (p: string): ArtifactLocationResolution => ({ ok: true, canonicalPath: p, entryKind: 'directory' });
}

/** Map-based directory resolver: maps canonical configured paths to resolved canonical directories. */
export function mappingDirectoryResolver(map: Record<string, string>): ArtifactLocationResolver {
  return (p: string): ArtifactLocationResolution => {
    const target = map[p];
    return target !== undefined
      ? { ok: true, canonicalPath: target, entryKind: 'directory' }
      : { ok: true, canonicalPath: p, entryKind: 'directory' };
  };
}

/** Failure resolver: returns the given failure code for every path. */
export function failingResolver(code: ArtifactLocationResolution['ok'] extends true ? never : 'not-found' | 'loop' | 'inaccessible' | 'ambiguous' | 'unsupported-entry-kind' | 'error'): ArtifactLocationResolver {
  return (): ArtifactLocationResolution => ({ ok: false, code });
}

/** Default configured artifact location for the alpha workspace. */
export const CONFIGURED_ALPHA_ARTIFACT_PATH = '/srv/gateway/alpha/artifacts';
