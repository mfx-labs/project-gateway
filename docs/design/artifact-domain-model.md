# Project Gateway MCP — Artifact Domain Model

**Status:** Authoritative WP-1 domain-model baseline
**Applies to:** Later artifact semantics, versioning, canonicalization, lifecycle, schema, validation, consumer, adapter, storage, and tool work

## Executive Summary

This document defines the conceptual domain model for the six approved Project Gateway MCP artifact kinds: `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, `CompletionContract`, `ExecutionBundle`, and `ExecutionResult`.

Each kind is an independent aggregate with one stable responsibility. A task states desired work; an authority policy constrains permitted operations; a context manifest selects context; a completion contract defines prospective proof; an execution bundle selects exact revisions for one proposed execution; and an execution result records retrospective observations. An artifact kind MUST NOT override, merge, or inherit another kind's responsibility.

Artifacts are project-visible, untrusted content. Structural and semantic validation establish conformance only. Approval, issuance, revocation, grants, activation, trusted receipts, and authoritative audit facts remain separate trusted local control-plane state outside the repository. In particular, a task, prompt, path, artifact draft, validated artifact, bundle, result, or producer assertion MUST NOT grant authority.

The model deliberately defines concepts and obligations rather than serialized fields, schemas, APIs, storage, or implementation. It makes future protocol work possible without weakening the WP-0 product, trust, authority, and consumer boundaries.

## Scope

### Defined by WP-1

WP-1 defines:

- the conceptual distinctions among artifact kind, artifact instance, artifact revision, artifact draft, artifact reference, and artifact aggregate;
- the sole responsibility, contents boundary, roles, relationships, invariants, and failure conditions for every core artifact kind;
- the non-merging composition boundary of `ExecutionBundle`;
- the retrospective observation boundary of `ExecutionResult`;
- conceptual ownership and separation of producer, validator, trusted lifecycle, consumer, result-producer, receipt-producer, and reviewer roles;
- a consumer-neutral extension framework; and
- domain-model handoff constraints for later work packages.

### Explicitly Outside WP-1

WP-1 does not define serialized envelope fields, object layouts, JSON Schemas, canonical JSON, digest or signing mechanisms, identifier formats, reference serialization, persistence formats, lifecycle state machines, approval records, storage layouts, adapter APIs, MCP tools, FFF integration, Pi integration, pi-guard changes, command syntax, path algorithms, or production code.

A conceptual term in this document MUST NOT be interpreted as a requirement for a particular field, API, database record, process, or implementation topology.

## Authoritative Inputs and Precedence

This document is constrained by the accepted WP-0 baseline:

- `docs/design/project-gateway-scope-and-principles.md`;
- `docs/design/glossary.md`;
- `docs/decisions/ADR-001-product-boundary.md`;
- `docs/decisions/ADR-002-trust-and-approval-boundary.md`;
- `docs/decisions/ADR-003-mvp-artifact-set.md`; and
- `docs/decisions/ADR-004-mvp-capability-boundary.md`.

WP-1 refines their conceptual boundaries but does not replace them. No inconsistency among those authoritative documents was identified during WP-1 analysis. If a later interpretation conflicts with an accepted WP-0 decision, the WP-0 decision controls until changed through an explicit human-approved architecture decision.

## Model Conventions and Trust Classification

### Conceptual model, not serialized representation

The terms *kind*, *instance*, *revision*, *reference*, and *aggregate* are conceptual distinctions. Future protocol work MUST preserve them even if one serialized document represents several of those concepts through identifiers or metadata. WP-1 does not prescribe how that representation works.

### Artifact content and trusted lifecycle state

Core artifact content is project-visible, reviewable, and untrusted input. An artifact revision can be structurally valid, semantically valid, approved, or issued only through the appropriate conceptual checks and trusted local records; no textual claim inside the artifact establishes those facts.

The trusted local control plane owns approval, issuance, revocation, runtime-grant, activation, trusted-receipt, and authoritative-audit facts. Those facts MUST remain outside managed repositories. A project-visible result may report an observation, but it is not a trusted local receipt.

### Role separation

A single deployed component MAY implement more than one role, but the following responsibilities remain conceptually distinct:

- authoring content;
- validating structural conformance;
- validating semantic conformance;
- approving, issuing, revoking, granting, or activating through trusted local control;
- consuming an artifact through an adapter or evaluator;
- producing a retrospective result; and
- producing a trusted local receipt.

Deployment colocation MUST NOT cause one role's input or assertion to be accepted as another role's decision.

## Domain Vocabulary

### Artifact Kind

An **artifact kind** is a stable protocol responsibility. It defines the semantic boundary of a class of artifacts, such as task intent or authority constraints.

An artifact kind is different from an artifact instance: one kind can have many independently meaningful logical artifacts. It is different from an artifact revision: a revision is one immutable content version of one instance of one kind. A kind does not imply approval, issuance, authority, or consumer support merely by being named.

Consumers MUST interpret only artifact kinds and required semantics they support. An unknown or unsupported required kind MUST fail closed. WP-1 does not standardize a serialized `kind` field, its syntax, or its registry representation.

### Artifact Instance

An **artifact instance** is the conceptual identity of one logical artifact across one or more revisions. For example, a task may remain the same logical task while its instructions are revised; each version is a separate revision of that task instance.

Instance identity is not content identity. A path, filename, branch, directory, repository history entry, or producer assertion is insufficient proof of instance identity. An instance remains untrusted project-visible content unless a separate trusted local record establishes a lifecycle fact about a specific revision. WP-1 does not standardize instance identifier format, creation rules, or succession mechanics.

### Artifact Revision

An **artifact revision** is one immutable conceptual content version of an artifact instance. Structural validation, semantic validation, bundle selection, and eventual approval binding apply to a revision, not to an undifferentiated file path or logical instance.

Changing content creates a different revision. A revision that has been issued MUST NOT be edited in place; a changed content proposal is a new revision that requires its own validation and any required trusted lifecycle decisions. Exact revision identifiers, canonical representation, canonical digest calculation, and the mechanics of determining revision equality are deferred.

### Artifact Draft

An **artifact draft** is producer-authored, untrusted proposed content for a revision. A draft can be structurally invalid, semantically invalid, or both. A structurally and semantically validated draft remains unapproved until a trusted local control plane binds approval to the corresponding revision identity and canonical digest.

A draft MUST NOT establish authority, lifecycle state, consumer support, or execution eligibility. A producer assertion that a draft is approved, issued, granted, activated, or received is not trusted state.

### Artifact Reference

An **artifact reference** is a conceptual directional relationship from one artifact revision to another artifact revision or other explicitly permitted observed artifact. The source aggregate owns the proposal of the reference; validators and consumers own compatibility and resolution checks.

A consumable reference MUST eventually select an exact compatible target revision. A provisional or unresolved reference MAY exist only while a producer is correcting a draft; it MUST prevent validation for consumption and downstream use. A reference MUST NOT copy, merge, reinterpret, approve, issue, grant, or activate its target. Reference syntax, resolution mechanics, and serialization are deferred.

### Artifact Aggregate

An **artifact aggregate** is the conceptual consistency boundary for one core artifact kind. Each aggregate has one sole responsibility, its own revisions, its own validators, and its own invariants. The aggregate concept does not prescribe a code structure, database aggregate, file, or process.

Changing content within one aggregate creates a new revision of that aggregate only. It MUST NOT silently alter another aggregate's responsibility or revision. When a prospective revision selected by an `ExecutionBundle` changes, a new bundle revision is required to select the changed revision; existing bundle revisions remain historical compositions.

### Execution Composition

**Execution composition** is the act of selecting compatible, exact prospective artifact revisions for one proposed execution. `ExecutionBundle` is the sole core aggregate that performs this composition. Composition is not semantic merging, approval, issuance, granting, or activation.

### Execution Observation

**Execution observation** is the retrospective reporting of what happened for an execution subject. `ExecutionResult` is the core aggregate for that report. It MAY identify the exact bundle and execution occurrence it reports, but it MUST NOT rewrite any prospective artifact or become a trusted local receipt.

### Concept Accountability

The table below records why each domain concept belongs in the core model. “Owner” means responsibility owner, not filesystem ownership or lifecycle authority unless stated.

| Concept | Sole purpose and reason it is core | Responsibility owner | Primary consumers | Trust classification |
| --- | --- | --- | --- | --- |
| Artifact kind | Preserves one stable responsibility and prevents semantic overloading | Protocol-contract governance, subject to human-approved evolution | Validators and all adapters | A contract boundary; not a lifecycle fact |
| Artifact instance | Distinguishes logical continuity from content and paths | Content producer proposes stewardship; later protocol rules govern continuity | Revision validators, reviewers, bundle authors | Untrusted identity claim until resolved by protocol rules |
| Artifact revision | Defines the immutable unit of validation, approval binding, and bundle selection | Producer owns proposal; validators own conformance assessment | Control plane, consumers, reviewers | Project-visible content; lifecycle facts remain external |
| Artifact draft | Represents proposed content before trusted lifecycle decisions | Producer | Validators and reviewers | Untrusted content |
| Artifact reference | Preserves directed composition without copying or overriding target semantics | Source aggregate's producer and validator | Bundle validators and consumers | Untrusted relationship claim until resolved |
| Artifact aggregate | Keeps each responsibility and its invariants independently governable | Protocol-contract governance for the kind; producer for a revision | Validators and permitted consumers | Conceptual boundary, not trusted state |
| Execution composition | Selects one proposed execution without creating authority | Bundle producer and bundle validator | Control plane and downstream adapters | Untrusted bundle content; no activation state |
| Execution observation | Reports outcomes without rewriting prospective requirements | Completion evaluator for an actual result | Reviewers, evaluators, future reporting consumers | Project-visible retrospective content; not a receipt |

## Shared Validation and Lifecycle Model

### Validation roles

A **structural validator** determines whether a draft conforms to the applicable kind contract at a structural level. A **semantic validator** determines whether a draft's meaning respects the artifact's sole responsibility, cross-artifact rules, required extensions, and consumer-neutral constraints. These are conceptual roles; the actual schemas, validation algorithms, and implementations are deferred.

Neither validator grants authority. A validator MUST reject or mark non-consumable a draft that violates a responsibility boundary, contains prohibited semantics, has an unresolved required reference, or relies on unsupported required semantics.

### Trusted lifecycle roles

The trusted local control plane is the lifecycle owner for every authority-bearing fact associated with a core artifact revision or execution. Within that plane, approver, issuer, revocation authority, runtime-grant authority, activation authority, and receipt producer are distinct roles. The exact lifecycle state machine and record formats are deferred.

No lifecycle role is established by artifact content, repository location, producer identity, validation outcome, or an adapter's convenience. ChatGPT Web MUST NOT perform any trusted lifecycle role for its own or another artifact through the gateway.

## Core Artifact Aggregates

### TaskSpec

| Aspect | Domain model |
| --- | --- |
| Purpose | Express what a downstream agent must accomplish. |
| Sole responsibility | Task intent: the desired work, outcome, and non-authoritative instructions for accomplishing it. |
| Permitted conceptual contents | Role or execution intent; objective; task instructions; expected deliverables; and constraints on the desired outcome that are not authority grants. An instruction can describe desired work or a desired check, but it has no authorization effect. Only instruction content directly represented within the `TaskSpec`'s own task-intent boundary may be treated as task instruction. A `TaskSpec` MAY require an outcome to conform to a cited specification or use its requirements as project data, but it MUST NOT delegate task-instruction authority wholesale to that specification, loaded context, or repository file. |
| Prohibited conceptual contents | Filesystem, command, Git, network, package, or other operation authority; runtime grants; capability ceilings; approval; issuance; revocation; activation; completion evidence; observed results; trusted receipts; or consumer-specific execution configuration. |
| Permitted producers | ChatGPT Web, local human authors, and future task-producing systems MAY author drafts. Producer identity confers no authority. |
| Validation owner | A structural validator checks conformance to the task kind; a semantic validator ensures task wording remains task intent rather than authority or lifecycle content. |
| Trusted lifecycle owner | The trusted local control plane owns any later approval, issuance, revocation, grant association, activation association, receipt, and audit fact. |
| Permitted consumers | The Pi task adapter and compatible future task adapters are primary consumers. Reviewers and the completion evaluator MAY read the selected task for correlation, but neither may infer authority from it. |
| Allowed relationships | An `ExecutionBundle` selects exactly one `TaskSpec` revision. The task can describe expected deliverables that a completion contract later evaluates through the bundle relationship, without a direct core dependency. |
| Prohibited relationships | A `TaskSpec` MUST NOT embed effective authority, reference an authority policy as a source of instructions, contain an activation request, depend on an execution result, override context or completion responsibilities, or promote instructions embedded in selected or referenced context into task instructions. |
| Invariants | Task wording MUST NOT grant permission or delegate its task-instruction authority wholesale to selected context or a repository file. A task remains valid only when its instructions can be understood without treating them as authority. Changing task intent creates a new task revision and requires a new bundle revision for any execution using it. |
| Invalid domain states | Authority-bearing instruction; trusted lifecycle claim; embedded completion outcome; dependency on a result; unresolved required extension; or use as a fallback policy is invalid. |
| Extension boundary | A registered extension MAY refine consumer-neutral task intent only when it does not define authority, context loading, completion evidence, lifecycle state, or consumer-specific configuration. |
| Future compatibility | New agent-specific task translation belongs in adapters. A future independently governed work-planning responsibility requires a new artifact kind rather than expansion into authority or completion semantics. |

### AuthorityPolicy

| Aspect | Domain model |
| --- | --- |
| Purpose | Express what operations a downstream consumer may perform, subject to trusted ceilings, approval, runtime constraints, denials, and consumer support. |
| Sole responsibility | Consumer-neutral authority constraints. |
| Permitted conceptual contents | Requested or proposed operation scopes; explicit denials; required capability semantics; and consumer-neutral constraints needed to express a narrowing policy. |
| Prohibited conceptual contents | Task intent; implementation or execution instructions; trusted global or workspace capability ceilings; self-approval; issuance; revocation; runtime activation; completion evidence; execution outcomes; trusted receipts; and consumer-specific configuration. |
| Permitted producers | ChatGPT Web, local human authors, and future policy-producing systems MAY author drafts. Every generated policy, regardless of producer, MAY narrow authority only; it MUST NOT expand a trusted global or workspace ceiling. |
| Validation owner | A structural validator checks the authority-kind contract. A semantic validator checks that proposed operations are consumer-neutral, explicit denials retain priority, required semantics are declared as required, and no content attempts to widen a trusted ceiling or act as task instruction. |
| Trusted lifecycle owner | The trusted local control plane exclusively owns approval, issuance, revocation, runtime grants, activation, receipts, and audit facts. The policy directory and a policy's text are not those facts. |
| Permitted consumers | The pi-guard authority adapter and compatible future authority adapters are primary consumers. Other consumers may use the policy only through supported authority enforcement; task adapters MUST NOT treat policy content as task instructions. |
| Allowed relationships | An `ExecutionBundle` selects exactly one `AuthorityPolicy` revision. The policy is evaluated independently against trusted global and workspace ceilings, runtime grants, denials, and consumer-supported capabilities. |
| Prohibited relationships | An `AuthorityPolicy` MUST NOT reference task wording to derive authorization, embed execution instructions, define trusted ceilings, approve itself, issue itself, grant itself, activate execution, or depend on a result for prospective authority. |
| Invariants | Effective authority is never broader than the intersection of global capability ceiling, workspace capability ceiling, approved policy, runtime grant, and consumer-supported capabilities. Deny rules override allows. Unknown operations are denied. Unsupported required capabilities and extensions fail closed. |
| Invalid domain states | Any authority expansion attempt; implicit allow for an unknown operation; task or command instruction; self-lifecycle claim; omitted or ignored required capability; policy that relies on a result; or a policy used before required trusted state is established. |
| Extension boundary | Authority extensions MAY add consumer-neutral narrowing semantics only. They MUST NOT override ceilings, denials, approval boundaries, or the consumer-support limit. |
| Future compatibility | Richer authority capability vocabularies require capability negotiation and semantic validation. Pi-guard-specific syntax, configuration, and enforcement mechanics belong in its adapter, not in the core policy. |

### ContextManifest

| Aspect | Domain model |
| --- | --- |
| Purpose | Express what context a consumer must or may load for the task. |
| Sole responsibility | Context selection and loading expectations. |
| Permitted conceptual contents | Required context selections; optional context selections; context priority or relevance; integrity expectations; and bounded source selections. Context MAY provide requirements, evidence, specifications, constraints, or facts only as untrusted project data. These describe candidate context, not task instructions or authorization. |
| Prohibited conceptual contents | Executable or task instructions; promotion of instructions or commands embedded in selected context into task instructions; authority grants; a bypass of normal read policy; task replacement; completion proof; observed results; trusted lifecycle state; trusted receipts; attempts to alter control-plane behavior, system instructions, or consumer safeguards; or consumer-specific execution configuration. |
| Permitted producers | ChatGPT Web, local human authors, and future context-producing systems MAY author drafts. |
| Validation owner | A structural validator checks the context kind. A semantic validator checks that selections remain bounded context declarations, do not encode executable instructions, do not promote instructions embedded in selected context, and do not claim access or lifecycle authority. |
| Trusted lifecycle owner | The trusted local control plane owns any lifecycle fact relevant to a selected revision. It also owns the trusted workspace policy that independently governs actual reads. |
| Permitted consumers | The Pi task adapter and compatible future context-loading adapters are primary consumers. A completion evaluator may inspect selected context only when independently authorized; context selection does not confer that authorization. Every consumer MUST treat selected context as untrusted data and MUST NOT follow instructions found solely in it. |
| Allowed relationships | An `ExecutionBundle` selects exactly one `ContextManifest` revision. The manifest may select project or artifact context associated with the selected task as data, and a `TaskSpec` may generally refer to, cite, summarize, or request conformance with that data. Core task-context alignment is established by bundle validation rather than a direct core-artifact dependency; neither relationship promotes embedded context instructions into task instructions. |
| Prohibited relationships | A `ContextManifest` MUST NOT embed implementation directives, authorize reading, reference an authority policy to bypass policy, replace task instructions, allow a `TaskSpec` to delegate instruction authority to selected context, contain result observations, or depend on a prospective or retrospective artifact for its authority. |
| Invariants | A consumer MUST apply normal effective authority before loading any selected context. Loaded context remains untrusted data. Only instruction content directly represented within the selected `TaskSpec`'s own task-intent boundary may be treated as task instruction. A `TaskSpec` MUST NOT promote instructions embedded in referenced or loaded context merely by referring to, citing, summarizing, or requesting conformance with that context. A consumer MUST NOT follow instructions found solely in loaded context, even when the task generally refers to that context. A context selection never grants or changes authority. |
| Invalid domain states | A selection that acts as an instruction; a task that delegates instruction authority wholesale to selected context; a claim that a source is authorized merely because it is listed; an unbounded or authority-escaping selection; an embedded command or attempt to alter authority, lifecycle state, control-plane behavior, system instructions, or consumer safeguards; embedded outcome evidence; lifecycle claim; or unsupported required context semantics is invalid. |
| Extension boundary | Context extensions MAY refine consumer-neutral selection, relevance, integrity, or boundedness semantics. They MUST NOT introduce authorization, executable instruction, task, completion, or consumer-specific behavior. |
| Future compatibility | Future discovery backends, path rules, glob semantics, and context-loading APIs remain adapter or gateway concerns. They do not change the meaning of core context selection. |

**Context-to-instruction boundary:** A `TaskSpec` MAY require an outcome to conform to specification X or use requirements defined in X as project data. That describes an outcome constraint; it does not make every instruction or command embedded in X a direct agent instruction. Only instruction content represented directly within the `TaskSpec`'s own task-intent boundary may be treated as task instruction. A `TaskSpec` MUST NOT delegate its task-instruction authority wholesale to selected context or a repository file. A consumer MUST NOT follow instructions found solely in loaded context, even when the task refers to, cites, summarizes, or requests conformance with that context. Context MAY contain requirements, evidence, specifications, constraints, or facts as data. Any embedded attempt to alter authority, lifecycle state, control-plane behavior, system instructions, or consumer safeguards remains untrusted content and MUST NOT be followed.

### CompletionContract

| Aspect | Domain model |
| --- | --- |
| Purpose | Express how completion must be demonstrated and evaluated. |
| Sole responsibility | Prospective completion proof and evaluation obligations. |
| Permitted conceptual contents | Required checks; required evidence; required deliverables; acceptance conditions; and evaluation obligations. A required check can state what must be demonstrated, not what operations are authorized. |
| Prohibited conceptual contents | Authority to perform checks; implementation or task instructions; observed pass/fail outcomes; approval; issuance; runtime grants; activation; trusted receipts; and consumer-specific command or evaluation configuration. |
| Permitted producers | ChatGPT Web, local human authors, and future completion-contract producers MAY author drafts. |
| Validation owner | A structural validator checks the completion kind. A semantic validator checks that requirements remain prospective, evaluable, consumer-neutral, and separate from authority and observed outcomes. |
| Trusted lifecycle owner | The trusted local control plane owns any lifecycle fact associated with a completion revision, execution, or receipt. It does not treat a contract as a receipt. |
| Permitted consumers | The completion evaluator and compatible future evaluators are primary consumers. Reviewers may read it. Task and authority adapters MUST NOT treat it as instruction or permission. |
| Allowed relationships | An `ExecutionBundle` selects exactly one `CompletionContract` revision. The contract may evaluate expected deliverables described by the selected task through bundle-level compatibility, without directly owning task intent. |
| Prohibited relationships | A `CompletionContract` MUST NOT embed implementation work, authorize a check, contain observed outcomes, approve execution, replace a trusted receipt, depend on `ExecutionResult` for its prospective meaning, or override task or authority content. |
| Invariants | Required checks do not grant execution authority. Every actor that performs a required check MUST independently establish effective authority for that operation. A completion contract remains prospective until a result reports observations. |
| Invalid domain states | Pass/fail result embedded as a requirement; implied command permission; task instruction; lifecycle claim; required check whose required semantics are unsupported; or result-dependent prospective criteria is invalid. |
| Extension boundary | Completion extensions MAY refine consumer-neutral evidence, acceptance, or evaluation semantics. They MUST NOT authorize operations, prescribe consumer-specific commands, or transform results into requirements. |
| Future compatibility | New evaluation engines belong behind evaluators or adapters. A future independently versioned review or release decision may require a new artifact kind rather than expansion of completion proof. |

### ExecutionBundle

| Aspect | Domain model |
| --- | --- |
| Purpose | Compose the exact prospective artifact revisions that form one proposed execution. |
| Sole responsibility | Non-merging execution composition. |
| Permitted conceptual contents | Exact references to one `TaskSpec` revision, one `AuthorityPolicy` revision, one `ContextManifest` revision, and one `CompletionContract` revision; plus consumer-neutral execution-target or adapter compatibility requirements. Such requirements are constraints on supported semantics, not instructions, authority, or configuration. |
| Prohibited conceptual contents | Inline unrestricted replacements for referenced artifacts; merged task/policy/context/completion semantics; fallback prompts; fallback authority; approval; issuance; revocation; runtime grants; activation; execution outcomes; trusted receipts; and consumer-specific configuration. |
| Permitted producers | ChatGPT Web, local human authors, and future orchestrating producers MAY author bundle drafts. A producer may propose a composition but cannot activate it. |
| Validation owner | A structural validator checks that all required core references are present and distinct by responsibility. A semantic bundle validator checks exact resolution, one compatible trusted workspace scope as resolved under the future OD-WP1-004 binding protocol, acyclic relationships, absence of hidden fallback semantics, required-extension support, and consumer-neutral compatibility constraints. |
| Trusted lifecycle owner | The trusted local control plane owns approval, issuance, revocation, runtime grants, activation, receipts, and audit facts. A bundle itself is not a grant or activation request with authority effect. |
| Permitted consumers | The trusted local control plane uses a bundle as the proposed execution composition for lifecycle checks. The Pi task adapter, pi-guard authority adapter, and completion evaluator use it to resolve the exact revisions relevant to their separate responsibilities. |
| Allowed relationships | The bundle has outgoing exact references to the four required prospective core revisions. It may declare registered required or optional extensions and consumer-neutral compatibility requirements. `ExecutionResult` may later refer back to the bundle; the bundle never refers forward to a result. |
| Prohibited relationships | An `ExecutionBundle` MUST NOT inline, reinterpret, override, or supplement a selected artifact with hidden semantics. It MUST NOT reference itself, a result, a receipt, a runtime grant, or another bundle as an authority substitute. |
| Invariants | Every consumable MVP bundle MUST select exactly one revision of each of `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, and `CompletionContract`. All four core prospective artifacts MUST be present. A context manifest MAY explicitly select no additional context, but absence of the manifest is not an implicit no-context default. `ExecutionResult` is retrospective and is not a prospective bundle member. |
| Invalid domain states | Missing, duplicate, unresolved, incompatible, circular, or cross-workspace core reference that cannot be resolved as compatible under OD-WP1-004; hidden fallback semantics; embedded authority; direct activation claim; unsupported required extension; unexpected unregistered dependency; or outcome content is invalid. |
| Extension boundary | Extensions may add registered supporting dependencies or compatibility constraints only when they preserve the four mandatory core references, do not merge responsibilities, and fail closed when required semantics are unsupported. |
| Future compatibility | Future consumers use adapters and capability negotiation. Agent-specific target configuration, invocation, command selection, or launch behavior belongs outside the core bundle. |

