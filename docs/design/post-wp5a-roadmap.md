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

**Current state (WP-13 pre-implementation contract decision; recorded
2026-08-10):** WP-11 is **CLOSED** (`9695c5d8a5f42404884f11c02c493ed56d6f9e72`,
`feat: close WP-11 controlled artifact writing slice 1`); WP-12 is
**CLOSED** (`164b8a04d05cb03c733fa1cef7f489e189e3c3be`, `feat: close
WP-12 local approval and execution control plane`); WP-5B is **CLOSED**
(`1067d5c6f9161b3d04443b0bdc73c5c80eda9253`, `feat: complete WP-5B Pi
enforcement integration` — the current HEAD; the WP-5B closure record
states the downstream WP-13 dependency is satisfied). The current phase is
the **WP-13 pre-implementation contract decision**
(`docs/reports/wp-13-pre-implementation-contract-decision.md`; ADR-038),
which resolves the three WP-13-owned contract decisions (completion
evaluator / ExecutionResult publication path; retry / attempt-ordering
rule; WP-13 → WP-15 retrospective facts) and establishes the WP-13
contract baseline. WP-13 implementation is **NOT AUTHORIZED**. WP-14 and
WP-15 remain **blocked** behind WP-13 (roadmap order; WP-15 also requires
WP-14). This current-state note supersedes earlier "current work package"
statements in the historical chronology below; historical records are
preserved.

**Current state (WP-13 closure; recorded 2026-08-11):** WP-13 is
**CLOSED** — the roadmap closure criterion *"End-to-end execution with
enforcement and retrospective results"* is **SATISFIED** (final closure
review: `WP-13 FINAL CLOSURE REVIEW ACCEPTED — READY FOR WP-13 CLOSURE
COMMIT`; closure report
`docs/reports/wp-13-closure-report.md`). WP-13A, WP-13B, WP-13C, durability
S1/S2/S3/S4, and the retrospective simplification amendment are all
**CLOSED**. **WP-14 becomes the next roadmap-eligible package** (human
implementation authorization still required before work begins).
**WP-15 remains blocked** by remaining roadmap prerequisites (roadmap
order; WP-15 also requires WP-14). This current-state note supersedes the
2026-08-10 note above and earlier "current work package" statements in the
historical chronology; historical records are preserved.

**Current state (WP-14 product UX alignment; recorded 2026-08-12 with the
WP-14 contract amendment):** the human-approved product UX baseline —
zero-transfer context/artifact movement between ChatGPT, the project
workspace, and Pi — is recorded in ADR-040 (WP-14 zero-transfer product
boundary) and the WP-14 pre-implementation contract decision
(`docs/reports/wp-14-pre-implementation-contract-decision.md`). The
remaining execution order is pinned as **WP-14 → WP-14C → WP-15**: WP-14
(ChatGPT Web connectivity, WP-11-backed controlled proposal persistence,
and stateless changed-context retrieval) remains the next
roadmap-eligible package; **WP-14C (Pi zero-transfer artifact loading) is
approved as a new minimal roadmap package** executing after WP-14 and
before WP-15; **WP-15 remains blocked** until WP-14 and WP-14C are
closed. **WP-14A, WP-14B, and WP-14C are NOT STARTED and NOT AUTHORIZED**
(human implementation authorization is still required before any
implementation work begins). The focused contract review returned
`WP-14 PRODUCT UX FOCUSED CONTRACT REVIEW CORRECTIONS REQUIRED`; the five
findings SCR-WP14-UX-001…005 are CLOSED by the focused correction
(ADR-040 correction record; WP-14 pre-implementation contract decision
§13; amendment report). This current-state note supersedes the
2026-08-11 note above and earlier "current work package" statements in the
historical chronology; historical records are preserved.

**Current state (WP-14 closure; recorded 2026-08-12 with the WP-14
closure commit):** **WP-14 is CLOSED** (closure report
`docs/reports/wp-14-closure-report.md`; roadmap criterion "ChatGPT Web
reaches Gateway surfaces via tunnel; can inspect project state, create +
validate + persist a supported proposal artifact through controlled
write, and retrieve changed project context without manual paste/upload;
no lifecycle authority flows through connectivity; fail-closed; no
generic filesystem-write surface" SATISFIED via scripted
tunnel-conformance evidence; live ChatGPT/tunnel smoke unavailable and
not fabricated). WP-14A CLOSED (baseline `d955394…`); WP-14B CLOSED
(integration and end-user validation; E2E evidence). **WP-14C (Pi
zero-transfer artifact loading) is now ELIGIBLE FOR HUMAN CONTRACT /
IMPLEMENTATION AUTHORIZATION** according to its own gate (bundle-
selection semantics deferred to its own contract decision; NOT STARTED /
NOT AUTHORIZED here). **WP-15 remains BLOCKED** until WP-14 and WP-14C
are closed (roadmap order `WP-14 → WP-14C → WP-15`). This current-state
note supersedes the 2026-08-12 WP-14 product UX alignment note above and
earlier "current work package" statements in the historical chronology;
historical records are preserved.

