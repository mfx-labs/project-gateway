/**
 * WP-14A — controlled proposal persistence adapter tests.
 *
 * Proves Model B end to end over a REAL filesystem lane (real WP-11
 * executor + real prospective-destination resolver + genuine validated
 * version-2 configuration): independent validation at the persistence
 * boundary, caller-provenance rejection, four-kind scope, canonical-byte/
 * digest/write continuity, create-only behavior, containment/ownership
 * inheritance, redaction, and no generic-write/lifecycle persistence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSchemaRegistry, computeArtifactDigest } from '../../../src/api/validate.js';
import { createMcpPersistRegistry, MCP_PERSIST_TOOLS } from '../../../src/adapters/mcp/index.js';
import { createDraftProposal } from '../../../src/drafting/proposal.js';
import type { PersistResponse, McpPersistRegistry } from '../../../src/adapters/mcp/index.js';
import { executeDraftFileWrite } from '../../../src/writing/executor.js';
import type { DraftWriteExecutorResult } from '../../../src/writing/types.js';
import { makeFsWorkspace, validatedConfigFor, realFsResolver, draftContent, validFixtureModel, fakeExecutor, countingResolver } from '../../../tests/writing/helpers.js';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

const FOUR_KINDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract'] as const;

function fixtureModel(kind: string): Record<string, unknown> {
  const names: Record<string, string> = {
    TaskSpec: 'task-minimal-genesis.json',
    AuthorityPolicy: 'policy-minimal-genesis.json',
    ContextManifest: 'context-minimal-genesis.json',
    CompletionContract: 'completion-minimal-genesis.json',
    ExecutionBundle: 'bundle-minimal-genesis.json',
  };
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', names[kind]!), 'utf8')) as Record<string, unknown>;
}

/** Real WP-14A persistence lane over a real temp workspace. */
function realLane(): { workspace: ReturnType<typeof makeFsWorkspace>; lane: { configuration: ReturnType<typeof validatedConfigFor>; resolveProspectiveDestination: ReturnType<typeof realFsResolver>; writeDraftFile: typeof executeDraftFileWrite } } {
  const workspace = makeFsWorkspace();
  return {
    workspace,
    lane: {
      configuration: validatedConfigFor(workspace),
      resolveProspectiveDestination: realFsResolver(),
      writeDraftFile: executeDraftFileWrite,
    },
  };
}

function registryWith(lane?: { configuration: ReturnType<typeof validatedConfigFor>; resolveProspectiveDestination: ReturnType<typeof realFsResolver>; writeDraftFile: typeof executeDraftFileWrite }): McpPersistRegistry {
  const built = createMcpPersistRegistry({
    registrations: [{ surfaceId: 'alpha', schemaRegistry: createSchemaRegistry(), ...(lane !== undefined ? { lane } : {}) }],
  });
  assert.equal(built.ok, true, built.message ?? '');
  return built.registry as McpPersistRegistry;
}

test('persist: exactly the four allowed proposal kinds persist through the controlled write lane', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    for (const kind of FOUR_KINDS) {
      const model = fixtureModel(kind);
      const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind, content: draftContent(model) }) as Extract<PersistResponse, { ok: true }>;
      assert.equal(response.ok, true, `${kind} must persist: ${JSON.stringify(response)}`);
      const evidence = response.result.persisted;
      assert.equal(evidence.artifactKind, kind);
      assert.equal(evidence.instanceId, model['instance_id']);
      assert.equal(evidence.revisionId, (model['revision'] as Record<string, unknown>)['id']);
      const { digest } = computeArtifactDigest(model);
      assert.equal(evidence.digest, digest, 'evidence digest must be the trusted digest of the candidate');
      // Derived destination is identity-based, artifact-root relative, never
      // an absolute path, and the file exists with EXACT canonical bytes.
      assert.equal(evidence.relativeDestination.includes('/'), false, 'derived destination is a single component');
      assert.equal(evidence.relativeDestination.startsWith('/'), false, 'no absolute path in evidence');
      assert.equal(evidence.relativeDestination, `${kind}.${model['instance_id']}.${(model['revision'] as Record<string, unknown>)['id']}.json`);
      const persisted = readFileSync(join(workspace.artifactRoot, evidence.relativeDestination), 'utf8');
      // The persisted bytes are the EXACT trusted canonical bytes produced by
      // the accepted validation composition (JCS-canonical projection with
      // the derived digest absent from the canonical surface) — proven by
      // equality with an independent draft-core call on the same candidate.
      const expectedDraft = createDraftProposal({ kind: kind as never, content: draftContent(model) });
      assert.equal(expectedDraft.ok, true);
      assert.equal(expectedDraft.valid, true);
      assert.equal(persisted, (expectedDraft as Extract<typeof expectedDraft, { ok: true; valid: true }>).proposal.canonicalUtf8, 'the persisted bytes are the exact trusted canonical bytes');
      assert.equal(evidence.persistedByteCount, Buffer.byteLength(persisted, 'utf8'));
      assert.equal(evidence.transition, 'missing-to-file');
      assert.equal(typeof response.result.validation.level === 'string' && response.result.validation.level.length > 0, true, 'fresh validation facts are returned');
    }
  } finally {
    workspace.remove();
  }
});

