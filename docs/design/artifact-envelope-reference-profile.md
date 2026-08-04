# Project Gateway MCP — Artifact Envelope and Exact-Reference Profile

**Status:** Normative WP-2 companion profile
**Companion to:** `docs/design/artifact-identity-versioning-reference-lifecycle-protocol.md`

## Purpose and Precedence

This profile gives schema authors and validators a concise normative view of the common artifact envelope, canonical projection, revision identity, exact references, workspace binding, and extension declarations. It applies to all six core artifact kinds. It does not define JSON Schema, storage, APIs, or implementation types.

The authoritative interpretation is the WP-2 artifact identity, versioning, reference, and lifecycle protocol. If this concise profile appears incomplete, that protocol supplies the controlling rule.

## Envelope Components

A canonical artifact revision MUST have exactly these common top-level components. `annotations` MAY be omitted. A later protocol major version is required before adding a common top-level component.

| Component | Required | Canonical and digest-covered | Purpose |
| --- | --- | --- | --- |
| `protocol` | Yes | Yes | Envelope identity, version, and canonicalization profile |
| `kind` | Yes | Yes | Artifact kind and kind-contract version |
| `instance_id` | Yes | Yes | Opaque logical-artifact identity |
| `revision` | Yes | Partly | Revision ID, generation, predecessor, and derived digest |
| `workspace_binding` | Yes | Yes | Portable or trusted-workspace-bound status |
| `requirements` | Yes | Yes | Registered required protocol features and consumer capabilities |
| `extensions` | Yes | Yes | Registered extension declarations and payloads |
| `body` | Yes | Yes | Kind-specific specification or retrospective result body |
| `annotations` | No | No | Presentation-only non-authoritative metadata |

The following normative abstract shape uses placeholders. It is not JSON Schema.

