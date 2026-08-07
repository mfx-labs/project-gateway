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
import { registryIndexViewOf } from './index-model.js';
import { validateRegistryIndexLive } from './index-store.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { isValidDigestSyntax } from '../format/envelope.js';
import type { RegistryView, RegistryViewRequest, RegistryViewResult, ScanBounds, ScanCursor, ScanFacts, ScanObservation, StorageFinding } from '../types.js';

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
 * Complete verified registry snapshot (WP-8-H §9): a fresh bounded registry
 * scan plus its observations, structure-level findings, and scan facts,
 * used by the index rebuild. Over-limit scans truncate with evidence and
 * carry a continuation; the index builder rejects both (a persistent index
 * requires a COMPLETE view).
 */
export function runRegistrySnapshotScan(request: {
  readonly trustedConfiguration: unknown;
  readonly trustedInput: unknown;
}): {
  readonly ok: boolean;
  readonly observations?: readonly ScanObservation[];
  readonly findings?: readonly StorageFinding[];
  readonly scanFacts?: ScanFacts;
  readonly continuation?: ScanCursor;
  readonly code?: string;
  readonly message?: string;
} {
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store revalidation failed' };
  }
  const capability = createReadCapability({ trustedInput: request.trustedInput, storeInstance: store.storeInstance });
  if (capability === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'read capability could not be issued for the registry snapshot scan' };
  }
  try {
    const profile = store.storeInstance.limitProfile;
    const entryLimit = profile['totalScanEntries'] ?? 1024 * 1024;
    const byteLimit = profile['totalScanBytes'] ?? 4 * 1024 * 1024 * 1024;
    const bounds: ScanBounds = { mode: 'registry', entryLimit, byteLimit, failClosed: false };
    const scan = scanStoreSnapshot({ capability, namespaceRoot: namespaceRootFor(store.storeInstance), bounds });
    if (!scan.ok) {
      return { ok: false, code: scan.findings[0]?.code ?? 'ERR-STO-IO-FAILURE', message: scan.findings[0]?.message ?? 'store scan failed' };
    }
    if (scan.generation === undefined) {
      return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'store scan produced no generation token' };
    }
    const scanFacts: ScanFacts = {
      generation: scan.generation,
      surfaceGeneration: scan.surfaceGeneration ?? '',
      scannedEntries: scan.scannedEntries,
      scannedBytes: scan.scannedBytes,
      truncated: scan.truncated,
      failClosed: false,
    };
    return {
      ok: true,
      observations: scan.observations,
      findings: scan.findings,
      scanFacts,
      ...(scan.continuation !== undefined ? { continuation: scan.continuation } : {}),
    };
  } finally {
    capability.dispose();
  }
}

/**
 * WP-8-H opt-in persistent-index fast path (WP-8-H §10): validates the
 * persistent registry index against the CURRENT store state (store
 * identity, recomputed generation and surface tokens, and the live
 * entry-set probe) and serves the deterministic registry view reproduced
 * from the index when it is current and exact. Returns the authoritative
 * result shape plus the deterministic `indexState`; the caller falls back
 * to the authoritative scan on any state other than `current-valid`.
 */
function tryPersistentIndexFastPath(request: RegistryViewRequest): { readonly ok: boolean; readonly view?: RegistryView; readonly indexState?: string; readonly findings?: readonly StorageFinding[] } {
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, indexState: 'unreadable' };
  }
  const profile = store.storeInstance.limitProfile;
  const indexByteLimit = profile['indexBytes'] ?? 64 * 1024 * 1024;
  const validation = validateRegistryIndexLive({
    namespaceRoot: namespaceRootFor(store.storeInstance),
    serviceUid: store.storeInstance.serviceUid,
    storeInstance: store.storeInstance,
    indexByteLimit,
  });
  if (validation.state !== 'current-valid' || validation.model === undefined) {
    // Fall back to the authoritative scan; the index state is reported for
    // diagnostics (a stale/missing index is a rebuild candidate, never a
    // storage failure).
    return { ok: false, indexState: validation.state };
  }
  const view = registryIndexViewOf(validation.model);
  return {
    ok: true,
    view,
    indexState: 'current-valid',
    ...(validation.model.findings.length > 0 ? { findings: validation.model.findings.map((f) => ({ code: f.code, message: f.message, phase: f.phase, state: NO_STATE }) as StorageFinding) } : {}),
  };
}

/**
 * Derive the deterministic in-memory registry view over a fresh bounded
 * scan of the verified store-records namespace (RDS-005, RGY-002/005/010).
 * The scan uses the bound `totalScanEntries`/`totalScanBytes` profile
 * values; over-limit scans truncate with evidence and return a
 * continuation cursor (LMT-006). With `usePersistentIndex`, the opt-in
 * fast path serves the reproduced view when a current index validates,
 * and falls back to this authoritative path otherwise.
 */
export function deriveRegistryView(request: RegistryViewRequest): RegistryViewResult {
  if (request.usePersistentIndex === true) {
    const fast = tryPersistentIndexFastPath(request);
    if (fast.ok && fast.view !== undefined) {
      return {
        ok: true,
        view: fast.view,
        indexState: fast.indexState,
        ...(fast.findings !== undefined && fast.findings.length > 0 ? { findings: fast.findings } : {}),
      };
    }
    // Fast path failed: report the index state on the authoritative result.
    const fallback = deriveRegistryViewAuthoritative(request);
    return { ...fallback, indexState: fast.indexState ?? 'unreadable' };
  }
  return deriveRegistryViewAuthoritative(request);
}

function deriveRegistryViewAuthoritative(request: RegistryViewRequest): RegistryViewResult {
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