**Current state (WP-14C contract baseline; recorded 2026-08-12 with the
WP-14C pre-implementation contract decision):** **WP-14 is CLOSED.** The
**WP-14C contract is ESTABLISHED** at documentation level
(`docs/reports/wp-14c-pre-implementation-contract-decision.md`; human-
approved architecture decisions: Model C selection — explicit pins +
uniqueness-only fallback — and resolved proposal-set semantics). The
normative load unit is the **resolved proposal set** (non-empty subset of
TaskSpec/AuthorityPolicy/ContextManifest/CompletionContract; never an
ExecutionBundle; no ExecutionBundle construction or persistence).
Loading reuses the WP-5A host-bridge injection and committed render
primitives; it transfers context only and creates no lifecycle/execution
authority. **WP-14C implementation is NOT STARTED / NOT AUTHORIZED**
(explicit human implementation authorization required). **WP-15 remains
BLOCKED** until WP-14C closes (roadmap order `WP-14 → WP-14C → WP-15`).
This current-state note supersedes the WP-14 closure note above; historical
records are preserved.

**Current state (WP-14C closure; recorded with the WP-14C closure
commit):** **WP-14: CLOSED. WP-14C: CLOSED** (closure report
`docs/reports/wp-14c-closure-report.md`; `gateway-load` short Pi action
satisfies the WP-14C product requirement — resolve, controlled-read,
freshly validate, correlate, render, and inject the intended non-empty
resolved proposal set without copy/paste, upload/download, manual path
transcription, or a natural-language loading prompt — creating NO
lifecycle or execution authority; senior review corrections closed;
focused rereview and closure review accepted). **WP-15 is the next
roadmap package: ELIGIBLE FOR HUMAN PRE-IMPLEMENTATION / AUTHORIZATION
WORK** (roadmap order `WP-14 → WP-14C → WP-15`; prerequisite satisfied
by this closure). **WP-15 implementation remains NOT AUTHORIZED.** This
current-state note supersedes the WP-14C contract-baseline note above;
historical records are preserved.

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

**WP-8-H (contract §29 phase 4 — persistent registry index, rebuild,
and stale detection) is implemented**: WP-8-G remains at the same commit
`0a1d48c` (subject `feat: add WP-8-G audit reconstruction`); the
**WP-8-H persistent registry index slice** adds the fourth recovery
operation **`registry-index-rebuild`** (recovery set: `orphan-removal`,
`quarantine-temporary`, `audit-reconstruction`, `registry-index-rebuild`)
with one canonical immutable index snapshot per derived state under
`index/registry-index/<shard>/<indexId>.idx` (ADR-031; contract 5.2
`index/`, CSA-003/004, ITG-005, RGY-001/007): a deterministic domain-
separated identity binding (model version, verified store and namespace
identities, registry scan generation, registry surface generation,
record/audit/observation roots, scan bounds, index bounds, scan
counters); content is the complete verified registry-mode observation
set with bounded stat facts (the freshness manifest), structure-level
scan findings, and scan facts — the registry view is re-derived purely
from the stored observations, so the opt-in fast path and the
authoritative scan share one derivation; completeness invariants
(truncated scans and unresolved continuations are rejected; every bound
fails the build deterministically); immutable no-replace publication
through an exact-record `RecoveryPublicationPermit` (role
`registry-index`; sink-level confinement preserved); the writer lock is
taken only for the publication phase with an under-lock generation/
surface/entry-set-probe recheck (stale builds fail closed); deterministic
stale detection (missing/malformed/unsupported-version/stale-generation/
stale-surface/stale-record-set/stale-audit-state/conflicting/wrong-type/
wrong-UID-mode/foreign); recovery-scanner classification of index
artifacts with rebuild recommendations; a fixed 8-stage crash inventory;
and exact static-guard/global-security boundaries (one new read-only fs
owner, `registry/index-store.ts`). The contract gained the single
normative `indexBytes` limit row (ADR-031) and its pinned SHA-256 was
updated. **Not begun**: stale-lock breaking, primary/audit deletion,
WPR-023 (d) disposition, retention, migration, index deletion/
disposition, WP-9 generation seeding, WP-12 integration. The
**implementation report
(`docs/reports/wp-8h-persistent-registry-index-implementation-report.md`)
is complete** with the verification evidence; the **next gate is the
WP-8-F/WP-8-G/WP-8-H implementation review**; **WP-8-F, WP-8-G, and
WP-8-H are not closed**; WP-8 implementation remains **not closed**;
WP-9 and later packages remain **not authorized**. No release,
publication, installation, or deployment action has occurred for WP-8.

