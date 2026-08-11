# Project Gateway MCP — Product Scope and Architecture Principles

**Status:** Authoritative WP-0 design baseline
**Applies to:** All later protocol, gateway, adapter, enforcement, and integration work

## Executive Summary

Project Gateway MCP is a standalone, local, policy-controlled gateway for explicitly configured project workspaces. It enables ChatGPT Web to inspect those workspaces and to produce structured downstream artifact drafts for coding agents and enforcement tools. It is an authority boundary, not a general-purpose local-computer interface.

In the MVP, ChatGPT Web MAY inspect authorized project material and MAY create validated artifact drafts in configured project-visible artifact locations. It MUST NOT approve, issue, revoke, activate, or grant authority; start Pi; edit source code; mutate Git; alter trusted gateway configuration or schemas; or expand policy. A trusted local control plane performs approval, issuance, revocation, runtime-grant, activation, receipt, and authoritative-audit functions outside managed repositories.

The initial protocol separates six artifact responsibilities: `TaskSpec`, `AuthorityPolicy`, `ContextManifest`, `CompletionContract`, `ExecutionBundle`, and `ExecutionResult`. Their detailed field semantics, JSON Schemas, and adapter interfaces are intentionally deferred. This separation prevents a task, prompt, repository file, or schema-valid draft from becoming implicit authority.

## Authority and Precedence

This document and ADR-001 through ADR-004 are the authoritative WP-0 record. `docs/Idea_Brief.md` is retained as prior background material. Where it differs from this WP-0 baseline—for example, on generic controlled file creation or optional source modification—the WP-0 documents take precedence. This statement changes no historical content in that brief.

## Problem Statement

ChatGPT Web needs a bounded way to understand configured local projects, prepare structured work for downstream agents, and review execution evidence. Exposing a generic filesystem, shell, or execution MCP would make untrusted prompts and repository content capable of influencing broad local authority.

The product therefore needs to separate project inspection and artifact drafting from authority decisions and execution. It also needs a durable distinction between project-visible documents and trusted local records, so repository content cannot grant itself permissions or impersonate an approval.

## Product Definition

Project Gateway MCP is a local gateway installed outside managed repositories. It provides a small, policy-controlled capability surface over explicitly configured workspaces for these roles:

- ChatGPT Web is a project inspector, advisor, orchestrator, structured-artifact producer, and execution-result reviewer.
- The gateway resolves trusted workspace configuration, applies policy, exposes authorized inspection capabilities, and MAY persist validated artifact drafts only in configured artifact locations.
- A trusted local control plane approves, issues, revokes, grants, activates, and records authoritative runtime state.
- Downstream adapters and evaluators consume issued artifacts within effective authority and report structured results.

The gateway MUST treat generated content, repository content, prompts, and artifact drafts as untrusted inputs. It MUST expose only workspaces configured by trusted local configuration. Repository content MUST NOT establish gateway policy, approval state, issuance state, grants, or authority.

## Product Non-Definition

Project Gateway MCP is not:

- a generic filesystem MCP or a proxy for unrestricted local paths;
- an unrestricted coding agent, shell service, arbitrary-command service, or autonomous deployment system;
- a Git automation server;
- a mechanism for ChatGPT to modify project source code or mutate Git state;
- a repository-resident policy engine or configuration system;
- an approval service controlled by artifact producers; or
- a replacement for a human or trusted local activation decision.

## Target Workflow

The intended MVP workflow is:

1. A trusted local administrator configures a workspace, its capability ceilings, and its project-visible artifact location outside the repository's authority.
2. ChatGPT Web selects from configured workspaces and performs only authorized inspection: discovery, reading, searching, read-only Git inspection, and review of existing artifacts or results.
3. ChatGPT Web prepares a structured artifact draft. The gateway MAY persist it only after the applicable structural and semantic validation succeeds and only in the configured artifact location.
4. Validation establishes conformance, not authority. The validated draft remains unapproved.
5. A trusted local control plane, under local human or other trusted control, MAY bind an approval to that artifact revision's canonical digest, then MAY issue it. Approval, issuance, and revocation records remain outside the repository.
6. A trusted local control plane MAY activate a specific issued execution through a runtime grant. ChatGPT Web MUST NOT obtain authority by treating a draft, bundle, or prompt as an activation command.
7. The Pi task adapter, pi-guard authority adapter, and completion evaluator consume their respective artifact responsibilities. A completion evaluator produces an `ExecutionResult`; trusted local execution receipts and audit records remain outside the repository.
8. ChatGPT Web MAY inspect the resulting project-visible artifacts and execution results, but it MUST NOT convert review into approval or activation.

