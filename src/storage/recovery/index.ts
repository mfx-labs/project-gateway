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
export { buildQuarantineEvidenceRecord, buildRecoveryEvidenceRecord, computeQuarantineEvidenceIdentity, computeQuarantineTemporaryId, computeRecoveryEvidenceIdentity, isoFromEpochMs, quarantineDestinationDesignation, recoveryEvidencePayload } from './evidence.js';
export { executeQuarantineTemporary } from './quarantine.js';
export { reverifyQuarantineSource, verifyQuarantineObjectDigest } from './reverify.js';
export { isPublicationTemporaryName, temporaryObservationId } from './scan.js';
export type { RecoveryEvidenceInput, RecoveryEvidenceBuild } from './evidence.js';
