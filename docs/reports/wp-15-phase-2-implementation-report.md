# WP-15 Phase 2 — `receipt-publication-correlation-producer` Authority Core — Implementation Report

**Work package:** WP-15 Phase 2 (the second WP-15 authority domain: the
controlled transition from a receipt-correlated ordinary-review publication
to an immutable receipt-correlated successor publication + exact
`SupersessionRecord`, making the publication eligible for the
contract-authorized privileged publication semantics).
**Status:** implementation complete + dual-track focused correction;
**Track A focused rereview ACCEPTED** (`WP-15 PHASE 2 TRACK A FOCUSED
REREVIEW ACCEPTED`); **Track B focused rereview ACCEPTED** (`WP-15 PHASE 2
TRACK B FOCUSED REREVIEW ACCEPTED`); SIR-WP15-P2-A-001 CLOSED;
SIR-WP15-P2-B-001 CLOSED; SIR-WP15-P2-B-002 CLOSED; no remaining Phase 2
blocking findings (no FRR blocking findings); envelope exception NONE;
Phase 2 accepted for LOCAL BASELINE COMMIT.
**Baseline:** HEAD `5856e3631d24fa638066cb2c15cee2a853f2ed54` (branch
`main`), the committed parent of this baseline commit. Nothing else
staged; no push/tag/release/deploy.
**Normative contract:** `docs/reports/wp-15-pre-implementation-contract-decision.md`
(Architecture Amendment A1 normative; Approved Decision 1.B §10–§13) + the
Phase 2 gate brief. Phase 1A/1B semantics are consumed unchanged
(event-type-aware source resolution, claimant-first exact outcome
resolution, EXE-008/EXE-012, exact receipt↔publication bindings, hostile
input capture, exact-chain currentness, generation-bound capability
discipline).

## 1. Baseline

HEAD `5856e3631d24fa638066cb2c15cee2a853f2ed54` (branch `main`; `feat:
establish WP-15 Phase 1B trusted receipt authority`), verified before any
edit. Nothing was staged at baseline; the only untracked files were the
pre-existing superseded WP-13D debris (`src/retrospective/**`,
`tests/unit/wp13d-*.test.ts`, `docs/reports/wp-13d-*.md`) — byte-untouched
and excluded from every walk (clean-clone evidence per contract §18).

## 2. Exact changed paths

New source family (`src/receipt-publication-correlation/`, 6 files):

- `src/receipt-publication-correlation/types.ts` — closed type vocabulary:
  the two-class write allowlist, the closed §3 read allowlist, the failure
  taxonomy (§30), the narrow request, the two-class store boundary, the
  host-assembled input, and the schema-role constants (capability identity
  ≠ schema role).
- `src/receipt-publication-correlation/internal/brand.ts` — module-private
  genuine correlation capability (independent generation registry) + TWO
  exact-record permits (successor publication; supersession), each
  class-bound.
- `src/receipt-publication-correlation/store.ts` — the exact two-class WP-8
  store boundary (the ONLY WP-8 surface of the family).
- `src/receipt-publication-correlation/authority.ts` — the decision core
  (`correlateReceiptPublication`).
- `src/receipt-publication-correlation/produce.ts` — the trusted host
  composition (`createReceiptPublicationCorrelationAuthority`; the ONE
  production capability mint site).
- `src/receipt-publication-correlation/index.ts` — family barrel (no
  capability/permit internals; no package-root export).

Modified (7):

- `src/pointofuse/evaluate.ts` — PUB-005 exact-correlation + currentness
  strengthening (§16/§36; minimum approved WP-15 correlation semantics).
- `tests/unit/wp15-phase1a-static-guard.test.ts` — the Phase 1A "no
  correlation producer" guard now scopes the
  `receipt-publication-correlation-producer` vocabulary to the authorized
  `src/receipt-publication-correlation/**` family (mirroring the Phase 1B
  receipt-producer scoping).
- `fixtures/workflows/valid/result-lifecycle.json` — WF-V-005 now models
  the WP-15 Phase 2 exact-correlation state (self-contained chain).
- `fixtures/manifest.json` — 12 new manifest entries (11 lifecycle LFC-V +
  1 artifact ART-V) for the new fixtures.
- `src/generated/corpus-bundle.ts` — regenerated (deterministic bundle
  mirror; `npm run build`).
- `tests/integration/conformance.test.ts`,
  `tests/integration/effective-authority.test.ts`, `tests/unit/core.test.ts`,
  `tests/trusted/destination-atomicity.test.ts` — manifest-total pins
  636 → 648 (the committed count now includes the new fixtures).

New fixtures (12 — 11 lifecycle + 1 artifact, matching the 12 manifest additions):

- `fixtures/artifacts/valid/result-phase2.json` — new ExecutionResult
  subject (digest computed through the committed projection machinery).