The exact user interface, record format, and process topology for these steps are deferred.

## Zero-Transfer Product UX Objective and Principles

**Product-level UX objective (approved):** Routine structured
context/artifact transfer between ChatGPT, the project workspace, and Pi
should not require manual copy/paste, upload/download, or path
transcription. Copy/paste, upload, and download remain intentional
actions for sharing material in discussion — never routine transport
between system components.

**Approved principles:**

- `Automate transfer, not authority.`
- `Zero-transfer, not necessarily zero-keystroke.`

**Extended target workflows (in addition to the steps above):**

### ChatGPT → workspace

1. ChatGPT inspects trusted/project state through authorized inspection
   surfaces.
2. ChatGPT constructs a structured proposal artifact.
3. ChatGPT validates it.
4. ChatGPT persists it through controlled write (schema-constrained,
   workspace-contained, create-only).

### workspace → Pi

1. The user invokes a short command/keyword/hotkey.
2. Pi resolves and validates the intended artifact/bundle from controlled
   project state.
3. Content enters Pi context without manual artifact transport (no
   paste, no upload/download, no path transcription, no natural-language
   loading prompt).

### Pi/project changes → ChatGPT

1. The user invokes a short ChatGPT workflow/keyword (e.g., conceptually
   `@gateway changes`).
2. Gateway retrieves the current changed state through controlled
   Git/file inspection at point of use.
3. No manual diff/file paste is required.

**Visible feedback (UX requirement):** every zero-transfer action returns
concise visible feedback — a successful persist/load/context retrieval
reports what was acted on (e.g., persisted kind/revision, loaded bundle,
changed-file count); incomplete or invalid state produces a typed visible
failure; no silent partial success. Exact wording is implementation
detail.

Zero-transfer automation never creates authority: connectivity, keyword
invocation, hotkeys, and artifact loading are context transfer only. See
ADR-040 and the WP-14 pre-implementation contract decision for the
package-level contract.

## Component Responsibility Matrix

The components below may be separate processes or logical components; this matrix defines responsibilities rather than an implementation topology.

| Component | Primary responsibility | MUST NOT be treated as responsible for |
| --- | --- | --- |
| ChatGPT Web | Inspect authorized projects, advise, orchestrate, draft structured artifacts, and review results | Approval, issuance, revocation, grants, activation, source editing, Git mutation, or gateway administration |
| Project Gateway MCP | Enforce configured workspace boundaries; expose authorized inspection capabilities; validate and persist permitted artifact drafts; normalize returned data | A generic filesystem, shell, execution launcher, policy approver, or source-code editor |
| Trusted local control plane | Maintain authoritative approval, issuance, revocation, runtime-grant, activation, receipt, and audit state | Treating repository content or a schema-valid draft as self-authenticating authority |
| Workspace repository and project-visible artifact area | Hold reviewable project content and artifact documents | Supplying trusted configuration, changing ceilings, or proving approval or issuance |
| Artifact validation function | Check applicable structural and semantic conformance | Granting authority, issuing an artifact, or activating execution |
| FFF discovery backend | Fast, ranked discovery of likely files or content within already authorized scope | Authorization, path policy, exhaustive completeness verification, or authority decisions |
| Exhaustive verification backend | Deterministic completeness-oriented verification searches within already authorized scope | Fast discovery ranking, authorization, or authority decisions |
| Pi task adapter | Translate supported task and context artifacts for Pi consumption | Interpreting a task as authority, approving artifacts, or starting execution from ChatGPT Web |
| pi-guard authority adapter | Enforce supported effective authority for downstream execution | Expanding ceilings, approving policies, or silently accepting unsupported required authority |
| Completion evaluator | Evaluate execution evidence against a completion contract and produce an `ExecutionResult` | Issuing authority, replacing a trusted receipt, or approving its own result |

