# WP-8-D — Focused Implementation Correction Report

**Status:** Focused correction of the three MINOR findings of the WP-8-D
senior implementation security and architecture review
(`docs/reports/wp-8d-senior-implementation-security-and-architecture-review.md`):
MINOR-1 (implementation-report count defect), MINOR-2 (classifier state-D
fixed-entry verification gap), MINOR-3 (SCP-005 relative-import coverage
gap). The correction is confined to the authorized paths; the phase is not
broadened; no accepted decision is reopened; the contract and all ADRs are
untouched. Implementation acceptance remains **not granted**; staging and
commit remain unauthorized; WP-9 and later phases remain unauthorized. The
next gate is the **WP-8-D FOCUSED IMPLEMENTATION REREVIEW**.

---

## 1. Baseline and Governance Waiver

| Item | Expected | Verified |
|---|---|---|
| Repository / branch | `/home/chef/Documents/Project_Gateway_MCP` / `main` | exact |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact |
| Staging | empty | empty |
| Commits after HEAD / tags | zero / zero | zero / zero |
| Pre-correction inventory | complete 39-path working tree incl. the senior implementation review | exact (16 modified + 23 untracked files; `git status --porcelain -uall` verified) |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` | exact; byte-identical |
| Dependencies / exports | `ajv@8.20.0` only; 42 | exact |
| Package exports | `"."`, `"./pi-adapter"` | exact |
| `src/index.ts` / `package-lock.json` | unchanged | unchanged |
| Production write authority | unreachable | unreachable (zero production write-action-provenance producers; guard-enforced) |
| WP-9 work / publication | none | none |

**WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION**

The baseline commit and its complete file manifest were not independently
verified; the commit is the operational baseline per human direction.
Nothing in this report claims independent verification of that commit.

## 2. Exact Correction Paths

**Required (7):**

- `src/storage/initialization/provision.ts` — MINOR-2: state-D fixed-entry
  descriptor verification.
- `tests/unit/storage/initialization.test.ts` — MINOR-2: focused state-D
  tests (wrong type, symlink, wrong mode, wrong UID privilege-gated).
- `tests/unit/storage/static-guard.test.ts` — MINOR-3: relative-import
  resolution + adversarial samples.
- `docs/reports/wp-8d-implementation-report.md` — MINOR-1: count
  corrections.
- `docs/reports/wp-8d-focused-implementation-correction-report.md` — this
  report (new).
- `docs/design/post-wp5a-roadmap.md` — current-state wording.
- `docs/design/post-wp5a-planning-status.md` — current-state wording.

**Optional (0 used):** `src/storage/initialization/state.ts` was not
modified — the correction stays inside the namespace classifier
(`classifyNamespace` + a new per-entry verifier in `provision.ts`); the
aggregate state vocabulary and `classifyAggregateState` are unchanged, so
no type/result-boundary change was required.

No other path changed. No new filesystem-bearing source module was
created.

## 3. MINOR-1 — Report Counts (corrected)

Independently re-counted per-file `test(` declarations (committed baseline
vs current):

| File | Committed | Current | Delta |
|---|---|---|---|
| audit.test.ts (new) | 0 | 5 | +5 |
| locks.test.ts (new) | 0 | 7 | +7 |
| publication.test.ts (new) | 0 | 11 | +11 |
| read.test.ts (new) | 0 | 6 | +6 |
| capabilities.test.ts | 6 | 14 | **+8** |
| initialization.test.ts | 14 | 19 | +5 |
| taxonomy.test.ts | 7 | 8 | +1 |
| static-guard.test.ts | 16 | 19 | +3 |
| trusted-input.test.ts | 7 | 10 | +3 |
| **Totals** | **148** | **197** | **+49** |

Correction applied to `docs/reports/wp-8d-implementation-report.md`:
- §2 item 23: `capabilities.test.ts (+7 tests)` → **`+8 tests; committed 6
  → current 14`**.
- §14 parenthetical: the defective component enumeration ("…capabilities
  +7, trusted-input +3, taxonomy +1, initialization +5, static guard +3,
  minus 1 superseded test rewrite…") is replaced by the verified component
  arithmetic: **new test-file contribution 29** (publication 11, locks 7,
  read 6, audit 5) **+ modified-test contribution 20** (capabilities +8,
  initialization +5, taxonomy +1, static guard +3, trusted-input +3);
  **`29 + 8 + 5 + 1 + 3 + 3 = 49`** and **`148 + 49 = 197`**; the
  superseded "unknown entries" test rewrite inside initialization.test.ts
  is a replacement, not an addition, and is already reflected in the +5
  initialization delta.

No functional or security conclusion was altered. Search confirmed no
stale `+7` or contradictory component totals remain.

## 4. MINOR-2 — Classifier State-D Fixed-Entry Verification

**Finding:** `classifyNamespace` verified only the namespace-root
descriptor and entry names; a wrong-type/UID/mode object at a fixed entry
path (e.g., a `0600` regular file at `store-v1/records`) classified
PROVISIONAL (reaching INITIALIZED with verified metadata) instead of the
accepted matrix's fail-closed state D.

**Correction (`src/storage/initialization/provision.ts`):** the classifier
now incorporates descriptor-bound verification of **every present fixed
entry** (`metadata`, `tmp`, `records`, `audit`, `locks`) through a new
`verifyFixedEntryObject(path, serviceUid)` helper that reuses the
committed WP-8-C pattern:

- **No-follow open:** `openSync(path, O_RDONLY|O_DIRECTORY|O_NOFOLLOW)` —
  symlinks never followed (`ELOOP` fails closed); a regular file or
  special object fails the directory open (`ENOTDIR` fails closed).
- **Directory type, configured UID, exact mode `0700`:** `fstat` +
  the committed `verifyDirectoryStat` predicate (directory type, owner
  UID, exact mode with group/other bits zero) — wrong type, wrong UID,
  or wrong mode → fail-closed state D.
- **Descriptor identity stability / bounded close/error handling:** the
  verification is a single open→fstat→close on the no-follow descriptor
  (no path-based re-stat); every native condition maps deterministically:
  `ENOENT` (entry listed by `readdir` but disappeared before the open) →
  state D; `ELOOP`/`ENOTDIR`/`EACCES`/`EPERM`/`ENAMETOOLONG`/`EINVAL` →
  state D; any other unverifiable condition → `IDENTITY_DRIFTED`. The
  internal classifier markers (`foreign-entry`/`drifted-entry`) are not
  `ERR-STO-*` codes — **no new error code**; the aggregate state maps to
  the closed vocabulary as before.

**Classifier behavior after the correction:**

- missing allowed phase-3 entry → PROVISIONAL / upgrade-required
  (unchanged five-state policy, states A/B/C);
- present exact directory → valid (continues);
- regular file, symlink, or other wrong type at a fixed entry → **state D
  (FOREIGN)**;
- wrong UID → **state D (FOREIGN)**;
- wrong mode → **state D (FOREIGN)**;
- identity drift / disappearance during verification → FOREIGN
  (disappeared) or IDENTITY_DRIFTED (unverifiable);
- unknown/deferred names → FOREIGN (unchanged, checked first);
- exact valid five-entry set with verified metadata → INITIALIZED
  (unchanged).

No repair, chown, chmod of existing objects, deletion, replacement, or
adoption occurs anywhere in the classifier. Deterministic concurrency and
crash-retry behavior are preserved (the entry verification is read-only;
partial sets still classify PROVISIONAL; unknown/deferred entries still
fail closed; provisioning idempotency unchanged).

**MINOR-2 tests (`tests/unit/storage/initialization.test.ts`, +4):**

- regular file at a fixed entry path (`records`) → FOREIGN,
  `unknownEntries: false` (the name is known; the object is invalid);
- symlink at a fixed entry path (`tmp`) → FOREIGN (no-follow);
- wrong mode (`locks` chmod `0644`) → FOREIGN;
- wrong UID (`audit` chown to 12345) → FOREIGN — **skipped only when
  `chown` actually fails** (privilege-gated), with deterministic synthetic
  wrong-UID coverage retained in the committed `verifyDirectoryStat`
  stat-policy tests (the classifier reuses that exact predicate).

Valid partial sets, the exact initialized set, and unknown/deferred
entries were already covered by the five-state tests and continue to pass
unchanged.

## 5. MINOR-3 — SCP-005 Relative-Import Coverage

**Finding:** the storage↔WP-7 no-import guard test skipped every `.`- or
`/`-prefixed import specifier, so a hypothetical relative forbidden edge
could never fail the assertion.

**Correction (`tests/unit/storage/static-guard.test.ts`):** the test now
classifies **every** parsed declaration (named imports, namespace, default,
export-from — plain and aliased — via the existing `parseImports`) with a
new pure `classifyWp7StorageEdge(importerRelPath, specifier)` helper:

**Relative-resolution algorithm (`resolveRelativeSpecifier`):**

1. non-relative specifiers → handled by the committed bare-module
   predicate (preserved);
2. importer source path + relative specifier joined lexically;
3. normalize separators, `.` and `..` components (a `..` on an empty stack
   or a result outside `src/` → **resolution rejected**, returns
   undefined — never resolved into an arbitrary path);
4. project-standard `.js` source specifiers mapped to the normalized
   `.ts` source target; a trailing `/` maps to `index.ts`;
5. the SCP-005 forbidden-root predicate applied to the normalized target:
   storage importer + target under `src/reader|src/git|src/fff` (or the
   bare tree leaves `reader|git|fff`) → forbidden; WP-7 importer + target
   under `src/storage` (or `storage…`/`…/storage/…` bare forms) →
   forbidden; everything else → allowed.

**Real-file scan:** the rewritten SCP-005 test iterates every parsed
declaration of every `src/**` file and asserts no declaration classifies
`forbidden` — relative specifiers are no longer skipped, so a real
hypothetical `import … from '../../reader/fs.js'` inside storage would now
fail the guard.

**Synthetic adversarial tests** (real repository-relative forms, resolved
and asserted `forbidden`): storage → reader (`../reader/reader.js`,
`../reader/index.js`, `../../reader/fs.js` from `publication/`), storage →
Git inspection (`../../git/inspect.js`), storage → FFF (`../../fff/discovery.js`,
`../../fff/rank.js`), each WP-7 tree → storage (`../storage/types.js`,
`../storage/locks/lock.js`, `../storage/read/read-record.js`,
`../storage/index.js`), path-traversal normalization
(`./x/../../../reader/fs.js` collapsing into `src/reader/fs.ts`), and the
aliased-binding form; plus the export-from form classified identically.
**Allowed controls:** storage → storage (`../types.js`), storage →
canonical (`../../canonical/jcs.js`), storage → JSON scanner
(`../../json/scanner.js`), storage → trusted configuration brand
(`../../trusted/configuration-brand.js`), WP-7 internal import within its
own tree (`./reader.js`), WP-7 sibling tree (`../reader/reader.js` from
`src/git`). Bare-module behavior preserved (`reader` from storage →
forbidden; `storage/types.js` from reader → forbidden; `node:fs` →
allowed). Out-of-root resolution rejected
(`../../../../outside.js` → undefined). `.js`→`.ts` mapping and `.`/`..`
normalization asserted.

The assertion now fails for a real hypothetical relative forbidden edge,
not merely a fabricated bare module name: the synthetic specifiers are
exactly the relative forms a storage or WP-7 source file would use, and
they resolve to real repository targets before the predicate is applied.

## 6. No-Regression Confirmation

The correction does not alter: the authority creator graph (no creator
imports changed); production reachability (zero write-action-provenance
producers; guard edges unchanged); capability brands; publication; locks;
audit; reads; filesystem delegation (the exact four delegated compiled
paths unchanged; no new fs-bearing module); taxonomy; package scripts;
dependencies; exports; or the crash harness (11 kill + 8 behavior stages
unchanged, both runs identical). The only runtime source change is the
read-only classifier entry verification inside `provision.ts`.

## 7. Commands and Actual Counts

| Command | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run build` | pass (51 schemas, 358 corpus inputs) |
| `npx tsc -p tsconfig.tests.json` | pass, 0 errors |
| focused initialization tests | **23 total / 21 pass / 2 privilege-gated skips / 0 fail** |
| focused static-guard tests | **20/20** |
| storage suite run 1 | **202 total / 200 pass / 2 skips / 0 fail** |
| storage suite run 2 | **202 total / 200 pass / 2 skips / 0 fail** |
| static guard | **20/20** |
| global security | **15/15** |
| `npm run test:storage-crash` run 1 | **5/5** |
| `npm run test:storage-crash` run 2 | **5/5** (identical 11+8 stage inventory) |
| `npm run test:security` | **15/15** |
| `npm run test:unit` | **169/169** |
| combined unit (`unit/*` + `unit/storage/*`) | **371 total / 369 pass / 2 skips / 0 fail** |
| `npm test` (default workflow) | **1358/1358** |
| `node scripts/run-wp7-tests.mjs` | **165/165** (reader 62, git 38, fff 26, security 39) |
| contract-hash audit | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` exact |
| dependency audit | `ajv@8.20.0` only |
| public-export count | 42 |
| package-export audit | `"."`, `"./pi-adapter"` |
| `git diff --check` | clean |

**Suite-delta reconciliation:** storage suite 197 → **202** = **+5**:
MINOR-2 classifier state-D tests +4 (initialization.test.ts 19 → 23) and
MINOR-3 adversarial test +1 (static-guard.test.ts 19 → 20). Baseline 148
→ 197 (WP-8-D) → 202 (after correction). Both skips are the
privilege-gated `chown` tests (the committed wrong-UID verification-only
test and the new state-D wrong-UID variant); neither is forced, and
wrong-UID policy coverage is deterministic via the committed synthetic
stat-policy tests. No zero-test invocation; the crash stage inventory is
unchanged and both crash runs executed the identical fixed 11+8 stages.

## 8. Inventory

**Correction delta (7 paths):** 1 modified source, 2 modified test files,
1 modified report, 1 new report, 2 modified status documents — all
authorized. The complete working-tree inventory is now **40 files**
(16 modified + 24 untracked), including the six pre-existing decision
documents, the two review reports, the implementation report, the
correction report, and the full WP-8-D source/test delta. No unauthorized
path exists.

## 9. Findings, Blockers, Deviations

**Findings:** none open at this gate. MINOR-1, MINOR-2, and MINOR-3 are
corrected as described above.

**Blockers:** none.

**Deviations:** none beyond those already recorded by the implementation
(lock-module `readFileSync` allowlist refinement; initialization-test
unknown-entry fixture update under the authorized D-7 policy; D-1).
The contract, all ADRs, `src/index.ts`, and `package-lock.json` are
untouched. `src/storage/initialization/state.ts` was not modified (the
optional path was not required).

## 10. Git State

All changes are unstaged and uncommitted; staging is empty; tags zero; no
commits after HEAD; no push, tag, release, publication, installation, or
deployment.

## 11. Next Gate

**WP-8-D FOCUSED IMPLEMENTATION REREVIEW** — review of this correction and
the three corrected findings, followed by the implementation acceptance
gate. Staging and commit remain unauthorized. WP-9 and later phases remain
unauthorized.

---

**WP-8-D FOCUSED IMPLEMENTATION CORRECTION: APPLIED (MINOR-1, MINOR-2, MINOR-3)**
**OPEN MINOR FINDINGS: 0 CLAIMED**
**IMPLEMENTATION ACCEPTANCE: NOT YET GRANTED**
**STAGING AUTHORIZATION: NOT GRANTED**
**COMMIT AUTHORIZATION: NOT GRANTED**
**PUBLICATION: NOT PERFORMED**
