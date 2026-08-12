# PS-1 — Gateway Operator Bootstrap — Senior Security/Architecture Review

**Reviewer role:** SENIOR SECURITY / ARCHITECTURE REVIEWER (read-only).
**Review type:** Risk-focused senior review of uncommitted PS-1 implementation.
**Mode:** READ-ONLY. No files modified, nothing staged, nothing committed,
nothing pushed/tagged/published/deployed. The only file created is this
report (left uncommitted, per instruction).

---

## 1. Baseline and reviewed tree identity

| Item | Value |
|---|---|
| Expected baseline HEAD | `0720476b240f74372c7f1d0d1a78290b19537801` |
| Actual baseline HEAD | `0720476b240f74372c7f1d0d1a78290b19537801` ✔ match |
| Baseline subject | `docs: close WP-15 release readiness` |
| Reviewed tree | baseline + uncommitted PS-1 working-tree changes |
| `git diff --check` | clean (exit 0) |
| Staged changes | none (`git diff --cached` empty) |

## 2. Scope

**In scope:** all PS-1 production files, tests, guards, and documentation in
the working tree diff:

- New production: `src/control-plane/storage-bootstrap-action.ts`,
  `src/bootstrap/run.ts`.
- Modified production: `src/runtime/mcp/cli.ts`, `src/runtime/mcp/config.ts`,
  `src/storage/initialization/initialize.ts` (comment-only),
  `src/storage/trusted-input/bootstrap-input.ts` (comment-only).
- New tests: `tests/unit/bootstrap-action.test.ts`,
  `tests/unit/bootstrap-static-guard.test.ts`,
  `tests/runtime/bootstrap.test.ts`.
- Modified tests: `tests/security/security.test.ts`,
  `tests/unit/storage/static-guard.test.ts`,
  `tests/unit/wp12-static-guard.test.ts`.
- Docs: `docs/decisions/ADR-041-operator-bootstrap-command.md` (new),
  `docs/operations/project-gateway-operator-runbook.md` (§2.8, §2.5 note,
  §4 PILOT-WP15-001 correction), `docs/design/wp-14b-operator-onboarding.md`.

**Excluded (mandated, untouched, pre-existing):** WP-13D debris —
`docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`,
`src/retrospective/`, `tests/unit/wp13d-retrospective.test.ts`,
`tests/unit/wp13d-static-guard.test.ts`. Verified untouched: no PS-1 file
imports or references them (grep: zero hits), and their file mtimes
(1786381624) predate all PS-1 files (1786547220+), consistent with the
"pre-existing untracked debris" claim.

## 3. Architectural assessment

The approved objective — "smallest correct production OPERATOR-ONLY bootstrap
path" — is met with exactly the two new production modules claimed and no
second initialization engine:

- `src/bootstrap/run.ts` is an operator CLI runner (arg parse → bounded
  config load → per-surface action composition → deterministic output). It
  imports no MCP SDK (verified in compiled `dist/bootstrap/run.js`: zero
  `@modelcontextprotocol` references), no network/subprocess/env/time
  vocabulary, and never constructs the server.
- `src/control-plane/storage-bootstrap-action.ts` is I/O-free; all host
  observation is injected through the WP-6 resolver seam (same contract as
  the committed WP-14A lanes). It mints the genuine provenance, invokes the
  **unchanged** `initializeTrustedStore()`, and re-verifies through the
  committed `verifyStoreInstance` pipeline.
- `initialize.ts` and `bootstrap-input.ts` diffs are comment-only
  (verified in the raw diff); the orchestrator, capability machinery,
  brand WeakSets, and correlation checks are byte-for-byte baseline.

The two-loader design (`loadRuntimeConfig` / `loadBootstrapConfig`) shares
one closed validator (`parseStartupConfigDocument` + `validateSurface` with a
`requireConfigurationIdentity` flag), so structural drift between profiles is
impossible; runtime validation is never weakened (identity REQUIRED in
runtime profile — verified by test and by inspection of
`validateSurface`).

## 4. Authority-boundary assessment

