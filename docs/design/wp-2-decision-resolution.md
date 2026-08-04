# WP-2 Decision Resolution

**Status:** Authoritative WP-2 resolution record
**Resolves:** OD-WP1-001 through OD-WP1-005

## Purpose

This document records the authoritative decisions made by WP-2 for the five open questions carried from the accepted WP-1 domain model. It is a decision companion to:

- `docs/design/artifact-identity-versioning-reference-lifecycle-protocol.md`;
- `docs/design/artifact-envelope-reference-profile.md`; and
- `docs/design/trusted-lifecycle-protocol.md`.

The decisions below are no longer open. They preserve the accepted WP-0 and WP-1 aggregate, trust, authority, context, consumer-neutrality, and result/receipt boundaries.

## OD-WP1-001 — Artifact-Instance Succession and Revision Lineage

### Original question

What rules determine whether changed content is a new revision of an existing artifact instance versus a new artifact instance, and how may permitted lineage be declared or verified?

### Selected decision

WP-2 selects opaque, globally non-reusable 128-bit random artifact-instance IDs and distinct opaque 128-bit random revision IDs. A trusted local identity registrar assigns or accepts these IDs after structural envelope validity; a producer may only propose them in an untrusted draft.

A generation-zero revision creates a new instance and has no predecessor. A continuation of an existing instance is a new revision with exactly one exact predecessor reference to the same kind and instance, and generation exactly one greater than its predecessor. Revision ID is distinct from canonical digest. The digest covers instance ID, revision ID, generation, predecessor, and workspace binding.

Canonicalization validates rather than transforms: every digest-covered string MUST already be NFC; non-NFC strings and duplicate member names are rejected before RFC 8785 JCS serializes the accepted data model. The protocol MUST NOT silently normalize artifact content. JCS does not perform Unicode normalization.

Lineage may branch but MUST NOT merge. Workspace binding is immutable within an instance: predecessor and successor have the same portable/bound mode and, when bound, the same workspace ID. A changed canonical projection creates a new revision and cannot inherit lifecycle state. A predecessor declaration is not approval, issuance, grant, activation, or producer-authority proof. Byte-identical mirroring preserves the same subject; a migration that changes canonical content, identity, semantics, or workspace binding creates a new generation-zero subject with no artifact predecessor and requires a trusted migration record for correlation.

### Rationale

Distinct opaque IDs prevent identity from being inferred from a path, filename, body similarity, timestamp, producer, or digest alone. Digest binding independently proves immutable bytes. One predecessor creates auditable continuation without allowing a document to merge or inherit lifecycle authority from multiple ancestors.

### Consequences

- An instance ID belongs to exactly one artifact kind and is never reused, including after deletion or archival.
- A revision ID maps to exactly one instance and canonical digest.
- One canonical revision belongs to one instance only.
- A new logical artifact receives a new instance; a correction or continuation retains the instance, names a valid predecessor, and retains exactly the same workspace-binding declaration.
- Existing approvals, issuances, grants, activations, publications, and receipts remain historical facts for their exact subject only.
- Exact references verify protocol/kind/version, instance, revision, digest, and workspace binding together.

### Rejected alternatives

1. **Path-, filename-, branch-, or Git-derived identity:** Rejected because mutable repository locations do not identify immutable content or trusted lineage.
2. **Digest as the only revision identity:** Rejected because it collapses registered revision identity into content equality and does not preserve the distinct instance/revision/digest concepts required by WP-1.
3. **Producer assertion as sufficient succession proof:** Rejected because a producer claim cannot establish trusted identity continuity or lifecycle authority.
4. **Multiple lineage parents/merge revisions:** Rejected because it creates ambiguous lifecycle and provenance inheritance.
5. **Automatic semantic similarity inference:** Rejected because text similarity cannot safely decide logical continuity.

### Affected protocol sections

- Artifact-Instance Identity
- Revision Identity and Lineage
- Canonical Representation and Digest Protocol
- Exact Artifact References
- Migration and Evolution

### Downstream handoff

Schema, identity-registry, canonicalization, reference-resolution, validator, and audit work MUST represent instance, revision, digest, predecessor, and workspace binding as distinct immutable concepts. It MUST reject ID reuse, non-NFC canonical input, duplicate parser-ambiguous keys, wrong-instance or cross-binding predecessor, wrong generation, false lineage, binding mutation, and aliases used as exact references.

## OD-WP1-002 — Execution Occurrence, Retry, and Result Grouping

### Original question