**WP-8-I (contract §16.6/§29 phase 4 — authorized external disposition)
is complete**: WP-8-H remains at the same commit `d3a0f22` (subject
`feat: add WP-8-H persistent registry index`); the **human contract
decision (ADR-032; contract §16.6/DPS-001…007) is implemented**: the
three class-specific disposition operations **`dispose-wpr023d-temporary`**
(ADJUDICATION-ONLY in the MVP: immediate re-verification, deterministic
`disposition-required`, no mutation, no evidence — preservation is the
default when durable facts cannot justify destruction),
**`dispose-quarantined-temporary`** (executable ONLY for the
`quarantine-malformed`/`foreign-entry`/`quarantine-conflict` regular
files with exact UID/mode/size/nlink/digest/observation bindings; the
wrong-type/wrong-UID-mode/unexpected-hard-link/valid/missing-evidence/
interrupted-link/directory/symlink/special states remain
adjudication-only), and **`dispose-conflicting-index`** (executable only
for the exact regular-file conflicting artifact at the deterministic
derived index identity; stale/current/unrelated-malformed/foreign index
objects, directories, symlinks, and recursive `index/` deletion are
prohibited; disposition never auto-triggers a rebuild). Executable
disposition uses the exact unlink-plus-directory-fsync primitive
(one new fs-bearing owner, `recovery/disposition.ts`), durable
`StoreEvidenceRecord` evidence with the EXISTING `recovery-evidence`
kind (no new evidence kind) and per-operation domain-separated
identities (`PGAP-STORAGE-QUARANTINE-DISPOSITION-EVIDENCE-v1`,
`PGAP-STORAGE-INDEX-DISPOSITION-EVIDENCE-v1`), the full 22-step
re-verification/mutation sequence under the single-writer lock, the §8
idempotency table (already-completed only with matching evidence;
target-absent-without-evidence, evidence-with-live-target, changed
classification/digest/inode, and conflicting evidence fail closed; no
repair-by-guessing), a fixed 12-stage executable crash inventory
(exercised for quarantine and index) alongside the 5-stage WPR-023 (d)
adjudication inventory, scanner `dispositionStates` classification
(completed / conflicting / dangling disposition evidence), exact
operation naming in advisory plan actions, and exact
static-guard/global-security boundaries (no generic disposition/deletion
authority; evidence publication remains exact-permit-bound). The
contract gained §16.6/DPS-001…007 and its pinned SHA-256 was updated.

**WP-8-J (contract §12.3.1/LOK-019…022 — externally adjudicated lock
recovery) is complete**: the **human decision (ADR-033) is normative** —
`break-writer-lock` is permitted ONLY through a genuine trusted recovery
action that explicitly adjudicates the exact currently observed
writer-lock instance as breakable; the storage layer performs NO liveness
inference (no PID existence, process liveness, lock age, timestamps, boot
identity, heartbeat, lease, or elapsed-time authorization; no subprocess,
no `/proc`). Lock-break serialization uses the distinct
`locks/recovery-break.guard` (exclusive create, canonical guard record,
fsync; never a second general writer lock; leftover guard = external
disposition); the final removal binds the exact lock-record digest and
the deterministic lock-instance identity
(`PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1`), with the post-unlink absence
check protecting a legitimate new writer lock (old evidence never
authorizes breaking it); durable `StoreEvidenceRecord` evidence
(`recovery-evidence`, operation `break-writer-lock`, identity domain
`PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1`, no nonce/path) with its
`authorized-write` audit; idempotency per LOK-022 (absent + matching
evidence → `already-completed`; absent + no evidence → fail closed); a
fixed 12-stage crash inventory; scanner `lockRecoveryStates`
(completed / conflicting / evidence-with-different-lock / dangling);
advisory plan actions naming `break-writer-lock` with explicit external-
adjudication wording; foreign lock objects are classified, never
scan-fatal. The mutation lives in the existing lock owner (no new
fs-bearing module; exact allowlist unchanged). The contract gained
§12.3.1/LOK-019…022 and its pinned SHA-256 was updated.
**Not begun**: primary/audit deletion, retention,
migration, disposition of the remaining adjudication-only classes,
WP-9
generation seeding, WP-12 integration. The **implementation report
(`docs/reports/wp-8i-authorized-external-disposition-implementation-report.md`)
is complete** with the verification evidence; the **next gate is the
WP-8-F/WP-8-G/WP-8-H/WP-8-I implementation review**; **WP-8-F, WP-8-G,
WP-8-H, and WP-8-I are not closed**; WP-8 implementation remains **not
closed**; WP-9 and later packages remain **not authorized**. No release,
publication, installation, or deployment action has occurred for WP-8.

**WP-8-J (contract §12.3.1 — externally adjudicated lock recovery) is
complete**: the human decision (ADR-033) is normative —
`break-writer-lock` is permitted ONLY through a genuine trusted recovery
action that explicitly adjudicates the exact currently observed
writer-lock instance as breakable; the storage layer performs NO liveness
inference (no PID/process-liveness/age/timestamp/boot/heartbeat/lease
authorization; no subprocess, no `/proc`). Lock-break serialization uses
the distinct recovery-break guard (`locks/recovery-break.guard`;
exclusive create, canonical record, fsync; never a general writer lock;
leftover guard = external disposition); removal binds the exact
lock-record digest and the deterministic lock-instance identity, with
the post-unlink absence check protecting a legitimate new writer lock
(old evidence never authorizes breaking it); durable `StoreEvidenceRecord`
evidence (`recovery-evidence`, `break-writer-lock`, identity domain
`PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1`, no nonce/path) + its
`authorized-write` audit; idempotency per LOK-022; a fixed 12-stage
crash inventory; scanner `lockRecoveryStates`; advisory plan actions
naming `break-writer-lock` with external-adjudication wording; foreign
lock objects are classified, never scan-fatal. The mutation lives in the
existing lock owner (no new fs-bearing module). The contract gained
§12.3.1/LOK-019…022 and its pinned SHA-256 was updated.

