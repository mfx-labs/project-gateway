# Project Gateway MCP Glossary

This glossary defines WP-0 terms. It establishes conceptual boundaries, not field-level schemas, persistence formats, or API contracts.

## Artifact

A structured protocol document governed by an artifact-kind contract. The term may be qualified to distinguish an artifact kind, artifact instance, and artifact revision. Artifact content is project-visible data unless a separate trusted local record establishes a lifecycle state. An artifact does not gain authority merely by existing, validating, or being stored in a particular path.

## Artifact Kind

One stable protocol responsibility, such as task intent or authority constraints. A kind is distinct from an artifact instance and revision, and it does not imply approval, issuance, authority, or consumer support. Serialized kind syntax is deferred.

## Artifact Instance

The conceptual identity of one logical artifact across one or more revisions. Instance identity is distinct from content identity and cannot be proven by a path, filename, branch, directory, or producer assertion. Identifier format and succession rules are deferred.

## Artifact Draft

A proposed artifact revision created by a producer, including ChatGPT Web. A draft is untrusted content and has no approval, issuance, grant, or activation authority. A draft may later pass validation, but a validated draft remains unapproved until trusted local approval is bound to its canonical digest.

## Validated Artifact

An artifact draft that has passed applicable structural and semantic validation. Validation establishes conformance only. A validated artifact is not thereby approved, issued, granted, or executable.

## Approved Artifact

An artifact revision for which a trusted local control plane has recorded an approval bound to that revision's canonical digest. Approval is distinct from issuance and activation. An approved artifact is not automatically available to a consumer or active for an execution.

## Issued Artifact

An approved artifact revision that a trusted local control plane has made available for authorized consumer use according to its issuance rules. Issuance is a separate lifecycle act from approval and does not itself activate execution.

## Artifact Revision

One immutable conceptual content version of an artifact instance. A revision is the unit to which validation, canonical digest, approval, issuance, comparison, and bundle selection apply. Changing content creates a different revision, and an issued revision MUST NOT be edited in place. Exact revision identifiers and storage rules are deferred.

## Canonical Digest

A deterministic digest of an artifact revision's canonical representation. A trusted approval binds to this digest so a changed revision cannot inherit approval implicitly. WP-0 does not standardize the canonical representation or digest mechanism.

## Artifact Reference

A conceptual directional relationship from one artifact revision to another artifact revision or another explicitly permitted observed artifact. A consumable reference MUST select an exact compatible revision. It does not copy, merge, approve, issue, grant, activate, or override its target. Serialization and resolution mechanics are deferred.

## Artifact Aggregate

The conceptual consistency boundary for one core artifact kind. Each aggregate has one sole responsibility, its own revisions, validators, and invariants. This term does not prescribe a code structure, database aggregate, file, or process.

## Execution Bundle

An artifact that identifies which exact artifact revisions constitute one proposed execution. It composes references without merging task, authority, context, completion, and result responsibilities. An execution bundle is not an approval, issuance, grant, or activation command.

## Execution Result

A structured, retrospective artifact reporting what occurred during execution and evaluation. It is distinct from a `CompletionContract`, which defines how completion must be proven before execution. An execution result is not authority, approval, issuance, or a trusted local execution receipt. Whether an evaluator-produced result requires a distinct approval, issuance, publication, receipt-correlation, revocation, or supersession condition for a particular use is deferred and MUST NOT be inferred from lifecycle rules for prospective artifacts.

## Authority

Permission to perform a particular operation under applicable policy and runtime constraints. Authority is separate from task intent, context selection, validation, approval, and execution outcome.

## Effective Authority

The authority actually available to a downstream consumer for a given execution. Conceptually it is the intersection of the global capability ceiling, workspace capability ceiling, approved `AuthorityPolicy`, runtime grant, and consumer-supported capabilities. Denials override allowances; unknown operations are denied.

## Capability Ceiling

A trusted upper bound on capabilities. A global ceiling applies across the gateway, and a workspace ceiling applies to one configured workspace. A generated `AuthorityPolicy`, grant, consumer adapter, or repository artifact cannot expand a ceiling.

## Workspace

A logical project scope registered through trusted local configuration. It has a controlled root, visibility, capability ceiling, and configured artifact location. ChatGPT Web and repository content do not define or alter those trusted properties.

## Consumer

A component that receives an issued artifact responsibility for use in a bounded workflow. Initial consumers are the Pi task adapter, pi-guard authority adapter, and completion evaluator. A consumer is limited by effective authority and its supported capabilities.

## Adapter

A boundary component that translates stable, consumer-neutral core artifact semantics into the needs of one consumer. An adapter does not approve artifacts, expand authority, or make consumer-specific configuration part of common artifact semantics.

## Approval

A trusted local control-plane decision accepting one artifact revision for a defined purpose, recorded as a binding to its canonical digest. Approval is not validation, issuance, a runtime grant, or activation.

## Issuance

A trusted local control-plane act that makes an approved artifact revision available for authorized consumer use. Issuance is not implied by approval and does not itself start execution.

## Grant

A trusted local runtime constraint or authorization associated with a particular execution context. A grant can narrow when or how already-permitted authority is available; it cannot add capability beyond global and workspace ceilings, approved policy, or consumer support.

## Revocation

A trusted local control-plane act or state that withdraws the current usability of an approval, issuance, grant, or activation as applicable. Repository content MUST NOT revoke or reinstate authoritative state. Consumers MUST fail closed when required current revocation status cannot be determined.

## Receipt

A trusted local record of a lifecycle or execution event, such as approval, issuance, grant use, activation, or execution observation. A receipt remains outside the repository and is distinct from a project-visible `ExecutionResult` artifact.

## Completion Contract

An artifact that specifies how task completion must be proven or evaluated. It defines prospective requirements and must remain separate from task instructions, authority, and retrospective execution results.

## Trusted Local Control Plane

The locally controlled authority boundary that maintains authoritative policy lifecycle and runtime records, including approvals, issuances, revocations, grants, activations, receipts, and audit state. It is outside managed repositories and is not controlled by ChatGPT Web or repository content.

## Required Extension

A registered extension whose semantics a consumer MUST understand and enforce for a particular artifact or execution to be valid. A consumer that does not support a required extension MUST fail closed and MUST NOT silently ignore or downgrade it.

## Optional Extension

A registered extension explicitly designated as optional by its defined semantics. A consumer MAY ignore it only when doing so cannot change core artifact meaning, authority, completion obligations, or safety guarantees. Optional extensions MUST NOT override capability ceilings, denials, approval requirements, or trusted-state boundaries.
