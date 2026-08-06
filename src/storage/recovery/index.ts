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
