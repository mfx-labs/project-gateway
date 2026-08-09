# ADR-038 — WP-13 Result Publication Authority Domain

## Status

Accepted (proposed by the WP-13 pre-implementation contract decision;
`docs/reports/wp-13-pre-implementation-contract-decision.md`; documentation
only — no implementation authorized by this ADR). Focused contract
corrections SCR-WP13-002/003/005/006 applied (validation-record path,
publication replay idempotence, publication concurrency/atomic
uniqueness, and the attempt-level publication lock domain
below); no architectural change to this
decision.

## Context

ADR-012 and the trusted-lifecycle protocol require that every
evaluator-produced `ExecutionResult` instance be attested by a trusted
`ResultPublicationRecord` binding evaluator provenance, the unique result
instance, validation, and the exact bundle/workspace/occurrence/attempt
association. The committed lifecycle schema fixes the producing role as
`trusted-result-publisher`
(`schemas/lifecycle/1.0/records/result-publication-record.json`), but no
authority domain is assigned production of that record:

- the WP-12 control-plane store boundary is confined to its committed
  eight-class allowlist and explicitly excludes `result-publication-record`
  (WP-12 "never produces results/summaries"; `src/control-plane/store-boundary.ts`);
- the WP-11 controlled-writing boundary explicitly excludes `ExecutionResult`
  persistence;
- the WP-8 storage layer never invents provenance and publishes only through
  exact-record permits held by trusted authority domains.

WP-13 owns end-to-end execution and result collection, but must not gain
generic lifecycle authority, must not issue `TrustedReceipt` (WP-15 owns),
and must not widen the committed WP-12 or WP-8 boundaries. A durable
decision is required on the trusted authority domain that may produce the
`ResultPublicationRecord` and the existing write primitive/path it uses.

## Decision

1. **The result publisher is a new narrow trusted authority domain: the
   result-publication authority, role `trusted-result-publisher`**
   (the schema-committed `responsible_role`). It is host-side, has a single
   trusted owner (the WP-13 host execution composition), and mirrors the
   committed recovery/retention authority-domain structure:
   - result-publication action provenance (branded; domain-separated
     identity domain `PGAP-EXECUTION-RESULT-PUBLICATION-PROVENANCE-v1`);
   - a trusted result-publication request supplied by the WP-13 completion
     evaluator;
   - a result-publication capability (module-private brand, generation-bound
     per CAP-008…CAP-016, minted only by the trusted host composition —
     zero production producers outside it);
   - an exact-record publication permit (role `result-publication`;
     sink-level confinement preserved).
2. **The authority produces exactly one record class:
   `ResultPublicationRecord`.** It may never produce or mutate approval,
   issuance, revocation, grant, activation, occurrence, attempt, receipt,
   configuration, evidence-kind, or any other record class; it performs no
   deletion, no retention action, no lock mutation, no registry-index
   mutation, and no lifecycle decision.
3. **The authority uses the existing WP-8 exact-record publication path** —
   the committed `publishRecord` primitive (single-writer lock, durable
   record publication, mechanical authorized-write audit D-6, exact registry
   context binding) — consumed through a dedicated boundary confined to the
   one `ResultPublicationRecord` class, exactly as the WP-12 control-plane
   store boundary wraps `publishRecord` for its eight classes. No new
   storage machinery, no new lock protocol, no write-path bypass, no
   capability or provenance widening. **Publication replay idempotence
   belongs to this narrow boundary (SCR-WP13-003):** the boundary
   read-verifies before publishing — an exact replay of the same
   publication identity/content/bindings/scope/registry context is
   recognized against the already-valid durable record and creates no
   second publication record; any differing result instance,
   revision/digest, provenance, validation-record id,
   bundle/workspace/occurrence/attempt binding, registry context, or scope
   is a publication conflict and fails closed before any write. WP-8
   storage semantics are unchanged.

   **The uniqueness/idempotence operation is one host-coordinated atomic
   decision (SCR-WP13-005; lock domain corrected by SCR-WP13-006):** the
   boundary acquires the existing trusted
   host-side coordination lock for the exact **attempt-level uniqueness
   subject**
   (workspace, bundle, occurrence, attempt — the
   publication decision key, in the WP-12 §15 coordination-lock pattern).
   `result_instance` MUST NOT participate in the lock key: it is compared
   as proposed publication data UNDER the lock.
   AFTER acquiring it MUST re-read and re-verify the current trusted
   lifecycle/registry context, **the publication/result-association state
   for the ENTIRE exact attempt** — the lookup MUST discover ANY existing
   evaluator-produced publication/result association for that attempt,
   regardless of its result-instance identity — evaluator provenance,
   `ValidationRecord` identity, result revision/digest,
   bundle/workspace/occurrence/attempt bindings, and publication scopes.
   Under the lock: no existing publication/result association → publish
   exactly one record
   through `publishRecord`; an exact existing publication with the SAME
   result instance and all identical
   identity/content/bindings/scope/registry context → idempotent success
   using the existing durable record, no write; an existing
   publication/result association with a DIFFERENT result instance, or
   the same result instance with any other material divergence → typed
   publication conflict, fail closed, no write. The
   attempt-level lock remains held through the uniqueness decision and the
   `publishRecord` call/outcome, so a second concurrent invocation
   re-reads under the same lock and observes either the exact durable
   publication (idempotent replay) or a conflicting durable publication
   (conflict). Different attempts use independent attempt-level
   coordination keys; no unnecessary serialization across attempts. No
   deterministic/content-derived lifecycle record ID is
   introduced (none is required by committed record semantics). WP-8
   `publishRecord` semantics remain unchanged; atomic uniqueness belongs
   to the narrow result-publication authority boundary.
