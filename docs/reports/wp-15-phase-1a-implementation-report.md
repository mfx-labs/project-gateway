# WP-15 Phase 1A — Event-Aware Receipt Lifecycle + Outcome Foundation — Implementation Report

**Work package:** WP-15 Phase 1A (event-type-aware TrustedReceipt lifecycle
verification; EXE-012 fail-closed outcome coverage; denied-activation
absent-only schema semantics; exact `incomplete`/`rejected` receipt
dispositions; trustworthy result-less terminal outcome durability through
the EXISTING `trusted-execution-outcome-recorder`).
**Status:** implementation complete; unstaged/uncommitted for senior review.
**Baseline:** HEAD `4c2d5b21a8b91818f4c7efa834bbd920baae6d3a` (branch
`main`; `docs: establish WP-15 contract baseline`), unchanged. Nothing
staged/committed; no push/tag/release/deploy.
**Normative contract:** `docs/reports/wp-15-pre-implementation-contract-decision.md`
(Architecture Amendment A1 normative; Remaining Architecture Decisions:
NONE). WP-15 Architecture + Execution Authorization Envelope: ACTIVE.

## 1. Exact changed paths

Source/schema:

- `schemas/lifecycle/1.0/records/trusted-receipt.json` — denied-activation
  `if/then/else` (occurrence/attempt MUST be ABSENT; `null`, empty string,
  and fabricated IDs invalid; non-denied branches retain their committed
  requirements and null-inapplicability convention); disposition
  vocabulary extended with `incomplete` and `rejected` (all existing values
  preserved).
- `src/lifecycle/graph.ts` — event-type-aware receipt verification:
  `receiptEventSourceClass` / `receiptSourceClassMatches` /
  `receiptSourceBindingOk` helpers (contract §3.2/§3.3); EXE-012 exact
  outcome coverage for the six attempt-correlated retrospective receipt
  event types; result-publication-correlation source + exact outcome
  result-association validation; EXE-008 attempt-side receipt-facts
  obligation conditioned on retrospective eligibility (exactly one
  exact-bound outcome record).
- `src/semantic/rules.ts` — EXE-008/EXE-012 titles reflect the A1
  semantics (rule IDs stable).
- `src/outcome-production/produce.ts` — documentation-only synchronization
  of the A1 result-less eligibility on the existing decision core (the
  eligibility path already admits the optional validated-result handoff; no
  runtime change was required — the committed path is the A1-corrected
  path; focused tests below prove it).
- `src/generated/schema-bundle.ts`, `src/generated/corpus-bundle.ts` —
  deterministic regeneration (`npm run generate`) from the committed
  schema/fixture sources.

Fixtures (`fixtures/lifecycle/`, `fixtures/manifest.json`):

- valid: `receipt-denied-activation.json` (full trusted-lifecycle-
  verification PASS: denied + absent occurrence/attempt, event-type-aware
  EXE-008 resolves the `ActivationRecord` source),
  `receipt-disposition-incomplete.json`, `receipt-disposition-rejected.json`
  (schema-acceptance PASS).
- invalid (structural-schema-validation FAIL): `receipt-denied-null-
  occurrence.json`, `receipt-denied-null-attempt.json`, `receipt-denied-
  fabricated-ids.json`, `receipt-attempt-end-missing-attempt.json`,
  `receipt-unsupported-disposition.json`.

Tests:

- `tests/unit/wp15-phase1a-receipt-lifecycle.test.ts` (new; 15 focused
  tests).
- `tests/unit/wp15-phase1a-outcome-resultless.test.ts` (new; 3 focused
  tests).
- `tests/unit/wp15-phase1a-static-guard.test.ts` (new; 4 static guards).
- `tests/unit/core.test.ts`, `tests/integration/conformance.test.ts`,
  `tests/integration/effective-authority.test.ts`,
  `tests/trusted/destination-atomicity.test.ts` — pinned conformance
  manifest count 628 → 636 (8 new fixtures; the count encodes the executed
  manifest surface).

Docs: `docs/design/semantic-validation-rules.md` — EXE-008/EXE-012
normative statements updated (event-type-aware source resolution; exact
outcome coverage; result-less ≠ outcome-less); rule IDs stable.

