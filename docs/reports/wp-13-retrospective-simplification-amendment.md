# WP-13 Retrospective Simplification Amendment

**Status:** DOCS-ONLY CONTRACT AMENDMENT — COMPLETE (S1/S2/S3 baselines
committed and CLOSED; this amendment changes no source, schema, fixture,
test, or runtime code). S4 implementation NOT STARTED / NOT AUTHORIZED.
**Baseline:** HEAD `69b19c811e3eac0d5ea794e26eaf9fe859f939ea` (branch
`main`; `feat: establish WP-13 durability S3 production`).
**Applies to:** the derived `ExecutionRetrospectiveFacts` view only.
No other JCS/hash/canonical requirement (durable records, observation
evidence, artifact identity, permits, coordination, publication) is
affected.

## 1. Motivation

The pre-durability retrospective assurance model required TWO independent
derivation engines (WP-13 emits the fact-set; WP-15 re-derives it) and
proved equivalence with a cross-engine **byte-identical** comparison
backed by a canonical-byte content identity
(`PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1`). Once S1–S3 made every
retrospective input durably trusted (the `ExecutionOutcomeRecord` +
committed records), a second independent engine and a canonical-byte
identity add assurance duplication without adding durability: the
durability property that matters is that a fresh process can reconstruct
the same **semantic** 21-field view from trusted durable records. This
amendment replaces the byte-equality assurance machinery with one shared
pure derivation primitive and a structural semantic-equality proof target.

## 2. Old model (superseded as normative)

- WP-13 and WP-15 independently derive the same fact-set (two engines).
- JCS/canonical byte serialization of `ExecutionRetrospectiveFacts`.
- Byte-identical WP-13 ↔ WP-15 proof.
- Retrospective fact-set content hash/identity
  (`PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1`) used solely for that
  cross-engine equality proof.

## 3. New model (normative)

- **ONE shared pure retrospective derivation function**, conceptually
  `deriveExecutionRetrospectiveFacts(durableState)` (exact naming and
  module placement are S4 implementation decisions).
- WP-13 S4 implements the primitive; WP-13 uses it for retrospective
  facts; **WP-15 later reuses the SAME primitive** — WP-15 does NOT
  implement a second independent transformation engine.
- The fixed 21-field `ExecutionRetrospectiveFacts` **semantic object**.
- Derivation exclusively from trusted durable state.
- Repeated/cold derivation of the same valid durable semantic state
  produces **structurally equal field values**.
- **Semantic equality, not canonical-byte equality.**

## 4. Preserved invariants (NOT weakened)

- Fixed 21-field shape and all field grouping/nullability invariants
  (top-level keys always present; `null` for unavailable
  scalars/references; `[]` for empty collections; grouped-field
  consistency; no `undefined`/alternate absence sentinel).
- Durable trusted-state-only sourcing; no process-local
  outcome/observation/handoff dependency; the project-visible
  `ExecutionResult` file is never trusted provenance.
- Cold-process re-derivation from trusted durable records only.
- Pure/read-only derivation (no persistence, no store mutation, no
  authority event).
- `terminal-unverifiable` → NO retrospective facts (valid lifecycle
  state; receipt-ineligible; no inferred recovery).
- `terminal-unpublished` → result association retained, publication id
  `null`, publication scopes `[]`.
- `ExecutionOutcomeRecord` durability and the S1/S2/S3 authority,
  locking, replay, and WP-13C publication-precondition semantics —
  untouched. No S1–S3 protocol redesign.
- Exact durable references (identities/digests, never paths) unchanged.

## 5. Removed as normative retrospective requirements

- Separate WP-13 and WP-15 derivation engines (WP-15 must reuse the
  shared primitive).
- Cross-engine byte-identical comparison.
- JCS requirement for the retrospective fact-set itself (the fact-set is
  a semantic object; JCS/NFC remain normative for actual durable
  records, observation evidence, artifact identity, permits,
  coordination, and every other committed security boundary).
- SHA-256/content-derived retrospective-facts identity
  (`PGAP-EXECUTION-RETROSPECTIVE-FACTS-v1`) where its only purpose was
  cross-engine equality.
- The requirement that derivation time produce a canonical byte
  identity.

## 6. Semantic equality contract (pinned)

For the same valid durable semantic state, repeated derivation MUST
produce an object whose 21 contract-defined fields are structurally
equal:

- scalar values equal;
- exact durable references equal;
- `null` retains its defined absence meaning;
- `[]` retains its defined absence meaning;
- array contents/order equal where ordering is normative.

