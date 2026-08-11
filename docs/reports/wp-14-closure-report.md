# WP-14 — Tunnel and ChatGPT Web Connectivity — Closure Report

**Work package:** WP-14 (ChatGPT Web connectivity; WP-11-backed controlled
proposal persistence; stateless changed-context retrieval).
**Phase:** closure — documentation/commit gate. **Verdict pinned:**

> WP-14 CLOSED.

**Contract baseline:** `a6d00a744802c3de1548b4a4c72af424bf2e83ad`
(`docs: establish WP-14 zero-transfer contract`; ADR-040; WP-14
pre-implementation contract decision; focused contract correction
SCR-WP14-UX-001…005 CLOSED).
**WP-14A baseline:** `d95539435e8a954f83f362b72b6f57a54afe8c5f`
(`feat: establish WP-14A controlled producer surfaces`).
**WP-14B candidate / closure-reviewed state:** uncommitted integration
candidate at closure review (`src/runtime/mcp/config.ts`,
`src/runtime/mcp/compose.ts`, `src/runtime/mcp/lanes.ts`,
`tests/runtime/wp14b-e2e.test.ts`,
`docs/design/wp-14b-operator-onboarding.md`,
`docs/reports/wp-14b-implementation-report.md`), committed by this
closure commit.

## 1. Review Acceptances

- **WP-14A senior review:** `WP-14A SENIOR REVIEW ACCEPTED — READY FOR
  BASELINE COMMIT` (persistence provenance Model B; WP-10/WP-11
  composition; destination derivation; changed-context confinement;
  config/lane wiring; nine-tool inventory; authority/secrets; error
  redaction; test adequacy).
- **WP-14B senior review:** `WP-14B SENIOR REVIEW ACCEPTED — READY FOR
  WP-14 CLOSURE REVIEW` (gitHome/gitTmpdir integration correction;
  real-CLI E2E persist and changed-context workflows; failure/disconnect
  evidence; secret-leakage test; operator onboarding; live-smoke gap;
  closure-gate coverage; no feature creep).
- **WP-14 closure review:** `WP-14 CLOSURE REVIEW ACCEPTED — READY FOR
  WP-14 CLOSURE COMMIT` (nine-item closure matrix all PASS or PASS WITH
  NONBLOCKING OBSERVATION; no blocking findings).

## 2. Closed Surface Inventory

Exactly nine registered MCP tools (verified in the runtime and through
real `tools/list` over stdio):

- six WP-9 inspection tools: `validate-artifact`,
  `inspect-stored-record`, `inspect-registry`, `inspect-audit-history`,
  `verify-record`, `enumerate-class`
- one WP-10 drafting tool: `draft-artifact`
- one WP-14A controlled proposal persistence tool: `persist-artifact`
- one WP-14A changed-context inspection tool: `inspect-changes`

No generic filesystem-write surface; no approval/issuance/grant/
activation/execution/receipt surface; no tenth tool.

## 3. Controlled Persistence (WP-14A)

- Exactly four persistable proposal kinds: `TaskSpec`,
  `AuthorityPolicy`, `ContextManifest`, `CompletionContract`
  (`ExecutionBundle` is draftable but never persistable).
- Model B validation-at-persistence: trusted structural + semantic
  validation, canonicalization, and trusted digest/correlation at the
  persistence boundary; freshly host-produced internal validated
  representation; caller-supplied validation provenance never trusted.
- Committed WP-11 controlled-write reuse: create-only, prospective
  containment + point-of-use revalidation, descriptor-anchored executor,
  service-user ownership, configuration identity correlation, bounded
  redacted evidence.
- Persisted material remains proposal/untrusted project-visible content;
  no lifecycle state is created (verified: empty registry, byte-identical
  store snapshot in E2E).

## 4. Changed-Context Retrieval (WP-14A)

- Stateless; changed state derives from fresh WP-7 Git inspection at
  point of use.
- Optional content reads confined to the fresh changed set; unrelated
  paths fail closed (`membership-denied`); workspace/read containment
  independently reapplied by the WP-7 read boundary; drift (symlink
  escape) fails closed.
- Bounded output (file count, metadata, diff bytes, per-file content
  bytes) with truthful truncation; typed failures; no silent partial
  success.
- No `ActiveContext`, `HotkeyRecord`, context database, or event
  protocol exists.

## 5. Zero-Transfer UX Result

The approved ChatGPT-side workflow is demonstrably achievable through
the real CLI/runtime integration (WP-14B E2E): inspect project state →
construct/draft proposal artifact → Model-B validate + persist through
controlled write → project-visible proposal file appears with no manual
file transfer → local project changes → `inspect-changes` retrieves the
changed state without copy/paste/upload → visible typed feedback on
every action. Pi artifact loading remains WP-14C-owned.

## 6. Connectivity / Tunnel-Boundary Result

