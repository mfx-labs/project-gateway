# PS-1 — Gateway Operator Bootstrap — Focused Rereview

**Role:** combined PS-1 FOCUSED REREVIEW → LOCAL BASELINE COMMIT gate.
**Mode:** read-only rereview first; commit authorized only by the rereview
verdict. No push/tag/publication/deployment. WP-13D debris untouched.

---

## 1. Baseline identity

| Item | Value |
|---|---|
| Pre-PS-1 baseline HEAD (expected) | `0720476b240f74372c7f1d0d1a78290b19537801` |
| Pre-PS-1 baseline HEAD (actual) | `0720476b240f74372c7f1d0d1a78290b19537801` ✔ match |
| Staged content | none |
| `git diff --check` | clean (exit 0) |
| Senior review | `docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-senior-review.md` — verdict ACCEPTED |

## 2. Rereview scope

Only the closed findings were reopened: SIR-PS1-001 (documentation
truthfulness), SIR-PS1-002 (complete-write invariant), SIR-PS1-004
(evidence arithmetic). SIR-PS1-003 reviewed for deferral only (A4). Full
PS-1 architecture not reopened; no cross-cutting issue introduced by the
corrections was found (A5).

## 3. SIR-PS1-001 verification — VERIFIED CLOSED

- `src/control-plane/storage-bootstrap-action.ts` header now states the
  true topology: "the PS-1 operator-bootstrap production composition path…
  Together with the pre-existing runtime composition root (`compose.ts` in
  the local stdio runtime), these are the sole two guard-pinned production
  consumers of the provenance creator… the runtime root composes trusted
  registrations and re-verifies existing stores; it does not expose
  bootstrap authority to MCP callers." No "only production path" claim
  remains where literally false.