**Where `StorageBootstrapActionProvenance` can be created.** The creator
`createStorageBootstrapActionProvenance` is exported only from
`src/storage/trusted-input/bootstrap-input.ts` (module-private WeakSet
branding, frozen fields, input validation). The storage static guard
(`tests/unit/storage/static-guard.test.ts`, creator-consumer edge test)
parses **import graphs** (named/namespace/default/export-from, alias
unwrapped) across all production sources and pins the consumer set to
exactly:

1. `src/control-plane/storage-bootstrap-action.ts` (PS-1 bootstrap action),
2. `src/runtime/mcp/compose.ts` (pre-existing WP-9 runtime composition root).

**Production importers:** exactly those two call sites
(`storage-bootstrap-action.ts:204`, `compose.ts:102`); no other module
imports the creator. `src/storage/index.ts` must not and does not re-export
creators; `export * from` outside the top barrel is denied; a dedicated test
proves no storage module re-exports creators, plain or aliased.

**Plain-object forgery.** Brands are module-private `WeakSet`s; lookalikes
fail `isGenuine*` (unchanged baseline). No serialization boundary carries a
branded object (results exclude provenance; `JSON.stringify` of results
asserted to contain no `actionIdentity`/`"provenance"`/brand material).

**Escape surfaces (all checked):**

| Surface | Result |
|---|---|
| package root (`.` / `src/index.ts`) | no `bootstrap`/`control-plane`/creator references (grep + live `import('./dist/index.js')` key scan: empty) |
| `./mcp` (`src/adapters/mcp/index.ts`) | no bootstrap/provenance exports; comment-only |
| `./pi-adapter` | no bootstrap/`initializeTrustedStore` references |
| `./loading` | no references |
| CLI JSON output (`--output` file and stdout document) | resolved config facts only; no provenance/authority (tested both paths) |
| stderr | bounded `writeDiagnostic` (2048-char, single-line); contains only the derived identity digest — a non-authority config digest also present in the emitted runtime config |
| MCP server | `server.ts` has no bootstrap import/call (asserted); requests dispatch only into the nine-tool registries |

**Operand influence.** Every provenance field is host/operator-owned:
`actionIdentity` (module constant), `locator` (bootstrap config, validated
absolute), `serviceUid` (config or process UID), `forbiddenRoots` (config),
`configurationIdentity` (derived from the WP-6-validated canonical
configuration — never caller-supplied), `limitProfile` (config merged on
defaults). No request, artifact, model input, or runtime-tool operand can
reach the provenance. ✔

**Guard quality (names/text vs graph).** The storage guard is a genuine
import-edge scan with alias unwrapping and negative synthetic samples
(W8C-S05 export-from/alias detection), not a name-presence check. The
wp12/bootstrap additions use `content.includes(...)` positive assertions,
but the authority localization itself is enforced by the import-edge pin —
the combination is meaningful. See SIR-PS1-003 for a pre-existing scan
limitation (namespace/dynamic imports).

**Result:** no ordinary public consumer can mint genuine bootstrap
authority. The header comment of `storage-bootstrap-action.ts` and
implementation-report §5 overstate the exclusivity (see SIR-PS1-001), but
the enforceable invariant — two pinned trusted composition roots — holds.

## 5. Identity-derivation assessment

Full trace verified:

```
raw JSON → readBoundedStartupConfig (1 MiB ceiling, fd-bound, duplicate-key
  rejection, closed fields, LMT-013 limit gate)
  → validateSurface (bootstrap profile: identity optional, format-checked if
    present) → loadBootstrapConfig
  → buildActionInputs (surfaces, resolvers from lanes.ts)
  → validateTrustedWorkspaceConfiguration (WP-6 Phase-1, real resolvers,
    TRUSTED_SOURCE_KIND, TRUSTED_HOST_LANE, CAPABILITY_VOCABULARY_VERSION —
    byte-identical constants to the committed WP-14A lanes)
  → computeTrustedConfigurationIdentity(configuration).digest
  → pinned: derived === configuration.identity (validator-internal invariant)
  → caller-supplied identity compared only: mismatch →
    ERR-BOOT-IDENTITY-CONFLICT BEFORE any storage mutation (tested: no
    store-v1/ created)
  → provenance minted with derivedIdentity
  → initializeTrustedStore (metadata binds configurationIdentity =
    derivedIdentity)
  → verifyStoreInstance with configurationIdentity = derivedIdentity
  → resolved runtime surface carries derivedIdentity → emitted config →
    loadRuntimeConfig (strict profile) accepts verbatim (tested)
```

