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

**Current state (WP-13 durability S3 baseline; recorded
2026-08-11):** WP-11, WP-12, WP-5B are **CLOSED**; WP-13 implementation
slices A/B/C are **committed/closed** (baselines `bc8429a`/`02bce4b`/
`5cddfc8`). The original WP-13D closure attempt
(`src/retrospective/`, `tests/unit/wp13d-retrospective.test.ts`,
`tests/unit/wp13d-static-guard.test.ts`,
`docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`)
remains **uncommitted and superseded** pending the durability
implementation. The WP-13 senior closure review findings
(SCR-WP13-CLOSURE-001, CRITICAL — cold re-derivability;
SCR-WP13-CLOSURE-002, MAJOR — observation evidence identity) are
resolved **at contract level** by the docs-only closure durability
decision (`docs/reports/wp-13-closure-durability-architecture-decision.md`;
ADR-039, **Accepted**); the durability architecture/contract and the
S1 foundation are **ACCEPTED** (committed baselines), the
**S2 authority boundary is ACCEPTED** (focused senior review), and the
**S3 outcome production & publication precondition baseline is ACCEPTED**
(focused senior review SIR-WP13-DUR-S3-001…004 all CLOSED; focused
rereview ACCEPTED; `SIR-WP13-DUR-S3-RR-001` retained as an accepted
non-blocking MINOR note; this baseline commit). **S1 CLOSED; S2 CLOSED;
S3 CLOSED; S4 — NOT STARTED / NOT AUTHORIZED** (requires explicit human
authorization); **WP-13 remains NOT CLOSED**. WP-14 and WP-15 remain
**blocked** behind WP-13. The WP-13 retrospective simplification
contract amendment (`docs/reports/wp-13-retrospective-simplification-amendment.md`)
is COMPLETE at contract level (docs-only): ONE shared pure derivation
primitive with structural semantic equality replaces the cross-engine
byte-identical proof; cold re-derivation from trusted durable records is
preserved; S4 remains NOT STARTED / NOT AUTHORIZED under the amended
contract. This current-state note supersedes the earlier
"WP-13 durability S2 baseline" current-state note; historical records are
preserved.

**Current state (WP-14 product UX alignment; recorded 2026-08-12 with the
WP-14 contract amendment):** **WP-13 is CLOSED** (closure report
`docs/reports/wp-13-closure-report.md`; roadmap criterion "End-to-end
execution with enforcement and retrospective results" SATISFIED). The
**WP-14 product UX alignment is approved** (human-approved product
decisions: ChatGPT controlled proposal persistence; ChatGPT
changed-context retrieval without routine copy/paste/upload/download; Pi
zero-transfer artifact loading; WP-14C added after WP-14 and before
WP-15; principles `Automate transfer, not authority` and `Zero-transfer,
not necessarily zero-keystroke`). The **WP-14 contract amendment is
established at documentation level** (ADR-040 — WP-14 zero-transfer
product boundary; `docs/reports/wp-14-pre-implementation-contract-decision.md`;
revised roadmap rows/attribute blocks for WP-14 and WP-14C; zero-transfer
UX objective and principles in `project-gateway-scope-and-principles.md`;
amendment report
`docs/reports/wp-14-product-ux-alignment-amendment.md`). **WP-14A NOT
STARTED / NOT AUTHORIZED; WP-14B NOT STARTED; WP-14C approved as a
roadmap package but NOT STARTED / NOT AUTHORIZED** (each requires
separate explicit human implementation authorization). **WP-15 remains
blocked** until WP-14 and WP-14C are closed (roadmap order
`WP-14 → WP-14C → WP-15`). Implementation authorization is NOT claimed
by this amendment: no WP-14A/B/C implementation work has begun. The
runtime's exactly-seven MCP tool inventory (six WP-9 inspection + one
WP-10 drafting) will intentionally grow in WP-14A by one controlled
proposal persistence operation and one changed-context inspection
operation; historical seven-tool statements in closed-package reports
and in superseded historical "current work package" bullets (e.g., the
WP-10 Slice 3 bullet below) remain historical; the WP-14A closed
inventory supersedes them at implementation time. The WP-14 focused
contract review returned `WP-14 PRODUCT UX FOCUSED CONTRACT REVIEW
CORRECTIONS REQUIRED`; the five findings SCR-WP14-UX-001…005 are CLOSED
by the docs-only focused correction (ADR-040 correction record; WP-14
pre-implementation contract decision §13; amendment report §14) — Model
B validation-at-persistence, changed-context membership confinement,
ADR-023 narrow tail amendment, secrets placement, and WP-14C "bundle"
clarification. This current-state note supersedes the earlier
"WP-13 durability S3 baseline" current-state note; historical records are
preserved.

