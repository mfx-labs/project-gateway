# ADR-014 — JSON Schema Dialect and Packaging

## Status

Accepted

## Context

WP-2 defines normative artifact, registry, and lifecycle protocol shapes but deliberately defers schemas. WP-3 needs machine-verifiable structural contracts without making repository paths, remote URLs, or producer-selected schemas part of protocol identity or authority.

## Decision

Project Gateway schema resources use JSON Schema Draft 2020-12. Every resource declares the Draft 2020-12 `$schema` URI and a stable URN `$id` using:

```text
urn:project-gateway:schema:<profile>:<contract-version>:<resource>
```

`schemas/catalog.json` is the normative offline catalog. Each entry records the exact schema `$id`, the local packaging path, profile, version, subject type, and the exact direct schema-resource dependencies. Catalog dependency lists are derivable from the schema documents: for each resource they are the sorted, unique set of direct external `$ref` base URNs (fragments removed, transitive references excluded, the resource itself never listed). Every external `$ref` in a schema resource is an absolute schema URN equal to the target resource’s exact `$id` (optionally with a local fragment); fragment-only references are allowed only within the current resource. A standard Draft 2020-12 validator supplied with the catalog’s `$id`-to-resource registry resolves every external reference under standard URI resolution. Catalog paths are packaging locations only and never become schema identity; no custom relative-file resolver, repository path dependence, or remote schema retrieval is part of the protocol.

All complete artifact, registry, and lifecycle contracts are closed with `unevaluatedProperties: false` or equivalent closed local components. Unknown members, generic bodies, generic scope, arbitrary metadata, generic lifecycle subjects, arbitrary extension payloads, fallback fields, and producer-selected discriminators are prohibited. The V1 registry profile admits only cataloged registered payload shapes.

Schema IDs are protocol resource identifiers only. They are not artifact IDs, revision IDs, registry snapshot IDs, lifecycle record IDs, approvals, grants, or exact references.

The selected serialized opaque prefixes are `pgw:i:`, `pgw:r:`, `pgw:w:`, `pgw:g:`, `pgw:l:`, `pgw:o:`, and `pgw:a:` plus bounded selector/evidence/evaluator/governance prefixes documented in the schema profile. Activation, receipt, and result-publication identity is the applicable `pgw:l:` lifecycle record ID; no separate serialized activation, receipt, or publication namespace is introduced.

## Rationale

Draft 2020-12 supplies stable composition and closure semantics. URNs avoid accidental dependence on unpublished HTTP locations or repository location. An offline catalog prevents a producer, repository, network response, or `$schema` assertion from substituting semantics. Closed contracts keep authority/lifecycle-sensitive fields from escaping into arbitrary JSON.

## Consequences

- Future validators must load schemas offline through the catalog and resolve external `$ref` values as absolute cataloged schema URNs.
- A cataloged schema resource has a stable identity independent of filename/package layout.
- Every complete kind and trusted record has a closed structural contract and conformance coverage.
- New extension payload semantics require a governed schema contract and catalog update; generic payload fallback is unavailable.
- Schema changes that alter valid/invalid interpretation follow WP-2 major/minor evolution and cannot modify an approved released schema in place.

## Rejected Alternatives

1. **Remote HTTP schema IDs and runtime retrieval:** Rejected because network availability or a remote response must not choose protocol semantics.
2. **Repository-relative IDs as normative identity:** Rejected because storage location is not stable protocol identity.
3. **Open JSON objects for future flexibility:** Rejected because they permit hidden authority/lifecycle semantics and ambiguous interpretation.
4. **Producer-selected `$schema` or extension payload schema:** Rejected because untrusted content cannot register semantics.
5. **Separate activation/receipt/publication identifier prefixes without a protocol need:** Rejected because the immutable lifecycle record identity already provides distinct trusted identity.
