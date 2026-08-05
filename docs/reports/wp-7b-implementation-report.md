# WP-7-B — Controlled Reader, Git Inspection, and Internal FFF — Implementation Report

**Status:** WP-7-B runtime implementation, corrected per the WP-7-B senior review (findings S-01…S-10), with the human-authorized GIT-018 erratum applied (GIT-018 now normatively requires `--no-textconv`, which the implementation already used; no source change was required). WP-7-B remains pending final focused rereview and is **not** accepted or committed. WP-7-C (integration, security verification, and closure) is **not** authorized and has not started. Nothing was staged, committed, pushed, tagged, published, released, installed, or deployed.

## Repository, Branch, Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`.
- Baseline HEAD: `64623c78b167c9aa50ab9c2e5f146e7cc9741c34` (`docs: establish WP-7-A contract baseline`).
- WP-7-A contract SHA-256: `642a5309b157e25f5bc76c500297e3d298277286437505715d87fcacc27fad81` (unchanged).

## Isolated Clean-Baseline Test Counts (independent forensics)

An isolated detached worktree at `64623c78b167c9aa50ab9c2e5f146e7cc9741c34` was created, generated output cleared, and all suites run:

| Suite | Isolated clean-baseline count | Passed |
|---|---|---|
| Production typecheck | — | PASS |
| Test typecheck | — | PASS |
| Default `npm test` | 1357 | 1357 |
| Trusted | 570 | 570 |
| Security | 14 | 14 |
| Integration | 100 | 100 |
| PointOfUse-v2 | 232 | 232 |

**Conclusion:** the accepted WP-7-A report numbers (1357/570/14/100/232) are factually reproducible. The senior-review suggestion that the clean commit produces 1356 (or 1355 with WP-7-B files, trusted 569, security 13) is **not reproducible** and is classified as a baseline-report discrepancy (no such counts occur from a clean checkout).

## Active Pre-Correction Counts and Regression Root Cause

With WP-7-B files present and generated output cleaned, the default suite discovered **1357 tests with 2 failures**:

1. `security: production modules perform no hidden filesystem/network/process I/O` — the pre-existing static audit scans all `dist/` for `node:fs`/`node:child_process`/`process.env` imports. WP-7 modules intentionally perform constrained filesystem and process I/O under the accepted contract. The repository convention already excludes module boundaries with their own security suites (the Pi adapter); WP-7 now follows the same convention with `tests/wp7/security`.
2. `H: internal barrel exposes only cohesive Phase-2A entry points` — asserted `parseWorkspaceRelativePath` is NOT barrel-exported. The WP-7 contract (CON-001, CMP-006, DEC-002) authorizes exactly this single re-export.

**Root cause:** contract-authorized changes that required the two pre-existing tests to be updated to the new authoritative reality — not a test regression, not stale generated output, not changed discovery.

**Correction:** (1) the security audit excludes `/reader/`, `/git/`, `/fff/` by boundary (same pattern as `/adapters/`), with the WP-7 security suite asserting the constrained properties; (2) the barrel test asserts `parseWorkspaceRelativePath` is now exported and all other low-level helpers remain module-local.

**Final counts:** default 1357/1357, trusted 570/570, security 14/14, integration 100/100, PointOfUse-v2 232/232 — **zero negative delta** versus the isolated clean baseline for every pre-existing suite.

## Senior-Review Finding Disposition