- **Drift between profiles:** structurally impossible (one validator, one
  flag); runtime profile failure for an absent identity is asserted
  (bootstrap-loaded doc → runtime loader rejects).
- **Weakening runtime startup:** the emitted document always contains the
  derived identity; the runtime profile still REQUIRES it; using the
  bootstrap doc directly as a runtime config fails closed.
- **Supplied-identity override:** impossible — comparison only, conflict
  fails before mutation.
- **Conflicts before mutation:** identity conflict check precedes
  provenance creation and `initializeTrustedStore`; verified at both
  action level and subprocess level (`existsSync(store-v1) === false`).
- **Correlation semantics:** identity is computed over the same fields
  (configurationVersion, capabilityVocabularyVersion, hostLane,
  provenance.sourceKind, ceilings, canonical workspace records) the runtime
  lanes revalidate; the emitted canonical roots are idempotent under
  re-validation, so runtime correlation (`verifyStoreInstance` at
  composition; persist-artifact store correlation) binds the same identity.
  If the environment drifts (root removed), runtime startup fails closed
  rather than mismatching silently.
- **TOCTOU:** identity is derived from the already-validated configuration
  object; the emitted document is a projection of that same object. No
  second parse of raw input occurs at output time; nothing can re-validate
  differently.
- **`limitProfile` in the emitted config** is operator overrides only (the
  runtime merges defaults itself in `compose.ts`), so strict runtime
  selection gates accept it; the effective profile never serializes.

## 6. CLI/runtime separation assessment

Structural separation verified:

- `main()` dispatches `argv[0] === 'bootstrap'` **before** the runtime
  parser; runtime mode's `parseArgs` accepts exactly `--config <file>`
  (length 2, argv[0] `--config`). The two modes are mutually exclusive:
  runtime mode can never see `bootstrap` as a mode, and bootstrap mode
  never reaches `composeTrustedRegistry`/`createMcpServer`/`serveStdio`.
- Malformed combinations fail closed with exit 2 (`bootstrap` alone,
  `--config` alone, empty path, extra operand, `--output` first,
  `--config x --output`, bare `--config`); covered by the subprocess
  malformed-operand loop in `tests/runtime/bootstrap.test.ts`.
- Bootstrap stdout: with `--output`, stdout is asserted empty; without,
  stdout carries exactly one JSON document (asserted to contain no
  `jsonrpc` protocol data). All diagnostics go through bounded stderr
  (`writeDiagnostic`).
- Runtime stdout remains protocol-only: `serveStdio` owns stdout, no
  `console.log` anywhere in the runtime path (runtime static guard passes
  unchanged).
- The MCP server cannot reach the bootstrap runner: `server.ts` has no
  `bootstrapStore`/`runBootstrapCommand`/`bootstrap/` import (asserted);
  the only importer of `src/bootstrap/run.js` in the tree is `cli.ts`.
- Process lifecycle: `runBootstrapCommand` returns exit codes 0/1/2 and
  never starts MCP; runtime mode unchanged (verified: runtime over the
  bootstrap-produced config starts and shuts down cleanly on stdin EOF;
  missing config still exits 1).
- `bootstrap --help`/`-h` exits 0 with usage (documented deviation #3;
  reasonable — help is a known operand).

## 7. Filesystem/output safety assessment

The `--output` writer (`writeOutputFile` in `src/bootstrap/run.ts`):

