# WP-13C — Trusted Result Publication Implementation Report

**Work package:** WP-13C — trusted result publication (ADR-038 authority;
slice C of WP-13; no retrospective-facts work).
**Status:** WP-13C FOCUSED REREVIEW ACCEPTED — READY FOR WP-13C BASELINE
COMMIT (SIR-WP13C-001 CLOSED by WP-13B amendment commit
`02bce4bb3e6bb5d57f1b6338d5fe449eca10ae78`; SIR-WP13C-002 CLOSED;
real WP-13B handoff integration PASS).
**Baseline:** HEAD `bc8429a98191296bc4c3ba12dfc7abcdb5c58296` (branch `main`;
`feat: establish WP-13B completion result foundation`), unchanged
throughout. WP-13B provenance amendment committed as `02bce4bb`
(`fix: align WP-13B evaluator provenance identities`) — SIR-WP13C-001
CLOSED. Nothing else staged/committed; no push/tag/release/deploy.
**Authoritative contract:**
`docs/reports/wp-13-pre-implementation-contract-decision.md` §3.3–§3.7
(SCR-WP13-003/005/006), ADR-038, ADR-012, the committed
`result-publication-record` lifecycle schema, the WP-8 `publishRecord`
contract, the WP-12 host-side coordination-lock pattern (FSCR-W12-001), and
the WP-13B `ValidatedResultHandoff`.

## 1. Baseline / changed paths

Baseline HEAD `bc8429a9` unchanged. New production module family
(`src/publication/`, 5 files):
- `types.ts` — closed vocabulary (failure taxonomy, request/result types,
  `PublicationStoreBoundary`, `PublicationIdentitySource`).
- `capability.ts` — result-publication capability (module-private WeakSet
  brand, generation-bound per CAP-008…016) + exact-record publication permit
  (role `result-publication`; sink-level confinement).
- `store-boundary.ts` — the narrow WP-8 boundary (single publishable class;
  closed read set; envelope per RFM-001; permit-gated).
- `publish.ts` — the authority flow (`publishValidatedResult`).
- `index.ts` — barrel (authority entry + boundary factory + types ONLY;
  capability/permit internals never exported — CAP-011/014/015).

New tests: `tests/unit/wp13c-publication.test.ts` (16 focused) ·
`tests/unit/wp13c-static-guard.test.ts` (4 static guards).

No tracked file was modified: WP-13A/B, WP-12, WP-8, and
`src/control-plane/subject.ts` are untouched. `git diff --check` clean.

## 2. ADR-038 authority construction

- Host-side only; the authority is a pure decision module over host-injected
  trusted context — zero ambient authority, zero direct filesystem access.
- Record role: `trusted-result-publisher` (schema-committed
  `responsible_role`); the authority produces ONLY `ResultPublicationRecord`
  (the boundary's publish allowlist is exactly that one class; every other
  class is rejected).
- Branded action provenance domain
  `PGAP-EXECUTION-RESULT-PUBLICATION-PROVENANCE-v1` is the provenance
  domain of the host-owned result-publication action identity (host-supplied
  write-action provenance minted through the AUTHORIZED WP-12 producer
  `src/control-plane/storage-write-action.ts` — the sole production
  consumer of `createStorageWriteActionProvenance`; storage static-guard
  edge unchanged).
- No generic lifecycle/store authority: the authority never calls the
  WP-12 command surface (`executeSlice1Command`/`publishLifecycleRecord`/
  `recordValidation` are statically forbidden in the family), never writes
  files, and never touches any record class but the one it publishes.

## 3. Capability / provenance boundary (CAP-008…016)

- `createResultPublicationCapability` is gated on the GENUINE WP-6 validated
  trusted configuration (runtime brand) + a host action identity; it is
  imported only by the trusted host composition and tests (never re-exported
  from the barrel; static-guard enforced).
