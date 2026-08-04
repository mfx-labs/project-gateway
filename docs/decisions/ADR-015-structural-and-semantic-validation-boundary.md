# ADR-015 — Structural and Semantic Validation Boundary

## Status

Accepted

## Context

WP-0 through WP-2 require strict validation without allowing schema validity to become lifecycle authority. Some requirements are local JSON structure; others require canonical byte computation, identity registration, cross-artifact resolution, trusted workspace/registry state, lifecycle facts, evaluator provenance, or point-of-use conditions.

## Decision

WP-3 separates validation into ordered structural, semantic, and trusted phases.

Structural validation covers raw JSON intake, duplicate-member rejection before ordinary object construction, Unicode/NFC and safe-integer preconditions, local schema selection, Draft 2020-12 validation, canonical set ordering, canonicalization, and derived digest verification.

Semantic validation covers responsibility boundaries, identity/lineage, exact references, workspace compatibility, registry compatibility, extension/support compatibility, and other cross-subject requirements. Trusted lifecycle validation covers exact external records, current revocation/validity, activation/occurrence/attempt cardinality, evaluator provenance, unique result-instance association, publication, receipt correlation, and point-of-use eligibility.

The normative phase order is recorded in `docs/design/structural-validation-profile.md` and the manifest records the actual first failing phase of every fixture. A fixture declared at a later phase must pass every earlier required phase first; a fixture must not claim coverage for a later-phase rule when an earlier phase already rejects it. Where the V1 closed schema eliminates every representable violation of a rule, the rule’s fail fixture is declared at the structural phase and the rule remains cataloged for later-phase cross-subject and trusted-state enforcement. JSON Schema is never stretched to weaken a cross-record or natural-language/trust-boundary invariant.

No validation phase approves, issues, grants, activates, publishes, establishes evaluator provenance, registers a workspace, or creates a trusted receipt. Those facts require separate trusted local control-plane records outside managed repositories.

## Rationale

The boundary makes schema behavior deterministic while preserving rules that JSON Schema cannot safely enforce. It prevents a validator or producer from converting a pass result into authority and requires current trusted checks at each privileged use.

## Consequences

- The semantic rule catalog is normative alongside the schemas.
- A future Artifact Core must implement every applicable phase, not only JSON Schema validation.
- Duplicate keys and NFC are handled before JCS; input is rejected rather than silently repaired.
- Exact resolution, lifecycle, registry, consumer support, and point-of-use checks remain fail-closed even for schema-valid content.
- Fixtures identify phase and stable failure category rather than implementation exception text.

## Rejected Alternatives

1. **JSON Schema only:** Rejected because it cannot establish registrar state, JCS digest correctness, trusted lifecycle facts, or all cross-record invariants.
2. **Semantic checks before raw/canonical validation:** Rejected because semantics must operate on the same accepted data model as digest/reference consumption.
3. **Validation implies approval or publication:** Rejected because conformance is not trusted lifecycle authority.
4. **Silent Unicode normalization before validation:** Rejected because it can make validators and consumers reason about different content.
5. **One post-parse best-effort phase:** Rejected because it permits parser ambiguity, target substitution, and stale trusted-state shortcuts.