Does one `ExecutionResult` report one activation attempt, one execution attempt, a group of retries under one bundle, or a separate summary of multiple attempts? How are those observations correlated with trusted receipts without making the result itself a receipt?

### Selected decision

Every activation decision creates exactly one immutable `ActivationRecord` with an `accepted` or `denied` decision. An accepted decision creates exactly one execution occurrence. A denied decision creates no occurrence or attempt and permanently closes its reserved occurrence ID and runtime grant for activation/execution use. An occurrence has zero or more ordered execution attempts. A retry is a later attempt in the same occurrence, with a new attempt ID and ordinal, and it cannot change the exact bundle, workspace, or occurrence grant scope.

The runtime grant is per occurrence. It is bound to a reserved occurrence ID and contains an explicit finite attempt allowance. A retry may reuse it only while its allowance, validity, revocation state, and point-of-use checks permit it. A new activation creates a new occurrence and a new grant; it cannot reuse a denied reservation, grant, or activation record.

An evaluator-produced `ExecutionResult` binds exactly one occurrence and exactly one attempt. The first successful evaluator adoption or origination atomically establishes at most one evaluator-produced result instance for that attempt. The protocol does not fabricate an evaluator result when an evaluator cannot produce one; an attempt may therefore have no evaluator-produced result while trusted receipts still report execution facts. Corrections are successor revisions of that same result instance. Retry aggregation is not an `ExecutionResult`; it is optional separate trusted `ExecutionSummaryRecord` reporting state.

### Rationale

The model preserves per-attempt evidence and prevents retries from hiding changes to authority, workspace, context, bundle selection, or execution history. It allows reliable receipt correlation without turning a project-visible report into a trusted record.

### Consequences

- Activation, reserved occurrence, occurrence, attempt, result instance, publication, and receipt IDs are distinct.
- A denied activation has no occurrence or attempt.
- A cancelled occurrence before an attempt has trusted occurrence facts but no attempt.
- A started abandoned, rejected, cancelled, timed-out, or crashed attempt has an attempt record and receipts; if no compatible evaluator result exists, completion/automation/reporting consumption fails closed.
- Multiple attempts and occurrences may refer to one exact bundle; their results never silently aggregate.
- A trusted summary may correlate per-attempt facts but cannot serve as completion proof or a core result.

### Rejected alternatives

1. **One result per bundle regardless of attempts:** Rejected because it hides retry and occurrence evidence.
2. **One result per activation request:** Rejected because denied activation may have no execution attempt and result semantics would blur activation/observation.
3. **Make every attempt fabricate a result:** Rejected because no evaluator observation can be invented when evaluator evidence is unavailable.
4. **Treat retry as new bundle or new occurrence automatically:** Rejected because it obscures a controlled retry of the same execution subject.
5. **Aggregate retries inside `ExecutionResult`:** Rejected because it overloads retrospective per-attempt observation and weakens auditability.

### Affected protocol sections

- Trusted Lifecycle Record Model
- Execution Occurrence, Attempts, and Retries
- ExecutionResult Lifecycle and Publication
- Point-of-Use Verification

### Downstream handoff

Lifecycle and evaluator work MUST allocate distinct reserved-occurrence, occurrence, and attempt identifiers; make denied activation terminal; preserve ordered per-attempt receipts; atomically enforce one result instance per attempt; prevent retry substitution; and require exact receipt correlation for privileged result uses. Summary views MUST use separate trusted reporting state.

## OD-WP1-003 — Registered Extension Namespace Governance

### Original question

Who governs registered extension namespaces, version compatibility, required-versus-optional declarations, and collision resolution while preserving the prohibition on ChatGPT-controlled schema registration?

### Selected decision

WP-2 selects a human-approved Project Gateway Protocol Registry outside managed repositories. Each accepted protocol release carries an immutable `RegistrySnapshot` with opaque `pgw:g:` identity, a domain-separated `PGAP-REGISTRY-SNAPSHOT-v1\u0000` SHA-256 digest, registry format version, and exact Project Gateway protocol-release or compatibility declaration. Trusted local control-plane configuration selects accepted snapshots by exact `RegistrySnapshotReference` and may narrow or disable local support, but it may not add, redefine, override, or resolve registry entries absent the same human-approved governance.