**WP-8-K (contract §13.4/HST-001…010, AUD-014 — read-only audit-history
inspection) is complete**: the capability-free `inspect-audit-history`
read operation derives bounded, deterministic history for one exact
record identity/revision from verified immutable record and audit facts
only (never the registry index). Association binds canonical bytes and
digest, derived-location identity, referenced identity/digest, revision,
reference digests, event-kind payload, and trusted action identity; the
original `authorized-write` must match the deterministic D-8 expected
identity/digest; wrong-digest/malformed/dangling/duplicate/conflicting/
unsupported/unverified objects are closed-vocabulary findings, never
adopted or repaired. Original vs `recovery-audit-reconstruction` kinds
are never flattened; reconstructions report the gap marker and recovery
action and never fabricate the original event. Ordering follows the
normative audit tuple; bounds follow the limit profile (`totalScanEntries`
fail closed, `recordBytes` per object, `enumerationResults` per page with
an opaque self-validating cursor bound to store/target/generation/
surface/limits/last position); the result is snapshot-bound (surface
tokens, generations, and target digest re-verified; change → fail
closed). Reconstruction evidence referencing the target appears as
operational annotations with verified linkage. The implementation is a
new read-only fs owner (strict read-only allowlist; no capability,
provenance, permit, lock, or recovery-mutation import; zero mutation).
The contract gained §13.4/HST-001…010 and AUD-014 and its pinned SHA-256
was updated. **Retrospective independent review returned corrections
required** (F1 already resolved by WP-8-L; F2 reconstruction association,
F3 cross-page snapshot binding, F4 annotation pagination, and cursor
format versioning corrected at the current HEAD with deterministic
adversarial tests — see the WP-8-K implementation report correction
section). **Retrospective independent rereview of the WP-8-K
correction returned `WP-8K INDEPENDENT REREVIEW: ACCEPTED AND
CORRECTION COMMITTED`** (correction commit
`a654c84d6d2958a5da35c0ef2de8ad8b7869a5ca`); the correction closed
reconstruction-event association, cross-page snapshot coherence,
annotation continuation duplication, and the cursor-format/version
defect; HST-005 normative ordering remains preserved.

**WP-8-L (contract §15.4/RNT-011…020; ADR-035 — retention, legal hold,
and exact deletion) is implemented**: the first policy-bound deletion
path for immutable storage as a **separate private branded retention
authority domain** (retention-action provenance, trusted-retention
request, retention capability, and exact-record retention publication
permit; zero production provenance producers; recovery authority can
never perform retention deletion and vice versa). The exact operations
are **`retention-delete-record`** and **`retention-delete-audit`** — no
generic deletion operation exists. The **legal-hold gate uses a
generation-bound freshness model** (`PGAP-STORAGE-RETENTION-HOLD-STATE-
GENERATION-v1` over the exact configuration identity/version the
authority adjudicated; re-derived at every mutation boundary; never
wall-clock TTL): `active-hold`/`unknown-hold-state`/`stale-hold-decision`
prohibit; `clear-current-hold-state` permits evaluation; a hold
appearing after intent fails the post-intent revalidation before the
unlink and the durable intent is never self-executing authority. The
narrow retention-deletable primary classes are the eight immutable
lifecycle fact classes; evidence/metadata/index/configuration/lock/
quarantine/foreign/malformed/tamper classes and revocable-usability
classes are excluded. Retention deletion binds the committed WP-8-K
history to a deterministic digest (`PGAP-STORAGE-RETENTION-HISTORY-
BINDING-v1`); only a clean complete original lineage is eligible and
reconstructed gaps fail closed. The mutation sequence publishes a durable
deletion-intent evidence record BEFORE the exact unlink and a
deletion-completion evidence record AFTER the unlink and containing-
directory fsync (deterministic domain identities; `retention-evidence`
kind with the existing closed taxonomy), under the normal writer lock
with under-lock re-derivation of target/hold/policy/history, descriptor-
bound exact unlink (UID/mode/type/size/digest/dev-ino-nlink), absence
verification, and directory fsync — plus the full §15.4 idempotency table
(already-completed, safe completion roll-forward, absence-without-intent
fail-closed, target-live-with-completion integrity failure, conflicting
intent/completion fail-closed, hold/policy change after intent
`hold-blocked`/`policy-blocked`) and a fixed 14-stage crash inventory
for both target classes. Audit deletion is stricter: the referenced
primary must be absent AND its durable retention-delete-record completion
evidence must exist; every audit deletion is exact, independently
authorized, and never a cascade. The scanner distinguishes intentional
retention survivors (via durable completion evidence) from corruption
and never proposes their disposition, and classifies retention evidence
states deterministically. The implementation is a new fs-bearing module
(`retention/delete.ts`) plus the fs-free execution and evidence modules;
static-guard and global-security boundaries are extended (no generic
deletion vocabulary; retention creators are never re-exported). WP-8-L
also root-cause corrected the WP-8-K reported-event ordering (HST-005):
the audit-history page slice and resume boundary now follow the
normative audit ordering tuple instead of surface scan order (a latent
ordering defect that made the budget tests depend on shard-prefix luck).
The contract gained §15.4/RNT-011…020 and its pinned SHA-256 was updated.
**Not begun**:
compaction, migration, disposition of the remaining adjudication-only
classes, configuration-namespace recovery, WP-9 generation seeding, WP-12
integration. The **implementation report
(`docs/reports/wp-8l-retention-legal-hold-deletion-implementation-report.md`)
is complete** with the verification evidence; the **next gate is the
WP-8-F…WP-8-L implementation review**; **WP-8-F…WP-8-K are not closed**;
WP-8 implementation remains **not closed**; WP-9 and later packages
remain **not authorized**. No release, publication, installation, or
deployment action has occurred for WP-8. **Retrospective independent
review of WP-8-L returned finding L-1 (recovery scan misclassifies
durable retention-deletion intent evidence as dangling-evidence;
intent-pending and roll-forward-eligible unreachable), corrected at the
current HEAD (intent/completion discriminated extraction, exact identity
re-derivation, restored intent-pending/roll-forward-eligible
classification, intermediate crash-state tests). **Retrospective
independent rereview of the WP-8-L correction returned `WP-8L
INDEPENDENT REREVIEW: ACCEPTED AND CORRECTION COMMITTED`**
(correction commit `1b60a096f9e10df53ccebf9a8f9b38394cae6b8a` — the
current assurance HEAD); the correction restored exact
intent/completion discrimination, `intent-pending`,
`roll-forward-eligible`, and completion-only survivor explanation
without changing mutation authority or retention execution.**

