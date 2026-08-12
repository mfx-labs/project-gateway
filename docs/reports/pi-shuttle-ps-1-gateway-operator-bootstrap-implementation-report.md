# PS-1 — Gateway Operator Bootstrap — Implementation Report

**Status:** Implementation complete; uncommitted, awaiting senior review.
**Gate:** pi-shuttle PS-1 (human-authorized).

## 1. Baseline SHA

- Baseline HEAD: `0720476b240f74372c7f1d0d1a78290b19537801` (WP-15 closure).
- Technical regression evidence bound to: `e2131dcb55be97442158687fceed250d8ff54180`
  (diff vs baseline = WP-15 closure report only).
- Working tree: baseline + the authorized PS-1 changes below (uncommitted).
- Known pre-existing untracked WP-13D debris present and untouched.

## 2. Objective

Make trusted-store initialization reachable through a supported
PRODUCTION, OPERATOR-ONLY workflow — the smallest correct composition
surface required by the pi-shuttle product contract — while keeping
initialization authority out of every MCP/model-controlled surface and
reusing the existing storage engine unchanged.

## 3. Files changed

**New (production):**

- `src/control-plane/storage-bootstrap-action.ts` — the reserved production
  provenance consumer (I/O-free; WP-6 validation + identity derivation +
  genuine provenance minting + `initializeTrustedStore()` invocation +
  post-init `verifyStoreInstance`).
- `src/bootstrap/run.ts` — operator bootstrap command runner (arg parse,
  config load, per-surface action composition, deterministic output write /
  stdout JSON, bounded diagnostics).

**Modified (production):**

- `src/runtime/mcp/cli.ts` — dispatch of the `bootstrap` verb before the MCP
  path; usage text; header docstring.
- `src/runtime/mcp/config.ts` — shared closed validator with two profiles:
  `loadRuntimeConfig` (identity REQUIRED, unchanged) and `loadBootstrapConfig`
  (identity optional; supplied identities still format-validated).
- `src/storage/trusted-input/bootstrap-input.ts` — stale header comments
  updated (the reserved consumer now exists). No behavior change.
- `src/storage/initialization/initialize.ts` — stale header comment updated
  (initialization is now reachable through the operator bootstrap path). No
  behavior change.

**New (tests):**

- `tests/unit/bootstrap-action.test.ts` — 15 action-level tests.
- `tests/unit/bootstrap-static-guard.test.ts` — 3 dedicated boundary guards.
- `tests/runtime/bootstrap.test.ts` — 15 subprocess CLI tests pre-correction; 18 after the SIR-PS1-002 output-write tests (§17).

**Modified (tests):**

- `tests/unit/storage/static-guard.test.ts` — creator-consumer edge for
  `createStorageBootstrapActionProvenance` extended to the new producer;
  exact consumer-set pin updated.
- `tests/unit/wp12-static-guard.test.ts` — storage-import allowlist for the
  new control-plane module; focused assertions on the bootstrap action.
- `tests/security/security.test.ts` — `dist/bootstrap` excluded by boundary
  (dedicated guard added), mirroring the runtime/writing/completion pattern.

**Documentation:**

- `docs/decisions/ADR-041-operator-bootstrap-command.md` — new ADR (the one
  ADR the approved design requires).
- `docs/operations/project-gateway-operator-runbook.md` — new §2.8 operator
  bootstrap instructions; §2.5 initialization note; **PILOT-WP15-001**
  storage-layout correction (§4).
- `docs/design/wp-14b-operator-onboarding.md` — one-line reference to the
  bootstrap verb.

## 4. Exact CLI surface

```text
project-gateway-mcp --config <file>                          (unchanged; stdio MCP)
project-gateway-mcp bootstrap --config <file> [--output <file>]   (operator-only; no MCP server)
project-gateway-mcp --help | -h                                (usage: both modes)
project-gateway-mcp bootstrap --help | -h                      (bootstrap usage; exit 0)
```

- Bootstrap operands are strict: exactly `bootstrap --config <f>` or
  `bootstrap --config <f> --output <o>`; anything else exits 2 with usage.
  The dispatch is structural (`argv[0] === 'bootstrap'` before the runtime
  parser), so the two modes can never overlap.
