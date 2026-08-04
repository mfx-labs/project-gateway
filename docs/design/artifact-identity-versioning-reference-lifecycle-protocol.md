# Project Gateway MCP — Artifact Identity, Versioning, Reference, and Lifecycle Protocol

**Status:** Authoritative WP-2 protocol specification
**Applies to:** Later schema, validator, canonicalization, lifecycle, registry, adapter, gateway, and conformance work
**Protocol identifier:** `project-gateway.artifact`
**Initial protocol envelope version:** `1.0`

## Executive Summary

This specification resolves the five WP-1 decisions needed to make Project Gateway artifacts addressable, immutable, composable, workspace-safe, and lifecycle-verifiable without weakening the accepted WP-0 and WP-1 boundaries.

The protocol uses one common envelope for the six core artifact kinds: `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, `CompletionContract`, `ExecutionBundle`, and `ExecutionResult`. Every canonical artifact revision has a globally unique opaque artifact-instance ID, an opaque revision ID, a generation, at most one exact predecessor reference, and a SHA-256 digest over a deterministic canonical projection. Revision ID and digest are distinct: the former identifies a registered immutable revision; the latter proves the exact canonical bytes assigned to that revision.

A consumable `ExecutionBundle` still contains exactly one exact revision of each four prospective core artifacts and remains a non-merging composition. `AuthorityPolicy`, `ContextManifest`, `ExecutionBundle`, and `ExecutionResult` are workspace-bound. `TaskSpec` and `CompletionContract` may be portable or workspace-bound. Every authorization for execution use is nevertheless workspace-scoped, so portable content never makes a portable approval or authority grant.

Trusted lifecycle records remain outside managed repositories. Validation, approval, issuance, runtime grant, activation, occurrence, attempt, result publication, receipt, revocation, and supersession are distinct records and decisions. A successful activation creates one execution occurrence. An occurrence can contain ordered attempts; a retry is a later attempt in the same occurrence and cannot silently substitute a bundle, workspace, or authority scope.

An `ExecutionResult` remains project-visible retrospective content, not a trusted receipt. A candidate result becomes evaluator-produced only through a compatible evaluator adoption or origination recorded in a trusted `ResultPublicationRecord`. Published provenance is sufficient for ordinary review. Receipt correlation is additionally required for completion-status consumption, downstream automation, and authoritative reporting. Result publication is not prospective-artifact issuance and never turns a result into a receipt.

## Scope

### Defined by WP-2

WP-2 defines the normative protocol for:

- common artifact envelopes and their canonical projection;
- protocol, kind, extension, and consumer-capability versioning;
- artifact-instance and immutable revision identity;
- revision lineage and succession;
- canonical JSON, digest calculation, and digest coverage;
- exact references and cross-artifact compatibility;
- trusted workspace binding, portability, and approval scope;
- extension registry governance;
- trusted lifecycle record responsibilities and transitions;
- approval, issuance, revocation, grant, activation, occurrence, attempt, receipt, publication, and supersession boundaries;
- execution retries and result correlation;
- compatibility decisions and protocol failure categories; and
- migration and handoff constraints.

### Outside WP-2

WP-2 does not define JSON Schema, source code, interfaces, runtime validators, canonicalization or hashing implementations, database or filesystem design, registry implementation, signing implementation, MCP tools, adapter APIs, Pi integration, pi-guard changes, evaluator code, CLI commands, package configuration, or process topology.

Abstract JSON in this specification is a normative protocol shape unless labeled non-normative. It is not JSON Schema and MUST NOT be read as an implementation storage format.

## Authoritative Inputs and Precedence

This specification is constrained by these accepted documents:

- `docs/design/project-gateway-scope-and-principles.md`;
- `docs/design/glossary.md`;
- `docs/decisions/ADR-001-product-boundary.md` through `docs/decisions/ADR-004-mvp-capability-boundary.md`;
- `docs/design/artifact-domain-model.md`;
- `docs/design/artifact-responsibility-matrix.md`;
- `docs/design/wp-1-open-decisions.md`; and
- `docs/decisions/ADR-005-artifact-aggregate-boundaries.md` through `docs/decisions/ADR-007-artifact-ownership-and-consumer-boundary.md`.

WP-0 and WP-1 responsibility and trust boundaries control if a later reading would conflict with this specification. No such conflict was found while resolving the WP-1 decisions. This document supplies the deferred protocol mechanics; it does not alter a core aggregate's sole responsibility, permit context-to-instruction promotion, or turn project-visible content into trusted lifecycle state.

## Protocol Terminology and Conventions

The following distinctions are normative:

| Term | Meaning | MUST NOT be confused with |
| --- | --- | --- |
| Artifact kind | One stable core responsibility or registered extension responsibility | Instance, revision, consumer, or lifecycle state |
| Artifact instance | One logical artifact identity across revisions | Path, filename, alias, digest, producer, or approval |
| Canonical artifact revision | Immutable digest-covered protocol content for one instance and revision ID | A mutable file carrier or annotation update |
| Revision ID | Opaque registered identifier for one canonical revision | Digest, sequence number, alias, or filename |
| Canonical digest | Domain-separated hash of one canonical revision projection | Revision ID, signature, approval, or receipt |
| Exact artifact reference | Digest-pinned target selection with redundant identity checks | Alias, query, path, latest pointer, or fallback |
| Workspace binding | Digest-covered declared scope that a trusted workspace registry verifies | A repository root, path, or authority grant |
| Lifecycle record | Trusted-local immutable record of a distinct lifecycle or execution fact | Artifact content, annotation, or producer claim |
| Approval | Trusted acceptance of an exact subject for an explicit workspace and purpose | Validation, issuance, grant, or activation |
| Issuance | Trusted availability decision for an approved prospective subject | Approval, grant, activation, or publication |
| Runtime grant | Trusted runtime narrowing bound for one execution occurrence | Capability ceiling, approval, or activation |
| Activation | Trusted decision to begin one eligible bundle occurrence | Issuance, grant, task instruction, or bundle content |
| Execution occurrence | One successfully activated execution subject | Activation request, attempt, retry, result, or receipt |
| Execution attempt | One ordered run within an occurrence | Occurrence, retry group, or result revision |
| Result publication | Trusted attribution and consumption decision for a retrospective result | Receipt, prospective issuance, or approval |
| Trusted receipt | Trusted-local record of lifecycle or execution facts | `ExecutionResult` content |

All protocol identifiers in this document are case-sensitive where their syntax says so. All normative requirements use the words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY as defined by their ordinary requirements-language meaning.

## Common Artifact Envelope

### Envelope contract

Every canonical revision of each core artifact kind MUST have the following envelope components. The `body` has kind-specific semantics; all other named components have common semantics.

```json
{
  "protocol": {
    "id": "project-gateway.artifact",
    "version": "1.0",
    "canonicalization": "jcs-rfc8785-v1"
  },
  "kind": {
    "id": "TaskSpec",
    "version": "1.0"
  },
  "instance_id": "pgw:i:<128-bit-random-lowercase-hex>",
  "revision": {
    "id": "pgw:r:<128-bit-random-lowercase-hex>",
    "generation": 0,
    "predecessor": null,
    "digest": "sha-256:<64-lowercase-hex>"
  },
  "workspace_binding": {
    "mode": "portable"
  },
  "requirements": {
    "protocol_features": [],
    "consumer_capabilities": []
  },
  "extensions": [],
  "body": {},
  "annotations": {}
}
```

The example is a **normative abstract shape**, not JSON Schema. A canonical envelope MUST contain `protocol`, `kind`, `instance_id`, `revision`, `workspace_binding`, `requirements`, `extensions`, and `body`. `annotations` MAY be absent. No unregistered top-level member is permitted.

| Component | Presence | Immutable canonical content? | Digest-covered? | Rules |
| --- | --- | --- | --- | --- |
| `protocol.id`, `protocol.version`, `protocol.canonicalization` | Required | Yes | Yes | Identifies the common-envelope contract. The ID MUST be exactly `project-gateway.artifact`. |
| `kind.id`, `kind.version` | Required | Yes | Yes | Identifies one core kind or a later registered kind. A core ID MUST use its exact listed spelling. |
| `instance_id` | Required | Yes | Yes | Opaque, global, non-reusable instance identifier. |
| `revision.id`, `revision.generation`, `revision.predecessor` | Required | Yes | Yes | Immutable revision identity and lineage declaration. `predecessor` is `null` only for generation zero. |
| `revision.digest` | Required derived assertion | Yes after computation | No, to avoid self-reference | MUST equal the recomputed artifact digest; it is never an input to its own digest. |
| `workspace_binding` | Required | Yes | Yes | Declares portable or bound status and, when bound, the opaque trusted workspace ID. |
| `requirements` | Required | Yes | Yes | Declares registered required protocol features and consumer-neutral capabilities. |
| `extensions` | Required | Yes | Yes | Ordered registered extension declarations and their payloads. |
| `body` | Required | Yes | Yes | Kind-specific specification or retrospective result content only. |
| `annotations` | Optional | No | No | Presentation-only, project-visible, non-authoritative metadata. |

A producer MAY hold incomplete working text before it satisfies this envelope. Such text is not a canonical artifact revision, has no exact reference identity, and MUST NOT be validated for consumption, approved, issued, activated, or published as a result.

### Required and prohibited envelope semantics

The envelope MUST NOT contain an embedded lifecycle status, approval assertion, issuance assertion, revocation assertion, runtime grant, activation request, trusted receipt, alias, path identity, Git identity, repository location, trusted workspace configuration, or consumer-specific launch configuration. Such semantics are prohibited even when placed in a generic object or annotation.

`body` MUST contain only the sole responsibility of its `kind` as established by WP-0 and WP-1. In particular:

- `TaskSpec` body MAY contain task intent and direct task instructions, but MUST NOT delegate task-instruction authority to context or repository files;
- `AuthorityPolicy` body MAY narrow authority only;
- `ContextManifest` body MAY select bounded context as untrusted data only;
- `CompletionContract` body MAY define prospective proof requirements only;
- `ExecutionBundle` body MUST contain exactly four required exact prospective references and no semantic merge or fallback; and
- `ExecutionResult` body MUST report retrospective observations only.

### Annotations and convenience metadata

`annotations` MAY contain display name, title, description, labels, comments, untrusted creation timestamp, and untrusted producer attribution. Those values are non-authoritative presentation metadata. They are excluded from the canonical revision projection and MAY change without creating a new canonical revision.

Consumers, validators, approvers, issuers, and adapters MUST NOT use annotations to determine identity, lineage, task meaning, authority, compatibility, workspace, lifecycle state, provenance, or consumer support. If a value must influence any of those decisions, it MUST be moved to digest-covered `body`, `requirements`, `extensions`, or another appropriate trusted local record, producing a new revision when canonical content changes.

Trusted approver, issuer, evaluator, registry-owner, and receipt-producer identity belongs only in trusted local records. Producer attribution in `annotations` is never proof of authorship, evaluator provenance, approval, or trust.

## Protocol, Kind, Extension, and Capability Versioning

### Version syntax

Protocol envelope versions, artifact-kind contract versions, registered extension contract versions, registered protocol-feature versions, and consumer-capability versions MUST use the strict two-component syntax `MAJOR.MINOR`.

- `MAJOR` and `MINOR` are non-negative decimal integers without leading zeroes except `0` itself.
- Pre-release labels, build metadata, ranges, wildcards, and patch components are prohibited in serialized protocol content.
- Software patch releases MAY exist outside the protocol, but they MUST NOT change serialized interpretation, canonicalization, digest computation, validation acceptance, required semantics, authority behavior, lifecycle behavior, or compatibility outcomes. A change that affects any of those requires a new minor or major contract version.

### Distinct version levels

| Version level | Controls | Location | Compatibility responsibility |
| --- | --- | --- | --- |
| Protocol envelope version | Interpretation of common envelope components and canonical projection | `protocol.version` | Protocol implementation and exact registry snapshot context |
| Artifact-kind contract version | Interpretation of a kind's `body` and kind-specific invariants | `kind.version` | Kind validator and consumer |
| Registered extension version | Interpretation of one extension payload | Extension declaration | Extension contract owner and consumer |
| Consumer-capability version | What a consumer can correctly understand and enforce | Trusted consumer support declaration | Consumer and compatibility evaluator |

These levels MUST NOT be collapsed into one `version` value or inferred from one another.

### Normative major/minor change classification

A change is **breaking** at the applicable contract level whenever an implementation conforming to the previous contract could accept the new subject but interpret, validate, authorize, canonicalize, reference, enforce, or consume it differently from the new contract. A breaking change MUST use a new major version; author preference, numeric ordering, or an assertion of compatibility cannot classify it as minor.

The following are major changes at the applicable contract level:

- changing the meaning of an existing member, value, operation, state, requirement, invariant, or enum value;
- removing or renaming an existing member or value, or making a previously optional member required;
- changing canonical projection, digest coverage, canonicalization behavior, identifier interpretation, exact-reference interpretation, array ordering, or set semantics;
- changing workspace-binding meaning, authority, denial, lifecycle, publication, receipt, point-of-use, trust-owner, aggregate-responsibility, or safety semantics;
- changing a default where a prior consumer could silently behave differently;
- permitting a value or structure a prior consumer might accept but misinterpret;
- prohibiting previously conforming canonical content without an explicit new feature or migration boundary;
- changing required-extension treatment, optional ignore-safety, or whether a behavior is required, authority-relevant, lifecycle-relevant, or safety-relevant; or
- adding any common top-level envelope component.

| Contract level | MUST be major | MAY be minor only when every general minor condition holds |
| --- | --- | --- |
| Protocol envelope | Any common-envelope member, canonicalization profile, canonical projection, digest, identifier, reference, workspace, lifecycle, or default-behavior change; any top-level component addition | Clarification with unchanged normative interpretation; a separately declared required protocol feature that older consumers detect and fail closed on; or a registered ignore-safe optional semantic that does not change envelope interpretation |
| Artifact-kind contract | Any existing body member/value/invariant meaning change; member removal/renaming; requiredness change; aggregate-responsibility, authority, completion, workspace, lifecycle, or safety change | Additive optional kind content that older consumers process with identical meaning, or a separately declared required feature that old consumers detect and fail closed on |
| Registered extension contract | Namespace semantic, payload/member/value, required/optional, ignore-safety, supported-kind/protocol, authority, lifecycle, workspace, or safety change | Additive separately registered optional semantics only when the registry proves ignore-safety; or a new explicitly required extension feature that unsupported consumers detect and fail closed on |
| Protocol-feature or consumer-capability contract | Existing feature/capability meaning, requirement, operation, enforcement, support, or safety change | Additive named feature/capability explicitly declared in `requirements` or trusted support context so older consumers fail closed rather than silently misinterpret it |

A minor change is permitted only when it is additive; previous valid content remains valid; previous meaning remains unchanged; an old conforming consumer either processes new content with identical meaning or detects an explicit unsupported required feature and fails closed; canonical interpretation of existing revisions is unchanged; and trust, authority, workspace, lifecycle, reference, completion, and safety guarantees are not weakened.

Adding required behavior is not automatically minor. It may be minor only when the subject explicitly declares the required feature and an older consumer detects that requirement and fails closed. A new enum value is major unless unknown values were already detectable and fail-closed and the value is gated by an explicit supported requirement or contract version. Tightening validation is major when previously conforming canonical subjects become invalid, unless it applies only to a newly declared required feature or new contract version that older consumers reject. Loosening validation is major when an old consumer may accept the syntax but interpret it differently or fail to enforce a new semantic.

### Compatibility rules

A version number alone is not proof of compatibility. A consumer MAY accept an artifact only after it establishes all of the following:

1. support for the protocol ID, canonicalization profile, and envelope version;
2. support for the artifact kind and kind version;
3. support for every required protocol feature and consumer capability;
4. support for every required extension and its registered contract version;
5. compatibility of all exact references and their required semantics;
6. compatibility with the artifact's workspace-binding model; and
7. the lifecycle state required for the proposed use.

A different major version MUST fail closed unless an explicitly supported migration profile converts it to a new canonical protocol subject. A consumer supporting `M.N` MAY accept an older `M.n` only when `n <= N` and all required features remain supported. It MAY accept a newer same-major minor only when its trusted support declaration explicitly lists that newer minor or a registry-defined compatibility profile for it; numeric ordering alone is insufficient.

Unknown required minor features, capabilities, extensions, or kind semantics MUST fail closed. Producers MAY emit an older supported version only when doing so does not omit, downgrade, or reinterpret a required semantic. Producers MUST NOT label newer semantics as an older version to obtain compatibility.

`requirements.protocol_features` and `requirements.consumer_capabilities` are arrays of registered versioned requirement identifiers. Each array MUST be unique and sorted by its canonical identifier. An empty array explicitly means that no additional common requirement beyond the versioned core contract is declared.

## Artifact-Instance Identity

### Identifier model

An artifact instance ID MUST use the exact syntax `pgw:i:` followed by 32 lowercase hexadecimal characters representing 128 bits generated by a cryptographically secure random source. It is opaque. It MUST NOT encode kind, workspace, time, path, filename, repository, producer, approval, or authority.

Instance IDs are globally unique protocol identifiers and MUST be non-reusable. The trusted local identity registrar MUST reject an attempted registration when an existing instance ID is associated with a different kind or an incompatible registered identity history. Deletion, archival, migration, or loss of a project-visible copy MUST NOT permit reuse. An observed collision, malformed ID, or unavailable identity registry is a fail-closed condition for registration, exact resolution, approval, issuance, activation, and authority-dependent consumption.

### Assignment and acceptance

A producer MAY propose an instance ID only in a draft. The proposal has no authority. A trusted local identity registrar assigns or accepts the opaque ID when it registers the first structurally valid canonical revision for that instance. The registrar is an identity-resolution role; it is not an approver, issuer, grant authority, or activation authority.

The registrar MUST record that one instance ID belongs to exactly one artifact kind. It MUST accept only one generation-zero revision for an instance. It MAY be colocated with another trusted local component, but its identity assignment MUST NOT make producer content trusted, approved, issued, workspace-authorized, or consumer-supported.

A new logical artifact MUST receive a new instance ID and a generation-zero revision. A changed continuation of an existing logical artifact MUST retain its instance ID and declare a valid predecessor. The protocol does not infer logical continuity from text similarity, paths, aliases, producer claims, or timestamps.

## Revision Identity and Lineage

### Revision identifier model

A revision ID MUST use the exact syntax `pgw:r:` followed by 32 lowercase hexadecimal characters representing 128 cryptographically secure random bits. It is a globally unique protocol identifier assigned or accepted by the identity registrar for exactly one instance and exactly one canonical digest. It is opaque and MUST NOT encode a sequence, timestamp, workspace, kind, path, producer, status, or authority.

Revision ID is not equal to canonical digest. The revision ID gives a stable registered handle; the digest independently verifies canonical bytes. Both MUST match during exact resolution. A registry MUST reject reuse of a revision ID with a different instance, kind, or digest.

### Lineage model

Every canonical revision MUST declare exactly one of these forms:

- **Genesis revision:** `generation` is `0` and `predecessor` is `null`.
- **Successor revision:** `generation` is greater than `0`; `predecessor` is an exact reference to one revision of the same instance and kind; and `generation` is exactly one greater than the predecessor generation.

A producer may declare predecessor lineage, but the identity registrar and semantic validator MUST verify the exact predecessor's kind, instance ID, revision ID, digest, generation, and canonical availability. A predecessor declaration is not proof of approval, issuance, grant, activation, authorship, or consent by the predecessor's producer.

Lineage MAY branch: multiple successors MAY name the same predecessor. Lineage MUST NOT merge: a revision MUST NOT name more than one predecessor, and a relationship list or annotation MUST NOT be treated as a second lineage parent. When content combines material from branches, it MUST declare one valid predecessor or begin a new instance; any other source is non-lineage evidence only and has no lifecycle effect.

A changed canonical projection always creates a distinct revision identity. An issued revision MUST NOT be amended in place. A changed revision MUST NOT inherit approval, issuance, runtime grant, activation, publication, or any other lifecycle fact. Lifecycle authority never transfers through predecessor lineage.

Two artifact documents may have equivalent kind-specific body text while remaining different canonical revisions because their immutable instance or revision identity differs. Two canonical revisions cannot have identical canonical bytes or digest unless they are the same instance ID, revision ID, and immutable projection. One canonical revision MUST belong to exactly one artifact instance.

### Workspace-binding continuity

Workspace-binding declaration is an artifact-instance invariant. Every revision of one artifact instance MUST use the same `workspace_binding.mode`; when that mode is `bound`, every revision MUST contain the same exact `workspace_id`. A successor's predecessor exact reference MUST carry the same workspace-binding declaration as the successor and the resolved predecessor.

An instance MUST NOT change from `portable` to `bound`, from `bound` to `portable`, or from one bound workspace ID to another. Moving, specializing, importing, or adapting content to a different workspace-binding declaration requires a new artifact instance ID, a generation-zero revision, no artifact predecessor relationship to the prior instance, fresh validation, and fresh workspace-scoped approval and issuance where applicable.

For `AuthorityPolicy`, `ContextManifest`, `ExecutionBundle`, and `ExecutionResult`, the bound workspace ID is immutable for the lifetime of the instance. `TaskSpec` and `CompletionContract` MAY be created portable or bound, but their chosen mode is immutable for that instance: a portable instance remains portable and a bound instance remains bound to one workspace across all revisions. An `ExecutionResult` instance is permanently bound to the workspace of its one reported execution attempt.

### Imports and migrations

A byte-identical copy of an existing canonical revision MAY be mirrored without becoming a new revision; the same instance ID, revision ID, and digest identify it. Its location does not transfer lifecycle state. A trusted local migration or import record is required before any foreign lifecycle fact is relied on.

When import or migration changes protocol version, canonical projection, kind semantics, instance ID, revision ID, digest, or workspace-binding declaration, it MUST create an explicit new canonical protocol subject. A trusted `MigrationRecord` MAY correlate old and new exact subjects, but it MUST NOT create artifact lineage, transfer identity, or transfer approval, issuance, grant, activation, publication, receipt, or workspace authority implicitly.

## Canonical Representation and Digest Protocol

### Canonical data model

The canonical artifact revision projection MUST be JSON Canonicalization Scheme RFC 8785 JSON under the additional restrictions in this section. The canonical byte representation is UTF-8 JCS output.

Before canonicalization, an implementation MUST validate one accepted JSON data model and MUST:

1. detect and reject duplicate member names at every object depth before an ordinary parser can silently discard or replace a member;
2. reject invalid Unicode and unpaired Unicode surrogate code points;
3. require every digest-covered string to already be Unicode Normalization Form C (NFC) and reject any digest-covered string that is not NFC;
4. reject non-finite numeric values and restrict digest-covered JSON numbers to safe integers in the inclusive range `-9007199254740991` through `9007199254740991`;
5. require any semantic decimal, arbitrary-precision integer, binary data, or opaque byte sequence to use a registered string representation rather than a JSON number;
6. use `null` only where the common or applicable kind/extension contract explicitly permits it; omitted and `null` members are never equivalent;
7. preserve array order as semantic order; and
8. require any digest-covered timestamp defined by a later kind or extension contract to use UTC RFC 3339 form `YYYY-MM-DDTHH:MM:SS.sssZ` with exactly three fractional digits.

Every digest-covered string MUST already be Unicode NFC. A non-NFC string MUST be rejected. The protocol MUST NOT silently normalize artifact content. NFC is a validation precondition, not a JCS operation. Implementations MUST NOT silently normalize, rewrite, repair, or replace digest-covered artifact strings. JCS serializes the accepted digest-covered JSON data model exactly as accepted under this profile; RFC 8785 JCS does not perform Unicode normalization. A producer that wants to convert non-NFC working content into NFC MUST do so before canonical revision formation; that producer-side preparation is not artifact canonicalization.

Structural validation, semantic validation, canonicalization, digest verification, reference resolution, and consumption MUST operate on the same accepted data model. JCS determines JSON string escaping, object-member serialization, and member ordering. Object member order is JCS lexicographic order on UTF-16 code units. Protocol-defined set-like arrays, including `extensions`, `protocol_features`, and `consumer_capabilities`, MUST additionally be unique and pre-sorted by their canonical identifier so that array order cannot create semantically duplicate artifact revisions.

### Canonical projection and coverage

The canonical artifact revision projection is the envelope with `annotations` omitted and `revision.digest` omitted. All remaining required components, including `revision.id`, lineage, workspace binding, requirements, extension declarations, extension payloads, and kind body, are covered.

| Candidate content | Covered by artifact digest? | Reason |
| --- | --- | --- |
| Protocol ID, version, and canonicalization profile | Yes | They control interpretation and bytes. |
| Kind ID and kind version | Yes | They control responsibility and body semantics. |
| Instance ID and revision ID | Yes | They bind content to one identity subject. |
| Generation and predecessor exact reference | Yes | They define immutable lineage. |
| Workspace binding | Yes | It controls portability and workspace compatibility. |
| Required feature and capability declarations | Yes | They control required interpretation. |
| Extension declarations and payloads | Yes | They can refine registered semantics. |
| Kind-specific body, including result occurrence/attempt claims | Yes | It is the artifact's core meaning. |
| `revision.digest` | No | It is the derived output of this projection. |
| Presentation annotations and untrusted producer claims | No | They have no protocol or lifecycle meaning. |
| Approval, issuance, grant, activation, revocation, receipt, publication, audit state | Prohibited from envelope | They exist only in trusted local records. |

### Digest calculation

The artifact digest MUST use SHA-256 with explicit domain separation:

```text
SHA-256(UTF-8("PGAP-ARTIFACT-REVISION-v1\u0000") || canonical-artifact-revision-bytes)
```

The serialized digest syntax MUST be `sha-256:` followed by exactly 64 lowercase hexadecimal characters. The `sha-256:` algorithm label is part of the digest value and MUST be checked. A plain SHA-256 value without this artifact domain is not an artifact digest.

Other protocol hash domains, if introduced later, MUST use distinct domain-separation prefixes and MUST NOT be accepted in place of an artifact digest. Examples of reserved future domains are `PGAP-LIFECYCLE-RECORD-v1` and `PGAP-EVIDENCE-v1`; they do not define a storage or signing mechanism.

A canonicalizer failure, NFC precondition failure, unsupported profile, duplicate key, invalid numeric form, or digest mismatch MUST fail closed. No consumer may substitute source bytes, pretty-printed bytes, a file hash, a Git object ID, a path hash, or an annotation hash for the artifact digest.

## Exact Artifact References

### Exact-reference contract

An exact artifact reference MUST contain these digest-covered elements in its source artifact:

```json
{
  "target_protocol_version": "1.0",
  "target_kind": {
    "id": "AuthorityPolicy",
    "version": "1.0"
  },
  "target_instance_id": "pgw:i:<128-bit-random-lowercase-hex>",
  "target_revision_id": "pgw:r:<128-bit-random-lowercase-hex>",
  "target_digest": "sha-256:<64-lowercase-hex>",
  "target_workspace_binding": {
    "mode": "bound",
    "workspace_id": "pgw:w:<128-bit-random-lowercase-hex>"
  }
}
```

This is a **normative abstract shape**, not JSON Schema. A reference MUST include the target protocol version, kind ID and kind version, instance ID, revision ID, canonical digest, and workspace-binding declaration. The target's required extension declarations are verified from the resolved target envelope and digest; a reference MUST NOT replace them with a lossy summary.

An exact reference identifies a specific immutable target. It MUST NOT be a filename, path, Git revision, alias, display name, `latest` selector, version range, query, partial digest, content-only digest, mutable lookup key, or hidden fallback list.

### Resolution and verification

A resolver MUST retrieve a candidate only as a candidate and then verify all reference elements against the target's recomputed canonical envelope:

1. target protocol version matches;
2. target kind ID and kind version match;
3. target instance ID and revision ID match;
4. recomputed target digest matches;
5. target workspace binding matches; and
6. target required features and extensions are supported for the intended consumer and use.

Any unresolved target, mismatch, alias use, mutable substitution, duplicate target, unsupported required semantic, unavailable identity/lifecycle state, or workspace-binding-continuity violation MUST fail closed. A resolver MUST NOT choose a nearby version, matching title, matching path, same body, or alternate workspace target. A predecessor resolver MUST verify the same workspace-binding declaration on predecessor and successor; it MUST reject cross-workspace predecessors and portable/bound mode mutation.

Reference graph validation MUST reject a cycle among canonical artifact references. In particular, prospective artifacts MUST NOT depend on an `ExecutionResult`; an `ExecutionBundle` MUST NOT reference itself, another bundle as an authority substitute, a receipt, a grant, or an activation record.

### Provisional draft references

A producer MAY use a provisional draft reference only in unconsumable working content. It MAY identify a producer-local opaque draft handle and expected target kind, but MUST NOT use a path, alias, or latest selector as a consumable resolution mechanism. A provisional reference MUST be replaced by one exact reference before structural validation for consumption. That replacement changes canonical content and therefore requires a new canonical revision and digest.

### Result and evidence references

An `ExecutionResult` MUST contain an exact reference to its reported `ExecutionBundle` and MUST bind one execution occurrence and one execution attempt. It MAY contain exact artifact references to artifacts observed as produced during that attempt. Such references are observations only; they do not approve, issue, activate, or make the observed artifact consumable.

A result MAY identify non-core evidence through an exact evidence descriptor defined by a compatible result contract or registered extension. Such a descriptor MUST bind immutable evidence identity or content digest, the applicable workspace scope, and its observation role. It MUST NOT turn a path, URL, log label, or producer claim into an authority or trusted receipt.

## Workspace Binding and Portability

### Workspace identifier and trusted registration

A trusted workspace ID MUST use `pgw:w:` followed by 32 lowercase hexadecimal characters representing a cryptographically random 128-bit value. It is opaque and is allocated by trusted local workspace configuration. It MUST NOT be derived from a repository path, Git remote, directory, project name, producer, or artifact content.

Artifact content declares a workspace-binding claim but MUST NOT create, register, alter, or authorize a workspace. A consumer MUST verify every bound workspace ID against trusted local workspace configuration before consuming authority-dependent semantics.

### Per-kind binding decision

| Core kind | Binding model | Required rule |
| --- | --- | --- |
| `TaskSpec` | Portable or bound | Its generation-zero revision chooses portable or one bound workspace; that choice is immutable for the instance. |
| `AuthorityPolicy` | Intrinsically bound | It MUST have `mode: "bound"` and exactly one trusted workspace ID that remains immutable for the instance. |
| `ContextManifest` | Intrinsically bound | It MUST have `mode: "bound"` and exactly one trusted workspace ID that remains immutable for the instance; selected context MUST remain within that trusted workspace scope. |
| `CompletionContract` | Portable or bound | Its generation-zero revision chooses portable or one bound workspace; that choice is immutable for the instance. |
| `ExecutionBundle` | Intrinsically bound | It MUST have `mode: "bound"` and exactly one proposed execution workspace that remains immutable for the instance. |
| `ExecutionResult` | Inherits and records occurrence workspace | It MUST have `mode: "bound"` with the same workspace ID as its one reported execution attempt; that ID remains immutable for the instance. |

A portable binding is exactly `{ "mode": "portable" }`. A bound binding is exactly `{ "mode": "bound", "workspace_id": "pgw:w:<...>" }`. Both forms are digest-covered. No implicit or omitted binding is permitted. A predecessor and successor MUST use exactly the same binding declaration; a binding change is a new-instance event, not a revision.

### Bundle workspace compatibility

A consumable bundle MUST resolve to exactly one trusted workspace scope. The bundle's bound workspace is a digest-covered proposed-execution binding. It records the scope selected by the composition; it does not establish trusted workspace registration, approval, issuance, authority, or activation. The trusted control plane establishes actual execution scope only by validating the bundle against trusted workspace configuration and lifecycle records.

For a bundle bound to workspace `W`:

- its `AuthorityPolicy` and `ContextManifest` references MUST be bound to `W`;
- any bound `TaskSpec` or `CompletionContract` reference MUST be bound to `W`;
- any portable `TaskSpec` or `CompletionContract` reference MAY be used only after workspace-scoped compatibility and lifecycle checks for `W` succeed; and
- a bound core target for any other workspace MUST fail closed.

Core-artifact cross-workspace references are prohibited. A result's retrospective evidence reference may identify external evidence only as untrusted observed data and only under independently authorized read policy; it cannot bridge authority, context selection, approval, or activation across workspaces.

### Approval and portability scope

Every approval and issuance that authorizes use in an execution MUST bind the exact artifact kind, instance ID, revision ID, digest, and one trusted workspace ID. This rule applies to portable `TaskSpec` and `CompletionContract` revisions as well as intrinsically bound artifacts. A portable revision MAY receive independent workspace-scoped approvals and issuances for multiple workspaces, but an approval or issuance for workspace `W1` MUST NOT be replayed for workspace `W2`.

No bound artifact content can be moved to another workspace by creating a later revision because binding continuity is instance-scoped. Changing mode or workspace ID requires a new instance and generation-zero revision with no artifact predecessor. A bundle cannot silently switch workspaces, and a result cannot be associated with a workspace other than its correlated occurrence and attempt.

## Extension Namespace Governance

### Selected registry model

The authoritative extension registry is a human-approved Project Gateway Protocol Registry maintained outside managed repositories. Each accepted protocol release includes an immutable `RegistrySnapshot` identified and verified exactly as defined below. Trusted local control-plane configuration selects accepted snapshots by exact identity and MAY disable entries or impose stricter local policy, but MUST NOT add, redefine, or override a registry entry without the same human-approved governance process.

Repository content, artifact content, ChatGPT Web, and producer claims MUST NOT allocate a registry snapshot ID, alter a snapshot, register a namespace, allocate a namespace owner, change extension semantics, resolve a collision, or make an extension trusted.

### RegistrySnapshot identity and reference

A `RegistrySnapshot` is a trusted immutable protocol subject outside managed repositories. It is not a core artifact, does not add a seventh aggregate, and is not project-visible authority content. A registry snapshot ID MUST use `pgw:g:` followed by 32 lowercase hexadecimal characters representing 128 cryptographically secure random bits. It is opaque, globally non-reusable, assigned only under human-approved registry governance, and distinct from artifact, revision, workspace, lifecycle-record, occurrence, attempt, result, publication, and receipt IDs.

An exact `RegistrySnapshotReference` MUST contain registry protocol identifier, registry snapshot format version, snapshot ID, canonical snapshot digest, and an associated `project-gateway.artifact` protocol-release or compatibility declaration. The initial registry protocol identifier is exactly `project-gateway.registry`, and its format version uses the same strict `MAJOR.MINOR` syntax as other protocol contracts. Its normative abstract shape is:

```json
{
  "registry_protocol_id": "project-gateway.registry",
  "registry_snapshot_format_version": "1.0",
  "registry_snapshot_id": "pgw:g:<32-lowercase-hex>",
  "registry_snapshot_digest": "sha-256:<64-lowercase-hex>",
  "protocol_compatibility": "<exact-project-gateway-artifact-release-or-compatibility-declaration>"
}
```

A human-readable registry version, filename, release tag, path, or label is not exact registry identity. The canonical registry snapshot uses the same JSON validation preconditions as canonical artifacts: duplicate names are rejected before parser ambiguity; every digest-covered string is already NFC; non-NFC strings are rejected; no digest-covered string is silently normalized, repaired, or rewritten; numbers are safe integers; and set-like arrays are deterministically ordered. It is serialized by RFC 8785 JCS after that validation. Its digest is:

```text
SHA-256(UTF-8("PGAP-REGISTRY-SNAPSHOT-v1\u0000") || JCS(canonical-registry-snapshot))
```

The registry snapshot digest syntax is `sha-256:` followed by 64 lowercase hexadecimal characters and MUST NOT use the artifact-revision digest domain. The canonical registry snapshot MUST cover registry protocol identifier, registry format/version, snapshot ID, protocol release or compatibility declaration, namespace entries, namespace ownership, extension contract versions, supported protocol and artifact-kind versions, required/optional and ignore-safety semantics, schema and semantic-contract identifiers, deprecation and supersession declarations, required governance security-review status, and governed capability and feature registrations.

Trusted local configuration selects accepted snapshots by exact `RegistrySnapshotReference`. Every `ValidationRecord` MUST bind the exact reference used for validation. Every approval whose validity depends on registry-governed required extensions, features, capabilities, or semantics MUST bind the exact accepted reference or an explicitly defined exact accepted registry context. Issuance and activation eligibility MUST verify the currently permitted registry context. Consumer support declarations MUST identify the exact snapshot or exact compatible registry contracts they implement. A newer snapshot MUST NOT silently reinterpret artifacts validated under an older snapshot; continued use under a different snapshot requires an explicit compatibility decision and, where required, new validation or lifecycle records.

### Namespace and declaration rules

An extension namespace MUST use lowercase reverse-domain-style ASCII labels separated by periods. Each label MUST begin with a lowercase letter and contain only lowercase letters, decimal digits, or hyphens; labels MUST NOT begin or end with a hyphen. A namespace MUST contain at least two labels. The registry reserves `project-gateway.*` and any namespace explicitly reserved by an accepted registry snapshot.

A registered extension declaration MUST contain a namespace, a two-component extension contract version, a requirement mode of `required` or `optional`, and a digest-covered extension payload. The registry entry owns the schema contract, semantic contract, namespace owner, supported protocol and kind-version relationships, security review status, deprecation state, successor information, and ignore-safety designation.

A namespace collision, unregistered namespace, owner mismatch, unsupported version, or registry snapshot disagreement MUST fail closed. Deprecation does not change historical interpretation. Supersession does not migrate content automatically; a producer MUST create a new revision using the successor extension or an explicit migration record.

### Required and optional behavior

A required extension MUST be structurally and semantically supported and enforced by every consumer that consumes the affected meaning. Unsupported required extensions MUST fail closed.

An optional extension MAY be ignored only when the authoritative registry entry expressly marks its version ignore-safe and the consumer verifies that ignoring it cannot change core meaning, authority, completion obligations, workspace binding, lifecycle requirements, reference meaning, or safety guarantees. An artifact's `optional` label alone is insufficient. No extension may override capability ceilings, denials, approval scope, issuance, grants, activation, result/receipt separation, or core aggregate responsibility.

## Trusted Lifecycle Record Model

Trusted lifecycle records are immutable, append-only conceptual records maintained outside managed repositories by the trusted local control plane. Their exact storage, signature, audit-log, replication, and process topology are out of scope. A record MUST bind exact protocol subjects, not paths, aliases, titles, or repository locations.

| Record type | Sole responsibility | Trust owner and creation authority | Required binding targets | Prohibited semantics |
| --- | --- | --- | --- | --- |
| `ValidationRecord` | Record structural and semantic conformance assessment | Trusted validation service or control-plane-recognized validator | Exact revision, digest, protocol/kind versions, validator profile, exact `RegistrySnapshotReference`, assessment outcome | Approval, issuance, authority grant, activation |
| `ApprovalRecord` | Accept one exact prospective revision for one declared workspace and purpose | Trusted approver | Exact kind, instance, revision, digest, workspace, purpose, validation record(s), required extension set, exact registry context where required | Issuance, grant, activation, transferable approval |
| `IssuanceRecord` | Make one approved prospective revision available for a defined use | Trusted issuer | Exact subject, matching approval, workspace, consumer class or use, validity and usage bounds, permitted registry context | Approval substitution, grant, activation |
| `RevocationRecord` | Withdraw current usability or publication of one permitted target | Trusted revocation authority | Exact `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, or `ResultPublicationRecord`; scope, effective point, reason | Content deletion, history rewrite, revocation of a historical event, silent reinstatement |
| `RuntimeGrant` | Narrow authority for one reserved execution occurrence | Trusted runtime-grant authority | Exact bundle, workspace, reserved occurrence ID, capability bound, validity, attempt allowance | Ceiling expansion, approval, issuance, activation |
| `ActivationRecord` | Record exactly one accepted or denied decision for one reserved occurrence | Trusted activation authority | Exact bundle, all required issuances, workspace, grant, reserved occurrence ID, exact registry context, decision | Bundle approval, runtime authority expansion, result receipt, reuse of the reservation |
| `ExecutionOccurrenceRecord` | Establish one successful activation's execution subject | Trusted control plane | Exact activation, bundle, workspace, occurrence ID | Attempt outcome, result publication, receipt substitution |
| `ExecutionAttemptRecord` | Establish one ordered attempt within an occurrence | Trusted execution recorder | Exact occurrence, attempt ID, ordinal, grant-use context | Bundle substitution, lifecycle approval, evaluator result claim |
| `TrustedReceipt` | Record trusted lifecycle or execution event facts | Trusted receipt producer | Exact event subject, occurrence/attempt when applicable, event time and disposition | Result content, prospective requirement rewrite |
| `ResultPublicationRecord` | Attest evaluator provenance, unique result-instance association, publication, and allowed result consumption | Trusted result publisher after compatible evaluator action | Exact result instance, revision, digest, evaluator identity/capability, validation, bundle, workspace, occurrence, attempt, receipt correlation when required, exact registry context, consumption scope | Receipt replacement, prospective approval or issuance, authority grant, second result instance for the attempt |
| `SupersessionRecord` | Designate a newer exact subject as current for a stated reporting or usage purpose | Trusted lifecycle authority | Exact prior and successor subjects/records, scope, reason | Content mutation, deletion, implicit approval transfer |
| `ExecutionSummaryRecord` | Optionally correlate per-attempt history for trusted reporting only | Trusted reporting authority | Exact occurrence and ordered attempt/receipt/result-publication references | A synthetic core `ExecutionResult`, authority, completion proof substitution |
| `MigrationRecord` | Correlate old and new exact protocol subjects across an explicit import or migration | Trusted migration authority | Exact old and new subjects, transformation profile, scope | Lifecycle transfer without separate records |
| `AuthoritativeAuditEvent` | Preserve an immutable audit fact about a trusted decision or observation | Trusted control plane | Exact record/event subject, actor role, time, correlation IDs | Replacing the primary lifecycle record or project-visible result |