Model: ChatGPT Web → external Secure MCP Tunnel / connector → existing
stdio `project-gateway-mcp --config ...` → nine bounded Gateway tools.
The Gateway itself owns no HTTP server, OAuth server, TLS endpoint,
token exchange, tunnel daemon, scheduler/service manager, or secret
store. **Live ChatGPT/tunnel smoke was NOT available and is NOT
claimed or fabricated.** Closure rests on scripted tunnel-conformance
evidence: the WP-14B E2E suite speaks the exact modern MCP protocol over
stdio to the real CLI — the same transport boundary the tunnel bridges —
per the committed rule `live where operationally available; otherwise
tunnel-conformance scripted evidence`.

## 7. Operator Configuration / Git-Lane Correction

Final operator model (onboarding guide
`docs/design/wp-14b-operator-onboarding.md`): closed-field surface
configuration; workspace lanes (`workspaceId`, `root`,
`artifactLocation`); `gitPath` (pinned supported Git binary 2.45.4,
fingerprint-checked); `gitHome`/`gitTmpdir` (empty, operator-owned,
outside every workspace root — the WP-14B integration correction for the
committed WP-7 host-lane requirement; absent → fail-closed composition
error; no environment fallback); tunnel command handoff (conceptual
flags belong to the external platform); connector onboarding; external
credential placement; clean EOF shutdown. `gitHome`/`gitTmpdir` create
no new authority and remain trusted operator startup configuration.

## 8. Failure / Disconnect Result

Integrated E2E evidence proves fail-closed behavior for: invalid/missing
config; startup/lane failure; malformed request; unsupported tool/kind;
semantic validation failure; create-only collision (existing target
never overwritten); containment/unknown-workspace denial; changed-context
membership denial; unknown surface; EOF/disconnect (clean child exit,
zero stderr). No silent partial success; no half-written acknowledged
artifact; trusted store/lifecycle state unchanged.

## 9. Authority Isolation

WP-14 proves no lifecycle/execution authority: no approval, issuance,
revocation, RuntimeGrant creation, activation, Pi execution, result
publication authority, TrustedReceipt, pi-guard mutation, or Git
mutation is reachable from connectivity, tunnel authentication,
persistence, changed-context retrieval, or short UX invocation
(verified import graph; closed nine-tool vocabulary; read-only Git
usage; E2E negative evidence).

## 10. Secrets / Config Result

Gateway runtime configuration is secret-free; credentials are
external/operator-local and never appear in artifacts, MCP
requests/responses, repository configuration, or committed examples;
WP-14 implements no secret-storage facility; startup diagnostics name
closed-field violations without echoing configuration values.

## 11. Preserved Nonblocking Observations

- **SIR-WP14A-001** — inherited 8 MiB diff ceiling: bounded and
  truthfully truncated; no change warranted. Nonblocking.
- **SIR-WP14A-002** — deleted/spaced/renamed changed-context coverage:
  **CLOSED** by WP-14B E2E evidence.
- **SIR-WP14A-003** — SDK request parsing before adapter caps:
  pre-existing pattern; no concrete integration issue. Nonblocking.
- **SIR-WP14B-001** — rename/original-path changed-context semantics:
  committed WP-7 status model surfaces renames under the original path;
  contract-correct and fail-closed; UX observation for WP-14C/UX
  follow-up. Nonblocking.
- **SIR-WP14B-002** — `gitHome`/`gitTmpdir` operator setup burden:
  documented one-time setup step. Nonblocking.

## 12. Verification Evidence

- WP-14B E2E suite: 4/4 (persist workflow; changed-context workflow;
  failure/disconnect; startup failure/redaction).
- Runtime suites: 35/35 (nine-tool inventory over real stdio).
- MCP unit suites: 96/96 (incl. WP-14A persist/changes/static guards).
- WP-14A neighbor suites passed before the WP-14A baseline commit.
- `git diff --check` clean at every gate.
- No broad regression run at closure (no cross-cutting change requiring
  it); no tests rerun at this commit gate.

## 13. Project State

- WP-13: CLOSED.
- WP-14 Product UX Contract: ESTABLISHED.
- WP-14A: CLOSED. WP-14B: CLOSED. WP-14: **CLOSED.**
- **WP-14C is now the next roadmap package eligible for contract /
  implementation authorization** according to its own gate (Pi
  zero-transfer artifact loading; bundle-selection semantics deferred to
  its own contract decision; NOT STARTED / NOT AUTHORIZED here).
- **WP-15 remains BLOCKED** until WP-14C closes (roadmap order
  `WP-14 → WP-14C → WP-15`).

## 14. Final Git State Before Commit

- HEAD: `d95539435e8a954f83f362b72b6f57a54afe8c5f` (WP-14A baseline).
- Uncommitted at closure review: the six reviewed WP-14B candidate
  paths (three source, one test, two docs) plus this closure report and
  the current-state roadmap/planning-status notes, committed by this
  closure commit.
- Pre-existing untracked WP-13D historical leftovers remain excluded.
- No push/tag/release/deploy; nothing else staged or committed.
