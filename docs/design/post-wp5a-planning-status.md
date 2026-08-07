# Post-WP-5A Planning Status and Open-Decision Dispositions

**Status:** Human-approved, authoritative, and closed (approval decision
date 2026-08-05; planning commit `97022a49d9029449f304a2b1e47f9dc8da4d4a89`;
accepted final review: POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED;
open findings at approval: zero). The human approval has been recorded in
ADR-023 through ADR-027 (all Accepted). The approval-recording mismatch
F-EL-A is closed. WP-6 has been implemented and closed
(`b07fea95d0a1ed20361dec441fc500766969536f`); the current work package is **WP-8-E — Audit, Registry Indexes, and
Recovery (read-only slice; contract §29 phase 4)**; WP-7 is **closed** at
`6b94d811dac8c41062ea4cbd57e56b1fe39b6419`. WP-7-A (foundation and contract
consolidation) is **closed**; WP-7-B (runtime implementation) is **closed**
at `7fa2b15c8bab8b373751affac08acc3e9225aba8` (WP-7 runtime implementation
is complete); WP-7-C (integration, full verification, and closure
preparation) was human-authorized — the senior closure review findings
(C-01…C-07) and the final focused closure rereview findings (Z-01…Z-05)
were all addressed, and the **final closure rereview accepted** WP-7-C with
**zero open findings**; WP-7-C is **closed** and WP-7 is **closed**, with
the closure baseline being the WP-7 closure commit
`6b94d811dac8c41062ea4cbd57e56b1fe39b6419`. WP-8-A (Foundation and
Contract Consolidation) is **human-authorized** as a **documentation-only
contract phase**; the authoritative WP-8 contract and foundation report
have been produced and corrected. The **senior contract review returned
corrections required** (W8A-C01…W8A-C13); the **first focused rereview
returned corrections required** (W8A-R01…W8A-R08); the **final focused
rereview returned corrections required — four MINOR findings**
(W8A-F01…W8A-F04); the **final documentation spot check found one
bounded MINOR finding** (empty `CSR-010` requirement body); the **final
micro spot check returned `WP-8-A FINAL MICRO SPOT CHECK: ACCEPTED`
with `OPEN FINDINGS: 0`**; the WP-8-A **contract is accepted**; the
**WP-8-A baseline commit** (subject `docs: establish WP-8-A contract
baseline`) is the commit containing this update; **WP-8-A is closed** at
the baseline commit `0965d668204540073b1346947db1c6193f9fd4dc`. WP-8-B
(Non-Mutating Format, Validation, and Determinism Foundation) is
**human-authorized**; the **WP-8-B non-mutating foundation implementation
is complete**; the **WP-8-B senior implementation review returned
corrections required** (one MODERATE finding W8B-C01 and three MINOR
findings W8B-C02…W8B-C04); the **focused implementation correction
closed all four findings**; the **focused implementation rereview
returned three MINOR findings (W8B-M01…W8B-M03)**; the **final micro
implementation correction closed all three**; the **final micro
implementation rereview returned `WP-8-B FINAL MICRO IMPLEMENTATION
REREVIEW: ACCEPTED` with `OPEN FINDINGS: 0`**; the **WP-8-B
implementation is accepted** and the **WP-8-B baseline commit** (subject
`feat: establish WP-8-B non-mutating foundation`) is the commit
containing this update; the **independent baseline-commit verification
accepted the WP-8-B baseline commit** and **WP-8-B is closed** at
`b83120475a4c66606ebb72d9346cf15f10c2f00d`; the **WP-8-C eligibility
and authorization analysis** found WP-8-C **eligible after the OD-001
human decision**; the **human decision closed OD-001** (explicit
control-plane locator only; no WP-8 host default; ADR-028; contract
Appendix G updated); the **WP-8-C authorization-envelope refinement**
produced the implementation-ready envelope; the **WP-8-C
pre-implementation decision baseline is documented**; the **senior
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
implementation is **not closed**. WP-9 and later
packages are **not authorized**. No push, release,
publication, installation, or deployment has occurred.

