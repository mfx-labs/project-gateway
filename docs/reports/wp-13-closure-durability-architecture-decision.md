# WP-13 Closure Architecture Decision — Retrospective-Fact Durability

**Status:** DOCS-ONLY DECISION — ACCEPTED
(SCR-WP13-DURABILITY-001…012 CLOSED at contract level; see §17 ledger
and §18 acceptance record). No source, schema, fixture, test, or runtime
code is changed by this document. Implementation slices are listed in
§16 and are NOT authorized here.

**Resolves:** SCR-WP13-CLOSURE-001 (CRITICAL — cold re-derivability) and
SCR-WP13-CLOSURE-002 (MAJOR — observation evidence identity), as
established by the WP-13 senior closure review (baseline HEAD `5cddfc8`),
as corrected by the senior durability contract review
(SCR-WP13-DURABILITY-001…012).

**ADRs:** this decision extends the ADR-038 authority-domain pattern to a
second narrow WP-13 record-producing domain and supersedes only ADR-038's
former "WP-13 only trusted-store production" consequence. Recorded as
ADR-039 (`docs/decisions/ADR-039-wp-13-execution-outcome-record.md`),
status **Accepted** (by the WP-13 durability focused contract rereview;
see §18 acceptance record).

---

## 1. Problem restated

`ExecutionRetrospectiveFacts` (WP-13 contract §5) must be re-derivable by
WP-15 after total process loss from durable trusted records/evidence only
(§5.2, §5.6; byte-identical facts and identical
`PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1` identity). The senior review
established that three fact groups currently exist only process-locally:

1. **disposition** — only in the transient WP-13A `ExecutionAttemptOutcome`
   ("never persisted", `src/execution/types.ts`); the committed
   `ExecutionAttemptRecord` schema carries no disposition/outcome field.
2. **observation references** — only from the transient WP-5A
   `PiExecutionObservation`; no durable record class carries the
   observation; and the emitted references place raw session/turn
   correlation ids in `external-evidence.evidence_id`, which the committed
   `evidence-reference` schema restricts to `pgw:e:<32hex>` (verified by
   running the committed registry validator — both emitted forms are
   rejected).
3. **result association for validated-but-unpublished results** —
   `association_mode` survives only in the transient `ValidatedResultHandoff`;
   `result_validation_record_id` is durable but not discoverable from the
   attempt anchor (no durable attempt → validation-record link).

Enforcement identity/fingerprint have the same defect class: `PiEnforcementEvidence`
is verified process-local evidence with no durable lifecycle record.

## 2. Objective and non-negotiables

Make the fact-set genuinely re-derivable after total process loss from
durable trusted state, without:

- weakening the cold re-derivation requirement (§5.2/§5.6 stay intact);
- trusting the project-visible `ExecutionResult` file (ADR-012);
- using `TrustedReceipt` as a source (WP-15-owned; F-08; EXE-008);
- mutating `ExecutionAttemptRecord` after creation (lifecycle immutability);
- retaining process-local handoffs;
- fabricating observation evidence identities;
- fabricating outcome records for attempts that never reached a verified
  retrospective-complete state.

## 3. Selected architecture

**ADOPT (alternative E): ONE narrow immutable WP-13-owned durable
lifecycle record class per exact started attempt:**

`ExecutionOutcomeRecord` (record class id `execution-outcome-record`),
responsible role **`trusted-execution-outcome-recorder`** (new closed role
const; host-side WP-13 authority domain).

Its purpose is exactly one thing: **durably persist the retrospective
facts of one attempt that has no other durable trusted source** —
disposition, the verified-observation evidence reference, the enforcement
evidence references, and the validated-result association when one exists.
It is NOT an authority, scheduler, receipt, publication substitute, retry
record, recovery mechanism, or generic execution log. It grants nothing.

No additional record class and no recovery authority are introduced.

## 4. Attempt eligibility / orphan semantics (SCR-WP13-DURABILITY-002)

**Corrected cardinality rule:**

- **at most one** immutable `ExecutionOutcomeRecord` per exact started
  attempt;
- **exactly one is required only** when the attempt reaches a **VERIFIED
  retrospective-complete state**:

  * durable `ExecutionAttemptRecord`;
  * verified terminal `ExecutionAttemptOutcome`;
  * genuine correlated `PiExecutionObservation`;
  * completion/`ValidationRecord` association when applicable.

