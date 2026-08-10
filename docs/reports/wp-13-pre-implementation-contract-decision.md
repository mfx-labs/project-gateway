# WP-13 — Pre-Implementation Contract Decision

**Work package:** WP-13 — End-to-end Pi execution integration.
**Phase:** contract decision only (no implementation authorized by this
document; no source/test/schema/fixture/package/runtime change made).
**Status:** the three WP-13-owned pre-implementation contract decisions
identified by the post-WP-5B roadmap eligibility analysis are resolved by
this document and by ADR-038, and the focused contract corrections
SCR-WP13-001…006 are applied and CLOSED (§9). Contract baseline
established (corrected) and **COMMITTED** (baseline commit subject
`docs: establish WP-13 implementation contract baseline`; parent
`1067d5c6f9161b3d04443b0bdc73c5c80eda9253`). WP-13
implementation remains NOT STARTED and NOT AUTHORIZED: a subsequent explicit
human implementation authorization is required. WP-14 and WP-15 remain
blocked behind WP-13. Current gate: **WP-13 FINAL CONTRACT SPOT CHECK
ACCEPTED — READY FOR CONTRACT BASELINE COMMIT** — recorded; the
baseline is now committed — **WP-13 CONTRACT BASELINE COMMITTED — READY
FOR HUMAN IMPLEMENTATION AUTHORIZATION** (implementation authorization
is not claimed by this document).
**Amendment note (2026-08-11):** subsequent to this baseline, WP-13A/B/C/D
were implemented and reviewed, and this contract received the WP-13
closure durability amendment during implementation/closure (ADR-039;
`docs/reports/wp-13-closure-durability-architecture-decision.md`,
including the SCR-WP13-DURABILITY-001…012 corrections and the final
execution-eligibility/observation-reference consistency fix). §5.1/§5.2/
§5.3/§5.6 and §6/§7 reflect the amended model; the historical baseline
statements above are preserved. The amended contract has passed the
WP-13 durability focused contract rereview (verdict: `WP-13 DURABILITY
FOCUSED CONTRACT REREVIEW ACCEPTED — READY FOR DURABILITY CONTRACT
BASELINE COMMIT`; zero new findings); no additional protocol change.
**Amendment note (2026-08-11, retrospective simplification):** the WP-13
retrospective assurance model is amended at contract level
(`docs/reports/wp-13-retrospective-simplification-amendment.md`): the
separate WP-13/WP-15 derivation engines, the cross-engine byte-identical
comparison, and the canonical-byte retrospective fact-set identity
(`PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1`) are retired as normative
requirements; ONE shared pure derivation primitive
(`deriveExecutionRetrospectiveFacts(durableState)`, implemented by S4 and
reused by WP-15) replaces them, with structural semantic equality as the
determinism/cold-restart proof target. §5.2/§5.3/§5.4/§5.6 reflect the
amended model; historical baseline text is preserved.
**Baseline:** HEAD `1067d5c6f9161b3d04443b0bdc73c5c80eda9253` (branch
`main`; `feat: complete WP-5B Pi enforcement integration`); working tree
clean at baseline; this phase adds documentation only.
**Eligibility basis:** WP-13 is the earliest remaining roadmap-ordered
package (ADR-023 Option C; execution order WP-6…WP-12 → WP-5B → WP-13 →
WP-14 → WP-15). Normative prerequisites are all CLOSED: WP-5B
(`1067d5c`), WP-12 (`164b8a0`), WP-11 (`9695c5d`), WP-7 (`6b94d81`).
WP-14 and WP-15 are not eligible (WP-13 not closed).

## 1. Fixed WP-13 scope (accepted roadmap — not reopened)

`docs/design/post-wp5a-roadmap.md` (table row 9; attribute block): WP-13
owns orchestrated Pi execution consuming plan + enforcement + observations,
with completion evaluation producing `ExecutionResult` (retrospective), and
emission of retrospective facts for trusted-receipt inputs (WP-15). Owned:
end-to-end execution, result collection. Prohibited: issuing `TrustedReceipt`
(WP-15 owns), self-approval. Invariants: result/receipt separation;
observation never proves authorization. Non-goals: no receipt issuance, no
authority creation. Closure gate: "End-to-end execution with enforcement and
retrospective results."

Preserved stage separation (ADR-002, ADR-011, ADR-012): validation ≠
approval ≠ issuance ≠ grant ≠ activation ≠ execution ≠ result publication ≠
receipt. WP-12 does NOT produce `ResultPublicationRecord`; WP-13 does NOT
issue receipts, activate pi-guard, or recompute authority.

## 2. Inherited normative contract (referenced, not restated)

- ADR-006 — `ExecutionBundle` composition boundary (one exact TaskSpec /
  AuthorityPolicy / ContextManifest / CompletionContract revision).
- ADR-011 — record taxonomy; per-occurrence grant; one activation decision
  per reserved occurrence; ordered attempts; retry is not new activation.
- ADR-012 — `ExecutionResult` result lifecycle: candidate vs
  evaluator-produced content; originate/adopt; one unique result instance
  per attempt; `ResultPublicationRecord` prerequisites and bindings;
  consumption scope table; result/receipt separation.
- ADR-020, ADR-022 — Pi adapter boundary and observation model
  (`PiExecutionObservation`: session/turn correlation, occurrence/attempt
  from the plan, completion status vocabulary).
- ADR-027 — enforcement-evidence semantics (WP-5B).
- ADR-038 — result-publication authority domain (new; this phase).
- `docs/design/trusted-lifecycle-protocol.md` — reserved occurrence
  identity; grant/activation/occurrence/attempt/retry protocol; occurrence
  and attempt cardinality; results and retry grouping; provenance,
  publication, and consumption rules.
