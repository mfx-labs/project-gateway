# ADR-017 — Artifact Core Language and Module Boundary

## Status

Accepted

## Context

WP-0 through WP-3 define a deterministic, consumer-neutral artifact protocol with
machine-verifiable schemas and a conformance corpus. WP-4 must realize the
protocol as a production library without becoming an MCP server, store,
lifecycle authority, adapter, or runtime service.

## Decision

The Artifact Core Library is implemented in TypeScript (strict, ECMAScript
modules) targeting the locally supported Node.js 22 runtime, published under the
private package identity `@project-gateway/artifact-core`. The production core
performs no hidden I/O: no filesystem, network, Git, process, shell, secret, or
wall-clock access. Protocol semantics are consumer-neutral and never depend on
Pi, pi-guard, Codex, Cline, or any adapter.

All external state is supplied through explicit injected interfaces: identity
state view, exact-subject resolver, accepted registry context, consumer support
declaration, lifecycle records, revocations, ceilings, and current time. The
package boundary exposes only reviewed public modules; internal registries,
parser internals, validator instances, and dependency-specific types are never
exported. A deterministic generation script mirrors the committed WP-3 schemas
and fixtures into `src/generated/` so the runtime is fully offline.

## Rationale

Strict TypeScript over Node built-ins minimizes the trust surface, keeps the
core deterministic and side-effect constrained, and matches the repository's
Node 22 environment. Injection keeps the core reusable by any future adapter
while preserving the no-I/O policy.

## Consequences

- Production dependencies are minimal: Ajv 8.20.0 (Draft 2020-12) is the only
  runtime dependency; TypeScript and `@types/node` are development-only.
- The core can never be confused with a lifecycle authority or execution
  controller.
- Future adapters must implement the injected interfaces and treat validation
  reports as conformance output, never as trusted state.

## Rejected Alternatives

1. **Runtime I/O library (filesystem/network access to schemas):** Rejected
   because it violates the no-I/O core policy and couples the library to its
   packaging location.
2. **Adapters or MCP surfaces inside the core:** Rejected because consumer
   neutrality and the trust boundary require them to be separate work.
