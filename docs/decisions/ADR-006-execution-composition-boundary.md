# ADR-006 — Execution Composition Boundary

## Status

Accepted

## Context

An execution needs an exact, reviewable selection of task intent, authority, context, and completion proof. If that selection is represented as a merged document, a fallback prompt, or an implicit latest-version lookup, the consumer cannot determine which semantics were actually proposed or whether one responsibility has overridden another.

WP-0 established `ExecutionBundle` as the artifact that identifies exact revisions for one proposed execution and prohibited it from becoming an approval, grant, or activation mechanism. WP-1 needs to define its composition boundary precisely.

## Decision

`ExecutionBundle` is the sole core aggregate that composes a proposed execution. A consumable MVP bundle MUST select exactly one compatible revision of each prospective core aggregate:

- one `TaskSpec`;
- one `AuthorityPolicy`;
- one `ContextManifest`; and
- one `CompletionContract`.

All four prospective artifacts MUST be present; an implicit default MUST NOT supply any of them. An explicit context manifest that selects no additional context is distinct from omitting context. `ExecutionResult` is retrospective and MUST NOT be a prospective bundle member.

A bundle composes exact references without copying, merging, reinterpreting, or replacing their semantics. It MUST NOT grant authority, approve or issue a referenced artifact, create a runtime grant, activate execution, or contain an unrestricted fallback prompt, policy, command, or replacement artifact. Activation remains a separate trusted local control-plane decision.

## Rationale

Exact non-merging composition preserves the meaning of every selected artifact and makes a proposed execution reviewable. Requiring all four prospective aggregates avoids dangerous implicit defaults, especially an absent authority policy, context boundary, or completion obligation.

Keeping activation outside the bundle ensures that a producer cannot turn a structured composition into a self-executing command. It preserves the trusted lifecycle boundary and lets downstream consumers resolve only the responsibility they support.

## Consequences

- Bundle validation MUST resolve each required reference to an exact compatible revision and reject missing, duplicate, unresolved, incompatible, circular, or unexpected dependencies.
- Changing any selected prospective revision requires a new bundle revision for a new proposed execution.
- Consumers MUST obtain task, authority, context, and completion semantics from their selected aggregates rather than from bundle metadata.
- Required extensions and consumer-neutral compatibility requirements MAY be declared only when they preserve the core composition and fail closed if unsupported.
- Reference syntax, revision identity format, lifecycle record format, and activation mechanics remain deferred to later work packages.

## Rejected Alternatives

1. **Merged executable job document:** Rejected because it erases responsibility boundaries and permits hidden authority or completion semantics.
2. **Optional authority, context, or completion artifact by omission:** Rejected because omission would create implicit defaults and ambiguity at the trust boundary.
3. **Bundle-embedded grant or activation flag:** Rejected because approval, grant, and activation are trusted local control-plane actions, not project-visible bundle content.
4. **Latest-revision or path-based selection:** Rejected because it cannot prove the exact content proposed for execution.
5. **Bundle fallback prompt or policy:** Rejected because hidden fallback semantics would let the bundle override referenced artifacts.