**WP-8-E (contract §29 phase 4 — audit, registry indexes, and recovery;
read-only slice) is implemented**: WP-8-D is **closed** at commit
`23a30b212dbe1f2ffa05e2b69314754730aeb222` (subject `docs: close WP-8-D
durable storage operations`); the **WP-8-E read-only registry and
recovery slice** is implemented under `src/storage/registry/` and
`src/storage/recovery/` (read-only store scan, closed 11-way candidate
classification, deterministic registry views, bounded recovery assessment,
advisory recovery plan; no mutation of any kind); the **static-guard and
global-security boundaries are extended** with exact module/API
allowlists; the **implementation report
(`docs/reports/wp-8e-registry-recovery-read-slice-implementation-report.md`)
is complete**; **WP-8-E is closed** at commit
`f3677e61c3ce048f9dde7ac7dc6de5ad8f2c9f8e`. **WP-8-F (authorized recovery
mutation foundation) is implemented**: authority-gated recovery mutation
(recovery capability + recovery-action provenance, zero production
producers); immediate descriptor-bound re-verification; safe WPR-023 (a)
orphan-temporary cleanup; the authorized **`quarantine-temporary`
operation** (ADR-030; contract §16.5, QRN-001…006) for WPR-023 (b)/(c)
regular temporaries with the deterministic quarantine destination,
hard-link plus unlink primitive, exact provisioning, no-overwrite and
idempotency states, durable evidence, recovery-scanner classification,
and a fixed 15-stage crash inventory; durable recovery evidence with
deterministic identity; deterministic already-completed idempotency;
exact static-guard/global-security extensions (three new fs owners; the
contract was extended with §16.5/QRN and its pinned SHA-256 updated).
Stale-lock breaking, deletion, WPR-023 (d) disposition, retention,
migration, index rebuild, WP-9, and WP-12 remain out of scope. The
**implementation report
(`docs/reports/wp-8f-recovery-mutation-foundation-implementation-report.md`)
is complete**; **WP-8-F is not yet closed** — implementation review
pending. **WP-8-G (audit reconstruction, contract §16.3, W8A-C11,
AUD-011/012, CSA-013/014) is implemented**: the third recovery operation
`audit-reconstruction` joins the recovery capability operation set
(`['orphan-removal', 'quarantine-temporary', 'audit-reconstruction']`);
verified durable store-records targets missing their write audit are
re-verified descriptor-bound and receive the contract's distinct
`recovery-audit-reconstruction` audit event (recovery action identity,
recovery-time timestamp, explicit gap marker, digest-bound target
reference; the original trusted action identity is verified and recorded
in the reconstruction evidence, never substituted into the event),
published through a dedicated exact-record permit (role
`reconstructed-recovery-audit`), followed by durable `StoreEvidenceRecord`
recovery evidence (`audit-reconstruction` operation; domain-separated
`PGAP-STORAGE-AUDIT-RECONSTRUCTION-EVIDENCE-v1` identity) and its
mechanical authorized-write audit; current-state audit/evidence
enumeration, deterministic idempotency and conflict states
(roll-forward, already-completed, evidence-without-audit integrity
failure, conflicting/contesting audits fail closed), scanner
classification of every interrupted and completed state, a fixed 12-stage
crash inventory, and exact static-guard/global-security extensions (no
new filesystem-bearing module). The work-package §5/§6 model (exact
`authorized-write` event with the original trusted action identity) was
not adopted: the human contract decision records that the existing WP-8
contract remains normative (§16.3/AUD-011/AUD-012/CSA-013/DS-28; distinct
`recovery-audit-reconstruction` event, recovery action identity,
recovery-time `createdAt`, explicit gap marker, original trusted action
identity evidence-only, no fabrication of the missing historical
`authorized-write`, no contract amendment required; the gap-marker
representation is accepted for the current storage model). Stale-lock
breaking, deletion, WPR-023
(d) disposition, retention, migration, index rebuild, WP-9, and WP-12
remain out of scope. The **implementation report
(`docs/reports/wp-8g-audit-reconstruction-implementation-report.md`)
is complete**. **WP-8-H (persistent registry index, rebuild, and stale
detection; ADR-031) is implemented**: the fourth recovery operation
`registry-index-rebuild` publishes one canonical immutable index snapshot
per derived state under `index/registry-index/<shard>/<indexId>.idx` — a
deterministic domain-separated identity binding (model version, verified
store/namespace identities, registry scan generation and surface token,
record/audit/observation roots, scan and index bounds, scan counters);
content is the complete verified registry-mode observation set with
bounded stat facts (freshness manifest), structure-level findings, and
scan facts; the opt-in registry fast path validates the index against the
current store (generation, surface, entry-set probe) and re-derives the
registry view purely from the stored observations (deep equivalence),
falling back to the authoritative scan on any invalidity; truncated
scans and unresolved continuations are rejected, every bound
(`indexRebuildWork`, new `indexBytes`) fails the build deterministically;
immutable no-replace publication through an exact-record
`RecoveryPublicationPermit` (role `registry-index`); the writer lock is
taken only for the publication phase with under-lock generation/surface/
probe rechecks (stale builds fail closed); deterministic stale detection
and recovery-scanner index-artifact classification with rebuild
recommendations; a fixed 8-stage crash inventory; one new read-only fs
owner. The contract gained the single normative `indexBytes` limit row
and its pinned SHA-256 was updated. Stale-lock breaking, deletion,
WPR-023 (d) disposition, retention, migration, index deletion/
disposition, WP-9, and WP-12 remain out of scope. The **implementation
report
(`docs/reports/wp-8h-persistent-registry-index-implementation-report.md`)
is complete**; **WP-8-F, WP-8-G, and WP-8-H are not yet closed** —
implementation review pending; WP-8 implementation is **not closed**.
WP-9 and later
packages are **not authorized**. No push, release, publication,
installation, or deployment has occurred. Each disposition
is one of RESOLVED (by this planning package or earlier closed packages),
DEFERRED WITH NON-BLOCKING RATIONALE, or STILL BLOCKING.

