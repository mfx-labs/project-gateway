/**
 * WP-14C — proposal-context load focused tests.
 *
 * Real WP-7 controlled reader over real temp workspaces; real WP-4/WP-10
 * validation through the surface schema registry; real persisted artifacts
 * written under the committed WP-14A destination convention
 * (`<kind>.<instanceId>.<revisionId>.json`) with the exact canonical bytes
 * produced by the trusted drafting pipeline.
 *
 * Covers Model-C selection (pins, uniqueness fallback, no chronology),
 * load-time validation (malformed/semantic-invalid/identity mismatch,
 * fresh revalidation), SCR-WP14C-001 correlation (mandatory in-set,
 * external/declarative, no set expansion), rendering/authority semantics
 * (TaskSpec-only instructions, non-operative AuthorityPolicy, distinct
 * load plan), the short command (no path, supersession, failed load
 * injects nothing), and filesystem confinement (artifact-location-only,
 * symlink escape fail-closed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync, realpathSync, symlinkSync, mkdirSync, lstatSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } from '../../src/trusted/index.js';
import { WorkspaceInspectionService } from '../../src/reader/index.js';
import { createSchemaRegistry, computeArtifactDigest } from '../../src/api/validate.js';
import { createDraftProposal } from '../../src/drafting/proposal.js';
import type { SchemaRegistry } from '../../src/schema/registry.js';
import { resolveProposalLoad, performGatewayLoad, createProposalLoadSessionRegistry, createProposalLoadBridge, buildLoadFeedback } from '../../src/loading/index.js';
import { verifyInSetCorrelation } from '../../src/loading/core.js';
import type { ValidDraftProposalResult } from '../../src/drafting/proposal.js';
import type { ProposalLoadLane, ProposalLoadPlan } from '../../src/loading/index.js';
import type { PiHostSurface } from '../../src/adapters/pi/index.js';
import { PROPOSAL_CANDIDATE_FILE_RE } from '../../src/loading/index.js';

const WS = 'pgw:w:aaaaaaaaaaaaaaaa';
const REPO = join(import.meta.dirname, '..', '..', '..');

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly lane: ProposalLoadLane;
  readonly schemaRegistry: SchemaRegistry;
  readonly cleanup: () => void;
}

function readFixture(kind: string): Record<string, unknown> {
  const map: Record<string, string> = {
    TaskSpec: 'task-minimal-genesis.json',
    AuthorityPolicy: 'policy-minimal-genesis.json',
    ContextManifest: 'context-minimal-genesis.json',
    CompletionContract: 'completion-minimal-genesis.json',
  };
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', map[kind]!), 'utf8')) as Record<string, unknown>;
}

/** Draft content: the canonical envelope with the derived digest member removed. */
function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

