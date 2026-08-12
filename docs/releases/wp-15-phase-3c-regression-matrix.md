# WP-15 Phase 3C — Authoritative Regression Matrix

**Status:** WP-15 Phase 3B-B documentation; binds the Phase 3C execution
gate. The closure SHA is intentionally NOT hardcoded here; each lane run
records the exact SHA used. Normative basis: WP-15 contract §18
(authoritative release regression surface) and §21 (closure gate);
`docs/releases/wp-15-release-readiness.md` (evidence bundle).

## Rules

- **ALL required lanes are conjunctive.** One required lane failure →
  **closure blocked**. There is no majority/partial-pass verdict and no
  averaging across lanes.
- Each lane runs on the **same exact closure SHA** and an **independent
  clean clone/worktree** with the **matching required environment**,
  **local build output** (never a shared `node_modules`), and **isolated
  temp/storage resources**.
- No lane may modify the candidate (no source/test/package changes during
  the gate; regenerated artifacts must be byte-reproducible from committed
  fixtures).
- The final verdict is centralized: lane reports are inputs, the closure
  reviewer(s) issue the single consolidated verdict per
  `docs/releases/wp-15-release-readiness.md` §6.

## Lanes

### Lane 0 — Clean clone + candidate pin

- `git clone <repository>` at the exact closure SHA (verify `git rev-parse HEAD`).
- `npm ci`.
- Evidence: clone URL/SHA, environment versions, `npm ci` result.

### Lane 1 — Build / typecheck / default authoritative regression

- `npm run build` (deterministic bundle generation + `tsc -p tsconfig.json`).
- `npm run typecheck`.
- `tsc -p tsconfig.tests.json`.
- Default authoritative regression (`npm test`) covering the contract §18
  surface: unit, integration (conformance), security, pi-adapter
  (unit/integration/security/compatibility/enforcement), mcp, runtime,
  drafting, writing, trusted, pointofuse-v2; plus
  `node scripts/wp7-discovery-guard.mjs` and the WP-7 reader suites.
- Evidence: per-suite totals, mismatches, recorded known skips.

### Lane 2 — Explicit storage suite

- `npm run test:storage` — provided by Phase 3B-A
  (`scripts/run-test-surface.mjs dist-test/tests/unit/storage`; the
  script was absent at baseline HEAD and exists once Phase 3B-A is
  integrated). This lane is executable only when the script is present;
  the gate MUST NOT claim it otherwise.
- Evidence: totals, mismatches.

### Lane 3 — Process / crash suite

- `npm run test:storage-crash` (exists at baseline HEAD;
  `dist-test/tests/process/storage-crash/*.test.js`).
- Evidence: totals, mismatches.

### Lane 4 — Loading suite

- `npm run test:loading` — provided by Phase 3B-A
  (`scripts/run-test-surface.mjs dist-test/tests/loading`; tests exist
  under `tests/loading/`; the npm script was absent at baseline HEAD, per
  contract §18 which records `dist-test/tests/loading/*.test.js` as
  absent from the default `npm test` script and added by the gate). This
  lane is executable only when the script is present.
- Evidence: totals, mismatches.

### Lane 5 — Pi 0.83.0 compatibility/enforcement lane

- pi-adapter compatibility + enforcement + security suites
  (`npm run test:pi-adapter`) executed on the **supported Pi 0.83.0 host
  lane** (`SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`), plus
  pi-guard v0.1.2 compatibility evidence (trusted projection interface,
  ADR-037).
- This lane is the closure point for **P3A-WP15-006** (Pi 0.83.0
  supported-lane verification prerequisite). Local Pi 0.84.1 is NOT
  substitute evidence and must not be reported as such (contract §16).
- Evidence: host lane identity, extension versions, suite results,
  compatibility fingerprint.

### Lane 6 — Final clean-tree / integrity check

- On the closure clone used for the verdict: `git rev-parse HEAD` equals the
  exact closure SHA; `git status` clean (no untracked files, no staged
  changes); `git diff --check` clean; no candidate mutation during the
  gate; regenerated artifacts byte-reproducible from committed fixtures.
- Evidence: SHA, status output, diff check output.

## Parallel execution

Phase 3C MAY run lanes in parallel **only when each lane**:

- uses the **same exact closure SHA**;
- uses an **independent clean clone/worktree** (no shared build output);
- matches the **required environment** for that lane;
- builds **locally** (per-clone `npm ci` + `npm run build`);
- uses **isolated temp/storage resources** (distinct store locators,
  temp dirs, git homes).

No lane may modify the candidate. Final verdict is centralized (§Rules).

## Verdict format

```text
Lane N (<name>): PASS / FAIL / NOT-EXECUTABLE (reason) — evidence ref
...
Consolidated: WP-15 PHASE 3C PASSED — RELEASE READY
          or: WP-15 PHASE 3C BLOCKED (lane <N>: <failure>)
```