- **Locator pre-existence:** the store locator must already exist as an
  operator-owned directory; neither the engine nor the runner creates
  parents (`mkdirSync` is not in the fs allowlist; engine SRX-005
  semantics preserved). Absent locator → `ERR-STO-ROOT-INVALID`, tested.
- **Atomic no-clobber scheme (hard-link publish):**
  1. `readExisting`: open/read/compare (ENOENT → absent; identical → no-op;
     other → conflict).
  2. Temp: `openSync(tmp, 'wx', 0o600)` + explicit `fchmodSync(0o600)` +
     `writeSync` + `fsyncSync` + close.
  3. Publish: `linkSync(tmp, path)` — fails `EEXIST` if the target appeared
     since the check, so **no overwrite is ever possible** (POSIX `link(2)`
     never replaces an existing directory entry, including symlinks and
     directories at the target). This is race-safe under POSIX semantics —
     not a check-then-rename race.
  4. `unlinkSync(tmp)` + parent-directory fsync (durability).
- **Fail-closed paths:** `EEXIST` at publish → `ERR-BOOT-OUTPUT-CONFLICT`;
  other errors → `ERR-BOOT-OUTPUT-IO`; the tmp file is unlinked on every
  failure path. No rename fallback exists, so no fallback can overwrite.
  Filesystems without hard-link support fail closed (no silent fallback).
- **Partial output exposure:** the final path appears only via the atomic
  link after complete content + fsync; a crash before publish leaves only
  a 0600 tmp orphan. **One robustness gap:** the `writeSync` return value
  is ignored — a short write would be fsync'd and linked as a truncated
  document (see SIR-PS1-002).
- **Symlink behavior:** a symlink at the output path yields `EEXIST` at
  publish (or a `same`-bytes no-op) — never an overwrite through the link.
- **Permissions:** 0600 via creation mode (umask cannot weaken 0600 since
  only owner bits are set) plus explicit `fchmodSync`; ownership is the
  operator's process UID.
- **Tmp naming:** `<path>.tmp-<pid>`; concurrent processes use distinct
  tmp names and the first `linkSync` wins — race-safe. The failure-path
  `unlinkSync(tmp)` can only remove a file named exactly
  `<path>.tmp-<own-pid>` (own tmp, a stale leftover of a recycled pid, or
  an attacker-planted file in a directory the attacker already writes).
- **No new generic write capability:** the fs allowlist for `src/bootstrap`
  is exactly `{closeSync, fchmodSync, fsyncSync, linkSync, openSync,
  readFileSync, unlinkSync, writeSync}`; no mkdir/rm/rename/chmod/chown/
  writeFileSync/cp/symlink/stat/readdir vocabulary (guard-enforced).
- The parent-directory fsync failure edge (exotic FUSE) can report a
  failure after a successful publish — the file is then complete and
  correct, so no incorrect content exposure (noted inside SIR-PS1-002).

## 8. Initialization/replay assessment

- **Absent store:** `initializeTrustedStore` (unchanged engine) provisions
  exactly `store-v1/{metadata,tmp}` and `config-v1/{metadata,tmp}` (lazy
  provisioning; asserted entry set).
- **Exact replay:** the engine's `INITIALIZED` aggregate path performs zero
  writes (classification + metadata replay + descriptor verification are
  read-only; the probe/provision paths are skipped). Evidence is genuine:
  namespace identities (dev/inode) and metadata digests are
  deep-equal across repeated bootstrap runs — a re-provision would produce
  fresh inodes. Subprocess-level: the identical output file's mtime is
  unchanged across reruns (no rewrite).
- **Hidden durable state:** no new capability/provenance generation occurs
  on replay; the initialization capability is disposed on every exit path
  (`finally { capability?.dispose() }`).
- **Fail-closed states:** partial → `ERR-STO-RECOVERY-REQUIRED`; foreign →
  `ERR-STO-INTEGRITY`; unsupported metadata version →
  `ERR-STO-UNSUPPORTED-VERSION`; wrong namespace mode → `ERR-STO-INTEGRITY`;
  forbidden-root overlap → `ERR-STO-ROOT-INVALID`; all tested at action and
  subprocess levels; none repaired.
