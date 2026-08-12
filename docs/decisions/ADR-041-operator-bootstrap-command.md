# ADR-041 — Operator-Only Bootstrap Command (trusted-store initialization surface)

**Status:** Accepted (PS-1, human-authorized pi-shuttle contract).
**Applies to:** the local stdio MCP runtime CLI (`project-gateway-mcp`) and
the trusted local control plane.
**Related:** ADR-028 (bootstrap locator, WP-8-C decisions C/F), ADR-024
(trusted configuration), WP-8-C (`initializeTrustedStore`), the WP-8-D
creator-consumer edge contract (`src/storage/trusted-input/
bootstrap-input.ts`), the storage static guard's creator edges, and the
pi-shuttle product contract (PS-0/PS-1).

## Context

Trusted-store initialization is complete, tested, and replay-safe, but was
production-unreachable: `initializeTrustedStore()` requires a genuine
branded `StorageBootstrapActionProvenance`, whose only declared production
consumer (`src/control-plane/storage-bootstrap-action.ts`) did not exist,
and the runtime composition root deliberately re-verifies stores without
initializing them (SRX-012: initialization is an explicit
control-plane-authorized action). A fresh end-user installation therefore
could not provision a trusted store through any supported production
workflow.

## Decision

1. **One operator-only CLI verb** `project-gateway-mcp bootstrap
   --config <file> [--output <file>]` makes initialization reachable.
   The verb is dispatched before the MCP path and never starts the MCP
   server; it is not an MCP tool, is not reachable through the tunnel or
   ChatGPT, and grants no model-accessible authority.
2. **The reserved production provenance consumer is implemented** at the
   contract-designated location `src/control-plane/storage-bootstrap-action.ts`
   (I/O-free; host observation injected through the WP-6 resolver seam).
   It is the only production module — together with the runtime
   composition root, which re-verifies only — allowed to import
   `createStorageBootstrapActionProvenance` (static-guard enforced).
3. **Identity is derived, never caller-trusted.** The verb builds the
   trusted configuration through the committed WP-6 Phase-1 validation
   pipeline and computes `configurationIdentity` through
   `computeTrustedConfigurationIdentity`. A caller-supplied identity is
   accepted only when it equals the derived identity; otherwise the action
   fails closed before any storage mutation. Normal `--config` startup
   continues to REQUIRE a concrete identity (two load profiles, one
   shared closed validator).
4. **Initialization reuses the accepted orchestrator unchanged**:
   `initializeTrustedStore()` provisions absent stores and replay-verifies
   initialized ones (exact idempotent replay, zero writes); partial,
   foreign, unsupported-version, drifted, wrong-identity, wrong-mode, and
   forbidden-root states fail closed with typed codes and are never
   repaired. Post-initialization verification reuses the committed
   store-instance pipeline.
5. **The trusted parent must already exist** as an operator-owned `0700`
   directory; the bootstrap verb (like the engine) never creates parents.
6. **The resolved runtime configuration is emitted deterministically**
   (`--output` atomic `0600` no-clobber, or stdout JSON when omitted) and
   contains no provenance, action identity, capability, or brand.
7. **No new write class and no new authority:** the verb's only
   filesystem writes are the bootstrap-owned trusted state (through the
   accepted orchestrator) and the operator config output file. The
   nine-tool MCP surface is unchanged.

## Consequences

- The fresh-install blocker is closed with the smallest correct surface:
  no second initializer, no generic administrative API, no MCP exposure.
- `pi-shuttle project add` composes this verb as a pinned subprocess and
  never touches storage internals.
- Re-runs are verification-only; re-bootstrapping after a later
  configuration change fails closed (identity conflict) rather than
  silently re-authoring state.
- The static guards now pin the exact producer edges; any future
  production importer of the bootstrap provenance creator fails the
  storage static guard.

## Alternatives considered

- **Start-time `initializeIfAbsent` flag** — rejected: would make the
  read-mostly runtime mutate storage on every start, weakening the
  explicit-action posture and risking initialization at a misconfigured
  locator.
- **Composition-side (pi-shuttle) initialization** — rejected: would
  duplicate the storage engine and cannot reach the process-local
  provenance brands; importing private internals is forbidden.
- **Exposing initialization through MCP** — rejected: initialization
  authority must never be model-callable or ChatGPT-accessible.
