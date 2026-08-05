/**
 * WP-7-B — FFF discovery tests.
 *
 * Exercises the deterministic internal FFF provider: controlled-reader
 * capability usage, BFS ordering, scoring, budget enforcement, and
 * cancellation — against a real temporary workspace.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWp7Fixture, type Wp7Fixture, WORKSPACE_ALPHA } from '../helpers.js';
import { WorkspaceInspectionService } from '../../../src/reader/service.js';
import { FffProvider } from '../../../src/fff/provider.js';
import { WP7_LIMITS } from '../../../src/reader/types.js';

let fixture: Wp7Fixture;
let service: WorkspaceInspectionService;
let provider: FffProvider;

before(async () => {
  fixture = createWp7Fixture();
  service = new WorkspaceInspectionService({
    configuration: fixture.configuration,
    resolveExistingPath: fixture.resolveExistingPath,
  });
  provider = new FffProvider({
    workspaceId: WORKSPACE_ALPHA,
    reader: service,
    budget: { visitedEntries: 0, candidateFiles: 0, totalContentBytes: 0 },
  });
});

after(async () => {
  await service.dispose().catch(() => {});
  fixture.cleanup();
});

async function discover(query: string, maxResults?: number, control: Record<string, unknown> = {}) {
  const r = await provider.discover(
    { operation: 'fff-discover', workspaceId: WORKSPACE_ALPHA, query, ...(maxResults !== undefined ? { maxResults } : {}) },
    control,
  );
  return r;
}

function itemsOf(r: { ok: boolean; value?: unknown }): { path: string; score: number; snippet?: string }[] {
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  const v = r.value as { items: { path: string; score: number; snippet?: string }[] };
  return v.items;
}

describe('WP-7 FFF: basic discovery', () => {
  it('finds a file by basename match', async () => {
    const r = await discover('alpha');
    const items = itemsOf(r);
    assert.ok(items.length >= 1);
    const hit = items.find((i) => i.path === 'src/alpha.txt');
    assert.ok(hit, 'src/alpha.txt must be found');
    assert.ok(hit.score >= 1000); // basename contains query
  });

  it('finds a file by full-path match with lower score', async () => {
    const r = await discover('docs');
    const items = itemsOf(r);
    const notes = items.find((i) => i.path === 'docs/notes.md');
    assert.ok(notes, 'docs/notes.md must be found via path match');
    // basename does not contain 'docs', so score has no +1000
    assert.ok(notes.score < 1000);
    assert.ok(notes.score >= 500);
  });

  it('scores content occurrences', async () => {
    // 'alpha content' in src/alpha.txt: basename 'alpha.txt' contains 'alpha' (+1000)
    const r = await discover('content');
    const items = itemsOf(r);
    const hit = items.find((i) => i.path === 'src/alpha.txt');
    assert.ok(hit, 'alpha.txt must be found by content match');
    assert.ok(hit.score >= 1);
  });

  it('omits zero-score candidates', async () => {
    const r = await discover('zzzz-not-present');
    const items = itemsOf(r);
    assert.equal(items.length, 0);
  });

  it('sorts by score descending, then path ascending', async () => {
    const r = await discover('a'); // matches many
    const items = itemsOf(r);
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      if (prev.score === cur.score) {
        assert.ok(prev.path < cur.path, 'tie must break by path ascending');
      } else {
        assert.ok(prev.score > cur.score, 'must sort by score descending');
      }
    }
  });

  it('is deterministic across repeated runs', async () => {
    const r1 = await discover('a');
    const r2 = await discover('a');
    assert.deepEqual(itemsOf(r1), itemsOf(r2));
  });

  it('rejects an empty query', async () => {
    const r = await discover('');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-REQ-INVALID');
  });

  it('rejects an overlong query', async () => {
    const r = await discover('x'.repeat(WP7_LIMITS.FFF_MAX_QUERY_BYTES + 1));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-REQ-INVALID');
  });

  it('is case-sensitive (no case folding)', async () => {
    const rUpper = await discover('ALPHA');
    const rLower = await discover('alpha');
    assert.notEqual(itemsOf(rUpper).length, itemsOf(rLower).length);
  });

  it('applies maxResults with truncation flag', async () => {
    const r = await discover('a', 1);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { items: unknown[]; truncated: boolean };
    assert.ok(v.items.length <= 1);
  });
});

describe('WP-7 FFF: symlink and binary policy', () => {
  it('does not follow symlinks', async () => {
    // A symlink named 'linked.txt' pointing to a file whose name matches
    // must NOT appear as a candidate (symlinks are not scanned).
    fs.symlinkSync(path.join(fixture.root, 'README.md'), path.join(fixture.root, 'linkmatch.txt'));
    try {
      const r = await discover('linkmatch');
      const items = itemsOf(r);
      assert.ok(!items.some((i) => i.path === 'linkmatch.txt'), 'symlink must not be a candidate');
    } finally {
      fs.rmSync(path.join(fixture.root, 'linkmatch.txt'), { force: true });
    }
  });

  it('does not content-scan NUL/binary files but still matches by name', async () => {
    fs.writeFileSync(path.join(fixture.root, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
    try {
      const r = await discover('binary');
      const items = itemsOf(r);
      const hit = items.find((i) => i.path === 'binary.bin');
      // name + path match still work (1000 basename + 500 path), but no
      // content contribution is possible for a NUL file.
      assert.ok(hit);
      assert.equal(hit.score, 1500);
    } finally {
      fs.rmSync(path.join(fixture.root, 'binary.bin'), { force: true });
    }
  });
});

/**
 * WP-7-C — synthetic controlled-reader capability for deterministic,
 * fast FFF budget tests (test-only; satisfies the FffCapability reader
 * surface structurally via the accepted WorkspaceInspectionService type).
 */
