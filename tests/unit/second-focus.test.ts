/**
 * Second focused correction tests: per-call snapshot traversal state,
 * non-forgeable WeakSet membership branding, exact phase gates, and identity
 * registration/verification mode separation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRawJsonInput,
  createSchemaRegistry,
  validateArtifactSelf,
  validateArtifactRevision,
  validateRegistrySnapshot,
  validateLifecycleRecord,
  validateArtifactForUse,
  computeArtifactDigest,
  MemoryIdentityState,
  snapshotJson,
  isBrandedArtifact,
  isBrandedRegistry,
  isBrandedRecord,
  isLevelAtLeast,
} from '../../src/index.js';
import { SnapshotError } from '../../src/internal/snapshot.js';
import { runArtifactPipeline } from '../../src/engine/pipeline.js';
import { checkProposedRegistration, verifyExistingRegistration } from '../../src/engine/identity.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import { VALIDATION_PHASES } from '../../src/api/validate.js';
import type { ValidatedArtifact, ValidationLevel } from '../../src/api/types.js';

const reg = createSchemaRegistry();
const corpus = CORPUS_INPUTS as Record<string, string>;
function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8').decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
}
function taskModel(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/task-minimal-genesis.json'))) as Record<string, unknown>;
}
function bundleModel(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadJson('fixtures/artifacts/valid/bundle-minimal-genesis.json'))) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Correction 6 — per-call snapshot traversal state
// ---------------------------------------------------------------------------
test('snapshot: same invalid object twice produces the same error', () => {
  const cyclic = { a: {} } as Record<string, unknown>;
  cyclic['a'] = cyclic;
  let first: unknown;
  let second: unknown;
  try {
    snapshotJson(cyclic);
  } catch (e) {
    first = (e as Error).message;
  }
  try {
    snapshotJson(cyclic);
  } catch (e) {
    second = (e as Error).message;
  }
  assert.equal(first, second);
  assert.match(String(first), /cyclic/);
});

test('snapshot: a failed nested traversal does not contaminate a later valid call', () => {
  const bad = { inner: { boom: {} } } as Record<string, unknown>;
  (bad['inner'] as Record<string, unknown>)['boom'] = bad['inner'];
  assert.throws(() => snapshotJson(bad), SnapshotError);
  const good = { a: 1, b: [1, 2, 3], c: 'x' };
  const snap = snapshotJson(good) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), good);
});

test('snapshot: failed object A does not affect object B', () => {
  const a = { x: {} } as Record<string, unknown>;
  a['x'] = a;
  assert.throws(() => snapshotJson(a), SnapshotError);
  const b = { x: { y: 'ok' } };
  assert.deepEqual(JSON.parse(JSON.stringify(snapshotJson(b))), b);
});

test('snapshot: true self-cycle is rejected', () => {
  const cyclic = { name: 'self' } as Record<string, unknown>;
  cyclic['self'] = cyclic;
  assert.throws(() => snapshotJson(cyclic), SnapshotError);
});

test('snapshot: mutual cycle is rejected', () => {
  const a = { name: 'a' } as Record<string, unknown>;
  const b = { name: 'b' } as Record<string, unknown>;
  a['other'] = b;
  b['other'] = a;
  assert.throws(() => snapshotJson(a), SnapshotError);
  assert.throws(() => snapshotJson(b), SnapshotError);
});

test('snapshot: repeated shared acyclic reference is accepted per the documented policy', () => {
  const shared = { id: 1, tags: ['x'] };
  const root = { first: shared, second: shared };
  const snap = snapshotJson(root) as { first: object; second: object };
  // independent immutable subtrees: no shared mutable reference with the caller
  assert.notEqual(snap.first, snap.second);
  assert.notEqual(snap.first, shared);
  assert.equal(Object.isFrozen(snap.first), true);
  assert.equal(Object.isFrozen((snap.first as { tags: unknown[] }).tags), true);
  // mutating the caller's shared object cannot affect the snapshot
  (shared as { id: number }).id = 2;
  assert.equal((snap.first as { id: number }).id, 1);
});

test('snapshot: repeated shared reference inside an array is accepted', () => {
  const shared = { v: 7 };
  const snap = snapshotJson([shared, shared, { v: 8 }]) as object[];
  assert.equal(snap.length, 3);
  assert.notEqual(snap[0], snap[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(snap[0])), { v: 7 });
});

test('snapshot: reentrant calls do not share state', () => {
  // snapshotJson never invokes accessors; a getter that attempted a nested
  // snapshot call is rejected without executing
  const t = taskModel();
  let innerCalls = 0;
  Object.defineProperty(t, 'booby', {
    enumerable: true,
    get() {
      innerCalls++;
      snapshotJson({ inner: true });
      return 'x';
    },
  });
  assert.throws(() => snapshotJson(t), SnapshotError);
  assert.equal(innerCalls, 0);
});

test('snapshot: concurrent Promise-level calls do not share state', async () => {
  const bad = { a: {} } as Record<string, unknown>;
  bad['a'] = bad;
  const good = { a: { b: [1] } };
  const results = await Promise.all([
    Promise.resolve().then(() => {
      try {
        snapshotJson(bad);
        return 'accepted';
      } catch {
        return 'rejected';
      }
    }),
    Promise.resolve().then(() => JSON.stringify(snapshotJson(good))),
    Promise.resolve().then(() => {
      try {
        snapshotJson(JSON.parse(JSON.stringify(bad)));
        return 'accepted';
      } catch {
        return 'rejected';
      }
    }),
  ]);
  assert.equal(results[0], 'rejected');
  assert.equal(results[1], JSON.stringify(good));
  assert.equal(results[2], 'rejected');
});

test('snapshot: deterministic error path and no module-global traversal state', async () => {
  const a = { x: {} } as Record<string, unknown>;
  a['x'] = a;
  const b = JSON.parse(JSON.stringify({ x: {} })) as Record<string, unknown>;
  b['x'] = b;
  let ma = '';
  let mb = '';
  try {
    snapshotJson(a);
  } catch (e) {
    ma = (e as Error).message;
  }
  try {
    snapshotJson(b);
  } catch (e) {
    mb = (e as Error).message;
  }
  assert.equal(ma, mb);
  const src = new TextDecoder().decode(
    new Uint8Array(await import('node:fs').then((fs) => fs.promises.readFile(new URL('../../../src/internal/snapshot.ts', import.meta.url)))),
  );
  assert.ok(!/\bconst seen\s*=\s*new WeakMap/.test(src), 'module-global WeakMap traversal state exists');
  // the only WeakSets are the three module-private membership sets
  const weakSets = src.match(/new WeakSet/g) ?? [];
  assert.equal(weakSets.length, 3, 'unexpected module-global WeakSet');
});

// ---------------------------------------------------------------------------
// Correction 5 — non-forgeable private membership branding
// ---------------------------------------------------------------------------
test('branding: extracting all symbols from a valid wrapper cannot forge membership', () => {
  const report = validateArtifactSelf(taskModel(), reg);
  const real = report.value as ValidatedArtifact;
  assert.equal(isBrandedArtifact(real), true);
  assert.equal(Object.getOwnPropertySymbols(real).length, 0);
  const symbols = Object.getOwnPropertySymbols(real);
  const forged = { ...real } as Record<PropertyKey, unknown>;
  for (const s of symbols) forged[s] = true;
  assert.equal(isBrandedArtifact(forged), false);
});

test('branding: spread wrapper is not branded', () => {
  const real = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const spread = { ...real };
  assert.equal(isBrandedArtifact(spread), false);
  assert.equal(Object.getOwnPropertySymbols(spread).length, 0);
});

test('branding: cloned wrapper fields are not branded', () => {
  const real = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const clone = {
    kind: real.kind,
    instanceId: real.instanceId,
    revisionId: real.revisionId,
    digest: real.digest,
    canonicalUtf8: real.canonicalUtf8,
    level: real.level,
    model: real.model,
  };
  assert.equal(isBrandedArtifact(clone), false);
});

test('branding: proxy around a valid wrapper is not branded', () => {
  const real = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const proxy = new Proxy(real, {});
  assert.equal(isBrandedArtifact(proxy), false);
  // the original wrapper remains recognized
  assert.equal(isBrandedArtifact(real), true);
});

test('branding: artifact guard rejects registry wrapper and vice versa', () => {
  const artifact = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const registry = validateRegistrySnapshot(loadJson('fixtures/registry/valid/registry-v1.json'), reg).value!;
  assert.equal(isBrandedArtifact(artifact), true);
  assert.equal(isBrandedRegistry(artifact), false);
  assert.equal(isBrandedArtifact(registry), false);
  assert.equal(isBrandedRegistry(registry), true);
  assert.equal(isBrandedRecord(artifact), false);
  assert.equal(isBrandedRecord(registry), false);
});

test('branding: lifecycle guard rejects artifact wrapper', () => {
  const artifact = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const record = validateLifecycleRecord(loadJson('fixtures/lifecycle/valid/approval-task.json'), reg).value!;
  assert.equal(isBrandedRecord(record), true);
  assert.equal(isBrandedRecord(artifact), false);
  assert.equal(isBrandedArtifact(record), false);
});

test('branding: original wrapper remains recognized after failed forgeries', () => {
  const real = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const spread = { ...real };
  const clone = { ...real };
  assert.equal(isBrandedArtifact(real), true);
  assert.equal(isBrandedArtifact(spread), false);
  assert.equal(isBrandedArtifact(clone), false);
  assert.equal(isBrandedArtifact(real), true);
});

test('branding: no brand property exists and branding never serializes', () => {
  const real = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  assert.equal(Object.getOwnPropertySymbols(real).length, 0);
  const keys = Object.keys(real as unknown as Record<string, unknown>);
  assert.ok(!keys.some((k) => k.includes('brand') || k.includes('BRAND')));
  assert.ok(!JSON.stringify(real).includes('brand'));
  assert.ok(!JSON.stringify(real).includes('BRAND'));
});

test('branding: plain object with identical fields does not pass the guard', () => {
  const real = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const lookalike = {
    kind: real.kind,
    instanceId: real.instanceId,
    revisionId: real.revisionId,
    digest: real.digest,
    canonicalUtf8: real.canonicalUtf8,
    level: 'point-of-use-eligible' as ValidationLevel,
    model: real.model,
  };
  assert.equal(isBrandedArtifact(lookalike), false);
});

test('branding: memberships are distinct across wrapper classes', () => {
  const artifact = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  const registry = validateRegistrySnapshot(loadJson('fixtures/registry/valid/registry-v1.json'), reg).value!;
  const record = validateLifecycleRecord(loadJson('fixtures/lifecycle/valid/approval-task.json'), reg).value!;
  assert.equal(isBrandedArtifact(artifact) && !isBrandedRegistry(artifact) && !isBrandedRecord(artifact), true);
  assert.equal(!isBrandedArtifact(registry) && isBrandedRegistry(registry) && !isBrandedRecord(registry), true);
  assert.equal(!isBrandedArtifact(record) && !isBrandedRegistry(record) && isBrandedRecord(record), true);
});

// ---------------------------------------------------------------------------
// Correction 2 — exact phase gates
// ---------------------------------------------------------------------------
test('phases: every through phase stops exactly at the requested phase', () => {
  // a model that would fail structural validation
  const structuralBad = taskModel();
  structuralBad['status'] = 'approved';
  // a model that would fail digest verification
  const digestBad = taskModel();
  (digestBad['revision'] as Record<string, unknown>)['digest'] = 'sha-256:' + '0'.repeat(64);
  // a model that would fail semantic self-validation
  const semanticBad = taskModel();
  (semanticBad['body'] as Record<string, unknown>)['objective'] = 'This execution is authorized by the trusted ceiling.';
  semanticBad['revision'] = { ...(semanticBad['revision'] as object), digest: computeArtifactDigest(semanticBad as never).digest };

  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  // a conflict-free successor (semantic would fail if executed)
  const successor = taskModel();
  successor['revision'] = {
    id: 'pgw:r:' + 'a'.repeat(31) + '2',
    generation: 1,
    predecessor: {
      target_protocol_version: '1.0',
      target_kind: { id: 'TaskSpec', version: '1.0' },
      target_instance_id: genesis.instanceId,
      target_revision_id: genesis.revisionId,
      target_digest: genesis.digest,
      target_workspace_binding: { mode: 'portable' },
    },
    digest: 'P',
  };
  (successor['body'] as Record<string, unknown>)['objective'] = 'This execution is authorized by the trusted ceiling.';
  successor['revision'] = { ...(successor['revision'] as object), digest: computeArtifactDigest(successor as never).digest };

  // canonical-input-validation stops before structural
  let r = validateArtifactRevision(structuralBad, reg, 'canonical-input-validation');
  assert.equal(r.ok, true);
  assert.equal(r.level, 'canonical-input-valid');
  assert.equal(r.value, undefined);
  // schema-identification stops after selection, before structural
  r = validateArtifactRevision(structuralBad, reg, 'schema-identification');
  assert.equal(r.ok, true);
  assert.equal(r.level, 'canonical-input-valid');
  assert.equal(r.schemaId, 'urn:project-gateway:schema:artifact:1.0:kinds:task-spec');
  assert.equal(r.value, undefined);
  // structural-schema-validation stops after structural, before digest
  r = validateArtifactRevision(digestBad, reg, 'structural-schema-validation');
  assert.equal(r.ok, true);
  assert.equal((r.value as ValidatedArtifact).level, 'structural-valid');
  // canonicalization-and-digest-verification stops before semantic
  r = validateArtifactRevision(semanticBad, reg, 'canonicalization-and-digest-verification');
  assert.equal(r.ok, true);
  assert.equal((r.value as ValidatedArtifact).level, 'digest-verified');
  // identity-registration stops after proposed checks, before semantic
  r = validateArtifactRevision(successor, reg, 'identity-registration', { identity: id });
  assert.equal(r.ok, true);
  assert.equal((r.value as ValidatedArtifact).level, 'digest-verified');
  // semantic-self-validation executes semantic checks and stops before registry
  r = validateArtifactRevision(taskModel(), reg, 'semantic-self-validation');
  assert.equal(r.ok, true);
  assert.equal((r.value as ValidatedArtifact).level, 'self-semantic-valid');
});

test('phases: structural request returns structural-valid; semantic returns self-semantic-valid', () => {
  const structural = validateArtifactRevision(taskModel(), reg, 'structural-schema-validation');
  assert.equal(structural.ok, true);
  assert.equal((structural.value as ValidatedArtifact).level, 'structural-valid');
  const semantic = validateArtifactRevision(taskModel(), reg, 'semantic-self-validation');
  assert.equal(semantic.ok, true);
  assert.equal((semantic.value as ValidatedArtifact).level, 'self-semantic-valid');
});

test('phases: no registry inputs means no registry-compatible wrapper', () => {
  const r = validateArtifactRevision(taskModel(), reg, 'registry-compatibility');
  assert.equal(r.ok, false);
  assert.equal(r.value, undefined);
  assert.equal(r.firstFailingPhase, 'registry-compatibility');
  assert.ok(r.ruleIds.length > 0 || r.category === 'REGISTRY-INCOMPATIBILITY');
});

test('phases: registry-compatible wrapper requires actual registry evaluation', () => {
  const snapshotModel = loadJson('fixtures/registry/valid/registry-v1.json');
  const snapshot = validateRegistrySnapshot(snapshotModel, reg).value!;
  const accepted = {
    registryProtocolId: 'project-gateway.registry',
    registrySnapshotFormatVersion: '1.0',
    registrySnapshotId: String(snapshotModel['snapshot_id']),
    registrySnapshotDigest: String(snapshotModel['snapshot_digest']),
    snapshot,
  };
  const r = validateArtifactRevision(taskModel(), reg, 'registry-compatibility', {
    registry: accepted,
    consumerSupport: {
      consumerId: 'test',
      supportedProtocolFeatures: [],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: [],
    },
  });
  assert.equal(r.ok, true);
  assert.equal((r.value as ValidatedArtifact).level, 'registry-compatible');
});

test('phases: later phases never label a subject beyond executed phases', () => {
  const snapshotModel = loadJson('fixtures/registry/valid/registry-v1.json');
  const snapshot = validateRegistrySnapshot(snapshotModel, reg).value!;
  const accepted = {
    registryProtocolId: 'project-gateway.registry',
    registrySnapshotFormatVersion: '1.0',
    registrySnapshotId: String(snapshotModel['snapshot_id']),
    registrySnapshotDigest: String(snapshotModel['snapshot_digest']),
    snapshot,
  };
  // without lifecycle inputs the pipeline must not claim lifecycle-verified
  const r = validateArtifactRevision(taskModel(), reg, 'trusted-lifecycle-verification', {
    registry: accepted,
    consumerSupport: {
      consumerId: 'test',
      supportedProtocolFeatures: [],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: [],
    },
  });
  assert.equal(r.ok, true);
  assert.equal((r.value as ValidatedArtifact).level, 'registry-compatible');
  assert.notEqual((r.value as ValidatedArtifact).level, 'lifecycle-verified');
});

test('levels: validation-level guards reject lower-level wrappers where higher-level are required', () => {
  assert.equal(isLevelAtLeast('structural-valid', 'registry-compatible'), false);
  assert.equal(isLevelAtLeast('registry-compatible', 'structural-valid'), true);
  assert.equal(isLevelAtLeast('self-semantic-valid', 'point-of-use-eligible'), false);
  assert.equal(isLevelAtLeast('point-of-use-eligible', 'self-semantic-valid'), true);
  const self = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  assert.equal(self.level, 'self-semantic-valid');
  assert.equal(isLevelAtLeast(self.level, 'point-of-use-eligible'), false);
  assert.equal(isLevelAtLeast(self.level, 'structural-valid'), true);
});

test('phases: canonical-input gate rejects non-NFC at its own phase', () => {
  const t = taskModel();
  (t['body'] as Record<string, unknown>)['objective'] = 'cafe\u0301';
  const r = validateArtifactRevision(t, reg, 'canonical-input-validation');
  assert.equal(r.ok, false);
  assert.equal(r.firstFailingPhase, 'canonical-input-validation');
  assert.equal(r.category, 'NON-NFC-STRING');
});

// ---------------------------------------------------------------------------
// Correction 2 — identity registration versus verification
// ---------------------------------------------------------------------------
test('identity: existing genesis revision verifies successfully (no false instance-reuse)', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  // verification mode must not reject the registered genesis as new reuse
  const pipeline = runArtifactPipeline(taskModel(), {
    schemaRegistry: reg,
    identity: id,
    through: 'semantic-self-validation',
    identityMode: 'verify',
  });
  assert.equal(pipeline.ok, true);
  assert.equal(verifyExistingRegistration(genesis.model, id), true);
});

test('identity: proposing a second genesis revision for the same instance fails', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  const second = taskModel();
  second['revision'] = { ...(second['revision'] as object), id: 'pgw:r:' + 'b'.repeat(32) };
  second['revision'] = { ...(second['revision'] as object), digest: computeArtifactDigest(second as never).digest };
  const r = validateArtifactRevision(second, reg, 'identity-registration', { identity: id });
  assert.equal(r.ok, false);
  assert.equal(r.firstFailingPhase, 'identity-registration');
  assert.ok(r.ruleIds.includes('LIN-001'));
});

test('identity: checkProposedRegistration detects digest, predecessor, and generation conflicts', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  // digest conflict: same revision id, different content
  const collision = taskModel();
  (collision['body'] as Record<string, unknown>)['objective'] = 'different content';
  collision['revision'] = { ...(collision['revision'] as object), digest: computeArtifactDigest(collision as never).digest };
  const findings = checkProposedRegistration(collision, id);
  assert.ok(findings.some((f) => f.ruleIds.includes('LIN-002')));
  // generation conflict: successor declares generation 5
  const successor = taskModel();
  successor['revision'] = {
    id: 'pgw:r:' + 'c'.repeat(32),
    generation: 5,
    predecessor: {
      target_protocol_version: '1.0',
      target_kind: { id: 'TaskSpec', version: '1.0' },
      target_instance_id: genesis.instanceId,
      target_revision_id: genesis.revisionId,
      target_digest: genesis.digest,
      target_workspace_binding: { mode: 'portable' },
    },
    digest: 'P',
  };
  successor['revision'] = { ...(successor['revision'] as object), digest: computeArtifactDigest(successor as never).digest };
  const genFindings = checkProposedRegistration(successor, id);
  assert.ok(genFindings.some((f) => f.ruleIds.includes('LIN-005')));
});

test('identity: verifying an existing revision does not register it', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  const unknown = taskModel();
  unknown['revision'] = { ...(unknown['revision'] as object), id: 'pgw:r:' + 'd'.repeat(32) };
  unknown['revision'] = { ...(unknown['revision'] as object), digest: computeArtifactDigest(unknown as never).digest };
  assert.equal(verifyExistingRegistration(unknown, id), false);
  assert.equal(id.findRevision('pgw:r:' + 'd'.repeat(32)), undefined);
  // verification of the registered revision leaves state untouched
  assert.equal(verifyExistingRegistration(genesis.model, id), true);
  assert.equal(id.findInstance(genesis.instanceId)?.registeredRevisionIds.length, 1);
});

test('identity: proposed registration does not mutate state', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  const second = taskModel();
  second['revision'] = { ...(second['revision'] as object), id: 'pgw:r:' + 'e'.repeat(32) };
  second['revision'] = { ...(second['revision'] as object), digest: computeArtifactDigest(second as never).digest };
  const before = id.findInstance(genesis.instanceId)?.registeredRevisionIds.length;
  const r = validateArtifactRevision(second, reg, 'identity-registration', { identity: id });
  assert.equal(r.ok, false);
  assert.equal(id.findInstance(genesis.instanceId)?.registeredRevisionIds.length, before);
  assert.equal(id.findRevision('pgw:r:' + 'e'.repeat(32)), undefined);
});

test('identity: for-use validation uses verification mode, never proposed conflicts', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  // re-validating the SAME registered genesis for use must not be rejected as
  // instance reuse (verification mode)
  const pipeline = runArtifactPipeline(taskModel(), {
    schemaRegistry: reg,
    identity: id,
    through: 'point-of-use-eligibility',
    identityMode: 'verify',
    registry: {
      registryProtocolId: 'project-gateway.registry',
      registrySnapshotFormatVersion: '1.0',
      registrySnapshotId: String(loadJson('fixtures/registry/valid/registry-v1.json')['snapshot_id']),
      registrySnapshotDigest: String(loadJson('fixtures/registry/valid/registry-v1.json')['snapshot_digest']),
      snapshot: validateRegistrySnapshot(loadJson('fixtures/registry/valid/registry-v1.json'), reg).value!,
    },
    consumerSupport: {
      consumerId: 'test',
      supportedProtocolFeatures: [],
      supportedConsumerCapabilities: [],
      supportedExtensionNamespaces: [],
    },
  });
  assert.equal(pipeline.ok, true);
  // unregistered subject fails verification
  const empty = new MemoryIdentityState();
  const pipeline2 = runArtifactPipeline(taskModel(), {
    schemaRegistry: reg,
    identity: empty,
    through: 'semantic-self-validation',
    identityMode: 'verify',
  });
  assert.equal(pipeline2.ok, false);
  assert.equal(pipeline2.firstFailingPhase, 'identity-registration');
});

test('phases: validation phases are the normative ordered set', () => {
  assert.deepEqual([...VALIDATION_PHASES], [
    'raw-json-intake',
    'canonical-input-validation',
    'schema-identification',
    'structural-schema-validation',
    'canonicalization-and-digest-verification',
    'identity-registration',
    'semantic-self-validation',
    'exact-reference-resolution',
    'cross-artifact-compatibility',
    'registry-compatibility',
    'semantic-registry-validation',
    'trusted-lifecycle-verification',
    'consumer-support-verification',
    'point-of-use-eligibility',
  ]);
});

test('identity: workspace binding is part of existing-registration verification', () => {
  const id = new MemoryIdentityState();
  const genesis = validateArtifactSelf(taskModel(), reg).value as ValidatedArtifact;
  id.register(genesis);
  assert.equal(verifyExistingRegistration(genesis.model, id), true);
  const rebound = taskModel();
  rebound['workspace_binding'] = { mode: 'bound', workspace_id: 'pgw:w:' + '9'.repeat(32) };
  rebound['revision'] = { ...(rebound['revision'] as object), digest: computeArtifactDigest(rebound as never).digest };
  assert.equal(verifyExistingRegistration(rebound, id), false);
});
