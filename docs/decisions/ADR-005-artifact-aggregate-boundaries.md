# ADR-005 — Artifact Aggregate Boundaries

## Status

Accepted

## Context

WP-0 established six separate artifact responsibilities but deferred the domain model needed to preserve them across revisions, validation, composition, and consumer use. Without explicit aggregate boundaries, a later schema or adapter could merge task instructions, authority, context, completion proof, execution selection, and retrospective outcomes into one unrestricted job document.

The protocol needs conceptual units that can evolve independently while retaining exact composition and clear responsibility ownership.

## Decision

`TaskSpec`, `AuthorityPolicy`, `ContextManifest`, `CompletionContract`, `ExecutionBundle`, and `ExecutionResult` are six independent domain aggregates with non-overlapping sole responsibilities.

Each aggregate has its own conceptual instance, immutable revisions, content boundary, validation obligations, lifecycle relationship, permitted consumers, and invariants. A change to one aggregate creates a new revision of that aggregate only. It MUST NOT silently change another aggregate's responsibility or selected revision.

The four prospective aggregates—task, authority, context, and completion—have no direct core-artifact dependencies on one another. `ExecutionBundle` is the sole prospective composition aggregate, and `ExecutionResult` is a separate retrospective aggregate. An aggregate MUST NOT embed, override, or use another aggregate's responsibility as fallback semantics.

## Rationale

Aggregate separation makes least privilege and reviewability durable across future schemas and adapters. It prevents task wording from becoming authority, prevents context from becoming instruction, prevents completion requirements from becoming execution permission, and prevents a result from rewriting the requirements it reports against.

Independent aggregates also make revision selection explicit. A policy can narrow without changing task intent, a completion contract can evolve without rewriting authority, and a new bundle can select a compatible new set without mutating historical compositions.

## Consequences

- Later protocol work MUST preserve kind, instance, revision, and aggregate distinctions.
- Validators MUST check both an aggregate's own responsibility and cross-aggregate compatibility without merging semantics.
- A change to a prospective revision used by an execution requires a new `ExecutionBundle` revision for any new proposed execution.
- Consumers receive only the responsibilities they support through consumer-specific adapters.
- New functionality that introduces an independent responsibility, lifecycle relationship, producer, or consumer contract requires a registered extension or a new artifact kind; it MUST NOT be smuggled into a core aggregate.

## Rejected Alternatives

1. **One unrestricted job document:** Rejected because it would conflate instructions, authority, context, completion, composition, and results.
2. **Embed authority in `TaskSpec`:** Rejected because task producers must not grant permission through instructions.
3. **Use `ContextManifest` or `CompletionContract` as task extensions:** Rejected because context selection and proof obligations have independent responsibilities.
4. **Use `ExecutionResult` to update prospective artifacts:** Rejected because retrospective observation must not redefine the task, authority, context, completion contract, or bundle.
5. **Let adapters define common artifact semantics:** Rejected because Pi-, pi-guard-, or future-consumer behavior would pollute the consumer-neutral core model.
