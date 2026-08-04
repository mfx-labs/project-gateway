# Project Gateway MCP Glossary

This glossary defines foundational and approved protocol terms. It establishes conceptual boundaries and selected protocol rules, not field-level schemas, persistence formats, APIs, or implementation topology.

## Artifact

A structured protocol document governed by an artifact-kind contract. The term may be qualified to distinguish an artifact kind, artifact instance, and artifact revision. Artifact content is project-visible data unless a separate trusted local record establishes a lifecycle state. An artifact does not gain authority merely by existing, validating, or being stored in a particular path.

## Artifact Kind

One stable protocol responsibility, such as task intent or authority constraints. A kind is distinct from an artifact instance and revision, and it does not imply approval, issuance, authority, or consumer support. A canonical envelope identifies a kind through a stable kind ID and separate kind-contract version.

## Artifact Instance

The conceptual identity of one logical artifact across one or more revisions. Instance identity is distinct from content identity and cannot be proven by a path, filename, branch, directory, or producer assertion. An instance ID is an opaque, non-reusable protocol identifier; valid continuation uses an exact predecessor lineage rather than path or content-similarity inference. Workspace binding is an instance invariant: every revision retains the same portable/bound mode and, if bound, the same workspace ID.

## Artifact Draft

A proposed artifact revision created by a producer, including ChatGPT Web. A draft is untrusted content and has no approval, issuance, grant, or activation authority. A draft may later pass validation, but a validated draft remains unapproved until trusted local approval is bound to its canonical digest.

## Validated Artifact

An artifact draft that has passed applicable structural and semantic validation. Validation establishes conformance only. A validated artifact is not thereby approved, issued, granted, or executable.

## Approved Artifact

An artifact revision for which a trusted local control plane has recorded an approval bound to that revision's canonical digest. Approval is distinct from issuance and activation. An approved artifact is not automatically available to a consumer or active for an execution.

## Issued Artifact

An approved artifact revision that a trusted local control plane has made available for authorized consumer use according to its issuance rules. Issuance is a separate lifecycle act from approval and does not itself activate execution.

## Artifact Revision

One immutable conceptual content version of an artifact instance. A revision is the unit to which validation, canonical digest, approval, issuance, comparison, and bundle selection apply. Changing canonical content creates a different revision, and an issued revision MUST NOT be edited in place. A revision has an opaque revision ID distinct from its canonical digest. A successor retains its instance's exact workspace-binding declaration; changing binding requires a new instance and generation-zero revision, not a predecessor relationship. Storage remains outside the glossary's scope.

## Canonical Digest

A deterministic domain-separated SHA-256 digest of an artifact revision's canonical projection. It is distinct from revision ID, file hash, Git object ID, approval, and receipt. Every digest-covered string MUST already be Unicode NFC; a non-NFC string is rejected and MUST NOT be silently normalized. A trusted approval binds to this digest and exact subject scope so changed content cannot inherit approval implicitly.

## Artifact Reference

A conceptual directional relationship from one artifact revision to another artifact revision or another explicitly permitted observed artifact. A consumable reference MUST be an exact artifact reference that identifies and verifies the target protocol/kind version, instance ID, revision ID, canonical digest, and workspace binding. It does not copy, merge, approve, issue, grant, activate, or override its target.

## Artifact Aggregate

The conceptual consistency boundary for one core artifact kind. Each aggregate has one sole responsibility, its own revisions, validators, and invariants. This term does not prescribe a code structure, database aggregate, file, or process.

## Execution Bundle

An artifact that identifies which exact artifact revisions constitute one proposed execution. It composes references without merging task, authority, context, completion, and result responsibilities. An execution bundle is not an approval, issuance, grant, or activation command.

## Execution Result

A structured, retrospective artifact reporting what occurred during execution and evaluation. It is distinct from a `CompletionContract`, which defines how completion must be proven before execution. An execution result is not authority, prospective-artifact approval or issuance, or a trusted local execution receipt. A candidate result becomes evaluator-produced and scope-limited published only through an active trusted `ResultPublicationRecord` that binds evaluator provenance and the one unique result instance for its exact attempt; receipt correlation is additionally required for completion-status consumption, downstream automation, and authoritative reporting.

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

