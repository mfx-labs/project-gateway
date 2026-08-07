# Post-WP-5A Work-Package Roadmap

**Status:** Human-approved and authoritative (approval decision date
2026-08-05; planning commit `97022a49d9029449f304a2b1e47f9dc8da4d4a89`;
accepted final review: POST-WP-5A FINAL DOCUMENTATION SPOT CHECK:
ACCEPTED; open findings at approval: zero). ADR-023 through ADR-027 are
Accepted. The planning package is authoritative and closed. WP-6 has been
implemented and closed (`b07fea95d0a1ed20361dec441fc500766969536f`). WP-7
(Controlled project reader, Git inspection, and internal discovery (FFF)) was
the current work package; WP-7 is **closed** at
`6b94d811dac8c41062ea4cbd57e56b1fe39b6419`. Historical
chronology (preserved): WP-7-A (foundation and contract consolidation) was
human-authorized, completed, and is **closed**; WP-7-B (runtime
implementation) was human-authorized and completed at
`7fa2b15c8bab8b373751affac08acc3e9225aba8` and is **closed** — the WP-7
runtime implementation is complete. Current state: WP-7-C (integration,
full verification, and closure preparation) was human-authorized; the senior
closure review returned seven actionable findings (C-01…C-07), all
addressed; the final focused closure rereview identified a final zero-test
issue plus follow-on items (Z-01…Z-05), all addressed by the final
correction; the **final closure rereview accepted** WP-7-C with **zero open
findings**; WP-7-C is **closed** and WP-7 is **closed** at
`6b94d811dac8c41062ea4cbd57e56b1fe39b6419`. Current state: WP-8-F
(authorized recovery mutation foundation; contract §29 phase 4; see the
narrative below). Prior state: WP-8-A (Foundation and Contract
Consolidation) was **human-authorized** as a
**documentation-only contract phase** and is **closed**: the senior contract review required corrections
(W8A-C01…W8A-C13), the first focused rereview required additional
corrections (W8A-R01…W8A-R08), and the **final focused rereview found four
bounded MINOR documentation findings** (W8A-F01…W8A-F04); the **final
documentation spot check found one bounded MINOR finding** (empty
`CSR-010` requirement body); the **final micro spot check returned
`WP-8-A FINAL MICRO SPOT CHECK: ACCEPTED` with `OPEN FINDINGS: 0`**;
the **WP-8-A contract is accepted**; the **WP-8-A baseline commit**
(subject `docs: establish WP-8-A contract baseline`) is the commit
containing this update; the authoritative WP-8 contract and foundation
report have been produced and corrected. **WP-8-A is closed** at the
baseline commit `0965d668204540073b1346947db1c6193f9fd4dc`. Current
state: **WP-8-B (Non-Mutating Format, Validation, and Determinism
Foundation) is human-authorized**; its **non-mutating foundation
implementation is complete**; the **WP-8-B senior implementation review
returned corrections required** (one MODERATE finding W8B-C01 and three
MINOR findings W8B-C02…W8B-C04); the **focused implementation correction
closed all four findings**; the **focused implementation rereview
returned three MINOR findings (W8B-M01…W8B-M03)**; the **final micro
implementation correction closed all three**; the **final micro
implementation rereview returned `WP-8-B FINAL MICRO IMPLEMENTATION
REREVIEW: ACCEPTED` with `OPEN FINDINGS: 0`**; the **WP-8-B
implementation is accepted** and the **WP-8-B baseline commit** (subject
`feat: establish WP-8-B non-mutating foundation`) is the commit
containing this update; the **independent baseline-commit verification
accepted the WP-8-B baseline commit** and **WP-8-B is closed** at
`b83120475a4c66606ebb72d9346cf15f10c2f00d`. Current state: the
**WP-8-C eligibility and authorization analysis** found WP-8-C
**eligible after the OD-001 human decision**; the **human decision
closed OD-001** (explicit control-plane locator only; no WP-8 host
default; ADR-028; contract Appendix G updated); the **WP-8-C
authorization-envelope refinement** produced the implementation-ready
envelope; the **WP-8-C pre-implementation decision baseline is
documented** (ADR-028; decision-consolidation report); the **senior
decision-baseline review returned corrections required** (nine findings
W8C-D01…W8C-D09); the **focused decision-baseline correction closed all
nine**; the **focused decision-baseline rereview returned one remaining
MAJOR finding (W8C-D10), one dependent finding (W8C-D11), and three
MINOR findings (W8C-D12…W8C-D14)**; the **final micro decision-baseline
correction closed all five**; the **final micro decision-baseline
rereview and the final status micro spot check returned `WP-8-C FINAL
STATUS MICRO SPOT CHECK: ACCEPTED` with `OPEN FINDINGS: 0`**; the
**WP-8-C decision baseline is ACCEPTED** and the **WP-8-C
decision-baseline commit** (subject `docs: establish WP-8-C decision
baseline`) is the commit containing this update; **WP-8-C implementation
was human-authorized and is complete** (trusted root, provisioning, probe,
metadata bootstrap, trusted input, and initialization capability; the
production control-plane action-provenance producer is **not implemented**
and **production initialization is unreachable**); the **implementation is
not yet accepted**; the **focused security-test integration correction is
complete** (exact compiled-module delegation in the global no-I/O security
test; blanket storage exclusion not used; full default workflow
**1358/1358**); the **senior security implementation review returned
corrections required** (two MODERATE findings W8C-S01…S02 and four MINOR
findings W8C-S03…S06); the **focused security implementation correction
closed all six**; the **focused security implementation rereview found the
six findings functionally closed** and returned corrections required only
for **two MINOR evidence findings**; the **final security-evidence micro
correction closed both evidence findings**; the **final historical-evidence
label correction closed the remaining labeling inconsistency**; the **final
historical-evidence micro spot check returned `WP-8-C FINAL HISTORICAL-
EVIDENCE MICRO SPOT CHECK: ACCEPTED` with `OPEN FINDINGS: 0`**; the
**WP-8-C implementation is ACCEPTED** and the **WP-8-C implementation
baseline commit** (subject `feat: establish WP-8-C trusted storage
bootstrap`) is the commit containing this update; the
**WP-8-C independent implementation-commit verification is SKIPPED BY
HUMAN DIRECTION** (governance waiver; the WP-8-C commit is treated as the
operational baseline without independent verification); **WP-8-D
(Durable Single-Record Publication, Exact Reads, and Locking — Component
C / implementation Phase 3) is human-authorized as a documentation-only
decision-resolution phase**; the **WP-8-D senior pre-implementation
security and architecture review returned `ACCEPTED FOR DECISION
RESOLUTION`** (three bounded MINOR findings, no blockers); the **seven
human-approved decisions (D-2, D-3, D-5, D-6, D-7, D-8, D-12) are
selected and bound by
`docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md`**;
the **three MINOR findings are corrected** in the consolidation report
and the **decision-resolution report
(`docs/reports/wp-8d-decision-resolution-report.md`) is **complete**
(no contract revision required for WP-8-D; implementation envelope and
requirement allocation consolidated); the **senior decision-resolution
and ADR review returned corrections required (M-1…M-4)**; the **focused
decision-package correction applied M-1…M-4** and the current sub-phase
is **focused decision-package correction**; the **WP-8-D focused
decision-package rereview returned `WP-8-D FOCUSED DECISION-PACKAGE
REREVIEW: ACCEPTED`** (M-1…M-4 closed; implementation readiness granted);
**WP-8-D implementation was human-authorized and is complete** (durable
single-record publication, single-writer lock, exact read/verify/
enumeration, mechanical authorized-write audit, phase-3 classifier and
provisioning, crash-injection harness; production write publication
remains unreachable; the **implementation report
(`docs/reports/wp-8d-implementation-report.md`) is complete** with the
full verification evidence); the **senior implementation security and
architecture review returned corrections required** (three MINOR findings
MINOR-1 report counts, MINOR-2 classifier state-D fixed-entry
verification, MINOR-3 SCP-005 relative-import coverage); the **focused
implementation correction applied MINOR-1…MINOR-3** (report counts
corrected; classifier state-D descriptor verification of every fixed
entry; SCP-005 relative-import resolution and adversarial tests) and the
**correction report (`docs/reports/wp-8d-focused-implementation-correction-report.md`)
is complete** with the full verification evidence; the **focused
implementation rereview returned `WP-8-D FOCUSED IMPLEMENTATION
REREVIEW: ACCEPTED`** (MINOR-1…MINOR-3 closed; open findings zero;
implementation acceptance readiness granted); the **WP-8-D implementation
is HUMAN-ACCEPTED** and the **implementation acceptance and
commit-preparation report
(`docs/reports/wp-8d-implementation-acceptance-and-commit-preparation-report.md`)
records the acceptance**; the **WP-8-D implementation baseline commit
`29582bbb2c748be3c60179e19584092fceb1eaa8` (subject `feat: establish
WP-8-D durable storage operations`, parent `bd832606…`) was created and
is **independently verified** (commit metadata, exact 42-path inventory,
committed-blob manifest, no-drift audit, production-write unreachability,
and the full test battery); the **focused implementation rereview is
accepted with zero findings** and the **implementation baseline is
accepted**; the **post-commit baseline verification and closure report
(`docs/reports/wp-8d-post-commit-baseline-verification-and-closure-report.md`)
records the verification and prepares the closure documentation**;
**WP-8-D is closed** at commit
`23a30b212dbe1f2ffa05e2b69314754730aeb222` (subject `docs: close WP-8-D
durable storage operations`); **WP-8-E was implemented and accepted** at
commit `f3677e61c3ce048f9dde7ac7dc6de5ad8f2c9f8e` (subject `feat: add
WP-8-E registry recovery read slice`); the **next gate is the WP-8-F
implementation review**; WP-8
implementation is **not closed**; WP-9 and later
packages are **not authorized**. No release,
publication, installation, or deployment action has occurred for WP-8.

