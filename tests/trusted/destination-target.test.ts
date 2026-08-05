/**
 * WP-6 Phase 2B: target-state/tail cross-validation and existing-target
 * reject-only policy (test categories I + J).
 *
 * Only a `missing` final target may produce a decision; every existing
 * state is rejected under the create-only policy with no decision, no
 * identity, and no overwrite authority.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProspectiveArtifactDestination } from '../../src/trusted/index.js';
import {
  validatedConfig,
  destinationRequest,
  destinationOptions,
  successResolver,
  evidenceResolver,
  joinParts,
  DEST_DIR_A,
} from './destination-helpers.js';

const config = validatedConfig();

const evaluate = (input: Record<string, unknown>, resolver = successResolver('missing')) =>
  evaluateProspectiveArtifactDestination(input, destinationOptions(config, resolver));

test('I: missing target with one-component tail succeeds', () => {
  const report = evaluate(destinationRequest(config, { destination: 'task.json' }));
  assert.equal(report.ok, true);
  assert.deepEqual(report.decision!.destinationTailComponents, ['task.json']);
  assert.equal(report.decision!.targetState, 'missing');
});

test('I: missing target with multi-component tail succeeds', () => {
  const report = evaluate(destinationRequest(config, { destination: 'a/b/c.json' }));
  assert.equal(report.ok, true);
  assert.deepEqual(report.decision!.destinationTailComponents, ['a', 'b', 'c.json']);
});

test('I: existing directory with empty tail rejected (TAD-040)', () => {
  const report = evaluate(destinationRequest(config, { destination: 'drafts' }), successResolver('existing-directory'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-040');
  assert.equal(report.findings[0]!.messageKey, 'destination.target-exists-directory');
  assert.equal(report.decision, undefined);
});

test('I: existing regular file rejected (TAD-039)', () => {
  const report = evaluate(destinationRequest(config, { destination: 'task.json' }), successResolver('existing-file'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-039');
  assert.equal(report.findings[0]!.messageKey, 'destination.target-exists-file');
});

test('I: existing symlink rejected (TAD-041)', () => {
  const report = evaluate(destinationRequest(config, { destination: 'task.json' }), successResolver('existing-symlink'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-041');
});

test('I: dangling symlink rejected (TAD-042)', () => {
  const report = evaluate(destinationRequest(config, { destination: 'task.json' }), successResolver('dangling-symlink'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-042');
});

test('I: unsupported final kind rejected (TAD-043)', () => {
  const report = evaluate(destinationRequest(config, { destination: 'task.json' }), successResolver('unsupported-kind'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-043');
});

test('I: missing with empty tail rejected (TAD-037)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a/b' }),
    successResolver('missing', { prefix: ['a', 'b'] }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-037');
  assert.equal(report.findings[0]!.messageKey, 'destination.target-state-tail-inconsistent');
});

test('I: existing directory with non-empty tail rejected (TAD-037)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['a'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/a`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['b'],
    targetState: 'existing-directory' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-037');
});

test('I: existing file with empty tail rejected (TAD-037)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['a', 'b'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/a/b`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: [],
    targetState: 'existing-file' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-037');
});

test('I: existing file with multi-component tail rejected (TAD-037)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['a', 'b'],
    targetState: 'existing-file' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-037');
});

test('I: unknown target state rejected (TAD-015)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a.json' }),
    evidenceResolver({ ...successResolver('missing')({ destinationContainmentProtocolVersion: '1', canonicalArtifactRoot: DEST_DIR_A, absoluteProspectiveDestination: `${DEST_DIR_A}/a.json` }), targetState: 'exists' } as never),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-015');
});

test('I: non-string target state rejected (TAD-015)', () => {
  const report = evaluate(
    destinationRequest(config, { destination: 'a.json' }),
    evidenceResolver({ ...successResolver('missing')({ destinationContainmentProtocolVersion: '1', canonicalArtifactRoot: DEST_DIR_A, absoluteProspectiveDestination: `${DEST_DIR_A}/a.json` }), targetState: 5 } as never),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-015');
});

test('I: added tail component rejected (TAD-036)', () => {
  // The evidence tail must be the exact remaining request suffix; a tail
  // longer than the suffix (an added component) fails closed.
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['a', 'b', 'extra'],
    targetState: 'missing' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
});

test('I: omitted tail component rejected (TAD-036)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['a'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/a`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['c'],
    targetState: 'missing' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b/c' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
});

test('I: reordered tail rejected (TAD-036)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['a'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/a`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['c', 'b'],
    targetState: 'missing' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b/c' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
});

test('I: duplicated tail component rejected (TAD-036)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['a', 'a'],
    targetState: 'missing' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a/b' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
});

test('I: root-reset attempt in tail rejected (TAD-036)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['/etc/passwd'],
    targetState: 'missing' as const,
  };
  const report = evaluate(destinationRequest(config, { destination: 'a.json' }), evidenceResolver(evidence));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-036');
});

test('J: every existing target state yields no decision and no identity', () => {
  for (const state of ['existing-file', 'existing-directory', 'existing-symlink', 'dangling-symlink', 'unsupported-kind'] as const) {
    const report = evaluate(destinationRequest(config, { destination: 'task.json' }), successResolver(state));
    assert.equal(report.ok, false, state);
    assert.equal(report.decision, undefined, state);
    assert.equal('decisionIdentity' in report, false, state);
  }
});

test('J: no overwrite or write authority on existing-target failure', () => {
  const report = evaluate(destinationRequest(config, { destination: 'task.json' }), successResolver('existing-file'));
  assert.equal(report.ok, false);
  const serialized = JSON.stringify(report);
  for (const token of ['writeAllowed', 'overwrite', 'persistenceHandle', 'RuntimeGrant', 'approval']) {
    assert.ok(!serialized.includes(token), token);
  }
});

test('I: target-state identity binds exactly missing (unit)', async () => {
  const { computeDestinationDecisionIdentity } = await import('../../src/trusted/destination-identity.js');
  const base = {
    destinationContainmentProtocolVersion: '1',
    operationClass: 'artifact-draft-destination',
    purpose: 'persist-validated-artifact-draft',
    configurationIdentity: config.identity,
    hostLane: config.hostLane,
    workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa',
    artifactKind: 'TaskSpec' as const,
    canonicalArtifactRelativeDestination: 'task.json',
    currentCanonicalArtifactRoot: DEST_DIR_A,
    lexicalExistingDirectoryPrefixComponents: [] as readonly string[],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    destinationTailComponents: ['task.json'] as readonly string[],
    targetState: 'missing' as const,
    pointOfUseRevalidationRequired: true as const,
  };
  const identity = computeDestinationDecisionIdentity(base);
  assert.match(identity.digest, /^sha-256:[0-9a-f]{64}$/);
  assert.equal(identity.projection['targetState'], 'missing');
  assert.equal(identity.projection['pointOfUseRevalidationRequired'], true);
});

test('I: helper smoke — joinParts', () => {
  assert.equal(joinParts(['a', 'b', 'c']), 'a/b/c');
});
