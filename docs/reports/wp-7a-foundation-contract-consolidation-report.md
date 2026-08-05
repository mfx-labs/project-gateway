# WP-7-A — Foundation and Contract Consolidation Report

**Status:** WP-7-A implementation/readiness report for WP-7 (Controlled project reader, Git inspection, and internal discovery (FFF)), prepared under the human-authorized WP-7-A package. **Senior-review corrections applied.** WP-7-B (runtime implementation) and WP-7-C (integration, security verification, and closure) are **not** authorized and have not started. Nothing was staged, committed, pushed, tagged, published, released, installed, or deployed; no dependency was added; no `src/**`, `tests/**`, `fixtures/**`, `schemas/**`, `package.json`, or generated artifact was modified.

## Repository, Branch, Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`.
- Baseline HEAD: `b07fea95d0a1ed20361dec441fc500766969536f` (`docs: close WP-6 Phase 3`); parent `49663a83cd406da9bd2854a031b2d7b2bb8c59f9`.
- Git state before work: staging empty; working tree clean; zero untracked paths; zero tags; WP-6 closed; no WP-7 implementation; no push/release.
- Contract of record: `docs/specs/wp-6-phase-3-point-of-use-v2-contract.md` — untouched.

## Authoritative-Source Hierarchy

| Source | Role | Authority level | Status | Relevant WP-7 material |
|---|---|---|---|---|
| `post-wp5a-roadmap.md` | Work-package roadmap (WP-7 attribute block, execution order, closure gate) | Normative planning (human-approved 2026-08-05; ADR-023 Accepted) | Authoritative and closed; current-state header updated by WP-7-A | WP-7 identity, prerequisites (WP-6), owned/prohibited, invariants, tests, non-goals, closure gate |
| `ADR-023-post-wp5a-sequencing.md` | Execution-order decision | Accepted ADR | Closed | WP-6 → WP-7 → WP-8 order; no dependency on WP-5A |
| `project-gateway-scope-and-principles.md` | WP-0 scope: FFF definition, MVP allowed/prohibited capabilities, component responsibilities, trust zones | Normative (WP-0) | Closed | FFF non-authority rules; read/Git capability list; Git-mutation prohibition |
| `trusted-workspace-and-ceiling-configuration.md` | WP-6 containment contract; F-EL1/F-EL2 | Accepted (ADR-024) | Closed | Containment decisions; F-EL2 point-of-use revalidation by WP-7/WP-11; root/rename rules |
| `post-wp5a-planning-status.md` | Deferred-item dispositions | Authoritative planning | Closed; current-state header updated by WP-7-A | WP-0 #7 layouts owned by WP-7/WP-11 (non-blocking) |
| `wp-6-phase-3c2-closure-readiness-report.md` | WP-6 closure record | Historical report | Closed | WP-6 closure evidence; no WP-7 content |
| `src/trusted/containment-*.ts` | Committed containment implementation | Committed code (authority over behavior) | Closed | `parseWorkspaceRelativePath`, `evaluateExistingPathContainment`, decision/request/options types, purposes `read`/`inspect` |
| `src/trusted/index.ts` | Internal trusted barrel | Committed code | Closed | `lookupValidatedWorkspace`, `isGenuineValidatedTrustedWorkspaceConfiguration` |
| ADR-024…027, `capability-vocabulary.md`, `pi-guard-compatibility-and-authority-projection.md` | WP-6/WP-5B contracts | Accepted | Closed | No direct WP-7 requirements; not modified |

No source conflict affects WP-7. Planning-era "WP-6 pending" wording in the two planning documents was superseded by the WP-6 closure and was corrected as current-state wording only; all historical planning decisions and execution-order rationale are preserved.

## Exact Added and Modified Paths

Added:
- `docs/specs/wp-7-controlled-reader-git-fff-contract.md` — the normative WP-7 contract (**237** normative requirements, 20 areas including 10B Hostile Request Capture, Appendices A/B).
- `docs/reports/wp-7a-foundation-contract-consolidation-report.md` — this report.

