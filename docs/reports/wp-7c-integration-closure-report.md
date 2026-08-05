# WP-7-C Integration and Closure Report (Corrected After Senior and Final Focused Rereview)

**Status:** WP-7-C integration, full verification, and closure preparation — human-authorized; the senior closure review returned seven actionable findings (C-01…C-07), all addressed by the correction cycle; the final focused closure rereview returned four findings and one hardening note (Z-01…Z-05), all addressed by this final correction. WP-7 is **not yet closed**; no commit, stage, push, tag, release, publication, installation, or deployment has occurred or is authorized.

**Review chronology (preserved):**

1. WP-7-A (foundation and contract consolidation) — closed at `64623c78b167c9aa50ab9c2e5f146e7cc9741c34`.
2. WP-7-B (runtime implementation) — closed at `7fa2b15c8bab8b373751affac08acc3e9225aba8`.
3. WP-7-C initial integration cycle — integrated the four focused suites into the default workflow (total 1490), produced `docs/reports/wp-7c-integration-closure-report.md`.
4. WP-7-C senior closure review — returned findings C-01…C-07 and non-blocking observations (serialization acceptable; earlier repository convention has similar weaknesses out of WP-7-C scope).
5. WP-7-C correction cycle — closed all seven findings (C-01…C-07), re-ran full closure verification (totals 1515), updated planning documents.
6. **WP-7-C final focused rereview** — returned findings Z-01…Z-04 and hardening note Z-05 (file presence does not prove execution; clean script cwd anchoring; isolation-helper cwd dependence; focused-script guarantee; fingerprint walker fail-closed hardening). **This report records their closure** with full evidence; accepted counts rose to reader 62, git 38, fff 26, security 39 (total 165; integrated 1522) solely from the seven authorized Z-05 fingerprint tests.

---

## 1. Senior Closure Review Findings and Dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| C-01 | MODERATE | Stale orphan and deleted-source compiled tests survive ordinary `npm test` | **CLOSED** — automatic generated-output cleanup (`scripts/clean-generated.mjs`) removes `dist/` and `dist-test/` before every official `npm test`; five stale-output experiments prove canonical totals return automatically (Section 4). |
| C-02 | MODERATE | Global `/proc` Git-process scan is not ownership-aware | **CLOSED** — ownership-aware PID/PPID-lineage evidence, leak-detection control, and unrelated-host-git isolation (Section 6). |
| C-03 | MODERATE | WP-7 phase succeeds with zero tests | **CLOSED** — fail-closed discovery guard (`scripts/wp7-discovery-guard.mjs`) with source↔compiled correspondence; all invalid-inventory probes exit nonzero (Section 5). |
| C-04 | MODERATE | Closure report contained inaccurate COMPLETE and determinism claims | **CLOSED** — this report corrects every identified claim (Sections 2, 10, 13) and updates the readiness matrix only after corrections were proven (Section 16). |
| C-05 | MODERATE | Mutation and FFF budget evidence incomplete or overstated | **CLOSED** — nine-operation tripwire matrix, representative failure-path tripwires, symlink fingerprint semantics, and direct FFF budget tests (Sections 8, 9). |
| C-06 | MINOR | Silent-pass test fallbacks contradict the report | **CLOSED** — FIFO prerequisite, deterministic timeout/cancellation, deterministic FFF cancellation; zero skips on the supported lane (Section 10). |
| C-07 | MINOR | Parallel-race reproduction statement not independently reproducible | **CLOSED** — the `2/6` observation is now stated accurately as a prior timing/load-dependent observation; senior review observed `0/16`; serialization is retained as a conservative deterministic choice (Section 7). |

**Non-blocking observations:** serialization is acceptable and does not hide a runtime leak (runtime reaping independently verified); the earlier repository test convention has similar stale/empty-glob weaknesses but is outside WP-7-C scope.

**Inaccurate claims removed from the prior report:** "manual clean convention is sufficient" (now automatic); "any host git process is an orphan" (now ownership-aware); "a missing test directory fails Node automatically" (now the explicit guard fails it); "all nine operations were previously fingerprinted" (now true); "symlink targets were walked" (now recorded via lstat/readlink, never followed); "all FFF budgets were previously tested" (now directly tested); "2/6 is a reproducible stable rate" (now qualified as timing/load dependent, not reproduced by senior review).

