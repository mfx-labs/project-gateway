/**
 * WP-8-C/WP-8-D/WP-8-E static guards: per-module filesystem API
 * allowlists, exact-name import discipline, capability-brand path scoping,
 * creator-consumer import edges, absence of ambient authority,
 * export/package deltas, and contract integrity (ADR-028 decision E;
 * W8C-D06/D14).
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

/** Exact per-module `node:fs` API allowlist (ADR-028 decision E; WP-8-D §16). */
const FS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'src/storage/root/resolve.ts': ['openSync', 'closeSync', 'fstatSync', 'lstatSync', 'realpathSync', 'constants'],
  'src/storage/initialization/provision.ts': ['mkdirSync', 'openSync', 'closeSync', 'fchmodSync', 'fstatSync', 'fsyncSync', 'readdirSync', 'constants'],
  'src/storage/probe/scratch.ts': ['openSync', 'closeSync', 'fstatSync', 'fchmodSync', 'writeSync', 'unlinkSync', 'constants'],
  'src/storage/probe/probe.ts': ['openSync', 'closeSync', 'fsyncSync', 'fstatSync', 'linkSync', 'symlinkSync', 'readFileSync', 'constants'],
  'src/storage/metadata/bootstrap-persist.ts': ['openSync', 'closeSync', 'writeSync', 'readFileSync', 'readSync', 'fsyncSync', 'fchmodSync', 'fstatSync', 'constants'],
  // WP-8-D exact fs-bearing modules (ADR-029 implementation constraints).
  'src/storage/publication/publish-record.ts': ['openSync', 'closeSync', 'writeSync', 'fsyncSync', 'fchmodSync', 'fstatSync', 'linkSync', 'unlinkSync', 'mkdirSync', 'readFileSync', 'constants'],
  // readFileSync(fd) is required by LOK-013 identity-bound release (lock-record
  // nonce/store-instance verification) — exact API refinement of the proposed
  // table, descriptor-bound only.
  'src/storage/locks/lock.ts': ['openSync', 'closeSync', 'writeSync', 'readFileSync', 'fsyncSync', 'fstatSync', 'unlinkSync', 'constants'],
  'src/storage/read/read-record.ts': ['openSync', 'closeSync', 'fstatSync', 'readFileSync', 'constants'],
  'src/storage/read/enumerate.ts': ['readdirSync', 'openSync', 'closeSync', 'fstatSync', 'constants'],
  // WP-8-E: the read-only store scan (records/audit/tmp/locks surfaces). The
  // allowlist is deliberately read-only: no mutating fs API is delegated.
  'src/storage/recovery/scan.ts': ['readdirSync', 'openSync', 'closeSync', 'fstatSync', 'readFileSync', 'constants'],
  // WP-8-F exact fs-bearing mutation owners (ADR-029 implementation
  // constraints): descriptor-bound re-verification (read-only) and the
  // exact-own-temporary unlink with tmp-directory fsync.
  'src/storage/recovery/reverify.ts': ['openSync', 'closeSync', 'fstatSync', 'readFileSync', 'constants'],
  'src/storage/recovery/cleanup.ts': ['openSync', 'closeSync', 'fstatSync', 'fsyncSync', 'unlinkSync', 'constants'],
  // WP-8-F quarantine-temporary: exact quarantine-directory provisioning
  // (mkdir) and the hard-link plus unlink primitive with directory fsyncs.
  // No rename, copy, chmod/chown, or recursive removal.
  'src/storage/recovery/quarantine.ts': ['mkdirSync', 'openSync', 'closeSync', 'fstatSync', 'fsyncSync', 'linkSync', 'unlinkSync', 'constants'],
  // WP-8-H registry-index store access: read-only descriptor reads, the
  // readdir + no-follow lstat freshness probe, and the index-family
  // enumeration. No mutating API is delegated.
  'src/storage/registry/index-store.ts': ['readdirSync', 'lstatSync', 'openSync', 'closeSync', 'fstatSync', 'readFileSync', 'constants'],
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
  // WP-8-D edges (ADR-029 implementation constraints):
  createStorageWriteActionProvenance: [], // future consumer: src/control-plane/storage-write-action.ts (does not exist)
  createTrustedWriteRequest: ['src/storage/publication/index.ts'],
  createWriteCapability: ['src/storage/publication/index.ts'],
  createProvisioningCapability: ['src/storage/publication/index.ts'],
  createReadCapability: ['src/storage/read/index.ts', 'src/storage/registry/compose.ts', 'src/storage/recovery/compose.ts'],
  createVerifyCapability: ['src/storage/read/index.ts'],
  // WP-8-F edges: the recovery-mutation boundary is the sole production
  // consumer; the provenance creator has zero production consumers.
  createRecoveryActionProvenance: [], // future consumer: src/control-plane/storage-recovery-action.ts (does not exist)
  createTrustedRecoveryRequest: ['src/storage/recovery/execute.ts'],
  createRecoveryCapability: ['src/storage/recovery/execute.ts'],
  // WP-8-F correction edges: the exact-record recovery publication permit
  // is minted only by the evidence module and verified/liveness-checked
  // only by the narrow permit-bound publication implementation.
  // WP-8-G: the audit-reconstruction publication builder joins the permit
  // creator edge (the permitted "other single exact recovery publication
  // builder"); WP-8-H: the registry-index publication builder joins it too.
  createRecoveryPublicationPermit: ['src/storage/recovery/evidence.ts', 'src/storage/recovery/reconstruct.ts', 'src/storage/recovery/index-rebuild.ts'],
  isGenuineRecoveryPublicationPermit: ['src/storage/publication/publish-record.ts'],
  recoveryPublicationPermitLive: ['src/storage/publication/publish-record.ts'],
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

