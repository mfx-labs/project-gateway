/**
 * WP-12 Slice 1 — untrusted request capture and canonical subject parsing.
 *
 * Descriptor-derived capture reuses the accepted WP-6 snapshot hardening
 * (`snapshotTrustedWorkspaceConfigurationInput`), then exact-key and
 * exact-syntax validation produce the typed request. Role-bearing and
 * authority-bearing keys are structurally rejected (SCR-W12-003): the
 * request can never supply the approver/issuer role, configuration,
 * ceilings, registry context, store boundary, or validation outcome.
 *
 * Pure module: no I/O, no persistence, no authority.
 */
import { snapshotTrustedWorkspaceConfigurationInput, TrustedSnapshotError } from '../trusted/index.js';
import type {
  CanonicalSubject,
  Slice1Request,
  Slice1Operation,
  Slice1KindId,
} from './types.js';
import {
  ARTIFACT_PROTOCOL_ID,
  ARTIFACT_PROTOCOL_VERSION,
  DIGEST_RE,
  INSTANCE_ID_RE,
  RECORD_ID_RE,
  REASON_MAX_LENGTH,
  REVISION_ID_RE,
  SLICE_1_KIND_IDS,
  SLICE_1_OPERATIONS,
  SLICE_1_PURPOSES,
  SLICE_1_USE_CLASSES,
  TIMESTAMP_RE,
  VALIDATION_REF_MAX_COUNT,
  VERSION_RE,
  WORKSPACE_ID_RE,
} from './types.js';

/** Exact key set of the whole request (union; per-operation subsets enforced). */
const REQUEST_KEYS: ReadonlySet<string> = new Set(['operation', 'subject', 'workspaceId', 'purpose', 'useClass', 'validationRecordIds', 'reason']);
/** Exact key set of the canonical subject operand (Decision 3 identity + workspace). */
const SUBJECT_KEYS: ReadonlySet<string> = new Set(['protocolId', 'protocolVersion', 'kindId', 'kindVersion', 'instanceId', 'revisionId', 'digest', 'workspaceId']);

/** Per-operation exact key sets. */
const OPERATION_KEYS: Readonly<Record<Slice1Operation, ReadonlySet<string>>> = {
  recordValidation: new Set(['operation', 'subject', 'workspaceId', 'reason']),
  approve: new Set(['operation', 'subject', 'workspaceId', 'purpose', 'validationRecordIds', 'reason']),
  issue: new Set(['operation', 'subject', 'workspaceId', 'useClass', 'reason']),
};

/**
 * Keys that attempt to assert or transport the trusted operator role.
 * Their presence is rejected as `approver-not-independent` (structural
 * independence; the role is host-asserted only).
 */
const ROLE_ASSERTION_KEYS: ReadonlySet<string> = new Set([
  'approverRole',
  'issuerRole',
  'operatorRole',
  'approver',
  'issuer',
  'role',
  'trustedRole',
  'approverIdentity',
  'operatorIdentity',
  'approverAuthority',
]);

export type RequestRejectReason =
  | 'capture'
  | 'unknown-key'
  | 'role-assertion'
  | 'shape'
  | 'subject-shape'
  | 'subject-syntax'
  | 'workspace-mismatch'
  | 'purpose'
  | 'use-class'
  | 'validation-refs'
  | 'reason'
  | 'operation';

export type RequestParseResult =
  | { readonly ok: true; readonly request: Slice1Request }
  | { readonly ok: false; readonly reason: RequestRejectReason };