- Semantic rules EXE-005 (ordered retry/allowance), EXE-006 (retry subject
  stability), EXE-007 (point-of-use revalidation), EXE-008 (attempt receipt
  facts; no fabricated result), EXE-009 (denied reservation has no result).
- WP-12 handoffs: `wp-12-pre-implementation-contract-decision.md` §1 (WP-12
  does not produce `ExecutionResult`), §27.3 S4-D3 (ordinal semantics), §27.4
  S4-D4 (allowance consumption); `wp-12-slice-4-implementation-report.md` §6
  (WP-13 boundary: execution, bundle-content acquisition, retry decisions,
  `ExecutionResult`, execution-time revalidation); `src/control-plane/subject.ts`
  ("WP-13 owns attempt ordinal").
- WP-5B closure (`wp-5b-pi-enforcement-implementation-report.md`):
  `PiEnforcementEvidence` path; activation correlation via
  `GuardActivationDecision` (accepted / grantCurrent / occurrence / attempt);
  restart requires a fresh activation decision and projection — stored
  evidence never reactivates enforcement.
- Committed schemas: `execution-result-body.json` (disposition vocabulary:
  `completed`/`incomplete`/`failed`/`cancelled`/`timed-out`/`crashed`/
  `rejected`; evidence references),
  `result-publication-record.json` (role `trusted-result-publisher`;
  bindings; `publication_scopes`; `receipt_correlations`),
  `execution-attempt-record.json` (role `trusted-execution-recorder`;
  ordinal 1…64), `trusted-receipt.json` (role `trusted-receipt-producer`;
  event/disposition vocabulary — WP-15-side),
  `schemas/lifecycle/1.0/common/components.json` (`publicationScope` enum;
  `evaluatorProvenance`).
- Identity conventions: domain-prefixed SHA-256 digests over JCS-canonical
  bytes (`domainDigest('<DOMAIN>\0', canonical)`), NFC strings, accepted
  host timestamp with `timestampSource` (F-02/F-R2). The accepted-host-
  timestamp convention does NOT apply to `ExecutionRetrospectiveFacts`
  (SCR-WP13-001; §5.2/§5.3 — the fact-set contains no synthesized
  timestamp).

## 3. Decision 1 — Completion evaluator and ExecutionResult publication path

### 3.1 Completion evaluation

WP-13 owns the completion evaluator (host-side; the first compatible
completion evaluator for an attempt, per ADR-012). It is a deterministic,
pure evaluation over committed inputs only: the validated `PiInvocationPlan`
(WP-5A), execution observations (`PiExecutionObservation`, WP-5A/ADR-022),
enforcement evidence (`PiEnforcementEvidence`, WP-5B/ADR-027), the WP-12
orchestration evidence and durable `ExecutionAttemptRecord`, the validated
`CompletionContract`, and the WP-4 validation machinery. The evaluator
never fabricates an observation, never reinterprets authority operands, and
never recomputes the authority intersection (WP-5B owns enforcement;
Artifact Core owns evaluation).

**ValidationRecord path (SCR-WP13-002):** completion evaluation (1) runs
the committed WP-4 validation machinery for the candidate/originated
result; (2) supplies the accepted validation result through the existing
WP-12 **`recordValidation`** control-plane operation (the committed
operation that records an ACCEPTED WP-4 validation run as a durable
`ValidationRecord`, role `trusted-validator`); and (3) consumes the
resulting durable `ValidationRecord` identity for `ResultPublicationRecord`
(§3.3/§3.7). WP-12 remains the trusted producer/recorder of
`ValidationRecord`; the WP-12 eight-class allowlist is unchanged (the
`validation-record` class is already inside it); the result-publication
authority produces ONLY `ResultPublicationRecord`; WP-13 gains no generic
validation-record authority — it supplies the accepted validation result
through the existing operation and never records, mints, or persists a
validation record itself.

### 3.2 Originating or adopting the one compatible ExecutionResult instance

Per ADR-012 and the lifecycle protocol: after structural and semantic
validation (path per §3.1), the evaluator either **originates** one new
immutable result
instance for the exact attempt, or **adopts** one exact validated candidate
revision, atomically establishing the unique evaluator-produced instance
without changing its digest-covered content. Exactly one result instance
per exact workspace/bundle/occurrence/attempt; a second distinct instance
for one attempt fails closed (EXE-009 for denied reservations; no result
instance is ever associated with a denied activation). An attempt may have
no evaluator-produced result when evaluation evidence is unavailable — the
protocol does not fabricate one (EXE-008). Corrections are later revisions
of the same instance (supersession/revocation production is later-owned,
not WP-13).

### 3.3 ResultPublicationRecord production — trusted authority domain

The trusted authority domain that may produce the `ResultPublicationRecord`
is the **result-publication authority**, role `trusted-result-publisher`
(schema-committed `responsible_role`), established by **ADR-038**:
host-side, single trusted owner (WP-13 host execution composition),
branded result-publication action provenance
(`PGAP-EXECUTION-RESULT-PUBLICATION-PROVENANCE-v1`), trusted
result-publication request from the completion evaluator,
result-publication capability (module-private brand, generation-bound per
CAP-008…CAP-016, zero production producers outside the host composition),
and an exact-record publication permit (role `result-publication`). The
authority produces exactly one record class — `ResultPublicationRecord` —
and nothing else. It consumes the exact passing `ValidationRecord`
identity (produced through the WP-12 `recordValidation` path, §3.1) and
requires it before any publication (§3.7).