/**
 * D-3 exception: `process.pid` is permitted in the exact lock module only
 * (contract 12.3/LOK-015 lock-record field). The pattern remains denied in
 * every other `src/storage/**` file.
 */
const LOCKS_PROCESS_PID_EXCEPTION = new Set(['src/storage/locks/lock.ts']);

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
        // D-3: the process.pid pattern is exempted for the exact lock module
        // only; every other prohibition (incl. Date.now, hrtime, Math.random,
        // crypto randomness, env, cwd, timers, fs-namespace access) applies
        // everywhere else.
        if (pattern.source === /process\s*\.\s*pid/.source && LOCKS_PROCESS_PID_EXCEPTION.has(path)) continue;
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
  assert.equal(hash, '87f0683992928d5114dff10b8329bdbab53cc18a425a7eaccb9243823cd01bee');
});

test('static guard: no timers, randomness, or environment dependence in storage modules', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    for (const pattern of OTHER_PROHIBITED_PATTERNS) {
      // D-3: the process.pid pattern is exempted for the exact lock module only.
      if (pattern.source === /process\s*\.\s*pid/.source && LOCKS_PROCESS_PID_EXCEPTION.has(path)) continue;
      assert.equal(pattern.test(content), false, `${path} matches ${pattern}`);
    }
  }
});

test('static guard: no forbidden later-phase directories exist (W8B-C03; WP-8-D/E)', () => {
  for (const d of ['retention']) {
    assert.equal(existsSync(join(STORAGE_SRC, d)), false, `src/storage/${d} must not exist in this phase`);
  }
  // WP-8-D authorized directories exist exactly once each.
  for (const d of ['publication', 'locks', 'read', 'audit']) {
    assert.equal(existsSync(join(STORAGE_SRC, d)), true, `src/storage/${d} must exist in this phase`);
  }
  // WP-8-E authorized directories exist exactly once each (read-only slice).
  for (const d of ['registry', 'recovery']) {
    assert.equal(existsSync(join(STORAGE_SRC, d)), true, `src/storage/${d} must exist in this phase`);
  }
});