### ExecutionResult

| Aspect | Domain model |
| --- | --- |
| Purpose | Report what occurred during execution and completion evaluation. |
| Sole responsibility | Retrospective execution and evaluation observation. |
| Permitted conceptual contents | Execution disposition; observed outputs; observed changed resources; check outcomes; completion evaluation; reported violations; produced-artifact references; and execution-evidence references. These are observations or evaluator conclusions, not prospective requirements or trusted lifecycle facts. |
| Prohibited conceptual contents | Task redefinition; authority change; completion-contract rewrite; approval; issuance; revocation; runtime grant; activation; trusted receipt replacement; prospective instructions; and unverifiable trusted lifecycle claims. |
| Permitted producers | A completion evaluator is the required result producer for an actual evaluator-produced `ExecutionResult`. ChatGPT Web or a local human may author an untrusted candidate for evaluator review, but a candidate MUST NOT be treated as an actual evaluator-produced result merely because it is labeled as one or stored with results. Candidate-to-result adoption, evaluator provenance, and any publication conditions are deferred to OD-WP1-005. Future evaluators require compatible adapters or registered extensions. |
| Validation owner | A structural validator checks the result kind. The completion evaluator or compatible semantic result validator checks that the result is retrospective, identifies its reported subject, aligns with the exact bundle, and does not redefine prospective artifacts. The conditions for candidate adoption, evaluator provenance, publication, and downstream consumability are deferred to OD-WP1-005. |
| Trusted lifecycle owner | The trusted local control plane owns external execution receipts, activation records, audit facts, and any authoritative correlation to lifecycle events. An `ExecutionResult` remains distinct from those records. This role assignment does not imply that the approval and issuance semantics for prospective artifacts apply unchanged to results; result lifecycle and publication conditions are deferred to OD-WP1-005. |
| Permitted consumers | ChatGPT Web and local human reviewers, the completion evaluator, compatible review or reporting consumers, and future release consumers may inspect project-visible result content as untrusted material. Whether a candidate or evaluator-produced result is consumable for review, completion evaluation, downstream automation, or authoritative reporting is deferred to OD-WP1-005. No consumer may use a result as authority or a receipt. |
| Allowed relationships | A result identifies the exact `ExecutionBundle` revision and execution occurrence it reports. It may reference artifacts produced during execution and evidence observed by evaluation. Such references report observations and do not approve or activate the referenced content. |
| Prohibited relationships | An `ExecutionResult` MUST NOT be referenced by a prospective core aggregate as a prerequisite for task, authority, context, completion, or bundle meaning. It MUST NOT update an original task, authority policy, context manifest, completion contract, or bundle in place. |
| Invariants | A result is retrospective. It reports one conceptual execution subject associated with one exact bundle revision; the treatment of retries or grouped attempts is deferred to OD-WP1-002. Candidate adoption, evaluator provenance, publication, approval or issuance applicability, receipt-correlation requirements, revocation, and supersession are deferred to OD-WP1-005. A result cannot make an incomplete task complete by changing prospective requirements. |
| Invalid domain states | Missing or mismatched reported bundle; outcome used as prospective requirement; authority or lifecycle assertion without separately verifiable control-plane evidence; mutation of prospective artifacts; circular dependency; unsupported required result semantics; or use as a trusted receipt is invalid. |
| Extension boundary | Result extensions MAY refine consumer-neutral evidence, evaluation observations, or reporting semantics. They MUST NOT create authority, change prospective requirements, or assert trusted lifecycle facts. |
| Future compatibility | Review-, release-, or audit-specific interpretation belongs in compatible consumers and adapters. Trusted receipt formats and execution-record storage remain trusted-local-control-plane concerns. |

