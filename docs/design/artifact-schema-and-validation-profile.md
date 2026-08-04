# Project Gateway MCP — Artifact Schema and Validation Profile

**Status:** Normative WP-3 conformance profile
**Applies to:** Schema selection, structural validation, semantic validation, conformance fixtures, and future Artifact Core work

## Scope

This profile turns the approved WP-0 through WP-2 protocol into an implementation-independent version-1 conformance package. It defines the schema packaging, resource identities, field contracts, bounds, and validation boundary used by `schemas/` and `fixtures/`.

It does **not** authorize an Artifact Core implementation, canonicalizer, hasher, database, lifecycle store, registry service, MCP tool, adapter, evaluator, CLI, package dependency, or build configuration. The schemas are normative protocol resources; a future implementation must conform to them and to the semantic catalog rather than treating them as a runtime design.

## Authoritative Inputs

This profile is constrained by all accepted WP-0 through WP-2 records, including:

- WP-0: `docs/design/project-gateway-scope-and-principles.md`, `docs/design/glossary.md`, and ADR-001 through ADR-004.
- WP-1: `docs/design/artifact-domain-model.md`, `docs/design/artifact-responsibility-matrix.md`, `docs/design/wp-1-open-decisions.md`, and ADR-005 through ADR-007.
- WP-2: `docs/design/artifact-identity-versioning-reference-lifecycle-protocol.md`, `docs/design/artifact-envelope-reference-profile.md`, `docs/design/trusted-lifecycle-protocol.md`, `docs/design/wp-2-decision-resolution.md`, `docs/design/wp-2-open-decisions.md`, and ADR-008 through ADR-013.

If a schema appears less expressive than an accepted protocol rule, the protocol rule controls. The unrepresentable portion is listed in `docs/design/semantic-validation-rules.md`; it is not weakened or omitted.

## JSON Schema Dialect and Resource Identity

All schema resources use JSON Schema Draft 2020-12 and declare exactly:

```json
"$schema": "https://json-schema.org/draft/2020-12/schema"
```

The normative schema-ID scheme is:

```text
urn:project-gateway:schema:<profile>:<contract-version>:<resource>
```

For example, the common artifact envelope is `urn:project-gateway:schema:artifact:1.0:common:artifact-envelope`. `<profile>` is one of `artifact`, `registry`, `lifecycle`, or `catalog`; `<contract-version>` is `1.0`; and `<resource>` is a stable colon-separated resource name. A schema `$id` is only a schema resource identity. It is never an artifact instance/revision, registry snapshot, lifecycle record, approval, authority grant, or exact artifact reference.

`schemas/catalog.json` is the authoritative offline index. It lists each resource `$id`, local path, profile, version, subject type, dependency `$id`s, and normative status. Every external `$ref` inside a schema resource is an absolute schema URN equal to the target resource’s exact `$id` (optionally with a local `#/...` fragment). Fragment-only references such as `#/$defs/example` are permitted only within the same resource. Catalog paths are packaging locations only and never become schema identity; no custom relative-file resolver, repository path, or network retrieval is part of the protocol. A standard Draft 2020-12 validator supplied with the catalog’s `$id`-to-resource registry resolves every external reference, and moving the schema package to another directory does not change resolution. The Draft 2020-12 meta-schema URI is a dialect declaration, not a runtime `$ref`; schema validation must not retrieve schemas from a network.

Catalog dependency lists are exact and reproducible: for each schema resource, `dependencies` is the sorted, unique set of direct external schema-resource `$ref` base URNs used by that resource. A direct external `$ref` is any `$ref` whose target resource differs from the current resource; fragment-only references such as `#/$defs/example` are not dependencies, fragments are removed from external targets, transitive references are excluded unless directly referenced, and the current resource itself is never listed. Catalog dependencies are schema-resource identities, never filesystem paths.

## Packaging and Inventory

```text
schemas/
  catalog.json
  artifact/1.0/common/
  artifact/1.0/kinds/
  registry/1.0/
  lifecycle/1.0/common/
  lifecycle/1.0/records/
```

The initial catalog contains 51 normative schema resources, plus the catalog itself:

| Profile | Resources | Purpose |
| --- | ---: | --- |
| Artifact common | 15 | Identifiers plus explicit artifact-instance-ID, digest-string, and UTC-timestamp resources; protocol/kind descriptors, revision, binding, exact reference, requirements, registered requirements, extension declaration, annotations, evidence reference, and complete envelope |
| Artifact kinds | 12 | Six closed body contracts and six complete envelope-plus-body kind schemas |
| Registry | 9 | Snapshot/reference, namespace and contract entries, feature/capability registration, compatibility, governance, deprecation, and supersession |
| Lifecycle | 15 | Closed common components plus 14 distinct trusted record schemas |