**Publication replay (SCR-WP13-003):** the authority's boundary performs
read/verify-before-publish: (1) the first exact publication publishes
normally through `publishRecord`; (2) a replay of the exact same
publication — same publication identity, content, bindings, scopes, and
registry context — is recognized against the already-valid durable record
and is idempotent: no second `ResultPublicationRecord` is created, and the
existing exact record is the outcome; (3) any differing result instance,
revision/digest, evaluator provenance, validation-record id,
bundle/workspace/occurrence/attempt binding, registry context, or
publication scope is a **publication conflict and fails closed** before
any write. Replay idempotence belongs to the narrow result-publication
authority/boundary; WP-8 storage semantics are unchanged (no new storage
behavior, no allowlist or class-permission change, no write-path bypass).

**Publication concurrency and atomic uniqueness (SCR-WP13-005; lock
domain corrected by SCR-WP13-006):** the
uniqueness/idempotence operation is **one host-coordinated atomic
decision** using the existing trusted host-side coordination-lock pattern
— the same pattern the WP-12 control plane uses for its decision
operations (host-side coordination lock over a decision key plus the
`publishRecord` writer lock; WP-12 pre-implementation contract decision
§15):

1. the boundary acquires the host-side coordination lock for the **exact
   attempt-level uniqueness subject** — workspace, bundle, occurrence,
   and attempt (publication decision key). `result_instance` MUST NOT
   participate in the lock key: it is compared as proposed publication
   data UNDER that lock;
2. AFTER acquiring the lock, it MUST re-read and re-verify: current
   trusted lifecycle/registry context; **the publication/result-
   association state for the ENTIRE exact attempt** — the lookup MUST
   discover ANY existing evaluator-produced publication/result
   association for that attempt, regardless of its result-instance
   identity; evaluator provenance;
   `ValidationRecord` identity; result revision/digest;
   bundle/workspace/occurrence/attempt bindings; publication scopes;
3. under the lock:
   - no existing publication/result association for the attempt →
     publish exactly one
     `ResultPublicationRecord` through WP-8 `publishRecord`;
   - exact existing publication with the SAME result instance and all
     identical content/bindings/provenance/validation/scope/registry
     context → idempotent
     success using the existing durable record; no write;
   - existing publication/result association with a DIFFERENT result
     instance → typed publication conflict;
     fail closed; no write;
   - same result instance but any other material divergence (revision/
     digest, provenance, validation id, binding, scope, registry
     context) → typed publication conflict;
     fail closed; no write;
4. the attempt-level lock remains held through the uniqueness decision
   AND the `publishRecord` call/outcome, so a second concurrent publisher
   cannot observe the same pre-publication state and independently commit;
5. a second concurrent invocation MUST re-read after obtaining the same
   attempt-level lock and therefore observes either the exact durable
   publication (idempotent replay) or a conflicting durable publication
   (conflict);
6. no deterministic/content-derived lifecycle record ID is introduced —
   none is required by committed `ResultPublicationRecord` semantics;
7. WP-8 `publishRecord` semantics remain unchanged; atomic uniqueness
   belongs to the narrow result-publication authority boundary.

Different attempts use independent attempt-level coordination keys
(workspace/bundle/occurrence/attempt); no unnecessary serialization
across attempts.

### 3.4 Write authority / write primitive used

- **Trusted record:** the authority publishes through the **existing WP-8
  exact-record publication primitive `publishRecord`** (single-writer lock,
  durable record publication, mechanical authorized-write audit D-6, exact
  registry context binding), consumed through a dedicated boundary confined
  to the one `ResultPublicationRecord` class — the same pattern as the
  WP-12 control-plane store boundary (`src/control-plane/store-boundary.ts`),
  which remains untouched. No new storage machinery, no new lock protocol,
  no write-path bypass. Replay/conflict handling per §3.3 (SCR-WP13-003).
- **Project-visible artifact file:** the canonical result artifact file is
  written by the **WP-13 result-write executor**, an injected host write
  executor in the WP-11 pattern but a distinct, narrower contract with
  exact create-only semantics (SCR-WP13-003):
  - the destination is deterministic for the exact workspace + bundle +
    occurrence + attempt — it is NOT derived from the opaque result
    instance/revision identifiers (destination clarification,
    SIR-WP13B-005); the file content itself carries and binds the opaque
    result instance/revision — and containment-verified under the WP-6
    workspace root at point of use;
  - initial creation uses **exclusive create semantics**;
  - the executor never overwrites, replaces, truncates, or mutates an
    existing destination;
  - an existing destination with bytes/digest that conflict with the
    expected canonical result bytes fails closed with a typed
    **exclusive-create conflict**;
  - if the deterministic destination already exists with exactly the
    expected canonical bytes and digest, it may be reused ONLY through the
    existing ADR-012 **adoption semantics** — after exact read and
    validation proves it is the same compatible candidate revision with
    the exact canonical bytes/digest expected for the result. This is
    adoption/recovery (crash recovery between artifact creation and
    trusted publication), NOT a successful create replay;
  - byte equality alone never confers evaluator provenance — adoption
    still requires the §3.1 evaluation and the §3.3 trusted publication;
  - no directory creation; descriptor-verified service-user ownership;
    exact-byte canonical serialization; no lifecycle/store/audit/Git side
    effects. The file is untrusted project-visible content (ADR-012);
    provenance comes only from the trusted publication record.

### 3.5 Publication locus

Two bound artifacts: (a) the project-visible `ExecutionResult` artifact
file (untrusted content, exact canonical bytes and digest); (b) the
trusted-local `ResultPublicationRecord` (ADR-012: the sole protocol fact
that makes the result evaluator-produced and published). Both bind the
same unique result instance identity and revision digest; the record
binds the file only by exact artifact identity/digest, never by path.