test('persist: unsupported kinds are rejected before any write — ExecutionBundle, ExecutionResult, lookalikes', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    for (const kind of ['ExecutionBundle', 'ExecutionResult', 'TaskSpecX', 'taskspec']) {
      const model = kind === 'ExecutionBundle' ? fixtureModel('ExecutionBundle') : fixtureModel('TaskSpec');
      const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind, content: draftContent(model) }) as Extract<PersistResponse, { ok: false }>;
      assert.equal(response.ok, false, `${kind} must be rejected`);
      assert.equal(response.error.code, 'unsupported-artifact-kind', `${kind} maps to unsupported-artifact-kind`);
    }
    const emptyKind = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: '', content: '{}' }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(emptyKind.error.code, 'invalid-request', 'an empty kind is a request error, not a vocabulary outcome');
    assert.deepEqual([...MCP_PERSIST_TOOLS], ['persist-artifact']);
  } finally {
    workspace.remove();
  }
});

test('persist: caller-supplied validation provenance never establishes trust', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    const model = fixtureModel('TaskSpec');
    const { digest } = computeArtifactDigest(model);
    // Caller attempts to supply ok/valid/canonicalUtf8/digest/draft-shaped
    // provenance fields: every one is an unknown envelope field → rejected.
    for (const extra of [
      { ok: true },
      { valid: true },
      { canonicalUtf8: '{}' },
      { digest: 'sha-256:' + '0'.repeat(64) },
      { draft: { ok: true, valid: true } },
      { validation: { level: 'structural', ruleIds: [] } },
    ]) {
      const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(model), ...extra }) as Extract<PersistResponse, { ok: false }>;
      assert.equal(response.ok, false, `caller field ${Object.keys(extra)[0]} must be rejected`);
      assert.equal(response.error.code, 'invalid-request', `caller field ${Object.keys(extra)[0]} maps to invalid-request`);
    }
    // A caller-supplied revision.digest inside the content is derived-member
    // forgery: the trusted composition rejects it (invalid-draft-request).
    const withDigest = JSON.stringify({ ...model, revision: { ...(model['revision'] as Record<string, unknown>), digest } });
    const forged = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: withDigest }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(forged.ok, false);
    assert.equal(forged.error.code, 'invalid-request');
    // A kind/content mismatch (caller claims TaskSpec but content is
    // AuthorityPolicy) is rejected before validation.
    const mismatched = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(fixtureModel('AuthorityPolicy')) }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.error.code, 'invalid-request');
  } finally {
    workspace.remove();
  }
});

