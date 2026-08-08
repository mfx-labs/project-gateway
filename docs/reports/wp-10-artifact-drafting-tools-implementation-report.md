# WP-10 Artifact Drafting Tools — Implementation Report (Slice 1)

**Slice:** WP-10 slice 1 — transport-free draft-proposal core.
**Status:** implementation candidate; Slice 1 independently accepted and
committed by focused independent rereview (the
first independent review returned one substantive MODERATE finding — F1
startup of §13 — corrected below; acceptance is not declared here).
**Baseline:** `84f2267784c788fb1ddea8563bc7fbb640633384` (WP-9 closure).
**Normative contract (roadmap):** WP-10 — "Artifact drafting tools.
Objective: draft-proposal creation for the six artifact kinds (WP-1 producer
boundary). Inputs: WP-4 validation, WP-6 workspace config, WP-7 reader.
Prohibited: persistence, approval, issuance. Invariants: drafts never
self-approve." Closure gate: "Drafts validate but never self-approve."
Normative prerequisites WP-4, WP-6, WP-7 are CLOSED.

## 1. Slice Boundary and Rationale

Slice 1 establishes DRAFT SEMANTICS ONLY: a library-level,
transport-independent core that constructs and validates draft proposals for
exactly the artifact kinds the accepted WP-1 producer boundary permits
ChatGPT Web / local humans to draft, and returns immutable plain-data
results. It deliberately does NOT persist, approve, issue, activate,
revoke, grant, execute, project authority, add MCP tools, or touch the stdio
runtime. MCP-facing draft tools and controlled-context integration are later
WP-10 slices.

## 2. Exact Draftable Artifact Vocabulary

Authority: `docs/design/artifact-responsibility-matrix.md` (WP-1 companion
matrix), cross-checked against `src/schema/select.ts` (`ARTIFACT_KINDS`) and
the conformance fixtures.

- **Draftable (ChatGPT Web / local human producers), exactly five
  PROSPECTIVE artifacts:**
  1. `TaskSpec` — task-intent boundary; never delegated instruction
     authority from context;
  2. `AuthorityPolicy` — proposals only narrow; drafting is NOT granting
     the described authority;
  3. `ContextManifest` — bounded selections as untrusted data; drafting a
     manifest is NOT loading context;
  4. `CompletionContract` — prospective proof only; drafting does NOT
     evaluate completion;
  5. `ExecutionBundle` — exact references to one task/policy/context/
     completion revision; drafting does NOT start execution.
- **Explicitly NON-draftable by WP-10:**
  - `ExecutionResult` — retrospective, completion-evaluator-produced
    (responsibility matrix; OD-WP1-005); rejected with
    `unsupported-artifact-kind`;
  - lifecycle records (`ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`,
    …) and `TrustedWorkspaceConfiguration` — trusted-local / control-plane
    owned; not artifacts and rejected via kind correlation;
  - close lookalike/spelling variants (`TaskSpec `, `taskspec`,
    `TaskSpecification`, …) — the closed vocabulary admits no variant.

`DRAFTABLE_ARTIFACT_KINDS` / `NON_DRAFTABLE_ARTIFACT_KINDS` in
`src/drafting/proposal.ts` are the single vocabulary authority; the static
guard pins them textually.

## 3. Request Model

`createDraftProposal({ kind, content })`:

- `kind` — exact draftable artifact kind (closed runtime check).
- `content` — raw JSON candidate artifact envelope WITHOUT `revision.digest`
  (a DERIVED member: identity-versioning reference line 96; the core derives
  it over the accepted canonical projection and rejects any producer-supplied
  digest). Proposed `instance_id` / `revision.id` MAY be present: the
  producer boundary allows proposing identity in a draft; syntax is
  validated by WP-4; assignment/acceptance remains the trusted identity
  registrar's role at registration time (never this core).
- Closed fields only; no filesystem destination, root, workspace path,
  approval/issuance/activation flag, grant, or execution request field.
  Unknown request fields are rejected (`invalid-draft-request`).