A schema resource has a passing and a failing manifest-driven coverage fixture. Complete kind schemas are consumable top-level schemas; body schemas are reusable closed components and never authorize a generic body.

## Common Artifact Envelope

The complete common envelope schema requires exactly these top-level members:

- `protocol`;
- `kind`;
- `instance_id`;
- `revision`;
- `workspace_binding`;
- `requirements`;
- `extensions`;
- `body`; and
- optional `annotations`.

It uses kind discrimination to bind one closed body schema and the appropriate workspace-binding form to each of the six core kinds. `unevaluatedProperties: false` rejects every unknown top-level member. There is no `status`, generic metadata, lifecycle, approval, issuance, grant, receipt, activation, path, Git, fallback, or launch-settings escape hatch.

The supported opaque serialized identifiers are deliberately disjoint:

| Subject | Pattern |
| --- | --- |
| Artifact instance | `pgw:i:` plus 32 lowercase hexadecimal characters |
| Artifact revision | `pgw:r:` plus 32 lowercase hexadecimal characters |
| Workspace | `pgw:w:` plus 32 lowercase hexadecimal characters |
| Registry snapshot | `pgw:g:` plus 32 lowercase hexadecimal characters |
| Lifecycle record | `pgw:l:` plus 32 lowercase hexadecimal characters |
| Occurrence | `pgw:o:` plus 32 lowercase hexadecimal characters |
| Attempt | `pgw:a:` plus 32 lowercase hexadecimal characters |
| Registered bounded selector | `pgw:s:` plus 32 lowercase hexadecimal characters |
| External evidence descriptor | `pgw:e:` plus 32 lowercase hexadecimal characters |
| Evaluator / capability profile | `pgw:ev:` / `pgw:cp:` plus 32 lowercase hexadecimal characters |

Activation, receipt, and result-publication identities are not separately serialized namespaces: their `pgw:l:` trusted record IDs are their identities. This decision is recorded by ADR-014. No identifier encodes a path, producer, authority, timestamp, workspace semantics, or lifecycle status.

## Artifact-Body Contracts

All body schemas are closed, bounded, and consumer-neutral.

| Kind | Field-level model and boundary |
| --- | --- |
| `TaskSpec` | Objective; direct `instructions`; local expected-deliverable IDs; non-authoritative outcome constraints; project-data citations. Instructions are the only free-form task text and remain task intent only. No authority, command-permission, lifecycle, result, or context-delegation field exists. |
| `AuthorityPolicy` | Ordered, identified allow/deny rules; a registered capability ID/version; a closed resource-class scope; closed narrowing constraints; registered required semantics. It has no task text, command, trusted ceiling, grant, or lifecycle member. Unknown operation approval is semantic fail-closed. |
| `ContextManifest` | Explicit `none` or bounded item selection; each item has identity, required/optional status, priority, project-data purpose, integrity expectation, and a registered bounded selector. No path glob, filesystem root, shell, instruction, authority, fallback query, or read-policy bypass is representable. |
| `CompletionContract` | Identified prospective checks, registered check types, expected deliverable relationships, required evidence kinds, acceptance conditions, and required/optional evaluation status. It has no observed outcome, command authorization, implementation instruction, activation, or receipt field. |
| `ExecutionBundle` | Exactly four and only four named exact references: `task`, `authority_policy`, `context_manifest`, and `completion_contract`. Target kinds are structurally constrained. Inline replacements, result references, extra dependency fields, activation, grant, fallback, or launch settings are rejected. |
| `ExecutionResult` | Exact reported bundle reference, occurrence and attempt IDs, disposition, bounded observations, changed-resource observations, check observations, violations, produced-artifact references, and typed evidence references. It is bound-only and cannot represent approval, issuance, provenance as trusted fact, publication, receipt, grant, or prospective rewrite. |

`TaskSpec` and `CompletionContract` may use either explicit binding form. `AuthorityPolicy`, `ContextManifest`, `ExecutionBundle`, and `ExecutionResult` are structurally bound-only. Binding continuity across revisions, actual workspace registration, exact target resolution, and lifecycle scope remain semantic/trusted checks.

## Typed Evidence and Extension Boundaries

`evidence-reference.json` explicitly separates four trust classes:

1. exact artifact reference;
2. trusted receipt reference by trusted record ID;
3. workspace resource observation with opaque resource ID, workspace, digest, and role; and
4. external evidence descriptor with opaque evidence ID, digest, media type, and observation role.

There is no generic URI field. A project-visible reference to a receipt does not turn result content into a receipt; receipt verification remains a trusted lifecycle check.

The V1 package deliberately supports two registry-governed, ignore-safe, optional test extensions: `project-gateway.conformance-tag` version `1.0` and `example.review-evidence` version `1.0`. Both payloads are closed and fixture-only. They exercise registered payload discrimination and canonical extension ordering without permitting arbitrary extension objects. A different registry contract requires a cataloged schema resource and reviewed protocol evolution; a producer cannot use a generic payload to self-register semantics.