**WP-8-E (contract §29 phase 4 — audit, registry indexes, and recovery;
read-only slice) is implemented**: WP-8-D is **closed** at commit
`23a30b212dbe1f2ffa05e2b69314754730aeb222` (subject `docs: close WP-8-D
durable storage operations`); the **WP-8-E read-only registry and
recovery slice** is implemented under `src/storage/registry/` and
`src/storage/recovery/`: the read-only store scan over the contract-defined
record and audit class locations plus the tmp and locks surfaces; the
closed 11-way candidate classification on the accepted error vocabulary;
deterministic in-memory registry views over verified records; the bounded
recovery assessment; and the structured, deterministic, non-authoritative
advisory recovery plan; the **static-guard and global-security boundaries
are extended** with exact module/API allowlists (no blanket storage
delegation); the **implementation report
(`docs/reports/wp-8e-registry-recovery-read-slice-implementation-report.md`)
is complete** with the full verification evidence; the slice **performs no
mutation of any kind** (no quarantine, deletion, lock breaking, audit
publication, or capability minting); **retention and migration remain out
of scope**; **WP-8-E is closed** at commit
`f3677e61c3ce048f9dde7ac7dc6de5ad8f2c9f8e` (subject `feat: add WP-8-E
registry recovery read slice`); WP-8 implementation remains **not
closed**; WP-9 and later packages remain **not authorized**. No release,
publication, installation, or deployment action has occurred for WP-8.