| Finding | Severity | Resolution |
|---|---|---|
| S-01 Illegal `new AbortSignal()` | MAJOR | Removed from all three services; replaced with `new AbortController().signal`. Listener cleanup (`removeEventListener`) added on every settling path in reader/git/fff execution frameworks. Direct tests cover omitted control, empty control, genuine signal, already-aborted signal, abort during operation, forged control, and repeated operations. |
| S-02 Empty focused suites | MAJOR | All four suites are now nonzero: reader 62, git 37, fff 17, security 17 (133 total), each passing twice consecutively. |
| S-03 Regression restoration | MAJOR | See forensics above. Zero negative delta versus the independently verified clean baseline. |
| S-04 Preflight-to-launch revalidation | MODERATE | `captureRepositoryPreflightFingerprint` + `revalidateRepositoryPreflightFingerprint` in `src/git/preflight.ts`; `preflight()` + `revalidateBeforeLaunch()` in `GitInspectionService` revalidate Git-binary fingerprint, repository fingerprint (`.git` identity, config dev/ino/size/mode/mtime/SHA-256, commondir/alternates presence) and cancellation immediately before every launch. Tests mutate config/commondir/alternates between preflight and launch. |
| S-05 Static child_process import | MODERATE | Removed the dynamic `await import('node:child_process')` from `git/service.ts`; unborn-repo detection now uses contained reads (`isUnbornRepository` in preflight). `node:child_process` is imported statically only in `git/wrapper.ts` (constrained wrapper) and `git/host-lane.ts` (fixed `['--version']` verification of the trusted binary). Static audit test asserts exactly these two owners and no `shell: true`. |
| S-06 HOME/TMPDIR validation | MODERATE | `validateHostDirectory` in `src/git/host-lane.ts`: absolute canonical path, exists, directory, no symlink component, owner root/service user, not group/world writable, outside all workspace roots, empty at initialization, distinct HOME/TMPDIR. Enforced in the `GitInspectionService` constructor. Tests cover writable dirs, symlink component, nonempty dir, inside-workspace, mode violations. |
| S-07 Descriptor identity binding | MODERATE | `statResolvedTarget` + `verifyDescriptorIdentity` in `src/reader/fs.ts`; `bindDescriptor` in the reader service compares dev/inode/type of the opened descriptor against a trusted internal stat of the containment-resolved absolute target taken immediately around descriptor acquisition. Fail closed on mismatch; no reopen through the user path. |
| S-08 `as any` readdirSync bypass | MINOR | Removed. Directory enumeration now uses `opendirSync('/proc/self/fd/<fd>')` — type-safe and still descriptor-bound. Focused directory enumeration test added. |
| S-09 Report accuracy | MINOR | This report. No unsupported claims; deviations and evidence are recorded exactly. |
| S-10 Contract traceability | MINOR | Full 20-group traceability section below. |

## Trusted Import Boundary Audit

All WP-7 imports of WP-6 trusted modules were converted to the authorized internal barrel:

- Before: deep imports from `../trusted/types.js`, `../trusted/configuration-brand.js`, `../trusted/validate.js`, `../trusted/containment-validate.js`, `../trusted/containment-resolver.js`, `../trusted/containment-types.js`, `../trusted/containment-path.js`, `../trusted/containment-identity.js`.
- After: single barrel import from `../trusted/index.js` in `reader/service.ts`, `reader/types.ts`, `git/service.ts`.
- The only WP-6 source modification remains the single authorized re-export (`export { parseWorkspaceRelativePath } from './containment-path.js';`) in `src/trusted/index.ts`.
- The runtime-genuineness brand check is enforced by committed WP-6 machinery (`evaluateExistingPathContainment` TCP-021 and `lookupValidatedWorkspace` brand gate); WP-7 does not duplicate the brand check (CON-004 single-source-of-truth), because `isGenuineValidatedTrustedWorkspaceConfiguration` is not barrel-exported and CMP-006 authorizes exactly one re-export.

## AbortSignal Correction (S-01)

- `new AbortSignal()` removed from `src/reader/service.ts`, `src/git/service.ts`, `src/fff/provider.ts`.
- Default no-signal execution uses `new AbortController().signal` (never aborted, valid platform signal).
- Every execution framework removes its abort listener on success, failure, cancellation, timeout, and disposal via a `cleanup()` closure.
- Abort reasons are never disclosed; failures use `ERR-OP-CANCELLED` with a safe message key.
- No mutable abort controller is shared across operations; each `execute`/`discover` call creates its own listener wiring on the caller-supplied (or default) signal.
- No unhandled rejection: `Promise.race` with the abort promise is always awaited inside `try/catch`.

## Focused Test Inventory and Both-Run Totals