### 3.6 Consumption-scope enforcement

WP-13 result publications carry **`ordinary-review` scope only**
(closed `publicationScope` vocabulary). `completion-status`,
`downstream-automation`, and `authoritative-reporting` scopes require
exact matching `TrustedReceipt` correlation, current non-revocation, and
compatible consumer support — WP-15-owned (F-08, EXE-008); WP-13 never
issues or correlates receipts for publication and never drives automation
or authoritative reporting from an unpublished or receipt-less result.
Publication confers no authority and never activates anything (ADR-012
consequences; roadmap-wide prohibited responsibilities).

### 3.7 Exact provenance/correlation requirements

The `ResultPublicationRecord` binds (schema-committed): the unique result
instance identity + exact protocol/kind version, revision ID, canonical
digest; evaluator provenance (`evaluator_id`, `capability_profile_id`);
association mode (`originated`/`adopted`); the passing result
`ValidationRecord` id (produced through the WP-12 `recordValidation` path,
§3.1 — the publisher requires the exact passing id before publication and
rejects any missing or differing validation id); exact `ExecutionBundle`
revision and digest; exact
workspace id; exact occurrence and attempt ids; publication scopes
(ordinary-review only); exact registry snapshot context. The publisher
re-verifies evaluator provenance, bindings, result-instance uniqueness,
and current trusted state at publication time and rejects any mismatch
(ADR-012 publisher-rejection rule); `receipt_correlations` remains empty
for WP-13 publications.

## 4. Decision 2 — Retry / attempt-ordering rule

WP-12 owns durable attempt recording (`recordExecutionAttempt`,
`ExecutionAttemptRecord`, role `trusted-execution-recorder`); WP-13 owns
the retry decision and the proposed ordinal (WP-12 slice-4 §6;
`src/control-plane/subject.ts`). This section pins the deterministic
WP-13 rule for proposing another execution attempt.

### 4.1 Definitions

- **Attempt:** begins only when an `ExecutionAttemptRecord` is created
  (protocol). Ordinal begins at 1 and increases by one without duplication
  for the occurrence (EXE-005; S4-D3).
- **Retry:** an attempt with ordinal > 1. A retry MUST retain the exact
  occurrence, bundle, workspace, and occurrence grant (EXE-006; bundle
  reference byte equality, exact workspace, exact occurrence, exact grant);
  it is not a new activation. Retry metadata never changes policy, context,
  task, completion, extension set, consumer compatibility, or workspace
  (protocol prohibited shortcut).

### 4.2 Terminal vs retryable outcomes

Deterministic classification of the previous attempt's outcome, derived
from observed execution facts (never fabricated), using the committed
`execution-result-body` disposition vocabulary:

| Disposition | Classification | Consequence |
|---|---|---|
| `completed` | TERMINAL — no retry | Proceed to completion evaluation and result production (Decision 1). |
| `rejected` | TERMINAL — no retry | Enforcement denial (WP-5B fail-closed path). Recovering requires a fresh activation decision and projection (new occurrence); never auto-retry. |
| `incomplete` | TERMINAL — no retry (ambiguous, fail closed) | No completion text, no error, no cancellation, no crash evidence. No retry proposal; operator decision or fresh activation required. |
| `failed` | RETRYABLE | Observed host tool errors; subject to §4.3 checks. |
| `cancelled` | RETRYABLE | Host cancellation during a started attempt. Cancellation before any attempt creates no attempt (protocol); a subsequent start is the first attempt (ordinal 1), not a retry. |
| `timed-out` | RETRYABLE | Subject to §4.3 checks. |
| `crashed` | RETRYABLE | Subject to §4.3 checks. |

A completion-evaluation failure is not an execution retry condition: a
`completed` attempt is terminal; an absent/invalid evaluation produces no
result and no fabricated one (EXE-008), and any further execution requires
a fresh activation decision (new occurrence).

### 4.3 When a retry may be proposed — all conditions must hold

1. **Durable previous attempt exists:** the immediately preceding attempt
   has a durable `ExecutionAttemptRecord` for the exact occurrence. Missing
   or conflicting record → no retry proposal (fail closed).
2. **Outcome retryable** per §4.2.
3. **Grant current:** the occurrence grant is not revoked, its validity
   window has not ended, and its explicit attempt allowance has remaining
   capacity (durable attempt count for the occurrence < allowance;
   EXE-005).
4. **EXE-006 subject stability:** exact bundle (byte equality), workspace,
   occurrence, and grant correlation of the first attempt are retained; any
   change → no retry, new activation required.
5. **EXE-007 point-of-use revalidation:** current registry, consumer
   support, revocation, validity, ceilings, policy, and grant state all
   rechecked and permitting at proposal time.
6. **Enforcement context current:** the occurrence's pi-guard projection/
   activation is still active. If enforcement would have to be reactivated
   (process/session restart), this is NOT a retry — restart requires a
   fresh activation decision and projection (WP-5B; F-03/F-06); stored
   evidence never reactivates enforcement.
7. **Ordinal valid:** proposed ordinal = durable attempt count for the
   occurrence + 1 (S4-D3; first ordinal 1; unique and gapless).

### 4.4 Attempt ordinal progression

Committed S4-D3 semantics (not restated as new): first ordinal = 1; every
new ordinal must equal the existing durable attempt count + 1; ordinals are
unique and gapless for the occurrence; the count is always derived from the
immutable durable `ExecutionAttemptRecord` set for the exact occurrence; no
created-at / record-ID / enumeration-order / newest-record winner rule ever
selects or breaks an ordinal sequence. The schema bound (ordinal 1…64) is
the hard ceiling; the grant allowance is the governing limit.

