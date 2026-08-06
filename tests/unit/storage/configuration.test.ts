/**
 * WP-8-B tests: pure configuration-chain verification (contract 3.6,
 * CSR-012…016) and the `ConfigurationSnapshotRecord` profile (TAX-014).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainFindingErrorCode,
  isRollbackRepresentableAsNewVersion,
  isStructurallyValidSuccessor,
  validateConfigurationSnapshotRecord,
  verifyConfigurationChain,
} from '../../../src/storage/index.js';
import type { ConfigurationChainInput } from '../../../src/storage/index.js';

function snap(revision: number, digestChar: string, predecessorId?: string, predecessorDigest?: string): ConfigurationChainInput {
  const recordId = `pgw:l:${digestChar.repeat(32)}`;
  return {
    revision,
    recordId,
    predecessorId,
    predecessorDigest,
    payloadDigest: 'sha-256:' + digestChar.repeat(64),
    canonicalUtf8: `{"revision":${revision},"id":"${recordId}"}`,
    recordDigest: 'sha-256:' + digestChar.repeat(64),
  };
}

function chain(revisions: number[], options: { gaps?: boolean; corrupt?: boolean } = {}): ConfigurationChainInput[] {
  const out: ConfigurationChainInput[] = [];
  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i]!;
    const prev = out[out.length - 1];
    const digestChar = String.fromCharCode(97 + (i % 26));
    if (options.corrupt && i === revisions.length - 1) {
      out.push(snap(rev, digestChar, prev?.recordId, 'sha-256:' + 'f'.repeat(64)));
    } else {
      out.push(snap(rev, digestChar, prev?.recordId, prev?.recordDigest));
    }
  }
  return out;
}

test('configuration: snapshot validator rejects incomplete non-genesis predecessor fields (W8B-C01)', () => {
  const base = { recordId: 'pgw:l:' + 'a'.repeat(32), formatVersion: '1.0', revision: 2, payloadDigest: 'sha-256:' + 'b'.repeat(64), trustedActionId: 'control-plane-action-1', createdAt: '2026-01-01T00:00:00Z' };
  // neither predecessor field
  assert.equal(validateConfigurationSnapshotRecord(base).ok, false);
  // identity only
  assert.equal(validateConfigurationSnapshotRecord({ ...base, predecessorId: 'pgw:l:' + 'c'.repeat(32) }).ok, false);
  // digest only
  assert.equal(validateConfigurationSnapshotRecord({ ...base, predecessorDigest: 'sha-256:' + 'd'.repeat(64) }).ok, false);
  // malformed digest with identity
  assert.equal(validateConfigurationSnapshotRecord({ ...base, predecessorId: 'pgw:l:' + 'c'.repeat(32), predecessorDigest: 'nope' }).ok, false);
  // malformed identity with digest
  assert.equal(validateConfigurationSnapshotRecord({ ...base, predecessorId: 'not-an-id', predecessorDigest: 'sha-256:' + 'd'.repeat(64) }).ok, false);
  // both valid
  assert.equal(validateConfigurationSnapshotRecord({ ...base, predecessorId: 'pgw:l:' + 'c'.repeat(32), predecessorDigest: 'sha-256:' + 'd'.repeat(64) }).ok, true);
});

test('configuration: snapshot record structural validation', () => {
  const valid = {
    recordId: 'pgw:l:' + 'a'.repeat(32),
    formatVersion: '1.0',
    revision: 1,
    payloadDigest: 'sha-256:' + 'b'.repeat(64),
    trustedActionId: 'control-plane-action-1',
    createdAt: '2026-01-01T00:00:00Z',
  };
  const ok = validateConfigurationSnapshotRecord(valid);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.snapshot.revision, 1);
  assert.equal(validateConfigurationSnapshotRecord({ ...valid, revision: 0 }).ok, false);
  assert.equal(validateConfigurationSnapshotRecord({ ...valid, revision: 2, predecessorId: 'pgw:l:' + 'c'.repeat(32), predecessorDigest: 'sha-256:' + 'd'.repeat(64) }).ok, true);
  // genesis must not carry a predecessor
  assert.equal(validateConfigurationSnapshotRecord({ ...valid, predecessorId: 'pgw:l:' + 'c'.repeat(32) }).ok, false);
  assert.equal(validateConfigurationSnapshotRecord({ ...valid, bogus: 1 }).ok, false);
  assert.equal(validateConfigurationSnapshotRecord({ ...valid, payloadDigest: 'nope' }).ok, false);
  assert.equal(validateConfigurationSnapshotRecord({ ...valid, recordId: 'bad' }).ok, false);
});

test('configuration: valid chain selects the unique head', () => {
  const r = verifyConfigurationChain(chain([1, 2, 3]));
  assert.equal(r.selectedHead?.revision, 3);
  assert.equal(r.heads.length, 1);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
});

test('configuration: missing genesis fails closed', () => {
  const r = verifyConfigurationChain(chain([2, 3]));
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('genesis')));
  assert.equal(chainFindingErrorCode('missing-genesis'), 'ERR-STO-CONFIG-UNAVAILABLE');
});

test('configuration: idempotent duplicate is deduplicated with evidence', () => {
  const base = chain([1, 2]);
  const dup = { ...base[1]! };
  const r = verifyConfigurationChain([...base, dup]);
  assert.equal(r.selectedHead?.revision, 2);
  assert.ok(r.findings.some((f) => f.message.includes('idempotent duplicate')));
  assert.equal(chainFindingErrorCode('idempotent-duplicate'), 'ERR-STO-DUPLICATE');
});

test('configuration: conflicting duplicate fails closed', () => {
  const base = chain([1]);
  const conflicting = snap(1, 'z', undefined, undefined); // same revision 1, different bytes
  const r = verifyConfigurationChain([base[0]!, conflicting]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('multiple distinct records claim the same configuration revision')));
  assert.equal(chainFindingErrorCode('conflicting-duplicate'), 'ERR-STO-CONFLICT-REVISION');
});

test('configuration: gap fails closed', () => {
  // revisions 1 and 3 linked with a missing revision 2.
  const one = snap(1, 'a');
  const three = snap(3, 'b', one.recordId, one.recordDigest);
  const r = verifyConfigurationChain([one, three]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('gap')));
});

test('configuration: fork / multiple heads fails closed', () => {
  const one = snap(1, 'a');
  const twoA = snap(2, 'b', one.recordId, one.recordDigest);
  const twoB = snap(2, 'c', one.recordId, one.recordDigest);
  const r = verifyConfigurationChain([one, twoA, twoB]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('multiple configuration heads')));
});

test('configuration: missing predecessor fails closed', () => {
  const two = snap(2, 'b', 'pgw:l:' + 'f'.repeat(32), 'sha-256:' + 'e'.repeat(64));
  const r = verifyConfigurationChain([two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor')));
  assert.equal(chainFindingErrorCode('missing-predecessor'), 'ERR-STO-INTEGRITY');
});

test('configuration: non-genesis with predecessor identity but no digest fails closed (W8B-C01)', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b', one.recordId, undefined);
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor digest')));
  assert.equal(chainFindingErrorCode('incomplete-predecessor'), 'ERR-STO-INTEGRITY');
});

test('configuration: non-genesis with digest but no predecessor identity fails closed (W8B-C01)', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b', undefined, one.recordDigest);
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor identity')));
});

test('configuration: non-genesis with neither predecessor field fails closed (W8B-C01)', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b');
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor identity')));
});

test('configuration: genesis with predecessor identity fails closed (W8B-C01)', () => {
  const g = snap(1, 'a', 'pgw:l:' + 'c'.repeat(32), undefined);
  const r = verifyConfigurationChain([g]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('genesis')));
  assert.equal(chainFindingErrorCode('genesis-with-predecessor'), 'ERR-STO-INTEGRITY');
});

test('configuration: genesis with predecessor digest fails closed (W8B-C01)', () => {
  const g = snap(1, 'a', undefined, 'sha-256:' + 'c'.repeat(64));
  const r = verifyConfigurationChain([g]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('genesis')));
});

test('configuration: genesis with both predecessor fields fails closed (W8B-C01)', () => {
  const g = snap(1, 'a', 'pgw:l:' + 'c'.repeat(32), 'sha-256:' + 'c'.repeat(64));
  const r = verifyConfigurationChain([g]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('genesis')));
});

test('configuration: malformed predecessor digest fails closed (W8B-C01)', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b', one.recordId, 'not-a-digest');
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor digest')));
});

test('configuration: malformed predecessor identity fails closed at chain level (W8B-M02)', () => {
  // Direct chain input: revision 2 with a malformed predecessor identity and
  // a syntactically valid predecessor digest; exercises the defensive chain
  // branch directly (not only the snapshot validator).
  const one = snap(1, 'a');
  const two = snap(2, 'b', 'not-an-id', one.recordDigest);
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor identity')));
  assert.equal(chainFindingErrorCode('incomplete-predecessor'), 'ERR-STO-INTEGRITY');
  // The invalid record cannot participate in traversal: the same defect is
  // reported for a set containing only the malformed non-genesis record.
  const alone = verifyConfigurationChain([two]);
  assert.equal(alone.selectedHead, undefined);
  assert.ok(alone.findings.some((f) => f.message.includes('predecessor identity')));
  // Deterministic under input reversal.
  const reversed = verifyConfigurationChain([two, one]);
  assert.equal(reversed.selectedHead, undefined);
  assert.deepEqual(reversed.findings.map((f) => f.code), r.findings.map((f) => f.code));
});

test('configuration: direct chain input bypassing snapshot validation fails closed (W8B-C01)', () => {
  // Caller constructs chain inputs directly (bypassing
  // validateConfigurationSnapshotRecord) with a revision-2 record that has a
  // predecessor identity but no predecessor digest. The chain validator MUST
  // fail closed defensively and MUST NOT select a head.
  const one = { revision: 1, recordId: 'pgw:l:' + 'a'.repeat(32), payloadDigest: 'sha-256:' + 'a'.repeat(64), canonicalUtf8: '{"r":1}', recordDigest: 'sha-256:' + 'a'.repeat(64) };
  const two = { revision: 2, recordId: 'pgw:l:' + 'b'.repeat(32), predecessorId: one.recordId, payloadDigest: 'sha-256:' + 'b'.repeat(64), canonicalUtf8: '{"r":2}', recordDigest: 'sha-256:' + 'b'.repeat(64) };
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor digest')));
});

test('configuration: valid non-genesis with both predecessor fields selects the head (W8B-C01)', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b', one.recordId, one.recordDigest);
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead?.revision, 2);
  assert.equal(r.findings.length, 0);
});

test('configuration: corrupted predecessor reference fails closed', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b', one.recordId, 'sha-256:' + 'f'.repeat(64)); // wrong digest
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead, undefined);
  assert.ok(r.findings.some((f) => f.message.includes('predecessor digest')));
  assert.equal(chainFindingErrorCode('corrupted-predecessor'), 'ERR-STO-INTEGRITY');
});

test('configuration: disconnected chain fails closed', () => {
  const one = snap(1, 'a');
  const two = snap(2, 'b', one.recordId, one.recordDigest);
  // A cyclic pair disconnected from the head: neither member is a head.
  const d = snap(7, 'd', 'pgw:l:' + 'e'.repeat(32), 'sha-256:' + 'e'.repeat(64));
  const e = snap(8, 'e', 'pgw:l:' + 'd'.repeat(32), 'sha-256:' + 'd'.repeat(64));
  const r = verifyConfigurationChain([one, two, d, e]);
  assert.equal(r.selectedHead?.revision, 2);
  assert.ok(r.findings.some((f) => f.message.includes('disconnected')));
  assert.equal(chainFindingErrorCode('disconnected-chain'), 'ERR-STO-INTEGRITY');
});

test('configuration: deterministic head selection and repeat generation', () => {
  const input = chain([1, 2, 3, 4]);
  const a = verifyConfigurationChain(input);
  const b = verifyConfigurationChain([...input].reverse());
  assert.equal(a.selectedHead?.recordId, b.selectedHead?.recordId);
  assert.equal(a.selectedHead?.revision, 4);
  assert.deepEqual(a.findings.map((f) => f.message), b.findings.map((f) => f.message));
});

test('configuration: rollback-as-new-version structural representation (CSR-015)', () => {
  // A return to earlier policy content is a NEW version that is the immediate
  // successor of the current head; the structure is validated, never the policy.
  assert.equal(isStructurallyValidSuccessor(4, 5), true);
  assert.equal(isStructurallyValidSuccessor(4, 6), false);
  assert.equal(isStructurallyValidSuccessor(undefined, 1), true);
  assert.equal(isRollbackRepresentableAsNewVersion(4, 5, true), true);
  assert.equal(isRollbackRepresentableAsNewVersion(4, 5, false), false);
  assert.equal(isRollbackRepresentableAsNewVersion(4, 3, true), false);
  assert.equal(isRollbackRepresentableAsNewVersion(undefined, 1, true), true);
});

test('configuration: chain verification never decides policy acceptance', () => {
  // Any structurally valid chain yields selection regardless of payload content;
  // payload content is opaque to the verifier.
  const one = snap(1, 'a');
  const two = snap(2, 'b', one.recordId, one.recordDigest);
  const r = verifyConfigurationChain([one, two]);
  assert.equal(r.selectedHead?.revision, 2);
  assert.equal(r.findings.length, 0);
});
