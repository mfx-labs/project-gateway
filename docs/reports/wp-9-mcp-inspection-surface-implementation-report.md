# WP-9 MCP Inspection Surface — Implementation Report (Slice 1)

**Slice:** WP-9 slice 1 — transport-free MCP inspection protocol/tool layer.
**Status:** implementation complete; candidate READY FOR INDEPENDENT REVIEW (this
report records the implemented slice only; acceptance is not declared here).
**Baseline:** `eb7feab9685faf9d971d93c79a9dfa691d635b7b` (WP-8 closure
assurance revalidated).
**Owned scope (roadmap):** read-only MCP tools for inspection (artifacts,
registry views, validation); prerequisites WP-7 and WP-4 satisfied; inspection
only, no mutation tools.

## 1. Slice Boundary and Rationale

WP-9 authorizes a read-only MCP inspection surface. No MCP transport/runtime
is normatively selected anywhere in the repository, no MCP SDK is installed,
and no product decision exists for server ownership (stdlib/stdio/SSE, host
process, or package). Installing or selecting a transport is therefore an
explicit non-goal of this slice (roadmap/planning rule: "stop that part and
report the exact gap"). The slice implements the complete protocol/tool layer
that any future transport shim hosts:

```
MCP request (JSON, transport-free)
→ strict closed-field adapter validation
→ existing domain API (WP-4 / WP-8 read / WP-8 registry)
→ deterministic public response mapping (redaction + closed error taxonomy)
```

The adapter is a pure routing boundary: it imports NO filesystem API and NO
mutation authority, and it reuses the accepted domain layers verbatim (no
duplicated walking, derivation, validation, history, Git, or storage logic).

## 2. Tool Inventory (closed, read-only)

| Tool | Domain backing | Request params | Response summary |
|---|---|---|---|
| `validate-artifact` | WP-4 `validateArtifactInput` (pure) | `content` (string, ≤ 1 MiB) | `valid`, kind, `instanceId`/`revisionId`/`digest` when valid, `schemaId`, `category`, `firstFailingPhase`, `level`, `ruleIds`, bounded `findings` |
| `inspect-stored-record` | WP-8 `readRecord` (exact verified read) | `recordClass` (closed accepted vocabulary), `recordId` (canonical typed identifier) | verified envelope model, `digest`, `byteLength`, `recordClass`, `recordId` |
| `inspect-registry` | WP-8 `deriveRegistryView` (authoritative derivation; optional verified persistent-index fast path) | `continuation?` (opaque), `usePersistentIndex?` (boolean, default false) | `source`, `recordsByClass`, `recordsByIdentity`, `latestResolvableRevision`, `duplicateConflicts`, `auditByPrimary`, `missingAudit`, `danglingAudit`, `findings`, `continuation?`, `indexState?` |

Validation never implies stored/approved/issued/active/authorized; the
`valid` flag is a pure WP-4 conclusion. Tool names use the repository's
kebab-case operation convention (no repository-specified MCP tool names
existed to reuse).

## 3. Request/Response Envelope and Validation

- `{ tool, params, requestId? }` — `requestId` is an optional opaque echo,
  bounded to 128 chars.
- Closed-field validation per tool; rejects: unknown request fields, unknown
  tool names, missing `params`, non-object params, wrong types, unknown
  parameter fields, malformed logical identifiers, path-shaped operands
  (`/abs`, `../`, `a/b`), non-canonical typed identifiers, unsupported
  `recordClass` values (including namespace-kind lookalikes such as
  `configuration`), oversized `content` (limit-exceeded), oversized
  `continuation`, and malformed/oversized `requestId`. Caller input is never
  coerced.
- Validation is hand-rolled closed-field checking (the repository pattern for
  authority boundaries); the WP-4 schema registry is used for artifact
  content validation exactly as the WP-4 API specifies.

## 4. Project/Store Targeting

The MCP client never selects roots, stores, or namespaces. The host
composition root supplies `createInspectionContext({ trustedConfiguration,
trustedInput, schemaRegistry? })`:

- the trusted input must be a **genuine branded** `TrustedStorageBootstrapInput`
  (WeakSet brand verifier only — no creator is imported);
- the trusted configuration must correlate by identity;
- the store is bound via the **strict** WP-8 `verifyStoreInstance` pipeline
  (both namespace metadata objects verified) — an unhealthy, malformed,
  foreign, or symlink-substituted store is rejected at construction;
- every request re-runs the domain's own per-request store revalidation
  (point-of-use discipline stays in the domain), so store-root substitution
  after construction fails closed (`integrity-conflict`).

## 5. Error Model

Closed public taxonomy (never internal errno/stack material):

| MCP code | Domain triggers |
|---|---|
| `invalid-request` | adapter validation failures; `ERR-STO-REQ-INVALID` without a continuation |
| `invalid-cursor` | malformed/tampered/query-mismatched continuation (adapter decode failure or domain cursor rejection) |
| `stale-cursor` | `ERR-STO-ROOT-IDENTITY-CHANGED` with a continuation (snapshot changed) |
| `not-found` | `ERR-STO-NOT-FOUND` |
| `unsupported` | `ERR-STO-UNSUPPORTED-VERSION` |
| `limit-exceeded` | `ERR-STO-LIMIT-EXCEEDED` and adapter size bounds |
| `integrity-conflict` | `ERR-STO-MALFORMED`, `ERR-STO-INTEGRITY`, store identity change without cursor |
| `adapter-error` | `ERR-STO-IO-FAILURE`, `ERR-STO-INTERNAL-INVARIANT`, `ERR-STO-CONFIG-UNAVAILABLE`, unknown codes — fixed message, no internals |

Fail-closed integrity conditions are never converted to empty success,
not-found, or partial success.

## 6. Bounds and Cursor Model

- Artifact content is bounded at the adapter (1 MiB, matching WP-4's
  `INPUT_BYTE_LIMITS.artifact`) before the domain call; the domain re-enforces
  its own bounds.
- Registry scans stay bounded by the store's limit profile
  (`totalScanEntries`/`totalScanBytes`) inside the domain; truncation reports
  `truncated` and carries a continuation — never silent truncation with a
  completeness claim.
- Continuations are opaque base64url encodings of the domain cursor objects
  (`ScanCursor`), bounded to 4096 encoded bytes. The adapter decodes and
  shape-checks only; the domain re-validates generation/surface/semantics
  (self-validating, query-bound, snapshot-bound, fail-closed on tamper or
  staleness). No filesystem-position cursor exists.

## 7. Read-Only and Non-Escalation Architecture

- The adapter imports only: WP-4 `validateArtifactInput`, WP-8 `readRecord`
  and `deriveRegistryView`, the trusted-input brand VERIFIER, the pure
  identifier/class validators, `verifyStoreInstance`, and `node:buffer`.
- No import of: `node:fs`, subprocess/shell, storage publication, recovery
  execution, retention execution, locks, configuration recovery mutation,
  capability/provenance creators, trusted-input creators, or the storage
  barrel. Enforced by the new MCP static guard.
- MCP requests carry no authority-shaped operands; results are deep-frozen
  plain data. Feeding an MCP result into any authority boundary confers zero
  authority (brands are module-private WeakSets; results are JSON data).

## 8. Redaction

Responses never include: raw host paths, descriptors, capabilities,
provenance tokens, permits, trusted-input internals, lock nonces, stack
traces, or internal errno strings. `adapter-error` uses a fixed message.
Verified record content returned by `inspect-stored-record` is the exact
verified public record model (digest- and location-verified by the domain);
malformed or conflicting stored content is never returned as verified data.

## 9. Package/Export Changes (documented)

- `package.json` exports gained exactly one subpath: `"./mcp"` →
  `./dist/adapters/mcp/index.js` (+ `.d.ts`), exposing only
  `createMcpInspectionSurface`, `createInspectionContext`, the closed tool/
  error vocabularies, the envelope types, and the pure cursor codec.
- The `test` script gained the focused glob
  `dist-test/tests/mcp/unit/*.test.js` and a `test:mcp` script.
- Two existing package-export guard assertions were updated to the new
  accepted state: `tests/unit/storage/static-guard.test.ts` (exports key set)
  and `tests/pointofuse-v2/boundary-v2.test.ts` (m-2 exports key set). No
  storage authority, publication owner, private recovery/retention type, or
  generic filesystem reader is exported.

## 10. Static Guards (new)

`tests/mcp/unit/static-guard.test.ts` proves the adapter:
- imports no filesystem/subprocess/shell/timers/randomness/environment APIs;
- imports only the exact read-only/pure domain allowlist (never the storage
  barrel, never mutation vocabulary);
- exports no authority creator/permit/raw reader from its entry point;
- is transport-free and dependency-free;
- `./mcp` maps to the adapter entry point only.

## 11. Tests

`tests/mcp/unit/inspection.test.ts` (11 tests) + `static-guard.test.ts`
(5 tests) = **19 focused tests, all passing**:

- schema boundary per tool (valid/missing/unknown/wrong-type/unsupported/
  oversize/malformed identifier/tampered cursor);
- domain equivalence (validate-artifact conclusion + ruleIds vs direct WP-4;
  inspect-stored-record digest/bytes/model vs direct WP-8 read;
  inspect-registry membership/conflicts/source vs direct WP-8 view);
- cursor round-trip, tamper, and staleness semantics;
- read-only proof (full store snapshot — paths/sizes/mtimes/modes — identical
  before and after exercising every tool including failing calls);
- target confinement (forged trusted input, mismatched configuration,
  uninitialized store, cross-store invisibility, namespace-root symlink
  substitution);
- error leakage (corrupted store metadata → closed mapped error; no paths,
  stacks, or raw content in responses);
- immutable deep-frozen results.

## 12. Regression Totals

- storage unit suite: 433 (431 pass, 2 existing privilege-gated skips);
- unit/integration/security/trusted/pointofuse-v2: 1086 pass;
- pi-adapter: 271 pass + the single accepted environmental mismatch
  (expected Pi `0.83.0`, installed `0.84.1`);
- process crash suite: 5 pass; WP-7 regression: 165 pass + discovery guard;
- default workflow (with the new mcp glob): **1377 total, 1376 pass, 1
  accepted Pi-version mismatch** — no additional unexplained failure;
- typecheck, build, test-TypeScript compilation, contract/hash guard, and
  `git diff --check` clean.

## 12a. Independent-Review Correction Note (F1)

The independent review of Slice 1 returned `CORRECTIONS REQUIRED` with one
substantive finding:

- **F1 (LOW, functional contract deviation): `validate-artifact` success
  responses failed to echo `requestId`.** The public envelope contract
  (`requestId` optional, opaque, bounded, echoed verbatim when supplied) was
  honored by `inspect-stored-record` and `inspect-registry` but not by
  `validate-artifact`: `runValidateArtifact` did not receive or forward the
  already-validated `requestId` on its success path.

Correction (narrowest consistent change): `runValidateArtifact` now accepts
and forwards the optional `requestId` through the SAME `okResponse` helper
used by the other two tools. No response format, envelope, type, error
taxonomy, or architecture change was made; validation-failure conclusions
remain MCP successes (`ok: true`, `result.valid: false`) with the requestId
echoed; absent requestId still invents no placeholder; error paths were
already echoing and are unchanged. New focused tests close the coverage gap
(valid + requestId, invalid-conclusion + requestId, no requestId,
invalid-request + requestId, limit-exceeded + requestId, cross-tool echo for
all three tools, and requestId never entering result payloads).

Slice 1 correction is ready for independent rereview; acceptance is not
declared here.

## 12b. Slice 2 — Audit-history inspection tool (`inspect-audit-history`)

Slice 2 adds exactly one bounded, read-only MCP-facing audit-history
inspection operation by routing the assurance-revalidated WP-8K
`inspectAuditHistory` API (the accepted read-only composition entry) through
the committed WP-9 adapter boundary. The closed tool inventory is now
exactly: `validate-artifact`, `inspect-stored-record`, `inspect-registry`,
`inspect-audit-history`.

- **Domain API reused:** `inspectAuditHistory` from
  `src/storage/read/index.js` (imported through the same read composition as
  Slice 1); `isHistoryTargetClass` from `src/storage/read/history.js` for
  the closed target vocabulary. No WP-8K production code was changed; no
  second history scanner exists.
- **Request schema:** `{ recordClass, recordId, revision?, continuation? }`
  — logical identifiers only; `recordClass` must satisfy the WP-8K inspected
  vocabulary (store-records classes excluding the audit class and bootstrap
  metadata; `authoritative-audit-event`, `store-metadata`, and
  non-store-records classes are rejected); `recordId` must be a canonical
  typed identifier; `revision` optional positive safe integer (domain
  default 1); `continuation` an opaque bounded cursor string.
- **Response schema:** `status`, `target`, `originalAuthorizedWrite`,
  `reconstruction`, `events`, `auditFindings`, `reconstructionEvidence`,
  `completeness`, `snapshot`, `findings` (mapped boundary findings), and
  `continuation` (opaque) — all exactly as the domain reports them.
- **Cursor model:** the Slice 1 generic base64url codec is reused (encoding
  is not authentication); the domain's `AuditHistoryCursor` self-validation
  owns all semantics (explicit `formatVersion`, store/target/query binding,
  `historySnapshotIdentity`, phase, resume position, tuple state). Malformed
  encodings/bindings map to `invalid-cursor`; a well-formed snapshot
  identity differing from the current history maps to `stale-cursor` (the
  domain's resume-time comparison); other boundary failures map through the
  committed taxonomy (`not-found` only for a genuinely absent target — a
  history gap is a status/finding inside an ok result, never `not-found`).
- **Semantics preserved:** normative D-8 tuple event ordering (never
  re-sorted), exactly-once findings/annotations across continuation pages,
  one history snapshot per walk (surface changes between pages fail closed),
  reconstruction/ambiguous/event-without-evidence distinctions, and
  completeness/status fields — all verbatim from WP-8K.
- **Read-only boundary:** the adapter imports no filesystem API and no
  reconstruction producer/mutator; the static guard now allows the
  read-only `history.js` dependency and still forbids every mutation
  surface. History results and cursors are plain frozen data and grant zero
  authority (probed by replay against the trusted-input brand boundary).
- **Focused tests:** 14 new tests (13 inspection + 1 static-guard inventory):
  clean single-page, multi-page walk,
  reconstructed-gap with evidence, event-without-evidence, conflicting
  history, stale continuation + irrelevant index change, cursor tamper
  matrix, cross-store cursor, not-found vs gap, schema boundary, requestId
  echo, redaction/non-escalation, read-only mutation watchdog).
- **Package/export changes:** none — the committed `./mcp` subpath is
  extended only.

## 13. Remaining WP-9 Work (not in this slice)

- **Transport/runtime ownership — exact open decision:** no MCP transport is
  normatively selected; a transport shim (MCP server runtime, stdio/SSE/SDK
  ownership, host process wiring) requires a product decision and is
  explicitly out of this slice.
- Verify-by-identity and enumeration MCP tools.
- Multi-store surface registration (currently one verified store per
  surface instance).
- WP-9 generation seeding (rides with WP-9 per the WP-8 planning note).
- Transport/runtime ownership remains the exact open product decision
  (unchanged; not part of Slice 1 or Slice 2).
