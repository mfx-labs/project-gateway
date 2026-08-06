/**
 * WP-8-B tests: canonical envelope, persisted bytes, and digests
 * (contract 7, RFM-001…014; ITG-001/007).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalEnvelopeBytes,
  computePayloadDigest,
  isValidDigestSyntax,
  isValidVersionSyntax,
  parsePersistedEnvelope,
  payloadDigestMatches,
  validateRecordEnvelope,
  STORAGE_RECORD_BYTES_DIGEST_DOMAIN,
  DIGEST_AUTHORSHIP_DISCLAIMER,
} from '../../../src/storage/index.js';

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordKind: 'ApprovalRecord',
    formatVersion: '1.0',
    recordId: 'pgw:r:' + '0'.repeat(32),
    revision: 1,
    createdAt: '2026-01-01T00:00:00Z',
    trustedActionId: 'trusted-approver-action-1',
    payload: { subject: 'pgw:i:' + 'a'.repeat(32) },
    payloadDigest: 'sha-256:' + '1'.repeat(64),
    ...overrides,
  };
}

test('envelope: valid envelope passes strict validation', () => {
  const v = validateRecordEnvelope(validEnvelope());
  assert.equal(v.ok, true, JSON.stringify(v.findings));
});

test('envelope: unknown fields fail closed (RFM-005)', () => {
  const v = validateRecordEnvelope(validEnvelope({ unexpectedField: 1 }));
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => f.code === 'ENV-UNKNOWN-FIELD'));
});

test('envelope: missing fields fail closed', () => {
  const { payloadDigest: _omit, ...missing } = validEnvelope();
  const v = validateRecordEnvelope(missing);
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => f.code === 'ENV-MISSING-FIELD'));
});

test('envelope: invalid recordKind fails closed (TAX-010)', () => {
  const v = validateRecordEnvelope(validEnvelope({ recordKind: 'UnknownKind' }));
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => f.code === 'ENV-INVALID-KIND'));
});

test('envelope: strict MAJOR.MINOR version syntax (RFM-011)', () => {
  assert.equal(isValidVersionSyntax('1.0'), true);
  assert.equal(isValidVersionSyntax('2.14'), true);
  for (const bad of ['1', '1.0.0', '01.0', '1.x', '', 'v1.0', '1.']) {
    assert.equal(isValidVersionSyntax(bad), false, bad);
  }
  assert.equal(validateRecordEnvelope(validEnvelope({ formatVersion: '1' })).ok, false);
});

test('envelope: revision must be a positive safe integer (RFM-006)', () => {
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
    assert.equal(validateRecordEnvelope(validEnvelope({ revision: bad })).ok, false, String(bad));
  }
});

test('envelope: recordId must be a canonical typed identifier (RFM-003)', () => {
  assert.equal(validateRecordEnvelope(validEnvelope({ recordId: 'not-an-id' })).ok, false);
  assert.equal(validateRecordEnvelope(validEnvelope({ recordId: 'pgw:r:' + 'Z'.repeat(32) })).ok, false);
});

test('envelope: digest syntax checks (RFM-002)', () => {
  assert.equal(isValidDigestSyntax('sha-256:' + 'a'.repeat(64)), true);
  for (const bad of ['sha-256:' + 'A'.repeat(64), 'sha-1:' + 'a'.repeat(40), 'sha-256:' + 'a'.repeat(63), 'md5:' + 'a'.repeat(32)]) {
    assert.equal(isValidDigestSyntax(bad), false, bad);
  }
  assert.equal(validateRecordEnvelope(validEnvelope({ payloadDigest: 'not-a-digest' })).ok, false);
  assert.equal(validateRecordEnvelope(validEnvelope({ previousRecordDigest: 'bad' })).ok, false);
});

test('envelope: canonical bytes are deterministic and length-exact (RFM-014)', () => {
  const a = canonicalEnvelopeBytes(validEnvelope());
  const b = canonicalEnvelopeBytes(validEnvelope());
  assert.equal(a.canonicalUtf8, b.canonicalUtf8);
  assert.equal(a.digest, b.digest);
  assert.equal(a.byteLength, Buffer.byteLength(a.canonicalUtf8, 'utf8'));
  assert.equal(isValidDigestSyntax(a.digest), true);
  // Key order must not affect canonical bytes: reordering yields identical output.
  const reordered: Record<string, unknown> = {};
  const base = validEnvelope();
  for (const k of Object.keys(base).reverse()) reordered[k] = base[k];
  assert.equal(canonicalEnvelopeBytes(reordered).canonicalUtf8, a.canonicalUtf8);
});

test('envelope: raw parse rejects duplicate keys and malformed JSON', () => {
  const dup = `{"recordKind":"ApprovalRecord","recordKind":"ApprovalRecord"}`;
  const r = parsePersistedEnvelope(dup, 4096);
  assert.equal(r.ok, false);
  const malformed = '{not json';
  assert.equal(parsePersistedEnvelope(malformed, 4096).ok, false);
  const validJson = JSON.stringify(validEnvelope());
  const ok = parsePersistedEnvelope(validJson, 4096);
  assert.equal(ok.ok, true);
  if (ok.ok && ok.bytes) {
    assert.equal(ok.bytes.digest, canonicalEnvelopeBytes(ok.model as Record<string, unknown>).digest);
  }
});

test('envelope: payload digest is domain-separated and recomputable (RFM-002, ITG-001)', () => {
  const payload = { subject: 'pgw:i:' + 'a'.repeat(32), purpose: 'review' };
  const d = computePayloadDigest(payload);
  assert.equal(isValidDigestSyntax(d), true);
  assert.equal(payloadDigestMatches(payload, d), true);
  assert.equal(payloadDigestMatches({ subject: 'pgw:i:' + 'b'.repeat(32), purpose: 'review' }, d), false);
});

test('envelope: storage digest domain is distinct from artifact domains', () => {
  assert.equal(STORAGE_RECORD_BYTES_DIGEST_DOMAIN.includes('PGAP-STORAGE'), true);
  assert.equal(STORAGE_RECORD_BYTES_DIGEST_DOMAIN.includes('PGAP-ARTIFACT'), false);
});

test('envelope: digest is never presented as authorship proof', () => {
  assert.ok(DIGEST_AUTHORSHIP_DISCLAIMER.includes('never proof of trusted authorship'));
});
