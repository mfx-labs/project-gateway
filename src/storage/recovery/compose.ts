/**
 * WP-8-E recovery-scan composition boundary (contract §16 CSA-001…015,
 * §12 LOK-004…009, §19 LMT-006/010; WP-8-E scope items 4–5). FILESYSTEM-
 * FREE: all filesystem work is delegated to the recovery scan module; this
 * module wires the genuine trusted input, the verified store instance, and
 * a live non-mutating read capability to the deterministic scan, the pure
 * assessment, and the pure advisory plan.
 *
 * The recovery scan is observation-only: it never deletes, renames,
 * unlinks, repairs, quarantines, breaks locks, publishes audit events, or
 * mints capabilities. The assessment and the plan are plain advisory data:
 * no raw paths, no payload bytes, no lock nonce, no capability objects,
 * and nothing directly executable (WP-8-E scope item 5). Over-limit
 * recovery scans fail closed with ERR-STO-LIMIT-EXCEEDED (the
 * `recoveryScanEntries` contract row: "recovery fails closed").
 */
import { createReadCapability } from '../capabilities/authenticity.js';
import { revalidateStore, revalidateStoreConfigurationTolerant } from '../read/index.js';
import { namespaceRootFor } from '../read/index.js';
import { scanStoreSnapshot } from './scan.js';
import { assessRecovery } from './assess.js';
import { buildRecoveryPlan } from './plan.js';
import type { RecoveryScanRequest, RecoveryScanResult, ScanBounds, ScanFacts } from '../types.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function failResult(code: string, message: string): RecoveryScanResult {
  return { ok: false, findings: [{ code, message, phase: 'request-validation', state: NO_STATE }] };
}

function scanFactsOf(scan: { readonly scannedEntries: number; readonly scannedBytes: number; readonly truncated: boolean; readonly surfaceGeneration?: string }, generation: string): ScanFacts {
  if (scan.surfaceGeneration === undefined) throw new Error('recovery scan produced no surface-generation token');
  return { generation, surfaceGeneration: scan.surfaceGeneration, scannedEntries: scan.scannedEntries, scannedBytes: scan.scannedBytes, truncated: scan.truncated, failClosed: true };
}

/**
 * Run the bounded read-only recovery scan over the verified store-records
 * namespace and produce the recovery assessment plus the advisory recovery
 * plan (CSA-001…015; LMT-006/010). Recovery-mode bounds come from
 * `recoveryScanEntries` (entries) and `totalScanBytes` (bytes); any
 * over-limit condition fails closed.
 */
export function runRecoveryScan(request: RecoveryScanRequest): RecoveryScanResult {
  // WP-8-M: the recovery scan uses the configuration-tolerant revalidation
  // so that a missing/conflicting configuration object is OBSERVED (the
  // configuration-namespace observation) instead of making the unrelated
  // store-records recovery scan fail (§16.7). The store-records metadata
  // remains fully verified; only the configuration-namespace metadata is
  // observed. Every other operation keeps the strict pipeline.
  const store = revalidateStoreConfigurationTolerant({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const capability = createReadCapability({ trustedInput: request.trustedInput, storeInstance: store.storeInstance });
  if (capability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'read capability could not be issued for the recovery scan');
  }
  try {
    const profile = store.storeInstance.limitProfile;
    const bounds: ScanBounds = {
      mode: 'recovery',
      entryLimit: profile['recoveryScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: true,
      // WP-8-H: per-index-artifact read bound (ADR-031 `indexBytes`).
      indexByteLimit: profile['indexBytes'] ?? 64 * 1024 * 1024,
    };
    const scan = scanStoreSnapshot({ capability, namespaceRoot: namespaceRootFor(store.storeInstance), bounds });
    if (!scan.ok) {
      return failResult(scan.findings[0]?.code ?? 'ERR-STO-IO-FAILURE', scan.findings[0]?.message ?? 'recovery scan failed');
    }
    // The scan computes the generation token; the assessment and plan bind
    // exactly that token.
    if (scan.generation === undefined) {
      return failResult('ERR-STO-INTERNAL-INVARIANT', 'recovery scan produced no generation token');
    }
    const assessment = assessRecovery(scan.observations, scanFactsOf(scan, scan.generation), scan.configurationObservation);
    const plan = buildRecoveryPlan(assessment);
    return { ok: true, assessment, plan, findings: scan.findings.length > 0 ? scan.findings : undefined };
  } finally {
    capability.dispose();
  }
}
