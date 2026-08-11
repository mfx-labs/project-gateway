# WP-14 — Pre-Implementation Contract Decision

**Work package:** WP-14 — Tunnel and ChatGPT Web connectivity.
**Phase:** contract decision only (documentation only; no implementation
authorized by this document; no source/test/schema/fixture/package/runtime
change made; nothing staged or committed).
**Status:** the WP-14 product UX alignment is human-approved and recorded
(ADR-040 — WP-14 zero-transfer product boundary; amendment report
`docs/reports/wp-14-product-ux-alignment-amendment.md`). This document
establishes the implementation-oriented WP-14 contract: exactly two
slices (WP-14A, WP-14B), the controlled-persistence contract, the
changed-context contract, the trigger model, and the end-user acceptance
scenario. **WP-14A and WP-14B remain NOT STARTED and NOT AUTHORIZED**:
subsequent explicit human implementation authorization is required.
**WP-14C (Pi zero-transfer artifact loading) is separately roadmap-owned**
(roadmap order pinned `WP-14 → WP-14C → WP-15`); it is NOT a WP-14 slice
and is NOT authorized here. WP-15 remains blocked until WP-14 and WP-14C
are closed.
**Correction record (2026-08-12):** the WP-14 product UX focused contract
review returned `WP-14 PRODUCT UX FOCUSED CONTRACT REVIEW CORRECTIONS
REQUIRED`; the five findings SCR-WP14-UX-001 (CRITICAL — persistence
validation provenance, Model B), SCR-WP14-UX-002 (MAJOR — changed-context
content-read confinement), SCR-WP14-UX-003 (MODERATE — ADR-023 narrow
tail amendment), SCR-WP14-UX-004 (MODERATE — secrets placement), and
SCR-WP14-UX-005 (MINOR — WP-14C "bundle" clarification) are CLOSED by
this correction (§13; ADR-040 correction record).
**Baseline:** HEAD `b656e20b24bfaebb9a16cb554ead6421cd6e75e4` (branch
`main`; `docs: close WP-13 execution integration`); working tree
contained only pre-existing untracked WP-13D historical leftovers at
baseline; this phase adds documentation only.
**Eligibility basis:** WP-13 is CLOSED (closure report
`docs/reports/wp-13-closure-report.md`); WP-14 is the next
roadmap-eligible package (human implementation authorization still
required). Committed prerequisites all CLOSED: WP-9 (`045ae7c2…`), WP-10
(`5c560f48…`), WP-11 (`9695c5d`), WP-7 (`6b94d81`), WP-6, WP-13
(`b656e20`).

## 1. Fixed WP-14 scope (accepted roadmap — not reopened)

`docs/design/post-wp5a-roadmap.md` (table row 10; attribute block): WP-14
owns ChatGPT Web draft/review connectivity per the WP-1 producer boundary
and the approved zero-transfer UX baseline (ADR-040): inspect → construct →
validate → persist proposal artifacts through the committed WP-11
controlled-write boundary, plus stateless changed-context retrieval.
Inputs: WP-13 execution results, WP-9 inspection surface, WP-7 controlled
reader/Git inspection, WP-10 drafting, WP-11 controlled writing. Outputs:
tunnel-only ChatGPT connectivity; one WP-11-backed controlled proposal
persistence surface; one stateless changed-context surface; connector/
operator configuration. Prohibited: widening authority, generic filesystem
writes, lifecycle-record writes, bypassing WP-11, Pi-side loading
(WP-14C-owned). Invariants: no lifecycle authority flows through
connectivity; schema limits WHAT ChatGPT may persist and WP-11 limits
WHERE and HOW; persistence is not lifecycle authority. Non-goals: no
governance, no execution, no third implementation slice beyond
WP-14A/WP-14B. Roadmap closure gate (revised): ChatGPT Web reaches Gateway
surfaces via tunnel; can inspect project state, create + validate + persist
a supported proposal artifact through controlled write, and retrieve
changed project context without manual paste/upload; no lifecycle
authority flows through connectivity; fail-closed; no generic
filesystem-write surface.

