# WP-12 Slice 2A — Implementation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Slice:** 2A — Revocation (first internal phase of Slice 2; the roadmap
Slice-2 closure unit also contains 2B `verifyCurrentLifecycleState`).
**Phase:** implementation complete — focused tests green (twice) — full
regression acceptable (sole known environmental Pi F8) — focused
correction applied (SIR-W12-S2A-001/002/003) — awaiting focused senior
rereview. Uncommitted, unstaged (per authorization). Not self-approved.

## 1. Baseline

Repository `/home/chef/Documents/Project_Gateway_MCP`; branch `main`; HEAD
`35f97a2e877e64d35ec23d87fded86af6ac6c654` (`docs: establish WP-12 slice 2
contract baseline`, parent `7282b3b7…`); working tree clean; staging empty;
`git diff --check` clean. Verified before any edit.

## 2. Exact files changed

Production (5 modified, within `src/control-plane/`; no new production
module — minimal extension of the closed family):

- `src/control-plane/types.ts` — operation union + `revoke`; Slice-2A
  target/scope vocabularies; `revokerRole` (optional host-asserted role);
  `revoked` outcome; registry-echo/request field types.
- `src/control-plane/subject.ts` — exact-key revoke request capture
  (target type/ID, scope, effectiveAt, reasonCode, required registry
  echo); role-assertion keys extended (revoker/revocation role tokens).
- `src/control-plane/records.ts` — `buildRevocationRecordPayload`
  (fixture/schema-shaped; no invented fields).
- `src/control-plane/core.ts` — revoke operation body: registry-echo
  correlation, workspace resolution, pre-lock locator read, target-derived
  coordination key, under-lock decision (re-read target → re-read
  revocation state → duplicate detection → build → schema gate → publish →
  verify), dispatch + role gate.
- `src/control-plane/store-boundary.ts` — primary publication-class set
  extended from 3 to 4 (`validation-record`, `approval-record`,
  `issuance-record`, `revocation-record`); WP-8 unchanged.

Tests/helpers (2 new + 2 modified):

- `tests/unit/wp12-revoke.test.ts` (20 tests) — pure-core focused suite.
- `tests/unit/wp12-revoke-store.test.ts` (8 tests) — REAL WP-8 store
  integration suite (SCR-W12-S2-004 requirement).
- `tests/unit/wp12-helpers.ts` — `revokerRole` override; mutable fake-store
  failure flags.
- `tests/unit/wp12-static-guard.test.ts` — Slice-2A revocation vocabulary
  confined to its modules; Slice-3+ ban unchanged; publishable-class set
  updated to exactly four.

No source outside `src/control-plane/` changed; no WP-4/WP-6/WP-8/WP-11
source, schema, fixture, package, lockfile, or generated file changed.

## 3. 2A architecture

Transport-free extension of the closed Slice-1 family: one new operation
`revoke` in the same injected-boundary pattern (untrusted exact-key
request → host-injected trusted context → process-local decision
coordination → single WP-8 publication). Revocation state is append-only
`RevocationRecord`s; currentness is derived later by Slice-1's existing
consumption (`currentnessOf`) and by 2B. No second state machine, no new
lock system, no new store, no new audit path.

## 4. Request/trusted-context separation

Request carries only: `operation`, `workspaceId`, `targetRecordType`,
`targetRecordId`, `scope`, `effectiveAt`, `reasonCode`, `registryEcho`.
Host injects: genuine WP-6 configuration, trusted workspace resolution,
authoritative registry context, revocation role, operator identity,
trusted time source, WP-8 store boundary, process-local coordinator,
record-ID source, write-action provenance. Request cannot supply any
authority-bearing object (exact-key capture rejects unknown keys;
descriptor-derived snapshot hardening rejects hostile structures).

## 5. Revocation role model

Distinct host-asserted `revokerRole` gate (`!== true` →
`lifecycle-state-missing`), separate from `approverRole`/`issuerRole`;
colocation allowed but roles remain distinct gates. Any request attempt to
assert/transport ANY trusted operator role (incl. revoker/revocation
tokens) → `approver-not-independent` (token name retained per contract;
no `revoker-not-independent`). No artifact operand, reasonCode, registry
echo, digest, or model instruction can confer revocation authority —
proven by runtime tests.

## 6. Request shape

