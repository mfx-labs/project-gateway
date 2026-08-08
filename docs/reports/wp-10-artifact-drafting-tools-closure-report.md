# WP-10 — Artifact Drafting Tools — Closure Report

> **Status: WP-10 INDEPENDENT CLOSURE REVIEW: ACCEPTED — WP-10 STATUS:
> CLOSED.**
> This document is the authoritative WP-10 closure report. It was prepared
> as a closure candidate (WP-10 CLOSURE CANDIDATE: READY FOR INDEPENDENT
> CLOSURE REVIEW) by the closure-preparation agent, deliberately left
> unstaged and uncommitted, and was then independently reviewed and
> accepted by the independent closure review with zero substantive
> findings. The preparation/review chronology is preserved below (§18,
> §22, §23).

## 1. Work Package Identity

| Field | Value |
|---|---|
| Work package | WP-10 — Artifact drafting tools |
| Roadmap owner contract | Draft-proposal creation for TaskSpec/AuthorityPolicy/ContextManifest/CompletionContract/ExecutionBundle (WP-1 producer boundary: ChatGPT Web MAY create validated drafts) |
| Normative prerequisites | WP-4 (artifact validation), WP-6 (trusted workspace and policy configuration core), WP-7 (controlled project reader) |
| Roadmap closure gate | Drafts validate but never self-approve |
| Roadmap order | 5 (after WP-9 inspection, before WP-11 structured writing) |
| Later consumers | WP-11 (controlled structured artifact writing — DIRECT normative consumer: roadmap row 6 inputs include WP-10), WP-12 (local approval and execution control plane — INDIRECT downstream package: declared inputs are WP-4/WP-6/WP-8; ADR-002 control-plane approval of drafted artifacts is downstream of writing), WP-14 (Tunnel and ChatGPT Web connectivity — INDIRECT downstream package: declared inputs are WP-13/WP-9; ChatGPT Web draft/review connectivity reaches drafting only through later integration) |

## 2. Baseline / Closure Candidate

- Branch `main`; HEAD exactly `c47126ea71f9ce40ac0856745495e46ce77cd22c`
  (Slice 3 commit), unchanged by closure preparation.
- BEFORE closure preparation: working tree clean; staging empty.
- AFTER closure preparation: staging empty; HEAD unchanged; exactly the four
  authorized closure-documentation paths below are present (one new
  untracked closure report + three modified tracked documentation files),
  so the working tree is intentionally NOT clean; no unrelated path and no
  source/test/package/schema delta.
- All three WP-10 slice commits are in the first-parent ancestry of HEAD:
  `5c560f4 → 09e4833 → c47126e` (exact ledger in §7).
- No source defect was found during preparation; no source/test/package/
  schema/ADR change was made (documentation-only preparation).

## 3. Original Objective

The original accepted WP-10 definition is reproduced verbatim from the
accepted roadmap (`docs/design/post-wp5a-roadmap.md`), the authoritative
planning document (human-approved 2026-08-05, recorded in ADR-023…ADR-027).
It is reproduced faithfully and NOT rewritten to match the implementation:

**Work-package paragraph (roadmap, WP-10 section):**

> **WP-10 — Artifact drafting tools.** Objective: draft-proposal creation
> for the six artifact kinds (WP-1 producer boundary). Inputs: WP-4
> validation, WP-6 workspace config, WP-7 reader. Outputs: validated draft
> proposals. Owned: draft creation. Prohibited: persistence, approval,
> issuance. Invariants: drafts never self-approve. Tests: draft validation
> boundaries. Non-goals: no lifecycle authority, no writing beyond drafts.

**Roadmap execution table row (order 5):**

> | 5 | WP-10 | Artifact drafting tools | WP-4, WP-6, WP-7 | Draft-proposal creation for TaskSpec/AuthorityPolicy/ContextManifest/CompletionContract/ExecutionBundle (WP-1 producer boundary: ChatGPT Web MAY create validated drafts) | Drafts validate but never self-approve |

**Closure gate (roadmap table):**

> Drafts validate but never self-approve.