## 2. EXE-008 implementation (event-type-aware event source)

The committed lifecycle verifier no longer assumes
`event_record_id` must be an `ExecutionAttemptRecord`. The exact contract
matrix (§3.2) is implemented:

| event_type | source class |
|---|---|
| activation-decision | `ActivationRecord` |
| occurrence-start | `ExecutionOccurrenceRecord` |
| attempt-start / attempt-end / enforcement-denial / timeout / crash | `ExecutionAttemptRecord` |
| cancellation | two pinned branches: occurrence-level (`ExecutionOccurrenceRecord`) / attempt-level (`ExecutionAttemptRecord`) |
| result-publication-correlation | `ResultPublicationRecord` |

Source-class mismatch, unknown event types, and exact-binding mismatches
(workspace; occurrence/attempt per event semantics; denied-activation
absent-only; accepted-activation exact reserved occurrence and never an
invented attempt) fail closed with EXE-008 (`lifecycle.receipt-event` /
`lifecycle.receipt-event-bindings`). No hidden universal attempt-record
rule remains. Event-source validity and retrospective eligibility are two
separate checks (separate helpers, separate rule emissions).

## 3. EXE-012 implementation (exact outcome coverage)

Every attempt-correlated retrospective receipt (attempt-start, attempt-end,
enforcement-denial, attempt-level cancellation, timeout, crash) requires an
exact matching trustworthy `ExecutionOutcomeRecord` — workspace, occurrence,
attempt, and bundle/reference context against the event source record.
No trustworthy outcome → `terminal-unverifiable` → receipt-ineligible →
`lifecycle.receipt-orphan` (RECEIPT-CORRELATION-FAILURE). Occurrence-level
receipts (activation-decision, occurrence-start, occurrence-level
cancellation) carry no attempt correlation and require no outcome coverage.
`result-publication-correlation` receipts additionally require the exact
valid publication with an exact outcome result association (EXE-013-
consistent context; `lifecycle.receipt-publication-invalid` on absence or
divergence).

## 4. Denied-activation schema behavior

`event_type = activation-decision` + `disposition = denied`: `occurrence_id`
and `attempt_id` MUST be ABSENT (JSON Schema `if/then`; the fields were
removed from the global `required` and are required only in the `else`
branch). `null`, empty string, and any real-looking/fabricated ID are
rejected both by the schema and by the graph's denied-branch binding check.
Non-denied branches retain their committed requirements; the `null`
inapplicability sentinel is unchanged there (accepted-activation and
occurrence-start keep present-`null` "not applicable" fields).

## 5. incomplete/rejected handling

TrustedReceipt disposition enum extended exactly as A1 authorizes:
`incomplete` and `rejected` added; all existing values preserved. No lossy
mapping (`incomplete` is never mapped to `failed`; `rejected` never to
`denied`); the durable outcome path preserves all seven committed outcome
dispositions one-to-one (the S3 decision core was already the full
7-value vocabulary; the A1 result-less path is exercised below). The
enforcement-denial event keeps its event-specific `denied` disposition
(distinct from the outcome disposition `rejected`, per contract §3.2).

## 6. Retrospective-complete classifier / receipt-facts obligation

The graph reuses the committed exact-bound subject (workspace + bundle +
occurrence + attempt + `execution_attempt_record_id` anchor, per
`classifyRetrospectiveEligibility`). A terminal attempt is
retrospective-complete iff exactly one exact-bound trustworthy
`ExecutionOutcomeRecord` exists; zero → `terminal-unverifiable` (valid
lifecycle state, NO receipt obligation, never forced to pass by a
fabricated receipt); >1 → conflicting (fails closed via EXE-010, no receipt
obligation). Completeness is never inferred from result presence/absence,
timestamps, process exit, enumeration order, or `ExecutionResult` bytes.

## 7. Result-less outcome-recorder correction

