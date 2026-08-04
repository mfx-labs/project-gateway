# ADR-007 — Artifact Ownership and Consumer Boundary

## Status

Accepted

## Context

Artifact production, validation, lifecycle control, consumption, result reporting, and receipt recording have different trust properties. Treating a producer or validator as an approver, treating a result as a receipt, or placing consumer-specific behavior in core artifacts would weaken the WP-0 trust and consumer boundaries.

The initial consumers are the Pi task adapter, pi-guard authority adapter, and completion evaluator. They require clear roles while remaining able to coexist in different local process topologies.

## Decision

The protocol distinguishes these conceptual roles:

- content producer;
- structural validator;
- semantic validator;
- trusted approver;
- issuer;
- revocation authority;
- runtime-grant authority;
- activation authority;
- downstream consumer;
- result producer;
- trusted receipt producer; and
- reviewer.

A content producer authors untrusted draft content. Producer identity MUST NOT imply approval, issuance, revocation, runtime-grant, activation, or receipt authority. Validation establishes conformance only and MUST NOT grant lifecycle authority.

The trusted local control plane owns approval, issuance, revocation, runtime grants, activation, trusted receipts, and authoritative audit state outside managed repositories. A completion evaluator produces `ExecutionResult` as a retrospective project-visible artifact; the trusted local control plane produces the distinct trusted receipt. ChatGPT Web MAY produce drafts and review results but MUST NOT perform trusted lifecycle roles through the gateway.

Downstream consumers MUST resolve supported exact revisions, verify required trusted state, apply effective authority independently from instructions, and fail closed for unsupported required semantics. Pi-, pi-guard-, and other consumer-specific behavior belongs in adapters or registered extensions, not common core artifact semantics.

One deployed component MAY implement multiple roles, but it MUST NOT accept an assertion made in one role as proof of another role's decision.

## Rationale

Role separation prevents a schema-valid draft from becoming executable, a producer claim from becoming approval, and an evaluator report from becoming a trusted receipt. It also preserves a clear audit path for local authority decisions.

Consumer-neutral artifacts make it possible to add future agents and evaluators without embedding Pi-specific, pi-guard-specific, Codex-specific, Cline-specific, reviewer-specific, or release-specific configuration in common protocol meaning.

## Consequences

- Later protocol and implementation work MUST model role boundaries even when a single local process implements multiple roles.
- Artifact lifecycle facts MUST be verified through trusted local state rather than document paths, filenames, producer identity, or embedded claims.
- The Pi task adapter consumes task and context responsibilities; pi-guard consumes authority; the completion evaluator consumes completion requirements and produces results.
- Consumers MUST NOT silently discard required capabilities or extensions.
- Result and receipt storage, formats, and correlation mechanics remain deferred while their trust distinction is preserved.

## Rejected Alternatives

1. **Producer self-approval:** Rejected because a content author cannot establish trusted lifecycle authority through its own output. ChatGPT self-approval is explicitly prohibited.
2. **Validation equals issuance or activation:** Rejected because conformance and trusted lifecycle decisions are distinct.
3. **`ExecutionResult` as a trusted receipt:** Rejected because a project-visible retrospective report cannot replace external authoritative runtime state.
4. **Consumer-specific core artifacts:** Rejected because agent-specific APIs and configuration would make common semantics unstable and non-portable.
5. **Infer trust from repository location or artifact filename:** Rejected because project-visible storage cannot establish approval, issuance, grant, activation, or receipt state.
