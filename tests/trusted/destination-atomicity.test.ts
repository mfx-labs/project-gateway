/**
 * WP-6 Phase 2B: atomicity, product-boundary, and package-boundary (test
 * category M).
 *
 * The evaluator returns either one complete frozen decision or one complete
 * deterministic failure report; never a partial decision, partial identity,
 * or branded failed result. No generic write/create/overwrite/delete/rename/
 * move, shell, network, Git, MCP, RuntimeGrant, approval, persistence,
 * execution, or Phase-3 behavior exists; the package root stays closed; the
 * production core performs no direct I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as packageRoot from '../../src/index.js';
import * as trustedBarrel from '../../src/trusted/index.js';
import { evaluateProspectiveArtifactDestination } from '../../src/trusted/index.js';
import {
  validatedConfig,
  validatedV1Config,
  v2ConfigTwoWorkspaces,
  v2ConfigWithoutLocation,
  destinationRequest,
  destinationOptions,
  successResolver,
  failingResolver,
  countingResolver,
  evidenceResolver,
  DEST_DIR_A,
} from './destination-helpers.js';

const config = validatedConfig();

const evaluate = (input: Record<string, unknown>, resolver = successResolver('missing')) =>
  evaluateProspectiveArtifactDestination(input, destinationOptions(config, resolver));

test('M: resolver throw rejected (TAD-014); exactly one call; no decision', () => {
  const counted = countingResolver(() => {
    throw new Error('resolver boom');
  });
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-014');
  assert.equal(report.findings[0]!.messageKey, 'destination.resolver-invocation-error');
  assert.equal(report.decision, undefined);
  assert.equal(counted.calls(), 1);
});

test('M: malformed success evidence rejected (TAD-015); no decision', () => {
  const evidence = { ok: true, currentCanonicalArtifactRoot: DEST_DIR_A, artifactRootEntryKind: 'directory' };
  const report = evaluate(destinationRequest(config), evidenceResolver(evidence as never));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-015');
  assert.equal(report.decision, undefined);
});

test('M: malformed failure evidence rejected (TAD-016); no decision', () => {
  const report = evaluate(destinationRequest(config), evidenceResolver({ ok: false, subject: 'artifact-root' } as never));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-016');
  assert.equal(report.decision, undefined);
});

test('M: root valid and ancestor invalid (TAD-027); no decision', () => {
  const report = evaluate(destinationRequest(config), failingResolver('existing-ancestor', 'not-found'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-027');
  assert.equal(report.findings[0]!.messageKey, 'destination.ancestor-not-found');
  assert.equal(report.decision, undefined);
});

test('M: root/ancestor valid and target existing (TAD-039); no decision', () => {
  const report = evaluate(destinationRequest(config), successResolver('existing-file'));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-039');
  assert.equal(report.decision, undefined);
});

test('M: no partial decision on any failure', () => {
  const failures = [
    destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' }),
    destinationRequest(config, { destination: 'a/..' }),
  ];
  for (const input of failures) {
    const report = evaluate(input);
    assert.equal(report.ok, false);
    assert.equal(report.decision, undefined);
    assert.equal('decision' in report, false);
  }
  const fail = evaluate(destinationRequest(config), failingResolver('artifact-root', 'not-found'));
  assert.equal('decision' in fail, false);
});

test('M: decisions carry no brand and no own symbols (Phase-2A prospective model)', () => {
  const report = evaluate(destinationRequest(config));
  assert.equal(report.ok, true);
  assert.equal(Object.getOwnPropertySymbols(report.decision!).length, 0);
  assert.equal(Object.getOwnPropertySymbols(report).length, 0);
  const serialized = JSON.stringify(report.decision);
  assert.ok(!serialized.includes('WeakSet'));
  assert.ok(!serialized.includes('brand'));
});

test('M: package root exposes no Phase-2B surface', () => {
  for (const name of [
    'evaluateProspectiveArtifactDestination',
    'DESTINATION_CONTAINMENT_PROTOCOL_VERSION',
    'DESTINATION_CONTAINMENT_OPERATION_CLASS',
    'DESTINATION_CONTAINMENT_PURPOSE',
    'computeDestinationDecisionIdentity',
    'ProspectiveDestinationResolver',
    'ProspectiveArtifactDestinationDecision',
  ]) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('M: trusted barrel retains cohesive Phase-2B entry points and hides internals', () => {
  for (const name of ['evaluateProspectiveArtifactDestination', 'DESTINATION_CONTAINMENT_PROTOCOL_VERSION', 'computeDestinationDecisionIdentity']) {
    assert.equal(name in trustedBarrel, true, `barrel must retain ${name}`);
  }
  for (const name of ['snapshotDestinationRequest', 'parseDestinationComponents', 'captureDestinationResolutionEvidence', 'validateDestinationSuccessEvidence', 'validateDestinationFailureEvidence', 'combineAncestorAndTail']) {
    assert.equal(name in trustedBarrel, false, `barrel must not export ${name}`);
  }
});

test('M: no direct I/O imports in Phase-2B production modules', () => {
  const dir = fileURLToPath(new URL('../../src/trusted/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.startsWith('destination-') && f.endsWith('.ts'));
  const forbidden = ['node:fs', 'node:net', 'node:http', 'node:https', 'node:child_process', 'process.env', 'process.cwd', 'fetch(', 'Date.now', 'Math.random'];
  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${file}`);
    }
  }
});

test('M: no generic write/create/overwrite/mutation tokens in Phase-2B production modules', () => {
  const dir = fileURLToPath(new URL('../../src/trusted/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.startsWith('destination-') && f.endsWith('.ts'));
  const forbidden = ['writeFile', 'mkdir', 'rename(', 'unlink', 'appendFile', 'createWriteStream', 'rmSync', 'copyFile', 'execSync', 'spawnSync'];
  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${file}`);
    }
  }
});

test('M: zero resolver calls for failures before the resolver stage', () => {
  const earlyFailures: Record<string, unknown>[] = [
    destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' }),
    destinationRequest(config, { artifactKind: 'ExecutionBundle' }),
    destinationRequest(config, { destination: '' }),
    destinationRequest(config, { destination: '/abs' }),
    destinationRequest(config, { destination: 'a/../b' }),
    destinationRequest(config, { extra: 1 }),
  ];
  for (const input of earlyFailures) {
    const counted = countingResolver(successResolver('missing'));
    const report = evaluate(input, counted.resolver);
    assert.equal(report.ok, false, JSON.stringify(input));
    assert.equal(counted.calls(), 0, JSON.stringify(input));
  }
});

test('M: conformance total tracks the committed package; schema count remains 51', () => {
  const stats = packageRoot.manifestStats();
  assert.equal(stats.entries, 587);
  assert.equal(stats.schemas, 51);
});

test('M: findings are static, deterministic, and path-safe', () => {
  const report = evaluate(destinationRequest(config, { destination: 'a/../secret' }), failingResolver('artifact-root', 'not-found'));
  assert.equal(report.ok, false);
  const first = JSON.stringify(report.findings);
  const second = JSON.stringify(evaluate(destinationRequest(config, { destination: 'a/../secret' }), failingResolver('artifact-root', 'not-found')).findings);
  assert.equal(first, second);
  assert.ok(!first.includes('secret'));
  assert.ok(!first.includes('srv'));
});

// ---------------------------------------------------------------------------
// F-2B-IMP-01 — root-freshness probes (direct evaluator branches)
// ---------------------------------------------------------------------------

test('M: root mismatch — current canonical root differs from the configuration-bound root (TAD-026)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: '/srv/gateway/alpha/artifacts-elsewhere',
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: '/srv/gateway/alpha/artifacts-elsewhere',
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-026');
  assert.equal(report.findings[0]!.messageKey, 'destination.artifact-root-canonical-mismatch');
  assert.equal(counted.calls(), 1);
  assert.equal(report.decision, undefined);
  assert.equal('decisionIdentity' in report, false);
  const serialized = JSON.stringify(report.findings);
  assert.ok(!serialized.includes('srv'), 'no configured or evidence root in findings');
  assert.ok(!serialized.includes('gateway'));
  assert.ok(!serialized.includes('elsewhere'));
  assert.equal(Object.isFrozen(report.findings), true);
  assert.equal(Object.isFrozen(report), true);
});

test('M: current canonical root "/" rejected (TAD-026)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: '/',
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: '/',
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-026');
  assert.equal(report.findings[0]!.messageKey, 'destination.artifact-root-canonical-mismatch');
  assert.equal(counted.calls(), 1);
  assert.equal(report.decision, undefined);
  assert.equal('decisionIdentity' in report, false);
  // Static finding message discloses no path material (the words
  // "whole-filesystem root" are not a path).
  assert.ok(!JSON.stringify(report.findings).includes('srv'));
});

test('M: configured root effectively redirected to another canonical location (TAD-026)', () => {
  // The configuration-bound canonical path is replaced by an alias whose
  // current canonical target is a different external location: the observed
  // current canonical root is the redirected path and fails the exact
  // canonical correlation.
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: '/srv/elsewhere/redirected-artifacts',
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: '/srv/elsewhere/redirected-artifacts',
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-026');
  assert.equal(counted.calls(), 1);
  assert.equal(report.decision, undefined);
  assert.ok(!JSON.stringify(report.findings).includes('redirected'));
});

test('M: canonical existing directory ancestor "/" rejected (TAD-033)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: '/',
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-033');
  assert.equal(report.findings[0]!.messageKey, 'destination.ancestor-outside-root');
  assert.equal(counted.calls(), 1);
  assert.equal(report.decision, undefined);
  assert.equal('decisionIdentity' in report, false);
  assert.ok(!JSON.stringify(report.findings).includes('srv'));
});

// ---------------------------------------------------------------------------
// F-2B-IMP-02 — simultaneous-failure precedence probes
// ---------------------------------------------------------------------------

test('M: precedence 1 — forged configuration wins over malformed request (TAD-001, zero calls)', () => {
  const forged = { ...config };
  const counted = countingResolver(successResolver('missing'));
  const report = evaluateProspectiveArtifactDestination(
    destinationRequest(config, { destination: 'a/../b' }),
    { configuration: forged as never, resolveProspectiveDestination: counted.resolver },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-001');
  assert.equal(counted.calls(), 0);
  assert.equal(report.decision, undefined);
});

test('M: precedence 2 — version-1 configuration wins over unknown workspace (TAD-002, zero calls)', () => {
  const v1 = validatedV1Config();
  const counted = countingResolver(successResolver('missing'));
  const report = evaluateProspectiveArtifactDestination(
    { expectedConfigurationIdentity: v1.identity, workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz', artifactKind: 'TaskSpec', destination: 'a.json' },
    { configuration: v1, resolveProspectiveDestination: counted.resolver },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-002');
  assert.equal(counted.calls(), 0);
});

test('M: precedence 3 — unknown workspace wins over malformed destination (TAD-003, zero calls)', () => {
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz', destination: 'a/../b' }), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-003');
  assert.equal(counted.calls(), 0);
});

test('M: precedence 4 — missing artifact location wins over unsupported artifact kind (TAD-004, zero calls)', () => {
  const noLocation = validatedConfig(v2ConfigWithoutLocation());
  const counted = countingResolver(successResolver('missing'));
  const report = evaluateProspectiveArtifactDestination(
    destinationRequest(noLocation, { artifactKind: 'ExecutionBundle' }),
    { configuration: noLocation, resolveProspectiveDestination: counted.resolver },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-004');
  assert.equal(counted.calls(), 0);
});

test('M: precedence 5 — expected identity mismatch wins over malformed destination (TAD-005, zero calls)', () => {
  const other = validatedConfig(v2ConfigTwoWorkspaces());
  assert.notEqual(other.identity, config.identity);
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(
    destinationRequest(config, { expectedConfigurationIdentity: other.identity, destination: 'a/../b' }),
    counted.resolver,
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-005');
  assert.equal(counted.calls(), 0);
});

test('M: precedence 6 — unsupported artifact kind wins over invalid grammar (TAD-006, zero calls)', () => {
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(destinationRequest(config, { artifactKind: 'ExecutionBundle', destination: 'a/../b' }), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-006');
  assert.equal(counted.calls(), 0);
});

test('M: precedence 7 — invalid grammar wins over missing resolver (grammar finding, zero calls)', () => {
  const report = evaluateProspectiveArtifactDestination(
    destinationRequest(config, { destination: 'a/../b' }),
    { configuration: config, resolveProspectiveDestination: undefined as never },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-010');
  assert.notEqual(report.findings[0]!.code, 'TAD-013');
});

test('M: precedence 8 — resolver throw wins over a hypothetical malformed return (TAD-014, exactly one call)', () => {
  const counted = countingResolver(() => {
    throw new Error('boom');
  });
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-014');
  assert.equal(report.findings[0]!.messageKey, 'destination.resolver-invocation-error');
  assert.equal(counted.calls(), 1);
  assert.equal(report.decision, undefined);
  // A throwing resolver returns no evidence: no capture or malformed-
  // evidence finding can be produced.
  assert.ok(!report.findings.some((f) => ['TAD-015', 'TAD-016', 'TAD-020'].includes(f.code)));
});

test('M: precedence 9 — malformed evidence wins over an embedded root mismatch (TAD-015, exactly one call)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: '/srv/elsewhere',
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: '/srv/elsewhere',
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
    extra: 1,
  };
  const counted = countingResolver(evidenceResolver(evidence as never));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-015');
  assert.equal(counted.calls(), 1);
  assert.ok(!report.findings.some((f) => f.code === 'TAD-026'));
  assert.equal(report.decision, undefined);
});

test('M: precedence 10 — root canonical mismatch wins over ancestor escape (TAD-026, exactly one call, no TAD-033)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: '/srv/gateway/alpha/artifacts-moved',
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: '/srv/outside',
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'missing' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-026');
  assert.equal(counted.calls(), 1);
  assert.ok(!report.findings.some((f) => f.code === 'TAD-033'));
  assert.equal(report.decision, undefined);
});

test('M: precedence 11 — alias prefix mismatch wins over an existing final target (TAD-035, exactly one call, no TAD-039)', () => {
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: ['x'],
    canonicalExistingDirectoryAncestor: `${DEST_DIR_A}/x`,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['b'],
    targetState: 'existing-file' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config, { destination: 'a/b' }), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-035');
  assert.equal(counted.calls(), 1);
  assert.ok(!report.findings.some((f) => f.code === 'TAD-039'));
  assert.equal(report.decision, undefined);
});

test('M: precedence 12 — existing final target wins over identity construction (TAD-039, exactly one call, identity constructor not reached)', () => {
  // The evaluator returns at the existing-target policy stage (17) before
  // the decision-identity stage (18), so the identity constructor is never
  // reached for an existing target. The constructor is deterministic and
  // functional (proven by the independent recomputation tests in
  // destination-decision), so the exactly-one-finding TAD-039 report with no
  // TAD-045 and no decision identity demonstrates the early return.
  const evidence = {
    ok: true as const,
    currentCanonicalArtifactRoot: DEST_DIR_A,
    artifactRootEntryKind: 'directory' as const,
    lexicalExistingDirectoryPrefixComponents: [],
    canonicalExistingDirectoryAncestor: DEST_DIR_A,
    existingAncestorEntryKind: 'directory' as const,
    destinationTailComponents: ['task.json'],
    targetState: 'existing-file' as const,
  };
  const counted = countingResolver(evidenceResolver(evidence));
  const report = evaluate(destinationRequest(config), counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]!.code, 'TAD-039');
  assert.ok(!report.findings.some((f) => f.code === 'TAD-045'));
  assert.equal(counted.calls(), 1);
  assert.equal(report.decision, undefined);
  assert.equal('decisionIdentity' in report, false);
});

// ---------------------------------------------------------------------------
// F-2B-IMP-02 — capture boundary pre-step probe
// ---------------------------------------------------------------------------

test('M: hostile request capture is a boundary pre-step — capture failure wins over later gates (TAD-007, zero calls, zero getter invocations)', () => {
  // The evaluator descriptor-captures the untrusted request before reading
  // any request field. A request whose capture fails (accessor descriptor)
  // cannot have its workspace or expected-identity gates evaluated from the
  // hostile original object: TAD-007 is returned and no later semantic gate
  // is evaluated. It would be false to assert that unknown-workspace (stage
  // 3) wins over an object that cannot be safely captured.
  let invoked = 0;
  const input = destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' });
  Object.defineProperty(input, 'workspaceId', {
    enumerable: true,
    get() {
      invoked++;
      return 'pgw:w:zzzzzzzzzzzzzzzz';
    },
  });
  const counted = countingResolver(successResolver('missing'));
  const report = evaluate(input, counted.resolver);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TAD-007');
  assert.equal(report.findings[0]!.messageKey, 'destination.request-snapshot-failed');
  assert.equal(invoked, 0);
  assert.equal(counted.calls(), 0);
  assert.equal(report.decision, undefined);
  // Contrast: a well-formed request with the same unknown workspace is
  // captured safely and reaches the workspace gate (TAD-003); later semantic
  // gates are evaluated only from the detached captured snapshot.
  const wellFormed = evaluate(destinationRequest(config, { workspaceId: 'pgw:w:zzzzzzzzzzzzzzzz' }), counted.resolver);
  assert.equal(wellFormed.ok, false);
  assert.equal(wellFormed.findings[0]!.code, 'TAD-003');
  assert.equal(counted.calls(), 0);
});
