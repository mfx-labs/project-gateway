#!/usr/bin/env node
/**
 * WP-7-C — validated WP-7 test runner (Z-01 final correction).
 *
 * Executes the real compiled WP-7 tests per suite and enforces the ACTUAL
 * executed-test summary against the accepted count manifest. File presence
 * and source<->compiled correspondence are validated separately by
 * scripts/wp7-discovery-guard.mjs; this runner proves that the tests are
 * really discovered AND executed, with the exact accepted counts.
 *
 * Per suite (reader, git, fff, security), sequentially:
 *   - resolve the exact compiled *.test.js files;
 *   - launch the supported Node test runner (process.execPath, Node 22.23.2)
 *     with a machine-parseable TAP reporter and serialized file execution;
 *   - parse the final authoritative TAP summary (plan line + summary block);
 *   - require: tests == expected, pass == tests, fail == cancelled ==
 *     skipped == todo == 0, and process exit 0;
 *   - fail nonzero on: zero tests, all-skipped, missing/added tests,
 *     absent or ambiguous summary, exit/summary inconsistency.
 *
 * No informal console-sentence parsing is used. On failure the original
 * suite output is preserved to a temporary file and a bounded deterministic
 * diagnostic is printed.
 *
 * The accepted count manifest (must be updated consistently if authorized
 * test-count changes are ever merged):
 *   reader 62, git 38, fff 26, security 39 (total 165).
 * Security rose from 32 to 39 in the final focused-rereview correction:
 * seven direct fingerprint fail-closed tests (Z-05) were authorized.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const EXPECTED_COUNTS = Object.freeze({ reader: 62, git: 38, fff: 26, security: 39 });

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_DIAGNOSTIC_LINES = 15;

/**
 * Parse the final authoritative TAP summary from a node --test TAP stream.
 * The plan line (`1..N`) and the six summary fields must each appear
 * exactly once in the trailing block; nested (indented) subtests are
 * ignored. Returns { ok, summary | error }.
 */
export function parseTapSummary(stdout) {
  const lines = stdout.split('\n');
  let planIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^1\.\.\d+$/.test(lines[i])) {
      planIdx = i;
      break;
    }
  }
  if (planIdx === -1) return { ok: false, error: 'missing TAP plan line (1..N)' };
  const block = lines.slice(planIdx + 1);
  const readField = (name) => {
    const re = new RegExp(`^# ${name} (\\d+)$`);
    const matches = block.filter((l) => re.test(l));
    if (matches.length !== 1) {
      return { bad: `summary field '# ${name}' must appear exactly once in the trailing summary (found ${matches.length})` };
    }
    return Number(re.exec(matches[0])[1]);
  };
  const fields = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const v = readField(name);
    if (v.bad) return { ok: false, error: v.bad };
    fields[name] = v;
  }
  return { ok: true, summary: fields };
}

/**
 * Evaluate a suite result: reconcile the parsed summary with the accepted
 * expected count and the child exit status. Returns { ok, summary, problems }.
 */
export function evaluateSuite(name, expected, status, stdout) {
  const problems = [];
  const parsed = parseTapSummary(stdout);
  if (!parsed.ok) {
    problems.push(`no valid test summary (${parsed.error}); process exit ${status}`);
    return { ok: false, problems, summary: null };
  }
  const s = parsed.summary;
  if (s.tests !== expected) problems.push(`expected ${expected} executed tests, summary reports ${s.tests}`);
  if (s.pass !== s.tests) problems.push(`pass count ${s.pass} != executed tests ${s.tests}`);
  if (s.fail !== 0) problems.push(`${s.fail} failing tests`);
  if (s.skipped !== 0) problems.push(`${s.skipped} skipped tests (zero-skip required)`);
  if (s.cancelled !== 0) problems.push(`${s.cancelled} cancelled tests`);
  if (s.todo !== 0) problems.push(`${s.todo} todo tests`);
  if (status !== 0) problems.push(`test process exited ${status} (inconsistent with an accepted summary)`);
  return { ok: problems.length === 0, problems, summary: s };
}

function runSuite(files) {
  const child = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES },
  );
  return {
    status: child.status === null ? -1 : child.status,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    spawnError: child.error ? String(child.error) : null,
  };
}

function main() {
  const problems = [];
  const preserved = [];
  let totalTests = 0;
  for (const suite of Object.keys(EXPECTED_COUNTS)) {
    const expected = EXPECTED_COUNTS[suite];
    const dir = join(REPO_ROOT, 'dist-test', 'tests', 'wp7', suite);
    if (!existsSync(dir)) {
      problems.push(`[${suite}] compiled suite directory missing: dist-test/tests/wp7/${suite}`);
      continue;
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.test.js'))
      .sort()
      .map((f) => join(dir, f));
    if (files.length === 0) {
      problems.push(`[${suite}] zero compiled test files in dist-test/tests/wp7/${suite}`);
      continue;
    }

    const { status, stdout, stderr, spawnError } = runSuite(files);
    const evaluation = evaluateSuite(suite, expected, status, stdout);
    totalTests += evaluation.summary ? evaluation.summary.tests : 0;

    if (spawnError) {
      problems.push(`[${suite}] runner spawn failed: ${spawnError}`);
    }
    if (!evaluation.ok) {
      for (const p of evaluation.problems) problems.push(`[${suite}] ${p}`);
      const artifact = join(mkdtempSync(join(tmpdir(), 'wp7-runner-')), `${suite}.out.txt`);
      writeFileSync(artifact, `-- stdout --\n${stdout}\n-- stderr --\n${stderr}`);
      preserved.push(artifact);
      const tail = stdout.split('\n').slice(-MAX_DIAGNOSTIC_LINES).join('\n');
      console.error(`[wp7-runner] FAIL ${suite}: last ${MAX_DIAGNOSTIC_LINES} output lines:\n${tail}`);
    } else {
      console.log(`[wp7-runner] ${suite}: ${evaluation.summary.tests}/${evaluation.summary.tests} pass (exit ${status})`);
    }
  }

  if (problems.length > 0) {
    for (const p of problems.slice(0, 40)) console.error(`[wp7-runner] FAIL: ${p}`);
    if (problems.length > 40) console.error(`[wp7-runner] FAIL: ${problems.length - 40} further problems omitted`);
    for (const a of preserved) console.error(`[wp7-runner] full suite output preserved at: ${a}`);
    console.error('[wp7-runner] WP-7 validated execution FAILED; refusing to report success.');
    process.exit(1);
  }
  console.log(`[wp7-runner] WP-7 validated execution OK: ${totalTests} tests across ${Object.keys(EXPECTED_COUNTS).length} suites, 0 failed/skipped/cancelled/todo.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
