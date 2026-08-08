/**
 * WP-10 Slice 2 — host/surface-aware transport-free drafting adapter tests.
 *
 * Surface routing → exact registered SchemaRegistry instance → accepted
 * Slice 1 core (via the `createDraftProposalWithSchemaRegistry` seam) →
 * verbatim `DraftProposalResult`. Proves: closed selector grammar (reused
 * WP-9 constants), deterministic registration/routing, exact-instance
 * consultation (instrumented registry subclass), inner drafting taxonomy
 * preservation (never remapped to inspection codes), routing-error
 * separation, draft/validate surface consistency against the accepted
 * WP-9 `validate-artifact` under the SAME registry instance, zero
 * authority, determinism, and zero project/store mutation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../../src/storage/initialization/initialize.js';
import { createSchemaRegistry, computeArtifactDigest } from '../../../src/api/validate.js';
import { SchemaRegistry, type SchemaErrorLike } from '../../../src/schema/registry.js';
import {
  createDraftingContext,
  createMcpDraftingRegistry,
  createMcpInspectionRegistry,
  createInspectionContext,
  createMcpInspectionSurface,
  MCP_DRAFT_TOOLS,
  MCP_INSPECTION_TOOLS,
} from '../../../src/adapters/mcp/index.js';
import { createDraftProposal, createDraftProposalWithSchemaRegistry } from '../../../src/drafting/proposal.js';
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { isGenuineTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { isGenuineWriteCapability, isGenuineReadCapability } from '../../../src/storage/capabilities/authenticity.js';
import type { DraftProposalResult, DraftableArtifactKindId } from '../../../src/drafting/proposal.js';
import type { DraftingResponse } from '../../../src/adapters/mcp/drafting.js';
import type { McpInspectionResponse } from '../../../src/adapters/mcp/types.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../../src/storage/limits/limits.js';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);
const VALID_FIXTURES: Readonly<Record<string, string>> = {
  TaskSpec: 'task-minimal-genesis.json',
  AuthorityPolicy: 'policy-minimal-genesis.json',
  ContextManifest: 'context-minimal-genesis.json',
  CompletionContract: 'completion-minimal-genesis.json',
  ExecutionBundle: 'bundle-minimal-genesis.json',
};

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', name), 'utf8')) as Record<string, unknown>;
}

function invalidFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', name), 'utf8')) as Record<string, unknown>;
}

/** Draft content: the canonical envelope with the derived member removed. */
function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

/** Full canonical envelope (digest present) — the exact `validate-artifact` operand. */
function fullContent(model: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(model);
}

/** Counts every structural schema-validation call — proves EXACT registry-instance consultation. */
class CountingRegistry extends SchemaRegistry {
  validateCalls = 0;
  override validate(schemaId: string, instance: unknown): { valid: boolean; errors: readonly SchemaErrorLike[] } {
    this.validateCalls++;
    return super.validate(schemaId, instance);
  }
}

/** Host-supplied broken registry — safe test seam for a genuine post-routing internal failure. */
class ThrowingRegistry extends SchemaRegistry {
  override validate(): { valid: boolean; errors: readonly SchemaErrorLike[] } {
    throw new Error('SECRET-INTERNAL-DETAIL stack=deep');
  }
}

function profile(overrides: Partial<Record<string, number>> = {}): SelectedLimitProfile {
  const base: Record<string, number> = { ...defaultLimitProfile() };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}

function genuineConfig(identity: string = CONFIG_IDENTITY): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

interface StoreEnv {
  readonly dir: string;
  readonly config: object;
  readonly trustedInput: unknown;
  readonly limitProfile: SelectedLimitProfile;
}

function makeStore(): StoreEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wp10s2-'));
  chmodSync(dir, 0o700);
  const config = genuineConfig();
  const bp = createStorageBootstrapActionProvenance({ actionIdentity: 'wp10s2-bootstrap', locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: profile() });
  const ir = createTrustedStorageBootstrapInput(config, bp, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: profile() });
  assert.equal(ir.ok, true);
  const result = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bp, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: profile() });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  return { dir, config, trustedInput: ir.input, limitProfile: profile() };
}