Model choice (A — complete candidate content, not field templating): WP-4
validates complete artifact input and no accepted field-construction API
exists; WP-10's objective is proposal creation, not a templating engine.

## 4. Construction / Serialization Ownership

The only construction step is inserting the accepted derived digest:
`computeArtifactDigest(model)` (accepted canonical projection over the
envelope with `annotations` and `revision.digest` omitted) → candidate
envelope → accepted WP-4 `validateArtifactSelf`. No second serializer, no
reordering, no Unicode normalization, no identity minting, no timestamps,
no randomness. Equivalence is proven: the derived digest equals the
committed conformance-fixture digest for every draftable kind, and the
WP-10 result equals direct WP-4 validation (digest, canonical bytes, level,
model, and finding projection) for valid and invalid content.

## 5. Result Model

- `{ ok: true, valid: true, kind, proposal: { instanceId, revisionId,
  digest, canonicalUtf8, level, model }, validation: { level, ruleIds } }`
  — immutable/frozen plain data; the model is the accepted WP-4 snapshot.
  Validity is stated only as valid draft content / valid artifact proposal —
  never approved, issued, activated, registered, or executable.
- `{ ok: true, valid: false, kind, findings }` — a legitimate proposal
  attempt whose content failed WP-4: bounded findings (phase, category,
  ruleIds, messageKey, schemaId/subjectIdentity/location where present) for
  iterative correction without persistence. Validation failures are never
  flattened into generic errors.
- `{ ok: false, error: { code, message } }` — closed draft-request errors:
  `invalid-draft-request`, `unsupported-artifact-kind`, `limit-exceeded`
  (accepted artifact byte bound, enforced by the accepted raw-JSON intake
  before expensive processing), `internal-adapter-failure` (fixed redacted
  message; no errno, path, stack, or trusted object).

## 6. WP-4 Remains Validation Authority

The core reuses `parseRawJsonInput` (duplicate-key-rejecting intake,
artifact byte limit), `createSchemaRegistry`, `validateArtifactSelf`, and
`computeArtifactDigest` — no schema selection, canonicalization, digest,
phase, or rule logic is duplicated. Consumption-phase checks (e.g.,
AuthorityPolicy expansion AUT-001 against trusted ceilings) remain
point-of-use concerns: self-validation does not claim consumption
eligibility (tested explicitly).

## 7. WP-6 / WP-7 Usage

- **WP-6 (trusted workspace configuration): NOT consumed in Slice 1.**
  Rationale: draft self-validation is pre-consumption; workspace-binding
  resolution and trusted-ceiling correlation are consumption-time concerns
  (WP-4 for-use / WP-6 boundaries). No draft requires trusted workspace
  facts to be constructed; no caller-controlled payload can inject
  workspace authority.
- **WP-7 (controlled reader): NOT consumed in Slice 1.** Drafts are
  constructed purely from supplied content; no project facts are needed.
  Reader-backed drafting/context selection is a later-slice integration
  decision. WP-7/WP-6 remain satisfied prerequisites of WP-10 as a whole.

## 8. No Persistence / No Authority / No Lifecycle

- Drafts live in memory/return values only; no project files, artifact
  store, registry, lifecycle or audit store, and no temporary files.
  Storage writers, recovery/retention mutation, writer locks, and
  configuration recovery are not imported (static guard + fs-mutation
  watchdog over all five kinds and failure paths).
- No approval/issuance/activation/revocation/grant/execution/pi-guard
  vocabulary is imported or invoked (static guard).
- Authority replay: draft proposal models (and structural lookalikes of
  trusted inputs built from them) fail every genuine brand verifier
  (trusted configuration, bootstrap input/provenance, write/read/
  initialization/recovery capabilities); zero brand symbols on draft data.
- Self-approval guard: envelope extras such as `approved`/`issued`/
  `activated`/`grant`/`executable` and request extras such as
  `approve`/`issued`/`root` fail closed-field/structural validation.

## 9. Determinism, Immutability, Redaction

