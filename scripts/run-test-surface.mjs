#!/usr/bin/env node
/**
 * WP-15 Phase 3B-A — discovery-proof compiled test-surface runner.
 *
 * Executes every compiled `*.test.js` under the given compiled root
 * directories with the supported Node test runner (process.execPath), and
 * fails NONZERO when:
 *
 *   - a root directory is missing or unreadable (with a build hint: a
 *     clean clone must run `npm run build` + `tsc -p tsconfig.tests.json`
 *     before Phase-3C execution; no stale generated output is assumed);
 *   - a root directory contains no compiled `*.test.js` files — empty
 *     discovery can never falsely succeed (the Node test runner itself
 *     exits 0 when a test glob matches nothing, so no glob is used here);
 *   - any executed test fails (the child exit code is forwarded verbatim).
 *
 * Discovery is a RECURSIVE walk of literal paths (no shell or Node globs),
 * so nested compiled test layouts are never silently missed.
 *
 * Deliberately NOT a generic test orchestration framework: no count
 * manifests, no reporters, no suite composition — just explicit
 * authoritative discovery + the real Node runner.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Recursively collect every compiled `*.test.js` under `dir` (literal paths). */
function collectTestFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.test.js')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('usage: node scripts/run-test-surface.mjs <compiled-test-root> [...]');
  process.exit(2);
}

const files = [];
for (const root of roots) {
  const abs = resolve(root);
  let found;
  try {
    found = collectTestFiles(abs);
  } catch {
    console.error(`run-test-surface: cannot read ${abs} — build first (npm run build && tsc -p tsconfig.tests.json)`);
    process.exit(2);
  }
  if (found.length === 0) {
    console.error(`run-test-surface: no compiled *.test.js files under ${abs} — empty discovery must not falsely succeed`);
    process.exit(1);
  }
  console.error(`run-test-surface: discovered ${found.length} compiled test file(s) under ${root}`);
  files.push(...found);
}

const child = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(child.status === null ? 1 : child.status);