- Exit codes: `0` success (bootstrap) / MCP-clean-EOF (runtime); `1`
  operational failure; `2` malformed operands.
- Diagnostics: bounded single-line stderr via the existing
  `writeDiagnostic` (typed `ERR-BOOT-*` for bootstrap-surface failures;
  storage codes `ERR-STO-*` pass through unchanged).

## 5. Authority/provenance composition

- The genuine `StorageBootstrapActionProvenance` is minted in exactly two
  guard-pinned production places: the PS-1 operator bootstrap action
  `src/control-plane/storage-bootstrap-action.ts` (the contract-designated
  reserved consumer, `createStorageBootstrapActionProvenance`) and the
  pre-existing runtime composition root `compose.ts` in the local stdio
  runtime (which composes trusted registrations and re-verifies existing
  stores; it never exposes bootstrap authority to MCP callers). The storage
  static guard's creator edge pins these two consumers; any future importer
  fails the guard.
- Provenance fields are correlated host-owned operands only: action identity
  (`project-gateway-operator-bootstrap`), locator, service UID, forbidden
  roots, validator-derived configuration identity, effective limit profile.
  No request/artifact/model/runtime-tool operand can reach them. The module
  exposes no provenance, capability, brand, or trusted-input creator; the
  package root, `./mcp`, and all package exports stay clean (asserted).
- The runner (`src/bootstrap/run.ts`) composes the action and never touches
  creator machinery (dedicated static guard asserts this).

## 6. Configuration identity derivation path

1. Operator bootstrap config (closed document) is loaded by
   `loadBootstrapConfig` (same 1 MiB ceiling, raw-JSON intake, duplicate-key
   rejection, closed fields, LMT-013 limit gate as the runtime loader).
2. Per surface, the action builds the WP-6 input exactly like the committed
   WP-14A lanes (same `TRUSTED_SOURCE_KIND` provenance, same capability
   vocabulary version, same host lane) and validates through the committed
   Phase-1 pipeline with real injected resolvers — so the derived identity
   is byte-identical to the identity the runtime lanes will correlate at
   startup (persist-artifact store correlation stays consistent).
3. `computeTrustedConfigurationIdentity(validatedConfiguration)` yields the
   identity; the action pins `derived === configuration.identity` (internal
   invariant) and uses ONLY that value for provenance/store/verification.
4. A caller-supplied `configurationIdentity` (bootstrap profile allows its
   absence; runtime profile still REQUIRES it) is only compared: mismatch →
   `ERR-BOOT-IDENTITY-CONFLICT` before any storage mutation; equality →
   idempotent replay composition.
5. The resolved runtime configuration carries the exact derived identity and
   is accepted verbatim by strict `loadRuntimeConfig` (tested).

## 7. Initialization/replay semantics

- `initializeTrustedStore()` is invoked UNCHANGED through the genuine
  branded operands. Absent store → provisioned (`INITIALIZED`, both
  namespaces, digests). Existing initialized store → verification-only
  replay (zero writes; namespace identities and metadata digests identical —
  tested).
- Fail-closed states surface as typed failures, never repaired: partial →
  `ERR-STO-RECOVERY-REQUIRED`; foreign → `ERR-STO-INTEGRITY`;
  unsupported-version → `ERR-STO-UNSUPPORTED-VERSION`; wrong namespace mode
  → `ERR-STO-INTEGRITY`; forbidden-root overlap → `ERR-STO-ROOT-INVALID`;
  invalid validated configuration → `ERR-BOOT-CONFIG-INVALID`.
- Post-initialization the store is independently re-verified through
  `verifyStoreInstance` (the same pipeline the runtime composition root uses
  at startup) with the derived identity.
- The trusted parent (locator) must already exist as an operator-owned 0700
  directory; neither the engine nor the runner creates parents (engine
  SRX-005 semantics preserved; documented in runbook §2.8 and ADR-041).
- Multi-surface configs process in order and abort at the first failure with
  nothing partial written; already-provisioned stores remain replay-safe.

## 8. Runtime-vs-bootstrap separation

