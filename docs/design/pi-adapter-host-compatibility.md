# Pi Adapter Host Compatibility (WP-5A)

**Status:** Normative WP-5A design
**Module:** `src/adapters/pi/compatibility.ts`, `src/adapters/pi/host-harness.ts`

## Inspected Local Pi Environment

- **Executable:** `/home/chef/.local/share/pi-node/node-v22.23.2-linux-x64/bin/pi`
- **Version:** `0.83.0`
- **Package identity:** `@earendil-works/pi-coding-agent@0.83.0`
- **Type declarations:** `dist/index.d.ts` + `dist/core/extensions/types.d.ts`
  (public, documented in `docs/extensions.md`)

## Public API Surface (Pi 0.83.0, extension API)

`ExtensionAPI` (public and documented) provides `on(event, handler)` for:
`project_trust`, `resources_discover`, `session_start`, `session_info_changed`,
`session_before_switch/fork/compact/tree`, `session_shutdown`, `session_compact`,
`session_tree`, `context`, `before_provider_request/headers`,
`after_provider_response`, `before_agent_start` (message + system-prompt
injection), `agent_start/end/settled`, `turn_start/turn_end`,
`message_start/update/end`, `tool_execution_start/update/end`, `model_select`,
`thinking_level_select`, `tool_call` (block-capable), `tool_result`,
`user_bash`, `input`; plus `registerTool`, `registerCommand`,
`registerShortcut`, `registerFlag`, `sendMessage`, `sendUserMessage`,
`appendEntry`, `getActiveTools()`, `getAllTools()`, and `VERSION`.

## Required Hooks and Event Shapes (adapter lane)

The bridge binds to this documented subset:

- prompt injection: `before_agent_start` → `{ message: { customType, content, display } }`;
- session lifecycle: `session_start` (reason), `session_shutdown` (reason);
- turn lifecycle: `turn_start` (turnIndex, timestamp — the only public
  timestamp in the lane), `turn_end`;
- result observation: `message_end` (assistant message), `agent_end`,
  `agent_settled` (no public timestamps on these events);
- tool-call observation: `tool_execution_start`, `tool_execution_end`,
  `tool_call` (observed only — never blocked, never mutated);
- correlation: `ctx.sessionManager.getSessionId()` (read-only).

WP-5A does **not** read or interpret the Pi tool inventory
(`getActiveTools()` / `getAllTools()`): tool inventory does not affect
projection, compatibility, or task semantics, and tool inventory and authority
projection are reserved for WP-5B. Tool-call attempts are observed only through
the lifecycle events above, and observing one never implies permission.

## Unsupported or Unstable Pi APIs

- There is no dedicated public 0.83.0 extension event for user cancellation;
  cancellation is recorded only when the integration layer supplies a host
  cancellation observation (never fabricated).
- TUI-only internals, provider-payload rewriting, and session-storage internals
  are out of the WP-5A lane.
- No fallback through undocumented behavior exists: missing required API
  properties reject projection or host binding with a stable compatibility
  finding.

## Capability Fingerprint

`hostCapabilityFingerprint(capability)` computes SHA-256 over a canonical
serialization of the required observable surface: package identity, version,
adapter API version, prompt-injection mechanisms, context transport, prompt
size, encodings, media types, and the six event classes (session, turn, result,
tool, cancellation, shutdown), correlation support, deterministic ordering, and
required features. Declared-value array order is normalized (sorted), so
reordered declarations do not change the fingerprint; a real surface difference
does. The fingerprint is deterministic, documented, testable, non-authoritative,
and used only for compatibility detection and drift reporting.

## Supported Lane

- Linux x86_64; Node.js v22.23.2; Pi 0.83.0; Artifact Core at commit
  `45bfd97…`; UTF-8; isolated local extension compatibility harness; no live
  model request; no active tool execution.
- `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`.

## Drift Detection

Version strings alone are never trusted: `inspectPiHostCompatibility` checks
package identity, version, adapter API version, every required hook class,
correlation support, deterministic ordering, and rejects unknown required
features. The environment-gated harness (`inspectLocalPiPackage`) verifies the
installed package manifest and required runtime exports (`VERSION`,
`isToolCallEventType`, `createExtensionRuntime`, `discoverAndLoadExtensions`)
without starting Pi.

## Environment-Gated Harness

`PGW_PI_PACKAGE_PATH` is the authoritative harness input (an explicit path
parameter overrides it for programmatic use). When the gate is absent, the
harness is inert and returns a stable gated result (`inspected: false`); the
adapter never imports Pi and never scans the filesystem to discover Pi
installations. A machine-specific local default exists only in the clearly
labeled local-lane test helper (`tests/pi-adapter/compatibility/local-lane.ts`)
and never affects production behavior. The harness performs no model request,
no tool execution, no `~/.pi` reads, and no configuration modification.