## Relationship Model

### Permitted conceptual relationships

The core relationship topology is intentionally narrow and acyclic:

1. An `ExecutionBundle` references exactly one revision of each prospective core aggregate: `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, and `CompletionContract`.
2. An `ExecutionResult` identifies the exact `ExecutionBundle` revision and execution occurrence it reports.
3. An `ExecutionResult` may reference produced artifacts or observed evidence as retrospective observations.
4. `TaskSpec` may describe expected deliverables without becoming authority.
5. `ContextManifest` may select context related to a task without containing task instructions.
6. `CompletionContract` may evaluate expected deliverables through bundle-level compatibility without becoming task intent.
7. `AuthorityPolicy` remains independent from task wording. Effective authority is calculated from trusted ceilings, approved policy, runtime grant, denials, and consumer support—not from task language.

The four prospective core aggregates do not have direct core-artifact dependencies on one another. Their compatibility is evaluated only as an explicit bundle composition. This prevents a task, policy, context selection, or completion condition from obtaining hidden meaning through a circular or override relationship.

### Conceptual relationship diagram

```text
[ExecutionBundle revision — proposed composition only]
  ├── exact reference ──▶ [TaskSpec revision]
  ├── exact reference ──▶ [AuthorityPolicy revision]
  ├── exact reference ──▶ [ContextManifest revision]
  └── exact reference ──▶ [CompletionContract revision]