**Current state (WP-14 closure; recorded 2026-08-12 with the WP-14
closure commit):** **WP-14 is CLOSED** (closure report
`docs/reports/wp-14-closure-report.md`; exactly nine MCP tools; four-kind
Model-B controlled persistence over WP-11; stateless changed-context
retrieval; Git-lane `gitHome`/`gitTmpdir` operator configuration
correction; operator onboarding; scripted stdio/tunnel-boundary
conformance; live ChatGPT smoke unavailable and not fabricated;
authority-isolation and secrets/config results; failure/disconnect
fail-closed evidence; zero-transfer UX verified through the real
runtime). **WP-14A CLOSED** (senior-review accepted; baseline
`d95539435e8a954f83f362b72b6f57a54afe8c5f`). **WP-14B CLOSED** (senior-
review accepted; integration E2E 4/4; runtime 35/35; MCP unit 96/96).
**WP-14C is now ELIGIBLE FOR HUMAN CONTRACT / IMPLEMENTATION
AUTHORIZATION** according to its own gate (roadmap-approved package;
NOT STARTED / NOT AUTHORIZED here; bundle-selection semantics deferred
to its own contract decision). **WP-15 remains BLOCKED** until WP-14 and
WP-14C are closed (roadmap order `WP-14 → WP-14C → WP-15`). Nonblocking
observations preserved for follow-up: SIR-WP14A-001 (8 MiB diff
ceiling), SIR-WP14A-003 (SDK request parsing before adapter caps),
SIR-WP14B-001 (rename/original-path changed-context semantics),
SIR-WP14B-002 (`gitHome`/`gitTmpdir` operator setup burden);
SIR-WP14A-002 CLOSED by WP-14B E2E coverage. This current-state note
supersedes the 2026-08-12 WP-14 product UX alignment note above and
earlier "current work package" statements; historical records are
preserved.

**Current state (WP-14C contract baseline; recorded 2026-08-12 with the
WP-14C pre-implementation contract decision):** **WP-14 is CLOSED.**
**WP-14C contract: ESTABLISHED** (human-approved Model C selection —
explicit pins + uniqueness-only fallback — and resolved proposal-set
semantics; contract decision
`docs/reports/wp-14c-pre-implementation-contract-decision.md`). Normative
load unit: **resolved proposal set** (non-empty subset of TaskSpec /
AuthorityPolicy / ContextManifest / CompletionContract; never an
ExecutionBundle; no ExecutionBundle construction or persistence).
Loading reuses the WP-5A host-bridge injection seam and committed render
primitives; it prepares Pi context only and grants no lifecycle/
execution authority (WP-12/WP-13 execution path untouched). **WP-14C
implementation: NOT STARTED / NOT AUTHORIZED** (explicit human
implementation authorization required). **WP-15: BLOCKED** until WP-14C
closes (roadmap order `WP-14 → WP-14C → WP-15`). This current-state note
supersedes the WP-14 closure note above; historical records are
preserved.

