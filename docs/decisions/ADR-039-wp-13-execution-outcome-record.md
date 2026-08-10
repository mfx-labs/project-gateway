# ADR-039 — WP-13 Execution Outcome Record (Retrospective-Fact Durability)

## Status

**Accepted** by the WP-13 durability focused contract rereview (verdict:
`WP-13 DURABILITY FOCUSED CONTRACT REREVIEW ACCEPTED — READY FOR
DURABILITY CONTRACT BASELINE COMMIT`; SCR-WP13-DURABILITY-001…012
CLOSED at contract level; zero new findings; correction ledger in
decision-report §17; acceptance record in decision-report §18). Proposed
by the WP-13 closure architecture decision
(`docs/reports/wp-13-closure-durability-architecture-decision.md`), with
focused contract corrections applied
(SCR-WP13-DURABILITY-001…012).

Documentation only — **no implementation is authorized by this ADR
acceptance**; the S1…S5 slices of decision-report §16 remain separately
gated (S1 requires explicit human authorization), and WP-13 remains
**NOT CLOSED**.

## Context

The WP-13 senior closure review established that
`ExecutionRetrospectiveFacts` (WP-13 contract §5) cannot be cold
re-derived after total process loss: disposition, observation evidence
references, and (for validated-but-unpublished results) the result
association exist only in process-local WP-13A/B objects, and the emitted
observation references place raw session/turn ids in
`external-evidence.evidence_id`, which the committed schema restricts to
`pgw:e:<32hex>`. No durable trusted record class carries these facts.

## Decision

1. **A new narrow immutable lifecycle record class,
   `ExecutionOutcomeRecord` (class id `execution-outcome-record`),
   produced by a new narrow WP-13-owned trusted authority domain
   (role `trusted-execution-outcome-recorder`), at most one per exact
   started attempt.** Its only purpose is to durably persist retrospective
   facts with no other durable trusted source: disposition, the verified-
   observation evidence reference (one `external-evidence` reference with
   an opaque `pgw:e:` evidence identity — `observation_evidence` is
   REQUIRED inside the record), enforcement evidence references (identity +
   fingerprint), and — when an evaluator-produced validated result exists —
   the exact quartet (result instance id, revision digest, association
   mode, passing ValidationRecord id). It is not an authority, scheduler,
   receipt, publication substitute, recovery mechanism, or generic
   execution log.
2. **Attempt eligibility:** exactly one outcome record is required ONLY
   for attempts reaching a verified retrospective-complete state (durable
   `ExecutionAttemptRecord` + verified terminal outcome + genuine
   correlated observation + completion/ValidationRecord association when
   applicable). A durably recorded attempt that never reaches those inputs
   is `terminal-unverifiable`: no outcome record is fabricated, no
   disposition is guessed, no retrospective fact-set is emitted, and the
   attempt is receipt-ineligible. This covers process crash before the
   outcome-recording point AND ordinary WP-13A post-recording failure
   paths. EXE-008 intent is amended accordingly; no recovery mechanism
   synthesizes a missing outcome.
3. **Production authority mirrors ADR-038 but is a SECOND, separately
   confined domain:** WP-13 now has two trusted record-producing
   authority domains — `trusted-result-publisher`
   (→ `ResultPublicationRecord` only; ADR-038, otherwise unchanged) and
   `trusted-execution-outcome-recorder` (→ `ExecutionOutcomeRecord` only).
   Host-side single trusted owner, branded generation-bound capability
   minted only by the trusted host composition, exact-record publication
   permit, sink-level confinement to the one class, reuse of the WP-8
   `publishRecord` path. WP-12's eight-class allowlist is unchanged; the
   outcome record is not a WP-12 class. This ADR supersedes ONLY ADR-038's
   former "WP-13 only trusted-store production" consequence.
4. **Lock model (Model 1, pinned):** the outcome-recording operation
   acquires the existing exact attempt-level lock, performs all under-lock
   re-read/decision/`publishRecord` work, then RELEASES the lock
   completely; only then may WP-13C publication begin, acquiring the SAME
   attempt-level lock key independently. No reentrant/nested acquisition.
   Key = workspace + exact bundle instance/revision/digest + occurrence +
   attempt. Result instance/revision/digest, disposition, observation
   evidence id, enforcement values, and ValidationRecord id are excluded
   from the key (compared under the lock only).
5. **Replay semantics:** no "same record identity" rule. Under the lock,
   an existing outcome record is compared on all caller-verifiable
   material; replay equivalence excludes the operation-assigned
   `record_id`, `created_at`, and `observation_evidence.evidence_id`. An
   exact replay returns the existing durable record without minting new
   ids/timestamps and without calling `publishRecord`; material divergence
   fails closed as a typed conflict. Opaque lifecycle/evidence ids and the
   timestamp are allocated ONLY in the no-existing branch.
