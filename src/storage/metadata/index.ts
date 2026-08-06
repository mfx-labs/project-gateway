/**
 * WP-8-C metadata module barrel (private to the repository).
 */
export { buildStoreMetadata, verifyMetadataModel, METADATA_FORMAT_VERSION, METADATA_MAX_BYTES, METADATA_RECORD_FORMAT_VERSION, METADATA_RECORD_KIND } from './store-metadata.js';
export type { MetadataBuildResult, StoreMetadataEnvelope, StoreMetadataExpectation } from './store-metadata.js';
export { persistMetadata, replayMetadata, writeAllSync } from './bootstrap-persist.js';
export type { PersistResult, ReplayResult } from './bootstrap-persist.js';
