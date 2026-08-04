# ADR-026 — pi-guard Compatibility Lane and Authority-Projection Boundary

## Status

Accepted

Accepted by the externally granted human approval of the Post-WP-5A
planning package (approval decision date 2026-08-05; planning commit
`97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review:
POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
approval: zero). Acceptance derives from the external human decision, not
from the documentation operator.

## Context

WP-5A reserved tool inventory and authority projection for WP-5B, and
WP-0 requires explicit authorization before pi-guard modifications. No
repository-owned compatibility contract, version lane, projection
interface, or enforcement-evidence contract exists (F-SEQ-2). The external
pi-guard 0.1.1 source was inspected read-only (see
`pi-guard-compatibility-and-authority-projection.md` Part A): it provides
mode profiles (OFF/INSPECT/EDIT/WRITE), verified restoration, and trusted-
project config, but **no external authority-projection input API**.

## Decision

- **Compatibility lane:** package identity `pi-guard`; the **only verified
  initial lane is exactly `pi-guard 0.1.1`** (F-03). No evidence covers any
  other `0.1.x` version; semantic-version range membership is insufficient;
  unverified versions fail closed; supporting another version requires a
  reviewed compatibility record or ADR update. The exact 0.1.1 compatibility
  predicate (identity, manifest version, extension identity, required
  exports, mode set, activation entry, restoration, config contract,
  reserved tool identities, failure/rollback semantics, compatibility
  fingerprint) is defined in `pi-guard-compatibility-and-authority-projection.md`
  Part B. Discovery is environment-gated, read-only, non-networked,
  non-mutating, deterministic, and fails closed; no machine-specific path
  enters the production contract.
- **Trust boundary:** pi-guard is an enforcement consumer, never an
  authority issuer; it never creates or widens authority.
- **Authority-projection input is a required future pi-guard-side
  interface** (a documented public mechanism to apply a plan-derived
  enforcement configuration with verified restoration). This planning
  package defines the Project Gateway contract; the pi-guard-side change
  itself is **not authorized here** and requires a separate explicit human
  authorization.
- **WP-5B owns:** effective-surface tool-inventory observation (Pi 0.83.0
  `getAllTools`/`getActiveTools` contract, sampling points, drift rule, and
  effective-surface identity — F-04/F-R1; see the inventory boundary below),
  capability→tool-profile mapping, deterministic projection, activation
  driven by a control-plane activation decision (ADR-002), verified
  restoration, concurrent-activation and restart rules (F-06/F-R3/F-F1), and
  enforcement evidence (ADR-027). WP-5B must not interpret artifact
  authority (Artifact Core owns `evaluatePointOfUseEligibility`); it
  consumes a validated, exactly-correlated `EligibilityReport`.
- **Idempotent-replay rule (authoritative, F-R3/F-F1):** an activation
  replay is idempotent only when **all** of the following match exactly:
  1. `PiInvocationPlan` identity or fingerprint;
  2. validated effective-authority identity;
  3. approval or activation-decision identity;
  4. RuntimeGrant identity, where represented separately;
  5. effective tool-inventory identity;
  6. compatibility-result identity;
  7. projected Enforcement Configuration identity;
  8. target Pi session or enforcement-surface identity.
  Any mismatch creates a **conflicting activation request** that fails
  closed; compatibility drift cannot qualify as idempotent replay; prior
  activation evidence does not authorize a replay; restart requires a fresh
  projection and a fresh trusted activation decision. (The complete
  normative list also appears in
  `pi-guard-compatibility-and-authority-projection.md` Part B.)
- **Pi 0.83.0 inventory boundary (decision-level, F-R1/F-F1):** Pi 0.83.0
  exposes one surviving effective `ToolInfo` per tool name; same-name
  registrations are collapsed before Project Gateway observation; shadowed
  registrations and the complete registration history are not observable
  through the reviewed public API. Project Gateway binds enforcement only
  to the observable effective name-to-source surface; the effective source
  must match trusted-local source expectations; unknown or unexpected
  effective tools are denied; effective source or inventory drift fails
  closed; Project Gateway does not claim to detect all duplicate, shadowed,
  hidden, or pre-resolved registrations; this limitation does not create
  authority. Optional uncollapsed-registration visibility is a separately
  reviewed **WP-15** hardening responsibility and is non-blocking for WP-6.
  Detailed sampling and drift rules: `pi-guard-compatibility-and-authority-projection.md`
  Part B.
- **Failure behavior:** unknown tools denied; unsupported required
  capabilities fail closed; inventory drift between projection and
  activation fails closed; no partial activation; restoration verified on
  completion/cancellation/error/shutdown.
- **No undocumented fallback and no design around pi-guard private
  internals:** only the public compatibility surface is used.

## Rationale

Enforcement can only be implemented against a defined, versioned consumer
contract; defining that contract in-repo (while leaving pi-guard changes
for separate authorization) keeps the authority boundary repository-owned
and reviewable.

## Consequences

- WP-5B is not eligible until WP-6 and WP-12 are closed (ADR-023) and until
  the pi-guard projection interface exists or is explicitly authorized.
- Compatibility drift fails closed with stable findings.
- Enforcement evidence is defined by ADR-027.

## Rejected Alternatives

1. **Modifying pi-guard within this planning package:** rejected — WP-0
   requires explicit separate authorization.
2. **Designing around pi-guard private internals:** rejected — no
   documented public surface exists for that; undocumented coupling would
   violate the compatibility boundary.
