/**
 * WP-15 Phase 2 — receipt/publication correlation static guards (§37/§38).
 *
 * Proves the module family (src/receipt-publication-correlation/**):
 *   - is filesystem-free and network/process/timer-free (no node:fs,
 *     node:crypto, process.env, Date.now, Math.random, timers);
 *   - the ONLY WP-8 surface of the family is store.ts (publishRecord +
 *     readRecord + enumerateClass + envelope/digest/layout vocabulary);
 *     no other module imports the storage publication/read/layout surface
 *     and no raw publishRecord handle is exported anywhere;
 *   - identity/time sources (`nowUtcIso`, `newRecordId`) are INVOKED only
 *     from the authority decision core; replay/conflict/denial paths never
 *     allocate;
 *   - §38 reuse: the authority imports the COMMITTED shared retrospective
 *     path (`src/retrospective-derivation`), the Phase 1A exact-outcome and
 *     source-binding primitives (`src/lifecycle`), and the committed
 *     lifecycle schema validator; NO second derivation engine exists under
 *     the family (no resolver/facts/derivation module, no redefinition of
 *     the S4/Phase 1A vocabulary);
 *   - §37 authority isolation: the family never imports or receives the
 *     WP-13C publication capability, the Phase 1B receipt capability,
 *     execution authority, the RuntimeGrant issuer, approval/issuance
 *     authority, a generic registry writer, or a generic lifecycle store
 *     writer; the read allowlist contains NO runtime-grant and none of the
 *     excluded classes (approval/issuance/summary/migration/audit); no
 *     TrustedReceipt write surface exists; no Phase 3/release vocabulary;
 *   - the capability mint is confined to produce.ts and the TWO permit
 *     mints to authority.ts; the family barrel and the package root export
 *     no brand/permit internals;
 *   - schema-role separation: the produced records use the committed schema
 *     role constants (`trusted-result-publisher`,
 *     `trusted-lifecycle-authority`) and the schema role vocabulary is
 *     never changed to the capability identity; the WP-13 taxonomy
 *     inventory (`src/storage/format/taxonomy.ts`) is untouched.
 *
 * Future files added under src/receipt-publication-correlation/** are
 * automatically covered (the directory is walked at guard runtime). These
 * guards are regression tripwires; the branded runtime checks (capability
 * brand, permit brand, sink confinement) remain the real authority defense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const CORRELATION_SRC = join(REPO, 'src', 'receipt-publication-correlation');

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

const correlationFiles = collectTsFiles(CORRELATION_SRC);
assert.ok(correlationFiles.length >= 6, 'the correlation source tree must exist');

/** Strip comments so honest prose never trips the guards; imports and code are scanned verbatim. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

const ALL_SRC = collectTsFiles(join(REPO, 'src'));

// ─── 1. purity ──────────────────────────────────────────────────────────────
test('correlation static guard: filesystem-free; no network/process/timer/env surface; no crypto', () => {
  for (const file of correlationFiles) {
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
test('correlation static guard: the ONLY WP-8 surface is store.ts; no raw publisher or generic lifecycle writer anywhere in the family', () => {
  for (const file of correlationFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    for (const forbidden of ['publishLifecycleRecord', 'executeSlice1Command', 'recordValidation', 'decideActivation', 'issueRuntimeGrant', 'publishValidatedResult']) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
    if (base === 'store.ts') {
      // store.ts owns the single WP-8 publication/read surface.
      assert.ok(content.includes('publishRecord'), 'store.ts must wrap publishRecord');
      assert.ok(content.includes('readRecord'), 'store.ts must wrap readRecord');
      assert.ok(content.includes('enumerateClass'), 'store.ts must wrap enumerateClass');
    } else {
      // Outside store.ts the family may touch ONLY the digest/type storage
      // vocabulary; every raw WP-8 surface is forbidden.
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
      ]) {
        assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
      }
    }
  }
  // The family barrel never exposes a raw publish surface.
  const barrel = codeOf(join(CORRELATION_SRC, 'index.ts'));
  for (const forbidden of ['publishRecord', 'publishLifecycleRecord', 'publishSuccessorPublication', 'publishSupersession', 'readLifecyclePayload', 'enumerateLifecycleRecords']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/receipt-publication-correlation/index.ts`);
  }
});

// ─── 3. identity/time invocation confinement (authority core only) ──────────
test('correlation static guard: identity/time sources invoked ONLY from the authority decision core', () => {
  for (const file of correlationFiles) {
    const content = codeOf(file);
    const base = file.split('/').pop() ?? '';
    if (base === 'authority.ts' || base === 'types.ts') continue;
    for (const name of ['newRecordId', 'nowUtcIso']) {
      assert.ok(!content.includes(`${name}(`), `${name}( invocation outside authority.ts (found in ${rel(file)})`);
      assert.ok(!content.includes(`${name}'](`), `${name}']( bracket invocation outside authority.ts (found in ${rel(file)})`);
    }
  }
  const authority = codeOf(join(CORRELATION_SRC, 'authority.ts'));
  assert.ok(authority.includes("newRecordId'](") && authority.includes("nowUtcIso']("), 'the authority core must own the identity/time invocations');
  assert.ok(authority.includes('createCorrelationPublicationPermit'), 'authority.ts must mint the successor permit');
  assert.ok(authority.includes('createCorrelationSupersessionPermit'), 'authority.ts must mint the supersession permit');
  assert.ok(!authority.includes('createReceiptPublicationCorrelationCapability'), 'authority.ts must never mint the capability');
});

// ─── 4. §38 retrospective-derivation + Phase 1A reuse guard ─────────────────
test('correlation static guard: §38 — the committed shared retrospective path and Phase 1A primitives are reused; no second derivation engine', () => {
  const authority = codeOf(join(CORRELATION_SRC, 'authority.ts'));
  assert.ok(authority.includes("from '../retrospective-derivation/index.js'"), 'authority.ts must import the committed retrospective-derivation barrel');
  assert.ok(authority.includes('deriveRetrospectiveFactsFromStore'), 'authority.ts must invoke the committed durable-state resolver + facts path');
  assert.ok(authority.includes("from '../lifecycle/retrospective-eligibility.js'"), 'authority.ts must import the Phase 1A exact-outcome semantics');
  assert.ok(authority.includes('resolveExactOutcome'), 'authority.ts must reuse the Phase 1A claimant-first exact outcome resolver');
  assert.ok(authority.includes("from '../lifecycle/graph.js'"), 'authority.ts must import the Phase 1A event-source binding semantics');
  assert.ok(authority.includes('receiptSourceBindingOk'), 'authority.ts must reuse the committed source-binding primitive');
  assert.ok(authority.includes('receiptEventDispositionOk'), 'authority.ts must reuse the committed event/disposition validator');
  assert.ok(authority.includes("from '../api/validate.js'"), 'authority.ts must reuse the committed lifecycle schema validator');
  // No new derivation family exists under receipt-publication-correlation.
  for (const file of correlationFiles) {
    const base = file.split('/').pop() ?? '';
    assert.ok(!/^(resolver|facts|derivation|retrospective)[^.]*\.ts$/.test(base), `correlation family must not define a derivation engine (${base})`);
    const content = codeOf(file);
    for (const forbidden of ['RETROSPECTIVE_FACTS_KEYS', 'ExecutionRetrospectiveFacts', 'resolveRetrospectiveDurableState', 'deriveExecutionRetrospectiveFacts(']) {
      assert.ok(!content.includes(forbidden), `${forbidden} must never be redefined in ${rel(file)}`);
    }
  }
});

// ─── 5. §37 authority isolation ─────────────────────────────────────────────
test('correlation static guard: §37 — no foreign authority capability, no execution/grant/approval/issuance surface, no TrustedReceipt write', () => {
  const forbiddenVocabulary = [
    'createResultPublicationCapability',
    'isGenuineResultPublicationCapability',
    'createResultPublicationPermit',
    'publishValidatedResult',
    'createPublicationStoreBoundary',
    'createPublicationOutcomePrecondition',
    'createTrustedReceiptCapability',
    'isGenuineTrustedReceiptCapability',
    'createTrustedReceiptPermit',
    'issueTrustedReceipt',
    'createReceiptStoreBoundary',
    'createExecutionOutcomeCapability',
    'produceExecutionOutcome',
    'issueRuntimeGrant',
    'decideActivation',
    'createOccurrence',
    'recordExecutionAttempt',
    'executeSlice1Command',
    'approve',
    'publishLifecycleRecord',
    'createWriteCapability',
  ];
  for (const file of correlationFiles) {
    const content = codeOf(file);
    for (const forbidden of forbiddenVocabulary) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
    for (const imp of [
      "from '../publication/",
      "from '../receipt-production/",
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

test('correlation static guard: §37 — read allowlist is the closed §3 set; no runtime-grant and none of the excluded classes', () => {
  const types = codeOf(join(CORRELATION_SRC, 'types.ts'));
  // The closed set is defined exactly once with the nine allowed classes.
  for (const cls of ['trusted-receipt', 'result-publication-record', 'supersession-record', 'validation-record', 'execution-outcome-record', 'execution-attempt-record', 'execution-occurrence-record', 'activation-record', 'revocation-record']) {
    assert.ok(types.includes(`'${cls}'`), `the closed read set must include ${cls}`);
  }
  for (const cls of ['approval-record', 'issuance-record', 'runtime-grant', 'execution-summary-record', 'migration-record', 'authoritative-audit-event']) {
    assert.ok(!types.includes(`'${cls}'`), `the closed read set must EXCLUDE ${cls}`);
  }
  // No family file may read/enumerate any class outside the closed set.
  const allowed = new Set(['trusted-receipt', 'result-publication-record', 'supersession-record', 'validation-record', 'execution-outcome-record', 'execution-attempt-record', 'execution-occurrence-record', 'activation-record', 'revocation-record']);
  for (const file of correlationFiles) {
    const content = codeOf(file);
    for (const cls of ['approval-record', 'issuance-record', 'runtime-grant', 'execution-summary-record', 'migration-record', 'authoritative-audit-event']) {
      assert.ok(!content.includes(`'${cls}'`), `${cls} must never appear in ${rel(file)}`);
    }
    // every readLifecyclePayload/enumerateLifecycleRecords call site in the
    // authority must use only allowed classes (spot-check the call classes)
    for (const m of content.matchAll(/enumerateLifecycleRecords\('([^']+)'\)/g)) {
      assert.ok(allowed.has(m[1]!), `enumerateLifecycleRecords('${m[1]}') outside the closed set in ${rel(file)}`);
    }
  }
  // The authority never constructs or publishes a TrustedReceipt.
  for (const file of correlationFiles) {
    const content = codeOf(file);
    assert.ok(!content.includes("record_type: 'TrustedReceipt'"), `TrustedReceipt construction in ${rel(file)}`);
    assert.ok(!content.includes('publishTrustedReceipt'), `publishTrustedReceipt surface in ${rel(file)}`);
  }
});

test('correlation static guard: §37 — no Phase 3/release vocabulary; no generic lifecycle-writer vocabulary', () => {
  for (const file of correlationFiles) {
    const content = codeOf(file);
    for (const forbidden of ['npm publish', 'release tag', 'GitHub Release', 'deploy', 'runbook', 'supported-lane', 'PI_LANE', 'pi-0.83.0', 'F-R1', 'registration-visibility']) {
      assert.ok(!content.includes(forbidden), `${forbidden} in ${rel(file)}`);
    }
  }
});

// ─── 6. mint-site confinement ───────────────────────────────────────────────
test('correlation static guard: capability mint confined to produce.ts; the TWO permit mints confined to authority.ts; brand private', () => {
  const capabilityMentions: string[] = [];
  const publicationPermitMentions: string[] = [];
  const supersessionPermitMentions: string[] = [];
  for (const file of ALL_SRC) {
    const content = codeOf(file);
    if (content.includes('createReceiptPublicationCorrelationCapability')) capabilityMentions.push(rel(file));
    if (content.includes('createCorrelationPublicationPermit')) publicationPermitMentions.push(rel(file));
    if (content.includes('createCorrelationSupersessionPermit')) supersessionPermitMentions.push(rel(file));
    // No other production module may import the correlation brand internals.
    if (content.includes('receipt-publication-correlation/internal/brand')) {
      assert.ok(
        rel(file).startsWith('src/receipt-publication-correlation/'),
        `${rel(file)} imports the private correlation brand — only the correlation family may`,
      );
    }
  }
  assert.deepEqual(
    capabilityMentions.sort(),
    ['src/receipt-publication-correlation/internal/brand.ts', 'src/receipt-publication-correlation/produce.ts'].sort(),
    'createReceiptPublicationCorrelationCapability must have EXACTLY ONE production mint site (produce.ts) outside the brand definition',
  );
  assert.deepEqual(
    publicationPermitMentions.sort(),
    ['src/receipt-publication-correlation/authority.ts', 'src/receipt-publication-correlation/internal/brand.ts'].sort(),
    'createCorrelationPublicationPermit must be minted ONLY by the authority decision core',
  );
  assert.deepEqual(
    supersessionPermitMentions.sort(),
    ['src/receipt-publication-correlation/authority.ts', 'src/receipt-publication-correlation/internal/brand.ts'].sort(),
    'createCorrelationSupersessionPermit must be minted ONLY by the authority decision core',
  );
  // adapters/runtime/root-barrel cannot mint or invoke correlation authority.
  for (const dir of ['adapters', 'runtime']) {
    for (const file of collectTsFiles(join(REPO, 'src', dir))) {
      const content = codeOf(file);
      for (const token of ['createReceiptPublicationCorrelationCapability', 'createCorrelationPublicationPermit', 'createCorrelationSupersessionPermit', 'correlateReceiptPublication']) {
        assert.ok(!content.includes(token), `${rel(file)} must not mint or invoke correlation authority — trusted local control-plane capability only`);
      }
    }
  }
  const rootBarrel = codeOf(join(REPO, 'src', 'index.ts'));
  for (const token of ['receipt-publication-correlation', 'correlateReceiptPublication', 'createReceiptPublicationCorrelationAuthority']) {
    assert.ok(!rootBarrel.includes(token), `src/index.ts must not export correlation authority — no public barrel export for Phase 2`);
  }
});

// ─── 7. barrel cleanliness + schema-role separation ─────────────────────────
test('correlation static guard: the barrel exposes the authority entry, composition, store factory, and closed vocabulary only', () => {
  const barrel = codeOf(join(CORRELATION_SRC, 'index.ts'));
  assert.ok(barrel.includes('correlateReceiptPublication'), 'the authority entry must be exported');
  assert.ok(barrel.includes('createReceiptPublicationCorrelationAuthority'), 'the host composition must be exported');
  assert.ok(barrel.includes('createCorrelationStoreBoundary'), 'the two-class store factory must be exported');
  for (const forbidden of ['createReceiptPublicationCorrelationCapability', 'createCorrelationPublicationPermit', 'createCorrelationSupersessionPermit', 'isGenuineCorrelationCapability', 'isGenuineCorrelationPublicationPermit', 'isGenuineCorrelationSupersessionPermit', 'correlationPermitLive', 'WeakSet', 'capabilityBrand', 'permitBrand']) {
    assert.ok(!barrel.includes(forbidden), `${forbidden} in src/receipt-publication-correlation/index.ts`);
  }
});

test('correlation static guard: §26 — schema roles stay committed; the capability identity is never a schema role', () => {
  const types = codeOf(join(CORRELATION_SRC, 'types.ts'));
  assert.ok(types.includes("CORRELATION_PUBLICATION_ROLE = 'trusted-result-publisher'"), 'the successor role must stay the committed publisher role');
  assert.ok(types.includes("CORRELATION_SUPERSESSION_ROLE = 'trusted-lifecycle-authority'"), 'the supersession role must stay the committed lifecycle-authority role');
  assert.ok(types.includes("CORRELATION_PRODUCER_CAPABILITY_IDENTITY = 'receipt-publication-correlation-producer'"), 'the capability identity must be distinct');
  // The produced payloads bind the SCHEMA roles, never the capability identity.
  const authority = codeOf(join(CORRELATION_SRC, 'authority.ts'));
  assert.ok(authority.includes('responsible_role: CORRELATION_PUBLICATION_ROLE'), 'the successor payload must carry the schema publisher role');
  assert.ok(authority.includes('responsible_role: CORRELATION_SUPERSESSION_ROLE'), 'the supersession payload must carry the schema lifecycle-authority role');
  // The WP-13 taxonomy inventory (components.json-equivalent) is untouched.
  const taxonomy = codeOf(join(REPO, 'src', 'storage', 'format', 'taxonomy.ts'));
  assert.ok(taxonomy.includes("producer: 'trusted result publisher'"), 'the taxonomy inventory must retain the committed publisher producer');
  assert.ok(taxonomy.includes("producer: 'trusted lifecycle authority'"), 'the taxonomy inventory must retain the committed lifecycle-authority producer');
  for (const token of ['receipt-publication-correlation-producer', 'trusted-receipt-producer']) {
    assert.ok(!taxonomy.includes(token), `the taxonomy inventory must not carry the ${token} capability identity as a role`);
  }
});

// ─── 8. point-of-use PUB-005 strengthening pin ──────────────────────────────
test('correlation static guard: the point-of-use PUB-005 verifier carries the exact-correlation + currentness strengthening (WP-15 §16/§36)', () => {
  const evaluate = codeOf(join(REPO, 'src', 'pointofuse', 'evaluate.ts'));
  assert.ok(evaluate.includes('pointofuse.privileged-without-receipt'), 'the no-correlation finding must remain');
  assert.ok(evaluate.includes("event_type']) !== 'result-publication-correlation'") || evaluate.includes("event_type') !== 'result-publication-correlation'"), 'the exact event-type check must exist');
  assert.ok(evaluate.includes("disposition']) !== 'completed'") || evaluate.includes("disposition') !== 'completed'"), 'the exact disposition check must exist');
  assert.ok(evaluate.includes('pointofuse.privileged-not-current'), 'the currentness finding must exist');
  assert.ok(evaluate.includes('pointofuse.privileged-superseded'), 'the superseded finding must exist');
  assert.ok(evaluate.includes('pointofuse.privileged-supersession-divergent'), 'the divergent/corrupt/multiple supersession finding must exist');
  assert.ok(evaluate.includes("responsible_role') !== 'trusted-receipt-producer'") || evaluate.includes("responsible_role']) !== 'trusted-receipt-producer'"), 'the receipt producer-role check must exist');
  assert.ok(evaluate.includes('attestedCandidate'), 'the attested predecessor resolution must exist');
  assert.ok(evaluate.includes('jcsSerialize(attestedSubject)'), 'the exact result-subject identity check must exist (revision/digest conflation impossible)');
  assert.ok(evaluate.includes('supersessionLinkFor'), 'the claimant-first supersession resolution must exist');
});

test('correlation static guard: SIR-WP15-P2-A-001 — exactly ONE narrow S4 ambiguity continuation; the tolerated set is predecessor + one same-result claimant', () => {
  const authority = codeOf(join(CORRELATION_SRC, 'authority.ts'));
  assert.ok(authority.includes("facts.code === 'state.publication-ambiguous'"), 'the S4 ambiguity continuation must exist');
  assert.ok(authority.includes("predecessors.length !== 1"), 'the predecessor must be present exactly once in the tolerated set');
  assert.ok(authority.includes("others.length !== 1"), 'exactly ONE other publication may share the ambiguity surface');
  assert.ok(authority.includes("str(otherSubject, 'instance_id') !== str(predecessorSubject, 'instance_id')"), 'the single other publication must claim the exact same result instance');
  // material exactness is delegated to the single successor-material resolver
  const occurrences = authority.split('resolveSuccessor(').length - 1;
  assert.ok(occurrences >= 2, 'resolveSuccessor must remain the single successor-material resolver');
  // the committed S4 resolver is NOT modified
  const s4 = codeOf(join(REPO, 'src', 'retrospective-derivation', 'resolver.ts'));
  assert.ok(s4.includes('state.publication-ambiguous'), 'the committed S4 resolver keeps its single-publication ambiguity signal');
});