- `fixtures/lifecycle/valid/runtime-grant-phase2.json`,
  `activation-phase2.json`, `occurrence-phase2.json`, `attempt-phase2.json`,
  `validation-phase2.json`, `outcome-phase2.json`,
  `receipt-attempt-phase2.json`, `publication-phase2-main.json`,
  `receipt-publication-correlation-phase2.json`,
  `publication-phase2-correlated.json`, `supersession-phase2.json` — a
  self-contained accepted chain (grant → activation → occurrence → attempt
  → outcome → validation → publications → receipts → supersession) with a
  dedicated result subject, so the WF-V-005 point-of-use view is coherent
  and isolated from the legacy corpus publications on the older subject.

New tests (6 files):

- `tests/unit/wp15-phase2-helpers.ts` — focused harness (real WP-8 store,
  real chain seeding, real two-class boundary + capability, counting/
  throwing identity, test-side payload mirrors).
- `tests/unit/wp15-phase2-correlation.test.ts` — State A fresh transition,
  State B recovery, State E replay, no-partial-success, §34/§35 adversarial
  matrices, hostile input, capability isolation, forged registry, two-class
  sink confinement (9 tests).
- `tests/unit/wp15-phase2-replay-recovery.test.ts` — §22 States B/C/D/E,
  crash-after-successor retry, cold-restart replay, in-lock divergent
  successor/supersession, throwing hooks, lock contention (6 tests).
- `tests/unit/wp15-phase2-concurrency.test.ts` — §33 same-predecessor
  serialization, divergent receipt fail-closed, independent predecessors,
  in-lock exact-claimant recovery (4 tests).
- `tests/unit/wp15-phase2-capability-security.test.ts` — §27/§37 runtime
  proofs: unbranded/foreign/disposed/stale capabilities, cross-class permit
  rejection, closed read allowlist (no runtime-grant/excluded classes), no
  raw publisher, injection surface, WP-13C permit rejection (12 tests).
- `tests/unit/wp15-phase2-static-guard.test.ts` — §37/§38 static guards
  (11 tests).
- `tests/unit/wp15-phase2-privileged-consumption.test.ts` — §36 point-of-use
  integration over real records (6 tests).

No schema, package-export, dependency, MCP, Pi, WP-7, release-script, or
F-R1 change. The WP-13D debris is byte-untouched and excluded from every
walk.

## 3. New capability domain

One new authority domain, `receipt-publication-correlation-producer`
(CAPABILITY identity — `CORRELATION_PRODUCER_CAPABILITY_IDENTITY`), with a
module-private WeakSet brand, an INDEPENDENT generation registry (no shared
generation namespace with the receipt-producer / result-publication /
outcome-recorder registries), minted ONLY by the trusted host composition
(`produce.ts`; static-guard pinned as the single production mint site).
Permits are minted ONLY by the authority core immediately before each write
(`authority.ts`; static-guard pinned), each binding the genuine capability +
exact record class + record id + record digest + canonical-byte digest +
internally derived destination designation.

## 4. Capability vs schema-role separation

Pinned and statically guarded (§26): the successor `ResultPublicationRecord`
retains its committed schema role `trusted-result-publisher`; the
`SupersessionRecord` retains its committed schema role
`trusted-lifecycle-authority`. The new capability identity
`receipt-publication-correlation-producer` is NEVER a schema role; the
permit role (`receipt-publication-correlation`) is the authority role, not a
schema attribution. The WP-13 taxonomy inventory
(`src/storage/format/taxonomy.ts`) is untouched. A static guard asserts the
payload constructions bind the schema constants and that the taxonomy
carries no capability identity.

## 5. Read/write allowlists

- **Write allowlist (EXACTLY two classes):** successor
  `result-publication-record`; `SupersessionRecord`
  (`supersession-record`). Nothing else — no TrustedReceipt,
  ExecutionResult, ValidationRecord, outcome/attempt/occurrence/activation/
  grant/approval/issuance/revocation/registry/audit/lifecycle class. The
  boundary exposes exactly two permit-gated publish methods; a genuine
  permit of one class is not genuine at the other class's sink; a
  TrustedReceipt payload is rejected at the class gate (runtime + static
  proof).
- **Read allowlist (closed §3 set):** `trusted-receipt`,
  `result-publication-record`, `supersession-record`, `validation-record`,
  `execution-outcome-record`, `execution-attempt-record`,
  `execution-occurrence-record`, `activation-record`, `revocation-record`.
  EXPLICITLY excluded: `approval-record`, `issuance-record`,
  `runtime-grant`, `execution-summary-record`, `migration-record`,
  `authoritative-audit-event`. No RuntimeGrant read (§29): the correlation
  verify path never needed it (the TrustedReceipt already carries trusted
  event attestation; the only currentness check is the PUB-004
  active-publication revocation check, which uses the revocation-record
  class in the allowlist). No escalation was required.

## 6. Request boundary (§6/§7)

`CorrelationRequest` = exactly `workspaceId` (`pgw:w:`),
`predecessorPublicationRecordId` (`pgw:l:`), `trustedReceiptRecordId`
(`pgw:l:`). The caller can never supply successor/supersession bytes,
target scopes, receipt_correlations, result/outcome/occurrence/attempt
facts, registry reference, responsible_role, provenance, publication
digest, predecessor currentness, successor/supersession identity — every
trusted transition fact is derived internally. Hostile request capture uses
the committed `snapshotJson` primitive (own enumerable data descriptors
only): getters, inherited fields, unexpected own keys, non-plain prototype
tricks, throwing Proxy traps, and revoked proxies fail closed as typed
`CORRELATION-INPUT-INVALID` (never an untyped exception) — the Phase 1B
input discipline is not regressed. The trusted input container has closed
keys (request, registry, store, coordinate, identity, schemaRegistry,
capability, hooks); the composition closes over every trusted dependency
and exposes exactly `authority.correlate(request)`.

