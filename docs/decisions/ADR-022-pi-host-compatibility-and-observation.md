# ADR-022 — Pi Host Compatibility and Observation

## Status

Accepted

## Context

The adapter must bind to a specific Pi release without assuming compatibility
from a version string alone, and must observe completion without creating
trusted lifecycle state.

## Decision

- **Pi 0.83.0 lane:** the supported lane is the inspected
  `@earendil-works/pi-coding-agent@0.83.0` public extension API subset
  (`before_agent_start` message injection; session/turn/message/tool/settle/
  shutdown events; read-only session correlation).
- **Host capability fingerprint:** a deterministic SHA-256 fingerprint over
  the required observable API surface (package identity, version, adapter API
  version, injection mechanism, context transport, prompt size, encodings,
  media types, event classes, correlation support, deterministic ordering,
  required features). Declared-value order is normalized; real surface changes
  change the fingerprint. The fingerprint is non-authoritative and used only
  for compatibility detection.
- **Extension API strategy:** public documented types and hooks first; a
  narrow structural `PiHostSurface` matches the ExtensionAPI subset; actual Pi
  imports are environment-gated (`PGW_PI_PACKAGE_PATH`) and never a package
  dependency.
- **Result observation:** assistant completion, tool-call attempts,
  cancellation (host-supplied), and host errors are captured as untrusted
  observations. In the verified 0.83.0 public lane only `turn_start` supplies
  a timestamp; completion, settle, and shutdown events generally do not, and
  the adapter records a timestamp only when the host actually supplies one
  (never synthesized, no `Date.now()` fallback). Host timestamps are
  observational, never lifecycle time.
- **No tool-inventory reads:** WP-5A never calls `getActiveTools()` or
  `getAllTools()`; tool inventory and authority projection are reserved for
  WP-5B, and tool-call attempts are observed through lifecycle events only.
- **Drift handling:** missing or changed required API properties reject
  projection or host binding with stable compatibility findings; no fallback
  through undocumented behavior exists.
- **No active installation:** the harness and bridge never install the
  adapter into `~/.pi`, never mutate Pi settings, never start Pi, and never
  send a model request. The harness gate is `PGW_PI_PACKAGE_PATH` (explicit
  path overrides); a machine-specific default exists only in the labeled
  local-lane test helper.

## Rationale

Binding to observable API properties instead of a version string makes drift
detectable and testable; environment gating keeps the package free of Pi
dependencies; observation-only capture preserves the no-authority boundary.

## Consequences

- The 0.83.0 lane is explicitly reported and enforced; other versions are
  rejected unless a reviewed lane update is made.
- WP-5B authority projection will add pi-guard enforcement without changing
  the observation model.