| Suite | Files | Run 1 | Run 2 |
|---|---|---|---|
| `test:wp7-reader` | `tests/wp7/reader/capture.test.ts`, `tests/wp7/reader/reader.test.ts` | 62/62 | 62/62 |
| `test:wp7-git` | `tests/wp7/git/git.test.ts` | 37/37 | 37/37 |
| `test:wp7-fff` | `tests/wp7/fff/fff.test.ts` | 17/17 | 17/17 |
| `test:wp7-security` | `tests/wp7/security/security.test.ts` | 17/17 | 17/17 |
| **Total** | 5 files | **133/133** | **133/133** |

Every suite is independently runnable via its npm script, discovers at least one test file, and fails if zero tests run (node --test reports a failure on empty discovery).

## Descriptor Identity Binding (S-07)

- Point-of-use containment decision supplies `resolvedAbsolutePath` (trusted-process-internal).
- `statResolvedTarget` captures dev/inode/type of the accepted resolved target immediately around descriptor acquisition.
- The target is opened through `/proc/self/fd/<rootFd>/<relative>` with `O_NONBLOCK` (no blocking FIFO open); `O_NOFOLLOW` is intentionally not applied to the final component because containment resolves the full symlink chain and the identity binding detects swaps after open.
- `fstat` on the opened descriptor; `verifyDescriptorIdentity` compares dev, inode, and object type. Mismatch → `ERR-CON-DENIED`; descriptor closed; no reopen through the user path.
- Applied to list-directory, read-text, and read-bytes.
- The contract's "descriptor/path divergence" race is bounded by the dev/ino comparison; the residual pre-open race is documented (no atomicity claim).

## Preflight Revalidation (S-04)

Immediately before process creation, in order:
1. `revalidateGitHostLane` — Git binary fingerprint (dev, inode, mode, size, mtime, SHA-256).
2. `revalidateRepositoryPreflightFingerprint` — `.git` directory identity, `.git/config` existence/type/dev/ino/size/mode/mtime/content digest, commondir presence, alternates presence.
3. Cancellation check (`signal.aborted`).
4. Fixed argv construction (`buildGitArgv`) and fresh sanitized environment.
5. Launch of the trusted Git executable with `cwd` pinned to the workspace root.

Any drift returns a deterministic fail-closed error (`ERR-GIT-UNAVAILABLE` or `ERR-GIT-STATE-UNSUPPORTED`) without launching. Raw paths or changed content are never disclosed. The residual race between revalidation and exec is documented; no atomicity is claimed.

## HOME/TMPDIR Validation (S-06)

`validateHostDirectory` (enforced at `GitInspectionService` construction):
- absolute canonical path; exists; is a directory; no symlink path component (per-component lstat walk); owner is root or the effective uid; not group-writable; not world-writable; outside every configured workspace root; empty at initialization; HOME ≠ TMPDIR.
- A mode-bit check is supplemented by the empty/owner checks; where the process is root and read-only enforcement for the child cannot be established, initialization fails rather than claiming read-only.
- Mutation evidence fingerprints HOME and TMPDIR before and after every Git operation (tests).

## Static Child-Process Ownership (S-05)

- `node:child_process` static imports exist only in `src/git/wrapper.ts` (constrained `execFile` wrapper, `shell: false`, fixed argv, sanitized env, cwd pinned) and `src/git/host-lane.ts` (fixed `['--version']` verification of the trusted binary).
- No dynamic imports; no general subprocess export; no alternate launch path.
- Security suite test asserts the exact owner set and forbids `shell: true`.

## Git Argument Validity — Contract Deviation (resolved by human-authorized erratum)

The pre-erratum contract GIT-018 pinned `--textconv=false`; Git 2.45.4 rejects that form (`error: option 'textconv' takes no value`). The implementation used `--no-textconv`, the exact semantic equivalent accepted by the supported Git version (verified: `git diff --no-color --no-ext-diff --no-textconv` runs cleanly).

**After the human-authorized GIT-018 erratum**, the normative contract now requires `--no-textconv` (the Git 2.45.4-compatible option that disables textconv and is part of the fixed allowlisted diff argv). The implementation already used `--no-textconv`, so **no production or test source change was required** by the erratum. The prior contract block is resolved; current runtime contract deviations: **0**. All other fixed options validated against Git 2.45.4.