The normative contract therefore contains both phrasings: the table row
enumerates exactly the five prospective producer-draftable kinds, and the
work-package paragraph refers to "the six artifact kinds" — the six total
approved artifact kinds of the WP-1 domain model (see §5 "Six Total / Five
Draftable"). The implementation satisfies both phrasings; the closure gate
is: **drafts validate but never self-approve**.

## 4. Prerequisites

Actual prerequisite closure evidence:

| Prerequisite | Status | Evidence |
|---|---|---|
| WP-4 — Artifact validation (structural/semantic validation authority) | CLOSED / satisfied | WP-4 artifact core library committed at `45bfd97f…`; `docs/reports/wp-4-implementation-report.md`; accepted as a satisfied prerequisite by the WP-9 closure review and by the roadmap WP-10 dependency row |
| WP-6 — Trusted workspace and policy configuration core | CLOSED / satisfied | WP-6 closed at `b07fea95d0a1ed20361dec441fc500766969536f` (Phase 3 closure commit; planning status: "WP-6 has been implemented and closed") |
| WP-7 — Controlled project reader, Git inspection, internal discovery (FFF) | CLOSED / satisfied | WP-7 closed at `6b94d811dac8c41062ea4cbd57e56b1fe39b6419` (WP-7-C final closure rereview accepted with zero open findings; WP-7-A `64623c7`, WP-7-B `7fa2b15`) |

**Prerequisite-consumption distinction (accepted and preserved):** the
accepted conclusion is that WP-6 and WP-7 are satisfied prerequisites of
WP-10 as a whole, while pure supplied-content draft self-validation
legitimately does NOT consume them (see §14). No claim is made that every
prerequisite is invoked on every draft request.

## 5. Producer Boundary

The WP-1 artifact responsibility matrix
(`docs/design/artifact-responsibility-matrix.md`) names ChatGPT Web and
local humans as the permitted content producers of exactly five
PROSPECTIVE artifacts; `ExecutionResult` is produced only by the
completion evaluator (retrospective). The closure matrix:

| Artifact kind | Prospective / retrospective | WP-10 draftable | WP-10 producer authority | Evidence |
|---|---|---|---|---|
| `TaskSpec` | Prospective | **YES** | Draft proposal only | `src/drafting/proposal.ts` `DRAFTABLE_ARTIFACT_KINDS`; drafting tests |
| `AuthorityPolicy` | Prospective | **YES** | Draft proposal only; never a grant | same |
| `ContextManifest` | Prospective | **YES** | Draft proposal only; nothing is loaded | same |
| `CompletionContract` | Prospective | **YES** | Draft proposal only; nothing is evaluated | same |
| `ExecutionBundle` | Prospective | **YES** | Draft proposal only; nothing is activated/executed | same |
| `ExecutionResult` | Retrospective | **NO** | Excluded; completion-evaluator-produced (responsibility matrix; OD-WP1-005) | `NON_DRAFTABLE_ARTIFACT_KINDS = ['ExecutionResult']`; rejected as inner `unsupported-artifact-kind` |

**Trusted-local / non-Artifact records:** lifecycle/control-plane records
(`ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, …) and
`TrustedWorkspaceConfiguration` are not Artifacts at all; they are
trusted-local / control-plane owned, are not in the WP-1 producer
boundary, and are rejected by kind correlation (no envelope `kind.id`
correlates), not by the draftable/non-draftable artifact split.

**Six total / five draftable (independently reviewed interpretation,
preserved):** six total Artifact kinds exist (domain model:
`docs/design/artifact-domain-model.md`); exactly five are prospective
producer-draftable kinds; `ExecutionResult` is retrospective and excluded
from WP-10 producer authority. The closure report does NOT imply that
WP-10 failed to implement a sixth draftable kind: the roadmap's "six
artifact kinds" phrase counts the domain-model total, and the roadmap's own
execution-table row enumerates exactly the five draftable kinds. Drafting
an `ExecutionResult` is a producer-boundary violation by contract, not a
missing capability.

## 6. Scope Completion Matrix

Mapping of every normative WP-10 requirement to implementation path,
accepted slice, accepted commit, test/guard evidence, and closure status.

| # | Normative requirement | Implementation path | Accepted slice | Accepted commit | Test/guard evidence | Closure status |
|---|---|---|---|---|---|---|
| 1 | Draft-proposal creation | `src/drafting/proposal.ts` `createDraftProposal` | Slice 1 | `5c560f4` | `tests/drafting/proposal.test.ts` (19) | IMPLEMENTED |
| 2 | WP-1 producer vocabulary (exactly five prospective kinds; `ExecutionResult` excluded) | `DRAFTABLE_ARTIFACT_KINDS` / `NON_DRAFTABLE_ARTIFACT_KINDS` | Slice 1 | `5c560f4` | `tests/drafting/static-guard.test.ts` (textual vocabulary pin); proposal tests | IMPLEMENTED |
| 3 | Artifact validation | accepted WP-4 `validateArtifactSelf` (reused, never duplicated) | Slice 1 | `5c560f4` | direct WP-4 equivalence tests (valid + invalid, identical finding projection) | IMPLEMENTED |
| 4 | Derived digest | accepted `computeArtifactDigest` canonical projection; producer-supplied digest rejected | Slice 1 | `5c560f4` | derived-member rule tests; committed conformance-fixture digest equivalence | IMPLEMENTED |
| 5 | Invalid-proposal findings | `ok:true, valid:false` bounded findings (phase/category/ruleIds/messageKey/location) | Slice 1 | `5c560f4` | proposal tests (valid + invalid) | IMPLEMENTED |
| 6 | Non-self-approval | no approval/issuance/activation vocabulary anywhere; self-approval guard rejects `approved`/`issued`/`activated`/`grant`/`executable` envelope extras and `approve`/`root` request extras | Slice 1 | `5c560f4` | self-approval guard tests; static guards | IMPLEMENTED |
| 7 | Non-persistence | zero persistence capability; closed request shape has no destination/path/root/store operand | Slice 1 (+2,3) | all | fs-mutation watchdog over drafting paths (core, adapter, runtime); stdio store-snapshot mutation test | IMPLEMENTED |
| 8 | Non-lifecycle authority | no approval/issuance/activation/revocation/grant/execution vocabulary; authority replay tests | Slice 1 (+2,3) | all | static guards; brand-verifier replay tests | IMPLEMENTED |
| 9 | Surface-aware validation context | `src/adapters/mcp/drafting.ts` — `surfaceId` → exact registered `SchemaRegistry` instance → Slice 1 core seam | Slice 2 | `09e4833` | `tests/mcp/unit/drafting.test.ts` (16): exact-instance consultation, draft/validate consistency | IMPLEMENTED |
| 10 | MCP drafting exposure | `src/runtime/mcp/server.ts` registers `draft-artifact` | Slice 3 | `c47126e` | `tests/runtime/server.test.ts`, `tests/runtime/stdio.test.ts` | IMPLEMENTED |
| 11 | Exact tool request surface | public MCP args `{surfaceId, kind, content}`; no `requestId`; shape/type-only SDK schema | Slice 3 | `c47126e` | runtime schema assertions; `tests/runtime/static-guard.test.ts` | IMPLEMENTED |
| 12 | No execution | ExecutionBundle drafts never resolved/activated/executed; no execution vocabulary | Slice 1 (+2,3) | all | static guards; watchdog | IMPLEMENTED |
| 13 | Local-only transport compatibility | local stdio runtime; no listener; no tunnel | Slice 3 | `c47126e` | runtime no-listener probe; static guards | IMPLEMENTED |
| 14 | Reader-assist closure decision | controlled-reader drafting assist NOT required for the closure gate (Slice 3 review conclusion) | Slice 3 | `c47126e` | §15 of this report | DECIDED — NOT REQUIRED FOR CLOSURE |
| 15 | Validation-phase boundary | self-validation only; no consumption/point-of-use eligibility claim | Slice 1 | `5c560f4` | consumption-phase separation tests | IMPLEMENTED |

All 15 rows IMPLEMENTED or DECIDED; zero normative gaps.

## 7. Slice / Commit Ledger

Exact first-parent ancestry of the closure-candidate HEAD, verified from
`git rev-parse` of each parent:

| Slice | Content | Accepted commit (exact) | Parent (exact) |
|---|---|---|---|
| 1 | Transport-free in-memory draft-proposal core (`src/drafting/proposal.ts`) | `5c560f4804e029f25b11b6eb1dc7cd45dcf9c7e7` | `84f2267784c788fb1ddea8563bc7fbb640633384` (WP-9 closure) |
| 2 | Host/surface-aware transport-free drafting adapter (`src/adapters/mcp/drafting.ts`) | `09e48332b97dfe12e344bb6d37e902c856798e1c` | `5c560f4804e029f25b11b6eb1dc7cd45dcf9c7e7` |
| 3 | Local stdio registration of `draft-artifact` (`src/runtime/mcp/{server,compose,cli}.ts`) | `c47126ea71f9ce40ac0856745495e46ce77cd22c` | `09e48332b97dfe12e344bb6d37e902c856798e1c` |

`git log --first-parent --oneline c47126e~3..c47126e` yields exactly:
`5c560f4 → 09e4833 → c47126e`. Each slice was independently reviewed
before its commit (see §16).

## 8. Draft Core Semantics (Slice 1)

Slice 1 owns the transport-free in-memory draft-proposal core. Accepted
properties (cross-checked against `src/drafting/proposal.ts` and
`tests/drafting/*`):

- `createDraftProposal({ kind, content })` — closed request envelope; only
  fields `kind` and `content`; unknown request fields rejected
  (`invalid-draft-request`).
- Exactly five prospective kinds (`DRAFTABLE_ARTIFACT_KINDS`); `ExecutionResult`
  and lifecycle/control-plane records excluded via
  `NON_DRAFTABLE_ARTIFACT_KINDS` / kind correlation (no lookalike variants).
- Producer-proposed `instanceId` / `revisionId` MAY be present in draft
  content; syntax is validated by WP-4; assignment/acceptance belongs to
  the trusted identity registrar at registration time — never this core.
- `revision.digest` is DERIVED (accepted canonical projection via
  `computeArtifactDigest`), never producer-supplied; a producer-supplied
  digest is rejected.
- Accepted WP-4 self-validation (`validateArtifactSelf`) — WP-4 remains
  the sole validation authority (§14); no schema/canonicalization/digest/
  rule logic is duplicated.
- Result model: `{ok:true, valid:true, kind, proposal, validation}` |
  `{ok:true, valid:false, kind, findings}` | `{ok:false, error:{code,
  message}}` with the closed drafting taxonomy `invalid-draft-request`,
  `unsupported-artifact-kind`, `limit-exceeded`, `internal-adapter-failure`
  (fixed redacted message).
- Deterministic (no clock/randomness/process identity); immutable
  (deep-frozen plain data); no persistence; no lifecycle authority; no
  execution; no MCP/transport (zero SDK imports).

## 9. Slice 1 F1 History (preserved, not rewritten)

The first independent review of Slice 1 returned `CORRECTIONS REQUIRED`
with exactly ONE substantive MODERATE finding, while simultaneously
accepting all Slice 1 semantics (draftable vocabulary, ExecutionResult
exclusion, identity proposal, WP-6/WP-7 non-use, non-authority, WP-9
surface unchanged).

**F1 (MODERATE):** valid JSON non-object content such as `null` was
initially misclassified as `internal-adapter-failure` instead of
`invalid-draft-request`. Cause: property access on a non-object parsed
value threw a `TypeError` caught by the catch-all.

**Correction:** an explicit object-envelope shape guard immediately after
the accepted raw-JSON intake and before any object-property assumption —
parsed model must be a non-null, non-array object, otherwise
`invalid-draft-request`. No exception-based shape control was introduced;
`internal-adapter-failure` remains reserved for genuinely unexpected
internal failures (probed via an existing test seam).

**Focused independent rereview:** F1 CLOSED with zero substantive
regression (focused regression coverage: `null`, scalars, empty/non-empty
arrays → `invalid-draft-request`, never `internal-adapter-failure`; control
cases preserved). Slice 1 accepted and committed at `5c560f4`. History is
preserved as corrected-after-review; the first candidate was NOT
defect-free.

## 10. Surface-Aware Adapter (Slice 2)

Slice 2 owns the host/surface-aware transport-free drafting adapter.
Accepted properties (cross-checked against `src/adapters/mcp/drafting.ts`
and `tests/mcp/unit/drafting.test.ts`):

- `DraftingContext` = the narrowest drafting context: exactly one fact,
  the host-supplied `SchemaRegistry`; no root/locator/configuration/
  reader/write/lifecycle/transport state.
- `createMcpDraftingRegistry({ registrations })` — host-owned, immutable
  after construction, insertion-order-independent (canonical sorted
  `surfaces`), empty registry legal, exact duplicate/conflicting surfaceIds
  fail construction deterministically.
- Exact registered `SchemaRegistry` instance routing: the seam
  `createDraftProposalWithSchemaRegistry` is invoked with the EXACT object
  registered by the host; proven by an instrumented `CountingRegistry`
  subclass (test seam only): surface A consults registry A exactly once and
  never registry B.
- Draft/validate surface consistency: same object bound into an inspection
  surface and a drafting surface under the same logical `surfaceId` yields
  identical validity/digest/instanceId/revisionId/ruleIds/level/finding
  projection (envelope shapes differ by design).
- Drafting registry/context strictly separate from the WP-9 inspection
  registry; `createMcpInspectionRegistry` is NOT widened (no drafting
  method on it; WP-9 registry tests unchanged).
- Accepted WP-9 `surfaceId` grammar reuse: `SURFACE_ID_RE`,
  `SURFACE_ID_MAX_LENGTH` imported, no second regex; malformed → outer
  `invalid-request`, well-formed unregistered → outer `not-found` (no
  inventory/path leakage, no fuzzy match, no cross-surface fallback).
- Outer routing taxonomy (`invalid-request`, `not-found`) strictly separate
  from the inner drafting taxonomy (`invalid-draft-request`,
  `unsupported-artifact-kind`, `limit-exceeded`,
  `internal-adapter-failure`, `valid:false`); inner outcomes are never
  remapped to inspection/storage codes.
- `requestId` convention aligned internally with WP-9 (optional echo,
  bounded 1..128, never enters draft content, NOT a future stdio tool
  argument).
- No persistence/lifecycle/execution; no WP-6/WP-7 consumption; no runtime
  modification (server untouched in this slice; inventory stayed six).

## 11. Stdio MCP Runtime (Slice 3)

Slice 3 owns local stdio registration of `draft-artifact`. Accepted
properties (cross-checked against `src/runtime/mcp/{server,compose,cli}.ts`
and `tests/runtime/*`):

- Overall server inventory exactly SEVEN tools: six WP-9 inspection tools
  (`validate-artifact`, `inspect-stored-record`, `inspect-registry`,
  `inspect-audit-history`, `verify-record`, `enumerate-class`) + exactly
  one WP-10 drafting tool (`draft-artifact`). Historical WP-9 inspection
  inventory remains exactly six (WP-9 history is NOT rewritten — see §31).
- Public MCP args: `{surfaceId, kind, content}`; no MCP `requestId`
  (runtime calls the adapter with `draftingRegistry.draft(surfaceId,
  {kind, content})` — no invented requestId); no persistence/lifecycle/
  execution operands.
- SDK owns shape/type only: `z.object({surfaceId: z.string(), kind:
  z.string(), content: z.string()}).strict()`; adapter/core own semantic
  validation (§12).
- Expected drafting/routing outcomes remain NORMAL tool executions
  (`isError` absent/false); only true runtime exceptions become MCP
  execution failures (bounded stderr diagnostic, generic error).
- text/structuredContent parity: `structuredContent` is the exact machine
  object; text is one compact JSON block of the same object (verified by
  JSON-normalized deep comparison).
- Same `SchemaRegistry` instance shared across inspection and drafting per
  surface (composition root, §15 of Slice 3 evidence / §39 below).
- Local stdio only; no persistence/lifecycle/execution/tunnel; modern
  `serveStdio(() => server)` factory preserved.

## 12. SDK / Adapter Validation Boundary

Accepted layering (preserved exactly):

| Input class | Layer | Outcome |
|---|---|---|
| `ExecutionResult` (or other unsupported string kind) | inner adapter/core | `unsupported-artifact-kind` (normal tool execution) |
| Malformed `surfaceId` string | outer adapter | `invalid-request` (normal tool execution) |
| Well-formed but unregistered `surfaceId` | outer adapter | `not-found` (normal tool execution) |
| Oversize `content` string | inner adapter/core | `limit-exceeded` (normal tool execution) |
| Wrong types / unknown outer fields | SDK (strict schema) | SDK/protocol input error (not a tool result) |
| Non-object JSON content (`null`, scalars, arrays) | inner core (F1 guard) | `invalid-draft-request` (never `internal-adapter-failure`) |

The SDK must NOT preempt inner outcomes: no kind enum, no byte ceiling, no
selector grammar in the schema. Expected outcomes are successful MCP tool
executions: `isError` absent/false — domain failure is never confused with
runtime failure. The tool advertises `annotations: { readOnlyHint: true }`
because drafting creates no external persistent side effect; this is a
HINT, not the security enforcement mechanism (static guards and the
mutation watchdog are the enforcement).

## 13. Validation / Digest / Identity

- **WP-4 validation authority (§14 of the implementation report):** WP-4
  remains the actual validation authority. WP-10 reuses `parseRawJsonInput`
  (duplicate-key-rejecting intake, artifact byte limit),
  `createSchemaRegistry`, `validateArtifactSelf`, and
  `computeArtifactDigest`. WP-10 duplicated NO schema logic,
  canonicalization, digest projection, or rule evaluation. Equivalence is
  proven: the WP-10 result equals direct WP-4 validation (digest, canonical
  bytes, level, model, finding projection) for valid and invalid content.
- **Validation-phase boundary:** WP-10 performs Artifact SELF-validation
  for draft creation only. It does NOT claim consumption/point-of-use
  eligibility; AuthorityPolicy expansion/ceilings (AUT-001 against trusted
  ceilings) remain later point-of-use concerns (tested explicitly).
- **Draft identity semantics:** the producer MAY propose instance identity
  and revision identity in a draft; WP-10 does not mint or confer
  registrar acceptance. Draft identity is NEVER overstated as registered
  identity — a valid draft is a valid candidate, not a registered record.
- **Digest semantics:** `revision.digest` is derived through the accepted
  canonical logic; producer-supplied digest is rejected; no second
  hashing/serialization contract exists (the only construction step is
  inserting the derived digest into the candidate envelope).
- **Draft result authority:** a valid draft is valid candidate Artifact
  content — NOT approved, issued, active, authoritative, or executable.

## 14. Non-Authority / Non-Persistence

- **Persistence boundary:** WP-10 has ZERO persistence capability. No
  destination/path operand, no store publication, no project-file write,
  no temp draft persistence exists in the draft request envelope, the
  adapter, or the runtime. WP-11 owns controlled workspace writing.
  Evidence: fs-mutation watchdog over core/adapter/runtime drafting paths;
  stdio store-snapshot test runs drafting calls in the same session and
  asserts zero store mutation.
- **Lifecycle boundary:** WP-12 owns approval, issuance, activation,
  revocation, and execution authorization. WP-10 contains none of these;
  no approval/issuance/activation/revocation/grant/execution vocabulary is
  imported or invoked (static guard + brand-verifier replay tests: draft
  data carries zero brand symbols and fails every genuine brand verifier).
- **Per-kind non-authority (each independently tested):**
  - Drafting `AuthorityPolicy` does NOT grant authority (proposals only
    narrow; drafting is not granting).
  - Drafting `TaskSpec` does NOT execute Pi.
  - Drafting `ContextManifest` does NOT read/load context (selections are
    untrusted data).
  - Drafting `CompletionContract` does NOT evaluate completion (prospective
    proof only).
  - Drafting `ExecutionBundle` does NOT activate references, create
    RuntimeGrant, or execute.
- **ExecutionResult:** remains retrospectively produced outside WP-10 by
  the completion evaluator; WP-10 rejects it as
  `unsupported-artifact-kind`.
- **WP-5B / WP-13 boundary:** WP-10 does not project authority to
  pi-guard, execute Pi, or produce retrospective ExecutionResult.
- **WP-14 boundary:** WP-10 does not own Secure MCP Tunnel, ChatGPT Web
  live connection, OAuth, public HTTPS, or connector onboarding. Local
  stdio MCP is sufficient for WP-10 closure.

## 15. WP-6 / WP-7 Role

- **WP-6 (trusted workspace configuration):** NOT consumed by draft
  self-validation. Draft self-validation is pre-consumption;
  workspace-binding resolution and trusted-ceiling correlation are
  consumption-time concerns (WP-4 for-use / WP-6 boundaries). No draft
  requires trusted workspace facts to be constructed; no caller-controlled
  payload can inject workspace authority.
- **WP-7 (controlled reader):** NOT consumed by pure supplied-content
  drafting; drafts are constructed purely from supplied content; no
  project facts are needed.
- **Accepted conclusion (preserved):** WP-6/WP-7 are satisfied
  prerequisites of WP-10 as a whole while pure supplied-content drafting
  legitimately does not consume them. The implementation report's accepted
  decisions are preserved: `WP-6 NEXT-SLICE ROLE: NOT REQUIRED`; `WP-7
  NEXT-SLICE ROLE: NOT REQUIRED`.

## 16. Controlled-Reader Closure Decision

The independent Slice 3 review concluded:

> `CONTROLLED-READER DRAFTING ASSIST: NOT REQUIRED FOR WP-10 CLOSURE`

This is proven against the normative WP-10 contract: the closure gate is
"Drafts validate but never self-approve"; the owned contract is
draft-proposal creation within the WP-1 producer boundary; the inputs are
WP-4 validation, WP-6 workspace config, WP-7 reader. Supplied-content
drafting satisfies the gate without project reads. The distinction is
preserved:

- **WP-7 prerequisite** — satisfied and CLOSED; a normative input of
  WP-10 overall;
- **WP-7-powered drafting-assist feature** — a separate optional
  enhancement (reader-backed context selection) that is NOT an output
  obligation of the WP-10 contract.

Reader-assisted drafting is therefore NOT listed as remaining WP-10
implementation work (§19). If mentioned at all, it is only an OPTIONAL
FUTURE SEPARATELY AUTHORIZED ENHANCEMENT — it does not create a new
required WP-10 slice.

## 17. Tool / Error / Schema Semantics

- **Final MCP inventory (§31 of instructions):** WP-9 inspection: exactly
  six historical tools; WP-10 adds exactly one (`draft-artifact`); current
  overall runtime: exactly seven tools. WP-9 history is NOT rewritten:
  WP-9 closed with six inspection tools; WP-10 later extended the overall
  runtime to seven.
- **Draft tool request:** exact public MCP args `surfaceId`, `kind`,
  `content`; no `requestId`; no persistence/lifecycle/execution operands.
- **`surfaceId` semantics:** selects host-owned validation context ONLY —
  never a write target, destination, or authority grant.
- **Same SchemaRegistry instance (runtime composition):** for each
  configured surface, ONE `SchemaRegistry` instance → inspection registry
  → drafting registry; same object identity. Proven by the injected
  registry factory (`ComposeDependencies.createSchemaRegistry`) with an
  instrumented `CountingRegistry`: a surface's drafting and inspection
  routes consult the same instance; drafting never consults another
  surface's instance.
- **Startup config:** existing host config automatically composes drafting
  for registered surfaces (no `"drafting": true` flag; drafting
  availability is part of this runtime version). No claim is made that
  startup JSON serializes arbitrary custom `SchemaRegistry` objects — one
  fresh registry per surface is created by composition and shared.
- **Startup-config security (Slice-5 protections preserved):** F1 — 1 MiB
  true byte-bounded config read; F2 — duplicate-key rejection via
  `parseRawJson`; F3 — LMT-013 limit-selection gate
  (`validateLimitSelection(name, value, true)`). WP-10 did not weaken
  these; `src/runtime/mcp/config.ts` is unchanged and the startup-config
  regression tests pass.
- **No new dependencies:** no WP-10 Slice 2/3 dependency expansion;
  `package-lock.json` untouched; the only `package.json` change in WP-10
  (Slice 1) was adding the `dist-test/tests/drafting/*.test.js` glob to
  the test script. Current MCP SDK/Zod facts (unchanged from WP-9):
  `@modelcontextprotocol/server` 2.0.0, `zod` 4.4.3. No versions were
  updated.
- **Package boundary:** root `exports` remains narrow (`.`,
  `./pi-adapter`, `./mcp`); `./mcp` additively contains the safe
  transport-free drafting composition (drafting adapter + inspection
  adapter); the registry-injected core seam
  (`createDraftProposalWithSchemaRegistry`) is exported at module level
  only, NOT from the package root — it is not accidentally a public package
  root authority; no trusted creator/storage/lifecycle authority is
  exported (trust creators remain localized to `compose.ts`).
- **Static guards:** guard coverage verified for the transport-free
  drafting core (`tests/drafting/static-guard.test.ts`), the drafting
  adapter (`tests/mcp/unit/static-guard.test.ts`), the exact six
  inspection tools, the exact one drafting tool, the exact seven current
  runtime tools (`tests/runtime/static-guard.test.ts`), and forbidden
  persistence/lifecycle/execution/network boundaries.
- **Mutation watchdog:** drafting through pure core, surface adapter, and
  stdio runtime causes zero project/store mutation (watchdog covers valid
  draft, invalid draft, unsupported kind, malformed JSON, oversize, unknown
  surface, malformed surface; stdio store-snapshot test includes drafting
  calls).
- **No network listener:** WP-10's runtime addition does not change local
  stdio topology; the live `/proc` socket probe covers the session that
  performs drafting calls; runtime static guard forbids
  `node:net`/`node:http`/`node:https`/`node:tls`/`node:dgram`,
  WebSocket, tunnel-client, OAuth, and subprocess use.
- **Modern/legacy MCP:** the modern 2026-07-28 path is verified
  (`client.getProtocolEra() === 'modern'`, `server/discover` answered,
  seven tools with stable schemas and `readOnlyHint`) with the SDK-managed
  legacy compatibility smoke retained — as verified by the Slice 3
  review. Protocol compatibility is not turned into a WP-10 product
  objective beyond the current accepted runtime.

## 18. Correction / Review History (chronological ledger)

- **Slice 1:** implementation → independent review: `CORRECTIONS
  REQUIRED`, one substantive MODERATE finding **F1** (non-object JSON
  misclassified as `internal-adapter-failure`) → correction (explicit
  object-envelope guard) → focused independent rereview: F1 CLOSED, zero
  substantive regression → accepted and committed at `5c560f4`.
- **Slice 2:** implementation → independent review ACCEPTED (zero
  substantive findings) → committed at `09e4833`.
- **Slice 3:** implementation → independent review ACCEPTED (including
  `CONTROLLED-READER DRAFTING ASSIST: NOT REQUIRED FOR WP-10 CLOSURE`) →
  committed at `c47126e`.

History is not rewritten: the Slice 1 F1 finding existed and was
corrected before acceptance.

## 19. Remaining Work

- **Remaining WP-10 implementation work: NONE.** Independently determined
  against the normative contract and the 15-row scope matrix (§6): every
  normative requirement is implemented, independently reviewed, and
  committed. No normative requirement is actually unmet; closure
  preparation is not blocked.
- Controlled-reader drafting assist: NOT required for closure (§16);
  optional future separately authorized enhancement only.
- **WP-10 is CLOSED** — the independent closure review accepted this
  closure candidate with zero substantive findings (chronology in §22).

## 20. Verification (this preparation run)

Run at baseline HEAD; environment Node v22.23.2, Pi 0.84.1. Every suite
was rerun from the committed baseline; totals were reconstructed from this
run, not copied from earlier reports.

| Suite | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | pass |
| Build (generate + `tsc`) | pass |
| Test-TypeScript compilation (`tsc -p tsconfig.tests.json`) | pass |
| Slice 1 drafting suite (`tests/drafting`) | 22/22 pass |
| Slice 2 drafting adapter + full MCP unit suite (`tests/mcp/unit`) | 76/76 pass (incl. `drafting.test.ts` 16 + adapter static guard) |
| Runtime suite (`tests/runtime`, incl. Slice 3) | 31/31 pass |
| WP-4 validation/conformance + default workflow (`tests/integration`) | 100/100 pass |
| Top-level unit suite (`tests/unit`) | 169/169 pass |
| Storage suite (`tests/unit/storage`, incl. contract/hash guards, WP-8K history, retention, config recovery, static guard) | 431 pass, 0 fail, 2 expected privilege-gated skips |
| Security suite (`tests/security`) | 15/15 pass |
| Trusted suite (`tests/trusted`) | 570/570 pass |
| Point-of-use v2 suite | 232/232 pass |
| pi-adapter (unit/integration/security/compatibility) | 271 pass, 1 fail — accepted Pi mismatch (below) |
| Crash suite (`process/storage-crash`) | 5/5 pass |
| WP-7 discovery guard | pass |
| WP-7 validated runner | 165/165 (reader 62, git 38, fff 26, security 39) |
| `git diff --check` | clean |

**Totals (this run):** 2090 executed → 2087 pass, 2 expected skips, 1
accepted environmental failure.

**Expected skips (unchanged, verified):** the two storage skips are the
same accepted privilege-gated chown cases in
`tests/unit/storage/initialization.test.ts` ("chown requires privileges;
wrong-UID coverage is provided by the synthetic stat-policy tests"). No new
skips were silently accepted.

**Accepted Pi mismatch (sole known environmental mismatch, unchanged):**
expected Pi `0.83.0` vs installed `0.84.1` (`pi --version`), observed in
the F8 compatibility test. Nothing was modified to hide it; it is
unrelated to WP-10.

## 21. Later-Work Boundaries

- **WP-11 (controlled structured artifact writing):** NOT STARTED; owns
  workspace-contained writes of validated drafts; WP-10's zero-persistence
  boundary is the required input state for it.
- **WP-12 (local approval and execution control plane):** NOT STARTED;
  owns approval, issuance, activation, revocation, RuntimeGrant, execution
  authorization; WP-10 contains none of these.
- **WP-5B / WP-13:** NOT STARTED; WP-10 does not project authority to
  pi-guard and does not execute Pi; `ExecutionResult` remains
  retrospectively produced by the WP-13-owned completion evaluator.
- **WP-14 (Tunnel and ChatGPT Web connectivity):** NOT STARTED; remains
  blocked by WP-13; the local stdio CLI remains the command an external
  tunnel client will launch later. WP-10 adds no listener and no tunnel.
- No push, tag, release, publication, installation, or deployment action
  has occurred or will occur as part of this preparation.

## 22. Closure-Candidate Verdict

- **Original objective satisfaction:** YES — the current implementation
  satisfies the original WP-10 objective ("draft-proposal creation for the
  six artifact kinds (WP-1 producer boundary)"; owned contract per the
  execution table: the five prospective draftable kinds) and the closure
  gate "Drafts validate but never self-approve". All accepted properties
  from the independent slice reviews are present and verified.
- **Closure-candidate status (pre-review, preserved):**

`WP-10 CLOSURE CANDIDATE: READY FOR INDEPENDENT CLOSURE REVIEW`

  This report did NOT state and did NOT imply WP-10 CLOSED, WP-10
  ACCEPTED, or that the closure review passed while it was a candidate.
  Acceptance and closure were the exclusive decision of the independent
  closure review. The candidate was neither staged nor committed by the
  closure-preparation agent, and the closure candidate was not
  independently reviewed by it.

- **Independent closure review result:** the independent closure review
  verified the complete closure evidence and reran closure-grade
  verification (2090 executed → 2087 pass + 2 expected skips + 1 accepted
  environmental failure; zero substantive findings) and returned:

`WP-10 INDEPENDENT CLOSURE REVIEW: ACCEPTED AND COMMITTED`

## 23. CLOSURE STATUS

**WP-10 STATUS: CLOSED.** The independent closure review accepted the
closure candidate with zero substantive findings
(`WP-10 INDEPENDENT CLOSURE REVIEW: ACCEPTED AND COMMITTED`); WP-10 is
CLOSED with implementation complete and no remaining WP-10 implementation
work. Preparation chronology preserved: WP-10 was IMPLEMENTATION COMPLETE
— CLOSURE REVIEW PENDING (NOT CLOSED) until this review. WP-11 NOT
STARTED; WP-12 NOT STARTED; WP-14 remains blocked by WP-13.

---

### Preparation-end Git state (required facts)

- HEAD unchanged: `c47126ea71f9ce40ac0856745495e46ce77cd22c`.
- Staging empty.
- Only the four authorized closure-documentation paths changed (all
  unstaged/uncommitted):
  1. `docs/reports/wp-10-artifact-drafting-tools-closure-report.md` (new);
  2. `docs/design/post-wp5a-roadmap.md` (narrow current-state update);
  3. `docs/design/post-wp5a-planning-status.md` (narrow current-state
     update);
  4. `docs/reports/wp-10-artifact-drafting-tools-implementation-report.md`
     (minimal current-state pointer only; historical implementation
     evidence untouched).
- `git diff --check` clean; no source/test/package/schema/ADR change.
