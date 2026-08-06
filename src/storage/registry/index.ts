/**
 * WP-8-E registry module barrel (private to the repository). Exports the
 * registry-view composition boundary, the pure classifier, and the pure
 * derivation. FILESYSTEM-FREE: no filesystem API import appears in this barrel or
 * in the pure modules; the read-only store scan lives in the recovery
 * module (`src/storage/recovery/scan.ts`). No capability creator is
 * re-exported; no recovery-operation export exists here.
 */
export { deriveRegistryView } from './compose.js';
export type { RegistryViewRequest, RegistryViewResult } from '../types.js';
export { classifyCandidate, extractEnvelopeFacts, isSupportedRecordFormatVersion, SUPPORTED_RECORD_FORMAT_VERSIONS } from './classify.js';
export type { CandidateFacts, CandidateClassification } from './classify.js';
export {
  auditAssociation,
  contentVerifiedRecords,
  deriveRegistryViewFromScan,
  finalizeSnapshotClassifications,
  verifiedAuditEventViews,
  verifiedRecordViews,
} from './derive.js';
export type { AuditAssociationResult, FinalizedSnapshot } from './derive.js';