- **Post-init verification** binds the exact derived identity through the
  committed `verifyStoreInstance` (same pipeline as runtime startup).
- **Multi-surface behavior (reported):** surfaces process in order; the
  first failure aborts with exit 1 and **no output document** is written;
  a surface initialized before the failure remains initialized. Assessed:
  **acceptable idempotent partial progress** within the approved contract —
  the invariant that matters holds (no partial output document is ever
  emitted, the initialized store is replay-safe on the next run, failures
  are typed and unrepaired, and no transactionality was required). It is
  documented in the implementation report §14; a one-line note in the
  runbook §2.8 would be a worthwhile documentation polish, not a defect.

## 9. MCP/package surface assessment

- **tools/list:** the authoritative unchanged test
  (`tests/runtime/server.test.ts:157`) asserts exactly nine tools;
  `tests/runtime/static-guard.test.ts:121-131` asserts exactly nine
  `registerTool` calls and the exact sorted inventory. Both pass (rerun).
  Inventory confirmed: `validate-artifact`, `inspect-stored-record`,
  `inspect-registry`, `inspect-audit-history`, `verify-record`,
  `enumerate-class`, `draft-artifact`, `persist-artifact`,
  `inspect-changes`.
- No bootstrap/init/admin/approval/issuance/activation/grant/receipt/
  storage-write tool exists; the runtime static guard's forbidden-tool-name
  scan passes unchanged; `server.ts` has no bootstrap import.
- **package.json:** unchanged (verified against baseline; not in the diff).
  Same `bin` (`dist/runtime/mcp/cli.js`), same exports (`.`,
  `./pi-adapter`, `./loading`, `./mcp`), same `private`/`UNLICENSED`.
  No new subpath, no new executable. The bootstrap verb is reachable only
  through the installed CLI bin.

## 10. Security-guard assessment

**Old blanket assertion ownership:** `tests/security/security.test.ts`
("production modules perform no hidden filesystem/network/process I/O")
scans compiled `dist/**` and forbids `node:fs`/network/subprocess/env/time
tokens in every module not explicitly delegated. It is a coarse text scan
that cannot accommodate a module that legitimately touches the filesystem.

**The exclusion:** `!p.includes('/bootstrap/')` removes `dist/bootstrap`
from that scan, mirroring the established runtime/writing/completion
boundary pattern (all are excluded the same way and covered by dedicated
guards).

**The dedicated guard** (`tests/unit/bootstrap-static-guard.test.ts`):
- scans the whole `src/bootstrap` tree (recursive, so future files are
  covered),
- forbids network/subprocess/tunnel/MCP-SDK/env/time/console vocabulary,
- restricts `node:fs` to the exact eight-name allowlist via named-import
  parsing and forbids the mutating API vocabulary,
- requires the runner to compose `bootstrapStore`/`loadBootstrapConfig`/
  `runBootstrapCommand` and forbids provenance/capability/brand
  creators and `initializeTrustedStore` inside the boundary.

**Equivalent-or-stronger:** the dedicated guard is strictly stronger for
the bootstrap boundary than the blanket scan would be (it permits only the
exact output-write discipline instead of merely no-I/O), and the
authority-localization invariant is enforced by the storage guard's import
edges. The exclusion is narrow (`/bootstrap/` on compiled paths ↔
`src/bootstrap` via tsc mirroring) and structurally pinned.

**Gap analysis (SIR-PS1-003):** both the blanket scan and the dedicated
guard are text/static-import scans; a future file could in principle use
`import('node:fs/promises')` + method-call syntax, and the storage guard's
`parseImports` does not bind namespace-import usage of creators. These are
pre-existing scan limitations shared with every other boundary, not a PS-1
regression, and no such code exists. Optional hardening only.

## 11. Test/evidence assessment