Namespace registration, ownership, security review, contract version, kind/protocol compatibility, deprecation, supersession, and ignore-safety are authoritative snapshot facts. Artifact content declares only a registered namespace/version/mode/payload; it does not register semantics or select trusted snapshot identity. Required extensions fail closed when unsupported. Optional extensions can be ignored only when the registry expressly marks them ignore-safe and all core-boundary conditions are met. Validation, approval where registry-governed semantics apply, compatibility, issuance, activation, and consumer support bind exact snapshot context rather than a label, tag, path, or filename. At protocol-envelope, kind-contract, extension-contract, and feature/capability-contract levels, any change an old conforming consumer could accept but interpret or enforce differently is major; a minor change is additive only when old consumers process identically or detect an explicit requirement and fail closed.

### Rationale

A release-snapshotted human-governed registry prevents repository content and producers from claiming common semantic authority while allowing extensions to evolve in a reviewable, consumer-neutral manner.

### Consequences

- Namespace syntax is lowercase reverse-domain-style ASCII and ownership is registry-defined.
- A collision, unregistered namespace, registry disagreement, owner mismatch, or unsupported contract version fails closed.
- Extension payload, declaration, mode, and version are artifact-digest-covered; registry snapshot identity and digest are separate trusted protocol-subject facts.
- Extension deprecation does not rewrite historical interpretation or silently migrate artifacts.
- Consumer support must explicitly include required extension versions and semantics.

### Rejected alternatives

1. **Repository-resident extension registry:** Rejected because project content is untrusted and could self-register semantics.
2. **ChatGPT- or producer-controlled namespace allocation:** Rejected because untrusted production cannot create trusted common contracts.
3. **Unversioned free-form extension keys:** Rejected because collisions and compatibility cannot be decided safely.
4. **Best-effort ignoring of unknown required extension data:** Rejected because required semantics may affect safety or meaning.
5. **A local registry permitted to override release semantics:** Rejected because local convenience would fragment core contract interpretation.

### Affected protocol sections

- Protocol, Kind, Extension, and Capability Versioning
- Extension Namespace Governance
- Compatibility and Negotiation
- Protocol Failure Model

### Downstream handoff

Registry, schema, validator, consumer, and adapter work MUST obtain extension contracts from exact accepted trusted snapshot references; must preserve major/minor change classification and required/optional semantics; and must reject producer-controlled snapshot substitution, registration, collision, digest mismatch, or unsupported required semantics.

## OD-WP1-004 — Artifact Workspace Binding and Portability

### Original question

Which artifact kinds are intrinsically bound to one trusted workspace, which may be portable across workspaces, and at what point is a portable artifact bound to the trusted workspace scope of an execution?

### Selected decision

`AuthorityPolicy`, `ContextManifest`, `ExecutionBundle`, and `ExecutionResult` are intrinsically workspace-bound. `TaskSpec` and `CompletionContract` may be either portable or workspace-bound. Workspace binding is mandatory, digest-covered envelope content and immutable for an artifact instance. A bound artifact carries one opaque trusted workspace ID; a portable artifact carries an explicit portable mode, not an omitted workspace field. Every successor revision preserves exactly the same mode and, when bound, workspace ID.

A bundle carries a digest-covered bound proposed-execution workspace and resolves to exactly one trusted workspace. It records the selected scope but does not create trusted workspace registration, authority, or activation. Policy and context must match the bundle workspace. A bound task or completion contract must match; a portable task or contract is usable only after workspace-scoped compatibility, approval, and issuance checks succeed.

Every execution-use approval and issuance, including for portable task and completion revisions, is scoped to one trusted workspace. A portable revision may have separate approval/issuance records in multiple workspaces, but no record is portable or replayable across them. A mode or bound-workspace change requires a new instance and generation-zero revision with no artifact predecessor; a `MigrationRecord` may correlate it but does not create lineage or transfer lifecycle authority.

### Rationale

Policy and context must remain tied to the trusted workspace whose capabilities and read boundary they constrain. A bundle must name one execution scope. Portable task and completion content can be legitimately reused while their use authorization remains workspace-specific.

### Consequences

- Artifact content never establishes trusted workspace registration.
- Context selection cannot escape a selected trusted workspace.
- A policy approved in one workspace cannot be applied in another without a new bound revision and fresh lifecycle records.
- Core cross-workspace references fail closed.
- A result must bind the same workspace as its reported occurrence/attempt and receipt correlation.
- All four bundle members and the bundle itself need matching workspace-scoped approval and issuance for execution.

### Rejected alternatives