The existing `trusted-execution-outcome-recorder` eligibility path
(S3 decision core) already admits the optional validated-result handoff —
the A1-required result-less durability is implemented at the decision core
and is now proven by focused tests for `incomplete` and `rejected`
dispositions: exactly one durable `ExecutionOutcomeRecord` per exact
attempt, `result_association` absent, no fabricated result, exact attempt/
workspace/occurrence/bundle binding, idempotent material replay (zero
allocations/writes), material-divergence conflict fail-closed, one exact
outcome per attempt, immutable durable-record model. `result-less ≠
outcome-less`: with the durable result-less outcome the attempt classifies
`retrospective-complete`; without any outcome it stays
`terminal-unverifiable`. No new authority domain, no generic
lifecycle-write capability, no second outcome producer, no `ExecutionResult`
fabrication, no publication-behavior change.

## 8. Authority-boundary preservation

Static guards prove Phase 1A introduced NO: `trusted-receipt-producer`
implementation (receipt issuance NOT YET IMPLEMENTED — Phase 1B);
`receipt-publication-correlation-producer` implementation (Phase 2 NOT
STARTED); new generic lifecycle writer; new outcome authority domain;
realtime receipt issuance; prospective authority. `src/lifecycle/**` remains
pure (no fs/store/lock/capability/identity material; closed import
surface). The outcome-production/outcome/retrospective-derivation families
carry zero receipt vocabulary; execution/completion never issue or store
receipts; the WP-13C publication family keeps its committed fixed empty
`receipt_correlations` surface and is not a receipt producer. The
superseded untracked WP-13D debris is untouched and not walked.

## 9. Fixtures/rules changed

8 new conformance fixtures + manifest entries (636 total; runner sorts by
fixture_id; dependency metadata valid). EXE-008/EXE-012 rule texts updated
in `src/semantic/rules.ts` and `docs/design/semantic-validation-rules.md`
(event-aware source; exact outcome coverage; result-less ≠ outcome-less);
rule IDs stable.

## 10. Tests run and results

Focused verification (no full authoritative regression — reserved for
WP-15 closure):

| Suite | Result |
|---|---|
| `wp15-phase1a-receipt-lifecycle.test.js` (new) | 15/15 pass |
| `wp15-phase1a-outcome-resultless.test.js` (new) | 3/3 pass |
| `wp15-phase1a-static-guard.test.js` (new) | 4/4 pass |
| `wp13-durability-s1.test.js` (EXE-008/012/013 + schema/taxonomy) | pass |
| `wp13-durability-s3-outcome-production.test.js` (result-less + replay/conflict) | pass |
| `w4-f1.test.js`, durability/13c/13d static guards | pass |
| `core.test.js` (full conformance manifest 636/636) | pass |
| `integration/conformance.test.js` + `effective-authority.test.js` | pass |
| `corrections.test.js`, `second-focus.test.js` | pass |
| full `unit/*.test.js` | 711/713 — 2 failures are the recorded superseded untracked WP-13D E2E tests (S3 report §23.6; superseded/non-authoritative; excluded by clean-clone construction, contract §18) |
| `pointofuse-v2`, `trusted`, `security` | 816/817 — 1 pre-existing baseline failure (`boundary-v2` WP-9-era exports pin vs WP-14C `./loading`; package.json untouched by Phase 1A; pre-dates this gate) |
| `mcp/unit`, `runtime`, `drafting`, `writing` | 204/204 pass |
| `pi-adapter/unit` | 231/231 pass |
| WP-7 validated runner (reader/git/fff/security) | 165/165 pass |
| `wp7-discovery-guard` | source↔compiled correspondence OK |
| TypeScript | `tsc -p tsconfig.json` and `tsc -p tsconfig.tests.json` clean |

## 11. Known limitations

- Receipt issuance, the `trusted-receipt-producer` capability, the
  `receipt-publication-correlation-producer`, successor publication, and
  `SupersessionRecord` production are NOT implemented (later phases).
- The graph does not yet validate receipt-disposition-to-event-type
  consistency (the contract pins the issuance-side mapping; the verifier
  foundation validates source class, bindings, and outcome coverage).
- The pointofuse-v2 `boundary-v2` exports-map pin is a pre-existing
  baseline failure (WP-9-era assertion vs committed WP-14C `./loading`
  export); out of Phase 1A scope, recorded for the closure gate.
- The superseded untracked WP-13D debris remains byte-untouched; its two
  recorded failing E2E tests are superseded/non-authoritative (excluded by
  clean-clone construction per contract §18).

