/**
 * WP-6 Phase 2B: Model B alias-aware lexical/canonical correlation (test
 * category H).
 *
 * The lexical existing-directory prefix and the canonical existing directory
 * ancestor are distinct operands. The lexical-to-canonical mapping is
 * trusted host evidence; the core verifies structural correlation only and
 * never requires `canonical ancestor + lexical tail == lexical absolute
 * destination` (invalid across aliases).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProspectiveArtifactDestination } from '../../src/trusted/index.js';
import { combineAncestorAndTail, joinComponents } from '../../src/trusted/destination-request.js';
import {
  validatedConfig,
  destinationRequest,
  destinationOptions,
  successResolver,
  aliasResolver,
  failingResolver,
  evidenceResolver,
  joinParts,
  DEST_DIR_A,
} from './destination-helpers.js';

const config = validatedConfig();

const evaluate = (input: Record<string, unknown>, resolver = successResolver('missing')) =>
  evaluateProspectiveArtifactDestination(input, destinationOptions(config, resolver));

test('H: empty lexical prefix with artifact root as ancestor (missing under root)', () => {
  const report = evaluate(destinationRequest(config, { destination: 'a/b.json' }));
  assert.equal(report.ok, true);
  assert.deepEqual(report.decision!.lexicalExistingDirectoryPrefixComponents, []);
  assert.equal(report.decision!.canonicalExistingDirectoryAncestor, DEST_DIR_A);
  assert.deepEqual(report.decision!.destinationTailComponents, ['a', 'b.json']);
});

test('H: nested real-directory prefix accepted', () => {
  const prefix = ['drafts', '2026'];
  const report = evaluate(
    destinationRequest(config, { destination: joinParts([...prefix, 'task.json']) }),
    successResolver('missing', { prefix, ancestor: `${DEST_DIR_A}/drafts/2026` }),
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.decision!.lexicalExistingDirectoryPrefixComponents, prefix);
  assert.equal(report.decision!.canonicalExistingDirectoryAncestor, `${DEST_DIR_A}/drafts/2026`);
  assert.deepEqual(report.decision!.destinationTailComponents, ['task.json']);
});

test('H: intermediate internal symlink accepted (alias-aware resolution)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], `${DEST_DIR_A}/internal`),
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.decision!.lexicalExistingDirectoryPrefixComponents, ['alias']);
  assert.equal(report.decision!.canonicalExistingDirectoryAncestor, `${DEST_DIR_A}/internal`);
  assert.deepEqual(report.decision!.destinationTailComponents, ['task.json']);
});

test('H: lexical prefix differs from canonical ancestor; both are bound', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], `${DEST_DIR_A}/internal`),
  );
  assert.equal(report.ok, true);
  assert.equal(report.decision!.lexicalExistingDirectoryPrefixComponents[0], 'alias');
  assert.equal(report.decision!.canonicalExistingDirectoryAncestor, `${DEST_DIR_A}/internal`);
  assert.notEqual(report.decision!.lexicalExistingDirectoryPrefixComponents[0], 'internal');
});

test('H: intermediate external symlink rejected (TAD-033)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], '/srv/outside/internal'),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-033');
  assert.equal(report.findings[0]!.messageKey, 'destination.ancestor-outside-root');
  assert.equal(report.decision, undefined);
});

test('H: intermediate dangling symlink rejected (TAD-030)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'link/task.json' }),
    failingResolver('existing-ancestor', 'dangling-symlink'),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-030');
});

test('H: intermediate loop rejected (TAD-031)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'loop/task.json' }),
    failingResolver('existing-ancestor', 'loop'),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-031');
});

test('H: intermediate non-directory rejected (TAD-028)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'file.txt/task.json' }),
    failingResolver('existing-ancestor', 'not-directory'),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-028');
  assert.equal(report.findings[0]!.messageKey, 'destination.ancestor-not-directory');
});

test('H: added prefix component rejected (TAD-035)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias', 'extra'], `${DEST_DIR_A}/internal`),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-035');
  assert.equal(report.findings[0]!.messageKey, 'destination.lexical-prefix-mismatch');
});

test('H: reordered prefix rejected (TAD-035)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a/b/task.json' }),
    aliasResolver(['b', 'a'], `${DEST_DIR_A}/x`),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-035');
});

test('H: duplicated prefix component rejected (TAD-035)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a/b/task.json' }),
    aliasResolver(['a', 'a'], `${DEST_DIR_A}/x`),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-035');
});

test('H: omitted prefix component rejected as tail mismatch (TAD-036)', () => {
  // P=['a'] omits the true prefix ['a','b']; the evidence tail then cannot
  // be the exact remaining suffix of the request.
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['a'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/x`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
  };
  const report = evaluate(
    destinationRequest(config, { destination: 'a/b/task.json' }),
    evidenceResolver(evidence),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
  assert.equal(report.findings[0]!.messageKey, 'destination.destination-tail-mismatch');
});

test('H: P empty with ancestor not equal to root rejected (TAD-038)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'task.json' }),
    successResolver('missing', { prefix: [], ancestor: `${DEST_DIR_A}/internal` }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-038');
  assert.equal(report.findings[0]!.messageKey, 'destination.alias-correlation-inconsistent');
});

test('H: canonical ancestor outside root rejected (TAD-033)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a/task.json' }),
    successResolver('missing', { prefix: ['a'], ancestor: '/srv/outside/x' }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-033');
});

test('H: sibling-prefix confusion rejected (TAD-033)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a/task.json' }),
    successResolver('missing', { prefix: ['a'], ancestor: `${DEST_DIR_A}2/a` }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-033');
});

test('H: cross-workspace ancestor defense is unreachable for validated configurations', () => {
  // Phase-1 prohibits overlapping workspace roots, so a canonical ancestor
  // inside workspace A's artifact root can never fall under workspace B's
  // root; the containment check fires first (TAD-033). The explicit
  // cross-workspace check (TAD-034) is kept as a defense-in-depth invariant.
  const report = evaluate(
    destinationRequest(config, { destination: 'task.json' }),
    successResolver('missing', { prefix: [], ancestor: '/srv/gateway/beta/artifacts' }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-033');
});

test('H: P + T == R is required (tail must be the exact remaining suffix)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['a'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/x`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['c.json'],
    targetState: 'missing' as const,
  };
  const report = evaluate(
    destinationRequest(config, { destination: 'a/b/c.json' }),
    evidenceResolver(evidence),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
});

test('H: A + T == lexical destination is NOT required across aliases', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], `${DEST_DIR_A}/internal`),
  );
  assert.equal(report.ok, true);
  const lexical = `${DEST_DIR_A}/alias/task.json`;
  const resolved = `${DEST_DIR_A}/internal/task.json`;
  assert.notEqual(resolved, lexical);
  assert.equal(report.decision!.canonicalArtifactRelativeDestination, 'alias/task.json');
});

test('H: alias operands are identity-bound (same mapping same identity; different ancestor differs)', () => {
  const a = evaluate(destinationRequest(config, { destination: 'alias/task.json' }), aliasResolver(['alias'], `${DEST_DIR_A}/internal`));
  const b = evaluate(destinationRequest(config, { destination: 'alias/task.json' }), aliasResolver(['alias'], `${DEST_DIR_A}/internal`));
  const c = evaluate(destinationRequest(config, { destination: 'alias/task.json' }), aliasResolver(['alias'], `${DEST_DIR_A}/other`));
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.equal(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
  assert.notEqual(a.decision!.decisionIdentity, c.decision!.decisionIdentity);
});

test('H: helper units — component joining is component-safe', () => {
  assert.equal(joinComponents(['a', 'b']), 'a/b');
  assert.equal(combineAncestorAndTail('/a/b', ['c', 'd']).ok, true);
  const r = combineAncestorAndTail('/a/b', ['c', 'd']);
  if (r.ok) assert.equal(r.resolved, '/a/b/c/d');
  assert.equal(combineAncestorAndTail('/', ['c']).ok, false);
  assert.equal(combineAncestorAndTail('/a/', ['c']).ok, false);
});

test('H: mutation-dependent prefix evidence stays deterministic', () => {
  // A stateful descriptor proxy would report a different prefix on repeated
  // reads; the evidence is captured once, so the outcome is either the
  // observed consistent state or a typed failure — never mixed evidence.
  let mode = false;
  const base: Record<string, unknown> = {
    ok: true,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory',
    lexicalExistingDirectoryPrefixComponents: ['a'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/a`,
    existingAncestorEntryKind: 'directory',
    destinationTailComponents: ['task.json'],
    targetState: 'missing',
  };
  const proxy = new Proxy(base, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      const desc = Reflect.getOwnPropertyDescriptor(t, p);
      if (p === 'lexicalExistingDirectoryPrefixComponents' && desc && mode) {
        return { value: ['a', 'extra'], writable: true, enumerable: true, configurable: true };
      }
      return desc;
    },
  });
  const first = evaluate(destinationRequest(config, { destination: 'a/task.json' }), evidenceResolver(proxy as never));
  mode = true;
  const second = evaluate(destinationRequest(config, { destination: 'a/task.json' }), evidenceResolver(proxy as never));
  // First capture: consistent prefix ['a'] → successful missing-target decision.
  assert.equal(first.ok, true);
  assert.deepEqual(first.decision!.lexicalExistingDirectoryPrefixComponents, ['a']);
  assert.deepEqual(first.decision!.destinationTailComponents, ['task.json']);
  // Second capture: the mutated prefix is not a prefix of the request →
  // deterministic typed failure; no mixed evidence can be formed.
  assert.equal(second.ok, false);
  assert.equal(second.findings[0]!.code, 'TAD-035');
  assert.equal(second.decision, undefined);
});
