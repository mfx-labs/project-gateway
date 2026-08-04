# ADR-020 — Pi Adapter Boundary and No-Authority

## Status

Accepted

## Context

WP-4 delivered a consumer-neutral Artifact Core with validated,
point-of-use-eligible subjects. WP-5A must realize the first consumer adapter
(Pi) without becoming an authority, lifecycle authority, pi-guard, or execution
controller.

## Decision

The Pi adapter is a pure projection and observation boundary:

- it accepts only Artifact Core validated wrappers at use-suitable levels
  (bundle ≥ `point-of-use-eligible`, members ≥ `registry-compatible`) with
  runtime membership checks; raw artifact JSON is rejected;
- it requires the exact ExecutionBundle and its four exact resolved members,
  correlated by exact-reference equality;
- it produces an immutable `projection-ready` invocation plan that explicitly
  states pi-guard authority enforcement is pending;
- it observes Pi completion and tool-call events as untrusted data and never
  authorizes, blocks, enables, or disables tools; it never changes pi-guard
  mode or Pi settings and never installs itself;
- it never creates approvals, issuances, grants, activations, lifecycle
  records, ExecutionResults, or TrustedReceipts.

## Rationale

Projection is not authorization; eligibility is not execution; observation is
not lifecycle state. Keeping the adapter authority-free preserves the WP-4
trust boundary and leaves the authority surface to WP-5B.

## Consequences

- The adapter can be reviewed and deployed independently of pi-guard.
- WP-5A does not read or interpret the Pi tool inventory; tool inventory and
  authority projection are reserved for WP-5B, and tool-call attempts are
  observed through lifecycle events only (observation never implies
  permission).
- WP-5B will consume the plan and apply authority projection into pi-guard.