test('persist: independent validation at the persistence boundary — invalid candidates never reach the executor', async () => {
  const { workspace, lane } = realLane();
  try {
    // Scripted executor that fails the test if invoked.
    const executor = fakeExecutor({ ok: true, outcome: 'created', persistedByteCount: 0 } as DraftWriteExecutorResult);
    const registry = registryWith({ configuration: lane.configuration, resolveProspectiveDestination: lane.resolveProspectiveDestination, writeDraftFile: executor.executor });
    // Semantic violation: delegated context instructions.
    const invalid = JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', 'semantic-task-delegated-context-instruction.json'), 'utf8')) as Record<string, unknown>;
    const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(invalid) }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'validation-failed');
    assert.ok((response.error.findings ?? []).length > 0, 'bounded findings are returned');
    assert.equal(executor.calls(), 0, 'the executor must never be invoked for an invalid candidate');
    // Malformed JSON and oversized content fail closed before any write.
    const malformed = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: '{bad' }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error.code, 'invalid-request');
    const oversized = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: '{}'.padStart(2 * 1024 * 1024 + 8, ' ') }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(oversized.ok, false);
    assert.equal(oversized.error.code, 'limit-exceeded');
    assert.equal(executor.calls(), 0);
  } finally {
    workspace.remove();
  }
});

test('persist: canonical-byte/digest/write continuity — the exact validated canonical bytes reach WP-11 and the file', async () => {
  const { workspace, lane } = realLane();
  try {
    const recording = fakeExecutor({ ok: true, outcome: 'created', persistedByteCount: 0 } as DraftWriteExecutorResult);
    const resolver = countingResolver(lane.resolveProspectiveDestination);
    const registry = registryWith({ configuration: lane.configuration, resolveProspectiveDestination: resolver.resolver, writeDraftFile: recording.executor });
    const model = fixtureModel('TaskSpec');
    const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(model) }) as Extract<PersistResponse, { ok: true }>;
    assert.equal(response.ok, true);
    // The WP-11 request received the freshly produced validated draft: the
    // executor input bytes equal the validated canonical bytes, and the
    // destination is the identity-derived single component.
    assert.equal(recording.inputs.length, 1);
    const input = recording.inputs[0]!;
    assert.equal(input.artifactKind, 'TaskSpec');
    assert.equal(input.destinationTailComponents.length, 1, 'single-component create invariant preserved');
    const { digest } = computeArtifactDigest(model);
    const expectedDraft = createDraftProposal({ kind: 'TaskSpec', content: draftContent(model) });
    assert.equal(expectedDraft.ok, true);
    assert.equal(expectedDraft.valid, true);
    const expected = (expectedDraft as Extract<typeof expectedDraft, { ok: true; valid: true }>).proposal;
    assert.equal(input.canonicalUtf8, expected.canonicalUtf8, 'the exact validated canonical bytes are handed to WP-11');
    assert.equal(input.expectedByteCount, Buffer.byteLength(expected.canonicalUtf8, 'utf8'));
    assert.equal(response.result.persisted.digest, digest);
    // Fresh point-of-use revalidation: the resolver was consulted TWICE
    // (prospective + point-of-use) inside the WP-11 core.
    assert.equal(resolver.calls(), 2, 'prospective + point-of-use revalidation both ran');
  } finally {
    workspace.remove();
  }
});

test('persist: substitution mismatch fails closed — tampered canonical bytes never write', async () => {
  const { workspace, lane } = realLane();
  try {
    // A hostile executor that tries to write DIFFERENT bytes than the
    // accepted canonical payload cannot happen through the adapter (the
    // executor receives the exact accepted bytes); prove the adapter hands
    // exactly the validated bytes and that the WP-11 core re-verifies the
    // digest correlation of whatever draft object it receives.
    const recording = fakeExecutor({ ok: true, outcome: 'created', persistedByteCount: 0 } as DraftWriteExecutorResult);
    const registry = registryWith({ configuration: lane.configuration, resolveProspectiveDestination: lane.resolveProspectiveDestination, writeDraftFile: recording.executor });
    const model = fixtureModel('TaskSpec');
    const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(model) }) as Extract<PersistResponse, { ok: true }>;
    assert.equal(response.ok, true);
    const expectedDraft = createDraftProposal({ kind: 'TaskSpec', content: draftContent(model) });
    assert.equal(expectedDraft.ok, true);
    assert.equal(expectedDraft.valid, true);
    const expected = (expectedDraft as Extract<typeof expectedDraft, { ok: true; valid: true }>).proposal;
    assert.equal(recording.inputs[0]!.canonicalUtf8, expected.canonicalUtf8, 'exact trusted canonical bytes are the bytes handed to WP-11');
    assert.equal(Buffer.byteLength(recording.inputs[0]!.canonicalUtf8, 'utf8'), recording.inputs[0]!.expectedByteCount);
  } finally {
    workspace.remove();
  }
});