- an attempt that is durably recorded but NEVER reaches those inputs is
  classified **`terminal-unverifiable`**, and:

  * no `ExecutionOutcomeRecord` is fabricated;
  * no disposition is guessed;
  * no observation evidence is fabricated;
  * no retrospective fact-set is emitted;
  * no `TrustedReceipt` may later be issued for that attempt;
  * the attempt is **receipt-ineligible**.

This covers BOTH:

- process crash before the outcome-recording point; and
- ordinary WP-13A post-recording failure paths that return before a
  verified outcome/observation exists.

**EXE-008 intent amended accordingly:** trusted receipt facts are
required for every started attempt that reaches a trusted
retrospective-complete outcome; `terminal-unverifiable` attempts are the
explicit fail-closed exception. **No recovery mechanism synthesizes a
missing outcome.** (Rule work pinned in §15 EXE-012.)

## 5. Record vocabulary — required durable content

`ExecutionOutcomeRecord` (closed schema; all fields always present unless
noted; partial presence invalid):

| Field | Type / reference | Rule |
|---|---|---|
| `record_type` | const `ExecutionOutcomeRecord` | — |
| `record_id` | `pgw:l:` (identifiers `lifecycleRecordId`) | opaque; allocated ONLY in the no-existing branch (§9); NEVER content-derived/deterministic |
| `created_at` | `timestamp` | lifecycle convention; obtained ONLY in the no-existing branch (§9); **never read by fact derivation** |
| `responsible_role` | const `trusted-execution-outcome-recorder` | new closed role |
| `registry_snapshot_reference` | `registry-snapshot-reference` | lifecycle convention |
| `workspace_id` | `pgw:w:` | reference; exact-equal the bound attempt record |
| `bundle` | exact `ExecutionBundle` reference | reference; exact-equal the bound attempt record |
| `occurrence_id` | `pgw:o:` | reference; exact-equal the bound attempt record |
| `attempt_id` | `pgw:a:` | reference; exact-equal the bound attempt record |
| `ordinal` | safe integer ≥ 1 | reference; exact-equal the bound attempt record |
| `execution_attempt_record_id` | `pgw:l:` | **the exact attempt-record binding (anchor)** |
| `disposition` | closed enum (committed 7-value vocabulary) | the durable disposition source |
| `observation_evidence` | ONE `external-evidence`-shaped reference: `{ kind: 'external-evidence', evidence_id: pgw:e:, content_digest: sha-256:, declared_media_type: 'application/json', observation_role: 'evaluation-evidence' }` | **REQUIRED — never optional inside the record**; a record is created only when a genuine correlated `PiExecutionObservation` exists |
| `enforcement_evidence` | OPTIONAL object `{ projection_identity: sha-256:, evidence_fingerprint: sha-256: }` | absent = enforcement never active for the attempt; both fields together; **values copied only after exact WP-5B correlation**; retrospective use only — they confer no activation/enforcement authority |
| `result_association` | OPTIONAL object `{ instance_id: pgw:i:, revision_digest: sha-256:, association_mode: 'originated'\|'adopted', validation_record_id: pgw:l: }` | absent = no evaluator-produced result; complete quartet when present; partial = schema-invalid |

Deliberately NOT duplicated: `activation_record_id`, `runtime_grant_id`
(derivable from the attempt record), publication id/scopes (from
`ResultPublicationRecord`, §6), and any authority-bearing content.
`revision_digest` holds the exact `ValidationRecord` subject digest
(matching the committed fact-set field `result_revision_digest`).

**Observation evidence is NOT an evidence-content store:** the original
observation material and its session/turn correlation values are NOT
durably stored or retrievable by WP-13; `content_digest` is a **binding**
over the canonical observation serialization, not stored content. Future
WP-15 re-derivation requires only the durable evidence reference
(evidence_id + content_digest + media type + role). The trust anchor is
the trusted outcome recorder's verification of the genuine observation +
exact attempt correlation **at record-production time** (rule work pinned
in §15 EXE-011).

## 6. Result association semantics

Three cases, resolved explicitly:

1. **No evaluator-produced result** (completion not applicable, no-result,
   or completion failed before validation): outcome record carries NO
   `result_association`. Facts: result quartet all `null`, publication
   `null`, scopes `[]`.
2. **Evaluator-produced, validated result** (handoff + committed passing
   `ValidationRecord`; publication absent or failed): outcome record
   carries the exact quartet — `instance_id`, `revision_digest`
   (ValidationRecord subject digest), `association_mode`,
   `validation_record_id`. This is the ONLY durable home of
   `association_mode` and of the attempt → validation-record link when no
   publication exists. The quartet is written from the completed WP-13B
   stage (handoff + its committed ValidationRecord) — never from the
   project-visible result file.
3. **Published result:** `ResultPublicationRecord` remains the
   authoritative publication fact. The outcome record NEVER carries
   publication id/scopes; WP-13D derives `result_publication_record_id`
   and `publication_scopes` from the durable attempt-scoped publication
   record. The outcome record is NOT publication provenance.

**Exact consistency checks between outcome record and any later
`ResultPublicationRecord`** (fail closed on divergence — never silently
prefer one): publication `result_subject.instance_id` === outcome
`result_association.instance_id`; publication `result_subject.digest` ===
outcome `revision_digest`; publication `association_mode` === outcome
`association_mode`; publication `validation_record_id` === outcome
`validation_record_id`; publication workspace/occurrence/attempt/bundle
=== outcome (via the attempt anchor). A publication without a matching
outcome-record association, or an outcome association without a matching
passing `ValidationRecord` (subject kind `ExecutionResult`, exact
instance/digest/workspace), is an inconsistent durable state: derivation
fails closed (rule work pinned in §15 EXE-013).

## 7. Observation evidence identity decision (resolves SCR-WP13-CLOSURE-002)

- **Raw session/turn correlation ids are NEVER placed in `evidence_id`.**
  They are correlation facts inside the verified observation material
  (fields of `PiExecutionObservation`), bound by `content_digest` — not
  substitutes for evidence identity.
- **Who allocates:** the trusted host composition, through the existing
  committed trusted-local opaque identity-source pattern (D-3; the same
  family as WP-13B `ResultIdentitySource.newEvidenceId` / WP-12
  `newRecordId`): a host-injected `newEvidenceId()` returning
  `pgw:e:<32hex>`. No content-derived evidence id is introduced (none is
  normatively authorized).
- **When:** ONLY in the no-existing branch of the outcome-recording
  operation (§9) — never before the under-lock re-read has established
  that no outcome record exists.
- **Where durable:** `ExecutionOutcomeRecord.observation_evidence.evidence_id`.
- **Canonical material bound by `content_digest`:** the canonical
  serialization of the exact verified `PiExecutionObservation` (JCS of the
  observation object; NFC-disciplined). The digest is `sha-256:` of that
  canonical material. **`content_digest` is a binding, not an
  evidence-content store.**
- **Correlation validation before trust:** the observation must be a
  genuine branded `PiExecutionObservation` (WP-5A verification), correlated
  exactly to the attempt (`occurrenceId`, `attemptId`, bundle reference
  exact-equal to the bound attempt record), re-verified by the outcome
  recorder under the lock before any write. The trust anchor is that
  production-time verification.
- **Cardinality:** ONE `external-evidence` reference per exact verified
  `PiExecutionObservation`. The fact-set's `observation_references` carries
  exactly one entry for an attempt with an outcome record.
- **Schema:** committed values only — `evidence_id` `pgw:e:<32hex>`,
  `content_digest` committed digest syntax, `declared_media_type`
  `application/json`, `observation_role` `evaluation-evidence`. **No shared
  external-evidence schema component is introduced**; future schema work
  must directly reuse/reference the committed `evidence-reference.json`
  branch as appropriate.
- **WP-15 re-derivation:** reads `evidence_id` + `content_digest` + media
  type + role from the durable outcome record — no process-local state, no
  observation object required.

## 8. Record production authority — two confined WP-13 domains

**Corrected:** WP-13 now has TWO separately confined trusted
record-producing authority domains:

1. `trusted-result-publisher` → `ResultPublicationRecord` only (ADR-038,
   unchanged);
