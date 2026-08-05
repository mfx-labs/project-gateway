/**
 * Security and boundary tests: duplicate keys, Unicode, bounds, prototype
 * pollution, no caller-input mutation, deterministic reports, and the
 * no-I/O core policy (production modules must not import filesystem/network/
 * process modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRawJsonInput,
  createSchemaRegistry,
  validateArtifactRevision,
  computeArtifactDigest,
  ConformanceRunner,
} from '../../src/index.js';

const reg = createSchemaRegistry();
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, '..', '..', '..', 'dist');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('security: production modules perform no hidden filesystem/network/process I/O', () => {
  const forbidden = [
    'node:fs',
    'node:net',
    'node:http',
    'node:https',
    'node:child_process',
    "require('fs')",
    'fetch(',
    'process.env',
    'Date.now(',
  ];
  // The Pi adapter is a separate module boundary with its own security suite
  // (tests/pi-adapter/security), which verifies that its only I/O is the
  // environment-gated host harness; it is excluded here by boundary.
  // WP-7 internal modules (reader/git/fff) are likewise a separate module
  // boundary with their own security suite (tests/wp7/security) verifying
  // that the only process I/O is the constrained trusted Git executable and
  // descriptor-bound reads; they are excluded here by boundary.
  const prodFiles = walk(DIST).filter((p) => !p.includes('conformance') && !p.includes('/adapters/') && !p.includes('/reader/') && !p.includes('/git/') && !p.includes('/fff/'));
  for (const p of prodFiles) {
    if (p.includes('runner.js') || p.includes('corpus-bundle')) continue;
    const src = readFileSync(p, 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${p}`);
    }
  }
});

test('security: time-dependent decisions never call Date.now in protocol code', () => {
  const files = walk(DIST).filter((p) => p.includes('pointofuse') || p.includes('lifecycle') || p.includes('engine'));
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    assert.ok(!src.includes('Date.now'), `Date.now in ${p}`);
  }
});

test('security: duplicate keys rejected at every depth', () => {
  const inputs = [
    '{"a":1,"a":2}',
    '{"a":{"b":1,"b":2}}',
    '[[{"x":1,"x":2}]]',
    '{"a":1,"b":2,"a":3}',
  ];
  for (const input of inputs) {
    const r = parseRawJsonInput(input, { subjectClass: 'artifact' });
    assert.equal(r.ok, false, input);
    if (!r.ok) assert.equal(r.report.findings[0]?.category, 'DUPLICATE-MEMBER', input);
  }
});

test('security: no silent repair of malformed input', () => {
  const inputs = ['{"a":}', '[1,]', '{"a" 1}', '01', '{"a":1} extra'];
  for (const input of inputs) {
    const r = parseRawJsonInput(input, { subjectClass: 'artifact' });
    assert.equal(r.ok, false, input);
  }
});

test('security: unpaired surrogates rejected', () => {
  const r = parseRawJsonInput('{"s":"\\udc00"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
});

test('security: prototype pollution is inert', () => {
  const r = parseRawJsonInput('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}', { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
});

test('security: caller input is never mutated', () => {
  const model = {
    protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' },
    kind: { id: 'TaskSpec', version: '1.0' },
    instance_id: 'pgw:i:' + 'a'.repeat(32),
    revision: { id: 'pgw:r:' + 'b'.repeat(32), generation: 0, predecessor: null, digest: '' },
    workspace_binding: { mode: 'portable' },
    requirements: { protocol_features: [], consumer_capabilities: [] },
    extensions: [],
    body: {
      objective: 'x',
      instructions: [{ instruction_id: 'i', text: 't' }],
      expected_deliverables: [{ deliverable_id: 'd', description: 'x', kind: 'document' }],
      outcome_constraints: [],
      project_data_citations: [],
    },
  };
  model.revision['digest'] = computeArtifactDigest(model).digest;
  const before = JSON.stringify(model);
  const report = validateArtifactRevision(model, reg, 'semantic-self-validation');
  assert.equal(report.ok, true);
  assert.equal(JSON.stringify(model), before);
});

test('security: bounded traversal resists deep nesting', () => {
  const deep = '['.repeat(33) + ']'.repeat(33);
  const r = parseRawJsonInput(deep, { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'RESOURCE-LIMIT');
});

test('security: deterministic finding order', () => {
  const model = {
    protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' },
    kind: { id: 'TaskSpec', version: '1.0' },
    instance_id: 'pgw:i:' + 'a'.repeat(32),
    revision: { id: 'pgw:r:' + 'b'.repeat(32), generation: 0, predecessor: null, digest: 'x' },
    workspace_binding: { mode: 'portable' },
    requirements: { protocol_features: [], consumer_capabilities: [] },
    extensions: [],
    body: {},
    unexpected: true,
  };
  const a = validateArtifactRevision(model, reg, 'structural-schema-validation');
  const b = validateArtifactRevision(JSON.parse(JSON.stringify(model)), reg, 'structural-schema-validation');
  assert.deepEqual(a, b);
});

test('security: conformance runner exposes no mutable global state', () => {
  const r1 = new ConformanceRunner();
  const r2 = new ConformanceRunner();
  assert.equal(r1.run().passed, r2.run().passed);
});

test('security: snapshot traversal state is per-call (no module-global WeakMap/WeakSet)', () => {
  const src = readFileSync(join(DIST, 'internal', 'snapshot.js'), 'utf8');
  // no module-scope WeakMap construction; the only WeakSets are the three
  // module-private membership sets
  assert.ok(!src.includes('new WeakMap'), 'module-global WeakMap in snapshot module');
  const weakSets = src.match(/new WeakSet/g) ?? [];
  assert.equal(weakSets.length, 3, 'unexpected WeakSet in snapshot module');
});

test('security: wrappers expose no brand symbol or brand property in compiled output', () => {
  const src = readFileSync(join(DIST, 'api', 'types.js'), 'utf8');
  assert.ok(!src.includes('getOwnPropertySymbols'), 'wrapper creation copies brand symbols');
  const snapSrc = readFileSync(join(DIST, 'internal', 'snapshot.js'), 'utf8');
  assert.ok(!snapSrc.includes('Symbol('), 'brand symbols exist in snapshot module');
  assert.ok(!snapSrc.includes('Symbol.for('), 'global symbol membership exists');
});

test('security: expected manifest metadata is never execution input (compiled scan)', () => {
  const src = readFileSync(join(DIST, 'conformance', 'runner.js'), 'utf8');
  const lines = src.split('\n');
  const classStart = lines.findIndex((l) => l.includes('class ConformanceRunner'));
  const comparisonStart = lines.findIndex((l) => l.includes('// ----') && l.includes('comparison'));
  assert.ok(classStart > 0 && comparisonStart > classStart);
  for (let i = classStart; i < comparisonStart; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    assert.ok(
      !line.includes('expected_schema_id') &&
        !line.includes('expected_semantic_rule_ids') &&
        !line.includes('expected_failure_category') &&
        !line.includes('expected_result'),
      `expected metadata read in execution code at compiled line ${i + 1}`,
    );
  }
});

test('security: point-of-use and identity modules keep no hidden mutable protocol state', () => {
  for (const rel of ['pointofuse/evaluate.js', 'engine/pipeline.js', 'engine/identity.js', 'references/validate.js']) {
    const src = readFileSync(join(DIST, rel), 'utf8');
    assert.ok(!src.includes('Date.now'), `Date.now in ${rel}`);
    assert.ok(!src.includes('process.env'), `process.env in ${rel}`);
  }
});