- `--config <f>` (argv[0]) → stdio MCP runtime, byte-for-byte unchanged
  behavior (strict parser, composition root, nine-tool server).
- `bootstrap` (argv[0]) → operator CLI runner; the MCP server is never
  constructed, the SDK is never imported by the runner, and no MCP protocol
  data is emitted (asserted by tests: stdout is empty with `--output`, and
  carries only the JSON document without it).
- The runner intentionally lives OUTSIDE `src/runtime/mcp` so the runtime
  static guards (protocol-only stdout, no storage mutation vocabulary,
  creators localized to compose.ts) remain literally true; `dist/bootstrap`
  is excluded from the blanket security no-I/O assertion only by boundary,
  backed by a new dedicated guard (same pattern as runtime/writing/
  completion).
- The bootstrap action lives in `src/control-plane` and passes the existing
  wp12 family guards (I/O-free, storage-import allowlist, vocabulary
  confinement, no package-root/./mcp exposure).

## 9. Package/public-export implications

- `package.json` unchanged: same bin (`dist/runtime/mcp/cli.js`), same
  exports (`.`, `./pi-adapter`, `./loading`, `./mcp`), same version `0.1.0`,
  still `private`/`UNLICENSED`. No new subpath, no new executable.
- `src/index.ts` and `src/adapters/mcp/index.ts` do not export the control
  plane or the bootstrap producer (existing wp12 guard + focused test).
- The bootstrap command is reachable ONLY through the installed CLI bin, i.e.
  through the operator's terminal.

## 10. MCP tool-surface verification

- Nine-tool surface unchanged: `validate-artifact`, `inspect-stored-record`,
  `inspect-registry`, `inspect-audit-history`, `verify-record`,
  `enumerate-class`, `draft-artifact`, `persist-artifact`,
  `inspect-changes`. `tests/runtime/static-guard.test.ts` (exactly nine
  registerTool calls, no admin/approval vocabulary) and
  `tests/runtime/server.test.ts` (tools/list == nine) pass unchanged.
- No bootstrap/init/admin tool exists; the server module cannot reach the
  bootstrap runner (focused assertion).
- stdio handshake/EOF/negotiation suite (`tests/runtime/stdio.test.js`)
  passes unchanged.

## 11. PILOT-WP15-001 correction

Runbook §4 storage-layout language corrected to state truthfully:
initialization creates exactly `metadata/` and `tmp/` per namespace;
`records/`, `audit/`, `locks/` are provisioned lazily (phase-3,
capability-gated); `index/` and `quarantine/` are contract-reserved and NOT
created by initialization — their presence is an unknown entry and fails
closed. Storage behavior unchanged (existing lazy-provisioning semantics);
the new bootstrap tests pin the `metadata,tmp` post-init entry set.

## 12. Focused tests executed and exact results (pre-correction inventory, as reviewed)

All on baseline + PS-1 changes, Node v22.23.2, `npm run build` +
`tsc -p tsconfig.tests.json`. This section documents the inventory exactly
as it stood at senior review. The totals below correct the arithmetic error
identified by the senior review (SIR-PS1-004): the report previously
stated 149 run / 147 pass, while the independently re-executed evidence
and this section's own inventory sum to **150 run / 148 pass / 0 fail /
2 skips**.

| Suite | Result |
|---|---|
| `tests/unit/bootstrap-action.test.js` (new; 15 tests) | 15/15 pass |
| `tests/unit/bootstrap-static-guard.test.js` (new; 3 tests) | 3/3 pass |
| `tests/runtime/bootstrap.test.js` (new; 15 subprocess tests; 18 after SIR-PS1-002 — see §17) | 15/15 pass |
| `tests/unit/storage/static-guard.test.js` (creator edges updated) | pass |
| `tests/unit/wp12-static-guard.test.js` (control-plane family) | pass |
| `tests/runtime/static-guard.test.js` (nine tools, runtime invariants) | pass |
| `tests/unit/storage/initialization.test.js` (directly affected) | pass (2 pre-existing chown-privilege skips) |
| `tests/unit/storage/trusted-input.test.js` (forged/plain provenance) | pass |
| `tests/runtime/server.test.js` + `tests/runtime/stdio.test.js` | pass |
| `tests/security/security.test.js` (blanket no-I/O + boundary) | pass |

