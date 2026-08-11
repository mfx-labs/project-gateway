# WP-13 Durability S4 — Shared Retrospective Derivation Implementation Report

**Work package:** WP-13 durability S4 (retrospective simplification amendment
§8; closure durability decision §12/§16).
**Status:** implementation complete; unstaged/uncommitted for focused senior
review.
**Baseline:** HEAD `14c3c81e9b071d0f5d65df26d57db65771ae783e` (branch `main`;
`docs: simplify WP-13 retrospective derivation contract`), unchanged. Nothing
staged/committed; no push/tag/release/deploy.
**Authorization:** S4 APPROVED (human). S1/S2/S3 and the retrospective
simplification amendment are CLOSED. S5 remains a later synchronization step
if residual documentation remains.

## 1. Exact changed paths

New (nothing modified, nothing staged, nothing committed):

- `src/retrospective-derivation/types.ts` — S4 type vocabulary
  (21-field semantic object, closed failure taxonomy, read boundary,
  resolver input, validated durable semantic state).
- `src/retrospective-derivation/facts.ts` — the ONE shared pure derivation
  primitive.
- `src/retrospective-derivation/resolver.ts` — the thin durable-state
  resolver + the cold-restart entry.
- `src/retrospective-derivation/index.ts` — barrel (primitive + resolver +
  closed vocabulary only).
- `tests/unit/wp13-durability-s4-retrospective-derivation.test.ts` —
  focused derivation tests (29).
- `tests/unit/wp13-durability-s4-static-guard.test.ts` — static purity
  guards (3).
- `docs/reports/wp-13-durability-s4-retrospective-derivation-implementation-report.md`
  — this report.

No source/test/schema/generated/committed file was modified; the superseded
untracked WP-13D paths (`src/retrospective/**`, `tests/unit/wp13d-*.test.ts`,
`docs/reports/wp-13d-*.md`) are untouched.

## 2. Authoritative shared primitive / module

`deriveExecutionRetrospectiveFacts(state)` in
`src/retrospective-derivation/facts.ts` is the ONE authoritative pure
derivation primitive: synchronous, read-only, deterministic, frozen-output.
WP-13 (S4) consumes it now; WP-15 later reuses the SAME implementation — a
second independent transformation engine is FORBIDDEN (amendment §3/§7) and
does not exist anywhere in this family. The resolver imports the primitive
and contains zero 21-field derivation logic (single derivation owner;
enforced by static guard).

## 3. Durable-state resolver boundary

`resolveRetrospectiveDurableState` (thin, read-only) plus the composed
cold-restart entry `deriveRetrospectiveFactsFromStore({ records,
attemptRecordId })`. The resolver ONLY:

1. reads and validates trusted durable records through the narrow
   read-only boundary (`readLifecyclePayload` / `enumerateLifecycleRecords`;
   the WP-8-backed `ControlPlaneStoreBoundary` satisfies it structurally);
2. establishes exact correlations/cardinality by content (workspace + exact
   bundle + occurrence + attempt) — never by enumeration order, newest
   timestamp, record id, or lexical ordering; any unreadable/corrupt entry
   inside a read class fails closed and is never skipped (WP-13C
   precondition pattern);
3. assembles the validated durable semantic state;
4. invokes the SAME shared primitive.

## 4. Exact 21-field mapping (§12)

Implemented exactly per the committed §12 durable-source mapping; every
grouping/absence rule preserved (all 21 keys always present; `null` for
unavailable scalars/references; `[]` for empty collections; no `undefined`;
no alternate sentinel):