## 7. Fresh receipt verification (§8/§9)

At every correlation attempt (pre-lock AND again under the lock, both on
fresh reads — no cache, no previous validation result, no caller facts):

- the nominated receipt is fresh-read from trusted durable storage;
- class gate (`TrustedReceipt`) → schema gate → `event_type` exactly
  `result-publication-correlation` → disposition exactly `completed`
  (through the committed Phase 1A `receiptEventDispositionOk` validator) →
  `event_record_id` exactly equal to the nominated predecessor publication →
  workspace/occurrence/attempt exact → committed Phase 1A
  `receiptSourceBindingOk` on the constructed form;
- a receipt of any other event type never unlocks the transition even if it
  references the same attempt; receipt existence alone is never sufficient.

## 8. Predecessor validation/currentness (§10/§35)

- exact class/schema/role; workspace exact; the Phase-2 predecessor surface
  is pinned: `publication_scopes` exactly `['ordinary-review']` and
  `receipt_correlations` empty (a receipt-correlated or privileged
  predecessor is not a Phase-2 predecessor);
- PUB-004 active-publication currentness: an applicable current
  RevocationRecord targeting the exact predecessor (class + identity,
  accepted `effective_at` at-or-before now) fails the transition closed;
- the predecessor is immutable: never modified in place.

## 9. Exact retrospective/binding result (§12/§13)

- the exact attempt context resolves uniquely (workspace/occurrence/attempt/
  bundle);
- Phase 1A claimant-first `resolveExactOutcome` (zero → missing;
  conflict/malformed → fail closed) + the exact result-association quartet
  against the publication result subject + the exact passing
  ValidationRecord (ExecutionResult subject matching the quartet) +
  well-formed evaluator provenance;
- the committed shared retrospective path is invoked on every transition:
  `deriveRetrospectiveFactsFromStore` (S4 resolver → primitive) with full
  fact cross-checks (workspace/occurrence/attempt/anchor/disposition/
  association quartet/publication identity/scopes). When the committed
  resolver reports its `state.publication-ambiguous` signal (its
  single-publication design; the correlation transition is the committed
  two-publication state), the authority tolerates EXACTLY {the predecessor
  present once + one schema-valid same-result-instance successor claimant}
  and defers material classification to the single successor-material
  resolver (SIR-WP15-P2-A-001; any unrelated/extra/malformed publication on
  the ambiguity surface fails closed as retrospective-invalid). There is NO
  second derivation engine (static guard proves the family imports the
  committed barrel and defines no resolver/facts/derivation module).

## 10. Successor publication derivation (§14/§15)

The successor starts from the fresh validated predecessor and preserves
every immutable/non-correlation fact exactly (workspace, result subject,
execution identifiers, bundle, validation id, association mode, evaluator
provenance). ONLY the contract-authorized receipt-gating surface changes:

- `receipt_correlations` = `[nominated receipt id]` — the exact freshly
  verified receipt; no caller-selected list, no unrelated receipt;
- `publication_scopes` = predecessor scopes ∪ the three receipt-gated
  privileged scopes `completion-status`, `downstream-automation`,
  `authoritative-reporting` (contract §10 — the exact scope transition; no
  new scope is invented);
- `responsible_role` stays `trusted-result-publisher`; the registry
  reference derives from the host-owned current context (`registryReferenceFor`).

## 11. PUB-005/PUB-006 behavior (§16/§36; corrected by SIR-WP15-P2-B-001/B-002)

The committed point-of-use PUB-005 verifier (`evaluatePointOfUse`) is
narrowly strengthened within the approved WP-15 correlation semantics:

- **(a) exact correlation triangle:** privileged scopes now require the
  correlation to resolve within the evaluated record set to an exact
  `result-publication-correlation` `completed` TrustedReceipt (committed
  shape + producer role) that attests a DISTINCT `ResultPublicationRecord`
  (never the candidate itself) with exact receipt↔attested
  workspace/occurrence/attempt bindings and a JCS-exact result identity
  (instance/revision/digest/kind/protocol/workspace) against the candidate.
  Non-empty `receipt_correlations` alone is insufficient; receipt existence
  elsewhere in storage is insufficient; self-attestation, revision/digest
  conflation, and mismatched correlations (different event type, different
  subject) never unlock privileged consumption.
- **(b) currentness:** the attested predecessor must be made current
  through EXACTLY ONE schema-valid SupersessionRecord binding it to this
  candidate (claimant-first; divergent/multiple/malformed claimants fail
  closed), the candidate itself must not be superseded, and no other
  non-superseded, non-revoked publication may compete for the same
  workspace/attempt/result instance (a successor whose SupersessionRecord
  is not yet durable is blocked; a revoked competitor does not compete —
  PUB-004 active-publication semantics, revocation-record already in the
  Phase 2 read allowlist).