**Totals (pre-correction, independently verified — SIR-PS1-004): 150 tests
run, 148 pass, 0 fail, 2 pre-existing documented chown-privilege skips**
(33 new PS-1 tests + 59 guard/security tests + 48 server/stdio/
initialization (46 pass / 2 skips) + 10 trusted-input tests).
`git diff --check`: clean. Full Phase 3C regression NOT rerun (focused
verification policy).

Coverage highlights: fresh init + exact derived identity; resolved config
accepted by strict startup validation; byte-deterministic output; 0600 mode;
atomic no-clobber (identical = no-op, different = `ERR-BOOT-OUTPUT-CONFLICT`);
replay zero-writes (identity/digest equality); identity conflict with no
store mutation; partial/foreign/unsupported-version/wrong-mode/forbidden-root
fail-closed codes; malformed args exit 2; runtime mode unchanged and serves
the bootstrap-produced config; no provenance serialization; no MCP protocol
from bootstrap; producer unreachable from package surfaces and server.

## 13. Deviations from approved contract

None material. Two design points resolved within the approved envelope and
documented (ADR-041, runbook §2.8):

1. **Trusted parent must pre-exist** (operator-created 0700 directory). The
   contract's "no new filesystem write class" prohibition and the engine's
   no-parent-creation fail-closed semantics jointly require this; the
   runner does not mkdir. pi-shuttle `project add` provisions the parent.
2. **`--output` overwrite rule**: identical bytes = idempotent no-op;
   different bytes = typed conflict (`ERR-BOOT-OUTPUT-CONFLICT`), never
   overwritten. The contract left the rule unspecified; this is the
   fail-closed choice, implemented with an atomic hard-link no-clobber
   publish (no check-then-rename race).
3. `bootstrap --help` exits 0 with usage (help is a known operand; malformed
   operands still exit 2).

## 14. Findings / open risks

- **Wrong-UID fail-closed coverage** relies on the existing synthetic
  stat-policy tests (chown requires privileges); no new runtime UID test
  was possible in this gate. Post-init `verifyStoreInstance` enforces
  ownership in production.
- **Locator pre-existence is a new operator-facing requirement**: an absent
  locator yields `ERR-STO-ROOT-INVALID` with the engine's existing message
  ("trusted parent must already exist and be resolvable"). The runbook and
  ADR document it; pi-shuttle `project add` will own the mkdir.
- **Multi-surface partial progress**: if surface 2 fails after surface 1
  initialized, no output is written but surface 1's store exists
  (replay-safe, never partial output). Documented in run.ts header.
- **The `configurationIdentity`-optional surface exists only in the
  bootstrap profile**; both loaders share one closed validator, so schema
  drift between profiles is structurally impossible.
- Static guard pins now make any future provenance-impoter change fail the
  storage guard deliberately (authority surface can only widen by reviewed
  guard change).

## 15. Git status

Modified: `docs/design/wp-14b-operator-onboarding.md`,
`docs/operations/project-gateway-operator-runbook.md`,
`src/runtime/mcp/cli.ts`, `src/runtime/mcp/config.ts`,
`src/storage/initialization/initialize.ts`,
`src/storage/trusted-input/bootstrap-input.ts`, `tests/security/security.test.ts`,
`tests/unit/storage/static-guard.test.ts`, `tests/unit/wp12-static-guard.test.ts`.

Untracked (new): `docs/decisions/ADR-041-operator-bootstrap-command.md`,
`src/bootstrap/`, `src/control-plane/storage-bootstrap-action.ts`,
`tests/runtime/bootstrap.test.ts`, `tests/unit/bootstrap-action.test.ts`,
`tests/unit/bootstrap-static-guard.test.ts`.

Untracked pre-existing (untouched): WP-13D debris (`docs/reports/
wp-13d-retrospective-facts-and-closure-implementation-report.md`,
`src/retrospective/`, `tests/unit/wp13d-retrospective.test.ts`,
`tests/unit/wp13d-static-guard.test.ts`).