Modified (current-state status wording only):
- `docs/design/post-wp5a-roadmap.md` — header status block.
- `docs/design/post-wp5a-planning-status.md` — header status block.

Historical disposition narratives preserved. No ADR was created: every decision resolved in WP-7-A is implementation-owned and recorded in the normative contract; none requires a durable decision record beyond the contract.

## Senior-Review Finding Disposition

| Finding | Severity | Disposition |
|---|---|---|
| F-01 `parseWorkspaceRelativePath` not barrel-exported | MAJOR | Narrow future barrel-export model (CON-001): WP-7-B authorized to add exactly one re-export to `src/trusted/index.ts`; export-only; no behavior change. CMP-006 and PKG-006 updated with explicit exception language. DEC-002 lists the authorized path. |
| F-02 Empty path '' vs parser `.` conflict | MAJOR | PAT-001/PAT-005 corrected: request root token is exactly `.`; empty `''` rejected; internal combined root representation is `''`; results use `''` internally but requests must use `.` |
| F-04 TRU-008 phantom ID | MODERATE | Appendix A corrected: TRU-001…TRU-007 (7). Appendix B row 2 corrected. TRU-008 removed from all references. |
| F-05 Total count mismatch (221 vs 230 vs 231) | MODERATE | Complete re-enumeration: 237 requirements after restructuring (see inventory below). All counts internally consistent. |
| F-06 "16 security properties" for 14 IDs | MODERATE | Report now states 14 security properties (SEC-001…SEC-014). |
| F-07 Appendix B references TRU-001…008 | MODERATE | Corrected to TRU-001…007. |
| F-08 RD-015 split-code-point fork | MODERATE | Resolved: single normative behavior — fail with ERR-TEXT-MALFORMED. No "return valid prefix" alternative. |
| F-09 RD-016 NUL-in-text fork | MODERATE | Resolved: single normative behavior — fail with ERR-FTYPE-UNSUPPORTED. No "succeed as text" alternative. |
| F-10 GIT-024 unborn-repo fork | MINOR | Resolved: log returns zero records; show fails with ERR-GIT-STATE-UNSUPPORTED. Single normative behavior. |
| F-11 LIM-006 queue-or-fail fork | MODERATE | Resolved: immediate-fail concurrency model. No internal queue. Fifth concurrent admission fails with ERR-LIMIT-CONCURRENCY. |
| F-12 CON-007 sequence ordering | MINOR | Corrected to 10-step descriptor-bound sequence (CON-007). Revalidation before open; descriptor binding after open. |
| F-15 `..` carry-vs-reject mismatch | MODERATE | PAT-006 corrected: two-phase model (parse carries `..`; combine does bounded pop; escape fails closed). No longer claims parse-time rejection. |
| F-16 Request syntax vs internal representation | NOTE | PAT-001/PAT-005 distinguish request syntax (`.`) from internal combined representation (`''`). |
| F-17 Revalidation sequence mis-ordered | MAJOR | CON-007 completely rewritten with correct 10-step sequence: (1) capture → … → (5) point-of-use eval → (6) open → (7) bind → (8) verify → (9) operate → (10) return POU identity. |
| F-18 TOCTOU / root-replacement overclaim | MAJOR | SYM-009/SYM-010 rewritten: descriptor-bound model; fstat-after-open verification; explicit lane limits; root-replacement detection scoped; path-only fallback prohibited. |
| F-19 Revalidation detail gaps (identity, divergence, correlation) | MODERATE | CON-009: POU decision identity returned; prospective is advisory only. POU and prospective must agree on workspaceId, canonical path, resolution classification, containment outcome. Disagreement is ERR-CON-DENIED. INT-004 defines correlation shape. |
| F-20 list-directory d_type / kind ambiguity | MODERATE | RD-006: `kindHint` is non-authoritative; derived from directory entry type when available; unknown maps to `other`; no per-entry stat calls. |
| F-21 inspect-metadata lstat vs stat | MODERATE | RD-010: explicit lstat semantics for logical entry. Symlink reported as symlink. Resolved-target containment checked before returning. |
| F-22 Missing timestamp field in RD-010 | MODERATE | RD-010: modification timestamp removed. DET-006: timestamp reference removed. Closed metadata shape: kind, sizeBytes?, isRegularFile, isDirectory, isSymbolicLink, isSpecial. |
| F-23 byteLength ambiguity | MINOR | RD-013: `byteLength` defined as number of raw file bytes returned in the read window before UTF-8 decoding. |
| F-24 Uint8Array freeze not enforceable | MINOR | RD-018: copy-on-return ownership. Result object frozen; Uint8Array is a fresh copy. INT-011: mutation of caller copy cannot affect service state. |
| F-25 Special-file type-inspection race | MODERATE | SYM-013/RD-021: open first through descriptor-bound strategy; fstat on descriptor; only then accept/reject. Pre-open stat + separate path-open prohibited. |
| F-26 Request capture undefined | MODERATE | New Area 10B (HRC-001…HRC-004): explicit descriptor-safe snapshot model reusing `src/internal/snapshot.ts` pattern; accessor rejection; Proxy trap handling; freeze; no caller reread. |
| F-27 Git path policy undefined | MODERATE | GIT-003/GIT-004: host-lane contract. Initialization validates binary (canonical path, no symlinks, ownership, permissions, version). Fingerprint recorded and revalidated before every launch. Path not hard-coded in portable source. |
| F-29 `--no-optional-locks` placement | MINOR | GIT-016: explicit that `--no-optional-locks` is a Git-level option placed before the subcommand. Fixed global argv prefix documented. |
| F-31 Git log format not pinned | MINOR | GIT-019: exact NUL-framed format `--format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00` with `--date=iso-strict`. Parser validates field count; malformed framing fails closed. |
| F-33 Hostile local Git config → executable launch | MAJOR | GIT-011: closed rejection policy. Preflight parses `.git/config` as hostile bounded data; rejects repository on any `[include]`, `[includeIf]`, `core.fsmonitor`, `core.hooksPath`, `core.worktree`, `diff.*.command`, `diff.*.textconv`, `pager.*`, `credential.*`, `log.showSignature`, `gpg.*`. Fixed global argv includes `-c` overrides for all reachable keys. |
| F-34 alternates/commondir containment | MODERATE | GIT-006: reject `.git/commondir` and `objects/info/alternates`. Set `GIT_ALTERNATE_OBJECT_DIRECTORIES` empty. Unset `GIT_OBJECT_DIRECTORY` and `GIT_COMMON_DIR`. |
| F-35 replace refs for git-show | MINOR | GIT-016 global prefix includes `--no-replace-objects`. GIT-020 inherits it. |
| F-36 diff framing | MINOR | GIT-018: diff output is bounded raw text; no structural parsing; no security dependency on diff content. Explicit acknowledgment. |
| F-37 `-`-prefixed filenames | MINOR | GIT-018: filenames beginning with `-` are valid data when placed after `--`. Not rejected. |
| F-38 Sanitized environment contradictions | MINOR | GIT-022/GIT-023: `GIT_PAGER`, `GIT_EDITOR`, `GIT_ASKPASS`, `GIT_SSH_COMMAND` unset entirely. Pager/editor suppression via fixed `-c` argv and `--no-pager`. No executable-path environment values. |
| F-40 HOME/TMPDIR lifecycle | MODERATE | RO-002/RO-003: host-preprovisioned model. WP-7 never creates HOME/TMPDIR. Host supplies pre-existing read-only directories. Initialization fingerprints them. |
| F-41 HOME/TMPDIR not in fingerprint | MODERATE | RO-004: fingerprint now covers workspace, .git, HOME contents, TMPDIR contents, and Git binary/containing-path attributes. |
| F-42 Fingerprint gaps | MODERATE | RO-004/R-006: expanded fingerprint scope. Guarantee scoped to "workspace, repository internals, trusted HOME/TMPDIR directories, or any other path writable or reachable by the WP-7 child environment." |
| F-45 FFF access substrate undefined | MAJOR | FFF-003/FFF-004: controlled-reader capability model. Provider receives only `listDirectory`, `readText`, cancellation, and scan-budget. No `node:fs`, absolute roots, or direct containment access. Scan limits pinned (depth 32, entries 10k, files 2k, content 16 MiB, per-file 64 KiB). |
| F-46 FFF ranking semantics incomplete | MODERATE | FFF-011…FFF-016: exact scoring pinned (+1000 basename, +500 path, +1/occurrence capped at 100). Literal byte matching; no case folding; no regex. Score 0 omitted. Sort by score desc then path asc. Snippet from first occurrence; valid UTF-8 boundaries. Binary files not content-scanned. |
| F-47/F-48 Error mapping ambiguous | MODERATE | ERR-002: 23-code closed enumeration (added ERR-OP-CANCELLED, ERR-LIMIT-CONCURRENCY). Section 11.1: explicit condition-to-code mapping table now covering 23/23 codes. |
| F-49 Query limit unit ambiguous | MINOR | LIM-001/F-008: units specified as UTF-8 bytes for query length and snippet size. |
| F-50 Interface incompleteness | MODERATE | Area 10: exact operation-name literal union; discriminated request/result unions; OperationCorrelation shape; service lifecycle (construction options, initialization failure, dispose idempotency, singleton-per-config, concurrency ownership). |
| F-51 Barrel conflict with CMP-006 | MODERATE | CMP-006: explicit exception for single re-export line of `parseWorkspaceRelativePath` in `src/trusted/index.ts`. PKG-006 updated. DEC-002 authorizes the path. |
| F-52 Test-workflow coherence | MODERATE | CMP-004/CMP-008/VER-009/DEC-002/DEC-003: explicit lifecycle. WP-7-B adds separately runnable focused scripts (`test:wp7-reader`, `test:wp7-git`, `test:wp7-fff`, `test:wp7-security`). Default suite unchanged during WP-7-B. WP-7-C integrates focused suites into default workflow once. |
| F-56 Report: "21 error codes" (was correct) | MINOR | Updated to 23 after adding ERR-OP-CANCELLED and ERR-LIMIT-CONCURRENCY. |
| F-57 Report: "Limits 1…8" understates limit count | MINOR | Report now distinguishes requirement count (LIM-001…LIM-008, 8 requirements) from the number of pinned limit values within LIM-001. |
| F-03 Purpose `'read'` confirmed valid | NOTE | Verified; no action. |
| F-13 Implementation-owned defaults pattern | NOTE | Acknowledged; specific forks resolved. |
| F-14 Other WP-6 APIs correctly named | NOTE | Verified; no action. |
| F-28 Git 2.45.4 confirmed at expected path | NOTE | Verified; recorded in GIT-003. |
| F-32 `--porcelain=v1 -z` sound | NOTE | Verified; retained. |
| F-39 Empty PATH for read-only subcommands | NOTE | GIT-022: PATH set to empty. Acknowledged as safe for status/diff/log/show. |
| F-43 Atime limitation documented | NOTE | RO-005 retained. |
| F-44 `--no-optional-locks` + lock tripwire | NOTE | Retained as defense-in-depth. |
| F-54 No ADR required | NOTE | Senior review conclusion confirmed. |
| F-55 Documentation diffs accurate | NOTE | Verified; unchanged. |