## 2. Repository, Branch, and Baseline

| Item | Value |
|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` |
| Branch | `main` |
| Baseline HEAD (WP-7-B) | `7fa2b15c8bab8b373751affac08acc3e9225aba8` |
| HEAD subject | `feat: implement WP-7 controlled inspection` |
| HEAD parent (WP-7-A) | `64623c78b167c9aa50ab9c2e5f146e7cc9741c34` |
| Git | 2.45.4 (supported lane) |
| Node | v22.23.2; npm 10.9.8 |

Baseline gate (recorded before any correction-cycle edit): staging empty; tags zero; working tree contained exactly the accepted initial WP-7-C diff (3 modified tracked paths: `package.json`, `docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`; 1 untracked: `docs/reports/wp-7c-integration-closure-report.md`); no runtime or test-source changes present before this cycle; no WP-8 work.

## 3. Exact Corrected Diff Inventory

```
 M package.json                                     (test script + new clean:generated script)
 M docs/design/post-wp5a-planning-status.md         (current-state paragraph)
 M docs/design/post-wp5a-roadmap.md                 (current-state paragraph)
 M tests/wp7/helpers.ts                             (shared fingerprint utilities)
 M tests/wp7/security/security.test.ts              (C-02/C-05/C-06 + Z-03 scratch repo + Z-05 fingerprint tests)
 M tests/wp7/fff/fff.test.ts                        (C-05 budget tests, C-06 cancellation)
 M tests/wp7/reader/reader.test.ts                  (C-06 FIFO + cancellation fixes)
 M tests/wp7/git/git.test.ts                        (C-06 deterministic timeout/cancellation)
 M docs/reports/wp-7c-integration-closure-report.md (this report, corrected)