function artifactLocationResolver() {
  return (absolutePath: string): import('../../src/trusted/index.js').ArtifactLocationResolution => {
    try {
      const st = lstatSync(absolutePath);
      if (st.isSymbolicLink()) {
        const resolved = realpathSync(absolutePath);
        if (!statSync(resolved).isDirectory()) return { ok: false, code: 'unsupported-entry-kind' };
        return { ok: true, canonicalPath: resolved, entryKind: 'directory' };
      }
      if (!st.isDirectory()) return { ok: false, code: 'unsupported-entry-kind' };
      return { ok: true, canonicalPath: realpathSync(absolutePath), entryKind: 'directory' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return { ok: false, code: 'loop' };
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'inaccessible' };
      return { ok: false, code: 'not-found' };
    }
  };
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'wp14c-load-'));
  chmodSync(base, 0o700);
  const workspaceRoot = join(base, 'workspace');
  const artifactRoot = join(workspaceRoot, 'artifacts');
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const report = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '2',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [{ workspaceId: WS, root: workspaceRoot, artifactLocation: artifactRoot }],
    },
    { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p, resolveArtifactLocation: artifactLocationResolver() },
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.code).join(','));
  const configuration = report.configuration!;
  const schemaRegistry = createSchemaRegistry();
  const reader = new WorkspaceInspectionService({
    configuration,
    resolveExistingPath: (p) => {
      try {
        return { ok: true, canonical: realpathSync(p) };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') return { ok: false, code: 'loop' };
        return { ok: false, code: 'not-found' };
      }
    },
  });
  return {
    base,
    workspaceRoot,
    artifactRoot,
    lane: { configuration, reader, schemaRegistry },
    schemaRegistry,
    cleanup: () => {
      void reader.dispose();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Persist one artifact under the WP-14A convention with exact trusted canonical bytes. */
function persistFixtureArtifact(fx: Fixture, kind: import('../../src/loading/index.js').ProposalLoadKindId, model: Readonly<Record<string, unknown>>): { instanceId: string; revisionId: string; digest: string } {
  const draft = createDraftProposal({ kind, content: draftContent(model) });
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.equal((draft as { valid?: boolean }).valid, true, 'fixture must be valid');
  const valid = draft as Extract<typeof draft, { ok: true; valid: true }>;
  const { instanceId, revisionId, digest, canonicalUtf8 } = valid.proposal;
  writeFileSync(join(fx.artifactRoot, `${kind}.${instanceId}.${revisionId}.json`), canonicalUtf8);
  return { instanceId, revisionId, digest };
}

/** Write raw bytes under a WP-14A-convention name (untrusted content paths). */
function writeRaw(fx: Fixture, kind: string, instanceId: string, revisionId: string, content: string): void {
  writeFileSync(join(fx.artifactRoot, `${kind}.${instanceId}.${revisionId}.json`), content);
}

/** Build a ContextManifest whose first item carries an artifact-revision selector. */
function manifestWithSelector(target: { kind: string; instanceId: string; revisionId: string; digest: string }, targetBinding: Readonly<Record<string, unknown>>, targetKindVersion = '1.0'): Record<string, unknown> {
  const base = readFixture('ContextManifest');
  return {
    ...base,
    body: {
      selection_mode: 'items',
      items: [
        {
          context_id: 'ctx-target',
          requirement: 'required',
          priority: 1,
          purpose: 'specification',
          integrity: { mode: 'none' },
          selector: {
            selector_type: 'project-gateway.artifact-revision',
            version: '1.0',
            artifact: {
              target_protocol_version: '1.0',
              target_kind: { id: target.kind, version: targetKindVersion },
              target_instance_id: target.instanceId,
              target_revision_id: target.revisionId,
              target_digest: target.digest,
              target_workspace_binding: targetBinding,
            },
          },
        },
      ],
    },
  };
}

/**
 * Hand-built manifest draft wrapper for focused correlation tests: the
 * wrong-kind-version manifest is schema-invalid as an artifact (committed
 * kind-descriptor constrains version to 1.0), so it cannot reach
 * `verifyInSetCorrelation` through the load path; the synthetic loaded set
 * drives the correlation function directly.
 */
function wrapManifestModel(model: Record<string, unknown>): ValidDraftProposalResult {
  const revision = model['revision'] as Readonly<Record<string, unknown>>;
  return {
    ok: true,
    valid: true,
    kind: 'ContextManifest',
    proposal: {
      instanceId: String(model['instance_id']),
      revisionId: String(revision['id']),
      digest: 'sha-256:' + 'a'.repeat(64),
      canonicalUtf8: '',
      level: 'self-semantic-valid',
      model,
    },
    validation: { level: 'self-semantic-valid', ruleIds: [] },
  } as unknown as ValidDraftProposalResult;
}

interface FakeSurface {
  readonly surface: PiHostSurface;
  readonly handlers: ReadonlyMap<string, (event: unknown, ctx: unknown) => unknown>;
  fire(event: string, ev?: unknown, ctx?: unknown): unknown;
}

function fakeSurface(): FakeSurface {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  return {
    surface: {
      hostIdentity: 'test-pi',
      hostVersion: '0.0.0',
      on: (event, handler) => {
        handlers.set(event, handler);
      },
    },
    handlers,
    fire(event: string, ev?: unknown, ctx?: unknown): unknown {
      const handler = handlers.get(event);
      if (handler === undefined) return undefined;
      return handler(ev, ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Model-C selection
// ---------------------------------------------------------------------------

test('load: explicit pin selects exactly the pinned artifact; unpinned kinds with zero candidates are omitted', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const result = await resolveProposalLoad(fx.lane, {
      workspaceId: WS,
      pins: [{ kind: 'TaskSpec', instanceId: task.instanceId, revisionId: task.revisionId }],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.plan.loaded.map((a) => a.kind), ['TaskSpec']);
    assert.equal(result.plan.loaded[0]!.instanceId, task.instanceId);
    assert.equal(result.plan.loaded[0]!.revisionId, task.revisionId);
    assert.deepEqual(result.plan.omittedKinds, ['AuthorityPolicy', 'ContextManifest', 'CompletionContract']);
  } finally {
    fx.cleanup();
  }
});

test('load: pinned missing candidate fails the whole load with missing-required', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const result = await resolveProposalLoad(fx.lane, {
      workspaceId: WS,
      pins: [{ kind: 'TaskSpec', instanceId: task.instanceId, revisionId: 'pgw:r:ffffffffffffffffffffffffffffffff' }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'missing-required');
  } finally {
    fx.cleanup();
  }
});

test('load: unpinned kind with exactly one valid candidate is included', async () => {
  const fx = makeFixture();
  try {
    persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    persistFixtureArtifact(fx, 'AuthorityPolicy', readFixture('AuthorityPolicy'));
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.plan.loaded.map((a) => a.kind), ['TaskSpec', 'AuthorityPolicy']);
    assert.deepEqual(result.plan.omittedKinds, ['ContextManifest', 'CompletionContract']);
  } finally {
    fx.cleanup();
  }
});

test('load: unpinned kind with more than one valid candidate fails closed with ambiguous-selection (no chronology/order used)', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    // A second valid TaskSpec instance under a different identity.
    const second = { ...readFixture('TaskSpec'), instance_id: 'pgw:i:22222222222222222222222222222222' };
    persistFixtureArtifact(fx, 'TaskSpec', second);
    void task;
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ambiguous-selection');
  } finally {
    fx.cleanup();
  }
});

test('load: no valid candidate at all returns no-candidate; empty artifact location too', async () => {
  const fx = makeFixture();
  try {
    const empty = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.code, 'no-candidate');
    // A directory with only non-candidate files still yields no-candidate.
    writeFileSync(join(fx.artifactRoot, 'README.json'), '{}');
    const nonCandidates = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(nonCandidates.ok, false);
    if (!nonCandidates.ok) assert.equal(nonCandidates.code, 'no-candidate');
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Load-time validation
// ---------------------------------------------------------------------------

test('load: malformed and semantic-invalid candidates are excluded unpinned and fail invalid-artifact when pinned', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    writeRaw(fx, 'ContextManifest', 'pgw:i:11111111111111111111111111111111', 'pgw:r:11111111111111111111111111111111', '{bad json');
    // Unpinned: malformed candidate excluded, valid TaskSpec included.
    const unpinned = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(unpinned.ok, true, JSON.stringify(unpinned));
    if (!unpinned.ok) return;
    assert.deepEqual(unpinned.plan.loaded.map((a) => a.kind), ['TaskSpec']);
    assert.ok(unpinned.plan.omittedKinds.includes('ContextManifest'));
    // Pinned: the malformed candidate fails the whole load.
    const pinned = await resolveProposalLoad(fx.lane, {
      workspaceId: WS,
      pins: [{ kind: 'ContextManifest', instanceId: 'pgw:i:11111111111111111111111111111111', revisionId: 'pgw:r:11111111111111111111111111111111' }],
    });
    assert.equal(pinned.ok, false);
    if (!pinned.ok) assert.equal(pinned.code, 'invalid-artifact');
    void task;
  } finally {
    fx.cleanup();
  }
});

test('load: semantic-invalid artifact is never accepted', async () => {
  const fx = makeFixture();
  try {
    const invalid = JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', 'semantic-task-delegated-context-instruction.json'), 'utf8')) as Record<string, unknown>;
    const instanceId = typeof invalid['instance_id'] === 'string' ? invalid['instance_id'] : 'pgw:i:33333333333333333333333333333333';
    const revision = invalid['revision'] as Readonly<Record<string, unknown>> | undefined;
    const revisionId = typeof revision?.['id'] === 'string' ? revision['id'] : 'pgw:r:33333333333333333333333333333333';
    writeRaw(fx, 'TaskSpec', instanceId, revisionId, JSON.stringify(invalid));
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'no-candidate');
  } finally {
    fx.cleanup();
  }
});

test('load: filename/content identity mismatch is rejected (filename identity alone never trusted)', async () => {
  const fx = makeFixture();
  try {
    const model = readFixture('TaskSpec');
    const otherInstance = 'pgw:i:44444444444444444444444444444444';
    // Content is a VALID TaskSpec, but the filename claims a different instance.
    const content = draftContent(model);
    writeRaw(fx, 'TaskSpec', otherInstance, 'pgw:r:44444444444444444444444444444444', content);
    const unpinned = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(unpinned.ok, false);
    if (!unpinned.ok) assert.equal(unpinned.code, 'no-candidate', 'identity-mismatched candidate must never count as valid');
    const pinned = await resolveProposalLoad(fx.lane, {
      workspaceId: WS,
      pins: [{ kind: 'TaskSpec', instanceId: otherInstance, revisionId: 'pgw:r:44444444444444444444444444444444' }],
    });
    assert.equal(pinned.ok, false);
    if (!pinned.ok) assert.equal(pinned.code, 'invalid-artifact');
  } finally {
    fx.cleanup();
  }
});

test('load: fresh revalidation on every invocation — reload reflects current file state, never a prior session', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const first = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    assert.deepEqual(first.plan.loaded.map((a) => a.kind), ['TaskSpec']);
    const firstDigest = first.plan.loaded[0]!.digest;
    // Same filename, different VALID content: fresh validation recomputes
    // the derived digest from current bytes — the load reflects current
    // state, never a prior session's result. The persisted-artifact format
    // is the digest-absent canonical form produced by the trusted drafting
    // pipeline (exactly what a WP-14A persist would write).
    const changedModel = { ...readFixture('TaskSpec'), body: { ...(readFixture('TaskSpec')['body'] as Readonly<Record<string, unknown>>), objective: 'changed objective' } };
    const changedDraft = createDraftProposal({ kind: 'TaskSpec', content: draftContent(changedModel) });
    assert.equal(changedDraft.ok && (changedDraft as { valid?: boolean }).valid, true, 'changed fixture must be valid');
    const changedValid = changedDraft as Extract<typeof changedDraft, { ok: true; valid: true }>;
    writeRaw(fx, 'TaskSpec', task.instanceId, task.revisionId, changedValid.proposal.canonicalUtf8);
    const second = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.notEqual(second.plan.loaded[0]!.digest, firstDigest, 'reload recomputes from current bytes');
    // Malformed content on the same filename: the candidate is no longer valid.
    writeRaw(fx, 'TaskSpec', task.instanceId, task.revisionId, '{bad json');
    const third = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(third.ok, false);
    if (!third.ok) assert.equal(third.code, 'no-candidate', 'malformed artifact must fail fresh validation');
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// SCR-WP14C-001 in-set correlation
// ---------------------------------------------------------------------------

test('correlation: ContextManifest selector targeting the selected TaskSpec succeeds', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const taskModel = readFixture('TaskSpec');
    const binding = taskModel['workspace_binding'] as Readonly<Record<string, unknown>>;
    const manifestModel = manifestWithSelector({ kind: 'TaskSpec', instanceId: task.instanceId, revisionId: task.revisionId, digest: task.digest }, binding);
    persistFixtureArtifact(fx, 'ContextManifest', manifestModel);
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.plan.loaded.map((a) => a.kind), ['TaskSpec', 'ContextManifest']);
  } finally {
    fx.cleanup();
  }
});