No derivation timestamp, random identity, operation-time state, or other
entropy may enter the facts. A normal structural equality assertion
(`deepStrictEqual`) is sufficient; canonical serialization/hash equality
is not required.

**Cold restart proof target:** `same durable semantic state -> deep
structural equality` (a fresh process with only the required trusted
durable records must obtain the same semantic 21-field object) — NOT
`same durable state -> same JCS bytes/hash`.

## 7. Shared ownership

| Item | Owner |
|---|---|
| Shared pure derivation primitive (S4 implementation) | WP-13 S4 |
| Retrospective facts use | WP-13 (S4) |
| Later reuse of the SAME primitive | WP-15 |
| Second independent transformation engine | FORBIDDEN |
| Receipt eligibility decision | WP-15 (unchanged) |
| Trust checks / event & disposition mapping | WP-15 (unchanged) |
| Receipt issuance authority | WP-15 (unchanged) |

Sharing the pure derivation primitive does NOT allow WP-15 to trust
project-visible files or process-local assertions; WP-15's own trust
boundary is unchanged.

## 8. S4 contract after amendment

S4 is now bounded to:

1. implement the single shared pure derivation function;
2. source all 21 fields from trusted durable records (the §12
   durable-source mapping of the closure durability decision);
3. cover `terminal-unverifiable` (no fact-set) and
   `terminal-unpublished` (association retained; `null` publication id;
   `[]` scopes) semantics;
4. prove cold restart from durable state;
5. test structural semantic equality;
6. fail closed on ambiguous/corrupt durable state;
7. expose the same primitive for later WP-15 reuse.

No second derivation engine. No retrospective JCS/hash identity
machinery. No receipt production, no WP-14/WP-15 scope.

## 9. Explicit non-impact on S1/S2/S3

- S1 schema/taxonomy/rules/corpus: unchanged (the fact-set is a derived
  view; no schema change).
- S2 outcome authority boundary: unchanged (one-class sink, exact
  permit, generation semantics).
- S3 outcome production / WP-13C precondition: unchanged (Model-1 lock,
  replay/cardinality, allocation timing, mint confinement, publication
  precondition all untouched).
- `ExecutionOutcomeRecord` remains the durable source of
  disposition/observation/result-association facts.
- ADR-012 §8 supersession behavior unchanged.

## 10. Documents changed

- `docs/reports/wp-13-retrospective-simplification-amendment.md` — this
  amendment record (new).
- `docs/reports/wp-13-pre-implementation-contract-decision.md` —
  amendment note; §5.2 determinism rule (semantic equality; identity
  retired); §5.3 canonicalization row → semantic-equality contract;
  §5.4 heading renamed (structural validation / semantic-equality
  expectations) + timestamp-free wording; §5.6 shared-primitive reuse;
  §7 closure-gate test-list wording (fact-set structural semantic
  equality); §9 SCR-WP13-001 ledger row.
- `docs/reports/wp-13-closure-durability-architecture-decision.md` —
  header amendment note; §1 problem statement (byte-identity proof
  retired); §12 cold re-derivation note (semantic equality); §18
  acceptance record.
- `docs/decisions/ADR-039-wp-13-execution-outcome-record.md` — §5 item
  10 (shared primitive; WP-15 reuse); rationale (semantic-equality
  re-derivation requirement).
- `docs/design/post-wp5a-planning-status.md` — current-state note
  (amendment complete at contract level; S4 NOT STARTED / NOT
  AUTHORIZED).

Historical reports that recorded the old decision (e.g., the WP-13D
retrospective-facts report and prior durability reports) are preserved as
historical records; where they remain current-normative they are amended
above. The superseded untracked WP-13D paths are untouched.

**Review-finding closure (focused contract review):**
SCR-WP13-RETRO-SIMPL-001 — MINOR — CLOSED by bounded wording cleanup:
§7 closure-gate test-list "fact-set canonicalization" → "fact-set
structural semantic equality"; §5.4 heading renamed (no canonical-byte
implication). No semantic contract change; no further review cycle
required.

## 11. Remaining S4 closure criteria

- S4 implementation of the shared primitive with the §12 durable-source
  mapping; cold-restart semantic-equality proof; fail-closed corrupt
  handling; WP-15 reuse exposure. S4 requires explicit human
  authorization and remains NOT STARTED. WP-13 remains NOT CLOSED;
  WP-14/WP-15 remain blocked.

---

**WP-13 RETROSPECTIVE SIMPLIFICATION AMENDMENT COMPLETE — READY FOR FOCUSED CONTRACT REVIEW**