| Claim | Evidence | Verdict |
|---|---|---|
| Fresh init + deterministic derived identity | action tests; identity equal across locators | genuine behavior test |
| Resolved config accepted by strict runtime loader | action + subprocess tests round-trip `loadRuntimeConfig` | genuine |
| Replay zero-writes | dev/inode identities + metadata digests deep-equal across runs; output mtime unchanged | genuine |
| Identity conflict → no mutation | `existsSync(store-v1) === false` at action and subprocess level | genuine |
| Output 0600 / no-clobber / conflict | subprocess tests exercise the **real compiled CLI** (`spawn` of `dist/runtime/mcp/cli.js`), assert mode 0600, mtime no-op, and conflict content preserved | genuine, real subprocess path |
| MCP absence | subprocess: stdout empty with `--output`, no `jsonrpc` without it; `server.ts` import/call assertions; compiled `dist/bootstrap/run.js` has zero `@modelcontextprotocol` references | genuine, server/tool layer covered |
| Nine-tool surface | unchanged authoritative tests rerun green | genuine |
| Authority guards negative cases | storage guard: unauthorized-consumer rejection + synthetic alias/export-from negatives; bootstrap guard: forbidden-vocabulary negatives | meaningful |
| No provenance serialization | `JSON.stringify` of results + output bytes checked | genuine |
| Malformed operands exit 2 | subprocess loop over seven malformed shapes | genuine |

**Test-count discrepancy (resolved):** the committed implementation report
states "149 tests run / 147 pass", while the conversational summary stated
"150 tests run / 148 pass / 2 skips". Executable evidence from rerunning the
report's own §12 suite inventory on the reviewed tree:

| Suite (report §12 inventory) | Result |
|---|---|
| `bootstrap-action` (15) + `bootstrap-static-guard` (3) + `runtime/bootstrap` (15) | 33/33 pass |
| `storage/static-guard` + `wp12-static-guard` + `security` + `runtime/static-guard` | 59/59 pass |
| `runtime/server` + `runtime/stdio` + `storage/initialization` | 48 run / 46 pass / 2 skips (skips = pre-existing chown-privilege skips in `initialization.test.js`, confirmed 23/21/2) |
| `storage/trusted-input` | 10/10 pass |
| **Total** | **150 run / 148 pass / 0 fail / 2 skips** |

**The conversational figure (150/148/2) is correct.** The committed report's
149/147 is a one-test arithmetic error (its own §12 table sums to 150). It
reveals no incomplete or misleading verification — everything reran green —
and is therefore a MINOR reporting correction, not a product defect
(SIR-PS1-004).

## 12. Documentation assessment