## 2. Slice Decomposition — exactly two slices

**WP-14A — ChatGPT Connectivity and Controlled Producer Surfaces.** Owns:

1. tunnel-only connectivity contract (ChatGPT Web → Secure MCP Tunnel →
   existing stdio `project-gateway-mcp --config ...` → existing/new
   bounded Gateway surfaces);
2. existing MCP surface exposure (the seven committed tools unchanged);
3. one WP-11-backed proposal persistence surface;
4. one stateless changed-context surface;
5. connector/operator configuration;
6. secrets-placement rules;
7. authority isolation (static guards: no lifecycle/store/control-plane
   imports; fail-closed; no generic filesystem-write surface);
8. typed/visible feedback on every surface.

Transport model: ChatGPT Web → Secure MCP Tunnel → existing stdio
`project-gateway-mcp --config ...` → existing/new bounded Gateway
surfaces. **No repository-owned HTTP/OAuth/public server** exists; the
committed local stdio CLI remains the tunnel `--mcp.command`.

**WP-14B — Integration and End-User Validation.** Owns:

- connector/tunnel integration;
- inspect workflow;
- draft → validate → persist workflow;
- changed-context workflow;
- failure/disconnect tests;
- authority-isolation evidence;
- live ChatGPT Web smoke where operationally available;
- WP-14 closure.

**Do NOT add a third WP-14 implementation slice.** WP-14C is separately
roadmap-owned.

### 2.1 Secrets placement (pinned)

- Tunnel/auth credentials are operator-local and owned by the external
  tunnel/platform; external tunnel tooling may use its own
  operator-local credential store/environment according to that
  platform.
- Credentials MUST NOT be stored in project-visible artifacts; MUST NOT
  be committed to repository configuration; MUST NOT be fields in
  trusted Gateway workspace/runtime configuration; MUST NOT be accepted
  through Gateway MCP tool requests; MUST NOT be returned through
  Gateway MCP responses.
- Gateway runtime configuration remains secret-free for WP-14. WP-14
  does NOT create secret-storage infrastructure.
- Transport authentication remains distinct from Gateway
  protocol/lifecycle authority.

## 3. Expected MCP Vocabulary

Existing (unchanged, closed):

- `validate-artifact`
- `inspect-stored-record`
- `inspect-registry`
- `inspect-audit-history`
- `verify-record`
- `enumerate-class`
- `draft-artifact`

New WP-14A surfaces (exactly two):

- one controlled proposal persistence operation (WP-11-backed);
- one changed-context inspection operation (WP-7-composed).

Exact names remain implementation details. The runtime's exactly-seven
tool inventory (asserted by `tests/runtime/static-guard.test.ts`,
`tests/runtime/server.test.ts`, `tests/runtime/stdio.test.ts`, and the
closed `MCP_INSPECTION_TOOLS` vocabulary asserted by
`tests/mcp/unit/static-guard.test.ts`) will intentionally grow by these
two operations; historical seven-tool statements in closed-package
reports remain historical.

## 4. Controlled-Persistence Contract (WP-14A adapter)

The future WP-14A persistence adapter must:

- consume the existing WP-11 controlled-write core (`src/writing/**`,
  CLOSED) — no WP-11 redesign is authorized;
- route through exact surface/workspace binding (opaque `workspaceId`;
  `surfaceId` routing per the accepted registry pattern);
- accept only supported proposal kinds (`TaskSpec`, `AuthorityPolicy`,
  `ContextManifest`, `CompletionContract`);
- derive destination through trusted host/WP-11 semantics
  (identity-based artifact-root-relative destination; no
  ChatGPT-supplied free-form paths — zero path transcription);
- preserve create-only/containment/ownership constraints (WP-6 Phase 2B
  prospective containment, point-of-use revalidation, descriptor-anchored
  executor, service-user ownership prerequisite);
- return bounded redacted write evidence (kind, instanceId, revisionId,
  digest, relative destination, byte count);
- expose no absolute trusted root (ChatGPT sees workspace identifiers,
  never trusted filesystem roots).

