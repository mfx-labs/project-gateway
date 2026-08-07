# WP-8-H — Persistent Registry Index, Rebuild, and Stale Detection — Implementation Report

**Status:** WP-8-H — the persistent, rebuildable registry index derived
exclusively from verified immutable storage records and audit state — is
implemented under the authorized scope: one canonical immutable index
snapshot per derived state under `index/registry-index/<shard>/<indexId>.idx`
(ADR-031; contract 5.2 `index/`, CSA-003/004, ITG-005, RGY-001/007,
WPR-009), the `registry-index-rebuild` recovery operation with exact-record
permit publication, deterministic stale detection, the opt-in registry fast
path, recovery-scanner classification of index artifacts, a fixed 8-stage
crash inventory, and one normative contract amendment (`indexBytes` limit +
ADR-031). All changes are left unstaged and uncommitted; nothing was pushed,
tagged, released, published, installed, or deployed. Implementation
acceptance is not yet granted.

**Verdict:** `WP-8H PERSISTENT REGISTRY INDEX: READY FOR REVIEW`

---

## 1. Baseline and Changed-Path Inventory

| Item | Value |
|---|---|
| Baseline HEAD | `0a1d48cf93ba98e899e9312512b85f35dd41c328` (`feat: add WP-8-G audit reconstruction`) |
| Contract | **modified by this slice**: the 19.1 limits table gains the single `indexBytes` row (ADR-031); SHA-256 updated to `87f0683992928d5114dff10b8329bdbab53cc18a425a7eaccb9243823cd01bee` in the static guard |
| Dependencies | unchanged (`ajv@8.20.0` only) |
| Public exports | unchanged; `src/index.ts` and package exports unchanged |

Modified (21):

- `docs/specs/wp-8-local-storage-registry-contract.md` — the one normative
  amendment: `indexBytes` limit row (ADR-031).
- `src/storage/types.ts` — index-artifact observation/classification types,
  assessment bucket (`indexArtifacts`, `indexMissing`), scan-bounds
  `indexByteLimit`, foreign-observation `shard`/`surface` fields, temp
  `indexContent`, plan categories (`registry-index-rebuild`,
  `index-object`), mutation action category + registry tokens,
  `trustedInput` on the mutation request, outcome `rebuilt`, `indexId`,
  6 new crash stages, `usePersistentIndex`/`indexState` on the registry
  view request/result.
- `src/storage/limits/limits.ts` — `indexBytes` limit definition.
- `src/storage/layout/layout.ts` — `deriveRegistryIndexRelativePath` and the
  index family constants.
- `src/storage/registry/compose.ts` — `runRegistrySnapshotScan` and the
  opt-in fast path in `deriveRegistryView`.
- `src/storage/recovery/scan.ts` — recovery-mode index-surface scan with
  deterministic classification, index structure in the recovery-mode
  surface token, temp `indexContent` detection, observation-id helpers,
  foreign shard/surface fields.
- `src/storage/recovery/assess.ts` — `indexArtifacts`/`indexMissing`
  classification and incomplete-index-temporary findings.
- `src/storage/recovery/plan.ts` — rebuild recommendations and index
  disposition actions.
- `src/storage/recovery/compose.ts` — `indexByteLimit` in recovery bounds.
- `src/storage/recovery/execute.ts` — `registry-index-rebuild` validation
  and the full rebuild flow.
- `src/storage/recovery/index.ts`, `src/storage/registry/index.ts` —
  private barrel exports.
- `src/storage/capabilities/authenticity.ts` — operation set,
  `registry-index` publication role and permit branch.
- `src/storage/locks/lock.ts` — lock operation vocabulary.
- `src/storage/publication/publish-record.ts` — the permit-bound sink's
  registry-index branch (parse/identity/digest validation, index family
  provisioning, ordinals 8).
- `tests/unit/storage/limits.test.ts`, `tests/unit/storage/recovery.test.ts`
  (plan semantics for the new rebuild recommendation),
  `tests/unit/storage/static-guard.test.ts` (allowlists, edges, vocabulary
  guards, contract hash), `tests/security/security.test.ts` (delegation set).