Deterministic results for identical input (no clock/randomness/process
identity); returned objects deep-frozen with no shared mutable state;
error messages carry no paths, stacks, errno, or internal details
(including the unexpected-failure path).

## 10. Tests

`tests/drafting/proposal.test.ts` (18 tests) + `tests/drafting/static-guard.test.ts`
(3 tests): exact vocabulary; valid draft per kind with committed-digest
equivalence; direct WP-4 equivalence (valid + invalid, identical finding
projection); consumption-phase separation; non-draftable/lookalike
rejection; kind correlation; derived-member rule; closed request shape;
self-approval guard; duplicate-key/malformed intake; byte bound; determinism;
immutability; authority replay; redaction; fs-mutation watchdog; static
dependency/vocabulary guard with exact import allowlist.

## 11. Remaining WP-10 Work

- MCP-facing draft tool adapter/registration (new tool class on the local
  stdio runtime; WP-9 six-tool inventory untouched until then).
- Any controlled-context (WP-6/WP-7) integration not part of this core.
- Final WP-10 integration/closure (exact later slices are for a later
  authorization after Slice 1 independent review).

## 12. Changed-Path Inventory (this slice, all unstaged/uncommitted)

- `src/drafting/proposal.ts` (new)
- `tests/drafting/proposal.test.ts` (new)
- `tests/drafting/static-guard.test.ts` (new)
- `docs/reports/wp-10-artifact-drafting-tools-implementation-report.md` (new)
- `docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`
  (narrow current-state updates)

## 13. Independent-Review Correction F1 (preserved history)

The first independent review of Slice 1 returned `CORRECTIONS REQUIRED`
with exactly ONE substantive MODERATE finding, and simultaneously accepted
all Slice 1 semantics (`DRAFTABLE ARTIFACT VOCABULARY: CONTRACT-CONFORMANT`,
`EXECUTIONRESULT PRODUCER BOUNDARY: CORRECTLY EXCLUDED`, `DRAFT IDENTITY
PROPOSAL: CONTRACT-CONFORMANT`, `WP-6 SLICE-1 NON-USE: CONTRACT-CONFORMANT`,
`WP-7 SLICE-1 NON-USE: CONTRACT-CONFORMANT`, `DRAFT-PROPOSAL NON-AUTHORITY:
CONTRACT-CONFORMANT`, `WP-9 MCP SURFACE: UNCHANGED`).

**F1 — valid JSON that is not an Artifact envelope could be misclassified
as `internal-adapter-failure`.** Cause: `createDraftProposal` with content
`null` (or any JSON value that is not a non-null, non-array object) reached
kind correlation, where property access on `null` threw a normal JavaScript
`TypeError`, and the catch-all converted it into an internal failure — a
taxonomy defect (client-controlled input must never masquerade as an
adapter malfunction).

**Correction:** an explicit object-envelope shape guard immediately after
the accepted raw-JSON intake and before any object-property assumption:
the parsed model must be an object, non-null, and not an array, otherwise
`invalid-draft-request` is returned. No exception-based shape control was
introduced; `internal-adapter-failure` remains reserved for genuinely
unexpected internal failures (probed via an existing test seam). The
accepted raw-JSON intake, kind-correlation semantics, derived-digest
semantics, WP-4 self-validation, and all accepted vocabulary/identity/
WP-6/WP-7/persistence/authority/MCP boundaries are unchanged.

**Focused regression coverage:** `null`, scalar string/number/boolean,
empty and non-empty arrays → `ok:false` / `invalid-draft-request` (never
`internal-adapter-failure`, no content echo); control cases preserved:
malformed JSON → parser error path; object-shaped WP-4-invalid proposal →
`ok:true` / `valid:false` with findings; unexpected internal failure →
fixed redacted `internal-adapter-failure`.

**Status:** the corrected candidate passed the focused independent rereview
with F1 CLOSED and zero substantive regression; Slice 1 was independently
accepted and committed as the committed candidate.

## 14. Slice 2 — Host/Surface-Aware Transport-Free Drafting Adapter (committed candidate)