It must NOT:

- bypass WP-11;
- write lifecycle records;
- write `ExecutionResult`;
- write `TrustedReceipt`;
- write configuration;
- offer arbitrary file writes.

The ChatGPT-facing operation must never accept arbitrary absolute paths,
arbitrary bytes outside the artifact contract, overwrite flags, file
modes, shell/file operations, or trusted resolver/configuration
evidence. Pin: **schema limits WHAT ChatGPT may persist; WP-11 limits
WHERE and HOW it may persist.**

### 4.1 Validation provenance — Model B (pinned)

The ChatGPT-facing persistence operation **independently performs the
required trusted structural and semantic validation at the persistence
boundary before invoking WP-11**. The remote request MUST NOT be trusted
as a `ValidDraftProposalResult`. The remote caller MUST NOT establish
validation provenance by supplying `ok`, `valid`, `canonicalUtf8`,
digest/correlation assertions, a caller-constructed
`ValidDraftProposalResult`, or a reference claiming prior validation. The
persistence adapter may accept candidate artifact material according to
its closed wire contract, but all caller material remains untrusted.

Trusted host composition at point of persistence:

```text
candidate artifact
→ structural validation
→ semantic validation
→ canonicalization
→ trusted digest/correlation
→ construct the internal validated draft representation
→ invoke WP-11 controlled write
```

The internal validated result passed to WP-11 must be freshly
host-produced from that validation operation. Continuity is pinned
across: artifact kind → instance/revision identity → canonical bytes →
digest → validation result → WP-11 write request → returned write
evidence. The exact bytes persisted must be the exact trusted canonical
bytes produced/correlated by that validation; any substitution or
mismatch fails closed.

No opaque validation handles, session validation state, or validation
caches as authority. `draft-artifact` remains an independent in-memory
drafting/self-validation UX surface; calling `draft-artifact` first is
NOT a security prerequisite for persistence; if artifact material
originated from `draft-artifact`, `persist-artifact` still independently
validates it at the persistence boundary. The existing trusted
validation composition is reused — no second validator is built.

## 5. Changed-Context Contract (WP-14A surface)

The changed-context capability exposes only enough to support the
approved UX:

- changed file set;
- bounded Git status/diff;
- controlled file content on explicit/narrow request where needed.

Reuse existing WP-7 controlled Git/file inspection (`git-status`,
`git-diff`, `read-text` via the WP-7 internal composition boundary —
the established WP-9 pattern of exposing WP-8 through a committed
adapter). Requirements: stateless; fresh point-of-use reads; bounded
output; workspace-contained; redacted; fail closed; no lifecycle side
effects. **Do not introduce a context database** — no `ActiveContext`
lifecycle record, no `HotkeyRecord`, no persistent selection/event
protocol.

### 5.1 Content-read confinement (pinned)

The changed-context operation derives the current changed-file set from
trusted, fresh WP-7 Git inspection. Any optional content read performed
by this operation MUST be limited to a requested subset of that freshly
resolved changed-file set. A caller MUST NOT nominate an unrelated
workspace path and obtain its contents through the changed-context
operation. For each requested content read:

- the path must belong to the fresh Git-derived changed set;
- ordinary workspace/read containment still applies independently;
- point-of-use membership/containment must be rechecked as required by
  existing WP-7 semantics;
- drift that invalidates membership fails closed;
- unreadable/out-of-scope/unsupported content fails through existing
  typed semantics;
- no silent partial success.

If the user wants an unrelated authorized project file, that must use
the already-existing appropriate inspection/read surface, not the
changed-context operation. Bounded limits are preserved for:
changed-file count, path/status metadata, diff bytes, and requested
file-content bytes. Binary/unsupported-file behavior delegates to
existing WP-7 semantics — no second content model is invented. No global
filesystem snapshot transaction is required.

## 6. Trigger Model
- **ChatGPT:** short invocation semantics such as conceptually
  `@gateway changes` belong to the ChatGPT Skill/App/workflow layer
  (WP-14 owns the workflow contract; the skill itself is
  operator/ChatGPT-side configuration).
