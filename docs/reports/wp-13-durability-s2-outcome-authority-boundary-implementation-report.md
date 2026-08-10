# WP-13 Durability S2 — Outcome Authority Boundary Implementation Report

**Work package:** WP-13 durability S2 — the narrow trusted authority domain
`trusted-execution-outcome-recorder` → `ExecutionOutcomeRecord` ONLY
(branded generation-bound capability, exact-record publication permit, narrow
one-class WP-8 store boundary, read surface for later S3, confinement/static
guards/tests).
**Status:** implementation complete; **ACCEPTED** by the WP-13 durability S2 focused senior review (verdict: `WP-13 DURABILITY S2 FOCUSED SENIOR REVIEW ACCEPTED — READY FOR S2 BASELINE COMMIT`; zero findings; see §16 acceptance record).
**Baseline:** HEAD `85bcc7443ffc5a6b75f3062d99c78cd2ba5af5eb` (branch `main`;
`feat: establish WP-13 durability S1 foundation`), unchanged. Nothing
staged/committed; no push/tag/release/deploy.
**Authoritative contract:** ADR-039 (Accepted), durability decision §8/§9,
amended WP-13 pre-implementation contract decision §6, committed S1
schema/taxonomy/rules baseline.

## 1. Exact changed paths

**New (untracked):**

| Path | Purpose |
|---|---|
| `src/outcome/types.ts` | closed S2 vocabulary: `EXECUTION_OUTCOME_RECORD_CLASS`, `EXECUTION_OUTCOME_OPERATION`, `OUTCOME_PUBLICATION_FAILURE_CATEGORIES`, `OutcomePublicationResult`, `OutcomeStoreBoundary` |
| `src/outcome/capability.ts` | branded generation-bound capability + exact-record permit (ADR-039 decision 3; WP-13C pattern) |
| `src/outcome/store-boundary.ts` | narrow one-class WP-8 boundary: `publishExactOutcomeRecord` + read surface + envelope builder |
| `src/outcome/index.ts` | barrel: boundary factory + closed vocabulary only (NO capability internals) |
| `tests/unit/wp13-durability-s2-outcome-authority.test.ts` | 15 focused tests (capability/permit/boundary/read/domain separation) |
| `tests/unit/wp13-durability-s2-static-guard.test.ts` | 7 static security guards |

**Modified (tracked) — stale count assertions surfaced by S2 verification
(S1-遗留 reconciliation, NOT protocol changes):**