### 4.5 Allowance / ceiling consumption

Committed S4-D4 semantics: a durable attempt record consumes one allowance
unit; zero consumption without durability; abandoned/crashed started
attempts remain consumed; no counter state exists — the durable record set
is the only source. The retry proposal is permitted only while durable
attempts < allowance (and the schema ceiling is never the deciding factor
beyond it).

### 4.6 Stale or duplicate proposal handling

The proposal basis is always the current durable record set for the exact
occurrence, re-derived at proposal time. A duplicate ordinal, a stale
proposal (basis no longer current), a skipped ordinal, or any proposal not
exactly `count + 1` is rejected as `attempt-ordinal-conflict` by
`recordExecutionAttempt` (S4-D3); WP-13 never guesses, never re-proposes
from cached state, and never repairs a conflicting proposal.

### 4.7 Correlation to occurrence / previous attempt

Every retry proposal binds: the exact occurrence id, the occurrence grant
identity, the activation decision identity, the immediately preceding
attempt id (or the occurrence start, for the first attempt), and the
proposed ordinal. `recordExecutionAttempt` performs the EXE-006
correlation and registry-context checks; the retry executes under the same
occurrence, grant, bundle, and workspace — never a new reservation.

### 4.8 Fail-closed behavior when retry eligibility is ambiguous

Any of the following → NO retry proposal; the occurrence is left open for
operator decision or a fresh activation decision (new occurrence):
missing or conflicting durable attempt record; unknown/ambiguous outcome
classification (`incomplete`); grant state unknown or conflicting;
point-of-use state unavailable (EXE-007 fail closed); enforcement state
unknown or drifted; ordinal basis unverifiable. Retry eligibility is never
inferred, guessed, or defaulted to yes.

### 4.9 No scheduler

WP-13 introduces no execution scheduler, no timer, no queue, no background
loop, and no automatic re-execution. A retry proposal occurs only in
response to an explicit host execution request for the same occurrence.
Nothing in this rule auto-advances attempts, auto-retries after failures,
or schedules deferred executions.

## 5. Decision 3 — WP-13 → WP-15 retrospective facts

### 5.1 Status and ownership

TrustedReceipt issuance is WP-15-owned (F-08; decision matrix: WP-15
normative owner; WP-13 input provider). EXE-008 requires every started
attempt to have an attempt record, and — as amended by the WP-13 closure
durability amendment (ADR-039;
`docs/reports/wp-13-closure-durability-architecture-decision.md`) —
available trusted receipt facts are required only when the attempt reaches
a verified retrospective-complete state. A durably recorded attempt that
never reaches that state is explicitly `terminal-unverifiable`:
such attempts emit no `ExecutionRetrospectiveFacts`, are
receipt-ineligible, never receive fabricated disposition/evidence, and
have no inferred recovery. TrustedReceipt issuance remains WP-15-owned.
This decision defines the exact retrospective fact-set WP-13 emits; it
does not authorize receipt issuance, persistence of the fact-set, or any
WP-15 work.

### 5.2 Definition

**`ExecutionRetrospectiveFacts`** — a bounded, deterministic, read-only
host-side object emitted by WP-13 at execution completion (at most one
deterministic view per exact attempt). The view exists only when an exact
durable `ExecutionOutcomeRecord` exists and all other required durable
correlations validate; a `terminal-unverifiable` attempt has NO fact-set.
It is a **derived view** over committed records and
verified evidence: fact-set emission itself performs no new persistence, no new
record class, and no store mutation. (Durability of the fact-set's
process-local inputs — disposition, observation evidence reference,
validated-result association — is provided by the WP-13 closure
durability amendment: the `ExecutionOutcomeRecord` class of the
outcome-recorder authority; see
`docs/reports/wp-13-closure-durability-architecture-decision.md` and
ADR-039. Fact-set emission remains write-free.)
WP-15 later reuses the SAME shared pure derivation primitive over the
referenced committed records/evidence (no second derivation engine;
retrospective simplification amendment); identical durable semantic
state ⇒ structurally equal fact-set (semantic equality). Emission is not
an authority event and grants nothing.

**Determinism rule (SCR-WP13-001):** `ExecutionRetrospectiveFacts` is a
**pure deterministic derived view over already committed records and
evidence only**:

- WP-13 does NOT stamp the fact-set when emitting it; WP-15 does NOT
  stamp the fact-set when re-deriving it;
- the fact-set contains no newly synthesized/emission-time timestamp, no
  random identity, no operation-time state, and no `timestampSource`;
- no derivation-time entropy of any kind may enter the facts;
- temporal facts (attempt `created_at`, activation time, enforcement
  `observedAt`, record timestamps, …) remain obtainable from the exact
  referenced committed records/evidence — they are referenced, never
  replaced by a new fact-set timestamp;
- identical committed inputs MUST produce **structurally equal** facts
  (the 21 contract-defined fields equal per the semantic-equality
  contract of the retrospective simplification amendment) regardless of
  derivation time; canonical-byte serialization/hash equality of the
  fact-set itself is NOT required (the former
  `PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1` byte identity is retired as a
  normative retrospective requirement).

### 5.3 Fixed v1 shape — complete property vocabulary

One fixed v1 shape. **Absence-encoding rules (SCR-WP13-004):**

- all contract-defined top-level properties are always present;
- conditionally unavailable scalar/reference properties use JSON `null`;
- collection properties are always present and use `[]` when empty;
- keys are never conditionally omitted;
- no `undefined`; no alternate absence sentinel;
- partial presence inside a paired/grouped set is malformed and fails
  validation.