## Read-Only Mutation Evidence (M)

Deterministic test-only fingerprinting implemented in `tests/wp7/security/security.test.ts`:
- workspace path set, file content SHA-256, sizes, modes (atime excluded per RO-003/RO-005);
- `.git` (index, refs, config, objects via the full tree walk), lock files (`.lock` detection);
- HOME and TMPDIR contents; Git binary SHA-256;
- child-process lifecycle (no orphaned git processes via `/proc` scan).

Covered operations: list-directory, inspect-metadata, read-text, read-bytes, git-status, git-log, fff-discover; failure paths: invalid request, traversal denial, drift detection. atime is excluded exactly as the contract permits (RO-003/RO-005) and the lane's relatime behavior is documented in the fingerprint design.

## Exact Source Inventory

```
src/reader/types.ts        src/reader/errors.ts       src/reader/capture.ts
src/reader/admission.ts    src/reader/fs.ts           src/reader/service.ts
src/reader/index.ts        src/git/host-lane.ts       src/git/preflight.ts
src/git/wrapper.ts         src/git/service.ts         src/fff/provider.ts
src/trusted/index.ts       (single authorized re-export line)
```

## Exact Test-File Inventory

```
tests/wp7/helpers.ts
tests/wp7/reader/capture.test.ts
tests/wp7/reader/reader.test.ts
tests/wp7/git/git.test.ts
tests/wp7/fff/fff.test.ts
tests/wp7/security/security.test.ts
```

## Contract Traceability (S-10)

Legend: **T** = implemented and directly tested; **A** = implemented and structurally audited (static security tests / code audit); **W6** = inherited from committed WP-6 behavior; **D** = documentation/phase-gate requirement; **–** = not satisfied.

