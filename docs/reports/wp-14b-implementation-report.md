# WP-14B Implementation Report — Integration and End-User Validation

**Work package:** WP-14B (second WP-14 slice; human-authorized).
**Phase:** implementation candidate — NOT committed, NOT closed. Review
gate: senior review.
**Baseline:** `d95539435e8a954f83f362b72b6f57a54afe8c5f` (`feat: establish
WP-14A controlled producer surfaces`; branch `main`).
**Nothing staged or committed.** No push/tag/release/deploy. WP-14C, WP-15
not begun. WP-14A is NOT redesigned: one concrete integration defect
(git-lane child environment) was corrected through operator configuration
plumbing — no MCP capability changed.

## 1. Baseline and Objective

Proves the ChatGPT-side zero-transfer workflow end-to-end through the real
stdio runtime (the exact path an external Secure MCP Tunnel launches):

`connectivity → inspect → draft → trusted revalidation → persist proposal
artifact → retrieve changed project context`

plus fail-closed failure evidence and authority-isolation negative
evidence. Pi artifact loading is explicitly NOT part of WP-14B (WP-14C).

## 2. Files Changed

**New:**
- `tests/runtime/wp14b-e2e.test.ts` — four end-to-end integration tests
  over the real CLI subprocess (persist workflow; changed-context
  workflow incl. deleted/spaced/renamed paths; failure/disconnect
  evidence; startup failure evidence).
- `docs/design/wp-14b-operator-onboarding.md` — tunnel launch, connector
  registration, credential placement, workflow invocation, shutdown.

**Modified (integration correction):**
- `src/runtime/mcp/config.ts` — `SurfaceConfig` gains optional
  `gitHome`/`gitTmpdir` (absolute paths).
- `src/runtime/mcp/compose.ts` — surfaces with `workspaces` now REQUIRE
  `gitHome`/`gitTmpdir` (fail-closed typed composition error otherwise);
  lane construction uses them instead of `process.env.HOME/TMPDIR`.
- `src/runtime/mcp/lanes.ts` — documentation of the git-lane child
  environment contract (no behavior change beyond the parameter source).

No MCP tool, adapter, registry, schema, or WP-11/WP-7 boundary changed.

## 3. Tunnel / Connector Integration Model

External and operator-owned, per the committed handoff (WP-9 closure §15):
the local stdio CLI remains the tunnel's `--mcp.command`. WP-14B adds only
operator configuration/runbook material
(`docs/design/wp-14b-operator-onboarding.md`): surface config template,
tunnel launch, ChatGPT connector registration, nine-tool discovery check,
workflow invocation, credential placement, clean shutdown. No
repository-owned HTTP/OAuth/TLS/token/daemon/scheduler/service-manager/
secret-store code exists (runtime static guards unchanged and passing).
Credentials are external/operator-local and appear in no Gateway
configuration, artifact, request/response, fixture, or committed example.

## 4. Operator Workflow

Documented end-to-end: configure surface (closed fields; `gitHome`/
`gitTmpdir` as empty operator-owned dirs) → launch through the tunnel →
register/connect the ChatGPT connector → verify the nine-tool discovery →
invoke inspect/persist/changes → understand credential placement (external
only) → shut down (session close → EOF → clean child exit; or SIGTERM).

## 5. End-to-End Persist Evidence

Through the real stdio subprocess with a v2 store, a git workspace, and a
configured artifact location:

- nine tools discoverable; `inspect-registry` reachable;
- `draft-artifact` constructs the candidate and returns the trusted
  canonical bytes;
- `persist-artifact` (Model B revalidation inside) returns typed evidence
  (kind `TaskSpec`, instance/revision identity, trusted digest,
  artifact-root-relative destination, byte count, `missing-to-file`);
- the project-visible file exists and its bytes EQUAL the trusted
  canonical bytes produced by the surface itself;
- the store registry stays empty (`recordsByClass == {}`), `enumerate-class`
  on `approval-record` is empty, and the store directory snapshot (paths/
  sizes/mtimes/modes) is byte-identical before/after the whole session —
  the proposal is unapproved/unissued and no lifecycle/control-plane
  record was created;
- no execution path exists on the surface (no execute/activate/issue
  tools; unknown-tool calls are protocol errors).

## 6. Changed-Context Evidence

Through the real runtime after real project modifications:

- modified file, untracked file with spaces, deleted file, and a rename
  all appear in the fresh Git-derived changed set (SIR-WP14A-002);
- bounded diff text covers the modification;
- content retrieval works for a requested subset of the fresh changed set
  (including the space-containing path) with exact bytes;
- an unrelated committed file is rejected with `membership-denied` — the
  surface cannot read unrelated files;
- the modeled user flow requires no paste, upload, or path transcription:
  only the opaque `workspaceId` (and optionally paths already present in
  the fresh set).

## 7. Failure / Disconnect Evidence

All through the real runtime, with a store snapshot asserted unchanged and
exactly one proposal file present at the end (no half-written state):