- Module-private WeakSet brand (CAP-014); every use re-verifies brand +
  liveness + generation (CAP-009); **generation semantics track the trusted
  configuration/authority lifecycle, NOT individual minting (SIR-WP13C-002
  correction, §17)**: the registry mirrors the committed WP-8
  `generationForStore` pattern — one current generation per authority
  lifecycle key (the trusted configuration's workspace identity), recording
  the configuration identity; multiple mints under one unchanged genuine
  configuration SHARE the generation (minting B never stales A); the
  generation ADVANCES only on a mint under a DIFFERENT configuration
  identity for the same workspace (genuine configuration replacement,
  CAP-008); disposal remains per-capability (CAP-009); no
  one-live-capability-only semantics; structural clones, forged objects,
  and detached methods fail `not-genuine` (CAP-015); the authority
  re-verifies the capability at admission AND the boundary re-verifies it at
  the mutation boundary immediately before `publishRecord`.
- Exact-record publication permit (role `result-publication`): minted
  internally by the authority immediately before the write; binds the
  genuine capability, the exact record class, record identity, record
  digest, canonical-byte digest, and the internally derived destination
  designation; the sink re-derives the destination and re-verifies permit +
  capability before any filesystem access. No raw path, descriptor,
  callback, or caller-selected class/destination ever crosses the boundary.
- Capability internals never appear in public exports, serialization,
  logging, structural cloning, or caller-supplied objects (CAP-011).

## 4. Attempt-level lock key (SCR-WP13-006)

The coordination key is the exact attempt-level uniqueness subject —
`workspace | bundle-target_instance_id | bundle-target_revision_id |
bundle-target_digest | occurrence | attempt` — and `result_instance` NEVER
participates in the key. Different attempts use independent keys (no
unnecessary serialization; tested with a shared coordinator). The committed
WP-12 host-side lock pattern is reused verbatim (the injected
`DecisionCoordinator`); a second overlapping acquisition fails closed as
`PUBLICATION-LOCK-CONFLICT` (`lock.conflict`), exactly like WP-12's
`lock-conflict` mapping. No second locking protocol exists.

## 5. Mandatory under-lock re-read (§3.3/§5)

AFTER acquiring the attempt-level lock, the authority re-reads and
re-verifies ALL decision state (never pre-lock cached):

1. **Attempt-scoped publication/result-association lookup** — enumerates
   `result-publication-record` and reads every payload; the association test
   is workspace + bundle (target instance/revision/digest + binding) +
   occurrence + attempt and discovers ANY existing association for the
   ENTIRE exact attempt **regardless of result instance**.
2. **Exact passing ValidationRecord** — the handoff's `validationRecordId`
   is read; it must be a `ValidationRecord` with `structural_outcome` and
   `semantic_outcome` `pass` and a subject EXACTLY equal to the handoff's
   result instance/revision/digest/kind/workspace (missing → typed
   `lifecycle.validation-record-missing`; mismatch → `*-mismatch`).
3. **Current lifecycle chain** — the exact attempt record must exist
   (attempt/occurrence/workspace/bundle exact) and bind the exact
   activation record (decision `accepted`) and occurrence record; the exact
   runtime grant must exist, must NOT be revoked (revocation-record scan),
   and its validity window must cover the current host time.
4. **Registry context** — the current host-supplied registry context is
   bound into the record at publication time and compared in replay
   (any divergence is a typed conflict; SCR-WP13-003).

Every read is contained (safeCall → exact return-shape validation → use);
malformed/null/throwing store returns map to typed failures.

## 6. First-publication path

Under the held lock, with no existing association: the authority constructs
exactly one `ResultPublicationRecord` payload (schema form: result_subject,
evaluator_provenance, association_mode, validation_record_id, bundle,
workspace/occurrence/attempt, `publication_scopes: ["ordinary-review"]`,
`receipt_correlations: []`, registry snapshot reference), assigns an OPAQUE
record identity from the host identity source (no deterministic/content-
derived record id), runs the committed lifecycle schema gate
(`validateLifecycleRecord`), mints the exact-record permit, and publishes
through the permit-gated boundary (`publishRecord`, WP-8 writer lock and
mechanical authorized-write audit preserved). The attempt-level lock is held
through the full `publishRecord` success/failure outcome.

## 7. Exact replay semantics

If the under-lock lookup finds a durable publication for the exact attempt
that is MATERIAL-EXACT (identical decision material in committed canonical
form — result subject, provenance, validation id, bundle/bindings, scopes,
receipts, registry context; record_id/created_at excluded), the authority
returns idempotent success with the EXISTING durable record identity and
performs NO second write (verified: publish counter unchanged, exactly one
durable record). No new record identity is minted to service a replay.

## 8. Conflict semantics

- Different result instance for the same attempt → `PUBLICATION-CONFLICT`
  `conflict.result-instance`, no write.
- Same instance with ANY material divergence (revision/digest, evaluator
  provenance, ValidationRecord id, bundle/workspace/occurrence/attempt
  binding, registry context, scopes, receipts) → `PUBLICATION-CONFLICT`
  `conflict.material-divergence`, no write.
- WP-8 duplicate/conflict outcomes at the sink → under-lock re-read of the
  durable record and material comparison (`conflict.durable-record` on
  divergence), or typed write failure.
- A publication for a DIFFERENT attempt is not an association: independent
  lock key and lookup → independent first publication (tested).

## 9. Concurrency evidence

- Two sequential exact requests → exactly one durable record; the second
  re-reads under the lock and returns idempotent replay of the same id.
- In-flight contention (second invocation while the first holds the
  attempt-level lock, via the WP-12 race-coverage hook seam) → typed
  `lock.conflict`, no write; after release the retry re-reads durable state
  and returns idempotent replay.
- Competing different result instance after release → re-read under the
  lock discovers the existing association → typed `conflict.result-instance`,
  no double publication.
- Different attempts with a SHARED coordinator → independent lock keys,
  both publish (no global serialization).

## 10. WP-8 publishRecord boundary

The dedicated boundary (`createPublicationStoreBoundary`) wraps the
committed `publishRecord` + `readRecord` + `enumerateClass` unchanged:
publish allowlist = exactly `result-publication-record`; read allowlist =
the closed under-lock set (publication, validation, attempt, occurrence,
activation, grant, revocation records). WP-8 storage semantics, record
allowlists, writer locking, durability rules, audit rules, and registry
binding model are UNCHANGED (no `src/storage/**` modification). The
authority has no direct filesystem/store write path (static-guard: no
`node:fs` anywhere in the family; `publishRecord` imported only by
`store-boundary.ts`).

## 11. Failure taxonomy (closed)

`PUBLICATION-INPUT-INVALID` (handoff/provenance/registry/boundary shape,
unknown-key — incl. any scope/receipt operand, evaluator-provenance
mismatch) · `PUBLICATION-CAPABILITY-DENIED` (not-genuine / disposed /
stale-generation / wrong-operation) · `PUBLICATION-LOCK-CONFLICT` ·
`PUBLICATION-STATE-UNVERIFIABLE` (under-lock read failures) ·
`PUBLICATION-LIFECYCLE-REJECTED` (validation missing/mismatch/not-passing,
attempt/occurrence/activation/grant missing or mismatched, activation
denied, grant revoked/expired) · `PUBLICATION-CONFLICT` (result-instance /
material-divergence / durable-record) · `PUBLICATION-WRITE-FAILED` ·
`PUBLICATION-INTERNAL-FAILURE` (schema gate, permit denial, boundary
exceptions, malformed returns). Raw exceptions, record bytes, capability
material, and untrusted diagnostics never leak (secret-marker tests).

## 12. Publication scope / receipt separation (§3.6)

WP-13 publication is exactly `["ordinary-review"]` with
`receipt_correlations: []` — fixed by construction, NEVER caller operands
(the input carries no scope/receipt fields; an exact-key check rejects any
unknown operand including scope/receipt material). `completion-status`,
`downstream-automation`, and `authoritative-reporting` remain WP-15-owned
(static-guard forbids the vocabulary in the family).

## 13. Contract-integration note (evaluator provenance seam) — CLOSED

The committed record schema requires evaluator provenance ids in the opaque
`pgw:ev:<32hex>` / `pgw:cp:<32hex>` forms. SIR-WP13C-001 (MAJOR) found that
the WP-13B handoff emitted human-readable labels, so no valid WP-13B handoff
could produce a schema-valid ResultPublicationRecord. CLOSED by the committed
WP-13B provenance amendment (`02bce4bb`, `fix: align WP-13B evaluator
provenance identities`): WP-13B now emits the canonical schema-valid opaque
identities. WP-13C continues to require the exact schema-valid provenance
and re-correlates it with the handoff by EXACT equality (never mapped, never
derived); the integration tests consume the REAL WP-13B handoff unchanged —
no mutation, no translation, no normalization. Integration proof: real
WP-13B completion flow → real `ValidatedResultHandoff` → WP-13C exact
provenance correlation → schema-valid `ResultPublicationRecord`.

## 14. Test evidence

| Suite | Result |
|---|---|
| typecheck (`tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.tests.json --noEmit`) | clean |
| Focused WP-13C (`wp13c-publication.test.js`) | **18/18 pass** (16 + 2 added SIR-WP13C-002 coverage: same-configuration multi-mint, configuration-replacement invalidation; adversarial/independence tests reworked) |
| WP-13C static guards (`wp13c-static-guard.test.js`) | **4/4 pass** |
| WP-13B suites (completion 21/21 + static guards 4/4) | **25/25 pass** |
| WP-13A suites | **43/43 pass** |
| WP-12 + writing + pointofuse-v2 suites | **558/558 pass** |
| Full unit + security + storage suites | **979 pass / 0 fail** (2 pre-existing chown skips in `storage/initialization.test.js`, unchanged) |
| Pi-adapter suite | **338/339** — sole failure = the known pre-existing environmental F8 (installed Pi 0.84.1 vs 0.83.0; unchanged) |
| `git diff --check` | clean |

Coverage per the WP-13C test contract: first publication · exact replay (zero
second write) · different result instance conflict · same-instance
revision/digest divergence · provenance/ValidationRecord-id/registry-context
divergence · different-attempt independence · scope/receipt operand
rejection · missing/mismatched ValidationRecord binding · attempt-missing /
grant-revoked / grant-expired · capability forgery / disposal /
stale-generation / detached-method · **same-configuration multi-mint
(SIR-WP13C-002: minting B never stales A)** · **genuine configuration-
replacement invalidation (old capability stale-generation; replacement
capability valid)** · in-flight lock contention · competing
result race · publishRecord failure under the lock · opaque record identity
(no deterministic id) · no direct store/fs write (static) · no
TrustedReceipt / no ExecutionRetrospectiveFacts (store-level + static).

## 15. Explicit WP-13D/WP-15 exclusions (NOT implemented)

`ExecutionRetrospectiveFacts` · `TrustedReceipt` · receipt correlation ·
privileged publication scopes (`completion-status` /
`downstream-automation` / `authoritative-reporting`) · `SupersessionRecord` ·
`RevocationRecord` production · retry changes · new lifecycle record classes
· new storage/lock protocol · WP-14/WP-15. The authority publishes exactly
one class and nothing else; no WP-13D behavior is stubbed.

## 16. Final Git state

Branch `main`; HEAD `02bce4bb3e6bb5d57f1b6338d5fe449eca10ae78` (WP-13B
provenance amendment commit; parent `bc8429a9`);
untracked new: `src/publication/` (5 files),
`tests/unit/wp13c-publication.test.ts`, `tests/unit/wp13c-static-guard.test.ts`.
NO tracked file modified; nothing staged; no push/tag/release/deploy.
WP-13D NOT STARTED; WP-14/WP-15 remain blocked.

## 17. Focused correction record (SIR-WP13C-002 — capability generation)

**Finding (MAJOR):** the original capability mint advanced the
per-configuration generation on EVERY mint, so minting capability B for an
unrelated publication staled in-flight capability A (contradicting
CAP-008/010 and the committed `generationForStore` pattern, which reuse the
generation on mint and advance only on trusted-configuration replacement);
inverted, a genuine configuration replacement did NOT invalidate
older-configuration capabilities (the registry was keyed by configuration
identity, so the old key retained the old generation).

**Root cause:** the generation registry was keyed by configuration identity
and advanced unconditionally at mint time instead of mirroring the committed
WP-8 generation-tracking semantics (`src/storage/capabilities/authenticity.ts`
`generationForStore`): one generation per lifecycle key, reused across
mints, advanced only when the recorded configuration identity changes.

**Corrected semantics (implemented in `src/publication/capability.ts`):**
- the registry mirrors `generationForStore` exactly: one current generation
  per authority lifecycle key (the trusted configuration's workspace
  identity — stable across configuration replacement, distinct per
  workspace), recording the configuration identity;
- multiple mints under one unchanged genuine trusted configuration SHARE
  the current generation — minting capability B NEVER invalidates
  capability A; A and B remain independently genuine/live until disposed or
  the configuration generation changes (no one-live-capability-only
  semantics);
- the generation ADVANCES only when a mint arrives under a DIFFERENT
  trusted configuration identity for the same workspace (genuine
  configuration replacement, CAP-008): every earlier capability becomes
  stale-generation and both authority admission and the store-boundary
  mutation-boundary verification reject it;
- disposal remains per-capability and invalidates only that capability;
- preserved unchanged: module-private WeakSet genuine brand, generation-
  bound verification, genuine WP-6 configuration brand requirement,
  detached/forged/structurally-cloned rejection, exact-record permit
  confinement, mutation-boundary re-verification, no capability internals in
  public exports, no authority widening.

**Tests added/adjusted (`tests/unit/wp13c-publication.test.ts`, now 18):**
same-configuration multi-mint (A and B both genuine/current; both used in
independent valid publications for different attempts) · genuine
configuration-replacement invalidation (old capability stale-generation at
verify and at the authority gate; replacement-minted capability valid and
publishes) · disposal is per-capability (disposing B leaves A valid) ·
concurrent different-attempt publications with independently minted
capabilities (shared coordinator; neither stales the other) · adversarial
cases preserved (forgery, structural clone, detached method).

**SIR-WP13C-001 integration proof:** the WP-13C tests now consume the REAL
`ValidatedResultHandoff` produced by the amended WP-13B unchanged — the
fixture that patched `evaluatorId`/`capabilityProfileId` onto the handoff
was REMOVED. The real handoff carries the canonical committed identities
(`COMPLETION_EVALUATOR_ID`/`COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID`),
and the published record's `evaluator_provenance` equals them exactly.

**Regression evidence:** focused WP-13C **18/18** · WP-13C static guards
**4/4** · WP-13B (committed amended baseline) **25/25** · WP-13A **43/43** ·
full unit **535/535** (incl. WP-12 coordination and storage capability
suites) · security **15/15** + storage **436 pass / 0 fail** (2 pre-existing
chown skips unchanged) · both typechecks clean · `git diff --check` clean.
Pi-adapter not rerun (no shared Pi path changed).

**Status: WP-13C CAPABILITY CORRECTION COMPLETE — READY FOR FOCUSED
REREVIEW.**

## 18. Focused rereview record

Focused rereview verdict: **WP-13C FOCUSED REREVIEW ACCEPTED — READY FOR
WP-13C BASELINE COMMIT**. SIR-WP13C-001 CLOSED (by the committed WP-13B
provenance amendment `02bce4bb`); SIR-WP13C-002 CLOSED (capability
generation correction, §17); real WP-13B handoff integration PASS (real
handoff → exact provenance correlation → schema-valid
`ResultPublicationRecord`, no mutation/translation).

Final evidence ledger: WP-13C focused **18/18** · static guards **4/4** ·
WP-13B amended baseline **25/25** · WP-13A **43/43** · focused sweep
**90/90** · storage **431 pass / 0 fail** (2 pre-existing chown skips
unchanged) · full unit **535/535** · security **15/15** · both typechecks
clean · `git diff --check` clean. WP-13D **NOT STARTED**; WP-14/WP-15
remain blocked behind WP-13.

---

**WP-13C BASELINE COMMIT READY**
