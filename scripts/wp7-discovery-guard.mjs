#!/usr/bin/env node
/**
 * WP-7-C — fail-closed WP-7 test-discovery guard.
 *
 * Runs after tsc compilation and before the WP-7 node --test phase of the
 * repository-default workflow. Verifies the WP-7 test inventory:
 *
 *  1. every required suite directory (reader, git, fff, security) exists in
 *     both source (tests/wp7/<suite>) and compiled (dist-test/tests/wp7/<suite>)
 *     form;
 *  2. every required suite contains at least one source test and one compiled
 *     test (no zero-test phase, no absent focused suite);
 *  3. source<->compiled correspondence: every *.test.ts has exactly one
 *     compiled *.test.js and every compiled *.test.js has a source
 *     counterpart (no missing compiled output, no orphan stale compiled test);
 *  4. helper files (non-*.test.*) are never counted as tests.
 *
 * On any invalid inventory: prints a bounded deterministic diagnostic and
 * exits nonzero WITHOUT starting the WP-7 test runner.
 */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SUITES = ['reader', 'git', 'fff', 'security'];
const SRC_BASE = join(ROOT, 'tests', 'wp7');
const DIST_BASE = join(ROOT, 'dist-test', 'tests', 'wp7');

const problems = [];
const MAX_DIAGNOSTICS = 20;

/** Reject symlinked entries and malformed test-like filenames. */
function inspectDir(dir, label, isSource) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    problems.push(`cannot enumerate ${label} directory: ${dir}`);
    return { testNames: [] };
  }
  const testNames = [];
  for (const name of names) {
    const full = join(dir, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      problems.push(`cannot stat ${label} entry: ${name} in ${dir}`);
      continue;
    }
    if (st.isSymbolicLink()) {
      problems.push(`symlinked ${label} entry (rejected): ${name} in ${dir}`);
      continue;
    }
    if (name.endsWith('.test.ts')) {
      testNames.push(name);
    } else if (name.endsWith('.test.js')) {
      testNames.push(name);
      if (isSource) problems.push(`malformed test filename in source (compiled extension in source tree): ${name} in ${dir}`);
    } else if (name.includes('.test.')) {
      problems.push(`malformed test filename: ${name} in ${dir}`);
    }
  }
  return { testNames };
}

for (const suite of SUITES) {
  const srcDir = join(SRC_BASE, suite);
  const distDir = join(DIST_BASE, suite);
  if (!existsSync(srcDir)) {
    problems.push(`missing source suite directory: tests/wp7/${suite}`);
    continue;
  }
  if (!existsSync(distDir)) {
    problems.push(`missing compiled suite directory: dist-test/tests/wp7/${suite} (zero tests would run)`);
    continue;
  }
  for (const [dir, label] of [[srcDir, 'source suite'], [distDir, 'compiled suite']]) {
    let st;
    try {
      st = lstatSync(dir);
    } catch {
      problems.push(`cannot stat ${label} directory: ${dir}`);
      continue;
    }
    if (st.isSymbolicLink()) problems.push(`symlinked ${label} directory (rejected): ${dir}`);
  }
  const srcTests = inspectDir(srcDir, 'source', true).testNames;
  const distTests = inspectDir(distDir, 'compiled', false).testNames;
  if (srcTests.length === 0) problems.push(`no source tests in tests/wp7/${suite}`);
  if (distTests.length === 0) problems.push(`no compiled tests in dist-test/tests/wp7/${suite} (zero-test phase)`);
  for (const f of srcTests) {
    const compiled = f.replace(/\.ts$/, '.js');
    if (!distTests.includes(compiled)) {
      problems.push(`compiled output missing for source test: tests/wp7/${suite}/${f}`);
    }
  }
  for (const f of distTests) {
    const source = f.replace(/\.js$/, '.ts');
    if (!srcTests.includes(source)) {
      problems.push(`orphan compiled test with no source: dist-test/tests/wp7/${suite}/${f}`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems.slice(0, MAX_DIAGNOSTICS)) {
    console.error(`[wp7-discovery-guard] FAIL: ${p}`);
  }
  if (problems.length > MAX_DIAGNOSTICS) {
    console.error(`[wp7-discovery-guard] FAIL: ${problems.length - MAX_DIAGNOSTICS} further problems omitted`);
  }
  console.error('[wp7-discovery-guard] WP-7 test inventory is invalid; refusing to start the WP-7 test runner.');
  process.exit(1);
}

console.log('[wp7-discovery-guard] WP-7 test inventory OK: source<->compiled correspondence verified for reader/git/fff/security.');