test('correlation: mandatory proposal-kind target absent from the selected set fails incompatible-set', async () => {
  const fx = makeFixture();
  try {
    const task = readFixture('TaskSpec');
    const binding = task['workspace_binding'] as Readonly<Record<string, unknown>>;
    const manifestModel = manifestWithSelector(
      { kind: 'TaskSpec', instanceId: 'pgw:i:55555555555555555555555555555555', revisionId: 'pgw:r:55555555555555555555555555555555', digest: 'sha-256:' + '5'.repeat(64) },
      binding,
    );
    persistFixtureArtifact(fx, 'ContextManifest', manifestModel);
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'incompatible-set');
  } finally {
    fx.cleanup();
  }
});

test('correlation: target existing on disk but NOT in the selected set still fails incompatible-set (references never expand the set)', async () => {
  const fx = makeFixture();
  try {
    const taskX = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    // TaskSpec Y (a second instance) exists on disk.
    const second = { ...readFixture('TaskSpec'), instance_id: 'pgw:i:66666666666666666666666666666666' };
    persistFixtureArtifact(fx, 'TaskSpec', second);
    // Manifest references X; the pin selects Y. X is on disk but NOT in the
    // selected set — the reference must fail, and X must NOT be loaded to
    // satisfy it.
    const taskModel = readFixture('TaskSpec');
    const binding = taskModel['workspace_binding'] as Readonly<Record<string, unknown>>;
    const manifestModel = manifestWithSelector({ kind: 'TaskSpec', instanceId: taskX.instanceId, revisionId: taskX.revisionId, digest: taskX.digest }, binding);
    persistFixtureArtifact(fx, 'ContextManifest', manifestModel);
    const options = {
      workspaceId: WS,
      pins: [{ kind: 'TaskSpec', instanceId: (second as { instance_id: string }).instance_id, revisionId: ((second as Readonly<Record<string, unknown>>)['revision'] as { id: string }).id }],
    };
    const result = await resolveProposalLoad(fx.lane, options);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'incompatible-set');
    // Failed correlation injects nothing and leaves session state unchanged.
    const surface = fakeSurface();
    const sessions = createProposalLoadSessionRegistry();
    const outcome = await performGatewayLoad({ surface: surface.surface, lane: fx.lane, options, sessions });
    assert.equal(outcome.ok, false);
    assert.equal(surface.handlers.has('before_agent_start'), false, 'failed correlation injects nothing');
    assert.equal(sessions.previous(WS), undefined, 'failed correlation leaves supersession state unchanged');
  } finally {
    fx.cleanup();
  }
});

