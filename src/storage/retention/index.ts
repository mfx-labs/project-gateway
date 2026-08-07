/**
 * WP-8-L retention module barrel (private to the repository). Exports the
 * authorized retention-mutation composition boundary, the exact unlink
 * owner's re-verification helpers, and the pure evidence builders. No
 * capability creator, provenance creator, permit creator, or mutation
 * primitive is re-exported (their exact import edges are enforced by the
 * static guard). Retention authority is a distinct private domain from
 * recovery authority; nothing here can be reached by a recovery capability.
 */
export { executeRetentionMutation, RETENTION_DELETABLE_RECORD_CLASSES } from './execute.js';
export type { RetentionMutationRequest, RetentionMutationResult } from '../types.js';
export {
  computeRetentionHoldStateGeneration,
  retentionHistoryBindingDigest,
  buildRetentionRecordIntentEvidence,
  buildRetentionAuditIntentEvidence,
  buildRetentionRecordCompletionEvidence,
  buildRetentionAuditCompletionEvidence,
  computeRetentionRecordIntentIdentity,
  computeRetentionAuditIntentIdentity,
  computeRetentionRecordCompletionIdentity,
  computeRetentionAuditCompletionIdentity,
  verifyExistingRetentionRecordIntent,
  verifyExistingRetentionAuditIntent,
  verifyExistingRetentionRecordCompletion,
  verifyExistingRetentionAuditCompletion,
  readRetentionEvidencePayload,
  publishRetentionEvidence,
  verifyRetentionEvidenceDurability,
  STORAGE_RETENTION_RECORD_DELETE_INTENT_DOMAIN,
  STORAGE_RETENTION_AUDIT_DELETE_INTENT_DOMAIN,
  STORAGE_RETENTION_RECORD_DELETE_COMPLETION_DOMAIN,
  STORAGE_RETENTION_AUDIT_DELETE_COMPLETION_DOMAIN,
  STORAGE_RETENTION_HOLD_STATE_GENERATION_DOMAIN,
  STORAGE_RETENTION_HISTORY_BINDING_DOMAIN,
} from './evidence.js';
export type { RetentionEvidenceBuild, RetentionEvidencePublishResult } from './evidence.js';