## WP-0 Deferred Decisions (project-gateway-scope-and-principles.md)

1. **Canonical artifact representation, digest calculation, revision
   identity, cross-artifact reference rules** — **RESOLVED** (WP-1…WP-3;
   committed).
2. **Complete field-level artifact semantics, JSON Schemas, validation
   error behavior** — **RESOLVED** (WP-1…WP-4; committed).
3. **Trusted local approver workflow, record retention, revocation
   propagation, activation UX** — **DEFERRED WITH NON-BLOCKING RATIONALE**:
   owned by WP-12 (approval/activation) and WP-8 (retention) in the adopted
   roadmap (ADR-023); no implementation before WP-12 begins; non-blocking
   for WP-6…WP-11.
4. **Concrete capability vocabulary and the trusted configuration format
   for global and workspace ceilings** — **RESOLVED (planning draft)**:
   vocabulary in `capability-vocabulary.md` (ADR-025); configuration
   contract in `trusted-workspace-and-ceiling-configuration.md`
   (ADR-024); implementation owner WP-6. Pending human approval of the
   planning package before any implementation.
5. **Execution-bundle issuance and runtime-grant lifecycle details** —
   **RESOLVED** (WP-2 protocol, WP-4 evaluation; committed).
6. **Adapter contracts, consumer capability-negotiation protocol,
   extension registry governance** — **PARTIALLY RESOLVED / DEFERRED WITH
   NON-BLOCKING RATIONALE**: WP-5A resolved the Pi adapter lane (ADR-020…
   022); remaining negotiation/registry items are owned by WP-5B (pi-guard
   lane, ADR-026) and WP-15 (extension governance hardening); non-blocking
   for WP-6…WP-12.
7. **Exact project-visible and trusted local directory layouts** —
   **DEFERRED WITH NON-BLOCKING RATIONALE**: owned by WP-8 (trusted-local
   layouts) and WP-7/WP-11 (project-visible layouts); non-blocking for
   WP-6.

## Sequencing Dispositions

- **WP-5B eligibility** — **STILL BLOCKING until closed**: WP-6 (ceilings,
  workspace identity) and WP-12 (activation decisions) are normative
  prerequisites (ADR-023); the pi-guard projection interface requires
  separate explicit authorization (ADR-026). These are open gates, not
  open design decisions of this package.
- **WP-6 eligibility** — **NOT BLOCKED by any open decision**: WP-6
  depends on WP-0…WP-4 and the planning contracts; no unresolved decision
  blocks it once the planning package is approved.

