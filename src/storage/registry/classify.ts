/**
 * WP-8-E pure record-candidate classification (contract 18.1/18.2, ERM-001…
 * 015, DTM-004; WP-8-E scope item 2). FILESYSTEM-FREE: this module decides
 * the closed 11-way candidate classification from pure facts; the fs-bearing
 * scan module (`src/storage/recovery/scan.ts`) computes the facts and never
 * decides categories, and the pure derivation
 * (`src/storage/registry/derive.ts`) upgrades the two snapshot-relative
 * categories (`incomplete-relationship`, `duplicate-conflicting-identity`).
 *
 * Classification precedence (deterministic; 18.2 and WP-8-E scope):
 *   1. entry-name grammar → `foreign-entry` (ERR-STO-MALFORMED);
 *   2. derived-location mismatch (ITG-003) → `wrong-derived-location`
 *      (ERR-STO-INTEGRITY) — containment-class failures precede file-type
 *      and permission failures (18.2);
 *   3. non-regular file type (FSP-003/005) → `wrong-type`
 *      (ERR-STO-FTYPE-UNSUPPORTED);
 *   4. owner UID or exact mode violation (SRX-006/007/014) →
 *      `wrong-uid-or-mode` (ERR-STO-PERM-DENIED);
 *   5. link count > 1 (FSP-006) → `unexpected-hard-link`
 *      (ERR-STO-INTEGRITY);
 *   6. per-record byte bound (LMT-004/007) → malformed bucket with the
 *      dedicated code ERR-STO-LIMIT-EXCEEDED (over-limit content is never
 *      accepted; ERM-010);
 *   7. content precedence via the accepted `classifyContentFailure`
 *      (18.2/ERM-014): unparseable minimum envelope → `malformed`;
 *      structurally valid unsupported version → `unsupported-version`;
 *      canonicalization failure → `malformed`; payload-digest mismatch →
 *      `digest-mismatch` (ERR-STO-INTEGRITY; ITG-001);
 *   8. envelope identity-component or class-label mismatch (LAY-005/ITG-003)
 *      → `wrong-derived-location` (ERR-STO-INTEGRITY).
 *
 * The remaining two categories are assigned by the pure snapshot
 * finalization in `derive.ts` (chain resolution and identity collision), so
 * that classification is deterministic and testable without a filesystem.
 *
 * No error code outside the closed 31-code set is ever produced; no
 * authority, path, or capability vocabulary appears in this module.
 */
import type { AuditAssociationFacts, RecordCandidateClassification, RecordClassId, RecordObservationFacts, ScannedObjectStat } from '../types.js';
import { RECORD_CLASS_BY_ID } from '../format/taxonomy.js';
import { parseRawJson } from '../../json/scanner.js';
import { jcsSerialize } from '../../canonical/jcs.js';
import { parseTypedIdentifier } from '../format/identifier.js';
import { computeDomainDigest, computePayloadDigest, isValidVersionSyntax, STORAGE_RECORD_BYTES_DIGEST_DOMAIN, validateRecordEnvelope } from '../format/envelope.js';

/** Supported lifecycle/audit record format versions for reads (VRS-002/003). */
export const SUPPORTED_RECORD_FORMAT_VERSIONS: readonly string[] = ['1.0'];

export function isSupportedRecordFormatVersion(version: string): boolean {
  return SUPPORTED_RECORD_FORMAT_VERSIONS.includes(version);
}

export interface CandidateClassification {
  readonly classification: RecordCandidateClassification;
  /** Closed ERR-STO-* code (Section 18.1). */
  readonly code: string;
  /** Static, disclosure-safe message (ERM-004). */
  readonly message: string;
}

/**
 * Pure per-candidate classification. The scan module supplies exactly these
 * facts; synthetic facts are used by unit tests for wrong UID/type/link
 * coverage without requiring root privileges or special files.
 */