**WP-8-M (contract §16.7/CSA-016…018; ADR-036 — configuration namespace
recovery) is implemented**: the exact recovery operation
**`recover-configuration-namespace`** (private recovery vocabulary only;
no generic configuration write/replace/repair operation exists) with the
**dual-authority gate** — genuine recovery authority AND a genuine
branded trusted configuration/bootstrap input correlated with the genuine
WP-6 trusted configuration (deterministic trusted-input identity digest
`PGAP-STORAGE-TRUSTED-INPUT-IDENTITY-v1`); recovery authority alone
cannot publish configuration and trusted input alone grants no mutation
authority, and an on-disk configuration object never authorizes its own
repair. The recoverable object is the configuration-namespace
`StoreMetadata` (`config-v1/metadata/metadata.json` — the only persistent
configuration object); the recoverable state is the expected canonical
configuration MISSING, republished with the exact no-overwrite metadata
protocol from bytes derived through the SAME canonical
trusted-input-to-storage transformation as normal initialization
(recovery-gated compatibility probe + metadata facts + `buildStoreMetadata`;
identical trusted input ⇒ identical bytes/digest; clock/PID/nonce/path/
recovery-action never enter the bytes). Conflicting bytes, malformed,
wrong type/UID/mode, symlinks, foreign entries, unsupported versions,
interrupted publication (provable prefix), and a missing metadata
DIRECTORY all fail closed — never overwritten, never repaired, zero
migration (older-version transformation is migration-required and
reserved). Publication is confined to a dedicated
`ConfigurationRecoveryMetadataPermit` consumed by the metadata
persistence owner (independent re-parse/re-verify/re-derive; EEXIST is
byte-exact replay only). A successful recovery publishes deterministic
`recovery-evidence` (`PGAP-STORAGE-CONFIGURATION-RECOVERY-EVIDENCE-v1`)
plus its `authorized-write` audit; evidence never grants configuration
authority. Idempotency: missing → recover; exact + matching evidence →
`already-completed`; exact + no evidence → non-mutating
`already-present` (no evidence fabricated); missing + evidence →
integrity failure; conflict/trusted-input-change/observation change →
fail closed. The recovery scan observes the configuration namespace
(closed state vocabulary + deterministic observation id) and classifies
configuration-recovery evidence states; malformed/conflicting
configuration never makes the unrelated recovery scan fail; the registry
index is never updated or deleted (WP-8-H staleness applies); the
recovered configuration is consumed by the normal configuration consumer
path exactly as initialization would produce it. A fixed 11-stage crash
inventory covers both publication and evidence; a stale writer lock is
never auto-broken. The recovery scan and the recovery operation use the
configuration-tolerant revalidation (fully verified store-records
metadata anchor; configuration metadata observed, never trusted); every
other operation keeps the strict fail-closed pipeline. The contract
gained §16.7/CSA-016…018 and its pinned SHA-256 was updated.
**Not begun**:
compaction, migration, disposition of the remaining adjudication-only
classes, configuration `ConfigurationSnapshotRecord` production (no
producer exists; recovery never invents configuration records),
configuration-namespace recovery of non-metadata objects, WP-9
generation seeding, WP-12 integration. The **implementation report
(`docs/reports/wp-8m-configuration-namespace-recovery-implementation-report.md`)
is complete** with the verification evidence.

**WP-8 CLOSED** (closure decision: implementation through WP-8-M
accepted; committed implementations, reports, tests, and commit history
are the accepted evidence):

