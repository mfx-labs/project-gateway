/**
 * Shared fixtures for WP-6 Phase 2B destination-containment tests.
 * Returns fresh plain objects per call so hostile-mutation tests are isolated.
 */
import {
  validateTrustedWorkspaceConfiguration,
  TRUSTED_HOST_LANE,
  type ProspectiveDestinationResolution,
  type ProspectiveDestinationResolutionFailureCode,
  type ProspectiveDestinationResolutionFailureSubject,
  type ProspectiveDestinationResolutionRequest,
  type ProspectiveDestinationResolver,
  type ProspectiveDestinationTargetState,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { validConfig, validOptions } from './helpers.js';

export const WS_A = 'pgw:w:aaaaaaaaaaaaaaaa';
export const WS_B = 'pgw:w:bbbbbbbbbbbbbbbb';
export const WS_ROOT_A = '/srv/gateway/alpha';
export const WS_ROOT_B = '/srv/gateway/beta';
export const DEST_DIR_A = '/srv/gateway/alpha/artifacts';
export const DEST_DIR_B = '/srv/gateway/beta/artifacts';

/** Version-2 configuration with an artifact location on workspace A. */
export function v2ConfigWithLocation(): Record<string, unknown> {
  return {
    configurationVersion: '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: WS_A, root: WS_ROOT_A, artifactLocation: DEST_DIR_A },
    ],
  };
}

/** Version-2 configuration with artifact locations on both workspaces. */
export function v2ConfigTwoWorkspaces(): Record<string, unknown> {
  return {
    configurationVersion: '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: WS_A, root: WS_ROOT_A, artifactLocation: DEST_DIR_A },
      { workspaceId: WS_B, root: WS_ROOT_B, artifactLocation: DEST_DIR_B },
    ],
  };
}

/** Version-2 configuration with no artifact location at all. */
export function v2ConfigWithoutLocation(): Record<string, unknown> {
  return {
    configurationVersion: '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: WS_A, root: WS_ROOT_A },
    ],
  };
}

/** Standard validated runtime-genuine version-2 configuration (workspace A has a location). */
export function validatedConfig(input: Record<string, unknown> = v2ConfigWithLocation()): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(input, {
    hostLane: TRUSTED_HOST_LANE,
    resolveRootPath: (p) => p,
    resolveArtifactLocation: (p) => ({ ok: true, canonicalPath: p, entryKind: 'directory' }),
  });
  if (!report.ok) throw new Error(`fixture configuration invalid: ${report.findings.map((f) => `${f.code}:${f.messageKey}`).join(',')}`);
  return report.configuration!;
}

/** Validated runtime-genuine version-1 configuration (Phase-1 fixtures). */
export function validatedV1Config(): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions());
  if (!report.ok) throw new Error('fixture v1 configuration invalid');
  return report.configuration!;
}

/** Untrusted destination request correlated to the given validated configuration. */
export function destinationRequest(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    expectedConfigurationIdentity: configuration.identity,
    workspaceId: WS_A,
    artifactKind: 'TaskSpec',
    destination: 'task.json',
    ...overrides,
  };
}

/** Trusted options for the destination evaluator. */
export function destinationOptions(
  configuration: ValidatedTrustedWorkspaceConfiguration,
  resolver: ProspectiveDestinationResolver,
): { configuration: ValidatedTrustedWorkspaceConfiguration; resolveProspectiveDestination: ProspectiveDestinationResolver } {
  return { configuration, resolveProspectiveDestination: resolver };
}

/** Extract validated destination components from the internally derived absolute destination. */
function requestComponents(request: Readonly<ProspectiveDestinationResolutionRequest>): readonly string[] {
  const root = request.canonicalArtifactRoot;
  const absolute = request.absoluteProspectiveDestination;
  if (!absolute.startsWith(`${root}/`)) throw new Error('internal resolver request mismatch');
  return absolute.slice(root.length + 1).split('/');
}

/**
 * Standard Model-B success resolver: current root == configuration root,
 * lexical prefix and canonical ancestor derived per target state. For
 * `missing` the prefix defaults to [] (ancestor = artifact root) and the
 * tail is the full validated component sequence; for existing states the
 * prefix/tail follow the contract (empty tail only for existing-directory).
 */
export function successResolver(
  targetState: ProspectiveDestinationTargetState,
  opts: { readonly prefix?: readonly string[]; readonly ancestor?: string } = {},
): ProspectiveDestinationResolver {
  return (request) => {
    const components = requestComponents(request);
    const prefix = opts.prefix ?? (
      targetState === 'missing' ? [] :
      targetState === 'existing-directory' ? components :
      components.slice(0, -1)
    );
    const tail = targetState === 'missing'
      ? components.slice(prefix.length)
      : targetState === 'existing-directory'
        ? []
        : [components[components.length - 1]!];
    const ancestor = opts.ancestor ?? (
      prefix.length === 0 ? request.canonicalArtifactRoot : `${request.canonicalArtifactRoot}/${prefix.join('/')}`
    );
    return {
      ok: true,
      currentCanonicalArtifactRoot: request.canonicalArtifactRoot,
      artifactRootEntryKind: 'directory',
      lexicalExistingDirectoryPrefixComponents: prefix,
      canonicalExistingDirectoryAncestor: ancestor,
      existingAncestorEntryKind: 'directory',
      destinationTailComponents: tail,
      targetState,
    };
  };
}

/** Alias-aware resolver: the request prefix resolves to an explicit canonical directory. */
export function aliasResolver(
  prefix: readonly string[],
  canonicalAncestor: string,
  targetState: ProspectiveDestinationTargetState = 'missing',
): ProspectiveDestinationResolver {
  return (request) => {
    const components = requestComponents(request);
    const tail = targetState === 'missing'
      ? components.slice(prefix.length)
      : targetState === 'existing-directory'
        ? []
        : [components[components.length - 1]!];
    return {
      ok: true,
      currentCanonicalArtifactRoot: request.canonicalArtifactRoot,
      artifactRootEntryKind: 'directory',
      lexicalExistingDirectoryPrefixComponents: prefix,
      canonicalExistingDirectoryAncestor: canonicalAncestor,
      existingAncestorEntryKind: 'directory',
      destinationTailComponents: tail,
      targetState,
    };
  };
}

/** Subject-aware failure resolver. */
export function failingResolver(
  subject: ProspectiveDestinationResolutionFailureSubject,
  code: ProspectiveDestinationResolutionFailureCode,
): ProspectiveDestinationResolver {
  return () => ({ ok: false, subject, code });
}

/** Fixed-evidence resolver (tests supply the exact evidence object). */
export function evidenceResolver(evidence: ProspectiveDestinationResolution): ProspectiveDestinationResolver {
  return () => evidence;
}

/** Counting wrapper for exact-once assertions. */
export function countingResolver(
  inner: ProspectiveDestinationResolver,
): { readonly resolver: ProspectiveDestinationResolver; readonly calls: () => number } {
  let count = 0;
  return {
    resolver: (request) => {
      count++;
      return inner(request);
    },
    calls: () => count,
  };
}

/** Join validated components into an artifact-relative destination string. */
export function joinParts(parts: readonly string[]): string {
  return parts.join('/');
}
