# ADR-025 — Capability Vocabulary and Versioning

## Status

Proposed — planning draft; not approved.

## Context

The authority model intersects global ceiling, workspace ceiling, approved
`AuthorityPolicy`, `RuntimeGrant`, and consumer support, but no concrete
capability vocabulary exists; WP-0 deferred it. Numeric action ceilings
exist in WP-4 but cannot express capability-level authority.

## Decision

- Adopt the consumer-neutral v1 capability vocabulary in
  `capability-vocabulary.md` (canonical `project-gateway.<class>` IDs for
  read, inspection, Git inspection, drafting, controlled writing, file
  edit/create/delete/move, shell execution, Git mutation, external network,
  local service, tool-inventory observation, Pi model/tool execution,
  approval operations, lifecycle issuance).
- Capabilities are versioned (`<id>` + version); operands declare intended
  versions; version mismatch fails closed (never auto-upgrade).
- Unknown capabilities are denied; unknown or unsupported **required**
  capabilities fail closed with a stable finding.
- Deny wins; each operand is a set and effective authority is the
  intersection; no operand widens another.
- No aliases in v1. Sets are compared/fingerprinted in sorted, deduplicated
  canonical form.
- **Numeric action ceilings remain orthogonal action-count limits**: a
  numeric ceiling never permits a capability absent from the capability
  sets, and capability presence never bypasses a numeric limit.
- The vocabulary is owned by Artifact Core protocol (reviewed core
  changes); pi-guard mapping tables are adapter-owned (WP-5B) and never
  alter the vocabulary.

## Rationale

A single canonical vocabulary lets ceilings, policies, grants, consumer
declarations, and enforcement reference the same capability identities
without per-adapter invention, while numeric ceilings keep their exact
documented role as action-count limits.

## Consequences

- WP-6 ceiling configuration references vocabulary IDs (ADR-024).
- WP-6 owns the reviewed Artifact Core evaluator extension that binds and
  checks vocabulary versions (F-01, Model A; ADR-024): version mismatch
  fails closed before any intersection result is trusted.
- WP-5B maps vocabulary IDs to pi-guard tool profiles; unmappable required
  capabilities fail closed (ADR-026).
- `ConsumerSupportDeclaration` continues to declare supported capabilities
  using vocabulary IDs.

## Rejected Alternatives

1. **Capability-less numeric ceilings only:** rejected — cannot express
  which capabilities are permitted, forcing enforcement to invent
  semantics.
2. **Per-adapter capability vocabularies:** rejected — breaks the
  intersection model and consumer neutrality.