Complete fixed v1 top-level property vocabulary (every property always
present; implementation may later enforce `unevaluatedProperties: false`
over exactly this vocabulary — no schema implementation is authorized in
this phase):

| Property | Type / values | Presence rule |
|---|---|---|
| `workspace_id` | string (workspace id) | always present |
| `bundle` | exact `ExecutionBundle` reference object (kind/instance/revision/digest) | always present |
| `occurrence_id` | string (occurrence id) | always present |
| `attempt_id` | string (attempt id) | always present |
| `attempt_ordinal` | integer ≥ 1 | always present |
| `activation_record_id` | string (lifecycle record id) | always present |
| `runtime_grant_id` | string (lifecycle record id) | always present |
| `execution_attempt_record_id` | string (lifecycle record id) | always present |
| `occurrence_record_id` | string (lifecycle record id) | always present |
| `previous_attempt_id` | string or `null` | `null` for ordinal 1; the immediately preceding attempt id for retries |
| `disposition` | enum: `completed`/`incomplete`/`failed`/`cancelled`/`timed-out`/`crashed`/`rejected` (committed `execution-result-body` vocabulary) | always present; derived from observations, never fabricated |
| `result_instance_id` | string or `null` | `null` when no evaluator-produced result exists |
| `result_revision_digest` | string or `null` | `null` when no evaluator-produced result exists |
| `association_mode` | `originated`/`adopted` or `null` | `null` when no evaluator-produced result exists |
| `result_validation_record_id` | string or `null` | `null` when no evaluator-produced result exists (WP-12 `recordValidation` id, §3.1) |
| `result_publication_record_id` | string or `null` | `null` when no `ResultPublicationRecord` exists |
| `publication_scopes` | array of `publicationScope` | always present; `[]` when no publication; WP-13 publications are exactly `["ordinary-review"]` |
| `observation_references` | array of committed `external-evidence` references | exactly one reference for every emitted fact-set, sourced from `ExecutionOutcomeRecord.observation_evidence`; `evidence_id` = opaque `pgw:e:<32 lowercase hex>`; `content_digest` = canonical digest binding the verified `PiExecutionObservation`; committed media type (`application/json`) / observation role (`evaluation-evidence`); session/turn ids are correlation facts inside the digest-bound observation material, NOT evidence identities; `terminal-unverifiable` attempts emit no fact-set at all, so this row creates no "observation required for every started attempt" obligation |
| `enforcement_evidence_identity` | string or `null` | `null` when enforcement was never active for the attempt |
| `enforcement_evidence_fingerprint` | string or `null` | `null` when enforcement was never active for the attempt |
| `orchestration_evidence_identity` | string | always present (WP-12 orchestration evidence, required) |

**Grouped-field consistency (partial presence is malformed and fails
validation):**

- retry group: `previous_attempt_id` is `null` iff `attempt_ordinal` is 1;
  non-null (the immediately preceding attempt id) iff `attempt_ordinal` > 1.
- result group: `result_instance_id`, `result_revision_digest`,
  `association_mode`, and `result_validation_record_id` are all `null`
  together (no evaluator-produced result) or all non-null together (one
  unique evaluator-produced result instance).
- publication group: `result_publication_record_id` non-null requires the
  result group non-null AND `publication_scopes` non-empty;
  `publication_scopes` is `[]` iff `result_publication_record_id` is
  `null`.
- enforcement group: `enforcement_evidence_identity` and
  `enforcement_evidence_fingerprint` are both `null` together
  (enforcement never active) or both non-null together.

**Semantic-equality contract (SCR-WP13-001, as amended by the
retrospective simplification amendment):** the fact-set is a fixed
21-field **semantic object**; repeated derivation of the same valid
durable semantic state MUST produce structurally equal field values
(scalars equal; exact durable references equal; `null`/`[]` retain their
defined absence meanings; array contents/order equal where ordering is
normative). A normal structural equality assertion (`deepStrictEqual`)
is sufficient — JCS/canonical-byte serialization or a content-derived
hash identity of the fact-set itself is NOT a normative retrospective
requirement (the former domain-separated SHA-256 identity
`PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1` is retired for cross-engine
byte-identity proof). The committed JCS/NFC/hash disciplines remain
normative wherever they protect actual durable records, observation
evidence, artifact identity, permits, or coordination — this amendment
applies only to the derived `ExecutionRetrospectiveFacts` view. The
fact-set contains **no synthesized/emission-time timestamp, no random
identity, and no `timestampSource`**; temporal facts are obtained from
the exact referenced committed records/evidence.

### 5.4 Structural validation / semantic-equality expectations

The fact-set is structurally validated against the committed schema
vocabulary it references (closed taxonomy; `unevaluatedProperties: false`
shape discipline over the fixed v1 vocabulary of §5.3); it is
deterministic over its inputs; it never embeds
unverified or untrusted content; it never invents a disposition, result,
or evidence reference. All references are exact identity/digest references
— never paths. Validation enforces the §5.3 fixed shape: every
top-level property present (keys never conditionally omitted), JSON
`null` for unavailable scalars/references, `[]` for empty collections, no
`undefined`, no alternate absence sentinel, and grouped-field consistency
(partial presence is malformed and fails validation). The fact-set is
**timestamp-free**: no synthesized/emission-time timestamp, no random
identity, no operation-time/current-time value, and no `timestampSource`
(SCR-WP13-001; semantic-equality contract per the retrospective
simplification amendment).

### 5.5 Explicitly excluded