## Focused-Correction Dispositions (F-01…F-09)

- **F-01 (capability-set ceiling evaluator integration)** — CORRECTED.
  Owning document: `post-wp5a-roadmap.md` (evaluator-integration section),
  `trusted-workspace-and-ceiling-configuration.md`, ADR-024. Model A
  selected: WP-6 owns the reviewed Artifact Core point-of-use boundary
  extension (additive, versioned interface extension; numeric-only shape
  remains valid). Effect on WP-6 future eligibility: required closure item
  (WP-6 cannot close without the evaluator extension implemented and
  fixtures passing); does not block WP-6 start. Implementation remains
  unauthorized.
- **F-02 (timestamp/fingerprint canonicalization)** — CORRECTED. Owning
  document: ADR-027 and `pi-guard-compatibility-and-authority-projection.md`
  Part E. Model: `projectionIdentity` excludes timestamps/observations;
  `evidenceFingerprint` includes present timestamps and timestamp-source
  identifiers; canonicalization rules defined. Effect on WP-6 eligibility:
  none. Implementation remains unauthorized.
- **F-03 (pi-guard lane)** — CORRECTED. Owning document: ADR-026 and
  compatibility design Part A/B. Lane is exactly `pi-guard 0.1.1`; exact
  compatibility predicate defined; unverified versions fail closed.
  Effect: pi-guard lane remains a future implementation gate (WP-5B) but is
  no longer an undefined contract. Implementation remains unauthorized.
- **F-04 (tool inventory)** — CORRECTED. Owning document: ADR-026 and
  compatibility design Part B. `getAllTools`/`getActiveTools` contract,
  sampling points, drift rule, duplicate/collision and source-identity
  handling defined. Effect on WP-6 eligibility: none. Implementation
  remains unauthorized.
- **F-05 (roadmap attributes)** — CORRECTED. Owning document:
  `post-wp5a-roadmap.md` (per-package attribute definitions). All 11
  packages now carry objective, inputs, outputs, owned components,
  prohibited responsibilities, invariants, test categories, closure gate,
  non-goals. Effect: future eligibility reviews need no invented
  attributes. Implementation remains unauthorized.
- **F-06 (concurrent activation/restart)** — CORRECTED. Owning document:
  ADR-026 and compatibility design Part B/D. Single trusted owner;
  serialized/rejected concurrent activations; restart begins from host
  pre-activation state; no automatic reactivation from persisted evidence.
  Effect on WP-6 eligibility: none. Implementation remains unauthorized.
- **F-07 (numeric ceiling semantics)** — CORRECTED. Owning document:
  `trusted-workspace-and-ceiling-configuration.md`, ADR-024,
  `capability-vocabulary.md`. Domain, zero, missing, overflow, malformed,
  canonical form, intersection rules defined. Effect on WP-6 eligibility:
  closure item. Implementation remains unauthorized.
- **F-08 (TrustedReceipt owner)** — CORRECTED. Owning document:
  `post-wp5a-roadmap.md` ownership matrix and WP-13/WP-15 attribute blocks.
  Normative owner: WP-15; input provider: WP-13. Effect on WP-6
  eligibility: none. Implementation remains unauthorized.
- **F-09 (glossary terms)** — CORRECTED. Owning document:
  `docs/design/glossary.md` (Trusted Workspace Configuration, Enforcement
  Configuration, Compatibility Fingerprint). Effect on WP-6 eligibility:
  none.

## Final-Focused-Correction Dispositions (F-R1…F-R6)

- **F-R1 (MAJOR — Pi 0.83.0 tool-inventory observability).** CORRECTED.
  Authoritative document: `pi-guard-compatibility-and-authority-projection.md`
  Part B and ADR-026. Pi 0.83.0 observability is stated accurately (one
  effective `ToolInfo` per surviving name; name-keyed collapse before
  observation; first surviving registration; shadowed and settings-excluded
  registrations not observable; `sourceInfo` describes only the surviving
  effective registration). Project Gateway binds to the effective
  observable surface, never claims duplicate/shadowed/hidden detection, and
  records the accepted shadowing limitation with a non-blocking future
  hardening owner (WP-15). Effect on planning approval: none beyond this
  correction; effect on WP-6 eligibility: none. Implementation remains
  unauthorized.