test('correlation: exact reference comparison enforces target kind version (SIR-WP14C-003)', async () => {
  const fx = makeFixture();
  try {
    const taskDraft = createDraftProposal({ kind: 'TaskSpec', content: draftContent(readFixture('TaskSpec')) });
    assert.equal(taskDraft.ok && (taskDraft as { valid?: boolean }).valid, true);
    const task = taskDraft as Extract<typeof taskDraft, { ok: true; valid: true }>;
    const binding = (readFixture('TaskSpec') as Readonly<Record<string, unknown>>)['workspace_binding'] as Readonly<Record<string, unknown>>;
    const loadedTask = { kind: 'TaskSpec' as const, draft: task };
    // Same kind ID + correct target kind version → correlation succeeds.
    const goodManifest = manifestWithSelector({ kind: 'TaskSpec', instanceId: task.proposal.instanceId, revisionId: task.proposal.revisionId, digest: task.proposal.digest }, binding);
    const good = verifyInSetCorrelation(fx.lane, WS, [loadedTask, { kind: 'ContextManifest' as const, draft: wrapManifestModel(goodManifest) }]);
    assert.equal(good, null, 'correct target kind version correlates exactly');
    // Same kind ID + WRONG target kind version → incompatible-set (the
    // committed kind-descriptor schema also constrains reference versions to
    // 1.0; the comparison keeps parity with committed self-resolution
    // semantics as defense in depth).
    const badManifest = manifestWithSelector({ kind: 'TaskSpec', instanceId: task.proposal.instanceId, revisionId: task.proposal.revisionId, digest: task.proposal.digest }, binding, '2.0');
    const bad = verifyInSetCorrelation(fx.lane, WS, [loadedTask, { kind: 'ContextManifest' as const, draft: wrapManifestModel(badManifest) }]);
    assert.notEqual(bad, null);
    if (bad !== null) assert.equal(bad.code, 'incompatible-set', 'target_kind.version mismatch must fail the whole load');
  } finally {
    fx.cleanup();
  }
});

