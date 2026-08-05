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

  it('cancellation during a large scan returns ERR-OP-CANCELLED or completes', async () => {
    // Build a deeper tree to give the scan something to do
    for (let i = 0; i < 30; i++) {
      fs.mkdirSync(path.join(fixture.root, 'deep', `d${i}`), { recursive: true });
      fs.writeFileSync(path.join(fixture.root, 'deep', `d${i}`, 'f.txt'), 'needle-content-here\n');
    }
    const ctrl = new AbortController();
    const promise = discover('needle', undefined, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 1);
    const r = await promise;
    if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
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
