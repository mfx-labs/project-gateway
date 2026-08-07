/**
 * WP-8-D read/verify/enumerate composition boundary (contract 13,
 * RDS-001…012; ADR-029 D-5). Filesystem-free: all filesystem work is
 * delegated to the read-side fs modules and the root/provision modules.
 *
 * Every operation requires a genuine branded `TrustedStorageBootstrapInput`
 * and a genuine accepted WP-6 trusted configuration; the verified store
 * instance is re-established through the metadata verification pipeline
 * (D-5), and the non-mutating read/verify capabilities are issued by their
 * gated creators (imported only by this module). Zero production consumers
 * exist until WP-9/WP-12 (API-008); the creators are not re-exported.
 *
 * Reads never mutate semantic trusted state (RDS-011); verification returns
 * structured findings only and confers no authority (RDS-003, ITG-007);
 * enumeration is bounded, deterministically ordered, and independently
 * verifies every reported record (RDS-004, DTM-003).
 */
import { createReadCapability, createVerifyCapability } from '../capabilities/authenticity.js';
import { isGenuineTrustedStorageBootstrapInput, type TrustedStorageBootstrapInput } from '../trusted-input/bootstrap-input.js';
import { verifyStoreInstance } from './read-record.js';
import { enumerateClassByIdentity } from './enumerate.js';
import { readRecordByIdentity, verifyRecordByIdentity } from './read-record.js';
import { inspectAuditHistoryByIdentity } from './history.js';
import { recordClassProfile } from '../format/taxonomy.js';
import { parseTypedIdentifier } from '../format/identifier.js';
import type { AuditHistoryInspectionResult, EnumerateClassRequest, EnumerateClassResult, InspectAuditHistoryRequest, ReadRecordRequest, ReadRecordResult, RecordClassId, RootIdentity, VerifiedStoreInstance, VerifyRecordRequest, VerifyRecordResult } from '../types.js';

function configFacts(trustedConfiguration: unknown): { readonly configurationVersion: string; readonly configurationIdentity: string } | undefined {
  if (typeof trustedConfiguration !== 'object' || trustedConfiguration === null) return undefined;
  const c = trustedConfiguration as Readonly<Record<string, unknown>>;
  if (typeof c['configurationVersion'] !== 'string' || typeof c['identity'] !== 'string') return undefined;
  return { configurationVersion: c['configurationVersion'], configurationIdentity: c['identity'] };
}

function validateClassAndIdentity(recordClass: RecordClassId, rawIdentifier: string): { readonly ok: boolean; readonly code?: string; readonly message?: string } {
  if (recordClassProfile(recordClass) === undefined) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record class is not accepted' };
  }
  const parsed = parseTypedIdentifier(rawIdentifier);
  if (!parsed.ok) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'record identity is not a canonical typed identifier' };
  }
  return { ok: true };
}

/** Internal store revalidation shared by the read-side operations. */
export function revalidateStore(request: { readonly trustedConfiguration: unknown; readonly trustedInput: unknown }): { readonly ok: boolean; readonly storeInstance?: VerifiedStoreInstance; readonly code?: string; readonly message?: string } {
  if (!isGenuineTrustedStorageBootstrapInput(request.trustedInput)) {
    return { ok: false, code: 'ERR-STO-REQ-INVALID', message: 'trusted input is not genuine' };
  }
  const facts = configFacts(request.trustedConfiguration);
  if (facts === undefined) {
    return { ok: false, code: 'ERR-STO-CONFIG-UNAVAILABLE', message: 'trusted configuration facts are unavailable' };
  }
  const input = request.trustedInput as TrustedStorageBootstrapInput;
  if (input.configurationIdentity !== facts.configurationIdentity) {
    return { ok: false, code: 'ERR-STO-CONFIG-UNAVAILABLE', message: 'trusted input does not correlate with the trusted configuration' };
  }
  return verifyStoreInstance({
    locator: input.locator,
    serviceUid: input.serviceUid,
    forbiddenRoots: input.forbiddenRoots,
    configurationIdentity: facts.configurationIdentity,
    configurationVersion: facts.configurationVersion,
    limitProfile: input.limitProfile,
  });
}

/** Verified store-records namespace root (fixed derivation; CSR-002). */
export function namespaceRootFor(storeInstance: VerifiedStoreInstance): string {
  return `${storeInstance.parentIdentity.canonicalPath}/store-v1`;
}