export function isRoleAssertionKey(key: string): boolean {
  return ROLE_ASSERTION_KEYS.has(key);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(container: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(container);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

/** Reject unknown keys; role-assertion keys are reported distinctly. */
function unknownKeyOf(container: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): string | undefined {
  for (const key of Object.keys(container)) {
    if (!allowed.has(key)) return key;
  }
  return undefined;
}

/** Parse and validate the canonical subject operand (exact keys + exact syntax). */
export function parseCanonicalSubject(value: unknown): { readonly ok: true; readonly subject: CanonicalSubject } | { readonly ok: false; readonly reason: 'shape' | 'syntax' } {
  if (!isRecord(value)) return { ok: false, reason: 'shape' };
  if (!hasExactKeys(value, SUBJECT_KEYS)) return { ok: false, reason: 'shape' };
  const protocolId = value['protocolId'];
  const protocolVersion = value['protocolVersion'];
  const kindId = value['kindId'];
  const kindVersion = value['kindVersion'];
  const instanceId = value['instanceId'];
  const revisionId = value['revisionId'];
  const digest = value['digest'];
  const workspaceId = value['workspaceId'];
  for (const v of [protocolId, protocolVersion, kindId, kindVersion, instanceId, revisionId, digest, workspaceId]) {
    if (typeof v !== 'string') return { ok: false, reason: 'shape' };
  }
  if (protocolId !== ARTIFACT_PROTOCOL_ID) return { ok: false, reason: 'syntax' };
  if (protocolVersion !== ARTIFACT_PROTOCOL_VERSION) return { ok: false, reason: 'syntax' };
  if (!(SLICE_1_KIND_IDS as readonly string[]).includes(kindId as string)) return { ok: false, reason: 'syntax' };
  if (!VERSION_RE.test(kindVersion as string)) return { ok: false, reason: 'syntax' };
  if (!INSTANCE_ID_RE.test(instanceId as string)) return { ok: false, reason: 'syntax' };
  if (!REVISION_ID_RE.test(revisionId as string)) return { ok: false, reason: 'syntax' };
  if (!DIGEST_RE.test(digest as string)) return { ok: false, reason: 'syntax' };
  if (!WORKSPACE_ID_RE.test(workspaceId as string)) return { ok: false, reason: 'syntax' };
  return {
    ok: true,
    subject: Object.freeze({
      protocolId: protocolId as string,
      protocolVersion: protocolVersion as string,
      kindId: kindId as Slice1KindId,
      kindVersion: kindVersion as string,
      instanceId: instanceId as string,
      revisionId: revisionId as string,
      digest: digest as string,
      workspaceId: workspaceId as string,
    }),
  };
}

function parseValidationRefs(value: unknown): { readonly ok: boolean; readonly refs?: readonly string[] } {
  if (!Array.isArray(value)) return { ok: false };
  if (value.length < 1 || value.length > VALIDATION_REF_MAX_COUNT) return { ok: false };
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !RECORD_ID_RE.test(entry)) return { ok: false };
    if (seen.has(entry)) return { ok: false };
    seen.add(entry);
  }
  return { ok: true, refs: Object.freeze([...seen]) };
}

/**
 * Capture and parse the untrusted Slice-1 command. Descriptor-derived
 * snapshot capture fails closed on hostile structures; exact-key validation
 * rejects every authority-bearing operand; role-assertion keys are rejected
 * as approver-not-independent.
 */