**Current state (WP-14C closure; recorded with the WP-14C closure
commit):** **WP-14: CLOSED.** **WP-14C: CLOSED** (closure report
`docs/reports/wp-14c-closure-report.md`; one short Pi action
`gateway-load` resolves → controlled-reads → freshly validates →
correlates → renders → injects the intended non-empty resolved proposal
set without copy/paste, upload/download, manual path transcription, or a
natural-language loading prompt; Model C selection; resolved
proposal-set semantics; configured artifact-location confinement; fresh
controlled read + validation; SCR-WP14C-001 exact-reference correlation;
proposal-context rendering; reload/supersession; authority isolation;
no generic filesystem loader; senior review corrections SIR-WP14C-001/
002/003 CLOSED; focused rereview and closure review accepted; loading/
static-guard 26/26; typechecks clean; live Pi host registration remains
environment-gated under the committed WP-5A seam and was not observed or
fabricated). **WP-15 is the next roadmap package: ELIGIBLE FOR HUMAN
PRE-IMPLEMENTATION / AUTHORIZATION WORK** (roadmap order
`WP-14 → WP-14C → WP-15`; prerequisite satisfied by this closure).
**WP-15 implementation remains NOT AUTHORIZED** — no WP-15 work begins
without separate explicit human authorization. This current-state note
supersedes the WP-14C contract-baseline note above; historical records
are preserved.

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
implementation review pending. **WP-8-I (authorized external disposition;
ADR-032; contract §16.6/DPS-001…007) is complete**: the human contract
decision is implemented — `dispose-wpr023d-temporary` remains
ADJUDICATION-ONLY (deterministic `disposition-required`, no mutation, no
evidence); `dispose-quarantined-temporary` is executable ONLY for
`quarantine-malformed`/`foreign-entry`/`quarantine-conflict` regular
files with exact UID/mode/size/nlink/digest/observation bindings (all
other quarantine states stay adjudication-only); `dispose-conflicting-index`
is executable only for the exact regular-file conflicting artifact at
the deterministic derived index identity (stale/current/unrelated
malformed/foreign index objects, directories, symlinks, and recursive
`index/` deletion prohibited; no auto-rebuild). Executable disposition
uses the exact unlink-plus-directory-fsync primitive (one new fs-bearing
owner), durable `StoreEvidenceRecord` evidence with the existing
`recovery-evidence` kind and per-operation domain-separated identities,
the full re-verification/mutation sequence under the single-writer lock,
the idempotency table (already-completed only with matching evidence;
all conflicting/absent/changed states fail closed), a fixed 12-stage
executable crash inventory plus the 5-stage WPR-023 (d) inventory,
scanner `dispositionStates` classification, exact operation naming in
advisory plan actions, and exact static-guard/global-security boundaries
(no generic disposition/deletion authority; no new evidence kind). The
contract gained §16.6/DPS-001…007 and its pinned SHA-256 was updated.

**WP-8-J (externally adjudicated lock recovery; ADR-033; contract
§12.3.1/LOK-019…022) is complete**: the human decision is normative —
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
naming `break-writer-lock`; foreign lock objects are classified, never
scan-fatal. The mutation lives in the existing lock owner (no new
fs-bearing module). The contract gained §12.3.1/LOK-019…022 and its
pinned SHA-256 was updated.