**Status:** independently accepted and committed as the committed
candidate (independent review ACCEPTED; zero substantive findings).
**Baseline:** `5c560f4804e029f25b11b6eb1dc7cd45dcf9c7e7` (Slice 1 commit).
**Authorized decision:** `DRAFT/VALIDATE SURFACE CONSISTENCY: REQUIRED`;
`DRAFT TOOL SURFACE ROUTING: REQUIRED`; `WP-6 NEXT-SLICE ROLE: NOT
REQUIRED`; `WP-7 NEXT-SLICE ROLE: NOT REQUIRED`; one generic future tool
`draft-artifact ({surfaceId, kind, content})`; verbatim Slice 1 result in
the accepted envelope; controlled-context ordering: validation-context
routing first, project-reader assist later.

### 14.1 Slice-1 Injection Seam (registry as validation context)

`src/drafting/proposal.ts` now exposes the shared implementation
`createDraftProposalWithSchemaRegistry(request, schemaRegistry)` — the
exact accepted Slice 1 algorithm with the ONLY difference being the
registry source. `createDraftProposal(request)` remains the public/default
wrapper supplying the fresh default registry (accepted Slice 1 semantics
unchanged; existing 22/22 drafting tests pass unmodified). A `SchemaRegistry`
is validation context ONLY: injecting one grants no persistence, approval,
issuance, activation, execution, or workspace access. The seam is exported
at module level only (not the package root).

### 14.2 Drafting Context / Registry Model

`src/adapters/mcp/drafting.ts` (transport-free sibling of the WP-9
inspection modules; no MCP SDK, no stdio runtime):

- `DraftingContext` — the narrowest drafting context: exactly one essential
  fact, the host-supplied `schemaRegistry`. No workspace root, storage
  locator, trusted configuration, reader, write authority, lifecycle state,
  RuntimeGrant, or transport state.
- `createDraftingContext({ schemaRegistry })` — host composition; the
  registry must be a genuine `SchemaRegistry` instance (`ERR-DRAFT-REQ-INVALID`
  otherwise).
- `McpDraftingRegistration = { surfaceId, schemaRegistry }` — host-owned;
  no storage/trusted bootstrap input required for pure draft
  self-validation (WP-6/WP-7 non-use, accepted decision).
- `createMcpDraftingRegistry({ registrations })` — immutable after
  construction, insertion-order-independent (canonical sorted `surfaces`),
  no client mutation/inventory API, empty registry legal (consistent with
  WP-9 host registration), exact duplicate/conflicting duplicate surfaceIds
  fail construction deterministically.
- `MCP_DRAFT_TOOLS = ['draft-artifact']` — distinct future vocabulary
  constant, strictly separate from `MCP_INSPECTION_TOOLS`; nothing is
  registered in this slice.

### 14.3 SurfaceId Grammar

The exact accepted WP-9 constants are reused (`SURFACE_ID_RE`,
`SURFACE_ID_MAX_LENGTH` from `src/adapters/mcp/registry.ts`); no second
regex, no copy. Selector semantics preserved: malformed → outer
`invalid-request`; well-formed but unregistered → outer `not-found` (no
inventory/path leakage, no fuzzy matching, no cross-surface fallback).

### 14.4 Same-Registry-Instance Mechanism

Routing resolves the registered surface and invokes
`createDraftProposalWithSchemaRegistry(inner, context.schemaRegistry)` —
the EXACT object registered by the host. Not a fresh registry, clone,
reconstructed equivalent, or default. Proven by an instrumented
`CountingRegistry` subclass (test seam; no production hooks): routing to
surface A consults registry A exactly once and never registry B. The
accepted same-instance contract is established and testable; the future
runtime composition root must register the same instance for the same
logical `surfaceId` in both registries (no process-global enforcement —
host composition owns pairing).

### 14.5 Request / Outer Routing / Result Model