**WP-8-F (contract §29 phase 4 — authorized recovery mutation
foundation) is implemented**: WP-8-E is **closed** at commit
`f3677e61c3ce048f9dde7ac7dc6de5ad8f2c9f8e` (subject `feat: add WP-8-E
registry recovery read slice`); the **WP-8-F recovery mutation
foundation** is implemented under `src/storage/recovery/` (execute,
reverify, cleanup, quarantine, evidence) plus the private recovery
capability and recovery-action-provenance authority domains: an
authority-gated recovery-mutation composition boundary with genuine
branded recovery capability and recovery-action provenance (zero
production producers); descriptor-bound immediate re-verification before
any mutation; safe WPR-023 (a) orphan-temporary cleanup; the authorized
**`quarantine-temporary` operation** (ADR-030; contract §16.5, QRN-001…
006): WPR-023 (b)/(c) regular temporaries moved by hard-link plus unlink
to the deterministic `quarantine/temporary/<shard>/<quarantineId>.qtn`
destination with exact provisioning, no-overwrite, idempotency and
collision states, durable `StoreEvidenceRecord` evidence and its
authorized-write audit, recovery-scanner classification of every
quarantine state (recovery-mode surface generation binds the quarantine
structure; registry mode excludes it), and a fixed 15-stage crash
inventory; deterministic already-completed idempotency; and exact
static-guard and global-security boundaries (three new fs owners,
exact allowlists, no blanket recovery delegation). **Not begun**:
stale-lock breaking, primary/audit deletion, WPR-023 (d) disposition,
retention, migration, index rebuild, WP-9 generation seeding, WP-12
integration. The **implementation report
(`docs/reports/wp-8f-recovery-mutation-foundation-implementation-report.md`)
is complete** with the verification evidence; the **next gate is the
WP-8-F implementation review**; **WP-8-F is not closed**; WP-8
implementation remains **not closed**; WP-9 and later packages remain
**not authorized**. No release, publication, installation, or deployment
action has occurred for WP-8.