export interface CandidateFacts {
  readonly entryName: string;
  readonly recordClass: RecordClassId;
  readonly shard: string;
  /** `deriveRecordRelativePath` outcome for the entry's identity component. */
  readonly derived: { readonly ok: boolean; readonly shard?: string; readonly filename?: string };
  readonly fileType: ScannedObjectStat['fileType'];
  readonly uidOk: boolean;
  readonly modeOk: boolean;
  readonly nlink: number;
  readonly size: number;
  readonly byteLimit: number;
  /** Accepted entry-name grammar: 32 lowercase hex + class suffix. */
  readonly nameGrammarOk: boolean;
  /** Raw JSON parses into an object with duplicate-key rejection. */
  readonly rawParses: boolean;
  /** Raw bytes equal the canonical RFC 8785 serialization (RFM-014). */
  readonly canonicalOk: boolean;
  /** The 8 required envelope fields are present (RFM-001). */
  readonly minimumEnvelopeParses: boolean;
  readonly versionStructurallyValid: boolean;
  readonly versionSupported: boolean;
  /** Deeper envelope field checks pass (kind, revision, identity, digests, NFC; RFM-005). */
  readonly envelopeDeferredOk: boolean;
  /** Payload digest matches the canonical payload (ITG-001). */
  readonly digestOk: boolean;
  /** Envelope identity component matches the entry component (ITG-003). */
  readonly identityComponentMatches: boolean;
  /** Envelope recordKind matches the class profile label (LAY-005). */
  readonly classLabelMatches: boolean;
}

function isRegular(fileType: CandidateFacts['fileType']): boolean {
  return fileType === 'regular';
}

function overLimit(input: CandidateFacts): boolean {
  return input.size > input.byteLimit;
}

/**
 * Deterministic 11-way classification with the fixed precedence of the
 * module header. Identical facts yield identical classifications; no host
 * directory order or clock value influences the result (DTM-003/004).
 */
export function classifyCandidate(input: CandidateFacts): CandidateClassification {
  if (!input.nameGrammarOk) {
    return { classification: 'foreign-entry', code: 'ERR-STO-MALFORMED', message: 'foreign entry in a record class directory' };
  }
  if (!input.derived.ok || input.derived.filename !== input.entryName || input.derived.shard !== input.shard) {
    return { classification: 'wrong-derived-location', code: 'ERR-STO-INTEGRITY', message: 'entry location does not match the layout derivation' };
  }
  if (!isRegular(input.fileType)) {
    return { classification: 'wrong-type', code: 'ERR-STO-FTYPE-UNSUPPORTED', message: 'record location is not a regular file' };
  }
  if (!input.uidOk || !input.modeOk) {
    return { classification: 'wrong-uid-or-mode', code: 'ERR-STO-PERM-DENIED', message: 'record ownership or mode violates the store permission policy' };
  }
  if (input.nlink > 1) {
    return { classification: 'unexpected-hard-link', code: 'ERR-STO-INTEGRITY', message: 'record has an unexpected hard-link state' };
  }
  if (overLimit(input)) {
    return { classification: 'malformed', code: 'ERR-STO-LIMIT-EXCEEDED', message: 'record exceeds the bounded byte limit' };
  }
  if (!input.rawParses || !input.canonicalOk) {
    return { classification: 'malformed', code: 'ERR-STO-MALFORMED', message: 'record is not canonical JSON' };
  }
  if (!input.minimumEnvelopeParses) {
    return { classification: 'malformed', code: 'ERR-STO-MALFORMED', message: 'record lacks the minimum envelope' };
  }
  if (!input.versionStructurallyValid) {
    return { classification: 'malformed', code: 'ERR-STO-MALFORMED', message: 'record format version is structurally invalid' };
  }
  if (!input.versionSupported) {
    return { classification: 'unsupported-version', code: 'ERR-STO-UNSUPPORTED-VERSION', message: 'record format version is outside the supported set' };
  }
  if (!input.envelopeDeferredOk) {
    return { classification: 'malformed', code: 'ERR-STO-MALFORMED', message: 'record envelope fields are not canonical' };
  }
  if (!input.digestOk) {
    return { classification: 'digest-mismatch', code: 'ERR-STO-INTEGRITY', message: 'record payload digest mismatch' };
  }
  if (!input.identityComponentMatches || !input.classLabelMatches) {
    return { classification: 'wrong-derived-location', code: 'ERR-STO-INTEGRITY', message: 'record identity or class does not match its derived location' };
  }
  return { classification: 'valid-immutable-record', code: '', message: 'record verified' };
}

/** Class profile label for the class (LAY-005 class-namespace check). */
export function classProfileLabel(recordClass: RecordClassId): string | undefined {
  return RECORD_CLASS_BY_ID.get(recordClass)?.label;
}

const REQUIRED_ENVELOPE_FIELDS = ['recordKind', 'formatVersion', 'recordId', 'revision', 'createdAt', 'trustedActionId', 'payload', 'payloadDigest'] as const;

/**
 * Pure envelope-fact extraction for one scanned candidate (RFM-001…014;
 * 18.2 precedence inputs). The scan module supplies raw UTF-8 bytes plus the
 * candidate component and class; this function returns the pure fact bundle
 * `classifyCandidate` needs plus the extracted envelope facts (never payload
 * bytes). Deterministic; no filesystem access.
 */
