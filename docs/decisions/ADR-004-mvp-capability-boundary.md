# ADR-004 — MVP Capability Boundary

## Status

Accepted

## Context

The gateway must be useful enough for ChatGPT Web to inspect configured projects, prepare structured downstream artifacts, and review results without becoming a general local execution interface. Capability breadth must not bypass the product's workspace, approval, and authority boundaries.

Fast discovery and deterministic verification have different properties. Likewise, read-only Git inspection is useful for project understanding but must not imply Git mutation authority. The first write function requires an especially narrow boundary.

## Decision

Subject to trusted workspace policy, the MVP MAY provide these ChatGPT-facing capabilities:

- list configured workspaces and report effective workspace capabilities;
- list and read authorized files;
- find files with FFF as an internal fast-discovery backend;
- search repository content;
- perform exhaustive verification searches through a backend separate from FFF;
- inspect Git status, diffs, logs, and selected commits in read-only mode;
- draft and validate structured artifacts;
- compare artifact revisions; and
- inspect execution bundles and execution results.

FFF is an internal discovery backend, not an authorization boundary. Exhaustive verification MUST remain distinct from discovery so ranked or partial discovery is never represented as complete verification.

The first ChatGPT-facing write capability is structured artifact drafting only. The gateway MAY persist validated artifact drafts only in workspace-configured artifact locations. It MUST NOT expose a generic `create_file` capability or source-code editing capability in the MVP.

Git inspection is read-only. The MVP MUST NOT expose Git mutation, including staging, committing, pushing, fetching, pulling, merging, rebasing, resetting, cleaning, or switching branches.

The MVP MUST NOT provide ChatGPT Web or downstream agents with unrestricted filesystem access, unrestricted shell access, arbitrary command execution, file deletion authority, arbitrary network access, package installation authority, gateway configuration authority, trusted schema definition or registration authority, policy self-approval, or direct execution activation from ChatGPT Web.

Unknown operations are denied. Deny rules override allows. Unsupported required capabilities or required extensions MUST fail closed and MUST NOT be silently ignored, downgraded, or treated as optional. Consumer support is an independent limiting term in effective authority.

## Rationale

The selected capabilities support the advisor-and-orchestrator workflow while preserving a narrow local authority boundary. Artifact-only writes allow structured coordination to begin without creating an arbitrary repository modification channel.

Read-only Git inspection provides useful evidence without granting control over repository history or working-tree state. Keeping FFF discovery separate from exhaustive verification makes completeness claims explicit and testable rather than dependent on a ranking-oriented search engine.

Fail-closed handling prevents a consumer from proceeding under an incomplete interpretation of a required policy or extension.

## Consequences

- The MVP tool surface, when designed later, MUST map only to these bounded capabilities and MUST enforce workspace policy independently of internal backends.
- A request to create or edit source code through the gateway MUST be rejected even if it appears low risk or targets an authorized workspace.
- Downstream consumers may operate only through their own effective authority and supported-capability checks; they do not gain general shell, filesystem, network, deletion, package, or Git-mutation authority from the gateway.
- A future source-write, execution, network, or Git-mutation capability requires an explicit later architectural decision and cannot be inferred from artifact drafting.
- Detailed MCP request and response schemas, FFF APIs, command syntax, and enforcement mechanics remain outside WP-0.

## Rejected Alternatives

1. **Generic file create and edit operations:** Rejected because they would create a broad write channel before the structured artifact protocol and approval boundary are established.
2. **Shell or arbitrary subprocess capability:** Rejected because it would bypass narrow capability enforcement and enable unbounded local effects.
3. **Git write operations alongside read-only inspection:** Rejected because repository mutation is not needed for the MVP inspection-and-artifact workflow.
4. **Use FFF for both discovery and completeness claims:** Rejected because fast ranked discovery is not a deterministic exhaustive-verification boundary.
5. **Best-effort handling of unsupported required capabilities:** Rejected because silent omission or downgrade can widen effective behavior or invalidate an execution's assumptions.