export function captureSlice1Request(input: unknown): RequestParseResult {
  let snapshot: unknown;
  try {
    snapshot = snapshotTrustedWorkspaceConfigurationInput(input);
  } catch (err) {
    void err;
    return { ok: false, reason: 'capture' };
  }
  if (!isRecord(snapshot)) return { ok: false, reason: 'shape' };
  const unknownKey = unknownKeyOf(snapshot, REQUEST_KEYS);
  if (unknownKey !== undefined) {
    return isRoleAssertionKey(unknownKey) ? { ok: false, reason: 'role-assertion' } : { ok: false, reason: 'unknown-key' };
  }
  const operation = snapshot['operation'];
  if (typeof operation !== 'string' || !(SLICE_1_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, reason: 'operation' };
  }
  const op = operation as Slice1Operation;
  const opKeys = OPERATION_KEYS[op];
  const opUnknownKey = unknownKeyOf(snapshot, opKeys);
  if (opUnknownKey !== undefined) {
    return isRoleAssertionKey(opUnknownKey) ? { ok: false, reason: 'role-assertion' } : { ok: false, reason: 'unknown-key' };
  }

  const subjectParsed = parseCanonicalSubject(snapshot['subject']);
  if (!subjectParsed.ok) {
    return { ok: false, reason: subjectParsed.reason === 'shape' ? 'subject-shape' : 'subject-syntax' };
  }
  const subject = subjectParsed.subject;

  const workspaceId = snapshot['workspaceId'];
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_RE.test(workspaceId)) return { ok: false, reason: 'shape' };
  if (workspaceId !== subject.workspaceId) return { ok: false, reason: 'workspace-mismatch' };

  let purpose: string | undefined;
  let useClass: string | undefined;
  let validationRecordIds: readonly string[] | undefined;
  const reasonValue = snapshot['reason'];

  if (op === 'approve') {
    const purposeValue = snapshot['purpose'];
    if (typeof purposeValue !== 'string' || !(SLICE_1_PURPOSES as readonly string[]).includes(purposeValue)) {
      return { ok: false, reason: 'purpose' };
    }
    purpose = purposeValue;
    const refs = parseValidationRefs(snapshot['validationRecordIds']);
    if (!refs.ok || refs.refs === undefined) return { ok: false, reason: 'validation-refs' };
    validationRecordIds = refs.refs;
  } else if (op === 'issue') {
    const useClassValue = snapshot['useClass'];
    if (typeof useClassValue !== 'string' || !(SLICE_1_USE_CLASSES as readonly string[]).includes(useClassValue)) {
      return { ok: false, reason: 'use-class' };
    }
    useClass = useClassValue;
  }

  if (reasonValue !== undefined) {
    if (typeof reasonValue !== 'string' || reasonValue.length > REASON_MAX_LENGTH) return { ok: false, reason: 'reason' };
  }

  return {
    ok: true,
    request: Object.freeze({
      operation: op,
      subject,
      workspaceId,
      ...(purpose !== undefined ? { purpose } : {}),
      ...(useClass !== undefined ? { useClass } : {}),
      ...(validationRecordIds !== undefined ? { validationRecordIds } : {}),
      ...(typeof reasonValue === 'string' ? { reason: reasonValue } : {}),
    }),
  };
}

/** True when a value is a syntactically accepted trusted UTC timestamp. */
export function isAcceptedTimestamp(value: unknown): value is string {
  return typeof value === 'string' && TIMESTAMP_RE.test(value) && value.length <= 24;
}

/** Lexicographic comparison is exact for the fixed accepted UTC timestamp form. */
export function timestampAtOrBefore(current: string, candidate: string | null | undefined): boolean {
  if (candidate === null || candidate === undefined) return false;
  return candidate <= current;
}

/** Exact subject correlation between two lifecycle record subjects. */
export function subjectsMatch(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const kindA = a['kind'];
  const kindB = b['kind'];
  const kindIdA = typeof kindA === 'object' && kindA !== null ? (kindA as Record<string, unknown>)['id'] : undefined;
  const kindIdB = typeof kindB === 'object' && kindB !== null ? (kindB as Record<string, unknown>)['id'] : undefined;
  return (
    a['protocol_version'] === b['protocol_version'] &&
    kindIdA === kindIdB &&
    a['instance_id'] === b['instance_id'] &&
    a['revision_id'] === b['revision_id'] &&
    a['digest'] === b['digest'] &&
    a['workspace_id'] === b['workspace_id']
  );
}

/** Correlation of a lifecycle record subject with the typed canonical subject. */
export function subjectMatchesCanonical(
  recordSubject: Readonly<Record<string, unknown>>,
  subject: CanonicalSubject,
): boolean {
  const kind = recordSubject['kind'];
  const kindId = typeof kind === 'object' && kind !== null ? (kind as Record<string, unknown>)['id'] : undefined;
  const kindVersion = typeof kind === 'object' && kind !== null ? (kind as Record<string, unknown>)['version'] : undefined;
  return (
    recordSubject['protocol_version'] === subject.protocolVersion &&
    kindId === subject.kindId &&
    kindVersion === subject.kindVersion &&
    recordSubject['instance_id'] === subject.instanceId &&
    recordSubject['revision_id'] === subject.revisionId &&
    recordSubject['digest'] === subject.digest &&
    recordSubject['workspace_id'] === subject.workspaceId
  );
}

/** Lifecycle record subject (the exact protocol record-subject form). */
export function recordSubjectOf(subject: CanonicalSubject): Readonly<Record<string, unknown>> {
  return Object.freeze({
    protocol_version: subject.protocolVersion,
    kind: Object.freeze({ id: subject.kindId, version: subject.kindVersion }),
    instance_id: subject.instanceId,
    revision_id: subject.revisionId,
    digest: subject.digest,
    workspace_id: subject.workspaceId,
  });
}