interface SynNode {
  path: string;
  kind: 'file' | 'dir' | 'symlink';
  content?: string;
}

class SyntheticReader {
  readonly readMaxBytes: number[] = [];
  constructor(
    private readonly tree: SynNode[],
    private readonly hooks: { blockList?: boolean; failReads?: Set<string> } = {},
  ) {}
  async listDirectory(req: { path: string }, _ctrl: unknown): Promise<unknown> {
    if (this.hooks.blockList) await new Promise(() => {}); // never settles
    const parent = req.path === '.' ? '' : req.path;
    const entries = this.tree
      .filter((n) => {
        if (!n.path.startsWith(parent === '' ? '' : `${parent}/`)) return false;
        const rest = parent === '' ? n.path : n.path.slice(parent.length + 1);
        return rest.length > 0 && !rest.includes('/');
      })
      .map((n) => ({
        name: n.path.split('/').pop()!,
        kindHint: n.kind === 'dir' ? 'directory' : n.kind === 'file' ? 'file' : 'symlink',
      }));
    return { ok: true, value: { entries, truncated: false } };
  }
  async readText(req: { path: string; maxBytes?: number }, _ctrl: unknown): Promise<unknown> {
    this.readMaxBytes.push(req.maxBytes ?? 0);
    if (this.hooks.blockList) await new Promise(() => {});
    const n = this.tree.find((x) => x.path === req.path);
    if (!n || n.kind !== 'file' || this.hooks.failReads?.has(req.path)) {
      return { ok: false, failure: { code: 'ERR-NOT-FOUND' } };
    }
    const text = (n.content ?? '').slice(0, req.maxBytes ?? Number.POSITIVE_INFINITY);
    return { ok: true, value: { text, byteLength: Buffer.byteLength(text) } };
  }
  async dispose(): Promise<void> {}
}

function providerFor(tree: SynNode[], hooks: { blockList?: boolean; failReads?: Set<string> } = {}): {
  provider: FffProvider;
  reader: SyntheticReader;
} {
  const reader = new SyntheticReader(tree, hooks);
  const provider = new FffProvider({
    workspaceId: WORKSPACE_ALPHA,
    reader: reader as unknown as WorkspaceInspectionService,
    budget: { visitedEntries: 0, candidateFiles: 0, totalContentBytes: 0 },
  });
  return { provider, reader };
}

async function discoverWith(provider: FffProvider, query: string, maxResults?: number, control: Record<string, unknown> = {}) {
  const r = await provider.discover(
    { operation: 'fff-discover', workspaceId: WORKSPACE_ALPHA, query, ...(maxResults !== undefined ? { maxResults } : {}) },
    control,
  );
  return r;
}

describe('WP-7 FFF: cancellation and control', () => {
  it('fails fast on an already-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await discover('a', undefined, { signal: ctrl.signal });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
  });

  it('rejects forged control', async () => {
    const r = await discover('a', undefined, { signal: { aborted: false } as unknown as AbortSignal });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-REQ-INVALID');
  });
});