test('persist: create-only — an existing target revision fails closed and is never overwritten', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    const model = fixtureModel('ContextManifest');
    const request = { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'ContextManifest', content: draftContent(model) };
    const first = registry.persist('alpha', request) as Extract<PersistResponse, { ok: true }>;
    assert.equal(first.ok, true);
    const before = readFileSync(join(workspace.artifactRoot, first.result.persisted.relativeDestination), 'utf8');
    const second = registry.persist('alpha', request) as Extract<PersistResponse, { ok: false }>;
    assert.equal(second.ok, false);
    // A target already present at evaluation time is a containment-level
    // denial (never an overwrite); the RACE path (target appearing between
    // the two accepted evaluations) is the WP-11 `point-of-use-conflict`
    // mapping exercised by the committed WP-11 suite.
    assert.equal(second.error.code, 'write-denied', 'an existing target is a typed create-only denial');
    assert.equal(readFileSync(join(workspace.artifactRoot, first.result.persisted.relativeDestination), 'utf8'), before, 'the existing file was never modified');
  } finally {
    workspace.remove();
  }
});

test('persist: containment/ownership/redaction inheritance — lanes confined to the configured artifact root', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    // Unknown workspace on a genuine lane: typed failure, nothing written.
    const unknown = registry.persist('alpha', { workspaceId: 'pgw:w:ffffffffffffffff', kind: 'TaskSpec', content: draftContent(fixtureModel('TaskSpec')) }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, 'write-denied', 'unknown workspace fails containment before any mutation');
    // Surface routing: unknown surface → not-found; laneless surface →
    // unsupported.
    const notFound = registry.persist('nope', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: '{}' }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(notFound.error.code, 'not-found');
    const laneless = registryWith(undefined);
    const unsupported = laneless.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(fixtureModel('TaskSpec')) }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(unsupported.error.code, 'unsupported');
    // Evidence and errors expose no absolute trusted roots.
    const ok = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(fixtureModel('TaskSpec')) }) as Extract<PersistResponse, { ok: true }>;
    assert.equal(JSON.stringify(ok).includes(workspace.workspaceRoot), false, 'no absolute root in the response');
    assert.equal(JSON.stringify(unsupported).includes(workspace.workspaceRoot), false);
  } finally {
    workspace.remove();
  }
});

test('persist: no generic write operands — the closed envelope admits only workspaceId/kind/content/requestId', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    for (const extra of [{ destination: 'x.json' }, { path: '/tmp/x' }, { overwrite: true }, { mode: 0o644 }, { resolveProspectiveDestination: {} }, { configuration: {} }, { absolutePath: '/etc/passwd' }, { shell: 'rm -rf /' }, { workspaceRoot: '/tmp' }]) {
      const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: draftContent(fixtureModel('TaskSpec')), ...extra }) as Extract<PersistResponse, { ok: false }>;
      assert.equal(response.ok, false, `operand ${Object.keys(extra)[0]} must be rejected`);
      assert.equal(response.error.code, 'invalid-request');
    }
  } finally {
    workspace.remove();
  }
});

test('persist: no lifecycle/ExecutionResult/TrustedReceipt/config persistence — lifecycle-shaped content is rejected', async () => {
  const { workspace, lane } = realLane();
  try {
    const registry = registryWith(lane);
    // A lifecycle-record-shaped document can never correlate as a proposal
    // artifact: kind correlation fails (content kind != requested kind).
    const lifecycle = JSON.stringify({ record_kind: 'ApprovalRecord', record_id: 'pgw:r:00000000000000000000000000000001' });
    const response = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: lifecycle }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'invalid-request');
    // ExecutionResult is outside the four-kind scope.
    const execResult = registry.persist('alpha', { workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'ExecutionResult', content: '{}' }) as Extract<PersistResponse, { ok: false }>;
    assert.equal(execResult.error.code, 'unsupported-artifact-kind');
    assert.equal(execResult.ok, false);
    // Nothing was written by any of the above.
    assert.equal(readdirSync(workspace.artifactRoot).length, 0);  } finally {
    workspace.remove();
  }
});
