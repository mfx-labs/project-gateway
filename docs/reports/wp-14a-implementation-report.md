# WP-14A Implementation Report — ChatGPT Connectivity and Controlled Producer Surfaces

**Work package:** WP-14A (first WP-14 slice; human-authorized).
**Phase:** implementation candidate — NOT committed, NOT closed. Review
gate: senior review.
**Baseline:** `a6d00a744802c3de1548b4a4c72af424bf2e83ad` (`docs: establish
WP-14 zero-transfer contract`; branch `main`).
**Nothing staged or committed.** No push/tag/release/deploy. WP-14B,
WP-14C, WP-15 not begun.

## 1. Baseline and Scope

Implements the two WP-14A MCP operations per ADR-040 and the WP-14
pre-implementation contract decision:

1. **`persist-artifact`** — controlled proposal persistence (Model B) over
   the committed WP-11 core;
2. **`inspect-changes`** — stateless changed-context inspection composed
   from the committed WP-7 controlled Git/file boundaries.

Closed runtime vocabulary after WP-14A: **exactly nine registered tools**
(six WP-9 inspection + `draft-artifact` + the two above).

## 2. Files Changed

**New source:**
- `src/adapters/mcp/persist.ts` — transport-free, I/O-free Model-B
  persistence adapter + `McpPersistRegistry` (`persist-artifact`).
- `src/adapters/mcp/changes.ts` — transport-free, I/O-free stateless
  changed-context adapter + `McpChangesRegistry` (`inspect-changes`).
- `src/runtime/mcp/lanes.ts` — host-owned WP-14A lane construction (real
  resolvers, genuine validated configuration, WP-11 executor wiring, WP-7
  service construction).

**Modified source:**
- `src/adapters/mcp/index.ts` — exports for the two new adapters.
- `src/runtime/mcp/config.ts` — `SurfaceConfig` gains optional
  `workspaces` (workspaceId/root/artifactLocation) and `gitPath`.
- `src/runtime/mcp/compose.ts` — builds the persist/changes registries;
  per-surface lanes via `buildWorkspaceLanes` (async composition).
- `src/runtime/mcp/server.ts` — registers the two new tools (nine total).
- `src/runtime/mcp/cli.ts` — awaits composition; passes the two new
  registries.

**Tests:**
- New: `tests/mcp/unit/persist.test.ts` (10 tests), `tests/mcp/unit/changes.test.ts` (10 tests).
- Updated: `tests/mcp/unit/static-guard.test.ts` (allowlist for the two
  adapters' imports — `writing`, `trusted`, `reader`; one-tool WP-14A
  vocabularies; Model-B envelope assertions),
  `tests/runtime/static-guard.test.ts` (exactly-nine registration
  assertions), `tests/runtime/server.test.ts` (nine-tool inventory,
  WP-14A schemas, laneless `unsupported` outcomes, async composition),
  `tests/runtime/stdio.test.ts` (nine tools over the real CLI; WP-14A
  fail-closed `unsupported` on laneless surfaces).

## 3. Chosen Tool Names

- `persist-artifact` (proposal persistence; `MCP_PERSIST_TOOLS`).
- `inspect-changes` (changed context; `MCP_CHANGES_TOOLS`).

## 4. Persistence Architecture (Model B)

Closed request envelope: `{ workspaceId, kind, content, requestId? }`.
`content` is the raw JSON candidate artifact envelope with
`revision.digest` ABSENT. The adapter:

1. gates the exact four WP-11-writeable kinds
   (`ARTIFACT_DRAFT_LOCATION_KINDS`) — `ExecutionBundle`,
   `ExecutionResult`, lifecycle records, and lookalikes are rejected as
   `unsupported-artifact-kind` before any validation;
2. runs the accepted WP-10 validation composition
   (`createDraftProposalWithSchemaRegistry` under the surface's exact
   schema registry): structural → semantic → canonicalization → trusted
   digest/correlation, producing a **freshly host-produced**
   `ValidDraftProposalResult` — caller `ok`/`valid`/`canonicalUtf8`/
   digest/flags are never accepted (unknown envelope fields →
   `invalid-request`; a caller-supplied `revision.digest` inside content
   is derived-member forgery and fails);
3. derives the destination deterministically from the validated identity
   — `<kind>.<instanceId>.<revisionId>.json`, a single
   artifact-root-relative component (schema-enforced `pgw:i:`/`pgw:r:`
   patterns guarantee a safe component; defensive guard fails closed);
   zero path transcription, no caller destination;
4. invokes the committed WP-11 `persistValidatedArtifactDraft` with the
   host lane (`expectedConfigurationIdentity` = the genuine validated
   configuration's computed identity; the resolver and executor are
   host-injected) — create-only, prospective + point-of-use containment,
   digest re-correlation, descriptor-anchored exclusive create, service-
   user ownership, bounded redacted evidence.

`draft-artifact` is not a prerequisite; material that originated there is
still independently revalidated. Persisted bytes are exactly the trusted
canonical bytes (proven by tests against the independent draft-core
canonicalUtf8). No lifecycle/ExecutionResult/TrustedReceipt/configuration/
source-file/arbitrary persistence exists; no store/control-plane import.

## 5. Model B Validation Continuity

`candidate → structural → semantic → canonicalization → trusted
digest/correlation → internal validated draft → WP-11 write request →
write evidence`; continuity pinned across kind → instance/revision
identity → canonical bytes → digest → validation result → write request →
evidence. Substitution/mismatch fails closed (WP-11 shape + digest
re-verification; the executor writes the accepted bytes verbatim). No
validation handles, session state, or caches as authority.

