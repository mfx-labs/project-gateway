# ADR-009 — Canonical Representation and Digest Binding

## Status

Accepted

## Context

WP-0 requires approval to bind the canonical digest of an exact revision, and WP-1 requires kind, instance, revision, and immutable content to remain distinct. A deterministic common representation is needed before validators, lifecycle records, and exact references can agree on the subject being approved or consumed.

## Decision

The canonical artifact revision projection uses RFC 8785 JSON Canonicalization Scheme serialized as UTF-8 under the Project Gateway profile `jcs-rfc8785-v1`.

The profile rejects duplicate object member names before an ordinary parser can discard or replace them, rejects invalid Unicode and unpaired Unicode surrogates, and requires every digest-covered string to already be Unicode NFC. A non-NFC digest-covered string MUST be rejected. The protocol MUST NOT silently normalize artifact content. Implementations MUST NOT silently normalize, rewrite, repair, or replace artifact strings; RFC 8785 JCS serializes the accepted data model and does not perform Unicode normalization. The profile limits digest-covered JSON numbers to safe integers; requires semantic decimals and byte data to use registered strings; preserves array order; requires protocol set-like arrays to be unique and canonically sorted; and requires any digest-covered timestamp to use UTC `YYYY-MM-DDTHH:MM:SS.sssZ`.

Every digest-covered string MUST already be Unicode NFC. A non-NFC string MUST be rejected. The protocol MUST NOT silently normalize artifact content.

The canonical projection includes protocol metadata, kind metadata, instance ID, revision ID, generation, predecessor, workspace binding, requirements, extension declarations and payloads, and kind body. It excludes only `revision.digest`, because it is derived from the projection, and optional presentation `annotations`. Lifecycle state is prohibited from the envelope rather than ambiguously included or excluded.

The artifact digest is SHA-256 with exact domain separation:

```text
SHA-256(UTF-8("PGAP-ARTIFACT-REVISION-v1\u0000") || JCS(canonical-projection))
```

Its serialized syntax is `sha-256:` plus 64 lowercase hexadecimal characters. Approvals bind exact protocol/kind versions, instance ID, revision ID, digest, workspace, purpose, validation context, exact registry snapshot context where required, and required semantic context. A digest, approval, or signature for one subject cannot be reused for another.

A trusted `RegistrySnapshot` uses the same validation-and-rejection preconditions and RFC 8785 JCS serialization, but it is not an artifact revision and uses a distinct digest domain:

```text
SHA-256(UTF-8("PGAP-REGISTRY-SNAPSHOT-v1\u0000") || JCS(canonical-registry-snapshot))
```

Its opaque `pgw:g:` snapshot ID, format version, protocol compatibility declaration, namespace ownership and contracts, feature/capability registrations, required/optional ignore-safety, deprecation/supersession, and governance security-review state are digest-covered snapshot content. Artifact digests and registry snapshot digests MUST NOT substitute for one another.

## Rationale

JCS provides a deterministic JSON representation while the additional profile restrictions eliminate duplicate-key, Unicode, number, timestamp, and unordered-set ambiguity. Domain separation prevents an artifact digest from being confused with a file hash, Git object ID, lifecycle record hash, or another hash domain.

## Consequences

- A canonicalization or digest mismatch fails closed before validation for consumption, issuance, activation, or privileged result use.
- Display metadata can remain mutable only as non-authoritative annotations that consumers cannot use for any protocol or lifecycle decision.
- A content change necessarily changes the canonical projection, revision identity, and digest.
- Validation, approvals, issuances, exact references, and audit records must use the same accepted canonicalization profile and exact digest value; validation and registry-dependent lifecycle decisions bind exact registry snapshot context where required.
- Later protocol changes that alter canonical interpretation require a new compatible contract version or explicit migration.

## Rejected Alternatives

1. **Silently normalize NFC before hashing:** Rejected because it can hash a tree different from the one validators and consumers received; NFC is a validation precondition and non-NFC input is rejected.
2. **Hash raw source bytes:** Rejected because whitespace, object ordering, and equivalent JSON presentation would produce unstable identity.
3. **Use a file hash or Git object ID:** Rejected because repository storage is not artifact identity and does not cover protocol interpretation.
4. **Permit duplicate keys or arbitrary number forms:** Rejected because parsers can disagree on their semantics.
5. **Digest mutable annotations or lifecycle state:** Rejected because it either makes presentation changes impersonate revisions or moves trusted state into project-visible content.
6. **Use an undomain-separated bare hash:** Rejected because it permits cross-purpose hash substitution.
