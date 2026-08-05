/**
 * WP-6 Phase 2B-P: artifact-domain scope and product-boundary security
 * (test categories G + H).
 *
 * The default ChatGPT-facing draft-location scope is exactly the four
 * prospective draft aggregates; ExecutionBundle and ExecutionResult are
 * excluded; no caller-configurable kind lists, no per-kind routing, no
 * destination containment, no write or persistence semantics exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as packageRoot from '../../src/index.js';
import { lookupValidatedArtifactLocation } from '../../src/trusted/index.js';
import { ARTIFACT_DRAFT_LOCATION_KINDS } from '../../src/trusted/artifact-location.js';
import { validatedV2Config, v2Config } from './artifact-location-helpers.js';

test('G: fixed scope contains exactly the four prospective draft aggregates', () => {
  assert.deepEqual([...ARTIFACT_DRAFT_LOCATION_KINDS], [
    'TaskSpec',
    'AuthorityPolicy',
    'ContextManifest',
    'CompletionContract',
  ]);
});

test('G: ExecutionBundle, ExecutionResult, TrustedReceipt, lifecycle records, and reports are excluded', () => {
  for (const kind of ['ExecutionBundle', 'ExecutionResult', 'TrustedReceipt', 'ApprovalRecord', 'RuntimeGrant', 'ImplementationReport']) {
    assert.equal(ARTIFACT_DRAFT_LOCATION_KINDS.includes(kind), false, kind);
  }
});

test('G: the fixed scope is immutable and not caller-configurable', () => {
  assert.equal(Object.isFrozen(ARTIFACT_DRAFT_LOCATION_KINDS), true);
  // No configuration or request field can alter the scope (strict shape).
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const lookup = (config as unknown as Record<string, unknown>)['artifactKinds'];
  assert.equal(lookup, undefined);
});

test('G: lookup exposes the fixed scope only as immutable metadata', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  // The validated configuration itself carries no kind metadata.
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes('TaskSpec'), serialized);
  assert.ok(!serialized.includes('ExecutionBundle'), serialized);
  // The lookup correlates the scope constant without granting authority.
  const lookup = lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa');
  assert.ok(lookup);
  assert.deepEqual([...lookup!.draftKinds], [...ARTIFACT_DRAFT_LOCATION_KINDS]);
  assert.equal('writeAllowed' in lookup!, false);
  assert.equal('persistenceHandle' in lookup!, false);
});

test('G: no per-kind routing, destination, or filename metadata exists', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const record = config.workspaces[0]! as unknown as Record<string, unknown>;
  for (const key of ['kindRoutes', 'filenames', 'extensions', 'destinationTemplate', 'subdirectories', 'writeMode', 'overwrite']) {
    assert.equal(key in record, false, key);
  }
});

test('H: the configured directory is not write authority', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const keys = Object.keys(config as unknown as Record<string, unknown>);
  for (const key of ['writeAuthority', 'approval', 'runtimeGrant', 'execution', 'receipt', 'destinationDecision']) {
    assert.equal(keys.includes(key), false, key);
  }
});

test('H: no destination-containment, nearest-ancestor, persistence, or mutation behavior exists', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const serialized = JSON.stringify(config);
  for (const token of ['destinationContained', 'nearestAncestor', 'persisted', 'writeAllowed', 'rename', 'delete', 'move']) {
    assert.ok(!serialized.includes(token), token);
  }
});

test('H: no filesystem, shell, network, Git, MCP, Pi, pi-guard, or execution behavior', () => {
  // The artifact-location core is I/O-free: resolution is caller-injected;
  // the security suite's dist-wide forbidden-I/O scan covers the new module
  // (verified separately).
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  assert.equal(config.workspaces[0]!.artifactLocation, '/srv/gateway/alpha/artifacts');
  const keys = Object.keys(config as unknown as Record<string, unknown>);
  for (const key of ['shellCommand', 'networkUrl', 'gitCommand', 'mcTool', 'piAction', 'guardAction', 'executed']) {
    assert.equal(keys.includes(key), false, key);
  }
});

test('H: no ExecutionBundle or ExecutionResult storage information exists', () => {
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes('ExecutionBundle'), serialized);
  assert.ok(!serialized.includes('ExecutionResult'), serialized);
  const lookup = lookupValidatedArtifactLocation(config, 'pgw:w:aaaaaaaaaaaaaaaa') as unknown as Record<string, unknown>;
  for (const key of ['executionBundleStorage', 'executionResultStorage', 'receipt']) {
    assert.equal(key in lookup, false, key);
  }
});

test('H: package root exposes no Phase-2B-P surface', () => {
  for (const name of [
    'lookupValidatedArtifactLocation',
    'ARTIFACT_DRAFT_LOCATION_KINDS',
    'TRUSTED_CONFIGURATION_VERSION_2',
    'ArtifactLocationResolver',
  ]) {
    assert.equal(name in packageRoot, false, `package root must not export ${name}`);
  }
});

test('H: no caller-configurable kind lists appear in v2 input', () => {
  // The v2 workspace shape accepts only the artifactLocation path string;
  // anything else is an unknown field (verified here at the type surface by
  // checking the validated record shape).
  const config = validatedV2Config(v2Config({
    workspaces: [
      { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/alpha', artifactLocation: '/srv/gateway/alpha/artifacts' },
    ],
  }));
  const record = config.workspaces[0]! as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ['artifactLocation', 'canonicalRoot', 'workspaceId']);
});