- `docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`
  — current-state wording only.

New (6):

- `src/storage/registry/index-model.ts` — the pure canonical index model
  (identity, roots, tuples, builder, parser, self-consistency, view/manifest
  reconstruction).
- `src/storage/registry/index-store.ts` — the read-only fs owner
  (descriptor index reads, readdir + lstat freshness probe, live
  validation).
- `src/storage/recovery/index-rebuild.ts` — the index publication builder
  (exact-record permit, fs-free).
- `docs/decisions/ADR-031-wp-8h-registry-index-rebuild.md`.
- `tests/unit/storage/registry-index.test.ts` (11 focused tests).
- `docs/reports/wp-8h-persistent-registry-index-implementation-report.md`
  (this report).

**Total: 21 modified + 6 new = 27 paths** (the earlier "28 / 7 new"
summary was inconsistent with the Git-derived inventory and is corrected
here).

## 2. Index Authority Model

The index is derived cache and grants nothing (RGY-010). Publication rides
the recovery capability with the exact operation `registry-index-rebuild`
(the contract's recovery duties include "rebuild indexes from source
records", 16.2) and an exact-record `RecoveryPublicationPermit` (role
`registry-index`) binding the genuine capability, the operation, the exact
index identity/digest/canonical-byte digest, and the internally derived
`index/registry-index/...` destination. The generic publication sink remains
write-authority-only; the recovery capability never reaches it; no capability
or provenance creator consumes index contents; a forged or caller-provided
index grants nothing (tested). Zero new production authority producers.

## 3. Canonical Index Model

One family, one snapshot per derived state: `index/registry-index/<shard4>/<indexId>.idx`
(36-char filename; layout 5.3 length arithmetic). Content:

- binding (store/namespace identities, generation, surface token, record
  root, audit root, observation root, scan bounds, index bounds, scan
  counters);
- the complete verified registry-mode observation set (records, audit
  events, and foreign entries at the records/audit surfaces) with bounded
  stat facts (the freshness manifest) and envelope/association facts — no
  raw paths, no payload bytes, no capability/provenance objects, no
  decisions;
- the structure-level scan findings and the scan facts.

The registry view is re-derived purely from the stored observations through
the existing derivation (`deriveRegistryViewFromScan`), so the fast path and
the authoritative path share one derivation (deep equivalence). Model
versioning: `REGISTRY_INDEX_MODEL_VERSION = '1'`; a semantic change bumps the
version; older versions are classified and trigger rebuild — no migration
machinery.

## 4. Deterministic Identity Inputs

`indexId` = domain digest (`PGAP-STORAGE-REGISTRY-INDEX-IDENTITY-v1`) over:
model version; verified trusted-parent identity and both namespace
identities; registry scan generation; registry structural surface
generation; record root (over verified records: class/id/revision/digest);
audit root (over verified audit events); observation root (over the full
canonical tuple set); scan entry/byte bounds and fail-closed flag;
`indexRebuildWork` and `indexBytes`; scanned-entry and scanned-byte
counters (bound so byte-identity and index identity cannot diverge). No
host enumeration order, clock, randomness, PID, raw path, or capability
identity enters. Same verified immutable state yields identical canonical
bytes (tested, including reversed observation input).

## 5. Persistence Layout

`index/` (a deferred top-level directory) + `index/registry-index/` +
`index/registry-index/<shard4>/` are provisioned lazily under the writer
lock with exact fixed-directory verification (no-follow, expected UID, exact
0700 mode, created parents fsynced in deterministic order). Filenames are
deterministically derived from the index identity only; no caller-supplied
destination; fixed UID/mode/type; bounded size (`indexBytes`); no symlink
traversal; no overwrite; no in-place mutation; no rename.

## 6. Publication Algorithm