function draftRegistry(registrations: { surfaceId: string; schemaRegistry: SchemaRegistry }[]) {
  const result = createMcpDraftingRegistry({ registrations });
  assert.equal(result.ok, true, result.message ?? '');
  return result.registry!;
}

test('drafting surface: registration — empty registry legal, sorted deterministic surfaces, immutable', () => {
  const result = createMcpDraftingRegistry({ registrations: [] });
  assert.equal(result.ok, true, result.message ?? '');
  assert.deepEqual(result.registry!.surfaces, []);
  const a = createSchemaRegistry();
  const b = createSchemaRegistry();
  const r1 = draftRegistry([{ surfaceId: 'surface-b', schemaRegistry: b }, { surfaceId: 'surface-a', schemaRegistry: a }]);
  const r2 = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: a }, { surfaceId: 'surface-b', schemaRegistry: b }]);
  assert.deepEqual(r1.surfaces, ['surface-a', 'surface-b'], 'insertion-order-independent canonical order');
  assert.deepEqual(r2.surfaces, ['surface-a', 'surface-b']);
  assert.equal(Object.isFrozen(r1.surfaces), true);
  assert.equal(Object.isFrozen(r1), true);
  assert.equal((r1 as unknown as Record<string, unknown>)['draft'] !== undefined, true);
  assert.equal(Object.keys(r1).sort().join(','), 'draft,surfaces', 'no mutation/admin API on the registry');
});

test('drafting surface: registration — duplicate surfaceId and non-genuine registry fail construction deterministically', () => {
  const a = createSchemaRegistry();
  const dup = createMcpDraftingRegistry({ registrations: [{ surfaceId: 'same', schemaRegistry: a }, { surfaceId: 'same', schemaRegistry: createSchemaRegistry() }] });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'ERR-DRAFT-REQ-INVALID');
  assert.ok(dup.message !== undefined && dup.message.includes('registered more than once'), dup.message ?? '');
  const bad = createMcpDraftingRegistry({ registrations: [{ surfaceId: 'fine', schemaRegistry: { not: 'a registry' } as never }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'ERR-DRAFT-REQ-INVALID');
  const ctx = createDraftingContext({ schemaRegistry: 'nope' as never });
  assert.equal(ctx.ok, false);
  assert.equal(ctx.code, 'ERR-DRAFT-REQ-INVALID');
  const ctxOk = createDraftingContext({ schemaRegistry: a });
  assert.equal(ctxOk.ok, true);
  assert.equal(ctxOk.context!.schemaRegistry, a, 'the context binds the exact instance');
  assert.equal(Object.isFrozen(ctxOk.context), true);
});

test('drafting surface: routing — malformed surfaceId fails invalid-request before any registry consultation', () => {
  const counting = new CountingRegistry();
  const registry = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: counting }]);
  const content = draftContent(fixture('task-minimal-genesis.json'));
  for (const bad of ['', 'UPPER', 'a_b', '/tmp/x', 'a b', 'x'.repeat(65), 42, null, undefined, ['a'], { surfaceId: 'a' }]) {
    const r = registry.draft(bad as never, { kind: 'TaskSpec', content }) as Extract<DraftingResponse, { ok: false }>;
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.error.code, 'invalid-request', String(bad));
  }
  assert.equal(counting.validateCalls, 0, 'no registry may be consulted for a malformed selector');
});

test('drafting surface: routing — unknown well-formed surfaceId fails not-found with no inventory leakage', () => {
  const counting = new CountingRegistry();
  const registry = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: counting }]);
  const r = registry.draft('surface-b', { kind: 'TaskSpec', content: draftContent(fixture('task-minimal-genesis.json')) }) as Extract<DraftingResponse, { ok: false }>;
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'not-found');
  assert.ok(!r.error.message.includes('surface-a'), 'no inventory leakage');
  assert.equal(counting.validateCalls, 0, 'no registry may be consulted for an unknown selector');
});

