# WP-8-D — Focused Implementation Rereview

**Review type:** adversarial, read-only focused rereview of the corrections
for MINOR-1, MINOR-2, and MINOR-3 from the WP-8-D senior implementation
security and architecture review
(`docs/reports/wp-8d-senior-implementation-security-and-architecture-review.md`).
No broad redesign review was performed.
**Primary input:** `docs/reports/wp-8d-focused-implementation-correction-report.md`.
**Independently checked:** the actual source and test corrections
(`src/storage/initialization/provision.ts`,
`tests/unit/storage/initialization.test.ts`,
`tests/unit/storage/static-guard.test.ts`), the amended implementation
report, the status documents, the authoritative contract (read in full,
SHA-256 `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`),
ADR-029, the decision-resolution report, the focused decision-package
rereview, the compiled `dist`/`dist-test` outputs, and the Git inventory.
Every count, state classification, resolution outcome, and test result was
re-derived independently; the previously-failing MINOR-2 case was
reproduced empirically against the corrected classifier. No file other
than this report was created or modified; nothing was staged or committed.

---

## 1. Baseline and Inventory

| Item | Expected | Verified |
|---|---|---|
| Repository / branch | `/home/chef/Documents/Project_Gateway_MCP` / `main` | exact |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact |
| Staging | empty | empty (zero staged entries; all changes unstaged ` M` / untracked `??`) |
| Commits after HEAD / tags | zero / zero | zero / zero |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` | exact (`sha256sum`; static-guard asserted) |
| Contract and ADRs | unchanged | unchanged (no diff against HEAD in `docs/specs/`, `docs/decisions/`) |
| `src/index.ts` / `package-lock.json` | unchanged | unchanged (zero diff) |
| Dependencies | `ajv@8.20.0` only | exact |
| Public exports | 42 | 42 (independent `dist/index.d.ts` audit) |
| Package exports | `"."`, `"./pi-adapter"` | exact |
| WP-9 work | none | none (`src/mcp`, `src/control-plane` absent; later-phase storage dirs absent) |
| Publication | none | none (no tags, no commits, no push) |

**Pre-rereview working-tree inventory: exactly 40 paths** (16 modified +
24 untracked; full `git status --porcelain -uall` enumeration), composed
of the 39-path post-implementation-review inventory plus the one new
correction report. After creating this report the complete inventory is
exactly **41 paths**.

**Focused correction delta: exactly 7 paths** — verified:
1. `src/storage/initialization/provision.ts` (modified source — MINOR-2);
2. `tests/unit/storage/initialization.test.ts` (modified test — MINOR-2);
3. `tests/unit/storage/static-guard.test.ts` (modified test — MINOR-3);
4. `docs/reports/wp-8d-implementation-report.md` (modified report — MINOR-1);
5. `docs/reports/wp-8d-focused-implementation-correction-report.md` (new correction report);
6. `docs/design/post-wp5a-roadmap.md` (modified status);
7. `docs/design/post-wp5a-planning-status.md` (modified status).

No other path changed. `src/storage/initialization/state.ts` was not
modified by the correction (the optional path was not required); its
working-tree state is unchanged from the previously reviewed WP-8-D
implementation.

**Governance fact (recorded exactly):**

`WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION`

The baseline commit `bd832606…` and its complete file manifest were not
independently verified; the commit is the operational baseline per human
direction. Nothing in this report claims independent verification of that
commit.

## 2. MINOR-1 — Count Correction

Independently recounted `test(` declarations per file (committed baseline
from `git show HEAD:<path>` vs current compiled `dist-test`):

| File | Committed | Current | Delta |
|---|---|---|---|
| audit.test.ts (new) | 0 | 5 | +5 |
| locks.test.ts (new) | 0 | 7 | +7 |
| publication.test.ts (new) | 0 | 11 | +11 |
| read.test.ts (new) | 0 | 6 | +6 |
| capabilities.test.ts | 6 | 14 | **+8** |
| initialization.test.ts | 14 | 23 | +9 (+5 WP-8-D, +4 state-D correction) |
| taxonomy.test.ts | 7 | 8 | +1 |
| static-guard.test.ts | 16 | 20 | +4 (+3 WP-8-D, +1 SCP-005 correction) |
| trusted-input.test.ts | 7 | 10 | +3 |
| configuration/envelope/errors/identifier/layout/limits/metadata/probe/root | unchanged | unchanged | 0 |
| **Storage suite totals** | **148** | **202** | **+54** |

Verified arithmetic:
- new test-file contribution: 11 + 7 + 6 + 5 = **29**;
- original WP-8-D modified-test contribution: capabilities +8,
  initialization +5, taxonomy +1, static guard +3, trusted input +3 =
  **20**;
- complete original WP-8-D delta: **29 + 20 = 49**;
- storage baseline reconciliation: **148 + 49 = 197**;
- correction delta: +4 (state-D) + 1 (SCP-005 adversarial) = +5 →
  **197 + 5 = 202** — matches the executed suite twice.

Searches of the entire implementation report: **no stale `+7`** (zero
hits); §2 item 23 now reads `capabilities.test.ts (+8 tests; committed 6 →
current 14)`; §14's defective parenthetical is replaced by the verified
component arithmetic (`29 + 8 + 5 + 1 + 3 + 3 = 49` and `148 + 49 = 197`)
with the superseded-test-rewrite note. No incorrect subtraction/addition
and no contradictory suite counts remain; the correction report's
`197 → 202 = +5` reconciliation is exact.

**MINOR-1: CLOSED.** (Bounded terminology note: the implementation
report's §14 "single skip" sentence describes the pre-correction 197-test
snapshot, which had exactly one skip; the correction report reconciles the
current two-skips state. Snapshot-accurate, no contradiction — NOTE-1.)

## 3. MINOR-2 — Source Inspection

`classifyNamespace` now verifies **every present fixed entry** before any
PROVISIONAL/INITIALIZED outcome, via the new
`verifyFixedEntryObject(path, serviceUid)`:

- **No-follow, directory-only open:** `openSync(path, O_RDONLY |
  O_DIRECTORY | O_NOFOLLOW)` — a symlink final component fails `ELOOP`;
  a regular file or special object fails the directory open
  (`ENOTDIR`/`EINVAL`); the path-based authority check is the descriptor
  `fstat`, never a path-following `stat`.
- **Directory type, configured UID, exact mode `0700`:** `fstatSync(fd)` +
  the committed `verifyDirectoryStat` predicate (directory type, owner UID,
  exact mode with group/other bits zero). Wrong type, wrong UID, or wrong
  mode → fail-closed state D.
- **Descriptor lifecycle:** every opened descriptor is closed in a
  `finally` on success and error paths (code-verified).
- **Deterministic native-error mapping:** `ENOENT` (entry listed by
  `readdir` but disappeared before the open) → `foreign-entry` (state D,
  FOREIGN); `ELOOP`/`ENOTDIR`/`EACCES`/`EPERM`/`ENAMETOOLONG`/`EINVAL` →
  `foreign-entry` (state D); any other unverifiable condition →
  `drifted-entry` (IDENTITY_DRIFTED). This mirrors the committed
  root-level vocabulary (`classifyNamespaceOpenError`: EACCES/EPERM →
  foreign, EIO → drifted), so permission failures are distinguished from
  identity drift exactly as the accepted state vocabulary does — an
  inaccessible-but-present entry fails closed as FOREIGN, an
  unverifiable/uncertain one as IDENTITY_DRIFTED; neither can reach
  PROVISIONAL/INITIALIZED.
- **No new `ERR-STO-*` code:** the markers `foreign-entry`/`drifted-entry`
  are internal classifier markers mapped to the existing aggregate states;
  the runtime ERR-STO count in `provision.ts` is unchanged (5 at HEAD, 5
  now; the single added `ERR-STO` text occurrence is a comment stating
  "never an ERR-STO-* code").
- **No repair or mutation:** verification is read-only; no chown, chmod,
  deletion, replacement, or adoption anywhere in the classifier.

The verification loop runs after the unknown-name check and before the
missing-entry branches, so no wrong fixed-entry object can reach
PROVISIONAL or INITIALIZED.

## 4. MINOR-2 — Empirical State-D Results (independently reproduced)

Executed against the corrected compiled classifier with genuine
capability/trusted-input fixtures:

| Case | Result |
|---|---|
| Regular file at `records` (the original failing case) | **FOREIGN** (previously PROVISIONAL) |
| Symlink at `tmp` (no-follow) | **FOREIGN** |
| Wrong mode (`locks` 0644) | **FOREIGN** |
| Wrong UID (privilege-gated; predicate identical to the synthetic tests) | FOREIGN via `verifyDirectoryStat` |
| Valid partial phase-3 set (`metadata,tmp,records`) | PROVISIONAL (retryable) |
| Exact valid five-entry set | INITIALIZED |
| Deferred `index` entry | FOREIGN |
| Entry disappearance (helper on absent path) | `foreign-entry` → FOREIGN |

No wrong fixed-entry object classifies PROVISIONAL or INITIALIZED.

## 5. MINOR-2 — Concurrency and Race Safety

- **Disappearance after `readdir`:** open fails `ENOENT` → FOREIGN
  (fail closed; verified via the helper).
- **Replacement with a symlink:** `ELOOP` on the no-follow open → FOREIGN.
- **Replacement with a regular file:** `ENOTDIR`/type failure → FOREIGN.
- **Replacement with another valid directory:** passes name + policy
  verification; the classifier is read-only and grants no authority, and
  subsequent provisioning (`ensureFixedDirectory` / class-shard creation)
  performs its own independent descriptor verification — a same-UID
  replacement is outside the accepted guarantee (TML) and the accepted
  identity model does not require entry-level identity capture. No unsafe
  outcome; no new cross-path identity design is required.
- **Partial entries from concurrent provisioning:** remain PROVISIONAL
  (missing-only-phase-3 branch, no unknowns, present entries valid);
  deterministic retry completes only the exact missing entries.
- **No classifier mutation occurs** (read-only); provisioning idempotency
  and its own descriptor verification are unchanged.

## 6. MINOR-2 — Test Adequacy

The four new state-D tests genuinely reach the classifier through the real
pipeline: `classifierEnv()` constructs a genuine branded
`TrustedStorageBootstrapInput` (real WP-6 brand + genuine action
provenance), a genuine initialization capability, and a real temporary
namespace; every test asserts the classifier's state, and setup failures
would throw (the `seed` helper rethrows non-EEXIST errors) rather than
silently pass. The wrong-UID test attempts the actual `chownSync(…,
12345, 12345)` and calls `t.skip` only when the chown **throws**; it does
not preemptively skip by UID or environment variable (source-verified).
Deterministic synthetic wrong-UID coverage exists in the committed
stat-policy tests (`tests/unit/storage/root.test.ts`:
`verifyDirectoryStat(syntheticStat({ uid: UID + 1 }), UID)` and
`uid: 424242` cases) — the classifier reuses that exact predicate.

Focused initialization reconciliation: **23 total / 21 pass / 2 skips /
0 fail** — reproduced. The two skips are (a) the committed pre-existing
W8C-S03 wrong-UID test and (b) the new state-D wrong-UID variant; both are
chown-privilege-gated, both actively attempt the chown first, neither is
forced.

**MINOR-2: CLOSED.**

## 7. MINOR-3 — Relative-Resolution Algorithm

`resolveRelativeSpecifier(importerRelPath, specifier)` (pure, exported,
independently exercised):

- resolves relative specifiers against the **importing source module's
  directory** (`importerRelPath` up to the last `/`);
- lexically normalizes separators, `.` and `..` (a `..` on an empty stack,
  or a result that does not start with `src/`, returns `undefined` —
  out-of-root resolution is rejected, never resolved into an arbitrary
  path);
- maps project-standard `.js` source specifiers to `.ts` targets;
  extensionless and `.ts` specifiers pass through normalized;
- trailing-directory `index.ts` mapping: present as a branch but
  unreachable (the split loop strips trailing empty parts) — bounded
  dead code with **no predicate impact**, because directory imports still
  classify correctly through tree-prefix matching (`../reader/` →
  `src/reader` → forbidden) — NOTE-2;
- returns a normalized repo-relative identity (`src/…`) used by the
  predicate.

Out-of-root failure cannot mask a forbidden edge: every forbidden tree
(`src/reader`, `src/git`, `src/fff`) lives under `src/`, so an unresolvable
specifier can never represent a WP-7 edge. Verified behaviors:
`../reader/fs.js` → `src/reader/fs.ts` (forbidden); extensionless
`../reader/fs` → forbidden; `.ts` specifier → forbidden; directory
`../reader/` → forbidden; redundant separators with genuine collapse into
storage (`./a//b/../reader/fs.js` from `src/storage/types.ts` →
`src/storage/a/reader/fs.ts` → allowed — correctly inside storage, not a
false negative); multiple `..` (`../../../../outside.js`) → undefined →
not-applicable; importer at `src/storage/index.ts` and in nested storage
directories resolves correctly; importers in each WP-7 tree resolve
same-tree and sibling imports as allowed.