Every selected record has its own opaque trusted record ID, creation time, responsible role, scope, and immutable content. A later revocation or supersession is a new record; it MUST NOT rewrite or delete a historical record or artifact.

### Revocable usability and immutable historical facts

Only `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, and `ResultPublicationRecord` are revocable usability or publication records. A `RevocationRecord` MAY target only one exact record of one of those types and only for its stated scope. Revocation does not delete artifact content or trusted records.

`ValidationRecord`, `ActivationRecord`, `ExecutionOccurrenceRecord`, `ExecutionAttemptRecord`, `TrustedReceipt`, `ExecutionSummaryRecord`, `MigrationRecord`, `SupersessionRecord`, and `AuthoritativeAuditEvent` are immutable historical fact or assessment records. They MUST NOT be revoked as though the event or assessment never occurred. A later `ValidationRecord` MAY supersede an earlier assessment for a stated current use, and a later record MAY correlate an earlier fact as obsolete, superseded, contradicted, or unacceptable for a defined current use, but neither MAY mutate or erase it. A `SupersessionRecord` is itself an immutable historical decision and a later supersession MAY select another current subject without revoking the earlier supersession event.

## Lifecycle State and Transitions

### State model

Artifact content has no embedded authoritative status. `draft`, `structurally valid`, `semantically valid`, `validated`, `approved`, `issued`, `revoked`, and `superseded` describe external assessments or trusted-record relationships, not mutable fields in an artifact.

- **Draft:** untrusted producer-proposed content. It may be incomplete or nonconformant.
- **Structurally valid:** a `ValidationRecord` reports passing envelope and applicable structural checks.
- **Semantically valid:** a `ValidationRecord` reports passing responsibility, compatibility, and applicable semantic checks.
- **Validated:** required structural and semantic assessments are both passing for the exact digest under the exact required `RegistrySnapshotReference`.
- **Approved:** an active matching `ApprovalRecord` exists. It is not issued.
- **Issued:** an active matching `IssuanceRecord` exists. It is not active for execution.
- **Revoked:** an active `RevocationRecord` withdraws usability or publication only for one permitted revocable target and stated scope. Historical artifacts, records, receipts, activations, occurrences, and attempts remain inspectable.
- **Superseded:** a `SupersessionRecord` selects a successor for a stated purpose. Supersession is not automatic revocation.

The protocol defines no universal artifact `expired` or `archived` content state. A trusted record MAY have an explicit validity end. Passing it makes that record unusable for its scope without changing historical facts. Archival is a retention classification only and MUST NOT create authority or erase inspection access.

### Prospective artifact transition preconditions

1. A validator MAY create a `ValidationRecord` only for an exact canonical revision and exact accepted `RegistrySnapshotReference`. Validation is externally recorded and independently reproducible; it is never embedded state.
2. An approver MAY create an `ApprovalRecord` only for a currently validated exact prospective subject, exact workspace, exact purpose, required semantic set, and exact required registry context. Approval MUST NOT be inferred from a validation record.
3. An issuer MAY create an `IssuanceRecord` only for an active matching approval, permitted current registry context, and current non-revoked state. Issuance MUST NOT be inferred from approval.
4. Every activation decision MUST create exactly one immutable `ActivationRecord` whose decision is `accepted` or `denied`. It MUST bind one reserved occurrence ID, one runtime grant, one bundle, one workspace, and exact current registry context.
5. An activation authority MAY record `accepted` only when the exact bundle and all four selected prospective revisions have required valid approvals and issuances for the same workspace; all exact references resolve; all required extensions and capabilities are supported; current revocations are clear; and effective authority is within trusted ceilings. An accepted decision creates exactly one `ExecutionOccurrenceRecord`.
6. A `denied` decision creates no occurrence and no attempt, permanently closes the reserved occurrence ID and associated runtime grant for activation and execution use, and remains an immutable audit or receipt-correlatable historical fact.
7. Reissuance after issuance revocation requires a new `IssuanceRecord` based on a currently active matching approval and all current checks. Revocation never silently reinstates itself.

### Activation decision finality

A reserved occurrence ID MAY be used by exactly one activation decision. An accepted decision permanently consumes that reservation, creates one and only one occurrence record with that ID, and permits attempts only under that occurrence and grant. A denied decision permanently closes the reservation and grant; it MUST NOT later become accepted, create an occurrence, create an attempt, or produce an evaluator-generated `ExecutionResult`.

A later activation request MUST allocate a fresh reserved occurrence ID, a fresh `RuntimeGrant`, and a new `ActivationRecord`. An activation decision MUST NOT be retried by mutating or reusing an earlier activation record. No occurrence ID may have more than one activation decision, both denied and accepted decisions, or more than one occurrence record. Revoking a runtime grant after an accepted activation prevents subsequent grant-dependent actions or retries under point-of-use rules, but does not erase the activation, occurrence, or already recorded attempts.

A later registry snapshot, consumer-support, workspace-ceiling, or global-ceiling change does not rewrite historical validation, approval, issuance, activation, occurrence, or assessment facts. It MUST be re-evaluated at point of use. If current registry context, semantics, policy, revocation state, or trusted state cannot be established, issuance, activation, and authority-dependent consumption MUST fail closed.

## Approval, Issuance, and Usage Binding

Approval accepts an exact prospective artifact revision for a defined purpose and one trusted workspace. At minimum an `ApprovalRecord` MUST bind artifact kind, protocol/kind version, instance ID, revision ID, canonical digest, workspace ID, purpose, required extensions or features, exact required `RegistrySnapshotReference` or exact accepted registry context, validation record, approver role, and validity scope.

Issuance is separately artifact-specific. An `IssuanceRecord` MUST bind the exact approved subject, approval record, workspace, intended protocol consumer class or use, and any explicit validity or use bound. It has no authority to add a capability or activate execution.

All four prospective revisions selected by a consumable bundle MUST individually have active matching workspace-scoped approval and issuance. The `ExecutionBundle` itself MUST also have its own active matching workspace-scoped approval and issuance. Bundle approval or issuance MUST NOT substitute for approval or issuance of a referenced artifact. Referenced artifact approval or issuance MUST NOT substitute for approval or issuance of a bundle.

A bundle issuance has a default maximum of one successful activation. It MAY authorize a finite greater activation count only when the trusted issuance record explicitly declares that bound. Each successful activation still creates a distinct occurrence and requires a distinct runtime grant. A referenced-artifact revocation, unavailable current status, unsupported consumer semantic, or changed ceiling that makes effective authority ineligible invalidates future activation eligibility even when historical bundle issuance remains recorded.

A runtime grant is prepared for one reserved execution occurrence ID and becomes associated with that occurrence only when a successful activation materializes the same ID. It MUST bind the exact bundle and workspace and MAY only narrow the authority already allowed by global ceiling, workspace ceiling, approved policy, and consumer support. A grant MAY authorize a finite number of attempts for that occurrence. A retry MAY reuse the same grant only while its explicit attempt allowance, validity, current revocation state, and all point-of-use checks remain satisfied. A grant never widens authority and never authorizes another occurrence.

## Execution Occurrence, Attempts, and Retries

### Identity and cardinality

| Subject | Identity and cardinality |
| --- | --- |
| `ExecutionBundle` revision | One immutable proposed composition; it may be used by zero or more issuances and occurrences. |
| Reserved occurrence ID | One opaque `pgw:o:` reservation bound to one runtime grant and exactly one activation decision. |
| Activation decision | One immutable `ActivationRecord` with `accepted` or `denied`; only `accepted` creates one occurrence. |
| Execution occurrence | One opaque `pgw:o:` identifier bound to one accepted activation, one bundle revision, one workspace, and one occurrence grant. |
| Execution attempt | One opaque `pgw:a:` identifier bound to one occurrence and one increasing ordinal. An occurrence has zero or more attempts. |
| Retry | An attempt with ordinal greater than one in the same occurrence. It MUST retain the bundle, workspace, and occurrence grant scope. |
| `ExecutionResult` instance | An attempt has zero or one evaluator-produced result instance. The unique instance, if one exists, binds exactly one workspace, bundle revision, occurrence, and attempt; corrections are new revisions of that same instance. |
| Trusted receipt | One or more trusted records of activation, start, end, cancellation, denial, timeout, crash, or other lifecycle/execution fact; never the result itself. |

`ExecutionBundle`, activation, occurrence, attempt, result, publication, and receipt IDs MUST remain distinct even when a single local component creates several records.

### Attempt and retry rules

A retry is not a new bundle, a new occurrence, a new activation, or a silent continuation of a different runtime grant. It is a newly recorded attempt in the same occurrence. It MUST receive a new attempt ID and ordinal, and it MUST be linked to the same exact bundle, workspace, and occurrence grant. A new activation instead creates a new occurrence and requires a new grant.

Every started attempt MUST have a corresponding `ExecutionAttemptRecord` and trusted execution receipts. Candidate result drafts MAY exist in multiple provisional forms, but before evaluator adoption or origination they have no trusted result-instance ownership for the attempt. The protocol MUST NOT fabricate evaluator observations when no compatible evaluator can produce them.

The first successful compatible evaluator origination or adoption for an exact workspace, bundle revision, occurrence ID, and attempt ID MUST atomically establish the unique evaluator-produced `ExecutionResult` instance for that attempt in trusted correlation state outside the repository. Once established, a compatible evaluator and result publisher MUST NOT originate, adopt, or publish a different result instance for that attempt. Every correction, clarification, or replacement for that attempt MUST retain the same result instance ID, create a new immutable revision with valid single-predecessor lineage, and preserve the same workspace, bundle, occurrence, and attempt association. An attempt with no evaluator-produced result remains without one; it cannot be filled by a synthetic result.

Multiple results MAY refer to the same bundle because a bundle may have multiple occurrences and attempts. Multiple result revisions for one attempt are correction history, not multiple attempts or result instances. The core protocol defines no aggregated retry `ExecutionResult`. A trusted `ExecutionSummaryRecord` MAY report ordered per-attempt facts for review or reporting, but it MUST NOT replace per-attempt evidence, create completion proof, or alter result semantics.

## ExecutionResult Lifecycle and Publication

### Result classes

| Class | Definition | Permitted consumption |
| --- | --- | --- |
| Candidate `ExecutionResult` | Untrusted project-visible result content with no trusted attempt-to-result-instance association | Inspection as untrusted material only |
| Evaluator-produced result | A revision of the one unique result instance atomically adopted or originated for one attempt by a compatible completion evaluator and attested in an active publication record | Ordinary review when validation and provenance conditions hold |
| Validated result | Result revision with a passing applicable `ValidationRecord` | Necessary but not sufficient for trusted publication or automation |
| Published result | Evaluator-produced result of the unique instance with an active `ResultPublicationRecord` declaring allowed consumption scope | Scope-limited consumption only |
| Trusted execution receipt | Separate trusted local fact record | Lifecycle/execution fact verification; never replaced by result content |

A candidate does not become evaluator-produced because of its filename, location, annotation, producer claim, or result-like body. The first compatible evaluator MAY originate one result instance or adopt one exact validated candidate revision for an attempt. That action MUST atomically establish the unique attempt-to-result-instance association. In either case, a trusted result publisher MUST create a `ResultPublicationRecord` binding the evaluator's compatible identity and capability profile, the unique result instance, exact result revision and digest, exact bundle, workspace, occurrence, attempt, validation record, exact registry context, and declared consumption scope. A result publisher MUST reject a second distinct result-instance adoption or publication for the same attempt.

### Selected result lifecycle

`ExecutionResult` does **not** use `ApprovalRecord` or `IssuanceRecord`. Its smallest trustworthy lifecycle is:

```text
candidate result content
  -> structural and semantic validation
  -> compatible evaluator origination or adoption
  -> trusted ResultPublicationRecord with evaluator provenance
  -> scope-limited published result
  -> optional revocation or supersession through new trusted records
