# WP-8-A Foundation and Contract-Consolidation Report

**Status:** WP-8-A — Foundation and Contract Consolidation — human-authorized, documentation-only. The senior contract review returned corrections required (W8A-C01…W8A-C13); the first focused rereview returned additional corrections required (W8A-R01…W8A-R08); the final focused contract rereview returned `WP-8-A FINAL FOCUSED CONTRACT REREVIEW: CORRECTIONS REQUIRED` with zero BLOCKER, zero MAJOR, zero MODERATE findings and four MINOR findings (W8A-F01…W8A-F04); the final documentation spot check returned `WP-8-A FINAL DOCUMENTATION SPOT CHECK: CORRECTIONS REQUIRED` with one remaining MINOR finding (empty `CSR-010` requirement body); the final micro documentation correction restored the `CSR-010` normative body and removed the duplicated content from `CSR-016`; the **final micro spot check returned `WP-8-A FINAL MICRO SPOT CHECK: ACCEPTED` with `OPEN FINDINGS: 0`**; the **WP-8-A contract is accepted** and the **WP-8-A baseline commit is the commit containing this update** (`docs: establish WP-8-A contract baseline`). WP-8 implementation is **not** authorized; WP-8 is **not** closed; WP-9 and later packages are **not** authorized. No push, release, publication, installation, or deployment has occurred.

**Report scope:** consolidation of the accepted architectural inputs into the authoritative implementation-neutral WP-8 contract (`docs/specs/wp-8-local-storage-registry-contract.md`), resolution or explicit phase-bounded deferral of the decisions required before implementation, the senior-review correction cycle, and current-state planning synchronization.

---

## 1. Repository, Branch, and Baseline