## 8. MINOR-3 — Forbidden-Edge Predicate

`classifyWp7StorageEdge(importerRelPath, specifier)` applies the same
resolved-target predicate to every parsed declaration kind (static named
imports, default imports, namespace imports, aliased named imports —
aliases unwrapped by `parseImports`/`originalName` — and export-from
declarations) in both the **real-file scan** (every declaration of every
`src/**` file, no specifier skipped) and the **synthetic adversarial
tests**. Forbidden directions covered and asserted: storage → reader
(`../reader/reader.js`, `../reader/index.js`, `../../reader/fs.js` from
`publication/`), storage → Git inspection (`../../git/inspect.js`),
storage → FFF (`../../fff/discovery.js`, `../../fff/rank.js`), reader →
storage, Git inspection → storage, FFF → storage, traversal normalization
(`./x/../../../reader/fs.js` collapsing into `src/reader/fs.ts`),
aliased-binding and export-from forms. Allowed controls verified without
false positives: storage → storage, storage → canonical
(`../../canonical/jcs.js`), storage → JSON scanner
(`../../json/scanner.js`), storage → trusted configuration brand
(`../../trusted/configuration-brand.js`), WP-7 same-tree imports, and the
accepted WP-7 sibling import (git → reader). Bare-module behavior is
preserved (`reader` from storage → forbidden; `storage/types.js` from
reader → forbidden; `node:fs` → allowed). The SCP-005 ownership set uses
the established repository trees (`src/reader`, `src/git`, `src/fff` —
checked against the actual source tree, including their leaf module
names), consistent with the previously reviewed guard policy.