## Trust Zones

| Trust zone | Content or state | Required treatment |
| --- | --- | --- |
| Remote producer zone | ChatGPT prompts, requests, generated text, and draft proposals | Untrusted input. It may be validated but cannot be self-approved or self-activated. |
| Project-content zone | Repository files, project-visible artifacts, embedded instructions, and generated execution results | Untrusted input and reviewable data. It cannot establish trusted policy or runtime state. |
| Gateway enforcement zone | Locally installed gateway code and trusted workspace configuration used to enforce the configured boundary | Trusted to enforce policy, while still treating all requests and repository-derived data as untrusted input. |
| Trusted local control-plane zone | Approval, issuance, revocation, grant, activation, receipt, and authoritative audit records | Authoritative local state. It MUST remain outside managed repositories. |
| Downstream consumer zone | Pi, pi-guard, and completion-evaluation consumers operating through adapters | Bounded by issued artifacts, runtime grants, supported capabilities, and local enforcement; no consumer receives implied authority beyond those bounds. |

Trust is not inherited merely because content was written locally. A repository file, draft, validated artifact, or `ExecutionResult` remains content rather than authoritative runtime state unless a separate trusted local record establishes the relevant state.

## Approval Boundary

Artifact lifecycle states are deliberately distinct:

```text
artifact draft
  -> validation
  -> validated artifact draft
  -> trusted approval bound to canonical digest
  -> approved artifact
  -> trusted issuance
  -> issued artifact
  -> trusted runtime grant and activation for a particular execution
```

- Validation MUST determine only structural and semantic conformance. It MUST NOT grant permission, approval, issuance, or activation.
- A trusted local approval MUST be bound to the canonical digest of a particular artifact revision. A content change that yields a different canonical digest MUST NOT inherit that approval.
- Approval MUST be separate from issuance. An approved artifact is not automatically issued, and an issued artifact is not automatically active for an execution.
- ChatGPT Web MUST NOT approve its own artifacts, issue artifacts, revoke artifacts, activate authority, or grant permissions.
- Repository paths, filenames, embedded assertions, and artifact metadata MUST NOT be accepted as proof of approval, issuance, revocation status, or a runtime grant.
- Consumers MUST fail closed when they cannot establish the required trusted status, current revocation status, or supported capability set.

The approval mechanism, approver identity representation, storage technology, canonicalization algorithm, and signing mechanism are not standardized in WP-0.

## Execution Boundary

The gateway's ChatGPT-facing write boundary ends at validated structured artifact drafts. It does not edit source code, invoke a shell, start Pi, or activate a downstream execution.

Execution is a downstream, locally controlled activity. An `ExecutionBundle` identifies the exact artifact revisions proposed for one execution, but the bundle itself does not grant authority or trigger execution. A trusted local control plane determines whether an issued bundle can be activated under a runtime grant. The Pi task adapter consumes task and context responsibilities; the pi-guard authority adapter enforces authority; and the completion evaluator reports what occurred.

A direct instruction from ChatGPT Web, a repository file, a prompt, or an artifact draft MUST NOT start Pi or activate execution in the MVP.

## Authority Model

A generated `AuthorityPolicy` MAY narrow authority only. It MUST NOT expand a global or workspace capability ceiling, and no other core artifact may imply an expansion of authority.

Effective downstream authority is conceptually:

```text
Global capability ceiling
∩ Workspace capability ceiling
∩ Approved AuthorityPolicy
∩ Runtime grant
∩ Consumer-supported capabilities
```

The global and workspace ceilings are trusted local configuration, not repository content. The approved policy is relevant only when its approval and issuance can be established through trusted local state. A runtime grant is an additional contextual bound; it cannot add authority absent from an earlier term. Consumer support is also a bound: an adapter or guard cannot safely infer a capability it does not support.

The following rules apply throughout the MVP:

- Deny rules override allow rules.
- Unknown operations are denied.
- A policy request that exceeds a trusted ceiling MUST be rejected or otherwise fail closed; it MUST NOT widen the effective authority.
- Unsupported required capabilities or required extensions MUST fail closed. They MUST NOT be silently ignored, downgraded, or converted into a weaker interpretation.
- `TaskSpec`, `ContextManifest`, `CompletionContract`, `ExecutionBundle`, and `ExecutionResult` MUST NOT grant authority.

## MVP Artifact Set

The MVP uses six distinct, versioned artifact kinds. A later work package will define their field-level semantics, schemas, canonical form, revision rules, and cross-artifact validation. WP-0 establishes the responsibility boundary only.

| Artifact kind | Sole responsibility | It MUST NOT supply |
| --- | --- | --- |
| `TaskSpec` | What the downstream agent must do: intended work, required outcome, and task instructions | Permission, capability expansion, context authorization, proof of completion, or observed results |
| `AuthorityPolicy` | What the downstream agent is allowed to do, subject to trusted ceilings, approval, grants, and consumer support | Task intent, a source of trusted ceiling expansion, execution activation, or self-approval |
| `ContextManifest` | What context the consumer must or may load for the task | Task instructions, authority, a waiver of ordinary read policy, or completion proof |
| `CompletionContract` | How completion must be proven and evaluated | Authority, task execution instructions, or an execution outcome |
| `ExecutionBundle` | Which exact artifact revisions constitute one proposed execution | A merged unrestricted job document, an implicit approval, a grant, or activation |
| `ExecutionResult` | What occurred during execution and the evidence reported by evaluation | Prospective completion requirements, authority, approval, issuance, or an authoritative local receipt |

A `TaskSpec` and an `AuthorityPolicy` are intentionally separate: a task can require work without granting permission, and a policy can constrain actions without directing work. A `ContextManifest` selects or describes context; it does not turn context into instructions or authorize access beyond other policy checks. A `CompletionContract` states prospective proof requirements, whereas an `ExecutionResult` reports observed outcomes. An `ExecutionBundle` binds exact revisions rather than collapsing all six responsibilities into one unrestricted document.

**Artifact ownership boundary:** ChatGPT Web MAY create validated drafts of producer-authored `TaskSpec`, narrowing `AuthorityPolicy`, `ContextManifest`, `CompletionContract`, and `ExecutionBundle` proposals. A trusted local control plane owns approval, issuance, revocation, grants, activation, and authoritative records for artifacts used in an execution. The Pi task adapter is the task-and-context consumer; the pi-guard authority adapter is the authority consumer; and the completion evaluator produces the `ExecutionResult` for an actual execution. ChatGPT Web MAY review results, but no producer becomes a lifecycle authority merely by writing an artifact document.

## MVP Allowed Capabilities

Subject to configured workspace policy and output bounds, the MVP MAY provide ChatGPT Web with these capabilities:

- list configured workspaces and report their effective workspace capabilities;
- list and read authorized files within a configured workspace;
- find files with FFF as an internal fast-discovery backend;
- search repository content;
- perform exhaustive verification searches through a backend separate from FFF when deterministic completeness is required;
- inspect Git status, diffs, logs, and selected commits in read-only mode;
- draft and validate structured artifacts;
- compare artifact revisions; and
- inspect execution bundles and execution results.

FFF is a discovery backend, not an authorization boundary. The gateway MUST authorize a request and its returned material independently of the discovery backend. Exhaustive verification MUST remain a separate capability so that ranked discovery is never represented as deterministic completeness verification.

## MVP Prohibited Capabilities

The MVP MUST NOT provide ChatGPT Web or downstream agents with:

- unrestricted filesystem access;
- unrestricted shell access or arbitrary command execution;
- file deletion authority;
- arbitrary network access;
- package installation authority;
- Git mutation authority, including staging, committing, pushing, fetching, pulling, merging, rebasing, resetting, cleaning, or switching branches;
- gateway configuration authority;
- trusted schema definition or registration authority;
- policy self-approval;
- direct execution activation from ChatGPT Web;
- generic source-code creation or editing through the gateway; or
- authority to bypass workspace bounds, capability ceilings, denials, grants, consumer support checks, or audit requirements.