Nothing staged, nothing committed. No push/tag/publish/deploy; no external
mutation; pi-guard and macOS lanes untouched.

## 16. Readiness verdict

PS-1 satisfies the approved contract: the smallest correct operator-only
bootstrap surface, reusing `initializeTrustedStore()` unchanged, with
identity derivation, exact idempotent replay, fail-closed states, typed
operator output, no MCP/model reachability, unchanged nine-tool surface,
guards updated and green, documentation (runbook §2.8, PILOT-WP15-001
correction, ADR-041) complete. Changes are left uncommitted for senior
review.

---

## 17. Focused correction record (SIR-PS1-001 / SIR-PS1-002 / SIR-PS1-004)

Senior review: `docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-senior-review.md`
(verdict `PS-1 SENIOR REVIEW — ACCEPTED`; preserved as historical evidence,
not rewritten). This section records the authorized focused correction and
supersedes the pre-correction wording/totals above where they differ.

### Closure matrix

| Finding | Severity | Status |
|---|---|---|
| SIR-PS1-001 | MINOR documentation truthfulness | **CLOSED** |
| SIR-PS1-002 | MINOR product/output robustness | **CLOSED** |
| SIR-PS1-004 | MINOR evidence/report arithmetic | **CLOSED** |
| SIR-PS1-003 | MINOR / optional hardening / non-blocking / pre-existing limitation | **DEFERRED / OPTIONAL HARDENING** (not implemented; not a PS-1 release requirement) |

### SIR-PS1-001 (CLOSED) — documentation truthfulness

Corrected only objectively false wording; no guard or authority behavior
changed:

- `src/control-plane/storage-bootstrap-action.ts` header — no longer claims
  to be the ONLY minting path; now states the true topology: the PS-1
  module is the operator-bootstrap production composition path and,
  together with the pre-existing runtime composition root (`compose.ts` in
  the local stdio runtime), these are the sole two guard-pinned production
  consumers of the provenance creator; the runtime root composes trusted
  registrations and re-verifies existing stores and does not expose
  bootstrap authority to MCP callers.
- `src/storage/trusted-input/bootstrap-input.ts` — the two PS-1-edited
  docblocks now name both guard-pinned consumers instead of "exactly one" /
  "sole" consumer.
- `tests/unit/wp12-static-guard.test.ts` — the PS-1 allowlist comment now
  states the two-consumer topology precisely (and keeps the truthful
  "only production consumer of the initialization orchestrator" claim,
  which the storage guard and source tree confirm).
- `docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-implementation-report.md`
  §5 — "minted in exactly one production place" corrected to the
  two-consumer statement.

No other PS-1 statement was objectively false (verified by grep of the PS-1
diff for "only production path" / "exactly one production place" / "sole
production" wording; ADR-041, runbook §2.8, and the storage static-guard
comments already stated the two-consumer truth).

### SIR-PS1-002 (CLOSED) — complete-buffer write before publish

**Exact implementation** (`src/bootstrap/run.ts`):

- New `OutputByteWriter` type = the `node:fs` `writeSync` signature
  `(fd, buffer, offset, length) => number`.
- New private `writeAllBytes(fd, bytes, write = writeSync)`: loops
  `write(fd, bytes, written, bytes.length - written)` until `written ===
  bytes.length`; a return value `<= 0` (zero-progress or invalid progress)
  throws `Object.assign(new Error('output write made no progress'), { code:
  'ESHORTWRITE' })`, which the existing failure path maps to the existing
  `ERR-BOOT-OUTPUT-IO` family (no new public error code).
- `writeOutputFile` is now exported and takes an optional `write` primitive
  (default `writeSync`) — the narrowest testability seam for deterministic
  short-write simulation. It widens no authority or I/O capability: the
  injectable writer can only consume bytes on an already-open descriptor,
  production always uses `writeSync`, and the fs allowlist of the bootstrap
  static guard is unchanged (`writeSync` was already the only writer).
