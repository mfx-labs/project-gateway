/**
 * WP-8-B layout module barrel: pure, version-bound relative-path derivation.
 */
export {
  AUDIT_SUFFIX,
  COMPONENT_LENGTH,
  FILENAME_LENGTH,
  PATH_BYTES_DEFAULT,
  PATH_BYTES_MAX,
  PATH_COMPONENT_BYTES_DEFAULT,
  PATH_COMPONENT_BYTES_MAX,
  RECORD_SUFFIX,
  SHARD_WIDTH,
  STORE_METADATA_RELATIVE_PATH,
  TEMPORARY_SUFFIX,
  WRITER_LOCK_RELATIVE_PATH,
  deriveRecordRelativePath,
  filenameWithinComponentBound,
  isDerivedRelativePath,
  relativePathWithinBound,
} from './layout.js';
export type { LayoutDerivationResult, LayoutRejectReason } from './layout.js';