2. `trusted-execution-outcome-recorder` → `ExecutionOutcomeRecord` only
   (this decision).

Neither is generic lifecycle authority. ADR-039 supersedes ONLY ADR-038's
former "WP-13 only trusted-store production" consequence; ADR-038
publication semantics otherwise remain intact.

**Outcome-recorder domain:** host-side single trusted owner, branded
generation-bound capability minted only by the trusted host composition
(module-private; zero production producers outside it), exact-record
publication permit, sink-level confinement to the one
`execution-outcome-record` class, reuse of the WP-8 `publishRecord` path
with the mechanical authorized-write audit preserved. WP-12's eight-class
allowlist (`src/control-plane/store-boundary.ts`) is unchanged; the
outcome record is NOT a WP-12 class and is NOT produced through the WP-12
boundary. No generic lifecycle authority, no TrustedReceipt authority, no
`ResultPublicationRecord` authority, no execution/activation authority, no
retry decision, no scheduler, no recovery authority.

## 9. Cardinality / uniqueness / lock model / replay (SCR-WP13-DURABILITY-004/005)

### Lock model — Model 1 (pinned)

1. The outcome-recording operation acquires the existing exact
   attempt-level lock;
2. performs ALL under-lock re-read / decision / `publishRecord` work;
3. **RELEASES the lock completely**;
4. only then may WP-13C publication begin;
5. WP-13C **independently acquires the SAME attempt-level lock key**.

**Nested acquisition is a composition error; there is NO reentrant
locking.**

Lock key — the exact same key namespace/string as WP-13C:

- workspace
- exact bundle **instance**
- exact bundle **revision**
- exact bundle **digest**
- occurrence
- attempt

Explicitly EXCLUDED from the uniqueness/lock key (compared under the lock
ONLY, never key material):

- result instance
- result revision/digest
- disposition
- observation evidence id
- enforcement evidence values
- ValidationRecord id

Different attempts remain fully independent.

### Cardinality

At most one outcome record per exact attempt; exactly one required only
for retrospective-complete attempts (§4).

### Replay semantics — opaque identities

There is NO "same record identity" replay rule. Under the attempt lock:

**Existing outcome record found:** reconstruct/verify all independently
derivable material and compare against the existing durable record.
Replay equivalence EXCLUDES the operation-assigned values `record_id`,
`created_at`, and `observation_evidence.evidence_id`. The existing
durable evidence id must (a) match `pgw:e:<32hex>` and (b) remain
associated with the exact stored observation digest / media type / role.
If all caller-verifiable material is exact:

- return the existing durable record/id;
- do NOT mint a new record id;
- do NOT mint a new observation evidence id;
- do NOT obtain a new timestamp;
- do NOT call `publishRecord`.

Material divergence → typed conflict, fail closed, no write.

**No existing outcome record:** ONLY now allocate the opaque lifecycle
record id, the opaque observation evidence id, and the lifecycle
timestamp; then construct, schema/semantic validate, permit, and publish
exactly one record. **No opaque operation-assigned identity is minted
before the no-existing branch.**

## 10. Production ordering and crash outcomes (SCR-WP13-DURABILITY-006/007)

### Ordering (pinned)

```
1. durable ExecutionAttemptRecord          (WP-12; existing)
2. execution + genuine verified observation/outcome (WP-13A; existing)
3. OPTIONAL completion + ValidationRecord   (WP-13B; applicable per
                                            disposition/result semantics)
4. outcome-record operation acquires/releases the attempt lock (NEW)
5. OPTIONAL WP-13C publication acquires/releases the SAME attempt lock
6. retrospective derivation                (WP-13D; existing, re-sourced)
```

Completion is OPTIONAL depending on disposition/result semantics
(non-completed attempts skip it). The outcome record is written AFTER
completion/validation when applicable (so disposition, verified
observation, and the result association are known) but BEFORE publication
(so a publication failure or absence never erases the validated-result
association); writing after completion keeps immutability (no second
write).

**Corrected crash-window description:** the attempt-record → outcome-record
interval may span the ENTIRE execution / completion operation; it is NOT
"one host step."

### Crash outcomes

**Attempt record exists, outcome record absent** → state:
`terminal-unverifiable` / receipt-ineligible (§4). Facts are NEVER
inferred. No recovery mechanism synthesizes the outcome.