> **Closure-assurance revalidation:** the historical WP-8 closure
> (commit `db1b41539331d10704f87cf480a49beacacf9168`) predated
> retrospective independent assurance. Retrospective assurance was
> required for WP-8-K, WP-8-L, and WP-8-M because implementation and
> self-review had previously been combined. The retrospective chain is
> now complete: WP-8-K independent review returned corrections required
> (correction `a654c84d6d2958a5da35c0ef2de8ad8b7869a5ca`;
> `WP-8K INDEPENDENT REREVIEW: ACCEPTED AND CORRECTION COMMITTED`);
> WP-8-L independent review returned finding L-1 (correction
> `1b60a096f9e10df53ccebf9a8f9b38394cae6b8a` — the current assurance
> HEAD; `WP-8L INDEPENDENT REREVIEW: ACCEPTED AND CORRECTION
> COMMITTED`); WP-8-M independent review returned `WP-8-M INDEPENDENT
> REVIEW: ACCEPTED` with zero substantive findings (two LOW non-blocking
> fail-closed observations remain: the configuration-recovery byte-exact
> EEXIST replay path is unreachable and fails closed, and the
> `interrupted-configuration-publication` scanner vocabulary state is
> unobservable because real partial prefixes classify as malformed —
> neither violates an enforceable WP-8 contract property). **No
> substantive WP-8 assurance finding remains; WP-8 closure is now
> `ASSURANCE-REVALIDATED`** — the historical closure decision above is
> historical and is not re-declared. Model: historical closure →
> retrospective assurance findings → forward corrections → independent
> rereviews → closure assurance revalidated. Migration remains deferred
> (DS-13 / §23.2); compaction remains non-MVP/deferred; the remaining
> adjudication-only states remain intentional; the next work package
> remains WP-9.

**WP-9 (MCP inspection surface) — CLOSED. Implementation complete;
Slices 1-4 committed (`b3cde8b…`, `0f3ac3a…`, `d5418f7…`, `ef118fc…`);
Slice 5 (local stdio MCP runtime) committed at
`045ae7c2f4a980d392333ac6823e33ffa5513d24` after the F1-F3 focused
rereview closed all three findings; TRANSPORT DECISION: LOCAL STDIO
(recorded in the transport/runtime decision analysis); closure
independently accepted (`docs/reports/wp-9-mcp-inspection-surface-closure-report.md`);
WP-9 CLOSED — no remaining WP-9 implementation work; no later work
package (WP-10, WP-14) is started or authorized by this closure**
(`docs/reports/wp-9-mcp-inspection-surface-implementation-report.md`): the
**transport-free MCP inspection protocol/tool layer**
(`src/adapters/mcp/`) exposes the closed read-only tool vocabulary.
Slice 1 (committed, independently reviewed with the F1 requestId-echo
correction): `validate-artifact` (pure WP-4 validation),
`inspect-stored-record` (exact verified WP-8 read), `inspect-registry`
(authoritative WP-8 registry view with opaque self-validating
continuation and optional verified persistent-index fast path).
Slice 2 (committed): `inspect-audit-history` — bounded read-only
audit-history inspection routing the assurance-revalidated WP-8K
`inspectAuditHistory` API through the committed adapter boundary;
normative tuple ordering, snapshot-bound continuation
(invalid-cursor/stale-cursor distinction), status/completeness,
reconstruction and event-without-evidence findings preserved verbatim;
closed WP-8K target vocabulary; no package-export change; no WP-8K
production change.
Slice 3 (committed): `verify-record` and `enumerate-class` — WP-8
verify-by-identity (`verifyRecord`) and bounded deterministic class
enumeration (`enumerateClass`) through the committed adapter boundary;
exact stored-identity verification (never content validation, never a
lifecycle claim), truthful truncation, opaque position continuation,
foreign-entry findings preserved; no package-export change; no domain
production change.
**Slice 4 (candidate): multi-store inspection surface registration** —
host-owned `createMcpInspectionRegistry`: opaque logical `surfaceId`
routing through the committed surface semantics (six tools unchanged,
single-store API preserved), duplicate/conflict fail-closed, per-request
revalidation freshness (no cached authority), per-tool cursor routing
(registry/history store-bound; enumeration position-only), zero client
root/path control. WP-9 generation seeding NOT implemented in this slice
(INDEPENDENT: no normative definition exists and registration does not
require it); remains remaining work. Strict closed-field request validation; deterministic
public error taxonomy (invalid-request / not-found / unsupported /
limit-exceeded / invalid-cursor / stale-cursor / integrity-conflict /
adapter-error); host-supplied trusted store targeting (genuine branded
trusted input + strict store verification at context construction; MCP
clients never select roots, stores, or namespaces); deep-frozen redacted
responses; zero filesystem/mutation imports (static proof); `./mcp`
exposes no storage authority. **Slice 2 is ready for independent review**;
acceptance is not declared by the implementation.
Remaining WP-9 work: none (WP-9 CLOSED — all slices committed and
independently reviewed; closure independently accepted). WP-9 generation
seeding (semantics undefined in the repository; not required by any
committed slice; removed from WP-9 closure criteria by the
 generation-seeding decision) is NOT listed as remaining implementation
work. Transport decision: LOCAL STDIO — the Slice 5 runtime implements
it; Secure MCP Tunnel / ChatGPT connectivity remains WP-14-owned (not
started or authorized by WP-9 closure).