- Order of operations unchanged otherwise: `openSync(tmp, 'wx', 0o600)` →
  `fchmodSync(0o600)` → `writeAllBytes` → `fsyncSync` → `linkSync` publish
  (atomic no-clobber) → `unlinkSync(tmp)` → parent-dir fsync. The publish
  step runs only after the complete intended byte sequence is written and
  fsynced.

**Short-write failure semantics:**

- Short writes (partial consumption) are looped until the buffer is fully
  written — the complete sequence always reaches `fsyncSync`.
- Zero-progress or invalid progress is an I/O failure: `ERR-BOOT-OUTPUT-IO`
  is returned, the final output path is never published (no truncated
  runtime config can appear at the target), and the temporary file is
  unlinked on the existing failure path (cleanup unchanged).
- Identical-existing-file no-op, different-existing-file conflict, 0600
  permissions, and the atomic hard-link no-clobber publication are all
  preserved (existing tests unchanged and green).

**Focused tests added** (`tests/runtime/bootstrap.test.ts`, +3):

1. `short writes are looped until the complete buffer is written before
   publish` — injects a real partial-writing primitive (at most one byte
   per call) and asserts the full content is published with exact 0600.
2. `zero-progress write fails closed; nothing is published and the temp is
   cleaned` — injects one real partial write then zero progress; asserts
   `ok: false`, `ERR-BOOT-OUTPUT-IO`, no file at the target, and no
   `.tmp-*` leftovers.
3. `output I/O failure fails the command closed with ERR-BOOT-OUTPUT-IO` —
   subprocess-level: `--output` into a nonexistent directory exits 1 with
   the typed code and empty stdout (no partial document).

### SIR-PS1-004 (CLOSED) — evidence arithmetic

- §12 above now states the independently verified pre-correction totals:
  **150 run / 148 pass / 0 fail / 2 skips** (the committed 149/147 was a
  one-test arithmetic error; the review's re-execution and this report's
  own inventory agree on 150/148/2).
- Post-correction totals (new SIR-PS1-002 tests included) are reported
  below; both pre- and post-correction evidence are recorded truthfully.

### SIR-PS1-003 (DEFERRED / OPTIONAL HARDENING)

Dynamic-import and namespace-import hardening of the static-import scans
(the storage guard's `parseImports` and the dedicated guard regexes) is a
pre-existing scan limitation shared by every boundary, explicitly classified
by the senior review as MINOR / optional / non-blocking. **Not implemented
in this gate; not a PS-1 release requirement.** No such code exists today.

### Post-correction focused verification (exact results)

Inventory: the §12 pre-correction suites, with `tests/runtime/bootstrap.test.js`
now at 18 tests (15 + 3 new). Node v22.23.2; `npm run build` +
`tsc -p tsconfig.tests.json`:

| Suite | Result |
|---|---|
| `tests/unit/bootstrap-action.test.js` (15) | 15/15 pass |
| `tests/unit/bootstrap-static-guard.test.js` (3) | 3/3 pass |
| `tests/runtime/bootstrap.test.js` (18) | 18/18 pass |
| `tests/unit/storage/static-guard.test.js` + `tests/unit/wp12-static-guard.test.js` + `tests/runtime/static-guard.test.js` + `tests/security/security.test.js` | 59/59 pass |
| `tests/runtime/server.test.js` + `tests/runtime/stdio.test.js` + `tests/unit/storage/initialization.test.js` | 48 run / 46 pass / 2 skips (pre-existing chown-privilege skips) |
| `tests/unit/storage/trusted-input.test.js` | 10/10 pass |

**Post-correction totals: 153 tests run / 151 pass / 0 fail / 2 skips.**
`git diff --check`: clean (exit 0).

### Surface-invariant confirmation

No authority domain, MCP tool, package export, storage engine, or
runtime-config-validator behavior changed: the correction touches only
wording (`storage-bootstrap-action.ts` header, `bootstrap-input.ts`
comments, wp12 guard comment), the output writer's byte-completion loop
(behavioral change confined to the existing `ERR-BOOT-OUTPUT-IO` failure
family), three focused tests, and this report. MCP tool-surface suites and
storage guards rerun green. Nothing staged, nothing committed; WP-13D
debris untouched; no external mutation.