## Contract Structure

`docs/specs/wp-7-controlled-reader-git-fff-contract.md`: 20 contract areas — 1 Scope and Non-Goals; 2 Trust Model; 3 Containment Reuse; 4 Path Model; 5 Symlink/Traversal/TOCTOU; 6 Controlled Read Surface; 7 Git Read-Only Inspection; 8 Read-Only Guarantee; 9 Internal FFF Discovery; 10 Internal Interfaces; 10B Hostile Request Capture; 11 Error and Finding Model; 12 Determinism; 13 Resource Bounds; 14 Package and API Boundary; 15 Compatibility; 16 Security Properties; 17 Test Matrix; 18 Verification and Acceptance; 19 Decomposition and Gates — plus Appendix A (requirement inventory, **237 normative requirements**) and Appendix B (acceptance matrix).

## Key Decisions Resolved in Corrections

1. **Path representation**: Request root token is `.`; empty request `''` rejected; internal combined root representation is `''`. Two-phase `..` model: parse carries; combine pops bounded by workspace root. Maximum request-path 4096 UTF-8 bytes.
2. **Barrel export**: WP-7-B authorized to add exactly one re-export of `parseWorkspaceRelativePath` to `src/trusted/index.ts`. Export-only; no behavior change.
3. **Descriptor-bound verification**: 10-step sequence with point-of-use containment before open, descriptor/handle opened relative to retained workspace-root descriptor, fstat verification on bound descriptor, reads bound to descriptor.
4. **Controlled-read semantics**: `kindHint` for listing; `lstat` for inspect-metadata; single normative NUL/truncation behaviors; copy-on-return for Uint8Array; fstat-after-open for special-file rejection.
5. **Git host lane**: Trusted absolute path validated at initialization (fingerprint + permissions + version); revalidated before every launch. Supported version 2.45.4.
6. **Git repository preflight**: Closed rejection of `.git/commondir`, alternates, and local config containing any executable-helper key. Exact fixed global argv with `-c` overrides for all attack surfaces.
7. **Git framing**: Exact NUL-framed format for log and show; porcelain v1 -z for status; raw bounded text for diff.
8. **Sanitized environment**: PATH empty; no `GIT_PAGER=cat`-style executable paths; all Git env vars unset except the controlled minimum set.
9. **HOME/TMPDIR**: Host-preprovisioned; WP-7 never creates them; fingerprint covers them plus Git binary.
10. **FFF access substrate**: Controlled-reader capability model; provider receives only `listDirectory`, `readText`, cancellation, and scan-budget.
11. **FFF ranking**: Pinned integer scoring; literal byte matching; no case folding or regex; valid-UTF-8 snippet boundaries; binary files not content-scanned.
12. **Error model**: 23 closed codes (added ERR-OP-CANCELLED, ERR-LIMIT-CONCURRENCY); complete 23/23 condition-to-code mapping table.
13. **Concurrency**: Immediate-fail model; 4 max concurrent; no internal queue.
14. **Request capture**: Descriptor-safe snapshot model (Area 10B) reusing committed `src/internal/snapshot.ts` pattern.
15. **Test workflow**: WP-7-B focused suites are separately runnable; default suite unchanged during WP-7-B; WP-7-C integrates.