- **Pi:** short invocation such as conceptually `/load-bundle` belongs to
  WP-14C's Pi extension/command surface.
- **OS hotkeys:** optional operator mappings only; hotkeys do not belong
  to the protocol.

Do NOT introduce: browser automation, keyboard daemon, persistent event
bus, `HotkeyRecord`. No lifecycle/authority record represents a hotkey or
context selection.

## 7. End-User Acceptance Scenario (product acceptance)
1. User asks ChatGPT to create/update an artifact.
2. ChatGPT inspects project state through Gateway.
3. ChatGPT constructs and validates the artifact.
4. ChatGPT persists it through controlled write.
5. User switches to Pi.
6. User invokes a short Pi load action.
7. Pi resolves/validates/loads the intended artifact/bundle.
8. Pi changes project files.
9. User invokes a short ChatGPT changed-context workflow.
10. ChatGPT retrieves the relevant changes itself.
11. ChatGPT reviews/updates artifacts as requested.
12. Pi can load the new revision through the short action.

Routine execution requires: no clipboard transport, no manual file
upload/download, no manual path transcription. User-authored conversational
instructions remain intentional and unrestricted.

**Feedback requirement:** every zero-transfer action returns concise
visible feedback (e.g., `ChatGPT context: 4 changed files loaded`,
`Artifact persisted: TaskSpec revision <id>`, `Pi loaded bundle: …`);
incomplete/invalid state produces typed visible failure; no silent partial
success. Exact wording is implementation detail.

## 8. WP-14 Closure Gate (revised)

At minimum, WP-14 closure must prove:

1. ChatGPT Web reaches the intended Gateway surfaces through the tunnel
   (live where operationally available; otherwise tunnel-conformance
   scripted evidence).
2. ChatGPT can inspect project state (existing six WP-9 inspection tools).
3. ChatGPT can create + validate + persist a supported proposal artifact
   through controlled write (project-visible file in the configured
   artifact location; typed evidence returned).
4. ChatGPT can retrieve changed project context without manual
   paste/upload (changed-context surface).
5. Connectivity/persistence creates no lifecycle/execution authority
   (negative evidence: no store/control-plane records, no pi-guard
   change, no receipts).
6. Failure/disconnect remains fail-closed (partial-write cleanup, no
   half-state, redacted errors).
7. No generic filesystem-write surface exists (closed-vocabulary static
   guards).
8. Every zero-transfer action returns concise visible feedback; typed
   failure on incomplete state.
9. Tool-count/static assumptions updated to the new closed inventory
   (§3).
10. Pi load acceptance is NOT part of the WP-14 gate: it belongs to the
    WP-14C closure gate (ownership decision; ADR-040 Decision C).

## 9. WP-14C Ownership Note

WP-14C (Pi zero-transfer artifact loading) is a new minimal roadmap
package executing after WP-14 and before WP-15 (roadmap order
`WP-14 → WP-14C → WP-15`; roadmap row 11; attribute block). WP-14C
closure gate: "Pi can load the intended valid artifact/bundle through a
short user action without copy/paste, upload/download, manual path
transcription, or a natural-language loading prompt, while gaining no
lifecycle authority from the load itself." **"Bundle" clarification
(pinned):** the phrase "intended artifact/bundle" refers to the future
WP-14C resolution/loading semantics and does NOT imply that WP-14 may
persist an `ExecutionBundle` — WP-14 persistence remains exactly
`TaskSpec`, `AuthorityPolicy`, `ContextManifest`, `CompletionContract`;
the exact Pi-side resolution/assembly semantics remain deferred to the
WP-14C contract gate; no durable current-selection record is introduced.
The exact "current intended bundle" selection algorithm is deferred to
the WP-14C contract decision: no durable selection record is assumed;
host-configured explicit selection should be preferred where practical;
a deterministic fallback may be considered during WP-14C contracting.

## 10. Authority Separation (pinned)

- **ChatGPT:** may inspect, retrieve changed context, draft, validate,
  persist proposal artifacts (controlled write only). May NOT approve,
  issue, grant, activate, execute, or issue TrustedReceipt.