| # | Field | Durable source |
|---|---|---|
| 1 | `workspace_id` | `ExecutionAttemptRecord.workspace_id` |
| 2 | `bundle` | `ExecutionAttemptRecord.bundle` (exact ref; copied/frozen) |
| 3 | `occurrence_id` | `ExecutionAttemptRecord.occurrence_id` |
| 4 | `attempt_id` | `ExecutionAttemptRecord.attempt_id` |
| 5 | `attempt_ordinal` | `ExecutionAttemptRecord.ordinal` |
| 6 | `activation_record_id` | `ExecutionAttemptRecord.activation_record_id` |
| 7 | `runtime_grant_id` | `ExecutionAttemptRecord.runtime_grant_id` |
| 8 | `execution_attempt_record_id` | `ExecutionAttemptRecord.record_id` |
| 9 | `occurrence_record_id` | exactly-one correlated `ExecutionOccurrenceRecord.record_id` |
| 10 | `previous_attempt_id` | exactly-one ordinal−1 attempt of the same occurrence/workspace/bundle; `null` iff ordinal 1 |
| 11 | `disposition` | `ExecutionOutcomeRecord.disposition` |
| 12–15 | result group | `ExecutionOutcomeRecord.result_association` quartet (all-`null` or all-non-`null`), cross-verified against the exact passing `ValidationRecord` (subject kind `ExecutionResult`, exact instance/digest/workspace) |
| 16 | `result_publication_record_id` | at-most-one attempt-scoped `ResultPublicationRecord.record_id`; `null` when unpublished |
| 17 | `publication_scopes` | same publication; `[]` when unpublished |
| 18 | `observation_references` | exactly one committed `external-evidence` reference from `ExecutionOutcomeRecord.observation_evidence` |
| 19–20 | enforcement pair | `ExecutionOutcomeRecord.enforcement_evidence` (both-`null` or both-non-`null`) |
| 21 | `orchestration_evidence_identity` | `ExecutionAttemptRecord.record_id` (the anchor) |

Publication consistency (EXE-013): the attempt-scoped publication must
exact-match the outcome result association (mode, ValidationRecord id,
result subject instance/digest/workspace); a publication can never create
result facts absent from the outcome association.

## 5. Terminal-unverifiable behavior

Zero correlated `ExecutionOutcomeRecord` for the exact attempt →
`RETROSPECTIVE-NO-FACTS` / `terminal-unverifiable` (EXE-012): a VALID
lifecycle state, typed distinctly from corruption. NO fact-set is emitted,
no disposition is guessed, no observation/result/publication is fabricated,
the attempt is receipt-ineligible (receipt semantics remain WP-15-owned).

## 6. Terminal-unpublished behavior

Valid outcome (with result association when applicable) and no
`ResultPublicationRecord` → fields 12–15 retained, `result_publication_record_id
= null`, `publication_scopes = []`. No automatic publication/completion
rerun, no scheduler/resume (ADR-039 §9; SCR-WP13-DURABILITY-007).

## 7. Corrupt/ambiguous-state failures

All typed `RETROSPECTIVE-STATE-CORRUPT` (ambiguity/corruption) or
`RETROSPECTIVE-CORRELATION-MISMATCH` (exact-match divergence), fail closed:

- missing/duplicate occurrence; missing/duplicate previous attempt;
  multiple outcome records; corrupt class entries (never skipped);
  outcome not bound to the exact anchor attempt record; outcome ordinal
  mismatch; missing/non-passing/mismatched ValidationRecord; publication
  without outcome association; EXE-013 publication divergence; multiple
  attempt-scoped publications; partial enforcement pair; partial result
  quartet; malformed input; malformed/corrupt payload shapes.
- Cross-workspace/bundle/occurrence/attempt records are simply NOT
  correlated (content-exact lookup) — an uncorrelated outcome leaves the
  attempt `terminal-unverifiable`; nothing is ever selected as a winner.

## 8. Cold-restart evidence

One focused E2E (`cold restart: a fresh store handle reconstructs the exact
same 21-field object from durable records only`): real S3
`produceExecutionOutcome` (published) + real WP-13C `publishValidatedResult`
(published) over a real WP-8 store, then derivation through (a) the live
boundary and (b) a fresh store boundary over the SAME durable root
(fresh-process equivalent) — `deepStrictEqual` across the restart. No
process-local `ExecutionAttemptOutcome`, no live `PiExecutionObservation`,
no `ValidatedResultHandoff`, no in-memory cache, no project-visible
`ExecutionResult` bytes, no receipt.

## 9. Semantic-equality evidence

- Golden-object table (7 valid rows: ordinal-1 minimal; retry with exact
  previous; associated-unpublished; published; enforcement absent;
  enforcement present; ordinal-1 unaffected by a later retry) — each
  asserted `deepStrictEqual` against an independently constructed 21-field
  golden object, plus the fixed 21-key vocabulary + no-`undefined`
  discipline;
- repeated derivation of the same state (every row);
- same durable semantic state seeded in different enumeration orders →
  structurally equal facts;
- fresh-process cold derivation (E2E).