```json
{
  "protocol": {
    "id": "project-gateway.artifact",
    "version": "1.0",
    "canonicalization": "jcs-rfc8785-v1"
  },
  "kind": {
    "id": "<core-kind-id>",
    "version": "<kind-major.minor>"
  },
  "instance_id": "pgw:i:<32-lowercase-hex>",
  "revision": {
    "id": "pgw:r:<32-lowercase-hex>",
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

A working document that does not meet this envelope is not a canonical artifact revision and MUST NOT be exactly referenced, approved, issued, activated, or published as an evaluator-produced result.

## Version Components

| Component | Syntax | Meaning | Compatibility rule |
| --- | --- | --- | --- |
| `protocol.version` | `MAJOR.MINOR` | Common-envelope interpretation | Major mismatch fails closed absent explicit migration support |
| `kind.version` | `MAJOR.MINOR` | `body` interpretation for one kind | Consumer must explicitly support kind semantics |
| Extension `version` | `MAJOR.MINOR` | Extension payload interpretation | Registry and consumer must explicitly support it |
| Required feature/capability version | Registered `MAJOR.MINOR` identifier | Required common or consumer-neutral semantics | Unknown requirement fails closed |
| Consumer support version | Trusted external support declaration | What a consumer can enforce | Never inferred from artifact producer assertion |

`MAJOR.MINOR` uses decimal components without leading zeroes except `0`. Patch, pre-release, build, range, wildcard, and alias notation are prohibited in canonical artifact content. Software patch releases MUST NOT change serialized interpretation, canonicalization, digest computation, validation acceptance, required semantics, authority behavior, lifecycle behavior, or compatibility outcomes.

### Contract change classification

A change is major whenever a prior conforming implementation could accept the new subject but interpret, validate, authorize, canonicalize, reference, enforce, or consume it differently. Major changes include changed/removed/renamed existing meaning, newly required existing content, changed canonical/digest/reference/workspace/lifecycle/authority semantics, unsafe defaults, changed set ordering, changed required/optional extension safety, changed trust or aggregate responsibility, and common top-level envelope additions.

| Contract | Major change examples | Minor only when additive, old meaning/validity/canonical interpretation remain unchanged, and older consumers process identically or detect an explicit requirement and fail closed |
| --- | --- | --- |
| Protocol envelope | Common member, canonicalization, digest, identifier, reference, workspace, lifecycle, or default change | Clarification; explicitly declared required protocol feature; registry-proven ignore-safe optional semantic |
| Artifact kind | Existing body member/value/invariant or responsibility/authority/completion/workspace/lifecycle change | Safe optional kind content or explicitly declared required feature |
| Extension | Payload/semantic/requiredness/ignore-safety/supported-contract/authority/lifecycle/workspace change | Separately registered ignore-safe optional semantic or explicitly declared required feature |
| Feature or capability | Existing feature/capability meaning, enforcement, support, or safety change | Additive named requirement that old consumers detect and fail closed on |

Adding required behavior is not automatically minor. A new enum value, validation tightening, or validation loosening is major unless the governing contract's explicit feature/version boundary makes old consumers reject it rather than silently misinterpret it. Numeric ordering alone is never compatibility proof.

## Identity and Revision Components

| Component | Normative rule |
| --- | --- |
| `instance_id` | MUST be `pgw:i:` plus 32 lowercase hexadecimal characters. It is opaque, globally non-reusable, and unrelated to path, workspace, producer, time, or authority. |
| `revision.id` | MUST be `pgw:r:` plus 32 lowercase hexadecimal characters. It is opaque, registered once, and distinct from digest. |
| `revision.generation` | MUST be safe non-negative integer. It is `0` for genesis; otherwise exactly one greater than the exact predecessor generation. |
| `revision.predecessor` | MUST be `null` only at generation zero. Otherwise it MUST be an exact reference to the same kind and instance. |
| `revision.digest` | MUST be a recomputed `sha-256:` artifact digest. It is derived and excluded only from its own digest input. |

A revision has zero or one predecessor. Branches are permitted; lineage merges are prohibited. A changed canonical projection requires a new revision ID and digest. An issued revision MUST NOT be amended in place. Predecessor lineage does not transfer lifecycle authority. Workspace binding is an instance invariant: predecessor and successor MUST have exactly the same binding declaration; a mode or bound-workspace change requires a new instance and generation-zero revision, not lineage.

## Canonicalization and Digest Components

The canonical projection is the envelope with `annotations` and `revision.digest` omitted. All other envelope components are digest-covered, including protocol/kind metadata, IDs, lineage, workspace binding, requirements, extensions, extension payloads, and body.

The projection MUST use RFC 8785 JCS JSON serialized as UTF-8, with these profile restrictions:

- every object rejects duplicate member names before an ordinary parser can silently discard or replace one;
- every digest-covered string MUST already be valid Unicode NFC and contain no unpaired surrogate; a non-NFC string MUST be rejected;
- implementations MUST NOT silently normalize, rewrite, repair, or replace digest-covered strings; JCS serializes only the accepted data model and does not perform Unicode normalization;
- numbers are safe integers only; semantic decimals and byte strings use registered strings;
- arrays preserve order, while set-like `requirements` and `extensions` arrays are unique and canonically sorted;
- `null` is permitted only where the relevant contract says so; and
- digest-covered timestamps use UTC `YYYY-MM-DDTHH:MM:SS.sssZ` exactly.

Every digest-covered string MUST already be Unicode NFC. A non-NFC string MUST be rejected. The protocol MUST NOT silently normalize artifact content.

The digest is:

```text
SHA-256(UTF-8("PGAP-ARTIFACT-REVISION-v1\u0000") || JCS(canonical-projection))
```

Its serialized form is `sha-256:` followed by 64 lowercase hexadecimal characters. A file hash, Git object ID, bare hash, annotation hash, or hash with another domain MUST NOT substitute for this value.

## Workspace-Binding Components

A workspace ID has syntax `pgw:w:` followed by 32 lowercase hexadecimal characters. It is allocated only by trusted local workspace configuration.

```json
{ "mode": "portable" }
```

```json
{ "mode": "bound", "workspace_id": "pgw:w:<32-lowercase-hex>" }
```

| Kind | Allowed binding |
| --- | --- |
| `TaskSpec` | `portable` or `bound`, chosen at generation zero and immutable for the instance |
| `AuthorityPolicy` | `bound` only; the bound workspace ID is immutable for the instance |
| `ContextManifest` | `bound` only; the bound workspace ID is immutable for the instance |
| `CompletionContract` | `portable` or `bound`, chosen at generation zero and immutable for the instance |
| `ExecutionBundle` | `bound` only; the bound workspace ID is immutable for the instance |
| `ExecutionResult` | `bound` only, equal to one reported attempt workspace and immutable for the result instance |

A predecessor and successor MUST have exactly the same workspace-binding declaration. A portable-to-bound, bound-to-portable, or bound-workspace-ID change requires a new instance, generation-zero revision, no artifact predecessor, and fresh validation/lifecycle records as applicable. A `MigrationRecord` may correlate old and new subjects but does not create lineage or transfer lifecycle authority.

A bundle's bound workspace is its digest-covered proposed execution scope. It does not create trusted workspace registration or authority. A bundle must resolve exactly one trusted workspace: policy and context MUST be bound to it; a bound task or contract MUST match it; a portable task or contract requires workspace-scoped lifecycle and compatibility checks. Core references to another bound workspace are prohibited.

## Extension Declarations

An `extensions` array MUST be present, even when empty. Its entries are canonicalized in unique ascending `(namespace, version)` order.

```json
{
  "namespace": "example.review-evidence",
  "version": "1.0",
  "mode": "required",
  "payload": {}
}
```

`namespace` uses registered lowercase reverse-domain-style ASCII labels. `mode` is exactly `required` or `optional`. The extension registry, not artifact content, owns namespace assignment, version semantics, supported kind relationships, deprecation, and ignore-safety.

A required extension MUST be understood and enforced. An optional extension MAY be ignored only when its registered semantics explicitly say it is ignore-safe and ignoring it cannot affect core meaning, authority, completion obligations, workspace binding, lifecycle, references, or safety.

## RegistrySnapshot Context

A `RegistrySnapshot` is a trusted immutable protocol subject outside managed repositories, not a core artifact or envelope member. An exact `RegistrySnapshotReference` is required wherever validation, approval, compatibility, issuance, activation, or consumer support relies on registry-governed semantics.

```json
{
  "registry_protocol_id": "project-gateway.registry",
  "registry_snapshot_format_version": "1.0",
  "registry_snapshot_id": "pgw:g:<32-lowercase-hex>",
  "registry_snapshot_digest": "sha-256:<64-lowercase-hex>",
  "protocol_compatibility": "<exact-project-gateway-artifact-release-or-compatibility-declaration>"
}
```

The snapshot ID is opaque and non-reusable. Its digest uses the distinct domain `PGAP-REGISTRY-SNAPSHOT-v1\u0000` over RFC 8785 JCS output after the same duplicate-key, already-NFC, no-silent-normalization, safe-integer, and deterministic-set validation preconditions as artifact canonicalization. A label, filename, path, tag, or release name is not exact snapshot identity. Artifact `requirements` and `extensions` declarations do not create or select trusted snapshot state.

## Exact Artifact Reference Components

Every consumable exact reference MUST be digest-covered by its source and contain all of these values:

```json
{
  "target_protocol_version": "1.0",
  "target_kind": {
    "id": "CompletionContract",
    "version": "1.0"
  },
  "target_instance_id": "pgw:i:<32-lowercase-hex>",
  "target_revision_id": "pgw:r:<32-lowercase-hex>",
  "target_digest": "sha-256:<64-lowercase-hex>",
  "target_workspace_binding": {
    "mode": "portable"
  }
}
```

The resolver MUST recompute and compare every listed target property. It MUST obtain extension requirements from the verified target envelope rather than a reference summary. A path, filename, title, alias, `latest`, version range, query, partial digest, fallback list, or Git revision is not an exact reference.

A provisional draft reference MAY exist only in unconsumable working content. It MUST become the full exact form before consumption, which produces a new canonical revision.

## Abstract Envelope Examples

### Portable `TaskSpec` revision

The following is a normative abstract example; placeholder body members do not define `TaskSpec` field semantics.

```json
{
  "protocol": {
    "id": "project-gateway.artifact",
    "version": "1.0",
    "canonicalization": "jcs-rfc8785-v1"
  },
  "kind": { "id": "TaskSpec", "version": "1.0" },
  "instance_id": "pgw:i:<task-instance>",
  "revision": {
    "id": "pgw:r:<task-revision>",
    "generation": 0,
    "predecessor": null,
    "digest": "sha-256:<task-digest>"
  },
  "workspace_binding": { "mode": "portable" },
  "requirements": { "protocol_features": [], "consumer_capabilities": [] },
  "extensions": [],
  "body": { "<task-intent-only>": "<placeholder>" },
  "annotations": { "title": "Untrusted display title" }
}
```

### Bound `ExecutionBundle` revision

The body contains exactly one full exact reference for each required prospective kind. Placeholder values stand for values conforming to the component syntax above; the member structure is normative.

```json
{
  "protocol": {
    "id": "project-gateway.artifact",
    "version": "1.0",
    "canonicalization": "jcs-rfc8785-v1"
  },
  "kind": { "id": "ExecutionBundle", "version": "1.0" },
  "instance_id": "pgw:i:<bundle-instance>",
  "revision": {
    "id": "pgw:r:<bundle-revision>",
    "generation": 1,
    "predecessor": {
      "target_protocol_version": "1.0",
      "target_kind": { "id": "ExecutionBundle", "version": "1.0" },
      "target_instance_id": "pgw:i:<bundle-instance>",
      "target_revision_id": "pgw:r:<prior-bundle-revision>",
      "target_digest": "sha-256:<prior-bundle-digest>",
      "target_workspace_binding": {
        "mode": "bound",
        "workspace_id": "pgw:w:<workspace>"
      }
    },
    "digest": "sha-256:<bundle-digest>"
  },
  "workspace_binding": {
    "mode": "bound",
    "workspace_id": "pgw:w:<workspace>"
  },
  "requirements": { "protocol_features": [], "consumer_capabilities": [] },
  "extensions": [],
  "body": {
    "task": {
      "target_protocol_version": "1.0",
      "target_kind": { "id": "TaskSpec", "version": "1.0" },
      "target_instance_id": "pgw:i:<task-instance>",
      "target_revision_id": "pgw:r:<task-revision>",
      "target_digest": "sha-256:<task-digest>",
      "target_workspace_binding": { "mode": "portable" }
    },
    "authority_policy": {
      "target_protocol_version": "1.0",
      "target_kind": { "id": "AuthorityPolicy", "version": "1.0" },
      "target_instance_id": "pgw:i:<policy-instance>",
      "target_revision_id": "pgw:r:<policy-revision>",
      "target_digest": "sha-256:<policy-digest>",
      "target_workspace_binding": {
        "mode": "bound",
        "workspace_id": "pgw:w:<workspace>"
      }
    },
    "context_manifest": {
      "target_protocol_version": "1.0",
      "target_kind": { "id": "ContextManifest", "version": "1.0" },
      "target_instance_id": "pgw:i:<context-instance>",
      "target_revision_id": "pgw:r:<context-revision>",
      "target_digest": "sha-256:<context-digest>",
      "target_workspace_binding": {
        "mode": "bound",
        "workspace_id": "pgw:w:<workspace>"
      }
    },
    "completion_contract": {
      "target_protocol_version": "1.0",
      "target_kind": { "id": "CompletionContract", "version": "1.0" },
      "target_instance_id": "pgw:i:<contract-instance>",
      "target_revision_id": "pgw:r:<contract-revision>",
      "target_digest": "sha-256:<contract-digest>",
      "target_workspace_binding": { "mode": "portable" }
    }
  }
}
```

The body MUST NOT contain result references, inline replacements, fallback semantics, authority grants, approval, issuance, runtime grant, activation, or consumer-specific launch settings.

### Bound `ExecutionResult` revision

```json
{
  "protocol": {
    "id": "project-gateway.artifact",
    "version": "1.0",
    "canonicalization": "jcs-rfc8785-v1"
  },
  "kind": { "id": "ExecutionResult", "version": "1.0" },
  "instance_id": "pgw:i:<result-instance>",
  "revision": {
    "id": "pgw:r:<result-revision>",
    "generation": 0,
    "predecessor": null,
    "digest": "sha-256:<result-digest>"
  },
  "workspace_binding": {
    "mode": "bound",
    "workspace_id": "pgw:w:<workspace>"
  },
  "requirements": { "protocol_features": [], "consumer_capabilities": [] },
  "extensions": [],
  "body": {
    "reported_bundle": {
      "target_protocol_version": "1.0",
      "target_kind": { "id": "ExecutionBundle", "version": "1.0" },
      "target_instance_id": "pgw:i:<bundle-instance>",
      "target_revision_id": "pgw:r:<bundle-revision>",
      "target_digest": "sha-256:<bundle-digest>",
      "target_workspace_binding": {
        "mode": "bound",
        "workspace_id": "pgw:w:<workspace>"
      }
    },
    "reported_occurrence_id": "pgw:o:<occurrence>",
    "reported_attempt_id": "pgw:a:<attempt>",
    "<retrospective-observation-only>": "<placeholder>"
  }
}
```

The result envelope contains no evaluator provenance, approval, issuance, publication state, receipt, runtime grant, activation, or trusted lifecycle assertion. Candidate forms have no trusted attempt-to-result-instance ownership. The first evaluator adoption or origination atomically establishes at most one evaluator-produced result instance for the exact workspace, bundle, occurrence, and attempt; every correction remains a successor revision of that same instance. Those facts are separately bound by trusted local records.

## Prohibited Mutable or Lifecycle Fields

The following MUST NOT be included as canonical common-envelope members, in an extension that overrides core rules, or as authoritative annotation semantics:

- mutable aliases, paths, filenames, Git revisions, repository roots, or storage locations as identity or references;
- `status`, `approved`, `issued`, `revoked`, `active`, `activated`, `grant`, `receipt`, or equivalent lifecycle assertions;
- approval, issuance, runtime-grant, activation, publication, evaluator-provenance, or trusted-receipt records;
- global or workspace capability ceilings, trusted workspace registration, or extension registration;
- bundle fallback, hidden semantic merge, or consumer-specific command/launch configuration; and
- any claim that context instructions, result content, producer attribution, or annotations establish authority.

A consumer MUST ignore annotations for all protocol and lifecycle decisions and MUST reject a document that relies on a prohibited field for a required semantic.
