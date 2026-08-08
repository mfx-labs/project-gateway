# WP-9 — MCP Inspection Surface — Closure Report

> **Status: WP-9 INDEPENDENT CLOSURE REVIEW: ACCEPTED — WP-9 STATUS: CLOSED.**
> This document was prepared as the authoritative WP-9 closure evidence
> (originally a CLOSURE CANDIDATE) and has been accepted by the independent
> closure review at baseline `045ae7c2f4a980d392333ac6823e33ffa5513d24`;
> the closure review committed this report together with the three current-
> state documentation updates.
>
> The candidate-preparation history is preserved below; the final
> closure-state transition is recorded in §19.

## 1. Work Package Identity

| Field | Value |
|---|---|
| Work package | WP-9 — MCP inspection surface |
| Roadmap owner contract | Read-only MCP tools for inspection (artifacts, registry views, validation) |
| Normative prerequisites | WP-7 (controlled project reader / internal discovery), WP-4 (artifact validation) |
| Roadmap closure gate | Inspection-only; no mutation tools |
| Roadmap order | 4 (after WP-8, before WP-10 drafting) |
| Later consumers | WP-14 (Tunnel and ChatGPT Web connectivity; prerequisites WP-13, WP-9) |

## 2. Baseline / Closure-Candidate HEAD

- Branch `main`; HEAD exactly `045ae7c2f4a980d392333ac6823e33ffa5513d24`
  (Slice 5 commit), unchanged by closure preparation.
- BEFORE closure preparation: working tree clean; staging empty.
- AFTER closure preparation: staging empty; HEAD unchanged; exactly the
  four authorized closure-documentation paths below are present (one new
  untracked closure report + three modified tracked documentation files),
  so the working tree is intentionally NOT clean; no unrelated path and
  no source/test/package/schema delta.
- All five WP-9 slice commits are in the first-parent ancestry of HEAD:
  `b3cde8b → 0f3ac3a → d5418f7 → ef118fc → 045ae7c`.

## 3. Original Objective

From the accepted roadmap (`docs/design/post-wp5a-roadmap.md`, WP-9 work
package definition):

- **Objective:** inspection-only MCP tools.
- **Inputs:** WP-7 reader, WP-4 validation.
- **Outputs:** read-only MCP inspection tools (artifacts, registry views,
  validation).
- **Owned:** inspection surface.
- **Prohibited:** drafting, writes, execution.
- **Invariants:** inspection-only; no mutation capability.
- **Tests:** tool-surface read-only audits.
- **Non-goals:** no mutation tools, no drafting.
- **Dependencies:** WP-7, WP-4 (normative prerequisites); later consumed by
  WP-14 connectivity.
- **Later consumers / boundary:** WP-10/WP-11/WP-12 (drafting, structured
  writing, control plane) are separate work packages; WP-9 closure does not
  imply any of those capabilities exist.

## 4. Scope Completion Matrix