- No unrelated PUB rule is widened; the ordinary-review surface is
  untouched. This strengthening is required by the gate brief's §36
  privileged-consumption scenarios (receipt-only → blocked; successor
  without supersession → blocked; exact successor + exact supersession +
  exact correlation → allowed for exactly the authorized scopes; mismatched
  correlation → blocked). The conformance corpus previously modeled the
  OLD weaker semantics (a privileged publication correlated with an
  attempt-end receipt); that fixture state is now contract-invalid, so the
  corpus was corrected (fixture + manifest + regenerated bundle + count
  pins) and conformance was rerun (§39) — 648/648 passes.

## 12. Publication lock (§20) and under-lock freshness (§21)

Key: `receipt-publication-correlation|<predecessorPublicationRecordId>` —
binds the exact predecessor; two concurrent correlations for the same
predecessor contend; independent predecessors never globally serialize.
Pre-lock verification is advisory; under the lock ALL relevant state is
re-read fresh (predecessor, receipt, attempt/outcome/validation,
supersessions, publications, revocations, registry context) and the full
verification re-runs; under-lock failures are authoritative.

## 13. Replay/conflict (§11/§17/§23/§24)

- Supersession resolution is claimant-first over the exact predecessor
  relation (`prior.subject_type = result-publication` + exact
  `prior.record_id`), schema-gated: no claimant → predecessor may be
  current; exactly one schema-valid claimant naming the exact
  materially-identical successor → State E replay; divergent named
  successor → `CORRELATION-PREDECESSOR-NOT-CURRENT`; multiple claimants,
  malformed, or schema-invalid claimants → fail closed. No
  first/latest/timestamp/enumeration-order winner.
- Successor resolution is claimant-first over the exact successor subject
  (same workspace/occurrence/attempt/bundle + result instance, excluding
  the predecessor), schema-gated: no claimant → mint (opaque non-content
  derived id) and publish; exactly one materially-identical claimant →
  reuse (State B); divergent/multiple claimants → typed conflict, ZERO new
  ids. The material projection is a closed explicit field list per class
  (future schema fields fail closed until deliberately added); only
  record_id/created_at are excluded.
- Successor identity is minted ONLY when under-lock fresh verification
  succeeds and no exact replayable/conflicting claimant exists.

## 14. Partial-state recovery (§22)

- State A (receipt durable, no successor): predecessor remains ordinary /
  non-privileged; retry constructs/publishes the successor.
- State B (successor durable, supersession missing): retry discovers the
  exact durable successor, validates it completely, allocates ZERO new
  successor ids, writes ZERO duplicate successor records, publishes the
  exact missing SupersessionRecord, and only then reports success
  (`recovered`); privileged consumption remains blocked until the
  supersession completes (PUB-005 currentness).
- State C (successor durable but divergent): fail closed, no overwrite.
- State D (supersession points to divergent successor): fail closed.
- State E (exact successor + exact supersession): idempotent replay
  (`replayed`), zero ids/writes/audits. No newest-wins.

## 15. Supersession result (§18)

Constructed internally after the exact successor is durable: binds
`prior = {subject_type: result-publication, record_id: predecessor}` and
`successor = {subject_type: result-publication, record_id: successor}`;
committed schema role `trusted-lifecycle-authority`; `scope` `ordinary-review`
(committed `publicationScope` enum; no committed consumer distinguishes the
value for result-publication supersessions) and `reason_code`
`receipt-correlation` (committed `reason_code` pattern). No generic
supersession capability; the correlation capability mints only the
class-specific supersession permit for this transition.

## 16. Registry/currentness (§28/§29)

Registry/current trusted context is host-owned (closed over at composition;
per-call injection rejected). The authority re-verifies registry genuineness
through the committed `isBrandedRegistry` primitive; successor/supersession
references are `registryReferenceFor(host context)`. Currentness uses ONLY
the Phase 2 read set: the PUB-004 predecessor revocation check
(revocation-record). No RuntimeGrant read was required.

## 17. Audit behavior (§31)

The D-6 authorized-write audit identity is passed through from the WP-8
durability point for each ACTUAL new write: `successorAuditEventId` only
when the successor was newly written; `supersessionAuditEventId` only when
the supersession was newly written. Replay/recovery never fabricates a
successful-write audit (State B recovery carries no successor audit; State E
replay carries neither). The typed result never claims an audit event for a
write that did not occur.

## 18. Typed result/error surface (§30/§32)