- **WP-8-N configuration migration is DEFERRED** by human decision
  (decision (c) Deferral) under the existing DS-13 / §23.2
  version-transition decision (DCS-002: deferred decisions must not be
  resolved by implementation). The live configuration transition
  primitive is intentionally undefined; `ConfigurationSnapshotRecord`
  production is deferred with it; WP-8M same-version configuration
  recovery remains complete and unchanged. Migration is **not a WP-8
  closure blocker** — no contract clause makes DS-13 resolution a WP-8
  completion prerequisite.
- **Compaction is DEFERRED / NON-MVP**: no normative WP-8 MVP
  completion rule requires a compaction mechanism; the contract
  references compaction only as a prohibition (TAX-009, RNT-002: no
  silent compaction or deletion of indefinite-retention classes).
- **Remaining adjudication-only classes are INTENTIONALLY
  ADJUDICATION-ONLY — not blockers**: wrong-type/wrong-UID-mode/
  unexpected-hard-link quarantine objects, foreign objects, tamper-class
  records, dangling audits, and leftover recovery-break guards are
  contract-defined external-disposition boundaries (WPR-023, LOK-020,
  §16.7); a `requires-external-disposition` scanner classification never
  implies an automatic-mutation obligation, and deletion authority is
  not broadened.
- **Lifecycle approval decisions**: later-owned by WP-12 (local
  approval and execution control plane); TAU-009 — maintenance
  procedures never invent lifecycle decisions; WP-8 derives structure
  only.
- **Later-package ownership**: WP-9 generation seeding was removed from
  WP-9 closure criteria by the generation-seeding decision (no normative
  definition exists); WP-12 integration is later-owned (WP-8 is a
  satisfied prerequisite OF WP-12, not the reverse).
- **Current work package: WP-9 (MCP inspection surface) — CLOSED.**
  Read-only inspection MCP tools; prerequisites WP-7 and WP-4 satisfied;
  inspection-only, no mutation tools; slices 1-5 committed (Slice 5 at
  `045ae7c2…`); transport decision LOCAL STDIO; F1-F3 startup-config
  corrections closed by the focused rereview; IMPLEMENTATION COMPLETE;
  independent closure review ACCEPTED — WP-9 CLOSED.
- **Current work package: WP-10 (Artifact drafting tools).** Slice 1
  (transport-free draft-proposal core, `src/drafting/proposal.ts`) was
  independently accepted and committed at `5c560f48…` (F1 focused
  rereview CLOSED; see
  `docs/reports/wp-10-artifact-drafting-tools-implementation-report.md`).
  **Slice 2 was independently accepted and committed as the committed
  candidate**: host/surface-aware transport-free drafting adapter
  (`src/adapters/mcp/drafting.ts` — surfaceId → exact registered
  SchemaRegistry instance → accepted Slice 1 core; verbatim drafting
  taxonomy; no runtime registration).
  **Slice 3 was independently accepted and committed**: local stdio
  registration of `draft-artifact` (`src/runtime/mcp/server.ts` registers
  the one WP-10 drafting tool beside the six WP-9 inspection tools —
  overall seven; same-registry-instance host composition in
  `src/runtime/mcp/compose.ts`; SDK input schema is shape/type only,
  drafting semantics stay in the accepted adapter/core). WP-10 was
  independently closure-reviewed with zero substantive findings and is
  **CLOSED** (remaining WP-10 implementation work NONE; controlled-reader
  drafting assist is not required for the closure gate; authoritative
  closure report:
  `docs/reports/wp-10-artifact-drafting-tools-closure-report.md`). No MCP
  draft tool
  was registered before Slice 3 (WP-9's six-tool inventory remains
  unchanged).
  WP-11 is **CLOSED** (`9695c5d`); WP-12 is **CLOSED** (`164b8a0`); WP-5B
  is **CLOSED** (`1067d5c`); the current phase is the WP-13
  pre-implementation contract decision (see the current-state note above);
  WP-14 remains blocked by WP-13 (see the current-state note above).

No release, publication, installation, or
deployment action has occurred for WP-8.

**Normative cross-references:** `project-gateway-scope-and-principles.md`
(WP-0), ADR-002, ADR-003, ADR-006, ADR-020, ADR-022, ADR-023 (sequencing
decision), ADR-024 (trusted configuration ownership), ADR-025 (capability
vocabulary), ADR-026 (pi-guard lane), ADR-027 (enforcement evidence),
ADR-040 (WP-14 zero-transfer product boundary),
`trusted-workspace-and-ceiling-configuration.md`,
`capability-vocabulary.md`, `pi-guard-compatibility-and-authority-projection.md`,
`post-wp5a-planning-status.md`, `docs/reports/wp-14-pre-implementation-contract-decision.md`.

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
| 10 | WP-14 | Tunnel and ChatGPT Web connectivity | WP-13, WP-9, WP-7, WP-10, WP-11 | ChatGPT Web draft/review connectivity, WP-11-backed controlled proposal persistence, stateless changed-context retrieval per the WP-1 producer boundary and the zero-transfer UX baseline (ADR-040) | ChatGPT Web reaches Gateway surfaces via tunnel; can inspect project state, create + validate + persist a supported proposal artifact through controlled write, and retrieve changed project context without manual paste/upload; no lifecycle authority flows through connectivity; fail-closed; no generic filesystem-write surface |
| 11 | WP-14C | Pi zero-transfer artifact loading | WP-14, WP-6, WP-7, WP-10, WP-5A | Pi-side artifact resolution/load workflow; short invocation/command; validated context injection into Pi; visible success/failure feedback | Pi can load the intended valid artifact/bundle through a short user action without copy/paste, upload/download, manual path transcription, or a natural-language loading prompt, while gaining no lifecycle authority from the load itself |
| 12 | WP-15 | Security hardening, release, and operational readiness | All prior (incl. WP-14, WP-14C) | Hardening review, release packaging, operational runbooks, final audit | Release gate passed; no open security findings |

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
- **WP-13 → WP-14:** ChatGPT Web connectivity composes execution,
  inspection (WP-9), drafting (WP-10), and controlled writing (WP-11);
  drafts remain producer-owned per WP-1; the approved zero-transfer UX
  baseline (ADR-040) requires controlled proposal persistence and
  stateless changed-context retrieval in addition to draft/review
  connectivity.