## Error Model

23 closed operational error codes: ERR-REQ-INVALID, ERR-WS-UNKNOWN, ERR-CON-DENIED, ERR-SYM-ESCAPE, ERR-PAT-TRAVERSAL, ERR-FTYPE-UNSUPPORTED, ERR-NOT-FOUND, ERR-PERM-DENIED, ERR-LIMIT-SIZE, ERR-LIMIT-ENTRIES, ERR-LIMIT-RESULTS, ERR-LIMIT-CONCURRENCY, ERR-TEXT-MALFORMED, ERR-OP-CANCELLED, ERR-GIT-UNAVAILABLE, ERR-GIT-NOT-REPO, ERR-GIT-STATE-UNSUPPORTED, ERR-GIT-TIMEOUT, ERR-GIT-SANITIZED-FAILURE, ERR-FFF-UNAVAILABLE, ERR-FFF-TIMEOUT, ERR-FFF-MALFORMED, ERR-INTERNAL-INVARIANT. Complete 23/23 condition-to-code mapping table in contract Section 11.1.

## Limits

Pinned in LIM-001: read bytes 1 MiB; directory entries 10,000; Git output 8 MiB; Git log records 1,000; FFF results 100; FFF snippet 512 UTF-8 bytes; FFF query 256 UTF-8 bytes; request-path 4096 UTF-8 bytes; per-operation timeout 5 s; total budget 30 s; max concurrent 4; FFF scan depth 32; FFF visited entries 10,000; FFF candidate files 2,000; FFF total content 16 MiB; FFF per-file window 64 KiB.