[trusted local control plane] ── separately activates if eligible ──▶ [execution occurrence]
                                      (not a bundle semantic)

[ExecutionResult revision] ── identifies exact reported composition ──▶ [ExecutionBundle revision]
        │
        ├── reports ──▶ [execution occurrence]
        └── MAY reference ──▶ [produced artifacts or observed evidence]
```

Arrows from `ExecutionBundle` are directed references, not semantic inheritance. The trusted-local-control-plane activation relationship is deliberately outside bundle content: only that control plane can activate a separately eligible composition.

### Prohibited relationship patterns

The following patterns violate the core model:

- `TaskSpec` embedding effective authority, using instructions as permission, or delegating its task-instruction authority wholesale to selected context or a repository file;
- `AuthorityPolicy` embedding task intent, implementation instructions, or trusted ceiling definitions;
- `ContextManifest` embedding executable instructions, promoting commands or instructions found in selected context into task instructions, using selection as a read-policy bypass, or allowing context to override task, authority, lifecycle, or consumer safeguards;
- `CompletionContract` embedding observed pass/fail results or using required checks as authority grants;
- `ExecutionResult` modifying prospective requirements or becoming a prerequisite for their meaning;
- `ExecutionBundle` containing hidden fallback prompts, policies, commands, or replacement artifacts;
- circular dependencies that make task, authority, context, or completion meaning depend on itself; and
- any reference that permits its source to override the target aggregate's sole responsibility.

## Execution Composition Rules

`ExecutionBundle` is the only core composition boundary for one proposed execution. The following rules apply:

1. A consumable MVP bundle MUST contain exactly one reference to each of the four prospective core revisions: one task, one authority policy, one context manifest, and one completion contract.
2. A consumable MVP bundle MUST NOT omit a prospective core artifact. Explicitly selecting a context manifest that requires no additional context is distinct from omitting a context manifest.
3. An `ExecutionResult` MUST NOT be selected as a prospective bundle member. It is created after an execution occurrence and refers back to its reported subject.
4. Every required reference MUST resolve to an exact compatible revision before consumption. A path, name, latest-version convention, or unbounded query is not an exact revision selection.
5. The four selected revisions MUST resolve to one compatible trusted workspace scope. Artifact content MUST NOT define, switch, or bridge workspace authority. The source of workspace binding, which artifact kinds may be portable, reference serialization, approval correlation, and bundle-validation mechanics are deferred to OD-WP1-004.
6. Changing any selected prospective revision requires a new bundle revision. Existing bundles cannot be updated in place to point at changed content.
7. Bundle compatibility requirements MUST remain consumer-neutral. They may constrain support for a semantic requirement, but they MUST NOT express a command, launch method, agent-specific configuration, authority expansion, or activation request.
8. Required extensions or supporting dependencies MUST be explicit and supported. Unknown, unresolved, incompatible, or unsupported required semantics prevent consumption.
9. Bundle composition does not merge, copy, or reinterpret source semantics. Consumers resolve each selected aggregate through its own responsibility boundary.

## Ownership Model

### Role definitions

| Role | Sole responsibility | Trust boundary |
| --- | --- | --- |
| Content producer | Authors or revises proposed artifact content | Untrusted producer role; content claims have no lifecycle effect |
| Structural validator | Determines structural conformance to a supported kind contract | Conformance role only; no authority grant |
| Semantic validator | Determines responsibility, compatibility, and required-semantics conformance | Conformance role only; no authority grant |
| Trusted approver | Records an approval bound to a revision's canonical digest | Trusted local control plane only |
| Issuer | Makes an approved revision available under issuance rules | Trusted local control plane only |
| Revocation authority | Withdraws current usability of relevant trusted lifecycle state | Trusted local control plane only |
| Runtime-grant authority | Applies a runtime bound that can only narrow effective authority | Trusted local control plane only |
| Activation authority | Activates a separately eligible execution | Trusted local control plane only |
| Downstream consumer | Resolves and uses supported issued artifact semantics under effective authority | Bounded by adapter support and local enforcement |
| Result producer | Produces a retrospective `ExecutionResult` for an execution | Completion evaluator or compatible future evaluator |
| Receipt producer | Records trusted lifecycle or execution facts | Trusted local control plane only |
| Reviewer | Inspects drafts, bundles, results, and evidence without changing trusted lifecycle state | ChatGPT Web, local human, or a compatible review consumer |

A component MAY implement multiple roles, but it MUST not use an assertion made in one role as proof of another role's decision. In particular, a producer is not an approver merely by authoring content, a validator is not an issuer merely by accepting conformance, and a result producer is not a receipt producer merely by reporting an outcome.

### Artifact responsibility matrix

| Artifact kind | Content producer | Structural and semantic validation owner | Trusted lifecycle owner | Primary downstream consumer | Result/receipt relationship |
| --- | --- | --- | --- | --- | --- |
| `TaskSpec` | ChatGPT Web, local human, future task producer | Protocol structural and semantic validation roles | Trusted local control plane | Pi task adapter and compatible task adapters | May be correlated by evaluator; never a receipt |
| `AuthorityPolicy` | ChatGPT Web, local human, future policy producer; all proposals only narrow | Protocol structural and authority-semantic validation roles | Trusted local control plane | pi-guard authority adapter and compatible authority adapters | May constrain execution; never a task, result, or receipt |
| `ContextManifest` | ChatGPT Web, local human, future context producer | Protocol structural and context-semantic validation roles | Trusted local control plane | Pi task adapter and compatible context-loading adapters | May be inspected by evaluator when independently authorized; never a receipt |
| `CompletionContract` | ChatGPT Web, local human, future completion producer | Protocol structural and completion-semantic validation roles | Trusted local control plane | Completion evaluator and compatible evaluators | Defines prospective evaluation; never a result or receipt |
| `ExecutionBundle` | ChatGPT Web, local human, future orchestration producer | Protocol structural and bundle-semantic validation roles | Trusted local control plane | Control plane, Pi adapter, pi-guard adapter, completion evaluator | Selects prospective revisions; later reported by result; never a receipt |
| `ExecutionResult` | Completion evaluator for an actual evaluator-produced result; candidate adoption is deferred to OD-WP1-005 | Protocol structural and result-semantic validation roles, with evaluator responsibility for observations; adoption/provenance conditions are deferred to OD-WP1-005 | Trusted local control plane owns external receipt and audit correlation; result lifecycle and publication are deferred to OD-WP1-005 | Review, completion, automation, and reporting consumption remain subject to OD-WP1-005 | Is a project-visible retrospective report; MUST NOT replace a trusted receipt or imply prospective-artifact approval or issuance semantics |

## Producer Model

The model supports the following producer classes without granting any of them trusted lifecycle authority:

- **ChatGPT Web:** MAY inspect authorized workspace data and produce artifact drafts through the gateway's approved drafting boundary. It MUST NOT approve, issue, revoke, grant, activate, start Pi, alter trusted schemas or configuration, or widen authority.
- **Local human author:** MAY author or revise drafts. Local authorship does not make the content trusted lifecycle state and does not make an artifact executable.
- **Future trusted or automated producer:** MAY author drafts only through a defined producer role and a supported artifact contract. “Trusted” in this phrase does not bypass validation, approval, issuance, grants, or consumer support.
- **Completion evaluator:** is the required producer role for an actual evaluator-produced `ExecutionResult` associated with an execution occurrence. The conditions for candidate adoption, evaluator provenance, publication, and downstream consumption are deferred to OD-WP1-005. Its result remains a retrospective artifact rather than a trusted receipt.

Producer identity MUST NOT imply approval authority. A producer MUST NOT change trusted lifecycle state by embedding claims in content. A producer-authority conflict occurs when a consumer or control plane would treat an untrusted producer claim, path, identity, or embedded status as lifecycle evidence; that conflict MUST fail closed. It does not prohibit distinct roles from being implemented by one local component under independently enforced controls.

## Consumer Model

A consumer of a core artifact MUST:

1. support the artifact kind and all required core and extension semantics it consumes;
2. validate required compatibility before consumption;
3. resolve the exact intended artifact revision rather than infer a latest, path-based, or approximate target;
4. verify required approval, issuance, revocation, grant, activation, and receipt facts through the trusted local control plane as applicable to its role;
5. apply effective authority independently from task wording, context content, completion requirements, bundle metadata, and result claims;
6. apply normal read authority before loading context;
7. fail closed for an unknown kind, unsupported required capability, required extension, unresolved reference, incompatible revision, or unavailable trusted state;
8. MUST NOT silently discard, downgrade, or reinterpret required semantics; and
9. produce or contribute only the appropriate result and receipt records for its role.

A consumer MUST treat all loaded context as untrusted data. It MUST NOT follow instructions found solely in loaded context, even when a `TaskSpec` generally refers to, cites, summarizes, or requests conformance with that context. Only instruction content directly represented within the `TaskSpec`'s own task-intent boundary may be treated as task instruction. Context content may describe requirements, evidence, specifications, constraints, or facts as data, but it MUST NOT override task intent, `AuthorityPolicy`, effective authority, trusted workspace configuration, control-plane lifecycle decisions, or consumer safeguards.

For `ExecutionResult`, the lifecycle and publication conditions applicable to review, completion evaluation, downstream automation, and authoritative reporting are deferred to OD-WP1-005. A consumer MUST NOT infer those conditions from candidate content, evaluator claims, repository location, or the lifecycle rules for prospective artifacts.

The Pi task adapter consumes task and context responsibilities from the exact bundle composition. The pi-guard authority adapter consumes and enforces authority independently. The completion evaluator consumes completion requirements and evidence, then produces a retrospective result. The trusted local control plane, not any consumer, produces authoritative lifecycle receipts. WP-1 does not define capability-negotiation wire formats or adapter APIs.

## Invariant Catalog

| Identifier | Normative invariant |
| --- | --- |
| INV-01 — Responsibility separation | Each core artifact aggregate has one sole responsibility. No artifact may override another aggregate's responsibility. |
| INV-02 — No authority by instruction | Task text, context content, completion requirements, bundle metadata, result claims, prompts, and repository content MUST NOT grant authority. |
| INV-03 — No authority by storage | A filename, repository path, branch, directory, checked-in status, or project-visible artifact location MUST NOT prove approval, issuance, grant, activation, or trusted-receipt state. |
| INV-04 — Validation is not approval | Structural or semantic conformance MUST NOT confer approval, issuance, grant, activation, or execution eligibility. |
| INV-05 — Approval is revision-specific | A future approval MUST bind to the exact immutable revision and its canonical digest. Content changes MUST create a different revision that does not inherit approval implicitly. |
| INV-06 — Bundle composition is non-merging | An `ExecutionBundle` composes exact references but MUST NOT merge, inline, reinterpret, or replace the selected task, policy, context, or completion semantics. |
| INV-07 — Result is retrospective | An `ExecutionResult` reports what occurred and MUST NOT retroactively redefine task, authority, context, completion, or bundle meaning. |
| INV-08 — Context is not instruction | Loaded context remains untrusted data. Only instruction content directly represented within the `TaskSpec`'s own task-intent boundary may be treated as task instruction. A `TaskSpec` MUST NOT promote instructions embedded in referenced or loaded context merely by referring to, citing, summarizing, or requesting conformance with that context. A consumer MUST NOT follow instructions found solely in loaded context. Context may provide requirements, evidence, specifications, constraints, or facts only as data, and `ContextManifest` selection MUST NOT become task instruction or authority. |
| INV-09 — Required checks do not grant authority | A `CompletionContract` requirement does not authorize any operation. Each actor performing a check MUST independently establish effective authority. |
| INV-10 — Consumer neutrality | Core artifacts MUST NOT require Pi-specific, pi-guard-specific, Codex-specific, Cline-specific, reviewer-specific, or release-specific behavior. Such behavior belongs in adapters or registered extensions. |
| INV-11 — Fail closed | Ambiguous kind or identity, unsupported required semantics, unresolved references, incompatible revisions, circular dependencies, or unavailable required trusted state MUST prevent consumption. |
| INV-12 — No lifecycle claims by content | Artifact content may request or report lifecycle-related information, but only trusted local control-plane records establish lifecycle facts. |
| INV-13 — Authority only narrows | An `AuthorityPolicy`, extension, runtime grant, task, context, completion contract, bundle, or result MUST NOT expand global or workspace capability ceilings. Denials override allows and unknown operations are denied. |
| INV-14 — Exact prospective composition | A consumable MVP bundle MUST select exactly one revision of each required prospective core artifact and MUST NOT use an implicit default or fallback artifact. |
| INV-15 — Directed, acyclic dependencies | Core references MUST remain directed and acyclic. No prospective aggregate may depend on an `ExecutionResult`, and no reference may enable source semantics to override target semantics. |
| INV-16 — Trusted receipt separation | A project-visible `ExecutionResult` MUST NOT replace, contain, or establish a trusted local receipt. |

## Domain Failure Model

These are conceptual failure categories, not serialized error codes. “Draft may remain for correction” means it may remain untrusted content for revision; it is never consumable until the violation is corrected and all applicable validation and lifecycle checks succeed.

| Failure category | Conceptual rule violated | Actor that MUST reject or fail closed | Draft may remain for correction? | Downstream consumption |
| --- | --- | --- | --- | --- |
| Unknown artifact kind | No consumer can infer semantics for an unrecognized responsibility | Structural validator and every consumer | Yes, as unconsumed content pending supported classification | Prohibited |
| Unsupported artifact kind | A consumer lacks support for a known kind or version it is asked to consume | Consumer | Yes, for a compatible future consumer or revision | Prohibited for that consumer |
| Responsibility violation | Content crosses its aggregate's sole responsibility boundary | Semantic validator | Yes | Prohibited |
| Prohibited embedded semantics | Content embeds authority, lifecycle, fallback, result, instruction, or other prohibited semantics | Semantic validator; bundle validator for composition | Yes | Prohibited |
| Ambiguous artifact identity | Instance or revision cannot be conceptually distinguished from a path, mutable latest target, or conflicting claim | Producer and validator; consumer at resolution | Yes | Prohibited |
| Unresolved artifact reference | A required reference does not select an exact compatible target | Semantic validator and consumer | Yes | Prohibited |
| Incompatible artifact relationship | Selected revisions cannot coexist under bundle rules, workspace scope, or required semantics | Bundle semantic validator and consumer | Yes | Prohibited |
| Circular dependency | A reference cycle makes prospective meaning self-dependent or result-dependent | Semantic validator and bundle validator | Yes | Prohibited |
| Missing required artifact | A bundle omits one of the four required prospective core revisions | Structural bundle validator and consumer | Yes | Prohibited |
| Unexpected artifact | A bundle adds an unregistered dependency, duplicate core responsibility, or unsupported required extension | Bundle validator and consumer | Yes, by removing it or registering a compatible extension later | Prohibited |
| Producer-authority conflict | A producer claim, identity, location, or embedded status is treated as lifecycle authority | Semantic validator, consumer, and trusted local control plane | Yes, by removing the claim or obtaining separate trusted evidence | Prohibited |
| Lifecycle-state claim without trusted evidence | Content claims approval, issuance, grant, activation, or receipt without independently verifiable local control-plane state | Consumer and trusted local control plane | Yes | Prohibited |
| Authority expansion attempt | Policy or any other content would exceed a trusted ceiling, defeat a denial, or infer an unknown allow | Semantic validator, pi-guard authority adapter, consumer, and control plane | Yes, only as a narrowing revision | Prohibited |
| Unsupported required consumer semantics | A required capability or extension is not supported by the intended consumer | Consumer | Yes, pending a supported revision or consumer | Prohibited |
| Result-to-bundle mismatch | A result reports a different, unresolved, or incompatible bundle or execution subject | Completion evaluator or result semantic validator | Yes | Prohibited as a valid result for that execution |
| Result attempting to redefine prospective artifacts | A result modifies task, authority, context, completion, or bundle semantics rather than reporting observations | Completion evaluator or result semantic validator | Yes | Prohibited |

## Extensibility Decision Framework

### Core extension rules

Future additions MUST preserve the six core responsibilities and all invariants. A registered extension MUST declare whether it is required or optional. Consumers encountering unsupported required semantics MUST fail closed. An optional extension MAY be ignored only when its defined optional semantics make that safe and ignoring it cannot change core meaning, authority, completion obligations, lifecycle boundaries, or safety guarantees.

Extensions MUST NOT override trusted ceilings, denials, approval boundaries, artifact responsibility boundaries, or the distinction between project-visible content and trusted local state.

### Where a future concept belongs

| Candidate location | Use it only when | Do not use it when |
| --- | --- | --- |
| Field within an existing artifact, to be designed later | The concept refines only that artifact's existing sole responsibility, is consumer-neutral, and is required to interpret the core responsibility consistently | It grants authority, introduces an independent lifecycle, creates a distinct producer/consumer contract, or blends another core responsibility |
| Registered extension | The concept adds namespaced, versioned semantics that remain within an existing responsibility and can be declared required or optional without changing core safety rules | It overrides core meaning, ceilings, denials, lifecycle authority, or requires consumer-specific implementation details in common semantics |
| New artifact kind | The concept has an independent sole responsibility, lifecycle/consumer relationship, or composition role that cannot fit without overloading a core aggregate | It is merely an alternate representation, adapter configuration, or trusted local fact |
| Trusted local control-plane state | The concept proves or controls approval, issuance, revocation, grant, activation, receipt, audit, trusted configuration, or authority ceilings | It is project-visible work content, task intent, context selection, completion proof, or retrospective observation |
| Adapter concern | The concept translates a stable core responsibility to a particular agent, guard, evaluator, API, command environment, or consumer implementation | It changes common core semantics or needs to be understood by all consumers |

### Future additions

- **New artifact kinds:** Require an explicit architecture decision establishing one new responsibility, producer, validator, lifecycle relationship, consumer, trust classification, and composition rules before schema work.
- **Optional supporting artifacts:** May be referenced through registered extensions when they do not change the four mandatory prospective core references or become hidden fallback semantics.
- **New downstream consumers and adapters:** Must negotiate supported kinds, versions, required capabilities, and required extensions. They translate core semantics rather than pollute them with agent-specific configuration.
- **Richer authority capabilities:** Belong in a consumer-neutral `AuthorityPolicy` extension only if they can only narrow authority and preserve deny-overrides-allow and fail-closed behavior.
- **Richer completion checks:** Belong in a consumer-neutral `CompletionContract` extension only if they define proof obligations rather than authority or commands.
- **Review, release, and migration artifacts:** Should become new artifact kinds when they acquire an independent responsibility or lifecycle. They MUST NOT be smuggled into task, policy, bundle, or result semantics.

## Explicitly Deferred Decisions

WP-1 deliberately does not decide:

- serialized artifact envelope fields;
- `apiVersion` syntax or any equivalent version marker;
- serialized kind syntax;
- artifact-instance identifier format;
- artifact-revision identifier format;
- artifact-instance succession mechanics, recorded as OD-WP1-001;
- canonicalization method;
- digest algorithm;
- reference serialization and resolution algorithm;
- complete JSON object layouts and JSON Schemas;
- schema registry implementation;
- structural or semantic validator implementation;
- lifecycle state-machine details;
- approval, issuance, revocation, grant, activation, receipt, and audit record structures;
- artifact workspace binding, portability, cross-workspace reference treatment, and approval correlation, recorded as OD-WP1-004;
- execution-occurrence and retry grouping mechanics, recorded as OD-WP1-002;
- `ExecutionResult` lifecycle, publication, provenance, receipt correlation, revocation, and supersession, recorded as OD-WP1-005;
- extension namespace governance, recorded as OD-WP1-003;
- persistence and storage implementation;
- adapter APIs and capability-negotiation wire formats;
- MCP tools;
- FFF integration;
- Pi integration; and
- pi-guard implementation changes.

## Unresolved Questions

The following scoped open decisions were discovered during WP-1. They do not block the conceptual model, but they block affected serialization, validation, lifecycle, or integration work. Their full records are in `docs/design/wp-1-open-decisions.md`.

- **OD-WP1-001 — Artifact-instance succession and revision lineage:** must be resolved before identity, revision, and reference protocol design.
- **OD-WP1-002 — Execution occurrence and retry/result grouping:** must be resolved before `ExecutionResult`, receipt-correlation, and execution-record protocol design.
- **OD-WP1-003 — Registered extension namespace governance:** must be resolved before extension registry, extension schema, or extension-negotiation work.
- **OD-WP1-004 — Artifact workspace binding and portability:** must be resolved before workspace-aware identity, reference, compatibility, storage, approval-correlation, or bundle-validation protocol design.
- **OD-WP1-005 — ExecutionResult lifecycle and publication:** must be resolved before result schema, provenance, candidate adoption, publication, receipt-correlation, automation, or authoritative reporting protocol design.

No accepted WP-0 inconsistency blocks this domain model.

## WP-1 Completion Criteria

WP-1 is complete for human review when:

- all six core kinds have one clear sole responsibility, permitted and prohibited conceptual content, role ownership, consumers, relationships, invariants, invalid states, extension boundaries, and future-compatibility constraints;
- artifact kind, instance, revision, draft, reference, aggregate, execution composition, and execution observation are conceptually distinct;
- a consumable MVP `ExecutionBundle` is defined as an exact, non-merging composition of one revision of each four prospective core artifacts;
- `ExecutionResult` is defined as retrospective and distinct from a trusted receipt;
- producer, validator, lifecycle owner, consumer, result producer, receipt producer, and reviewer roles remain separate;
- generated authority only narrows and all unsupported required semantics fail closed;
- no JSON fields, schemas, serialized formats, lifecycle record formats, tools, adapters, integrations, storage, or production code are designed;
- open decisions are recorded without silently making them; and
- the responsibility matrix and ADR-005 through ADR-007 agree with this document and the accepted WP-0 baseline.

Document completion does not approve an artifact, activate an execution, or close WP-1. Human review and an explicit approval decision remain required.

## Handoff Requirements for the Next Work Package

The next protocol work package MUST treat this domain model, the responsibility matrix, ADR-005 through ADR-007, and the accepted WP-0 documents as binding constraints. It MUST:

1. resolve OD-WP1-001 before standardizing artifact instance, revision, or reference identifiers;
2. resolve OD-WP1-002 before standardizing execution-result, execution-record, retry, or receipt-correlation semantics;
3. resolve OD-WP1-003 before creating extension registry, namespace, or negotiation mechanisms;
4. resolve OD-WP1-004 before standardizing workspace-aware identity, reference, cross-workspace compatibility, storage lookup, approval correlation, issued-artifact resolution, portable-artifact reuse, or bundle workspace validation;
5. resolve OD-WP1-005 before standardizing `ExecutionResult` schema, evaluator provenance, candidate adoption, publication, supersession, receipt correlation, downstream result-consumption, automated completion, review, or authoritative reporting semantics;
6. define serialized envelopes, versioning, canonical representation, digest binding, and reference mechanics without erasing kind/instance/revision distinctions;
7. define schemas and structural/semantic validators without allowing validation to grant lifecycle authority;
8. preserve the four mandatory prospective bundle references, the result's retrospective boundary, and the prohibition on context-to-instruction promotion;
9. define trusted local lifecycle records separately from project-visible artifact content;
10. preserve consumer neutrality and route Pi-, pi-guard-, Codex-, Cline-, reviewer-, and release-specific behavior through adapters or registered extensions; and
11. avoid implementation, MCP tool design, FFF integration, Pi integration, pi-guard changes, or storage design unless explicitly authorized by a later work package.