- `src/storage/trusted-input/bootstrap-input.ts` — both PS-1-edited
  docblocks now name both guard-pinned consumers ("exactly two production
  consumers (guard-pinned)"), dropping the false "sole/future" wording.
- Implementation report §5 now reads "minted in exactly two guard-pinned
  production places" with the correct two-consumer statement.
- `tests/unit/wp12-static-guard.test.ts` allowlist comment corrected to the
  two-consumer topology; its remaining "only production consumer of the
  initialization orchestrator" claim was independently confirmed true by
  import grep: `initializeTrustedStore` has exactly one production importer
  (`src/control-plane/storage-bootstrap-action.ts:51,220`).
- ADR-041 and runbook §2.8 already stated the two-consumer truth; unchanged
  and consistent.
- Authority behavior/import graph unchanged: the storage static-guard
  creator-consumer pin still asserts exactly
  `['src/control-plane/storage-bootstrap-action.ts', 'src/runtime/mcp/compose.ts']`
  (guard suite rerun green).
- `git diff` shows the correction touched wording only in these files;
  no functional line changed in the authority path.

## 4. SIR-PS1-002 verification — VERIFIED CLOSED

Actual implementation inspected (`src/bootstrap/run.ts`):

```ts
export type OutputByteWriter = (fd: number, buffer: Buffer, offset: number, length: number) => number;

function writeAllBytes(fd: number, bytes: Buffer, write: OutputByteWriter = writeSync): void {
  let written = 0;
  while (written < bytes.length) {
    const n = write(fd, bytes, written, bytes.length - written);
    if (n <= 0) {
      throw Object.assign(new Error('output write made no progress'), { code: 'ESHORTWRITE' });
    }
    written += n;
  }
}
```

Independent verification against all sixteen points:

1. Loop continues until the entire buffer is written — returns only when
   `written === bytes.length`. ✔
2. Offset/remaining arithmetic correct — `write(fd, bytes, written,
   bytes.length - written)`. ✔
3. Partial positive writes advance — `written += n` for every `n > 0`. ✔
4. Zero progress fails closed — `n === 0` throws. ✔
5. Negative/invalid progress fails closed — `n < 0` throws. ✔
6. No infinite loop — every iteration either throws or advances `written`
   by at least 1 (integer `n > 0`); bounded by `bytes.length`. ✔
7. `fsyncSync` only after the full buffer — `writeAllBytes` is called before
   `fsyncSync(fd)` and cannot return early. ✔
8. `linkSync` publication only after complete-write + fsync — order is
   `openSync(tmp,'wx',0o600)` → `fchmodSync(0o600)` → `writeAllBytes` →
   `fsyncSync` → `closeSync` → `linkSync` (atomic no-clobber) →
   `unlinkSync(tmp)` → parent-dir fsync. ✔
9. Short/failed write cannot publish the target — the throw jumps to the
   existing catch: best-effort close, tmp unlink, typed failure; `linkSync`
   never runs. `ESHORTWRITE` maps to the existing `ERR-BOOT-OUTPUT-IO`
   family (no new public error code). ✔
10. Tmp cleanup on failure — `unlinkSync(tmp)` in the failure path;
    verified by test (no `.tmp-*` leftovers). ✔
11. 0600 unchanged — creation mode + explicit `fchmodSync(0o600)`. ✔
12. Identical-existing-file no-op unchanged — `readExisting` `'same'`
    early-returns `ok`. ✔
13. Different-existing-file conflict unchanged — `linkSync` `EEXIST` →
    `ERR-BOOT-OUTPUT-CONFLICT`. ✔
14. No overwrite/fallback publication path added — `linkSync` remains the
    sole publish primitive; no rename/copy fallback exists. ✔
15. Injectable primitive is a narrow testability seam — `writeOutputFile`
    and `OutputByteWriter` are exported from `src/bootstrap/run.ts`, which
    is not reachable through any package export (`src/bootstrap` has no
    package subpath; `src/index.ts` and `./mcp` untouched); production
    always uses `writeSync`; the writer can only consume bytes on an
    already-open descriptor. No new model/public authority surface. ✔
16. Bootstrap static fs allowlist not widened — `node:fs` named imports in
    `run.ts` unchanged: `{closeSync, fchmodSync, fsyncSync, linkSync,
    openSync, readFileSync, unlinkSync, writeSync}` — all within the
    existing guard allowlist; dedicated guard rerun green (3/3). ✔

The three new focused tests genuinely exercise the required behaviors:

1. **Short-write loop** — injects a real partial-writing primitive (at most
   one byte per call via real `writeSync` with `length = 1`) and asserts the
   complete content is published with exact 0600. Exercises many repeated
   short writes through the actual loop.
2. **Zero-progress fail-closed** — one real partial write then `0`; asserts
   `ok:false`, `ERR-BOOT-OUTPUT-IO`, final path absent, and no `.tmp-*`
   leftovers (cleanup genuine).
3. **Subprocess output failure** — `--output` into a nonexistent directory
   via the real compiled CLI: exit 1, typed code, empty stdout.

All three pass. Existing no-op/conflict/0600/determinism tests unchanged and
green.

## 5. SIR-PS1-004 verification — VERIFIED CLOSED

Implementation report §12 now labels its inventory as "pre-correction
inventory, as reviewed" and states the independently verified
**pre-correction totals: 150 run / 148 pass / 0 fail / 2 skips**, explicitly
recording that the earlier 149/147 was a one-test arithmetic error and that
the senior review's re-execution and the report's own inventory agree on
150/148/2. §17 records the **post-correction totals: 153 run / 151 pass /
0 fail / 2 skips** with the full suite inventory.

Independently rerun inventory (this gate, compiled dist-test, Node
v22.23.2):

| Suite group | Result |
|---|---|
| `bootstrap-action` (15) + `bootstrap-static-guard` (3) + `runtime/bootstrap` (18) | 36/36 pass |
| `storage/static-guard` + `wp12-static-guard` + `runtime/static-guard` + `security` | 59/59 pass |
| `runtime/server` + `runtime/stdio` + `storage/initialization` | 48 run / 46 pass / 2 skips |
| `storage/trusted-input` | 10/10 pass |
| **Total** | **153 run / 151 pass / 0 fail / 2 skips** |

- Inventory sums to 153: 36 + 59 + 48 + 10 = 153. ✔
- Increase from 150 to 153 = exactly the three new SIR-PS1-002 tests
  (`tests/runtime/bootstrap.test.js` 15 → 18). ✔
- Pass count 148 → 151 (+3). ✔
- The only skips are the two pre-existing chown-privilege skips in
  `tests/unit/storage/initialization.test.js` (confirmed: 23 run / 21 pass /
  2 skip). ✔
- No failed/cancelled/todo tests (all runs report 0). ✔
- Historical (150/148/2, "as reviewed") and current (153/151/2) totals are
  clearly distinguished in the report. ✔

## 6. SIR-PS1-003 — DEFERRED / OPTIONAL HARDENING

Confirmed deferred. The corrections introduced **no** dynamic-import
handling, no namespace-import handling, no generalized parser, and no
static-guard redesign: the storage static-guard diff remains the
creator-consumer edge pin (unchanged from the senior-review state), the
wp12 diff is comment wording plus the pre-existing allowlist entry, and the
bootstrap dedicated guard is unchanged. Not closed, not implemented, not
promoted. No such code exists in the tree.

## 7. Exact focused tests rerun

- `dist-test/tests/runtime/bootstrap.test.js` (18 tests) — 18/18 pass
- `dist-test/tests/unit/bootstrap-action.test.js` (15) — 15/15 pass
- `dist-test/tests/unit/bootstrap-static-guard.test.js` (3) — 3/3 pass
- `dist-test/tests/unit/storage/static-guard.test.js`,
  `dist-test/tests/unit/wp12-static-guard.test.js`,
  `dist-test/tests/runtime/static-guard.test.js`,
  `dist-test/tests/security/security.test.js` — 59/59 pass
- `dist-test/tests/runtime/server.test.js`,
  `dist-test/tests/runtime/stdio.test.js`,
  `dist-test/tests/unit/storage/initialization.test.js` — 48 run / 46 pass /
  2 skips
- `dist-test/tests/unit/storage/trusted-input.test.js` — 10/10 pass

No unrelated suites rerun. Full Phase 3C not run.

## 8. Exact current evidence totals

**153 tests run / 151 pass / 0 fail / 2 skips** (2 skips = pre-existing
documented chown-privilege skips in `tests/unit/storage/initialization.test.js`).

## 9. Boundary regression check (A5)

- **Package exports:** `package.json` not in the diff (0 hits) — bin,
  exports (`.`, `./pi-adapter`, `./loading`, `./mcp`), version `0.1.0`,
  `private`, `UNLICENSED` all unchanged.
- **Nine-tool MCP surface:** `server.ts` untouched; authoritative
  `tests/runtime/server.test.js` (tools/list == nine, exact inventory) and
  `tests/runtime/static-guard.test.js` (exactly nine `registerTool` calls,
  no admin/approval vocabulary) rerun green.
- **No new MCP/bootstrap/admin tool:** server surface unchanged.
- **No provenance/capability/brand exported:** package-surface checks from
  the senior review unchanged (no new exports in `src/index.ts`,
  `src/adapters/mcp/index.ts`).
- **No new authority consumer:** creator-consumer pin still exactly the two
  composition roots (guard rerun green); `initializeTrustedStore` still has
  exactly one production importer.
- **`initializeTrustedStore()` behavior:** `src/storage/initialization/
  initialize.ts` diff contains comment lines only (verified by filtered
  diff).
- **Runtime configuration semantics:** `src/runtime/mcp/config.ts` diff
  unchanged since senior review (125 lines, same content); `compose.ts`
  untouched.
- **Host/platform lane:** no change to `TRUSTED_HOST_LANE` or env claims.
- **pi-guard:** not modified; the only diff mention is a pre-existing
  runbook sentence ("Verify the loaded pi-guard extension identity…").
- `git diff --check`: clean (exit 0).
- Exact changed-path inventory (tracked): 9 files — `docs/design/
  wp-14b-operator-onboarding.md`, `docs/operations/project-gateway-operator-
  runbook.md`, `src/runtime/mcp/cli.ts`, `src/runtime/mcp/config.ts`,
  `src/storage/initialization/initialize.ts`, `src/storage/trusted-input/
  bootstrap-input.ts`, `tests/security/security.test.ts`,
  `tests/unit/storage/static-guard.test.ts`, `tests/unit/wp12-static-guard.test.ts`.
  Untracked: the authorized PS-1 new files + WP-13D debris (excluded).

## 10. Git status before commit

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
?? docs/reports/pi-shuttle-ps-1-gateway-operator-bootstrap-senior-review.md
?? docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md   (WP-13D debris; excluded)
?? src/bootstrap/
?? src/control-plane/storage-bootstrap-action.ts
?? src/retrospective/                                                             (WP-13D debris; excluded)
?? tests/runtime/bootstrap.test.ts
?? tests/unit/bootstrap-action.test.ts
?? tests/unit/bootstrap-static-guard.test.ts
?? tests/unit/wp13d-retrospective.test.ts                                          (WP-13D debris; excluded)
?? tests/unit/wp13d-static-guard.test.ts                                           (WP-13D debris; excluded)
```

Plus this rereview report (created in Phase B, uncommitted). Nothing staged;
HEAD at baseline; WP-13D debris untracked and untouched.

## 11. Findings

No new correction-required findings. No reopened findings.

- SIR-PS1-001 — VERIFIED CLOSED (wording-only correction; topology true;
  guard-pinned two-consumer graph unchanged).
- SIR-PS1-002 — VERIFIED CLOSED (`writeAllBytes` sound on all 16 points;
  three genuine focused tests green; allowlist unchanged; seam is
  test-only and not package-reachable).
- SIR-PS1-003 — DEFERRED / OPTIONAL HARDENING (not implemented; no
  accidental guard redesign).
- SIR-PS1-004 — VERIFIED CLOSED (pre/post totals truthful and
  distinguished; 153/151/2 independently reproduced).

## 12. Envelope exceptions

None. No new authority domain, no model-accessible initialization, no
public provenance creation, no generic lifecycle writes, no Artifact
authority change, no broader platform/support semantics, no cross-cutting
invariant requiring redesign. The `writeOutputFile`/`OutputByteWriter`
exports are in-repo-internal only (no package subpath, not re-exported).

## 13. Verdict

PS-1 FOCUSED REREVIEW — ACCEPTED
