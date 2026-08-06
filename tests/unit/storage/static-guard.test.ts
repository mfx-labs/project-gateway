/**
 * WP-8-C static guards: per-module filesystem API allowlists, exact-name
 * import discipline, capability-brand path scoping, creator-consumer import
 * edges, absence of ambient authority, export/package deltas, and contract
 * integrity (ADR-028 decision E; W8C-D06/D14).
 *
 * These checks are static/test-time only; they do not mutate anything.
 *
 * Filesystem-bearing modules (exact paths) may import `node:fs` with
 * exact-name named imports only, restricted to their per-module API subset.
 * All other `src/storage/**` modules remain filesystem-free. `new WeakSet`
 * brand markers are granted only to the two exact brand-bearing modules
 * (`src/storage/trusted-input/bootstrap-input.ts`,
 * `src/storage/capabilities/authenticity.ts`). The action-provenance
 * creator, the trusted-input creator, and the capability creator have exact
 * production consumer edges (the future
 * `src/control-plane/storage-bootstrap-action.ts` producer does not exist,
 * so the production import count of the action-provenance creator must be
 * zero). Test-only imports are permitted only from the authorized storage
 * test files and never create a runtime or package export path.
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

/** Exact per-module `node:fs` API allowlist (ADR-028 decision E). */
const FS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'src/storage/root/resolve.ts': ['openSync', 'closeSync', 'fstatSync', 'lstatSync', 'realpathSync', 'constants'],
  'src/storage/initialization/provision.ts': ['mkdirSync', 'openSync', 'closeSync', 'fchmodSync', 'fstatSync', 'fsyncSync', 'readdirSync', 'constants'],
  'src/storage/probe/scratch.ts': ['openSync', 'closeSync', 'fstatSync', 'fchmodSync', 'writeSync', 'unlinkSync', 'constants'],
  'src/storage/probe/probe.ts': ['openSync', 'closeSync', 'fsyncSync', 'fstatSync', 'linkSync', 'symlinkSync', 'readFileSync', 'constants'],
  'src/storage/metadata/bootstrap-persist.ts': ['openSync', 'closeSync', 'writeSync', 'readFileSync', 'readSync', 'fsyncSync', 'fchmodSync', 'fstatSync', 'constants'],
};

/** Complete filesystem API name vocabulary (denied outside the allowlist). */
const FS_API_NAMES = [
  'openSync', 'closeSync', 'fstatSync', 'lstatSync', 'realpathSync', 'fchmodSync', 'fsyncSync',
  'mkdirSync', 'readdirSync', 'linkSync', 'unlinkSync', 'rmdirSync', 'symlinkSync', 'writeSync',
  'readFileSync', 'readSync', 'statSync', 'statfsSync', 'opendirSync', 'cpSync', 'rmSync', 'chownSync', 'chmodSync',
] as const;

/** The two exact brand-bearing modules (Model A). */
const BRAND_MODULES = new Set([
  'src/storage/trusted-input/bootstrap-input.ts',
  'src/storage/capabilities/authenticity.ts',
]);

/** Exact creator-consumer edges for production sources. */
const CREATOR_EDGES: Readonly<Record<string, readonly string[]>> = {
  createStorageBootstrapActionProvenance: [], // future consumer: src/control-plane/storage-bootstrap-action.ts (does not exist)
  createTrustedStorageBootstrapInput: ['src/storage/initialization/initialize.ts'],
  createInitializationCapability: ['src/storage/initialization/initialize.ts'],
};

/** Future capability issuance markers — denied globally. */
const FUTURE_ISSUANCE_MARKERS = /issueWriteCapability|issueReadCapability|issueVerifyCapability|issueRecoveryCapability|issueRetentionCapability|issueMigrationCapability/;

/** Factory/brand vocabulary markers — denied everywhere in src/storage. */
const FACTORY_MARKERS = /createCapability|capabilityFactory|issueCapability|privateBrand|brandToken|capabilityNonce/;

