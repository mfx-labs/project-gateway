/**
 * WP-8-D mechanical write-audit event tests (contract 10.1 step 9, WPR-010,
 * AUD-002/003/005; ADR-029 D-8/D-12). Pure construction tests; the event is
 * filesystem-free by design.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizedWriteAuditEvent, computeAuditEventIdentity, AUTHORIZED_WRITE_EVENT_KIND } from '../../../src/storage/audit/write-audit.js';
import { computePayloadDigest } from '../../../src/storage/format/envelope.js';
import { parseTypedIdentifier } from '../../../src/storage/format/identifier.js';

const STORE = [
  { kind: 'configuration' as const, dev: 1, ino: 11 },
  { kind: 'store-records' as const, dev: 1, ino: 22 },
];
const PRIMARY = 'pgw:r:0123456789abcdef0123456789abcdef';
const DIGEST = 'sha-256:' + 'd'.repeat(64);
const ACTION = 'audit-action-1';
const CREATED_AT = '2026-02-01T00:00:00.000Z';

function input(overrides: Partial<Parameters<typeof buildAuthorizedWriteAuditEvent>[0]> = {}) {
  return {
    storeInstance: STORE,
    primaryClass: 'approval-record',
    primaryRecordId: PRIMARY,
    primaryRevision: 3,
    primaryDigest: DIGEST,
    eventKind: AUTHORIZED_WRITE_EVENT_KIND,
    trustedActionIdentity: ACTION,
    primaryCreatedAt: CREATED_AT,
    ...overrides,
  };
}

test('audit: identity is deterministic, domain-separated and pgw:l:<32-hex>', () => {
  const a = computeAuditEventIdentity(input());
  const b = computeAuditEventIdentity(input());
  assert.equal(a, b, 'identical tuples yield identical identities');
  assert.match(a, /^pgw:l:[0-9a-f]{32}$/);
  const parsed = parseTypedIdentifier(a, 'pgw:l:');
  assert.equal(parsed.ok, true);
  // Every tuple member changes the identity (no counter, nonce, PID, or path
  // may enter the input).
  assert.notEqual(computeAuditEventIdentity(input({ primaryDigest: 'sha-256:' + 'e'.repeat(64) })), a, 'primary digest must be in the tuple');
  assert.notEqual(computeAuditEventIdentity(input({ trustedActionIdentity: 'other-action' })), a, 'trusted action identity must be in the tuple');
  assert.notEqual(computeAuditEventIdentity(input({ primaryRecordId: 'pgw:r:ffffffffffffffffffffffffffffffff' })), a, 'primary identity must be in the tuple');
  assert.notEqual(computeAuditEventIdentity(input({ primaryRevision: 4 })), a, 'primary revision must be in the tuple');
  assert.notEqual(computeAuditEventIdentity(input({ primaryClass: 'issuance-record' })), a, 'primary class must be in the tuple');
  assert.notEqual(computeAuditEventIdentity(input({ storeInstance: [{ kind: 'store-records', dev: 1, ino: 99 }] })), a, 'store identity must be in the tuple');
});

test('audit: event envelope carries evidence fields and the primary logical time', () => {
  const built = buildAuthorizedWriteAuditEvent(input());
  assert.equal(built.ok, true);
  const event = built.event!;
  assert.equal(event.recordId, computeAuditEventIdentity(input()));
  assert.equal(event.envelope['recordKind'], 'AuthoritativeAuditEvent');
  assert.equal(event.envelope['formatVersion'], '1.0');
  assert.equal(event.envelope['recordId'], event.recordId);
  assert.equal(event.envelope['revision'], 1);
  assert.equal(event.envelope['createdAt'], CREATED_AT, 'audit createdAt represents the primary logical creation time');
  assert.equal(event.envelope['trustedActionId'], ACTION);
  const payload = event.envelope['payload'] as Record<string, unknown>;
  assert.equal(payload['eventKind'], 'authorized-write');
  assert.equal(payload['recordId'], PRIMARY);
  assert.equal(payload['recordDigest'], DIGEST);
  assert.deepEqual(event.envelope['referenceDigests'], [DIGEST]);
  assert.equal(event.envelope['retentionClass'], 'indefinite');
  // The declared payload digest verifies (digest-bound, AUD-003).
  assert.equal(event.envelope['payloadDigest'], computePayloadDigest(payload));
  // Deterministic canonical bytes: identical inputs → identical bytes.
  assert.equal(event.canonicalUtf8, buildAuthorizedWriteAuditEvent(input()).event!.canonicalUtf8);
  assert.match(event.digest, /^sha-256:[0-9a-f]{64}$/);
});

test('audit: ordering tuple is the stable (primary createdAt, primary identity, event identity) order', () => {
  const event = buildAuthorizedWriteAuditEvent(input()).event!;
  assert.deepEqual(event.ordering, [CREATED_AT, PRIMARY, event.recordId]);
});

test('audit: only the authorized-write kind is implemented (D-12)', () => {
  const other = buildAuthorizedWriteAuditEvent(input({ eventKind: 'conflict' as never }));
  assert.equal(other.ok, false);
  assert.equal(other.code, 'ERR-STO-REQ-INVALID');
  const badDigest = buildAuthorizedWriteAuditEvent(input({ primaryDigest: 'not-a-digest' }));
  assert.equal(badDigest.ok, false);
});

test('audit: a different action cannot forge the identity of the publishing action', () => {
  // The identity binds the action; a retry by the same action reproduces the
  // same event, a different action produces a different event (D-8 B/C).
  const same = buildAuthorizedWriteAuditEvent(input()).event!;
  const different = buildAuthorizedWriteAuditEvent(input({ trustedActionIdentity: 'other-action' })).event!;
  assert.notEqual(same.recordId, different.recordId);
  assert.notEqual(same.canonicalUtf8, different.canonicalUtf8);
});