- **Pi:** may load/consume validated project artifacts as context; may
  execute only when separately authorized by the existing trusted
  execution path. Loading alone grants nothing.
- Connectivity, keyword invocation, hotkeys, or artifact loading MUST
  NOT create authority.

## 11. Open Decisions (future-gated only)

The approved product requirements are NOT reopened. Only these remain:

- **WP-14A implementation details:** exact new MCP tool names; internal
  adapter/file placement; one-vs-composed helper structure.
- **WP-14B evidence detail:** precise live ChatGPT smoke procedure based
  on operational platform availability.
- **WP-14C contract decision:** exact deterministic resolution semantics
  for "intended artifact/bundle" (host-configured explicit selection
  preferred; deterministic fallback may be considered).

No other architecture decision blocks WP-14A after this amendment is
accepted.

## 12. Verification (docs-only)

- Roadmap consistency: execution order pinned `WP-14 → WP-14C → WP-15`;
  WP-14C row and attribute block present; WP-15 prerequisites include
  WP-14 and WP-14C; no circular-dependency change.
- ADR-040 created and cross-referenced from the roadmap (normative
  cross-references) and the scope/principles document; ADR-023 carries
  the narrow tail-amendment note and agrees with ADR-040 on
  `WP-14 → WP-14C → WP-15`.
- No contradictory "in-memory only" or seven-tool-as-permanent-boundary
  language found in current normative/current-state documents
  (closed-package historical reports retain historical wording).
- No current normative text makes persistence equal lifecycle authority
  (WP-0 invariants 14–16; ADR-040; roadmap invariants).
- Persistence docs explicitly contain independent validation-at-
  persistence semantics (Model B); no normative text permits a
  caller-constructed `ValidDraftProposalResult` as trusted provenance.
- Changed-context content reads are constrained to the fresh
  Git-derived changed set (§5.1; ADR-040 Decision B).
- Secret-placement prohibitions are normative (§2.1; ADR-040 Decision D;
  roadmap WP-14 attribute block).
- WP-14 persistable kinds remain exactly four; `ExecutionBundle` is not
  implied persistable by WP-14 (§9; ADR-040 Decision C).
- `git diff --check` clean; nothing staged or committed.

## 13. Focused Correction Record

The WP-14 product UX focused contract review returned `WP-14 PRODUCT UX
FOCUSED CONTRACT REVIEW CORRECTIONS REQUIRED`. Findings and closures:

- **SCR-WP14-UX-001 (CRITICAL) — CLOSED:** Model B selected; §4.1 pins
  independent trusted structural/semantic validation at the persistence
  boundary, the trusted host validation chain, continuity, and the
  prohibition on caller-supplied validation provenance (ADR-040
  Decision A items 5–7).
- **SCR-WP14-UX-002 (MAJOR) — CLOSED:** §5.1 pins changed-context
  content-read confinement to the fresh Git-derived changed set, with
  point-of-use membership rechecks and fail-closed drift (ADR-040
  Decision B item 2).
- **SCR-WP14-UX-003 (MODERATE) — CLOSED:** ADR-023 carries the narrow
  amendment note (tail `WP-14 → WP-14C → WP-15` only); all other
  ADR-023 decisions unchanged.
- **SCR-WP14-UX-004 (MODERATE) — CLOSED:** §2.1 pins secrets placement
  (operator-local, external-tunnel-owned, secret-free Gateway runtime
  configuration, no credentials in artifacts/repository/trusted
  configuration/MCP requests or responses; ADR-040 Decision D).
- **SCR-WP14-UX-005 (MINOR) — CLOSED:** §9 pins the "intended
  artifact/bundle" clarification (WP-14C resolution semantics only;
  WP-14 persistence remains exactly four kinds; no durable
  current-selection record).

## 14. Git State

Baseline HEAD `b656e20b24bfaebb9a16cb554ead6421cd6e75e4` unchanged;
nothing staged or committed; pre-existing untracked WP-13D historical
leftovers untouched; no push/tag/release/deploy.
