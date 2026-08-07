/**
 * WP-8-E registry-view composition boundary (contract §14, RGY-001…010;
 * RDS-005; WP-8-E scope item 3). FILESYSTEM-FREE at module scope: all
 * filesystem work is delegated to the read-side fs modules and the
 * recovery scan module; this module wires the genuine trusted input, the
 * verified store instance, and a live non-mutating read capability to the
 * deterministic scan and the pure view derivation.
 *
 * The derived view is plain data: it grants no authority (RGY-010), makes
 * no lifecycle decision, contains no raw filesystem paths, no payload
 * bytes, and no capability objects; it is reproducible from the same
 * immutable store bytes and valid only for the scanned snapshot generation
 * (RGY-005). Reads never mutate semantic trusted state (RDS-011).
 */
import { createReadCapability } from '../capabilities/authenticity.js';
import { revalidateStore, namespaceRootFor } from '../read/index.js';
import { scanStoreSnapshot } from '../recovery/scan.js';
import { deriveRegistryViewFromScan } from './derive.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { isValidDigestSyntax } from '../format/envelope.js';
import type { RegistryViewRequest, RegistryViewResult, ScanBounds, ScanCursor, ScanFacts } from '../types.js';

const NO_STATE = { retryable: false, recoveryRequired: false, primaryStateChanged: 'no' as const, durabilityPointReached: 'no' as const, auditChanged: 'no' as const, verifyBeforeRetry: false };

function failResult(code: string, message: string): RegistryViewResult {
  return { ok: false, findings: [{ code, message, phase: 'request-validation', state: NO_STATE }] };
}

function scanFactsOf(scan: { readonly scannedEntries: number; readonly scannedBytes: number; readonly truncated: boolean; readonly surfaceGeneration?: string }, generation: string, failClosed: boolean): ScanFacts {
  if (scan.surfaceGeneration === undefined) throw new Error('registry scan produced no surface-generation token');
  return { generation, surfaceGeneration: scan.surfaceGeneration, scannedEntries: scan.scannedEntries, scannedBytes: scan.scannedBytes, truncated: scan.truncated, failClosed };
}

/**
 * Validate a caller-supplied continuation cursor (request-lowerable
 * operand; RDS-004; F2/F3-G). Both generation tokens must be present and
 * carry digest syntax; the deep generation-equality and cross-page
 * structural-snapshot checks run inside the scan (the scan computes the
 * request's own generations and rejects mismatches before scanning any
 * candidate content).
 */
function validateCursor(cursor: ScanCursor | undefined): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  if (cursor === undefined) return { ok: true };
  const profile = RECORD_CLASS_BY_ID.get(cursor.recordClass);
  if (
    typeof cursor.generation !== 'string' ||
    !isValidDigestSyntax(cursor.generation) ||
    typeof cursor.surfaceGeneration !== 'string' ||
    !isValidDigestSyntax(cursor.surfaceGeneration) ||
    profile === undefined ||
    profile.namespace !== 'store-records' ||
    !/^[0-9a-f]{4}$/.test(cursor.shard) ||
    cursor.entry.length === 0 ||
    cursor.entry.length > 128
  ) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'scan continuation is malformed' };
  }
  return { ok: true };
}

/**
 * Derive the deterministic in-memory registry view over a fresh bounded
 * scan of the verified store-records namespace (RDS-005, RGY-002/005/010).
 * The scan uses the bound `totalScanEntries`/`totalScanBytes` profile
 * values; over-limit scans truncate with evidence and return a
 * continuation cursor (LMT-006).
 */
export function deriveRegistryView(request: RegistryViewRequest): RegistryViewResult {
  const cursorCheck = validateCursor(request.continuation);
  if (!cursorCheck.ok) {
    return failResult(cursorCheck.code ?? 'ERR-STO-REQ-INVALID', cursorCheck.message ?? 'scan continuation is malformed');
  }
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return failResult(store.code ?? 'ERR-STO-INTEGRITY', store.message ?? 'store revalidation failed');
  }
  const capability = createReadCapability({ trustedInput: request.trustedInput, storeInstance: store.storeInstance });
  if (capability === undefined) {
    return failResult('ERR-STO-REQ-INVALID', 'read capability could not be issued for the registry view');
  }
  try {
    const profile = store.storeInstance.limitProfile;
    const bounds: ScanBounds = {
      mode: 'registry',
      entryLimit: profile['totalScanEntries'] ?? 1024 * 1024,
      byteLimit: profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024,
      failClosed: false,
    };
    const scan = scanStoreSnapshot({ capability, namespaceRoot: namespaceRootFor(store.storeInstance), bounds, continuation: request.continuation });
    if (!scan.ok) {
      return failResult(scan.findings[0]?.code ?? 'ERR-STO-IO-FAILURE', scan.findings[0]?.message ?? 'store scan failed');
    }
    // The scan computes the generation token from the verified store
    // instance, mode, and bounds; the view binds exactly that token.
    if (scan.generation === undefined) {
      return failResult('ERR-STO-INTERNAL-INVARIANT', 'store scan produced no generation token');
    }
    const view = deriveRegistryViewFromScan(scan.observations, scanFactsOf(scan, scan.generation, false));
    return {
      ok: true,
      view,
      ...(scan.continuation !== undefined ? { continuation: scan.continuation } : {}),
      findings: scan.findings.length > 0 ? scan.findings : undefined,
    };
  } finally {
    capability.dispose();
  }
}
