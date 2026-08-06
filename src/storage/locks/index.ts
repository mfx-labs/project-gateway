/**
 * WP-8-D locks module barrel (private to the repository). Exports the lock
 * functions and the record builder. No creator is re-exported; the lock
 * module is fs-bearing and its exports never include filesystem API names.
 */
export {
  LOCK_RECORD_MAX_BYTES,
  LOCK_VERSION,
  STORAGE_LOCK_ACTION_DIGEST_DOMAIN,
  acquireWriterLock,
  buildLockRecord,
  canonicalLockRecordBytes,
  probeWriterLock,
  releaseWriterLock,
} from './lock.js';
export type { LockHooks } from './lock.js';