- No `TrustedReceipt` issuance, receipt record, or receipt correlation.
- No authority operands: no approval, issuance, grant, activation, or
  policy content — references by identity only.
- No enforcement configuration, projection content, tool inventory, or
  pi-guard internals — `PiEnforcementEvidence` is referenced by identity
  and fingerprint only.
- No result content bytes — the result instance is referenced by identity
  and revision digest only.
- No prospective facts, no retry permissions, no lifecycle decisions, no
  activation or execution authority.
- No `ExecutionSummaryRecord` aggregation (later-owned, reporting only).

### 5.6 WP-15 consumption note

Receipt issuance remains WP-15-owned; the `TrustedReceipt` event-type and
disposition vocabulary (`attempt-start`, `attempt-end`,
`enforcement-denial`, `cancellation`, `timeout`, `crash`,
`result-publication-correlation`, …) is WP-15-side mapping, not WP-13.
EXE-008 "available trusted receipt facts" is satisfied by the deterministic
derivability of the fact-set from the committed records/evidence it
references (for attempts reaching a trusted retrospective-complete
outcome, the durable `ExecutionOutcomeRecord` is the source of
disposition/observation/result-association facts per the closure
durability amendment; `terminal-unverifiable` attempts — durably recorded
but never reaching a verified retrospective-complete outcome — are the
explicit fail-closed exception and are receipt-ineligible). WP-15
later reuses the SAME shared pure derivation primitive **without
stamping it** (SCR-WP13-001; retrospective simplification amendment);
the re-derived fact-set is **structurally equal** to the emitted one
(semantic equality — no second derivation engine, no byte-identity
comparison).

## 6. Ownership and boundary check

| Item | Owner | Boundary evidence |
|---|---|---|
| `ExecutionResult` artifact file write | WP-13 result-write executor (host) | Narrow exclusive-create executor with ADR-012 adoption/recovery on exact existing destination (§3.4, SCR-WP13-003); no lifecycle authority |
| `ValidationRecord` production | WP-12 control plane, role `trusted-validator` (via `recordValidation`) | Committed operation + schema; WP-13 supplies the accepted WP-4 validation result through it and never records/mints validation records itself (§3.1, SCR-WP13-002) |
| `ResultPublicationRecord` production | WP-13 result-publication authority, role `trusted-result-publisher` | ADR-038; one class; WP-8 `publishRecord` path; replay idempotence/conflict at the authority boundary (§3.3–3.4, SCR-WP13-003) |
| `ExecutionAttemptRecord` production | WP-12, role `trusted-execution-recorder` | Committed schema; S4-D3/D4; WP-12 slice-4 §6 |
| `ExecutionOutcomeRecord` production | WP-13 outcome-recorder authority, role `trusted-execution-outcome-recorder` | ADR-039 (closure durability amendment); one class; WP-8 `publishRecord` path; at most one per exact attempt; only for verified retrospective-complete attempts; attempt-level lock Model 1; replay/conflict per decision-report §9 |
| Activation / occurrence / grant records | WP-12 control plane | Committed eight-class allowlist (unchanged) |
| pi-guard activation + `PiEnforcementEvidence` | WP-5B | Closure record; ADR-026/027 |
| `TrustedReceipt` issuance | WP-15 (WP-13 input provider only) | F-08; ADR-012; §5 |
| Supersession/revocation of result publications | Later-owned (not WP-13) | ADR-012; §8 |
| `ExecutionSummaryRecord` | Later-owned (reporting only) | ADR-011; §8 |

WP-12's committed store boundary, WP-11's controlled-writing boundary,
WP-5B's enforcement surface, and WP-8's storage authority are all
unchanged. No lifecycle authority is widened; WP-13 gains a second
narrowly confined trusted record-producing authority domain
(`trusted-execution-outcome-recorder` → `ExecutionOutcomeRecord` only) in
addition to the ADR-038 `trusted-result-publisher` domain; each domain
produces exactly one record class. No pi-guard, storage, or
control-plane modification is contemplated.

## 7. Closure-gate mapping (roadmap: "End-to-end execution with
enforcement and retrospective results")

Under this contract, WP-13 implementation (when separately authorized)
must deliver: orchestrated execution consuming the validated plan, active
enforcement (WP-5B), and observations (WP-5A); retry decisions per §4;
completion evaluation and one-instance result production per §3;
optional outcome-record durability for every verified
retrospective-complete attempt (ADR-039; before publication); result
publication through the ADR-038 authority via the WP-8 `publishRecord`
path with `ordinary-review` scope (with the required future precondition:
exact `ExecutionOutcomeRecord` result association matching, decision-report
§11); and `ExecutionRetrospectiveFacts` emission per §5. Tests: end-to-end execution, retry-ordinal matrices,
result provenance, publication fail-closed matrices, fact-set
structural semantic equality.

## 8. Not authorized / open items

- No WP-13 implementation of any kind; no source/test/schema/fixture/
  package/runtime change is authorized by this document.
- No WP-14 or WP-15 start; no WP-15 receipt work.
- Receipt-correlated consumption scopes (`completion-status`,
  `downstream-automation`, `authoritative-reporting`): WP-15-owned.
- `SupersessionRecord`/`RevocationRecord` for result publications and
  `ExecutionSummaryRecord` production: later-owned; nothing here assigns
  or authorizes them.
- WP-13 implementation requires a subsequent explicit human
  implementation authorization; this document does not self-approve.

## 9. Focused correction record (SCR-WP13-001…004) and readiness state

### 9.1 Dispositions

