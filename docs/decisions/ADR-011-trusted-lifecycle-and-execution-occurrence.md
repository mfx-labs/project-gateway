# ADR-011 — Trusted Lifecycle and Execution Occurrence

## Status

Accepted

## Context

WP-0 and WP-1 require trusted local approval, issuance, revocation, grants, activation, receipts, and audit facts, while deferring record structure and execution occurrence/retry semantics. Lifecycle decisions must remain distinct and outside repositories, and retries must not hide a change to bundle, authority, workspace, or execution evidence.

## Decision

The trusted local control plane maintains immutable, append-only records with separate responsibilities: `ValidationRecord`, `ApprovalRecord`, `IssuanceRecord`, `RevocationRecord`, `RuntimeGrant`, `ActivationRecord`, `ExecutionOccurrenceRecord`, `ExecutionAttemptRecord`, `TrustedReceipt`, `SupersessionRecord`, `ExecutionSummaryRecord`, `MigrationRecord`, and `AuthoritativeAuditEvent`.

Validation is an external reproducible assessment; it is not approval. Approval is an exact prospective artifact decision scoped to one workspace and purpose. Issuance is a separate exact-subject availability decision. All four selected prospective artifacts and their bundle require individual matching approval and issuance for activation. Only `ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, and `ResultPublicationRecord` are revocable usability or publication records. `ValidationRecord`, activation/occurrence/attempt records, receipts, summaries, migrations, supersessions, and audit events are immutable historical facts; later correlation may affect current use but never revoke or erase that fact.

A runtime grant is per occurrence and only narrows authority. It is bound to a fresh reserved occurrence ID, exact bundle, workspace, exact registry context, validity, and finite attempt allowance. Every activation decision creates one immutable `ActivationRecord` with `accepted` or `denied` outcome. An accepted decision permanently consumes the reservation and creates exactly one occurrence with that ID. A denied decision creates no occurrence or attempt and permanently closes the reserved ID and grant for activation/execution use. An occurrence can contain ordered attempts. A retry is a later attempt in the same occurrence and may reuse the grant only within its explicit allowance and current validity; a new activation creates a new occurrence and grant.

Trusted receipts separately record lifecycle and execution facts. Point-of-use checks must verify current exact trusted state before issuance, activation, grant use, authority-dependent action, and privileged result consumption.

## Rationale

Separating records keeps validation, authorization, availability, runtime bounds, execution start, observation, and audit facts independently reviewable. Per-occurrence grants and per-attempt records preserve retry evidence without allowing silent replay or widening of authority.

## Consequences

- Artifact content, paths, annotations, and producer assertions cannot create lifecycle state.
- A denied activation creates no occurrence or attempt, closes its reserved occurrence ID and grant permanently, and cannot later become accepted; a started attempt has an attempt record and receipt facts even when execution ends abnormally.
- Issued artifacts remain immutable; later configuration or consumer changes are evaluated at point of use rather than rewriting history.
- Referenced artifact revocation blocks future bundle activation even if historical bundle issuance remains recorded.
- Bundle issuance defaults to one successful activation unless a trusted issuance explicitly grants a finite larger bound.
- A trusted retry summary, if needed, is reporting state only and not a core `ExecutionResult` or completion proof.
- Every validation, approval where registry-governed semantics apply, compatibility decision, issuance, and activation binds exact accepted registry snapshot context; a snapshot label is not sufficient.

## Rejected Alternatives

1. **One repository-resident status field:** Rejected because content cannot establish trusted lifecycle state.
2. **Validation as approval or issuance:** Rejected because conformance and trusted authorization are distinct decisions.
3. **Bundle issuance substituting for selected artifact issuance:** Rejected because composition cannot silently approve or issue its members.
4. **Revoke activation, occurrence, receipt, or audit records as erased facts:** Rejected because historical events remain immutable; only usability/publication records are revocable.
5. **Reuse a denied reservation or grant:** Rejected because a denied activation is terminal for that exact reserved occurrence ID and runtime grant.
6. **One grant reused across unrelated occurrences:** Rejected because it enables execution replay outside the original activation scope.
7. **Retry as an unrecorded continuation or new bundle:** Rejected because it obscures per-attempt evidence and exact execution subject.
8. **Use `ExecutionResult` as a receipt:** Rejected because project-visible observation cannot replace trusted local event facts.