**Outcome record exists, publication absent** → facts are fully
cold-derivable: result quartet from the outcome record when present;
`result_publication_record_id` = `null`; `publication_scopes` = `[]`.

**Process loss before the first `ResultPublicationRecord` was written:**
do NOT promise automatic publication recovery. The publication dimension
is `terminal-unpublished`. No automatic completion rerun. No automatic
publication rerun. No scheduler/resume protocol. A later, separately
authorized host operation may only publish if it can independently
reconstruct ALL currently required trusted publication inputs; that
recovery is NOT part of WP-13 closure and must not be assumed. Existing
WP-13C idempotent replay remains applicable ONLY when a durable
publication already exists, or when a valid live publication invocation is
actually available.

## 11. WP-13C new precondition (future required correction)

Because outcome durability is now normative BEFORE publication, WP-13C
requires a future correction (S3): under its existing attempt lock, before
first publication or replay acceptance, WP-13C MUST:

- locate the exact `ExecutionOutcomeRecord` for the attempt;
- require its `result_association` to exist;
- exact-match the publication request/handoff against it:
  result instance, result revision digest, association mode,
  ValidationRecord id, workspace, bundle, occurrence, attempt;
- independently re-check the passing `ValidationRecord`.

No outcome record or any mismatch → fail closed; no publication write.
`ResultPublicationRecord` remains the authoritative publication fact; the
outcome record is NOT publication provenance. This is the ONLY
WP-13A/B/C semantic change required by this decision (rule work §15
EXE-013).

## 12. Cold re-derivation contract — exact 21-field durable-source mapping

After total process loss, a fresh process derives the fact-set from these
durable sources ONLY. No field lists a process-local object as its
required source. The project-visible `ExecutionResult` file is never
treated as trusted provenance. An attempt without an outcome record is
`terminal-unverifiable`: NO fact-set is emitted at all.

| # | Field | Durable source | Correlation rule | Absence rule |
|---|---|---|---|---|
| 1 | `workspace_id` | `ExecutionAttemptRecord.workspace_id` | anchor = attempt record bound by outcome record `execution_attempt_record_id` | always present |
| 2 | `bundle` | `ExecutionAttemptRecord.bundle` (exact ref) | same anchor | always present |
| 3 | `occurrence_id` | `ExecutionAttemptRecord.occurrence_id` | same anchor | always present |
| 4 | `attempt_id` | `ExecutionAttemptRecord.attempt_id` | same anchor | always present |
| 5 | `attempt_ordinal` | `ExecutionAttemptRecord.ordinal` | same anchor | always present |
| 6 | `activation_record_id` | `ExecutionAttemptRecord.activation_record_id` | same anchor | always present |
| 7 | `runtime_grant_id` | `ExecutionAttemptRecord.runtime_grant_id` | same anchor | always present |
| 8 | `execution_attempt_record_id` | `ExecutionAttemptRecord.record_id` | the anchor itself | always present |
| 9 | `occurrence_record_id` | `ExecutionOccurrenceRecord.record_id` | occurrence correlated by occurrence_id + workspace_id + exact bundle; exactly one | always present |
| 10 | `previous_attempt_id` | durable attempt set (all `ExecutionAttemptRecord`s) | ordinal−1, same occurrence/workspace/bundle; exactly one; enumeration-order independent; no newest-wins | `null` iff ordinal 1 |
| 11 | `disposition` | `ExecutionOutcomeRecord.disposition` | outcome record bound by anchor; at most one | no fact-set when no outcome record (`terminal-unverifiable`); disposition never guessed |
| 12 | `result_instance_id` | `ExecutionOutcomeRecord.result_association.instance_id` | attempt-scoped outcome record | `null` when no association |
| 13 | `result_revision_digest` | `ExecutionOutcomeRecord.result_association.revision_digest` | same | `null` when no association |
| 14 | `association_mode` | `ExecutionOutcomeRecord.result_association.association_mode` | same | `null` when no association |
| 15 | `result_validation_record_id` | `ExecutionOutcomeRecord.result_association.validation_record_id` | + durable `ValidationRecord` (subject kind `ExecutionResult`, exact instance/digest/workspace; structural+semantic `pass`) | `null` when no association |
| 16 | `result_publication_record_id` | `ResultPublicationRecord.record_id` | attempt-scoped publication lookup (workspace/bundle instance+revision+digest/occurrence/attempt); never from the outcome record | `null` when no publication |
| 17 | `publication_scopes` | `ResultPublicationRecord.publication_scopes` | same publication | `[]` when no publication |
| 18 | `observation_references` | `ExecutionOutcomeRecord.observation_evidence` (one external-evidence reference) | anchor | one entry for every attempt with an outcome record |
| 19 | `enforcement_evidence_identity` | `ExecutionOutcomeRecord.enforcement_evidence.projection_identity` | anchor | `null` when enforcement never active |
| 20 | `enforcement_evidence_fingerprint` | `ExecutionOutcomeRecord.enforcement_evidence.evidence_fingerprint` | anchor | `null` when enforcement never active |
| 21 | `orchestration_evidence_identity` | `ExecutionAttemptRecord.record_id` | the anchor (WP-12 Slice-4 durable orchestration fact) | always present |

