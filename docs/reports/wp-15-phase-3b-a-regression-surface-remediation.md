# WP-15 Phase 3B-A — Regression Surface Remediation — Report

**Work package:** WP-15 Phase 3B-A (bounded regression-surface remediation
lane: P3A-WP15-001, P3A-WP15-002, P3A-WP15-003).
**Status:** complete; unstaged/uncommitted for integration review.
**Baseline:** HEAD `a6f85231c718157ef245ef7f1aa82f7729e59140` (branch
`main`), unchanged. Nothing staged; no commit; no push/tag/release/deploy.
**Lane boundary:** P3A-WP15-004/005/006 NOT addressed (other lanes). No
product source change, no schema change, no fixture/corpus change, no
authority-semantic change, no package-export change, no dependency change,
no Phase 3C start, no full authoritative regression.

## 1. P3A-WP15-001 — stale pointofuse export pin — CLOSED

**Root cause:** `tests/pointofuse-v2/boundary-v2.test.ts`, test "M: package
exports map unchanged — no deep-import subpath (m-2)", pinned the
pre-WP-14C three-subpath surface:

```ts
assert.deepEqual(Object.keys(pkg['exports']).sort(), ['.', './mcp', './pi-adapter']);
```

while the committed `package.json` export surface is exactly four subpaths
(`.`, `./mcp`, `./pi-adapter`, `./loading` — WP-9 added `./mcp`; WP-14C
added `./loading`).

**Correction (test expectation only; `package.json` untouched):**

```ts
// The committed export surface is exactly four subpaths: `.` (root), the
// WP-9 `./mcp` inspection subpath, `./pi-adapter`, and the WP-14C
// `./loading` subpath.
assert.deepEqual(Object.keys(pkg['exports']).sort(), ['.', './loading', './mcp', './pi-adapter']);
```

**Result:** the affected file executes 9/9 pass; the test still enforces
the exact intended four-subpath surface, no wildcard (`!subpath.includes('*')`),
no deep-import (`!subpath.startsWith('./src')`), no pointofuse private
subpath, no api/ subpath.

### Final package export pin (committed surface, unchanged):

```json
".":           dist/index.js (root entry)
"./pi-adapter": dist/adapters/pi/index.js
"./loading":    dist/loading/index.js
"./mcp":        dist/adapters/mcp/index.js
```

`package.json.exports` is byte-unchanged (verified by diff: only two named
test-script lines were added to `scripts`).

## 2. P3A-WP15-002 — storage suite discovery — CLOSED

**Root cause:** the authoritative storage test surface
(`tests/unit/storage/**` → `dist-test/tests/unit/storage/*.test.js`, 29
compiled files, flat layout) is NOT discovered by any existing npm script —
the default `test`/`test:unit` commands glob only the top-level
`dist-test/tests/unit/*.test.js`, so the storage suite (including a stale
pre-WP-14C export pin in `tests/unit/storage/static-guard.test.ts:517`,
the same defect class as P3A-WP15-001) was silently unexecuted.

**Script added** (existing `test:*` naming style):

```json
"test:storage": "node scripts/run-test-surface.mjs dist-test/tests/unit/storage"
```

**Discovery-proof wrapper** `scripts/run-test-surface.mjs` (smallest
necessary, no orchestration framework): recursive walk of literal paths
(no shell/Node globs — nested layouts are never silently missed), fails
exit 1 on zero discovered files and exit 2 on a missing/unreadable root
(with a clean-clone build hint: `npm run build && tsc -p
tsconfig.tests.json` — no stale generated output is assumed), forwards the
Node test runner's exit code verbatim, and prints the discovered file count.

**Same-root-cause pin corrected** (required by the 002 mandate that the
executed storage surface is the full intended surface and green):
`tests/unit/storage/static-guard.test.ts` "static guard: package exports
and dependencies unchanged" — `['.', './mcp', './pi-adapter']` →
`['.', './loading', './mcp', './pi-adapter']` (dependencies pin untouched;
test otherwise unchanged). This pin is identical to the 001 defect and was
only reachable once the storage surface became executable.

**Exact executed storage surface (actual counts):** 29 compiled test files
discovered and executed: audit-history, audit-reconstruction, audit,
capabilities, config-recovery, configuration, envelope, errors,
external-disposition, identifier, initialization, layout, limits,
lock-recovery, locks, metadata, probe, publication, quarantine, read,
recovery-mutation, recovery, registry-index, registry, retention, root,
static-guard, taxonomy, trusted-input — **433 tests, 431 pass, 2 skipped
(the already-accepted environment-dependent privilege-gated `chown` skips;
not treated as failures), 0 fail, exit 0.**

## 3. P3A-WP15-003 — loading suite discovery — CLOSED

**Script added:**

```json
"test:loading": "node scripts/run-test-surface.mjs dist-test/tests/loading"
```

Executes the complete WP-14C loading surface (no loading implementation
change): **2 compiled test files discovered (`load.test.js`,
`static-guard.test.js`) — 26 tests, 26 pass, 0 fail, exit 0.**

## 4. Script-quality checks — PASS

- No dependency on untracked WP-13D paths (wrapper walks only the compiled
  roots passed as arguments).
- Scripts run from repository root (npm semantics; wrapper resolves
  relative to CWD).
- Fail nonzero on test failure (child exit code forwarded — verified exit
  0 on green runs).
- Empty discovery cannot falsely succeed (verified: the Node test runner
  exits 0 when a test glob matches nothing; the wrapper instead fails
  nonzero — probed exit 2 on missing root, no glob used).
- No stale generated output assumed: missing compiled roots fail with the
  build hint; Phase 3C clean clones build first.

## 5. No package-surface drift — PASS

`package.json` changed fields: exactly two — `scripts."test:storage"`,
`scripts."test:loading"`. Explicitly unchanged (byte-identical, verified
by `git diff package.json`): `exports`, `version`, `engines`,
`dependencies`/`devDependencies`, `bin`, `files`, `name`, `type`, all
other scripts.

## 6. Actual focused test evidence

| Surface | Discovered | Tests | Pass | Skip | Fail | Exit |
|---|---|---|---|---|---|---|
| `pointofuse-v2/boundary-v2.test.js` (m-2 corrected) | 1 file | 9 | 9 | 0 | 0 | 0 |
| `npm run test:storage` | 29 files | 433 | 431 | 2 (accepted chown skips) | 0 | 0 |
| `npm run test:loading` | 2 files | 26 | 26 | 0 | 0 | 0 |

TypeScript: `tsc -p tsconfig.tests.json` clean (needed to compile the two
corrected test files); no broad typecheck run (no product-source change).
`git diff --check` clean.

## 7. Git state

HEAD `a6f85231c718157ef245ef7f1aa82f7729e59140` unchanged; branch `main`;
nothing staged; no commit. Lane changes: `M package.json` (+2 script
lines), `M tests/pointofuse-v2/boundary-v2.test.ts`, `M
tests/unit/storage/static-guard.test.ts`, `?? scripts/run-test-surface.mjs`.
WP-13D debris untouched/excluded. Concurrent-lane artifacts observed in
the working tree during this session (`docs/operations/…`,
`docs/releases/…` — created by other Phase-3 lanes, byte-untouched, not
part of this lane's candidate).

## 8. Envelope exception status

**NONE.** No product source, schema, fixture, corpus, authority, or export
change; no dependency; two named test scripts + one wrapper + two stale
test-expectation corrections only.

WP-15 PHASE 3B-A COMPLETE — REGRESSION SURFACES READY FOR INTEGRATION