## 6. WP-11 Reuse

The committed `src/writing/**` core is consumed unchanged — no WP-11
redesign, no later WP-11 slice. The real host executor
(`executeDraftFileWrite`) and the real prospective-destination resolver
(`lanes.ts`) are wired at the composition root. Resolver behavior mirrors
the accepted WP-11 test-lane resolver with hardened failure evidence.

## 7. Changed-Context Architecture

Closed request envelope: `{ workspaceId, diff?, paths?, requestId? }`.
Flow: fresh WP-7 `git-status` at point of use → changed-file set → optional
bounded `git-diff` → optional content reads for a requested subset via the
WP-7 `read-text` boundary (64 KiB cap per file). Stateless: no
`ActiveContext`, no `HotkeyRecord`, no context database, no persistent
event protocol, no global snapshot.

## 8. Changed-Set Membership Confinement

Content reads are limited to the freshly resolved Git-derived changed set:
a non-member path fails the WHOLE request with `membership-denied` (no
silent partial success). Each read re-runs the WP-7 read boundary, which
independently reapplies workspace containment and point-of-use checks —
escape/drift fails closed through typed semantics (proven by the
symlink-escape test). Binary/unsupported/malformed content delegates to
WP-7 typed outcomes (`content-unreadable`). Bounds: 250 reported files
with truthful `truncated`, 8 content paths, 1024-char path cap, 64 KiB per
file. Unrelated authorized files belong to the existing inspection
surfaces.

## 9. Runtime / Composition Changes

- `createMcpServer` now takes four registries and registers exactly nine
  tools; `persist-artifact` carries no `readOnlyHint` (it is the one
  controlled write), `inspect-changes` is read-only.
- Per surface: one `SchemaRegistry` shared by inspection/drafting/persist
  (same-instance validation context); lanes built only when the operator
  configured `workspaces`; laneless surfaces keep the tools but serve the
  typed `unsupported` outcome (never invented lanes).
- SDK schemas are shape/type only (no kind enum, no byte ceilings —
  `unsupported-artifact-kind`/`limit-exceeded` stay reachable inner
  outcomes).
- Static guards updated: exactly nine `registerTool` calls, six inspection
  registrations, one each drafting/persist/changes; no generic
  save/write/publish/approve/issue/execute/activate/revoke tool names.
- The `src/adapters/mcp` import allowlist extended for the two adapters
  (`writing`, `trusted`, `reader` boundaries; still no fs/subprocess/SDK).

## 10. Authority-Isolation Evidence

- Persistence creates only the one WP-11 artifact draft file; no lifecycle
  record, no store/control-plane write, no pi-guard state, no
  TrustedReceipt (negative evidence: adapter imports exclude storage
  mutation, publication, capability, and provenance creators; static
  guards pass).
- Changed context performs only controlled WP-7 reads.
- Transport authentication remains outside the Gateway; no HTTP/OAuth/TLS/
  token/tunnel-daemon/scheduler/secret-storage code exists (runtime static
  guard network/auth/tunnel/subprocess checks pass unchanged).
- Persisted artifacts remain untrusted proposals (ADR-040).

## 11. Secret / Config Boundary

`SurfaceConfig` carries no credential fields; lanes never read secrets.
Tunnel/auth credentials stay operator-local with the external
tunnel/platform (ADR-040 Decision D). Gateway runtime configuration
remains secret-free; errors and evidence are redacted (no absolute roots,
no errno, no host details).

## 12. Focused Tests Run and Results

| Suite | Result |
|---|---|
| `tests/mcp/unit/persist.test.js` (10 new) | 10/10 |
| `tests/mcp/unit/changes.test.js` (10 new) | 10/10 |
| `tests/mcp/unit/*` (incl. static guard, inspection, drafting, registry) | 96/96 |
| `tests/runtime/*` (server, static guard, stdio nine-tool) | 31/31 |
| `tests/writing/*` (WP-11 neighbor) | 50/50 |
| `tests/drafting/*` (WP-10 neighbor) | 22/22 |
| `tests/security/security.test.js` | 15/15 |
| WP-7 discovery guard | OK |

Coverage per the authorization: all four kinds; unsupported-kind rejection;
forged-provenance rejection; independent validation; invalid
structural/semantic rejection; canonical-byte/digest/write continuity;
substitution fail-closed; create-only; containment/ownership/redaction;
no generic write operands; no lifecycle/ExecutionBundle/ExecutionResult/
TrustedReceipt persistence; fresh changed-set; status/diff; content subset;
unrelated-path rejection; symlink-escape drift fail-closed; binary
delegation; bounds; truncation; routing; exactly-nine runtime inventory.

## 13. Known Limitations

- Destination layout is the adapter-derived flat
  `<kind>.<instanceId>.<revisionId>.json` convention (single-component
  create invariant); a future canonical layout convention would be a
  WP-14A amendment, not a WP-11 change.
- Changed-context diff output is bounded by the committed WP-7 Git output
  ceiling (8 MiB) — no smaller adapter diff cap; acceptable per the
  committed WP-7 limits.
- Live ChatGPT/tunnel smoke remains WP-14B (operationally gated).
- Git lane requires the pinned supported Git binary (2.45.4); a
  non-conforming `gitPath` fails composition with a typed error.

## 14. Git State

- HEAD unchanged: `a6d00a744802c3de1548b4a4c72af424bf2e83ad`.
- Nothing staged, nothing committed; no push/tag/release/deploy.
- Pre-existing untracked WP-13D leftovers untouched.

WP-14A IMPLEMENTATION COMPLETE — READY FOR SENIOR REVIEW