Consistency rule across rows 12–15 vs 16–17: when a publication exists,
§6 checks apply (exact equality or fail closed). Rows 11, 18, 19, 20 are
sourced exclusively from the outcome record; rows 12–15 from the outcome
record's association, cross-verified against the durable `ValidationRecord`
and any publication.

## 13. Orchestration evidence mapping (preserved)

The closure-review conclusion stands: under committed WP-12 Slice-4
semantics the durable orchestration fact IS the `ExecutionAttemptRecord`
(S4-D1; `orchestrationDecision` is decision-only with zero records and no
identity of its own). Therefore:

**`orchestration_evidence_identity` = the `ExecutionAttemptRecord` lifecycle
record identity (`execution_attempt_record_id`).**

The WP-8 mechanical authorized-write audit event id
(`attemptAuditEventId`) is the audit event, NOT the orchestration evidence
identity. No change required.

## 14. Contract impact analysis (normative resources requiring later change)

Identified — NOT implemented in this phase:

1. **Lifecycle schemas:** new
   `schemas/lifecycle/1.0/records/execution-outcome-record.json`; lifecycle
   schema **union/selection** — `src/schema/select.ts`
   (`LIFECYCLE_RECORD_TYPES`, lifecycle schema selection map);
   `schemas/catalog.json`; regenerated `src/generated/schema-bundle.ts`.
   **No shared external-evidence component is extracted solely for this
   record**; future schema work directly references the committed
   `evidence-reference.json` branch as appropriate.
2. **Record taxonomy / responsibility matrix:** lifecycle/taxonomy class id
   `execution-outcome-record` (label `ExecutionOutcomeRecord`, segment,
   producer `trusted execution outcome recorder`) in
   `src/storage/format/taxonomy.ts` and its types; responsible-role
   vocabulary (`trusted-execution-outcome-recorder`);
   `docs/design/artifact-responsibility-matrix.md`; glossary.
3. **Storage surfaces:** storage read/enumeration allowlists; storage-format
   taxonomy/types; record-class count assertions; taxonomy tests; any
   closed record-count documentation/assertions. New narrow WP-13-owned
   store boundary + capability/permit family on WP-8 `publishRecord`
   (ADR-038 pattern). WP-12 eight-class allowlist unchanged. WP-13C
   publication boundary unchanged except the §11 precondition.
4. **Semantic rule inventory:** new rules in
   `docs/design/semantic-validation-rules.md` — EXE-010, EXE-011,
   EXE-012, EXE-013 (§15) with pass/fail fixtures and rule vectors
   (`RULE-EXE-01x-PASS/FAIL`).
5. **ADR-012 / ADR-038 interactions:** no change to ADR-012 result
   lifecycle. ADR-038 publication semantics unchanged; its former
   "WP-13 only trusted-store production" consequence superseded by
   ADR-039 (§8).
6. **WP-13 contract §5:** §5.2 derivation-source wording (outcome record
   added; `terminal-unverifiable` exception); §5.3
   `observation_references` row (one `pgw:e:`-backed reference per
   observation); §5.3 `orchestration_evidence_identity` row (mapping
   pinned, §13); §5.6 re-derivation sources (outcome record; no fact-set
   for `terminal-unverifiable` attempts).
