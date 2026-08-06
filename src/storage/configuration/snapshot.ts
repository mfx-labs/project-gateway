/**
 * `ConfigurationSnapshotRecord` pure representation and envelope profile
 * (contract 3.6, CSR-011…016, TAX-014).
 *
 * WP-8-B defines the pure internal representation and persisted-envelope
 * profile and may validate caller-supplied records. It never creates an
 * accepted configuration version, publishes a snapshot, selects trusted
 * policy, stores a current-head index, performs recovery, or reinterprets
 * policy content. The trusted control plane remains the semantic producer.
 *
 * Structural predecessor rules (CSR-012, corrected W8B-C01):
 * - genesis (revision 1) MUST carry NO predecessor identity and NO
 *   predecessor digest;
 * - every non-genesis version (revision > 1) MUST carry BOTH a predecessor
 *   identity and a predecessor digest, each satisfying its syntax and
 *   canonical-form requirements.
 * All mixed states (identity without digest, digest without identity,
 * genesis with either field, non-genesis with neither field) are rejected
 * before a record can enter normal chain verification.
 */
import { isValidDigestSyntax } from '../format/envelope.js';
import { parseTypedIdentifier } from '../format/identifier.js';

export interface ConfigurationSnapshotRecordView {
  readonly recordId: string;
  readonly formatVersion: string;
  /** Monotonic configuration revision (positive integer, strictly increasing). */
  readonly revision: number;
  /** Absent only for the genesis version. */
  readonly predecessorId?: string;
  readonly predecessorDigest?: string;
  readonly payloadDigest: string;
  readonly trustedActionId: string;
  readonly createdAt: string;
  /** Canonical bytes of the snapshot record (for duplicate classification). */
  readonly canonicalUtf8: string;
  readonly recordDigest: string;
}

const SNAPSHOT_FIELDS = ['recordId', 'formatVersion', 'revision', 'predecessorId', 'predecessorDigest', 'payloadDigest', 'trustedActionId', 'createdAt'] as const;

export type SnapshotFindingCode = 'SNAP-UNKNOWN-FIELD' | 'SNAP-MISSING-FIELD' | 'SNAP-RECORD-ID' | 'SNAP-VERSION' | 'SNAP-REVISION' | 'SNAP-PREDECESSOR-ID' | 'SNAP-PREDECESSOR-DIGEST' | 'SNAP-PAYLOAD-DIGEST' | 'SNAP-ACTION-ID' | 'SNAP-GENESIS-PREDECESSOR' | 'SNAP-PREDECESSOR-INCOMPLETE';

export interface SnapshotFinding {
  readonly code: SnapshotFindingCode;
  readonly message: string;
  readonly path: string;
}

export type SnapshotValidation =
  | { readonly ok: true; readonly snapshot: ConfigurationSnapshotRecordView }
  | { readonly ok: false; readonly findings: readonly SnapshotFinding[] };

function f(code: SnapshotFindingCode, message: string, path: string): SnapshotFinding {
  return { code, message, path };
}

/** Strict structural validation of a caller-supplied snapshot record view. */
export function validateConfigurationSnapshotRecord(input: Readonly<Record<string, unknown>>): SnapshotValidation {
  const findings: SnapshotFinding[] = [];
  for (const key of Object.keys(input)) {
    if (!(SNAPSHOT_FIELDS as readonly string[]).includes(key)) {
      findings.push(f('SNAP-UNKNOWN-FIELD', 'unknown configuration snapshot field', `/snapshot/${key}`));
    }
  }
  for (const field of ['recordId', 'formatVersion', 'revision', 'payloadDigest', 'trustedActionId', 'createdAt']) {
    if (!(field in input)) findings.push(f('SNAP-MISSING-FIELD', 'missing configuration snapshot field', `/snapshot/${field}`));
  }
  if (findings.length > 0) return { ok: false, findings };
  const recordId = String(input['recordId']);
  const formatVersion = String(input['formatVersion']);
  const revision = input['revision'];
  const payloadDigest = String(input['payloadDigest']);
  const trustedActionId = String(input['trustedActionId']);
  const createdAt = String(input['createdAt']);
  const predecessorId = input['predecessorId'] === undefined ? undefined : String(input['predecessorId']);
  const predecessorDigest = input['predecessorDigest'] === undefined ? undefined : String(input['predecessorDigest']);

  if (!parseTypedIdentifier(recordId).ok) findings.push(f('SNAP-RECORD-ID', 'recordId must be a canonical typed identifier', '/snapshot/recordId'));
  if (!/^[1-9][0-9]*\.(0|[1-9][0-9]*)$/.test(formatVersion)) findings.push(f('SNAP-VERSION', 'formatVersion must use strict MAJOR.MINOR syntax', '/snapshot/formatVersion'));
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) findings.push(f('SNAP-REVISION', 'revision must be a positive safe integer', '/snapshot/revision'));
  if (!isValidDigestSyntax(payloadDigest)) findings.push(f('SNAP-PAYLOAD-DIGEST', 'payloadDigest must use sha-256:<64-hex> syntax', '/snapshot/payloadDigest'));
  if (trustedActionId.length === 0) findings.push(f('SNAP-ACTION-ID', 'trustedActionId must be non-empty', '/snapshot/trustedActionId'));
  if (predecessorId !== undefined && !parseTypedIdentifier(predecessorId).ok) findings.push(f('SNAP-PREDECESSOR-ID', 'predecessorId must be a canonical typed identifier', '/snapshot/predecessorId'));
  if (predecessorDigest !== undefined && !isValidDigestSyntax(predecessorDigest)) findings.push(f('SNAP-PREDECESSOR-DIGEST', 'predecessorDigest must use sha-256:<64-hex> syntax', '/snapshot/predecessorDigest'));
  if (revision === 1 && (predecessorId !== undefined || predecessorDigest !== undefined)) {
    findings.push(f('SNAP-GENESIS-PREDECESSOR', 'genesis (revision 1) must not carry a predecessor', '/snapshot/predecessorId'));
  }
  // Non-genesis versions MUST carry BOTH predecessor identity and digest
  // (CSR-012; corrected W8B-C01). Applied only when revision is a valid
  // number greater than 1 so invalid revisions are reported as revision
  // errors, not as predecessor errors.
  if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 1 && (predecessorId === undefined || predecessorDigest === undefined)) {
    findings.push(f('SNAP-PREDECESSOR-INCOMPLETE', 'non-genesis configuration snapshot must carry both a predecessor identity and a predecessor digest', '/snapshot/predecessorId'));
  }
  if (findings.length > 0) return { ok: false, findings };
  return {
    ok: true,
    snapshot: {
      recordId,
      formatVersion,
      revision: revision as number,
      predecessorId,
      predecessorDigest,
      payloadDigest,
      trustedActionId,
      createdAt,
      canonicalUtf8: '',
      recordDigest: '',
    },
  };
}

/** Structural successor rule: a new version is valid only as head+1. */
export function isStructurallyValidSuccessor(currentHeadRevision: number | undefined, candidateRevision: number): boolean {
  return candidateRevision === (currentHeadRevision === undefined ? 1 : currentHeadRevision + 1);
}
