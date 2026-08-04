# ADR-008 — Artifact Identity and Revision Lineage

## Status

Accepted

## Context

WP-1 distinguished artifact kind, instance, revision, and reference but intentionally deferred identifier, succession, digest, and lineage mechanics. Later protocol work needs immutable identity without treating a path, filename, producer assertion, Git revision, or mutable alias as proof of continuity or authority.

## Decision

Project Gateway uses separate opaque instance IDs and revision IDs. An instance ID uses `pgw:i:` plus 128 random bits; a revision ID uses `pgw:r:` plus 128 random bits. Both are globally unique, non-reusable protocol identifiers and are assigned or accepted by a trusted local identity registrar only after structural envelope validity. They do not encode time, workspace, kind, path, producer, lifecycle state, or authority.

Revision ID is distinct from canonical digest. A revision binds exactly one kind, instance, canonical projection, and digest. The digest covers instance ID, revision ID, generation, and predecessor.

A generation-zero revision creates an instance and has no predecessor. Any later revision has exactly one exact predecessor reference to the same kind and instance, with generation one greater than its predecessor. Workspace binding is an instance invariant: predecessor and successor have the same portable/bound mode and, when bound, the same exact workspace ID. Branches are allowed; lineage merges are prohibited. A producer may propose identity or lineage, but the identity registrar and semantic validator must verify identity, lineage, and binding continuity. A predecessor never transfers approval, issuance, grant, activation, publication, or other lifecycle authority.

A canonical-content change creates a new revision. An issued revision cannot be amended in place. Import or migration that changes canonical content, identity, semantics, binding mode, or bound workspace ID creates an explicit new generation-zero protocol subject with no artifact predecessor and requires separate trusted migration correlation. A migration record is not lineage and no lifecycle state transfers implicitly.

## Rationale

Separate registered identity and digest verification preserve logical continuity, immutable byte verification, and exact references without collapsing them into path or body similarity. A one-parent model makes history auditable and prevents lifecycle ambiguity from multi-parent merges.

## Consequences

- Identity registration must reject collisions, reuse, wrong-kind reuse, false predecessor references, generation gaps, and unavailable required identity state.
- Exact references must bind instance ID, revision ID, digest, kind/version, protocol version, and workspace binding; predecessor resolution must reject binding mutation or cross-workspace lineage.
- A byte-identical mirror remains the same subject; a new content-bearing document is not allowed to impersonate it through its filename or display metadata.
- Lifecycle records bind exact revision identity and digest rather than an instance, path, alias, or lineage family.
- Correcting an artifact creates a new revision and, where used by a bundle, a new bundle revision; changing workspace binding instead creates a new instance with no predecessor.

## Rejected Alternatives

1. **Path-, filename-, branch-, or Git-based IDs:** Rejected because mutable storage does not identify immutable content.
2. **Digest-only revision identity:** Rejected because it erases the required distinction among instance, revision, and digest.
3. **Producer-declared identity accepted without registrar checks:** Rejected because a producer claim cannot safely establish continuity or collision-free reference resolution.
4. **Workspace change as a later revision:** Rejected because a bound workspace or portable/bound mode is immutable for an instance and a change would make lineage/reference scope ambiguous.
5. **Multiple predecessor/merge lineage:** Rejected because it creates ambiguous inheritance and audit semantics.
6. **Automatic content-similarity succession:** Rejected because semantic similarity is not a trustworthy identity decision.