| Requirement | Implementation owner / path | Accepted slice | Accepted commit | Test/guard evidence | Closure status |
|---|---|---|---|---|---|
| Artifact/content validation inspection | `src/adapters/mcp/validate.ts` (pure WP-4 `validateArtifactInput`) | Slice 1 | `b3cde8b` | `tests/mcp/unit/inspection.test.ts` | CLOSED |
| Exact stored-record inspection | `src/adapters/mcp/inspect.ts` (`inspect-stored-record` via WP-8 read) | Slice 1 | `b3cde8b` | `tests/mcp/unit/inspection.test.ts` | CLOSED |
| Registry inspection | `src/adapters/mcp/inspect.ts` (`inspect-registry`, WP-8 registry view, optional verified persistent-index fast path, opaque self-validating continuation) | Slice 1 | `b3cde8b` | `tests/mcp/unit/inspection.test.ts` | CLOSED |
| Audit-history inspection | `src/adapters/mcp/inspect.ts` (`inspect-audit-history` via assurance-revalidated WP-8K `inspectAuditHistory`) | Slice 2 | `0f3ac3a` | `tests/mcp/unit/inspection.test.ts` (history sections) | CLOSED |
| Verify-by-identity | `src/adapters/mcp/inspect.ts` (`verify-record` via WP-8 `verifyRecord`) | Slice 3 | `d5418f7` | `tests/mcp/unit/inspection.test.ts` | CLOSED |
| Bounded class enumeration | `src/adapters/mcp/inspect.ts` (`enumerate-class` via WP-8 `enumerateClass`, truthful truncation, position continuation) | Slice 3 | `d5418f7` | `tests/mcp/unit/inspection.test.ts` | CLOSED |
| Multi-store host composition | `src/adapters/mcp/registry.ts` (`createMcpInspectionRegistry`) | Slice 4 | `ef118fc` | `tests/mcp/unit/registry.test.ts` | CLOSED |
| Local MCP runtime | `src/runtime/mcp/{cli,compose,server,config,diagnostics}.ts`; package `bin` `project-gateway-mcp` | Slice 5 | `045ae7c` | `tests/runtime/{server,static-guard,stdio}.test.ts` | CLOSED |
| Read-only behavior | Whole adapter/runtime; deep-frozen redacted responses | Slices 1–5 | all | `tests/mcp/unit/inspection.test.ts`; `tests/runtime/static-guard.test.ts` | CLOSED |
| No mutation capability | Static guards forbid mutation vocabulary/imports in adapter and runtime; no write tool | Slices 1–5 | all | `tests/mcp/unit/static-guard.test.ts`; `tests/runtime/static-guard.test.ts` | CLOSED |
| No direct filesystem/root selection by MCP clients | `surfaceId` routing only; clients never supply roots/locators/paths; registry is host-owned | Slices 4–5 | `ef118fc`, `045ae7c` | `tests/mcp/unit/registry.test.ts`; `tests/runtime/stdio.test.ts` | CLOSED |

## 5. Accepted Slice / Commit Ledger

| Slice | Content | Commit | Parent |
|---|---|---|---|
| 1 | Transport-free MCP inspection adapter (`validate-artifact`, `inspect-stored-record`, `inspect-registry`) | `b3cde8bdf853452b57401812708fb3096a65da45` | pre-WP-9 base (`eb7feab`) |
| 2 | Audit-history inspection | `0f3ac3ae2fcae7deb4bd167659e5d9b1256e764e` | `b3cde8b` |
| 3 | Verify-by-identity + bounded enumeration | `d5418f7475609bbf14bc38c9ed179bdcf5c67e28` | `0f3ac3a` |
| 4 | Host-owned multi-store inspection registry | `ef118fc565ddbb0254c26881d943b52ad3cf3547` | `d5418f7` |
| 5 | Local stdio MCP runtime | `045ae7c2f4a980d392333ac6823e33ffa5513d24` | `ef118fc` |

Every slice was independently reviewed before its commit; correction
history is preserved in §13.

## 6. Final Tool Inventory

The public MCP runtime exposes exactly six tools, per
`MCP_INSPECTION_TOOLS` in `src/adapters/mcp/types.ts` (verified from
source and by the runtime static guard):

1. `validate-artifact`
2. `inspect-stored-record`
3. `inspect-registry`
4. `inspect-audit-history`
5. `verify-record`
6. `enumerate-class`

No seventh admin/mutation/registration/tunnel tool exists (static guard
asserts exactly six `registerTool` calls and forbids
`list-stores`/`register-store`/`select-store`/`unregister-store`/`health`
names). All six advertise `annotations.readOnlyHint: true` (a hint, not a
security boundary) and require `surfaceId`.

## 7. Architecture / Boundary Summary

- **Adapter (`src/adapters/mcp/`)** is transport-free and SDK-free:
  zero `@modelcontextprotocol/*` imports in `src/adapters/`,
  `src/storage/`, `src/trusted/`, `src/schema/` (verified by grep over
  current source and enforced by `tests/mcp/unit/static-guard.test.ts`).
  It exposes the committed request envelope `{ tool, params, requestId? }`
  and the closed response shape.
