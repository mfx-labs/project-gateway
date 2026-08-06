# WP-8-D — Pre-Implementation Decision Consolidation Report

**Status:** Documentation-only decision consolidation for the human-authorized
WP-8-D phase identifier (Component C / implementation Phase 3 of contract
§29): **Durable Single-Record Publication, Exact Reads, and Locking**. This
report establishes the operational baseline, eligibility, exact scope,
record-class inventory, capability/lock/publication/audit models, filesystem
ownership, test architecture, requirement allocation, and decision register
for WP-8-D. It authorizes **no** implementation, staging, commit, or later
phase. The WP-8-C independent commit verification was **SKIPPED BY HUMAN
DIRECTION** (governance fact; recorded in §2). The **WP-8-D senior
pre-implementation security and architecture review returned `ACCEPTED FOR
DECISION RESOLUTION`** with three bounded MINOR findings; the **seven
human-approved decisions (D-2, D-3, D-5, D-6, D-7, D-8, D-12) are applied
and bound by `docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md`**;
the **three MINOR findings are corrected** (§10, §15, §21/§22); the
**senior decision-resolution and ADR review returned corrections required**
(four findings M-1…M-4); the **focused decision-package correction applied
M-1…M-4** (provisioning authority pinned, §10; five-state classifier
policy, §10; taxonomy array rules, §6/§22; current status); the next
gate is the **WP-8-D focused decision-package rereview**.

---

## 1. Baseline

