/**
 * WP-5B unit tests — capability → tool-profile projection (Part C/D).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectAllowedAndDenied,
  capabilityToProfileKind,
} from '../../../src/adapters/pi/enforcement/projection.js';
import { observeEffectiveSurface } from '../../../src/adapters/pi/enforcement/surface.js';
import type { EffectiveToolSurface, ExpectedToolSource } from '../../../src/adapters/pi/enforcement/types.js';

function tool(name: string, source = 'builtin'): { name: string; sourceInfo: { source: string } } {
  return { name, sourceInfo: { source } };
}

/**
 * Research-shaped surface: required builtins + bash + authoring + web extras.
 * `overrides` replaces an existing tool's source by name; `extra` adds tools.
 */
function researchSurface(overrides: Record<string, string> = {}, extra: { name: string; source: string }[] = [], active: string[] = ['read', 'grep']): EffectiveToolSurface {
  const defaults: { name: string; source: string }[] = [
    { name: 'read', source: 'builtin' },
    { name: 'grep', source: 'builtin' },
    { name: 'find', source: 'builtin' },
    { name: 'ls', source: 'builtin' },
    { name: 'bash', source: 'builtin' },
    { name: 'edit', source: 'builtin' },
    { name: 'write', source: 'builtin' },
    { name: 'ffgrep', source: 'builtin' },
    { name: 'fffind', source: 'builtin' },
    { name: 'git_inspect', source: 'pi-guard' },
    { name: 'web_search', source: 'npm:pi-web-access' },
  ];
  const byName = new Map<string, string>(defaults.map((d) => [d.name, d.source]));
  for (const [name, source] of Object.entries(overrides)) byName.set(name, source);
  for (const e of extra) byName.set(e.name, e.source);
  const inv = [...byName].map(([name, source]) => tool(name, source));
  const observed = observeEffectiveSurface(inv, active, 't');
  if (!observed.ok || observed.surface === undefined) throw new Error('surface observation failed');
  return observed.surface;
}

function project(capability: string, surface: EffectiveToolSurface, expectedToolSources: readonly ExpectedToolSource[] = []) {
  return projectAllowedAndDenied({
    capability,
    capabilityVocabularyVersion: '1',
    surface,
    expectedToolSources,
    workspaceIdentity: 'pgw:w:cf4339b1f56441936467dea1357dc30e',
  });
}

test('workspace-read projects the research profile and denies extras', () => {
  const result = project('project-gateway.workspace-read', researchSurface());
  assert.ok(result.ok);
  if (!result.ok) return;
  // research profile = required builtins + present trusted optional FFF tools
  assert.deepEqual(result.projection.allowedToolNames, ['fffind', 'ffgrep', 'find', 'grep', 'ls', 'read']);
  assert.deepEqual(result.projection.deniedToolNames, ['bash', 'edit', 'git_inspect', 'web_search', 'write']);
});

test('git-inspect adds git_inspect to the profile (with its declared trusted source)', () => {
  const result = project('project-gateway.git-inspect', researchSurface(), [{ toolName: 'git_inspect', packageId: 'pi-guard', scope: 'temporary' }]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.projection.allowedToolNames.includes('git_inspect'));
});

test('file-edit adds edit; absent edit fails closed', () => {
  const full = project('project-gateway.file-edit', researchSurface());
  assert.ok(full.ok);
  if (!full.ok) return;
  assert.ok(full.projection.allowedToolNames.includes('edit'));

  // surface without the edit tool -> required profile tool absent -> fail
  const observed = observeEffectiveSurface(
    [tool('read'), tool('grep'), tool('find'), tool('ls'), tool('bash'), tool('write')],
    ['read'],
    't',
  );
  assert.ok(observed.ok && observed.surface !== undefined);
  const absent = project('project-gateway.file-edit', observed.surface);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.ok(absent.findings.some((f) => f.key === 'projection.required-tool-absent'));
});

test('controlled-write and file-create add write', () => {
  for (const capability of ['project-gateway.controlled-write', 'project-gateway.file-create']) {
    const result = project(capability, researchSurface());
    assert.ok(result.ok);
    if (result.ok) assert.ok(result.projection.allowedToolNames.includes('write'));
  }
});

test('unsupported capabilities fail projection closed (no partial output)', () => {
  for (const capability of ['project-gateway.shell-execute', 'project-gateway.git-mutate', 'project-gateway.file-delete', 'project-gateway.network-external', 'project-gateway.service-local', 'project-gateway.pi-tool-execute', 'unknown-capability']) {
    const result = project(capability, researchSurface());
    assert.ok(!result.ok, `expected ${capability} to fail`);
    if (!result.ok) assert.equal(capabilityToProfileKind(capability), 'unsupported');
  }
});

test('observation-only capability yields a deny-all empty allowed profile', () => {
  const result = project('project-gateway.tool-inventory-inspect', researchSurface());
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.projection.allowedToolNames, []);
  assert.deepEqual(result.projection.deniedToolNames, ['bash', 'edit', 'fffind', 'ffgrep', 'find', 'git_inspect', 'grep', 'ls', 'read', 'web_search', 'write']);
});

test('a required tool with an unexpected source fails closed (trusted-extension mismatch)', () => {
  const surface = researchSurface({ edit: 'other-package' });
  const result = project('project-gateway.file-edit', surface, [{ toolName: 'edit', packageId: 'builtin', scope: 'temporary' }]);
  assert.ok(!result.ok);
  if (!result.ok) assert.ok(result.findings.some((f) => f.key === 'projection.trusted-source-mismatch'));
});

test('a declared expected source is enforced on required tools', () => {
  const surface = researchSurface({ edit: 'my-trusted-editor' });
  const result = project('project-gateway.file-edit', surface, [{ toolName: 'edit', packageId: 'my-trusted-editor', scope: 'temporary' }]);
  assert.ok(result.ok);
  if (result.ok) assert.ok(result.projection.allowedToolNames.includes('edit'));
});

test('optional ffgrep/fffind with an unexpected source are denied (never allowed)', () => {
  const surface = researchSurface({ ffgrep: 'rogue' });
  const result = project('project-gateway.workspace-read', surface, [{ toolName: 'ffgrep', packageId: 'builtin', scope: 'temporary' }]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(!result.projection.allowedToolNames.includes('ffgrep'));
  assert.ok(result.projection.deniedToolNames.includes('ffgrep'));
  // fffind (still trusted builtin) remains allowed
  assert.ok(result.projection.allowedToolNames.includes('fffind'));
  assert.ok(result.projection.allowedToolNames.includes('find'));
});

test('tool names are exact and case-sensitive; extras denied', () => {
  const surface = researchSurface({}, [{ name: 'Read', source: 'builtin' }]);
  const result = project('project-gateway.workspace-read', surface);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.projection.allowedToolNames.includes('read'));
  assert.ok(result.projection.deniedToolNames.includes('Read'));
  assert.equal(result.projection.allowedToolNames.filter((n) => n === 'Read').length, 0);
});
