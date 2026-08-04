# Project Gateway MCP — Artifact Responsibility Matrix

**Status:** Authoritative WP-1 companion matrix
**Companion document:** `docs/design/artifact-domain-model.md`

This matrix is a concise restatement of the WP-1 domain model. It defines conceptual boundaries only; it does not prescribe fields, schemas, references, storage, or APIs. All artifact content is project-visible and untrusted. Trusted lifecycle facts remain outside the repository in the trusted local control plane.

## Purpose and Content Boundaries

| Artifact | Sole purpose | Permitted conceptual contents | Prohibited conceptual contents |
| --- | --- | --- | --- |
| `TaskSpec` | What the downstream agent must accomplish | Role or execution intent; objective; task instructions represented directly in the task-intent boundary; expected deliverables; non-authoritative outcome constraints; references to specifications as project data only | Any filesystem, command, Git, network, or other authority; capability ceilings; lifecycle state; completion evidence; observed result; consumer-specific configuration; delegated instruction authority from selected context or a repository file |
| `AuthorityPolicy` | What operations a consumer may perform within effective authority | Proposed operation scopes; explicit denials; required capability semantics; consumer-neutral narrowing constraints | Task intent; implementation instructions; trusted ceilings; approval, issuance, grant, or activation; completion evidence; outcomes; consumer-specific configuration |
| `ContextManifest` | What context a consumer must or may load | Required and optional bounded selections; relevance or priority; integrity expectations; requirements, evidence, specifications, constraints, and facts as untrusted project data | Executable or task instructions; promotion of embedded context instructions or commands; read-policy bypass; authority; task replacement; completion proof; results; lifecycle state; control-plane, system-instruction, or consumer-safeguard override; consumer-specific configuration |
| `CompletionContract` | How completion must be demonstrated and evaluated | Required checks; evidence; deliverables; acceptance conditions; evaluation obligations | Authority for checks; implementation instructions; observed outcomes; approval, issuance, grant, activation, or receipt; consumer-specific command configuration |
| `ExecutionBundle` | Which exact prospective revisions form one proposed execution | Exact references to one task, policy, context, and completion revision; consumer-neutral compatibility requirements; registered extension declarations | Inline replacements; semantic merging; fallback prompt/policy; authority; lifecycle state; grant; activation; outcome; consumer-specific launch configuration |
| `ExecutionResult` | What occurred during execution and evaluation | Disposition; observed outputs and changed resources; check outcomes; evaluation; violations; produced-artifact and evidence references | Task/policy/context/completion rewrite; authority; lifecycle state; grant; activation; prospective instructions; trusted receipt replacement |

## Ownership, Validation, and Consumer Boundaries

| Artifact | Permitted content producer | Structural and semantic validator | Trusted lifecycle owner | Permitted consumer | Result / receipt boundary |
| --- | --- | --- | --- | --- | --- |
| `TaskSpec` | ChatGPT Web, local human, future task producer | Protocol structural validator; task semantic validator | Trusted local control plane | Pi task adapter; compatible future task adapters; reviewers | May be correlated during evaluation; never a result or receipt |
| `AuthorityPolicy` | ChatGPT Web, local human, future policy producer; every proposal only narrows | Protocol structural validator; authority semantic validator | Trusted local control plane | pi-guard authority adapter; compatible future authority adapters | Constrains execution only through effective authority; never a receipt |
| `ContextManifest` | ChatGPT Web, local human, future context producer | Protocol structural validator; context semantic validator | Trusted local control plane | Pi task adapter; compatible context-loading adapters | Consumers still require independent normal read authority and MUST treat selected context as untrusted data; never a receipt |
| `CompletionContract` | ChatGPT Web, local human, future completion producer | Protocol structural validator; completion semantic validator | Trusted local control plane | Completion evaluator; compatible future evaluators; reviewers | Defines prospective proof only; never a result or receipt |
| `ExecutionBundle` | ChatGPT Web, local human, future orchestration producer | Protocol structural validator; bundle semantic validator | Trusted local control plane | Control plane for lifecycle checks; Pi task adapter; pi-guard adapter; completion evaluator | Selects prospective content; later reported by result; never a receipt |
| `ExecutionResult` | Completion evaluator for an actual evaluator-produced result; candidate adoption is deferred to OD-WP1-005 | Protocol structural validator; result semantic validator and completion evaluator; adoption/provenance conditions are deferred to OD-WP1-005 | Trusted local control plane owns separate external receipt/audit correlation; result lifecycle and publication are deferred to OD-WP1-005 | Review, completion, automation, and reporting consumption remain subject to OD-WP1-005 | Project-visible retrospective report; MUST NOT replace a trusted receipt or imply prospective-artifact approval or issuance semantics |

