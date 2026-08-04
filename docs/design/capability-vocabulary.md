# Capability Vocabulary (Planning Draft)

**Status:** Planning draft — not approved. Resolves the capability-vocabulary
portion of F-SEQ-1. Normative decision: ADR-025. Cross-references:
`trusted-workspace-and-ceiling-configuration.md`, `post-wp5a-roadmap.md`,
`pi-guard-compatibility-and-authority-projection.md`, ADR-003, ADR-004.

## Purpose

One consumer-neutral capability vocabulary shared by the global ceiling, the
workspace ceiling, `AuthorityPolicy`, `RuntimeGrant` narrowing constraints,
consumer-support declarations, and (via a pi-guard adapter mapping) pi-guard
enforcement. The vocabulary is the authority-model layer; it carries no
Pi-specific or tool-specific semantics. A later pi-guard adapter maps
capabilities to guard-mode tool profiles without changing the vocabulary.

## Canonical Capability Identifiers

Identifiers use the established `project-gateway.<class>` convention
(compare the fixture vocabulary `project-gateway.workspace-read`,
`project-gateway.conformance-*`). Versioning is per-capability
(`project-gateway.file-edit` v1). The v1 vocabulary:

| ID | Semantics | Notes |
|---|---|---|
| `project-gateway.workspace-read` | Read workspace content within the configured root | Existing fixture capability |
| `project-gateway.project-inspect` | Project-level inspection (structure, metadata) | Read-only |
| `project-gateway.git-inspect` | Bounded read-only Git inspection | Mirrors pi-guard `git_inspect` semantics |
| `project-gateway.artifact-draft` | Project-local structured artifact drafting (proposals only) | Never approval/issuance |
| `project-gateway.controlled-write` | Controlled structured artifact writing within root | WP-11 scope; never lifecycle authority |
| `project-gateway.file-edit` | Edit existing files within root | Denied when only read capabilities allowed |
| `project-gateway.file-create` | Create new files within root | |
| `project-gateway.file-delete` | Delete files within root | Highest-risk file capability; default denied |
| `project-gateway.file-move` | Rename/move within root | |
| `project-gateway.shell-execute` | Shell command execution | Default denied; never implied by read/write sets |
| `project-gateway.git-mutate` | Git mutation (commit/stage/push etc.) | Default denied |
| `project-gateway.network-external` | External network access | Default denied |
| `project-gateway.service-local` | Local service access | Default denied |
| `project-gateway.tool-inventory-inspect` | Observe the active tool inventory | Observation only; never permission |
| `project-gateway.pi-model-execute` | Pi model execution | WP-13 scope |
| `project-gateway.pi-tool-execute` | Pi tool execution | Enforcement subject of WP-5B |
| `project-gateway.approval-operate` | Perform approval operations | Control plane only; never granted to artifacts |
| `project-gateway.lifecycle-issue` | Issue lifecycle records (validation/approval/issuance/grant/activation) | Control plane only |

Classification: `operation-class` (read/write/execute/observe/govern) and
`resource-class` scope (existing scope types: resource-class scope,
exact-resource scope, workspace scope) apply to each capability when
evaluated. Capabilities never encode paths; paths are scoped separately by
workspace-root containment.

## Numeric Action Ceilings

Numeric action ceilings (`globalActionCeiling`, `workspaceActionCeiling`,
grant `max-actions`) remain **orthogonal limits on action counts**, not a
substitute for the capability vocabulary. Effective authority for an action
requires (a) the capability present in every intersecting operand, and
(b) the action count within every applicable numeric limit. A numeric
ceiling alone never permits a capability that is absent from the capability
sets. Exact numeric semantics (domain, zero, missing, overflow, malformed,
canonical form, intersection) are defined in
`trusted-workspace-and-ceiling-configuration.md` (F-07).

## Evaluator Integration (F-01)

Capability-set ceilings require a reviewed Artifact Core point-of-use
boundary extension (the **`PointOfUseInputs v2`** interface, F-R6:
optional capability-ceiling inputs on `PointOfUseInputs`/
`EffectiveAuthorityInputs`, vocabulary-version binding, canonicalization,
intersection, fail-closed findings, fixtures, vectors; the numeric-only
shape is the `v1` legacy compatibility shape with explicit mixed-version
fail-closed rules per ADR-024).
Ownership and version-migration model: **WP-6 under Model A** — an
additive, versioned interface extension — as specified in
`post-wp5a-roadmap.md` and
`trusted-workspace-and-ceiling-configuration.md`. The vocabulary itself is
not changed by the extension.

## Required Semantics

1. **Canonical identifiers:** the table above is canonical for v1; every
   operand references capabilities by canonical ID + version.
2. **Required versus optional capabilities:** a capability may be declared
   `required` (must be supported by the enforcement consumer) or `optional`
   (may be unsupported). Required-but-unsupported fails closed.
3. **Unknown capability behavior:** unknown IDs are denied and, when
   required, produce an unsupported-required-capability failure.
4. **Deny precedence:** an explicit deny at any operand wins over allows
   (deny wins); absent capability at any operand denies.
5. **Subset/intersection behavior:** each operand is a set; effective
   authority is the intersection. An operand never adds capabilities absent
   from another operand.
6. **Aliases:** none in v1; aliases, if ever introduced, require a vocabulary
   version change and explicit mapping rules.
7. **Versioning:** capabilities are versioned (`<id>` v1); operands declare
   the version they intend; mismatched versions fail closed (never
   auto-upgrade).
8. **Compatibility rules:** a consumer-support declaration lists supported
   capability IDs; requesting a capability the consumer does not declare
   fails closed. Enforcement consumers (pi-guard) that cannot map a required
   capability to a guard profile fail closed.
9. **Unsupported required capability handling:** always fail closed with a
   stable finding; never silently downgrade.
10. **Consumer declaration behavior:** `ConsumerSupportDeclaration`
    continues to declare supported capabilities; the vocabulary is the
    canonical ID source for those declarations.
11. **Deterministic canonicalization:** capability sets are compared and
    fingerprinted in sorted, deduplicated canonical form (matching the
    established deterministic-ordering principle).

## Vocabulary Ownership and Maintenance

Owned by Artifact Core protocol (maintained through reviewed core changes);
the v1 table is proposed here for human review. pi-guard mapping tables are
adapter-owned (WP-5B) and never alter the vocabulary itself.