## 12. Explicit state

- `trusted-receipt-producer` NOT YET IMPLEMENTED.
- `receipt-publication-correlation-producer` NOT YET IMPLEMENTED.
- Phase 2 / Phase 3 NOT STARTED.
- F-R1 NOT IMPLEMENTED.
- No external release action occurred (no push/tag/publication/
  installation/deployment).

## 13. Git state

HEAD `4c2d5b21a8b91818f4c7efa834bbd920baae6d3a` unchanged; branch `main`;
nothing staged; no commit. Working tree: the changed paths above (modified
+ new) plus the pre-existing untracked WP-13D debris (untouched).
`git diff --check` clean. Envelope exception: NONE.

---

# Focused Correction — SIR-WP15-P1A-001…003 (senior review)

**Gate:** focused correction; envelope exception NONE; no redesign of
Phase 1A; no Phase 1B; no receipt issuance; no correlation authority.

## SIR-WP15-P1A-001 — exact outcome resolution — CLOSED

**Root cause:** Phase 1A used parallel existential lookups (`.some()` /
`.find()`) for outcome coverage in the receipt EXE-012 check, the
publication-correlation resolution, and the attempt-side obligation, with
the classifier as a separate matching definition.

**Correction:** one authoritative primitive
`resolveExactOutcome(attempt, outcomes)` in
`src/lifecycle/retrospective-eligibility.ts` returns an explicit result:
`exactly-one-valid` (with the outcome) | `none` | `conflict` | `malformed`.
The exact subject is workspace_id + occurrence_id + attempt_id + exact
bundle identity + `execution_attempt_record_id` anchor + committed ordinal
binding (EXE-010). Cardinality is exact: zero → none (terminal-unverifiable
/ receipt-ineligible); exactly one exact-bound → eligible; more than one
subject candidate → conflict (never first/latest/enumeration order, never
"at least one"); one subject candidate violating the anchor/ordinal
binding → malformed (a misanchored competing record never becomes "one
valid outcome").

**Consumers:** graph EXE-012 attempt-correlated receipt coverage
(`receipt-orphan` on none; `receipt-outcome-invalid` on conflict/malformed);
result-publication-correlation resolution (exact attempt anchor for the
publication context must resolve uniquely, then exactly one anchor-bound
outcome, then exact `result_association` vs `result_subject`;
`receipt-publication-invalid` on duplicate/misanchored/absent state);
`classifyRetrospectiveEligibility` now delegates to the resolver and gains
a `conflict` classification; EXE-008 obligation gates on the same resolver.

**Adversarial tests:** duplicate exact outcomes → `receipt-outcome-invalid`;
misanchored anchor (single and mixed with one valid) → fail closed; wrong
ordinal → fail closed; publication correlation with duplicate outcomes →
fail; publication correlation with misanchored outcome → fail; classifier
conflict state; zero/exactly-one vectors retained.

## SIR-WP15-P1A-002 — EXE-008 receipt-facts obligation — CLOSED

**Root cause:** the obligation counted receipts by
`receipt.attempt_id === attempt.attempt_id` alone, so an invalid contextual
receipt (whose own findings are entry-filtered) could suppress the
obligation.

**Correction:** pure semantic predicate `qualifyReceiptForAttempt(receipt,
attempt, outcomes)` — independent of finding emission and entry filtering.
A receipt qualifies only when: event type is a legitimate
attempt-correlated fact (attempt-start, attempt-end, enforcement-denial,
timeout, crash, attempt-level cancellation — `event_record_id` must be the
exact attempt record, so occurrence-level cancellation never qualifies);
`event_record_id` === the exact attempt record; workspace/occurrence/
attempt bindings exact; the attempt is exactly-one-valid outcome-covered;
the event/disposition pair is valid. A `result-publication-correlation`
receipt never satisfies the general attempt obligation. The graph obligation
uses `receipts.some((t) => qualifyReceiptForAttempt(t, r, outcomes))`.

**Adversarial tests (attempt as validation entry):** source-mismatched
receipt (same attempt_id, wrong source class) does not satisfy; impossible
event/disposition pair does not satisfy; non-attempt-correlated event type
does not satisfy; correlation-receipt-only does not suppress; valid
qualifying receipt satisfies; entry-filter isolation regression (invalid
contextual receipt never suppresses, and its own finding is not emitted);
conflicting/malformed outcome state never demands a receipt.

## SIR-WP15-P1A-003 — event/disposition semantics — CLOSED

**Root cause:** Phase 1A validated source class and bindings but not
event/disposition consistency; the enforcement-denial evidence rule and
source-state agreement were unpinned.

**Correction:** one authoritative `receiptEventDispositionOk(eventType,
disposition, event, outcome)` implementing the exact contract mapping with
source-state agreement: activation-decision requires the source decision
(accepted→`accepted`, denied→`denied`); occurrence-start/attempt-start →
`started`; attempt-end → exact one-to-one outcome disposition (all seven
values, no lossy conversion); enforcement-denial → `denied` with a
`rejected` outcome AND the committed enforcement-evidence group
(`projection_identity` + `evidence_fingerprint`; completed outcome or
missing/partial evidence fails); cancellation (occurrence-level and
attempt-level with `cancelled` outcome); timeout/crash → matching outcome
disposition; result-publication-correlation → `completed`. Outcome
disposition and event disposition stay distinct (`rejected` is never
mapped to `denied` for attempt-end). The graph emits the existing
receipt-event semantic finding family (`lifecycle.receipt-event-disposition`,
EXE-008; rule IDs stable).

**Invalid-pair tests:** occurrence-start+completed; attempt-start+crashed;
timeout+completed; crash+completed; activation accepted+denied; activation
denied+accepted; enforcement-denial+rejected receipt disposition;
enforcement-denial+denied+completed outcome; enforcement-denial+denied+
rejected outcome missing evidence; correlation+non-completed; attempt-end
lossy mapping rejected→denied; plus the enforcement-evidence 4+1 matrix and
the 7-value one-to-one attempt-end accept/reject loop.

## Exact files changed by the correction

- `src/lifecycle/retrospective-eligibility.ts` — rewritten: shared exact
  outcome resolver, delegation-based classifier (+`conflict`), canonical
  attempt-correlated event set, event/disposition validator, qualifying-
  receipt predicate.
- `src/lifecycle/graph.ts` — receipts loop + attempt obligation consume the
  shared primitives; disposition finding; `receipt-outcome-invalid`
  finding; correlation path uses the exact attempt anchor + resolver.
- `tests/unit/wp15-phase1a-receipt-lifecycle.test.ts` — matrix per-type
  outcomes; +12 adversarial tests (27 total).
- `fixtures/lifecycle/valid/receipt-dup-1.json` →
  `fixtures/lifecycle/invalid/receipt-dup-1.json` + manifest entry
  LFC-V-62C64CBB → LFC-I-D79D7043 (conflicting outcome state is
  receipt-ineligible under exact resolution); `src/generated/*` regenerated.
- `docs/design/semantic-validation-rules.md` — EXE-008/EXE-012 text already
  corrected in Phase 1A; no further change required by this gate.

## Focused tests/typechecks (correction gate)

Phase 1A suites 34/34; wp13-durability-s1/s3 + w4-f1 83/83; core +
integration conformance + effective-authority + corrections + second-focus
207/207 (manifest 636/636); pointofuse-v2/trusted/security 816/817 (the
single pre-existing baseline boundary-v2 exports-pin failure, unrelated);
full unit 723/725 (the two recorded superseded WP-13D E2E failures only);
`tsc` main + tests clean; `git diff --check` clean.

## Authority-boundary confirmation

No new authority domain; no `trusted-receipt-producer`; no correlation
producer; WP-13C publication authority untouched; outcome producer
authority model untouched; package exports/dependencies/release
scripts/F-R1 untouched; schema unchanged by this gate (A1 schema proven
sufficient).

## Remaining known limitations

Unchanged from Phase 1A: receipt issuance and correlation producer not
implemented (later phases); pre-existing baseline failures (2 superseded
WP-13D E2E; 1 pointofuse exports pin) recorded for the closure gate.

## Git state / envelope

HEAD `4c2d5b21a8b91818f4c7efa834bbd920baae6d3a` unchanged; branch main;
nothing staged; no commit; WP-13D debris byte-untouched; no external
release action. Envelope exception: NONE.

---

# Second Focused Correction — residual SIR-WP15-P1A-001…002

**Gate:** narrow A1 correction only; no Phase 1B, receipt issuance,
correlation producer, authority, schema, event/disposition, publication, or
outcome-producer change. SIR-WP15-P1A-003 remains **CLOSED** unchanged.

## SIR-WP15-P1A-001 — claimant cardinality before exact validity — CLOSED

**Residual root cause:** `resolveExactOutcome` selected candidates only after
an exact bundle comparison. A schema-valid record could cite the same attempt
subject or exact attempt-record anchor while carrying a divergent bundle and
disappear before cardinality analysis.

**Correction:** resolution is now two-stage in the one shared primitive:

1. The claimant set includes every `ExecutionOutcomeRecord` that either
   carries the exact workspace/occurrence/attempt tuple **or** cites the
   exact target `execution_attempt_record_id`. Bundle and ordinal are not
   filters at this stage.
2. Zero claimants returns `none`; one claimant must match every exact binding
   (workspace, occurrence, attempt, bundle/reference, anchor, ordinal) or
   returns `malformed`; more than one claimant returns `conflict` regardless
   of which claimant is exact or divergent.

An unrelated outcome that carries neither the tuple nor anchor remains
outside the claimant set. Thus a lone bundle-divergent claimant is malformed;
an exact outcome plus a bundle-divergent claimant is conflict; no first,
latest, or enumeration-order winner exists. The classifier, EXE-012 receipt
validation, and result-publication-correlation all inherit the correction
through the shared resolver.

## SIR-WP15-P1A-002 — dependent qualifying receipt — CLOSED

`qualifyReceiptForAttempt` already had the required pure, entry-independent
shape. Its residual false qualification was inherited solely from the
resolver. With an exact outcome plus a bundle-divergent claimant, resolution
is now conflict, the predicate returns false, the attempt carries no false
retrospective-complete receipt obligation, and the receipt entry emits the
existing fail-closed outcome-invalid finding.

## Second-correction files and verification

- `src/lifecycle/retrospective-eligibility.ts` — claimant-set selection now
  precedes full exact-binding validation.
- `tests/unit/wp15-phase1a-receipt-lifecycle.test.ts` — schema-valid
  bundle-divergent singleton/mixed/two-claimant cases; anchor/tuple symmetry;
  unrelated outcome; EXE-012, classifier, publication-correlation, and
  attempt-entry qualification regressions.
- `tests/unit/wp13-durability-s1.test.ts` — an anchor-linked tuple-divergent
  outcome is correctly conflict-equivalent rather than terminal-unverifiable.
- `docs/reports/wp-15-phase-1a-implementation-report.md` — this correction
  record.

Focused verification: TypeScript main/tests clean; WP-15 Phase 1A focused
suites 37/37; WP-13 durability S1 14/14; WP-13 durability S3 51/51. No
conformance rerun was needed because fixtures/schema/generated corpus were
unchanged. `git diff --check` is clean. HEAD remains the stated baseline;
nothing staged; WP-13D debris remains untouched; envelope exception NONE.

## Final focused rereview / baseline handoff

**Final focused rereview verdict:** **WP-15 PHASE 1A FINAL FOCUSED REREVIEW
ACCEPTED — READY FOR PHASE 1A BASELINE COMMIT.**

- SIR-WP15-P1A-001: **CLOSED** — claimant-first exact resolver accepted.
- SIR-WP15-P1A-002: **CLOSED** — semantic qualification inherits the exact
  resolver and remains entry-filter independent.
- SIR-WP15-P1A-003: **CLOSED** — unchanged after its accepted correction.
- New findings: **NONE**. Envelope exception: **NONE**.
- WP-15 Phase 1A implementation: **ACCEPTED**. Phase 1B is **NOT STARTED**
  at the instant before the local baseline commit.

The authority boundary remains unchanged: no trusted-receipt producer,
receipt-publication-correlation producer, generic lifecycle writer, new
outcome authority, prospective authority, or external release action.
