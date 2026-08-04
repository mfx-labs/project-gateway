# ADR-024 — Trusted Workspace and Ceiling Configuration Ownership

## Status

Proposed — planning draft; not approved.

## Context

WP-0 established that a trusted local administrator configures workspaces
and their capability ceilings outside the repository's authority, and
deferred the concrete capability vocabulary and the trusted configuration
format for global and workspace ceilings until before affected
implementation. No work package owned this configuration (F-SEQ-1).

## Decision

- **WP-6 (trusted workspace and policy configuration core) owns** the
  trusted configuration boundary defined in
  `trusted-workspace-and-ceiling-configuration.md`: global capability
  ceiling, workspace capability ceilings, workspace identifier registry,
  workspace roots, root containment, configuration loading, versioning, and
  fail-closed malformed/unknown handling.
- **WP-6 also owns the trusted extension set (F-F2):** the versioned
  `trustedExtensionSet` configuration element (permitted extension/package
  identities; expected effective source identity for security-relevant
  tools; built-in and web-access tool treatment; scope handling; missing/
  malformed/unexpected-source behavior; versioning; provenance; fail-closed
  loading; repository influence prohibition) is part of Trusted Workspace
  Configuration, with WP-6 owning its contract, validation, identity,
  provenance, canonicalization, fail-closed loading, and trusted update
  boundary. Membership never grants a capability; WP-5B validates the
  observable effective Pi surface against this configuration; WP-15 owns
  only optional future hardening and is not a second configuration owner.
- **WP-6 also owns the capability-ceiling evaluator integration (F-01,
  Model A):** a narrowly scoped, reviewed extension of the Artifact Core
  point-of-use boundary introducing optional `globalCapabilityCeiling` /
  `workspaceCapabilityCeiling` inputs on `PointOfUseInputs` /
  `EffectiveAuthorityInputs`, capability-vocabulary version binding,
  capability-version compatibility checks (mismatch fails closed),
  deterministic capability-set canonicalization, intersection rules,
  fail-closed findings, and conformance fixtures/AUT-* rules/vectors.
  Artifact Core remains the only authoritative effective-authority
  evaluator; WP-5B consumes the validated `EligibilityReport` and never
  recomputes the intersection.
- **Evaluator interface version (F-R6):** the capability-aware point-of-use
  evaluator interface is named **`PointOfUseInputs v2`**. The existing
  numeric-only shape is the **legacy compatibility shape** (`PointOfUseInputs
  v1`). `PointOfUseInputs v2` includes `globalCapabilityCeiling`,
  `workspaceCapabilityCeiling`, `capabilityVocabularyVersion`, the
  requested-use capability version, and exact capability-set identities.
  Rules: (1) the numeric-only shape is the legacy compatibility shape; (2)
  the v2 shape includes the capability-aware fields; (3) production
  evaluations using a trusted workspace configuration that contains
  capability ceilings must supply those ceilings to every point-of-use
  evaluation; (4) omission of a configured ceiling is a fail-closed
  input-correlation error; (5) a caller may use the v1 compatibility shape
  only when it is an explicitly identified legacy/test compatibility path,
  no capability ceiling is configured, no required capability-aware
  semantics are present, and the consumer explicitly declares support for
  the compatibility shape; (6) a legacy consumer must not silently accept a
  capability-aware input it cannot evaluate; (7) mixed evaluator-interface
  versions fail closed unless a reviewed conversion rule exists; (8)
  canonical evaluation-input identities include the evaluator-interface
  version; (9) v1 and v2 evaluation inputs cannot share the same canonical
  identity; (10) WP-6 owns implementation and conformance migration; (11)
  Artifact Core remains long-term owner of evaluation semantics; (12) WP-4
  remains the committed numeric-only baseline. "Backward compatible" is
  used only under these constraints.
- **Trusted configuration is external to repository-controlled content.**
  Repository files cannot grant, widen, or alter authority; the configuration
  store is trusted-local (WP-8 persistence) and written only by explicit
  trusted local operations of the control plane.
- Workspace IDs exposed to consumers remain opaque identifiers; filesystem
  roots are trusted-local configuration and are never exposed as authority
  inputs.
- Global and workspace ceilings narrow authority only; they are operands of
  the intersection rule and never widen any other operand.
- Missing, malformed, or unknown configuration denies affected actions
  (default deny).
- The WP-4 numeric action ceilings (`globalActionCeiling`,
  `workspaceActionCeiling`) remain the validated numeric-action operand with
  the complete numeric semantics of F-07 (non-negative safe integers; zero
  denies; missing means no additional quantitative restriction, never
  permission; malformed/overflowed values fail closed at config load;
  intersection uses the minimum applicable finite ceiling; no wraparound;
  no Infinity sentinel); capability-level ceilings are the capability-set
  operand defined by ADR-025.

## Rationale

A single owner for the configuration boundary prevents repository content,
artifact documents, or consumers from becoming configuration sources, and
gives WP-5B a defined producer for two intersection operands instead of
temporary semantics.

## Consequences

- WP-6 becomes a normative prerequisite of WP-5B (see ADR-023).
- No component other than the control plane may mutate the configuration
  store.
- Path containment rules (symlinks, traversal, normalization, root escape)
  are part of the WP-6 contract and must fail closed.

## Rejected Alternatives

1. **Configuration inside the repository:** rejected (ADR-002; repository
   content is changeable and not trusted governance).
2. **WP-5B loading configuration directly:** rejected (would bypass the
   trusted-local boundary and couple enforcement to an undefined format).
