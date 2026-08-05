/**
 * Unit tests: raw JSON intake, canonical input, digests, schema registry,
 * identity, references, registry evaluation, lifecycle records, and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parseRawJsonInput,
  createSchemaRegistry,
  validateArtifactRevision,
  validateRegistrySnapshot,
  computeArtifactDigest,
  computeRegistryDigest,
  verifyArtifactDigestValue,
  MemoryIdentityState,
  isNfc,
  ConformanceRunner,
} from '../../src/index.js';
import { identifySchema } from '../../src/schema/select.js';
import { validateReferenceModel } from '../../src/references/validate.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import type { ValidatedArtifact } from '../../src/api/types.js';

const reg = createSchemaRegistry();
const corpus = CORPUS_INPUTS as Record<string, string>;

function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
}

function signedTask(): unknown {
  const t = loadJson('fixtures/artifacts/valid/task-minimal-genesis.json');
  return JSON.parse(JSON.stringify(t));
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------- raw JSON
test('raw JSON: malformed input fails with RAW-PARSE-FAILURE', () => {
  const r = parseRawJsonInput('{"a":', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'RAW-PARSE-FAILURE');
});

test('raw JSON: duplicate members rejected before construction', () => {
  const r = parseRawJsonInput('{"a":1,"a":2}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'DUPLICATE-MEMBER');
});

test('raw JSON: nested duplicate members rejected', () => {
  const r = parseRawJsonInput('{"x":{"b":1,"b":2}}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'DUPLICATE-MEMBER');
});

test('raw JSON: invalid UTF-8 rejected', () => {
  const r = parseRawJsonInput(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d]), { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('raw JSON: unpaired surrogate escape rejected', () => {
  const r = parseRawJsonInput('{"text":"\\ud800"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'INVALID-UNICODE');
});

test('raw JSON: input byte bounds enforced', () => {
  const big = '[' + '0,'.repeat(200000) + '0]';
  const r = parseRawJsonInput(big, { subjectClass: 'lifecycle' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'RESOURCE-LIMIT');
});

test('raw JSON: nesting bounds enforced', () => {
  const deep = '['.repeat(40) + ']'.repeat(40);
  const r = parseRawJsonInput(deep, { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'RESOURCE-LIMIT');
});

// ---------------------------------------------------------------- canonical input
test('canonical input: NFC accepted', () => {
  assert.equal(isNfc('caf\u00e9'), true);
});

test('canonical input: non-NFC rejected without normalization', () => {
  assert.equal(isNfc('cafe\u0301'), false);
  const t = JSON.parse(JSON.stringify(signedTask()));
  t['body'] = { ...(t['body'] as object), objective: 'cafe\u0301' };
  const report = validateArtifactRevision(t, reg, 'canonical-input-validation');
  assert.equal(report.ok, false);
  assert.equal(report.category, 'NON-NFC-STRING');
});

test('canonical input: unsafe numbers rejected', () => {
  const raw = '{"n":9007199254740993}';
  const r = parseRawJsonInput(raw, { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
  if (r.ok) {
    const report = validateArtifactRevision({ n: 9007199254740993 }, reg, 'canonical-input-validation');
    assert.equal(report.ok, false);
    assert.equal(report.category, 'UNSAFE-INTEGER');
  }
});

// ---------------------------------------------------------------- digests
test('digest: artifact vector recomputation', () => {
  const vector = loadJson('fixtures/canonicalization/artifact/object-order-and-digest.json');
  const hash = sha256(String(vector['digest_domain']) + String(vector['canonical_utf8']));
  assert.equal(hash, vector['expected_sha256']);
});

test('digest: registry vector recomputation and domain separation', () => {
  const vector = loadJson('fixtures/canonicalization/registry/registry-canonical-digest.json');
  const hash = sha256(String(vector['digest_domain']) + String(vector['canonical_utf8']));
  assert.equal(hash, vector['expected_sha256']);
  assert.equal(vector['digest_domain'], 'PGAP-REGISTRY-SNAPSHOT-v1\u0000');
  assert.notEqual(vector['digest_domain'], 'PGAP-ARTIFACT-REVISION-v1\u0000');
});

test('digest: annotation exclusion and derived digest exclusion', () => {
  const t = signedTask() as Record<string, unknown>;
  const base = computeArtifactDigest(t);
  const withAnn = JSON.parse(JSON.stringify(t));
  withAnn['annotations'] = { title: 'changed' };
  assert.equal(computeArtifactDigest(withAnn).digest, base.digest);
  assert.equal(verifyArtifactDigestValue(withAnn as never, base.digest), true);
});

test('digest: canonical-content changes alter digest', () => {
  const t = signedTask() as Record<string, unknown>;
  const base = computeArtifactDigest(t);
  const changed = JSON.parse(JSON.stringify(t));
  changed['body']['instructions'][0]['text'] = 'different';
  assert.notEqual(computeArtifactDigest(changed).digest, base.digest);
});

test('digest: artifact and registry domains differ', () => {
  assert.notEqual(computeArtifactDigest({ a: 1 }).domain, computeRegistryDigest({ a: 1 }).domain);
});

// ---------------------------------------------------------------- schema
test('schema registry: all 51 resources compile offline', () => {
  assert.equal(reg.schemaIdsList.length, 51);
});

test('schema registry: unknown schema rejected', () => {
  assert.throws(() => reg.validate('urn:unknown', {}));
});

test('structural: closed contract rejects unknown members', () => {
  const t = JSON.parse(JSON.stringify(signedTask()));
  t['status'] = 'approved';
  const report = validateArtifactRevision(t, reg, 'structural-schema-validation');
  assert.equal(report.ok, false);
  assert.equal(report.category, 'STRUCTURAL-SCHEMA-FAILURE');
});

test('structural: valid artifact passes through semantic validation', () => {
  const report = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation');
  assert.equal(report.ok, true);
});

// ---------------------------------------------------------------- identity
test('identity: instance reuse detected', () => {
  const id = new MemoryIdentityState();
  const a = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation', { identity: id  });
  assert.equal(a.ok, true);
  id.register(a.value as ValidatedArtifact);
  const second = JSON.parse(JSON.stringify(signedTask()));
  second['revision'] = { ...(second['revision'] as object), id: 'pgw:r:' + '2'.repeat(32) };
  second['revision'] = { ...(second['revision'] as object), digest: computeArtifactDigest(second).digest };
  const r = validateArtifactRevision(second, reg, 'identity-registration', { identity: id });
  assert.equal(r.ok, false);
  assert.equal(r.category, 'IDENTITY-CONFLICT');
});

test('identity: successor branch of the same instance accepted', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation', { identity: id  });
  id.register(genesis.value as ValidatedArtifact);
  const g = genesis.value as ValidatedArtifact;
  const succ = JSON.parse(JSON.stringify(signedTask()));
  succ['revision'] = {
    id: 'pgw:r:' + '3'.repeat(32),
    generation: 1,
    predecessor: {
      target_protocol_version: '1.0',
      target_kind: { id: 'TaskSpec', version: '1.0' },
      target_instance_id: g.instanceId,
      target_revision_id: g.revisionId,
      target_digest: g.digest,
      target_workspace_binding: { mode: 'portable' },
    },
    digest: 'P',
  };
  succ['revision'] = { ...succ['revision'], digest: computeArtifactDigest(succ).digest };
  const r = validateArtifactRevision(succ, reg, 'semantic-self-validation', { identity: id });
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------- references
function makeRef(a: ValidatedArtifact) {
  return {
    target_protocol_version: '1.0',
    target_kind: { id: 'TaskSpec', version: '1.0' },
    target_instance_id: a.instanceId,
    target_revision_id: a.revisionId,
    target_digest: a.digest,
    target_workspace_binding: { mode: 'portable' },
  };
}

test('reference: exact success', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation', { identity: id  });
  id.register(genesis.value as ValidatedArtifact);
  const a = genesis.value as ValidatedArtifact;
  const report = validateReferenceModel(makeRef(a), { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, true);
});

test('reference: digest mismatch rejected', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation', { identity: id  });
  id.register(genesis.value as ValidatedArtifact);
  const a = genesis.value as ValidatedArtifact;
  const ref = { ...makeRef(a), target_digest: 'sha-256:' + 'f'.repeat(64) };
  const report = validateReferenceModel(ref, { identity: id, schemaRegistry: reg, resolve: () => a.model });
  assert.equal(report.ok, false);
  assert.equal(report.category, 'EXACT-REFERENCE-FAILURE');
});

test('reference: unresolved target rejected', () => {
  const ref = {
    target_protocol_version: '1.0',
    target_kind: { id: 'TaskSpec', version: '1.0' },
    target_instance_id: 'pgw:i:' + 'a'.repeat(32),
    target_revision_id: 'pgw:r:' + 'b'.repeat(32),
    target_digest: 'sha-256:' + 'c'.repeat(64),
    target_workspace_binding: { mode: 'portable' },
  };
  const report = validateReferenceModel(ref, { identity: new MemoryIdentityState(), schemaRegistry: reg, resolve: () => undefined });
  assert.equal(report.ok, false);
  assert.equal(report.category, 'EXACT-REFERENCE-FAILURE');
});

// ---------------------------------------------------------------- registry
test('registry: valid snapshot passes; digest mismatch fails', () => {
  const snap = loadJson('fixtures/registry/valid/registry-v1.json');
  const report = validateRegistrySnapshot(snap, reg);
  assert.equal(report.ok, true);
  const bad = JSON.parse(JSON.stringify(snap));
  bad['snapshot_digest'] = 'sha-256:' + '0'.repeat(64);
  const badReport = validateRegistrySnapshot(bad, reg);
  assert.equal(badReport.ok, false);
  assert.equal(badReport.category, 'DIGEST-MISMATCH');
});

// ---------------------------------------------------------------- lifecycle
test('lifecycle: valid record identifies to its exact schema', () => {
  const rec = loadJson('fixtures/lifecycle/valid/approval-task.json');
  const selection = identifySchema(rec);
  assert.equal(selection.ok, true);
  assert.equal(selection.schemaId, 'urn:project-gateway:schema:lifecycle:1.0:records:approval-record');
});

// ---------------------------------------------------------------- determinism / security
test('determinism: equal inputs produce equal outputs', () => {
  const a = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation');
  const b = validateArtifactRevision(signedTask(), reg, 'semantic-self-validation');
  assert.deepEqual(a, b);
});

test('determinism: findings are sorted', () => {
  const t = JSON.parse(JSON.stringify(signedTask()));
  t['status'] = 'x';
  t['extra'] = 'y';
  const report = validateArtifactRevision(t, reg, 'structural-schema-validation');
  const keys = report.findings.map((f) => `${f.phase}|${f.category}|${f.messageKey}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('security: caller input is not mutated', () => {
  const t = signedTask() as Record<string, unknown>;
  const snapshot = JSON.stringify(t);
  validateArtifactRevision(t, reg, 'semantic-self-validation');
  computeArtifactDigest(t);
  assert.equal(JSON.stringify(t), snapshot);
});

test('security: prototype-looking keys do not pollute', () => {
  const r = parseRawJsonInput('{"__proto__":{"polluted":true},"constructor":{"x":1}}', { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
  if (r.ok) {
    const model = r.model as Record<string, unknown>;
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal(typeof model['__proto__'], 'object');
  }
});

test('security: independent library instances do not share state', () => {
  const r1 = new ConformanceRunner();
  const r2 = new ConformanceRunner();
  assert.notEqual(r1, r2);
  const s1 = r1.run();
  const s2 = r2.run();
  assert.equal(s1.passed, s2.passed);
});

test('conformance: manifest totals after the WP-3 registry-digest erratum', () => {
  const runner = new ConformanceRunner();
  const summary = runner.run();
  assert.equal(summary.total, 587);
  assert.equal(summary.executed, 587);
  assert.equal(summary.passed, 587);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.mismatches, []);
});

test('conformance: manifest dependency metadata is valid', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; dependencies: string[] }[] };
  const ids = new Set(manifest.fixtures.map((f) => f.fixture_id));
  for (const f of manifest.fixtures) {
    for (const d of f.dependencies) assert.ok(ids.has(d), `dependency ${d} of ${f.fixture_id}`);
  }
});