The first ChatGPT-facing write capability is structured artifact drafting only. The gateway MAY write a validated artifact draft only into a workspace-configured artifact location. It MUST NOT expose a generic create-file capability or a source-code editing capability in the MVP.

## Workspace and Storage Boundary

A workspace is a logical project scope selected from trusted local configuration. Its root, visibility, capability ceilings, and artifact location are not supplied or modified by ChatGPT Web or repository content.

Project-visible, reviewable artifact documents MAY be stored in a project-controlled location. A non-normative layout could be:

```text
.agent/
├── tasks/
├── policies/
├── contexts/
├── completion/
└── bundles/
```

This layout is not a trusted control-plane directory and is not standardized by WP-0. The location for `ExecutionResult` documents is likewise configurable rather than standardized here.

Trusted runtime state MUST remain outside the repository. A non-normative local state layout could be:

```text
~/.local/state/project-gateway/
├── approvals/
├── issued/
├── grants/
├── receipts/
├── executions/
└── audit/
```

The exact directory structure is not standardized. The trust distinction is:

| Project-visible repository area | Trusted local state outside the repository |
| --- | --- |
| Artifact drafts, validated artifact documents, reviewable bundle documents, and reviewable execution-result documents | Trusted workspace and global policy configuration; approvals; issuance and revocation records; runtime grants; activation state; execution receipts; authoritative audit state |
| Content that may be inspected, compared, versioned, or reviewed with the project | State that determines authority or proves the control-plane lifecycle |
| Never sufficient on its own to prove authority | Never established by a repository assertion or artifact filename |

## Downstream Consumer Model

The first supported consumers are deliberately narrow:

- **Pi task adapter:** consumes the task and context responsibilities needed to prepare Pi. It MUST NOT derive permission from task text or context content.
- **pi-guard authority adapter:** consumes and enforces the authority responsibility. It MUST calculate or enforce only effective authority and MUST fail closed for unknown or unsupported required capabilities.
- **Completion evaluator:** consumes completion requirements and execution evidence, then produces a structured `ExecutionResult`. Its result does not replace a trusted local execution receipt or confer approval.

Adapters provide the consumer-specific translation boundary. Core artifacts MUST remain consumer-neutral and MUST NOT embed Pi-specific configuration as common semantics. Exact adapter APIs, Pi extension APIs, pi-guard changes, and execution mechanics are outside WP-0.

## Extension and Future-Compatibility Principles

The architecture MUST support future agents and artifact features without weakening core boundaries:

1. Artifact kinds and their versions MUST be explicit and stable enough for independent consumers to negotiate support.
2. Core contracts MUST remain separate from consumer-specific adapters.
3. Extensions MUST use registered extension namespaces rather than silently overloading common artifact semantics.
4. An extension MUST declare whether it is required or optional for a consumer or execution.
5. Schema validation and semantic validation MUST apply to extensions in addition to core artifacts.
6. A consumer encountering an unsupported required extension or feature MUST fail closed.
7. An optional extension MAY be ignored only when its registered optional semantics permit that and ignoring it cannot alter core meaning, authority, completion obligations, or safety guarantees.
8. Extensions MUST NOT override capability ceilings, deny rules, the approval boundary, or the distinction between artifact content and trusted runtime state.

Future Pi-, Codex-, Cline-, reviewer-, or release-specific behavior SHOULD be introduced through adapters or registered extensions, not by polluting common artifact semantics.

## Explicit Non-Goals

WP-0 does not define or authorize:

- production implementation, MCP tools, JSON Schemas, adapter APIs, FFF SDK integration, Pi integration, pi-guard changes, or command syntax;
- a generic write, edit, delete, shell, network, package-management, or Git-mutation facility;
- a standardized database, signing system, approval UI, audit format, or final directory layout;
- automated approval based solely on validation, repository state, or generated content;
- direct ChatGPT-controlled execution; or
- a universal agent-specific configuration embedded in the core artifacts.

## Key Invariants