export function extractEnvelopeFacts(input: {
  readonly raw: string;
  readonly byteLimit: number;
  readonly component: string;
  readonly recordClass?: RecordClassId;
}): {
  readonly rawParses: boolean;
  readonly canonicalOk: boolean;
  readonly minimumEnvelopeParses: boolean;
  readonly versionStructurallyValid: boolean;
  readonly versionSupported: boolean;
  readonly envelopeDeferredOk: boolean;
  readonly digestOk: boolean;
  readonly identityComponentMatches: boolean;
  readonly classLabelMatches: boolean;
  readonly envelope?: RecordObservationFacts;
  readonly auditAssociation?: AuditAssociationFacts;
} {
  let model: unknown;
  try {
    model = parseRawJson(input.raw, input.byteLimit).model;
  } catch {
    model = undefined;
  }
  const isObject = typeof model === 'object' && model !== null && !Array.isArray(model);
  const rawParses = isObject;
  const obj = isObject ? (model as Readonly<Record<string, unknown>>) : undefined;
  const canonicalOk = rawParses && obj !== undefined && jcsSerialize(obj) === input.raw;
  const minimumEnvelopeParses = rawParses && obj !== undefined && REQUIRED_ENVELOPE_FIELDS.every((f) => f in obj);
  const version = rawParses && obj !== undefined && typeof obj['formatVersion'] === 'string' ? (obj['formatVersion'] as string) : undefined;
  const versionStructurallyValid = version !== undefined && isValidVersionSyntax(version);
  const versionSupported = versionStructurallyValid && isSupportedRecordFormatVersion(version);
  let envelopeDeferredOk = false;
  if (rawParses && obj !== undefined && versionSupported) {
    envelopeDeferredOk = validateRecordEnvelope(obj).ok;
  }
  let digestOk = false;
  let payloadDigest: string | undefined;
  let resultAuditAssociation: AuditAssociationFacts | undefined;
  if (rawParses && obj !== undefined && versionSupported && envelopeDeferredOk) {
    const payload = obj['payload'];
    const declared = obj['payloadDigest'];
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof declared === 'string') {
      payloadDigest = declared;
      digestOk = computePayloadDigest(payload as Readonly<Record<string, unknown>>) === declared;
    }
  }
  const recordId = rawParses && obj !== undefined && typeof obj['recordId'] === 'string' ? (obj['recordId'] as string) : undefined;
  const identityComponentMatches = recordId !== undefined && parseTypedIdentifier(recordId).ok && recordId.endsWith(input.component);
  const classLabelMatches = rawParses && obj !== undefined && input.recordClass !== undefined && obj['recordKind'] === RECORD_CLASS_BY_ID.get(input.recordClass)?.label;
  let envelope: RecordObservationFacts | undefined;
  if (rawParses && obj !== undefined && versionSupported && envelopeDeferredOk && digestOk && recordId !== undefined) {
    const revision = obj['revision'];
    const createdAt = obj['createdAt'];
    const previousRecordDigest = obj['previousRecordDigest'];
    const referenceDigests = obj['referenceDigests'];
    envelope = {
      recordId,
      revision: typeof revision === 'number' ? revision : undefined,
      createdAt: typeof createdAt === 'string' ? createdAt : undefined,
      payloadDigest,
      recordDigest: computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, input.raw),
      previousRecordDigest: typeof previousRecordDigest === 'string' ? previousRecordDigest : undefined,
      referenceDigests: Array.isArray(referenceDigests) ? referenceDigests.filter((r): r is string => typeof r === 'string') : undefined,
    };
    if (input.recordClass === 'authoritative-audit-event') {
      const payload = obj['payload'] as Readonly<Record<string, unknown>>;
      const eventKind = payload['eventKind'];
      const primaryRecordId = payload['recordId'];
      const primaryDigest = payload['recordDigest'];
      if (typeof eventKind === 'string') {
        resultAuditAssociation = {
          eventKind,
          primaryRecordId: typeof primaryRecordId === 'string' ? primaryRecordId : undefined,
          primaryDigest: typeof primaryDigest === 'string' ? primaryDigest : undefined,
        };
      }
    }
  }
  return { rawParses, canonicalOk, minimumEnvelopeParses, versionStructurallyValid, versionSupported, envelopeDeferredOk, digestOk, identityComponentMatches, classLabelMatches, envelope, auditAssociation: resultAuditAssociation };
}
