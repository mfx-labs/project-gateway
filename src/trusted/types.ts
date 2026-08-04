/**
 * Trusted-local configuration model (WP-6 Phase 1).
 *
 * `TrustedWorkspaceConfiguration` is explicitly classified (F-EL4) as:
 * - a trusted-local control-plane configuration object;
 * - repository-external;
 * - schema-governed / type-governed within the local gateway implementation;
 * - prospective configuration input.
 *
 * It is NOT one of the six Artifact Core aggregates, NOT an artifact kind, NOT
 * a lifecycle record, approval record, RuntimeGrant, ExecutionResult, or
 * TrustedReceipt. No seventh aggregate, new artifact kind, or WP-3 aggregate
 * schema-catalog entry is introduced here; any machine-readable schema for
 * this object remains a local configuration schema outside the aggregate
 * catalog.
 *
 * Validated outputs are deeply immutable; public identifiers never disclose
 * workspace roots.
 */
import type {
  ValidatedTrustedConfigurationProvenance,
} from './provenance.js';
import type {
  ValidatedTrustedExtensionSet,
} from './extension-set.js';
import type { RootPathResolver } from './roots.js';
import type { TRUSTED_HOST_LANE } from './host-lane.js';

/** Accepted trusted-configuration version (canonical, single representation). */
export const TRUSTED_CONFIGURATION_VERSION = '1';

/** Input model: caller-supplied runtime object, captured via descriptor snapshot. */
export interface TrustedWorkspaceConfigurationInput {
  readonly configurationVersion: string;
  readonly capabilityVocabularyVersion: string;
  readonly provenance: TrustedConfigurationProvenanceInput;
  readonly globalCapabilityCeiling?: { readonly capabilities?: readonly string[] };
  readonly globalActionCeiling?: number;
  readonly trustedExtensionSet?: TrustedExtensionSetInput;
  readonly workspaces: readonly TrustedWorkspaceInput[];
}

export interface TrustedConfigurationProvenanceInput {
  readonly sourceKind: string;
}

export interface TrustedWorkspaceInput {
  readonly workspaceId: string;
  readonly root: string;
  /** Optional per-record version; when present it must equal the top-level version (mixed-version rule). */
  readonly recordVersion?: string;
  /** Workspace capability ceiling (canonical set). */
  readonly capabilities?: readonly string[];
  /** Workspace numeric action ceiling. */
  readonly actionCeiling?: number;
}

export interface TrustedExtensionSetInput {
  readonly version: string;
  readonly permittedExtensionIds?: readonly string[];
  readonly supportedBuiltinToolIds?: readonly string[];
  readonly trustedWebAccess?: readonly { readonly packageId: string; readonly version: string }[];
  readonly expectedToolSources?: readonly {
    readonly toolName: string;
    readonly packageId: string;
    readonly scope: string;
  }[];
}

/** Options for trusted configuration validation. */
export interface TrustedConfigurationValidationOptions {
  /**
   * Explicit trusted host-lane compatibility operand (F-EL3, correction F-7).
   * Required: only the accepted lane identifier can produce a validated
   * configuration; missing or unsupported lanes fail closed. The core never
   * ambiently probes the host.
   */
  readonly hostLane: string;
  /**
   * Required read-only resolver for canonicalizing existing workspace roots
   * (symlink resolution). The production caller supplies a host-boundary
   * resolver outside the I/O-free core. Missing resolver fails closed;
   * no lexical-only input may produce a validated configuration, and
   * duplicate/overlap evaluation always uses resolved canonical roots.
   */
  readonly resolveRootPath: RootPathResolver;
}

/** Validated workspace record: deeply immutable, contains no authority semantics. */
export interface ValidatedWorkspaceRecord {
  readonly workspaceId: string;
  /**
   * Trusted-process-internal canonical root (lexically normalized and
   * symlink-resolved via the mandatory injected resolver). Raw canonical
   * roots are trusted-process internal data (correction F-5): never exposed
   * through the package root API, public identity, findings, or any
   * user-facing/MCP/ChatGPT projection; external projections use the opaque
   * workspace identity only.
   */
  readonly canonicalRoot: string;
  /** Present only when declared; canonical sorted set. */
  readonly capabilities?: readonly string[];
  /** Present only when declared. */
  readonly actionCeiling?: number;
}

/**
 * Validated global capability ceiling. Presence-aware: `capabilities` is
 * present only when the input declared it. A declared ceiling with absent
 * capabilities is preserved as absent (semantically "empty set = deny all" in
 * later phases); omission and explicit empty are distinct and both are bound
 * into the configuration identity.
 */
export interface ValidatedGlobalCapabilityCeiling {
  readonly capabilities?: readonly string[];
}

/** Validated trusted-local control-plane configuration object. */
export interface ValidatedTrustedWorkspaceConfiguration {
  readonly configurationVersion: typeof TRUSTED_CONFIGURATION_VERSION;
  readonly capabilityVocabularyVersion: string;
  /** Accepted trusted host-lane operand (identity-bound). */
  readonly hostLane: typeof TRUSTED_HOST_LANE;
  readonly provenance: ValidatedTrustedConfigurationProvenance;
  /** Present only when declared (omission vs explicit empty is preserved). */
  readonly globalCapabilityCeiling?: ValidatedGlobalCapabilityCeiling;
  /** Present only when declared. */
  readonly globalActionCeiling?: number;
  /** Present only when declared. */
  readonly trustedExtensionSet?: ValidatedTrustedExtensionSet;
  /** Canonically ordered workspace records (sorted by workspace identity). */
  readonly workspaces: readonly ValidatedWorkspaceRecord[];
  /** Deterministic configuration identity (`sha-256:<hex>`). */
  readonly identity: string;
}