test('drafting surface: routing — all five kinds equal the direct registry-injected core result', () => {
  const registry = createSchemaRegistry();
  const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: registry }]);
  for (const kind of Object.keys(VALID_FIXTURES) as DraftableArtifactKindId[]) {
    const content = draftContent(fixture(VALID_FIXTURES[kind]!));
    const direct = createDraftProposalWithSchemaRegistry({ kind, content }, registry);
    const routed = drafting.draft('surface-a', { kind, content });
    assert.equal(routed.ok, true, kind);
    if (routed.ok) {
      assert.deepEqual(routed.result, direct, `${kind}: surface-routed result equals direct seam result`);
      assert.equal(routed.result.ok, true);
    }
  }
  // The public/default wrapper (fresh default registry) still matches the seam under a fresh default registry.
  const content = draftContent(fixture('task-minimal-genesis.json'));
  assert.deepEqual(createDraftProposal({ kind: 'TaskSpec', content }), createDraftProposalWithSchemaRegistry({ kind: 'TaskSpec', content }, createSchemaRegistry()));
});

test('drafting surface: routing — the exact registered registry instance is the one consulted', () => {
  const registryA = new CountingRegistry();
  const registryB = new CountingRegistry();
  const drafting = draftRegistry([
    { surfaceId: 'surface-a', schemaRegistry: registryA },
    { surfaceId: 'surface-b', schemaRegistry: registryB },
  ]);
  const content = draftContent(fixture('task-minimal-genesis.json'));
  const r1 = drafting.draft('surface-a', { kind: 'TaskSpec', content });
  assert.equal(r1.ok, true);
  assert.equal(registryA.validateCalls, 1, 'surface-a consulted registry A exactly once');
  assert.equal(registryB.validateCalls, 0, 'registry B untouched');
  const r2 = drafting.draft('surface-b', { kind: 'TaskSpec', content });
  assert.equal(r2.ok, true);
  assert.equal(registryB.validateCalls, 1, 'surface-b consulted registry B exactly once');
  assert.equal(registryA.validateCalls, 1, 'registry A not re-consulted for surface-b');
  assert.deepEqual(r1, r2, 'same candidate, same closed bundle → same result across surfaces');
});

test('drafting surface: envelope — closed fields, bounded requestId echo, malformed envelopes', () => {
  const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: createSchemaRegistry() }]);
  const content = draftContent(fixture('task-minimal-genesis.json'));
  const ok = drafting.draft('surface-a', { kind: 'TaskSpec', content, requestId: 'abc-123' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.requestId, 'abc-123', 'requestId echoed consistently');
  for (const bad of [null, 42, 'x', [], { kind: 'TaskSpec', content, root: '/tmp' }, { kind: 'TaskSpec', content, requestId: '' }, { kind: 'TaskSpec', content, requestId: 'x'.repeat(129) }]) {
    const r = drafting.draft('surface-a', bad as never) as Extract<DraftingResponse, { ok: false }>;
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.error.code, 'invalid-request', JSON.stringify(bad));
  }
});