```

Result publication is a trusted attribution and consumption decision. It is not an authority grant, prospective approval, prospective issuance, activation, or trusted receipt.

Ordinary local-human or ChatGPT review MAY inspect candidate content as untrusted material. Ordinary review of an evaluator-produced result requires a validated, active published result with evaluator provenance; receipt correlation is not required merely to inspect and discuss it.

Completion-status consumption, downstream automation, and authoritative reporting each additionally require an active trusted receipt correlation. The publication record MUST bind the exact trusted receipt or receipt set that corroborates the same workspace, occurrence, attempt, bundle, unique result instance, and exact registry context. These uses also require current non-revocation, compatible consumer support, and an explicit publication scope permitting the use. For one result instance and one publication scope, at most one active current publication MAY be applicable at a time; a later current publication for that scope MUST supersede or revoke the prior current publication explicitly. A result cannot independently establish that an execution happened, completed, or was authorized.

### Corrections, withdrawal, revocation, and supersession

A correction to digest-covered result content creates a new immutable revision of the same unique result instance. It MUST retain the same workspace, bundle, occurrence, and attempt association; it MUST NOT amend an earlier result in place or switch to a new result instance. An earlier erroneous result remains historical and inspectable as project-visible content. A trusted `SupersessionRecord` MAY designate a later revision or publication of that same result instance as preferred for a stated review, completion, automation, or reporting purpose.

A `RevocationRecord` MAY withdraw a `ResultPublicationRecord` without deleting the result revision. Withdrawal prevents the revoked publication from its declared consumption scope. It does not convert the result into a receipt or erase historical facts. A newly corrected result requires its own validation, evaluator provenance, publication, exact registry context, and receipt correlation where its intended consumption requires them.

## Compatibility and Negotiation

A protocol compatibility decision is a local determination, not a wire API. It MUST take these inputs:

- resolved canonical envelope and recomputed digest;
- exact reference graph and graph-validation result;
- trusted consumer support declaration for protocol, kind, extension, capability, canonicalization, workspace-binding, reference, and lifecycle profiles;
- exact accepted `RegistrySnapshotReference` and applicable registry contracts;
- trusted workspace configuration and current workspace scope;
- required lifecycle records and current revocation state for the proposed use; and
- for authority-dependent use, trusted ceilings, approved policy, runtime grant, and activation context.

The output MUST be either `compatible for <specific use>` or `incompatible`, with one or more human-readable protocol failure categories. It MUST NOT silently downgrade required semantics, choose an alternative reference, treat optional as required or required as optional, or infer authority from compatibility.

A consumer support declaration MUST explicitly state the protocol versions, kind versions, extension versions, requirement identifiers, capability versions, canonicalization profiles, workspace-binding models, reference profile, lifecycle/result-publication profiles, and the exact registry snapshot or exact compatible registry contracts it correctly understands and enforces. A consumer MAY support more than one compatible release, but no generic semantic-version comparison authorizes a missing behavior.

## Protocol Failure Model

The following are protocol categories, not implementation error codes. `Diagnostic validation` means that an actor MAY inspect malformed or untrusted content to report a defect but MUST NOT record a successful validation for it. In every row, a failed subject remains inspectable as untrusted content unless trusted local policy independently restricts access.

| Failure category | Violated rule | Rejecting actor | Correctable? | Inspection / validation | Issuance | Activation | Downstream consumption |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Malformed envelope | Required envelope or JSON restrictions fail | Structural validator, resolver, consumer | Yes, by new draft/revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Unsupported protocol version | Consumer lacks supported envelope contract | Consumer, validator | Yes, by supported migration or consumer | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Unsupported artifact-kind version | Consumer lacks kind semantics | Kind validator, consumer | Yes, by compatible revision or consumer | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Invalid instance identity | Instance syntax, registration, or kind uniqueness fails | Identity registrar, resolver | Yes, by new accepted ID | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Reused or colliding instance identity | ID maps to incompatible identity history | Identity registrar, control plane | Yes, only by new instance | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Invalid revision identity | Revision syntax or registration binding fails | Identity registrar, resolver | Yes, by new revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Non-NFC or invalid canonical input | A digest-covered string is not already NFC, Unicode is invalid, or duplicate names could create parser ambiguity | Validator, resolver, consumer | Yes, by producer-side working-content correction before a new revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Canonicalization failure | Accepted projection cannot be JCS-canonicalized under the required profile | Validator, resolver, consumer | Yes, by conforming revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Digest mismatch | Derived digest differs from canonical bytes | Validator, resolver, consumer, control plane | Yes, by corrected immutable revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| False or invalid lineage | Predecessor, generation, kind, or instance rule fails | Identity registrar, semantic validator | Yes, by valid successor or new instance | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Workspace-binding mutation within an instance | A revision changes its instance's binding declaration | Identity registrar, semantic validator, resolver | Yes, only by a new instance and generation-zero revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Cross-workspace predecessor | A predecessor and successor have different bound workspace IDs | Identity registrar, semantic validator, resolver | Yes, only by a new instance | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Portable/bound mode mutation | A revision changes from portable to bound or bound to portable | Identity registrar, semantic validator, resolver | Yes, only by a new instance | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Invalid migration represented as lineage | A migration/binding change is modeled as an artifact predecessor | Identity registrar, migration authority, semantic validator | Yes, by generation-zero new instance plus migration correlation | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Mutable-reference use | Alias, path, query, range, or fallback used as exact target | Validator, resolver, consumer | Yes, by exact reference | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Unresolved exact reference | Exact target is unavailable or cannot be verified | Resolver, validator, consumer | Yes, by making target resolvable | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Kind mismatch | Resolved target is not expected kind/version | Validator, resolver, consumer | Yes, by correct reference | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Instance mismatch | Resolved target instance differs from reference | Resolver, consumer | Yes, by correct exact reference | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Workspace-binding mismatch | Bound target or result does not match required workspace | Bundle validator, consumer, control plane | Yes, by compatible revision/composition | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Unauthorized cross-workspace reference | Core reference crosses a bound workspace scope | Validator, resolver, consumer | Yes, by same-workspace or portable target | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Incompatible extension | Registry contract, version, or semantics conflict | Extension validator, consumer | Yes, by compatible revision/registry support | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Unsupported required extension | Required extension cannot be enforced | Consumer, validator | Yes, by support or new revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Extension namespace collision | Namespace ownership or registry snapshot conflicts | Registry authority, validator, consumer | Yes, by approved registry resolution/new revision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Unknown registry snapshot | Required exact snapshot cannot be resolved or is not accepted | Registry authority, validator, issuer, activation authority, consumer | Yes, by exact accepted snapshot context | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Registry snapshot ID reuse | One `pgw:g:` ID maps to incompatible snapshot content/history | Registry authority, validator, consumer | Yes, only by new governed snapshot ID | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Registry digest mismatch | Recomputed snapshot digest differs from its reference | Registry authority, validator, consumer | Yes, by exact valid snapshot reference | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Ambiguous registry label | A version, tag, path, filename, or label is used instead of exact snapshot identity | Validator, issuer, activation authority, consumer | Yes, by exact `RegistrySnapshotReference` | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Validation-record snapshot mismatch | Validation record snapshot differs from validation context required for the subject/use | Approver, issuer, activation authority, consumer | Yes, by compatible revalidation | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Lifecycle-record snapshot mismatch | Approval, issuance, activation, or publication binds an incompatible registry context | Control plane, consumer | Yes, by valid new lifecycle record after current checks | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Consumer support evaluated against a different snapshot | Consumer support does not match the required snapshot or explicitly compatible contracts | Compatibility evaluator, consumer | Yes, by exact compatible support decision | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Repository- or producer-controlled snapshot substitution | Untrusted content allocates, alters, or substitutes registry context | Registry authority, validator, control plane, consumer | Yes, by trusted governed snapshot selection | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Lifecycle record subject mismatch | Trusted record does not bind exact subject/scope | Control plane, consumer | Yes, by correct new record | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Approval scope mismatch | Approval lacks exact workspace, purpose, or subject scope | Approver, issuer, consumer | Yes, by new approval | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Issuance without approval | Issuance lacks active matching approval | Issuer, control plane, consumer | Yes, by validation and approval then issuance | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |
| Activation without eligibility | Bundle, references, issuance, grant, ceiling, registry context, or support check fails | Activation authority, consumer | Yes, by satisfying all current checks with a fresh reservation/grant | Inspect yes / diagnostic only | Issuance may remain separately possible | Prohibited | Prohibited for execution |
| Reused reserved occurrence ID | A reservation is associated with more than one activation decision | Activation authority, control plane | Yes, only by a fresh reservation and grant | Inspect yes / diagnostic only | Not applicable | Prohibited | Prohibited for execution |
| Second activation decision for one reserved occurrence | An `accepted` or `denied` decision already exists for the reservation | Activation authority, control plane | Yes, only by a fresh reservation and grant | Inspect yes / diagnostic only | Not applicable | Prohibited | Prohibited for execution |
| Denied-grant reuse | A grant closed by denied activation is reused for activation or execution | Activation authority, authority enforcer, consumer | Yes, only by a fresh reservation and grant | Inspect yes / diagnostic only | Not applicable | Prohibited | Prohibited for execution |
| Occurrence created after denied activation | An occurrence is associated with a denied decision | Control plane, execution recorder, consumer | No for that reservation; use a fresh activation path | Inspect yes / diagnostic only | Not applicable | Prohibited | Prohibited for execution |
| Multiple occurrence records for one activation | More than one occurrence claims one accepted activation | Control plane, execution recorder, consumer | No for the conflicting records; use a fresh activation path | Inspect yes / diagnostic only | Not applicable | Prohibited | Prohibited for execution |
| Attempt without accepted activation and occurrence | Attempt lacks one accepted activation and exactly one occurrence | Execution recorder, evaluator, result publisher, consumer | No for that attempted correlation; use a fresh valid occurrence | Inspect yes / diagnostic only | Not applicable | Prohibited | Prohibited for result-driven use |
| Stale or revoked lifecycle state | Required current state is revoked, expired, or unavailable | Issuer, activation authority, consumer | Yes, by valid new lifecycle decision where permitted | Inspect yes / diagnostic only | Prohibited while stale | Prohibited | Prohibited |
| Result provenance failure | Evaluator identity/capability or adoption binding fails | Result publisher, consumer | Yes, by compatible evaluator publication | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited beyond untrusted inspection |
| Conflicting evaluator-produced result instance | More than one evaluator-produced result instance is associated with one attempt | Result publisher, control plane, consumer | No for the conflicting attempt association; fail closed pending trusted conflict resolution outside result publication | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited for completion, automation, reporting |
| Second result-instance adoption for one attempt | Evaluator attempts to adopt/originate a different instance after unique association exists | Result publisher, evaluator, consumer | No for that second instance; correction must use existing instance | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited for completion, automation, reporting |
| Publication bound to wrong unique result instance | Publication instance differs from the trusted attempt association | Result publisher, consumer | Yes, by publication of the correct unique instance where otherwise valid | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited beyond untrusted inspection |
| Correction using a new result instance | A correction/replacement changes result instance rather than succeeding within it | Result validator, result publisher, consumer | Yes, by successor revision of the existing instance | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited for completion, automation, reporting |
| Competing current publications for one scope | More than one active current publication claims same result-instance scope | Result publisher, lifecycle resolver, consumer | Yes, by explicit revocation or supersession | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited for the conflicting scope |
| Result-to-occurrence mismatch | Result, publication, receipt, bundle, workspace, occurrence, or attempt disagree | Result validator, publisher, consumer | Yes, by corrected result/publication | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited beyond untrusted inspection |
| Receipt-correlation failure | Required result use lacks matching trusted receipt | Result publisher, consumer | Yes, by valid receipt correlation | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited for completion, automation, reporting |
| Illegal result publication | Publication exceeds result role or scope | Result publisher, control plane, consumer | Yes, by new valid publication | Inspect yes / diagnostic only | Not applicable to result | Prohibited for result-driven use | Prohibited beyond untrusted inspection |
| Replay or substitution attempt | Subject, digest, workspace, record, grant, or receipt reused out of scope | Resolver, control plane, consumer | Yes, by valid scoped subject/record | Inspect yes / diagnostic only | Prohibited | Prohibited | Prohibited |

## Security and Replay Invariants

1. **Opaque identity is not authority:** An instance, revision, occurrence, attempt, or record ID MUST NOT establish trust, approval, issuance, workspace authority, or consumer support.
2. **Path is not identity:** A path, filename, Git revision, directory, repository, alias, or display name MUST NOT identify an exact artifact.
3. **Alias is not an exact reference:** `latest`, version range, query, and fallback selection MUST NOT be consumed as exact references.
4. **Content change creates a new revision:** Any canonical projection change MUST create a new revision ID and digest.
5. **Digest mismatch fails closed:** A target with mismatched canonical digest MUST NOT be consumed.
6. **Approval binds immutable content:** Approval MUST bind exact kind, instance, revision, digest, workspace, and purpose.
7. **Approval scope cannot widen:** A record for one workspace, purpose, consumer use, or extension set MUST NOT authorize another.
8. **Workspace approval cannot replay:** An approval, issuance, bundle, policy, context, grant, receipt, or result publication for one workspace MUST NOT be replayed into another.
9. **Lifecycle records are not repository content:** Repository content, ChatGPT Web, and artifact producers MUST NOT create trusted lifecycle facts by writing documents.
10. **Issued content is immutable:** An issued revision MUST NOT be edited in place or inherit lifecycle state after canonical change.
11. **Revocation is checked at point of use:** Issuance, activation, grant use, authority-dependent action, and result consumption MUST check applicable current revocation and validity state.
12. **Required unsupported semantics fail closed:** Unknown required versions, features, capabilities, kinds, or extensions MUST prevent consumption.
13. **Bundle composition is non-merging:** A bundle MUST select exact references and MUST NOT copy, override, fallback, grant, approve, issue, or activate.
14. **Result remains retrospective:** A result MUST NOT redefine prospective task, policy, context, completion, or bundle meaning.
15. **Result is not a receipt:** Publication and evaluator provenance MUST NOT turn a result into a trusted receipt.
16. **Context remains untrusted data:** Context loading MUST NOT promote instructions, authority, lifecycle claims, system instructions, or consumer-safeguard overrides.
17. **Extension registry is not producer-controlled:** Artifact content and repository content MUST NOT register or redefine extension semantics.
18. **History is append-only:** Artifact revisions and trusted records MUST NOT be silently deleted, rewritten, or reused; revocation and supersession are explicit new facts.
19. **Trusted-state unavailability fails closed:** Unavailable required trusted state MUST prevent authority-dependent use and privileged result consumption.
20. **Consumer neutrality persists:** Core semantics MUST NOT depend on Pi, pi-guard, Codex, Cline, a particular evaluator, filesystem layout, or database.
21. **NFC is a validation precondition:** Every digest-covered string MUST already be NFC; non-NFC strings MUST be rejected and MUST NOT be silently normalized by JCS or any protocol step.
22. **Workspace binding is instance-continuous:** A successor MUST retain exactly its instance's portable/bound mode and, if bound, workspace ID. A binding change requires a new instance, not lineage.
23. **Only usability/publication records are revocable:** Only approval, issuance, runtime grant, and result publication records may be revoked; historical facts and assessments remain immutable.
24. **Activation decisions are terminal per reservation:** One reserved occurrence ID has one immutable accepted-or-denied activation decision. A denial closes its reservation and grant permanently.
25. **One evaluator-produced result instance per attempt:** A trusted attempt association MUST identify zero or one evaluator-produced result instance; corrections remain revisions of that instance.
26. **Registry snapshot identity is exact:** Registry labels, paths, and release names are not identity. Required registry-dependent decisions MUST bind exact snapshot identity and its distinct digest domain.

## Migration and Evolution

A protocol migration MUST be explicit, reviewable, and non-escalating.

- A newer envelope major, kind major, canonicalization profile, identity format, or semantic reinterpretation requires a new canonical subject or an explicit supported migration profile.
- A migration that changes canonical bytes MUST create a new revision ID and digest. A migration that changes instance semantics, workspace-binding mode, bound workspace ID, or cannot preserve binding continuity MUST create a new instance and generation-zero revision with no artifact predecessor.
- A `MigrationRecord` MAY correlate exact old and new subjects, preserve historical references, and identify a reviewed transformation profile. It MUST NOT create artifact lineage, transfer identity, or transfer approval, issuance, grant, activation, publication, workspace scope, or receipt correlation automatically.
- Deprecated protocol, kind, or extension versions MAY receive read-only inspection support. They MUST NOT be newly issued, activated, or consumed in an authority-dependent use unless explicitly supported by current trusted policy.
- Replacing a deprecated extension namespace requires a new revision using the registered successor. No consumer may silently reinterpret old extension payload as successor semantics.
- Imported earlier drafts become either byte-identical mirrors of an existing canonical subject or new protocol subjects with explicit migration correlation. A path, import label, or producer assertion is not migration proof.

## Resolved WP-1 Decisions

| WP-1 decision | Selected WP-2 decision | Primary protocol sections |
| --- | --- | --- |
| OD-WP1-001 — Artifact-instance succession and revision lineage | Opaque globally unique instance and revision IDs; revision ID distinct from digest; one genesis or one exact predecessor; branches allowed, merges prohibited; workspace binding is immutable for an instance; trusted registrar verifies identity, lineage, and binding continuity. | Artifact-Instance Identity; Revision Identity and Lineage; Canonical Representation |
| OD-WP1-002 — Execution occurrence, retry, and result grouping | Each reservation has one accepted-or-denied activation decision; accepted creates one occurrence; occurrence contains ordered attempts; retry is a later attempt; each attempt has at most one evaluator-produced result instance; receipts correlate facts; retry aggregation is separate trusted reporting state. | Execution Occurrence, Attempts, and Retries; ExecutionResult Lifecycle |
| OD-WP1-003 — Registered extension namespace governance | Human-approved external protocol registry with immutable, exact-ID-and-digest snapshots; trusted local configuration can only constrain; required unsupported semantics fail closed. | Extension Namespace Governance; Compatibility and Negotiation |
| OD-WP1-004 — Artifact workspace binding and portability | Policy/context/bundle/result are bound; task/contract may be portable or bound; binding is continuous within an instance; all execution-use approvals and issuances are workspace-scoped; bundle resolves to exactly one trusted workspace. | Workspace Binding and Portability; Approval, Issuance, and Usage Binding |
| OD-WP1-005 — ExecutionResult lifecycle and publication | Candidate, validation, unique evaluator-produced result instance per attempt, trusted publication, scope-limited consumption, separate receipt correlation, revocation, and supersession; no prospective approval/issuance for results. | ExecutionResult Lifecycle and Publication; Trusted Lifecycle Record Model |

## Deferred Implementation Work

The following work is deliberately handed to later packages and MUST conform to this specification:

- JSON Schemas for common envelopes, core-kind bodies, exact references, extensions, and trusted-record interchange where authorized;
- structural and semantic validation algorithms and conformance suites;
- NFC precondition validation, JCS serialization, hashing, and digest verification libraries;
- identity registry, workspace registry, extension registry, and lifecycle-record persistence implementations;
- trusted approver, issuer, activation, evaluator, receipt, and audit integration;
- consumer support declarations and capability-negotiation interfaces;
- adapter behavior for Pi, pi-guard, and future consumers; and
- gateway tools and user interfaces.

None of those implementation activities is authorized by WP-2.

## Unresolved WP-2 Questions

No unresolved WP-2 protocol decisions.

## Completion Criteria

WP-2 is ready for human review when all of the following are true:

- the six accepted core aggregates and mandatory non-merging bundle composition remain intact;
- protocol, kind, extension, and consumer-capability versions are distinct;
- instance, revision, digest, reference, and alias are distinct;
- canonical JSON and digest coverage are deterministic and unambiguous;
- exact references prevent target substitution;
- workspace binding prevents cross-workspace authority or approval replay and remains continuous within an artifact instance;
- extension governance is outside repository and producer control, with exact immutable registry snapshot identity;
- trusted lifecycle records remain outside repositories and retain role separation;
- validation, approval, issuance, grant, activation, result publication, and receipt remain distinct;
- occurrence, attempt, retry, result instance, publication, and receipt are distinct; one attempt has at most one evaluator-produced result instance;
- result publication does not make a result a receipt;
- revocation is checked at point of use; and
- no implementation, schema, adapter, storage, or tool work is included.

Document completion does not approve an artifact, issue an artifact, activate an execution, or close WP-2. Human review and explicit approval remain required.

## Handoff Requirements

Later schema and implementation work MUST:

1. encode only the envelope components and prohibited-field boundaries defined here;
2. preserve IDs, digest coverage, NFC validation-and-rejection, JCS serialization, workspace-binding continuity, and exact-reference verification without path or alias fallback;
3. enforce one exact `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, and `CompletionContract` in every consumable MVP bundle;
4. validate workspace compatibility and workspace-scoped approval/issuance at every appropriate use;
5. keep registry governance, exact registry snapshot identity, workspace configuration, identity registration, and lifecycle records outside managed repositories;
6. reject unknown required versions, capabilities, extensions, references, and lifecycle state;
7. preserve the authority intersection, deny-overrides-allow, and context-as-untrusted-data boundaries;
8. implement no result-as-receipt shortcut and no prospective lifecycle inference for results;
9. correlate result publication and receipt only through exact trusted records;
10. preserve append-only historical artifact and record facts, terminal denied activation reservations, and one-result-instance-per-attempt correlation; and
11. remain consumer-neutral, routing consumer-specific behavior through adapters or registered extensions.