`operation: 'revoke'` + `workspaceId` (pgw:w: syntax) + `targetRecordType`
(`ApprovalRecord` | `IssuanceRecord`) + `targetRecordId` (pgw:l: syntax) +
`scope` (`all-uses` | `execution-use`) + `effectiveAt` (accepted UTC
timestamp) + `reasonCode` (schema pattern `^[a-z][a-z0-9-]{0,63}$`,
≤64) + `registryEcho` (exact keys `registry_snapshot_id`,
`registry_snapshot_digest`). Per-operation exact-key set enforced;
unknown keys → `request-invalid`.

## 7. Registry echo semantics

REQUIRED untrusted correlation-only operand. Missing/malformed (shape,
id/digest syntax) → `request-invalid`; differing from the host-injected
accepted context (id or digest) → `registry-context-mismatch`; matching →
continue. The echo never selects, downgrades, or overrides the
authoritative host registry.

## 8. Target lookup / non-disclosure

Class-scoped read (`approval-record`/`issuance-record`). Nonexistent
target and out-of-workspace target both → `lifecycle-state-missing` with
identical public category and message (test-asserted); no existence,
type, content, workspace, or path disclosure. Malformed target ID/type →
`request-invalid`; malformed/unreadable authoritative stored target →
`store-failure`.

## 9. Operational target classes

Exactly `ApprovalRecord` and `IssuanceRecord`. `RuntimeGrant` and
`ResultPublicationRecord` revocation NOT pulled forward (later slices).
Immutable/historical classes (ValidationRecord, ActivationRecord,
ExecutionOccurrenceRecord, ExecutionAttemptRecord, TrustedReceipt,
SupersessionRecord, ExecutionSummaryRecord, MigrationRecord,
AuthoritativeAuditEvent) rejected at capture → `request-invalid`
(LFC-005/006 preserved; schema target enum unchanged).

## 10. Scope semantics

Operation-level validation for Slice-2A targets: `all-uses` and
`execution-use` only; publication/result-only scopes and malformed scopes
→ `request-invalid`; never reinterpreted as `all-uses`. Applicability is
derived at point of use (target ID exact ∧ scope all-uses-or-matching ∧
`effectiveAt <= trustedNow`). Duplicate detection (SIR-W12-S2A-001,
corrected) distinguishes TWO rules: EXACT-SCOPE repeats (same target type
+ same target record ID + exact same scope) are existence-based — even a
future-dated same-scope record conflicts (one-way replay, contract §10);
CROSS-SCOPE subsumption (existing `all-uses` over new `execution-use`)
blocks ONLY when the existing record is EFFECTIVE (`effectiveAt <=
trustedNow`, contract §25.2 E + §25.8 applicability) — a future-dated
`all-uses` record is valid but not yet applicable and does NOT block an
effective `execution-use` revoke; BROADENING (`execution-use` then
`all-uses`) is always allowed (execution-use never subsumes all-uses).

## 11. effectiveAt / time model

Accepted timestamp syntax; MAY be future-dated (no invented window);
effective when `effectiveAt <= trustedNow`; equality effective. Time
source: host-injected `identity.nowUtcIso()` only — no ambient
`Date.now()` path added (static guard: no `Date.now(` in the family).
Malformed → `request-invalid`. The record exists immediately; no delayed
mutation machinery.

## 12. reasonCode semantics

Bounded descriptive metadata only; never affects authority, scope,
applicability, ordering, priority, currentness, or target selection.
Malformed → `request-invalid`. No reason policy engine.

## 13. Old-registry target model (C6)

A genuine historical ApprovalRecord/IssuanceRecord created under an older
registry snapshot MAY be revoked; the target's own
`registry_snapshot_reference` is NOT required to equal the current
accepted context for targetability. The new RevocationRecord MUST bind the
current host-injected accepted context; the request echo must match it.
Target identity/workspace/authority correlation stays exact; no target
rewrite, migration, or re-issuance (real-store test: old-registry target
revoked, target byte-identical, new record binds current registry).

## 14. Coordination-key reuse

The exact Slice-1 key encoding is reused
(`${kindId}|${instanceId}|${revisionId}|${digest}|${workspaceId}`),
derived from the TARGET's canonical subject — never keyed by target record
ID alone — so revoke competes with issue/re-approval for the same
lifecycle subject (test: recorded issue and revoke keys are identical for
the same subject).

## 15. Pre-lock locator read

One class-scoped read before lock acquisition to establish existence,
basic parseability, workspace eligibility (non-disclosure), and the
coordination key. It is NOT decision authority; no pre-lock state is
retained for the decision.

## 16. Under-lock revalidation