**WP-8-G (contract §16.3 — authorized audit reconstruction) is
implemented**: WP-8-F remains at the same commit `1ee2016` (subject
`feat: add WP-8-F recovery mutation foundation`); the **WP-8-G audit
reconstruction slice** adds the third recovery operation
**`audit-reconstruction`** (recovery set: `orphan-removal`,
`quarantine-temporary`, `audit-reconstruction`): eligible verified
durable store-records targets missing their write audit are re-verified
descriptor-bound at their derived canonical location with exact
identity/digest/class/UID/mode/link-count and the original trusted action
identity verified from the durable envelope; the contract's distinct
**`recovery-audit-reconstruction`** audit event (16.3/AUD-011/012: trusted
recovery action identity, recovery-time timestamp, explicit gap marker,
digest-bound target reference) is derived mechanically and published
through a dedicated exact-record permit (role
`reconstructed-recovery-audit`; sink-level confinement preserved),
followed by durable `StoreEvidenceRecord` evidence (operation
`audit-reconstruction`, deterministic domain-separated identity
`PGAP-STORAGE-AUDIT-RECONSTRUCTION-EVIDENCE-v1`) and its mechanical
`authorized-write` audit; current-state audit/evidence enumeration, all
WP-8-G §9 idempotency/conflict states (normal reconstruction,
roll-forward, already-completed, evidence-without-audit integrity
failure, conflicting/contesting fail-closed, no repair-by-guessing),
recovery-scanner classification of every interrupted and completed
state, the fixed 12-stage crash inventory, and exact static-guard and
global-security boundaries (no new filesystem-bearing module). The
work-package §5/§6 model (exact `authorized-write` event with the
original trusted action identity) was not adopted: the human contract
decision records that the existing WP-8 contract remains normative
(§16.3/AUD-011/AUD-012/CSA-013/DS-28; distinct
`recovery-audit-reconstruction` event, recovery action identity,
recovery-time `createdAt`, explicit gap marker, original trusted action
identity evidence-only, no fabrication of the missing historical
`authorized-write`, no contract amendment required; the gap-marker
representation is accepted for the current storage model). **Not
begun**: stale-lock breaking, primary/audit deletion, WPR-023 (d)
disposition, retention, migration, index rebuild, WP-9 generation
seeding, WP-12 integration. The **implementation report
(`docs/reports/wp-8g-audit-reconstruction-implementation-report.md`) is
complete** with the verification evidence; the **next gate is the
WP-8-F/WP-8-G implementation review**; **WP-8-F and WP-8-G are not
closed**; WP-8 implementation remains **not closed**; WP-9 and later
packages remain **not authorized**. No release, publication,
installation, or deployment action has occurred for WP-8.

**Normative cross-references:** `project-gateway-scope-and-principles.md`
(WP-0), ADR-002, ADR-003, ADR-006, ADR-020, ADR-022, ADR-023 (sequencing
decision), ADR-024 (trusted configuration ownership), ADR-025 (capability
vocabulary), ADR-026 (pi-guard lane), ADR-027 (enforcement evidence),
`trusted-workspace-and-ceiling-configuration.md`,
`capability-vocabulary.md`, `pi-guard-compatibility-and-authority-projection.md`,
`post-wp5a-planning-status.md`.

## Work-Package Identifiers and Execution Order

Identifiers keep the established WP-5B…WP-15 naming. The **execution order**
is the authoritative ordering and is not numeric: WP-5B is executed after
the workspace/policy core and the control-plane packages because its trusted
authority inputs (ceilings, workspace identity, approval/activation state)
must have real producers before enforcement can be implemented or tested.