**WP-8-K (read-only audit-history inspection; ADR-034; contract
§13.4/HST-001…010, AUD-014) is complete**: the read boundary now exposes
the capability-free `inspect-audit-history` — bounded, deterministic,
read-only history for one exact durable record identity/revision,
derived exclusively from verified immutable record and audit facts
(never the registry index). Association is by verified facts only
(canonical bytes/digest, derived-location identity, referenced
identity/digest, revision binding, reference digests, event-kind
payload, trusted action identity); the original `authorized-write` event
must match the deterministic D-8 expected identity/digest; wrong-digest,
malformed, dangling, duplicate, conflicting, unsupported-version, and
unverified objects are closed-vocabulary findings, never adopted, never
repaired. Original vs reconstructed kinds are never flattened; a
reconstruction reports the gap marker and recovery action and never
fabricates the original event. Ordering is the normative audit tuple
(primary logical creation time, primary record identity, event
identity); timestamps are recorded facts, never mtime/fs order. Bounds
follow the limit profile (`totalScanEntries` fail closed, per-object
`recordBytes`, per-page `enumerationResults` with an opaque
self-validating continuation cursor bound to store/target/generation/
surface/limits/last position). The result is bound to a verified
snapshot (audit + evidence surface tokens, generations, and target
digest re-verified after inspection; change → fail closed).
`StoreEvidenceRecord` reconstruction evidence referencing the target is
reported as operational annotations with verified linkage. The
implementation is a read-only fs owner (strict read-only allowlist; no
capability/provenance/permit/lock imports; zero mutation). The contract
gained §13.4/HST-001…010 and AUD-014 and its pinned SHA-256 was
updated. WP-8-L also root-cause corrected the reported-event ordering
(HST-005): the page slice and resume boundary now follow the normative
audit ordering tuple instead of surface scan order (the previous
scan-ordered pagination disagreed with the tuple whenever shard prefixes
differed from creation order, a latent defect that made the budget tests
depend on shard-prefix luck). **Retrospective independent review returned
corrections required** (F1 already resolved by WP-8-L; F2 reconstruction
association, F3 cross-page snapshot binding, F4 annotation pagination,
and cursor format versioning corrected at the current HEAD with
deterministic adversarial tests — see the WP-8-K implementation report
correction section). **Retrospective independent rereview of the WP-8-K
correction returned `WP-8K INDEPENDENT REREVIEW: ACCEPTED AND
CORRECTION COMMITTED`** (correction commit
`a654c84d6d2958a5da35c0ef2de8ad8b7869a5ca`); the correction closed
reconstruction-event association, cross-page snapshot coherence,
annotation continuation duplication, and the cursor-format/version
defect; HST-005 normative ordering remains preserved.