`CorrelationResult` success: `{ok: true, outcome: 'correlated' | 'recovered'
| 'replayed', predecessorRecordId, successorRecordId, supersessionRecordId,
receiptRecordId, successorRecordDigest, supersessionRecordDigest,
successorAuditEventId?, supersessionAuditEventId?}`. No partial success: if
the successor write succeeds but the supersession write fails, the result is
a typed incomplete/retryable failure (`CORRELATION-SUPERSESSION-CONFLICT`
`conflict.durable-record` etc.) and the durable successor remains for exact
recovery on retry. Closed failure categories: `CORRELATION-INPUT-INVALID`,
`CORRELATION-CAPABILITY-DENIED`, `CORRELATION-LOCK-CONFLICT`,
`CORRELATION-STATE-UNVERIFIABLE`, `CORRELATION-RECEIPT-REJECTED`,
`CORRELATION-PREDECESSOR-REJECTED`, `CORRELATION-MISMATCH`,
`CORRELATION-RETROSPECTIVE-INVALID`, `CORRELATION-PREDECESSOR-NOT-CURRENT`,
`CORRELATION-SUPERSESSION-CONFLICT`, `CORRELATION-SUCCESSOR-CONFLICT`,
`CORRELATION-REGISTRY-INVALID`, `CORRELATION-SUCCESSOR-WRITE-FAILED`,
`CORRELATION-SUPERSESSION-WRITE-FAILED`, `CORRELATION-INTERNAL-FAILURE`.
Nothing leaks capability internals, raw store paths, unrestricted registry
data, or unrelated lifecycle records.

## 19. Concurrency tests (§33)

Through the real WP-8 store + real two-class boundary + real process-local
coordinator (serialized acquisitions of the same key plus the in-lock hook
seam): same predecessor + same receipt → exactly one successor + one
supersession, second caller `replayed`; same predecessor + divergent receipt
→ fail closed, no competing successor; independent predecessors → both
transitions complete under independent keys (no global serialization);
in-lock exact-claimant seeding → `recovered` with zero new successor
writes; crash-after-successor retry → `recovered`; cold-restart replay →
`replayed`; in-lock divergent successor/supersession → typed conflicts with
zero allocations.

## 20. Privileged-consumption integration (§36)

Over the real durable records produced by the authority, evaluated through
the committed `evaluatePointOfUse`: receipt durable only → no privileged
consumption (ordinary-review-only surface); successor durable, supersession
absent → `pointofuse.privileged-not-current`; exact successor + exact
supersession + exact receipt correlation → allowed for exactly
ordinary-review + the three receipt-gated scopes; mismatched correlation
(different event type / unrelated receipt / different subject) → blocked;
superseded correlated publication → blocked.

## 21. Authority/static guard results (§37/§38)

Static guards prove: family purity (no fs/network/process/timer/crypto);
the ONLY WP-8 surface is `store.ts`; identity/time sources invoked only
from the authority core; the committed S4 barrel + Phase 1A primitives
(`resolveExactOutcome`, `receiptSourceBindingOk`, `receiptEventDispositionOk`)
+ committed schema validator are imported (no second derivation engine, no
redefined S4/Phase 1A vocabulary); no WP-13C publication capability/
publisher, no Phase 1B receipt capability, no execution/grant/approval/
issuance surface, no generic lifecycle writer, no TrustedReceipt write
surface, no excluded read class (including no runtime-grant), no Phase
3/release vocabulary; the capability mint is confined to `produce.ts` and
the two permit mints to `authority.ts`; the barrel and the package root
export no brand/permit internals; schema roles stay committed; the
point-of-use verifier carries the exact-correlation + currentness
strengthening. Runtime proofs cover unbranded/foreign/disposed/stale
capabilities, forged permits, cross-class permits, WP-13C permit rejection,
closed read surface, injection rejection, and host-composed authority
surface (`correlate` only).

## 22. Focused tests/typechecks

| Suite | Result |
|---|---|
| `wp15-phase2-correlation.test.js` (new; includes SIR-WP15-P2-A-001 regressions A1/A2/A4) | 12/12 |
| `wp15-phase2-replay-recovery.test.js` (new) | 6/6 |
| `wp15-phase2-concurrency.test.js` (new) | 4/4 |
| `wp15-phase2-capability-security.test.js` (new) | 12/12 |
| `wp15-phase2-static-guard.test.js` (new; includes SIR-WP15-P2-A-001 continuation pin) | 12/12 |
| `wp15-phase2-privileged-consumption.test.js` (new; includes SIR-WP15-P2-B-001 B1–B7 and SIR-WP15-P2-B-002 C1–C6 regressions) | 19/19 |
| Phase 1B (receipt-producer 49 + concurrency 7 + capability-security 14 + static guard 9) | 79/79 |
| Phase 1A (lifecycle + resultless + static guard) | 37/37 |
| Focused correction neighbors: WP-13C publication, S4 derivation + static guard, S3 precondition (S4 proven unchanged) | 191/191 |
| integration conformance + effective-authority + core (manifest 648/648, oracle, dispatch) | 133/133 |
| pointofuse-v2 + security + trusted | 816/817 — 1 pre-existing baseline failure (boundary-v2 `m-2` package-exports pin vs `./loading`; package.json untouched; pre-dates this gate, recorded at Phase 1B) |
| full `unit/*.test.js` | 870/872 — the 2 failures are the recorded superseded untracked WP-13D E2E tests (pre-existing, non-authoritative) |
| mcp/unit + runtime + drafting + writing + pi-adapter/unit | 435/435 |
| pi-adapter integration/security/enforcement + execution | 95/95 |
| shared-module consumers after the correction (pi-adapter unit/integration/security/enforcement + mcp/unit + runtime + drafting + writing + trusted + execution) | 1100/1100 |
| TypeScript | `tsc -p tsconfig.json` and `tsc -p tsconfig.tests.json` clean |
| `git diff --check` | clean |

