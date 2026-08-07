/**
 * WP-8-E recovery module barrel (private to the repository). Exports the
 * recovery-scan composition boundary, the fs-bearing scan module (the only
 * new scan owner in the storage tree), and the pure assessment/plan
 * builders. The scan is observation-only; the assessment and plan are
 * advisory data. No capability creator, mutation primitive, or
 * recovery-operation creator is re-exported.
 */
export { runRecoveryScan } from './compose.js';
export type { RecoveryScanRequest, RecoveryScanResult } from '../types.js';
export { computeScanGeneration, scanStoreSnapshot, SCAN_GENERATION_DOMAIN } from './scan.js';
export type { StoreScanInput, StoreScanResult, ScanHooks } from '../types.js';
export { assessRecovery, parseLockRecordFacts } from './assess.js';
export type { LockRecordParseResult } from './assess.js';
export { buildRecoveryPlan } from './plan.js';
// WP-8-F: the authorized recovery-mutation composition boundary (private
// barrel; never a package-root export). No capability or provenance creator
// is re-exported; the plan remains advisory data.
export { executeRecoveryMutation } from './execute.js';
export type { RecoveryMutationRequest, RecoveryMutationResult } from '../types.js';
export { buildQuarantineEvidenceRecord, buildRecoveryEvidenceRecord, computeQuarantineEvidenceIdentity, computeQuarantineTemporaryId, computeRecoveryEvidenceIdentity, isoFromEpochMs, quarantineDestinationDesignation, recoveryEvidencePayload, buildDispositionEvidenceRecord, computeDispositionEvidenceIdentity, verifyExistingDispositionEvidence, dispositionEvidencePayload, STORAGE_QUARANTINE_DISPOSITION_EVIDENCE_IDENTITY_DOMAIN, STORAGE_INDEX_DISPOSITION_EVIDENCE_IDENTITY_DOMAIN, buildLockRecoveryEvidenceRecord, computeLockRecoveryEvidenceIdentity, verifyExistingLockRecoveryEvidence, lockRecoveryEvidencePayload, STORAGE_LOCK_RECOVERY_EVIDENCE_IDENTITY_DOMAIN } from './evidence.js';
export { executeQuarantineTemporary } from './quarantine.js';
export { reverifyQuarantineSource, verifyQuarantineObjectDigest, reverifyReconstructionTarget } from './reverify.js';
export { isPublicationTemporaryName, temporaryObservationId, recordObservationId, auditEventsForRecord, reconstructionEvidenceForTarget, extractReconstructionEvidenceFacts, extractRetentionEvidenceFacts } from './scan.js';
// WP-8-I: the external-disposition adjudication foundation re-verification
// helpers (current-state single-entry classification with the committed
// scanner logic; read-only). No capability or mutation primitive is
// re-exported.
export { currentTemporaryObservation, currentQuarantineObservation, currentIndexObservation, quarantineObservationId, extractDispositionEvidenceFacts } from './scan.js';
// WP-8-J: lock-recovery read-side helpers (current writer-lock
// re-verification, observation identity, evidence-facts extraction). The
// recovery-break guard and unlink primitives are NOT re-exported (they
// live in the lock owner only; no public lock-mutation authority exists).
export { currentLockObservation, lockObservationId, extractLockRecoveryEvidenceFacts } from './scan.js';
// WP-8-M: configuration-namespace observation + classification + evidence
// facts (advisory; never authority). The mutation boundary is exported
// through the recovery-mutation dispatch (executeRecoveryMutation); the
// exact configuration-recovery permit is never re-exported.
export { classifyConfigurationMetadataSurface, classifyConfigurationMetadataState, configurationMetadataObservationId, extractConfigurationRecoveryEvidenceFacts, STORAGE_CONFIGURATION_OBSERVATION_DOMAIN } from './scan.js';
export type { ConfigurationNamespaceObservation } from '../types.js';
// WP-8-G: the audit-reconstruction operation (16.3): pure derivation and
// evidence construction plus the exact-record publication composition. The
// permit creator and verifier are never re-exported.
export {
  buildAuditReconstructionEvidenceRecord,
  computeAuditReconstructionEvidenceIdentity,
  auditReconstructionEvidencePayload,
  publishReconstructedAudit,
  publishAuditReconstructionEvidence,
  isReconstructionTargetClass,
  STORAGE_AUDIT_RECONSTRUCTION_EVIDENCE_IDENTITY_DOMAIN,
} from './reconstruct.js';
export type { RecoveryEvidenceInput, RecoveryEvidenceBuild } from './evidence.js';
export type { DispositionEvidenceInput, DispositionEvidenceIdentityInput } from './evidence.js';
export type { AuditReconstructionEvidenceInput, AuditReconstructionOutcome, ReconstructedAuditPublishResult } from './reconstruct.js';
export { buildRecoveryAuditReconstructionEvent, RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND } from '../audit/write-audit.js';
// WP-8-M: configuration-recovery evidence builders + trusted-input identity.
export {
  computeTrustedInputIdentity,
  buildConfigurationRecoveryEvidenceRecord,
  configurationRecoveryEvidenceIdentityFacts,
  verifyExistingConfigurationRecoveryEvidence,
  verifyRecoveryEvidenceDurability,
  STORAGE_CONFIGURATION_RECOVERY_EVIDENCE_IDENTITY_DOMAIN,
  STORAGE_TRUSTED_INPUT_IDENTITY_DOMAIN,
} from './evidence.js';
export type { ConfigurationRecoveryEvidenceInput } from './evidence.js';
export type { ConfigurationRecoveryEvidenceFacts } from '../types.js';
// WP-8-H: the registry-index rebuild operation (ADR-031): the exact
// registry-index publication builder and the index surface scan helpers.
export { publishRegistryIndex } from './index-rebuild.js';
export { indexObservationId, isRegistryIndexBytes } from './scan.js';
export type { RegistryIndexPublishResult } from './index-rebuild.js';