## 10. No fact-set JCS/hash/byte-identity machinery

Confirmed: no `jcsSerialize`, no `node:crypto`/`createHash`, no digest
imports, no `PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1`, no byte comparison in
the family (static-guard enforced). JCS/NFC/hash disciplines protecting the
underlying durable records/evidence remain untouched in their owning
modules.

## 11. WP-15 has no second engine

WP-15 later reuses the SAME `deriveExecutionRetrospectiveFacts` primitive
(exported from `src/retrospective-derivation`). Receipt eligibility, trust
checks, event/disposition mapping, and receipt issuance authority remain
WP-15-owned (amendment §7); this family issues/decides nothing.

## 12. Focused test totals

- `wp13-durability-s4-retrospective-derivation.test.js`: **31/31 pass**
  (7 valid golden rows incl. repeated derivation; 2 terminal states; 16
  fail-closed vectors; 1 enumeration-order semantic equality; 1 cold
  restart E2E; 1 input-hygiene; 1 malformed-input/attempt-missing; 2
  SIR-WP13-DUR-S4-001 ownership regressions added by the §17 correction).
- `wp13-durability-s4-static-guard.test.js`: **3/3 pass**.
- No S1/S2/S3, Pi, drafting, writing, reader/FFF, or conformance suites were
  rerun: S4 adds new files only and changes NO shared dependency (no
  committed file modified), so no existing suite can be affected.

## 13. Typecheck / diff check

- `npm run typecheck` (src): pass.
- `tsc -p tsconfig.tests.json` (tests): pass.
- `git diff --check`: clean (no whitespace errors).

## 14. S1/S2/S3 no-drift

No schema class, lifecycle record type, authority/capability domain, write
path, or rule inventory was added or modified; S3 outcome production,
Model-1 locking, replay/cardinality, observation canonical digest, the
WP-13C publication precondition, and ADR-012 supersession behavior are
untouched (the S3-produced durable outcome record is consumed as trusted
input, exactly as §12 prescribes).

## 15. Superseded WP-13D isolation

`src/retrospective/**`, `tests/unit/wp13d-*.test.ts`, and
`docs/reports/wp-13d-*.md` remain untracked/untouched. The S4 family never
imports them (static-guard enforced) and carries none of their canonical
serializer/hash-identity/byte-equality/dual-engine machinery.

## 16. Final Git state

Working tree: 7 new untracked paths (4 source files, 2 test files, this
report); no tracked file modified; nothing staged; HEAD unchanged at
`14c3c81e9b071d0f5d65df26d57db65771ae783e`. No push/tag/release/deploy.

---

## 17. Focused correction — SIR-WP13-DUR-S4-001 (MODERATE): stable immutable fact-set ownership

**Senior review:** `WP-13 DURABILITY S4 FOCUSED SENIOR REVIEW CORRECTIONS
REQUIRED` — correct ONLY `SIR-WP13-DUR-S4-001`; SIR-002/SIR-003 retained as
accepted non-blocking MINOR notes.

### Previous defect

`deriveExecutionRetrospectiveFacts(...)` emitted
`bundle: Object.freeze({ ...bundle })`: a SHALLOW copy. The nested
`target_kind` and `target_workspace_binding` objects remained shared
references to the caller's input, so post-derivation mutation of caller-owned
input objects could mutate an already-derived fact-set.

### Ownership/copy/freeze correction (`src/retrospective-derivation/facts.ts`)

Replaced the shallow copy with `freezeOwnedBundle(...)`: an explicit,
bounded, per-committed-shape copy of the exact `ExecutionBundle` reference
(six scalar members + the two nested objects). Each nested object
(`target_kind`, `target_workspace_binding`) is individually copied
(`{ ...obj }`) and frozen; the bundle itself is frozen. Bounded to this ONE
committed shape — no generic deep-clone framework, no serialization
round-trip, no JCS, no hashing, no persistence subsystem. Caller input is
never mutated. The primitive's documented promise ("the returned object and
every nested member is frozen and owned") now holds for the nested bundle
members.

### Proof: caller mutation cannot alter derived facts

New regression `input mutation isolation ... (SIR-WP13-DUR-S4-001)`: derive
facts from a validated state whose input bundle is a caller-owned MUTABLE
copy; after derivation, mutate the input's nested `target_kind` (id),
nested `target_workspace_binding` (workspace_id), and `target_digest`; the
previously derived fact-set still deep-equals the golden 21-field object and
retains the original nested values.

