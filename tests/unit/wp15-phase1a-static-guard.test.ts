/**
 * WP-15 Phase 1A — static authority-boundary guards (updated for Phase 1B).
 *
 * Proves the Phase 1A surface does NOT introduce:
 *   - a `receipt-publication-correlation-producer` implementation
 *     (Phase 2 NOT STARTED);
 *   - a new generic lifecycle writer or a new outcome authority domain;
 *   - realtime receipt issuance or prospective authority.
 *
 * Phase 1B (authorized) adds the `trusted-receipt-producer` authority
 * family under `src/receipt-production/**`; this guard now scopes the
 * receipt-producer vocabulary to that family and keeps every other surface
 * clean. Phase 2 (authorized) adds the
 * `receipt-publication-correlation-producer` family under
 * `src/receipt-publication-correlation/**`; the correlation vocabulary is
 * scoped to that family. The lifecycle verifier stays a pure evaluation
 * surface: `src/lifecycle/**` remains filesystem-free, store-write-free,
 * capability-free, and authority-free. The WP-13 outcome families keep
 * zero receipt vocabulary. Superseded untracked WP-13D debris is NOT
 * walked and is excluded by construction (clean-clone evidence per the
 * WP-15 contract §18).
 *
 * Future files added under the guarded directories are automatically
 * covered (the directories are walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');

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

// ─── 1. no unexpected correlation-producer source family exists; the Phase 1B
//      receipt-production family and the Phase 2 correlation family are the
//      ONLY receipt authority families ─────────────────────────────────────
test('phase1a guard: no unexpected correlation-producer source family exists; receipt authority confined to src/receipt-production and src/receipt-publication-correlation', () => {
  const src = join(REPO, 'src');
  const entries = readdirSync(src).sort();
  for (const name of entries) {
    const full = join(src, name);
    if (!statSync(full).isDirectory()) continue;
    if (name === 'receipt-production') continue; // Phase 1B authorized family
    if (name === 'receipt-publication-correlation') continue; // Phase 2 authorized family
    assert.ok(
      !/^(trusted-)?receipt|receipt-|correlation/.test(name),
      `unexpected authority-family directory src/${name} — receipt authority lives ONLY in src/receipt-production and src/receipt-publication-correlation`,
    );
  }
  // the correlation-producer vocabulary is confined to the Phase 2 family;
  // the receipt-producer role vocabulary is confined to the Phase 1B family
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'retrospective') continue; // superseded untracked debris — excluded by construction
        if (name === 'generated') continue; // schema/corpus bundle mirrors committed schema data, not implementation
        walk(full);
      } else if (name.endsWith('.ts')) {
        const content = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/[^\n]*/g, ' ');
        const isCorrelationFamily = full.startsWith(join(src, 'receipt-publication-correlation'));
        if (!isCorrelationFamily) {
          assert.ok(!content.includes('receipt-publication-correlation-producer'), `${rel(full)} carries receipt-publication-correlation-producer outside the Phase 2 correlation family`);
        }
        const isReceiptFamily = full.startsWith(join(src, 'receipt-production'));
        if (!isReceiptFamily && !isCorrelationFamily) {
          // Consumer-side exception (WP-15 Phase 2, SIR-WP15-P2-B-001): the
          // point-of-use PUB-005 verifier must NAME the committed receipt
          // producer role to verify it on the correlation receipt — a
          // consumer verification surface, never an authority family.
          const isPub005Consumer = full === join(src, 'pointofuse', 'evaluate.ts');
          if (!isPub005Consumer) {
            assert.ok(!content.includes('trusted-receipt-producer'), `${rel(full)} carries trusted-receipt-producer outside the Phase 1B receipt-production family`);
          }
        }
      }
    }
  };
  walk(src);
});

// ─── 2. lifecycle verifier stays pure and authority-free ─────────────────────
test('phase1a guard: lifecycle verifier surface is pure (no store/authority/fs)', () => {
  const lifecycleFiles = collectTsFiles(join(REPO, 'src', 'lifecycle'));
  assert.ok(lifecycleFiles.length >= 2, 'the lifecycle verifier family must exist');
  for (const file of lifecycleFiles) {
    const content = readFileSync(file, 'utf8');
    for (const token of ['node:fs', 'node:crypto', 'publishRecord', 'withLock', 'newRecordId', 'newEvidenceId', 'nowUtcIso', 'createExecutionOutcomeCapability', 'createResultPublicationCapability', 'createOutcomeStoreBoundary', 'createPublicationStoreBoundary']) {
      assert.ok(!content.includes(token), `${rel(file)} must not contain ${token} — the lifecycle verifier never writes, locks, or mints authority`);
    }
  }
  // the graph module's import surface is closed (pure evaluation only)
  const graph = readFileSync(join(REPO, 'src', 'lifecycle', 'graph.ts'), 'utf8');
  for (const imp of ["from '../storage/", "from '../outcome", "from '../publication", "from '../control-plane", "from '../execution", "from '../completion"]) {
    assert.ok(!graph.includes(imp), `graph.ts must not import ${imp}`);
  }
});

// ─── 3. WP-13 outcome/publication families carry zero receipt vocabulary ────
test('phase1a guard: outcome and publication families carry no receipt vocabulary', () => {
  // hard prohibition: no receipt vocabulary at all in the outcome/derivation families
  for (const dir of ['outcome-production', 'outcome', 'retrospective-derivation']) {
    const files = collectTsFiles(join(REPO, 'src', dir));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const token of ['TrustedReceipt', 'trusted-receipt-producer', 'receipt_correlations']) {
        assert.ok(!content.includes(token), `${rel(file)} must not contain ${token} — receipt vocabulary is WP-15-owned and NOT in this family`);
      }
    }
  }
  // execution/completion never produce or store receipts (boundary comments are fine)
  for (const dir of ['execution', 'completion']) {
    const files = collectTsFiles(join(REPO, 'src', dir));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const token of ['trusted-receipt-producer', 'receipt_correlations', "record_type: 'TrustedReceipt'", 'TrustedReceiptRecord']) {
        assert.ok(!content.includes(token), `${rel(file)} must not contain ${token} — execution/completion never issue or store receipts`);
      }
    }
  }
  // the WP-13C publication family keeps its committed fixed empty
  // receipt_correlations surface but never touches TrustedReceipt records.
  const publicationFiles = collectTsFiles(join(REPO, 'src', 'publication'));
  for (const file of publicationFiles) {
    const content = readFileSync(file, 'utf8');
    for (const token of ['TrustedReceipt', 'trusted-receipt-producer']) {
      assert.ok(!content.includes(token), `${rel(file)} must not contain ${token} — WP-13C publication is not a receipt producer`);
    }
  }
});

// ─── 4. no new outcome authority domain; single outcome producer stays ──────
test('phase1a guard: the existing trusted-execution-outcome-recorder remains the only outcome producer', () => {
  // the outcome-production decision core + new-outcome branch are the ONLY
  // modules that construct/publish ExecutionOutcomeRecord payloads; the
  // lifecycle verifier never constructs records.
  const lifecycleFiles = collectTsFiles(join(REPO, 'src', 'lifecycle'));
  for (const file of lifecycleFiles) {
    const content = readFileSync(file, 'utf8');
    assert.ok(!content.includes("record_type: 'ExecutionOutcomeRecord'"), `${rel(file)} must never construct outcome records`);
    assert.ok(!content.includes("record_type: 'TrustedReceipt'"), `${rel(file)} must never construct receipt records`);
  }
});