6. **Result association semantics:** no result → absent association;
   validated result → quartet persisted durably even when publication is
   absent; published result → `ResultPublicationRecord` remains the
   authoritative publication fact (the outcome record never duplicates
   publication id/scopes) and is consistency-checked exactly against the
   outcome-record association (divergence fails closed). Required future
   WP-13C precondition: under its lock, before first publication or replay
   acceptance, WP-13C must locate the exact outcome record, require its
   `result_association`, exact-match the request/handoff (instance, digest,
   association mode, ValidationRecord id, workspace, bundle, occurrence,
   attempt), and independently re-check the passing ValidationRecord; no
   outcome record or mismatch → fail closed, no publication write.
   EXE-013 governs this WP-13 attempt-scoped evaluator-produced publication
   path only. A later-owned ADR-012 §8 supersession/correction publication
   (a `SupersessionRecord` prior or successor with subject type
   `result-publication`) is NOT a second WP-13 attempt result association
   and is governed by the committed supersession contract rather than being
   forced to equal the original outcome association; the exemption grants
   no competing second WP-13 result instance, does not weaken this S3
   first-publication precondition, and does not make the outcome record
   publication provenance.
7. **Observation evidence identity:** raw session/turn correlation ids are
   never used as `evidence_id`. The trusted host composition allocates one
   opaque `pgw:e:<32hex>` evidence identity per exact verified
   `PiExecutionObservation` through the committed trusted-local identity
   pattern (D-3), ONLY in the no-existing branch, bound by the canonical
   observation digest (`content_digest` — a binding, not an
   evidence-content store), validated for exact attempt correlation before
   trust, and made durable in the outcome record. One reference per
   observation. No shared external-evidence schema component is
   introduced; future schema work directly references the committed
   `evidence-reference.json` branch.
8. **Ordering:** durable `ExecutionAttemptRecord` → execution + genuine
   verified observation/outcome → OPTIONAL completion/ValidationRecord →
   outcome-record operation (acquire/release the attempt lock) →
   OPTIONAL `ResultPublicationRecord` (acquire/release the SAME lock) →
   retrospective derivation. The attempt-record → outcome-record interval
   may span the entire execution/completion operation.
9. **Crash outcomes:** attempt record without outcome record →
   `terminal-unverifiable`/receipt-ineligible, never inferred; outcome
   record without publication → facts fully cold-derivable (quartet,
   `null` publication, `[]` scopes), and pre-first-publication process
   loss is `terminal-unpublished` with NO automatic publication/completion
   rerun and no scheduler/resume protocol; WP-13C idempotent replay
   applies only when a durable publication already exists or a valid live
   publication invocation is actually available.
10. **Cold re-derivation:** WP-15 re-derives the exact 21-field fact-set
    from durable records only, per the field-source table in the decision
    report (§12). No process-local object is a required source; the
    project-visible `ExecutionResult` file is never trusted provenance;
    no fact-set is emitted for `terminal-unverifiable` attempts.

## Rationale

One attempt-scoped outcome record is the minimum durable protocol surface
satisfying the contract's byte-identical re-derivation requirement without
weakening it, without mutating WP-12 records, without trusting project
bytes, and without collapsing result/receipt separation. Reusing the
ADR-038 authority-domain pattern keeps every record-producing domain
narrow and singly owned; at-most-one eligibility and
`terminal-unverifiable` semantics keep the record honest (never
fabricated) across crash and post-recording failure paths.

## Consequences

- `ExecutionRetrospectiveFacts` becomes cold re-derivable for
  retrospective-complete attempts; `terminal-unverifiable` attempts are
  receipt-ineligible; `terminal-unpublished` publication dimensions are
  never auto-recovered.
- The lifecycle schema set (including `src/schema/select.ts`
  `LIFECYCLE_RECORD_TYPES` and the lifecycle selection map,
  `schemas/catalog.json`, regenerated `schema-bundle.ts`), record
  taxonomy, responsibility matrix, role vocabulary, glossary, storage
  read/enumeration allowlists, taxonomy types/count assertions, rule
  inventory (EXE-010…013), fixtures, WP-13 contract §5, closure-gate
  composition, and WP-13D implementation require the amendments listed in
  decision-report §14/§16 — none implemented by this ADR.
- WP-12, WP-13C publication authority (except the §11 precondition),
  ADR-012 result lifecycle, and receipt ownership (WP-15) are unchanged.

## Rejected Alternatives

1. **Weaken cold re-derivation to allow transient handoffs** — breaks
   §5.2/§5.6 and defeats audit verification.
2. **Mutate/extend `ExecutionAttemptRecord`** — violates immutability and
   WP-12 role boundaries; disposition is unknown at recording time.
3. **Derive from project-visible `ExecutionResult` bytes** — untrusted
   content cannot become trusted provenance (ADR-012).
4. **`ResultPublicationRecord` as the only result source** — publication
   may be absent; `association_mode` still lost for unpublished results.
5. **Multiple separate per-fact records** — larger surface, more authority
   domains and crash windows, no benefit over one attempt-scoped record.