| Path | Change |
|---|---|
| `tests/unit/storage/recovery.test.ts` | absent record-class directory count 14 → 15 (19-class taxonomy from S1) |
| `tests/unit/storage/registry.test.ts` | same class-directory counts 14 → 15 (×4 assertions) |
| `tests/unit/storage/static-guard.test.ts` | `src/index.ts` public export count 42 → 43 (S1's `classifyRetrospectiveEligibility` re-export) |

These three files were missed by S1's verification because the storage unit
suites run as a separate glob; S2 verification (required by the S2 mandate to
run relevant WP-8 storage tests) surfaced them. They reconcile assertions to
the already-committed S1 taxonomy — no schema, protocol, or count change by S2.
Per the S1-preservation instruction, this is reported rather than silent.

## 2. Capability design

`src/outcome/capability.ts` mirrors the accepted WP-13C discipline exactly:

- **Module-private brand:** `WeakSet` brands (`capabilityBrand`,
  `capabilityDisposed`, `permitBrand`, `permitDisposed`) — not structurally
  representable by public fields; forged/spread-cloned/detached-method/
  serialized lookalikes fail `not-genuine` (CAP-014/015 pattern).
- **Generation-bound:** one current generation per authority lifecycle key
  (the trusted configuration's workspace identity), recording the
  configuration identity — the corrected WP-13C generation semantics
  (SIR-WP13C-002; the committed WP-8 `generationForStore` pattern):
  multiple mints under one unchanged genuine configuration SHARE the current
  generation (minting B never invalidates A); the generation ADVANCES only on
  a mint under a DIFFERENT configuration identity for the same workspace
  (genuine configuration replacement); disposal remains per-capability.
- **Independent registry:** the outcome generation map is a SEPARATE module
  instance from the result-publication registry — **no shared generation
  namespace** between the two WP-13 domains; changing one domain's
  configuration never alters the other domain's capability validity.
- **Mint ownership:** `createExecutionOutcomeCapability({trustedConfiguration,
  actionIdentity})` is gated by the genuine WP-6 validated trusted
  configuration brand (`isGenuineValidatedTrustedWorkspaceConfiguration`) and
  is NOT exported from the barrel; the static guard proves **zero production
  mint sites** across all of `src/**` (the S3 host composition will be the
  sole mint owner; not wired anywhere yet).
- **No serialization/export of brand or secret material.**

## 3. Configuration identity / generation semantics

The capability binds the exact trusted configuration **identity** (string) and
the workspace lifecycle key — nothing attempt/result-specific (attempt-scoped
authorization belongs to S3's decision and exact-record permit). The domain
structure reuses the WP-13C model (configuration identity + workspace key +
host action identity) with authority generations fully independent between the
two domains. Tests prove: sibling mints share validity; disposal is
per-capability; genuine configuration replacement stales old capabilities at
both mint time and the sink; outcome-domain replacement does not touch
publication-domain validity and vice versa.

## 4. Exact-record publication permit

`createExecutionOutcomePermit({capability, role: 'execution-outcome-recording',
recordId, recordDigest, canonicalBytesDigest})` binds:

- the genuine live outcome capability;
- the closed role `execution-outcome-recording` and the closed record class
  `execution-outcome-record`;
- the exact record identity, the exact record digest AND the canonical-byte
  digest (equal, bound independently);
- the internally derived destination designation (pure layout derivation).

The permit authorizes exactly ONE already-constructed record: changing any
permit-bound material (record id, disposition, observation evidence, result
association, attempt/bundle binding, class) makes the sink reject the changed
record (`record.identity-mismatch` / `record.digest-mismatch` /
`record.class-mismatch`). No class family, no mutable builder, no future
record, no publication/result/receipt record. The permit is process-local and
structurally unforgeable; no raw path/descriptor/callback. S3 material-replay
comparison is deliberately absent.

## 5. Store-boundary write surface

`createOutcomeStoreBoundary(options)` exposes `publishExactOutcomeRecord(
permit, payload)` — the ONLY outcome write path. Before any WP-8 delegation it
verifies, in order:

1. permit genuine (domain brand) → `permit.not-genuine`;
2. permit live (not disposed) → `permit.disposed`;
3. permit role/recordClass are the outcome domain's → `permit.foreign-domain`;
4. capability re-verified at the mutation boundary → `capability.${reason}`
   (`not-genuine` / `disposed` / `stale-generation`);
5. payload is an object; `record_id` === permit binding → `record.identity-mismatch`;
6. `record_type` === `ExecutionOutcomeRecord` → `record.class-mismatch`;
7. `responsible_role` === `trusted-execution-outcome-recorder` → `record.role-mismatch`;
8. `computePayloadDigest(payload)` === permit digests → `record.digest-mismatch`;
9. re-derived destination === permit designation → `record.destination-mismatch`;
10. committed lifecycle schema gate (`validateLifecycleRecord`: canonical
    input + selection + structural schema through the committed S1 schema) →
    `record.schema-invalid`;
11. envelope built per RFM-001; then WP-8 `publishRecord` (writer lock,
    durability, D-6 authorized-write audit, registry binding preserved).

WP-8 storage-level outcomes pass through as storage facts
(`published` / `idempotent-duplicate` / `duplicate` / `conflict-revision`);
`failed` / `temp-exists-retry` map to `OUTCOME-WRITE-FAILED`; exceptions map to
`OUTCOME-INTERNAL-FAILURE`. **No alternate write primitive exists; no
bypass of the WP-8 writer lock, durable publication protocol, audit, registry
binding, or exact-record validation.**

## 6. Read surface (for later S3)

`readLifecyclePayload` / `enumerateLifecycleRecords` confined to exactly
`execution-outcome-record`, using the committed WP-8 read/enumerate
primitives. Deterministic verified reads only: no mutation, no "newest wins",
no enumeration-order selection, no hidden uniqueness decision, no attempt
lock, no replay/conflict semantics; multiple candidate records are returned
as the verified set (enumerated ids + per-id verified payload reads) for S3 to
fail closed on. Read recognition is strictly separate from write authority
(readers carry no capability). Reads of other classes are rejected.

## 7. Domain separation from WP-13C

- A result-publication capability cannot mint outcome permits (separate
  WeakSet brand → mint returns `undefined`) and a result-publication permit
  cannot pass the outcome sink (`permit.not-genuine`).
- An outcome capability cannot mint result-publication permits and an outcome
  permit cannot pass the result-publication sink (proven against the REAL
  `createPublicationStoreBoundary`).
- The two domains hold independent generation registries (no shared
  namespace); configuration replacement in either domain is proven to stale
  only that domain's capabilities.
- The outcome family imports nothing from `src/publication/**` (static guard).

## 8. WP-12 isolation

Static guard asserts `src/control-plane/store-boundary.ts` contains no
`execution-outcome-record` and that the `CONTROL_PLANE_PUBLISH_CLASSES`
allowlist remains exactly the committed eight classes. The new boundary is
WP-13-owned and independent; the outcome record is NOT a WP-12 class.

## 9. Failure mappings (closed, S3-clean)

Categories: `OUTCOME-CAPABILITY-DENIED` (not-genuine/disposed/
stale-generation/foreign permit), `OUTCOME-INPUT-INVALID` (record
identity/class/role/digest/destination/schema failures),
`OUTCOME-WRITE-FAILED` (WP-8 rejection), `OUTCOME-INTERNAL-FAILURE`
(envelope/exception). Deliberately ABSENT (S3): outcome conflict, duplicate
attempt outcome, replay mismatch, attempt lock conflict,
retrospective-ineligible, observation-correlation failure. A static guard
forbids the S3 vocabulary (`DecisionCoordinator`, `withLock`,
`LockContentionError`, `materiallyExact`, `attemptLockKey`, `newEvidenceId`,
`ValidatedResultHandoff`, `PiExecutionObservation`, `PiEnforcementEvidence`)
in the family.

## 10. Static/security confinement

`tests/unit/wp13-durability-s2-static-guard.test.ts` (walks `src/outcome/**`):

- filesystem-free; no network/process/timer/crypto/env surface;
- WP-8 surface confined: `publishRecord`/read/enumerate only in
  `store-boundary.ts`; capability.ts owns only the pure layout derivation;
  types.ts carries no runtime storage surface;
- no WP-12 publish path (`publishLifecycleRecord`), no WP-13D/WP-15 vocabulary
  (`TrustedReceipt`, `ExecutionRetrospectiveFacts`, `SupersessionRecord`,
  privileged scopes), no S3 decision surface;
- capability/permit internals never exported from the barrel; zero production
  mint sites for `createExecutionOutcomeCapability` across all of `src/**`;
- no generic lifecycle writer export; barrel exposes only the boundary factory
  + closed vocabulary;
- WP-12 eight-class allowlist unchanged (source-scanned);
- no result-publication surface inside the outcome family.

No raw fs writer, no network/process/shell/timer authority, no WP-15 receipt
authority. Confinement does not rely on TypeScript types alone.

## 11. Explicit S3 exclusions (NOT implemented)

No `newRecordId()`/`newEvidenceId()` decision timing, no `created_at`
selection, no outcome construction from `ExecutionAttemptOutcome`, no
observation/enforcement correlation, no ValidationRecord/result-association
verification, no retrospective-complete eligibility decision, no attempt-level
uniqueness key, no `DecisionCoordinator` lock, no under-lock re-read, no
material replay equivalence, no duplicate/divergence conflict decision, no
closure-composition production, no WP-13C outcome precondition. The tests use
an already-constructed schema-valid `ExecutionOutcomeRecord` payload purely to
exercise the authority plumbing.

## 12. Test evidence

| Suite | Result |
|---|---|
| S2 authority tests (capability 6, permit 2, boundary 6, read 1, domain separation 2... total 15) | **15/15 pass** |
| S2 static guards (7) | **7/7 pass** |
| Existing WP-13C publication + static-guard + WP-13B completion + WP-12 store/attempt/static suites | **71/71 pass** |
| Storage unit suites (incl. WP-8 publication/read/recovery/registry) | **431 pass / 0 fail** (2 pre-existing chown skips, unchanged) |
| Full unit (`dist-test/tests/unit/*.test.js`) | **590/590 pass** |
| Integration (incl. full conformance 628/628) | **100/100 pass** |
| Trusted + security + mcp | **661/661 pass** |
| Writing + runtime + drafting + pointofuse-v2 + storage-crash | **340/340 pass** |
| WP-7 discovery guard | OK (source↔compiled) |
| Both TypeScript typechecks | clean |
| `git diff --check` | clean |

Pi-adapter battery not re-run (no Pi/shared adapter path changed).

## 13. S1 no-drift evidence

Schema counts 52, lifecycle types 15, taxonomy 19, rules 120, RULE matrix
236/118, manifest 628, corpus 391 — all unchanged and re-verified by the
passing integration/conformance suites (628/628), taxonomy tests, and core
schema-count tests. EXE-012 valid-state classification, EXE-013 supersession
semantics, and the observation `pgw:e` schema are untouched. The only tracked
modifications are the three stale storage-suite count assertions described in
§1 (S1-遗留 reconciliations surfaced by S2-mandated storage verification;
reported per the S1-preservation instruction rather than silently updated).

## 14. Superseded WP-13D isolation

`src/retrospective/**`, `tests/unit/wp13d-retrospective.test.ts`,
`tests/unit/wp13d-static-guard.test.ts`, and
`docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`
remain untracked and unmodified.

## 15. Final Git state

Branch `main`; HEAD `85bcc7443ffc5a6b75f3062d99c78cd2ba5af5eb` (unchanged).
Working tree: 3 modified tracked test files (count reconciliations), 6 new
untracked S2 files (`src/outcome/**` ×4, two test files), plus the 4
pre-existing untracked superseded WP-13D paths. Nothing staged; no
push/tag/release/deploy. S3/S4/S5 not begun; WP-14/WP-15 remain blocked.

## 16. Acceptance record (focused senior review)

- Focused senior review verdict: **WP-13 DURABILITY S2 FOCUSED SENIOR
  REVIEW ACCEPTED — READY FOR S2 BASELINE COMMIT**;
- **zero findings**;
- **S2 implementation ACCEPTED**;
- **S3 NOT STARTED** / requires separate human authorization;
- **WP-13 remains NOT CLOSED**;
- **WP-14/WP-15 remain blocked**.

**Senior-review non-findings (preserved):**

1. The capability `actionIdentity` is informational; trusted write
   provenance comes from the host-owned write action (minted through
   `src/control-plane/storage-write-action.ts` at the store boundary), not
   from the capability binding.
2. Future S3 mint wiring must EXTEND the exact mint-site allowlist asserted
   by the S2 static guard (currently zero production mint sites) rather
   than weakening it — the guard is the bounded record of who may mint the
   outcome capability.

No new protocol decision is introduced by this record.

---

**WP-13 DURABILITY S2 IMPLEMENTATION COMPLETE — READY FOR FOCUSED SENIOR REVIEW**