- **WP-14 → WP-14C:** Pi zero-transfer artifact loading is a Pi-side
  consumer/UX package, not ChatGPT connectivity: it resolves artifacts
  from controlled project state (WP-6 configuration, WP-7 controlled
  reads, WP-10 validation) and injects them through the existing WP-5A
  host-bridge seam. It is NOT forced into WP-14 merely because hotkeys
  share the same end-user journey.
- **WP-14C → WP-15:** final hardening/release consumes every prior
  package, including WP-14 and WP-14C.
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
draft/review connectivity per the WP-1 producer boundary and the approved
zero-transfer UX baseline (ADR-040): inspect → construct → validate →
persist proposal artifacts through the committed WP-11 controlled-write
boundary, plus stateless changed-context retrieval. Inputs: WP-13
execution results, WP-9 inspection surface, WP-7 controlled reader/Git
inspection, WP-10 drafting, WP-11 controlled writing. Outputs:
tunnel-only ChatGPT connectivity; one WP-11-backed controlled proposal
persistence surface; one stateless changed-context surface; connector/
operator configuration. Owned: tunnel/ChatGPT Web connectivity,
WP-11-backed persistence adapter with independent validation at the
persistence boundary (Model B), changed-context composition,
connector/operator configuration and secrets placement (tunnel/auth
credentials are operator-local and owned by the external tunnel/
platform; Gateway runtime configuration remains secret-free; credentials
MUST NOT be stored in project-visible artifacts, committed to repository
configuration, placed in trusted Gateway workspace/runtime
configuration, accepted through Gateway MCP tool requests, or returned
through Gateway MCP responses; WP-14 creates no secret-storage
infrastructure). Prohibited:
widening authority, generic filesystem writes, lifecycle-record writes,
bypassing WP-11, Pi-side loading (WP-14C-owned). Invariants: no lifecycle
authority flows through connectivity; schema limits WHAT ChatGPT may
persist and WP-11 limits WHERE and HOW; persistence is not lifecycle
authority. Tests: connectivity isolation; persistence containment,
create-only, and ownership constraints; changed-context boundedness and
redaction; fail-closed and disconnect behavior. Non-goals: no governance,
no execution, no third implementation slice beyond WP-14A/WP-14B.

**WP-14C — Pi zero-transfer artifact loading.** Objective: allow Pi to
resolve, validate, and load the intended structured artifact/bundle
through a short command/keyword/hotkey; eliminate routine artifact
copy/paste and natural-language file-loading prompts. Inputs: committed
project workspace/configuration, persisted proposal artifacts, existing
WP-6 controlled workspace/configuration semantics, WP-7 controlled reads,
WP-4/WP-10 artifact validation, existing Pi adapter/host-bridge injection
seam. Outputs: Pi-side artifact resolution/load workflow; short
invocation/command; validated context injection into Pi; visible
success/failure feedback. Owned: Pi-side artifact resolution/load
workflow; short invocation/command; validated context injection into Pi;
visible success/failure feedback. Prohibited: approval, issuance, grant,
activation, execution authorization, receipt issuance, lifecycle state
mutation caused by loading. Invariants: artifact loading is context
transfer, not authority. Tests: resolution/validation/load matrices;
no-authority negative evidence; feedback behavior. Non-goals: no
scheduler, no generic filesystem loader, no durable selection record, no
execution redesign, no new authority domain.

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
| ChatGPT proposal-artifact persistence | WP-14 (persistence adapter over the committed WP-11 controlled-write boundary) | Validated draft + WP-11 controlled write (schema limits WHAT; WP-11 limits WHERE/HOW) | Derived (schema-validated) | Only as validated proposal artifacts | Prospective |
| Changed-context retrieval | WP-14 (composed from WP-7/WP-9 controlled inspection) | Controlled Git/file inspection at point of use | Observational | No | Present-state |
| Pi artifact loading | WP-14C (Pi-side consumer/UX package) | Controlled project state + WP-10 validation | Derived (validated) | Only as validated proposal artifacts/context | Prospective |

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
never a public MCP or security boundary; persistence is never lifecycle
authority (a persisted proposal remains unapproved/untrusted until the
trusted-local lifecycle separately acts); artifact loading is context
transfer, not authority; connectivity, keyword invocation, hotkeys, and
artifact loading never create authority.