/** Exact read by identity (RDS-001/002/008/009/011/012). */
export function readRecord(request: ReadRecordRequest): ReadRecordResult {
  const validated = validateClassAndIdentity(request.recordClass, request.recordId);
  if (!validated.ok) {
    return { ok: false, findings: [{ code: validated.code ?? 'ERR-STO-REQ-INVALID', message: validated.message ?? 'invalid read request', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, findings: [{ code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store revalidation failed', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const capability = createReadCapability({ trustedInput: request.trustedInput, storeInstance: store.storeInstance });
  if (capability === undefined) {
    return { ok: false, findings: [{ code: 'ERR-STO-REQ-INVALID', message: 'read capability could not be issued', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  try {
    return readRecordByIdentity({ capability, namespaceRoot: namespaceRootFor(store.storeInstance), recordClass: request.recordClass, rawIdentifier: request.recordId });
  } finally {
    capability.dispose();
  }
}

/** Verify by identity (RDS-003): structured findings only, no content, no repair. */
/**
 * Bounded read-only audit-history inspection (13.4, RDS-006/008/011,
 * HST-001…010, AUD-014; ADR-034): exact record identity/revision history
 * over verified immutable audit facts. Capability-free — the trusted
 * configuration + trusted input establish the verified store instance and
 * the query never accepts or returns authority (HST-001/010).
 */
export function inspectAuditHistory(request: InspectAuditHistoryRequest): AuditHistoryInspectionResult {
  const validated = validateClassAndIdentity(request.recordClass, request.recordId);
  if (!validated.ok) {
    return { ok: false, findings: [{ code: validated.code ?? 'ERR-STO-REQ-INVALID', message: validated.message ?? 'invalid audit-history request', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, findings: [{ code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store revalidation failed', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  return inspectAuditHistoryByIdentity({
    storeInstance: store.storeInstance,
    namespaceRoot: namespaceRootFor(store.storeInstance),
    recordClass: request.recordClass,
    recordId: request.recordId,
    revision: request.revision,
    continuation: request.continuation,
  });
}

export function verifyRecord(request: VerifyRecordRequest): VerifyRecordResult {
  const validated = validateClassAndIdentity(request.recordClass, request.recordId);
  if (!validated.ok) {
    return { ok: false, findings: [{ code: validated.code ?? 'ERR-STO-REQ-INVALID', message: validated.message ?? 'invalid verify request', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, findings: [{ code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store revalidation failed', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const capability = createVerifyCapability({ trustedInput: request.trustedInput, storeInstance: store.storeInstance });
  if (capability === undefined) {
    return { ok: false, findings: [{ code: 'ERR-STO-REQ-INVALID', message: 'verify capability could not be issued', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  try {
    return verifyRecordByIdentity({ capability, namespaceRoot: namespaceRootFor(store.storeInstance), recordClass: request.recordClass, rawIdentifier: request.recordId });
  } finally {
    capability.dispose();
  }
}

/** Bounded deterministic class enumeration (RDS-004, DTM-003, LMT-006). */
export function enumerateClass(request: EnumerateClassRequest): EnumerateClassResult {
  if (recordClassProfile(request.recordClass) === undefined) {
    return { ok: false, items: [], scannedEntries: 0, truncated: false, findings: [{ code: 'ERR-STO-REQ-INVALID', message: 'record class is not accepted', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const store = revalidateStore({ trustedConfiguration: request.trustedConfiguration, trustedInput: request.trustedInput });
  if (!store.ok || store.storeInstance === undefined) {
    return { ok: false, items: [], scannedEntries: 0, truncated: false, findings: [{ code: store.code ?? 'ERR-STO-INTEGRITY', message: store.message ?? 'store revalidation failed', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  const capability = createReadCapability({ trustedInput: request.trustedInput, storeInstance: store.storeInstance });
  if (capability === undefined) {
    return { ok: false, items: [], scannedEntries: 0, truncated: false, findings: [{ code: 'ERR-STO-REQ-INVALID', message: 'read capability could not be issued', phase: 'request-validation', state: { retryable: false, recoveryRequired: false, primaryStateChanged: 'no', durabilityPointReached: 'no', auditChanged: 'no', verifyBeforeRetry: false } }] };
  }
  try {
    return enumerateClassByIdentity({ capability, namespaceRoot: namespaceRootFor(store.storeInstance), recordClass: request.recordClass, continuation: request.continuation });
  } finally {
    capability.dispose();
  }
}
