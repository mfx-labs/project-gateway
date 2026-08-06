/**
 * WP-8-C trusted-input module barrel (private to the repository).
 * Exports types and the genuineness verifiers only. The creators are NOT
 * re-exported here: the action-provenance creator is reserved for the future
 * `src/control-plane/storage-bootstrap-action.ts` consumer and the
 * trusted-input creator for `src/storage/initialization/initialize.ts`
 * (both edges enforced by the static guard).
 */
export type {
  StorageBootstrapActionProvenance,
  TrustedInputRejectionReason,
  TrustedInputResult,
  TrustedStorageBootstrapInput,
} from './bootstrap-input.js';
export {
  isGenuineStorageBootstrapActionProvenance,
  isGenuineTrustedStorageBootstrapInput,
} from './bootstrap-input.js';
