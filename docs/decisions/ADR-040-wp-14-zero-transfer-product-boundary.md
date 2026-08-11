# ADR-040 — WP-14 Zero-Transfer Product Boundary

## Status

**Accepted** as part of the WP-14 product UX contract amendment
(docs-only; baseline `b656e20b24bfaebb9a16cb554ead6421cd6e75e4`; amendment
report `docs/reports/wp-14-product-ux-alignment-amendment.md`). The
human-approved product UX baseline is recorded here at decision level.

Documentation only — **no implementation is authorized by this ADR
acceptance**: WP-14A, WP-14B, and WP-14C remain **NOT STARTED and NOT
AUTHORIZED**; each requires separate human implementation authorization.

**Correction record (2026-08-12):** the WP-14 product UX focused contract
review returned `WP-14 PRODUCT UX FOCUSED CONTRACT REVIEW CORRECTIONS
REQUIRED`; the five findings SCR-WP14-UX-001 (CRITICAL — persistence
validation provenance, Model B selected), SCR-WP14-UX-002 (MAJOR —
changed-context content-read confinement), SCR-WP14-UX-003 (MODERATE —
ADR-023 tail amendment), SCR-WP14-UX-004 (MODERATE — secrets placement),
and SCR-WP14-UX-005 (MINOR — WP-14C "bundle" clarification) are closed by
this correction. Decisions A–D below include the corrected text.

## Context

The approved product UX baseline requires that routine structured
context/artifact transfer between ChatGPT, the project workspace, and Pi
happen without manual copy/paste, upload/download, or path transcription,
while preserving the authority model: persistence of a proposal artifact is
not lifecycle authority, and loading artifacts into Pi is context transfer,
not authorization. WP-14 (ChatGPT Web connectivity) must therefore include
a narrow ChatGPT-facing controlled-persistence path and a stateless
changed-context retrieval capability, and a new minimal package WP-14C must
own Pi-side zero-transfer artifact loading.

Principles:

- `Automate transfer, not authority.`
- `Zero-transfer, not necessarily zero-keystroke.`

## Decision A — ChatGPT Controlled Proposal Persistence

1. ChatGPT Web may persist exactly the existing WP-11-writeable
   prospective proposal kinds: `TaskSpec`, `AuthorityPolicy`,
   `ContextManifest`, `CompletionContract`.
2. Persistence must reuse the committed WP-11 controlled-write boundary
   (`src/writing/**`, WP-11 CLOSED). No WP-11 redesign is authorized; no
   later WP-11 slice is created; WP-14 composes the committed core.
3. No generic filesystem-write API exists or is introduced.
4. ChatGPT must never supply arbitrary: absolute paths, byte payloads
   outside the artifact contract, overwrite flags, file modes, shell
   operations, or trusted resolver/configuration evidence.
5. **Validation provenance — Model B (pinned):** the ChatGPT-facing
   persistence operation independently performs the required trusted
   structural and semantic validation at the persistence boundary before
   invoking WP-11. The remote request MUST NOT be trusted as a
   `ValidDraftProposalResult`. The remote caller MUST NOT establish
   validation provenance by supplying `ok`, `valid`, `canonicalUtf8`,
   digest/correlation assertions, a caller-constructed
   `ValidDraftProposalResult`, or a reference claiming prior validation.
   The persistence adapter may accept candidate artifact material
   according to its closed wire contract, but all caller material remains
   untrusted.
6. **Trusted host validation chain (at point of persistence):**

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
7. **No validation-state authority:** no opaque validation handles, no
   session validation state, no validation caches as authority.
   `draft-artifact` remains an independent in-memory drafting/
   self-validation UX surface; calling `draft-artifact` first is NOT a
   security prerequisite for persistence; if artifact material originated
   from `draft-artifact`, `persist-artifact` still independently validates
   it at the persistence boundary. The existing trusted validation
   composition is reused — no second validator is built.