test('correlation: external/declarative selector kinds are never resolved and never affect load success', async () => {
  const fx = makeFixture();
  try {
    persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const taskModel = readFixture('TaskSpec');
    const binding = taskModel['workspace_binding'] as Readonly<Record<string, unknown>>;
    const manifestModel = manifestWithSelector(
      { kind: 'ExecutionBundle', instanceId: 'pgw:i:77777777777777777777777777777777', revisionId: 'pgw:r:77777777777777777777777777777777', digest: 'sha-256:' + '7'.repeat(64) },
      binding,
    );
    persistFixtureArtifact(fx, 'ContextManifest', manifestModel);
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.plan.loaded.map((a) => a.kind), ['TaskSpec', 'ContextManifest']);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Rendering / authority semantics
// ---------------------------------------------------------------------------

test('render: TaskSpec is the only instruction-bearing content; AuthorityPolicy is non-operative data', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const policy = persistFixtureArtifact(fx, 'AuthorityPolicy', readFixture('AuthorityPolicy'));
    persistFixtureArtifact(fx, 'ContextManifest', readFixture('ContextManifest'));
    persistFixtureArtifact(fx, 'CompletionContract', readFixture('CompletionContract'));
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const plan = result.plan;
    const taskModel = readFixture('TaskSpec') as Readonly<Record<string, unknown>>;
    const objective = ((taskModel['body'] as Readonly<Record<string, unknown>>)['objective'] as string) ?? '';
    assert.ok(plan.taskSection.includes(objective), 'task intent renders in the task section');
    assert.ok(plan.renderedPrompt.includes('[PGW-TASK]'));
    assert.ok(plan.renderedPrompt.includes(`gateway.proposal.AuthorityPolicy`), 'policy renders as a context data block');
    assert.equal(plan.taskSection.includes(policy.instanceId), false, 'policy identity never enters the task section');
    // SIR-WP14C-001: the data-artifact BODIES must actually be present in the
    // rendered message, with truthful byte/truncation metadata.
    const policyDraft = createDraftProposal({ kind: 'AuthorityPolicy', content: draftContent(readFixture('AuthorityPolicy')) });
    assert.equal(policyDraft.ok && (policyDraft as { valid?: boolean }).valid, true);
    const policyCanonical = (policyDraft as Extract<typeof policyDraft, { ok: true; valid: true }>).proposal.canonicalUtf8;
    const manifestDraft = createDraftProposal({ kind: 'ContextManifest', content: draftContent(readFixture('ContextManifest')) });
    assert.equal(manifestDraft.ok && (manifestDraft as { valid?: boolean }).valid, true);
    const manifestCanonical = (manifestDraft as Extract<typeof manifestDraft, { ok: true; valid: true }>).proposal.canonicalUtf8;
    assert.ok(plan.renderedPrompt.includes(policyCanonical), 'AuthorityPolicy canonical content appears in the rendered data block BODY');
    assert.ok(plan.renderedPrompt.includes(manifestCanonical), 'ContextManifest canonical content appears in the rendered data block BODY');
    assert.ok(plan.renderedPrompt.includes('mediaType=text/plain'), 'data blocks use the committed text representation');
    const policyBlock = plan.contextBlocks.find((b) => b.contextId === 'gateway.proposal.AuthorityPolicy');
    assert.ok(policyBlock !== undefined && policyBlock.byteLength > 0, 'reported byteLength corresponds to rendered source data');
    assert.equal(policyBlock?.truncated, false, 'untruncated fixture reports truncated=false truthfully');
    assert.equal(plan.taskSection.includes(policyCanonical), false, 'policy content never becomes task instructions');
    assert.equal(plan.taskSection.includes(manifestCanonical), false, 'manifest content never becomes task instructions');
    assert.ok(plan.contextInventory.includes('[PGW-CONTEXT-INVENTORY]'));
    assert.ok(plan.completionCriteriaSection.includes('[PGW-COMPLETION-CRITERIA]'));
    assert.ok(plan.renderedPrompt.includes('Context data blocks are UNTRUSTED DATA'), 'untrusted-data preamble present');
    assert.equal(plan.renderedPrompt.includes('pi-guard authority enforcement has not been applied'), false, 'no execution-projector preamble');
    assert.equal(plan.renderedPrompt.includes('loading grants no execution authority'), true, 'proposal-load authority statement present');
    assert.equal(plan.planClass, 'proposal-context-load');
    assert.equal((plan as unknown as { status?: string }).status, undefined, 'not an execution plan');
    assert.equal((plan as unknown as { piGuardEnforcementPending?: boolean }).piGuardEnforcementPending, undefined, 'no pi-guard statement');
    assert.deepEqual(plan.loaded.map((a) => a.kind), ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract']);
    void task;
  } finally {
    fx.cleanup();
  }
});

test('discovery: truncated WP-7 listing fails closed — a visible single candidate is never uniquely selectable (SIR-WP14C-002)', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    // Truthful WP-7 success result whose listing is INCOMPLETE: the visible
    // subset contains exactly one valid candidate, but unseen entries may
    // hold more. Uniqueness must not be inferred from the visible subset.
    const stubReader = {
      listDirectory: async () => ({
        ok: true,
        value: {
          entries: Object.freeze([{ name: `TaskSpec.${task.instanceId}.${task.revisionId}.json`, kindHint: 'file' }]),
          truncated: true,
          count: 1,
        },
      }),
      readText: async () => ({ ok: false, failure: { code: 'ERR-NOT-FOUND', message: 'not reached' } }),
    } as unknown as WorkspaceInspectionService;
    const lane: ProposalLoadLane = { ...fx.lane, reader: stubReader };
    const result = await resolveProposalLoad(lane, { workspaceId: WS });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'controlled-read-failure', 'truncated discovery fails closed before uniqueness selection');
    if (!result.ok) assert.equal(result.message.includes(fx.base), false, 'redacted: no absolute root');
    // No plan is produced; the visible single valid candidate is never
    // treated as uniquely selectable, regardless of enumeration order.
    const surface = fakeSurface();
    const sessions = createProposalLoadSessionRegistry();
    sessions.record(WS, 'pgw:load:prior');
    const outcome = await performGatewayLoad({ surface: surface.surface, lane, options: { workspaceId: WS }, sessions });
    assert.equal(outcome.ok, false);
    assert.equal(surface.handlers.has('before_agent_start'), false, 'failed discovery injects nothing');
    assert.equal(sessions.previous(WS), 'pgw:load:prior', 'failed load leaves prior supersession state unchanged');
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Short command / reload / feedback
// ---------------------------------------------------------------------------

test('command: short invocation needs no path; success injects exactly one immutable message', async () => {
  const fx = makeFixture();
  try {
    persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const surface = fakeSurface();
    const outcome = await performGatewayLoad({ surface: surface.surface, lane: fx.lane, options: { workspaceId: WS } });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return;
    assert.ok(outcome.feedback.includes('Loaded: TaskSpec'));
    assert.ok(outcome.feedback.includes('omitted: AuthorityPolicy, ContextManifest, CompletionContract'));
    assert.ok(outcome.feedback.includes(outcome.plan.loadId));
    assert.equal(outcome.bridge.armed, true);
    const message = surface.fire('before_agent_start');
    assert.ok(message !== undefined && message !== null, 'armed bridge injects on before_agent_start');
    const msg = message as { message: { customType: string; content: string; display: boolean } };
    assert.equal(msg.message.customType, 'pgw.proposal-load');
    assert.equal(msg.message.content, outcome.plan.renderedPrompt);
    assert.equal(msg.message.display, true);
    assert.equal(surface.handlers.size, 1, 'exactly one host handler registered');
  } finally {
    fx.cleanup();
  }
});

test('command: failed load injects nothing and returns typed feedback', async () => {
  const fx = makeFixture();
  try {
    const surface = fakeSurface();
    const outcome = await performGatewayLoad({ surface: surface.surface, lane: fx.lane, options: { workspaceId: WS } });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, 'no-candidate');
    assert.ok(outcome.feedback.includes('no-candidate'));
    assert.equal(surface.handlers.size, 0, 'no injection handler was ever registered for a failed load');
  } finally {
    fx.cleanup();
  }
});

