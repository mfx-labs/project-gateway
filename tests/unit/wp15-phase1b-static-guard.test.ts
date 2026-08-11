/**
 * WP-15 Phase 1B — trusted receipt production static guards (§23/§24).
 *
 * Proves the module family (src/receipt-production/**):
 *   - is filesystem-free and network/process/timer-free (no node:fs,
 *     node:crypto, process.env, Date.now, Math.random, timers);
 *   - the ONLY WP-8 surface of the family is store.ts (publishRecord +
 *     readRecord + enumerateClass + envelope/digest/layout vocabulary);
 *     no other module imports the storage/read/publication/layout surface
 *     and no raw publishRecord handle is exported anywhere;
 *   - identity/time sources (`nowUtcIso`, `newRecordId`) are INVOKED only
 *     from the authority decision core (dot-call AND bracket-call
 *     spellings); replay/conflict/denial paths never allocate (§13);
 *   - §23 retrospective-derivation reuse: the authority imports the
 *     COMMITTED shared retrospective resolver/facts path
 *     (`src/retrospective-derivation`); no new derivation family exists
 *     under receipt-production; no receipt-specific duplicate derivation
 *     engine (no redefinition of exact-outcome resolution or fact
 *     derivation vocabulary);
 *   - §24 authority isolation: the family never imports or receives the
 *     WP-13C publication capability, the receipt-publication-correlation
 *     capability, execution authority, the RuntimeGrant issuer,
 *     approval/issuance authority, a generic registry writer, or a generic
 *     lifecycle store writer; execution/completion/adapters/runtime/barrel
 *     surfaces cannot mint or import the private receipt authority brand;
 *   - the capability mint is confined to produce.ts (the trusted host
 *     composition) and the permit mint to authority.ts (the decision
 *     core); the family barrel exposes no brand/permit internals.
 *
 * Future files added under src/receipt-production/** are automatically
 * covered (the directory is walked at guard runtime). These guards are
 * regression tripwires; the branded runtime checks (capability brand,
 * permit brand, sink confinement) remain the real authority defense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const RECEIPT_SRC = join(REPO, 'src', 'receipt-production');

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

const receiptFiles = collectTsFiles(RECEIPT_SRC);
assert.ok(receiptFiles.length >= 5, 'the receipt-production source tree must exist');

/** Strip comments so honest prose never trips the guards; imports and code are scanned verbatim. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

const ALL_SRC = collectTsFiles(join(REPO, 'src'));

// ─── 1. purity ──────────────────────────────────────────────────────────────
test('receipt-production static guard: filesystem-free; no network/process/timer/env surface; no crypto', () => {
  for (const file of receiptFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      'node:fs',
      "from 'fs'",
      "require('fs')",
      'fs/promises',
      'node:net',
      'node:http',
      'node:https',
      'node:tls',
      'node:dgram',
      'node:child_process',
      'child_process',
      'spawn(',
      'exec(',
      'fetch(',
      'WebSocket',
      'process.env',
      'Date.now(',
      'Math.random',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'process.nextTick',
      'node:crypto',
      'createHash(',
    ]) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

// ─── 2. single WP-8 store surface (store.ts only) ───────────────────────────
test('receipt-production static guard: the ONLY WP-8 surface is store.ts; no raw publisher or lifecycle writer anywhere in the family', () => {
  for (const file of receiptFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    for (const forbidden of ['publishLifecycleRecord', 'executeSlice1Command', 'recordValidation', 'decideActivation', 'issueRuntimeGrant']) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
    if (base === 'store.ts') {
      // store.ts owns the single WP-8 publication/read surface.
      assert.ok(content.includes('publishRecord'), 'store.ts must wrap publishRecord');
      assert.ok(content.includes('readRecord'), 'store.ts must wrap readRecord');
      assert.ok(content.includes('enumerateClass'), 'store.ts must wrap enumerateClass');
    } else {
      // Outside store.ts the family may touch ONLY the digest/type storage
      // vocabulary (the envelope digest + type imports, exactly as the
      // WP-13C/S3 discipline); every raw WP-8 surface is forbidden.
      for (const forbidden of [
        'publishRecord',
        'readRecord',
        'enumerateClass',
        "from '../storage/publication/",
        "from '../storage/read/",
        "from '../storage/layout/",
        "from '../storage/format/taxonomy.js'",
        "from '../storage/capabilities/",
        "from '../storage/trusted-input/",
        "from '../storage/locks/",
        "from '../storage/registry/",
        "from '../storage'\u0027",
      ]) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    }
  }
  // The family barrel never exposes a raw publish surface.
  const barrel = codeOf(join(RECEIPT_SRC, 'index.ts'));
  for (const forbidden of ['publishRecord', 'publishLifecycleRecord', 'publishTrustedReceipt', 'readLifecyclePayload', 'enumerateLifecycleRecords']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/receipt-production/index.ts`);
  }
});

// ─── 3. identity/time invocation confinement (authority core only) ──────────
test('receipt-production static guard: identity/time sources invoked ONLY from the authority decision core', () => {
  for (const file of receiptFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'authority.ts' || base === 'types.ts') continue;
    for (const name of ['newRecordId', 'nowUtcIso']) {
      assert.ok(!content.includes(`${name}(`), `${name}( invocation outside authority.ts (found in ${rel(file)})`);
      assert.ok(!content.includes(`${name}'](`), `${name}']( bracket invocation outside authority.ts (found in ${rel(file)})`);
      assert.ok(!content.includes(`${name}'?.(`), `${name}'?.( optional bracket invocation outside authority.ts (found in ${rel(file)})`);
    }
  }
  const authority = codeOf(join(RECEIPT_SRC, 'authority.ts'));
  assert.ok(authority.includes("newRecordId'](") && authority.includes("nowUtcIso']("), 'the authority core must own the identity/time invocations');
  // The authority itself never mints the capability or the permit outside
  // the decision flow: the permit mint is authority-owned (immediately
  // before the write), the capability mint is composition-owned.
  assert.ok(authority.includes('createTrustedReceiptPermit'), 'authority.ts must mint the exact-record permit');
  assert.ok(!authority.includes('createTrustedReceiptCapability'), 'authority.ts must never mint the capability');
});

// ─── 4. §23 retrospective-derivation reuse guard ────────────────────────────
test('receipt-production static guard: §23 — the committed shared retrospective path is reused; no second derivation engine', () => {
  // The authority imports the committed S4 family.
  const authority = codeOf(join(RECEIPT_SRC, 'authority.ts'));
  assert.ok(authority.includes("from '../retrospective-derivation/index.js'"), 'authority.ts must import the committed retrospective-derivation barrel');
  assert.ok(authority.includes('deriveRetrospectiveFactsFromStore'), 'authority.ts must invoke the committed durable-state resolver + facts path');
  assert.ok(authority.includes("from '../lifecycle/retrospective-eligibility.js'"), 'authority.ts must import the Phase 1A exact-outcome semantics');
  assert.ok(authority.includes('resolveExactOutcome'), 'authority.ts must reuse the Phase 1A claimant-first exact outcome resolver');
  // SIR-WP15-P1B-005: ONE disposition authority — the Phase 1A derivation is
  // imported; no receipt-specific disposition map exists in the family.
  assert.ok(authority.includes('deriveReceiptDisposition'), 'authority.ts must consume the Phase 1A authoritative disposition derivation');
  // No new derivation family exists under receipt-production (no
  // retrospective/derivation/resolver/facts engine files).
  for (const file of receiptFiles) {
    const base = file.split('/').pop() ?? '';
    assert.ok(!/^(resolver|facts|derivation|retrospective)[^.]*\.ts$/.test(base), `receipt-production must not define a derivation engine (${base})`);
    const content = codeOf(file);
    for (const forbidden of ['RETROSPECTIVE_FACTS_KEYS', 'ExecutionRetrospectiveFacts', 'resolveRetrospectiveDurableState', 'deriveExecutionRetrospectiveFacts(']) {
      assert.ok(!content.includes(forbidden), `${forbidden} must never be redefined in ${rel(file)}`);
    }
    // SIR-WP15-P1B-005 §23: no duplicate derivation map under receipt-production.
    assert.ok(!content.includes('deriveDisposition('), `a second disposition derivation must not exist in ${rel(file)}`);
  }
});

// ─── 5. §24 authority isolation ─────────────────────────────────────────────
test('receipt-production static guard: §24 — no foreign authority capability, no correlation/execution/grant/approval/issuance surface', () => {
  const forbiddenVocabulary = [
    'createResultPublicationCapability',
    'isGenuineResultPublicationCapability',
    'createResultPublicationPermit',
    'publishValidatedResult',
    'createPublicationStoreBoundary',
    'createPublicationOutcomePrecondition',
    'receipt-publication-correlation',
    'createExecutionOutcomeCapability',
    'isGenuineExecutionOutcomeCapability',
    'produceExecutionOutcome',
    'createExecutionOutcomeAuthority',
    'createExecutionOutcomePermit',
    'createOutcomeStoreBoundary',
    'issueRuntimeGrant',
    'decideActivation',
    'createOccurrence',
    'recordExecutionAttempt',
    'executeSlice1Command',
    'approve',
    'publishLifecycleRecord',
    'createWriteCapability',
    'SupersessionRecord',
  ];
  for (const file of receiptFiles) {
    const content = codeOf(file);
    for (const forbidden of forbiddenVocabulary) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
    // no import of the publication/outcome/execution/control-plane store families
    for (const imp of [
      "from '../publication/",
      "from '../outcome",
      "from '../execution",
      "from '../completion",
      "from '../control-plane/store-boundary.js'",
      "from '../adapters/",
    ]) {
      assert.ok(!content.includes(imp), `${imp} in ${rel(file)}`);
    }
  }
});

test('receipt-production static guard: §24 — the private receipt brand is confined; execution/completion/adapters/runtime/barrel cannot mint or import it', () => {
  // Production mentions of the capability mint: definition + composition only.
  const capabilityMentions: string[] = [];
  // Production mentions of the permit mint: definition + authority only.
  const permitMentions: string[] = [];
  for (const file of ALL_SRC) {
    const content = codeOf(file);
    if (content.includes('createTrustedReceiptCapability')) capabilityMentions.push(rel(file));
    if (content.includes('createTrustedReceiptPermit')) permitMentions.push(rel(file));
    // No other production module may import the receipt brand internals.
    if (content.includes("receipt-production/internal/brand")) {
      assert.ok(
        rel(file).startsWith('src/receipt-production/'),
        `${rel(file)} imports the private receipt brand — only the receipt-production family may`,
      );
    }
  }
  assert.deepEqual(
    capabilityMentions.sort(),
    ['src/receipt-production/internal/brand.ts', 'src/receipt-production/produce.ts'].sort(),
    'createTrustedReceiptCapability must have EXACTLY ONE production mint site (produce.ts) outside the brand definition',
  );
  assert.deepEqual(
    permitMentions.sort(),
    ['src/receipt-production/authority.ts', 'src/receipt-production/internal/brand.ts'].sort(),
    'createTrustedReceiptPermit must be minted ONLY by the authority decision core',
  );
  // execution/completion never issue or store receipts.
  for (const dir of ['execution', 'completion']) {
    for (const file of collectTsFiles(join(REPO, 'src', dir))) {
      const content = codeOf(file);
      for (const token of ['trusted-receipt-producer', 'receipt-production', 'TrustedReceipt']) {
        assert.ok(!content.includes(token), `${rel(file)} must not contain ${token} — execution/completion never touch receipt authority`);
      }
    }
  }
  // project-visible/MCP/Pi surfaces cannot mint receipt authority directly.
  for (const dir of ['adapters', 'runtime']) {
    for (const file of collectTsFiles(join(REPO, 'src', dir))) {
      const content = codeOf(file);
      for (const token of ['createTrustedReceiptCapability', 'createTrustedReceiptPermit', 'issueTrustedReceipt']) {
        assert.ok(!content.includes(token), `${rel(file)} must not mint or invoke receipt authority — trusted local control-plane capability only`);
      }
    }
  }
  const rootBarrel = codeOf(join(REPO, 'src', 'index.ts'));
  for (const token of ['receipt-production', 'issueTrustedReceipt', 'createReceiptProducerAuthority', 'TrustedReceipt']) {
    assert.ok(!rootBarrel.includes(token), `src/index.ts must not export receipt authority — no public barrel export for Phase 1B`);
  }
});

// ─── 6. barrel cleanliness + SIR-WP15-P1B-002 authority surface ─────────────
test('receipt-production static guard: the barrel exposes the authority entry, composition, store factory, and closed vocabulary only', () => {
  const barrel = codeOf(join(RECEIPT_SRC, 'index.ts'));
  assert.ok(barrel.includes('issueTrustedReceipt'), 'the authority entry must be exported');
  assert.ok(barrel.includes('createReceiptProducerAuthority'), 'the host composition must be exported');
  assert.ok(barrel.includes('createReceiptStoreBoundary'), 'the single-class store factory must be exported');
  for (const forbidden of ['createTrustedReceiptCapability', 'createTrustedReceiptPermit', 'isGenuineTrustedReceiptCapability', 'isGenuineTrustedReceiptPermit', 'trustedReceiptPermitLive', 'WeakSet', 'capabilityBrand', 'permitBrand', 'TRUSTED_RECEIPT_READ_CLASSES', 'ReceiptAuthorityInput']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/receipt-production/index.ts`);
  }
});

test('receipt-production static guard: SIR-P1B-002 — the authority surface accepts only ReceiptRequest; trusted context is host-closed', () => {
  const produce = codeOf(join(RECEIPT_SRC, 'produce.ts'));
  // The public authority method nominates ONLY a ReceiptRequest.
  assert.ok(produce.includes('issue(request: ReceiptRequest)'), 'produce.ts must expose issue(request: ReceiptRequest)');
  assert.ok(!produce.includes('issue(input: ReceiptInput)'), 'the authority surface must never accept a full trusted input');
  assert.ok(!produce.includes('issue({'), 'the authority surface must not accept per-call trusted-context operands');
  // The composition closes over the host-owned trusted infrastructure.
  for (const token of ['registryProvider', 'identity:', 'coordinate:', 'schemaRegistry', 'capability', 'hooks']) {
    assert.ok(produce.includes(token), `produce.ts must close over ${token}`);
  }
  // The capability mint stays confined to the composition; the permit mint to
  // the authority core.
  assert.ok(produce.includes('createTrustedReceiptCapability'), 'produce.ts is the ONE production capability mint site');
  assert.ok(!produce.includes('createTrustedReceiptPermit'), 'produce.ts must never mint a permit');
  const authority = codeOf(join(RECEIPT_SRC, 'authority.ts'));
  assert.ok(authority.includes('isBrandedRegistry'), 'the authority must verify registry genuineness through the committed brand primitive');
  assert.ok(authority.includes('snapshotJson'), 'the authority must capture the request through the committed hostile-input primitive');
});

// ─── 7. Phase 1A vocabulary regression ──────────────────────────────────────
test('receipt-production static guard: the family carries no Phase 2 vocabulary (successor/correlation transition)', () => {
  for (const file of receiptFiles) {
    const content = codeOf(file);
    for (const forbidden of ['receipt_correlations', 'successor', 'SupersessionRecord', 'privileged', 'authoritative-reporting', 'completion-status', 'downstream-automation', 'resume']) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});