test('drafting surface: inner drafting taxonomy preserved verbatim after successful routing', () => {
  const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: createSchemaRegistry() }]);
  // unsupported-artifact-kind (ExecutionResult through the correct request path)
  const resultModel = fixture('result-minimal-genesis.json');
  const r1 = drafting.draft('surface-a', { kind: 'ExecutionResult', content: draftContent(resultModel) });
  assert.equal(r1.ok, true, 'routing succeeded; the outcome is an inner drafting result');
  if (r1.ok) {
    assert.equal(r1.result.ok, false);
    assert.equal(r1.result.error.code, 'unsupported-artifact-kind', 'never remapped to inspection codes');
  }
  // invalid-draft-request (valid JSON non-object)
  const r2 = drafting.draft('surface-a', { kind: 'TaskSpec', content: 'null' });
  assert.equal(r2.ok, true);
  if (r2.ok) {
    assert.equal(r2.result.ok, false);
    assert.equal(r2.result.error.code, 'invalid-draft-request');
  }
  // limit-exceeded (accepted artifact byte bound)
  const r3 = drafting.draft('surface-a', { kind: 'TaskSpec', content: '{"a":' + ' '.repeat(1024 * 1024) + '}' });
  assert.equal(r3.ok, true);
  if (r3.ok) {
    assert.equal(r3.result.ok, false);
    assert.equal(r3.result.error.code, 'limit-exceeded');
  }
  // valid:false conclusion (object-shaped WP-4-invalid proposal)
  const r4 = drafting.draft('surface-a', { kind: 'TaskSpec', content: draftContent(invalidFixture('semantic-task-delegated-context-instruction.json')) });
  assert.equal(r4.ok, true);
  if (r4.ok) {
    assert.equal(r4.result.ok, true);
    assert.equal(r4.result.valid, false);
    assert.ok(r4.result.findings.length > 0);
    assert.equal(r4.result.findings[0]!.ruleIds.length > 0, true);
  }
});

test('drafting surface: genuine post-routing internal failure stays the drafting taxonomy (host registry seam)', () => {
  const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: new ThrowingRegistry() }]);
  const r = drafting.draft('surface-a', { kind: 'TaskSpec', content: draftContent(fixture('task-minimal-genesis.json')) });
  assert.equal(r.ok, true, 'routing succeeded');
  if (r.ok) {
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error.code, 'internal-adapter-failure');
    assert.ok(!r.result.error.message.includes('SECRET'), 'redacted');
    assert.ok(!r.result.error.message.includes('stack'), 'redacted');
  }
});