- missing config file → nonzero exit, empty stdout, bounded stderr;
- malformed config (unknown field, including a planted `secretToken`
  value) → nonzero exit; the diagnostic names the closed-field violation
  and never echoes the planted value;
- unregistered tool (`approve-artifact`) → protocol-level not-found error;
- unsupported kind (`ExecutionBundle`) → `unsupported-artifact-kind`;
- malformed request (empty kind) → `invalid-request`;
- persistence validation failure (semantic violation) → `validation-failed`
  with bounded findings;
- create-only collision (second persist of the same revision) →
  `write-denied`; the existing file bytes are unchanged (never overwritten);
- containment denial (unknown workspace) → `write-denied`;
- changed-context membership denial (unrelated path) → `membership-denied`;
- unknown surface → `not-found`;
- lost/closed stdio connection: the server exits cleanly on EOF, and the
  whole session emits ZERO stderr diagnostics (typed, redacted outcomes
  throughout).

No retry/recovery/scheduler behavior was added.

## 8. Authority-Isolation Evidence

Negative evidence from §5 and §7: no approval/issuance/revocation/grant/
activation/execution/receipt/pi-guard surface exists (nine-tool closed
vocabulary; unregistered lifecycle tools are protocol errors); the store
is untouched; the registry is empty; the only persisted object is the
project-visible proposal file, which remains proposal/untrusted project
content (no lifecycle record references it). Transport authentication
remains distinct from protocol authority (no Gateway auth code exists).

## 9. Live ChatGPT Smoke Result

**UNAVAILABLE** — no operational ChatGPT/tunnel environment is reachable
from this build environment. No live evidence is fabricated. The
reproducible scripted conformance evidence is the WP-14B E2E suite: the
client SDK speaks the exact modern MCP protocol over stdio to the real
CLI — the same transport boundary the tunnel bridges — covering
connectivity, discovery, inspect, persist, changed-context, failures, and
disconnect. The live-smoke gap is recorded for closure review.

## 10. SIR-WP14A-001/002/003 Handling

- **SIR-WP14A-001 (diff cap):** integration evidence shows the inherited
  WP-7 Git output ceiling (8 MiB) is practical — bounded, truncated
  truthfully, no impracticality observed. No change.
- **SIR-WP14A-002 (deleted/spaced/renamed):** explicit integration
  coverage ADDED in the changed-context E2E test (deleted file, untracked
  file with spaces, rename) — all correctly reported by the fresh
  changed set. Closed by evidence.
- **SIR-WP14A-003 (request size):** integration revealed no real
  request-size problem; the WP-3 artifact byte bound and the adapter's
  closed bounds hold through the real path. No change.

## 11. Focused Tests and Results

| Suite | Result |
|---|---|
| `tests/runtime/wp14b-e2e.test.js` (4 new E2E tests) | 4/4 |
| `tests/runtime/*` (server, static guard, stdio, wp14b — nine-tool inventory) | 35/35 |
| `tests/mcp/unit/*` (WP-14A neighbor, unaffected paths) | 96/96 |

Per the testing policy, no WP-6…WP-13 suites and no full regression were
run. `git diff --check` clean.

## 12. Closure-Gate Assessment (WP-14)

| Closure element | Status |
|---|---|
| ChatGPT/tunnel reaches the intended nine-tool Gateway surface | PROVEN (stdio E2E; live smoke pending) |
| Project inspection works | PROVEN (`inspect-registry`, `validate-artifact`, discovery) |
| Proposal persistence works through WP-11 | PROVEN (canonical-byte file, typed evidence) |
| Changed-context retrieval without manual transfer | PROVEN (fresh set, diff, subset contents) |
| Failure remains fail-closed | PROVEN (typed redacted outcomes, clean EOF exit, no half-state) |
| No generic filesystem-write surface | PROVEN (closed vocabulary; single controlled write) |
| No lifecycle/execution authority created | PROVEN (empty registry, untouched store, no lifecycle tools) |
| Visible typed feedback | PROVEN (evidence/error shapes in every outcome) |
| Operator onboarding sufficient | PROVEN (operator guide; fail-closed config errors) |
| Pi artifact loading | OUT OF SCOPE — WP-14C |

## 13. Remaining Limitations

- Live ChatGPT smoke not performed (environment unavailable); scripted
  stdio conformance stands in; gap recorded for closure review.
- Tunnel-side integration remains operator-owned; WP-14B validates the
  Gateway side of the boundary only.
- `gitHome`/`gitTmpdir` are required operator fields for laned surfaces
  (fail-closed when absent) — a documented one-time setup step.

## 14. Git State

- HEAD unchanged: `d95539435e8a954f83f362b72b6f57a54afe8c5f`.
- Nothing staged, nothing committed; no push/tag/release/deploy.
- Pre-existing untracked WP-13D leftovers untouched.

WP-14B IMPLEMENTATION COMPLETE — READY FOR SENIOR REVIEW
