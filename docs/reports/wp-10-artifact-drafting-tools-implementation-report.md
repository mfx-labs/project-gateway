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
