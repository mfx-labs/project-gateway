/**
 * WP-8 record format: canonical envelope, persisted bytes, and digests
 * (contract 7, RFM-001…014).
 *
 * Pure helpers: accept already-parsed or explicitly parsed record data,
 * reuse the accepted WP-3/WP-4 canonicalization (RFC 8785 via the committed
 * `jcsSerialize`) and digest semantics, reject duplicate keys via the
 * committed raw-JSON scanner, and never interpret a digest as authorship,
 * approval, issuance, grant, or activation (ITG-007).
 */
import { createHash } from 'node:crypto';
import { parseRawJson } from '../../json/scanner.js';
import { jcsSerialize } from '../../canonical/jcs.js';
import { isNfc } from '../../canonical/input.js';
import { DIGEST_RE } from '../../digest/index.js';
import type { PersistedByteDescriptor, RecordEnvelope } from '../types.js';
import { RECORD_CLASS_PROFILES } from './taxonomy.js';
import { parseTypedIdentifier } from './identifier.js';

/** WP-8 storage digest domains (domain-separated; never reuse artifact domains). */
export const STORAGE_PAYLOAD_DIGEST_DOMAIN = 'PGAP-STORAGE-PAYLOAD-v1\u0000';
export const STORAGE_RECORD_BYTES_DIGEST_DOMAIN = 'PGAP-STORAGE-RECORD-BYTES-v1\u0000';
export const STORAGE_METADATA_DIGEST_DOMAIN = 'PGAP-STORAGE-METADATA-v1\u0000';

/** Strict two-component MAJOR.MINOR version syntax (WP-2; RFM-011). */
const VERSION_RE = /^[1-9][0-9]*\.(0|[1-9][0-9]*)$/;

export function isValidVersionSyntax(v: string): boolean {
  return VERSION_RE.test(v);
}

