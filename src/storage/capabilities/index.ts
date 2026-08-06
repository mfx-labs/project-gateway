/**
 * WP-8-C capabilities barrel. Exports only the verifier and types. The
 * creator `createInitializationCapability` is NOT re-exported here: its only
 * consumer is `src/storage/initialization/initialize.ts` (static-guard
 * enforced) and it must not appear in any barrel, the package root, or any
 * local re-export.
 */
export type {
  CapabilityCheck,
  CapabilityRejectionReason,
  InitializationCapability,
  InitializationCapabilityBinding,
  InitializationOperation,
  NamespaceDerivationBinding,
} from './authenticity.js';
export { INITIALIZATION_OPERATION_SET, isGenuineInitializationCapability } from './authenticity.js';