| Order | ID | Title | Normative prerequisites | Owned contracts | Closure gate |
|---|---|---|---|---|---|
| 1 | WP-6 | Trusted workspace and policy configuration core | WP-0…WP-4; ADR-024; ADR-025 | Global/workspace capability ceilings; **trusted extension set (`trustedExtensionSet`, F-F2)**; workspace identifier registry; workspace-root containment; trusted configuration load contract; fail-closed unknown-workspace handling; **reviewed Artifact Core point-of-use boundary extension for capability-set ceilings (Model A, F-01)** | Ceiling and workspace-config contracts implemented and tested; **capability ceilings evaluated by Artifact Core (Model A only); capability-version mismatch and unknown capabilities fail closed; new conformance fixtures/rules pass; numeric and capability ceilings proven orthogonal; WP-4 numeric-only behavior compatible or explicitly version-migrated under the `PointOfUseInputs v2` rules**; no repository content can alter governance |
| 2 | WP-7 | Controlled project reader, Git inspection, and internal discovery (FFF) | WP-6 | Bounded read-only project/Git inspection; internal discovery surface (FFF remains internal, never a public MCP or security boundary) | Read-only guarantees tested; no mutation capability |
| 3 | WP-8 | Local storage and registry | WP-6, WP-7 | Trusted-local persistence for lifecycle records, approvals, grants, receipts, audit events (ADR-002 persistence requirement); trusted-local directory layouts | Durable, crash-safe, path-contained storage; repository cannot forge stored state |
| 4 | WP-9 | MCP inspection surface | WP-7, WP-4 | Read-only MCP tools for inspection (artifacts, registry views, validation) | Inspection-only; no mutation tools |
| 5 | WP-10 | Artifact drafting tools | WP-4, WP-6, WP-7 | Draft-proposal creation for TaskSpec/AuthorityPolicy/ContextManifest/CompletionContract/ExecutionBundle (WP-1 producer boundary: ChatGPT Web MAY create validated drafts) | Drafts validate but never self-approve |
| 6 | WP-11 | Controlled structured artifact writing | WP-6, WP-7, WP-10 | Workspace-contained writes of validated drafts under workspace-root containment | Writes confined to configured workspace roots; no lifecycle authority |
| 7 | WP-12 | Local approval and execution control plane | WP-4, WP-6, WP-8 | Approval, issuance, revocation, RuntimeGrant, activation decisions, authoritative records, execution orchestration decisions (ADR-002) | All lifecycle decisions external to repository content; fail closed on missing state |
| 8 | WP-5B | pi-guard authority projection and enforcement integration | WP-5A, WP-6, WP-12, ADR-026, ADR-027 | Tool-inventory inspection (Pi 0.83.0 `getAllTools`/`getActiveTools` contract); authority projection into pi-guard; enforcement configuration output; pi-guard activation/restoration (single trusted owner; concurrent-activation and restart rules); enforcement evidence (projection/activation) | Effective authority enforced without inventing any authority operand; no partial activation on failure; inventory drift fails closed; unverified pi-guard versions fail closed; concurrent activations serialized/rejected; restart requires fresh activation decision and projection |
| 9 | WP-13 | End-to-end Pi execution integration | WP-5B, WP-12, WP-7, WP-11 | Orchestrated execution consuming plan + enforcement + observations; completion evaluation producing ExecutionResult | End-to-end execution with enforcement and retrospective results |
| 10 | WP-14 | Tunnel and ChatGPT Web connectivity | WP-13, WP-9 | ChatGPT Web draft/review connectivity per WP-1 ownership boundary | No lifecycle authority flows through connectivity |
| 11 | WP-15 | Security hardening, release, and operational readiness | All prior | Hardening review, release packaging, operational runbooks, final audit | Release gate passed; no open security findings |

## WP-5B Placement Decision

Selected option: **C — WP-5A → WP-6 → control-plane packages (WP-7…WP-12) → WP-5B → WP-13** (recorded in ADR-023).

Rationale (each dependency edge):

- **WP-5A → WP-6:** no direct dependency (WP-6 depends only on WP-0…WP-4 and
  the planning contracts); WP-6 may begin immediately after approval of this
  package. WP-6 is intentionally **not** Pi-specific.
- **WP-6 → WP-5B (normative):** WP-5B maps effective authority into guard
  modes. Effective authority includes the global and workspace capability
  ceilings (ADR-003: `AuthorityPolicy` may narrow only within trusted
  ceilings). WP-6 owns the capability-vocabulary-grounded ceiling
  configuration and workspace identity. WP-5B must not invent capability
  vocabulary, ceiling semantics, or workspace identity (F-SEQ-1 closure).
- **WP-12 → WP-5B (normative):** activation of an execution is a trusted
  local control-plane decision (ADR-002). WP-5B activates pi-guard only for
  an execution whose activation decision and applicable RuntimeGrant come
  from the control plane. WP-5B must not invent approval state or RuntimeGrant
  semantics (F-SEQ-1 closure, invariant 3).
- **WP-5B → WP-13 (normative):** end-to-end execution integrates enforcement
  as one stage; WP-13 also owns completion evaluation (ExecutionResult) and
  trusted receipt separation.
- **WP-8 → WP-12:** control-plane persistence (ADR-002 l.42) requires the
  local storage and registry package.
- **WP-7 → WP-9, WP-10 → WP-11:** reader/inspection first, then drafting,
  then controlled writing (writes confined by WP-6 containment).
- **WP-13 → WP-14:** ChatGPT Web connectivity composes execution; drafts
  remain producer-owned per WP-1.
- **WP-15:** final hardening/release consumes every prior package.

No circular dependencies exist: every edge points from an earlier execution
order to a later one.

## Capability-Ceiling Evaluator Integration (F-01, Model A)

Artifact Core remains the only authoritative effective-authority evaluator.
WP-6 owns a narrowly scoped, reviewed **extension of the Artifact Core
point-of-use boundary** to introduce capability-set global and workspace
ceilings:

- the **`PointOfUseInputs v2`** interface (F-R6): optional
  `globalCapabilityCeiling` / `workspaceCapabilityCeiling` inputs on
  `PointOfUseInputs` / `EffectiveAuthorityInputs` (capability-set +
  vocabulary version binding), with the numeric-only `v1` shape as the
  legacy compatibility shape;