Immutable hard-link no-replace publication through the shared substrate
(temporary in `tmp/` under the exact per-operation ordinal 8, write-all,
fsync, permit revalidation, `link(2)` no-replace, final-object identity and
nlink verification, final-directory fsync, own-temp unlink, `tmp/` fsync).
EEXIST replay is verified byte-exact (idempotent `already-completed`) or
fails closed as conflicting; identical existing bytes are idempotent;
directory durability is explicit; an index publication crash cannot corrupt
records or audits; incomplete index temporaries remain scanner-classifiable
and disposable.

## 7. Stale Detection

At fast-path open: canonical form, model version, store identity, registry
generation, registry surface token, self-consistency (identity re-digest,
record/audit/observation roots over the stored entries), UID/mode/type/size,
and the live entry-set probe (readdir + no-follow lstat over the records/
audit surfaces mirrored exactly from the scan walk). Classification
vocabulary: `current-valid`, `missing`, `malformed`,
`unsupported-version`, `stale-generation`, `stale-surface`,
`stale-record-set`, `stale-audit-state`, `conflicting-index`,
`wrong-type`, `wrong-uid-or-mode`, `foreign-index-entry`, `unreadable`.
A stale index is a rebuild candidate, never a storage failure; a conflicting
index at the derived identity requires disposition (rebuild collides; index
deletion stays out of scope). The recovery scanner classifies every index
artifact against the current state (registry-mode tokens + roots) and the
advisory plan recommends rebuild.

## 8. Rebuild Flow

1. genuine trusted recovery request + genuine branded trusted bootstrap
   input + store revalidation + recovery capability;
2. registry-mode generation recomputation against the request binding;
3. complete verified registry snapshot scan WITHOUT the writer lock;
4. deterministic index build (rejects truncated scans, unresolved
   continuations, and every bound overflow);
5. pre-lock surface recheck;
6. writer-lock acquisition (publication phase only);
7. under-lock recheck: generation, registry surface, and the live entry-set
   probe against the built manifest — any change since the scan fails
   closed as a stale build (never publish an index for an old snapshot);
8. derived-path existence check (byte-exact → `already-completed`;
   conflicting → fail closed);
9. exact permit publication; 10. durability confirmation; 11. capability
   and root revalidation; 12. lock release; 13. reopen and verify the
   published index (form, self-consistency, store identity, generation and
   surface tokens; the entry probe is intentionally excluded at reopen — a
   legitimate write after release makes the index stale for the fast path,
   not a publication failure).

## 9. Fast-Path Equivalence

`deriveRegistryView({ usePersistentIndex: true })` validates the index
against the CURRENT store; a current-valid index serves the view re-derived
from its stored observations with the stored scan facts — deep-equivalent to
the authoritative derivation for the same immutable state (tested:
`recordsByClass`, `recordsByIdentity`, `latestResolvableRevision`,
`auditByPrimary`, `missingAudit`, `danglingAudit`, `duplicateConflicts`,
`findings`, generation/surface). Any invalidity falls back to the
authoritative scan with the deterministic `indexState` reported; a corrupted
index never masks authoritative store errors (tested with a corrupted
record).

## 10. Bounds

`indexRebuildWork` (entries) bounds the indexed observation count, identity
groups, conflicts, associations, and represented findings; the new
`indexBytes` limit (ADR-031) bounds the canonical snapshot bytes. Every
bound fails the build deterministically (`ERR-STO-LIMIT-EXCEEDED`); an
over-bound store never produces a partial index and the authoritative scan
remains fully usable (tested). Parsing caps arrays at the
`indexRebuildWork` hard maximum.

## 11. Crash Model

Fixed 8-stage inventory (asserted): `before-lock-acquisition`,
`after-lock-acquisition`, `after-generation-recheck`,
`before-index-publication`, `after-index-publication`,
`before-directory-durability`, `after-directory-durability`,
`before-lock-release`. After every injected crash: the authoritative store
is untouched, the state is scanner-classifiable, the rerun completes
(rebuild or `already-completed`, never a second index for the same state),
the published index validates as current, and a held crash lock is never
automatically broken (fixture release, matching the WP-8-F harness).

