# WP-5A Open Decisions

## Implementation Decisions (Resolved)

All implementation-critical WP-5A decisions were resolved during
implementation:

- **Module boundary:** the Pi adapter lives under `src/adapters/pi/**` and is
  exposed through the package subpath
  `@project-gateway/artifact-core/pi-adapter`; the root Artifact Core namespace
  acquires no Pi-specific types. A subpath export was suitable, so no monorepo
  restructure was performed.
- **Narrow root exports:** `EligibilityReport`, `ImmutableModel`,
  `RequestedUse`, and `ValidationLevel` types plus `exactReferencesEqual` /
  `workspaceBindingsEqual` were added to the root exports for adapter
  consumption; WP-4 behavior and totals are unchanged.
- **Host lane:** Pi 0.83.0 (`@earendil-works/pi-coding-agent`) inspected
  locally; the adapter binds to the documented public extension API subset and
  never depends on undocumented internals; no Pi dependency was added
  (environment-gated dynamic import only).
- **Prompt injection:** the documented `before_agent_start` message-injection
  mechanism; context blocks use fixed length-prefixed framing.
- **Observation:** session/turn correlation from host events; timestamps are
  host-supplied observations only; cancellation is host-supplied (no public
  0.83.0 cancellation event).
- **Identity:** occurrence and attempt IDs are caller-supplied; the adapter
  never generates trusted identifiers.

No unresolved WP-5A Pi Adapter decisions.