?? scripts/clean-generated.mjs                      (C-01 automatic cleanup; Z-02 repository-anchored, path-safe)
?? scripts/wp7-discovery-guard.mjs                  (C-03 guard; G hardening: symlinked/malformed entries rejected)
?? scripts/run-wp7-tests.mjs                        (Z-01 validated execution runner)
```

**Untouched:** `src/reader/**`, `src/git/**`, `src/fff/**`, `src/trusted/**`, `src/index.ts`, the WP-7 contract, schemas, semantic rules, fixtures, vectors, corpus inputs, generated source artifacts, adapters, package exports, dependencies, `package-lock.json`, the accepted WP-7-A and WP-7-B reports, WP-8+ documents.

## 4. C-01 — Automatic Stale-Output Elimination

**Implementation:** `scripts/clean-generated.mjs` (new, Node built-ins only, no dependency) removes `dist/` and `dist-test/` (`fs.rmSync(recursive, force)`, which throws visibly on permission failures; only absent directories are tolerated). The official `test` script now begins with `npm run clean:generated && …` before `build` and the test typecheck, so every official run starts from a clean compiled-output state **without any human manual-clean convention**. Focused scripts are unchanged; they operate on `dist-test` produced by the workflow (or a prior `npm test`).

**Stale-output experiments** (each: canonical build → inject stale output → ordinary `npm test` with no manual clean → canonical totals must return automatically; canonical = 1357 pre-existing + 158 WP-7 = 1515):

| # | Contamination | Result |
|---|---|---|
| 1 | Stale extra test bytes appended inside an existing compiled file (`unit/core.test.js`) | 1357 + 158, stale bytes never executed (overwritten by recompile after clean) |
| 2 | Orphan compiled test with no source (`wp7/security/zz-stale.test.js`) | 1357 + 158, orphan removed by the automatic clean |
| 3 | Compiled residue whose source test was deleted (`reader/reader.test.ts` moved out; old compiled file present) | 1357 + 129 (29 reader tests absent; residue never executed); after source restore → 1357 + 158 |
| 4 | Orphan helper/non-test compiled file (`wp7/security/stray-helper.js`) | 1357 + 158, removed |
| 5 | Malformed stale compiled test (`unit/malformed.test.js`, invalid syntax) | 1357 + 158, removed before any loader could parse it |

Post-experiment residue check: zero stale/stray/malformed files remain in `dist-test`.

## 5. C-03 — Fail-Closed Test-Discovery Guard

**Implementation:** `scripts/wp7-discovery-guard.mjs` (new, Node built-ins only) runs after `tsc -p tsconfig.tests.json` and before the WP-7 runner in the official workflow. It verifies, per required suite (reader, git, fff, security):

- the source directory `tests/wp7/<suite>` exists and contains ≥1 `*.test.ts`;
- the compiled directory `dist-test/tests/wp7/<suite>` exists and contains ≥1 `*.test.js` (no zero-test phase, no absent focused suite);
- source↔compiled correspondence: every `*.test.ts` has exactly one compiled `*.test.js`; every compiled `*.test.js` has a source counterpart (orphans and missing outputs both fail);
- helper files (non-`*.test.*`, e.g. `helpers.ts`/`helpers.js`) are never counted as tests.

On failure it prints a bounded deterministic diagnostic (≤20 lines + an omitted-count line) and exits 1 **without starting the WP-7 test runner**.

**Probes (direct guard invocation, exit codes):**

| Inventory state | Exit |
|---|---|
| Normal complete inventory | 0 |
| Missing `reader` compiled dir | 1 |
| Missing `git` compiled dir | 1 |
| Missing `fff` compiled dir | 1 |
| Missing `security` compiled dir | 1 |
| Empty compiled dir (no `*.test.js`) | 1 |
| Orphan compiled test (no source) | 1 |
| Missing compiled output (source present, compiled absent) | 1 |

**Full-workflow probes (`npm test`, exit codes):** missing `reader` source dir → 1; missing `git` → 1; missing `fff` → 1 (`FAIL: missing source suite directory: tests/wp7/fff`); missing `security` → 1; empty `fff` suite → 1 (`FAIL: missing compiled suite directory: … (zero tests would run)`). The guard diagnostics appear in the official output; all suite directories were restored and the canonical run re-verified after the probes.

## 6. C-02 — Ownership-Aware Git Child-Process Evidence

The global `/proc` name scan was replaced with a test-only ownership-aware model in `tests/wp7/security/security.test.ts`:

- **Lineage derivation:** `gitDescendants(ancestorPid)` reads `/proc/*/stat`, extracts `comm` and `ppid`, and returns only processes whose PID/PPID ancestry reaches the test process **and** whose comm contains `git`. Unrelated host git processes are never matched. `(pid, starttime)` pairs are used so PID reuse cannot confuse observation.
- **Observed-and-reaped test:** during three status + log operations, a 2ms poll must observe ≥1 WP-7-owned git child; after completion, `gitDescendants(me)` must be empty (waited up to 2s). Passes.
- **Leak-detection control:** a deliberately leaked `git cat-file --batch` child (stdin pipe held open) must be detected by the ownership-aware detector while alive, then is killed and awaited; after cleanup the detector must be empty. The child is never left running. Passes.
- **Unrelated-host-git isolation:** a real git process is spawned by a throwaway node helper via double-fork (helper exits; git is reparented to init; stdin is a FIFO opened O_RDWR so the child stays alive without an EOF), then asserted to be **ignored** by the detector and killed. Passes.

**External-interference test (orchestrated):** with an unrelated, reparented git process running outside the repository: `test:wp7-security` → 32/32; serialized WP-7 phase → 158/158; full `npm test` → 1357 + 158 = 1515. All pass. The unrelated git was terminated afterwards.

**Leak-detection control evidence:** the control proves the detector would fail (non-empty) if a WP-7-owned child were leaked, and that cleanup restores the empty invariant.

## 7. Serialization Adjudication (C-07)

`--test-concurrency=1` is retained for the WP-7 default invocation. It is:

- a legitimate orchestration choice (file-level serialization of the WP-7 phase);
- a prevention of cross-file interference between the Git suite's short-lived children and the security suite's observations;
- **not** the ownership-aware orphan check (that is the lineage detector in Section 6);
- independent of runtime reaping, which is verified by the observed-and-reaped test and by post-run process checks (zero git processes remain after every run).

**Race evidence stated accurately:** the interaction was previously observed (the initial cycle recorded 2 failures in 6 parallel WP-7 file runs; failure identity: the then-global orphan scan). Senior review ran 0/16 without reproduction. The race is timing/load dependent, not a stable rate; serialization is retained as a conservative deterministic choice. No claim of a reproducible `2/6` rate is made.

## 8. C-05 — Complete Mutation Evidence (nine operations)

`tests/wp7/security/security.test.ts` now carries a before/after tripwire for **all nine operations**, each fingerprinting the workspace (including `.git` internals), HOME, TMPDIR, and the Git binary SHA-256:

| # | Operation | Tripwire |
|---|---|---|
| 1 | list-directory | **added** (lists workspace root, asserts ok) |
| 2 | inspect-metadata | **added** (`file.txt`, asserts ok) |
| 3 | read-text | **fixed** — now runs on the actual tree the operation reads (workspace rooted at the git repo) and asserts `ok` + content; previously fingerprinted the wrong tree and never asserted success |
| 4 | read-bytes | **added** |
| 5 | git-status | preserved |
| 6 | git-diff | **added** (clean-repo diff, asserts ok) |
| 7 | git-log | preserved |
| 8 | git-show | **added** (log → full-SHA show, asserts ok) |
| 9 | fff-discover | preserved |

**Representative failure-path tripwires** (each with before/after fingerprints): invalid request; traversal denial; containment denial (symlink escape); special file (FIFO, `ERR-FTYPE-UNSUPPORTED`); malformed UTF-8 (`ERR-TEXT-MALFORMED`); cancellation (`ERR-OP-CANCELLED`); **git timeout** (deterministic `cat-file --batch` hang through the real wrapper, `code: 'timeout'`, ~5s); hostile Git config (`ERR-GIT-STATE-UNSUPPORTED`); preflight-to-launch drift detection; output-limit truncation (ok + `truncated`); **FFF budget exhaustion** (10,000-entry real tree, `truncated: true`).

**Fingerprint model** (`tests/wp7/helpers.ts`, shared with the git suite): path set (files, directories, symlinks, and other kinds); regular-file content SHA-256, size, mode; directory entries and modes; **symlink identity and link target via `lstat`/`readlink` — symlinks are recorded but never followed, and targets outside the fingerprint root are never walked**; `.git` tree (index, refs, reflogs, config, object database via full-tree walk); lock files (`*.lock` must be absent after); HOME; TMPDIR; Git executable metadata; test-owned child-process lifecycle (Section 6). atime is excluded exactly as the contract accepts (RO-004/RO-005); the prior claim that symlink targets were walked is removed.

## 9. C-05 — FFF Budget Tests

`tests/wp7/fff/fff.test.ts` gained a `budget enforcement` describe using a **synthetic controlled-reader capability** (test-only class satisfying the `FffCapability` reader surface; deterministic, no filesystem I/O, fast):

| Test | Evidence |
|---|---|
| Bounded traversal | files at depth ≤ `FFF_MAX_DEPTH` (32) discovered; depth 33 and depth 40 never discovered (exact boundary pinned) |
| Visited-entry budget | 11,000-entry tree → `truncated: true` |
| Candidate-file budget | 2,500 candidates → truncated at the pinned limit; deterministic across two runs |
| Total-content-byte budget | 300 × 64KiB content windows → truncated |
| Per-file content window | `readText` requested with exactly `FFF_PER_FILE_WINDOW`; snippet byteLength ≤ `FFF_MAX_SNIPPET_BYTES` and contains the query |
| maxResults truncation | 50 matches, `maxResults: 3` → 3 items, `truncated: true`, deterministic |
| Cancellation during budget consumption | blocking synthetic capability → deterministic `ERR-OP-CANCELLED` mid-scan |
| Failed candidates consume budget | 2,100 files with 100 failing reads → truncated (failed reads still counted as candidates) |
| Symlinks consume visited budget | 10,500 symlink entries → truncated; symlinks never become candidates |
| No authority from partial results | budget-truncated items carry only `path`/`score`/`snippet` |

Resulting suite counts: FFF 17 → **26**.

## 10. C-06 — Silent-Pass Fallback Removal

Audited every WP-7 focused test for `catch { return; }`, `if (!x) return;` without a preceding assertion, and either-or assertions:

- **FIFO prerequisite** (`reader.test.ts`): `mkfifo` failure now throws a clear test error on the supported Linux lane (was: silent `return`).
- **Git lane/drift prerequisites**: all existing `assert.*`-then-guard patterns verified loud (assert precedes every narrowing `return`); no silent pass.
- **Timeout** (`git.test.ts`): the previous test asserted a quick log succeeded and never exercised timeout — replaced with a **deterministic hung-launch timeout test** (test-owned sleeping executable launched through the real `GitInspectionService` with a matching lane fingerprint; pinned `OPERATION_TIMEOUT_MS` enforces `ERR-GIT-TIMEOUT` in ≥4s; failure is sanitized) and a **deterministic cancellation test** (abort during hung launch → `ERR-OP-CANCELLED`). Security suite carries the timeout tripwire (Section 8).
- **FFF cancellation** (`fff.test.ts`): the either-or "cancelled or completes" test replaced with the deterministic blocking-capability test (Section 9).
- **Reader in-flight cancellation** (`reader.test.ts`): the either-or test was removed; the deterministic contract surface (already-aborted → `ERR-OP-CANCELLED`; recovery) is asserted, and deterministic in-flight cancellation evidence lives in the FFF (blocking capability) and Git (hung launch) suites, where an abort can be forced to land mid-operation.
- **Host-specific path checks**: none remain conditional.

**Result: zero skips across all WP-7 suites on the supported lane** (Linux, Node 22.23.2, Git 2.45.4, `/proc/self/fd`, `O_NOFOLLOW`, `O_NONBLOCK`) — every run reports `# skipped 0`.