/** Prohibited dynamic-execution, process, timing, randomness, and environment patterns (all files). */
const OTHER_PROHIBITED_PATTERNS = [
  /import\s*\(/,
  /\brequire\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /process\s*\.\s*env/,
  /process\s*\.\s*cwd\s*\(/,
  /process\s*\.\s*pid/,
  /process\s*\.\s*hrtime\s*\(/,
  /performance\s*\.\s*now\s*\(/,
  /Date\s*\.\s*now\s*\(/,
  /new\s+Date\s*\(/,
  /setTimeout\s*\(|setInterval\s*\(|setImmediate\s*\(|queueMicrotask\s*\(/,
  /Math\s*\.\s*random\s*\(/,
  /crypto\s*\.\s*random/,
  /randomUUID/,
  /\bfs\s*\./, // no namespace/property access to an fs object
] as const;

/** Non-filesystem module import forms — denied everywhere. */
const FORBIDDEN_MODULE_PATTERNS = [
  /from\s+['"](?:node:)?child_process['"]/,
  /from\s+['"](?:node:)?worker_threads['"]/,
  /from\s+['"](?:node:)?(?:net|http|https|dgram|dns|tls|http2)['"]/,
] as const;

/** True when any blanket prohibited pattern matches the content (synthetic samples). */
export function matchesAnyProhibited(content: string): boolean {
  return [
    ...OTHER_PROHIBITED_PATTERNS,
    ...FORBIDDEN_MODULE_PATTERNS,
    /from\s+['"](?:node:)?fs(?:\/promises)?['"]/,
    /new WeakSet|new WeakMap/,
    FACTORY_MARKERS,
    FUTURE_ISSUANCE_MARKERS,
  ].some((p) => p.test(content));
}

function rel(file: string): string {
  return relative(REPO, file);
}

interface ImportDecl {
  readonly kind: 'named' | 'namespace' | 'default' | 'export-from' | 'export-star';
  readonly names: readonly string[];
  readonly specifier: string;
}

/** Parse import/export-from declarations (source-text; the allowed syntax is tightly constrained). */
function parseImports(content: string): ImportDecl[] {
  const out: ImportDecl[] = [];
  const named = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(named)) {
    const names = m[1]!.split(',').map((n) => n.trim()).filter((n) => n.length > 0);
    out.push({ kind: 'named', names, specifier: m[2]! });
  }
  const ns = /import\s*\*\s*as\s+\w+\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(ns)) out.push({ kind: 'namespace', names: [], specifier: m[1]! });
  const def = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(def)) out.push({ kind: 'default', names: [m[1]!], specifier: m[2]! });
  // Named export-from: names are retained (plain and aliased) so local
  // re-exports of creators and filesystem names are inspectable (W8C-S05).
  const ef = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(ef)) {
    const names = m[1]!.split(',').map((n) => n.trim()).filter((n) => n.length > 0);
    out.push({ kind: 'export-from', names, specifier: m[2]! });
  }
  const es = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(es)) out.push({ kind: 'export-star', names: [], specifier: m[1]! });
  return out;
}

/** Original (pre-alias) name of an imported/exported binding. */
function originalName(binding: string): string {
  return binding.split(/\s+as\s+/)[0]!.trim();
}

/**
 * Original names exported by any `export { ... }` block, including named
 * export-from declarations (aliases unwrapped). Deterministic; used by the
 * creator re-export scan and its synthetic samples (W8C-S05).
 */
export function exportedBindingNames(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/export\s*\{([^}]*)\}/g)) {
    const group = m[1] ?? '';
    for (const binding of group.split(',').map((n) => n.trim()).filter((n) => n.length > 0)) {
      out.push(originalName(binding));
    }
  }
  return out;
}

function isFsSpecifier(specifier: string): boolean {
  return /^(?:node:)?fs(?:\/promises)?$/.test(specifier);
}

function isForbiddenSpecifier(specifier: string): boolean {
  return /^(?:node:)?(?:child_process|worker_threads|net|http|https|dgram|dns|tls|http2)(?:\/.*)?$/.test(specifier);
}

/** Assert the exact import discipline for one production file. */
function assertImportDiscipline(file: string, content: string): void {
  const path = rel(file);
  const allowlist = FS_ALLOWLIST[path];
  const decls = parseImports(content);
  for (const decl of decls) {
    if (isForbiddenSpecifier(decl.specifier)) {
      assert.fail(`${path}: forbidden module import ${decl.specifier}`);
    }
    if (isFsSpecifier(decl.specifier)) {
      assert.ok(allowlist !== undefined, `${path}: filesystem import in a non-allowlisted module`);
      if (decl.kind !== 'named') {
        assert.fail(`${path}: only exact-name named imports from node:fs are permitted (${decl.kind})`);
      }
      for (const name of decl.names) {
        const plain = name.includes(' as ') ? undefined : name;
        assert.ok(plain !== undefined, `${path}: renamed filesystem imports are not permitted`);
        assert.ok(allowlist.includes(plain), `${path}: filesystem API ${plain} is outside this module's allowlist`);
      }
    }
  }
}

test('static guard: per-module filesystem API allowlists and exact-name imports', () => {
  const files = collectTsFiles(STORAGE_SRC);
  assert.ok(files.length >= 20, `expected the storage module tree, found ${files.length}`);
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    assertImportDiscipline(file, content);
    const allowlisted = FS_ALLOWLIST[path] !== undefined;
    if (!allowlisted) {
      for (const name of FS_API_NAMES) {
        assert.equal(new RegExp(`\\b${name}\\b`).test(content), false, `${path} references filesystem API ${name} without an allowlist`);
      }
      for (const pattern of OTHER_PROHIBITED_PATTERNS) {
        assert.equal(pattern.test(content), false, `${path} matches ${pattern}`);
      }
      for (const pattern of FORBIDDEN_MODULE_PATTERNS) {
        assert.equal(pattern.test(content), false, `${path} matches ${pattern}`);
      }
    } else {
      for (const pattern of OTHER_PROHIBITED_PATTERNS) {
        assert.equal(pattern.test(content), false, `${path} matches ${pattern}`);
      }
      for (const pattern of FORBIDDEN_MODULE_PATTERNS) {
        assert.equal(pattern.test(content), false, `${path} matches ${pattern}`);
      }
      // No absolute-path literals anywhere (disclosure safety).
      assert.equal(/\/home\/|\/tmp\//.test(content), false, `${path} contains an absolute path literal`);
      // Filesystem-bearing modules must not export fs-imported names.
      const exported = [...content.matchAll(/export\s+(?:const|function|class|let|var)\s+(\w+)|export\s*\{([^}]*)\}/g)];
      for (const m of exported) {
        const group = (m[1] ?? m[2] ?? '').split(',').map((n) => n.trim().split(' as ').pop()?.trim()).filter((n): n is string => n !== undefined && n.length > 0);
        for (const name of group) {
          assert.equal((FS_ALLOWLIST[path] ?? []).includes(name), false, `${path} exports a filesystem API name (${name})`);
        }
      }
    }
    // Blanket: no '/home/' or '/tmp/' literals in any storage file.
    assert.equal(/\/home\/|\/tmp\//.test(content), false, `${path} contains an absolute path literal`);
  }
});

test('static guard: capability-brand markers are path-scoped to the two exact modules', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    if (BRAND_MODULES.has(path)) {
      assert.ok(/new WeakSet/.test(content), `${path} must carry its private brand collection`);
    } else {
      assert.equal(/new WeakSet/.test(content), false, `${path} contains a brand collection outside the authorized modules`);
    }
    assert.equal(/new WeakMap/.test(content), false, `${path} contains WeakMap`);
    assert.equal(FACTORY_MARKERS.test(content), false, `${path} contains a factory or branding marker`);
    assert.equal(FUTURE_ISSUANCE_MARKERS.test(content), false, `${path} contains a future capability issuance marker`);
  }
});

test('static guard: creator-consumer edges hold for production sources', () => {
  const production = collectTsFiles(join(REPO, 'src')).filter((f) => !f.startsWith(join(REPO, 'src', 'storage')));
  const storageProduction = collectTsFiles(STORAGE_SRC);
  const consumers = new Map<string, string[]>();
  const init = (name: string): void => {
    if (!consumers.has(name)) consumers.set(name, []);
  };
  for (const file of [...production, ...storageProduction]) {
    const content = readFileSync(file, 'utf8');
    for (const [creator] of Object.entries(CREATOR_EDGES)) {
      init(creator);
    }
    for (const decl of parseImports(content)) {
      for (const [creator] of Object.entries(CREATOR_EDGES)) {
        // Aliased bindings are unwrapped so `import { x as y }` and
        // `export { x as y } from ...` cannot hide a creator edge (W8C-S05).
        if (decl.names.some((name) => originalName(name) === creator)) consumers.get(creator)!.push(rel(file));
      }
    }
  }
  for (const [creator, allowed] of Object.entries(CREATOR_EDGES)) {
    const actual = consumers.get(creator) ?? [];
    for (const consumer of actual) {
      assert.ok(allowed.includes(consumer), `${creator} imported by unauthorized production consumer ${consumer}`);
    }
  }
  // The production action-provenance creator must have ZERO production importers
  // (its only consumer, src/control-plane/storage-bootstrap-action.ts, does not exist).
  assert.equal((consumers.get('createStorageBootstrapActionProvenance') ?? []).length, 0, 'action-provenance creator must have no production importer');
  // The private storage barrel must not re-export the creators.
  const barrel = readFileSync(join(STORAGE_SRC, 'index.ts'), 'utf8');
  for (const creator of Object.keys(CREATOR_EDGES)) {
    assert.equal(barrel.includes(creator), false, `src/storage/index.ts must not re-export ${creator}`);
  }
});

test('static guard: creators are never re-exported by any storage module (W8C-S05)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  const creators = Object.keys(CREATOR_EDGES);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const name of exportedBindingNames(content)) {
      for (const creator of creators) {
        assert.equal(name === creator, false, `${rel(file)} re-exports ${creator} (plain or aliased, incl. export-from)`);
      }
    }
  }
});

test('static guard: export * from is denied outside the top storage barrel (W8C-S05)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const path = rel(file);
    for (const decl of parseImports(readFileSync(file, 'utf8'))) {
      if (decl.kind === 'export-star') {
        // The top barrel's export-star targets are the individually guarded
        // sub-barrels (creators never exported); anywhere else the policy
        // cannot prove safety, so export-star is denied.
        assert.equal(path, 'src/storage/index.ts', `${path}: export * from is only provably safe from the top barrel`);
      }
    }
  }
});