8. Pinned invariant:

   > Schema limits WHAT ChatGPT may persist; WP-11 limits WHERE and HOW it
   > may persist.

9. Persisted project-visible artifacts remain proposals/untrusted content
   until the trusted-local lifecycle separately approves/issues them.
   Persistence does NOT approve, issue, grant, activate, execute, publish
   trusted lifecycle authority, or issue TrustedReceipt.

## Decision B — Changed-Context Retrieval

1. WP-14 owns a stateless ChatGPT-facing changed-context capability
   composed from existing WP-7/WP-9 controlled Git/file inspection
   (changed-file set, bounded Git status/diff, controlled file content on
   explicit narrow request).
2. **Content-read confinement (pinned):** the changed-context operation
   derives the current changed-file set from trusted, fresh WP-7 Git
   inspection. Any optional content read performed by this operation MUST
   be limited to a requested subset of that freshly resolved changed-file
   set. A caller MUST NOT nominate an unrelated workspace path and obtain
   its contents through the changed-context operation. For each requested
   content read: the path must belong to the fresh Git-derived changed
   set; ordinary workspace/read containment still applies independently;
   point-of-use membership/containment must be rechecked as required by
   existing WP-7 semantics; drift that invalidates membership fails
   closed; unreadable/out-of-scope/unsupported content fails through
   existing typed semantics; no silent partial success. If the user wants
   an unrelated authorized project file, that must use the
   already-existing appropriate inspection/read surface, not the
   changed-context operation. Bounded limits are preserved for:
   changed-file count, path/status metadata, diff bytes, and requested
   file-content bytes. Binary/unsupported-file behavior delegates to
   existing WP-7 semantics — no second content model is invented. No
   global filesystem snapshot transaction is required.
3. No `ActiveContext` lifecycle record, no `HotkeyRecord`, no persistent
   selection/event protocol, and no authority effect exist.
4. The short trigger/workflow (e.g., conceptually `@gateway changes`) is
   UX; actual state is re-read at point of use (fresh, bounded, redacted,
   fail-closed).

## Decision C — Pi Zero-Transfer Package Ownership

1. WP-14C owns Pi artifact loading. Loading resolves artifacts from
   controlled project state, validates them, and injects content using
   the existing Pi host-bridge/context boundary (WP-5A seam).
2. Loading creates no lifecycle authority.
3. **"Bundle" clarification (pinned):** the phrase "intended
   artifact/bundle" in the WP-14C contract refers to the future WP-14C
   resolution/loading semantics and does NOT imply that WP-14 may persist
   an `ExecutionBundle`. WP-14 persistence remains exactly `TaskSpec`,
   `AuthorityPolicy`, `ContextManifest`, `CompletionContract`. The exact
   Pi-side resolution/assembly semantics remain deferred to the WP-14C
   contract gate. No durable current-selection record is introduced.
4. The exact "current intended bundle" selection algorithm is deferred to
   the WP-14C contract decision. Explicitly: no durable selection record
   is assumed; host-configured explicit selection should be preferred
   where practical; a deterministic fallback may be considered during
   WP-14C contracting.
5. WP-14C executes after WP-14 and before WP-15 (roadmap order
   `WP-14 → WP-14C → WP-15`); WP-15 remains blocked until WP-14 and
   WP-14C are closed.

## Decision D — Secrets Placement

1. Tunnel/auth credentials are operator-local and owned by the external
   tunnel/platform.
2. Credentials MUST NOT be stored in project-visible artifacts; MUST NOT
   be committed to repository configuration; MUST NOT be fields in
   trusted Gateway workspace/runtime configuration; MUST NOT be accepted
   through Gateway MCP tool requests; MUST NOT be returned through
   Gateway MCP responses.
3. Gateway runtime configuration remains secret-free for WP-14.
4. External tunnel tooling may use its own operator-local credential
   store/environment according to that platform. WP-14 does NOT create
   secret-storage infrastructure.
