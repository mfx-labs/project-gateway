/**
 * Focused correction tests: Unicode surrogate handling, canonical-input
 * exclusion traversal, deep immutable wrappers, runtime branding, and explicit
 * validation levels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRawJsonInput,
  createSchemaRegistry,
  validateArtifactSelf,
  validateArtifactRevision,
  validateLifecycleRecord,
  validateRegistrySnapshot,
  computeArtifactDigest,
  MemoryIdentityState,
  snapshotJson,
  isBrandedArtifact,
  isBrandedRegistry,
} from '../../src/index.js';
import { validateCanonicalInput } from '../../src/canonical/input.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import type { ValidatedArtifact, ValidationLevel } from '../../src/api/types.js';

const reg = createSchemaRegistry();
const corpus = CORPUS_INPUTS as Record<string, string>;
function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
}
function taskModel(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/task-minimal-genesis.json'))) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Correction 2 — Unicode surrogate handling
// ---------------------------------------------------------------------------
test('unicode: valid escaped surrogate pair accepted', () => {
  const r = parseRawJsonInput('{"s":"\\uD83D\\uDE00"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r.model as Record<string, unknown>)['s'], '\u{1F600}');
});

test('unicode: literal supplementary character accepted', () => {
  const r = parseRawJsonInput('{"s":"\u{1F600}"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r.model as Record<string, unknown>)['s'], '\u{1F600}');
});

test('unicode: escaped pair and literal produce equal accepted data model', () => {
  const a = parseRawJsonInput('{"s":"\\uD83D\\uDE00"}', { subjectClass: 'artifact' });
  const b = parseRawJsonInput('{"s":"\u{1F600}"}', { subjectClass: 'artifact' });
  assert.deepEqual(a, b);
});

test('unicode: isolated escaped high surrogate rejected', () => {
  const r = parseRawJsonInput('{"s":"\\uD83D"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('unicode: isolated escaped low surrogate rejected', () => {
  const r = parseRawJsonInput('{"s":"\\uDE00"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('unicode: high surrogate followed by non-low surrogate rejected', () => {
  const r = parseRawJsonInput('{"s":"\\uD83D\\u0041"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('unicode: high surrogate followed by ordinary escaped character rejected', () => {
  const r = parseRawJsonInput('{"s":"\\uD83D\\n"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('unicode: raw JS lone high surrogate rejected before encoding', () => {
  const r = parseRawJsonInput('{"s":"\uD83D"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('unicode: raw JS lone low surrogate rejected before encoding', () => {
  const r = parseRawJsonInput('{"s":"\uDE00"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('unicode: invalid UTF-8 byte sequence rejected without replacement', () => {
  const r = parseRawJsonInput(new Uint8Array([0x7b, 0x22, 0x73, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
  assert.ok(!r.report.findings[0]?.message.includes('FFFD'));
});

test('unicode: no U+FFFD repair on lone surrogates', () => {
  const r = parseRawJsonInput('{"s":"\\uD800"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  const raw = parseRawJsonInput('{"s":"\uD800"}', { subjectClass: 'artifact' });
  assert.equal(raw.ok, false);
});

test('unicode: nested valid supplementary characters accepted', () => {
  const r = parseRawJsonInput('{"a":[{"b":"x\\uD83D\\uDE00y"}]}', { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
});

test('unicode: duplicate key containing supplementary characters rejected', () => {
  const r = parseRawJsonInput('{"\u{1F600}":1,"\u{1F600}":2}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'DUPLICATE-MEMBER');
});

// ---------------------------------------------------------------------------
// Correction 7 — canonical-input exclusion traversal and member names
// ---------------------------------------------------------------------------
function annotate(model: Record<string, unknown>, annotation: unknown): Record<string, unknown> {
  const t = JSON.parse(JSON.stringify(model));
  t['annotations'] = annotation;
  return t;
}

test('canonical-input: non-NFC top-level annotation value is excluded from digest coverage', () => {
  const t = annotate(taskModel(), { title: 'cafe\u0301' });
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, true);
  const base = computeArtifactDigest(taskModel());
  assert.equal(computeArtifactDigest(t).digest, base.digest);
});

test('canonical-input: non-NFC nested annotation value is excluded', () => {
  const t = annotate(taskModel(), { comments: ['cafe\u0301'] });
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, true);
});

test('canonical-input: annotation-only change leaves digest unchanged', () => {
  const base = computeArtifactDigest(taskModel());
  const withAnn = annotate(taskModel(), { title: 'changed' });
  assert.equal(computeArtifactDigest(withAnn).digest, base.digest);
});

test('canonical-input: non-NFC body value rejected', () => {
  const t = taskModel();
  (t['body'] as Record<string, unknown>)['objective'] = 'cafe\u0301';
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, false);
  assert.equal(canonical.category, 'NON-NFC-STRING');
});

test('canonical-input: non-NFC body member name rejected', () => {
  const t = taskModel();
  const body = t['body'] as Record<string, unknown>;
  body['cafe\u0301'] = 'x';
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, false);
  assert.equal(canonical.category, 'NON-NFC-STRING');
});

test('canonical-input: nested body field named annotations remains digest-covered', () => {
  const t = taskModel();
  const body = t['body'] as Record<string, unknown>;
  body['annotations'] = { note: 'cafe\u0301' };
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, false);
  assert.equal(canonical.category, 'NON-NFC-STRING');
});

test('canonical-input: nested field named digest remains digest-covered', () => {
  const t = taskModel();
  const body = t['body'] as Record<string, unknown>;
  body['digest'] = 'cafe\u0301';
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, false);
  assert.equal(canonical.category, 'NON-NFC-STRING');
});

test('canonical-input: revision.digest exclusion is path-specific', () => {
  const t = taskModel();
  const rev = t['revision'] as Record<string, unknown>;
  rev['digest'] = 'cafe\u0301'; // excluded value; syntax checked at the digest phase
  const canonical = validateCanonicalInput(t, { subjectClass: 'artifact' });
  assert.equal(canonical.ok, true);
});

test('canonical-input: registry snapshot derived digest exclusion is path-specific', () => {
  const snap = loadJson('fixtures/registry/valid/registry-v1.json');
  const canonical = validateCanonicalInput(snap, { subjectClass: 'registry' });
  assert.equal(canonical.ok, true);
});

// ---------------------------------------------------------------------------
// Correction 5 — deep immutability and runtime branding
// ---------------------------------------------------------------------------
test('immutable: mutating original top-level object after validation has no effect', () => {
  const t = taskModel();
  const report = validateArtifactSelf(t, reg);
  const digest = (report.value as ValidatedArtifact).digest;
  (t as Record<string, unknown>)['instance_id'] = 'pgw:i:' + '9'.repeat(32);
  assert.equal((report.value as ValidatedArtifact).instanceId, taskModel()['instance_id']);
  assert.equal((report.value as ValidatedArtifact).digest, digest);
});

test('immutable: mutating original nested object has no effect', () => {
  const t = taskModel();
  const report = validateArtifactSelf(t, reg);
  const model = (report.value as ValidatedArtifact).model;
  const objective = (model['body'] as Record<string, unknown>)['objective'];
  (t['body'] as Record<string, unknown>)['objective'] = 'changed';
  assert.equal((model['body'] as Record<string, unknown>)['objective'], objective);
});

test('immutable: mutating original nested array has no effect', () => {
  const t = taskModel();
  const report = validateArtifactSelf(t, reg);
  const model = (report.value as ValidatedArtifact).model;
  const first = (model['body'] as Record<string, unknown>)['instructions'];
  ((t['body'] as Record<string, unknown>)['instructions'] as unknown[]).push({ instruction_id: 'x', text: 'y' });
  assert.deepEqual((model['body'] as Record<string, unknown>)['instructions'], first);
});

test('immutable: mutating validated nested object has no effect (frozen)', () => {
  const report = validateArtifactSelf(taskModel(), reg);
  const body = (report.value as ValidatedArtifact).model['body'] as Record<string, unknown>;
  assert.equal(Object.isFrozen(body), true);
  assert.throws(() => {
    'use strict';
    body['objective'] = 'nope';
  });
});

test('immutable: mutating validated nested array has no effect (frozen)', () => {
  const report = validateArtifactSelf(taskModel(), reg);
  const instructions = (report.value as ValidatedArtifact).model['body'] as Record<string, unknown>;
  const arr = instructions['instructions'] as unknown[];
  assert.equal(Object.isFrozen(arr), true);
});

test('immutable: altering caller prototype after validation has no effect', () => {
  const t = taskModel();
  const report = validateArtifactSelf(t, reg);
  const proto = Object.getPrototypeOf(t) as Record<string, unknown>;
  proto['polluted'] = true;
  assert.equal((report.value as ValidatedArtifact).model['polluted'], undefined);
  delete proto['polluted'];
});

test('immutable: getter is not executed during snapshot', () => {
  const t = taskModel();
  let calls = 0;
  Object.defineProperty(t, 'booby', {
    enumerable: true,
    get() {
      calls++;
      return 'x';
    },
  });
  // the snapshot boundary never invokes accessors: it rejects them instead
  assert.throws(() => snapshotJson(t));
  assert.equal(calls, 0);
});

test('branding: forged wrapper fails brand guard', () => {
  const report = validateArtifactSelf(taskModel(), reg);
  const real = report.value as ValidatedArtifact;
  const forged = {
    kind: real.kind,
    instanceId: real.instanceId,
    revisionId: real.revisionId,
    digest: real.digest,
    canonicalUtf8: real.canonicalUtf8,
    level: 'point-of-use-eligible' as ValidationLevel,
    model: real.model,
  };
  // no exported symbol can forge the brand: membership is module-private and
  // the forged plain object is not a member
  assert.equal(Object.getOwnPropertySymbols(forged).length, 0);
  assert.equal(isBrandedArtifact(forged), false);
  assert.equal(isBrandedArtifact(real), true);
});

test('branding: validated artifact brand differs from registry brand', () => {
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const snap = validateRegistrySnapshot(loadJson('fixtures/registry/valid/registry-v1.json'), reg).value;
  // membership branding is module-private: no brand symbol is exposed, yet the
  // artifact and registry guards distinguish the two wrappers
  assert.equal(Object.getOwnPropertySymbols(a).length, 0);
  assert.equal(snap ? Object.getOwnPropertySymbols(snap).length : -1, 0);
  assert.equal(isBrandedArtifact(a), true);
  assert.equal(isBrandedRegistry(a), false);
  assert.equal(isBrandedArtifact(snap), false);
  assert.equal(isBrandedRegistry(snap), true);
});

test('branding: wrappers from the same physical module instance remain recognized', () => {
  const a = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const b = validateArtifactSelf(taskModel(), createSchemaRegistry()).value as ValidatedArtifact;
  // branding is valid within the physical module instance that created the
  // wrapper; separate library instances share the same module instance
  assert.equal(isBrandedArtifact(a), true);
  assert.equal(isBrandedArtifact(b), true);
  assert.equal(Object.getOwnPropertySymbols(a).length, 0);
});

test('immutable: digest and model remain consistent after attempted mutations', () => {
  const t = taskModel();
  const report = validateArtifactSelf(t, reg);
  const v = report.value as ValidatedArtifact;
  (t['body'] as Record<string, unknown>)['objective'] = 'mutated';
  const recomputed = computeArtifactDigest(v.model);
  assert.equal(recomputed.digest, v.digest);
  assert.equal(recomputed.canonicalUtf8, v.canonicalUtf8);
});

// ---------------------------------------------------------------------------
// Correction 6 — explicit validation levels
// ---------------------------------------------------------------------------
test('levels: self validation reports self-semantic-valid level', () => {
  const report = validateArtifactSelf(taskModel(), reg);
  assert.equal(report.ok, true);
  assert.equal((report.value as ValidatedArtifact).level, 'self-semantic-valid');
});

test('levels: controlled validation records its phase', () => {
  const report = validateArtifactRevision(taskModel(), reg, 'canonicalization-and-digest-verification');
  assert.equal(report.ok, true);
  assert.equal((report.value as ValidatedArtifact).level, 'digest-verified');
});

test('levels: lifecycle record wrapper carries structural-valid level', () => {
  const report = validateLifecycleRecord(loadJson('fixtures/lifecycle/valid/approval-task.json'), reg);
  assert.equal(report.ok, true);
  assert.equal(report.value?.level, 'structural-valid');
});

test('levels: registry snapshot wrapper carries registry-compatible level', () => {
  const report = validateRegistrySnapshot(loadJson('fixtures/registry/valid/registry-v1.json'), reg);
  assert.equal(report.ok, true);
  assert.equal(report.value?.level, 'registry-compatible');
});

test('levels: identity verification does not register', () => {
  const id = new MemoryIdentityState();
  const report = validateArtifactSelf(taskModel(), reg, { identity: id });
  assert.equal(report.ok, true);
  const v = report.value as ValidatedArtifact;
  assert.equal(id.verifyRegistration(v.instanceId, v.revisionId, v.digest), false); // not registered
  id.register(v);
  assert.equal(id.verifyRegistration(v.instanceId, v.revisionId, v.digest), true);
  // mutating digest breaks verification
  assert.equal(id.verifyRegistration(v.instanceId, v.revisionId, 'sha-256:' + '0'.repeat(64)), false);
});

test('security: manifest is data, not a dispatch source', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; expected_semantic_rule_ids: string[] }[] };
  const lfc011 = manifest.fixtures.find((f) => f.fixture_id === 'RULE-LFC-011-FAIL');
  assert.ok(lfc011);
  assert.deepEqual(lfc011.expected_semantic_rule_ids, ['LFC-011']);
});
