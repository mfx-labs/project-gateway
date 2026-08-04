# ADR-001 — Product Boundary

## Status

Accepted

## Context

ChatGPT Web needs to inspect local project workspaces and produce useful structured work for downstream coding and enforcement components. A broad MCP that exposes arbitrary filesystem paths, shell commands, source editing, Git mutation, or execution would turn untrusted prompts and repository content into a route toward unrestricted local authority.

The gateway is intended to be installed outside the repositories it manages. It needs to support explicitly configured workspaces while keeping policy and lifecycle control local and independent of project content.

## Decision

Project Gateway MCP is a standalone, policy-controlled local project and artifact gateway. It MUST expose only explicitly configured workspaces and a narrow set of authorized project-inspection and structured-artifact-drafting capabilities.

It is not a generic filesystem MCP, unrestricted coding agent, shell service, arbitrary-command service, Git automation server, or autonomous execution system. In the MVP, its only ChatGPT-facing write boundary is persistence of validated structured artifact drafts in workspace-configured artifact locations. It MUST NOT expose generic file creation, source-code editing, file deletion, Git mutation, package installation, arbitrary network access, or direct execution activation.

The gateway MUST be installed and configured outside managed repositories. Repository content MUST NOT establish workspace roots, policy, trusted configuration, approval state, issuance state, grants, or audit behavior.

## Rationale

A narrow gateway makes the authority boundary inspectable and enforceable. It lets ChatGPT serve as an inspector, advisor, orchestrator, and artifact producer without treating it as an unrestricted local execution principal.

Confining the product to configured workspaces prevents requests from becoming arbitrary path access. Separating artifact drafting from source editing permits useful downstream coordination while avoiding a generic write primitive. Keeping configuration and authority outside repositories prevents checked-in content, prompt injection, or generated artifacts from changing the gateway's trust boundary.

## Consequences

- The MVP can support authorized workspace listing, reading, discovery search, exhaustive verification search, read-only Git inspection, artifact drafting and validation, artifact comparison, and result inspection.
- Internal discovery and inspection backends are implementation details, not authority boundaries.
- Generic filesystem, shell, execution, and Git-write APIs are out of scope even when a caller proposes a narrow use case.
- A future capability expansion requires an explicit, human-reviewed architecture and policy decision; it cannot be inferred from an existing broad adapter or repository request.
- The product MUST maintain trusted local configuration and policy enforcement outside managed repositories.

## Rejected Alternatives

1. **Generic filesystem MCP:** Rejected because path-level access alone cannot express the product's intended project, policy, and artifact boundaries safely.
2. **Unrestricted coding-agent or shell MCP:** Rejected because arbitrary commands and local execution collapse inspection, authority, and execution into one unbounded interface.
3. **Git automation server:** Rejected because staging, committing, branching, pushing, and related mutation are not required for the MVP advisor-and-artifact workflow.
4. **Repository-installed or repository-configured gateway:** Rejected because repository content is untrusted and must not be able to register workspaces, widen permissions, or alter audit and approval controls.
5. **Generic controlled file-create API as the first write feature:** Rejected because it would establish a source or arbitrary-content write channel rather than the intentionally narrow structured-artifact drafting boundary.