4. **Publication preconditions** (ADR-012 and protocol, not restated as new
   semantics): one unique result instance per exact
   workspace/bundle/occurrence/attempt, originated or adopted only after
   structural and semantic validation with a passing result `ValidationRecord`
   produced through the committed WP-12 **`recordValidation`** path
   (SCR-WP13-002: WP-13 supplies the accepted WP-4 validation result through
   the existing WP-12 operation; WP-12 remains the trusted
   producer/recorder; the authority consumes the durable identity and
   requires the exact passing id before publication);
   exact evaluator provenance (`evaluator_id`, `capability_profile_id`);
   exact bindings (result revision/digest, bundle, workspace, occurrence,
   attempt); exact registry snapshot context; current trusted state
   re-verified at publication time; EXE-009 — a denied reservation never
   produces an evaluator-produced result association; a second distinct
   result instance for one attempt fails closed.
5. **WP-13 result publications carry `ordinary-review` scope only.** The
   receipt-correlated scopes (`completion-status`, `downstream-automation`,
   `authoritative-reporting`) require exact matching `TrustedReceipt`
   correlation and remain WP-15-owned; WP-13 never issues or correlates
   receipts for publication. Publication is neither a trusted receipt nor a
   prospective authorization decision (ADR-012).
6. **The publisher never rewrites the retrospective body**, never becomes
   the receipt producer, never grants authority, never activates execution,
   and never auto-reactivates enforcement. The evaluator remains the result
   producer; the trusted publisher attests provenance only.

## Rationale

ADR-012 requires trusted publication but assigns no producer; WP-12 and
WP-11 boundaries exclude it by committed contract. The existing WP-8
authority-domain pattern (recovery, retention, configuration recovery) is
the committed, reviewed shape for a trusted producer of one record class
with branded provenance and exact-record permits; reusing `publishRecord`
avoids new storage machinery while keeping provenance trusted-local.
Restricting WP-13 publication to `ordinary-review` preserves the
result/receipt separation (F-08, ADR-012, EXE-008) and keeps every
authority-conferring or automation-driving consumption path behind WP-15
receipt correlation.

## Consequences

- `ResultPublicationRecord` production has exactly one trusted owner
  (role `trusted-result-publisher`, WP-13 result-publication authority).
- WP-12, WP-11, WP-8 committed boundaries are unchanged; no allowlist is
  widened.
- WP-13 implementation gains no generic lifecycle authority; its only
  trusted-store production is the single publication-record class through
  the WP-8 `publishRecord` path.
- `SupersessionRecord`/`RevocationRecord` for result publications and
  `ExecutionSummaryRecord` remain later-owned; nothing in this ADR assigns
  or authorizes their production.
- The WP-13 retrospective-facts interface (Decision 3 of the contract
  decision) remains evidence-only and is unaffected by this ADR.

## Rejected Alternatives

1. **WP-12 control plane produces the record.** Rejected: would widen the
   committed eight-class control-plane allowlist and conflate prospective
   lifecycle decisions with retrospective result reporting (ADR-012).
2. **WP-8 storage self-attests provenance.** Rejected: storage never
   invents provenance; the record must be produced by an authority domain
   that verifies evaluator provenance and bindings.
3. **Untrusted host write of the record.** Rejected: provenance must be
   trusted-local; only the trusted authority domain may publish.
4. **WP-13 publications carry receipt-correlated scopes.** Rejected:
   receipt correlation is WP-15-owned (F-08, EXE-008); WP-13 must not
   collapse result and receipt semantics.