## Security Boundary

14 normative security properties (SEC-001…SEC-014). The only executable is the fixed trusted Git binary under the constrained invocation contract with fingerprint verification at initialization and before every launch. No shell. No `GIT_PAGER=cat`-style secondary executable environment values. Local Git config rejection preflight prevents helper/config-based execution. Descriptor-bound containment with fstat verification. Home/TMPDIR host-preprovisioned with fingerprint evidence.

## Package Boundary

Internal modules only; no `src/index.ts` export; export map stays `.`/`./pi-adapter`. Single authorized `src/trusted/index.ts` barrel addition (one re-export line for `parseWorkspaceRelativePath`) during WP-7-B. Deep import from `src/trusted/containment-path.ts` prohibited.

## Compatibility Obligations

No change to public v1, PointOfUseInputs v2, WP-6 authority, schemas (51), rules (116), conformance (587), vectors (36), corpus (358), exports. Default test suite unchanged during WP-7-B. WP-7-B focused tests run separately. WP-7-C integrates them into the default suite.

## Phase Decomposition

WP-7-A (contract; senior review + focused correction review) → WP-7-B (implementation; authorized barrel re-export; separately runnable focused tests; senior review) → WP-7-C (integration, security verification, closure; independent closure review). No subphase is authorized by this report.

