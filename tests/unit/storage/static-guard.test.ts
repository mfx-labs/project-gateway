/**
 * WP-8-B static guards: prohibited imports, absence of capability
 * factories/instances, absence of filesystem authority, export and package
 * deltas, and contract integrity.
 *
 * These checks are static/test-time only; they do not mutate anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// Compiled location: dist-test/tests/unit/storage/ -> repository root is 4 levels up.
const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const STORAGE_SRC = join(REPO, 'src', 'storage');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const PROHIBITED_IMPORT_PATTERNS = [
  // Static imports / export-from / aliased / namespace forms (whitespace-tolerant).
  /from\s+['"](?:node:)?fs(?:\/promises)?['"]/,
  /from\s+['"](?:node:)?child_process['"]/,
  /from\s+['"](?:node:)?worker_threads['"]/,
  /from\s+['"](?:node:)?(?:net|http|https|dgram|dns|tls|http2)['"]/,
  // Dynamic import(...) of any module (W8B-C03).
  /import\s*\(/,
  // CommonJS require(...) of any module (W8B-C03).
  /require\s*\(/,
  // Dynamic execution.
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  // Process and environment identity (whitespace-tolerant around the dot).
  /process\s*\.\s*env/,
  /process\s*\.\s*cwd\s*\(/,
  /process\s*\.\s*pid/,
  /process\s*\.\s*hrtime\s*\(/,
  // Wall-clock time and timers.
  /performance\s*\.\s*now\s*\(/,
  /Date\s*\.\s*now\s*\(/,
  /new\s+Date\s*\(/,
  /setTimeout\s*\(|setInterval\s*\(|setImmediate\s*\(|queueMicrotask\s*\(/,
  // Nondeterministic randomness.
  /Math\s*\.\s*random\s*\(/,
  /crypto\s*\.\s*random/,
  /randomUUID/,
] as const;

/** True when any prohibited pattern matches the content. */
export function matchesAnyProhibited(content: string): boolean {
  return PROHIBITED_IMPORT_PATTERNS.some((p) => p.test(content));
}

test('static guard: no prohibited filesystem/process imports in src/storage/**', () => {
  const files = collectTsFiles(STORAGE_SRC);
  assert.ok(files.length >= 10, `expected a storage module tree, found ${files.length}`);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of PROHIBITED_IMPORT_PATTERNS) {
      assert.equal(pattern.test(content), false, `${relative(REPO, file)} matches ${pattern}`);
    }
  }
});

test('static guard: no capability factory or capability instance exists in src/storage/**', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(/new WeakSet/.test(content), false, `${relative(REPO, file)} contains WeakSet`);
    assert.equal(/new WeakMap/.test(content), false, `${relative(REPO, file)} contains WeakMap`);
    assert.equal(/createCapability|capabilityFactory|issueCapability|privateBrand|brandToken|capabilityNonce/.test(content), false, `${relative(REPO, file)} contains a factory or branding marker`);
  }
});

test('static guard: no absolute-path or filesystem operation exists in src/storage/**', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(/\/home\/|\/tmp\/|openSync|mkdirSync|writeFileSync|unlinkSync|realpathSync|statSync/.test(content), false, `${relative(REPO, file)} has filesystem operations`);
  }
});

test('static guard: no mutation-implying vocabulary in src/storage/**', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(/fs\.(write|rename|link|mkdir|unlink)/.test(content), false, `${relative(REPO, file)} references fs mutations`);
  }
});

test('static guard: src/index.ts is unchanged and does not import src/storage', () => {
  const index = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  assert.equal(/storage/.test(index), false, 'src/index.ts must not reference storage');
  // Public export count remains 42 (measured from the built declaration surface).
  const distDts = join(REPO, 'dist', 'index.d.ts');
  if (existsSync(distDts)) {
    const dts = readFileSync(distDts, 'utf8');
    const names = new Set<string>();
    for (const m of dts.matchAll(/export\s+(?:declare\s+)?(?:type\s+)?(?:abstract\s+)?(?:class|interface|type|const|function|enum)\s+(\w+)/g)) {
      const name = m[1];
      if (name) names.add(name);
    }
    for (const m of dts.matchAll(/export\s*\{([^}]*)\}/g)) {
      const group = m[1];
      if (group === undefined) continue;
      for (const n of group.split(',')) {
        const name = n.trim().split(' as ').pop()?.trim();
        if (name) names.add(name);
      }
    }
    assert.equal(names.size, 42, `public export count ${names.size} != 42`);
  }
});