- capability-version compatibility checks (mismatch fails closed);
- deterministic capability-set canonicalization (sorted, deduplicated);
- effective-authority intersection including capability ceilings
  (deny wins; unknown denied);
- new fail-closed findings for missing/malformed/unknown ceiling entries;
- conformance fixtures, rules (AUT-*), and digest/semantic vectors;
- backward compatibility under the F-R6 constraints: the numeric-only `v1`
  shape remains the legacy compatibility shape; the capability-set fields
  are an **additive, versioned interface extension** (`PointOfUseInputs
  v2`, not a replacement); configured capability ceilings cannot be omitted
  from production evaluation (omission is a fail-closed input-correlation
  error); the `v1` shape is usable only on explicitly identified
  legacy/test compatibility paths with no configured ceiling and an
  explicit consumer declaration; mixed interface versions fail closed
  unless a reviewed conversion rule exists; canonical evaluation-input
  identities include the interface version; a declared capability-set
  ceiling with an unknown capability or vocabulary version fails closed.

Evaluation order (normative): (1) capability authorization by the five-set
intersection; (2) numeric ceilings further narrow already-authorized
actions; (3) numeric ceilings never grant a capability; (4) capability
presence never bypasses numeric limits. WP-5B consumes the validated
`EligibilityReport` and never recomputes the intersection (see
`pi-guard-compatibility-and-authority-projection.md` Part C). Model B (a
separately owned pre-evaluator trusted boundary filter) is rejected: it
would duplicate authority semantics outside Artifact Core.

## Work-Package Attribute Definitions

Each package below states objective, input contracts, output contracts,
owned components, prohibited responsibilities, security invariants,
expected test categories, and non-goals; normative prerequisites and
closure gates are in the overview table. Full contract definitions live in
the cross-referenced documents and are not repeated here.

**WP-6 — Trusted workspace and policy configuration core.** Objective:
provide trusted global/workspace capability ceilings, workspace identity
registry, root containment, and the Model A Artifact Core evaluator
extension (F-01). Inputs: WP-0…WP-4 contracts; ADR-024/025 vocabulary and
configuration contracts; trusted local configuration (external to
repository). Outputs: validated ceiling/workspace configuration contract;
the versioned `trustedExtensionSet` contract (F-F2); extended
`PointOfUseInputs`/`EffectiveAuthorityInputs`; new AUT-* findings
and conformance fixtures/vectors. Owned: configuration boundary, capability
ceiling representations, the trusted extension set, evaluator extension.
Supported lane: Linux x86_64, POSIX filesystem semantics, UTF-8, Node.js
22.x (F-EL3; see `trusted-workspace-and-ceiling-configuration.md`).
Hardening: WP-6 adopts the descriptor-derived snapshot input-hardening
invariant for runtime configuration objects (F-EL5). Prohibited: approval,
tool inventory, MCP exposure, pi-guard activation, execution, lifecycle
issuance. Invariants: repository content cannot alter governance; unknown
workspace/capability fails closed; ceilings narrow only. Tests: config
loading/containment/symlink matrices; evaluator intersection and
version-mismatch matrices; conformance fixtures/vectors; WP-4 numeric-only
regression. Non-goals: no pi-guard interface, no execution, no approval
state.

**WP-7 — Controlled project reader, Git inspection, and internal
discovery (FFF).** Objective: bounded read-only project/Git inspection and
internal discovery. Inputs: WP-6 workspace containment contract.
Outputs: read-only inspection surface; internal discovery (FFF) results.
Owned: controlled reads, Git inspection, internal discovery. Prohibited:
writes, policy authority, mutation. Invariants: FFF remains internal, never
a public MCP or security boundary; read-only guarantees hold under hostile
paths. Tests: path containment, symlink/traversal, Git read-only
guarantees. Non-goals: no writes, no execution, no policy evaluation.

**WP-8 — Local storage and registry.** Objective: trusted-local
persistence for lifecycle records, approvals, grants, receipts, audit
events (ADR-002), and trusted-local directory layouts. Inputs: WP-6
configuration, WP-7 discovery. Outputs: durable registry/storage contract.
Owned: storage and registry persistence. Prohibited: authority issuance,
execution. Invariants: repository cannot forge stored state; crash-safe,
path-contained. Tests: durability, crash, path containment, tamper
detection. Non-goals: no lifecycle decisions, no execution.