**Conclusion:** a real hypothetical relative forbidden edge in a
production source file would now cause the test to fail — proven by the
real-file scan over the actual tree (no false positives, 20/20) and by
the resolution-verified synthetic samples.

## 9. MINOR-3 — Adversarial Tests

Synthetic fixtures assert `forbidden` for all six directions plus
normalized traversal, `.js` specifiers, aliased bindings, and export-from;
allowed controls assert `allowed`; out-of-root resolution asserts
`undefined`. The multiline form is covered by `parseImports` (whitespace/
newline-tolerant regex) and the per-declaration classification. Static
guard reconciled: **20/20** (19 committed-WP-8-D + 1 new SCP-005
adversarial test; the SCP-005 real-file test itself was rewritten in
place). No test was modified during this rereview.

**MINOR-3: CLOSED.** (Bounded note: a bare-with-path specifier such as
`reader/fs.js` from storage classifies allowed (exact-equality check on
bare names) — identical to the committed pre-correction predicate (not a
regression), unreachable in this repository's import style (all internal
imports are relative; bare internal specifiers do not resolve under ESM),
and outside the required relative-import scope — NOTE-3.)

## 10. No-Regression

The correction changed **one production source file** —
`src/storage/initialization/provision.ts` — and only by adding the
read-only fixed-entry verification to `classifyNamespace` plus the
`verifyFixedEntryObject` helper (no new fs API beyond the module's
existing allowlist: openSync/closeSync/fstatSync/constants). Verified
unchanged: the write-provenance creator graph (zero production importers
re-confirmed by grep; guard `CREATOR_EDGES` untouched by the correction);
capability brands; publication protocol; lock implementation; audit
implementation; read/verify/enumeration; the five fs-bearing-module
allowlists; global no-I/O delegation (exact nine compiled paths; global
security 15/15); taxonomy; package scripts (16, unchanged);
dependencies/exports (ajv-only; `"."` + `"./pi-adapter"`; 42 exports);
crash harness and stage inventory (11 kill + 8 behavior stages, identical
in both runs). **Production write authority remains unreachable** (zero
production write-action-provenance producers; no ambient issuance; no
runtime test hook).