**WP-8-L (retention, legal hold, and exact deletion; ADR-035; contract
§15.4/RNT-011…020) is implemented**: the first policy-bound deletion path
for immutable storage as a **separate private branded retention authority
domain** — retention-action provenance, trusted-retention request,
retention capability (`retention-delete-record` / `retention-delete-audit`;
no generic deletion operation), and exact-record retention publication
permit, with zero production provenance producers; recovery authority can
never perform retention deletion and vice versa. The **legal-hold gate
uses a generation-bound freshness model** (`PGAP-STORAGE-RETENTION-HOLD-
STATE-GENERATION-v1` over the exact configuration identity/version the
authority adjudicated; re-derived at every mutation boundary; never
wall-clock TTL): `active-hold`/`unknown-hold-state`/`stale-hold-decision`
prohibit deletion, `clear-current-hold-state` permits evaluation, and a
hold appearing after intent fails the post-intent revalidation before the
unlink (the durable intent is never self-executing authority). The narrow
retention-deletable primary classes are the eight immutable lifecycle
fact classes; evidence/metadata/index/configuration/lock/quarantine/
foreign/malformed/tamper and revocable-usability classes are excluded.
Primary deletion binds the committed WP-8-K history to a deterministic
digest (`PGAP-STORAGE-RETENTION-HISTORY-BINDING-v1`); only a clean
complete original lineage is eligible and reconstructed gaps fail closed.
The mutation publishes durable deletion-intent evidence BEFORE the exact
unlink and deletion-completion evidence AFTER the unlink and
containing-directory fsync (deterministic domains; `retention-evidence`
kind), under the normal writer lock with under-lock re-derivation,
descriptor-bound exact unlink, absence verification, the full §15.4
idempotency table (already-completed, safe roll-forward,
absence-without-intent fail-closed, target-live-with-completion
integrity failure, conflicting intent/completion fail-closed,
hold/policy change after intent `hold-blocked`/`policy-blocked`), and a
fixed 14-stage crash inventory for both target classes. Audit deletion is
stricter: the referenced primary must be absent AND its durable
retention-delete-record completion evidence must exist; each audit
deletion is exact, independently authorized, and never a cascade. The
recovery scanner distinguishes intentional retention survivors (via
durable completion evidence) from corruption and never proposes their
disposition, and classifies retention evidence states deterministically.
The implementation adds one fs-bearing module (`retention/delete.ts`)
plus fs-free execution/evidence modules; static-guard and global-security
boundaries are extended (no generic deletion vocabulary; retention
creators never re-exported). The contract gained §15.4/RNT-011…020 and
its pinned SHA-256 was updated.
Compaction, migration, disposition of
the remaining adjudication-only classes, WP-9, and WP-12 remain out of
scope. The **implementation report
(`docs/reports/wp-8l-retention-legal-hold-deletion-implementation-report.md`)
is complete**; **WP-8-F, WP-8-G, WP-8-H, WP-8-I, WP-8-J, WP-8-K, and
WP-8-L are
not yet closed**
— implementation review pending; WP-8 implementation is **not closed**.
**Retrospective independent review of WP-8-L returned finding L-1
(retention intent evidence misclassified as dangling-evidence;
intent-pending and roll-forward-eligible unreachable), corrected at the
current HEAD. **Retrospective independent rereview of the WP-8-L
correction returned `WP-8L INDEPENDENT REREVIEW: ACCEPTED AND
CORRECTION COMMITTED`** (correction commit
`1b60a096f9e10df53ccebf9a8f9b38394cae6b8a` — the current assurance
HEAD); the correction restored exact intent/completion discrimination,
`intent-pending`, `roll-forward-eligible`, and completion-only survivor
explanation without changing mutation authority or retention
execution.**

**WP-8-M (configuration namespace recovery; ADR-036; contract
§16.7/CSA-016…018) is implemented**: the exact recovery operation
`recover-configuration-namespace` with the dual-authority gate (genuine
recovery authority AND genuine trusted configuration/bootstrap input —
deterministic trusted-input identity digest; recovery authority alone
cannot publish configuration; trusted input alone grants no mutation
authority; on-disk configuration never authorizes its own repair). The
recoverable object is the configuration-namespace `StoreMetadata`
(`config-v1/metadata/metadata.json`); the recoverable state is the
expected canonical configuration MISSING, republished with the exact
no-overwrite protocol from bytes derived through the SAME
trusted-input-to-storage transformation as normal initialization.
Conflicts, malformed, wrong type/UID/mode, symlinks, foreign entries,
unsupported versions, interrupted publication, and a missing metadata
directory fail closed — never overwritten, never repaired, zero
migration. Publication is confined to a dedicated
`ConfigurationRecoveryMetadataPermit`; a successful recovery publishes
deterministic `recovery-evidence` plus its `authorized-write` audit.
Idempotency: recovered / already-completed / already-present (no
evidence fabricated) / integrity-failure / fail-closed. The recovery
scan observes the configuration namespace (closed state vocabulary +
deterministic observation id) and classifies configuration-recovery
evidence states; malformed/conflicting configuration never makes the
unrelated recovery scan fail; the registry index is never updated or
deleted; the recovered configuration is consumed by the normal
configuration consumer path exactly as initialization would produce it.
A fixed 11-stage crash inventory; stale writer locks are never
auto-broken. The recovery scan and the recovery operation use the
configuration-tolerant revalidation (fully verified store-records
metadata anchor); every other operation keeps the strict fail-closed
pipeline. The contract gained §16.7/CSA-016…018 and its pinned SHA-256
was updated.
Configuration `ConfigurationSnapshotRecord` production (no producer
exists; recovery never invents configuration records),
configuration-namespace recovery of non-metadata objects, migration,
compaction, WP-9, and WP-12 remain out of scope. The **implementation
report
(`docs/reports/wp-8m-configuration-namespace-recovery-implementation-report.md`)
is complete** with the verification evidence.