**WP-9 — MCP inspection surface.** Objective: inspection-only MCP tools.
Inputs: WP-7 reader, WP-4 validation. Outputs: read-only MCP inspection
tools (artifacts, registry views, validation). Owned: inspection surface.
Prohibited: drafting, writes, execution. Invariants: inspection-only; no
mutation capability. Tests: tool-surface read-only audits. Non-goals: no
mutation tools, no drafting.

**WP-10 — Artifact drafting tools.** Objective: draft-proposal creation
for the six artifact kinds (WP-1 producer boundary). Inputs: WP-4
validation, WP-6 workspace config, WP-7 reader. Outputs: validated draft
proposals. Owned: draft creation. Prohibited: persistence, approval,
issuance. Invariants: drafts never self-approve. Tests: draft validation
boundaries. Non-goals: no lifecycle authority, no writing beyond drafts.

**WP-11 — Controlled structured artifact writing.** Objective:
workspace-contained writes of validated drafts. Inputs: WP-10 drafts,
WP-6 containment, WP-7 reader. Outputs: contained artifact files. Owned:
controlled writes. Prohibited: approval, execution. Invariants: writes
confined to configured roots; no lifecycle authority. Tests: containment,
path-escape, symlink matrices. Non-goals: no approval, no execution, no
governance mutation.

**WP-12 — Local approval and execution control plane.** Objective:
approval, issuance, revocation, RuntimeGrant, activation decisions,
authoritative records, and execution authorization (ADR-002). Inputs:
WP-4 eligibility evaluation, WP-6 ceilings, WP-8 persistence. Outputs:
lifecycle records and activation decisions. Owned: approval state,
lifecycle issuance, activation decisions, execution authorization. It does
not itself activate pi-guard (WP-5B) and does not execute Pi (WP-13).
Prohibited: repository-driven decisions. Invariants: all lifecycle state
external to repository content; fail closed on missing state. Tests:
decision-boundary, fail-closed, record integrity. Non-goals: no pi-guard
activation, no Pi execution.

**WP-5B — pi-guard authority projection and enforcement integration.**
Objective: observe and bind only to the effective Pi tool surface (F-R1),
project effective authority into a pi-guard enforcement configuration,
activate/restore enforcement under the idempotent-replay identity rule
(F-R3), and emit enforcement evidence (ADR-026/027; Parts B–E of
`pi-guard-compatibility-and-authority-projection.md`). Inputs: validated
WP-5A plan; ceilings (WP-6); approved policy; RuntimeGrant and activation
decision (WP-12); consumer support; observed tool surface; compatibility
result. Outputs: enforcement configuration, activation/restoration
outcomes, `PiEnforcementEvidence`. Owned: projection, compatibility,
activation/restoration (single trusted owner; concurrent-activation and
restart rules per F-06), enforcement evidence. Prohibited: approval,
execution, recomputing the authority intersection. Invariants: unknown
tools denied; unsupported required capabilities fail closed; no partial
activation; inventory drift fails closed; unverified pi-guard versions
fail closed. Tests: projection matrices, inventory sampling/drift/
collision matrices, activation/restoration matrices, evidence
canonicalization. Non-goals: no authority evaluation, no execution, no
receipt issuance.

**WP-13 — End-to-end Pi execution integration.** Objective: orchestrated
Pi execution consuming plan + enforcement + observations, with completion
evaluation. Inputs: WP-5B enforcement, WP-12 orchestration decisions,
WP-7/WP-11 task inputs. Outputs: `ExecutionResult` (retrospective);
retrospective facts for trusted-receipt inputs (WP-15). Owned: end-to-end
execution, result collection. Prohibited: issuing TrustedReceipt (WP-15
owns), self-approval. Invariants: result/receipt separation;
observation never proves authorization. Tests: end-to-end execution,
result provenance. Non-goals: no receipt issuance, no authority creation.

**WP-14 — Tunnel and ChatGPT Web connectivity.** Objective: ChatGPT Web
draft/review connectivity per the WP-1 producer boundary. Inputs: WP-13
execution results, WP-9 inspection surface. Outputs: connectivity for
drafts/reviews. Owned: tunnel/ChatGPT Web connectivity. Prohibited:
widening authority. Invariants: no lifecycle authority flows through
connectivity. Tests: connectivity isolation. Non-goals: no governance,
no execution.

**WP-15 — Security hardening, release, and operational readiness.**
Objective: hardening review, release packaging, operational runbooks,
final audit, the separate trusted receipt component (F-08), and optional
uncollapsed registration-visibility hardening for the Pi/pi-guard host
compatibility surface (F-R1, non-blocking future deliverable).
Inputs: all prior packages; WP-13 retrospective facts. Outputs: release
gate, trusted receipts (normative owner). Owned: hardening, operations,
release, trusted receipt issuance. Prohibited: self-issuing receipts from
execution code. Invariants: TrustedReceipt separate from ExecutionResult;
receipts issued only after WP-15 trust checks. Tests: security audit,
receipt trust checks. Non-goals: no execution, no authority.