test('static guard: synthetic creator export-from and alias samples are detected (W8C-S05)', () => {
  const creators = Object.keys(CREATOR_EDGES);
  const samples: ReadonlyArray<[string, string]> = [
    ['export { createStorageBootstrapActionProvenance } from "./bootstrap-input.js"', 'action-provenance creator export-from'],
    ['export { createStorageBootstrapActionProvenance as mintAction } from "./bootstrap-input.js"', 'aliased action-provenance creator export-from'],
    ['export { createTrustedStorageBootstrapInput } from "./bootstrap-input.js"', 'trusted-input creator export-from'],
    ['export { createTrustedStorageBootstrapInput as mintInput } from "./bootstrap-input.js"', 'aliased trusted-input creator export-from'],
    ['export { createInitializationCapability } from "./authenticity.js"', 'capability creator export-from'],
    ['export { createInitializationCapability as mintCap } from "./authenticity.js"', 'aliased capability creator export-from'],
    ['export {\n  createInitializationCapability as mintCap,\n  INITIALIZATION_OPERATION_SET,\n} from "./authenticity.js"', 'multiline aliased capability creator export-from'],
    ['export * from "./bootstrap-input.js"', 'export-star from a creator-bearing module'],
    ['export { openSync } from "./bootstrap-persist.js"', 'local export-from of a filesystem-imported name'],
    ['export { openSync as read } from "./bootstrap-persist.js"', 'aliased local export-from of a filesystem-imported name'],
  ];
  for (const [sample, label] of samples) {
    const decls = parseImports(sample);
    assert.ok(decls.length > 0, `${label}: no parsed declaration for ${sample}`);
    const bindings = exportedBindingNames(sample);
    if (label.includes('creator') && !label.includes('export-star')) {
      assert.ok(bindings.some((b) => creators.includes(b)), `${label}: creator binding not detected in ${sample}`);
    }
    if (label.includes('export-star')) {
      assert.ok(decls.some((d) => d.kind === 'export-star'), `${label}: export-star not detected`);
    }
    if (label.includes('filesystem-imported name')) {
      assert.ok(bindings.includes('openSync'), `${label}: filesystem name not detected in ${sample}`);
    }
  }
});