## 11. Unique Test-Discovery Accounting (corrected)

Per-file WP-7 counts (compiled, runner-verified): `wp7/reader/capture.test.js` 33, `wp7/reader/reader.test.js` 29, `wp7/git/git.test.js` 38, `wp7/fff/fff.test.js` 26, `wp7/security/security.test.js` 39.

- Pre-existing default: **1357** (unit 169, integration 100, security 14, pi-adapter 272, trusted 570, pointofuse-v2 232) — unchanged; no pre-existing test removed or weakened.
- WP-7 focused: reader 62, git 38, fff 26, security 39 = **165** (accepted 133 + 25 authorized C-05/C-06 evidence tests + 7 authorized Z-05 fingerprint fail-closed tests; every increase is a direct justified evidence test, no forced arithmetic).
- Integrated default total: **1522** = 1357 + 165.
- Compiled test files: **75** (unchanged file count; new tests live in existing files).
- Duplicate identities: **0**; omitted identities: **0**; skipped: **0**; stale compiled tests: **0** (Section 4); missing-source compiled tests: **0** (Section 5); every required WP-7 suite nonzero (guard); executed counts enforced per suite by the validated runner (Section Z-01).

## 12. Default Totals Across All Runs (corrected cycle)

From ordinary repository state with no manual pre-clean (the workflow cleans itself), `npm test`:

| Run | Pre-existing | WP-7 (validated runner) | Total |
|---|---|---|---|
| 1 | 1357/1357 | 165/165 | 1522 |
| 2 | 1357/1357 | 165/165 | 1522 |
| 3 | 1357/1357 | 165/165 | 1522 |
| 4 | 1357/1357 | 165/165 | 1522 |
| 5 | 1357/1357 | 165/165 | 1522 |
| 6 | 1357/1357 | 165/165 | 1522 |
| 7 | 1357/1357 | 165/165 | 1522 |
| Interference (unrelated git running) | 1357/1357 | 165/165 | 1522 |
| Canonical (probe-copy baseline) | 1357/1357 | 165/165 | 1522 |

Identical discovery, counts, and pass/fail across all runs (all from ordinary repository state, no manual pre-clean); zero skips; exit status 0 each run. Focused suites ×2 each: reader 62/62, git 38/38, fff 26/26, security 39/39 — all zero skips. The WP-7 phase is executed by the validated runner (`scripts/run-wp7-tests.mjs`), which reports per-suite executed/pass/exit evidence. Orphan-process state after every run: zero git processes; lock-file state: zero; HOME/TMPDIR: fixture-local, fingerprint-verified unchanged.

## 13. Regression, Conformance, and Generated Evidence (corrected cycle)

