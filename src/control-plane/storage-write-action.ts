/**
 * WP-12 Slice 1 — control-plane storage write-action provenance producer.
 *
 * The WP-8-D contract names this module as the sole future production
 * consumer of `createStorageWriteActionProvenance` (see
 * `src/storage/trusted-input/bootstrap-input.ts` and the storage static
 * guard's creator-consumer edges). WP-12 Slice 1 is the trusted control
 * plane: the HOST supplies the write-action fields (action identity,
 * locator, service UID, forbidden roots, configuration identity, limit
 * profile) as trusted context; this module mints the genuine branded
 * provenance consumed unchanged by `publishRecord`. No request operand can
 * reach these fields.
 *
 * No authority is created here: the branded provenance only carries
 * correlated host-owned facts into the accepted WP-8 gate
 * (`createTrustedWriteRequest`).
 */
import { createStorageWriteActionProvenance } from '../storage/trusted-input/bootstrap-input.js';
import type { StorageWriteActionProvenance } from '../storage/trusted-input/bootstrap-input.js';

export type { StorageWriteActionProvenance } from '../storage/trusted-input/bootstrap-input.js';

/**
 * Mint the genuine storage write-action provenance from host-owned fields.
 * Throws on invalid fields exactly as the accepted creator does; the
 * store-boundary adapter treats a throw as a host-composition failure.
 */
export function createControlPlaneWriteAction(fields: StorageWriteActionProvenance): StorageWriteActionProvenance {
  return createStorageWriteActionProvenance(fields);
}