test('static guard: no local re-export chain exposes filesystem APIs', () => {
  const files = collectTsFiles(STORAGE_SRC);
  const fsNamesByModule = new Map<string, string[]>();
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    const names: string[] = [];
    for (const decl of parseImports(content)) {
      if (isFsSpecifier(decl.specifier)) names.push(...decl.names);
    }
    fsNamesByModule.set(path, names);
  }
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    for (const decl of parseImports(content)) {
      if (decl.specifier.startsWith('.') || decl.specifier.startsWith('..')) {
        const target = join(dirnameOf(path), decl.specifier);
        const fsNames = fsNamesByModule.get(target) ?? [];
        for (const name of decl.names) {
          assert.equal(fsNames.includes(originalName(name)), false, `${path} re-imports filesystem name ${originalName(name)} through local module ${target}`);
        }
      }
    }
  }
});

function dirnameOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

test('static guard: no absolute-path or mutation-implying vocabulary in src/storage/**', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(/\/home\/|\/tmp\//.test(content), false, `${relative(REPO, file)} has absolute path literals`);
    assert.equal(/fs\.(write|rename|link|mkdir|unlink)/.test(content), false, `${relative(REPO, file)} references fs mutations`);
    assert.equal(/\bchownSync\b|\bchmodSync\b/.test(content), false, `${relative(REPO, file)} references ownership mutation`);
  }
});