A trusted local control-plane decision accepting one exact prospective artifact revision for a defined purpose and trusted workspace, recorded as a binding to protocol/kind version, instance ID, revision ID, canonical digest, workspace, and required semantic context. Approval is not validation, issuance, a runtime grant, or activation.

## Issuance

A trusted local control-plane act that makes an approved prospective artifact revision available for a defined workspace and authorized consumer use. Issuance is not implied by approval, does not itself start execution, and does not apply to `ExecutionResult` publication.

## Grant

A trusted local runtime constraint associated with one reserved execution occurrence. A grant can narrow when or how already-permitted authority is available and may set a finite attempt allowance; it cannot add capability beyond global and workspace ceilings, approved policy, or consumer support. A denied activation permanently closes its associated grant for activation and execution use.

## Revocation

A trusted local control-plane record that withdraws the current usability or publication of one exact `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, or `ResultPublicationRecord` for its stated scope. It does not revoke, delete, or erase historical validation, activation, occurrence, attempt, receipt, migration, supersession, or audit facts. Repository content MUST NOT revoke or reinstate authoritative state. Consumers MUST fail closed when required current revocation status cannot be determined.

## Receipt

A trusted local historical fact record of a lifecycle or execution event, such as approval, issuance, grant use, activation decision, occurrence, or attempt fact. A receipt remains outside the repository, is distinct from a project-visible `ExecutionResult` artifact, is not revocable as an erased fact, and is required to corroborate privileged result uses where the protocol requires receipt correlation.

## Completion Contract

An artifact that specifies how task completion must be proven or evaluated. It defines prospective requirements and must remain separate from task instructions, authority, and retrospective execution results.

## Trusted Local Control Plane

The locally controlled authority boundary that maintains authoritative policy lifecycle and runtime records, including approvals, issuances, revocations, grants, activations, receipts, and audit state. It is outside managed repositories and is not controlled by ChatGPT Web or repository content.

## Required Extension

A registered extension whose semantics a consumer MUST understand and enforce for a particular artifact or execution to be valid. A consumer that does not support a required extension MUST fail closed and MUST NOT silently ignore or downgrade it.

## Optional Extension

A registered extension explicitly designated as optional by its authoritative registry contract. A consumer MAY ignore it only when that contract marks it ignore-safe and doing so cannot change core artifact meaning, authority, completion obligations, workspace binding, lifecycle requirements, reference semantics, or safety guarantees. Optional extensions MUST NOT override capability ceilings, denials, approval requirements, or trusted-state boundaries.

## Protocol Version

The `MAJOR.MINOR` version that controls interpretation of the common artifact envelope and canonicalization profile. It is distinct from kind-contract, extension-contract, and consumer-capability versions. A version number alone is not proof of compatibility. A breaking semantic or compatibility change requires a new major version; a minor change is additive only when old meaning, validity, canonical interpretation, and safety guarantees remain unchanged and older consumers process identically or detect an explicit unsupported requirement and fail closed.

## Artifact-Kind Contract Version

The `MAJOR.MINOR` version that controls interpretation of one artifact kind's body and kind-specific invariants. It is distinct from protocol envelope version and extension version. Major/minor classification depends on semantic and compatibility effect, not author preference or numeric ordering alone.

## Revision ID

An opaque, non-reusable identifier for one canonical revision. It is distinct from instance ID, canonical digest, generation, predecessor, alias, path, and filename. A revision ID is bound to one instance and one canonical digest.

## Canonical Artifact Revision

The immutable digest-covered envelope projection for one artifact instance and revision ID. It includes protocol and kind metadata, identity, lineage, workspace binding, requirements, extensions, and kind body; it excludes derived digest and non-authoritative annotations.

## Exact Artifact Reference

A digest-covered reference that identifies a target's protocol version, kind and kind version, instance ID, revision ID, canonical digest, and workspace binding. It is verified on resolution and cannot be a path, filename, alias, query, version range, partial digest, or fallback target.

## Workspace Binding

The explicit digest-covered portable or bound relationship between an artifact revision and a trusted workspace ID. Artifact content declares a binding but cannot create trusted workspace registration, authorization, approval, or activation. The declaration is immutable for one artifact instance: every successor retains the same mode and, if bound, the same workspace ID. Every execution-use approval and issuance is workspace-scoped.

## Lifecycle Record

An immutable trusted local control-plane record for one distinct validation, approval, issuance, revocation, grant, activation, occurrence, attempt, receipt, result-publication, supersession, migration, or audit fact. It binds exact protocol subjects and required exact registry snapshot context and remains outside managed repositories. Only approval, issuance, runtime-grant, and result-publication records are revocable usability or publication records; other listed event/assessment records are historical facts.

## Execution Occurrence

The execution subject created by one successful trusted activation of one exact issued bundle in one trusted workspace. It is distinct from activation, attempt, retry, result, and receipt.

## Execution Attempt

One ordered run within an execution occurrence. A retry is a later attempt in the same occurrence and retains the same exact bundle, workspace, and occurrence grant scope.

## Result Publication

A trusted local record that attests compatible evaluator provenance, atomic adoption or origination of the unique result instance for one exact attempt, exact result/occurrence binding, exact registry context, and allowed result-consumption scope. It is distinct from prospective approval or issuance and from a trusted receipt.

## Evaluator Provenance

The trusted-local attestation of the identity, compatible capability/profile, and adoption-origination responsibility of the completion evaluator for one exact `ExecutionResult` revision. An annotation, producer claim, path, or result body cannot establish it.

## Supersession

A trusted local record that designates an exact successor revision or publication for one stated use or reporting scope. It does not mutate, delete, revoke, or transfer lifecycle authority from the earlier subject.

## Extension Registry Snapshot

An immutable human-approved protocol registry catalog selected by trusted local configuration. It is a trusted external protocol subject, not a core artifact. It has exact opaque identity and a distinct domain-separated digest, and defines namespace ownership, extension contracts, required-versus-optional rules, compatibility, deprecation, and ignore-safety; repository content and producers cannot alter it.

## Kind Version

The `MAJOR.MINOR` artifact-kind contract version. It is also called an Artifact-Kind Contract Version and controls one kind body's meaning and invariants, independently from protocol, extension, and capability versions.

## Contract Major Version

The first component of a contract version. It changes when a previously conforming implementation could accept a subject but interpret, validate, authorize, canonicalize, reference, enforce, or consume it differently under the new contract.

## Contract Minor Version

The second component of a contract version. It changes only for additive compatible evolution that preserves previous validity, meaning, canonical interpretation, and safety, and that old consumers either process identically or reject through an explicit unsupported requirement.

## Canonical Revision

The Canonical Artifact Revision for one instance and revision ID: the accepted immutable digest-covered data model serialized by the selected canonicalization profile. It excludes non-authoritative annotations and derived digest.

## Canonicalization Profile

The named deterministic validation-and-serialization rules used to form canonical bytes. The current artifact profile uses RFC 8785 JCS only after duplicate-key rejection and validation that every digest-covered string is already NFC. It does not silently normalize artifact content.

## Artifact Digest

The domain-separated `sha-256:` digest of one Canonical Revision. It uses the artifact-revision digest domain and is distinct from a Registry Snapshot Digest, file hash, Git object ID, revision ID, approval, and receipt.

## Workspace-Binding Continuity

The requirement that every revision of one artifact instance retains exactly the same portable/bound mode and, if bound, the same workspace ID. A binding change requires a new instance, generation-zero revision, no artifact predecessor, and fresh lifecycle decisions where applicable. Migration correlation is not lineage.

## Historical Fact Record

An immutable trusted record that preserves that an assessment, decision, event, or observation occurred. Validation, activation, occurrence, attempt, trusted receipt, execution summary, migration, supersession, and audit records are historical fact or assessment records; they are not revocable as erased facts.

## Reserved Occurrence ID

An opaque occurrence ID allocated before or atomically with activation and bound to one runtime grant. It may have exactly one activation decision. It becomes an execution occurrence only when that decision is accepted; a denied decision permanently closes it.

## Activation Decision

The immutable accepted-or-denied decision recorded by one `ActivationRecord` for one reserved occurrence ID. An accepted decision creates exactly one occurrence; a denied decision creates no occurrence or attempt and permanently closes its grant for activation/execution use.

## Retry

An execution attempt after the first within the same occurrence. It retains the exact bundle, workspace, occurrence grant, and supported semantics, and may proceed only while the grant allowance and point-of-use checks remain valid.

## Candidate ExecutionResult

Untrusted project-visible `ExecutionResult` content that has no trusted evaluator provenance or trusted attempt-to-result-instance association. Multiple candidate forms may exist, but none establishes evaluator-produced result ownership by label, location, or annotation.

## Evaluator-Produced ExecutionResult

A revision of the one unique result instance atomically adopted or originated by a compatible evaluator for one exact workspace, bundle, occurrence, and attempt, and attested by an active `ResultPublicationRecord`.

## Result Instance

The one artifact instance that may be associated as evaluator-produced with one execution attempt. The first successful evaluator adoption or origination establishes the trusted association. Corrections and replacements are successor revisions of this same instance; a second evaluator-produced instance for the attempt is a fail-closed conflict.

## Trusted Receipt

A Receipt maintained outside managed repositories by the trusted local control plane. It is an immutable historical event fact, distinct from `ExecutionResult`, and never becomes revocable merely because current usability or publication changes.

## Registry Snapshot

An Extension Registry Snapshot identified by an opaque, globally non-reusable `pgw:g:` ID and governing a fixed registry format/version and Project Gateway protocol-release or compatibility declaration. It is not a core artifact and cannot be created or substituted by repository content, artifact content, ChatGPT Web, or producers.

## Registry Snapshot Reference

The exact external reference to a Registry Snapshot: registry protocol identifier, registry snapshot format version, opaque snapshot ID, canonical snapshot digest, and associated Project Gateway protocol-release or compatibility declaration. A label, filename, path, tag, or release name is not a Registry Snapshot Reference.

## Registry Snapshot Digest

The distinct domain-separated `sha-256:` digest of canonical Registry Snapshot content, using `PGAP-REGISTRY-SNAPSHOT-v1\u0000` rather than the artifact-revision digest domain. Registry snapshot data is validated for duplicate keys and already-NFC digest-covered strings before RFC 8785 JCS serialization; it is not silently normalized.

## Structural Validation

The ordered validation of raw input, canonical-input preconditions, local schema selection, closed JSON Schema contracts, canonical ordering, and derived digest assertions. Structural Validation establishes conformance only; it never establishes approval, issuance, a grant, activation, publication, evaluator provenance, workspace registration, or a receipt.

## Semantic Validation

The fail-closed validation of protocol meaning that requires cross-field, cross-artifact, registry, identity, workspace, lifecycle, consumer-support, or point-of-use inputs beyond one JSON Schema evaluation. Semantic Validation establishes conformance only and does not create trusted lifecycle authority.

## Canonical-Input Validation

The pre-canonicalization validation of one parsed JSON data model: duplicate member rejection before parser ambiguity, valid Unicode and no unpaired surrogate, already-NFC digest-covered strings, safe integers, explicit nullability, and canonical ordering prerequisites. It rejects nonconforming input and never silently normalizes it.

## Schema Resource

One versioned Draft 2020-12 structural contract with a stable Project Gateway schema URN `$id`. Every external reference from a Schema Resource is an absolute URN matching another resource’s exact `$id`; fragment-only references are resource-local. A Schema Resource is neither an artifact identity nor a trusted registry/lifecycle subject and is resolved only through the offline Schema Catalog, whose paths are packaging locations, not identity.

## Schema Catalog

The offline normative index of local Schema Resources, their stable URN `$id` values, paths, profiles, versions, subject types, dependencies, and status. It prevents producer-controlled or remote schema substitution.

## Conformance Fixture

A deterministic normative input or graph named by a stable fixture ID in the fixture manifest. It declares the first failing phase, expected pass/fail result, the exact schema resource that applies to a single subject (or explicit `null` for raw, canonical-input, schema-selection, graph, and vector fixtures), rule IDs, failure category, dependencies, and exact registry context where applicable. A later-phase fixture must pass every earlier required phase first.

## Digest Vector

A Conformance Fixture that records canonical projection/input expectations, exact canonical UTF-8 text, digest domain, actual SHA-256 output, serialized digest, and relevant rule IDs, or an explicit rejection expectation. It tests a protocol digest contract without becoming a hashing implementation.

## Validation Phase

One ordered stage in the protocol validation pipeline. A required failure at an earlier phase prevents later authority-dependent use; a later phase must operate on the same accepted data model established by the preceding phases.

## Conformance Rule ID

A stable normative identifier such as `ART-001`, `REF-004`, `LFC-003`, or `PUB-005` for one semantic protocol requirement. It is not an implementation exception string and maps to passing and failing Conformance Fixtures.