/** Domain-separated SHA-256 digest over canonical UTF-8 bytes. */
export function computeDomainDigest(domain: string, canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

export function isValidDigestSyntax(d: string): boolean {
  return DIGEST_RE.test(d);
}

const ENVELOPE_FIELDS = [
  'recordKind',
  'formatVersion',
  'recordId',
  'revision',
  'createdAt',
  'trustedActionId',
  'payload',
  'payloadDigest',
  'referenceDigests',
  'previousRecordDigest',
  'integrityMetadata',
  'retentionClass',
] as const;

export type EnvelopeFindingCode = 'ENV-UNKNOWN-FIELD' | 'ENV-MISSING-FIELD' | 'ENV-INVALID-KIND' | 'ENV-VERSION-SYNTAX' | 'ENV-REVISION' | 'ENV-RECORD-ID' | 'ENV-DIGEST-SYNTAX' | 'ENV-NFC' | 'ENV-ACTION-ID' | 'ENV-CANONICAL';

export interface EnvelopeFinding {
  readonly code: EnvelopeFindingCode;
  readonly message: string;
  readonly path: string;
}

export interface EnvelopeValidation {
  readonly ok: boolean;
  readonly findings: readonly EnvelopeFinding[];
}

function finding(code: EnvelopeFindingCode, message: string, path: string): EnvelopeFinding {
  return { code, message, path };
}

/** Strict envelope validation (RFM-001/005/010/011/012; unknown fields fail closed). */
export function validateRecordEnvelope(model: Readonly<Record<string, unknown>>): EnvelopeValidation {
  const findings: EnvelopeFinding[] = [];
  for (const key of Object.keys(model)) {
    if (!(ENVELOPE_FIELDS as readonly string[]).includes(key)) {
      findings.push(finding('ENV-UNKNOWN-FIELD', `unknown envelope field`, `/envelope/${key}`));
    }
  }
  const required: readonly (keyof RecordEnvelope)[] = [
    'recordKind',
    'formatVersion',
    'recordId',
    'revision',
    'createdAt',
    'trustedActionId',
    'payload',
    'payloadDigest',
  ];
  for (const f of required) {
    if (!(f in model)) findings.push(finding('ENV-MISSING-FIELD', `missing envelope field`, `/envelope/${String(f)}`));
  }
  if (findings.length > 0) return { ok: false, findings };
  const kind = model['recordKind'];
  if (typeof kind !== 'string' || !RECORD_CLASS_PROFILES.some((p) => p.label === kind)) {
    findings.push(finding('ENV-INVALID-KIND', 'unknown or unsupported recordKind', '/envelope/recordKind'));
  }
  const version = model['formatVersion'];
  if (typeof version !== 'string' || !isValidVersionSyntax(version)) {
    findings.push(finding('ENV-VERSION-SYNTAX', 'formatVersion must use strict MAJOR.MINOR syntax', '/envelope/formatVersion'));
  }
  const revision = model['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    findings.push(finding('ENV-REVISION', 'revision must be a positive safe integer', '/envelope/revision'));
  }
  const recordId = model['recordId'];
  if (typeof recordId !== 'string' || !parseTypedIdentifier(recordId).ok) {
    findings.push(finding('ENV-RECORD-ID', 'recordId must be a canonical typed identifier', '/envelope/recordId'));
  }
  const payloadDigest = model['payloadDigest'];
  if (typeof payloadDigest !== 'string' || !isValidDigestSyntax(payloadDigest)) {
    findings.push(finding('ENV-DIGEST-SYNTAX', 'payloadDigest must use sha-256:<64-hex> syntax', '/envelope/payloadDigest'));
  }
  const prev = model['previousRecordDigest'];
  if (prev !== undefined && (typeof prev !== 'string' || !isValidDigestSyntax(prev))) {
    findings.push(finding('ENV-DIGEST-SYNTAX', 'previousRecordDigest must use sha-256:<64-hex> syntax', '/envelope/previousRecordDigest'));
  }
  const refs = model['referenceDigests'];
  if (refs !== undefined && (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string' || !isValidDigestSyntax(r)))) {
    findings.push(finding('ENV-DIGEST-SYNTAX', 'referenceDigests must be an array of digest strings', '/envelope/referenceDigests'));
  }
  const actionId = model['trustedActionId'];
  if (typeof actionId !== 'string' || actionId.length === 0) {
    findings.push(finding('ENV-ACTION-ID', 'trustedActionId must be a non-empty string', '/envelope/trustedActionId'));
  }
  for (const s of [kind, version, recordId, actionId, model['createdAt']]) {
    if (typeof s === 'string' && !isNfc(s)) {
      findings.push(finding('ENV-NFC', 'envelope string fields must be NFC', '/envelope'));
      break;
    }
  }
  return { ok: findings.length === 0, findings };
}

/**
 * Produce the deterministic canonical persisted bytes for a validated
 * envelope (RFM-014): RFC 8785 serialization of the envelope model with
 * sorted keys; identical logical records yield identical bytes.
 */
export function canonicalEnvelopeBytes(model: Readonly<Record<string, unknown>>): PersistedByteDescriptor {
  const canonicalUtf8 = jcsSerialize(model);
  const byteLength = Buffer.byteLength(canonicalUtf8, 'utf8');
  const digest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalUtf8);
  return { canonicalUtf8, byteLength, digest };
}

/**
 * Parse raw persisted JSON with duplicate-key rejection and byte bounds
 * (WP-3 profile), then validate the envelope structure strictly.
 */
export function parsePersistedEnvelope(rawJson: string, byteLimit: number): EnvelopeParseOutcome {
  let model: unknown;
  try {
    model = parseRawJson(rawJson, byteLimit).model;
  } catch {
    return { ok: false, findings: [finding('ENV-CANONICAL', 'malformed JSON or duplicate object member', '/envelope')] };
  }
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    return { ok: false, findings: [finding('ENV-CANONICAL', 'envelope must be a JSON object', '/envelope')] };
  }
  const validation = validateRecordEnvelope(model as Readonly<Record<string, unknown>>);
  if (!validation.ok) return { ok: false, findings: validation.findings };
  const bytes = canonicalEnvelopeBytes(model as Readonly<Record<string, unknown>>);
  return { ok: true, model: model as Readonly<Record<string, unknown>>, bytes };
}

export interface EnvelopeParseOutcome {
  readonly ok: boolean;
  readonly model?: Readonly<Record<string, unknown>>;
  readonly bytes?: PersistedByteDescriptor;
  readonly findings?: readonly EnvelopeFinding[];
}

/** Canonical payload digest (RFM-002) over the canonical digest input. */
export function computePayloadDigest(payload: Readonly<Record<string, unknown>>): string {
  return computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, jcsSerialize(payload));
}

/** Deterministic digest comparison (ITG-001). */
export function payloadDigestMatches(payload: Readonly<Record<string, unknown>>, declared: string): boolean {
  return isValidDigestSyntax(declared) && computePayloadDigest(payload) === declared;
}

/** Never treat any digest as proof of authorship or approval (ITG-007/008). */
export const DIGEST_AUTHORSHIP_DISCLAIMER =
  'A digest verifies content integrity only; it is never proof of trusted authorship, approval, issuance, grant, or activation.';