| Group | Source modules | Focused tests | Evidence | Status |
|---|---|---|---|---|
| SCO (1–13) | All WP-7 modules | security static audits; reader/git/fff suites | No public export, no mutation API, fixed-executable model | T/A |
| TRU (1–7) | capture.ts, service.ts | capture tests, security no-disclosure test | Hostile capture; fail-closed; FFF non-authority (fff tests) | T |
| CON (1–10) | service.ts (barrel imports) | reader tests (containment denials), git tests | Committed machinery consumed via barrel only; point-of-use identity returned | T/W6 |
| PAT (1–10) | capture.ts, service.ts | reader tests (root ., empty rejection, length, traversal) | Parser-compatible grammar; 4096-byte bound | T/W6 |
| SYM (1–14) | service.ts, fs.ts | reader tests (symlinks, escape, FIFO) | Descriptor-bound verification; lane limits | T |
| RD (1–21) | fs.ts, service.ts | reader tests (62) | All four operations + special-file O_NONBLOCK | T |
| GIT (1–25) | git/* | git tests (37) + security | Host lane, preflight, argv, framing, env | T |
| RO (1–12) | wrapper.ts, preflight.ts | security mutation tripwires | Workspace/.git/HOME/TMPDIR/binary fingerprints | T |
| FFF (1–22) | fff/provider.ts | fff tests (17) | Capability model, scoring, budgets, cancellation | T |
| INT (1–13) | reader/types.ts, index.ts | reader/git/fff suites | Discriminated unions, correlation, lifecycle | T |
| HRC (1–4) | capture.ts | reader capture tests | Snapshot hardening, no getter invocation | T |
| ERR (1–10) | reader/errors.ts | capture tests, security | 23 codes, mapping, retryability | T |
| DET (1–10) | all | reader ordering, fff determinism, git log sort | Byte-order sorts; deterministic tie-breaks | T |
| LIM (1–8) | reader/types.ts, admission.ts | reader concurrency, capture limits | 4-op cap, immediate fail, byte bounds | T |
| PKG (1–8) | reader/index.ts | security static audits | Internal barrel; no public export; no dependency | T/A |
| CMP (1–8) | — | full regression runs | All pre-existing counts unchanged | A |
| SEC (1–14) | all | security suite (17) | Static + dynamic security evidence | T/A |
| TST (1–8) | tests/wp7/** | all focused suites | All categories executed | T |
| VER (1–12) | — | verification matrix below | Typecheck, suites, reproducibility | T/A |
| DEC (1–8) | — | — | Phase gates; WP-7-B/C not authorized | D |

No group is ABSENT. All 237 normative requirements are satisfied: implemented-and-tested, structurally audited, inherited from committed WP-6 behavior, or phase-gate documentation requirements — none is unsatisfied.

## Regression Totals and Deltas

| Pre-existing suite | Isolated clean baseline | Final WP-7-B | Delta |
|---|---|---|---|
| Default `npm test` | 1357 | 1357 | 0 |
| Trusted | 570 | 570 | 0 |
| Security | 14 | 14 | 0 |
| Integration | 100 | 100 | 0 |
| PointOfUse-v2 | 232 | 232 | 0 |
| Schemas | 51 | 51 | 0 |
| Semantic rules | 116 | 116 | 0 |
| Artifact RULE matrix | 228 | 228 | 0 |
| Digest vectors | 36 | 36 | 0 |
| Corpus inputs | 358 | 358 | 0 |

## Full Verification Matrix (from clean generated output)

1. Production typecheck — PASS
2. Test typecheck — PASS
3. `test:wp7-reader` — 62/62 (run 1), 62/62 (run 2)
4. `test:wp7-git` — 37/37 (run 1), 37/37 (run 2)
5. `test:wp7-fff` — 17/17 (run 1), 17/17 (run 2)
6. `test:wp7-security` — 17/17 (run 1), 17/17 (run 2)
7. Repository-default `npm test` — 1357/1357
8. PointOfUse-v2 — 232/232
9. Trusted — 570/570
10. Integration — 100/100
11. Security — 14/14
12. Conformance — 587/587 (via integration conformance runner)
13. Schema assertions — 51
14. Semantic-rule assertions — 116
15. Artifact RULE matrix — 228
16. Digest vectors — 36
17. Corpus generation — run twice, byte-identical (51 schemas, 358 inputs)
18. `git diff --check` — PASS

## Deviations from Contract

None. The previously documented deviation (GIT-018 `--textconv=false` → `--no-textconv`) is **resolved** by the human-authorized GIT-018 erratum: the normative contract now requires `--no-textconv`, which the implementation already used. No production or test source change was required by the erratum.

## Open Findings

None.

## Git State

- HEAD: `64623c78b167c9aa50ab9c2e5f146e7cc9741c34` (unchanged).
- Staging: empty; zero tags.
- All WP-7-B changes unstaged: `package.json` (scripts), `src/trusted/index.ts` (re-export), `src/reader/**`, `src/git/**`, `src/fff/**`, `tests/wp7/**`, this report.
- package-lock unchanged; no dependency, schema, fixture, conformance, vector, corpus, adapter, or public-export change.

## Readiness Verdict

**WP-7-B SENIOR-REVIEW CORRECTION: READY FOR FOCUSED REREVIEW**

BASELINE WP-7-A COMMIT: 64623c78b167c9aa50ab9c2e5f146e7cc9741c34
WP-7-B SENIOR-REVIEW FINDINGS CLAIMED CLOSED: 10
WP-7-B RUNTIME IMPLEMENTATION: READY FOR FOCUSED REREVIEW
WP-7-B FOCUSED TEST SUITES: 4 OF 4 NONZERO AND PASSING
WP-7-B CONTRACT TRACEABILITY: COMPLETE
WP-7 CONTRACT DEVIATIONS: 0 (the previously documented GIT-018 deviation is resolved by the human-authorized erratum; GIT-018 now normatively requires `--no-textconv`, which the implementation already used)
WP-7-B IMPLEMENTATION COMMITTED: NO
WP-7-B COMMIT AUTHORIZATION: NOT GRANTED
WP-7-C INTEGRATION/CLOSURE AUTHORIZATION: NOT GRANTED
NEXT GATE: WP-7-B FINAL FOCUSED REREVIEW
WP-7 STATUS: IMPLEMENTATION IN PROGRESS — NOT CLOSED
