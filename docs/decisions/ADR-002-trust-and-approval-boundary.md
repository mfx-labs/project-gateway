# ADR-002 — Trust and Approval Boundary

## Status

Accepted

## Context

ChatGPT-generated content, prompts, repository files, artifact drafts, and execution-result documents can be useful inputs but are not trustworthy sources of local authority. Schema validity or semantic validity alone does not prove that a human or trusted local authority accepted a proposed artifact for use.

The system needs a lifecycle that prevents an artifact producer from approving or activating its own work, and it needs durable evidence that an approval applies to the exact content later consumed by an adapter.

## Decision

Project Gateway MCP separates untrusted artifact production from trusted local lifecycle control.

The trust zones are:

- **Remote producer zone:** ChatGPT Web, its requests, generated content, and draft proposals are untrusted inputs.
- **Project-content zone:** repository content and project-visible artifact documents are untrusted, reviewable data.
- **Gateway enforcement zone:** the locally installed gateway enforces trusted workspace configuration while treating incoming and repository-derived material as untrusted.
- **Trusted local control-plane zone:** local components maintain authoritative approval, issuance, revocation, runtime-grant, activation, receipt, and audit state outside managed repositories.
- **Downstream consumer zone:** adapters and evaluators consume only what their effective authority and supported capabilities permit.

ChatGPT Web MAY create validated artifact drafts. A trusted local control plane MUST approve, issue, revoke, grant, and activate artifacts or executions. ChatGPT Web MUST NOT approve its own artifacts, issue artifacts, grant permissions, revoke artifacts, or activate execution.

An approval MUST bind to the canonical digest of a specific artifact revision. If content changes such that its canonical digest changes, the new revision MUST NOT inherit approval implicitly. Approval is distinct from issuance, and issuance is distinct from runtime activation. A repository filename, path, embedded status, or artifact assertion MUST NOT be accepted as proof of any of those lifecycle states.

Approvals, issued-state records, revocations, runtime grants, execution receipts, activation state, and authoritative audit records MUST remain outside the repository. Project-visible artifact documents MAY be retained for review, but their content is not authoritative runtime state.

## Rationale

Digest binding prevents a review or approval of one revision from being applied to materially different content. Separate approval, issuance, and activation decisions support local control at each escalation point and make revocation meaningful.

Keeping authoritative state outside repositories prevents repository writes, branch changes, generated text, and prompt injection from granting authority. It also preserves the distinction between a structured report of execution and a trusted local receipt of lifecycle events.

## Consequences

- Validation can establish conformance only; it cannot grant authority or make a draft executable.
- Consumers MUST consult trusted local lifecycle state and fail closed if required approval, issuance, revocation, grant, or capability information cannot be established.
- A project-visible `ExecutionResult` does not replace a trusted local execution receipt.
- The control plane requires local persistence and an approval workflow independent of repository content.
- Approval mechanisms, canonicalization details, record formats, storage technology, and signing mechanisms remain for later work packages; their design MUST preserve this boundary.

## Rejected Alternatives

1. **Treat schema-valid artifacts as approved:** Rejected because validation does not express a trusted authorization decision.
2. **Allow ChatGPT to self-approve or self-issue its drafts:** Rejected because producer and approver would be the same untrusted authority path.
3. **Store approval and grant records inside the repository:** Rejected because repository content can be changed, replayed, or influenced without becoming trusted local control-plane state.
4. **Bind approval to an artifact name or path:** Rejected because a path does not identify immutable content and can be reused for a changed revision.
5. **Combine approval, issuance, and activation into one artifact flag:** Rejected because it erases distinct local control decisions and makes revocation and runtime constraints ambiguous.
