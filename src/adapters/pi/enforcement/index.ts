/**
 * WP-5B — pi-guard enforcement / activation-evidence integration surface.
 *
 * Deterministic pi-guard compatibility discovery, effective tool-surface
 * observation + normative v1 inventory fingerprint, capability→tool
 * projection, trusted activation/restoration, and `PiEnforcementEvidence`
 * construction (Part B–E). Evidence and enforcement only; never authority.
 */
export * from './types.js';
export {
  computeInventoryFingerprint,
  GOLDEN_VECTOR_DIGEST,
  GOLDEN_VECTOR_ENTRIES,
  compareUtf8Bytes,
  isAcceptedTimestamp,
} from './fingerprint.js';
export { observeEffectiveSurface, surfaceIdentity, resampleMatches } from './surface.js';
export {
  verifyTrustedProjectionApi,
  guardCompatibilityFingerprint,
  GUARD_PROJECTION_SCHEMA,
  GUARD_MODE_SET,
  GUARD_RESERVED_TOOL_IDS,
  GUARD_CONFIG_CONTRACT,
  GUARD_EXTENSION_ENTRY,
} from './compatibility.js';
export { inspectGuardPackage, resolveGuardPackagePath } from './guard-host-harness.js';
export {
  capabilityToProfileKind,
  projectAllowedAndDenied,
  RESEARCH_REQUIRED_TOOLS,
  OPTIONAL_FFF_TOOLS,
  BUILTIN_SOURCE,
} from './projection.js';
export {
  computePlanFingerprint,
  computePlanIdentity,
  computeEffectiveAuthorityIdentity,
  computeConsumerDeclarationIdentity,
  computeEnforcementConfigurationIdentity,
  computeProjectionIdentity,
  buildEvidence,
  computeEvidenceFingerprint,
  canonicalizeEvidence,
  domainDigest,
  type ProjectionIdentityInput,
  type EvidenceFacts,
} from './evidence.js';
export { runTrustedEnforcement, buildTrustedProjection, surfaceStable } from './run.js';
