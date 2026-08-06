# WP-8-D — Senior Pre-Implementation Security and Architecture Review

**Review type:** adversarial, read-only senior review of the WP-8-D
pre-implementation decision consolidation.
**Primary input:** `docs/reports/wp-8d-pre-implementation-decision-consolidation-report.md`
(967 lines).
**Independently checked:** the authoritative contract
(`docs/specs/wp-8-local-storage-registry-contract.md`, SHA-256
`aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`, read in
full), committed `src/storage/**` (layout, taxonomy, provision/state,
capabilities, trusted-input, errors/precedence, limits, root), committed
`tests/unit/storage/**`, `tests/security/security.test.ts`,
`docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`,
ADR-028, the WP-8-C implementation report (committed), the WP-8A foundation
report §14, WP-6 trusted-configuration code, WP-7 reader/git/fff trees,
package/export/dependency configuration, and the WP-2/WP-4 identity and
canonicalization profile. No file other than this report was created or
modified; nothing was staged or committed.

---

## 1. Repository, Branch and HEAD

| Item | Expected | Verified |
|---|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` | exact |
| Branch | `main` | exact |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact |
| Staging | empty | empty (`git diff --cached` empty) |
| Commits after HEAD | zero | zero |
| Tags | zero | zero |
| Unstaged before this report | exactly 3 documentation paths | 2 modified (`post-wp5a-roadmap.md`, `post-wp5a-planning-status.md`) + 1 untracked (`wp-8d-pre-implementation-decision-consolidation-report.md`) |
| Contract SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` | exact (`sha256sum` + committed static guard) |
| Dependencies | `ajv@8.20.0` only | exact (`package.json`/lock unchanged) |
| Public exports | 42 | 42 (`dist/index.d.ts` audit) |
| Package exports | `"."`, `"./pi-adapter"` | exact |
| `src/index.ts` | unchanged | unchanged; zero storage references |
| Production bootstrap-provenance producer | absent | absent (`src/control-plane/` does not exist) |
| Production initialization | unreachable | unreachable (action-provenance creator has zero production importers; static-guard enforced) |
| WP-8-D runtime source | none | none (`src/storage/{publication,read,audit,registry,recovery,retention,lock,locks}` absent) |
| WP-9 work | none | none (no `src/mcp`, no control trees) |
| Publication | none | none (no tags, no release artifacts) |

Executed at HEAD to confirm the operational-baseline claims:
`npm run typecheck` (pass), `npx tsc -p tsconfig.tests.json` (pass),
`node --test dist-test/tests/unit/storage/static-guard.test.js
dist-test/tests/security/security.test.js` → **31/31 pass, 0 fail, 0 skip**
(16 static-guard + 15 global security). After the report was created the
working tree contains exactly the three prior documentation paths plus this
report.

## 2. Baseline / Scope Result

**ESTABLISHED.** No source or test delta, no contract or ADR delta, no
WP-8-D runtime source, no WP-9 work. The three unstaged paths are all
documentation and were present before this review.

## 3. Governance Waiver Result

**WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION**

Recorded as a governance fact. This review does not claim that the baseline
commit `bd832606…`, its complete 31-file manifest, or its commit report was
independently verified. The commit is treated as the operational baseline
per human direction (consolidation §2 records the same; roadmap and
planning status corroborate). The committed WP-8-C implementation report
states its own acceptance (including a final micro spot-check banner); that
is the committed document's claim, not an independent verification by this
review.

## 4. Phase-Eligibility Result