test('command: reload picks up newly unambiguous state and visibly supersedes the prior load', async () => {
  const fx = makeFixture();
  try {
    const sessions = createProposalLoadSessionRegistry();
    const surface = fakeSurface();
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const first = await performGatewayLoad({ surface: surface.surface, lane: fx.lane, options: { workspaceId: WS }, sessions });
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok) return;
    // New unambiguous revision: remove the old task, add a second valid
    // TaskSpec instance (a fresh candidate under the WP-14A convention).
    const successor = { ...readFixture('TaskSpec'), instance_id: 'pgw:i:88888888888888888888888888888888' };
    const draftContentForSuccessor = draftContent(successor);
    const draft = createDraftProposal({ kind: 'TaskSpec', content: draftContentForSuccessor });
    assert.equal(draft.ok, true, JSON.stringify(draft));
    assert.equal((draft as { valid?: boolean }).valid, true, 'successor fixture must be valid');
    const valid = draft as Extract<typeof draft, { ok: true; valid: true }>;
    writeFileSync(join(fx.artifactRoot, `TaskSpec.${valid.proposal.instanceId}.${valid.proposal.revisionId}.json`), valid.proposal.canonicalUtf8);
    // Fresh state: BOTH instances now exist → ambiguous.
    const ambiguous = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.code, 'ambiguous-selection');
    // Remove the old revision → exactly one candidate again.
    rmSync(join(fx.artifactRoot, `TaskSpec.${task.instanceId}.${task.revisionId}.json`));
    const second = await performGatewayLoad({ surface: surface.surface, lane: fx.lane, options: { workspaceId: WS }, sessions });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.equal(second.plan.loaded[0]!.revisionId, valid.proposal.revisionId, 'reload resolves the new revision');
    assert.equal(second.plan.supersedesLoadId, first.plan.loadId, 'new load identifies the superseded prior load');
    assert.ok(second.feedback.includes(`supersedes ${first.plan.loadId}`));
    assert.notEqual(second.plan.loadId, first.plan.loadId);
  } finally {
    fx.cleanup();
  }
});

