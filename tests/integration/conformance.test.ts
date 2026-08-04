/**
 * Integration tests: full conformance execution, vector coverage, raw-input
 * phases, and workflow subject integrity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ConformanceRunner, manifestStats } from '../../src/index.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';

const corpus = CORPUS_INPUTS as Record<string, string>;

test('integration: manifest stats match the committed package', () => {
  const stats = manifestStats();
  assert.equal(stats.entries, 531);
  assert.equal(stats.schemas, 51);
  assert.ok(stats.inputs >= 300);
});

test('integration: every physical corpus input is listed in the manifest', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { paths: string[] }[] };
  const listed = new Set<string>();
  for (const f of manifest.fixtures) for (const p of f.paths) listed.add(p);
  for (const rel of Object.keys(corpus)) assert.ok(listed.has(rel), `unlisted input ${rel}`);
});

test('integration: all RULE coverage entries point at existing inputs', () => {
  const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; paths: string[] }[] };
  const ruleEntries = manifest.fixtures.filter((f) => f.fixture_id.startsWith('RULE-'));
  assert.equal(ruleEntries.length, 228);
  for (const f of ruleEntries) {
    for (const p of f.paths) assert.ok(corpus[p] !== undefined, `missing ${p} for ${f.fixture_id}`);
  }
});

test('integration: all 19 digest vectors recompute', () => {
  const manifestVectors = (CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; paths: string[] }[] }).fixtures.filter(
    (f) => f.fixture_id.startsWith('CAN-'),
  );
  assert.equal(manifestVectors.length, 19);
  const vectors = [...new Set(manifestVectors.flatMap((f) => f.paths))];
  for (const rel of vectors) {
    const v = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
    const expected = v['expected_sha256'];
    if (expected === null || expected === undefined) continue;
    const texts = Array.isArray(v['canonical_utf8']) ? (v['canonical_utf8'] as string[]) : [String(v['canonical_utf8'])];
    const hashes = Array.isArray(expected) ? (expected as string[]) : [String(expected)];
    for (let i = 0; i < texts.length; i++) {
      const got = createHash('sha256').update(String(v['digest_domain']) + texts[i]!, 'utf8').digest('hex');
      assert.equal(got, hashes[i], `vector ${rel}[${i}]`);
    }
  }
});

test('integration: full conformance manifest executes 531/531 after the WP-3 registry-digest erratum', () => {
  const summary = new ConformanceRunner().run();
  assert.equal(summary.total, 531);
  assert.equal(summary.executed, 531);
  assert.equal(summary.passed, 531);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.mismatches, []);
});

test('integration: runner is deterministic across instances', () => {
  const a = new ConformanceRunner().run();
  const b = new ConformanceRunner().run();
  assert.equal(a.passed, b.passed);
  assert.deepEqual(a.mismatches, b.mismatches);
});