## Implementation-Readiness Matrix

| Area | Status |
|---|---|
| Inputs | COMPLETE |
| Outputs | COMPLETE |
| Path model | COMPLETE |
| Containment | COMPLETE |
| Symlink/TOCTOU | COMPLETE |
| Read operations | COMPLETE |
| Git operations | COMPLETE |
| FFF interface | COMPLETE |
| Error model | COMPLETE |
| Limits | COMPLETE |
| Determinism | COMPLETE |
| Security | COMPLETE |
| Package boundary | COMPLETE |
| Compatibility | COMPLETE |
| Tests | COMPLETE |
| Acceptance gates | COMPLETE |

All 16 areas: COMPLETE. No PARTIAL or ABSENT area remains. All 40 senior-review actionable findings have been addressed (senior-review correction). Six additional focused-rereview findings (R-01 through R-06) have been addressed in the final focused correction (see below).

---

## Final Focused-Rereview Correction Section

**Focused-rereview verdict:** Six findings (R-01…R-06) identified. All six are closed below.

### R-01 — Trusted AbortSignal Operand (MODERATE)

**Correction:** `AbortSignal` moved out of hostile request data into a separate `TrustedOperationControl` operand. The internal call model is `execute(requestData, control)` where `requestData` undergoes descriptor-safe snapshot capture and `control` is a trusted internal operand. `AbortSignal` MUST NOT appear inside the hostile request-data discriminated union. The signal is validated as a genuine platform object without invoking getters or conversion hooks. Only `aborted` state and add/remove listener are consumed; abort reasons are never exposed. Future trusted caller-supplied capabilities MUST use separate trusted operands.

**Contract locations:** Area 10.2 (rewritten request/control model), HRC-002 (deadline signals removed from snapshot scope, control separation documented), error-mapping table row for cancellation updated.