## Registry and Lifecycle Schemas

`RegistrySnapshot` is a separate closed schema, not an artifact envelope or seventh aggregate. It has a `pgw:g:` ID, exact format/version and artifact compatibility declaration, governed namespace entries, feature/capability registrations, immutable governance/security-review declaration, and derived `snapshot_digest`. Its canonical projection omits only that derived digest. Snapshot labels, paths, tags, and annotations are not identity fields.

The lifecycle profile contains separate closed schemas for:

- `ValidationRecord`;
- `ApprovalRecord`;
- `IssuanceRecord`;
- `RevocationRecord`;
- `RuntimeGrant`;
- `ActivationRecord`;
- `ExecutionOccurrenceRecord`;
- `ExecutionAttemptRecord`;
- `TrustedReceipt`;
- `ResultPublicationRecord`;
- `SupersessionRecord`;
- `ExecutionSummaryRecord`;
- `MigrationRecord`; and
- `AuthoritativeAuditEvent`.

Every record requires a `pgw:l:` record ID, trusted UTC timestamp, responsible-role discriminator, and exact `RegistrySnapshotReference`. Each has only its own responsibility fields. In particular, `RevocationRecord.target.record_type` is an exact enum limited to approval, issuance, runtime-grant, and result-publication records. `ActivationRecord` has an accepted/denied discriminator and no occurrence field; a separate occurrence record is required for a successful activation. `ResultPublicationRecord` carries the unique result subject, evaluator profile, validation, bundle/workspace/occurrence/attempt correlation, scopes, and receipt correlations without becoming a receipt.

## Structural/Semantic Boundary

Schema validation enforces JSON shapes, required fields, closed discriminators, identifier syntax, bounds, enums, safe integer range, local binding shape, and local prohibition of escape hatches. It does not grant authority.

The following are necessarily semantic or trusted checks: duplicate-member intake before parser construction; NFC/unpaired-surrogate validation; JCS preconditions and ordering; digest recomputation; registration and global uniqueness; predecessor target resolution; branch/no-merge continuity; reference resolution; trusted workspace registration; registry acceptance/compatibility; support declarations; lifecycle state, revocation, atomic reservation, occurrence cardinality, evaluator provenance, result-instance uniqueness, and point-of-use eligibility. They are normatively cataloged in `docs/design/semantic-validation-rules.md`.

## Resource Bounds

The structural profile fixes conservative V1 protocol bounds:

| Subject | Bound |
| --- | ---: |
| Raw artifact input | 1 MiB UTF-8 bytes |
| Raw registry input | 512 KiB UTF-8 bytes |
| Raw lifecycle input | 256 KiB UTF-8 bytes |
| JSON nesting | 32 levels |
| Digest-covered string | 16,384 Unicode scalar values |
| Extensions | 32 per artifact |
| Protocol/capability requirements | 32 per array |
| Policy rules | 64 |
| Context items | 128 |
| Completion checks | 128 |
| Result outputs/changed resources/evidence | 256 each |
| Lifecycle correlations | 64 |
| Runtime attempts | 64 |

Field-level maxima in the schemas narrow these general limits. JSON numbers are only accepted in the safe integer interval `-9007199254740991` through `9007199254740991`; semantic decimals and byte values must use a registered string contract. All set-like arrays are unique structurally and must be canonical-order checked semantically. Altering a bound in a way that changes accepted content follows the WP-2 major/minor classification.

## Evolution, Compatibility, and Security

A schema filename is packaging only; its `$id` and declared `1.0` contract are normative. A change that changes accepted/invalid interpretation is protocol evolution and must follow the WP-2 major/minor rules. An approved released V1 schema is immutable. A future change requires a reviewed new schema/contract resource, catalog update, fixtures, and compatibility or migration documentation.

Security rules include closed contracts, no remote runtime schema resolution, no `format` dependence for security decisions, patterns and bounds for identifiers/timestamps/digests, typed evidence, no arbitrary `body`, `scope`, metadata, command, filesystem-root, lifecycle subject, or fallback structure, and fail-closed handling for unknown required semantics. Annotations are constrained noncanonical presentation data only and must not influence identity, lineage, authority, compatibility, lifecycle, evaluator provenance, receipt correlation, or consumer support.

## Completion and Artifact Core Handoff

WP-3 is ready for review when the catalog, schemas, structural profile, semantic catalog, fixture profile, vectors, and manifest agree; every resource has schema coverage; every accepted WP-2 invariant has rule coverage; and no implementation has been added.

A future Artifact Core must load schemas offline through the catalog, implement the ordered validation phases exactly, use the conformance manifest as its test oracle, preserve trusted-state separation, and add no producer-controlled semantic fallback. That future work remains separately authorized.
