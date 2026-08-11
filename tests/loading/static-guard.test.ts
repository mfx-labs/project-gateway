/**
 * WP-14C — static guard: the loading package stays inside the proposal-load
 * boundary. No lifecycle/control-plane/execution/enforcement/storage/
 * publication/writing imports; no generic filesystem vocabulary; no
 * ExecutionBundle vocabulary; no execution-plan type.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const LOADING_SRC = join(REPO, 'src', 'loading');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.ts')) {
        out.push(full);
      }
    }
  };
  walk(LOADING_SRC);
  return out;
}

test('loading static guard: no lifecycle/execution authority imports in the proposal-load package', () => {
  for (const file of sourceFiles()) {
    const content = readFileSync(file, 'utf8');
    // Only import statements are checked: doc comments may name the
    // forbidden boundaries (prohibitions), but imports must never reach them.
    const imports = content.split('\n').filter((l) => l.startsWith('import ')).join('\n');
    for (const forbidden of [
      '../storage/',
      '../lifecycle',
      '../control-plane',
      '../execution',
      '../publication',
      '../outcome',
      '../retrospective',
      'enforcement',
      '../writing/',
      'pi-guard',
      'piGuard',
    ]) {
      assert.equal(imports.includes(forbidden), false, `${file} must not import ${forbidden}`);
    }
  }
});

test('loading static guard: no generic filesystem or shell vocabulary; no ExecutionBundle construction', () => {
  const core = readFileSync(join(LOADING_SRC, 'core.ts'), 'utf8');
  const plan = readFileSync(join(LOADING_SRC, 'plan.ts'), 'utf8');
  const bridge = readFileSync(join(LOADING_SRC, 'bridge.ts'), 'utf8');
  for (const [name, content] of [['core.ts', core], ['plan.ts', plan], ['bridge.ts', bridge]] as const) {
    for (const forbidden of ['writeFileSync', 'openSync', 'execFile', 'spawn(', 'child_process', 'readdirSync', 'readFileSync']) {
      assert.equal(content.includes(forbidden), false, `${name} must not use ${forbidden}`);
    }
    assert.equal(content.includes('ExecutionBundle'), false, `${name} must never construct or persist an ExecutionBundle`);
  }
  assert.equal(core.includes('PiProjectionInput'), false, 'core.ts must not route through the execution projection pipeline');
  assert.equal(plan.includes('EligibilityReport'), false, 'plan.ts must not fabricate eligibility evidence');
});

test('loading static guard: the candidate naming convention is pinned and bounded', () => {
  const types = readFileSync(join(LOADING_SRC, 'types.ts'), 'utf8');
  assert.equal(types.includes("PROPOSAL_CANDIDATE_FILE_RE = /^(TaskSpec|AuthorityPolicy|ContextManifest|CompletionContract)\\.(pgw:i:[0-9a-f]{32})\\.(pgw:r:[0-9a-f]{32})\\.json$/"), true, 'exact WP-14A destination convention');
  assert.equal(types.includes("PROPOSAL_LOAD_KINDS = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract']"), true, 'exact four-kind vocabulary');
  assert.equal(types.includes('interface CurrentSelectionRecord'), false, 'no durable selection state concept');
});