test('static guard: package exports and dependencies unchanged', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
  };
  assert.deepEqual(Object.keys(pkg.exports ?? {}).sort(), ['.', './pi-adapter']);
  assert.deepEqual(pkg.dependencies, { ajv: '8.20.0' });
});

test('static guard: authoritative contract is byte-identical at the accepted SHA-256', () => {
  const contract = readFileSync(join(REPO, 'docs', 'specs', 'wp-8-local-storage-registry-contract.md'), 'utf8');
  const hash = createHash('sha256').update(contract).digest('hex');
  assert.equal(hash, '926c4de0f6498c10a64d2dadc75ed9ee65108c2d31030cc3e124276f208b83b0');
});

test('static guard: no timers, randomness, or environment dependence in storage modules', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(matchesAnyProhibited(content), false, `${relative(REPO, file)} matches a prohibited pattern`);
  }
});

test('static guard: no forbidden later-phase directories exist (W8B-C03)', () => {
  for (const d of ['root', 'capabilities', 'publication', 'read', 'audit', 'registry', 'recovery', 'retention']) {
    assert.equal(existsSync(join(STORAGE_SRC, d)), false, `src/storage/${d} must not exist in this phase`);
  }
});

test('static guard: synthetic prohibited samples are detected (W8B-C03)', () => {
  const samples: ReadonlyArray<[string, string]> = [
    ['await import("node:fs")', 'dynamic fs import'],
    ['await import( "node:fs/promises" )', 'dynamic fs/promises import with whitespace'],
    ['import("child_process")', 'dynamic child_process import'],
    ['require("fs")', 'CommonJS fs require'],
    ['require ( "child_process" )', 'CommonJS child_process require with whitespace'],
    ['eval("process.exit(1)")', 'eval'],
    ['new Function("return 1")', 'new Function'],
    ['process.cwd()', 'process.cwd'],
    ['process . cwd ( )', 'process.cwd with whitespace around dot and call'],
    ['process\n  .\n  cwd()', 'process.cwd multiline dotted access'],
    ['process.env.SECRET', 'process.env'],
    ['process . env . SECRET', 'process.env with whitespace around dots'],
    ['process.pid', 'process.pid'],
    ['performance.now()', 'performance.now'],
    ['performance . now ( )', 'performance.now with whitespace around dot and call'],
    ['Date.now()', 'Date.now'],
    ['Date . now ( )', 'Date.now with whitespace around dot and call'],
    ['setTimeout(cb, 1)', 'setTimeout'],
    ['setInterval(cb, 1)', 'setInterval'],
    ['Math.random()', 'Math.random'],
    ['Math . random ( )', 'Math.random with whitespace around dot and call'],
    ['crypto.randomBytes(16)', 'crypto.randomBytes'],
    ['randomUUID()', 'randomUUID'],
    ['import { readFile } from "node:fs"', 'static fs import'],
    ['import * as fs from "fs"', 'namespace fs import'],
    ['export { x } from "fs"', 'export-from fs'],
    ['import { readFile as rf } from "node:fs"', 'aliased fs import'],
    ['import { spawn } from "node:child_process"', 'child_process static import'],
    ['import { parentPort } from "node:worker_threads"', 'worker_threads static import'],
  ];
  for (const [sample, label] of samples) {
    assert.equal(matchesAnyProhibited(sample), true, label);
  }
});

test('static guard: benign storage-style source does not trip the guard (W8B-C03)', () => {
  const benign = `
import { parseTypedIdentifier } from '../format/identifier.js';
import { jcsSerialize } from '../../canonical/jcs.js';
export function deriveRecordRelativePath(recordClass: string, rawIdentifier: string): string {
  const parsed = parseTypedIdentifier(rawIdentifier);
  const component = parsed.opaque;
  const shard = component.slice(0, 4);
  return 'records/' + recordClass + '/' + shard + '/' + component + '.rec';
}
`;
  assert.equal(matchesAnyProhibited(benign), false);
});