**Requirement-ID impact:** None. Existing INT-001…INT-013, HRC-001…HRC-004 remain at same counts; wording edited.

### R-02 — Complete 23-Code Error Mapping (MODERATE)

**Correction:** Five missing condition rows added to Section 11.1 mapping table: ERR-TEXT-MALFORMED, ERR-LIMIT-ENTRIES, ERR-LIMIT-RESULTS, ERR-FFF-UNAVAILABLE, ERR-GIT-NOT-REPO. Every operational error code now has exactly one primary condition row. All 23 codes covered.

**Contract locations:** Section 11.1 error-mapping table.

**Requirement-ID impact:** None.

**Error-mapping coverage:** 23 of 23 operational error codes.

### R-03 — Nonblocking Special-File Open (MINOR)

**Correction:** RD-021 updated to require `O_NONBLOCK` (or supported-lane equivalent, e.g. `fs.constants.O_NONBLOCK` on Node.js 22.23.2) for descriptor acquisition before type inspection. Descriptors for non-regular, non-directory files MUST be closed after rejection. Blocking FIFO open for type discovery is prohibited. Failure to obtain a safe nonblocking descriptor fails closed.

**Contract locations:** RD-021.

**Requirement-ID impact:** None. RD-021 edited.

### R-04 — Error-Code Naming Consistency (MINOR)

**Correction:** Renamed `ERR-TRAVERSAL` → `ERR-PAT-TRAVERSAL` and `ERR-CANCELLED` → `ERR-OP-CANCELLED` throughout the contract and report. All occurrences updated: ERR-002 enumeration, mapping table, path model (PAT-006), containment (SYM-007), cancellation (ERR-009), retryability, test matrix, and implementation-readiness matrix. Operational error-code count remains 23.

**Contract locations:** PAT-006, SYM-007, ERR-002, ERR-009, Section 11.1, implementation-readiness matrix.

**Requirement-ID impact:** None.

### R-05 — Deterministic Git Status Configuration (MINOR)

**Correction:** Added `-c status.showUntrackedFiles=normal` to the fixed global argv. The local repository configuration cannot change untracked-file behavior. `git status --porcelain=v1 -z` observes the pinned normal policy. GIT-017 updated to reference the fixed override.

**Contract locations:** Section 7.6 fixed argv, GIT-017.

**Requirement-ID impact:** None.

### R-06 — Empty Pager Overrides (MINOR)

**Correction:** Changed `-c pager.status=false`, `-c pager.diff=false`, `-c pager.log=false`, `-c pager.show=false` to `-c pager.status=`, `-c pager.diff=`, `-c pager.log=`, `-c pager.show=` (empty values). No executable name is supplied for any pager configuration. Retained: `--no-pager`, `-c core.pager=`, empty PATH, and unset pager environment variables. The only executable WP-7 may launch remains the trusted Git binary.

**Contract locations:** Section 7.6 fixed argv.

**Requirement-ID impact:** None.

### Implementation-Readiness Matrix (post final correction)

All 16 areas independently reassessed. Every area: **COMPLETE**.

| Area | Status | Evidence |
|---|---|---|
| Inputs | COMPLETE | Separate `TrustedOperationControl` for AbortSignal; hostile request data isolated |
| Outputs | COMPLETE | Unchanged |
| Path model | COMPLETE | Unchanged |
| Containment | COMPLETE | Unchanged |
| Symlink/TOCTOU | COMPLETE | Unchanged |
| Read operations | COMPLETE | O_NONBLOCK special-file open pinned (RD-021) |
| Git operations | COMPLETE | `-c status.showUntrackedFiles=normal`; empty pager values; exact argv validated |
| FFF interface | COMPLETE | Unchanged |
| Error model | COMPLETE | 23/23 condition-to-code mapping; ERR-PAT-TRAVERSAL, ERR-OP-CANCELLED renamed |
| Limits | COMPLETE | Unchanged |
| Determinism | COMPLETE | Unchanged |
| Security | COMPLETE | No executable-valued pager configuration; AbortSignal in trusted operand |
| Package boundary | COMPLETE | Unchanged |
| Compatibility | COMPLETE | Unchanged |
| Tests | COMPLETE | Unchanged |
| Acceptance gates | COMPLETE | Unchanged |