Conformance WAS rerun after the focused correction: the point-of-use PUB-005
rule semantics changed (SIR-WP15-P2-B-001/B-002), so conformance was
re-executed to prove the corpus remains structurally correct — 648/648
entries pass with NO fixture/manifest/count changes in the correction (the
existing WF-V-005 phase2 chain already satisfies the exact
predecessor/receipt/successor triangle). No MCP/Pi/WP-7/WP-14C rerun was
needed beyond the suites above (the only shared-module change is
`src/pointofuse/evaluate.ts`, whose direct consumers — conformance,
pointofuse-v2, security, trusted, pi-adapter enforcement/security — all
pass).

## 23. Focused correction — SIR-WP15-P2-A-001 / B-001 / B-002 (dual-track synthesis)

**Gate:** focused correction; envelope exception NONE. All other reviewed
Track A / Track B areas: PASS or nonblocking observation (N1 corrected
below; N2–N5 and the accepted limitations are preserved as observations —
no correction required). The accepted Phase 2 architecture is preserved
unchanged: one `receipt-publication-correlation-producer` authority domain,
two-class write allowlist, committed schema roles, closed §3 read allowlist
(no RuntimeGrant), host-closed composition, correlation lock, immutable
replay/conflict, WP-8 durability/audit. No Phase 1B semantics, no Phase 3,
no F-R1, no release action.

### SIR-WP15-P2-A-001 — S4 publication ambiguity tolerance too broad — CLOSED

**Root cause:** the producer-side continuation of the committed S4
`state.publication-ambiguous` signal tolerated ANY ≥2 schema-valid
attempt-scoped publications, so an unrelated same-attempt publication with
a DIFFERENT result instance could be normalized into a successful
correlation (States A/B fail-open).

**Correction (`src/receipt-publication-correlation/authority.ts`, one
narrow continuation):** when S4 returns exactly
`RETROSPECTIVE-STATE-CORRUPT / state.publication-ambiguous`, the tolerated
set is now EXACTLY

- the predecessor itself present exactly once;
- EXACTLY ONE other schema-valid publication;
- that other publication claiming the SAME exact result instance as the
  predecessor.

Zero other publications, more than one other publication, a different
result instance, or a malformed/schema-invalid claimant on the same
ambiguity surface → `CORRELATION-RETROSPECTIVE-INVALID`
`subject.retrospective-publication-state` (zero writes). Material exactness
is NOT classified in the gate: the single successor-material resolver
(`resolveSuccessor`) remains the one authority for replay/divergence. The
committed S4 resolver is NOT modified (git-proven unchanged; its
single-publication design and ambiguity signal are preserved).

**Tests:** A1 (predecessor + unrelated same-attempt/different-result
publication → retrospective-invalid, zero successor/supersession writes),
A2 (predecessor + exact successor + unrelated third publication →
retrospective-invalid, no recovery), A3 (predecessor + exactly one
same-result exact successor → State B recovery remains valid), A4
(predecessor + exactly one same-result divergent successor → passes only
the ambiguity-shape gate, then fails in `resolveSuccessor` with the
existing `successor.material-divergence`). The prior
`successor.multiple-claimants` expectation for >1 same-result claimants is
superseded by the tighter gate (now `CORRELATION-RETROSPECTIVE-INVALID`,
matching the required model). A static guard pins the
exact-one-other/same-instance continuation and the unchanged S4 resolver.

**Disposition:** CLOSED.

### SIR-WP15-P2-B-001 — PUB-005 under-verifies the attested predecessor — CLOSED

**Root cause:** the consumer-side exact-correlation predicate compared the
receipt bindings only against the privileged candidate and checked only
the attested result INSTANCE — self-attestation (receipt attesting the
candidate itself) and revision/digest conflation (same instance, different
revision/digest) could pass, and the attested predecessor's own bindings
were never independently verified.

**Correction (`src/pointofuse/evaluate.ts`, PUB-005 exact-correlation
path):** for every receipt considered authoritative the verifier now
proves the full triangle
`candidate P2 --receipt_correlations--> R --event_record_id--> attested P1`:

- **receipt itself:** `TrustedReceipt`, committed producer role
  `trusted-receipt-producer`, correlation-relevant shape gate (class, role,
  identity/time forms, `result-publication-correlation` event,
  `completed` disposition — the full JSON-schema validation lives at the
  validated-record API boundary);
- **distinct predecessor:** `attested.record_id !== candidate.record_id` —
  self-attestation is impossible;
- **receipt ↔ attested predecessor binding:** the attested publication's
  OWN workspace/occurrence/attempt must agree with the receipt (not merely
  with the candidate);
- **attested predecessor ↔ candidate result identity:** the FULL committed
  result subject (JCS-exact — instance_id, revision_id, digest, kind,
  protocol version, workspace) must be identical — same instance with
  another revision/digest is never exact correlation;