| Item | Value |
|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` |
| Branch | `main` |
| Baseline HEAD (WP-7 closure) | `6b94d811dac8c41062ea4cbd57e56b1fe39b6419` |
| HEAD subject | `test: close WP-7 controlled inspection` |
| HEAD parent (WP-7-B) | `7fa2b15c8bab8b373751affac08acc3e9225aba8` |
| Working tree / staging / untracked / tags | clean / empty / zero / zero (before this phase's edits) |
| Commits after baseline | zero |
| package-lock SHA-256 | `0fe11d74491a1d6b8a10a6969848a106c1f472417a4cb102b09fcfe7d7b4f0ff` |
| Dependencies | `ajv@8.20.0` only |
| Public exports | 42 (unchanged; zero WP-8 additions) |
| Package exports | `"."` and `"./pi-adapter"` only (unchanged) |

## 2. Authorization

The human authorized (WP-8-A foundation and contract-consolidation authorization, including the senior-review correction cycle): authoring and correcting the authoritative WP-8 contract under `docs/specs/`; creating and maintaining this foundation report under `docs/reports/`; current-state synchronization of `docs/design/post-wp5a-roadmap.md` and `docs/design/post-wp5a-planning-status.md`; and read-only inspection of repository material. Not authorized: production or test implementation, schemas/rules/fixtures/vectors/corpus changes, adapter, package, dependency, export, control-plane, approval/issuance, execution, MCP, Pi, pi-guard, staging, commit, push, tag, publication, release, installation, deployment.

## 3. Senior Contract Review Chronology

1. **WP-8-A initial delivery** — contract (`3019815b…`), foundation report, planning sync; 267 requirements, 24 error codes, 17 record classes, 12 operations.
2. **Senior contract review verdict:** corrections required — seven MODERATE findings and six MINOR findings.
3. **Normalized correction register (W8A-C01…W8A-C13):**

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| W8A-C01 | MODERATE | trusted-configuration-store persistence and bootstrap unspecified | CLOSED — CSR section; two-namespace bootstrap model; no circular trust |
| W8A-C02 | MODERATE | root ownership/permission policy contradictory | CLOSED — deterministic policy (service UID, 0700/0600, no group/other write, ACL write-grant unsupported, no config relaxation) |
| W8A-C03 | MODERATE | collision-safe publication primitive impossible as written | CLOSED — hard-link publication protocol with no-replace semantics and EEXIST verification |
| W8A-C04 | MODERATE | filesystem compatibility lane and capacity/read-only failures underdefined | CLOSED — FSL section; initialization probe; six dedicated filesystem error codes |
| W8A-C05 | MODERATE | writer-lock model contradicts stale-lock recovery | CLOSED — normative lock record, confirmed-stale classification, explicit recovery authority, liveness-undeterminable rule |
| W8A-C06 | MODERATE | security/resource limits lack hard ranges and configuration binding | CLOSED — complete 20-limit table; hard maxima; profile bound to configuration version/identity + store metadata |
| W8A-C07 | MODERATE | write-capability creation/possession/transfer/revocation/forgery incomplete | CLOSED — CAP section; gated opaque capabilities; in-process only; non-transferable; non-serializable; revoked by disposal/config replacement |
| W8A-C08 | MINOR | identifier path encoding not exact/version-bound | CLOSED — exact lowercase-hex encoding, shard rule, bounds, rejection, test vectors (Appendix H), layout-version binding |
| W8A-C09 | MINOR | recovery/retention evidence taxonomy ambiguous | CLOSED — single `StoreEvidenceRecord` class with closed `evidenceKind` discriminator; the taxonomy contains 18 record classes after adding `ConfigurationSnapshotRecord` (W8A-R03) |
| W8A-C10 | MINOR | full-store rollback and full-rewrite tamper limitations unstated | CLOSED — TML section; explicit limitations and extension points; no rollback-resistance claim |
| W8A-C11 | MINOR | recovery-generated audit reconstruction underspecified | CLOSED — CSA-013/014, AUD-011/012; distinct kind, gap marker, recovery-time timestamp, idempotency |
| W8A-C12 | MINOR | Appendix E does not map all normative requirements | CLOSED — complete per-prefix acceptance mapping; TVR-013 mechanical completeness verification |
| W8A-C13 | MINOR | error mapping, precedence, retry state, disclosure claims inaccurate | CLOSED — many-to-one deterministic mapping; precedence; per-code phase/state/durability/audit/verify semantics; expanded disclosure prohibitions; report claims corrected |

4. **Focused contract rereview (first):** corrections required — five remaining MODERATE findings and three MINOR findings (W8A-R01…W8A-R08), plus a non-blocking phase-decomposition ambiguity concerning configuration seeding. The earlier statements that "all thirteen findings are closed" and "none open" were **premature** and are superseded by this register.
5. **Second focused correction (this cycle):** closes W8A-R01…W8A-R08 and the phase-decomposition clarification:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| W8A-R01 | MODERATE | identifier path-encoding algorithm contradicts Appendix H and the path-component limit | CLOSED — one normative model: parse canonical WP-2 identifier, extract the 32-hex opaque component verbatim, shard from its first 4 characters, kind only in the parent namespace; length arithmetic fits `pathComponentBytes`; Appendix H contains four acceptance vectors, seven rejection vectors, and one additional shard-check example |
| W8A-R02 | MODERATE | temporary-directory unlink not durably synchronized | CLOSED — normative order: link → final-dir fsync → unlink temp → tmp-dir fsync → audit; durability point includes durable temp-name removal; stage failure semantics per 10.5; crash-reappearing temp classification (WPR-023, CSA-015) |
| W8A-R03 | MODERATE | configuration update/current-selection/history semantics unspecified | CLOSED — append-only immutable `ConfigurationSnapshotRecord` (new store class, taxonomy 18); monotonic revision, predecessor linkage, unique verified chain head selection; genesis/replay/fork/gap/rollback behaviors; WP-8 derives structure, never policy acceptance |
| W8A-R04 | MODERATE | read-only-filesystem error state and malformed-versus-version precedence incomplete | CLOSED — phase-aware ERR-STO-READONLY-FS rows (pre-publication / post-primary-publication / post-audit-publication); error precedence normed (ERM-007, ERM-014); phase-aware ERR-STO-READONLY-FS semantics (ERM-015) |
| W8A-R05 | MODERATE | capability unforgeability overbroad and insufficiently scoped | CLOSED — scoped guarantee within the supported runtime and module boundary; private-brand mechanism (CAP-014); explicit non-authentic channel list (CAP-015); forwarding/capture rules (CAP-016); DS-18 updated; TVR-014 hostile-channel tests |
| W8A-R06 | MINOR | ACL-presence policy not implementable on the stdlib-only lane | CLOSED — effective-permission model (SRX-007/014/015, FSP-015): exact-mode verification, group/other zero, ACL mask → nonzero group bits → exact-mode check fails; harmless ACL metadata ignored; descriptor-bound fchmod+fstat; no getfacl, no dependency |
| W8A-R07 | MINOR | limit-table count inaccurate | CLOSED — table verified at **20** normative limits; all "21" statements corrected; no redundant row added |
| W8A-R08 | MINOR | foundation-report closure claims premature | CLOSED — this chronology; no acceptance, zero-findings, or readiness-for-baseline-commit claims made |
| (I) | NOTE | phase-2/phase-3 configuration-seeding ambiguity | CLOSED — phase 2 may define/validate formats and identities and (only if explicitly authorized) create empty namespaces/metadata; persistent configuration-record publication (including seeding the first version) belongs to the durable publication phase or later (FPH-005) |

6. **Final focused contract rereview:** `WP-8-A FINAL FOCUSED CONTRACT REREVIEW: CORRECTIONS REQUIRED` — zero BLOCKER, zero MAJOR, zero MODERATE findings; four MINOR findings (W8A-F01…W8A-F04); all substantive architecture, authority, filesystem, durability, configuration-chain, capability-authenticity, and error-model findings already closed.
7. **Final bounded documentation correction (this cycle):** closes W8A-F01…W8A-F04:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| W8A-F01 | MINOR | stale identifier-encoding terminology in DS-25 and §5.4 | CLOSED — DS-25 now states the parse-and-extract model; §5.4 uses "identifier-derived shards"; no encoding algorithm, vectors, limits, layout, suffix, grammar, or derivation changed |
| W8A-F02 | MINOR | foundation-report counts, ranges, vector wording, and citations stale | CLOSED — 20-limit wording, 18-class taxonomy, DS-01…DS-29 summary, FPH-001…005, TVR-001…015, R01 vector composition (four acceptance + seven rejection + one shard-check example), R04 citations (ERM-007/014 precedence; ERM-015 phase-aware EROFS); historical counts preserved where labeled as earlier deliveries |
| W8A-F03 | MINOR | ACL test wording refers to ACL presence rather than effective access | CLOSED — TVR-004 and §26.1-D now require "ACL effective-grant denial"; no getfacl, no dependency, no literal rejection of harmless ACL metadata |
| W8A-F04 | MINOR | mid-operation capability invalidation semantics not explicitly normative | CLOSED — CAP-008/009/014 extended: admission capture of brand/generation/store/snapshot/operation-set/limit-profile/lifetime; revalidation at every mutation boundary; phase-aware outcomes (pre-mutation abort, post-publication verify-required, durable-state authoritative with idempotent replay); no new error code (31 retained); no new requirement (364 retained); TVR-014, Appendix C, Appendix E, DS-18 updated |

8. **Final documentation spot check:** `WP-8-A FINAL DOCUMENTATION SPOT CHECK: CORRECTIONS REQUIRED` — zero BLOCKER, zero MAJOR, zero MODERATE findings; one remaining MINOR finding: `CSR-010` has an empty normative requirement body while its intended content appeared duplicated at the end of `CSR-016`. All other spot-check items (W8A-F01…F04 terminology, report counts and citations, ACL test wording, mid-operation capability invalidation, inventories, matrices, planning) verified clean.
9. **Final micro documentation correction (this cycle):** restores the `CSR-010` normative body (fail-closed handling of configuration-store tamper, unsupported-version, malformed-record, and integrity failures under ITG/VRS/RFM/ERM, plus the recovery non-reinterpretation gate) and removes only the corresponding duplicate tail from `CSR-016` (which retains only its current-selection responsibility). No requirement ID added, removed, or renumbered; no semantic requirement lost or duplicated; inventory remains 364/31/18/12/29/20; no other contract area changed.

**Final micro spot check:** `WP-8-A FINAL MICRO SPOT CHECK: ACCEPTED` — `OPEN FINDINGS: 0`; the WP-8-A contract is **accepted**; the WP-8-A baseline commit (subject `docs: establish WP-8-A contract baseline`) is authorized and is the commit containing this update. WP-8 implementation remains **not** authorized; WP-9 and later packages remain **not** authorized; no push, release, publication, installation, or deployment has occurred.

## 4. Exact Input Inventory

| Path | Owning WP | Role in WP-8 | Authority status | Material constraints contributed |
|---|---|---|---|---|
| `docs/design/project-gateway-scope-and-principles.md` | WP-0 | Product boundary, trust zones, workspace/storage boundary | Accepted, committed | Trusted-local state outside repositories; non-normative local-state layout sketch; lifecycle separation; no repository-derived authority |
| `docs/decisions/ADR-002-trust-and-approval-boundary.md` | WP-0 | Trust/approval boundary | Accepted | Persistence independent of repository content (l.42); formats/storage/signing deferred; store-in-repo rejected; digest-bound approvals; record classes remain outside repository |
| `docs/decisions/ADR-023-post-wp5a-sequencing.md` | Planning | Sequencing | Accepted | Execution order `WP-6 → WP-7 → WP-8 → WP-9 → …`; WP-8 → WP-12 edge |
| `docs/decisions/ADR-024-trusted-workspace-and-ceiling-configuration-ownership.md` | Planning | Store ownership incl. configuration store | Accepted | Trusted store is WP-8 persistence; **trusted-configuration-store persistence assigned to WP-8**; written only by explicit control-plane actions; no other component mutates it |
| `docs/decisions/ADR-025-capability-vocabulary-and-versioning.md` | Planning | Vocabulary context | Accepted | Capability vocabulary consumed by configuration, not by storage |
| `docs/design/trusted-workspace-and-ceiling-configuration.md` | WP-6 (contract) | Store-root and configuration source | Accepted | Store root from trusted configuration; configuration versioning/update ownership; containment terminology |
| `docs/specs/wp-6-phase-3-point-of-use-v2-contract.md` | WP-6 Phase 3 | Internal-boundary and containment terminology | Accepted (implementation complete) | Internal barrel pattern; descriptor-bound verification; containment evaluation terminology |
| `docs/design/artifact-identity-versioning-reference-lifecycle-protocol.md` | WP-2 | Record taxonomy, identity, envelope, registry semantics | Accepted | 13 trusted lifecycle record classes with owners, binding targets, immutability/revocability; opaque identities; digest syntax; registry-snapshot canonicalization; envelope prohibitions |
| `docs/design/artifact-domain-model.md`, `artifact-responsibility-matrix.md`, `glossary.md` | WP-1 | Vocabulary and responsibility | Accepted | Record-class vocabulary; trusted receipt semantics; producer/consumer boundaries |
| `docs/design/artifact-schema-and-validation-profile.md`, `artifact-core-validation-engine.md`, `artifact-core-architecture.md`, `artifact-core-public-api.md` | WP-3/WP-4 | Canonicalization and validation profile | Accepted | JCS canonicalization, duplicate-key rejection, NFC rules, strict unknown-field policy, digest rules |
| `docs/decisions/ADR-020…022`, `docs/design/pi-adapter-*.md` | WP-5A | Adapter boundary | Accepted | Pi adapter has no store access; no adapter registration by WP-8 |
| `docs/decisions/ADR-026/027`, `docs/design/pi-guard-compatibility-and-authority-projection.md` | WP-5B | Later consumer | Accepted (package not begun) | Enforcement projection consumes verified state later |
| `docs/specs/wp-7-controlled-reader-git-fff-contract.md` | WP-7 | Consumer interface; WP-8 as future internal consumer | Accepted, closed | SCO-005 (WP-8 discovery inputs), SCO-011 (WP-7 MUST NOT implement persistence), INT-001/PKG-005 (internal composition), supported lane, RO-005 atime convention |
| `docs/design/post-wp5a-roadmap.md`, `post-wp5a-planning-status.md` | Planning | Official definition and status | Accepted, closed | WP-8 definition; deferred items owned by WP-8 (retention, trusted-local layouts) |
| `docs/reports/post-wp5a-sequencing-resolution-report.md`, `wp-6-phase-*-…reports.md`, `wp-7a/wb/wc-…reports.md` | WP-6/WP-7 | Chronology and closure evidence | Accepted, closed | Closure baselines; WP-6 closed `b07fea9…`; WP-7 closed `6b94d81…` |
| `src/registry/evaluate.ts`, `src/lifecycle/graph.ts`, `src/index.ts` | WP-2/WP-4 | Existing semantics (read-only reference) | Committed | Registry-snapshot evaluation and lifecycle graph validation exist as pure caller-supplied evaluation; no persistence; WP-8 consumes, never reimplements |
| `src/reader/index.ts` | WP-7 | Internal barrel for future consumers | Committed | Composition pattern for WP-8 read inputs |

**Input disagreements found:** none material. All documents agree on: store outside repositories; control-plane-only mutation; WP-8 owns persistence (including the configuration store, ADR-024), not decisions; deferred formats/signing/storage technology.

## 5. Authority and Chronology Analysis

Commit chain: WP-6 closed `b07fea95d0a1ed20361dec441fc500766969536f`; WP-7-A `64623c78b167c9aa50ab9c2e5f146e7cc9741c34`; WP-7-B `7fa2b15c8bab8b373751affac08acc3e9225aba8`; WP-7 closed `6b94d811dac8c41062ea4cbd57e56b1fe39b6419`. No intervening commit invalidates the chain. Post-WP-5A planning package (`97022a49d9029449f304a2b1e47f9dc8da4d4a89`) and ADR-023…027 (Accepted) establish WP-8's definition and prerequisites. WP-8-A is the first WP-8 phase; the human-established identifier is **WP-8-A — Foundation and Contract Consolidation**.

## 6. Exact Changed-Path Inventory

| Path | Status | Purpose |
|---|---|---|
| `docs/specs/wp-8-local-storage-registry-contract.md` | new (corrected) | Authoritative WP-8 contract (this phase's primary deliverable) |
| `docs/reports/wp-8a-foundation-contract-consolidation-report.md` | new (corrected) | This report |
| `docs/design/post-wp5a-roadmap.md` | modified (current-state wording only) | Planning synchronization |
| `docs/design/post-wp5a-planning-status.md` | modified (current-state wording only) | Planning synchronization |

No other path changed. No source, test, schema, rule, fixture, vector, corpus, adapter, package, dependency, or export file was touched. No WP-8 implementation exists.

## 7. Official WP-8 Definition and WP-8-A Identifier

**WP-8 — Local storage and registry** (roadmap table row 3): trusted-local persistence for lifecycle records, approvals, grants, receipts, audit events (ADR-002) and trusted-local directory layouts; inputs WP-6 configuration and WP-7 discovery; outputs durable registry/storage contract; owned: storage and registry persistence; prohibited: authority issuance, execution; invariants: repository cannot forge stored state, crash-safe, path-contained; closure gate: durable, crash-safe, path-contained storage; repository cannot forge stored state. Corrected scope adds: trusted configuration-store persistence (ADR-024).

**WP-8-A — Foundation and Contract Consolidation** (human-established identifier): documentation-only phase producing the implementation-neutral contract and this foundation report; no implementation.

## 8. Ownership and Prohibited Boundary (contract §1–2, 20–21)

WP-8 owns: trusted-local persistence (record/registry store and configuration store); record formats; trusted-local directory layout; durable storage of lifecycle records, approvals, grants, receipts, audit events; integrity and tamper evidence (with documented TML limits); crash safety; path containment; retention and recovery semantics; internal storage/registry interfaces; capability boundary; implementation verification requirements. WP-8 consumes but does not own: Artifact Core validation/lifecycle semantics; WP-6 configuration semantics and PointOfUse-v2; WP-7 reader/Git/FFF; identity/revision/canonicalization/digest/reference semantics. WP-8 must not own: approval/issuance/grant/revocation decisions; execution authorization or triggering; Pi invocation; pi-guard projection/enforcement; ChatGPT drafting; MCP tool registration; adapter ownership; public API expansion; trusted key issuance; release/deployment.

## 9. Contract Structure

29 normative areas (SCP, TAU, CSR, SRX, LAY, TAX, RFM, ITG, TML, WPR, FSL, LOK, RDS, RGY, RNT, CSA, FSP, ERM, LMT, API, CAP, AUD, VRS, DTM, SRE, TVR, CLE, DCS, FPH) plus appendices A–H. Implementation-neutral: required properties normative (hard-link publication, fsync, single writer, exclusive creation, compatibility probe); no database/library/dependency chosen; technology choice deferred to the implementation phase.

## 10. Corrected Requirement Counts

SCP 10, TAU 10, CSR 16, SRX 15, LAY 14, TAX 14, RFM 14, ITG 12, TML 8, WPR 23, FSL 10, LOK 18, RDS 12, RGY 10, RNT 10, CSA 15, FSP 15, ERM 15, LMT 13, API 12, CAP 16, AUD 13, VRS 10, DTM 8, SRE 15, TVR 15, CLE 8, DCS 8, FPH 5. **Total: 364 normative requirements** (was 267 at initial delivery, 340 after the first correction). All IDs unique (verified mechanically); no WP-7 requirement IDs reused; inventory arithmetic exact.

## 11. Operations, Taxonomy, Errors

- **Operations (12):** initialize (incl. compatibility probe and config namespace); authorized write; read; verify; enumerate; resolve registry state; inspect audit history; detect corruption; recovery scan; retention execution; format verification; migration (future, gated). Mapped in Appendix B.
- **Record taxonomy (18 classes):** the 13 WP-2 lifecycle classes, `AuthoritativeAuditEvent`, accepted registry snapshots, store metadata, the unified `StoreEvidenceRecord` with a closed `evidenceKind` discriminator (W8A-C09), and `ConfigurationSnapshotRecord` (W8A-R03, store class in the configuration namespace). Semantics owned by WP-2/WP-12; persisted form by WP-8.
- **Errors (31 closed codes):** the original 24 plus ERR-STO-NO-SPACE, ERR-STO-QUOTA-EXCEEDED, ERR-STO-READONLY-FS, ERR-STO-CROSS-DEVICE, ERR-STO-FS-UNSUPPORTED, ERR-STO-IO-FAILURE, and ERR-STO-LIMIT-EXCEEDED. Deterministic many-to-one condition mapping with per-code phase, retryability, recovery, primary-state, durability-point, audit, and verify-before-retry semantics; ERR-STO-READONLY-FS carries phase-aware rows (W8A-R04); malformed-versus-version precedence defined; capacity/quota/read-only/unsupported-filesystem conditions never map to the internal-invariant code.
- **Limits (20 normative rows):** table verified at 20 rows (W8A-R07); all prose corrected from "21".

## 12. Senior-Review Correction Summary (per finding)

- **W8A-C01 — Configuration store and bootstrap:** CSR section: bootstrap locator is a trusted host/control-plane input (never env/request/repo/WP-8 record); `config-v1/` and `store-v1/` are sibling versioned namespaces under one trusted parent; the record-store root is derived without trusting either namespace's contents; explicit control-plane-authorized initialization; config-store persistence/integrity/recovery/permissions/versioning/tamper covered by the same substrate; namespace-scoped recovery; config recovery never invents policy; non-confusable identities; deterministic overlap rules. No deferral needed — ADR-024's assignment is contracted.
- **W8A-C02 — Permission policy:** deterministic policy (SRX-006…009): trusted service UID; dirs `0700`; files `0600`; no group/other write; ACL or extended mechanisms granting another principal write access are unsupported and fail closed; inability to verify policy fails initialization; trusted configuration cannot relax; relaxation requires a contract-version change. Contradiction removed.
- **W8A-C03 — Publication protocol:** hard-link protocol (WPR-003…007, 015…020): unique exclusive-created temp under `tmp/`; complete canonical bytes; temp fsync; identity/type verification; `link(2)` to final path; `EEXIST` → existing-target verification (identical bytes/digest → idempotent duplicate; different bytes → ERR-STO-DUPLICATE; conflicting revision or revision/digest mismatch → ERR-STO-CONFLICT-REVISION); unlink temp; final-directory fsync; crash semantics per stage (link-before-unlink, publication-before-dir-sync); cancellation/timeout per stage. Plain `rename` prohibited for immutable records.
- **W8A-C04 — Filesystem lane:** FSL section: bounded cleanup-safe initialization probe (same-device, hard link, dir/file fsync, O_EXCL, no-follow, case-sensitivity, no network/unsupported FS); deterministic mapping for ENOSPC/EDQUOT/EROFS/EXDEV/unsupported primitives/I/O/permission/remount; dedicated codes; state/durability semantics per code.
- **W8A-C05 — Lock model:** LOK section: fixed `locks/writer.lock`; O_EXCL|O_NOFOLLOW acquisition, mode `0600`, dir fsync; normative lock record (version, store-instance, nonce, trusted-action digest, PID, start time, boot identity, acquisition time, max age); process death does NOT remove locks; stale = boot mismatch OR confirmed dead (PID, start time); liveness-undeterminable → lock-unavailable, never stale; a live lock never becomes stale by timeout alone; only explicit recovery may break confirmed stale locks; evidence + audit; PID-reuse defense (start time + nonce); concurrent recovery fails closed. OD-002 resolved.
- **W8A-C06 — Limit profile:** complete 20-limit table (record/payload/references/path components/path bytes/dir entries/enumeration/audit events/records per transaction/temporary bytes/total scan entries/bytes/recovery scan/retained versions/lock wait/operation timeout/concurrent readers/writers/quarantine/index rebuild work) with default, hard min, hard max, source, config-selectability, request lower/raise, exact and +1 behavior, result, durability, and binding; profile bound to configuration version/identity, store metadata, and operation identity; security hard maxima contract-defined; no implementation-selected security limits.
- **W8A-C07 — Capability model:** CAP section: separate opaque capabilities (init, write, read, verify, recovery, retention, migration-later); mutation-capable creation gate (validated configuration snapshot + store identity + explicit control-plane request); trusted factory; operation-set binding; in-process possession; non-transferable; non-serializable; no worker/process crossing; cross-process mutation excluded from the MVP; no construction from JSON/paths/env/PIDs/records/repo content/requests; disposal or configuration replacement invalidates; generation nonce; use-after-dispose fails closed; no capture/forwarding; no capability-identity disclosure. DS-18 clarified: external authentication deferred; in-process model normative.
- **W8A-C08 — Path encoding:** exact lowercase-hex encoding of NFC bytes; 4-char shard; fixed suffixes and length bounds; injective; rejection rules; layout-version binding; test vectors (Appendix H); changes require new layout version + migration + compatibility tests.
- **W8A-C09 — Evidence taxonomy:** single `StoreEvidenceRecord` class with mandatory closed `evidenceKind` (recovery/retention/quarantine/lock-recovery/initialization/migration/audit-reconstruction); full class semantics; the taxonomy contains 18 record classes after adding `ConfigurationSnapshotRecord` (W8A-R03).
- **W8A-C10 — Tamper limitations:** TML section: MVP guarantee = accidental-corruption detection and internal consistency, NOT rollback resistance; explicit out-of-scope attacks (full rollback, tail deletion + metadata replacement, self-consistent rewrite, checkpoint/index replacement, replay); distinctions among corruption/consistency/repository-forgery/local-write-attacker/authenticity/rollback; extension points (signed checkpoints, external monotonic counters, protected anchors); no rollback claim before an anchor.
- **W8A-C11 — Recovery audit reconstruction:** CSA-013/014, AUD-011/012: distinct `recovery-audit-reconstruction` kind; recovery action identity; source evidence referencing the original record digest; sequence allocation with gap marker; recovery-time timestamps; idempotency and duplicate rejection; ordering after other recovery evidence; same durability point; bounded disclosure; never implies the original emitted the event; never creates lifecycle decisions.
- **W8A-C12 — Test mapping:** Appendix E now maps every prefix range to acceptance categories; TVR-013 requires mechanical completeness verification (no orphaned requirement, no nonexistent reference, every prohibited responsibility has a boundary test, every deferred feature has a gate test).
- **W8A-C13 — Error model and report claims:** many-to-one deterministic mapping; precedence (containment/root-identity → type/permission → content → integrity → version/malformed → lock → publication; cancellation/timeout before durability point = no state change; after = verify required); duplicate/conflict semantics; retry-after-unknown-ack verification; expanded disclosure prohibitions (trusted action identity, capability identity, store-instance identity, configuration digest, lock nonce, raw errno, absolute paths, record content, integrity metadata, signing/auth material, stack data); report claims corrected (see §17).

## 13. Decisions

The corrected decision register (contract §28) contains DS-01 through DS-29: resolved DS-01…DS-06, DS-08…DS-12, DS-14…DS-16, DS-19…DS-26, DS-28, DS-29; deferred DS-07 (signing), DS-13 (migration), DS-17 (multi-record atomic transactions), DS-18 (external authentication/cross-process attestation only), DS-27 (rollback anchor). OD-002 resolved; OD-001 and OD-003 remain open, non-blocking, with owners and gates. **Phase-bounded readiness:** no implementation-critical decision is ambiguous within the explicitly phase-bounded sequence of contract §29; phase 1 (non-mutating foundation) is fully unblocked; each later phase lists the decisions that must close before it.

## 14. Future Phase Decomposition (informative; not authorized)

1. Non-mutating format and validation foundation (no deferred decision gates it); 2. trusted-root and configuration-store bootstrap (DS-18 in-process model already normative); 3. durable single-record publication and exact reads (DS-01/02/08/09/10/21 resolved); 4. audit, registry indexes, and recovery (DS-03/11/14/26/28 resolved; DS-27 stays deferred within documented limits); 5. retention and later migrations (DS-13 must be explicitly authorized before migration work); 6. integration and closure. Each phase lists prerequisites, owned areas, prohibited areas, decisions to close first, and a review gate. No phase identifier is created; no phase is authorized (FPH-001…005).

## 15. Test and Verification Matrix

Contract §26 (TVR-001…015) requires categories A–I: contract/static (incl. encoding vectors and capability boundary); storage behavior; durability/crash injection at every write stage (incl. link/unlink/dir-sync); path/filesystem hostility (incl. ACL effective-grant denial); integrity/tamper (incl. TML negative tests); concurrency (incl. stale-lock classification and liveness-undeterminable); limits (exact and +1, capacity/quota/read-only injection); compatibility/determinism; mutation evidence (only the trusted store changes during an authorized storage mutation). Appendix E is complete; TVR-013 verifies mechanically and TVR-014/015 add capability hostile-channel/invalidation-boundary and effective-permission tests.

## 16. Unresolved Decisions

Deferred with owners and gates: DS-07 (signing), DS-13 (migration), DS-17 (multi-record atomic transactions), DS-18 (external authentication only), DS-27 (rollback anchor). Open non-blocking: OD-001 (exact trusted-parent directory convention), OD-003 (retention-policy configuration format). None blocks the phase-bounded sequence; all gates recorded.

## 17. Deviations, Findings, Blockers

**Deviations:** none — no accepted input contradicted; no requirement ID reused from WP-7; no authority boundary weakened. **Findings:** none open in this phase's scope; the two prior-report claims corrected per W8A-C13 — (a) the error model is now stated as deterministic many-to-one (not "1:1"); (b) the blanket "no implementation-critical decision remains ambiguous" is replaced by the phase-bounded statement of §13/§29; (c) the prior "findings: none" and "internally consistent" claims are replaced by audited, evidence-referenced statements; (d) all counts updated (340 requirements, 31 errors, 17 record classes, 12 operations); the second correction refreshed the counts to 364 requirements, 31 errors, 18 record classes, 20 limits, 29 decision rows, 12 operations. **Blockers:** none. **Notes:** (a) WP-0's layout sketch is non-normative (OD-001); (b) the WP-7-C closure-report header retains its pre-closure historical wording (superseded by its own §18; untouched); (c) the senior-review non-blocking notes are preserved as notes unless closed by the corrections above.

## 18. SHA-256 Values and Git State

| Path | SHA-256 (corrected) |
|---|---|
| `docs/specs/wp-8-local-storage-registry-contract.md` | computed at review (see final report) |
| `docs/reports/wp-8a-foundation-contract-consolidation-report.md` | computed at review |
| `docs/design/post-wp5a-roadmap.md` | computed at review |
| `docs/design/post-wp5a-planning-status.md` | computed at review |

Git state: HEAD remains `6b94d811dac8c41062ea4cbd57e56b1fe39b6419`; exactly four authorized documentation paths changed, all unstaged; staging empty; zero tags; package-lock and dependencies unchanged; no WP-8 implementation; no commit, push, tag, release, publication, installation, or deployment performed.

## 19. Readiness Verdict

The final documentation spot check verified all four bounded corrections (W8A-F01…W8A-F04) closed and inventories/matrices exact, with one remaining MINOR finding (empty `CSR-010` requirement body). The final micro documentation correction restored the `CSR-010` normative body and removed the duplicated content from `CSR-016`, preserving the mechanically audited inventory (364 unique requirements, 31 closed error codes, 18 record classes, 12 operations, 29 decision rows, 20 limits, appendices A–H, complete matrices) and making no architecture, authority, filesystem, durability, configuration-chain, capability-authenticity, or error-model changes. The final micro spot check accepted the corrected delivery with **zero open findings**; the **WP-8-A contract is accepted** and the **WP-8-A baseline commit** (subject `docs: establish WP-8-A contract baseline`) is the commit containing this update. WP-8 is **not** closed; WP-8 implementation is **not** authorized; WP-9 and later packages are **not** authorized; no push, release, publication, installation, or deployment has occurred.

**WP-8-A FINAL MICRO SPOT CHECK: ACCEPTED**
**OPEN FINDINGS: 0**
