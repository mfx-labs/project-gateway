# ADR-013 — Extension Governance and Compatibility

## Status

Accepted

## Context

WP-0 requires registered extension namespaces, explicit required-versus-optional semantics, consumer-neutrality, and fail-closed handling. WP-1 preserves those boundaries but defers who governs namespaces, what a registry controls, and how compatibility is decided without allowing repository content or ChatGPT Web to define trusted semantics.

## Decision

Project Gateway adopts a human-approved Protocol Registry maintained outside managed repositories. Every accepted protocol release includes an immutable `RegistrySnapshot`, a trusted external protocol subject rather than a core artifact. A snapshot has opaque globally non-reusable `pgw:g:` identity, registry format version, exact Project Gateway protocol-release or compatibility declaration, and a `sha-256:` digest over RFC 8785 JCS canonical snapshot content under the distinct domain `PGAP-REGISTRY-SNAPSHOT-v1\u0000`. Snapshot canonicalization rejects duplicate member names and non-NFC digest-covered strings; it never silently normalizes content. Trusted local configuration selects accepted snapshots by exact `RegistrySnapshotReference` and may impose stricter local policy or disable support, but it cannot add, redefine, or override a namespace or extension contract without human-approved registry governance.

Extensions use registered lowercase reverse-domain-style ASCII namespaces and separate `MAJOR.MINOR` contract versions. Registry entries define namespace ownership, supported protocol and kind versions, schema and semantic-contract ownership, security review, deprecation, supersession, required/optional ignore-safety, and consumer support expectations. A label, tag, path, filename, or release name is not snapshot identity; artifact/repository/ChatGPT content cannot allocate, alter, or substitute a snapshot.

An artifact declaration contains registered namespace, extension version, required-or-optional mode, and digest-covered payload. Required extensions must be understood and enforced. Optional extensions may be ignored only when the registry expressly declares that version ignore-safe and ignoring it cannot alter core meaning, authority, completion obligations, workspace binding, lifecycle requirements, reference semantics, or safety guarantees.

Protocol envelope version, kind version, extension version, and consumer capability version are distinct. Compatibility requires explicit support across all relevant levels and exact required registry context; semantic-version ordering alone is not proof of compatibility. Unknown major versions and unknown required minor semantics fail closed.

A contract change is major whenever an old conforming implementation could accept the new subject but interpret, validate, authorize, canonicalize, reference, enforce, or consume it differently. Existing semantic/member/value changes, removal/renaming, requiredness changes, canonical/digest/reference/workspace/lifecycle/authority changes, changed defaults or set ordering, required/optional ignore-safety changes, trust/aggregate changes, and common envelope top-level additions are major. A minor change is allowed only when additive, previous validity/meaning/canonical interpretation are unchanged, and an old consumer either processes identically or detects an explicit required feature and fails closed.

| Contract level | Major classification | Minor classification |
| --- | --- | --- |
| Protocol envelope | Existing envelope, canonicalization, digest, identifier, reference, workspace, lifecycle, or default change | Explicit requirement-gated feature or safe clarification only |
| Artifact kind | Existing body/invariant/responsibility/authority/completion/workspace/lifecycle change | Safe optional content or explicit requirement-gated feature only |
| Extension | Payload/semantic/requiredness/ignore-safety/supported-contract change | Registry-proven ignore-safe optional or explicit requirement-gated feature only |
| Feature/capability | Existing meaning/enforcement/support/safety change | Additive named requirement old consumers detect and fail closed on |

Software patch releases remain outside serialized versions and MUST NOT change interpretation, canonicalization, digest computation, validation acceptance, required semantics, authority, lifecycle, or compatibility outcomes.

## Rationale

A human-approved immutable registry snapshot gives all consumers a common reviewed contract while preserving local ability to narrow support. Explicit compatibility inputs prevent a producer from using a version string or optional marker to obtain unsafe best-effort interpretation.

## Consequences

- Repository content, artifacts, ChatGPT Web, and producers cannot register namespaces or resolve ownership/collision disputes.
- Namespace collision, unregistered namespace, owner mismatch, unsupported version, unknown/unaccepted snapshot, snapshot ID reuse, digest mismatch, snapshot-label ambiguity, registry disagreement, or producer-controlled snapshot substitution fails closed.
- Deprecation and supersession preserve historical interpretation and require explicit new content or migration; they never silently rewrite payload meaning.
- Validation records bind exact snapshot references; registry-dependent approvals, compatibility decisions, issuance, activation, and consumer support must bind or verify exact permitted snapshot context.
- A consumer support declaration must name the protocol, kind, extension, capability, canonicalization, workspace, reference, lifecycle semantics, and exact snapshot or exact compatible registry contracts it enforces.
- Extensions cannot override ceilings, denials, lifecycle boundaries, result/receipt separation, or core aggregate responsibilities.

## Rejected Alternatives

1. **Repository-controlled registry:** Rejected because untrusted project content could self-authorize semantics.
2. **ChatGPT- or producer-controlled registration:** Rejected because an artifact producer cannot create trusted protocol contracts.
3. **Free-form extension keys with no owner/version:** Rejected because collisions and interpretation cannot be safely resolved.
4. **Ignore all unknown optional declarations:** Rejected because optionality must itself be registry-defined and safety-preserving.
5. **Use a registry label, path, tag, or release name as snapshot identity:** Rejected because immutable registry content requires exact opaque ID and digest binding.
6. **Use semantic-version comparison as compatibility proof:** Rejected because support depends on actual required features, extensions, capabilities, workspace binding, references, lifecycle semantics, and exact registry context.