## 11. Test Execution

Independently executed (actual results):

| Command | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run build` | pass (51 schemas, 358 corpus inputs) |
| `npx tsc -p tsconfig.tests.json` | pass, 0 errors |
| focused initialization tests | **23 total / 21 pass / 2 skips / 0 fail** |
| focused static-guard tests | **20/20** |
| storage suite run 1 | **202 total / 200 pass / 2 skips / 0 fail** |
| storage suite run 2 | **202 total / 200 pass / 2 skips / 0 fail** |
| static guard | **20/20** |
| global security | **15/15** |
| `npm run test:storage-crash` run 1 | **5/5** |
| `npm run test:storage-crash` run 2 | **5/5** (identical 11 kill + 8 behavior stage inventory) |
| `npm run test:security` | **15/15** |
| `npm run test:unit` | **169/169** |
| combined unit (`unit/*` + `unit/storage/*`) | **371 total / 369 pass / 2 skips / 0 fail** |
| `npm test` (default workflow) | **1358/1358** |
| `node scripts/run-wp7-tests.mjs` | **165/165** (reader 62, git 38, fff 26, security 39) |
| contract-hash audit | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` exact |
| dependency audit | `ajv@8.20.0` only |
| public-export count | 42 (independent) |
| package-export audit | `"."`, `"./pi-adapter"` |
| `git diff --check` | clean |

Every claimed count reproduced exactly. **Both skips are legitimate
chown failures** — each test actively executes `chownSync(…, 12345,
12345)` and skips only when the chown throws; neither is forced by UID
checks, environment variables, or preemptive conditionals, and
deterministic wrong-UID policy coverage exists via the committed synthetic
`verifyDirectoryStat` tests.

## 12. Status and Reports

- The correction report accurately describes the actual source/test
  changes (independently verified against the diffs: `verifyFixedEntryObject`
  + classifier loop in `provision.ts`; four state-D tests in
  `initialization.test.ts`; resolver + predicate + adversarial tests in
  `static-guard.test.ts`; no other path).
- The implementation report contains the corrected arithmetic (no stale
  `+7`; §2 and §14 exact).
- Roadmap and planning-status say the focused implementation correction is
  applied and the rereview is pending; the implementation remains **not
  accepted** before this rereview; staging and commit remain unauthorized;
  WP-9 remains unauthorized; no independent WP-8-C verification claim
  appears anywhere.

## 13. Findings, Blockers, Deviations

**Findings:** none open at any severity. MINOR-1, MINOR-2, and MINOR-3 are
fully closed.

**Blockers:** none.

**Deviations:** none beyond those already recorded by the implementation
(lock-module `readFileSync` allowlist refinement; initialization-test
unknown-entry fixture update under the authorized D-7 policy; D-1).
The contract, all ADRs, `src/index.ts`, and `package-lock.json` are
untouched; `state.ts` was not modified by the correction.

**Notes (non-blocking, verified):**
- **NOTE-1** — the implementation report's §14 skip-reconciliation text
  describes the pre-correction single-skip snapshot; the correction report
  reconciles the current two-skips state. Snapshot-accurate; no
  contradiction.
- **NOTE-2** — `resolveRelativeSpecifier`'s trailing-`/` → `index.ts`
  branch is unreachable (the split loop strips trailing empty parts);
  directory imports still classify correctly via tree-prefix matching, so
  there is no predicate impact.
- **NOTE-3** — bare-with-path WP-7 specifiers (`reader/fs.js`) from
  storage classify allowed; identical to the committed pre-correction
  predicate (not a regression), unreachable in this repository's
  relative-only internal import style.

## 14. Acceptance Result

- Pre/post-rereview working-tree inventories: **40** paths before this
  report; **41** after.
- Correction paths: exactly the authorized seven; no envelope violation.
- MINOR-1: counts exact and internally consistent (6→14 = +8; 29 + 20 =
  49; 148 + 49 = 197; correction +5 → 202).
- MINOR-2: every present fixed entry descriptor-verified
  (no-follow, directory-only, UID, exact `0700`, descriptor `fstat`,
  closed on all paths, deterministic mapping, no new code, no mutation);
  all state-D cases empirically fail closed; race-safe; tests genuine;
  23/21/2 reconciled.
- MINOR-3: relative resolution lexical, contained, `.js`→`.ts`, out-of-root
  rejected fail-closed; predicate applied to every declaration form in
  real-file and synthetic scans; a real hypothetical relative forbidden
  edge now fails the guard; 20/20.
- No-regression: only read-only classifier inspection added; all
  authority/durability surfaces and inventories unchanged; production
  write authority unreachable.
- Every test command reproduced the claimed totals; both skips are
  legitimate chown failures.
- Contract/package/export/dependency invariants hold; status/report
  documents consistent.

Because MINOR-1, MINOR-2, and MINOR-3 are fully closed with zero open
findings at all severities, the WP-8-D implementation is accepted at this
gate and readiness for the separate human implementation-acceptance and
commit-preparation gate is granted. Nothing was staged or committed;
WP-9 remains unauthorized.

---

## Final Report

- **Repository, branch, HEAD:** `/home/chef/Documents/Project_Gateway_MCP`,
  `main`, `bd832606ece489a924b4fcc13ad55789fcb0736f`
  (`feat: establish WP-8-C trusted storage bootstrap`, parent
  `05904e46ded384bab5f250ac72c2734539f1e86f`).
- **Pre/post-rereview working-tree inventories:** 40 paths before this
  report (16 modified + 24 untracked); **41 paths** after.
- **Governance-waiver result:**
  `WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION` —
  recorded as a governance fact; no independent verification of the
  WP-8-C commit or its manifest is claimed.
- **Correction-path result:** exactly the authorized seven paths
  (1 modified source, 2 modified tests, 1 modified implementation report,
  1 new correction report, 2 modified status documents); no other path
  changed.
- **MINOR-1 count result:** capabilities committed 6 → current 14 = **+8**;
  new-file contribution **29** (publication 11, locks 7, read 6, audit 5);
  modified-test contribution **20** (capabilities 8, initialization 5,
  taxonomy 1, static guard 3, trusted input 3); **29 + 20 = 49**;
  **148 + 49 = 197**; correction +5 → **202**; no stale `+7`; all
  arithmetic internally consistent. **CLOSED.**
- **MINOR-2 source result:** `verifyFixedEntryObject` — `O_RDONLY |
  O_DIRECTORY | O_NOFOLLOW` open, `fstat` + committed `verifyDirectoryStat`
  (directory type, configured UID, exact `0700`), descriptors closed on
  all paths, deterministic native-error mapping (ENOENT/ELOOP/ENOTDIR/
  EACCES/EPERM/ENAMETOOLONG/EINVAL → state D; other → IDENTITY_DRIFTED),
  no new `ERR-STO-*` code, no repair or mutation; the verification loop
  precedes every PROVISIONAL/INITIALIZED outcome. **CLOSED.**
- **MINOR-2 state-D empirical results:** regular file at `records` →
  FOREIGN; symlink at `tmp` → FOREIGN; wrong mode at `locks` → FOREIGN;
  partial set → PROVISIONAL; exact set → INITIALIZED; `index` → FOREIGN;
  disappearance → FOREIGN. No wrong fixed-entry object classifies
  PROVISIONAL or INITIALIZED.
- **MINOR-2 race/concurrency result:** disappearance, symlink, and
  regular-file replacement fail closed; valid-directory replacement stays
  safely classified with no authority granted (read-only classifier;
  provisioning re-verifies); partial sets remain retryable; no classifier
  mutation. **CLOSED.**
- **MINOR-2 test result:** four genuine pipeline tests (setup cannot fail
  silently); wrong-UID test skips only after actual `chownSync` failure;
  deterministic synthetic `verifyDirectoryStat` UID coverage committed;
  focused initialization **23/21/2** reproduced. **CLOSED.**
- **MINOR-3 resolution-algorithm result:** lexical importer-directory
  resolution; `.`/`..` normalization; `src/` containment; out-of-root
  rejected fail-closed (cannot mask a forbidden edge — all forbidden trees
  are under `src/`); `.js`→`.ts` mapping; extensionless/`.ts`/directory
  forms verified; nested importer and top-barrel importer verified.
  **CLOSED.**
- **MINOR-3 forbidden-edge result:** same resolved-target predicate across
  real-file scan and synthetic tests, every parsed declaration form
  (static, default, namespace, aliased, export-from); all six directions
  forbidden and asserted; allowed controls (storage→storage/canonical/
  JSON/brand; WP-7 same-tree/sibling) produce no false positives.
  **CLOSED.**
- **MINOR-3 adversarial-test result:** all required samples rejected
  (six directions, traversal normalization, `.js` specifiers, aliased,
  export-from, multiline via parser); static guard **20/20**.
  **CLOSED.**
- **No-regression result:** only the read-only classifier inspection
  changed in production source; authority creators, brands, publication,
  lock, audit, read/verify/enumeration, allowlists, global delegation,
  taxonomy, package scripts, dependencies, exports, and the crash stage
  inventory are unchanged; **production write authority remains
  unreachable**.
- **Commands and actual counts:** typecheck pass; build pass (51 schemas,
  358 corpus); tests-tsc pass; focused initialization 23/21/2; focused
  guard 20/20; storage 202/200/2 twice; static guard 20/20; global
  security 15/15; crash 5/5 twice (identical 11+8 inventory); security
  15/15; unit 169/169; combined 371/369/2; default 1358/1358; WP-7
  165/165; contract hash exact; deps ajv-only; exports 42; package exports
  exact; `git diff --check` clean.
- **Contract/package/export/dependency result:** all invariants hold.
- **Status/report result:** correction report accurate; implementation
  report arithmetic corrected; status documents consistent (correction
  applied, rereview pending, implementation not yet accepted); staging/
  commit/WP-9 unauthorized; no WP-8-C verification claim.
- **Findings by severity:** BLOCKER 0; CRITICAL 0; MAJOR 0; MODERATE 0;
  MINOR 0; NOTE 3 (snapshot phrasing, dead resolver branch, bare-with-path
  predicate — all non-blocking).
- **Blockers:** none.
- **Deviations:** the three previously recorded implementation deviations
  only; none introduced by the correction.
- **Implementation-acceptance result:** accepted at this gate; readiness
  for the separate human implementation-acceptance and commit-preparation
  gate granted.
- **Exact next gate:** human authorization of WP-8-D implementation
  acceptance and commit preparation.
- **Exact verdict:**

`WP-8-D FOCUSED IMPLEMENTATION REREVIEW: ACCEPTED`

```text
OPEN FINDINGS: 0
WP-8-D MINOR-1 REPORT COUNTS: ACCEPTED
WP-8-D MINOR-2 CLASSIFIER STATE-D: ACCEPTED
WP-8-D MINOR-3 SCP-005 RELATIVE IMPORT COVERAGE: ACCEPTED
WP-8-D SECURITY-CRITICAL IMPLEMENTATION: ACCEPTED
WP-8-D PRODUCTION WRITE AUTHORITY: UNREACHABLE
WP-8-D IMPLEMENTATION: ACCEPTED
WP-8-D CONTRACT REVISION: NOT REQUIRED
WP-8-D IMPLEMENTATION ACCEPTANCE READINESS: GRANTED
WP-8-D STAGING AUTHORIZATION: NOT GRANTED
WP-8-D COMMIT AUTHORIZATION: NOT GRANTED
WP-9 AND LATER AUTHORIZATION: NOT GRANTED
NEXT GATE: HUMAN AUTHORIZATION OF WP-8-D IMPLEMENTATION ACCEPTANCE AND COMMIT PREPARATION
PUBLICATION: NOT PERFORMED
```