5. Transport authentication remains distinct from Gateway
   protocol/lifecycle authority.

## Authority Separation

### ChatGPT

May: inspect; retrieve changed context; draft; validate; persist proposal
artifacts (controlled write only).

May NOT: approve; issue; grant; activate; execute; issue TrustedReceipt.

### Pi

May: load/consume validated project artifacts as context; execute only
when separately authorized by the existing trusted execution path
(WP-12 decisions, WP-13 execution).

Loading alone grants nothing.

## Rationale

The committed normative baseline already authorizes validated-draft
persistence (WP-0 Target Workflow, ADR-001, ADR-004); this ADR pins the
boundary for WP-14's controlled producer surfaces and records the
zero-transfer UX objective at decision level so later packages implement
against a stable contract. Composing existing committed boundaries
(WP-11 write, WP-7/WP-9 inspection, WP-5A injection seam) keeps the
authority model unchanged: transfer is automated, authority is not.

## Consequences

- The roadmap (`docs/design/post-wp5a-roadmap.md`) pins
  `WP-14 → WP-14C → WP-15` and the WP-14/WP-14C package contracts;
  the product scope document
  (`docs/design/project-gateway-scope-and-principles.md`) records the
  zero-transfer objective, principles, extended workflows, and feedback
  requirement; the WP-14 pre-implementation contract decision
  (`docs/reports/wp-14-pre-implementation-contract-decision.md`) carries
  the implementation-oriented slice contracts.
- The runtime MCP tool inventory (currently exactly seven tools,
  asserted by `tests/runtime/**` and `tests/mcp/unit/static-guard.test.ts`)
  will intentionally grow in WP-14A by one controlled proposal
  persistence operation and one changed-context inspection operation;
  historical seven-tool statements in closed-package reports remain
  historical.
- WP-14A's persistence adapter performs independent trusted
  validation-at-persistence (Model B): the remote request is never
  trusted as a `ValidDraftProposalResult`, and the validated draft
  handed to WP-11 is freshly host-produced.
- Changed-context content reads are confined to the freshly resolved
  Git-derived changed set; unrelated project files remain the domain of
  the existing inspection/read surfaces.
- Secrets placement is normative: WP-14 Gateway runtime configuration
  is secret-free; tunnel/auth credentials stay operator-local with the
  external tunnel/platform.
- WP-11, WP-12, WP-13, WP-5A/WP-5B contracts are unchanged. No lifecycle
  record class, role, or authority domain is added by this ADR.

## Rejected Alternatives

1. **ChatGPT Web drafting in-memory only (no persistence)** — superseded:
   contradicts the approved product requirement that ChatGPT persist
   schema-constrained artifacts into the configured workspace, and
   contradicts the committed WP-0/ADR-001/ADR-004 persistence boundary.
2. **A generic ChatGPT-facing filesystem write surface** — violates
   ADR-001/ADR-004 and the WP-11 controlled-write contract; rejected in
   favor of the artifact-oriented WP-11-backed operation.
3. **A durable `ActiveContext`/`HotkeyRecord` protocol for retrieval or
   triggers** — state is re-read at point of use; durable records for UX
   actions would fabricate lifecycle semantics; rejected.
4. **Folding Pi artifact loading into WP-14** — loading is a Pi-side
   consumer/UX concern, not ChatGPT connectivity; hotkey adjacency is not
   an architectural reason; WP-14C is separately roadmap-owned.
5. **Folding Pi artifact loading into WP-15** — WP-15 is hardening,
   release, and operational readiness; feature work violates its charter
   and closure gate.
6. **Trusting the remote request as validation provenance (Model A)** —
   accepting a caller-constructed `ValidDraftProposalResult` (or
   `ok`/`valid`/`canonicalUtf8`/digest assertions, or a reference
   claiming prior validation) would make untrusted remote content the
   source of validation provenance and would break the trusted
   validation boundary; Model B (independent validation at the
   persistence boundary) is selected instead.