- Request envelope: `{ kind, content, requestId? }` (closed fields;
  `requestId` bounded 1..128, echoed consistently, never enters draft
  content, and will NOT be a future stdio tool argument). No root, path,
  destination, workspace, approve, issue, activate, execute, or
  RuntimeGrant operand.
- Routing failure (malformed selector/envelope) → outer `{ ok: false,
  error: { code: 'invalid-request' | 'not-found', ... } }`.
- Successful surface selection → outer `{ ok: true, result: <complete
  Slice 1 DraftProposalResult verbatim> }`. The inner drafting taxonomy
  (`invalid-draft-request`, `unsupported-artifact-kind`,
  `limit-exceeded`, `internal-adapter-failure`, `valid:false` conclusions)
  is NEVER remapped to inspection/storage codes.
- Genuine post-routing internal failures (host-supplied broken registry
  test seam) remain `internal-adapter-failure` with the fixed redacted
  message.
- `surfaceId` selects host-owned validation context ONLY — never a
  persistence destination, workspace write target, or storage authority
  (WP-11 remains the persistence boundary).

### 14.6 Draft/Validate Surface Consistency

Tests construct one `SchemaRegistry` instance and bind the SAME object into
an accepted WP-9 inspection surface/context and a drafting surface under the
same logical `surfaceId`. For all five draftable kinds (valid) and three
representative invalid candidates: draft self-validation conclusion ≡
`validate-artifact` conclusion — identical validity, digest, instanceId,
revisionId, ruleIds, level, and identical finding projection
(phase/category/ruleIds/messageKey/location/subjectIdentity). Envelope
shapes differ by design (draft result carries `proposal`/`validation`;
`validate-artifact` carries `valid`/`firstFailingPhase`/`digest` at top
level); semantic results are equivalent.

### 14.7 Boundary Preservation

No persistence (no file/store/temp writes; fs-mutation watchdog covers
valid routing, invalid drafts, unknown/malformed selectors, duplicate
construction failure — zero mutation), no lifecycle/authority (no
approval/issuance/activation/grant vocabulary, zero brand symbols, genuine
verifiers reject draft data), no execution, no network/tunnel, no WP-6
consumption (no trusted configuration operand), no WP-7 consumption (no
project reads), no runtime modification (`src/runtime/mcp/server.ts`
untouched; stdio inventory remains exactly six WP-9 inspection tools), and
`createMcpInspectionRegistry` is NOT widened into drafting (no drafting
method on it; WP-9 registry tests unchanged).

### 14.8 Exports / Dependencies

The drafting adapter is exported additively from the `./mcp` adapter entry
(`src/adapters/mcp/index.ts`); `package.json` exports map is unchanged
(`./mcp` remains the adapter library boundary; no new subpath — the package
is private and no external consumer justifies one). No new dependency
(zod + `@modelcontextprotocol/server` remain runtime-layer only; the
adapter imports zero SDK/transport modules).

### 14.9 Tests