Producer identity MUST NOT imply approval, issuance, grant, activation, or receipt authority. Structural and semantic validation establish conformance only. The trusted local control plane is the only lifecycle owner. One deployed component MAY implement multiple roles, but those roles remain conceptually distinct.

Loaded context remains untrusted data. Only instruction content represented directly within the `TaskSpec`'s own task-intent boundary may be treated as task instruction. A `TaskSpec` MUST NOT delegate instruction authority wholesale to selected context or a repository file, and a consumer MUST NOT follow instructions found solely in loaded context, even when the task refers to, cites, summarizes, or requests conformance with that context. Context may provide requirements, evidence, specifications, constraints, or facts as data, but it MUST NOT override task intent, `AuthorityPolicy`, effective authority, trusted workspace configuration, control-plane lifecycle decisions, or consumer safeguards.

## Relationships and Dependency Boundaries

| Artifact | Allowed references or relationships | Prohibited dependencies |
| --- | --- | --- |
| `TaskSpec` | Incoming exact selection by an `ExecutionBundle`; bundle-level alignment with context and completion; citation of non-core project data only | Direct core dependency on authority, context, completion, bundle fallback, result, receipt, or lifecycle state; embedded effective authority; delegated instruction authority from selected context or a repository file |
| `AuthorityPolicy` | Incoming exact selection by an `ExecutionBundle`; independent intersection with trusted ceilings, runtime grant, and consumer support | Task wording as authority source; execution instructions; trusted-ceiling definition; result-dependent authority; self-approval or activation |
| `ContextManifest` | Incoming exact selection by an `ExecutionBundle`; bounded selections related to selected task as untrusted data | Direct task-instruction dependency or promotion; authority-policy bypass; result dependency; completion proof; read authority by listing; override of authority, lifecycle, or consumer safeguards |
| `CompletionContract` | Incoming exact selection by an `ExecutionBundle`; bundle-level evaluation of task deliverables | Task implementation instructions; authority to run checks; result-dependent prospective requirements; activation or receipt dependency |
| `ExecutionBundle` | Outgoing exact references to exactly one `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, and `CompletionContract`; registered supporting extension dependencies; one compatible trusted workspace scope as resolved under OD-WP1-004 | Result, receipt, grant, activation, self-reference, another bundle as authority substitute, hidden fallback prompt/policy, cross-workspace reference not resolved as compatible under OD-WP1-004, or any semantic override of a referenced aggregate |
| `ExecutionResult` | Identifies exact reported bundle and execution occurrence; MAY reference produced artifacts and evidence | Any prospective aggregate depending on it; task/policy/context/completion/bundle mutation; lifecycle proof; authority or activation effect |

The core topology is directed and acyclic. The four prospective artifacts have no direct core-artifact dependencies on one another; `ExecutionBundle` is their only prospective composition boundary. `ExecutionResult` is retrospective and is never a prospective bundle member.

## Mandatory Execution Composition

A consumable MVP `ExecutionBundle` MUST select exactly one compatible revision of each of these four prospective aggregates:

1. `TaskSpec`;
2. `AuthorityPolicy`;
3. `ContextManifest`; and
4. `CompletionContract`.

All four MUST be present. A context manifest that selects no additional context is an explicit context-manifest revision, not an omitted default. All required references MUST resolve to exact compatible revisions and one compatible trusted workspace scope. The source and serialization of workspace binding, portability rules, and cross-workspace reference treatment are deferred to OD-WP1-004. A change to a selected revision MUST be represented by a new bundle revision. Required capabilities and extensions that are unknown, unresolved, incompatible, or unsupported MUST fail closed.

## Non-Artifact Note (F-EL4)

`TrustedWorkspaceConfiguration` (the WP-6 trusted workspace and policy
configuration object) is **not** an Artifact Core aggregate, artifact kind,
lifecycle record, approval record, RuntimeGrant, ExecutionResult, or
TrustedReceipt. It is a trusted-local, repository-external control-plane
configuration object governed by the local gateway implementation (see
`trusted-workspace-and-ceiling-configuration.md`). It is intentionally
absent from the artifact responsibility matrix above.