7. **WP-13 closure gate:** the closure composition gains the
   outcome-recording stage between completion and publication (§10); the
   gate proof includes a genuine cold-restart re-derivation step (S4).
8. **Conformance fixtures / rule IDs:** fixture `ExecutionOutcomeRecord`
   payloads (complete, absent-association, replay-exact, divergence),
   replay/conflict vectors, evidence-reference fixtures with `pgw:e:` ids.
9. **WP-13D implementation/tests:** `facts.ts` sources rows 11–15/18–20
   from the outcome record; observation evidence identity allocation in
   the no-existing branch; removal of `handoff`/`outcome`/`observation` as
   derivation inputs; re-derivation test rewritten to discard ALL
   process-local objects; schema validation of emitted references;
   `terminal-unverifiable` (no fact-set) coverage; adversarial
   outcome-vs-publication consistency.
10. **WP-15 future input contract:** WP-15 consumes the outcome record +
    existing records; `terminal-unverifiable` attempts are
    receipt-ineligible. No WP-15 work authorized here.

## 15. Semantic-rule decisions (future rule work, pinned)

| Rule | Decision |
|---|---|
| **EXE-010** | `ExecutionOutcomeRecord` cardinality/immutability: at most one per exact attempt; record only for retrospective-complete attempts; material replay idempotent (opaque operation-assigned values excluded from equivalence); divergence conflict; exact attempt/result/validation correlations |
| **EXE-011** | Observation evidence trust: genuine `PiExecutionObservation`; exact attempt correlation; opaque `pgw:e:` allocation ONLY in the no-existing branch; canonical observation digest; one durable evidence reference |
| **EXE-012** | Terminal-unverifiable attempt: durable attempt exists; no trustworthy retrospective-complete outcome; no outcome record; no retrospective facts; receipt-ineligible; no inferred recovery |
| **EXE-013** | Outcome/publication consistency: publication requires an exact outcome result association; both the publication boundary and retrospective derivation fail closed on divergence |

Numbers confirmed free in the committed inventory (EXE-001…009 exist).

## 16. Implementation slicing (dependency order, after acceptance)

- **S1 — Schema/taxonomy/rules/fixtures** (per §14.1–2, §15; includes
  `select.ts`, catalog, generated bundle, taxonomy types, count
  assertions, rule vectors) → **focused review/commit**
- **S2 — Outcome authority boundary** (capability + permit + narrow store
  boundary on WP-8 `publishRecord`, static-guard confinement) →
  **focused review/commit**
- **S3 — Outcome production + lock/replay (§9) + required WP-13C
  precondition (§11)** → **focused review/commit**
- **S4 — WP-13D re-source (§12) + genuine cold-restart E2E** →
  **senior WP-13 closure review**
- **S5 — Final contract/report/planning synchronization** if residual
  documentation remains

WP-15 remains separately authorized later. Nothing above is implemented by
this document.

## 17. Correction ledger — SCR-WP13-DURABILITY-001…012