- **F-R2 (MINOR — timestamp canonicalization).** CORRECTED. Authoritative
  document: ADR-027 and the evidence section. Accepted values, rejection
  rules, omission semantics, canonical serialization, and dual-implementation
  byte-identity are defined. Effect on WP-6 eligibility: none. Implementation
  remains unauthorized.
- **F-R3 (MINOR — idempotent replay identity).** CORRECTED. Authoritative
  document: ADR-026 and the activation/restart section. Replay requires
  exact match of plan, effective-authority, approval/activation-decision,
  RuntimeGrant (where separate), inventory, **compatibility**, projected
  enforcement-configuration, and target Pi session/surface identities;
  compatibility drift never qualifies. Effect on WP-6 eligibility: none.
  Implementation remains unauthorized.
- **F-R4 (MINOR — projectionIdentity unification).** CORRECTED.
  Authoritative document: evidence section (single canonical member set)
  and ADR-027; `projectionIdentity` added to the evidence field list; the
  Part D "projection result identity" now references the canonical
  definition with no separate member set. Effect on WP-6 eligibility: none.
  Implementation remains unauthorized.
- **F-R5 (MINOR — stale text).** CORRECTED. Authoritative documents:
  planning report (lane summary and glossary count) and roadmap (Model B
  residual removed from the WP-6 closure gate). Remaining `0.1.x`/Model B
  references are intentional, labeled, or rejected-alternative contexts.
  Effect on WP-6 eligibility: none. Implementation remains unauthorized.
- **F-R6 (MINOR — evaluator interface version).** CORRECTED. Authoritative
  document: ADR-024 (`PointOfUseInputs v2` with the twelve rules), with
  cross-references in the trusted-configuration design, capability
  vocabulary, roadmap, and report. Effect on WP-6 eligibility: closure item
  (v2 implementation and conformance migration); does not block WP-6 start.
  Implementation remains unauthorized.

## Final Two-Finding Dispositions (F-F1, F-F2)

- **F-F1 (MINOR — ADR-026 replay predicate and inventory framing).**
  CORRECTED. Authoritative document: ADR-026 (authoritative eight-identity
  idempotent-replay rule; decision-level Pi 0.83.0 inventory boundary with
  effective-surface binding, shadowing limitation, and WP-15 non-blocking
  hardening; cross-references the detailed design). No abbreviated replay
  predicate remains. Effect on planning approval: none; effect on WP-6
  eligibility: none. Implementation remains unauthorized.
- **F-F2 (MINOR — trusted extension set ownership).** CORRECTED.
  Authoritative documents: `trusted-workspace-and-ceiling-configuration.md`
  (`trustedExtensionSet` contract and trust rules), ADR-024 (ownership),
  roadmap (WP-6 owned contracts), and
  `pi-guard-compatibility-and-authority-projection.md` (single-owner
  binding; unowned alternative phrase removed). Trusted Workspace
  Configuration is the single owner; WP-6 implements; WP-5B consumes for
  Pi/pi-guard enforcement; WP-15 owns only optional hardening. Effect on
  planning approval: none; effect on WP-6 eligibility: closure item (WP-6
  cannot close without the trusted-extension-set contract); does not block
  WP-6 start. Implementation remains unauthorized.

## Eligibility-Prerequisite Correction Dispositions (F-EL-A, F-EL1…F-EL5)