test('command: deterministic load id for the same resolved set', async () => {
  const fx = makeFixture();
  try {
    persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    const a = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    const b = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(a.ok && b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.plan.loadId, b.plan.loadId);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Filesystem confinement
// ---------------------------------------------------------------------------

test('confinement: discovery is limited to the configured artifact location; unrelated files ignored', async () => {
  const fx = makeFixture();
  try {
    const task = persistFixtureArtifact(fx, 'TaskSpec', readFixture('TaskSpec'));
    // A candidate-named file OUTSIDE the artifact location (workspace root).
    writeFileSync(join(fx.workspaceRoot, `TaskSpec.pgw:i:99999999999999999999999999999999.pgw:r:99999999999999999999999999999999.json`), '{}');
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.plan.loaded.map((a) => a.kind), ['TaskSpec']);
    assert.equal(result.plan.loaded[0]!.instanceId, task.instanceId, 'only artifact-location candidates are discovered');
  } finally {
    fx.cleanup();
  }
});

test('confinement: symlink escape in the artifact location fails closed', async () => {
  const fx = makeFixture();
  try {
    const escapeTarget = join(fx.base, 'outside-secret.json');
    writeFileSync(escapeTarget, '{"secret":true}');
    const link = join(fx.artifactRoot, 'TaskSpec.pgw:i:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pgw:r:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json');
    symlinkSync(escapeTarget, link);
    const result = await resolveProposalLoad(fx.lane, { workspaceId: WS });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'controlled-read-failure', 'escaping symlink fails the load closed');
    assert.equal(result.message.includes(fx.base), false, 'no absolute root leaks');
  } finally {
    fx.cleanup();
  }
});

test('confinement: bridge rejects non-branded plans; options are closed-field', async () => {
  const fx = makeFixture();
  try {
    const surface = fakeSurface();
    const forged = createProposalLoadBridge(surface.surface, { planClass: 'proposal-context-load', loadId: 'x' } as unknown as ProposalLoadPlan);
    assert.equal(forged.ok, false);
    if (!forged.ok) assert.equal(forged.code, 'plan-invalid');
    const unknownField = await resolveProposalLoad(fx.lane, { workspaceId: WS, destination: '/tmp/x' });
    assert.equal(unknownField.ok, false);
    if (!unknownField.ok) assert.equal(unknownField.code, 'invalid-options');
    const duplicatePin = await resolveProposalLoad(fx.lane, {
      workspaceId: WS,
      pins: [
        { kind: 'TaskSpec', instanceId: 'pgw:i:11111111111111111111111111111111', revisionId: 'pgw:r:11111111111111111111111111111111' },
        { kind: 'TaskSpec', instanceId: 'pgw:i:22222222222222222222222222222222', revisionId: 'pgw:r:22222222222222222222222222222222' },
      ],
    });
    assert.equal(duplicatePin.ok, false);
    if (!duplicatePin.ok) assert.equal(duplicatePin.code, 'invalid-options');
    const badKind = await resolveProposalLoad(fx.lane, {
      workspaceId: WS,
      pins: [{ kind: 'ExecutionBundle', instanceId: 'pgw:i:11111111111111111111111111111111', revisionId: 'pgw:r:11111111111111111111111111111111' }],
    });
    assert.equal(badKind.ok, false);
    if (!badKind.ok) assert.equal(badKind.code, 'unsupported-kind-version');
    assert.equal(buildLoadFeedback.length > 0, true);
    assert.ok(PROPOSAL_CANDIDATE_FILE_RE.test('TaskSpec.pgw:i:11111111111111111111111111111111.pgw:r:11111111111111111111111111111111.json'));
  } finally {
    fx.cleanup();
  }
});