| Suite | Result |
|---|---|
| PointOfUse-v2 | 232/232 |
| trusted | 570/570 |
| integration (84 effective-authority + 16 conformance) | 100/100 |
| existing security | 14/14 |
| Conformance internals: manifest 587/587 executed, 0 mismatches; schemas 51; semantic rules 116; RULE matrix 228; digest vectors 36/36; corpus inputs 358 | PASS |
| Corpus generation (2 runs) | 51 schemas + 358 inputs; byte-identical (`schema-bundle.ts` `5de98ba3…`, `corpus-bundle.ts` `e8e11be7…`) |
| Production typecheck / test typecheck | PASS / PASS |
| `git diff --check` | clean |

## 14. Runtime and Contract Immutability (corrected cycle)

Runtime SHA-256 before and after the correction cycle — **14/14 identical** (all files under `src/reader/**`, `src/git/**`, `src/fff/**`, `src/trusted/index.ts`, `src/index.ts`). Contract SHA-256 `5976cfdf5dd2cb8e3c7f16a60a8ac37fa95a5327bb99b1bb874a19c189bcbe1b` unchanged; WP-7-A report `685702ad…` and WP-7-B report `24c53027…` unchanged; package-lock SHA-256 `0fe11d74…` unchanged. Contract state: 237 requirements, 20 prefix groups, 23 operational error codes, 23/23 condition-to-code mapping, GIT-018 uses `--no-textconv`, **zero contract deviations**, no new erratum.

## 15. Planning-Document Updates

Both `docs/design/post-wp5a-roadmap.md` and `docs/design/post-wp5a-planning-status.md` current-state paragraphs now state: WP-7-A closed; WP-7-B closed at `7fa2b15c8bab8b373751affac08acc3e9225aba8`; WP-7-C human-authorized; the senior correction and focused rereview identified a final zero-test issue (Z-01) plus Z-02…Z-05; the final correction is complete and ready for final closure rereview; WP-7 is **not closed**; WP-8 is **not authorized**; no publication or release has occurred. Historical chronology preserved; no prior-phase rewriting.

## Z. Final Focused-Rereview Correction (Z-01…Z-05)

### Z-01 — Actual test-execution fail-closed runner (MODERATE)

**Finding:** file-presence correspondence does not prove nonzero discovered/executed tests; all-skipped and gutted-suite states could previously pass file-level checks.

**Correction:** new orchestration script `scripts/run-wp7-tests.mjs` (Node.js 22.23.2-compatible, no dependency) is the WP-7 phase of the official workflow. For each suite (reader, git, fff, security), sequentially, it:

1. resolves the exact compiled `*.test.js` files (the set the discovery guard validated);
2. launches the real test runner via `process.execPath` with `--test --test-concurrency=1 --test-reporter=tap`;
3. parses the **final authoritative TAP summary** (trailing `1..N` plan line + the six summary fields, each required exactly once; indented nested plans ignored; duplicate/missing fields rejected; malformed output rejected);
4. enforces: `tests == expected` (accepted manifest: reader 62, git 38, fff 26, security 39), `pass == tests`, `fail == cancelled == skipped == todo == 0`, and child exit status 0;
5. fails nonzero with bounded deterministic diagnostics and preserves the full suite output to a temporary file for debugging.

No static source-text counting is used. The runner is imported into the report chain only as a validated executor; the discovery guard (Section 5) still runs first and is **not replaced**.

**Probes (disposable copy, full `npm test`, all exit 1 with the affected suite identified):** reader/git/fff/security suites with all tests removed (guard: `missing compiled suite directory … (zero tests would run)`); git suite all-`skip` (runner: `pass count 0 != executed tests 38`); one reader test removed (runner: `expected 62 executed tests, summary reports 61`); one unexpected reader test added (runner: `expected 62 … reports 63`); fff file loading but registering zero tests (runner: `expected 26 executed tests, summary reports 1`); real-workflow exit-code mutation (runner identified the git suite, exit 1). Parser-level probes (exported `parseTapSummary`/`evaluateSuite`): missing plan, duplicate field, missing field, nested-plan isolation, count mismatch, exit-nonzero-with-passing-summary, exit-zero-with-invalid-summary, zero tests, all-skipped — all behave as specified. Canonical restore re-verified: 1522/1522.