Under the process-local lock (fixed order per contract §15): re-read
target → verify existence/class/workspace → re-read `revocation-record`
class → revalidate echo/current host context → detect duplicate →
build candidate → accepted schema pipeline gate (`validateLifecycleRecord`;
LFC-005/006 enforced structurally) → publish exactly one RevocationRecord
via WP-8 → verify durable outcome → release in `finally`. Stale pre-lock
state never decides.

## 17. Revoke-vs-issue race

Proven on real store: issue completes first → revoke re-reads and succeeds
afterward; revoke completes first → later issue fails
`approval-revoked`; true overlap under a manually held key → both fail
fast `lock-conflict`. No stale pre-lock decision can succeed after the
competing mutation; no cross-process exclusion claimed.

## 18. Duplicate semantics (corrected per SIR-W12-S2A-001)

Two distinct duplicate rules, both closed-token (`lifecycle-conflict`):

1. EXACT-SCOPE REPEAT — same target record type + same target record ID +
   exact same scope → `lifecycle-conflict` REGARDLESS of effectiveness
   (one-way replay, contract §10; a future-dated exact-scope record still
   blocks a repeat).
2. CROSS-SCOPE SUBSUMPTION — existing `all-uses` + new `execution-use` →
   `lifecycle-conflict` ONLY when the existing record is effective at
   trustedNow (contract §25.2 E + §25.8: a revocation "applies when …
   effectiveAt <= trustedNow"). A future-dated `all-uses` record does NOT
   block the narrower revoke; both records may legitimately coexist
   (pending broad + effective narrow), each immutable.
3. BROADENING — existing `execution-use` + new `all-uses` → allowed,
   provided no exact-scope `all-uses` duplicate exists; `execution-use`
   never subsumes `all-uses`.

Zero new publication on any duplicate denial; identity never inferred
from record ID alone; target unchanged.

## 19. RevocationRecord construction

Exact schema fields: `record_type`, `record_id`, `created_at`,
`responsible_role: 'trusted-revocation-authority'`,
`registry_snapshot_reference` (current accepted context via the accepted
`registryReferenceFor` pattern), `target{record_type, record_id}`,
`scope`, `effective_at`, `reason_code`. No workspace field invented
(schema has none). Reuses the accepted record-ID source, trusted time
source, payload builder pattern, schema pipeline, and envelope digest
machinery. No second builder framework.

## 20. WP-4/schema reuse

No second lifecycle targeting evaluator: the RevocationRecord schema gate
(accepted `validateLifecycleRecord` pipeline) enforces LFC-005/006 target
semantics; revocation applicability semantics match the accepted WP-4
point-of-use `effectiveAt <= at` rule; `mapGraphFindings`/graph machinery
untouched (revoke is a targeting/current-state operation; no forced
candidate lifecycle evaluation). Unknown/unmapped blocking findings fail
closed (`internal-failure` on schema-gate rejection).

## 21. WP-6 reuse

No new capability token (`project-gateway.revocation-operate` NOT
invented — contract §22). Runtime-genuine configuration
(`isGenuineValidatedTrustedWorkspaceConfiguration`) and trusted workspace
resolution (`lookupValidatedWorkspace`) still anchor host-context
genuineness and workspace authorization; no caller-supplied config or
workspace authority.

## 22. WP-8 publication/provenance

`publishRecord` consumed unchanged through the single store boundary;
boundary publishable-class set now exactly {ValidationRecord,
ApprovalRecord, IssuanceRecord, RevocationRecord}. Existing
write-action provenance (`storage-write-action.ts`, ADR-029 D-2 edge)
unchanged. No RuntimeGrant/ActivationRecord/ExecutionOccurrenceRecord/
ExecutionAttemptRecord/AuthoritativeAuditEvent publication added.

## 23. Mechanical audit

Successful revoke receives only the WP-8 mechanical authorized-write
audit side effect (verified on the real store via `inspectAuditHistory`
`originalAuthorizedWrite.present === true`). Denied revoke: zero
RevocationRecord, zero new primary lifecycle record, zero WP-12-created
audit record. No AuthoritativeAuditEvent primary publication.

## 24. Mutation scope

Successful revoke: exactly one RevocationRecord; target byte-identical
(asserted); mechanical audit only. Denied revoke: zero lifecycle
mutation, zero project-file mutation (workspace root asserted empty on
the real store), zero Git/config/MCP mutation. No RuntimeGrant,
ActivationRecord, ExecutionOccurrenceRecord, ExecutionAttemptRecord,
SupersessionRecord, or AuthoritativeAuditEvent production.

## 25. Taxonomy/redaction

Only committed closed categories used: `request-invalid`,
`approver-not-independent`, `lifecycle-state-missing`,
`lifecycle-conflict`, `registry-context-mismatch`, `store-failure`,
`lock-conflict`, `internal-failure` (+ `subject-invalid` unused by
revoke). No `target-unknown`, `revoker-not-independent`,
`already-revoked`, `revocation-denied`, `revocation-invalid` added.
Public messages deterministic/bounded/redacted; no raw target from
another workspace, store path, errno, stack, lock key, WP-8 finding
object, role object, or registry internals (redaction asserted on real
store incl. store-failure path).

## 26. Real-store integration (SCR-W12-S2-004)

Real WP-8 store coverage for 2A is REQUIRED and provided (7 tests):
ApprovalRecord revoke (publication, byte-identical target, exactly one
record, mechanical audit, no lock artifact); IssuanceRecord revoke;
duplicate revoke; historical old-registry target revoked into current
registry context (+ wrong-echo → registry-context-mismatch, zero
publication); out-of-workspace target (lifecycle-state-missing, zero
publication, no existence disclosure); genuine read malfunction →
store-failure, bounded/redacted; revoke-vs-issue race semantics. Fake
stores used for focused failure injection only.

## 27. Static guards

Family static guard extended minimally: Slice-2A revocation production
vocabulary (`revocation-record`, `'revoke'`, `RevocationRecord`,
`revoke(`) allowed ONLY in the owning modules (core, types, subject,
records, store-boundary) via an explicit per-module allowlist;
`supersession-record` remains core.ts-only; the Slice-3+ production
vocabulary ban is unchanged family-wide; publishable-class guard updated
to exactly four classes; all other bans (no fs/network/process/Git/MCP,
no WP-8 writer-lock API, no primary audit publisher, no package-root/
`./mcp` exposure, `randomBytes` confinement, exact storage-import
allowlist) unchanged and passing.

## 28. Focused test results

WP-12 control-plane focused family (`wp12-*.test.js`): **138 tests, 138
pass, 0 fail, 0 skip — two consecutive runs** (110 Slice-1 + 20 revoke
pure-core + 8 revoke real-store). Static guard: 8 tests green.

## 29. Slice-1 regression

All 110 closed Slice-1 tests pass unchanged (request boundary,
recordValidation 13, approve 22, issue 20, coordination 9, store
integration 10, reuse 9, ExecutionBundle 5, static guard 8). Explicit
currentness regressions proven through real RevocationRecord state: issue
after effective approval revocation → `approval-revoked`; future-dated
revocation does not block issue; re-approval after revocation is a new
command/new record (revoked approval historical); re-issuance after
issuance revocation remains consistent. No Slice-1 public result changed.

## 30. Full regression

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass (51 schemas, 358 corpus inputs) |
| `npx tsc -p tsconfig.tests.json` | pass |
| WP-12 focused family (×2) | 138 / 138 pass each |
| storage unit | 431 pass / 0 fail / 2 pre-existing skips |
| storage crash/recovery | 5 pass |
| trusted | 570 pass |
| pointofuse-v2 | 232 pass |
| security | 15 pass |
| drafting | 22 pass |
| writing | 50 pass |
| MCP unit | 76 pass |
| runtime | 31 pass |
| integration | 100 pass |
| pi-adapter | 271 pass / 1 fail (F8) |
| WP-7 discovery guard | OK |
| WP-7 validated runner | 165 pass |
| `npm test` | **1675 total — 1674 pass / 1 fail** (F8) |
| `git diff --check` | clean |

## 31. Known environment failure

Exactly one, unchanged and unrelated: `tests/pi-adapter/compatibility/
harness.test.js` — "F8: real Pi 0.83.0 path supplied explicitly is
accepted" fails because installed Pi is **0.84.1** while the suite
expects **0.83.0**. Not normalized; no pi-adapter file touched.

## 32. git diff --check

Clean.

## 33. Final HEAD

`35f97a2e877e64d35ec23d87fded86af6ac6c654` — unchanged.

## 34. Working tree / staging

Working tree: 5 modified control-plane modules + 2 modified test files +
2 new test files, all unstaged and uncommitted. Staging: empty.

## 35. 2B not implemented

`verifyCurrentLifecycleState` NOT implemented; no read-only verification
evidence model, no ConsumerSupportDeclaration handling, no verify command
placeholder. Only the minimum shared revocation primitives needed by
revoke and existing Slice-1 currentness were used.

## 36. Slice-3+ not implemented

No RuntimeGrant, activation, occurrence reservation, occurrence/attempt
recording, orchestration, ExecutionResult, TrustedReceipt, supersession
production, or execution capability (static guard + source).

## 37. No MCP/CLI transport

No MCP tool, CLI, stdio, HTTP, network, package-root export, or `./mcp`
exposure (static guard: package root and `./mcp` bans hold).

## 38. No commit/push/tag/release/publication/install/deploy

Confirmed — no Git mutation of any kind was performed.

## 39. Unresolved issue

None. The one MINOR-style note from the senior review (duplicate
subsumption effectiveness) was corrected (SIR-W12-S2A-001); report
citations corrected (SIR-W12-S2A-002); direct operation reentrancy tests
added (SIR-W12-S2A-003). See the focused correction record (§40).

## 40. Focused senior-review correction record

Applied per the focused 2A correction authorization; resolves
SIR-W12-S2A-001/002/003. No committed Slice-2 contract, schema, fixture,
WP-4/WP-6/WP-8 source, package, lockfile, MCP/runtime adapter, or
Slice-1/Slice-3+ code was changed. No public taxonomy token added; lock
semantics (fail-fast, no queue) unchanged; no 2B; no Slice-3+; no
transport.

### SIR-W12-S2A-001 — duplicate/subsumption semantics (MODERATE) — CLOSED

`core.ts` duplicate detection is now two-rule and effectiveness-aware:
`exactScopeDuplicate` (same target type + target record ID + exact same
scope → conflict regardless of effectiveness — one-way replay, contract
§10) and `effectiveScopeSubsumes` (existing `all-uses` blocks a new
`execution-use` ONLY when `effectiveAt <= trustedNow` — contract §25.2 E
+ §25.8). The trusted now comes from the existing host-injected identity
source inside the under-lock decision; no new time model, no `Date.now()`.
Test matrix (pure + real store): exact execution-use duplicate →
conflict; exact all-uses duplicate → conflict; EFFECTIVE all-uses →
execution-use → conflict; equality `effectiveAt == trustedNow` → conflict;
execution-use → all-uses → success; FUTURE-DATED execution-use +
same-scope → conflict; FUTURE-DATED all-uses + execution-use → success
(two immutable records, target byte-identical, new record binds current
registry, mechanical audit present).

### SIR-W12-S2A-002 — report precision (MINOR) — CLOSED

One-way revocation citation corrected from "contract §19" to the
committed locations (contract §10 replay rule; §25.2 E / §25.8
applicability). §10/§18 now state the exact-scope (existence-based),
cross-scope (effectiveness-aware subsumption), and broadening rules
explicitly; the previous effectiveness-blind description is not claimed
as contract-committed.

### SIR-W12-S2A-003 — direct operation reentrancy test (MINOR) — CLOSED

Added two operation-vs-operation reentrancy tests that exercise BOTH
actual operation bodies through the injected store boundary: (1) revoke
owns the key → issue re-enters during the revocation publication →
`lock-conflict` → owner completes → later issue retry re-reads and
returns `approval-revoked`; (2) issue owns the key → revoke re-enters
during the issuance publication → `lock-conflict` → owner completes →
later revoke re-reads and proceeds. Fail-fast semantics preserved (no
queue); release in `finally`; later retry allowed.

## Final Slice-2 closure addendum (post-acceptance)

2A was accepted by its focused senior rereview (`WP-12 SLICE 2A FOCUSED
REREVIEW ACCEPTED — READY FOR 2B IMPLEMENTATION AUTHORIZATION`). Slice 2B
was subsequently accepted (`WP-12 SLICE 2B SENIOR REVIEW ACCEPTED — READY
FOR SLICE 2 CLOSURE AUTHORIZATION`; 0 CRITICAL / 0 MAJOR / 0 MODERATE /
1 MINOR — SIR-W12-S2B-001, static-guard precision, closed by a test-only
guard-window widening with zero production change). Final integrated
Slice-2 closure verification (focused family 172/172 twice; full
regression with sole environmental F8; real-store A–H end-to-end) found
NO 2A regression: duplicate/subsumption semantics, reentrancy behavior,
old-registry target revocation, target immutability, single-record
publication, mechanical audit, and the four-class publication allowlist
all remain green and byte-identical in behavior. Slice 2 (2A + 2B) is
committed as ONE closure unit.