**VALID.** WP-8-D is contract §29 implementation **Phase 3** ("Durable
single-record publication and exact reads"), the earliest dependency-safe
phase after Phase 2 (WP-8-C): prerequisites (phases 1–2; DS-01/02/08/09/10/
21 resolved) are satisfied by the committed baseline; owned areas (hard-link
publication, writer lock, exact read/verify, capability factory
write/read, durability) match the consolidation; prohibited areas (registry
derivation, retention, migration) are not claimed. WP-8-D can begin
decision closure without WP-8-E configuration persistence, registry
derivation, recovery, stale-lock breaking, retention, migration, WP-12,
MCP, or Pi. No requirement makes WP-8-D structurally dependent on a later
phase: WPR-010/AUD-003 (write-audit at the durability point) is
WP-8-D-internal; phase-4 items (recovery, reconstruction, quarantine,
registry, audit pipeline, config persistence, stale-lock breaking) are all
downstream consumers of the WP-8-D substrate. The consolidation's forward
references (CSA-005/013, WPR-023, 16.3) are reporting boundaries, not
dependencies. **No circular deferral found.**

## 5. Record-Class Scope Result

**COHERENT.** Independently reconstructed from contract §6.2 + §29 + §28:
all 18 classes in the consolidation's matrix match the contract on
semantic owner, producer, immutability, and phase ownership, including the
special rows: `MigrationRecord` (DS-13-deferred), `AuthoritativeAuditEvent`
(§6.2 producer column "trusted control plane"; the minimal `authorized-write`
event is emitted mechanically by the store under the capability-bound
trusted action identity — evidence only, AUD-005/22.2; the tension is
correctly surfaced as F-2/D-6 and must be explicitly acknowledged in the
ADR), registry snapshots (phase 4, RGY-008), store metadata (never
republished; TAX-007), `StoreEvidenceRecord` (phase 4/5, closed
`evidenceKind` verified in committed taxonomy), `ConfigurationSnapshotRecord`
(deferred, D-11; contract permissive via W8A-R08/I and FPH-005 — the
deferral is recorded, not silently resolved).

The consolidation correctly separates (a) semantic production (never WP-8-D
for WP-2/WP-12 classes), (b) validation of externally produced records
(class-generic, exists as a substrate), and (c) durable canonical-byte
publication (substrate class-generic; reachability determined by producer
availability). Both unsafe interpretations are rejected: WP-8-D does not
become the semantic producer of any WP-2/WP-12 record (TAX-002, TAU-010),
and primary publication is exercisable through test-only producers while
production publication is unreachable. The "first persistence phase" column
accurately distinguishes "substrate available in WP-8-D" from "producer
available in WP-8-D".

## 6. Namespace-Layout Result

**CORRECTLY CLASSIFIED.** Committed facts verified: `provision.ts`
`NAMESPACE_FIXED_ENTRIES = ['metadata','tmp']`; `classifyNamespace` marks
any additional entry FOREIGN (fail closed). Contract §5.2 already
normatively defines the seven per-namespace directories (metadata, records,
index, audit, tmp, locks, quarantine) and LAY-001 requires the namespace
structure of 5.2; WP-8-D's needed subset (records, audit, locks) is
therefore contract-normative, not a contract revision. F-1/D-7 is correctly
classified: **implementation-owned amendment of committed WP-8-C
initialization source requiring explicit phase authorization**, with
version-bound entry-set acceptance and lazy provisioning (D-13). A
backward-compatible provisional path exists under the committed classifier
(missing fixed entries → PROVISIONAL when metadata is unverified), so
existing WP-8-C-initialized stores remain classifiable after the amendment.
The report does not propose an authoritative layout decision without
authorization — D-7 is explicitly gated. The entry-set change is treated as
a security boundary change (F-1), not an implementation detail.

## 7. Publication-Protocol Result

**VERIFIED AGAINST THE CONTRACT TEXT.** The consolidation's 22-stage table
is a faithful mapping of the contract's normative 10.1 ten-step order:
temp exclusive creation → write-all → temp fsync → descriptor verify →
hard link (link(2), rename prohibited, DS-21) → final-dir fsync → temp
unlink → tmp-dir fsync → **audit publication** → success. The claim that
§10.1 orders audit **after** temporary cleanup is verified from the actual
text (steps 7–8 precede step 9; WPR-007 fixes final-dir fsync before
unlink; WPR-008/021 require durable audit state before success). Cleanup
before audit does not introduce unacceptable ambiguity: the post-cleanup
failure window leaves a durable primary with a missing audit event, which
10.5/CSA-005/16.3 define precisely (DURABILITY-class outcome; recovery
completes or reconstructs; WP-8-D never fabricates). The alternative order
would instead leave an orphaned temp with a published record (WPR-023
class (a)) — the contract's order is the cleaner failure mode. Final path
derivation (LAY-003…008 via committed `deriveRecordRelativePath`), temp
confinement (WPR-003/LAY-010, WP-8-C scratch pattern), mode/UID policy
(0600/configured UID), no-overwrite, hard-link assumptions (probe-backed,
FSL-010), retry/idempotency (WPR-012/019), conflict semantics (10.2/18.2),
and the single operation durability point (10.5 = union of primary and
audit elements) all match the contract. One bounded gap: see MINOR-2.

## 8. Existing-Target Result

**CORRECT.** Every row of the §11 table was checked against 10.2/18.2/
FSP-005/006/SRX-006/WPR-019: identical bytes → idempotent duplicate
(class-permitted success, verify-first); same digest/different bytes →
impossible for canonical forms (RFM-014 injectivity), observed mismatch →
INTEGRITY; same identity/different payload → DUPLICATE; revision/digest
conflict → CONFLICT-REVISION; FIFO/socket/device/symlink/directory →
FTYPE-UNSUPPORTED (no-follow, FSP-003/005); unexpected hard link →
INTEGRITY where detectable (FSP-006); UID/mode mismatch → PERM-DENIED;
unsupported version → UNSUPPORTED-VERSION (only after structural validity,
ERM-014); malformed → MALFORMED (precedes version); primary-durable-audit-
missing → DURABILITY + recovery-required outcome (10.5 audit row), never
fabricated. No target is ever overwritten (hard-link no-replace);
idempotent success requires the full invariant set (canonical bytes +
digest + location + descriptor verification), not merely matching bytes.

## 9. Audit Identity/Ordering/Recursion Result

**CLEAR DECISION PATH; OPEN HUMAN DECISION (gates implementation, not this
gate).** The contract fixes audit ordering semantics (AUD-002/003, DTM-003,
6.4 logical sequence per class, 24.1) and recovery reconstruction sequence
allocation (16.3: next audit sequence + gap markers) but does **not**
define the normal-write audit-event identity or the sequence allocation
mechanism for ordinary operations — the envelope (7.1) has no class-level
sequence field. The consolidation correctly does **not** silently resolve
this: D-8 records the proposed deterministic model (identity = domain
digest of (primary identity, event kind) → `pgw:l:<32-hex>`; ordering =
(primary createdAt, identity); numeric sequence = rebuildable derived
position, compatible with phase-4 gap-marked reconstruction) with
alternatives (counter-under-lock; contract revision for stored sequence
semantics). The deterministic derivation is achievable, so this is a
**human decision with a clear path, not a blocker of decision
resolution**; it is a blocker for implementation authorization until
selected (the consolidation's §23 gating is correct). Recursion is
prevented by the closed §22.1 event list (verified: "audit-event
publication" is not an audited event; AUD-001 does not chain; the
authorized-write event is terminal). Two bounded points: (a) AUD-001's
unconditional sweep over 22.1 includes `idempotent-duplicate` and
`conflict` kinds, whose deferral to phase 4 is recorded as
"implementation-owned" (D-12) — this touches a normative requirement and
should be reclassified as a human-acknowledged decision (MINOR-3);
(b) audit ordering across namespaces is vacuous in WP-8-D (only store-v1 is
written) and after crash is phase-4 reconstruction — both consistent with
the derived-position model.

## 10. Durability Result

**TRUTHFUL.** The §12 matrix covers every stage where primary/audit/temp/
lock state can diverge, with the committed state-summary vocabulary
(primaryStateChanged, durabilityPointReached, auditChanged,
verifyBeforeRetry) and only closed 31-code vocabulary (verified in
`errors/codes.ts`: all required codes exist — DUPLICATE, CONFLICT-REVISION,
LOCK-UNAVAILABLE, LOCK-TIMEOUT, CONCURRENCY, CANCELLED, TIMEOUT,
PUBLISH-FAILED, CONTAINMENT-DENIED, FTYPE-UNSUPPORTED, LIMIT-EXCEEDED).
Per-stage rows match 10.5 exactly (step-6/7/8/9 rows: DURABILITY /
PUBLISH-FAILED / DURABILITY / DURABILITY), the EROFS phase rows match 18.1,
and CAP-009 invalidation rows match 21.2 verbatim (REQ-INVALID before any
trusted-state mutation; DURABILITY-class, no rollback, verify-before-retry
after primary publication; durable state authoritative, idempotent replay,
verify-required not success at acknowledgement). The contract does **not**
permit ordinary IO-FAILURE after primary durability — 10.5 mandates
durability/recovery-specific results — and the matrix honors this
(IO-FAILURE rows are all pre-publication or transient-state). Publication
never claims rollback after a durable link (CSA-007; §8 rows 3–4).

## 11. Capability Result

**NON-AMBIENT; CONSERVATIVE.** The proposal extends the existing two
brand-bearing modules (`capabilities/authenticity.ts`,
`trusted-input/bootstrap-input.ts`) with new **separate** private-domain
brands (WriteCapability, ReadCapability, VerifyCapability;
StorageWriteActionProvenance, TrustedWriteRequest) rather than a shared
brand — cross-kind substitution is prevented by distinct WeakSets, and no
third brand-bearing module (and thus no static-guard brand change) is
needed. Verified against the committed framework: generation registry reuse
(configuration replacement advances generation; stale capabilities fail),
store-instance binding to verified StoreMetadata namespace identities
(ADR-028 decision C gate "future capabilities may bind to verified metadata
only after later human authorization" verified verbatim — the WP-8-D human
authorization is that gate, D-5), configuration/action/limit-profile/
operation bindings, disposal, detached-method/structured-clone/Proxy/
reflection rejection (CAP-015 pattern), re-export and direct-import
restrictions (creator-consumer edges; zero production importers for the
write-action-provenance creator until the future
`src/control-plane/storage-write-action.ts` exists — WP-12). Producer
posture: zero production write-provenance producers; zero production
write-capability consumers outside the future trusted control plane
(API-004); production publication unreachable; no public/test-hook escape.
Read/verify creators are gated with zero production consumers (CAP-001,
API-003/008). Meaningful unit and process testing remains possible via
test-only producers, mirroring the established WP-8-C pattern.

## 12. Revalidation Result

**CORRECT.** The four CAP-009 boundaries are verified verbatim against
21.2: before first trusted-state mutation; immediately before primary
publication; before required audit publication; before reporting successful
completion. The §8 table's phase-aware outcomes match CAP-009 exactly
(including the subtle point that boundary 2 occurs while lock/temp are
still transient, so invalidation there is REQ-INVALID with containment —
release own lock, remove own temp — and no trusted-state change). After
durable primary publication, invalidation must not prevent truthful
durability completion: the contract requires stopping advancement except
containment/recovery/evidence and returning the phase-aware
verify-before-retry result; the consolidation's rows 3–4 implement exactly
this (no rollback fabrication, no silent success, audit completeness left
to phase-4 reconstruction). The capability is never used to advance after
invalidation (which would itself violate CAP-009's first sentence).

## 13. Lock Result

**SOUND; ONE RECORDED AMBIGUITY.** Path `store-v1/locks/writer.lock`
verified against 12.3/LOK-004 and the committed
`WRITER_LOCK_RELATIVE_PATH = 'locks/writer.lock'` in `layout.ts`.
Normative fields (12.3/OD-002/LOK-005) are all present: lock version,
store-instance identity, random per-acquisition nonce, trusted action
identity digest, PID, process start time, boot identity "where available",
acquisition time, max age from the limit profile. Exclusive no-follow
creation mode 0600, file fsync, locks-dir fsync, identity-bound release
(nonce + store-instance) + locks-dir fsync (LOK-013), bounded wait
(LMT-008 → LOCK-TIMEOUT), contention → LOCK-UNAVAILABLE, PID-reuse defense
(LOK-015), crash persistence (LOK-014) with follow-up operations failing
closed until recovery. WP-8-D **never** classifies stale and **never**
breaks an existing lock (LOK-007/009): every lock that cannot be positively
identified as the caller's own live acquisition (other-live, stale-looking,
malformed, foreign) fails closed with ERR-STO-LOCK-UNAVAILABLE. The
DS-10 ("whole-store lock") vs 12.3/LOK-004 (per-namespace fixed path)
tension is real and correctly recorded (D-4/D-9): in-phase harmless (only
store-v1 is written) but must be resolved before the configuration phase
(DS-10's reopen gate is contract revision — recorded). Boot identity is
recorded as absent via an injectable source with no production default read
(contract-compliant "where available"; avoids out-of-store /proc I/O); the
recovery phase wires the real bounded source (NOTE-3).

## 14. Randomness/Process-Identity Result

**REQUIRED, NARROWLY SCOPED.** Contract 12.3 normatively requires a random
per-acquisition nonce plus PID and process start time; a deterministic
action-derived nonce would violate the contract and be weaker (an action
identity appears in the store's own records, so a derived nonce would be
replayable/forgeable). The committed static guard blanket-prohibits
`Math.random`, `crypto.random*`, `randomUUID`, `process.pid`,
`Date.now`, `process.hrtime` in `src/storage/**` (verified in the committed
guard). The exact-module exception (D-3) is therefore contract-mandated,
not convenience: `node:crypto` `randomBytes` + `process.pid` (plus
injectable start-time/boot-id/clock) confined to `src/storage/locks/**`,
with per-module allowlist entries, negative leakage tests, deterministic
test strategy (injectable entropy; uniqueness assertions, not value
assertions), and exact compiled-path delegation in the global security
test. No broad process or crypto access is authorized. Boot identity in the
supported Linux lane would require a bounded `/proc` read; WP-8-D has no
consumer (stale classification is phase 4), so the injectable-source
approach avoids it entirely this phase.

## 15. Read/Verify/Enumerate Result

**CORRECT.** Separate operations (API-003, CAP-001): exact read by
validated class + canonical typed identity only (RDS-001, LAY-005),
descriptor-bound no-follow, pre/post fstat (WP-8-C replay pattern),
`recordBytes` bound, canonical-only parsing (18.2/ERM-014), digest +
location verification (ITG-001/003 via committed `isDerivedRelativePath`),
copy-on-return (RDS-008), no lifecycle decisions, no mutation (RDS-011);
verify returns structured findings only, never content, never converts a
valid record into trusted authority (RDS-003, ITG-007/TAU-008), no repair;
enumeration fixed-class, bounded (`dirEntries`/`enumerationResults` +
continuation), deterministic ordering (DTM-003, never host order), no
recursion, per-record independent verification, malformed/foreign entries
as bounded findings never records, no registry semantics (RGY phase 4), no
path disclosure (RDS-012). Separate gated read/verify issuers with zero
production consumers until WP-9/WP-12 (API-008). Reads unaudited by default
(AUD-010).

## 16. Crash-Harness Result

**ADEQUATELY SPECIFIED.** `tests/process/storage-crash/**`: child processes
only in tests (runtime `child_process` denied by the committed guard,
SRE-013); STAGE-marker protocol with bounded deadlines and SIGKILL only
after proof of stage reach; no sleep-only synchronization; isolated temp
trusted root; orphan sweep limited to the harness's own children; exact
post-crash classification per the §12 rows; no unrelated filesystem
mutation (TVR-009); stale-compiled-output freshness gate; table-driven
stage matrix with fixed expected counts; focused `test:storage-crash`
script with no dependency/export/default-workflow change. The stage
inventory covers TVR-002/26.1-C (link, unlink, dir-sync, fsync, process
termination, stale temp, stale lock, lock release) plus capability
invalidation and root-drift kills. Minimum stages required before WP-8-D
acceptance: the full §12 kill matrix (lock create; tmp create; partial/
zero write; pre-fsync; post-fsync; link; EEXIST; post-link pre-dir-fsync;
dir-fsync failure; unlink; tmp-dir fsync; pre-audit; audit write/link/
dir-sync; post-durability lock release) — the proposed matrix contains all
of them.

## 17. Filesystem/Static-Guard Result

**FEASIBLE; FOUR IS SUFFICIENT.** New fs-bearing modules:
`publication/publish-record.ts`, `locks/lock.ts`, `read/read-record.ts`,
`read/enumerate.ts`, plus the amended `initialization/provision.ts` (existing
allowlist shape unchanged); `audit/write-audit.ts` is fs-free by design
(prevents a second publication path). Each new module has an exact per-API
allowlist, exact-name named imports only, no fs-name exports, no namespace
imports, no helper indirection escaping path ownership, no barrel-level fs
imports, no child-process in runtime. Global delegation grows by exactly
the four compiled paths; the fail-closed predicate and rejection inventory
remain; blanket `storage/**` delegation remains prohibited (W8C-I01
precedent). The read tree denies all mutating APIs (write/link/unlink/
mkdir/fsync). Static-guard amendments (allowlist entries, later-phase-
directory release for publication/read/audit with registry/recovery/
retention remaining absent, creator edges incl. zero-producer write
provenance, locks-only randomness/process exception with negative leakage
tests, storage↔WP-7 no-import-edge per SCP-005, read-tree mutation-API
denial) are all coherent with the committed guard.

## 18. Limits/Error Result

**CORRECT.** The 14 applicable limits (recordBytes, payloadBytes,
referencesPerRecord, pathComponentBytes, pathBytes, dirEntries,
enumerationResults, auditEventsPerOperation, recordsPerTransaction,
temporaryBytes, lockWait, operationTimeout, concurrentReaders, writers)
match contract 19.1 and the committed `limits.ts` member-by-member
(defaults, hard min/max, source, request-lowerability, exact/+1 behavior,
error, mutation-before-failure). The 6 deferred limits are exactly the
phase-4/5 scan/retention/quarantine/index limits. Error codes are from the
committed 31-code set (verified in `errors/codes.ts`); `selectPrecedence`
(18.2) is preserved unchanged; no new code is invented. Bounded count
mismatch: see MINOR-1.

## 19. Requirement-Allocation Result

**CONSERVATIVE; MEMBER-BY-MEMBER.** The §21 table allocates WPR-001…023,
LOK-001…018, RDS-001…012, TAU-004/005/007, API-004, CAP-001…016,
AUD-001…013, FSP-001…015, ITG-003, VRS-003, write-side SRE-006/008…015,
TVR-001/002/005…015, and CSR-006 with individual rows (no bare range
claims), each verified against the contract text: e.g., WPR-009/011/016/023
correctly split I/T from phase-4 quarantine halves; LOK-007 splits the
fail-closed portion from deferred stale classification; RDS-005/006/007
deferred; CAP-001 limits issuance to write/read/verify kinds; AUD-001
partial allocation (MINOR-3); TVR-006 covers the 14 applicable limits;
TVR-014 covers all four CAP-009 boundaries; SRE-013 (no spawn) enforced;
deferred groups (RGY, RNT, CSA, TML-007/008, CLE) mapped to later phases.
Bounded omission: SRE-001…005/007 have no explicit D/NO row (NOTE-2).

## 20. Implementation-Path-Envelope Result

**BOUNDED.** Required source paths are enumerated exactly (publication/**,
locks/**, read/**, audit/write-audit + index, six extended modules, two
amended WP-8-C modules with explicit authorization, private barrel);
required test paths enumerated (four new unit files, four extended unit
files, process harness, security-test delegation growth, one package
script); optional paths listed; prohibited paths comprehensive (contract,
all ADRs, `src/index.ts`, package exports/dependencies, control-plane,
registry/recovery/retention/migration trees, out-of-envelope tests,
blanket exclusions, new brand modules, new dependencies, subprocess-in-
runtime, native addons, network). No package export or dependency change is
required. Every existing-file modification is named.

## 21. ADR/Contract-Necessity Result

One **WP-8-D ADR is required** and sufficient for the implementation-policy
items, with clearly separated decision blocks: (1) write-capability
producer posture (zero producers; future `storage-write-action.ts`
boundary); (2) static-guard randomness/PID/clock exception scope
(locks-module-only); (3) phase-3 entry-set/classifier amendment
authorization; (4) taxonomy `Wp8Production` amendment (D-6) and the
AUD-001 partial-allocation acknowledgment (D-12 — see MINOR-3); (5)
crash-harness placement. The **audit identity/ordering model (D-8)** is a
human decision with a separate gate and **conditional contract revision**
(only if a stored/normative numeric sequence is chosen); the **lock-scope
clarification (D-9)** is a deferred human decision before the configuration
phase, gated by DS-10's contract-revision reopen authority. Already
normative (no decision needed): publication primitive (DS-21), durability
point (DS-09), transaction boundary (DS-08), lock record fields
(OD-002/12.3), error codes and precedence (18.1/18.2), CAP-009 boundaries,
audit failure semantics (10.5/AUD-013), existing-target classification
(10.2), read/enumeration behavior (RDS/DTM). This review selects no option.

## 22. Findings by Severity

**BLOCKER:** none — baseline, contract, and phase scope established;
decision resolution can proceed.

**CRITICAL:** none — no proposed model permits untrusted authority minting,
arbitrary filesystem mutation, lock breaking, or overwrite.

**MAJOR:** none — record-class roles separated; partial-success semantics
truthful; capabilities non-forgeable; audit required at the durability
point; filesystem authority bounded to exact modules.

**MODERATE:** none.

**MINOR-1 — Error-count mismatch (§15).** The text claims "29 of 31"
codes exercised but enumerates **28**; it describes RECOVERY-REQUIRED/
FAILED both as "not raised" and "returned only as recovery-gate state".
Bounded count/terminology mismatch; the code set and precedence themselves
are correct.

**MINOR-2 — Post-crash same-action retry classification for temp EEXIST
(§12) under-specified.** Temp names are deterministic per action identity
(WP-8-C scratch pattern), so an idempotent retry of the same action after a
crash re-derives the same temp name and hits `O_CREAT|O_EXCL` EEXIST. The
matrix defines the crash state but not the follow-up retry's classification
(adoption is prohibited; fail-closed verify-required follows from the
scratch-ownership precedent and WPR-012/019, but is not stated). Must be
specified in the implementation plan before implementation; bounded
crash-matrix gap.

**MINOR-3 — D-12 classified as implementation-owned.** AUD-001 is
unconditional ("Every event class of 22.1 MUST produce an audit event");
the deferral of the `idempotent-duplicate` and `conflict` event kinds to
phase 4 is sound (phase 4 owns the audit pipeline) but touches a normative
requirement and should be a human-acknowledged decision folded into the
ADR (D-8 block), not an implementation-owned allocation.

**NOTE-1 — read-record.ts allowlist width.** `readdirSync` is listed for
`read/read-record.ts` without a stated purpose; bounded enumeration should
be the sole directory-scan owner. No security impact (the read tree is
non-mutating).

**NOTE-2 — Allocation-table completeness.** SRE-001…005/007 lack explicit
D/NO rows; they are store-wide regression-covered properties, not new
WP-8-D obligations. Recommend explicit rows.

**NOTE-3 — Boot identity.** Recorded absent via injectable source
(contract-compliant "where available"; no out-of-store /proc I/O this
phase). The lock record format must reserve the field so phase-4 recovery
can parse WP-8-D locks; recovery wires the real bounded source.

**NOTE-4 — Audit-event producer tension.** Contract §6.2 lists the
producer of `AuthoritativeAuditEvent` as the trusted control plane while
WPR-010 obliges the store to emit the mechanical write-audit event; the
consolidation surfaces this correctly (F-2/D-6). The ADR must record the
reconciliation (store emits evidence under the capability-bound trusted
action identity; evidence never becomes authority).

## 23. Required Corrections (for the ADR/decision-resolution work; none gates this gate)

1. Fix the §15 count wording (28 enumerated vs "29 of 31"; reconcile "not
   raised" with "returned only as recovery-gate state").
2. Specify the post-crash same-action temp-EEXIST retry classification
   (fail-closed verify-required, no adoption) in §12 or the implementation
   plan.
3. Reclassify D-12 as a human-acknowledged decision in the ADR.

## 24. Human Decisions (open, explicitly gated; 7)

1. **D-2** — ratify the zero-production-write-provenance posture and the
   future `src/control-plane/storage-write-action.ts` boundary.
2. **D-3** — approve the locks-module-only randomness/PID/clock static-guard
   exception (contract-mandated).
3. **D-5** — authorize exercising the ADR-028 decision-C gate: write
   capability binding to verified StoreMetadata identities.
4. **D-6** — authorize the taxonomy `Wp8Production` amendment for the
   mechanical write-audit production.
5. **D-7** — authorize the phase-3 entry-set/classifier amendment of
   committed WP-8-C initialization source (records/audit/locks, version-
   bound; lazy provisioning).
6. **D-8** — select the audit-event identity/ordering model (deterministic
   derivation + rebuildable sequence, or counter-under-lock, or contract
   revision for stored sequence semantics).
7. **D-12** — acknowledge the partial AUD-001 allocation
   (authorized-write only in WP-8-D).

Recorded deferred, non-gating: **D-9** (lock scope resolution before the
configuration phase; DS-10 reopen gate = contract revision), **D-11**
(configuration-record persistence timing; task-directed, contract
permissive).

## 25. Blockers / Deviations

**Blockers:** none for decision resolution. D-3, D-7, and D-8 (per the
consolidation's §23 and this review's findings) gate **implementation
authorization**, not this gate.

**Deviations:** D-1 (eligibility/decomposition report path substituted with
contract §29 + WP-8A report §14) — verified accurate: the named file does
not exist and the substitutes are the actual equivalent inputs. No other
deviation.

## 26. Next Gate

**HUMAN AUTHORIZATION OF WP-8-D DECISION RESOLUTION AND ADR/CONTRACT WORK**
— closure of the seven open human decisions, the WP-8-D ADR, and any
conditional contract revision, followed by a separate implementation
authorization.

## 27. Verdict

The consolidation's material claims were independently verified against
the contract text (read in full), the committed source, the committed
guards, the committed tests (executed 31/31 at HEAD), the roadmap/planning
status, ADR-028, and the WP-8-A/WP-8-C reports. Phase eligibility is valid;
publication scope is coherent; producer/publisher roles are separated;
namespace layout changes are correctly classified as authorized
implementation amendments; audit identity/ordering and lock scope have
explicit decision paths; capability authority is non-ambient with
production publication unreachable; failure/crash semantics are truthful;
API ownership and the path envelope are bounded; requirement allocation is
conservative; every remaining human or contract decision is explicitly
gated; no implementation authorization is implied. The three MINOR findings
are bounded documentation/classification issues to be folded into the
ADR/decision-resolution work.

`WP-8-D SENIOR PRE-IMPLEMENTATION SECURITY AND ARCHITECTURE REVIEW: ACCEPTED FOR DECISION RESOLUTION`

```text
WP-8-C OPERATIONAL BASELINE: bd832606ece489a924b4fcc13ad55789fcb0736f
WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION
WP-8-D PHASE ELIGIBILITY: ACCEPTED
WP-8-D CONSOLIDATION: ACCEPTED FOR DECISION RESOLUTION
WP-8-D IMPLEMENTATION READINESS: NOT YET GRANTED
WP-8-D PRODUCTION WRITE AUTHORITY: UNREACHABLE
WP-8-D OPEN HUMAN DECISIONS: 7
WP-8-D CONTRACT REVISIONS REQUIRED: no (conditional: yes if D-8 selects a stored/normative audit sequence or D-9 resolves via contract revision)
WP-8-D ADR WORK REQUIRED: yes
WP-8-D IMPLEMENTATION AUTHORIZATION: NOT GRANTED
WP-8-D STAGING AUTHORIZATION: NOT GRANTED
WP-8-D COMMIT AUTHORIZATION: NOT GRANTED
WP-9 AND LATER AUTHORIZATION: NOT GRANTED
NEXT GATE: HUMAN AUTHORIZATION OF WP-8-D DECISION RESOLUTION AND ADR/CONTRACT WORK
PUBLICATION: NOT PERFORMED
```