## 12. Security-Boundary Changes

One new read-only fs owner (`registry/index-store.ts`; allowlist:
`readdirSync`, `lstatSync`, `openSync`, `closeSync`, `fstatSync`,
`readFileSync`, `constants`; no mutating API). The pure index model and the
index-rebuild builder are fs-free; no rename/copy/delete/chmod-chown repair,
subprocess, or network; no dynamic/default/namespace fs imports; no
package-root index-authority exports; no index → capability/provenance
dependency (guarded). The permit creator edge gains the index-rebuild
builder; the permit-bound sink validates the index role/identity/digest and
the gap-free canonical form.

## 13. Tests and Exact Counts

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | pass |
| Build | `npm run build` | pass |
| Test TS compilation | `npx tsc -p tsconfig.tests.json` | pass |
| Focused registry-index | `node --test dist-test/tests/unit/storage/registry-index.test.js` | **11 tests, 11 pass, 0 fail** |
| Registry/recovery | `node --test dist-test/tests/unit/storage/registry.test.js dist-test/tests/unit/storage/recovery.test.js` | **41 tests, 41 pass, 0 fail** |
| Complete storage suite | `node --test "dist-test/tests/unit/storage/*.test.js"` | **302 tests, 300 pass, 2 skipped** (pre-existing privilege-gated chown tests), 0 fail |
| Static guard | `node --test dist-test/tests/unit/storage/static-guard.test.js` | **24 tests, 24 pass, 0 fail** |
| Global security | `node --test dist-test/tests/security/security.test.js` | **15 tests, 15 pass, 0 fail** |
| Crash suites | recovery-mutation (10-stage), quarantine (15-stage), audit-reconstruction (12-stage), registry-index (8-stage) | all pass within the storage suite |
| Default workflow | `npm test` | **1357/1358 pass; 1 pre-existing environment-pinned failure** (pi-adapter harness expects Pi `0.83.0`, installed `0.84.1`; reproduced identically on the baseline — accepted per WP-8H §17) |
| WP-7 regression | `node scripts/run-wp7-tests.mjs` | **165/165 pass** |
| Contract-hash audit | static guard (pinned SHA-256) | pass |
| `git diff --check` | — | clean |

## 14. Contract Ambiguity / Recorded Assumptions

1. **Contract 10.4 step 4 ("update the derived index only after record
   publication")** is realized as the authorized rebuild, not a per-write
   index publication: the write path never touches the index; a write makes
   the index stale, the fast path detects it and falls back, and the
   rebuild refreshes it. WPR-009/CSA-003/ITG-005 tolerate exactly this, and
   per-write full-store rebuilds would be a severe regression. Recorded in
   ADR-031.
2. **Freshness proof** uses the readdir + lstat entry-set probe; content
   tampering with identical names and stat facts requires store write
   access and is out of the MVP trust anchor (TML-002), exactly as for the
   authoritative scan.
3. **`indexBytes`** is the single normative limits amendment (ADR-031); no
   other contract change was required (the `index/` layout was already
   normative in 5.2).
4. **Reopen verification** (rebuild §9.11) excludes the entry-set probe by
   design (a write after lock release makes the index legitimately stale
   for the fast path).

## 15. Remaining WP-8 Build Work

Stale-lock breaking with lock-recovery evidence; primary/audit deletion;
WPR-023 (d) and other external-disposition paths; quarantine-object
disposition; index deletion/disposition (conflicting-index state); full
audit-history inspection; configuration-namespace recovery; retention;
legal holds; migration; lifecycle approval decisions; WP-12 integration;
WP-9 generation seeding.

## 16. Git State

All changes are unstaged and uncommitted (`git status` shows the modified
and untracked paths of §1 only). Nothing was pushed, tagged, released,
published, installed, or deployed. The next gate is the WP-8-F/WP-8-G/
WP-8-H implementation review.
