/**
 * Deterministic trusted-configuration identity (WP-6 Phase 1).
 *
 * One deterministic identity binds the complete validated
 * TrustedWorkspaceConfiguration: configuration version, capability-vocabulary
 * version, accepted trusted host lane, provenance, canonical global ceilings,
 * canonical workspace records (workspace identity + canonical root identity +
 * workspace ceilings), and the trustedExtensionSet.
 *
 * Algorithm:
 * 1. build a fixed-shape canonical projection (explicit omission rules:
 *    absent optional fields are omitted; explicitly empty arrays are
 *    retained, so omission and explicit empty are distinct);
 * 2. serialize with the repository RFC 8785 canonical serializer
 *    (`jcsSerialize`), which is deterministic (sorted keys, canonical
 *    numbers, shortest string escapes) and produces UTF-8 bytes;
 * 3. SHA-256 over the domain prefix `PGAP-TRUSTED-CONFIG-v1\0` followed by
 *    the canonical UTF-8 bytes, formatted as `sha-256:<hex>` per repository
 *    digest convention.
 *
 * Workspace records are ordered canonically by workspace identity using one
 * locale-independent code-unit comparator (correction F-3); input
 * registration order is non-semantic for the identity, and the ordering is
 * identical across environments and implementations. The public identity
 * representation is the digest string only; canonical bytes stay local to
 * identity computation (correction F-5) and no machine-specific root or
 * path is disclosed through the digest.
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../canonical/jcs.js';
import { compareStrings } from './ordering.js';
import type { ValidatedTrustedWorkspaceConfiguration } from './types.js';

export const TRUSTED_CONFIG_DIGEST_DOMAIN = 'PGAP-TRUSTED-CONFIG-v1\u0000';

export const TRUSTED_CONFIG_DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;

export interface TrustedConfigurationIdentity {
  /** Canonical projection (fixed shape, omission rules applied). */
  readonly projection: Readonly<Record<string, unknown>>;
  /** Canonical UTF-8 serialization (deterministic bytes). */
  readonly canonicalUtf8: string;
  /** Domain-separated SHA-256 digest. */
  readonly digest: string;
}

function computeDigest(canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(TRUSTED_CONFIG_DIGEST_DOMAIN, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

function workspaceProjection(workspace: ValidatedTrustedWorkspaceConfiguration['workspaces'][number]): Record<string, unknown> {
  const out: Record<string, unknown> = { workspaceId: workspace.workspaceId, canonicalRoot: workspace.canonicalRoot };
  if (workspace.capabilities !== undefined) out['capabilities'] = [...workspace.capabilities];
  if (workspace.actionCeiling !== undefined) out['actionCeiling'] = workspace.actionCeiling;
  // Version-2 artifact location: presence-aware; version-1 records never
  // carry it, so the version-1 projection remains byte-identical.
  if (workspace.artifactLocation !== undefined) out['artifactLocation'] = workspace.artifactLocation;
  return out;
}

/** Build the canonical projection for a validated configuration. */
export function trustedConfigurationProjection(
  configuration: ValidatedTrustedWorkspaceConfiguration,
): Record<string, unknown> {
  const projection: Record<string, unknown> = {
    configurationVersion: configuration.configurationVersion,
    capabilityVocabularyVersion: configuration.capabilityVocabularyVersion,
    hostLane: configuration.hostLane,
    provenance: { sourceKind: configuration.provenance.sourceKind },
  };
  if (configuration.globalCapabilityCeiling !== undefined) {
    const ceiling: Record<string, unknown> = {};
    if (configuration.globalCapabilityCeiling.capabilities !== undefined) {
      ceiling['capabilities'] = [...configuration.globalCapabilityCeiling.capabilities];
    }
    projection['globalCapabilityCeiling'] = ceiling;
  }
  if (configuration.globalActionCeiling !== undefined) {
    projection['globalActionCeiling'] = configuration.globalActionCeiling;
  }
  if (configuration.trustedExtensionSet !== undefined) {
    const set = configuration.trustedExtensionSet;
    projection['trustedExtensionSet'] = {
      version: set.version,
      permittedExtensionIds: [...set.permittedExtensionIds],
      supportedBuiltinToolIds: [...set.supportedBuiltinToolIds],
      trustedWebAccess: set.trustedWebAccess.map((e) => ({ packageId: e.packageId, version: e.version })),
      expectedToolSources: set.expectedToolSources.map((s) => ({ toolName: s.toolName, packageId: s.packageId, scope: s.scope })),
    };
  }
  projection['workspaces'] = [...configuration.workspaces]
    .map((w) => workspaceProjection(w))
    .sort((a, b) => compareStrings(a['workspaceId'] as string, b['workspaceId'] as string));
  return projection;
}

/** Compute the deterministic identity of a validated configuration. */
export function computeTrustedConfigurationIdentity(
  configuration: ValidatedTrustedWorkspaceConfiguration,
): TrustedConfigurationIdentity {
  const projection = trustedConfigurationProjection(configuration);
  const canonicalUtf8 = jcsSerialize(projection);
  const digest = computeDigest(canonicalUtf8);
  return { projection, canonicalUtf8, digest };
}