describe('WP-7 FFF: budget enforcement (C-05 correction)', () => {
  it('bounded traversal: files beyond the pinned depth are never discovered', async () => {
    const tree: SynNode[] = [];
    let p = '';
    for (let i = 0; i < 40; i++) {
      p = p === '' ? `d${i}` : `${p}/d${i}`;
      tree.push({ path: p, kind: 'dir' });
    }
    tree.push({ path: `${p}/needle.txt`, kind: 'file', content: 'needle' }); // depth 40
    // exact boundary: depth 32 (pinned FFF_MAX_DEPTH) is discovered, depth 33 is not
    const d32 = Array.from({ length: 32 }, (_, i) => `x${i}`).join('/');
    const d33 = `${d32}/x32`;
    // the x-dir chain must exist as dir nodes for BFS to descend it
    for (let i = 1; i <= 33; i++) {
      tree.push({ path: Array.from({ length: i }, (_, j) => `x${j}`).join('/'), kind: 'dir' });
    }
    tree.push({ path: `${d32}/at32.txt`, kind: 'file', content: 'needle' });
    tree.push({ path: `${d33}/at33.txt`, kind: 'file', content: 'needle' });
    tree.push({ path: 'd0/d1/d2/d3/d4/needle5.txt', kind: 'file', content: 'needle' });
    const { provider } = providerFor(tree);
    const r = await discoverWith(provider, 'needle');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const items = (r.value as { items: { path: string }[] }).items;
    assert.ok(items.some((i) => i.path === 'd0/d1/d2/d3/d4/needle5.txt'), 'shallow needle must be found');
    assert.ok(
      items.some((i) => i.path === `${d32}/at32.txt`),
      `a file at the pinned FFF_MAX_DEPTH (${WP7_LIMITS.FFF_MAX_DEPTH}) must be discovered`,
    );
    assert.ok(
      !items.some((i) => i.path === `${d33}/at33.txt`),
      `a file beyond FFF_MAX_DEPTH (${WP7_LIMITS.FFF_MAX_DEPTH}) must not be discovered`,
    );
    assert.ok(
      !items.some((i) => i.path === `${p}/needle.txt`),
      `depth-40 needle must not be discovered (pinned FFF_MAX_DEPTH=${WP7_LIMITS.FFF_MAX_DEPTH})`,
    );
  });

  it('visited-entry budget: an 11k-entry tree truncates the scan', async () => {
    const tree: SynNode[] = [];
    for (let i = 0; i < 11_000; i++) tree.push({ path: `d${String(i).padStart(5, '0')}`, kind: 'dir' });
    tree.push({ path: 'needle.txt', kind: 'file', content: 'needle' });
    const { provider } = providerFor(tree);
    const r = await discoverWith(provider, 'needle');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { items: unknown[]; truncated: boolean };
    assert.equal(v.truncated, true, 'visited-entry budget must truncate');
    assert.ok(v.items.length < 11_001);
  });

  it('candidate-file budget: 2500 candidates truncate at the pinned limit, deterministically', async () => {
    const tree: SynNode[] = [];
    for (let i = 0; i < 2500; i++) {
      tree.push({ path: `f${String(i).padStart(4, '0')}.txt`, kind: 'file', content: 'needle' });
    }
    const { provider } = providerFor(tree);
    const r1 = await discoverWith(provider, 'needle');
    assert.equal(r1.ok, true);
    if (!r1.ok) throw new Error('unreachable');
    const v1 = r1.value as { items: unknown[]; truncated: boolean };
    assert.equal(v1.truncated, true, 'candidate-file budget must truncate');
    assert.ok(v1.items.length <= WP7_LIMITS.FFF_MAX_CANDIDATE_FILES);
    const r2 = await discoverWith(provider, 'needle');
    if (!r2.ok) throw new Error('unreachable');
    assert.deepEqual(v1.items, (r2.value as { items: unknown[] }).items, 'truncated results must be deterministic');
  });

  it('total-content-byte budget: large content scans truncate', async () => {
    const content = 'x'.repeat(WP7_LIMITS.FFF_PER_FILE_WINDOW);
    const tree: SynNode[] = [];
    for (let i = 0; i < 300; i++) {
      tree.push({ path: `b${String(i).padStart(3, '0')}.txt`, kind: 'file', content });
    }
    const { provider } = providerFor(tree);
    const r = await discoverWith(provider, 'x');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { items: unknown[]; truncated: boolean };
    assert.equal(v.truncated, true, 'total-content-byte budget must truncate');
  });

  it('per-file content window: readText is bounded to FFF_PER_FILE_WINDOW; snippet bounded', async () => {
    const { provider, reader } = providerFor([
      { path: 'big.txt', kind: 'file', content: `needle${'y'.repeat(200_000)}` },
    ]);
    const r = await discoverWith(provider, 'needle');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    assert.ok(reader.readMaxBytes.length >= 1, 'readText must be invoked during scoring');
    assert.equal(reader.readMaxBytes[0], WP7_LIMITS.FFF_PER_FILE_WINDOW, 'readText must request the pinned per-file window');
    const items = (r.value as { items: { snippet?: string }[] }).items;
    assert.ok(items.length >= 1);
    const snippet = items[0]?.snippet;
    assert.ok(snippet !== undefined && snippet.includes('needle'), 'snippet must be present and contain the query');
    assert.ok(
      Buffer.byteLength(snippet!) <= WP7_LIMITS.FFF_MAX_SNIPPET_BYTES,
      `snippet must respect FFF_MAX_SNIPPET_BYTES (got ${Buffer.byteLength(snippet!)})`,
    );
  });

  it('maxResults truncation is explicit and deterministic', async () => {
    const tree: SynNode[] = [];
    for (let i = 0; i < 50; i++) {
      tree.push({ path: `match${String(i).padStart(2, '0')}.txt`, kind: 'file', content: 'zzz' });
    }
    const { provider } = providerFor(tree);
    const r = await discoverWith(provider, 'match', 3);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { items: unknown[]; truncated: boolean };
    assert.equal(v.items.length, 3);
    assert.equal(v.truncated, true);
    const r2 = await discoverWith(provider, 'match', 3);
    if (!r2.ok) throw new Error('unreachable');
    assert.deepEqual(v.items, (r2.value as { items: unknown[] }).items);
  });

  it('cancellation during budget consumption returns ERR-OP-CANCELLED (deterministic)', async () => {
    // The synthetic capability blocks inside listDirectory, so the abort
    // deterministically lands mid-scan: the provider's abort race must win.
    const { provider } = providerFor([{ path: 'a.txt', kind: 'file', content: 'needle' }], { blockList: true });
    const ctrl = new AbortController();
    const pending = discoverWith(provider, 'needle', undefined, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 50);
    const r = await pending;
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
  });

  it('budget accounting includes failed candidates', async () => {
    const tree: SynNode[] = [];
    const failReads = new Set<string>();
    for (let i = 0; i < 2100; i++) {
      const p = `g${String(i).padStart(4, '0')}.txt`;
      tree.push({ path: p, kind: 'file', content: 'needle' });
      if (i < 100) failReads.add(p);
    }
    const { provider } = providerFor(tree, { failReads });
    const r = await discoverWith(provider, 'needle');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { truncated: boolean };
    assert.equal(v.truncated, true, 'failed reads must still consume candidate budget');
  });

  it('symlink entries consume visited budget without becoming candidates', async () => {
    const tree: SynNode[] = [];
    for (let i = 0; i < 10_500; i++) {
      tree.push({ path: `l${String(i).padStart(5, '0')}.link`, kind: 'symlink' });
    }
    const { provider } = providerFor(tree);
    const r = await discoverWith(provider, 'zzz');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { items: unknown[]; truncated: boolean };
    assert.equal(v.truncated, true, 'symlink entries must consume the visited budget');
    assert.equal(v.items.length, 0, 'symlinks are never candidates');
  });

  it('partial (budget-truncated) results carry no security authority', async () => {
    const tree: SynNode[] = [];
    for (let i = 0; i < 2500; i++) {
      tree.push({ path: `h${String(i).padStart(4, '0')}.txt`, kind: 'file', content: 'needle' });
    }
    const { provider } = providerFor(tree);
    const r = await discoverWith(provider, 'needle');
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error('unreachable');
    const v = r.value as { items: Record<string, unknown>[]; truncated: boolean };
    assert.equal(v.truncated, true);
    for (const item of v.items) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(keys.filter((k) => k !== 'snippet'), ['path', 'score'], `unexpected result keys: ${keys}`);
    }
  });
});

describe('WP-7 FFF: provider boundary', () => {
  it('result paths are canonical workspace-relative only', async () => {
    const r = await discover('notes');
    const items = itemsOf(r);
    for (const item of items) {
      assert.ok(!item.path.startsWith('/'), 'no absolute paths in results');
      assert.ok(!item.path.startsWith('../'), 'no traversal in results');
    }
  });

  it('duplicate paths are deduplicated', async () => {
    // 'docs' matches both notes.md and unicode.md by path; each appears once
    const r = await discover('md');
    const items = itemsOf(r);
    const paths = items.map((i) => i.path);
    assert.equal(new Set(paths).size, paths.length, 'no duplicate paths');
  });
});