| Finding | Severity | Disposition | Applied change |
|---|---|---|---|
| SCR-WP13-001 — retrospective-facts determinism | MAJOR | CLOSED | §2 identity-conventions note; §5.2 determinism rule (no emission-time stamp by WP-13 or WP-15; no operation-time value in the facts; identical committed inputs ⇒ structurally equal facts regardless of derivation time — semantic equality per the retrospective simplification amendment; the former canonical byte identity retired as a normative retrospective requirement); §5.3 semantic-equality row; §5.4 validation expectation; §5.6 no-stamp shared-primitive re-derivation. All conflicting timestamp statements removed/qualified. |
| SCR-WP13-002 — ValidationRecord ownership | MODERATE | CLOSED | §3.1 explicit validation path: WP-4 machinery → WP-12 `recordValidation` → durable `ValidationRecord` id (role `trusted-validator`) consumed for `ResultPublicationRecord`; §3.7 requires the exact passing id before publication; §6 ownership table row added. WP-12 remains the trusted producer; no allowlist widening; authority still produces only `ResultPublicationRecord`; WP-13 gains no generic validation-record authority. |
| SCR-WP13-003 — result-write / publication idempotence | MODERATE | CLOSED | §3.4 exclusive-create result-file semantics, typed exclusive-create conflict, ADR-012 adoption/recovery on exact existing destination (never a create replay; byte equality alone never confers provenance), crash-recovery coverage between artifact creation and trusted publication; §3.3 publication replay idempotence (exact replay recognized, no second record) and publication-conflict fail-closed on any divergence; idempotence confined to the result-publication authority/boundary; WP-8 storage semantics unchanged. Its concurrency mechanism is now explicitly pinned by SCR-WP13-005 (§3.3). |
| SCR-WP13-005 — publication concurrency/idempotence | MODERATE | CLOSED | §3.3 pins the uniqueness/idempotence operation as ONE host-coordinated atomic decision using the existing trusted host-side coordination-lock pattern (WP-12 §15 pattern; publication decision key over workspace/bundle/occurrence/attempt): acquire lock → re-read/re-verify (current trusted lifecycle/registry context, existing publication state for the exact attempt, evaluator provenance, ValidationRecord identity, result revision/digest, bindings, scopes) → no existing ⇒ publish exactly one `ResultPublicationRecord` via WP-8 `publishRecord`; exact existing (identical identity/content/bindings/scope/registry context) ⇒ idempotent success, no write; conflicting existing ⇒ typed publication conflict, fail closed, no write; lock held through the uniqueness decision and the `publishRecord` outcome; concurrent invocations re-read under the lock (exact replay or conflict); no deterministic/content-derived record ID introduced; WP-8 semantics unchanged. ADR-038 decision 3 aligned. Its atomic mechanism is retained and its uniqueness domain is corrected by SCR-WP13-006 (§3.3): the lock key is attempt-level — result instance no longer participates in the key. |
| SCR-WP13-006 — publication uniqueness lock domain | MODERATE | CLOSED | §3.3 corrects the coordination-lock domain to the exact attempt-level uniqueness subject (workspace + bundle + occurrence + attempt); `result_instance` MUST NOT participate in the lock key — it is compared as proposed publication data UNDER the lock. Under-lock lookup is attempt-scoped: after acquiring the attempt-level lock, the boundary re-reads the publication/result-association state for the ENTIRE exact attempt and MUST discover ANY existing evaluator-produced publication/result association for that attempt regardless of result-instance identity; no existing ⇒ publish the proposed record; exact existing with the same result instance and all identical content/bindings/provenance/validation/scope/registry context ⇒ idempotent success, no write; existing association with a different result instance ⇒ typed publication conflict, fail closed, no write; same result instance but any other material divergence ⇒ typed publication conflict, fail closed, no write. The attempt-level lock is held through the `publishRecord` call/outcome; different attempts use independent locks (no unnecessary serialization). ADR-038 decision 3 aligned. |
| SCR-WP13-004 — exact absence encoding | MINOR | CLOSED | §5.3 fixed v1 shape: complete top-level property vocabulary (21 properties), all always present; `null` for unavailable scalars/references; `[]` for empty collections; keys never omitted; no `undefined`/alternate sentinel; grouped-field consistency (retry/result/publication/enforcement groups) with partial presence malformed; §5.4 validation expectations updated. Minimum pins applied: `previousAttemptId`→`previous_attempt_id = null` at ordinal 1; no-result group all `null` + `publication_scopes = []`; enforcement-never-active group both `null`. No schema implementation authorized. |

### 9.2 Readiness state

All six focused corrections (SCR-WP13-001…006) are applied and CLOSED.
The three
WP-13-owned pre-implementation contract decisions (completion evaluator /
ExecutionResult publication path; retry / attempt-ordering rule; WP-13 →
WP-15 retrospective facts) remain resolved under the corrected contract.
The final contract spot check returned **`WP-13 FINAL CONTRACT SPOT CHECK
ACCEPTED — READY FOR CONTRACT BASELINE COMMIT`** with zero open findings.
No unresolved WP-13-owned contract decision remains.
The WP-13 contract baseline is committed by the baseline commit (subject
`docs: establish WP-13 implementation contract baseline`; parent
`1067d5c6f9161b3d04443b0bdc73c5c80eda9253`); the earlier "ELIGIBLE FOR
HUMAN IMPLEMENTATION AUTHORIZATION" statement is restored.

**WP-13 CONTRACT BASELINE COMMITTED — READY FOR HUMAN IMPLEMENTATION AUTHORIZATION**

Implementation remains NOT STARTED and NOT AUTHORIZED; this document does
not self-approve.

Implementation remains NOT STARTED and NOT AUTHORIZED; this document does
not self-approve.