`tests/mcp/unit/drafting.test.ts` (16 tests) + one drafting-adapter static
guard test in `tests/mcp/unit/static-guard.test.ts`: registration
(empty/single/two surfaces, duplicate, non-genuine registry, ordering,
immutability), malformed/unknown selectors (with no-registry-consultation
proof), five-kind routing equivalence with the direct seam, exact-instance
consultation, closed envelope, inner taxonomy preservation, internal-
failure preservation, draft/validate surface consistency (valid + invalid),
no-authority, determinism, fs-mutation watchdog, vocabulary separation, and
inspection-registry stability. Drafting static guard allowlist extended
with `../schema/registry.js` (the seam's registry type); MCP adapter
allowlist extended with `./registry.js`, `./drafting.js`,
`../../drafting/proposal.js`.

### 14.10 Remaining WP-10 Work

- stdio registration of `draft-artifact` (six → seven tools) — COMPLETED by
  Slice 3 (see §15);
- controlled-reader drafting assist only if still required/authorized;
- final WP-10 integration/closure.

## 15. Slice 3 — Local stdio registration of draft-artifact (implementation candidate)

**Status:** implementation candidate; Slice 3 independently accepted and
committed by independent review (WP-10 remains NOT closed).
**Baseline:** `09e48332b97dfe12e344bb6d37e902c856798e1c` (Slice 2 commit).
**Authorized:** HUMAN AUTHORIZATION to implement the next accepted WP-10
slice; local stdio registration of exactly ONE new tool (`draft-artifact`)
through the already-accepted Slice 2 drafting adapter.

### 15.1 Runtime inventory

The runtime now serves exactly SEVEN stdio MCP tools:

1. `validate-artifact`
2. `inspect-stored-record`
3. `inspect-registry`
4. `inspect-audit-history`
5. `verify-record`
6. `enumerate-class`
7. `draft-artifact`

`MCP_INSPECTION_TOOLS` remains exactly the six accepted WP-9 inspection
tools (WP-9 CLOSED, six-tool inspection surface unchanged); `MCP_DRAFT_TOOLS
= ['draft-artifact']` (accepted Slice 2 constant) is the one drafting
vocabulary — no second runtime spelling/list exists. The runtime static
guard asserts distinct tool classes: six inspection registrations + one
drafting registration + overall seven, and rejects tool names implying
save/write/persist/publish/approve/issue/execute/activate/revoke.

### 15.2 Server is a pure routing layer (no new draft semantics)

`src/runtime/mcp/server.ts` registers `draft-artifact` with the accepted
`McpDraftingRegistry`: the handler passes the MCP arguments `{ surfaceId,
kind, content }` to `draftingRegistry.draft(surfaceId, { kind, content })`
— no invented requestId — and presents the accepted transport-free result
through the existing text + `structuredContent` convention. The server
implements NO draft parsing, five-kind checks, digest calculation, WP-4
validation, surface lookup, or drafting error mapping: those remain owned
by the accepted Slice 1 core / Slice 2 adapter.

### 15.3 SDK input schema — shape/type only

`inputSchema: z.object({ surfaceId: z.string(), kind: z.string(), content:
z.string() }).strict()` with `annotations: { readOnlyHint: true }` (the
operation creates no external persistent side effect; no destructiveHint).
The SDK validates TYPE/SHAPE; semantics stay in the adapter/core:

- `kind` is a plain string (no five-kind enum): `ExecutionResult` and
  other unsupported string kinds reach the inner drafting outcome
  `unsupported-artifact-kind` as a successful tool execution — the SDK
  never preempts it;
- `content` is a plain string (no byte ceiling): oversize content reaches
  the inner `limit-exceeded` outcome;
- `surfaceId` is a plain string: malformed selectors reach the outer
  adapter `invalid-request` outcome;
- wrong argument TYPES (surfaceId number, kind object, content array) and
  unknown outer fields remain SDK/protocol input errors (closed strict
  schema) — distinct from semantically invalid string values;
- no `requestId` tool argument; no root/path/destination/workspace/
  approve/issue/activate/execute/RuntimeGrant operand.

### 15.4 Result / isError mapping

Every expected adapter/drafting outcome is a successful MCP tool result
(`isError` absent/false): outer `ok:true` with the complete inner Slice 1
`DraftProposalResult` verbatim (including inner `ok:false` outcomes:
`invalid-draft-request`, `unsupported-artifact-kind`, `limit-exceeded`,
`internal-adapter-failure`, and `ok:true valid:false` conclusions with
findings), and outer `ok:false` routing outcomes (`invalid-request`,
`not-found`) presented through the same normal tool-result convention used
for expected WP-9 adapter outcomes. Only true runtime/handler exceptions
become MCP execution failures (bounded stderr diagnostic, generic error,
no internal details). `structuredContent` is the exact machine response
object; the text block is the compact JSON of the same object (parity
verified by JSON-normalized deep comparison in tests).

### 15.5 Host composition — same-registry-instance

`src/runtime/mcp/compose.ts` now builds BOTH registries. For each
configured logical surface it creates exactly ONE `SchemaRegistry` and
passes that SAME object into the inspection registration
(`McpStoreRegistrationInput.schemaRegistry`) and the drafting registration
(`McpDraftingRegistration.schemaRegistry`) — so `validate-artifact` and
`draft-artifact` self-validate under the identical schema context for the
same surface. No startup-config change: the existing `surfaces` entries
automatically gain drafting validation context (WP-10 drafting
availability is part of this runtime version, not a per-surface
client-granted authority flag); no `"drafting": true` flag. The startup
JSON does not serialize custom schema registries (one fresh registry per
surface is created by composition and shared). The registry factory is an
optional pure composition dependency (`ComposeDependencies`) defaulting to
`createSchemaRegistry`; tests use it to PROVE same-instance sharing (an
instrumented `CountingRegistry` subclass created once per surface is
consulted by BOTH the drafting route and the inspection route, and a
surface's drafting never consults another surface's instance). No mutable
production instrumentation was added.

### 15.6 Config security (F1-F3) preserved

`src/runtime/mcp/config.ts` is UNCHANGED: 1 MiB true byte-bounded config
read (F1), duplicate-key-rejecting raw JSON intake (F2), and
`validateLimitSelection(name, value, true)` for configurable limits (F3)
are untouched and re-verified by the existing startup-config regression
tests.

### 15.7 Boundary preservation

No persistence: runtime invocation of `draft-artifact` writes no project
files, storage, temp files, registry, or audit/lifecycle store (fs-mutation
watchdog now covers drafting paths — valid draft, invalid draft,
unsupported kind, malformed JSON, oversize, unknown surface, malformed
surface — plus the stdio store-snapshot test runs drafting calls in the
same session and asserts zero store mutation). No lifecycle authority
(AuthorityPolicy drafts remain plain candidate data; no activation/grant),
no execution (ExecutionBundle drafts are not resolved/executed), no
project/context read (ContextManifest drafting loads nothing), no network
change (local stdio only; the no-listener probe covers the session that
performs drafting calls), stdout protocol-only with bounded stderr
diagnostics, modern `serveStdio(() => server)` factory preserved (no
direct transport connection), drafting registry lives in the same
server/runtime composition lifetime as the inspection registry (no
process-global mutable drafting state). No new dependency; package export
map unchanged (runtime imports internal modules directly).

### 15.8 Tests

Runtime suite extended: `tests/runtime/server.test.ts` (six new tests:
seven-tool inventory + draft-artifact schema shape/type assertions;
semantic passthrough with outer/inner taxonomy and text/structuredContent
parity; wrong-type/unknown-field SDK errors; all five draftable kinds;
draft/validate consistency through MCP; same-instance composition proof
through `composeTrustedRegistry` with the injected factory; no-authority
probe; watchdog extended with drafting calls), `tests/runtime/stdio.test.ts`
(modern pinned path: seven tools, draft-artifact schema, valid draft,
unsupported-kind regression, unknown surface; auto path: all seven tools +
draft failure paths under store snapshot; two-surface drafting routing
with no global fallback), and `tests/runtime/static-guard.test.ts`
(exactly seven registrations with distinct tool classes, no
write-implying tool names, shape/type-only input schema assertions,
runtime envelope `{ kind, content }` without requestId).

### 15.9 Remaining WP-10 work (reassessed)

- WP-10 IMPLEMENTATION COMPLETE — CLOSURE REVIEW PENDING (WP-10 is NOT
  closed; the independent Slice 3 review concluded that controlled-reader
  drafting assist is NOT required for the normative WP-10 closure gate
  "Drafts validate but never self-approve": WP-7 is a satisfied
  prerequisite, not a drafting-assist output obligation);
- controlled-reader drafting assist: NOT implemented and NOT required for
  WP-10 closure; it would be an optional separately-authorized enhancement
  (never invented automatically).

Slice 3 does NOT start WP-11 (persistence), WP-12 (lifecycle authority),
WP-13 (Pi execution), or WP-14 (tunnel/ChatGPT configuration); the runtime
remains the local stdio command an external tunnel client will launch
later under WP-14.