- **Runtime (`src/runtime/mcp/`)** is the only MCP-SDK consumer: `cli.ts`
  uses `serveStdio` from `@modelcontextprotocol/server/stdio`; `server.ts`
  owns pure routing (`surfaceId` is destructured out before the internal
  envelope is built, line 73) and tool registration; `compose.ts` is the
  localized trusted composition root; `config.ts` loads operator startup
  config; `diagnostics.ts` owns bounded stderr.
- **Package boundary:** `src/index.ts` remains storage-private (pure
  validation library API only); exports remain exactly `.`, `./pi-adapter`,
  `./mcp`; the package `bin` (`project-gateway-mcp` →
  `./dist/runtime/mcp/cli.js`) owns runtime invocation; trusted
  bootstrap/runtime internals are not re-exported as public authority
  creators.

## 8. Security / Read-Only Invariants

The complete WP-9 path — MCP client input → stdio runtime → inspection
registry → adapter → read/domain layer — cannot reach project/store
mutation. Evidence:

- **Runtime static guard** (`tests/runtime/static-guard.test.ts`): no
  stdout writes, no `node:net`/`node:http`/`node:https`/`node:tls`/
  `node:dgram`, no WebSocket, no tunnel-client, no OAuth, no
  `child_process`/`spawn`/`exec` in runtime production source; no storage
  mutation vocabulary (`publishRecord`, `publishImmutableRecord`,
  `executeRecoveryMutation`, `executeRetentionMutation`,
  `acquireWriterLock`/`releaseWriterLock`/`breakWriterLock`,
  `executeConfigurationRecovery`, `writeFileSync`, `mkdirSync`, `rmSync`,
  `chmodSync`, `renameSync`, `unlinkSync`); trust creators localized to
  `compose.ts` and never re-exported through `./mcp`.
- **Adapter static guard** (`tests/mcp/unit/static-guard.test.ts`):
  `./mcp` exposes no storage authority; no trusted-material creation in
  the adapter; exactly six tools.
- **Mutation watchdog**: runtime tests exercise the six tools while
  asserting zero store mutation (store snapshot equality before/after MCP
  sessions in `tests/runtime/stdio.test.ts`).