| # | Corrected decision | Resulting invariant | Owning slice | Disposition |
|---|---|---|---|---|
| 001 | Architecture preserved: ONE `ExecutionOutcomeRecord`, role `trusted-execution-outcome-recorder`; alternative E retained; no additional record class or recovery authority | Single narrow outcome record; no recovery surface | S1–S3 | CLOSED (contract level) |
| 002 | At-most-one outcome record; exactly one only for verified retrospective-complete attempts; `terminal-unverifiable` semantics (no record, no facts, receipt-ineligible, no inference); EXE-008 intent amended | Orphan attempts fail closed; nothing fabricated | S1 (schema), S4 (derivation), S5 (contract) | CLOSED (contract level) |
| 003 | `observation_evidence` REQUIRED inside the record; record only with genuine correlated observation; `content_digest` is a binding, not a content store; trust anchor = production-time recorder verification; enforcement refs copied only after exact WP-5B correlation, retrospective-only, no authority | No evidence-content storage; no fabricated observation | S1 (schema), S3 (production), S5 (contract) | CLOSED (contract level) |
| 004 | Lock Model 1 pinned: outcome operation acquires/releases the attempt lock completely; WP-13C then acquires the SAME key independently; no reentrant/nested acquisition; key = workspace + bundle instance/revision/digest + occurrence + attempt; result/disposition/observation/enforcement/validation values excluded from the key | Sequential, non-reentrant attempt-scoped locking | S3 | CLOSED (contract level) |
| 005 | Replay equivalence excludes `record_id`/`created_at`/`evidence_id`; exact replay returns the existing durable record without minting ids/timestamps or calling `publishRecord`; opaque ids allocated ONLY in the no-existing branch | Idempotent, non-minting replay; deterministic identity discipline | S3 | CLOSED (contract level) |
| 006 | Production ordering pinned; completion optional; attempt-record → outcome-record interval may span the entire execution/completion operation (not "one host step") | Correct crash-window model | S3, S5 (contract) | CLOSED (contract level) |
| 007 | Crash outcomes: attempt-only = `terminal-unverifiable`/receipt-ineligible; outcome-without-publication = fully cold-derivable (quartet, null publication, `[]` scopes); pre-first-publication loss = `terminal-unpublished`, NO automatic publication/completion rerun, no scheduler/resume; WP-13C replay only with durable publication or valid live invocation | No hidden recovery protocol | S3, S4 | CLOSED (contract level) |
| 008 | WP-13C future precondition: under its lock, before first publication or replay acceptance, locate the exact outcome record, require `result_association`, exact-match 8 items, re-check the passing ValidationRecord; no record/mismatch → fail closed | Publication cannot bypass outcome durability | S3 | CLOSED (contract level) |
| 009 | One `external-evidence` reference per genuine observation; committed values only; NO shared external-evidence schema component; future schema work references committed `evidence-reference.json` directly | No schema-component invention | S1 | CLOSED (contract level) |
| 010 | WP-13 has TWO separately confined trusted record-producing domains (`trusted-result-publisher`, `trusted-execution-outcome-recorder`); ADR-039 supersedes only ADR-038's former single-production consequence; contract ownership table/§5/closure-ordering text updated | Authority boundaries remain singly owned per class | S5 (docs) | CLOSED (contract level) |
| 011 | EXE-010…013 rule decisions pinned (cardinality/immutability; observation trust; terminal-unverifiable; outcome/publication consistency) | Rule inventory ready for S1 | S1 | CLOSED (contract level) |
| 012 | S1 impact list corrected: lifecycle schema union/selection (`src/schema/select.ts`, `LIFECYCLE_RECORD_TYPES`, selection map), `schemas/catalog.json`, regenerated `schema-bundle.ts`, taxonomy class id/role vocabulary/responsibility matrix/glossary, storage read/enumeration allowlists, taxonomy types, record-count assertions, taxonomy tests, rule inventory, fixtures/vectors; no shared evidence component | Complete normative surface enumerated | S1 | CLOSED (contract level) |
| 013 | Final cross-document synchronization (docs-only, no new architectural decision): WP-13 pre-implementation contract §5.1 EXE-008 eligibility, §5.2 fact-set cardinality/existence, and §5.3 `observation_references` semantics corrected to the amended model (`terminal-unverifiable`; at-most-one fact-set; exactly one `pgw:e:`-backed reference per emitted fact-set; session/turn ids never evidence identities); header amendment note added; historical baseline text preserved | Single consistent model across the durability decision, ADR-039, and the WP-13 contract §5/§6/§7 | S5 | CLOSED (contract level) |

## 18. Acceptance record (decision gate)

Accepted by the WP-13 durability focused contract rereview:

- SCR-WP13-DURABILITY-001…012 **CLOSED at contract level** (ledger §17);
- final cross-document consistency synchronization accepted (ledger 013);
- focused contract rereview verdict:
  **WP-13 DURABILITY FOCUSED CONTRACT REREVIEW ACCEPTED — READY FOR
  DURABILITY CONTRACT BASELINE COMMIT**;
- zero new findings;
- durability contract ready for baseline commit;
- implementation **NOT STARTED** under this durability amendment (no
  source, schema, fixture, test, or generated-file change);
- **S1 requires explicit human authorization** (separate gate; not granted
  here).

ADR-039 status updated to **Accepted** accordingly; WP-13 remains
**NOT CLOSED**.
