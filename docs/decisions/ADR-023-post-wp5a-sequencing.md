# ADR-023 — Post-WP-5A Work-Package Sequencing

## Status

Accepted

Accepted by the externally granted human approval of the Post-WP-5A
planning package (approval decision date 2026-08-05; planning commit
`97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review:
POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
approval: zero). Acceptance derives from the external human decision, not
from the documentation operator.

## Context

WP-5A is committed and closed. The repository defines no roadmap beyond
WP-5B, and WP-5B's trusted authority inputs (capability vocabulary, trusted
ceiling configuration, workspace identity, approval/activation state,
pi-guard compatibility contract) have no owners or contracts (F-SEQ-1,
F-SEQ-2, F-SEQ-3). WP-0 deferred the concrete capability vocabulary and the
trusted configuration format for global and workspace ceilings, requiring
resolution before affected implementation begins.

## Decision

- Adopt the execution order: **WP-6 → WP-7 → WP-8 → WP-9 → WP-10 → WP-11 →
  WP-12 → WP-5B → WP-13 → WP-14 → WP-15** (details, prerequisites, owned
  contracts, and closure gates in `post-wp5a-roadmap.md`).
- **WP-5B placement: Option C — after WP-6 and after the control-plane
  packages (WP-7…WP-12), before WP-13.** WP-5B must not invent capability
  vocabulary, ceiling semantics, workspace identity, approval state,
  RuntimeGrant semantics, or enforcement-consumer support semantics; each of
  those has an owner in the roadmap (respectively Artifact Core/WP-6, WP-6,
  WP-6, WP-12, WP-2/WP-4, WP-5B contract).
- WP-6 depends only on WP-0…WP-4 and the planning contracts and may be the
  first implementation package after this roadmap is approved; it does not
  depend on WP-5A.
- Numeric work-package identifiers are retained; execution order is
  authoritative and is not numeric (WP-5B executes after WP-12).

## Rationale

Effective authority is the intersection of ceilings, approved policy,
RuntimeGrant, and consumer support. Enforcement (WP-5B) cannot be
implemented or tested against trusted inputs that have no producers: the
ceilings and workspace configuration come from WP-6, and activation
decisions come from the control plane (ADR-002). Placing WP-5B before those
producers would require temporary policy semantics, which is prohibited.

## Consequences

- WP-5B is not eligible for authorization until WP-6 and WP-12 are closed
  (or their input contracts are demonstrated satisfied by earlier packages).
- WP-6 may be proposed as the earliest eligible implementation package once
  this roadmap is approved.
- WP-13 is the first package that composes enforcement with end-to-end
  execution and completion evaluation.

## Rejected Alternatives

1. **WP-5A → WP-5B → WP-6 (Option A):** rejected because WP-5B would lack
   ceiling/workspace-configuration producers and would invent capability
   vocabulary semantics.
2. **WP-5A → WP-6 → WP-5B (Option B):** rejected because activation remains
   a control-plane decision (ADR-002); WP-5B needs the activation-decision
   contract and approval state from the control-plane packages.