**WP-8 CLOSED** — implementation through WP-8-M accepted; committed
implementations, reports, tests, and commit history are the accepted
evidence.

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
> `ASSURANCE-REVALIDATED`** — the historical closure statement above
> remains historical evidence. Model: historical closure → retrospective
> assurance findings → forward corrections → independent rereviews →
> closure assurance revalidated. Migration remains deferred (DS-13 /
> §23.2); compaction remains non-MVP/deferred; the remaining
> adjudication-only states remain intentional; the next work package
> remains WP-9.

**WP-9 (MCP inspection surface) — CLOSED. Implementation complete;
Slices 1-4 committed (`b3cde8b…`, `0f3ac3a…`, `d5418f7…`, `ef118fc…`);
Slice 5 (local stdio MCP runtime) committed at
`045ae7c2f4a980d392333ac6823e33ffa5513d24` after the F1-F3 focused
rereview closed all three startup-config findings; TRANSPORT DECISION:
LOCAL STDIO (recorded in the transport/runtime decision analysis);
closure independently accepted
(`docs/reports/wp-9-mcp-inspection-surface-closure-report.md`);
WP-9 CLOSED — no remaining implementation work; no later work package
started or authorized**
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
require it); remains remaining work. Strict closed-field request
validation; deterministic public error taxonomy (invalid-request /
not-found / unsupported / limit-exceeded / invalid-cursor / stale-cursor /
integrity-conflict / adapter-error); host-supplied trusted store targeting
(genuine branded trusted input + strict store verification at context
construction; MCP clients never select roots, stores, or namespaces);
deep-frozen redacted responses; zero filesystem/mutation imports (static
proof). The `./mcp` package subpath is the only package-export change;
`./mcp` exposes no storage authority. **Slice 1 historical note:
independent review returned `CORRECTIONS REQUIRED` (F1: `validate-artifact`
success responses failed to echo `requestId`); the narrow F1 correction was
applied (success requestId echo uniform across all three tools) and Slice 1
was accepted and committed at `b3cde8bdf853452b57401812708fb3096a65da45`**;
acceptance of Slice 2 is not declared by the implementation.
Remaining WP-9 work: WP-9 generation seeding (semantics undefined in the
repository; not required by any committed slice; removed from WP-9 closure
criteria by the generation-seeding decision). Transport decision: LOCAL
STDIO — the Slice 5 runtime implements it; Secure MCP Tunnel / ChatGPT
connectivity remains WP-14-owned.

- **WP-8-N configuration migration DEFERRED** (human decision (c)
  Deferral) under DS-13 / §23.2 (DCS-002): the live configuration
  transition primitive is intentionally undefined;
  `ConfigurationSnapshotRecord` production deferred with it; WP-8M
  same-version configuration recovery complete and unchanged. No
  contract clause makes DS-13 resolution a WP-8 closure prerequisite —
  **not a blocker**.
- **Compaction DEFERRED / NON-MVP**: no normative WP-8 MVP completion
  rule requires it; the contract prohibits silent compaction of
  indefinite-retention classes (TAX-009, RNT-002) but mandates no
  compaction capability.
- **Remaining adjudication-only classes** (wrong-type/wrong-UID-mode/
  unexpected-hard-link quarantine objects, foreign objects, tamper-class
  records, dangling audits, leftover recovery-break guards):
  **INTENTIONALLY ADJUDICATION-ONLY — not blockers**; contract-defined
  external-disposition boundaries (WPR-023, LOK-020, §16.7); no
  automatic-mutation obligation; deletion authority not broadened.
- **Lifecycle approval decisions**: later-owned by WP-12 (TAU-009 —
  maintenance procedures never invent lifecycle decisions).