- **F-EL-A (MAJOR — approval not recorded).** CLOSED. Authoritative
  documents: ADR-023…ADR-027 (status now Accepted, with approval evidence:
  external human decision 2026-08-05; planning commit
  `97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review
  POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
  approval: zero); roadmap and planning-status headers updated to record
  approval and closure; the planning report records the temporal sequence
  (human approval; initial planning commit; later status-recording
  correction). Effect: WP-6's normative prerequisite "planning
  authoritative and closed" is now satisfied as recorded. WP-6 remains
  pending a separate eligibility and implementation-authorization
  decision; implementation remains unauthorized.
- **F-EL1 (MINOR — workspace identity and root uniqueness).** CLOSED.
  Authoritative document: `trusted-workspace-and-ceiling-configuration.md`
  (duplicate workspace identifiers and duplicate/overlapping roots fail
  the entire configuration load; no first-wins/last-wins/merge/load-order
  or first-match/longest-prefix routing; symlink-resolved and case-folding
  overlap checked; v1 root-overlap prohibition). Effect on WP-6
  eligibility: contract precision satisfied. Implementation remains
  unauthorized.
- **F-EL2 (MINOR — non-existent paths and rename containment).** CLOSED.
  Authoritative document: `trusted-workspace-and-ceiling-configuration.md`
  (nearest-existing-ancestor resolution; validated lexical append; escape
  rejection; intermediate-symlink rejection; prospective decision with
  point-of-use revalidation by WP-7/WP-11; rename contained only when both
  endpoints are independently contained in the same workspace). Effect on
  WP-6 eligibility: contract precision satisfied. Implementation remains
  unauthorized.
- **F-EL3 (NOTE — host lane).** CLOSED. Authoritative document:
  `trusted-workspace-and-ceiling-configuration.md` and roadmap
  cross-reference (Linux; x86_64; POSIX; UTF-8; Node.js 22.x at the
  verified 22.23.2 lane; unverified lanes fail compatibility eligibility).
  Effect on WP-6 eligibility: test determinism satisfied. Implementation
  remains unauthorized.
- **F-EL4 (NOTE — classification).** CLOSED. Authoritative documents:
  `trusted-workspace-and-ceiling-configuration.md` and
  `artifact-responsibility-matrix.md` (trusted-local control-plane
  configuration object; not an Artifact Core aggregate, artifact kind,
  lifecycle/approval/grant record, ExecutionResult, or TrustedReceipt; no
  seventh aggregate, new kind, or WP-3 catalog change without a later
  explicit decision; local configuration schema outside the aggregate
  catalog). Effect on WP-6 eligibility: scope boundary satisfied.
  Implementation remains unauthorized.
- **F-EL5 (NOTE — runtime-input hardening).** CLOSED. Authoritative
  documents: `trusted-workspace-and-ceiling-configuration.md` (ten-point
  descriptor-derived snapshot invariant) and roadmap WP-6 block
  (hardening assignment). Effect on WP-6 eligibility: implementation
  invariant assigned. Implementation remains unauthorized.
- **F-EL-R1 (MINOR — status-header contradiction).** CLOSED. The three
  authoritative contract documents
  (`capability-vocabulary.md`, `pi-guard-compatibility-and-authority-projection.md`,
  `trusted-workspace-and-ceiling-configuration.md`) previously carried
  current, unlabeled `(Planning Draft)` H1 suffixes and
  `Planning draft — not approved` status blocks that contradicted the
  Accepted ADR-024/ADR-025/ADR-026 decisions and the human-approved,
  authoritative, closed planning package. Their H1 suffixes and status
  blocks now state `Accepted — human-approved and authoritative` with the
  same approval evidence already recorded by the governing ADRs (external
  human decision 2026-08-05; planning commit
  `97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review
  POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
  approval: zero). No contract semantics changed; implementation-scope
  caveats remain; no eligibility-prerequisite finding remains open
  according to the F-EL-R1 correction report. WP-6 remains unauthorized
  and not started; the separate pi-guard-side authorization remains
  pending.

## F-SEQ Dispositions

- **F-SEQ-1 (capability vocabulary + trusted ceiling format)** — RESOLVED
  in planning draft (ADR-024, ADR-025, vocabulary and configuration
  documents).
- **F-SEQ-2 (pi-guard compatibility contract)** — RESOLVED in planning
  draft (ADR-026; compatibility/projection/evidence contract document);
  pi-guard-side interface change remains a separately authorized item.
- **F-SEQ-3 (roadmap)** — RESOLVED in planning draft (ADR-023;
  `post-wp5a-roadmap.md`).

## Known Non-Blocking Limitations

- pi-guard 0.1.1 has no external authority-projection input API; the
  required interface is documented (ADR-026) and requires separate
  authorization — a deferred implementation item, not an unresolved
  architecture decision of this package.
- The v1 capability vocabulary is approved (ADR-025 Accepted); no
  implementation consumes it before a separate WP-6
  implementation-authorization decision.