test('static guard: locks-only entropy/process exception does not leak (D-3)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    if (path === 'src/storage/locks/lock.ts') {
      // The exact exception module may use process.pid and named randomBytes.
      assert.equal(/\bprocess\s*\.\s*pid\b/.test(content), true, 'lock.ts must read process.pid (LOK-015)');
      assert.equal(/randomBytes\s*\(/.test(content), true, 'lock.ts must use the named randomBytes nonce source');
      assert.equal(/Date\s*\.\s*now\s*\(/.test(content), false, 'lock.ts must not use a direct clock');
    } else {
      assert.equal(/\bprocess\s*\.\s*pid\b/.test(content), false, `${path} must not reference process.pid outside the lock module`);
      assert.equal(/randomBytes\s*\(/.test(content), false, `${path} must not use randomBytes outside the lock module`);
    }
    // No namespace/default/dynamic crypto imports anywhere (incl. the lock module).
    assert.equal(/import\s*\*\s*as\s+\w+\s*from\s*['"](?:node:)?crypto['"]/.test(content), false, `${path}: namespace crypto import`);
    assert.equal(/import\s+\w+\s+from\s*['"](?:node:)?crypto['"]/.test(content), false, `${path}: default crypto import`);
    assert.equal(/import\s*\([^)]*crypto/.test(content), false, `${path}: dynamic crypto import`);
  }
  // Synthetic leakage samples: each must be rejected by the blanket scan or
  // by the per-file D-3 module restriction.
  const leakage: ReadonlyArray<[string, string]> = [
    ['const pid = process.pid;', 'process.pid in a non-lock module'],
    ['import { randomBytes } from "node:crypto"; randomBytes(16);', 'randomBytes outside the lock module'],
    ['import * as crypto from "node:crypto";', 'namespace crypto import'],
    ['import cryptoDefault from "node:crypto";', 'default crypto import'],
    ['import("node:crypto")', 'dynamic crypto import'],
  ];
  for (const [sample, label] of leakage) {
    const blanketHit = matchesAnyProhibited(sample);
    const moduleRestrictionHit =
      /randomBytes\s*\(/.test(sample) ||
      /\bprocess\s*\.\s*pid\b/.test(sample) ||
      /import\s*\*\s*as\s+\w+\s*from\s*['"](?:node:)?crypto['"]/.test(sample) ||
      /import\s+\w+\s+from\s*['"](?:node:)?crypto['"]/.test(sample) ||
      /import\s*\([^)]*crypto/.test(sample);
    assert.ok(blanketHit || moduleRestrictionHit, label);
  }
  // The lock module itself must not trip the blanket scan except the exempted pattern.
  const lockContent = readFileSync(join(STORAGE_SRC, 'locks', 'lock.ts'), 'utf8');
  for (const pattern of OTHER_PROHIBITED_PATTERNS) {
    if (pattern.source === /process\s*\.\s*pid/.source) continue;
    assert.equal(pattern.test(lockContent), false, `lock.ts must not match ${pattern}`);
  }
});

test('static guard: read/scan tree is mutation-free and readdirSync is the scan owner (WP-8-D/E/F)', () => {
  const readTree = ['src/storage/read/read-record.ts', 'src/storage/read/enumerate.ts', 'src/storage/recovery/scan.ts', 'src/storage/recovery/reverify.ts'];
  const mutating = /\b(writeSync|linkSync|unlinkSync|mkdirSync|fsyncSync|fchmodSync|renameSync|rmSync|rmdirSync|cpSync|chmodSync|chownSync)\b/;
  for (const path of readTree) {
    const content = readFileSync(join(STORAGE_SRC, path.replace('src/storage/', '')), 'utf8');
    assert.equal(mutating.test(content), false, `${path} imports or uses a mutating filesystem API`);
  }
  // readdirSync is confined to the enumeration module, the provisioning
  // classifier, the WP-8-E recovery scan module, and the WP-8-H index store
  // (freshness probe) in the storage tree.
  const readdirOwners = ['src/storage/read/enumerate.ts', 'src/storage/initialization/provision.ts', 'src/storage/recovery/scan.ts', 'src/storage/registry/index-store.ts'];
  const files = collectTsFiles(STORAGE_SRC);
  for (const file of files) {
    const path = rel(file);
    if (/readdirSync/.test(readFileSync(file, 'utf8'))) {
      assert.ok(readdirOwners.includes(path), `${path} uses readdirSync outside the authorized owners`);
    }
  }
});

test('static guard: registry/recovery boundaries hold (WP-8-E)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  const fsFree = ['src/storage/registry/classify.ts', 'src/storage/registry/derive.ts', 'src/storage/registry/compose.ts', 'src/storage/registry/index-model.ts', 'src/storage/recovery/assess.ts', 'src/storage/recovery/plan.ts', 'src/storage/recovery/compose.ts', 'src/storage/recovery/execute.ts', 'src/storage/recovery/evidence.ts', 'src/storage/recovery/reconstruct.ts', 'src/storage/recovery/index-rebuild.ts'];
  const scanAllowlist = FS_ALLOWLIST['src/storage/recovery/scan.ts'] ?? [];
  const mutating = ['writeSync', 'linkSync', 'unlinkSync', 'mkdirSync', 'fsyncSync', 'fchmodSync', 'renameSync', 'rmSync', 'rmdirSync', 'cpSync', 'chmodSync', 'chownSync'];
  for (const name of mutating) {
    assert.equal(scanAllowlist.includes(name), false, `scan allowlist must not contain the mutating API ${name}`);
  }
  for (const path of fsFree) {
    const content = readFileSync(join(STORAGE_SRC, path.replace('src/storage/', '')), 'utf8');
    for (const name of FS_API_NAMES) {
      assert.equal(new RegExp(`\\b${name}\\b`).test(content), false, `${path} references filesystem API ${name} (fs-free boundary)`);
    }
  }
  // WP-8-E performed no recovery mutation; WP-8-F adds the exact authorized
  // mutation owners. Operation-level mutation primitives (quarantine
  // execution, lock breaking, audit reconstruction, generic recovery
  // execution, capability issuance) are denied everywhere; the orphan-removal
  // primitive and the composition boundary exist ONLY in their exact owners.
  const RECOVERY_MUTATION_OWNERS = new Set(['src/storage/recovery/execute.ts', 'src/storage/recovery/cleanup.ts', 'src/storage/recovery/quarantine.ts', 'src/storage/recovery/reconstruct.ts', 'src/storage/recovery/index-rebuild.ts', 'src/storage/recovery/index.ts']); // index.ts re-exports only the exact boundary
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!RECOVERY_MUTATION_OWNERS.has(rel(file))) {
      assert.equal(/\bquarantineObject\s*\(|breakLock|removeOrphan|reconstructAudit|performRecovery|issueRecoveryOperation|executeRecoveryMutation/i.test(content), false, `${rel(file)} contains a recovery-mutation operation marker`);
    }
  }
  // The recovery-mutation boundary never accepts a plan action or any
  // path/descriptor/nonce/fs-function operand.
  const execute = readFileSync(join(STORAGE_SRC, 'recovery', 'execute.ts'), 'utf8');
  assert.equal(/RecoveryPlanAction/.test(execute), false, 'execute.ts must not accept a plan action operand');
  assert.equal(/readFileSync|writeSync|unlinkSync|linkSync|mkdirSync|renameSync/.test(execute), false, 'execute.ts must not perform filesystem work directly');
});

test('static guard: publication sink accepts write authority only; recovery publication is permit-bound (WP-8-F correction)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  // The structural substitution view is gone: no PublicationAuthority
  // abstraction and no caller-supplied operation vocabulary anywhere.
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(/PublicationAuthority/.test(content), false, `${rel(file)} still references the structural PublicationAuthority abstraction`);
    assert.equal(/generic recovery authority union/.test(content), false, `${rel(file)} references a recovery authority union`);
  }
  const substrate = readFileSync(join(STORAGE_SRC, 'publication', 'publish-record.ts'), 'utf8');
  // Generic publication and provisioning are write-only: genuine brand check
  // before any filesystem access; no recovery-capability operand type.
  assert.equal(/isGenuineWriteCapability/.test(substrate), true, 'publish-record.ts must runtime-brand-check the write capability');
  assert.equal(/\bRecoveryCapability\b/.test(substrate), false, 'publish-record.ts must never reference the recovery capability type');
  assert.equal(/\bWriteCapability\b/.test(substrate), true, 'publish-record.ts must accept the write capability type');
  assert.equal(/publishImmutableRecord\(input: \{\s*\n  readonly capability: WriteCapability/.test(substrate), true, 'publishImmutableRecord must accept WriteCapability only');
  assert.equal(/ensureClassShardDirectories\(input: \{\s*\n  readonly capability: WriteCapability/.test(substrate), true, 'ensureClassShardDirectories must accept WriteCapability only');
  assert.equal(/readonly operation\?:/.test(substrate), false, 'publish-record.ts must not carry a caller-supplied operation parameter');
  // The recovery entry point consumes only the exact-record permit and never
  // accepts a record class, final path, shard, or operation from the caller.
  assert.equal(/publishRecoveryBoundRecord/.test(substrate), true, 'the dedicated recovery publication entry point must exist');
  assert.equal(/readonly permit: RecoveryPublicationPermit/.test(substrate), true, 'the recovery entry point must consume the permit only');
  const recoveryEntry = substrate.slice(substrate.indexOf('export function publishRecoveryBoundRecord'), substrate.indexOf('export function publishRecoveryBoundRecord') + 900);
  assert.equal(/readonly recordClass|readonly finalPath|readonly shard|readonly operation/.test(recoveryEntry), false, 'the recovery entry point must not accept a record class, final path, shard, or operation');
  // No permit creator or verifier in any barrel or the package root.
  for (const barrel of ['src/storage/index.ts', 'src/storage/publication/index.ts', 'src/storage/capabilities/index.ts', 'src/index.ts']) {
    const content = readFileSync(join(REPO, barrel), 'utf8');
    assert.equal(/createRecoveryPublicationPermit|isGenuineRecoveryPublicationPermit|recoveryPublicationPermitLive/.test(content), false, `${barrel} must not export the recovery publication permit creator or verifier`);
  }
});

test('static guard: audit-reconstruction vocabulary is closed and confined (WP-8-G)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  // The recovery operation set contains exactly the four implemented
  // operations — no generic audit-write/audit-repair/recovery-write/
  // publish-audit operation exists anywhere in src/storage.
  const authenticity = readFileSync(join(STORAGE_SRC, 'capabilities', 'authenticity.ts'), 'utf8');
  assert.equal(
    /RECOVERY_OPERATION_SET = \['orphan-removal', 'quarantine-temporary', 'audit-reconstruction', 'registry-index-rebuild'\]/.test(authenticity),
    true,
    'the recovery operation set must contain exactly the four implemented operations',
  );
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(/\baudit-write\b|\baudit-repair\b|\brecovery-write\b|\bpublish-audit\b/.test(content), false, `${rel(file)} contains a generic audit-operation marker`);
  }
  // The reconstructed-audit publication role exists only in the brand
  // module, the permit-bound publication sink, and the reconstruction
  // publication builder.
  const roleOwners = new Set(['src/storage/capabilities/authenticity.ts', 'src/storage/publication/publish-record.ts', 'src/storage/recovery/reconstruct.ts']);
  for (const file of files) {
    if (/reconstructed-recovery-audit/.test(readFileSync(file, 'utf8'))) {
      assert.ok(roleOwners.has(rel(file)), `${rel(file)} references the reconstructed-audit publication role outside its owners`);
    }
  }
  // The contract's distinct event-kind literal exists only in the audit
  // builder module; every other production module imports the constant
  // (no duplicate vocabulary, no generic audit publication API).
  const kindOwners = new Set(['src/storage/audit/write-audit.ts']);
  for (const file of files) {
    if (readFileSync(file, 'utf8').includes(`'recovery-audit-reconstruction'`)) {
      assert.ok(kindOwners.has(rel(file)), `${rel(file)} contains the event-kind literal; import the constant instead`);
    }
  }
  // The permit creator remains confined to the two exact recovery
  // publication builders; no barrel re-exports it (the creator-edge test
  // covers production importers; this asserts the new builder is a member).
  const reconstruct = readFileSync(join(STORAGE_SRC, 'recovery', 'reconstruct.ts'), 'utf8');
  assert.equal(/createRecoveryPublicationPermit/.test(reconstruct), true, 'reconstruct.ts must be the recovery publication builder');
  assert.equal(/import\s*[\s\S]*node:fs/.test(reconstruct), false, 'reconstruct.ts must remain filesystem-free');
  // The reconstructed event never carries a caller-selected payload,
  // destination, or event kind: the sink's audit binding is exact.
  const substrate = readFileSync(join(STORAGE_SRC, 'publication', 'publish-record.ts'), 'utf8');
  assert.equal(/readonly payload|readonly eventKind|readonly destination/.test(substrate.slice(substrate.indexOf('export function publishRecoveryBoundRecord'), substrate.indexOf('export function publishRecoveryBoundRecord') + 900)), false, 'the recovery publication entry point must not accept caller-selected audit operands');
  // The recovery capability creator accepts only the closed vocabulary.
  const capCreator = authenticity.slice(authenticity.indexOf('export function createRecoveryCapability'), authenticity.indexOf('export function createRecoveryCapability') + 1600);
  assert.equal(/RECOVERY_OPERATION_SET\.includes\(op\)/.test(capCreator), true, 'the capability creator must validate its operation set against the closed vocabulary');
});

test('static guard: registry-index vocabulary is closed and confined (WP-8-H)', () => {
  const files = collectTsFiles(STORAGE_SRC);
  // The `registry-index` publication-role binding exists only in the brand
  // module, the permit-bound sink, and the index-rebuild builder.
  const roleOwners = new Set(['src/storage/capabilities/authenticity.ts', 'src/storage/publication/publish-record.ts', 'src/storage/recovery/index-rebuild.ts']);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (/role: 'registry-index'|role === 'registry-index'|role !== 'registry-index'/.test(content)) {
      assert.ok(roleOwners.has(rel(file)), `${rel(file)} binds the registry-index publication role outside its owners`);
    }
    assert.equal(/\bindex-write\b|\bindex-repair\b|\bindex-publish\b|\bpublish-index\b/.test(content), false, `${rel(file)} contains a generic index-publication marker`);
  }
  // The pure index model and the read-only index store never import
  // capability or provenance creators: an index grants nothing and can
  // never mint authority (WP-8-H §2).
  for (const pure of ['src/storage/registry/index-model.ts']) {
    const content = readFileSync(join(STORAGE_SRC, pure.replace('src/storage/', '')), 'utf8');
    assert.equal(/createReadCapability|createRecoveryCapability|createWriteCapability|createRecoveryPublicationPermit|createTrustedRecoveryRequest|createRecoveryActionProvenance|createStorageWriteActionProvenance/.test(content), false, `${pure} must not import capability or provenance creators`);
  }
  const indexStore = readFileSync(join(STORAGE_SRC, 'registry', 'index-store.ts'), 'utf8');
  assert.equal(/createReadCapability|createRecoveryCapability|createWriteCapability|createRecoveryPublicationPermit|createTrustedRecoveryRequest/.test(indexStore), false, 'index-store.ts must not import capability or provenance creators');
  // The index publication builder consumes only the exact permit (sink
  // confinement equivalent to the WP-8-F exact-record permits).
  const indexRebuild = readFileSync(join(STORAGE_SRC, 'recovery', 'index-rebuild.ts'), 'utf8');
  assert.equal(/createRecoveryPublicationPermit/.test(indexRebuild), true, 'index-rebuild.ts must mint the exact registry-index permit');
  assert.equal(/publishImmutableRecord|ensureClassShardDirectories/.test(indexRebuild), false, 'index-rebuild.ts must never reach the generic publication substrate');
  // The index store is the exact read-only fs owner; its allowlist is
  // read-only (no mutating API).
  const indexStoreAllowlist = FS_ALLOWLIST['src/storage/registry/index-store.ts'] ?? [];
  assert.ok(indexStoreAllowlist.length > 0, 'index-store.ts must carry an exact fs allowlist');
  for (const mutating of ['writeSync', 'linkSync', 'unlinkSync', 'mkdirSync', 'fsyncSync', 'fchmodSync', 'renameSync', 'rmSync', 'rmdirSync', 'cpSync', 'chmodSync', 'chownSync']) {
    assert.equal(indexStoreAllowlist.includes(mutating), false, `index-store allowlist must not contain the mutating API ${mutating}`);
  }
});

/**
 * Lexical resolution of a relative import specifier to a normalized
 * repository-relative source path (MINOR-3). Project-standard source
 * specifiers use `.js` suffixes in `.ts` sources, so a resolved `*.js`
 * target maps to the `*.ts` source; a trailing `/` maps to `index.ts`.
 * Resolution outside the repository source root is rejected (returns
 * undefined). Pure and deterministic.
 */
export function resolveRelativeSpecifier(importerRelPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined;
  const importerDir = importerRelPath.slice(0, importerRelPath.lastIndexOf('/'));
  const joined = specifier.startsWith('/') ? specifier.slice(1) : `${importerDir}/${specifier}`;
  const parts: string[] = [];
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined; // escapes the source root
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = parts.join('/');
  if (!normalized.startsWith('src/')) return undefined; // outside the source root
  if (normalized.endsWith('.js')) return normalized.slice(0, -3) + '.ts';
  if (normalized.endsWith('/')) return `${normalized}index.ts`;
  return normalized;
}

/**
 * SCP-005 edge classification (MINOR-3): storage modules must never import
 * WP-7 modules and WP-7 modules must never import storage, in either
 * direction, in every syntax form the guard parses (named imports,
 * export-from, aliased bindings). Relative specifiers are resolved
 * lexically against the importer; bare/non-relative specifiers keep the
 * committed predicate. Returns 'forbidden' | 'allowed' | 'not-applicable'.
 */
export function classifyWp7StorageEdge(importerRelPath: string, specifier: string): 'forbidden' | 'allowed' | 'not-applicable' {
  const wp7Trees = ['src/reader', 'src/git', 'src/fff'];
  const isStorage = importerRelPath.startsWith('src/storage/');
  const isWp7 = wp7Trees.some((t) => importerRelPath.startsWith(t + '/'));
  if (!isStorage && !isWp7) return 'not-applicable';
  const spec = specifier.replace(/^node:/, '');
  let target: string | undefined;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    target = resolveRelativeSpecifier(importerRelPath, spec);
    if (target === undefined) return 'not-applicable'; // non-resolvable / out-of-root
  } else {
    target = spec;
  }
  if (isStorage) {
    // Resolved relative targets are repo-relative (`src/…`); bare module
    // names keep the committed predicate with the WP-7 tree leaf names
    // explicitly denied (SCP-005 intent: no storage→WP-7 import in any form).
    const hitsWp7 = wp7Trees.some((t) => target.startsWith(t)) || target === 'reader' || target === 'git' || target === 'fff';
    return hitsWp7 ? 'forbidden' : 'allowed';
  }
  // WP-7 importer: storage targets are forbidden; its own tree and other
  // approved trees are allowed.
  const hitsStorage = target.startsWith('storage') || target.includes('/storage/');
  return hitsStorage ? 'forbidden' : 'allowed';
}

test('static guard: storage-to-WP-7 import edge is closed in both directions (SCP-005; MINOR-3)', () => {
  const files = collectTsFiles(join(REPO, 'src'));
  for (const file of files) {
    const path = rel(file);
    const content = readFileSync(file, 'utf8');
    // Every parsed declaration (named imports AND export-from forms, plain
    // and aliased) is classified; relative specifiers are resolved lexically
    // and are no longer skipped.
    for (const decl of parseImports(content)) {
      const edge = classifyWp7StorageEdge(path, decl.specifier);
      assert.notEqual(edge, 'forbidden', `${path}: SCP-005 forbidden import ${decl.specifier}`);
    }
  }
});

test('static guard: SCP-005 relative-import adversarial samples are detected (MINOR-3)', () => {
  // Real repository-relative hypothetical forbidden edges: each sample is a
  // genuine relative specifier as it would appear in a source file of the
  // given importer path; the classifier must resolve it and reject it.
  const forbidden: ReadonlyArray<[string, string, string]> = [
    ['src/storage/types.ts', '../reader/reader.js', 'storage → reader'],
    ['src/storage/types.ts', '../reader/index.js', 'storage → reader barrel'],
    ['src/storage/publication/index.ts', '../../reader/fs.js', 'storage → reader fs module'],
    ['src/storage/locks/lock.ts', '../../git/inspect.js', 'storage → Git inspection'],
    ['src/storage/read/read-record.ts', '../../fff/discovery.js', 'storage → FFF/internal discovery'],
    ['src/storage/audit/write-audit.ts', '../../fff/rank.js', 'storage → FFF deep relative'],
    ['src/reader/reader.ts', '../storage/types.js', 'reader → storage'],
    ['src/git/git.ts', '../storage/locks/lock.js', 'Git inspection → storage'],
    ['src/fff/discovery.ts', '../storage/read/read-record.js', 'FFF → storage'],
    ['src/reader/reader.ts', '../storage/index.js', 'reader → storage barrel'],
    // Path-traversal normalization: a nested relative chain that collapses
    // into a WP-7 tree after consuming importer-directory components.
    ['src/storage/publication/index.ts', './x/../../../reader/fs.js', 'traversal normalization'],
    // Multiline syntax and aliased bindings: the parser must surface the
    // specifier regardless of formatting or aliasing.
    ['src/storage/types.ts', '../reader/fs.js', 'aliased binding form'],
  ];
  for (const [importer, specifier, label] of forbidden) {
    const edge = classifyWp7StorageEdge(importer, specifier);
    assert.equal(edge, 'forbidden', `${label}: expected forbidden for ${importer} → ${specifier}`);
  }
  // Export-from forms (plain and aliased) are parsed declarations and must
  // classify identically.
  const exportFrom = classifyWp7StorageEdge('src/storage/types.ts', '../reader/fs.js');
  assert.equal(exportFrom, 'forbidden');
  // Allowed controls: storage → storage, storage → approved canonical/JSON/
  // trusted-configuration modules, and WP-7 internal imports within its own
  // approved tree.
  const allowed: ReadonlyArray<[string, string, string]> = [
    ['src/storage/types.ts', '../types.js', 'storage → storage'],
    ['src/storage/format/envelope.ts', '../../canonical/jcs.js', 'storage → canonical'],
    ['src/storage/format/envelope.ts', '../../json/scanner.js', 'storage → JSON scanner'],
    ['src/storage/trusted-input/bootstrap-input.ts', '../../trusted/configuration-brand.js', 'storage → trusted configuration brand'],
    ['src/reader/reader.ts', './reader.js', 'WP-7 internal import within its own tree'],
    ['src/git/git.ts', '../reader/reader.js', 'WP-7 sibling tree import (allowed by the predicate)'],
  ];
  for (const [importer, specifier, label] of allowed) {
    const edge = classifyWp7StorageEdge(importer, specifier);
    assert.equal(edge, 'allowed', `${label}: expected allowed for ${importer} → ${specifier}`);
  }
  // Bare module names keep the committed predicate behavior.
  assert.equal(classifyWp7StorageEdge('src/storage/types.ts', 'reader'), 'forbidden');
  assert.equal(classifyWp7StorageEdge('src/reader/reader.ts', 'storage/types.js'), 'forbidden');
  assert.equal(classifyWp7StorageEdge('src/storage/types.ts', 'node:fs'), 'allowed');
  // Out-of-root resolution is rejected (never resolved into an arbitrary path).
  assert.equal(resolveRelativeSpecifier('src/storage/types.ts', '../../../../outside.js'), undefined);
  // The resolver maps project-standard .js specifiers to the .ts source and
  // normalizes `.`/`..`/separators.
  assert.equal(resolveRelativeSpecifier('src/storage/types.ts', './x/../types.js'), 'src/storage/types.ts');
  assert.equal(resolveRelativeSpecifier('src/storage/types.ts', './format/taxonomy.js'), 'src/storage/format/taxonomy.ts');
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
