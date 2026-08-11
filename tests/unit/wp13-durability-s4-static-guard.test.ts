/**
 * WP-13 durability S4 — shared retrospective derivation static security
 * guards.
 *
 * Proves the module family (src/retrospective-derivation/**):
 *   - is clock-free and random-free (no `Date.now`, `new Date`,
 *     `performance.now`, `process.hrtime`, `Math.random`,
 *     `timestampSource`, timers);
 *   - contains NO canonical-byte/hash machinery for the fact-set (no
 *     `jcsSerialize`, no `node:crypto`/`createHash`, no digest imports)
 *     and NO retrospective fact-set content identity (the retired
 *     `PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1` domain token);
 *   - is write-free and authority-free: no WP-8/WP-12 publish path, no
 *     store-mutation boundary, no identity/time allocation
 *     (`newRecordId`/`newEvidenceId`/`nowUtcIso`), no coordination lock
 *     (`withLock`), no receipt vocabulary (WP-15), no
 *     scheduler/recovery/resume imports;
 *   - never imports the superseded WP-13D implementation
 *     (`src/retrospective/**`).
 *
 * Future files added under src/retrospective-derivation/** are
 * automatically covered (the directory is walked at guard runtime).
 * These guards are regression tripwires; the semantic-equality tests and
 * the fail-closed derivation tests remain the real behavioral defense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const S4_SRC = join(REPO, 'src', 'retrospective-derivation');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const s4Files = collectTsFiles(S4_SRC);
assert.ok(s4Files.length >= 4, 'the retrospective-derivation source tree must exist');

const FORBIDDEN_PATTERNS: readonly { readonly pattern: string; readonly reason: string }[] = [
  // clock / random / timers (derivation purity; SCR-WP13-001)
  { pattern: 'Date.now', reason: 'derivation must be timestamp-free' },
  { pattern: 'new Date(', reason: 'derivation must be timestamp-free' },
  { pattern: 'performance.now', reason: 'derivation must be timestamp-free' },
  { pattern: 'process.hrtime', reason: 'derivation must be timestamp-free' },
  { pattern: 'Math.random', reason: 'derivation must be random-free' },
  { pattern: 'timestampSource', reason: 'derivation must be timestamp-free' },
  { pattern: 'setTimeout', reason: 'no timers/scheduler primitives' },
  { pattern: 'setInterval', reason: 'no timers/scheduler primitives' },
  // canonical-byte / hash machinery for the fact-set (retired as normative)
  { pattern: 'jcsSerialize', reason: 'no canonical-byte serialization of the fact-set' },
  { pattern: 'node:crypto', reason: 'no fact-set hashing' },
  { pattern: 'createHash', reason: 'no fact-set hashing' },
  { pattern: "from '../digest", reason: 'no fact-set digest machinery' },
  { pattern: 'PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1', reason: 'the retrospective fact-set content identity is retired' },
  // writes / identity allocation / authority / locking
  { pattern: 'publishRecord', reason: 'the family is read-only' },
  { pattern: 'publishLifecycleRecord', reason: 'the family is read-only' },
  { pattern: 'publishExactOutcomeRecord', reason: 'the family is read-only' },
  { pattern: 'publishResultPublicationRecord', reason: 'the family is read-only' },
  { pattern: 'newRecordId', reason: 'no identity allocation' },
  { pattern: 'newEvidenceId', reason: 'no identity allocation' },
  { pattern: 'nowUtcIso', reason: 'no time source' },
  { pattern: 'withLock', reason: 'no coordination lock' },
  // WP-15 receipt vocabulary / recovery / superseded WP-13D
  { pattern: 'TrustedReceipt', reason: 'no receipt material (WP-15-owned)' },
  { pattern: "from '../retrospective/", reason: 'the superseded WP-13D implementation is never imported' },
];

test('S4 derivation family: no clock/random/timers/writes/identity/receipt/canonical-byte machinery', () => {
  for (const file of s4Files) {
    const text = readFileSync(file, 'utf8');
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      assert.equal(text.includes(pattern), false, `${rel(file)} must not contain ${JSON.stringify(pattern)} (${reason})`);
    }
  }
});

test('S4 derivation family: the resolver never imports the pure primitive\'s field vocabulary (single derivation owner)', () => {
  // The resolver must stay thin: it imports ONLY the primitive entry and
  // protocol-equality — never the facts vocabulary or any derivation internals.
  for (const file of s4Files.filter((f) => f.endsWith('resolver.ts'))) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes("from './facts.js'"), true, `${rel(file)} must invoke the shared primitive`);
  }
});

test('S4 barrel exports the shared primitive and the closed vocabulary only', () => {
  const barrel = readFileSync(join(S4_SRC, 'index.ts'), 'utf8');
  assert.equal(barrel.includes('deriveExecutionRetrospectiveFacts'), true, 'the shared primitive must be exported');
  assert.equal(barrel.includes('deriveRetrospectiveFactsFromStore'), true, 'the cold-restart entry must be exported');
  assert.equal(barrel.includes('RETROSPECTIVE_FACTS_KEYS'), true, 'the fixed 21-key vocabulary must be exported');
  assert.equal(barrel.includes('RETROSPECTIVE_DERIVATION_FAILURE_CATEGORIES'), true, 'the closed failure taxonomy must be exported');
});