### Temporal Sequence

1. Initial WP-7-A package (contract + report).
2. Senior review — CORRECTIONS REQUIRED (40 findings).
3. Senior-review correction — addressed all 40 findings.
4. Focused rereview — CORRECTIONS REQUIRED (6 findings: R-01…R-06).
5. This final focused correction — addresses all 6 findings.
6. Final rereview — accepted.
7. WP-7-A baseline commit — `64623c78b167c9aa50ab9c2e5f146e7cc9741c34`.
8. Human-authorized GIT-018 erratum — applied after the WP-7-A baseline commit (see below).

---

## GIT-018 Erratum Note (human-authorized)

A narrow, human-authorized erratum was applied to the normative contract after the WP-7-A baseline commit:

- **Original accepted contract text** (GIT-018) specified `diff --no-color --no-ext-diff --textconv=false`.
- **Git 2.45.4 rejects** the `--textconv=false` syntax (`error: option 'textconv' takes no value`); the supported lane accepts `--no-textconv`.
- **The human-authorized erratum** replaces `--textconv=false` with `--no-textconv` in GIT-018.
- **Security intent is unchanged**: textconv (external text-conversion commands) remains disabled; `--no-textconv` is the exact semantic equivalent accepted by the supported Git version and is part of the fixed allowlisted diff argv alongside `--no-ext-diff`, `-c diff.external=`, and `-c core.attributesfile=/dev/null`.
- **Requirement ID remains GIT-018**; requirement numbering, error codes, limits, and the requirement inventory (237 normative requirements) are unchanged.
- **No source implementation was changed by the erratum**: the WP-7-B implementation already used `--no-textconv`; the erratum aligns the normative contract with the implementation.
- The earlier review records (including this report's historical finding rows) accurately recorded the pre-erratum contract text and remain valid as superseded history.

---

## Baseline Verification (unchanged implementation totals)

- Production typecheck PASS; test typecheck PASS.
- PointOfUse-v2 232/232; repository default `npm test` 1357/1357; trusted 570/570; integration 100/100; security 14/14; conformance 587/587; schemas 51; semantic rules 116; artifact RULE matrix 228; digest vectors 36; corpus inputs 358; generation reproducible (zero diff); `git diff --check` PASS.

## Git State After Final Focused Corrections

- HEAD unchanged `b07fea95d0a1ed20361dec441fc500766969536f`.
- Working tree: 2 modified tracked paths (planning-document headers) + 2 untracked paths (corrected contract, corrected report). Nothing staged; zero tags; no push; no release; no deployment; no WP-7-B work.

## Readiness Verdict

**WP-7-A FINAL FOCUSED CORRECTION: READY FOR FINAL REREVIEW**

BASELINE WP-6 CLOSURE: b07fea95d0a1ed20361dec441fc500766969536f
WP-7-A FINAL CONTRACT CORRECTION: COMPLETE
FOCUSED-REREVIEW FINDINGS CLAIMED CLOSED: 6
WP-7 IMPLEMENTATION CONTRACT: READY FOR FINAL REREVIEW
WP-7-A COMMIT AUTHORIZATION: NOT GRANTED
WP-7-B IMPLEMENTATION AUTHORIZATION: NOT GRANTED
WP-7-C INTEGRATION/CLOSURE AUTHORIZATION: NOT GRANTED
IMPLEMENTATION COMMITTED: NO
NEXT GATE: WP-7-A FINAL REREVIEW
WP-7 STATUS: NOT YET IMPLEMENTED