- **Later packages**: WP-9 generation seeding removed from WP-9 closure
  criteria by the generation-seeding decision; WP-12 integration
  later-owned.
- **Current work package: WP-9 (MCP inspection surface) — CLOSED.**
  Read-only inspection MCP tools; prerequisites WP-7 and WP-4 satisfied;
  inspection-only, no mutation tools; slices 1-5 committed (Slice 5 at
  `045ae7c2…`); transport decision LOCAL STDIO; F1-F3 startup-config
  corrections closed by the focused rereview; **IMPLEMENTATION COMPLETE**
  (distinct from WORK PACKAGE CLOSED); independent closure review
  ACCEPTED — **WORK PACKAGE CLOSED**.
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
  registration of `draft-artifact` — the runtime now serves exactly seven
  tools (six WP-9 inspection + one WP-10 drafting), with
  same-registry-instance host composition (one `SchemaRegistry` per
  logical surface shared by inspection and drafting) and a shape/type-only
  SDK input schema.
  WP-10 was
  independently closure-reviewed with zero substantive findings and is
  **CLOSED** (implementation complete; remaining WP-10 implementation
  work NONE; controlled-reader drafting assist is not required for the
  closure gate; authoritative closure report:
  `docs/reports/wp-10-artifact-drafting-tools-closure-report.md`) (WP-9's
  six-tool inspection inventory unchanged). The
  next work package remains subject to separate authorization. WP-11
  is **CLOSED** (`9695c5d`); WP-12 is **CLOSED** (`164b8a0`); WP-5B is
  **CLOSED** (`1067d5c`); the current phase is the WP-13 pre-implementation
  contract decision (see the current-state note above); WP-14 remains
  blocked by WP-13 (see the current-state note above).

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

- **WP-5B eligibility** — **ELIGIBLE**: WP-6 (ceilings, workspace
  identity), WP-7, and WP-12 (activation decisions) are closed (ADR-023
  satisfied); ADR-037 authorization is closed; the pi-guard trusted
  projection interface **exists** — implemented and released in
  **pi-guard v0.1.2** (release commit
  `7a7580cc4cbd7926797564c72269394fc29a860a`; annotated tag `v0.1.2`
  resolves to that commit) — and the **v0.1.2 compatibility lane is
  VERIFIED** against `pi-guard-compatibility-and-authority-projection.md`
  Parts B/D (predicate 12–17 plus the retained v0.1.1-compatible
  predicate), with the normative `inventoryFingerprint` golden vector
  converged and preserved pi-guard evidence (unit 305/305, process
  22/22, integration 27/27, total 354/354, typecheck clean). The
  previous projection-interface blocker is fully resolved. **WP-5B is
  ELIGIBLE — READY FOR HUMAN IMPLEMENTATION AUTHORIZATION**; WP-5B
  implementation remains not started.
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
  and not started. The separate pi-guard-side interface authorization
  required by ADR-026 is now granted by ADR-037
  (`ADR-037-pi-guard-trusted-projection-interface-authorization.md`);
  the pi-guard v0.1.2 implementation and its compatibility-lane
  verification are now complete (pi-guard v0.1.2 released at commit
  `7a7580cc4cbd7926797564c72269394fc29a860a`, tag `v0.1.2`; lane verified
  and recorded).

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

- pi-guard 0.1.1 (historical) has no external authority-projection input
  API; the trusted projection interface is provided by the released
  **pi-guard v0.1.2** lane (release commit
  `7a7580cc4cbd7926797564c72269394fc29a860a`; annotated tag `v0.1.2`;
  lane verified against the Gateway contract) — the previous
  implementation/lane-verification deferral is resolved. Not an
  unresolved architecture decision of this package.
- The v1 capability vocabulary is approved (ADR-025 Accepted); no
  implementation consumes it before a separate WP-6
  implementation-authorization decision.
