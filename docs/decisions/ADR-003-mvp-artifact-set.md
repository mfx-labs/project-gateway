# ADR-003 — MVP Artifact Set

## Status

Accepted

## Context

A single unrestricted job document would blur task intent, permission, context selection, completion proof, execution composition, and execution evidence. That ambiguity could let instructions or repository content be mistaken for authority, or let a result be mistaken for proof that a task was authorized and complete.

The first downstream consumers are a Pi task adapter, a pi-guard authority adapter, and a completion evaluator. They need a stable, consumer-neutral separation of responsibilities before detailed protocol work begins.

## Decision

The MVP artifact protocol consists of these six distinct artifact kinds:

| Artifact kind | Responsibility | Must remain separate from |
| --- | --- | --- |
| `TaskSpec` | What the agent must do | Authority, context authorization, completion evidence, and execution results |
| `AuthorityPolicy` | What the agent is allowed to do | Task intent, trusted capability ceilings, approval, issuance, and activation |
| `ContextManifest` | What context the consumer must or may load | Task instructions, authority, and ordinary access-policy bypasses |
| `CompletionContract` | How completion is proven | Execution instructions, authority, and observed execution results |
| `ExecutionBundle` | Which exact artifact revisions form one execution | An implicit grant, approval, activation, or unrestricted merged job document |
| `ExecutionResult` | What occurred during execution | Prospective completion requirements, authority, approval, issuance, and trusted local receipts |

A `TaskSpec` MUST NOT grant permission. An `AuthorityPolicy` MAY narrow authority only within trusted global and workspace capability ceilings and MUST be approved and issued through the trusted local control plane before use. A `ContextManifest` identifies required or optional context; it does not convert that context into instructions or authority. A `CompletionContract` defines evaluation expectations before execution, while an `ExecutionResult` records observed outcomes after execution.

An `ExecutionBundle` binds exact revisions of the participating artifacts for a proposed execution. It does not collapse their semantics and does not itself authorize execution. Approval, issuance, revocation, runtime grants, and execution receipts remain trusted local state outside the repository.

Detailed artifact semantics, complete field definitions, JSON Schemas, canonicalization rules, reference formats, and validation rules belong to later work packages and are explicitly not defined by this ADR.

## Rationale

Separating concerns limits the impact of each artifact and allows each consumer to receive only the responsibility it needs. It prevents task wording from becoming a permission grant, prevents a context list from becoming an instruction channel, and keeps completion evidence distinct from completion requirements.

The separation also supports future adapters. Pi-specific, Codex-specific, Cline-specific, reviewer-specific, and release-specific behavior can be added through adapters or registered extensions without changing the common meaning of core task, authority, context, completion, bundle, and result artifacts.

## Consequences

- Producers and consumers MUST identify artifact kind and version explicitly in later protocol work.
- Cross-artifact validation MUST preserve responsibility boundaries instead of accepting an unrestricted composite document.
- The Pi task adapter consumes task and context responsibilities; pi-guard consumes authority; the completion evaluator produces execution results against completion requirements.
- `ExecutionResult` remains a structured artifact/report and does not replace a trusted local receipt.
- Later work MUST define how revisions are selected and how the control plane verifies their approval and issuance without placing authoritative lifecycle state in project-visible documents.

## Rejected Alternatives

1. **One generic job or agent document:** Rejected because it combines instructions, authority, context, and outcomes in a way that cannot preserve least privilege or clear ownership.
2. **Embed authority in `TaskSpec` or prompt text:** Rejected because task producers must not be able to grant permissions through instructions.
3. **Treat `ContextManifest` entries as executable instructions:** Rejected because context selection and work direction are different responsibilities.
4. **Use `ExecutionResult` as the completion contract or trusted receipt:** Rejected because results are retrospective artifact content, while proof requirements are prospective and receipts are trusted local runtime records.
5. **Define complete schemas in WP-0:** Rejected because WP-0 establishes boundaries and principles; detailed protocol and schema work is deferred to later work packages.
