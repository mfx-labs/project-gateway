# ADR-010 — Exact References and Workspace Binding

## Status

Accepted

## Context

WP-1 requires every consumable bundle to select exact compatible revisions and resolve to one compatible trusted workspace, but it defers reference serialization, portability, cross-workspace handling, and approval correlation. Without those rules, a path, alias, or approval from another workspace could substitute authority-relevant content.

## Decision

An exact artifact reference MUST bind target protocol version, kind ID and kind version, instance ID, revision ID, canonical digest, and workspace-binding declaration. Resolvers recompute and compare each value. Paths, filenames, Git revisions, aliases, `latest`, version ranges, queries, partial digests, and fallback targets are not exact references. Provisional draft references are allowed only in unconsumable working content and must become exact references in a new canonical revision.

Workspace binding is mandatory and digest-covered, and it is immutable for the lifetime of an artifact instance. `AuthorityPolicy`, `ContextManifest`, `ExecutionBundle`, and `ExecutionResult` are bound to exactly one opaque trusted workspace ID. `TaskSpec` and `CompletionContract` may be portable or bound. A generation-zero revision chooses the instance binding; every successor and predecessor must have exactly the same portable/bound declaration and, when bound, the same workspace ID. A bundle is always bound and records one proposed execution workspace; it does not establish trusted workspace registration, approval, authority, or activation.

For a bundle workspace, policy and context must be bound to it; a bound task or completion contract must match it; a portable task or completion contract requires compatible workspace-scoped lifecycle and consumer checks. Core cross-workspace references are prohibited. Every execution-use approval and issuance binds one workspace, including for portable task and completion revisions. A portable revision can have separate records for multiple workspaces, but no record is reusable across workspace scope. Changing binding mode or workspace ID requires a new instance and generation-zero revision with no artifact predecessor; a `MigrationRecord` may correlate old/new subjects without creating lineage or transferring lifecycle authority.

## Rationale

Exact digest-pinned references prevent substitution. Binding policy, context, composition, occurrence, and result facts to trusted workspace scope prevents authority or context escape while permitting genuinely portable task and completion content to be reused only through separate workspace-specific authorization.

## Consequences

- Every consumable MVP bundle resolves exactly one trusted workspace.
- Context cannot use a manifest reference to escape the selected workspace, a policy cannot be replayed into another workspace, and a bound instance cannot move workspaces through a later revision.
- Bundle approval/issuance remains separate from approval/issuance of each selected prospective revision.
- Result publication and receipt correlation must match the reported occurrence workspace.
- Unresolved, wrong-kind, wrong-instance, digest-mismatched, alias-based, cross-workspace, or unsupported-required-semantic references fail closed.

## Rejected Alternatives

1. **Path or `latest` reference resolution:** Rejected because mutable selection cannot prove exact content.
2. **Content-only digest reference:** Rejected because it loses redundant protocol, kind, instance, revision, and workspace verification.
3. **All artifacts universally portable:** Rejected because policy, context, bundle, and occurrence facts require a workspace boundary.
4. **All prospective content universally workspace-bound:** Rejected because consumer-neutral task and completion content can be safely portable while use authorization remains workspace-scoped.
5. **Change portable/bound mode or workspace ID through lineage:** Rejected because workspace binding is an artifact-instance invariant; a change requires a new instance rather than a successor revision.
6. **Portable approval without workspace correlation:** Rejected because it permits unauthorized approval replay.
7. **Bundle content establishes trusted workspace state:** Rejected because project-visible content cannot create trusted configuration or authority.
