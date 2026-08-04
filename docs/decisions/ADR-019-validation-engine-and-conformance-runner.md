# ADR-019 — Validation Engine and Conformance Runner

## Status

Accepted

## Context

WP-3 defines an ordered 13-phase validation pipeline, 114 semantic rules, and a
531-entry conformance manifest that is an executable oracle. WP-4 must execute
the corpus and report deterministic results.

## Decision

- **Validator:** Ajv 8.20.0 pinned as the sole runtime dependency, configured for
  Draft 2020-12 with all 51 schema resources registered by exact `$id` from the
  embedded catalog. Network retrieval is structurally impossible (the loader
  throws); `format` is annotation-only; errors are mapped to stable WP-3
  failure categories and never leak as the protocol API.
- **Schema registry:** per-instance registries (no shared global state); catalog
  `$id` consistency, meta-validation, and eager compilation at construction.
- **Rule dispatch:** all 114 rule IDs are registered with stable phases,
  categories, and an implementation-owned enforcement classification
  (evaluator, structural, graph, raw, canonical, or pipeline). The dispatch
  source is the registered rule table; structurally enforced rules are mapped
  from schema resource + validator keyword + path (`src/internal/structural-map.ts`),
  never from the conformance manifest.
- **Validation levels:** wrappers carry an explicit validation level; `self`,
  controlled (`through` required), and `for-use` operations are distinct, and
  for-use validation uses every supplied decision input and fails closed on
  missing required dependencies.
- **Exact phase gates:** the artifact pipeline stops exactly at the requested
  `through` phase (`canonical-input-validation`, `schema-identification`,
  `structural-schema-validation`, `canonicalization-and-digest-verification`,
  `identity-registration`, `semantic-self-validation`,
  `registry-compatibility`); `registry-compatible` is assigned only after
  actual registry and consumer-support evaluation, missing registry inputs
  fail closed, and later lifecycle/point-of-use levels are assigned only after
  those phases execute in their own entry points.
- **Identity modes:** phase 6 never mixes proposed registration with
  existing-registration verification. `checkProposedRegistration` runs only at
  the explicit `identity-registration` gate (instance/revision/digest/
  predecessor/generation conflicts; never mutates state);
  `verifyExistingRegistration` confirms the instance, revision, digest,
  generation, predecessor, and workspace binding of an already registered
  subject and never rejects a valid registered genesis as new reuse.
  `validateArtifactForUse` uses verification mode only.
- **Exact-reference profiles:** references are validated against the approved
  exact-reference schema (unknown members rejected) and separated by purpose.
  Self resolution revalidates the resolver output through self-semantic
  validation and never claims registry compatibility; for-use resolution
  additionally requires the accepted registry context and consumer support,
  revalidates through registry compatibility, fails closed on absent required
  inputs, denies unsupported required extensions/features, and returns
  `registry-compatible` only after actual registry evaluation. No `skipIdentity`
  path bypasses verification.
- **Graph validation:** lifecycle rules evaluate caller-supplied records as a
  graph (approval/issuance separation, activation cardinality and terminality,
  occurrence/attempt ordering, retry stability, receipt facts, publication
  competition and supersession, migration without lifecycle transfer, registry
  context continuity). Findings are attributed only to entry-owned records;
  attempt-ordinal checks use the valid attempt context plus entry attempts.
- **Conformance runner (fully oracle-independent):** loads the embedded
  manifest and corpus, validates dependency metadata, evaluates entries in
  deterministic order, executes only the phases applicable to each declared
  outcome, and compares actual outcome, first failing phase, failure category,
  rule IDs, and schema ID against expected values read only after execution.
  Schema-resource (`SCH-*`) fixtures resolve their execution target from an
  implementation-owned fixture-path → catalog mapping (never
  `expected_schema_id`); canonical-vector entries return an actual evaluation
  object (success/failure, phase, category, rule IDs, canonical projection,
  canonical UTF-8, digest, rejection reason) and `RULE-*` vector entries are
  routed through the same common comparison as all other entries. Expected
  values are never copied into actual findings; altering any expected value
  (schema ID, rule ID, category, phase, pass/fail, or digest) produces a
  mismatch. Mismatches are reported by fixture ID with a stable reason; no
  fixture is skipped and no fixture-ID branch exists.
- **Point-of-use lifecycle chain:** point-of-use evaluation begins from the
  exact verified `ExecutionBundle` and its exact trusted lifecycle chain;
  missing `RuntimeGrant`, missing lifecycle state, and unrelated lifecycle
  records (never evaluated) are handled fail-closed; every grant
  `narrowed_constraint` is enforced; findings are sorted before the first
  failing phase is selected.
- **Insertion-order-independent protocol equality (W4-F1):** workspace
  bindings, exact artifact references, and ExecutionBundle references are
  compared by explicit protocol fields through the authoritative comparators
  in `src/internal/protocol-equality.ts`; cross-artifact member-binding
  compatibility, lineage binding continuity, migration binding checks, and
  lifecycle retry stability never depend on JSON member insertion order, and
  ordinary `JSON.stringify` is not a protocol equality mechanism.
- **Error model:** typed `ValidationReport`s with findings sorted by phase,
  category, rule ID, subject identity, location, and message key. Expected
  invalid input returns reports; programmer errors throw but are never
  presented as conformance failures.

## Rationale

A pinned, offline, `$id`-registered validator plus deterministic rule and graph
evaluation makes the corpus executable and the reports stable across
independent library instances.

## Consequences

- The runner executes the complete committed corpus (531/531 with zero
  mismatches after the approved WP-3 fixture erratum); mismatches are reported
  visibly, never skipped or hidden.
- Future protocol changes must update the catalog, fixtures, vectors, and the
  runner's expectations consistently.