test('drafting surface: draft/validate surface consistency — same exact registry, valid candidate', () => {
  const registryA = createSchemaRegistry();
  const env = makeStore();
  try {
    const inspection = createInspectionContext({ trustedConfiguration: env.config, trustedInput: env.trustedInput, schemaRegistry: registryA });
    assert.equal(inspection.ok, true, inspection.message ?? '');
    const surface = createMcpInspectionSurface(inspection.context!);
    const drafting = draftRegistry([{ surfaceId: 'consistency-a', schemaRegistry: registryA }]);
    for (const kind of Object.keys(VALID_FIXTURES) as DraftableArtifactKindId[]) {
      const model = fixture(VALID_FIXTURES[kind]!);
      const draftR = drafting.draft('consistency-a', { kind, content: draftContent(model) });
      assert.equal(draftR.ok, true, kind);
      const validateR = surface.inspect({ tool: 'validate-artifact', params: { content: fullContent(model) } }) as McpInspectionResponse;
      assert.equal(validateR.ok, true, kind);
      const inner = (draftR as { ok: true; result: DraftProposalResult }).result;
      const verdict = validateR.result as Readonly<Record<string, unknown>>;
      assert.equal(verdict['valid'], true, `${kind}: validate-artifact agrees`);
      assert.equal(inner.ok, true, `${kind}: draft routing succeeded`);
      if (inner.ok === true) {
        assert.equal(inner.valid, true, `${kind}: draft agrees`);
        if (inner.valid) {
          assert.equal(inner.proposal.digest, verdict['digest'], `${kind}: digest identical`);
          assert.equal(inner.proposal.instanceId, verdict['instanceId'], `${kind}: instanceId identical`);
          assert.equal(inner.proposal.revisionId, verdict['revisionId'], `${kind}: revisionId identical`);
          assert.deepEqual(inner.validation.ruleIds, verdict['ruleIds'], `${kind}: ruleIds identical`);
          assert.equal(inner.validation.level, 'self-semantic-valid', `${kind}: self-validation level`);
        }
      }
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('drafting surface: draft/validate surface consistency — same exact registry, invalid candidates (identical findings)', () => {
  const registryA = createSchemaRegistry();
  const env = makeStore();
  try {
    const inspection = createInspectionContext({ trustedConfiguration: env.config, trustedInput: env.trustedInput, schemaRegistry: registryA });
    assert.equal(inspection.ok, true, inspection.message ?? '');
    const surface = createMcpInspectionSurface(inspection.context!);
    const drafting = draftRegistry([{ surfaceId: 'consistency-a', schemaRegistry: registryA }]);
    const cases: ReadonlyArray<{ kind: string; fixture: string }> = [
      { kind: 'TaskSpec', fixture: 'semantic-task-delegated-context-instruction.json' },
      { kind: 'AuthorityPolicy', fixture: 'semantic-authority-contains-task-instruction.json' },
      { kind: 'ContextManifest', fixture: 'semantic-context-instruction-promotion.json' },
    ];
    for (const c of cases) {
      const model = invalidFixture(c.fixture);
      const draftR = drafting.draft('consistency-a', { kind: c.kind, content: draftContent(model) });
      assert.equal(draftR.ok, true, c.fixture);
      // validate-artifact requires the full envelope with the derived digest present.
      const { digest } = computeArtifactDigest(model);
      const full = { ...model, revision: { ...(model['revision'] as Record<string, unknown>), digest } };
      const validateR = surface.inspect({ tool: 'validate-artifact', params: { content: JSON.stringify(full) } }) as McpInspectionResponse;
      assert.equal(validateR.ok, true, c.fixture);
      const inner = (draftR as { ok: true; result: DraftProposalResult }).result;
      const verdict = validateR.result as Readonly<Record<string, unknown>>;
      assert.equal(inner.ok, true, `${c.fixture}: draft routing succeeded`);
      if (inner.ok === true) {
        assert.equal(inner.valid, false, `${c.fixture}: draft rejects`);
        assert.equal(verdict['valid'], false, `${c.fixture}: validate-artifact rejects`);
        if (!inner.valid) {
          assert.deepEqual(inner.findings, verdict['findings'], `${c.fixture}: identical finding projection (phase/category/ruleIds/messageKey/location/subjectIdentity)`);
          assert.deepEqual(inner.findings.map((f) => f.ruleIds), (verdict['findings'] as ReadonlyArray<{ ruleIds: readonly string[] }>).map((f) => f.ruleIds), `${c.fixture}: ruleIds identical`);
        }
      }
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('drafting surface: no authority — registry/context/results carry zero trusted brand', () => {
  const registry = createSchemaRegistry();
  const contextResult = createDraftingContext({ schemaRegistry: registry });
  assert.equal(contextResult.ok, true);
  const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: registry }]);
  const r = drafting.draft('surface-a', { kind: 'TaskSpec', content: draftContent(fixture('task-minimal-genesis.json')) });
  assert.equal(r.ok, true);
  if (r.ok && r.result.ok === true && r.result.valid === true) {
    const model = r.result.proposal.model;
    assert.equal(Object.getOwnPropertySymbols(model).length, 0, 'no brand symbols on draft data');
    assert.equal(Object.getOwnPropertySymbols(drafting).length, 0, 'no brand symbols on the registry');
    assert.equal(Object.getOwnPropertySymbols(contextResult.context!).length, 0, 'no brand symbols on the context');
    assert.equal(isGenuineValidatedTrustedWorkspaceConfiguration(model), false);
    assert.equal(isGenuineTrustedStorageBootstrapInput(model), false);
    assert.equal(isGenuineWriteCapability(model), false);
    assert.equal(isGenuineReadCapability(model), false);
  }
});

test('drafting surface: determinism — identical surface state and request produce identical results', () => {
  const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: createSchemaRegistry() }]);
  for (const kind of Object.keys(VALID_FIXTURES) as DraftableArtifactKindId[]) {
    const content = draftContent(fixture(VALID_FIXTURES[kind]!));
    const a = drafting.draft('surface-a', { kind, content });
    const b = drafting.draft('surface-a', { kind, content });
    assert.deepEqual(b, a, kind);
  }
  const err = drafting.draft('surface-a', { kind: 'TaskSpec', content: '{bad' });
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(drafting.draft('surface-a', { kind: 'TaskSpec', content: '{bad' }), err);
    assert.deepEqual(drafting.draft('nope', { kind: 'TaskSpec', content: 'x' }), drafting.draft('nope', { kind: 'TaskSpec', content: 'x' }));
  }
});

test('drafting surface: fs mutation watchdog — routing, drafting, and failure paths never mutate', () => {
  const guards = ['writeFileSync', 'writeFile', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'renameSync', 'rename', 'unlinkSync', 'unlink', 'chmodSync', 'chmod', 'chownSync', 'chown', 'symlinkSync', 'linkSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'utimesSync', 'utimes'];
  const originals: Record<string, unknown> = {};
  for (const g of guards) {
    originals[g] = (fs as unknown as Record<string, unknown>)[g];
    (fs as unknown as Record<string, unknown>)[g] = (...a: unknown[]) => {
      throw new Error(`MUTATION:${g}`);
    };
  }
  try {
    const registry = createSchemaRegistry();
    const drafting = draftRegistry([{ surfaceId: 'surface-a', schemaRegistry: registry }]);
    for (const kind of Object.keys(VALID_FIXTURES) as DraftableArtifactKindId[]) {
      const ok = drafting.draft('surface-a', { kind, content: draftContent(fixture(VALID_FIXTURES[kind]!)) });
      assert.equal(ok.ok, true);
    }
    drafting.draft('surface-a', { kind: 'TaskSpec', content: draftContent(invalidFixture('semantic-task-delegated-context-instruction.json')) });
    drafting.draft('surface-a', { kind: 'TaskSpec', content: 'null' });
    drafting.draft('surface-a', { kind: 'ExecutionResult', content: '{}' });
    drafting.draft('nope', { kind: 'TaskSpec', content: '{}' });
    drafting.draft('BAD_SELECTOR', { kind: 'TaskSpec', content: '{}' });
    createMcpDraftingRegistry({ registrations: [{ surfaceId: 'same', schemaRegistry: registry }, { surfaceId: 'same', schemaRegistry: registry }] });
  } finally {
    for (const g of guards) (fs as unknown as Record<string, unknown>)[g] = originals[g];
  }
});

test('drafting surface: vocabulary separation — MCP_DRAFT_TOOLS distinct from the six inspection tools', () => {
  assert.deepEqual([...MCP_DRAFT_TOOLS], ['draft-artifact']);
  assert.deepEqual([...MCP_INSPECTION_TOOLS], ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class']);
  assert.equal(MCP_INSPECTION_TOOLS.includes('draft-artifact' as never), false, 'the inspection inventory stays exactly six');
});

test('drafting surface: inspection registry is not widened into drafting (WP-9 stability)', () => {
  const a = createSchemaRegistry();
  const inspection = createMcpInspectionRegistry({ registrations: [] });
  assert.equal(inspection.ok, true, inspection.message ?? '');
  assert.deepEqual(inspection.registry!.surfaces, []);
  const registry = inspection.registry!;
  assert.deepEqual(Object.keys(registry).sort(), ['inspect', 'surfaces'], 'no drafting method appears on the inspection registry');
  const dup = createMcpInspectionRegistry({ registrations: [{ surfaceId: 'x', trustedConfiguration: {}, trustedInput: {}, schemaRegistry: a } as never] });
  assert.equal(dup.ok, false, 'inspection registration still requires genuine trusted operands');
});