- **ADR-041:** accurate on every reviewed point, including the correct
  two-consumer statement ("the only production module — together with the
  runtime composition root, which re-verifies only — allowed to import
  `createStorageBootstrapActionProvenance`"). No implication of automatic
  parent creation by Gateway, automatic initialization at MCP startup,
  immediate existence of all storage subdirectories, MCP-available
  bootstrap authority, or broader platform support.
- **Runbook §2.8:** operator-only framing, strict operand surface, exit
  codes, locator pre-existence (`mkdir -p -m 0700`), identity derivation
  and comparison-only semantics, replay/fail-closed semantics, output
  no-clobber, no provenance serialization — all truthful vs code.
  §2.5 note and the §4 PILOT-WP15-001 storage-layout correction
  ("initialization creates exactly `metadata/` and `tmp/`; `records/`,
  `audit/`, `locks/` provisioned lazily; `index/`/`quarantine/`
  contract-reserved, presence fails closed") match the engine's actual
  behavior and the tested post-init entry set.
- **WP-14B reference:** one-line pointer to the bootstrap verb; no false
  claims.
- **Inaccurate claims found:** the `storage-bootstrap-action.ts` header
  ("This module is the ONLY production path that mints the genuine bootstrap
  action provenance") and implementation-report §5 ("minted in exactly one
  production place") are false as literally worded — `compose.ts` (pre-
  existing, WP-9 root) also mints the provenance for verification seeding.
  The guard and ADR-041 state the truth. Security posture unaffected.
  → SIR-PS1-001.

## 13. Findings table

### Product/security defects

| ID | Severity | Location | Violated invariant | Consequence | Smallest safe correction | In envelope |
|---|---|---|---|---|---|---|
| SIR-PS1-002 | MINOR | `src/bootstrap/run.ts` `writeOutputFile` (~line 110) | Output discipline: publish only complete content | `writeSync` return value ignored; a short write (signal interruption, exotic fs) would be fsync'd and atomically linked as a truncated runtime config. Downstream runtime fails closed on bad JSON, but the published document would be incomplete. | Assert `writeSync(fd, bytes) === bytes.length` (loop or fail closed) before `fsyncSync`; keep existing failure path | Yes (same output discipline, no new capability) |

### Test/evidence defects

| ID | Severity | Location | Violated invariant | Consequence | Smallest safe correction | In envelope |
|---|---|---|---|---|---|---|
| SIR-PS1-004 | MINOR | `docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-implementation-report.md` §12 | Reporting truthfulness | States 149 run / 147 pass; executable evidence and the report's own §12 table sum to 150 run / 148 pass / 2 skips. No verification is incomplete or misleading (all green). | Correct the totals to 150/148/2 before commit | Yes (report-only) |

### Documentation defects

| ID | Severity | Location | Violated invariant | Consequence | Smallest safe correction | In envelope |
|---|---|---|---|---|---|---|
| SIR-PS1-001 | MINOR | `src/control-plane/storage-bootstrap-action.ts` header; implementation report §5 | Documentation truthfulness (Review Area A/I) | Claims the action module is "the ONLY production path that mints the genuine bootstrap action provenance"; `compose.ts` (pre-existing WP-9 root) also mints it for verification seeding. Guard and ADR-041 state the truth; no security impact. | Reword to "the only PS-1 production path; together with the pre-existing runtime composition root (re-verification only), the sole two guard-pinned consumers" | Yes (wording only) |

### Optional hardening (non-blocking)

| ID | Severity | Location | Nature | Smallest safe change | In envelope |
|---|---|---|---|---|---|
| SIR-PS1-003 | MINOR (hardening) | `tests/unit/storage/static-guard.test.ts` `parseImports`; `tests/unit/bootstrap-static-guard.test.ts` | Pre-existing scan limitation shared by all boundaries: dynamic `import(...)` and namespace-import usage (`import * as x …; x.<creator>(…)`) are not bound by the import-edge scan; dedicated guard regexes match only static named imports | Deny namespace imports of brand-bearing modules in the storage guard, or scan usage sites; note the limitation in the guard comment. No such code exists today | Yes (guard strengthening; not required for release) |

No CRITICAL, MAJOR, or MODERATE findings. No product/security defect blocks.

## 14. Envelope exceptions

**None.** Verified against the escalation criteria:

- New authority domain? No — the provenance/capability/brand machinery is
  the unchanged WP-8-C domain; `CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY` is
  a new label value in an existing metadata field, minted by the
  contract-designated reserved consumer.
- Model-accessible initialization authority? No — unreachable from MCP/
  tools/server; operator CLI verb only.
- Public provenance creation? No — creator pinned to two trusted
  composition roots, not package-exported.
- New generic lifecycle writes? No — writes are store initialization
  through the accepted orchestrator plus the operator config output file
  (atomic, 0600, no-clobber).
- Changed Artifact authority semantics? No — nine-tool surface and all
  approval/issuance/activation semantics unchanged.
- Broader platform/support semantics? No — `TRUSTED_HOST_LANE` unchanged;
  no macOS host lane; no environment-claim broadening.
- Cross-cutting security invariant requiring redesign? No — guards updated
  within the existing boundary pattern (runtime/writing/completion
  precedent).

## 15. Focused verification performed

Read-only inspection of every PS-1 source, test, guard, and doc file, plus:

1. `git rev-parse HEAD` → baseline match; full `git status --porcelain=v1`
   and `git diff --cached` (nothing staged).
2. `git diff` of all 9 modified files (raw); `git diff --stat`;
   `git diff --check` (clean).
3. Import-graph greps: `createStorageBootstrapActionProvenance` call sites
   and importers; `storage-bootstrap-action`/`bootstrap/run` importers;
   accidental `bootstrap/` imports (none outside `cli.ts`); WP-13D
   references from PS-1 files (none).
4. Package surface: `package.json` (unchanged bin/exports/files), live
   `import('./dist/index.js')` key scan (no bootstrap/provenance/initialize
   exports), `src/index.ts`, `src/adapters/mcp/index.ts`,
   `src/adapters/pi/index.ts`, `src/loading/index.ts` scans.
5. Compiled-output checks: `dist/bootstrap/run.js` (0 MCP SDK refs),
   `dist/runtime/mcp/cli.js` (1 legitimate `serveStdio` import).
6. MCP tool surface: reran the authoritative
   `tests/runtime/server.test.js` (tools/list == nine, exact inventory) and
   `tests/runtime/static-guard.test.js` (exactly nine `registerTool` calls,
   forbidden-tool vocabulary).
7. Focused test runs (compiled dist-test, Node v22.23.2):
   - `bootstrap-action` + `bootstrap-static-guard` + `runtime/bootstrap`:
     33/33 pass.
   - `storage/static-guard` + `wp12-static-guard` + `security` +
     `runtime/static-guard`: 59/59 pass.
   - `runtime/server` + `runtime/stdio` + `storage/initialization`:
     48 run / 46 pass / 2 skips (skips confirmed as the pre-existing
     chown-privilege skips).
   - `storage/trusted-input`: 10/10 pass.
   - Total: **150 run / 148 pass / 0 fail / 2 skips**.
8. Full Phase 3C regression: **not rerun** (focused-verification policy).

## 16. Exact Git status (at review close)

```
 M docs/design/wp-14b-operator-onboarding.md
 M docs/operations/project-gateway-operator-runbook.md
 M src/runtime/mcp/cli.ts
 M src/runtime/mcp/config.ts
 M src/storage/initialization/initialize.ts
 M src/storage/trusted-input/bootstrap-input.ts
 M tests/security/security.test.ts
 M tests/unit/storage/static-guard.test.ts
 M tests/unit/wp12-static-guard.test.ts
?? docs/decisions/ADR-041-operator-bootstrap-command.md
?? docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-implementation-report.md
?? docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md   (pre-existing WP-13D debris; untouched)
?? src/bootstrap/
?? src/control-plane/storage-bootstrap-action.ts
?? src/retrospective/                                                             (pre-existing WP-13D debris; untouched)
?? tests/runtime/bootstrap.test.ts
?? tests/unit/bootstrap-action.test.ts
?? tests/unit/bootstrap-static-guard.test.ts
?? tests/unit/wp13d-retrospective.test.ts                                          (pre-existing WP-13D debris; untouched)
?? tests/unit/wp13d-static-guard.test.ts                                           (pre-existing WP-13D debris; untouched)
```

Plus this report (`docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-senior-review.md`),
uncommitted and unstaged, as required. Nothing staged, nothing committed,
no push/tag/publish/deploy performed.

## 17. Final verdict

PS-1 implements the approved operator-only bootstrap contract with the
smallest correct surface: the unchanged `initializeTrustedStore()` engine,
identity derived exclusively through the validated canonical path with
comparison-only caller identities, genuine provenance minted only inside
two guard-pinned trusted composition roots (both operator-boundary), exact
verification-only replay with zero writes, a race-safe atomic no-clobber
output scheme, strict CLI mode separation, an unchanged nine-tool MCP
surface, unchanged package exports, and a dedicated static guard that is
equivalent-or-stronger than the blanket assertion it replaces. Every
authority, identity, separation, filesystem, replay, and surface claim was
independently verified against code, guards, and tests rather than the
report. No envelope exception applies; all three findings are MINOR
(wording/arithmetic/hardening) and none blocks release, though correcting
the two truthfulness items (SIR-PS1-001, SIR-PS1-004) before commit is
recommended.

PS-1 SENIOR REVIEW — ACCEPTED