## Decision and Ownership Matrix (Deliverable 7)

| Item | Owning work package | Authoritative data source | Trust level | Repository content may influence it? | Prospective/retrospective |
|---|---|---|---|---|---|
| Global capability ceiling | WP-6 (config core) | Trusted local configuration (external to repository); evaluated by Artifact Core via the WP-6-owned boundary extension | Trusted-local | No | Prospective |
| Workspace capability ceiling | WP-6 | Trusted local configuration; evaluated by Artifact Core via the WP-6-owned boundary extension | Trusted-local | No | Prospective |
| Workspace configuration (IDs, roots) | WP-6 | Trusted local configuration | Trusted-local | No | Prospective |
| Capability vocabulary | Planning package (ADR-025); maintained by Artifact Core | Canonical vocabulary document + core validation | Protocol | Only via reviewed core changes | Prospective |
| Approved AuthorityPolicy | Control plane (WP-12) approves; WP-1/WP-4 validate | Validated artifact + approval record | Trusted lifecycle | Only as validated artifact proposals | Prospective |
| RuntimeGrant | Control plane (WP-12) issues; WP-2/WP-4 represent | Lifecycle record | Trusted lifecycle | No | Prospective |
| Consumer support declaration | Consumer (caller boundary); WP-4 contract | `ConsumerSupportDeclaration` | Caller-supplied, validated | No | Prospective |
| Effective-authority evaluation | Artifact Core (WP-4), extended by WP-6 under Model A (F-01) | `evaluatePointOfUseEligibility` / `EffectiveAuthorityInputs` | Protocol | No | Prospective |
| Capability-version validation | Artifact Core (WP-4), extended by WP-6 (Model A) | Vocabulary version binding in evaluation inputs | Protocol | No | Prospective |
| Numeric action ceilings | Artifact Core (WP-4) | `globalActionCeiling` / `workspaceActionCeiling` | Protocol | No | Prospective |
| Evaluator protocol changes (capability-set ceiling inputs) | WP-6 (Model A) | Reviewed Artifact Core boundary extension | Protocol | Only via reviewed core changes | Prospective |
| Tool inventory | WP-5B (reads Pi/pi-guard surface) | Pi/pi-guard runtime | Observed, untrusted | No | Present-state |
| Authority projection | WP-5B | Plan + evaluated eligibility + ceilings + tool surface | Derived | No | Prospective |
| pi-guard activation | WP-5B (driven by WP-12 activation decision) | Activation decision + projection | Derived | No | Prospective |
| Enforcement evidence | WP-5B | Projection/activation outcomes | Observational | No | Prospective/contemporaneous |
| Approval state | Control plane (WP-12) | Trusted-local lifecycle records (WP-8) | Trusted lifecycle | No | Retrospective |
| Execution orchestration | WP-12 (decisions), WP-13 (execution) | Control-plane state + plan | Trusted lifecycle | No | Prospective |
| Result evaluation (ExecutionResult) | WP-13 completion evaluator | Observed execution | Observational | No | Retrospective |
| Trusted receipt issuance | **WP-15 (normative owner**; input provider: WP-13 retrospective facts) | Trusted receipts | Trusted-local | No | Retrospective |

## Prohibited Responsibilities (roadmap-wide)

No listed package may: approve its own output; issue lifecycle records or
RuntimeGrant records outside its assigned owner; modify pi-guard without a
separate explicit authorization (see ADR-026); activate pi-guard without a
control-plane activation decision; execute Pi or project tools outside WP-13
scope; mutate Git outside explicitly assigned mutation capabilities
(WP-11 controlled writes; otherwise read-only); load arbitrary shell
commands; expose arbitrary filesystem roots; trust repository governance
files; or treat observations as enforcement proof.

## Invariants Preserved

Artifacts never self-authorize; approval state stays external to artifacts;
RuntimeGrant stays external runtime authority; the repository cannot widen
trusted governance; pi-guard is an enforcement consumer, never an authority
issuer; WP-5A plans remain projections, never grants; tool observation never
implies tool permission; CompletionContract never grants authority;
ExecutionResult stays retrospective; TrustedReceipt stays separate and
trusted; unknown semantics are denied; unsupported required semantics fail
closed; deny wins; no partial activation after projection failure; effective
authority never exceeds any input operand; ChatGPT sees workspace
identifiers, never trusted filesystem roots; FFF remains internal discovery,
never a public MCP or security boundary.