### Proof: nested returned bundle satisfies the immutability contract

New regression `output immutability ... (SIR-WP13-DUR-S4-001)`: in strict
 mode, assignment to the returned nested `target_kind`, nested
`target_workspace_binding`, the bundle's own `target_digest`, the fact-set's
own `workspace_id`, the observation reference entry, and the
`publication_scopes` array all throw `TypeError`; values remain unchanged
(golden deep-equal).

### Semantic-equality preservation

No value semantics changed: every existing golden row, the repeated-
derivation assertions, the enumeration-order equality test, and the cold-
restart E2E still pass unchanged (34/34 focused tests). No byte/JCS/hash
comparison anywhere.

### Focused test totals (post-correction)

- `wp13-durability-s4-retrospective-derivation.test.js`: **31/31 pass**
  (29 prior + 2 new SIR-001 regressions).
- `wp13-durability-s4-static-guard.test.js`: **3/3 pass**.
- `npm run typecheck` (src): pass; `tsc -p tsconfig.tests.json`: pass;
  `git diff --check`: clean.

### Unchanged (preserved S4 areas)

Resolver responsibilities, durable-state read/correlation logic, the 21-field
§12 source mapping, cardinality handling, terminal-unverifiable/
terminal-unpublished behavior, ValidationRecord checks, EXE-013 publication
consistency, cold-restart architecture, the WP-15 reuse surface, the
static-guard policy, and the failure taxonomy are all unchanged. No second
derivation engine.

### Accepted non-blocking review notes

- **SIR-WP13-DUR-S4-002 — MINOR (accepted, non-blocking):** class-valid but
  content-corrupt entries may fail correlation rather than being classified
  independently as corrupt. NOT broadened here: supported write paths already
  prevent such records, and the behavior is consistent with the committed
  WP-13C precondition pattern.
- **SIR-WP13-DUR-S4-003 — MINOR (accepted, non-blocking):**
  `RETROSPECTIVE-INTERNAL-FAILURE` is declared but hostile-proxy exceptions
  may escape without mapping. NO generic try/catch added: the hostile-object
  case is unreachable in the supported durable-read path.

### S1/S2/S3 no-drift / WP-13D untouched

No S1–S3 module, schema, rule, or committed file was modified. The superseded
untracked WP-13D paths remain untouched. The correction touches only the new
S4 files (`facts.ts`, the S4 test file, and this report).

### Final Git state

Working tree: 7 new untracked paths; no tracked file modified; nothing
staged or committed; HEAD unchanged at
`14c3c81e9b071d0f5d65df26d57db65771ae783e`. No push/tag/release/deploy.

---

## 18. Final status and review disposition (S4 baseline commit gate)

- **S4 implementation:** complete.
- **Initial senior review:** `WP-13 DURABILITY S4 FOCUSED SENIOR REVIEW
  CORRECTIONS REQUIRED` — one MODERATE finding, corrected (§17).
- **SIR-WP13-DUR-S4-001 (MODERATE):** CLOSED — bounded owned frozen copy
  of the bundle nested members (`freezeOwnedBundle`); caller-mutation
  isolation and returned-object immutability proven by two regression
  tests and independently re-verified.
- **Focused rereview:** `WP-13 DURABILITY S4 FOCUSED REREVIEW ACCEPTED —
  READY FOR S4 BASELINE COMMIT` — zero blocking findings.
- **SIR-WP13-DUR-S4-002 (MINOR):** accepted non-blocking note — retained
  for WP-13 closure consideration; not fixed at this gate.
- **SIR-WP13-DUR-S4-003 (MINOR):** accepted non-blocking note — retained
  for WP-13 closure consideration; not fixed at this gate.
- **Blocking findings:** zero.
- **WP-13 overall status:** NOT CLOSED (S1/S2/S3 CLOSED; S4 CLOSED at
  this baseline; closure review still pending).
- **WP-14 / WP-15:** still blocked.

Committed as the S4 baseline (parent `14c3c81e9b071d0f5d65df26d57db65771ae783e`)
with the exact accepted S4 delta: `src/retrospective-derivation/` (4
files), the two S4 test files, and this report. No push/tag/release/deploy.