- **candidate ↔ receipt:** the existing exact workspace/occurrence/attempt
  and receipt-ID reference checks are preserved.

Any mismatch emits the existing `pointofuse.privileged-without-receipt`
finding; no new rule family was created.

**Tests (real `evaluatePointOfUse`):** B1 self-attestation blocked; B2
attested predecessor with different workspace blocked; B3 different
occurrence blocked; B4 different attempt blocked; B5 same instance with
different revision blocked; B6 same instance/revision with divergent
digest blocked; B7 exact legitimate predecessor receipt remains eligible
subject to supersession/currentness.

**Disposition:** CLOSED.

### SIR-WP15-P2-B-002 — Supersession currentness is not exact — CLOSED

**Root cause:** the consumer treated a predecessor as "superseded" from
`prior.subject_type + prior.record_id` alone — without schema validity,
exact-successor enforcement, or claimant cardinality — so a
malformed/divergent supersession could remove the attested predecessor
from competition and unlock the privileged candidate.

**Correction (`src/pointofuse/evaluate.ts`, PUB-005 currentness path):**
claimant-first supersession resolution for the ATTESTED predecessor
(claimants discovered by the exact prior relation ONLY — never prefilters
by the expected successor):

- no claimant → the required predecessor→candidate transition is
  incomplete (partial State B): `pointofuse.privileged-not-current`;
- exactly one schema-valid claimant with `successor.record_id = exact
  candidate` → currentness link valid;
- exactly one claimant with a divergent successor, a schema-invalid
  claimant, or more than one claimant → fail closed
  `pointofuse.privileged-supersession-divergent` — no
  first/latest/newest/enumeration winner;
- the candidate's own later supersession keeps the existing
  `pointofuse.privileged-superseded` blocking.

The supersession shape gate covers class, committed
`trusted-lifecycle-authority` role, prior/successor reference forms, scope
vocabulary, reason-code pattern, and identity/time forms. `scope` /
`reason_code` remain non-authoritative for consumer currentness (accepted
observation N5, not reopened).

**Tests (real `evaluatePointOfUse`):** C1 exact predecessor→candidate
supersession allowed; C2 supersession to a different successor blocked;
C3 multiple claimants blocked; C4 schema-invalid claimant blocked;
C5 no SupersessionRecord blocked; C6 exact candidate later superseded
remains blocked.

**Disposition:** CLOSED.

### Producer/consumer alignment (proven)

The SAME exact transition satisfies both sides: the correlation authority
produces P1 + exact correlation receipt R → P2 + exact supersession
S(P1→P2) (producer tests), and `evaluatePointOfUse(P2, durable context)`
requires P2.receipt_correlations ⊇ {R}, R attests exact P1 (distinct,
exact bindings, exact result identity), exactly one schema-valid S binds
P1→P2, and P2 is otherwise current (consumer tests B7/C1 + conformance
WF-V-005). Neither side weakens the other.

### Preserved PUB behavior (regression-proven)

Receipt of another event type blocked; attempt-end receipt never unlocks;
ordinary-review requires no correlation; successor without supersession
blocked (`privileged-not-current`); revoked competitor governed by the
unchanged PUB-004 `revokedAt` predicate; the exact completed transition
enables only ordinary-review + completion-status + downstream-automation +
authoritative-reporting; later-superseded correlated publication blocked
(`privileged-superseded`).

### Conformance / corpus

No fixture, manifest, or count change was required by the correction: the
existing WF-V-005 phase2 chain already satisfies the exact
predecessor/receipt/successor triangle. Conformance was re-executed (the
point-of-use rule semantics changed) — 648/648 entries pass. The new
adversarial coverage (self-attestation, wrong predecessor, wrong
revision/digest, divergent supersession, multiple claimants, exact chain)
is owned by the focused point-of-use regressions (B1–B7, C1–C6).

### Exact changed paths (focused correction)

- `src/receipt-publication-correlation/authority.ts` — tightened S4
  ambiguity continuation (predecessor-once + exactly-one same-result
  schema-valid successor claimant; everything else retrospective-invalid).
- `src/pointofuse/evaluate.ts` — PUB-005 exact triangle (receipt shape +
  producer role, distinct attested predecessor, attested↔receipt bindings,
  JCS-exact result identity) + claimant-first supersession currentness with
  the `pointofuse.privileged-supersession-divergent` finding.
- `tests/unit/wp15-phase1a-static-guard.test.ts` — narrow consumer
  exception for the `trusted-receipt-producer` role token in the PUB-005
  verifier (a consumer verification surface, never an authority family).
- `tests/unit/wp15-phase2-correlation.test.ts` — A1/A2/A4 regressions;
  multiple-claimants expectation updated to the tightened gate.
- `tests/unit/wp15-phase2-privileged-consumption.test.ts` — B1–B7, C1–C6
  regressions.
- `tests/unit/wp15-phase2-static-guard.test.ts` — A-001 continuation pin +
  B-001/B-002 vocabulary pin.
- `docs/reports/wp-15-phase-2-implementation-report.md` — this section +
  N1 fixture-count prose correction (13 → 12).

### Focused verification (actual counts)

