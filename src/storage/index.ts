/**
 * WP-8-B/WP-8-C/WP-8-D internal storage barrel (private to the repository).
 *
 * PRIVATE TO THE REPOSITORY: `src/storage/**` is not exported from the
 * package root (`src/index.ts` is unchanged), is never registered as an MCP
 * tool or adapter, and exposes no public mutation surface.
 *
 * WP-8-C: this barrel exports the initialization orchestrator and types
 * only. WP-8-D: it additionally exports the publication composition, the
 * lock functions, the read/verify/enumerate compositions, and the audit
 * event builder. The capability creators, the trusted-input creators, and
 * the action-provenance creators are deliberately NOT re-exported here
 * (their exact import edges are enforced by the static guard). Production
 * publication is unreachable: a genuine write-action provenance can only be
 * minted by its creator, which no production module may import.
 */
export * from './types.js';
export * from './format/index.js';
export * from './layout/index.js';
export * from './errors/index.js';
export * from './limits/index.js';
export * from './configuration/index.js';
export * from './root/index.js';
export * from './metadata/index.js';
export * from './probe/index.js';
export * from './trusted-input/index.js';
export * from './capabilities/index.js';
export * from './initialization/index.js';
export * from './publication/index.js';
export * from './locks/index.js';
export * from './read/index.js';
export * from './audit/index.js';
export {
  isGenuineReadCapability,
  isGenuineVerifyCapability,
  isGenuineWriteCapability,
} from './capabilities/authenticity.js';
export {
  isGenuineStorageWriteActionProvenance,
  isGenuineTrustedWriteRequest,
} from './trusted-input/bootstrap-input.js';
export { NAMESPACE_CLASSIFIER_ENTRIES, provisionPhase3TopLevel } from './initialization/provision.js';
export {
  ensureClassShardDirectories,
  publicationTempName,
  publishImmutableRecord,
} from './publication/publish-record.js';
export {
  verifyNamespaceRootIdentity,
  verifyRecordObjectAt,
  verifyStoreInstance,
  verifyStoreMetadataAtPath,
} from './read/read-record.js';
export { enumerateClassByIdentity } from './read/enumerate.js';
export * from './registry/index.js';
export * from './recovery/index.js';