1. **All six kinds universally portable:** Rejected because authority, context, composition, and retrospective occurrence facts require a trusted workspace scope.
2. **All prospective kinds always workspace-bound:** Rejected because task intent and completion proof can remain consumer-neutral portable content without weakening authorization.
3. **Workspace binding only in paths or storage lookup:** Rejected because paths are not trusted identity or immutable content.
4. **Bundle content creates trusted workspace binding:** Rejected because project-visible content cannot establish trusted configuration or authority.
5. **Portable approval with no workspace scope:** Rejected because it enables cross-workspace approval replay.

### Affected protocol sections

- Common Artifact Envelope
- Exact Artifact References
- Workspace Binding and Portability
- Approval, Issuance, and Usage Binding
- Compatibility and Negotiation

### Downstream handoff

Schema, resolver, lifecycle, and consumer work MUST make binding explicit and digest-covered; verify a single trusted bundle workspace; reject cross-workspace core targets; and bind approval/issuance to exact workspace scope even for portable content.

## OD-WP1-005 — ExecutionResult Lifecycle and Publication

### Original question

What lifecycle conditions make an `ExecutionResult` consumable as an evaluator-produced retrospective artifact, and how is that status distinguished from an untrusted candidate result and from a trusted local execution receipt?

### Selected decision

WP-2 selects a distinct result lifecycle, not prospective-artifact approval/issuance. A candidate is untrusted project-visible result content with no trusted attempt-to-result-instance ownership. The first compatible completion evaluator may originate one result instance or adopt one exact validated candidate, atomically establishing the unique evaluator-produced result instance for that exact workspace/bundle/occurrence/attempt. A trusted `ResultPublicationRecord` then attests evaluator provenance, unique result instance, exact result revision/bundle/workspace/occurrence/attempt binding, validation, exact registry context, and allowed consumption scope. A second result instance for the attempt fails closed.

A published evaluator-produced result is sufficient for ordinary review when it has passing validation, evaluator provenance, an active ordinary-review publication, and no relevant revocation. It requires matching trusted receipt correlation before it is consumable for completion status, downstream automation, or authoritative reporting. `ExecutionResult` does not require `ApprovalRecord` or `IssuanceRecord` and publication never makes it a trusted receipt.

Result corrections create new immutable revisions of the same unique result instance. A trusted `SupersessionRecord` can designate a later revision or publication of that same instance as currently preferred for a stated scope. A `RevocationRecord` can withdraw publication without deleting historical result content; it cannot revoke a receipt, activation, occurrence, attempt, or supersession event.

### Rationale

The selected lifecycle admits trustworthy evaluator provenance and ordinary review without treating a result as a prospective authority artifact. It adds receipt correlation only where a consumer needs trusted evidence that the reported execution facts correspond to an actual trusted occurrence.

### Consequences

- Candidate, validated, evaluator-produced, published, receipt-correlated, revoked-publication, and superseded-publication states are distinct external facts.
- Human or ChatGPT inspection of candidate content remains permitted as untrusted review under ordinary read policy.
- Publication must contain explicit use scope; automation cannot infer permission from result content.
- An absent evaluator result is not replaced by a synthetic result; receipt facts remain separate.
- Historical erroneous results remain inspectable; they are not silently deleted or overwritten.

### Rejected alternatives

1. **Apply prospective approval and issuance unchanged to results:** Rejected because retrospective reports do not authorize future use in the same way as prospective artifacts.
2. **Treat evaluator annotation or producer claim as provenance:** Rejected because project-visible content cannot establish trusted evaluator role.
3. **Require receipt correlation for all inspection:** Rejected because ordinary review can safely inspect untrusted or provenance-published content without authority effect.
4. **Permit automation after evaluator provenance alone:** Rejected because it would let a report claim execution facts without trusted occurrence correlation.
5. **Use result publication as a receipt:** Rejected because publication attests result provenance/use scope and does not replace trusted execution-event facts.
6. **Edit erroneous result content in place:** Rejected because immutable audit history requires a new revision and explicit supersession.

### Affected protocol sections

- Trusted Lifecycle Record Model
- Execution Occurrence, Attempts, and Retries
- ExecutionResult Lifecycle and Publication
- Protocol Failure Model
- Point-of-Use Verification

### Downstream handoff

Result schema, evaluator, lifecycle, reporting, and automation work MUST keep candidate content, evaluator adoption/origination, validation, publication, receipt correlation, revocation, and supersession as distinct steps. It MUST never use a project-visible result as a trusted receipt or prospective authority record.

## Resolution Completion

OD-WP1-001, OD-WP1-002, OD-WP1-003, OD-WP1-004, and OD-WP1-005 are resolved by this document and the cited WP-2 protocol documents. They MUST NOT be carried forward as open decisions.
