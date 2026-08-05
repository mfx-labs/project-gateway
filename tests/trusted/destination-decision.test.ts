/**
 * WP-6 Phase 2B: successful decision shape and deterministic decision
 * identity (test categories K + L).
 *
 * Identity binds protocol version, operation class, purpose, configuration
 * identity, host lane, workspace, artifact kind, lexical destination,
 * current canonical artifact root, lexical prefix, canonical ancestor, tail,
 * target state `missing`, and the point-of-use marker; resolver identity,
 * timestamps, and authority are never bound. Independent recomputation does
 * not use the production identity constructor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateProspectiveArtifactDestination, computeDestinationDecisionIdentity } from '../../src/trusted/index.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';
import { DESTINATION_DECISION_DIGEST_DOMAIN } from '../../src/trusted/destination-identity.js';
import {
  validatedConfig,
  v2ConfigTwoWorkspaces,
  destinationRequest,
  destinationOptions,
  successResolver,
  aliasResolver,
  joinParts,
  DEST_DIR_A,
  DEST_DIR_B,
  WS_A,
  WS_B,
} from './destination-helpers.js';

const config = validatedConfig();
const configTwo = validatedConfig(v2ConfigTwoWorkspaces());

const evaluate = (cfg: unknown, input: Record<string, unknown>, resolver = successResolver('missing')) =>
  evaluateProspectiveArtifactDestination(input, { configuration: cfg as never, resolveProspectiveDestination: resolver });

test('K: successful missing-target decision carries the exact protocol fields', () => {
  const report = evaluate(config, destinationRequest(config, { destination: 'drafts/task.json' }));
  assert.equal(report.ok, true);
  const d = report.decision!;
  assert.equal(d.destinationContainmentProtocolVersion, '1');
  assert.equal(d.operationClass, 'artifact-draft-destination');
  assert.equal(d.purpose, 'persist-validated-artifact-draft');
  assert.match(d.decisionIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.equal(d.configurationIdentity, config.identity);
  assert.equal(d.hostLane, config.hostLane);
  assert.equal(d.workspaceId, WS_A);
  assert.equal(d.artifactKind, 'TaskSpec');
  assert.equal(d.canonicalArtifactRelativeDestination, 'drafts/task.json');
  assert.equal(d.currentCanonicalArtifactRoot, DEST_DIR_A);
  assert.deepEqual(d.lexicalExistingDirectoryPrefixComponents, []);
  assert.equal(d.canonicalExistingDirectoryAncestor, DEST_DIR_A);
  assert.deepEqual(d.destinationTailComponents, ['drafts', 'task.json']);
  assert.equal(d.targetState, 'missing');
  assert.equal(d.pointOfUseRevalidationRequired, true);
});

test('K: decision is deeply frozen', () => {
  const report = evaluate(config, destinationRequest(config));
  assert.equal(report.ok, true);
  const d = report.decision!;
  assert.equal(Object.isFrozen(d), true);
  assert.equal(Object.isFrozen(d.lexicalExistingDirectoryPrefixComponents), true);
  assert.equal(Object.isFrozen(d.destinationTailComponents), true);
  assert.equal(Object.isFrozen(report.findings), true);
});

test('K: decision contains no timestamp, authority, or persistence fields', () => {
  const report = evaluate(config, destinationRequest(config));
  assert.equal(report.ok, true);
  const keys = Object.keys(report.decision!);
  for (const forbidden of ['timestamp', 'issuedAt', 'freshness', 'writeAllowed', 'overwrite', 'grant', 'approval', 'persistenceHandle', 'runtimeGrant', 'executionResult', 'receipt']) {
    assert.ok(!keys.includes(forbidden), forbidden);
  }
});

test('L: deterministic repeated evaluation', () => {
  const a = evaluate(config, destinationRequest(config, { destination: 'a/b.json' }));
  const b = evaluate(config, destinationRequest(config, { destination: 'a/b.json' }));
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: independent identity recomputation without the production constructor', () => {
  const report = evaluate(config, destinationRequest(config, { destination: 'a/b.json' }));
  assert.equal(report.ok, true);
  const d = report.decision!;
  const projection = {
    destinationContainmentProtocolVersion: d.destinationContainmentProtocolVersion,
    operationClass: d.operationClass,
    purpose: d.purpose,
    configurationIdentity: d.configurationIdentity,
    hostLane: d.hostLane,
    workspaceId: d.workspaceId,
    artifactKind: d.artifactKind,
    canonicalArtifactRelativeDestination: d.canonicalArtifactRelativeDestination,
    currentCanonicalArtifactRoot: d.currentCanonicalArtifactRoot,
    lexicalExistingDirectoryPrefixComponents: [...d.lexicalExistingDirectoryPrefixComponents],
    canonicalExistingDirectoryAncestor: d.canonicalExistingDirectoryAncestor,
    destinationTailComponents: [...d.destinationTailComponents],
    targetState: d.targetState,
    pointOfUseRevalidationRequired: d.pointOfUseRevalidationRequired,
  };
  const canonicalUtf8 = jcsSerialize(projection);
  const digest = 'sha-256:' + createHash('sha256')
    .update(DESTINATION_DECISION_DIGEST_DOMAIN, 'utf8')
    .update(canonicalUtf8, 'utf8')
    .digest('hex');
  assert.equal(digest, d.decisionIdentity);
});

test('L: identity binds the destination-containment protocol version (unit)', () => {
  const base = identityInput();
  const a = computeDestinationDecisionIdentity(base);
  const b = computeDestinationDecisionIdentity({ ...base, destinationContainmentProtocolVersion: '2' });
  assert.notEqual(a.digest, b.digest);
});

test('L: identity binds the operation class (unit)', () => {
  const base = identityInput();
  const a = computeDestinationDecisionIdentity(base);
  const b = computeDestinationDecisionIdentity({ ...base, operationClass: 'existing-path' });
  assert.notEqual(a.digest, b.digest);
});

test('L: identity binds the purpose (unit)', () => {
  const base = identityInput();
  const a = computeDestinationDecisionIdentity(base);
  const b = computeDestinationDecisionIdentity({ ...base, purpose: 'persist-draft' });
  assert.notEqual(a.digest, b.digest);
});

test('L: identity binds the host lane (unit)', () => {
  const base = identityInput();
  const a = computeDestinationDecisionIdentity(base);
  const b = computeDestinationDecisionIdentity({ ...base, hostLane: 'linux-x86_64-posix-utf8-node23' });
  assert.notEqual(a.digest, b.digest);
});

test('L: configuration identity difference changes the decision identity', () => {
  const a = evaluate(config, destinationRequest(config, { destination: 'task.json' }));
  const b = evaluate(configTwo, destinationRequest(configTwo, { destination: 'task.json' }));
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
  assert.notEqual(a.decision!.configurationIdentity, b.decision!.configurationIdentity);
});

test('L: workspace difference changes the decision identity', () => {
  const a = evaluate(configTwo, destinationRequest(configTwo, { workspaceId: WS_A, destination: 'task.json' }));
  const b = evaluate(configTwo, destinationRequest(configTwo, { workspaceId: WS_B, destination: 'task.json' }));
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.decision!.canonicalExistingDirectoryAncestor, DEST_DIR_A);
  assert.equal(b.decision!.canonicalExistingDirectoryAncestor, DEST_DIR_B);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: artifact-kind difference changes the decision identity', () => {
  const a = evaluate(config, destinationRequest(config, { artifactKind: 'TaskSpec' }));
  const b = evaluate(config, destinationRequest(config, { artifactKind: 'CompletionContract' }));
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: lexical destination difference changes the decision identity', () => {
  const a = evaluate(config, destinationRequest(config, { destination: 'a.json' }));
  const b = evaluate(config, destinationRequest(config, { destination: 'b.json' }));
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: lexical prefix difference changes the decision identity (alias vs direct)', () => {
  // Same canonical ancestor and same tail, different lexical prefix and
  // relative destination: identities must differ.
  const alias = evaluate(
    config,
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], `${DEST_DIR_A}/internal`),
  );
  const direct = evaluate(
    config,
    destinationRequest(config, { destination: 'internal/task.json' }),
    aliasResolver(['internal'], `${DEST_DIR_A}/internal`),
  );
  assert.equal(alias.ok && direct.ok, true);
  assert.equal(alias.decision!.canonicalExistingDirectoryAncestor, direct.decision!.canonicalExistingDirectoryAncestor);
  assert.deepEqual(alias.decision!.destinationTailComponents, direct.decision!.destinationTailComponents);
  assert.notEqual(alias.decision!.decisionIdentity, direct.decision!.decisionIdentity);
});

test('L: canonical ancestor difference changes the decision identity', () => {
  const a = evaluate(
    config,
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], `${DEST_DIR_A}/internal`),
  );
  const b = evaluate(
    config,
    destinationRequest(config, { destination: 'alias/task.json' }),
    aliasResolver(['alias'], `${DEST_DIR_A}/other`),
  );
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: destination tail difference changes the decision identity', () => {
  const a = evaluate(config, destinationRequest(config, { destination: 'a/x.json' }));
  const b = evaluate(config, destinationRequest(config, { destination: 'a/y.json' }));
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: point-of-use revalidation marker is bound (unit)', () => {
  const base = identityInput();
  const a = computeDestinationDecisionIdentity(base);
  const b = computeDestinationDecisionIdentity({ ...base, pointOfUseRevalidationRequired: false as never });
  assert.notEqual(a.digest, b.digest);
});

test('L: registration-order independence', () => {
  const forward = validatedConfig({
    configurationVersion: '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: WS_A, root: '/srv/gateway/alpha', artifactLocation: DEST_DIR_A },
      { workspaceId: WS_B, root: '/srv/gateway/beta', artifactLocation: DEST_DIR_B },
    ],
  });
  const reversed = validatedConfig({
    configurationVersion: '2',
    capabilityVocabularyVersion: 'v1',
    provenance: { sourceKind: 'trusted-local-control-plane' },
    workspaces: [
      { workspaceId: WS_B, root: '/srv/gateway/beta', artifactLocation: DEST_DIR_B },
      { workspaceId: WS_A, root: '/srv/gateway/alpha', artifactLocation: DEST_DIR_A },
    ],
  });
  const a = evaluate(forward, destinationRequest(forward, { destination: 'task.json' }));
  const b = evaluate(reversed, destinationRequest(reversed, { destination: 'task.json' }));
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.decision!.configurationIdentity, b.decision!.configurationIdentity);
  assert.equal(a.decision!.decisionIdentity, b.decision!.decisionIdentity);
});

test('L: no identity on any failure', () => {
  const failures: Record<string, unknown>[] = [
    destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' }),
    destinationRequest(config, { artifactKind: 'ExecutionBundle' }),
    destinationRequest(config, { destination: 'a/../b' }),
    destinationRequest(config, { destination: '' }),
  ];
  for (const input of failures) {
    const report = evaluate(config, input);
    assert.equal(report.ok, false);
    assert.equal(report.decision, undefined);
    assert.equal('decisionIdentity' in report, false);
  }
});

test('L: no root material in digest or findings', () => {
  const report = evaluate(config, destinationRequest(config, { destination: 'secret-name.json' }));
  assert.equal(report.ok, true);
  assert.ok(!report.decision!.decisionIdentity.includes('secret'));
  assert.ok(!report.decision!.decisionIdentity.includes('srv'));
  const failReport = evaluate(config, destinationRequest(config, { destination: 'a/../b' }));
  const serialized = JSON.stringify(failReport.findings);
  assert.ok(!serialized.includes('srv'));
  assert.ok(!serialized.includes('gateway'));
  assert.ok(!serialized.includes('alpha'));
});

function identityInput() {
  return {
    destinationContainmentProtocolVersion: '1',
    operationClass: 'artifact-draft-destination',
    purpose: 'persist-validated-artifact-draft',
    configurationIdentity: config.identity,
    hostLane: config.hostLane,
    workspaceId: WS_A,
    artifactKind: 'TaskSpec' as const,
    canonicalArtifactRelativeDestination: 'task.json',
    currentCanonicalArtifactRoot: DEST_DIR_A,
    lexicalExistingDirectoryPrefixComponents: [] as readonly string[],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    destinationTailComponents: ['task.json'] as readonly string[],
    targetState: 'missing' as const,
    pointOfUseRevalidationRequired: true as const,
  };
}

test('L: identity binds the current canonical artifact root operand only (unit)', () => {
  const base = identityInput();
  const alt = { ...base, currentCanonicalArtifactRoot: `${DEST_DIR_A}/moved` };
  const a = computeDestinationDecisionIdentity(base);
  const b = computeDestinationDecisionIdentity(alt);
  // Changing ONLY the root operand changes the identity.
  assert.notEqual(a.digest, b.digest);
  // Independent recomputation WITHOUT the production identity constructor:
  // the manual digest must equal the constructor digest for each variant,
  // demonstrating that the root operand is included in the canonical
  // projection.
  const manual = (input: ReturnType<typeof identityInput>): string => {
    const projection = {
      destinationContainmentProtocolVersion: input.destinationContainmentProtocolVersion,
      operationClass: input.operationClass,
      purpose: input.purpose,
      configurationIdentity: input.configurationIdentity,
      hostLane: input.hostLane,
      workspaceId: input.workspaceId,
      artifactKind: input.artifactKind,
      canonicalArtifactRelativeDestination: input.canonicalArtifactRelativeDestination,
      currentCanonicalArtifactRoot: input.currentCanonicalArtifactRoot,
      lexicalExistingDirectoryPrefixComponents: [...input.lexicalExistingDirectoryPrefixComponents],
      canonicalExistingDirectoryAncestor: input.canonicalExistingDirectoryAncestor,
      destinationTailComponents: [...input.destinationTailComponents],
      targetState: input.targetState,
      pointOfUseRevalidationRequired: input.pointOfUseRevalidationRequired,
    };
    return 'sha-256:' + createHash('sha256')
      .update(DESTINATION_DECISION_DIGEST_DOMAIN, 'utf8')
      .update(jcsSerialize(projection), 'utf8')
      .digest('hex');
  };
  assert.equal(manual(base), a.digest);
  assert.equal(manual(alt), b.digest);
  assert.notEqual(manual(base), manual(alt));
  // No raw path material appears in the digest strings.
  assert.ok(!a.digest.includes('srv'));
  assert.ok(!b.digest.includes('srv'));
  assert.ok(!b.digest.includes('moved'));
});

test('L: helper smoke — joinParts across workspaces', () => {
  assert.equal(joinParts(['a', 'b']), 'a/b');
});