| Suite | Result |
|---|---|
| `wp15-phase2-correlation.test.js` (A1/A2/A4 included) | 12/12 |
| `wp15-phase2-replay-recovery.test.js` | 6/6 |
| `wp15-phase2-concurrency.test.js` | 4/4 |
| `wp15-phase2-capability-security.test.js` | 12/12 |
| `wp15-phase2-static-guard.test.js` (A-001 pin included) | 12/12 |
| `wp15-phase2-privileged-consumption.test.js` (B1–B7, C1–C6 included) | 19/19 |
| Phase 1B + Phase 1A + S4 + WP-13C + S3-precondition (S4 unchanged) | 191/191 |
| integration conformance + effective-authority + core (648/648) | 133/133 |
| pointofuse-v2 + security | 246/247 — 1 pre-existing baseline failure (boundary-v2 `m-2` package-exports pin; package.json untouched) |
| full `unit/*.test.js` | 870/872 — 2 recorded pre-existing superseded WP-13D E2E failures |
| shared-module consumers (pi-adapter/mcp/runtime/drafting/writing/trusted/execution) | 1100/1100 |
| TypeScript main + tests | clean |
| `git diff --check` | clean |

### Authority boundary after correction

Unchanged: `receipt-publication-correlation-producer` capability identity
(distinct mint sites: capability → `produce.ts`, permits →
`authority.ts`), two-class write allowlist (successor
`ResultPublicationRecord` + `SupersessionRecord`), committed schema roles
(`trusted-result-publisher` / `trusted-lifecycle-authority`), closed §3
read allowlist (NO runtime-grant), host-closed composition
(`authority.correlate(request)`), correlation lock, under-lock freshness,
immutable replay/conflict, WP-8 durability/audit. The committed S4 resolver
is unchanged (git-proven). No new authority domain, no new writable class,
no RuntimeGrant read, no Phase 3 implementation, no F-R1, no external
release action.

## 24. Known limitations

- The event-subject correlation lock is process-local per the committed
  coordinator contract (FSCR-W12-001); multi-process composition relies on
  WP-8's per-record publication lock, which the two-class boundary preserves
  unchanged.
- The committed S4 resolver is single-publication by design; the
  correlation transition is the committed two-publication state. When the
  resolver reports `state.publication-ambiguous`, the authority tolerates
  EXACTLY {predecessor + one schema-valid same-result successor claimant}
  and delegates material classification to the successor resolution (the
  shared derivation primitive is never reimplemented; SIR-WP15-P2-A-001).
  If a future contract change makes the resolver supersession-aware, the
  shared path can be tightened further without touching this family.
- The supersession `scope`/`reason_code` values (`ordinary-review` /
  `receipt-correlation`) follow the committed schema vocabulary; no
  committed consumer distinguishes the scope value for
  result-publication supersessions.
- The conformance corpus's legacy invalid publications on the older result
  subject remain as committed; the WF-V-005 view now models a
  self-contained WP-15 Phase 2 chain to stay fail-closed-correct under the
  strengthened PUB-005 semantics.
- The two recorded pre-existing baseline failures (2 superseded WP-13D E2E;
  1 pointofuse `m-2` exports pin) remain untouched and are recorded for the
  closure gate.

## 25. Git state

Committed in this gate as the single Phase 2 baseline commit, subject
`feat: establish WP-15 Phase 2 receipt publication correlation`; parent
HEAD `5856e3631d24fa638066cb2c15cee2a853f2ed54` (branch `main`); nothing
else staged; no tag; no push/release/deploy. The committed tree is the
exact dual-track-focused-rereviewed candidate: the changed/new paths above
plus the pre-existing untracked WP-13D debris (byte-untouched, excluded
from all guards and from the commit). `git diff --check` clean.

## 26. Explicit state

- `trusted-receipt-producer` (Phase 1B) UNCHANGED — its authority
  semantics, capability brand, store boundary, and tests are untouched.
- Phase 2 issues NO TrustedReceipt (no receipt issuance by the correlation
  authority; the two-class sink rejects the receipt class; the receipt is
  consumed as the exact correlation subject).
- `ExecutionResult` immutable (never touched by the correlation family).
- The predecessor `ResultPublicationRecord` is immutable (never modified in
  place; only a fresh successor is produced).
- No generic lifecycle-write authority exists; the write surface is exactly
  two classes under two exact class-bound permits.
- Phase 3 NOT STARTED; F-R1 NOT IMPLEMENTED; no external release action
  (no push/tag/publication/installation/deployment; no MCP/Pi surface
  change; no package exports change; no new dependency; no
  `components.json`/taxonomy role-vocabulary change).

## 27. Envelope exception status

Envelope exception: NONE. Phase 2 accepted for baseline (Track A focused
rereview ACCEPTED; Track B focused rereview ACCEPTED; SIR-WP15-P2-A-001 /
B-001 / B-002 CLOSED; no remaining Phase 2 blocking findings). Phase 3
NOT STARTED by this commit; F-R1 NOT IMPLEMENTED; external release actions
NOT AUTHORIZED.

WP-15 PHASE 2 BASELINED — PHASE 3 IMPLEMENTATION AUTHORIZED
