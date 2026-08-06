/**
 * WP-8-B configuration module barrel: pure representation and structural
 * chain validation only. No persistence, selection authority, or policy
 * interpretation.
 */
export { validateConfigurationSnapshotRecord, isStructurallyValidSuccessor } from './snapshot.js';
export type { ConfigurationSnapshotRecordView, SnapshotFinding, SnapshotFindingCode, SnapshotValidation } from './snapshot.js';
export { verifyConfigurationChain, chainFindingErrorCode, isRollbackRepresentableAsNewVersion } from './chain.js';
export type { ChainFindingKind } from './chain.js';