test('static guard: src/index.ts is unchanged and does not import src/storage', () => {
  const index = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  assert.equal(/storage/.test(index), false, 'src/index.ts must not reference storage');
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
  assert.equal(hash, 'aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f');
});

test('static guard: no timers, randomness, or environment dependence in storage modules', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of OTHER_PROHIBITED_PATTERNS) {
      assert.equal(pattern.test(content), false, `${relative(REPO, file)} matches ${pattern}`);
    }
  }
});

test('static guard: no forbidden later-phase directories exist (W8B-C03)', () => {
  for (const d of ['publication', 'read', 'audit', 'registry', 'recovery', 'retention', 'lock']) {
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
    ['import * as fsp from "node:fs/promises"', 'namespace fs/promises import'],
    ['export { x } from "fs"', 'export-from fs'],
    ['import { readFile as rf } from "node:fs"', 'aliased fs import'],
    ['import { spawn } from "node:child_process"', 'child_process static import'],
    ['import { parentPort } from "node:worker_threads"', 'worker_threads static import'],
    ['import { openSync } from "fs/promises"', 'fs/promises static import'],
    ['import { openSync } from "node:fs/promises"', 'node:fs/promises static import'],
    ['new WeakSet()', 'brand marker in a wrong path'],
    ['issueWriteCapability()', 'future write capability issuance marker'],
    ['issueRecoveryCapability()', 'future recovery capability issuance marker'],
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

test('static guard: exact import discipline rejects off-allowlist fs forms (W8C-D06)', () => {
  const violations: ReadonlyArray<[string, string]> = [
    ['import { openSync } from "node:fs"', 'off-allowlist filesystem import'],
    ['import { openSync as o } from "node:fs"', 'renamed filesystem import'],
    ['import * as fsp from "node:fs"', 'namespace filesystem import'],
    ['import { writeFileSync } from "node:fs"', 'API outside the module-specific subset'],
    ['import fs from "node:fs"', 'default filesystem import'],
    ['export { openSync } from "node:fs"', 'export-from filesystem declaration'],
  ];
  for (const [sample, label] of violations) {
    assert.equal(matchesAnyProhibited(sample), true, label);
  }
});
