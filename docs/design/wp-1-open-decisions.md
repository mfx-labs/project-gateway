# WP-1 Open Decisions

This file contains only unresolved decisions discovered while defining the WP-1 domain model. The decisions below do not weaken the accepted WP-0 or WP-1 boundaries. They MUST be resolved explicitly before the listed later work proceeds.

## OD-WP1-001 — Artifact-Instance Succession and Revision Lineage

**Question**

What rules determine whether changed content is a new revision of an existing artifact instance versus a new artifact instance, and how may permitted lineage be declared or verified?

**Why it cannot be resolved safely in WP-1**

WP-1 establishes the conceptual distinction but does not define identifiers, canonicalization, digesting, reference serialization, or lifecycle records. Selecting succession rules without those related protocol decisions could make approval binding, audit history, or exact reference resolution ambiguous.

**Earliest work package that must resolve it**

WP-2 — artifact identity, versioning, and reference protocol design, before any envelope, revision, reference, canonicalization, or digest work.

**Later work blocked by it**

Artifact-instance and revision serialization; exact reference schema; revision-lineage validation; approval-to-revision correlation; and audit/history semantics.

**Current non-authoritative options**

1. A producer-declared persistent instance identity with each changed content proposal represented as a new revision.
2. A persistent instance identity plus an explicit predecessor relationship between revisions.
3. A separately governed identity service or registry that establishes permitted instance succession outside project-visible artifact content.

## OD-WP1-002 — Execution Occurrence, Retry, and Result Grouping

**Question**

Does one `ExecutionResult` report one activation attempt, one execution attempt, a group of retries under one bundle, or a separate summary of multiple attempts? How are those observations correlated with trusted receipts without making the result itself a receipt?

**Why it cannot be resolved safely in WP-1**

WP-1 defines the required retrospective boundary and exact bundle association but intentionally does not define lifecycle state machines, execution-record identities, receipt structures, retry semantics, or persistence. An arbitrary grouping rule would affect both audit meaning and result-to-bundle validation.

**Earliest work package that must resolve it**

WP-2 — execution occurrence and lifecycle-correlation protocol design, before `ExecutionResult`, receipt-correlation, execution-record, or retry semantics are serialized.

**Later work blocked by it**

`ExecutionResult` schema and semantic validation; execution-record and receipt correlation; retry reporting; completion-evaluation aggregation; and audit interpretation.

**Current non-authoritative options**

1. Produce one result per activation attempt, including a disposition for attempts that do not complete.
2. Produce one result per execution attempt, with separate trusted receipts correlating activation and execution attempts.
3. Produce per-attempt results plus a separate non-core summary or future aggregate for grouped retries.

## OD-WP1-003 — Registered Extension Namespace Governance

**Question**

Who governs registered extension namespaces, version compatibility, required-versus-optional declarations, and collision resolution while preserving the prohibition on ChatGPT-controlled schema registration?

**Why it cannot be resolved safely in WP-1**

WP-1 defines extension boundaries and fail-closed behavior but does not define registry implementation, schema registration, version syntax, or governance process. Choosing a registry model here would exceed the domain-model scope and could accidentally grant repository or producer content authority over common semantics.

**Earliest work package that must resolve it**

WP-2 — artifact versioning and extension-contract design, before extension registry, extension schema, consumer-negotiation, or adapter implementation work.

**Later work blocked by it**

Registered extension schemas; extension semantic validators; required-extension compatibility checks; extension namespace allocation; and adapter negotiation for non-core semantics.

**Current non-authoritative options**

1. A human-approved protocol registry maintained outside managed repositories.
2. A versioned protocol release process that publishes a fixed extension catalog.
3. A trusted local control-plane registry with explicit human-approved registration and compatibility policy.

## OD-WP1-004 — Artifact Workspace Binding and Portability

**Question**

Which artifact kinds are intrinsically bound to one trusted workspace, which may be portable across workspaces, and at what point is a portable artifact bound to the trusted workspace scope of an execution?

The question includes:

- whether `TaskSpec` may be workspace-portable;
- whether `CompletionContract` may be workspace-portable;
- whether `AuthorityPolicy` must always be workspace-bound;
- whether `ContextManifest` must always be workspace-bound;
- whether `ExecutionBundle` establishes or only records workspace binding;
- whether `ExecutionResult` inherits the workspace scope of its reported execution;
- how cross-workspace references are treated; and
- whether approval is correlated with a workspace as well as an artifact revision.

**Why it cannot be resolved safely in WP-1**

WP-1 defines aggregate responsibilities and requires a consumable bundle to resolve to one compatible trusted workspace scope, but it does not define artifact identity, reference serialization, trusted workspace identifiers, approval correlation, resolution context, storage lookup, or the bundle-validation protocol. Choosing a binding model without those protocol decisions could create ambiguous cross-workspace authority, reference, portability, or approval semantics.

**Earliest work package that must resolve it**

WP-2 — artifact identity, versioning, workspace-binding, and reference protocol design.

**Later work blocked by it**

- artifact identity and reference serialization;
- cross-artifact compatibility validation;
- cross-workspace reference rejection;
- bundle workspace validation;
- artifact storage lookup;
- approval-to-workspace correlation;
- issued-artifact resolution; and
- portable artifact reuse.

**Current non-authoritative options**

1. All four prospective artifacts are intrinsically workspace-bound.
2. `AuthorityPolicy` and `ContextManifest` are intrinsically workspace-bound, while `TaskSpec` and `CompletionContract` may be portable.
3. Prospective artifacts may be portable, but `ExecutionBundle` explicitly binds selected revisions to one trusted workspace.
4. Trusted local lifecycle state establishes workspace binding independently from project-visible artifact content.

## OD-WP1-005 — ExecutionResult Lifecycle and Publication

**Question**

What lifecycle conditions make an `ExecutionResult` consumable as an evaluator-produced retrospective artifact, and how is that status distinguished from an untrusted candidate result and from a trusted local execution receipt?

The question includes:

- whether `ExecutionResult` requires approval;
- whether it requires issuance or publication;
- whether evaluator provenance is sufficient for normal review;
- when a candidate result becomes an actual evaluator-produced result;
- whether trusted receipt correlation is required before review, completion evaluation, downstream automation, or authoritative reporting;
- what issuance means for a retrospective result;
- whether revocation or supersession applies to results; and
- how result publication differs from trusted lifecycle receipt production.

**Why it cannot be resolved safely in WP-1**

WP-1 defines the retrospective responsibility and trust distinction but does not define execution occurrence identity, evaluator identity or provenance, lifecycle states, result publication, receipt structures, receipt correlation, retry grouping, trusted storage, or downstream automation eligibility. Selecting a result lifecycle or publication model here would exceed the domain-model scope and could blur a candidate result, evaluator-produced result, and trusted local receipt.

**Earliest work package that must resolve it**

WP-2 — execution occurrence, result identity, lifecycle-correlation, and publication protocol design.

**Later work blocked by it**

- `ExecutionResult` schema;
- result semantic validation;
- evaluator provenance;
- candidate-to-result promotion;
- result publication;
- result supersession;
- receipt correlation;
- downstream result-consumption rules; and
- automated completion and review workflows.

**Current non-authoritative options**

1. One evaluator-produced result per execution attempt, consumable for review after validation and provenance verification.
2. Results require a trusted publication or issuance record before downstream consumption.
3. Results may be reviewed before receipt correlation but require trusted receipt correlation before authoritative automation.
4. Candidate result drafts require explicit adoption by a compatible completion evaluator before becoming evaluator-produced results.