1. **Default deny:** Unknown, ambiguous, unsupported, or unauthenticated operations MUST be denied.
2. **No authority by content:** A prompt, repository file, artifact draft, schema-valid artifact, bundle, or result MUST NOT grant authority.
3. **Validation is not approval:** Validation MAY establish conformance only; it MUST NOT establish approval, issuance, a grant, or activation.
4. **Approval is digest-bound:** An approval MUST apply to the canonical digest of one artifact revision and MUST NOT survive a content change implicitly.
5. **Approval is not issuance or activation:** These are separate trusted local control-plane decisions.
6. **No self-approval:** ChatGPT Web MUST NOT approve, issue, activate, or grant authority for its own drafts.
7. **Ceilings only narrow:** Generated `AuthorityPolicy` and runtime grants MUST NOT expand trusted global or workspace ceilings.
8. **Deny wins:** Denials override allowances at every authority layer.
9. **Responsibilities remain separate:** Task, authority, context, completion criteria, execution composition, and execution result MUST NOT be merged into an unrestricted artifact.
10. **Project content is untrusted:** Project-visible artifacts and repository content MUST NOT become trusted runtime state by location or assertion.
11. **Discovery is not verification:** FFF discovery MUST NOT be represented as exhaustive completeness verification.
12. **No gateway execution path:** ChatGPT Web MUST NOT directly start Pi or downstream execution through the MVP gateway.
13. **Fail closed:** Unsupported required capabilities, extensions, or status checks MUST fail closed rather than silently downgrade.
14. **Persistence is not lifecycle authority:** A persisted project-visible proposal artifact remains unapproved/untrusted content until the trusted-local lifecycle separately approves/issues it.
15. **Loading is not authorization:** Loading validated artifacts into Pi as context grants no lifecycle authority.
16. **Zero-transfer is not zero-keystroke:** Short user invocations remain intentional user actions; they merely eliminate manual artifact transport.

## Unresolved Questions

No unresolved product-boundary decision blocks WP-0. The following are intentionally deferred to later, human-reviewed work packages and MUST be resolved before affected implementation begins:

- canonical artifact representation, digest calculation, revision identity, and cross-artifact reference rules;
- complete field-level artifact semantics, JSON Schemas, and validation error behavior;
- trusted local approver workflow, record retention, revocation propagation, and activation UX;
- concrete capability vocabulary and the trusted configuration format for global and workspace ceilings;
- execution-bundle issuance and runtime-grant lifecycle details;
- adapter contracts, consumer capability-negotiation protocol, and extension registry governance; and
- exact project-visible and trusted local directory layouts.

## WP-0 Completion Criteria

WP-0 is complete for human review when:

- this scope-and-principles document, ADR-001 through ADR-004, and the glossary exist and agree on the product, trust, artifact, and capability boundaries;
- all six artifact kinds have distinct responsibility boundaries without field-level schema design;
- ChatGPT self-approval, issuance, grants, activation, direct Pi execution, source editing, and Git mutation are explicitly prohibited;
- generated authority is constrained to the intersection of trusted ceilings, approved policy, runtime grant, and consumer support;
- project-visible artifacts are separated from trusted local approvals, grants, receipts, and audit state;
- FFF discovery is distinguished from exhaustive verification;
- no production implementation, tool design, schema design, dependency change, or integration work has been performed; and
- a human reviewer has the documents needed to accept, refine, or reject later protocol work.

Document completion does not itself approve an artifact, activate execution, or close WP-0. Human review remains required.

## Handoff Requirements for WP-1

WP-1 MUST treat this document, the accepted ADRs, and the glossary as architectural constraints. Before defining detailed artifact protocol work, WP-1 MUST:

1. preserve the six non-overlapping artifact responsibilities and the distinction between project-visible content and trusted local state;
2. define versioning, canonical representation, revision identity, and digest binding without allowing validation to confer authority;
3. define structural and semantic validation boundaries, including cross-artifact compatibility and extension handling;
4. define how approval, issuance, revocation, runtime grants, and receipts are represented by trusted local state rather than repository artifacts;
5. define capability negotiation such that unsupported required capabilities and extensions fail closed;
6. keep core artifacts consumer-neutral and route Pi-, pi-guard-, or future-consumer behavior through adapters or registered extensions; and
7. avoid MCP tool schemas, FFF APIs, Pi APIs, pi-guard modifications, and production implementation unless those are explicitly authorized by a subsequent work package.