### Z-02 — Clean-script repository anchoring (MINOR)

**Correction:** `scripts/clean-generated.mjs` derives the repository root from its own location (`import.meta.url` → `fileURLToPath` → `dirname` → parent), never from `process.cwd()`. Before deletion it verifies the derived root's `package.json` name equals `@project-gateway/artifact-core`, each target is exactly a direct child (`dist`/`dist-test` basenames), neither target equals or escapes the repository root, and entries are detected via `lstat` (dangling symlinks included). `rmSync(recursive)` unlinks symlinks without following them.

**Probes (throwaway repo, copied script):** invocation from repo root, from `/tmp`, from a nested directory, and with a decoy `package.json` in cwd — all removed exactly `<repo>/dist` and `<repo>/dist-test`; `dist` symlink to an external target and `dist-test` symlink to an external target — links removed, external targets intact; nested symlink inside a real `dist` — removed, external target intact; dangling symlink — removed; wrong package name — refuses (exit 1, nothing deleted); missing `package.json` — refuses (exit 1).

### Z-03 — Isolation-helper cwd independence (MINOR)

**Correction:** the unrelated-Git isolation evidence now initializes a dedicated scratch repository (`git init` + minimal committed fixture) and launches the controlled unrelated Git process with `cwd` pinned to that scratch repo; the leak-detection control also pins `cwd` to the controlled git fixture repo. The security suite's `PROJECT_ROOT` is derived from the test file location (`import.meta.url`), not `process.cwd()`, so static audits and isolation evidence are invocation-cwd independent.

**Evidence:** security suite 39/39 from the repository root; 39/39 from a disposable copy **without `.git`** (cwd = the copy); 39/39 from an unrelated working directory (`/tmp`, absolute paths); zero git processes and zero scratch residue after every run.

### Z-04 — Focused-script guarantee (MINOR)

**Documented (this section and Section Z-04 of the report record):** official `npm test` performs automatic cleanup, correspondence validation, and exact executed-test-count enforcement. Direct `test:wp7-*` scripts operate on compiled `dist-test` output and may execute stale orphan outputs if invoked against contaminated compiled output; they are **not** described as stale-output resistant. Callers requiring closure-grade deterministic verification must use `npm test` or explicitly run the official cleanup/build/guard preparation first. Focused scripts remain useful for rapid focused execution after a known-clean build, and remain independently runnable per the accepted contract.

### Z-05 — Fingerprint walker fail-closed hardening (NOTE)

**Correction:** `fingerprintTree` in `tests/wp7/helpers.ts` now **throws** on every evidence-collection failure — directory enumeration, `lstat`, `readlink`, file hashing, permission denials — with a bounded relative-path diagnostic that never discloses unrelated absolute host paths. Nothing is silently omitted; disappearing entries surface as one of these failure classes and fail the test.

**Direct tests added (security suite, +7):** unreadable directory → throws with relative diagnostic; unreadable file → throws; missing root → throws; broken symlink → recorded as link with target string, no throw; external symlink target → recorded, never traversed (external contents never appear in the fingerprint); special file (FIFO) → recorded as `other`, no block, no throw; unchanged-tree roundtrip equality. These tests raise the security suite from 32 to **39** (the sole justified count increase in this cycle).

### Discovery-guard preservation (G)

The source↔compiled correspondence guard remains and additionally rejects symlinked source/compiled suite directories, symlinked test entries, and malformed test-like filenames (probes: 7 guard cases exit 1 as required). The execution-count runner complements, not replaces, the guard.

## 16. Closure Readiness Matrix (post-final-correction)

