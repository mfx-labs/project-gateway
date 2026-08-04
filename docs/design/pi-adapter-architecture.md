# Pi Adapter Architecture (WP-5A)

**Status:** Normative WP-5A design
**Module boundary:** `src/adapters/pi/**`, package subpath `@project-gateway/artifact-core/pi-adapter`

## Role of WP-5A

WP-5A implements the first consumer adapter for Project Gateway: a
deterministic, fail-closed adapter that converts an **already validated and
point-of-use-eligible ExecutionBundle** (plus its four exact resolved
prospective members) into a Pi-compatible invocation plan and observes
Pi-compatible completion output through a narrow host bridge.

The adapter covers **projection and observation only**:

- Artifact Core validation is not approval.
- Point-of-use eligibility is not Pi execution.
- Pi invocation-plan creation is not activation.
- The Pi adapter creates or widens no authority.

## Boundary with Artifact Core

- Inputs are **validated Artifact Core wrappers** (`ValidatedArtifact`) at
  use-suitable validation levels (bundle ≥ `point-of-use-eligible`; members ≥
  `registry-compatible`), verified by runtime membership branding. Raw artifact
  JSON is never accepted.
- The adapter consumes narrow root exports only: `isBrandedArtifact`,
  `isLevelAtLeast`, `snapshotJson`, `exactReferencesEqual`, and the
  `EligibilityReport`/`ImmutableModel`/`ValidationLevel`/`RequestedUse` types.
- The root Artifact Core API acquires no Pi-specific types; the adapter lives
  under its own subpath and is not re-exported from the root namespace.

## Boundary with pi-guard (WP-5B)

- WP-5A does **not** implement pi-guard authority projection, tool
  allowlisting or denial, mode switching, or RuntimeGrant/AuthorityPolicy
  enforcement inside Pi.
- Every plan explicitly states that pi-guard enforcement is pending; the plan
  status is always `projection-ready` and never `authorized`, `approved`,
  `activated`, `executable`, or `granted`.
- WP-5B will consume the plan and apply authority projection into pi-guard.

## Input and Output Flow

```
ValidatedArtifact (bundle + 4 members)
  + EligibilityReport (eligible, correlated)
  + AcceptedRegistryContext
  + occurrenceId / attemptId (caller-supplied)
  + PiHostCapabilityDeclaration
  + resolved context items (caller-supplied)
  + AdapterLimits
        │
        ▼
projectExecutionBundleToPi(input)
        │  (exact-reference correlation, capability check,
        │   context correlation, deterministic render)
        ▼
PiInvocationPlan (immutable, branded, projection-ready)
        │
        ▼
createPiHostBridge(surface, plan) ──► armInjection() ──► observe()
        │
        ▼
PiExecutionObservation (immutable, branded; not an ExecutionResult)
```

## No-Authority Guarantee

- TaskSpec is the only artifact that may supply imperative task intent.
- ContextManifest content is untrusted data and is never promoted to system,
  developer, policy, tool-authorization, lifecycle, or adapter configuration.
- CompletionContract supplies prospective completion criteria only; Pi is
  never instructed to self-certify, approve, or issue receipts.
- AuthorityPolicy is correlated by exact reference and digest only; its
  allow/deny content is never rendered as executable instructions.
- RuntimeGrant is never interpreted or enforced by WP-5A.
- Tool-call observation never implies permission; the bridge never blocks,
  enables, disables, or mutates tools.
- WP-5A does not read or interpret Pi tool inventory; tool inventory and
  authority projection are reserved for WP-5B.

## Pure Projection versus Host Bridge

- **Projection** (`projection.ts`, `render.ts`, `context.ts`,
  `compatibility.ts`) is a pure function: equal inputs produce byte-equivalent
  plans with no time, random, process, or environment-dependent content. All
  textual limits are measured in UTF-8 bytes (one authoritative text-bound
  model; truncation never splits a Unicode scalar).
- **Host bridge** (`host-bridge.ts`, `observation.ts`, `host-harness.ts`) is a
  narrow structural binding to the public Pi 0.83.0 extension API subset. The
  injection contract is hook-driven: `armInjection()` only arms the plan
  (idempotent), and the registered `before_agent_start` handler performs the
  actual injection on each host event — one injection per event, so repeated
  turns may legitimately receive repeated injection. The integration layer is
  responsible for registering exactly one bridge per host surface; WP-5A keeps
  no mutable global host registry. The bridge observes session/turn/message/
  tool/settle/shutdown events as data. Actual Pi imports are environment-gated
  (`PGW_PI_PACKAGE_PATH`); the harness never starts Pi, sends a model request,
  executes tools, or modifies configuration.

## Trusted and Untrusted Data

| Data | Trust | Handling |
| --- | --- | --- |
| Adapter preamble | trusted (static adapter code) | section boundaries and untrusted-data warning |
| TaskSpec content | validated artifact | task section (only instruction-bearing section) |
| ContextManifest metadata | validated artifact | context inventory (metadata only) |
| Resolved context items | untrusted caller data | length-prefixed untrusted data blocks |
| CompletionContract | validated artifact | criteria for later assessment |
| AuthorityPolicy | validated artifact | non-operative correlation only |
| Pi host events/timestamps | untrusted observations | captured as data (only when the host supplies them; `turn_start` is the only public 0.83.0 timestamp source), never lifecycle time |
| Pi completion output | untrusted observation | never an ExecutionResult or TrustedReceipt |

## Deterministic Rendering

Fixed-order segments (preamble, task, context inventory, context data,
completion criteria, correlation footer); fixed delimiters; length-prefixed
context blocks so content can never escape its boundary; deterministic
ordering of members, context items, findings, and correlations.

## Future WP-5B Integration

WP-5B will add authority projection into pi-guard using the same validated
subjects and the plan's correlation metadata. WP-5A intentionally leaves the
authority surface untouched so WP-5B can consume the projection without
re-deriving eligibility.