- **General security suite** (`tests/security/security.test.ts`):
  production modules perform no hidden filesystem/network/process I/O;
  the runtime is covered by its own dedicated guard (explicitly noted in
  the guard's WP-9 comment).
- **Read-only domain path**: every tool routes through read/verify
  domain APIs (`readRecord`, `inspectAuditHistory`, `verifyRecord`,
  `enumerateClass`, registry derivation); no write capability is created
  anywhere on the path. Responses are plain frozen data; registration
  objects are routing data only.

## 9. Cursor Semantics Summary

Cursor semantics are PER-TOOL and must stay distinct (accepted review
conclusions):

- **`inspect-registry`**: opaque self-validating continuation,
  generation/surface-bound; a store snapshot change yields the committed
  `stale-cursor` outcome; per-request revalidation (registration is never
  cached authority).
- **`inspect-audit-history`**: target/query/store/snapshot-bound
  continuation; snapshot change → `stale-cursor`; invalid shape →
  `invalid-cursor`; bounded pagination over the WP-8K audit stream.
- **`enumerate-class`**: position-only continuation under the accepted
  RDS-004 semantics; live resume over deterministic shard order; truthful
  truncation; NO snapshot guarantee is invented (accepted Slice 3
  conclusion: `ENUMERATION CURSOR MODEL: CONTRACT-CONFORMANT`).

## 10. Multi-Store Model

`createMcpInspectionRegistry` (`src/adapters/mcp/registry.ts`) is the
accepted host-owned multi-store routing abstraction:

- Opaque logical `surfaceId` (closed pattern `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`,
  max 64; never a path/locator/trusted-input serialization).
- Immutable after construction; registration from genuine branded trusted
  configuration + genuine branded `TrustedStorageBootstrapInput` + strict
  `verifyStoreInstance` at construction.
- Duplicate/conflict handling: fail-closed at registration and per
  request; malformed selector → `invalid-request`; well-formed unregistered
  selector → `not-found` (no inventory/path leakage).
- Zero client root/path control; same-store aliases (multiple surfaceIds
  over one store) are allowed and independently smoke-tested.
- No seventh public MCP registration tool.
- Accepted review conclusions: `SURFACE INVENTORY EXPOSURE:
  HOST-LOCAL AND CONTRACT-CONFORMANT`; `ENUMERATION CROSS-SURFACE ROUTING:
  CONTRACT-CONFORMANT`; `GENERATION SEEDING: INDEPENDENT / NOT REQUIRED
  FOR SLICE 4`.

## 11. Local Stdio Runtime

- **Decision:** `WP-9 TRANSPORT/RUNTIME DECISION: LOCAL STDIO`. Rationale
  at closure-summary level: local/private product fit; no inbound
  listener; external tunnel support later (WP-14 launches this CLI as the
  tunnel command); lower operational/security surface than HTTP/public
  HTTPS for the current MVP.
- Entry: package `bin` `project-gateway-mcp` →
  `./dist/runtime/mcp/cli.js` (shebang'd, starts with `--config <file>`).
- Serves through the accepted MCP v2 SDK path (`serveStdio` factory from
  `@modelcontextprotocol/server/stdio`), which owns era negotiation
  (modern 2026-07-28 opening via `server/discover` plus SDK-managed legacy
  compatibility).
- Owns no HTTP listener (runtime static guard + live `/proc` socket probe
  in `tests/runtime/stdio.test.ts`), no public HTTPS endpoint, no OAuth,
  no Secure MCP Tunnel implementation.
- Modern conformance evidence (accepted Slice 5 + current tests):
  `client.getProtocolEra() === 'modern'`, `server/discover` answered, six
  tools with stable schemas and `readOnlyHint`, protocol/tool-error
  distinction (see §18).

## 12. Startup-Config Trust Boundary

The host-local startup config (`--config <file>`) is:

- operator-owned host composition input;
- security-sensitive (it names which stores become inspectable and may
  carry limit-profile overrides);
- read only at startup, never an MCP request field;
- composed through the same genuine-brand/trusted-bootstrap pipeline that
  gates every registration — loading JSON never bypasses branding.

It is deliberately NOT described as untrusted trivia: it is inside the
security boundary as host input, and the Slice 5 corrections hardened
exactly this boundary.

**F1 — startup-config byte bound (CLOSED).** `MAX_STARTUP_CONFIG_BYTES =
1024 * 1024` (1 MiB, verified from `src/runtime/mcp/config.ts`), a
runtime-local ceiling that never enters any limit profile. True bounded
read: explicit `openSync`; no unbounded `readFileSync(path,'utf8')`;
single fixed `MAX+1` allocation; positioned `readSync` loop with a
`total <= MAX` guard; `fstatSync` is only a fast path; post-loop reject;
descriptor closed on every path. Byte-based ceiling (UTF-8 bytes, not
character count); fails before serving (non-zero exit, zero stdout,
bounded stderr). Boundary probes: exactly MAX accepted, MAX+1 rejected,
96 MiB reproduction rejected, multibyte UTF-8 rejected by byte count,
read-failure cleanup with no descriptor leak.

**F2 — duplicate JSON keys (CLOSED).** Startup config is parsed through
the repository's duplicate-key-rejecting raw JSON intake
(`parseRawJson` from `src/json/scanner.ts`, byteLimit =
`MAX_STARTUP_CONFIG_BYTES`), so duplicate object members are rejected at
every nesting level before the single model construction. No silent
last-wins semantics; no second independent `JSON.parse` of the config
text exists. Prototype-shaped keys are inert closed-field data.

**F3 — limit-profile selection (CLOSED).** Every startup `limitProfile`
override is checked through the committed LMT-013 config-selection gate
`validateLimitSelection(name, value, true)` (`src/storage/limits/
limits.js`). The runtime keeps no copy of the limit table and no weaker
check; validated values are the composed values; the domain consumes them
(verified by a live scan-bound probe: a selected `enumerationResults`
bound is observed by the running runtime).

## 13. Correction History (preserved)

- **Slice 1 — F1 finding:** original review found success responses
  failed to echo `requestId`. Narrow correction applied; independently
  rereviewed; accepted and committed at `b3cde8b`. History is not
  rewritten: the finding existed and was corrected.
- **Slice 2:** passed independent review before commit (`0f3ac3a`).
- **Slice 3:** passed; independent conclusion `ENUMERATION CURSOR MODEL:
  CONTRACT-CONFORMANT` (`d5418f7`).
- **Slice 4:** passed; conclusions `SURFACE INVENTORY EXPOSURE:
  HOST-LOCAL AND CONTRACT-CONFORMANT`, `ENUMERATION CROSS-SURFACE ROUTING:
  CONTRACT-CONFORMANT`, `GENERATION SEEDING: INDEPENDENT / NOT REQUIRED
  FOR SLICE 4` (`ef118fc`).
- **Slice 5 original review:** exactly three substantive findings — F1
  unbounded startup-config read (reproduced ~96 MiB), F2 duplicate JSON
  keys last-win, F3 LMT-013 limit-profile gate bypass — while
  simultaneously accepting `MODERN MCP 2026-07-28 STDIO: CONFORMANT`,
  `CAPABILITY GENERATION RE-ESTABLISHMENT: CONTRACT-CONFORMANT`, and
  `STDIO RUNTIME SECURITY BOUNDARY: PRESERVED`.
- **Slice 5 focused rereview:** F1, F2, F3 all CLOSED with no substantive
  regression; Slice 5 accepted and committed at `045ae7c`.

## 14. Generation-Seeding Decision

- **Decision:** `WP-9 GENERATION-SEEDING DECISION: DEFER / REMOVE FROM
  WP-9 CLOSURE`. The roadmap contained later-work references to "WP-9
  generation seeding", but analysis found no normative producer,
  consumer, property, trust anchor, or failure semantics anywhere in the
  repository; registration correctness does not require it (per-store
  verification + per-request revalidation provide identity/freshness).
- It is therefore NOT listed as remaining WP-9 implementation work.
- **Capability-generation RE-ESTABLISHMENT (distinct):** the Slice 5
  runtime composition root re-establishes the EXISTING in-process storage
  capability-generation registry by creating an initialization capability
  that is never used for any mutation and is disposed immediately. This is
  NOT WP-9 generation seeding, transport/session generation, server
  generation, or cursor generation. Independent conclusion:
  `CAPABILITY GENERATION RE-ESTABLISHMENT: CONTRACT-CONFORMANT`.
- **Possible future transport generation:** if mentioned at all, it is
  only a future transport/runtime design question that may be revisited if
  a concrete server/session property appears; none is currently required.

## 15. WP-14 Handoff

WP-14 owns: Secure MCP Tunnel, ChatGPT Web connectivity, connector
configuration, and operator tunnel onboarding/integration. The local CLI
is the command an external tunnel client will launch (`--mcp.command`).

WP-9 does not own or require for closure: live ChatGPT tests,
tunnel-client, OAuth, public HTTPS, or ChatGPT publication. Closure uses
local deterministic conformance only.

## 16. Public Error Taxonomy and Outcome Rules

- **Exact committed taxonomy** (from `src/adapters/mcp/types.ts`):
  `invalid-request`, `not-found`, `unsupported`, `limit-exceeded`,
  `invalid-cursor`, `stale-cursor`, `integrity-conflict`,
  `adapter-error`.
- **Tool outcomes vs protocol errors:** expected inspection `ok:false`
  outcomes (the closed taxonomy above) remain successful MCP tool
  executions (`isError` absent/false) with `content` = one compact JSON
  text block and `structuredContent` = the identical object; protocol
  errors (malformed messages, unknown methods, outer argument-shape
  failures) are SDK-owned and never leak stacks.
- **Request-ID boundary:** the committed internal adapter supports an
  optional `requestId` echo; MCP tool schemas do NOT expose `requestId`
  (no `requestId`/`root`/`locator` schema fields); protocol request
  correlation is MCP/JSON-RPC-owned.
- **`validate-artifact` context:** it also routes by `surfaceId` because
  surface composition may determine the trusted schema-registry context
  (per-surface `SchemaRegistry`, defaulting to a fresh registry). The
  startup config does not currently support arbitrary per-surface custom
  schema-registry serialization; no such claim is made.

## 17. Final Verification (this preparation run)

Run at baseline HEAD; environment Node v22.23.2, Pi 0.84.1.

| Suite | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | pass |
| Build (generate + `tsc`) | pass |
| Test-TypeScript compilation (`tsc -p tsconfig.tests.json`) | pass |
| Runtime suite (`tests/runtime`) | 25/25 pass |
| Focused MCP suite (`tests/mcp/unit`) | 59/59 pass |
| Storage suite (`tests/unit/storage`, incl. contract/hash guards, WP-8K history, retention, config recovery, static guard) | 431 pass, 0 fail, 2 expected privilege-gated skips |
| Security suite (`tests/security`) | 15/15 pass |
| Default workflow / integration / conformance | 100/100 pass |
| Trusted suite | 570/570 pass |
| pi-adapter (unit/integration/security/compatibility) | 271 pass, 1 fail — accepted Pi mismatch (below) |
| Point-of-use v2 suite | 232/232 pass |
| Top-level unit suite | 169/169 pass |
| WP-7 discovery guard | pass |
| WP-7 validated runner | 165/165 (reader 62, git 38, fff 26, security 39) |
| Crash suite (`process/storage-crash`) | 5/5 pass |
| `git diff --check` | clean |

**Totals (this run):** 2045 executed → 2042 pass, 2 expected skips, 1
accepted environmental failure.

**Accepted environmental mismatch (sole expected failure):** Pi `0.83.0`
expected by the F8 compatibility test vs installed `0.84.1` (`pi
--version`). This is the single accepted environmental mismatch; it was
NOT "fixed" and is unrelated to WP-9.

## 18. Remaining WP-9 Work

- **Implementation: NONE.** Every roadmap requirement and closure-gate
  item for WP-9 is implemented, independently reviewed, and committed
  (scope matrix §4).
- Generation seeding: removed from closure by decision (§14), not listed
  as remaining implementation work.
- Final state: the independent closure review accepted the closure
  evidence and closed WP-9 (§19); no remaining WP-9 work exists.

## 19. Closure Verdict

`WP-9 INDEPENDENT CLOSURE REVIEW: ACCEPTED`

`WP-9 STATUS: CLOSED`

The independent closure review verified the complete closure evidence
(repository, commits, source, tests, package metadata, and this report):

- original WP-9 contract fully satisfied (inspection-only MCP tools;
  read-only surface; no mutation capability; no drafting/writing/
  execution tools; accepted local stdio runtime);
- 11/11 scope-matrix rows independently verified CLOSED;
- all five slice commits present in the exact first-parent ancestry of
  the baseline HEAD, each independently reviewed before commit;
- final verification battery green with the single accepted Pi
  environmental mismatch and the two accepted privilege-gated skips;
- zero substantive findings; no remaining WP-9 implementation work;
- the closure candidate (this report plus the three current-state
  documentation updates) was reviewed and is committed by this closure
  commit.

Historical record: this report was originally prepared as a CLOSURE
CANDIDATE at baseline `045ae7c2f4a980d392333ac6823e33ffa5513d24` and was
left unstaged and uncommitted until the independent closure review
completed. The four closure-documentation paths are:

- `docs/reports/wp-9-mcp-inspection-surface-closure-report.md` (new),
- `docs/design/post-wp5a-roadmap.md`,
- `docs/design/post-wp5a-planning-status.md`,
- `docs/reports/wp-9-mcp-inspection-surface-implementation-report.md`
  (minimal current-state update only).

WP-9 is CLOSED. No later work package (WP-10, WP-14) has been started or
authorized by this closure.