| Item | Expected | Verified |
|---|---|---|
| Repository root | `/home/chef/Documents/Project_Gateway_MCP` | `/home/chef/Documents/Project_Gateway_MCP` |
| Branch | `main` | `main` |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact match |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact match |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact match |
| Working tree | clean | clean (`git status --porcelain` empty) |
| Staging | empty | empty (`git diff --cached` empty) |
| Untracked files | zero | zero |
| Tags | zero | zero |
| Commits after HEAD | zero | zero |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` | exact match (byte-identical) |
| Dependencies | `ajv@8.20.0` only | exact match (`package.json` + lock unchanged) |
| Public exports | 42 | 42 (`dist/index.d.ts` audit; static guard 16/16) |
| Package exports | `"."`, `"./pi-adapter"` | exact match |
| `src/index.ts` | unchanged | unchanged (tree clean; no storage reference) |
| WP-8-C source | committed | 34 files under `src/storage/**` tracked at HEAD |
| WP-8-C tests | committed | 14 files under `tests/unit/storage/**` tracked at HEAD |
| Production action-provenance producer | absent | absent — `src/control-plane/` does not exist |
| Production initialization | unreachable | unreachable — `initializeTrustedStore` requires a genuine branded `TrustedStorageBootstrapInput`; the action-provenance creator has **zero production importers** (static-guard enforced; verified by grep) |
| WP-8-D runtime source | none | none — `src/storage/{publication,read,audit,registry,recovery,retention,lock,locks}` do not exist |
| WP-9 or later work | none | none — no `src/mcp`, `src/control*`, or other later-phase trees |
| Publication | none occurred | no publication capability exists anywhere |

Executed verification: `node --test dist-test/tests/unit/storage/static-guard.test.js
dist-test/tests/security/security.test.js` → **31/31 pass** (16 static-guard +
15 global security) at HEAD, confirming the committed guard, contract hash,
export, package, and dependency invariants still hold.

**Eligibility/decomposition input path note:** the input list names
`docs/reports/wp-8-implementation-phase-eligibility-and-decomposition-analysis.md`.
That file does not exist in the repository; the actual equivalent inputs are
the contract's **§29 Future Phase Decomposition** (FPH-001…005) and
`docs/reports/wp-8a-foundation-contract-consolidation-report.md` §14. The
report uses those as the equivalent path (documented deviation D-1).

## 2. Governance Waiver Record

**WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION**

The human explicitly waived independent verification of the WP-8-C commit.
This report does not claim: (a) the commit was independently verified; (b)
its full 31-file SHA-256 manifest was verified; (c) its commit report was
cryptographically reconfirmed. The target commit `bd832606…` is treated as
the operational baseline per direction. This is a governance fact, not a
finding.

## 3. Authority Chain

WP-0 scope and principles; ADR-002 (trust and approval boundary, Accepted);
ADR-023 (post-WP-5A sequencing, Accepted); ADR-024 (trusted workspace and
ceiling configuration ownership, Accepted); ADR-025/026/027 (Accepted);
ADR-028 (trusted storage bootstrap locator and WP-8-C decision baseline,
Accepted); approved Post-WP-5A planning package (commit
`97022a49d9029449f304a2b1e47f9dc8da4d4a89`); WP-6 closed
(`b07fea95d0a1ed20361dec441fc500766969536f`); WP-7 closed
(`6b94d811dac8c41062ea4cbd57e56b1fe39b6419`); WP-8-A contract baseline
(`0965d668204540073b1346947db1c6193f9fd4dc`); WP-8-B foundation baseline
(`b83120475a4c66606ebb72d9346cf15f10c2f00d`); WP-8-C decision baseline
(`05904e46ded384bab5f250ac72c2734539f1e86f`); WP-8-C implementation baseline
(`bd832606ece489a924b4fcc13ad55789fcb0736f`, this HEAD, accepted per the
WP-8-C implementation report; independent verification waived by human
direction). Authoritative contract: `docs/specs/wp-8-local-storage-registry-contract.md`
(SHA-256 `aeed2579…`, 364 normative requirements, 18 record classes, 31
error codes, 20 limits, 29 resolved decisions DS-01…29, OD-001/002 closed).
This report is documentation only and creates no phase authorization.

## 4. Phase Identity and Boundary

**WP-8-D** is the human-authorized identifier corresponding to Component C /
implementation **Phase 3** of contract §29: **Durable Single-Record
Publication, Exact Reads, and Locking**. Prerequisites confirmed:

- WP-8-B pure format and validation foundation committed (`b8312047…`):
  envelope, canonicalization, digests, identifier grammar, taxonomy,
  layout derivation, error codes/precedence, 20-limit profile,
  configuration snapshot/chain vocabulary.
- WP-8-C trusted root/bootstrap/capability framework committed
  (`bd832606…`): root resolution/identity/overlap, compatibility probe,
  provisioning, StoreMetadata bootstrap persistence and replay,
  trusted bootstrap input + action provenance, one-shot initialization
  capability.
- Namespace initialization and `StoreMetadata` exist; `store-v1` and
  `config-v1` roots with `metadata/` and `tmp/` are provisioned.
- Write, read and verification capability kinds exist as type vocabulary
  only (`CapabilityKind` in `src/storage/types.ts`); no issuance path.
- Only initialization has been exercised so far.
- No durable lifecycle/configuration-record publication exists; no
  single-writer lock implementation exists; no read/verify/enumeration
  storage implementation exists; no recovery/retention/registry
  implementation exists.

**WP-8-D owns only:** immutable one-record publication (hard-link
protocol); single-writer lock acquisition, live contention, timeout/
cancellation, identity-bound normal release; authorized-write capability
exercise; read capability exercise; verify capability exercise; exact read
by identity; verification by identity; bounded enumeration; the minimal
write-audit event required by the publication durability protocol; the
process-level crash-injection harness; the phase-applicable errors, limits,
and security enforcement.

**WP-8-D does not own:** registry derivation, retention, migration (contract
§29 phase-3 prohibition); stale-lock breaking, quarantine, recovery,
audit-history surface, configuration-record persistence (deferred; §16).

## 5. Eligibility

**WP-8-D PRE-IMPLEMENTATION DECISION CONSOLIDATION: ELIGIBLE** on the
verified baseline of §1. Every baseline and eligibility item was confirmed
exact; no mismatch was found; nothing was repaired.

## 6. Exact Record-Class Scope (18-class matrix)

Publication in WP-8-D is **mechanical and class-generic**: the publication
substrate accepts any validated class, but **production reachability is
determined by producer availability**, not by the substrate. WP-8-D's only
authorized production publication is the minimal write-audit event
(mechanical, evidence-only, AUD-005). WP-8-D must not become the semantic
producer of any WP-2/WP-12 record (TAU-010, TAX-002). Read/verify/enumerate
are class-generic surfaces (RDS-001…012, namespace-scoped) and are
available for every class except `StoreMetadata`, which is store-bootstrap
state read only through the metadata layer.

| Class | Semantic owner | Format defined in | First persistence phase | WP-8-D may publish | WP-8-D may read/verify/enumerate | Producer availability in WP-8-D | Reason |
|---|---|---|---|---|---|---|---|
| `ValidationRecord` | WP-2 | WP-8-B envelope (7.1) | WP-8-D (substrate) | No | Yes | None | WP-8-D is not the trusted validator; no control-plane producer exists (TAX-002, TAU-010) |
| `ApprovalRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted approver is WP-12-era; revocable-usability class, revocation via new record (TAX-005) |
| `IssuanceRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Same as above |
| `RevocationRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted revocation authority absent |
| `RuntimeGrant` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted grant authority absent |
| `ActivationRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted activation authority absent |
| `ExecutionOccurrenceRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted control plane absent |
| `ExecutionAttemptRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted execution recorder absent |
| `TrustedReceipt` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Receipt issuance is WP-15-owned (roadmap) |
| `ResultPublicationRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted result publisher absent |
| `SupersessionRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted lifecycle authority absent |
| `ExecutionSummaryRecord` | WP-2/WP-12 | WP-8-B envelope | WP-8-D (substrate) | No | Yes | None | Trusted reporting authority absent |
| `MigrationRecord` | WP-2/WP-12 | WP-8-B envelope | later phase | No | Yes (class-generic; no data exists) | None | Gated by **DS-13** (deferred, human authorization); production prohibited |
| `AuthoritativeAuditEvent` | WP-2/WP-12 | WP-8-B envelope (`audit-event`, `.aud`) | WP-8-D (write-audit event) | **Yes — one minimal event kind only: the authorized-write event at the publication durability point (WPR-010, AUD-001 "authorized write", 10.1 step 9)** | Yes | The store itself (mechanical, evidence-only; action identity from the write capability; AUD-005) | Required by the publication durability protocol; taxonomy production flag must be amended (`reconstruction-only` → + mechanical write-audit; decision D-6) |
| Registry snapshot (accepted) | WP-2 | WP-8-B envelope | phase 4 | No | Yes | None | Registry phase (RGY-008); snapshots and derived registry state belong to phase 4 (§29) |
| Store metadata | WP-8 | WP-8-B/C metadata profile | WP-8-C (done) | **No — never republished as an ordinary record** | No (metadata layer only) | store initialization | WP-8-C bootstrap state; excluded from the record read surface (TAX-007, STORE_METADATA_RELATIVE_PATH) |
| `StoreEvidenceRecord` | WP-8 | WP-8-B envelope (`evidence`, closed `evidenceKind`) | phase 4/5 | No | Yes (class-generic; no data exists) | None | Recovery/retention/maintenance phases (TAX-008/013); no recovery in WP-8-D |
| `ConfigurationSnapshotRecord` | WP-8 (store class, config namespace) | WP-8-B snapshot/chain | later configuration phase | **No** (deferred per this task's boundary) | Yes mechanically (namespace-scoped; no data exists) | None | Persistence belongs to the later configuration phase (see D-11: contract §29 phase-3 note is permissive; deferral recorded, not silently resolved) |

Boundary application note (task §3): the four task-specified boundaries
(ConfigurationSnapshotRecord deferral; registry snapshots → registry phase;
`StoreEvidenceRecord` → recovery/retention phases; `MigrationRecord` gated
by DS-13; StoreMetadata not republished) are applied as directed. The
contract **does not prove any of them wrong**; for
`ConfigurationSnapshotRecord` the contract is **permissive** (W8A-R08/I:
configuration publication "belongs to the durable publication phase (phase
3) or a later separately authorized phase"; FPH-005 forbids only
publication *before* phase 3). The deferral is therefore recorded as an
explicit decision item (D-11) rather than a silent resolution.

**Write-audit recursion (audit of audit).** Resolved from the contract, not
invented: §22.1 defines a **closed** list of audited events
(initialization; authorized write; idempotent duplicate; conflict; audited
reads where required; integrity failure; tamper detection; recovery;
recovery-audit reconstruction; retention; deletion; lock recovery;
configuration change; format migration). "Audit-event publication" is not
an audited event, so AUD-001 (every event class of 22.1 produces an audit
event) does not chain: the authorized-write event is the **terminal** audit
event of the publication operation. The write protocol has exactly one
audit step (10.1 step 9; WPR-010) and the transaction boundary is one
record per atomic unit with the audit event as a second ordered unit
(10.6) — the audit unit is not itself an audited action. Recursion
terminates by construction; no blocker arises. The `idempotent-duplicate`
and `conflict` event kinds of 22.1 are allocated to the audit phase (phase
4) — WP-8-D publishes only the authorized-write event (see §13).

## 7. Authorized-Write Authority Model

Consolidated from the committed WP-8-C capability framework (ADR-028
decisions B/C/E; `src/storage/capabilities/authenticity.ts`,
`src/storage/trusted-input/bootstrap-input.ts`) — **no second framework is
proposed**.

- **Private brand.** The existing module-private `WeakSet` mechanism
  (CAP-007/014, Model A) safely supports a write capability: a **new,
  separate** `WriteCapability` brand collection inside
  `capabilities/authenticity.ts` (already one of the two exact
  brand-bearing modules; no third brand module, no guard change for the
  brand itself). No shared/interchangeable brand; no exported brand state.
- **Creator path (exact).** `createWriteCapability` in
  `src/storage/capabilities/authenticity.ts`; imported by exactly one
  production module — the WP-8-D write composition boundary
  (`src/storage/publication/index.ts`). Not exported from the storage
  barrel, `src/index.ts`, or package exports. Naming is guard-safe
  (`createCapability` factory-marker regex does not match).
- **Creation gate (non-ambient).** Requires (a) a genuine branded
  `TrustedWriteRequest` (new semantically distinct domain in
  `src/storage/trusted-input/bootstrap-input.ts`, extending the ADR-028
  two-brand module: private `WeakSet`s for `StorageWriteActionProvenance`
  and `TrustedWriteRequest`; structural equality never establishes
  genuineness); (b) **verified store-instance identity** — both namespace
  identities from verified `StoreMetadata` (this is the first exercise of
  the ADR-028 decision-C gate "future capabilities may bind to verified
  metadata only after later human authorization"; the WP-8-D human
  authorization is that gate, recorded as decision D-5); (c) correlated
  trusted-configuration identity, configured service UID, limit-profile
  identity, and action identity. The action identity derives only from the
  genuine write-action provenance operand bound into the request — never
  as a separate or structurally assumed string.
- **Write-action provenance producer (future, not implemented).**
  `src/control-plane/storage-write-action.ts` — documented as the future
  sole production consumer of the write-provenance creator (mirroring
  ADR-028 decision B for bootstrap). **Not implemented in WP-8-D.**
  Static guard: while the producer does not exist, the write-provenance
  creator has **zero production importers**. Test-only producers confined
  to tests (never compiled/exported as runtime code).
- **Current/future consumer path.** Current: none (zero production
  importers of every new creator). Future: the trusted control plane
  (WP-12) through `src/control-plane/storage-write-action.ts`, then the
  WP-8-D write composition boundary. API-004 (write capability consumable
  only by the trusted control plane) is enforced by the zero-producer
  posture.
- **Exact action-provenance type.** `StorageWriteActionProvenance`
  (extension of the bootstrap module), binding action identity, store
  instance (namespace identities), configuration identity, service UID,
  limit profile, operation set `{record-publish}`.
- **Trusted-input correlation.** Exact equality/canonical identity
  correlation between the request operands: configuration identity,
  store-instance identities, service UID, limit-profile identity, action
  identity — the established bootstrap-input correlation pattern.
- **Store/configuration/limit-profile bindings.** Configuration identity,
  both namespace identities (store instance), selected limit-profile
  identity, generation nonce (reuse the existing
  `currentGenerationByStore` registry: configuration replacement advances
  the generation; stale capabilities fail closed), live/disposed state.
- **Exact operation set.** `{record-publish}` (the write-audit event is a
  required sub-step of the publication operation, not a separate
  capability operation).
- **Generation behavior.** Reuses the WP-8-C per-store generation
  registry; a new trusted-configuration identity advances generation;
  every use revalidates brand + generation + all bindings (CAP-008/010/014).
- **Disposal behavior.** `dispose()` kills every later use; use-after-
  dispose fails closed (CAP-009); disposal is idempotent.
- **Non-transferability.** In-process only; forwarding beyond the owning
  trusted component prohibited (CAP-005/016); consumers must not capture
  or store capabilities (CAP-011).
- **Serialization / structured-clone / Proxy / reflection /
  detached-method behavior.** Brand is not structurally representable;
  JSON, structured clone, spread, prototype imitation, Proxy, reflection
  lookalikes, worker messages, and captured/detached method references
  fail every verifier (CAP-015, TVR-014) — the existing
  `verify(this)`-style receiver-brand check pattern.
- **Package/barrel restrictions.** Creators never exported from
  `src/storage/index.ts`, `src/index.ts`, package exports, or any local
  re-export barrel (static guard, W8C-S05 pattern).
- **Static-guard requirements.** Exact creator-consumer edges for
  `createWriteCapability` (single consumer), the trusted-write-request
  creator (single composition boundary), and the write-action-provenance
  creator (**zero production importers**); future issuance markers
  remain denied globally.

**Non-constructibility (task §4).** The write capability cannot be
constructed from: record payload, repository content, MCP request, Pi task,
environment, argv, cwd, process UID alone, a plain action ID string, a
structural object, or an existing stored record — because the only creation
path requires the genuine branded `TrustedWriteRequest` (which itself
requires genuine branded write-action provenance) plus verified store
identity, and every use revalidates the private brand and all bindings.

**Producer posture decision (task §4).** **Zero production write-provenance
producers in WP-8-D.** Production publication is unreachable until a genuine
trusted control-plane producer exists (WP-12). The future consumer path
`src/control-plane/storage-write-action.ts` is documented (narrowly named)
and enforced by static policy (zero importers while absent). **No
public/test-hook escape is authorized or designed.**

## 8. Capability Revalidation Boundaries (CAP-009)

The write capability is revalidated (brand + generation + store-instance +
configuration + operation set + limit profile + lifetime) at admission and
at each boundary below. The lock file, lock directory, and `tmp/` objects
are **transient state, not trusted state**; the first trusted-state mutation
is the hard-link publication into `records/`. The audit event link is the
second trusted-state mutation.

| # | Boundary (CAP-009) | Invalidation error | Primary state | Audit state | Durability certainty | Verify before retry | Lock release permitted | Temp cleanup permitted | Rollback | Recovery | Success |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Immediately before lock acquisition (and before the first trusted-state mutation) | `ERR-STO-REQ-INVALID` (invalid capability operand) | no change | no change | none | no (fresh request) | n/a (not acquired) | n/a (none created) | n/a | no | prohibited |
| 2 | Immediately before primary publication (hard link) — temp and lock exist, all transient | `ERR-STO-REQ-INVALID` | no change (trusted state untouched) | no change | none | no (fresh request) | **yes** (containment: release own lock, identity-bound) | **yes** (remove own temp) | n/a (nothing durable) | no | prohibited |
| 3 | Immediately before required audit publication (after primary durable, temp unlinked, `tmp/` dir synced) | `ERR-STO-DURABILITY` class (verify-required outcome) | changed: yes, durable | not changed (audit not yet published) | primary: reached; audit: none | **yes** | yes (containment) | n/a (temp already removed) | **prohibited** — never fabricate rollback of durable primary (CAP-009, CSA-007) | yes (audit completeness; phase-4 reconstruction CSA-013) | prohibited |
| 4 | Immediately before reporting successful completion (after audit durable) | `ERR-STO-DURABILITY` class (verify-required); durable state remains authoritative, idempotent replay rules apply (CAP-009) | changed: yes, durable | changed: yes, durable | reached | **yes** (verify-required result, not ordinary success) | yes (containment) | n/a | prohibited | no (state durable; recovery only if a later stage failed) | prohibited (verify-required result instead) |

No invalidation outcome may fabricate rollback of already durable state; no
invalidation may silently swap an in-flight operation to newer
configuration (CAP-008 admission capture); no invalidation may erase
already durable state.

## 9. Single-Writer Lock Model

Consolidated from contract §12 (LOK-001…018; OD-002 **resolved** in
Appendix G: "RESOLVED (normative lock record fields, LOK-005)").

- **Path:** fixed per-namespace lock location `<namespace>/locks/writer.lock`
  (LOK-004; layout constant `WRITER_LOCK_RELATIVE_PATH = 'locks/writer.lock'`
  already exists in `src/storage/layout/layout.ts`).
- **Namespace ownership:** the lock file lives under the **written
  namespace's** `locks/` (5.2). WP-8-D writes only `store-v1`, so the
  exercised lock is `store-v1/locks/writer.lock`.
- **Per namespace or whole store:** the lock file is **per namespace**
  (LOK-004, 5.2); the single-writer rule of 12.1/DS-10 is stated
  **store-wide**. The two readings coexist in WP-8-D because only one
  namespace is written; cross-namespace single-writer exclusion is
  unexercised and is recorded as an ambiguity to resolve before the
  configuration phase (D-9).
- **Lock record fields (normative, LOK-005/12.3):** lock version;
  store-instance identity (both namespace identities); writer nonce
  (random, per acquisition); trusted action identity digest (safe
  reference); process PID; process start time; host boot identity where
  available; acquisition time; maximum age (from the limit profile,
  `lockWait`).
- **Exclusive no-follow creation:** `open(locks/writer.lock,
  O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY, 0o600)`; `EEXIST` = contention.
- **File mode and UID policy:** mode `0600`, configured trusted service
  UID, descriptor-bound `fstat` verification (SRX-006/014 pattern).
- **Lock-file fsync:** file `fsync` after writing the lock record.
- **Lock-directory fsync:** `fsync` of the `locks/` directory after
  creation (LOK-005 "followed by directory fsync").
- **Nonce and trusted action identity:** nonce from `node:crypto`
  `randomBytes` (contract-required randomness, 12.3 — requires the
  exact-module static-guard exception of D-3); action identity recorded
  as its digest (safe reference, 12.3), sourced from the capability
  binding, never from request strings.
- **Process identity fields:** PID (`process.pid`) and process start time
  (injectable; default derived at acquisition), never PID alone
  (LOK-015).
- **Boot identity:** recorded "where available" (12.3). WP-8-D has **no
  consumer** for it (stale classification is phase-4), so the field is
  recorded as unavailable/absent via an injectable source with no
  production default read — avoiding any out-of-store `/proc` I/O in this
  phase. The recovery phase wires the real source.
- **Acquisition deadline:** bounded by `lockWait` (LMT-008; default 5000
  ms, hard max 120000 ms).
- **Contention behavior:** an existing lock that cannot be positively
  treated as the caller's own live lock **fails closed** —
  `ERR-STO-LOCK-UNAVAILABLE` (LOK-008; WP-8-D never classifies stale and
  never breaks locks, LOK-009). Wait is bounded; expiry →
  `ERR-STO-LOCK-TIMEOUT` (LOK-011). In-process second-writer rejection →
  `ERR-STO-CONCURRENCY` where applicable.
- **Cancellation/timeout behavior:** during wait or during the write,
  leaves no partial trusted state and no orphaned lock claims (LOK-012);
  cancellation → `ERR-STO-CANCELLED` pre-publication (ERM-009).
- **Identity-bound release:** verify the lock record (nonce +
  store-instance identity) matches the caller's own acquisition before
  `unlink`, then `fsync` the `locks/` directory (LOK-013).
- **Release fsync behavior:** locks-directory `fsync` after unlink
  (LOK-013).
- **Failure after lock creation:** pre-publication failure paths release
  the caller's own lock (containment) after cleanup of own temp; lock
  release failure itself is mapped in §12 (row 22).
- **Release after capability invalidation:** permitted **only** as
  contract-required containment when the lock record positively matches
  the caller's own nonce + store instance (CAP-009); a mismatched lock is
  never touched.
- **Lock leakage after process crash:** the lock file remains (LOK-014);
  subsequent operations fail closed with `ERR-STO-LOCK-UNAVAILABLE` until
  explicit recovery (deferred); the crash harness asserts this (§14).

**Strict WP-8-D boundary:** acquisition; live-lock contention;
timeout/cancellation; identity-bound normal release. **Deferred to the
recovery phase (phase 4):** stale-lock breaking; confirmed-dead
classification used to mutate the lock; lock quarantine; lock-recovery
evidence (`lock-recovery-evidence`, LOK-010); concurrent recovery
(LOK-016); recovery audit reconstruction. In WP-8-D an existing lock that
cannot be positively treated as the caller's own live lock **fails closed
and is never broken**.

## 10. Publication Protocol

The contract's normative protocol is §10.1 (10 steps) with the corrected
durability point of 10.5 (W8A-R02) and the stage-failure semantics of 10.5/
WPR-022. The task's 22-stage enumeration is mapped onto the **contract's
normative order** below; the task's stage numbering is not the normative
order. **Ordering decision (cited, not intuited):** the contract orders
**temporary cleanup before audit publication** — step 7 (unlink temporary)
and step 8 (`tmp/` directory `fsync`) precede step 9 (publish and
synchronize the required audit event) in §10.1; WPR-007 fixes "final
record directory fsync BEFORE the temporary name is unlinked"; WPR-008/021
fix success only after the full durability point including durable removal
of the temporary name **and** durable audit state. The task's stages 16-19
(audit before unlink) are therefore reordered to the contract order
(16-19 → audit after tmp-dir sync).

| Stage (contract order) | Operation | Normative basis |
|---|---|---|
| 1 | Validate request and record class (envelope, canonicalization, references, class rules, limits) — **before any persistence** | WPR-001/002, RFM-001…014, 18.2 precedence |
| 2 | Verify trusted action provenance (genuine branded provenance correlated to the capability binding) | TAU-004/007, WPR-014, CAP-002 |
| 3 | Create and validate the genuine write capability (gate §7) and capture admission bindings (CAP-008) | CAP-002…004, CAP-008 |
| 4 | Revalidate root, namespace identities (point-of-use, from verified StoreMetadata) and capability | SRX-013, FSP-014, CAP-009 boundary 1 |
| 5 | Acquire the correct writer lock (`store-v1/locks/writer.lock`, exclusive no-follow, mode `0600`, lock-record write, file `fsync`, locks-dir `fsync`) | LOK-005/006/011, §9 |
| 6 | Derive the final path **only** from validated record identity and class (layout derivation; shard from opaque component) | LAY-003…008, FSP-001/002 |
| 7 | Derive a bounded temporary path **only** inside verified `tmp/` (action-derived name; no randomness/clock/PID) | WPR-003, LAY-010, FSP-009; WP-8-C scratch pattern |
| 8 | Exclusive no-follow temporary creation (`O_CREAT|O_EXCL|O_NOFOLLOW`, `0600`) | WPR-003, SRX-014 |
| 9 | Set and verify mode `0600` + configured UID (descriptor-bound `fchmod`/`fstat`) | SRX-006/014, FSP-008 |
| 10 | Write canonical bytes with a bounded write-all loop (no single-write assumption) | WPR-002, ADR-028 decision D pattern |
| 11 | Verify descriptor type (regular file), identity, size, policy | WPR-005, FSP-005/008 |
| 12 | `fsync` the temporary file | WPR-005, 10.1 step 3 |
| 13 | Revalidate capability (boundary 2) — immediately before primary publication | CAP-009 |
| 14 | Atomically publish by hard link from the temp inode to the final path (`link(2)`); `EEXIST` → existing-target classification (§11); **plain `rename` prohibited** | WPR-004/006, DS-21, FSP-012 |
| 15 | Verify final object identity (device/inode/type), link relationship, bytes | ITG-003, FSP-006, WPR-019 |
| 16 | `fsync` the final record directory **before** temp unlink | 10.1 step 6, WPR-007 |
| 17 | `unlink` the exact owned temporary object | 10.1 step 7, WPR-007 |
| 18 | `fsync` the `tmp/` directory (durable temp-name removal) | 10.1 step 8, WPR-007 |
| 19 | Revalidate capability (boundary 3); publish the mandatory write-audit event (its own temp + link under `audit/`, same protocol) and synchronize all audit durability components (audit file `fsync`, audit class-shard dir `fsync`, audit parent dir `fsync`) | 10.1 step 9, WPR-010, AUD-003, 10.5 |
| 20 | Revalidate capability and roots (boundary 4) before success | CAP-009, SRX-013 |
| 21 | Release the exact owned lock (identity-bound `unlink` + locks-dir `fsync`) | LOK-013 |
| 22 | Return success only after the full durability point | WPR-008/021 |

**Phase-3 provisioning sequence and classification (D-7, approved;
M-1/M-2 corrected).** The committed WP-8-C phase-2 classifier returns
FOREIGN when fixed entries are missing **and metadata is verified**
(`hasVerifiedMetadata ? 'FOREIGN' : 'PROVISIONAL'`); the newly authorized
WP-8-D policy revision defines the five-state phase classification:
**A** phase-2 initialized (exact `{metadata,tmp}`, verified metadata) →
`PROVISIONAL / PHASE3-UPGRADE-REQUIRED`; **B** upgrade in progress
(allowed subset, no unknowns) → `PROVISIONAL`; **C** incomplete phase-3
(`metadata,tmp` plus a proper subset of `records,audit,locks`, all
existing entries valid) → `PROVISIONAL` **regardless of the
metadata-verification flag**; **D** foreign/invalid (unknown or deferred
entries, wrong type/UID/mode, symlink, drift, malformed/unsupported
state) → the existing fail-closed state per precedence; **E** phase-3
initialized (exact `{metadata,tmp,records,audit,locks}`, all verified) →
`INITIALIZED`. The expected policy is a committed internal
software-policy revision: not request-selectable, not selected by
metadata; StoreMetadata format and layout versions unchanged; no stored
phase fact; no migration. Classification is
**classifier-policy-revision-bound**. Concurrent first use: exclusive
`mkdir`; `EEXIST` enters descriptor verification (exact valid object →
idempotent continue; invalid → fail closed). Crash between creations: a
partial allowed set remains `PROVISIONAL`; deterministic retry creates
only the missing exact entries. Upgrade/downgrade: WP-8-D software
upgrades phase-2 stores; older software sees phase-3 entries as FOREIGN
and fails closed (intentional, VRS-008-safe).

The writer lock file lives at `<ns>/locks/writer.lock`, so `locks/` (and
`records/`, `audit/`) must exist **before** lock acquisition; lazy
provisioning therefore cannot run under the writer lock (no circular
dependency). **Provisioning authority (M-1 pin):** `provision-phase3` is
**not a new CAP-001 capability kind** — it is an operation-set
extension of the existing initialization-capability family, using the
existing module-private `InitializationCapability` authenticity domain;
allowed initialization-family operation values are `namespace-initialize`
and `provision-phase3`; issuance uses the existing initialization-family
trusted gate with all current parent, namespace, configuration,
limit-profile, generation and lifetime bindings; **zero production
issuance remains**. The exact consumer is
**`src/storage/publication/index.ts`**, which invokes the top-level
provisioning sequence **before writer-lock acquisition**. Top-level
mutation targets are pinned to exactly `<namespace>/records`,
`<namespace>/audit`, `<namespace>/locks`; **no raw path operand is
accepted**. Class and shard directory creation is pinned separately: it
requires a **genuine live `WriteCapability`** and occurs **only after
writer-lock acquisition**; class from the closed validated taxonomy; class
segment from the accepted layout derivation; shard an exact canonical
four-lowercase-hex value from the validated record identity; permitted
targets `<namespace>/records/<validated-class-segment>/<validated-shard>`
and `<namespace>/audit/audit-event/<validated-shard>`; no arbitrary
directory or segment; **no other capability may create these targets**.
Sequence: (1) revalidate the store through verified StoreMetadata (D-5);
(2) acquire the phase-3 provisioning capability (initialization-family
domain, operation `provision-phase3`, existing trusted gate); (3) create
only the exact missing top-level phase-3 directories (exclusive `mkdir` +
descriptor-bound no-follow verification, configured UID, exact `0700`,
`fsync`; `EEXIST` → descriptor verification → idempotent continue
or fail closed); (4) dispose the provisioning capability; (5) proceed to
writer-lock acquisition, then class/shard creation under the genuine live
`WriteCapability`. StoreMetadata format/version are unchanged; no
migration semantics.

**Same-action temporary-name EEXIST retry (MINOR-2 resolution, approved
with D-7/D-8).** Temporary names are deterministic per action identity
(WP-8-C scratch pattern), so an idempotent retry of the same action after
a crash re-derives the same temp name and hits `O_CREAT|O_EXCL` EEXIST.
The retry must: **not adopt, reopen for writing, or unlink** the existing
object; inspect it only via bounded no-follow `fstat` (wrong type/owner/
mode → `ERR-STO-FTYPE-UNSUPPORTED` / `ERR-STO-PERM-DENIED`, fail closed,
no content read); then verify the **final primary target** and the
**required audit target**; if primary and audit are fully durable and
exact → the contract-permitted idempotent result (WPR-012/019); if primary
is durable but audit is incomplete → `ERR-STO-DURABILITY` with the 10.5
audit-row state tuple (`primaryStateChanged: yes`; `durabilityPointReached:
yes` (primary); `auditChanged: unknown`; `verifyBeforeRetry: true`;
recovery completes or reconstructs — phase 4); if neither complete state
is provable → `ERR-STO-DURABILITY` with the unknown-state tuple
(`primaryStateChanged: unknown`; `durabilityPointReached: unknown`;
`auditChanged: unknown`; `verifyBeforeRetry: true`; retryable) per
WPR-017/ERM-006. **No new error code**; stale-temp cleanup belongs to
recovery (WPR-023 class (b), phase 4).

**Durability points.** The contract defines **one** operation durability
point whose elements are: record file synchronized; hard link created;
final record directory synchronized; temporary name unlinked; `tmp/`
directory synchronized; required audit event durably published with its
directory synchronized (10.5 corrected W8A-R02; WPR-021). It does **not**
define a separate "audit durability point": AUD-003 and WPR-010 give the
audit event "the same durability point as the operation". For WP-8-D
implementation the two distinguishable milestones are: **primary
durability** (record file sync → link → final-dir sync → temp unlink →
`tmp/`-dir sync) and **audit durability** (audit event link + audit
directory sync); the **operation durability point is their union**, and
success requires all of it. If any element cannot be reached, the operation
fails with a durability-class error and must not report success (WPR-008/
022, ERM-006/009).

**Required directory preconditions.** The publication paths
`<ns>/records/<segment>/<shard>/` and `<ns>/audit/audit-event/<shard>/`
and the `<ns>/locks/` directory must exist. WP-8-C provisioned only
`metadata/` and `tmp/` per namespace. WP-8-D must therefore create the
fixed phase-3 directories (records, audit, locks per namespace; class shard
directories) with the WP-8-C exclusive-`mkdir` + descriptor-verify pattern,
and the initialization classifier must accept them — **a required, bounded
amendment of committed WP-8-C initialization source** (D-7; see §16, §17,
§23 finding F-1).

## 11. Existing-Target Semantics

Existing final objects are **never overwritten**: hard-link no-replace
semantics guarantee it (WPR-004/006, DS-21); `EEXIST` at publication enters
verification and classification (WPR-006, 18.2). The existing object is
verified descriptor-bound, no-follow, before classification (WPR-019).

| Existing-target case | Classification | Code / behavior |
|---|---|---|
| Exact same committed bytes (verified, identical digest) | **idempotent duplicate** | class-dependent success with duplicate evidence (10.2, WPR-012/019); verify first, then success |
| Same logical record and digest but different bytes | **integrity failure** | impossible for canonical forms (RFM-014: identical logical records ⇒ identical bytes); observed mismatch ⇒ `ERR-STO-INTEGRITY` (digest cannot verify different bytes) |
| Same record ID, different payload (different bytes) | **duplicate** | `ERR-STO-DUPLICATE` (10.2, 18.2) |
| Same ID and revision, different bytes | **conflict** | `ERR-STO-CONFLICT-REVISION` (10.2: "same revision with conflicting digest"; 18.2) |
| Existing non-regular file (FIFO/socket/device) | **foreign object** | `ERR-STO-FTYPE-UNSUPPORTED` (FSP-005, SRE-005) |
| Symlink at final path | **foreign object** | no-follow open fails; `ERR-STO-FTYPE-UNSUPPORTED` (FSP-003) |
| Directory at final path | **foreign object** | `ERR-STO-FTYPE-UNSUPPORTED` |
| Hard-linked unexpected object (link count > 1 / inode shared with a non-store object) | **integrity failure** | `ERR-STO-INTEGRITY` where detectable on the supported lane (FSP-006); quarantine ownership = recovery phase |
| Ownership or mode mismatch | **permission failure** | `ERR-STO-PERM-DENIED` (SRX-006/007/014, FSP-008) |
| Unsupported format version (structurally valid envelope) | **unsupported version** | `ERR-STO-UNSUPPORTED-VERSION` (18.2, VRS-002) |
| Malformed canonical bytes (unparseable envelope / non-canonical) | **malformed** | `ERR-STO-MALFORMED` (18.2 precedence; precedes version classification) |
| Incomplete or unverified audit linkage (primary exists, audit missing/partial) | **recovery required** | not an existing-target case at primary publication; observed at retry/read ⇒ durability-class outcome `ERR-STO-DURABILITY`, recovery required (10.5 audit row, CSA-005/013); WP-8-D never fabricates the missing event (reconstruction is phase-4) |

## 12. Failure and Crash Matrix

Rows follow the normative order of §10; "crash" rows describe post-crash
filesystem classification (the operation does not return). Error codes are
only from the closed 31-code vocabulary; state tuples follow 18.1 and 10.5.
Temp = the primary temporary object (or the audit temporary where noted).

| Stage / failure | Mutation attempted | Primary state | Audit state | Temp state | Lock state | Durability certainty | Error code | Retryable | Verify before retry | Cleanup permitted | Recovery ownership | Harness test |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Before lock creation (validation/provenance/capability/root failure) | none | no change | no change | none | none | none | per cause (`ERR-STO-REQ-INVALID`, `-CONFIG-UNAVAILABLE`, `-ROOT-INVALID`, `-ROOT-IDENTITY-CHANGED`, `-CONTAINMENT-DENIED`, `-MALFORMED`, `-UNSUPPORTED-VERSION`, `-LIMIT-EXCEEDED`, `-NOT-FOUND`) | per code | no | none | none | none | kill before lock |
| After lock file creation, before locks-dir `fsync` (crash) | lock file | no change | no change | none | file exists, not durable | none (lock is transient) | n/a (crash) — post-crash writers: `ERR-STO-LOCK-UNAVAILABLE` | yes (fresh attempt) | no | unlink own lock on failure path | recovery-phase lock handling | kill after lock create, before dir fsync; assert lock remains and store fails closed |
| Lock-dir `fsync` failure (non-crash) | lock file | no change | no change | none | exists | unknown (may reappear) | `ERR-STO-IO-FAILURE` | yes | yes | unlink own lock (containment) | none | fsync injection |
| After tmp creation (crash) | temp file | no change | no change | orphan present | held | none | n/a — post-crash: orphan (WPR-023 class b) | yes | yes | remove own temp on failure path | phase-4 quarantine with evidence (WPR-023, CSA-001/010) | kill after tmp create; assert orphan + no record under `records/` |
| During partial write / zero-progress write | temp bytes | no change | no change | partial/complete | held | none | per FSL map (`ERR-STO-NO-SPACE`, `-QUOTA-EXCEEDED`, `-IO-FAILURE`, `-READONLY-FS`); zero-progress loop terminates fail-closed | per code | yes | remove own temp | none | injected write failure; kill mid-write |
| After write, before file `fsync` (crash/failure) | temp bytes | no change | no change | complete, not durable | held | none | per FSL map; `ERR-STO-IO-FAILURE` | yes | yes | remove own temp | phase-4 orphan class (b) | kill after write, before fsync |
| File `fsync` failure | temp fsync | no change | no change | complete | held | none (temp not durable) | per FSL map | yes | yes | remove own temp | none | fsync injection |
| After file `fsync`, before link (crash) | — (link not attempted) | no change | no change | durable orphan | held | temp durable only | n/a — orphan (class b) | yes | yes | remove own temp | phase-4 quarantine | kill before link |
| Hard-link failure (non-EEXIST) | link(2) | no change | no change | present | held | none | `ERR-STO-CROSS-DEVICE` (EXDEV), `-FS-UNSUPPORTED`, `-PERM-DENIED`, `-NO-SPACE` (WPR-015, FSL-008) | per code | yes | remove own temp | none | injected link failure |
| `EEXIST` at final target | link(2) | no change (existing object untouched) | no change | present | held | n/a | classify per §11 (idempotent / `-DUPLICATE` / `-CONFLICT-REVISION`); never overwrite | per class | yes (WPR-019) | remove own temp | none | EEXIST fixture |
| After successful link, before final-dir `fsync` (crash/failure) | — (link done) | changed: yes | no change | present (both names) | held | unknown (WPR-017) | failure: `ERR-STO-DURABILITY` (10.5 step-6 row) | yes | yes | remove own temp (final name kept; never delete the record) | yes — durability-unknown classification (WPR-017) | kill after link, before final-dir fsync; assert record exists and durability-unknown on recovery |
| Final-dir `fsync` failure | dir fsync | changed: yes | no change | present | held | unknown | `ERR-STO-DURABILITY` (10.5) | yes | yes | remove own temp | yes (WPR-017) | fsync injection |
| After tmp unlink, before `tmp/`-dir `fsync` (crash/failure) | — (unlink done) | changed: yes, final name durable | no change | name may reappear after crash | held | primary durable; temp-name removal unknown | failure: `ERR-STO-DURABILITY` (10.5 step-8 row) | yes | yes | n/a (already unlinked; if reappeared, remove own name only) | yes — WPR-023 classify | kill after unlink, before tmp-dir fsync |
| `tmp/`-dir `fsync` failure | dir fsync | changed: yes, durable | no change | removal not durable | held | primary reached; temp-removal unknown | `ERR-STO-DURABILITY` (10.5) | yes | yes | n/a | yes (WPR-023) | fsync injection |
| Before audit creation (crash) | — (audit not begun) | changed: yes, durable | none | none (tmp removed) | held | primary reached | n/a — recovery reconstructs missing event (CSA-005/013; phase 4) | yes | yes | n/a | yes — audit reconstruction (phase 4) | kill before audit temp create; assert primary durable, audit absent |
| During audit write / audit link / audit-dir `fsync` failures | audit temp + audit link | changed: yes, durable | possibly absent or partial | audit temp may remain | held | primary reached; audit unknown | `ERR-STO-DURABILITY` (10.5 step-9 row; AUD-013) | yes | yes | remove own audit temp | yes — complete or reconstruct audit (CSA-005/013) | injected audit-stage failures; kill mid-audit |
| After primary + audit durable, before tmp unlink | — | — | — | — | — | — | **Unreachable in the normative order**: unlink (step 7) precedes audit (step 9) (10.1); observed state ⇒ protocol violation `ERR-STO-INTERNAL-INVARIANT` + recovery | no | yes | n/a | yes | negative harness assertion (state must not arise) |
| Tmp unlink failure (step 7, before audit) | unlink | changed: yes, final name durable | no change | remains | held | primary durable; temp removal not durable | `ERR-STO-PUBLISH-FAILED` (10.5 step-7 row) | yes | yes | retry unlink of exact own name | yes — cleanup with evidence (phase 4) | injected unlink failure |
| Capability invalidation at boundaries 1-2 (before any trusted-state mutation) | none | no change | no change | own temp (b2) | own lock | none | `ERR-STO-REQ-INVALID` (CAP-009) | no | no | yes (own temp) | no | invalidation injection at each boundary |
| Capability invalidation at boundaries 3-4 (after primary publication) | — | changed: yes, durable | boundary 3: none; boundary 4: durable | n/a | own lock | primary reached; audit per boundary | `ERR-STO-DURABILITY` class (CAP-009); never ordinary success | yes | yes | containment only | boundary 3: yes (audit completeness); boundary 4: no | invalidation injection at each boundary |
| Root identity drift at any revalidation | — | unknown | unknown | per stage | per stage | unknown | `ERR-STO-ROOT-IDENTITY-CHANGED` (SRX-010) | no | yes | containment only | yes (re-init) | drift fixture |
| Lock release failure (post-durability) | lock unlink | changed: yes, durable | changed: yes, durable | none | remains | reached | `ERR-STO-PUBLISH-FAILED` (cleanup-failure class; LOK-013; not covered by 10.5 — mapped to the closed cleanup-failure code, D-10) | yes (idempotent replay) | yes | n/a | lock cleanup — recovery phase; until then writers fail closed `ERR-STO-LOCK-UNAVAILABLE` | injected release failure |
| Process kill at every meaningful stage | — | per row | per row | per row | per row | per row | n/a (crash) | — | — | — | per row | full harness stage matrix (§14) |

## 13. Write-Audit Boundary

**Minimum that must land in WP-8-D** (WPR-010/AUD-001 require the audit
event at the publication durability point; §29 phase 3 owns "durability"):

- **Exact event kind:** `authorized-write` (22.1 first-class event for
  the write action).
- **Record class:** `AuthoritativeAuditEvent` (6.2; layout `audit/audit-event/<shard>/<component>.aud`).
- **Exact record fields (envelope 7.1 + payload):** `recordKind =
  AuthoritativeAuditEvent`; `formatVersion` (current supported version);
  `recordId` (opaque typed identifier, `pgw:l:` prefix — the accepted
  trusted-record prefix of 5.3); `revision` = 1 (per-identity sequence);
  `createdAt` = the primary record's logical `createdAt` (deterministic,
  idempotent — never minted by the store); `trustedActionId` = the write
  capability's action identity; `payload` = `{ eventKind:
  'authorized-write', recordId: <primary identity>, recordDigest:
  <primary digest> }`; `payloadDigest` (domain-separated, RFC 8785);
  `referenceDigests = [primary record digest]` (linkage: AUD-002);
  `integrityMetadata`; `retentionClass = 'indefinite'` (RNT-002).
- **Linkage:** the event binds the primary record identity and digest and
  the trusted action identity (AUD-002/005); never paths (TAX-003).
- **Sequence/order allocation:** the contract fixes ordering
  (AUD-002/003, DTM-003: deterministic; 6.4: logical sequence per class)
  but does **not** fix the allocation mechanism for normal write
  operations (16.3's "next audit sequence" vocabulary belongs to
  recovery reconstruction). The approved model (D-8, ADR-029) uses a
  **deterministic total order (primary record `createdAt`, primary record
  identity, audit event identity)** with the numeric sequence treated as a
  **rebuildable derived position** (index-like, RGY-007 principle);
  phase-4 reconstruction derives sequences over that order and allocates
  gap markers. **Selected by D-8 (ADR-029); contract revision not
  required.**
- **Audit path derivation:** `audit/audit-event/<shard-of-audit-event-id>/<component>.aud`
  via the existing `deriveRecordRelativePath` (suffix `.aud` ⇒ `audit/`
  tree), bounded by `pathBytes`/`pathComponentBytes`.
- **Audit publication protocol:** identical hard-link protocol (§10)
  with its own temp under `tmp/`, `EEXIST` → existing-target
  classification (identical bytes ⇒ idempotent; different bytes ⇒
  `ERR-STO-DUPLICATE`), audit file `fsync`, audit class-shard directory
  `fsync`, audit parent directory `fsync`, all at the operation
  durability point (WPR-010, AUD-003).
- **Idempotency:** deterministic event identity (derived from the primary
  record identity + event kind, D-8 option) makes retries and
  post-crash replays idempotent (WPR-012/019).
- **Recursive-audit prohibition:** resolved in §6 — the write-audit event
  is the terminal event; audit publication is not an audited event (22.1).
- **Primary durable, audit not:** `ERR-STO-DURABILITY` (10.5 audit row);
  no success; verify before retry; recovery completes or reconstructs
  with the distinct `recovery-audit-reconstruction` kind (CSA-013, phase
  4). WP-8-D never fabricates the event.
- **Audit durable, temp cleanup or lock release fails:** per the
  normative order, temp cleanup precedes audit, so "audit durable, temp
  not unlinked" cannot arise (§12 row); lock-release failure after audit
  durability → `ERR-STO-PUBLISH-FAILED`, verify before retry, lock
  remains until recovery (D-10).

**Deferred to the audit phase (phase 4):** audit-history surface beyond
minimum exact reads (RDS-006); reconstruction (16.3, CSA-013/014);
gap repair; recovery-generated audit; retention audit (RNT-004);
registry audit; generalized event production (all 22.1 kinds except
`authorized-write`; the `idempotent-duplicate` and `conflict` event kinds
are explicitly allocated to phase 4).

## 14. Exact Read, Verify and Enumeration Model

Three separate operations (API-003; no omnibus interface):

- **Exact read (read-by-identity, RDS-001/002/008/009/011/012):**
  validated record class + canonical typed identity only; no raw path, no
  alias/title/workspace path (LAY-005); descriptor-bound open
  (`O_RDONLY|O_NOFOLLOW`), pre/post `fstat` verification (WP-8-C replay
  pattern), bounded bytes (`recordBytes`), strict canonical parsing
  (18.2 precedence), digest verification (ITG-001), location verification
  against the layout derivation (ITG-003), copy-on-return (RDS-008), no
  semantic lifecycle evaluation, no mutation (RDS-011).
- **Verify (verify-by-identity, RDS-003):** structured
  pass/fail result with the specific failure class (18.1/18.2); returns
  **no record content**; never claims trusted authority merely because a
  record is valid (ITG-007, TAU-008); no mutation; no repair.
- **Bounded enumeration (bounded-enumerate-class, RDS-004, DTM-003):**
  fixed class namespace only; deterministic ordering (sort by logical
  sequence and identity — never host directory order); strict limits
  (`dirEntries`, `enumerationResults`, continuation); no recursive
  arbitrary filesystem listing; **every discovered object independently
  verified before being reported as a valid record**; unknown/foreign
  entries fail closed (returned only as bounded findings per the
  contract, never as records); no registry or current-state resolution
  (RGY is phase 4); no FFF ranking; no path disclosure (RDS-012).

**Issuers.** Read and verify capabilities have **gated factories but zero
production consumers** in WP-8-D: the creators exist in
`capabilities/authenticity.ts` (branded; bound to verified store-instance
identity + configuration identity; no action provenance required — they
are non-mutating, 21.1), importable only by the internal read composition
module, with no production caller until WP-9/WP-12 consumers exist
(API-008). Reads are unaudited by default (AUD-010).

## 15. Limits and Error Precedence

**Applicable in WP-8-D (14 of 20):**

| Limit | Source | Default | Hard min | Hard max | Request lowering | Exact | +1 | Error | Mutation |
|---|---|---|---|---|---|---|---|---|---|
| `recordBytes` | layout constant / config | 1 MiB | 1 KiB | 64 MiB | yes | accepted | fail closed | `ERR-STO-LIMIT-EXCEEDED` | none (pre-validation) |
| `payloadBytes` | layout constant / config | 512 KiB | 256 B | 16 MiB | yes | accepted | fail closed | record rejected at validation | none |
| `referencesPerRecord` | layout constant / config | 64 | 1 | 1024 | yes | accepted | fail closed | record rejected | none |
| `pathComponentBytes` | layout constant | 64 | 8 | 128 | yes | accepted | fail closed | derivation rejected (LAY-007) | none |
| `pathBytes` | layout constant | 512 | 64 | 1024 | yes | accepted | fail closed | derivation rejected | none |
| `temporaryBytes` | layout constant / config | 64 MiB | 1 MiB | 1 GiB | yes | accepted | fail closed | write aborted pre-publication (LMT-007) | none (own temp removed) |
| `lockWait` | config | 5000 ms | 100 | 120000 | yes | accepted | fail closed | `ERR-STO-LOCK-TIMEOUT` (LMT-008) | none (LOK-012) |
| `operationTimeout` | config | 30000 ms | 1000 | 300000 | yes | accepted | fail closed | `ERR-STO-TIMEOUT` (ERM-009) | none pre-publication; verify-required post |
| `dirEntries` | config | 4096 | 16 | 65536 | yes | accepted | fail closed | enumeration bounded | none |
| `enumerationResults` | config | 1024 | 16 | 65536 | yes | accepted | **continuation** | continuation (RDS-004) | none |
| `auditEventsPerOperation` | config | 1 | 1 | 64 | yes | accepted | fail closed | batch rejected | none |
| `recordsPerTransaction` | config | 1 | 1 | 64 | yes | accepted | fail closed | batch rejected (WPR-013) | none |
| `concurrentReaders` | config | 16 | 1 | 64 | yes | accepted | fail closed | read rejected | none |
| `writers` | contract constant | 1 | 1 | 1 | no | n/a | n/a | `ERR-STO-CONCURRENCY` | none |

**Deferred (6):** `totalScanEntries`, `totalScanBytes`,
`recoveryScanEntries` (phase 4 scans); `retainedVersions` (phase 4/5);
`quarantineEntries` (phase 4); `indexRebuildWork` (phase 4). Crash-scan
bounds are not applicable in WP-8-D (no recovery scanner).

The selected profile is bound to the trusted-configuration version and
identity, store metadata, and operation identity (LMT-011); the write
capability captures the profile identity at admission (CAP-008).

**Error precedence:** the committed `selectPrecedence` chain (18.2)
already covers every WP-8-D code: recovery-gate codes first;
request/root/containment/limit; file-type/permission; malformed;
unsupported-version; canonicalization-malformed; integrity;
conflict/not-found; duplicate; lock codes; publication/durability/
filesystem codes; cancellation/timeout; internal-invariant. WP-8-D
exercises **28 of the closed 31 codes directly**. The exact 31-code
disposition (corrected per senior-review MINOR-1; totals equal 31):

| Code | Disposition in WP-8-D |
|---|---|
| `ERR-STO-REQ-INVALID`, `ERR-STO-CONFIG-UNAVAILABLE`, `ERR-STO-ROOT-INVALID`, `ERR-STO-ROOT-IDENTITY-CHANGED`, `ERR-STO-CONTAINMENT-DENIED`, `ERR-STO-FTYPE-UNSUPPORTED`, `ERR-STO-PERM-DENIED`, `ERR-STO-NOT-FOUND`, `ERR-STO-DUPLICATE`, `ERR-STO-CONFLICT-REVISION`, `ERR-STO-INTEGRITY`, `ERR-STO-UNSUPPORTED-VERSION`, `ERR-STO-MALFORMED`, `ERR-STO-DURABILITY`, `ERR-STO-PUBLISH-FAILED`, `ERR-STO-LOCK-UNAVAILABLE`, `ERR-STO-LOCK-TIMEOUT`, `ERR-STO-CONCURRENCY`, `ERR-STO-CANCELLED`, `ERR-STO-TIMEOUT`, `ERR-STO-INTERNAL-INVARIANT`, `ERR-STO-NO-SPACE`, `ERR-STO-QUOTA-EXCEEDED`, `ERR-STO-READONLY-FS` (all three phase rows), `ERR-STO-CROSS-DEVICE`, `ERR-STO-FS-UNSUPPORTED`, `ERR-STO-IO-FAILURE`, `ERR-STO-LIMIT-EXCEEDED` | **exercised directly by WP-8-D operations** (28) |
| `ERR-STO-RECOVERY-REQUIRED`, `ERR-STO-RECOVERY-FAILED` | **regression-only** (3): members of the closed 31-code vocabulary and of the committed `selectPrecedence` recovery-gate tier; **neither raised nor returned by any WP-8-D operation** — they are reserved as the phase-4 recovery-gate codes. The distinction: a code is "raised" when a WP-8-D operation maps a condition to it; WP-8-D maps all recovery-required conditions to the `ERR-STO-DURABILITY` class per 10.5, so the gate codes never surface in this phase |
| `ERR-STO-RETENTION-DENIED` | **regression-only** (3): closed-vocabulary member; phase-5 retention code; not raised by WP-8-D |

Total: **28 exercised directly + 3 regression-only = 31**. No code is
"returned as a phase/recovery state" by WP-8-D; the recovery-gate codes
remain in the vocabulary and precedence chain for phase 4. **No new error
code** (ERM-001); precedence is preserved unchanged.

## 16. Filesystem API Ownership Map

Every filesystem-bearing WP-8-D module with exact imported APIs, purpose,
mutation/read classification, exclusivity rationale, static-guard rule, and
global-delegation impact. **No broad `storage/**` exclusion is used.**

| Module (exact path) | `node:fs` APIs (exact names) + extras | Purpose | Class | Why no other module needs it | Static-guard rule | Global no-I/O delegation |
|---|---|---|---|---|---|---|
| `src/storage/publication/publish-record.ts` (new) | `openSync`, `closeSync`, `writeSync`, `readSync`, `fsyncSync`, `fchmodSync`, `fstatSync`, `linkSync`, `unlinkSync`, `mkdirSync` (exclusive, fixed derivations), `readFileSync(fd)`; `constants` (`O_CREAT`, `O_EXCL`, `O_WRONLY`, `O_RDONLY`, `O_NOFOLLOW`) | temp write/fsync, shard-dir provisioning, hard-link publication, final-dir/`tmp`-dir `fsync`, own-temp unlink | mutation | single owner of the publication primitive (WPR); orchestrators, audit, capabilities stay fs-free | allowlist entry; exact-name named imports; no fs-name exports; importable only by `publication/index.ts` | delegated exact compiled path in `security.test.ts` |
| `src/storage/locks/lock.ts` (new) | `openSync`, `closeSync`, `writeSync`, `fsyncSync`, `fstatSync`, `unlinkSync`; `constants` (`O_CREAT`, `O_EXCL`, `O_WRONLY`, `O_NOFOLLOW`); `randomBytes` (`node:crypto`); `process.pid`; injectable clock/start-time/boot-id | lock acquire/verify/release (LOK) | mutation (transient state) | only the lock module touches `locks/` (LOK-004/011) | allowlist entry + the **only** module granted the randomness/PID/clock exception (D-3) | delegated exact compiled path |
| `src/storage/read/read-record.ts` (new) | `openSync`, `closeSync`, `fstatSync`, `readFileSync(fd)`/`readSync`; `constants` (`O_RDONLY`, `O_NOFOLLOW`) | descriptor-bound exact read + verify-by-identity | read-only | read/verify are the only consumers of record bytes; `readdirSync` is **not** authorized here (senior-review NOTE-1 applied: bounded enumeration in `enumerate.ts` is the sole directory-scan owner); no mutation anywhere in the read tree | allowlist entry; read modules may import **no** mutating fs API (`writeSync`, `linkSync`, `unlinkSync`, `mkdirSync`, `fsyncSync`, `readdirSync` denied here) | delegated exact compiled path |
| `src/storage/read/enumerate.ts` (new) | `readdirSync` + descriptor open/close/fstat | bounded deterministic enumeration (RDS-004) | read-only | enumeration is the only bounded directory scan; `dirEntries`/`enumerationResults` enforcement lives here | allowlist entry (bounded `readdirSync` only; no recursion) | delegated exact compiled path |
| `src/storage/audit/write-audit.ts` (new) | **none** (fs-free) | event construction, identity/order derivation, durability-point composition; delegates publication to `publication/publish-record.ts` | pure | audit is composition, not I/O; keeping it fs-free prevents a second publication path (WPR-010) | no `node:fs`; no brand markers | not delegated (no I/O) |
| `src/storage/initialization/provision.ts` + `state.ts` (amended) | existing allowlist (`mkdirSync`, `openSync`, `closeSync`, `fchmodSync`, `fstatSync`, `fsyncSync`, `readdirSync`, `constants`) | phase-3 fixed entry set (`records`, `audit`, `locks`) + classifier (D-7) | mutation (init) | the classifier is the sole entry-set authority | existing allowlist unchanged in shape; entry-set constants extended | already delegated |
| `src/storage/capabilities/authenticity.ts` (extended) | none | write/read/verify brands + creators | pure | capability authenticity stays in the single brand module (ADR-028 Model A) | `new WeakSet` already granted; new separate brand collections; creator edges added | not delegated |
| `src/storage/trusted-input/bootstrap-input.ts` (extended) | none | write-action provenance + trusted-write-request domains | pure | trusted-input correlation stays in the single trusted-input module | `new WeakSet` already granted; new domains; zero-producer edge for write provenance | not delegated |

**Global delegation set growth:** required. `tests/security/security.test.ts`
`STORAGE_FS_DELEGATED_MODULES` must grow by the **exact** new compiled
paths (`storage/publication/publish-record.js`, `storage/locks/lock.js`,
`storage/read/read-record.js`, `storage/read/enumerate.js`), each paired
with the stricter storage static guard (per-API allowlists above). The
fail-closed predicate and the rejection inventory remain; a blanket
`dist/storage/**` exclusion remains **prohibited** (W8C-I01 precedent).

## 17. Static-Guard Impact

- **Amendments required (test-side, `tests/unit/storage/static-guard.test.ts`):**
  (a) `FS_ALLOWLIST` gains the four new modules with the exact API
  subsets of §16; (b) the "no forbidden later-phase directories" test
  releases `publication`, `read`, `audit` (and confirms `registry`,
  `recovery`, `retention` remain absent); (c) `CREATOR_EDGES` gains
  `createWriteCapability` (single consumer), the trusted-write-request
  creator (single composition boundary), the write-action-provenance
  creator (**zero production importers**), and the read/verify creators
  (single read-composition consumer); (d) the **randomness/PID/clock
  exception is granted to `src/storage/locks/**` only** — the blanket
  `Math.random`/`crypto.random`/`randomUUID`/`Date.now`/`process.pid`
  prohibitions remain everywhere else, with negative tests proving the
  exception does not leak (D-3); (e) a new no-import-edge rule between
  `src/storage/**` and `src/{reader,git,fff}/**` (SCP-005: WP-7
  inspection never confers storage authority, in either direction); (f)
  mutation-API denial inside the read tree.
- **Runtime source:** no new brand-bearing module (both brands remain in
  the two exact modules); no new issuance markers; `src/index.ts`,
  package exports, dependencies unchanged.
- **Global security test:** exact delegation growth per §16.

## 18. Crash-Injection Harness

**The harness belongs in WP-8-D** (accepted decomposition: phase 3 gate is
"review + crash-injection evidence"; TVR-002 requires crash injection at
every write stage; WP-8-D is the first phase dependent on crash semantics).

- **Child processes allowed only in tests; runtime source must not
  spawn** (SRE-013: `child_process` imports are denied in `src/**` by the
  guard; harness code lives under `tests/process/**` only).
- **Isolated temporary trusted root:** each test creates its own trusted
  parent + store under a test-scoped temp directory; no HOME, workspace,
  repository, or unrelated-path mutation (TVR-009 mutation-evidence
  assertions included).
- **Deterministic stage markers:** the child fixture executes the §10
  protocol and emits `STAGE:<n>` markers on stdout before each stage;
  the parent waits for the exact marker (bounded deadline) then sends
  `SIGKILL`; a stage not reached is asserted as not reached (no false
  pass).
- **Exact post-crash classification:** after kill, the parent asserts the
  §12 row expectations (records/audit/tmp/lock state, error-code
  behavior of a follow-up operation, verify-before-retry outcomes).
- **No reliance on sleeps alone:** marker protocol + bounded deadlines;
  sleeps only as secondary liveness backstops.
- **No orphan child processes:** kill + `wait` with a bounded timeout and
  an explicit orphan sweep (only the harness's own children).
- **Stale compiled-output protection:** the harness gate command rebuilds
  or asserts freshness of `dist-test` fixture and harness (mirrors the
  documented storage gate discipline).
- **Exact test counting:** table-driven stage matrix; the runner reports
  per-row pass/fail with a fixed expected count.
- **Reproducible stage matrix:** one row per §12 stage (lock creation,
  tmp creation, partial/zero write, pre-fsync, file-fsync failure, post
  fsync, link, EEXIST, post-link pre-dir-fsync, dir-fsync failure,
  unlink, tmp-dir fsync, pre-audit, audit write/link/dir-sync,
  post-durability lock release), plus capability-invalidation and root-
  drift kills.
- **Execution:** a focused runner (`tests/process/storage-crash/*.test.ts`
  compiled to `dist-test`, invoked by a new `test:storage-crash` package
  script) — **no dependency, package-export, or default-workflow change**
  beyond adding the focused script (the storage suite is already a
  documented explicit gate command).

## 19. Source and Test Path Envelope (proposal only — NOT granted)

**Required (source):**

- `src/storage/publication/**` — `publish-record.ts`, `index.ts` (new;
  fs-bearing + composition boundary).
- `src/storage/locks/**` — `lock.ts`, `index.ts` (new; the only
  randomness/PID/clock-exempt modules).
- `src/storage/read/**` — `read-record.ts`, `enumerate.ts`, `index.ts`
  (new; read-only; no mutating fs APIs).
- `src/storage/audit/write-audit.ts` + `index.ts` (new; **fs-free**
  publication-only audit support).
- `src/storage/capabilities/authenticity.ts` (extend: `WriteCapability`,
  `ReadCapability`, `VerifyCapability` brands + gated creators).
- `src/storage/trusted-input/bootstrap-input.ts` (extend:
  `StorageWriteActionProvenance`, `TrustedWriteRequest` domains +
  creators).
- `src/storage/types.ts` (extend: write/read operation and result types,
  lock-record type, audit-event payload types).
- `src/storage/format/taxonomy.ts` (extend: `Wp8Production` value for
  mechanical write-audit production of `authoritative-audit-event`).
- `src/storage/initialization/provision.ts` + `state.ts` (amend:
  phase-3 fixed entry set — D-7; cross-phase amendment requiring
  explicit authorization).
- `src/storage/index.ts` (extend private barrel; no creators
  re-exported).

**Required (tests):** `tests/unit/storage/{publication,locks,read,audit}.test.ts`
(new); `tests/unit/storage/{capabilities,trusted-input,static-guard,taxonomy}.test.ts`
(extend); `tests/process/storage-crash/{crash-harness,fixture}.test.ts`
(new); `tests/security/security.test.ts` (exact delegation growth);
`package.json` (one focused `test:storage-crash` script only; exports,
dependencies, and `files` unchanged).

**Optional:** `tests/unit/storage/{layout,envelope,limits,errors}.test.ts`
extensions where the new types touch them; `tests/unit/storage/initialization.test.ts`
extensions for the entry-set amendment.

**Prohibited:** every other path. Explicitly: `src/index.ts`; package
exports/dependencies; the WP-8 contract; all ADRs; `src/control-plane/**`;
`src/storage/{registry,recovery,retention,migration}/**`; any
`tests/security` blanket exclusion; any path in `tests/` outside the
listed envelope; any new brand-bearing module; any new dependency,
subprocess-in-runtime, native addon, or network access.

## 20. Deferred Responsibilities (mapped)

| Item | Future phase / owner |
|---|---|
| `ConfigurationSnapshotRecord` persistence; configuration genesis/current-head materialization; configuration recovery | later configuration phase (CSR-011…016; D-11) |
| Registry derivation, materialized views, registry snapshots | phase 4 (RGY; §29) |
| Full audit-history pipeline, audit reconstruction, gap repair | phase 4 (RDS-006, CSA-013/014, AUD-011/012) |
| Recovery scanner, quarantine (+ evidence), `quarantine-evidence` | phase 4 (CSA, WPR-023) |
| Stale-lock breaking, confirmed-dead classification, lock quarantine, lock-recovery evidence, concurrent recovery | phase 4 (LOK-007/009/010/016) |
| `StoreEvidenceRecord` production (all kinds) | phase 4/5 (TAX-008) |
| Retention execution, deletion evidence | phase 5 (RNT) |
| Migration | phase 5, gated by DS-13 |
| Signing / rollback anchors | DS-07 / DS-27 (human authorization) |
| Cross-process authentication | DS-18 (before any cross-process mutation phase) |
| WP-12 control-plane producer (incl. `src/control-plane/storage-write-action.ts`) | WP-12 |
| MCP inspection | WP-9 |
| Project-file writing | WP-11 |
| Pi / pi-guard integration | WP-5B / WP-13 |
| Execution | WP-13 |

## 21. Requirement Allocation

Class: **I** = implemented in WP-8-D; **T** = tested in WP-8-D;
**IL** = integrated later; **D** = deferred; **NO** = not owned;
**R** = regression-only (no new WP-8-D obligation; committed coverage
re-run at the WP-8-D gate).

| Requirement | Class | WP-8-D basis |
|---|---|---|
| WPR-001…008 | I/T | validate-before-persist; canonical bytes; temp; hard-link; temp fsync+verify; EEXIST; dir-sync order; success gating |
| WPR-009 | IL | no index in WP-8-D; vacuous until phase-4 index update |
| WPR-010 | I/T | audit at same durability point |
| WPR-011 | I/T (removal half); D (quarantine half) | own-temp removal; quarantine with evidence = phase 4 |
| WPR-012 | I/T | idempotent retry per class |
| WPR-013 | I/T | one record per atomic unit; audit as ordered second unit |
| WPR-014 | I/T | trusted action identity on every write |
| WPR-015 | I/T | hard-link failure mapping |
| WPR-016 | I/T (record-valid side); D (quarantine) | crash after link; orphan quarantine = phase 4 |
| WPR-017 | I/T | durability-unknown; verification required |
| WPR-018 | I/T | cancellation/timeout semantics |
| WPR-019 | I/T | verify before idempotent declaration |
| WPR-020 | I/T | permission policy on published records |
| WPR-021/022 | I/T | durability point; stage failure semantics |
| WPR-023 | D | crash-reappearing temp classification = phase 4 (harness asserts input state) |
| LOK-001…006, 008, 009, 011…015, 017, 018 | I/T | single writer; readers safe; published-only reads; lock path/creation/identity; liveness-undeterminable fail-closed; never break; bounded wait; cancellation; identity release; crash persistence; PID-reuse defense; revisions; repository lock irrelevance |
| LOK-007 | I/T (fail-closed portion); D (classification used to mutate) | never treat as stale in WP-8-D; full stale classification = phase 4 |
| LOK-010, 016 | D | lock-recovery evidence/audit; concurrent recovery = phase 4 |
| RDS-001…004, 008…012 | I/T | read/verify/enumerate exact surface |
| RDS-005…007 | D | registry resolution, audit-history, corruption detection = phase 4 |
| TAU-004 | I/T | trusted action identity on writes (capability-bound) |
| TAU-005 | I/T | non-derivability (capability model) |
| TAU-007 | I/T | fail closed when identity/config unestablishable |
| API-004 | I/T | write capability consumable only by trusted control plane (zero-producer posture) |
| CAP-001 | I/T | write/read/verify kinds now have gated issuance (recovery/retention/migration remain vocabulary) |
| CAP-002…007, 010…016 | I/T | gated creation; bindings; non-transferability; non-serializability; brand; hostile channels; invalidation rules |
| CAP-008/009 | I/T | admission capture + four mutation-boundary revalidations (TVR-014) |
| AUD-001 | I/T (`authorized-write` only); IL (`idempotent-duplicate`, `conflict` — phase 4) | 22.1 partial allocation, **human-acknowledged** (D-12, ADR-029); WP-8-D does not claim full AUD-001 conformance |
| AUD-002/003 | I/T | immutable, ordered, linked, digest-bound, same durability point |
| AUD-004 | I/T | audit failure fails the operation |
| AUD-005…007 | I/T (write-event scope) | evidence-only; bounded disclosure; indefinite retention |
| AUD-008…012 | D | lock recovery, migration, audited reads, reconstruction = phase 4/5 |
| AUD-013 | I/T | audit-stage failure distinction per 10.5 |
| FSP-001…015 | I/T (publication/read subset) | derivation; traversal; no-follow; parent replacement; descriptor types; link-only; mount drift; perms; tmp confinement; disclosure; profile; hard-link protocol; no symlink reach; point-of-use; no external tooling |
| ITG-003 | I/T | location verification in read/verify |
| VRS-003 | I/T | reads at accepted versions; writes only at current version |
| SRE-006, 008…015 | I/T | atomicity/crash safety; unauthorized-write rejection; least authority; bounds; disclosure; dependency boundary; no spawn in runtime; no credentials; no network |
| SRE-001…005 | R | committed WP-8-B/C root-isolation, containment, symlink/replacement, special-file, and repository-forgery coverage; re-verified at the WP-8-D gate; publication/read must not weaken them (FSP, SRX) |
| SRE-007 | R | committed tamper-detection coverage re-run by WP-8-D read/verify; full tamper matrix remains phase-4 (ITG, TML) |
| TVR-001…002 | I/T | categories A–I coverage; crash injection at every write stage (harness) |
| TVR-005 | I/T (WP-8-D subset); D (stale-lock classification) | single-writer, reader safety, contention, timeout, liveness-undeterminable fail-closed; full stale classification = phase 4 |
| TVR-006 | I/T | exact/+1 for the 14 applicable limits |
| TVR-007/008 | I/T | determinism; unsupported-lane fail-closed (probe reuse) |
| TVR-009 | I/T | mutation-evidence assertions in harness |
| TVR-010/011 | I/T | boundary/dependency checks (static guard) |
| TVR-012 | I/T | lifecycle integration via the documented gate |
| TVR-013 | I/T | matrix completeness verification |
| TVR-014 | I/T | hostile channels + mid-operation invalidation at all four boundaries |
| TVR-015 | I/T | effective mode/owner verification incl. inherited-access rejection |
| CSR-006 | IL | config-store persistence substrate now exercised (write side) |
| RGY, RNT, CSA, TML-007/008, CLE | D/NO | later phases / closure |

**Decision-to-requirement mapping (D-2…D-12, ADR-029):**

| Decision | Requirement rows | Allocation |
|---|---|---|
| D-2 zero production write authority | API-004, CAP-002/003/005/006/012, TAU-005 | I/T (posture enforced by the static guard; zero-producer edge) |
| D-3 locks-only entropy/process identity | LOK-005/006/015, DTM-007, SRE-009/011, TVR-A | I/T (`randomBytes` + `process.pid` in `src/storage/locks/lock.ts` only; negative leakage tests) |
| D-5 verified-StoreMetadata binding | CAP-002…004/008/010/014, LMT-011, SRX-013 | I/T (binding tuple; separate authenticity domains) |
| D-6 mechanical write-audit production | AUD-005, TAX-002/011/012 | I/T (narrow `Wp8Production` amendment; no other class changes) |
| D-7 phase-3 entry set + provisioning sequence | LAY-001, FSP-004/005/008, SRX-006/014, TAX-010, CAP-001/004 | I/T (classifier-policy-revision-bound five-state classification; initialization-family `provision-phase3` operation; pre-lock provisioning via `src/storage/publication/index.ts`; class/shard creation under the live `WriteCapability`) |
| D-8 deterministic audit identity/ordering | AUD-002/003, DTM-003/007, WPR-012/019, 16.3 (phase-4 view) | I/T (identity tuple; no stored sequence; no contract revision) |
| D-12 partial AUD-001 allocation | AUD-001 | I/T (`authorized-write`); IL (`idempotent-duplicate`, `conflict`) |
| Same-action temp-EEXIST retry (MINOR-2) | WPR-003/012/017/019, ERM-006, 10.5 | I/T (protocol in §10; crash-harness cases) |
| Taxonomy amendment (D-6) | TAX-011, RFM | I/T (one union member; one class; canonical array rules: exact order, no duplicates, one-element arrays except audit) |
| Classifier amendment (D-7) | LAY-001, TAX-010 | I/T (fixed-entry constant; classifier-policy-revision-bound; five-state matrix) |

## 22. Decision Register

| ID | Issue | Classification | Disposition |
|---|---|---|---|
| D-1 | Eligibility/decomposition report path does not exist | implementation-owned | Substituted: contract §29 + WP-8A report §14 (deviation, §1) |
| D-2 | Write-capability producer posture | **human-approved (ADR-029)** | **Zero production write-provenance producers in WP-8-D**; future producer `src/control-plane/storage-write-action.ts` documented as static policy only, not implemented; zero-importers static policy; production publication unreachable; no public/test-hook escape |
| D-3 | Static-guard randomness/PID/clock exception for the lock module | **human-approved (ADR-029)** | Required (12.3 mandates random nonce); granted to the exact module `src/storage/locks/lock.ts` only (`randomBytes` from `node:crypto` + `process.pid`; injected start-time/clock/boot identity; no production `/proc` read); negative leakage tests; senior decision-resolution review sign-off |
| D-4 | Lock scope (per-namespace file vs store-wide single-writer) | contract ambiguity (DS-10 vs LOK-004) | WP-8-D: store-v1 lock only; ambiguity harmless in-phase; must be resolved before the configuration phase (D-9) |
| D-5 | Write capability binding to verified metadata | **human-approved (ADR-029)** | The WP-8-D human authorization exercised the ADR-028 decision-C gate; binding only after full StoreMetadata verification (descriptor-bound read, canonical parse, digests, namespace/parent/configuration/limit-profile identity); complete binding tuple in ADR-029 |
| D-6 | Taxonomy `Wp8Production` for `authoritative-audit-event` | **human-approved (ADR-029)** | Narrow amendment selected: union gains `'write-audit'`; field becomes `readonly Wp8Production[]`; `authoritative-audit-event` → `['reconstruction-only', 'write-audit']`; no other class or event kind changes. **Canonical array rules (M-3):** immutable arrays; no duplicates; never empty; exact declared order; no runtime sorting; every non-audit profile uses an exact one-element array (`['no']`, `['initialization']`, `['maintenance']`, `['reconstruction-only']`); only the audit profile has two values and contains `'write-audit'`; the four committed scalar taxonomy-test assertion sites update to array equality at implementation time |
| D-7 | Phase-3 fixed entry set + classifier | **human-approved (ADR-029); amendment of committed WP-8-C `provision.ts`/`state.ts` explicitly authorized** | `records`, `audit`, `locks` as **classifier-policy-revision-bound** fixed entries; five-state classification (A phase-2 initialized → `PROVISIONAL / PHASE3-UPGRADE-REQUIRED`; B upgrade in progress → `PROVISIONAL`; C incomplete phase-3 → `PROVISIONAL` regardless of the metadata flag; D foreign/invalid → fail-closed per precedence; E exact phase-3 set → `INITIALIZED`); committed semantics corrected (verified-metadata + missing fixed entries → FOREIGN in phase-2); provisioning authority pinned (M-1): initialization-family operation-set extension `{namespace-initialize, provision-phase3}`, existing `InitializationCapability` domain, existing trusted gate, zero production issuance, consumer `src/storage/publication/index.ts`, top-level targets `<ns>/records`/`<ns>/audit`/`<ns>/locks` only; class/shard creation requires a genuine live `WriteCapability` after lock acquisition with layout-derived segments and validated 4-hex shards; no raw path operand; unknown entries remain FOREIGN; no repair/deletion/adoption; no StoreMetadata format change; no migration |
| D-8 | Audit-event identity + sequence ordering | **human-approved (ADR-029); contract revision NOT required** | Selected: domain-separated digest of (store/namespace identity, primary record class, primary instance/revision identity, primary record digest, event kind, trusted action identity) → `pgw:l:<32-hex>`; **no operation ordinal** (single-writer uniqueness; an ordinal would break idempotent retry); ordering (primary `createdAt`, primary record identity, audit event identity) with identity as total-order tiebreaker; **no stored normative numeric sequence**; numeric sequence is a later derived registry/recovery view (phase-4 gap markers). Rejected: counter-under-lock; nonce/PID/time-based identity |
| D-9 | Cross-namespace single-writer exclusion | deferred | Configuration phase must resolve (store-wide serialization or contract clarification) |
| D-10 | Lock-release failure code (post-durability) | implementation-owned | `ERR-STO-PUBLISH-FAILED` (cleanup-failure class); no new code (ERM-001); documented in §12 row 22 |
| D-11 | `ConfigurationSnapshotRecord` persistence timing | task-directed deferral; contract permissive (W8A-R08/I, FPH-005) | Deferred to the later configuration phase; permissiveness recorded; re-openable at that phase |
| D-12 | Idempotent-duplicate/conflict audit event kinds | **human-acknowledged phase allocation (ADR-029)** | WP-8-D implements the minimum `authorized-write` event only and does **not** claim full AUD-001 conformance; `idempotent-duplicate`/`conflict` kinds deferred to phase 4; requirement tables classify AUD-001 partial/IL; this is an explicit phase allocation boundary, not an omission hidden from acceptance |
| D-13 | Directory provisioning timing | implementation-owned | **Lazy provisioning selected (D-7, ADR-029)**: phase-3 directories provisioned at first write via a distinct pre-lock `{provision-phase3}` capability; initialization-time provisioning rejected |
| D-14 | Crash-harness placement/runner | implementation-owned | In WP-8-D; `tests/process/storage-crash/**`; focused `test:storage-crash` script; no dependency/export change |
| D-15 | Read/verify capability issuers | implementation-owned | Gated factories, zero production consumers until WP-9/WP-12 |

**Already normative in the contract (no decision needed):** publication
primitive (DS-21), durability point (DS-09), transaction boundary
(DS-08), lock record fields (OD-002/LOK-005), error codes (18.1),
limits (19.1), revalidation boundaries (CAP-009), audit failure
semantics (AUD-013/10.5), existing-target classification (10.2/18.2).

**ADR necessity.** A **WP-8-D ADR is required** to bind the durable
items: (1) **write-capability producer posture** (zero producers +
documented future `storage-write-action.ts` boundary) — *options:* zero
producers (recommended); one static-policy-enforced future consumer path
with no implementation; — *consequences:* production publication
unreachable until WP-12 (preferred safety posture) vs earlier wiring
risk; *human gate:* WP-8-D authorization; (2) **static-guard
randomness/PID/clock exception scope** — *options:* locks-module-only
exception (recommended); injectable-only with no production default;
— *consequences:* contract-mandated random nonce vs determinism
invariants; *human gate:* senior security review; (3) **audit-event
identity and ordering model** — *options:* deterministic derivation +
rebuildable sequence (recommended); counter-under-lock; contract
revision — *consequences:* idempotency and phase-4 reconstruction
interoperability; *human gate:* senior review; (4) **phase-3 entry-set /
classifier amendment** — *options:* lazy provisioning + classifier
amendment (recommended); initialization-time provisioning;
— *consequences:* WP-8-C source amendment scope; *human gate:*
WP-8-D authorization; (5) **lock-scope clarification** for the
configuration phase. **The human approved the seven decisions; `docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md`
was created and binds them** (items 1–4 above as decision blocks D-2/D-3,
D-6/D-8/D-12, and D-7, each with rejected alternatives and consequences;
the audit identity/ordering model carries its own no-contract-revision
gate). The lock-scope clarification (item 5, D-9) remains deferred to the
configuration phase; DS-10's contract-revision reopen gate applies.

## 23. Findings, Blockers, Deviations

**Findings.**
- **F-1 (cross-phase integration, required):** WP-8-C's
  `NAMESPACE_FIXED_ENTRIES = ['metadata','tmp']` and `classifyNamespace`
  mark any additional namespace entry FOREIGN (fail closed). WP-8-D
  publication requires `records/`, `audit/`, `locks/` (and class shard
  dirs) to exist, so the committed WP-8-C initialization source must be
  amended (entry set + classifier, classifier-policy-revision-bound). Unavoidable; must be
  explicitly authorized (D-7).
- **F-2 (taxonomy):** `Wp8Production: 'reconstruction-only'` for
  `authoritative-audit-event` contradicts WPR-010's write-audit
  obligation; must be amended (D-6).
- **F-3 (static policy):** 12.3's random nonce + PID/time fields
  conflict with the blanket randomness/process prohibitions of the
  storage static guard; exact-module exception required (D-3).
- **F-4 (audit sequencing):** normal-operation audit sequence allocation
  is unspecified in the contract; proposed deterministic model (D-8).
- **F-5 (lock scope):** per-namespace lock files vs store-wide single
  writer wording (D-4/D-9).
- **F-6 (delegation):** the global no-I/O security test's exact module
  set must grow (four new compiled paths); no blanket exclusion.
- **F-7 (configuration permissiveness):** contract phase-3 note
  (W8A-R08/I) permits configuration-record publication in phase 3; this
  task defers it (D-11); recorded, not silently resolved.

**Disposition of findings after decision resolution:** F-1 is closed by
the approved D-7 (entry-set/classifier amendment authorized); F-2 by D-6
(taxonomy amendment defined); F-3 by D-3 (locks-only exception approved);
F-4 by D-8 (deterministic model selected; no contract revision); F-5
remains recorded (D-4/D-9 deferred to the configuration phase); F-6
remains an implementation-owned guard change; F-7 remains recorded
(D-11 deferral).

**Senior-review MINOR findings:** MINOR-1 corrected (§15 exact 31-code
table); MINOR-2 corrected (§10 same-action temp-EEXIST retry protocol);
MINOR-3 corrected (D-12 reclassified human-acknowledged, §21/§22).

**Blockers:** none. The seven decisions (D-2, D-3, D-5, D-6, D-7, D-8,
D-12) are human-approved and bound by ADR-029; implementation
authorization remains a separate human gate.

**Deviations:** D-1 (eligibility report path substitution — actual
equivalent used); no other deviation. The contract, all ADRs, all runtime
source, and all tests are untouched by this task.

## 24. Next Gate

**WP-8-D FOCUSED DECISION-PACKAGE REREVIEW** — rereview of the focused
decision-package correction (M-1…M-4) applied to ADR-029, the
decision-resolution report, and this consolidation report. Implementation,
staging, commit, and later phases remain unauthorized.

---

**WP-8-D PRE-IMPLEMENTATION DECISION CONSOLIDATION: RESOLVED (M-1…M-4 CORRECTED)**
**OPEN FINDINGS: 0** (findings F-1…F-7 recorded; F-1…F-4 closed by the
approved decisions, F-5/F-6/F-7 recorded or deferred; the seven decisions
D-2, D-3, D-5, D-6, D-7, D-8, D-12 are human-approved and bound by
ADR-029; senior-review MINOR findings 1–3 corrected; D-9/D-11 remain
deferred)
**NEXT GATE: WP-8-D FOCUSED DECISION-PACKAGE REREVIEW**
**IMPLEMENTATION AUTHORIZATION: NOT GRANTED**
**STAGING AUTHORIZATION: NOT GRANTED**
**COMMIT AUTHORIZATION: NOT GRANTED**
**PUBLICATION: NOT PERFORMED**