| Area | Assessment |
|---|---|
| Default test integration (validated runner phase) | COMPLETE |
| Focused-suite preservation (independently runnable, ×2) | COMPLETE |
| Unique test discovery (1522, per-file accounting) | COMPLETE |
| Test-execution fail-closed (actual summaries, Z-01 probes) | COMPLETE |
| Stale-output resistance (automatic clean, 5 experiments) | COMPLETE |
| Cleanup path safety (anchored, symlink-safe, cwd-independent) | COMPLETE |
| Test-discovery fail-closed (guard incl. symlink/malformed) | COMPLETE |
| External-process isolation (scratch repo, cwd-independent) | COMPLETE |
| Focused-script guarantee (documented, not stale-resistant) | COMPLETE |
| Fingerprint fail-closed (Z-05 tests, throws on any fs failure) | COMPLETE |
| Runtime immutability (14/14) | COMPLETE |
| Contract immutability (SHA, 237/20/23/23) | COMPLETE |
| Controlled-reader verification (62/62 ×2) | COMPLETE |
| Git verification (38/38 ×2 + timeout/cancellation/ownership) | COMPLETE |
| FFF verification (26/26 ×2 + budget matrix) | COMPLETE |
| Mutation evidence (9/9 operations + failure paths) | COMPLETE |
| Child-process evidence (ownership-aware) | COMPLETE |
| Package boundary / public boundary / dependency state | COMPLETE / COMPLETE / COMPLETE |
| Regression compatibility (232/570/100/14) | COMPLETE |
| Conformance (587/51/116/228/36/358) | COMPLETE |
| Corpus reproducibility (byte-identical ×2) | COMPLETE |
| Planning-state accuracy | COMPLETE |
| Closure documentation (this report) | COMPLETE |

## 17. Deviations, Findings, Git State, Verdict

**Deviations:** none. **Open findings:** none. **Blockers:** none. All previously observed anomalies (cross-file orphan-scan race; file-presence-vs-execution gap) are resolved at the orchestration level with no runtime or test-content change beyond authorized evidence tests.

**Git state:** HEAD remains `7fa2b15c8bab8b373751affac08acc3e9225aba8`; all correction-cycle changes remain **unstaged and uncommitted**; staging empty; zero tags; no push/release/publication/installation/deployment; package-lock and dependencies unchanged; no WP-8 work.

WP-7 remains **not closed**: closure requires the final closure rereview and a separately authorized closure commit.

**WP-7-C FINAL CORRECTION: READY FOR FINAL CLOSURE REREVIEW**

---

## 18. Final Closure Rereview and WP-7 Closure (authoritative closure record)

**Final closure rereview verdict:** `WP-7-C FINAL CLOSURE REREVIEW: ACCEPTED`; **open findings: `0`**. All prior findings C-01…C-07 and Z-01…Z-05 are closed. The two final rereview notes (TAP parser last-plan-wins tolerance for a duplicated top-level plan line; bounded per-suite summaries in successful full runs rather than complete WP-7 TAP logs) are accepted as non-blocking design notes and were intentionally not changed before this commit.

**Accepted integrated totals:** default `1522` (`1357` pre-existing + `165` WP-7); WP-7 suites: reader `62`, Git `38`, FFF `26`, security `39`; compiled test files `75`; skips/todos/cancellations zero; duplicate and omitted test files zero.

**Immutability:** runtime/public-boundary files `14/14` byte-identical to the WP-7-B baseline `7fa2b15c8bab8b373751affac08acc3e9225aba8`; contract immutable (`5976cfdf5dd2cb8e3c7f16a60a8ac37fa95a5327bb99b1bb874a19c189bcbe1b`; 237 normative requirements, 20 prefix groups, 23 error codes, 23/23 mappings, GIT-018 `--no-textconv`); contract deviations `0`; WP-7-A and WP-7-B reports unchanged; package-lock and dependencies unchanged; public and package exports unchanged.

**Closure state:** the commit containing this closure record is the authoritative WP-7 closure baseline. It contains exactly the twelve authorized WP-7-C paths (final-rereviewed verification lifecycle and evidence plus this closure-state synchronization). WP-7-C is **closed** by the commit containing this report; WP-7 is **closed** by the commit containing this report. WP-8 remains **not authorized**. No push, tag, release, publication, installation, or deployment has occurred or is authorized.

**WP-7-C FINAL CLOSURE: COMMITTED — WP-7 CLOSED**
