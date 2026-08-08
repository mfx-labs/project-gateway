# WP-12 Slice 1 — Implementation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Slice:** 1 — Transport-free approval and issuance decision core.
**Phase:** implementation complete — independent senior implementation
review ACCEPTED (four non-blocking MINOR findings) — focused
senior-review correction complete — focused closure rereview:
"WP-12 SLICE 1 FOCUSED CORRECTION ACCEPTED — READY FOR CLOSURE
authorization" — final documentation refresh applied (FCR-W12-S1-001
CLOSED) — closure commit authorized. Uncommitted until the closure
commit; not self-approved.

## 1. Verified baseline

| Check | Result |
|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` — exact |
| Branch | `main` |
| HEAD | `f0f10b0a96fcda55fbec3dba572549e1845b742b` (commit `docs: establish WP-12 pre-implementation contract`, parent `9695c5d8a5f42404884f11c02c493ed56d6f9e72`) |
| Working tree before implementation | clean |
| Staging | empty |

## 2. Exact files changed

Production (new module family `src/control-plane/`, 10 modules):

- `src/control-plane/types.ts` — request/trusted-context/result vocabulary, closed Slice-1 taxonomy, canonical subject model
- `src/control-plane/subject.ts` — descriptor-derived request capture, exact-key parsing, canonical subject syntax, record-subject correlation
- `src/control-plane/evidence.ts` — accepted WP-4 validation evidence form + correlation
- `src/control-plane/records.ts` — exact fixture-shaped ValidationRecord/ApprovalRecord/IssuanceRecord payload builders, registry reference, decision-content digest
- `src/control-plane/graph.ts` — WP-4 lifecycle-graph adapter + closed-token finding mapping
- `src/control-plane/core.ts` — the three Slice-1 operations (recordValidation, approve, issue)
- `src/control-plane/coordination.ts` — host-side/process-level keyed decision coordinator (FSCR-W12-001)
- `src/control-plane/storage-write-action.ts` — the WP-8-D-designated write-action provenance producer
- `src/control-plane/store-boundary.ts` — real WP-8 adapter (publishRecord/readRecord/enumerateClass; envelope builder)
- `src/control-plane/identity.ts` — crypto record-ID source helper (host-owned)

Tests (9 files, `tests/unit/` flat so the default `npm test` glob covers them):

- `tests/unit/wp12-helpers.ts`
- `tests/unit/wp12-request-boundary.test.ts` (14 tests)
- `tests/unit/wp12-record-validation.test.ts` (13 tests)
- `tests/unit/wp12-approve.test.ts` (22 tests)
- `tests/unit/wp12-issue.test.ts` (20 tests)
- `tests/unit/wp12-coordination.test.ts` (9 tests)
- `tests/unit/wp12-store-integration.test.ts` (10 tests)
- `tests/unit/wp12-reuse.test.ts` (9 tests)
- `tests/unit/wp12-execution-bundle.test.ts` (5 tests)
- `tests/unit/wp12-static-guard.test.ts` (8 tests)

Modified (one test expectation, no production code):

- `tests/unit/storage/static-guard.test.ts` — creator-consumer edge for
  `createStorageWriteActionProvenance` now admits the authorized WP-12
  consumer `src/control-plane/storage-write-action.ts` (the edge the WP-8-D
  contract itself designated as the future producer; no WP-8 source change).

## 3. Slice-1 architecture

Transport-free decision core following the accepted WP-11 injected-boundary
pattern: the pure decision core (`core.ts` + `subject.ts` + `evidence.ts` +
`records.ts` + `graph.ts`) is I/O-free; all persistence and serialization
enter through the host-injected `ControlPlaneTrustedContext` (store
boundary, decision coordinator, identity sources, configuration, registry,
roles). The store boundary is the single WP-8 adapter; the coordinator is
the host-side process-level serialization mechanism.

## 4. Request/trusted-context separation

Untrusted request operands (`operation`, `subject`, `workspaceId`, `purpose`
/ `useClass`, `validationRecordIds`, `reason`) are captured via the accepted
descriptor-derived snapshot hardening and validated with exact-key sets per
operation. Role-bearing keys are rejected as `approver-not-independent`;
all other authority-bearing keys are rejected as `request-invalid`. The
request can never supply configuration, ceilings, registry context, store
boundary, validation outcome, findings, validator profile, provenance, or
the approver/issuer role (SCR-W12-003).

## 5. Subject model

Canonical subject identity (protocolId/version, kindId/version, instanceId,
revisionId, digest) plus workspace binding per the committed subject model;
record payloads place `workspace_id` inside the record subject exactly per
the accepted protocol schemas/fixtures (SCR-W12-008). Identity is never
path/filename/repository/persistence based.

## 6. recordValidation implementation

Records exactly one ValidationRecord derived exclusively from the
host-injected accepted WP-4 run (report + branded ValidatedArtifact):
form gate (report ok:true, no findings, branded artifact, level ≥
self-semantic-valid), correlation gate (protocol/kind/instance/revision/
digest/workspace), payload derivation (validator profile, pass outcomes,
empty findings), duplicate gate keyed on full decision-content correlation
(never digest alone), WP-4 schema pipeline gate, single WP-8 publication
with mechanical write-audit.

## 7. Accepted WP-4 validation-evidence correlation

`validateArtifactSelf`/`validateArtifactRevision`-produced reports and
branded wrappers are the only accepted evidence forms (existing WP-4
result/report types reused; no second validator/canonicalizer/digest).
A failed WP-4 result is `subject-not-validated`; unsupported forms are
`request-invalid`; correlation failures are `subject-invalid`
(FSCR-W12-002). WP-12 never converts a WP-4 denial into success.

## 8. Approver structural-authority model

Approval authority exists only in the host-asserted `approverRole`; the
role is never accepted from any operand, artifact field, annotation,
validation record, digest, or transported proposal. No producer-identity
field exists or is invented; no per-artifact producer comparison
(SCR-W12-003). Slice 1 defines no delegation; service automation does not
receive the approver role; the default boundary is a trusted local
human/operator host composition. Operator identity is host-owned
attribution only.

## 9. approve implementation

Requires: exact request, genuine WP-6 configuration, workspace lookup,
capability ceiling (`project-gateway.approval-operate`), host approver
role, host-injected exact validated subject artifact, ValidationRecord
references (existence, exact subject, pass outcomes), current-state
re-read under the coordination lock, duplicate/conflict semantics over
CURRENT approvals only (revoked/expired approvals are historical and do
not block re-approval), WP-4 graph LFC-001/002 + REG gate, WP-4 schema
pipeline gate, exactly one ApprovalRecord publication.

## 10. issue implementation

Requires: exact request, workspace lookup, capability ceiling
(`project-gateway.lifecycle-issue`), host issuer role, the CURRENT matching
approval (same subject/workspace; revocation → `approval-revoked`; expiry
→ non-current; supersession consumed defensively per the accepted schema,
which cannot target lifecycle records), duplicate/conflict semantics over
current issuances, WP-4 graph LFC-003 + REG gate, schema gate, exactly one
IssuanceRecord publication bound to the exact approval record identity.
Issuance never creates an ApprovalRecord, RuntimeGrant, or activation
state.

## 11. WP-4 lifecycle graph reuse

`validateLifecycleGraph` + `evaluateLifecycleRegistryContext` are invoked
for every approve/issue candidate (entry-record evaluation); findings map
to the closed taxonomy (REG → registry-context-mismatch; LFC-001/002 →
subject-not-validated; LFC-003 → issuance-not-authorized; other →
eligibility-denied). No parallel lifecycle state machine exists
(static-guard + adapter tests prove the single rule authority).

## 12. WP-6 config/ceiling reuse

The runtime-genuine validated configuration (branded), `lookupValidatedWorkspace`
(unknown workspace → lifecycle-state-missing), `isKnownCapability`, and the
presence-aware capability-ceiling semantics of the committed WP-6 model
(global ceiling ∩ workspace ceiling; deny wins) are reused; a concrete
ceiling violation → `ceiling-denied` (more specific than
`eligibility-denied`).

## 13. WP-8 publication reuse

`publishRecord`, `readRecord`, and `enumerateClass` are consumed unchanged
through the single store-boundary adapter; the record envelope is built per
RFM-001; the write-action provenance is minted by the WP-8-D-designated
producer. No filesystem writes, no WP-8 layout changes, no lock API use.

## 14. Mechanical audit behavior

Successful publications receive only the WP-8 mechanical authorized-write
audit event (reported via `auditEventId` in the success evidence). Denied
operations create zero lifecycle records and zero AuthoritativeAuditEvent
records; no WP-12 audit publisher exists (SCR-W12-001).

## 15. Host-side/process-level coordination mechanism

`DecisionCoordinator.withLock(key, fn)` injected boundary; default
`createProcessLocalCoordinator()` is an in-process keyed reentrancy guard
(fixed order: capture → acquire → read state → revalidate → publish →
verify → release; release guaranteed by try/finally; overlapping
acquisition → `lock-conflict`). It creates no filesystem entry, no entry
under the WP-8 `locks/` layout, and is not a WP-8 writer lock
(FSCR-W12-001).

## 16. Supported host-composition assumption

Slice 1 supports ONE control-plane instance per store within one process.
The host-side lock provides NO cross-process exclusion; multi-process
control-plane composition against the same store is outside the supported
surface (only WP-8's per-record publication lock would apply then) and must
be rejected by the host composition. Recorded here per contract §17; no ADR
created for this implementation constraint.

## 17. Concurrency behavior

Same-key competing operations are prevented from interleaving by
**fail-fast process-local mutual exclusion**: the first same-key operation
acquires the process-local guard; a second overlapping same-key acquisition
does NOT queue — it fails closed with `LockContentionError` mapped to
`lock-conflict`; the first operation continues and releases in `finally`;
a later retry may proceed after release; unrelated keys are unaffected.
The duplicate gates (already-approved/already-issued/lifecycle-conflict)
guarantee a single record per decision content; `publishRecord` remains
responsible for its own internal writer lock (no residual lock files in the
real-store tests).

## 18. Result taxonomy / redaction

Only the committed closed Slice-1 categories are used; all messages are
fixed, bounded, and redacted (no paths, errno, stacks, secrets, internal
capability material, or unrelated records — proven by redaction tests over
real stores).

## 19. ExecutionBundle handling

Validated ExecutionBundle revisions are recorded/approved/issued as exact
revision identity with zero project-file persistence, zero retained bundle
bytes (records hold identity/digest facts only; the stored payload is
smaller than the evidence bytes), and no WP-11/WP-8/WP-13 change. WP-13
content acquisition is NOT implemented (out of contract scope).

## 20. Mutation scope

The only mutations are WP-8 trusted-store publications: exactly one
ValidationRecord / ApprovalRecord / IssuanceRecord per successful
operation, plus WP-8's mechanical audit side effect. Zero mutation of
project files, Git, configuration, MCP state, execution state, or any
Slice-2+ record class (verified by real-store and workspace assertions and
by the family static guard).

## 21. Static security guards

`tests/unit/wp12-static-guard.test.ts` (8 tests) proves: the family is
I/O-free (no node:fs/fs.promises/network/subprocess/timers/env/fetch;
node:crypto confined to the identity helper); exactly one WP-8 surface
import (per-module allowlist); no AuthoritativeAuditEvent publication and
no WP-8 writer-lock API; no Slice-2+ production vocabulary (revocation/
supersession literals confined to core.ts read-only currentness
consumption); only the three publishable classes; no package-root/./mcp
exposure; no Git/MCP/transport vocabulary. Corrected per SR-W12-S1-001:
the guard contains exactly 8 tests (the earlier "9 tests" reference was a
documentation error; the 102/110-test arithmetic uses 8).

## 22. Exact focused test results

`node --test "dist-test/tests/unit/wp12-*.test.js"` → **110 tests, 110
pass, 0 fail, 0 skip** (two consecutive runs).

Slice-1 test inventory after the focused senior-review correction:
request/authority boundary 14, recordValidation 13, approve 22 (added
unbranded-lookalike / branded-clone / mismatched-branded subjectArtifact
gates), issue 20 (same three gates), coordination 9, store integration 10
(added real-store missing-reference and real-store read-malfunction
regressions), reuse 9, ExecutionBundle 5, static guard 8 — 110 executed
tests, all passing.

## 23. Exact regression results

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npx tsc -p tsconfig.tests.json` | pass |
| `npm test` (default workflow incl. wp7-discovery-guard) | 1647 total — 1646 pass / **1 fail** (known environmental Pi lane mismatch, below) |
| `node --test "dist-test/tests/unit/storage/*.test.js"` | 431 pass / 0 fail / 2 skip (pre-existing privilege-gated chown skips) |
| `npm run test:storage-crash` | 5 pass / 0 fail |
| `node scripts/run-wp7-tests.mjs` | 165 pass / 0 fail (reader 62, git 38, fff 26, security 39) |
| `git diff --check` | clean |

## 24. Known environment failures

Exactly one: `tests/pi-adapter/compatibility/harness.test.js` — "F8: real
Pi 0.83.0 path supplied explicitly is accepted" fails because the installed
Pi is **0.84.1** while the suite expects **0.83.0**. This is the
pre-existing known Pi lane mismatch named in the authorization; it is
unchanged and unrelated to WP-12 (no pi-adapter file was touched).

## 25. git diff --check

Clean.

## 26. Final HEAD

`f0f10b0a96fcda55fbec3dba572549e1845b742b` — unchanged.

## 27. Working-tree / staging state

Working tree: 1 modified test expectation + 10 new production modules +
9 new test files + 1 new helper file, all unstaged and uncommitted.
Staging: empty.

## 28. Confirmation: no Slice-2+ capability implemented

Confirmed — no revocation operation, no verification API, no RuntimeGrant,
no activation, no occurrence reservation, no orchestration, no attempt
recording (static guard + tests).

## 29. Confirmation: no MCP/CLI transport added

Confirmed — no MCP tools, no stdio tools, no HTTP endpoints, no CLI
(static guard: no @modelcontextprotocol/mcp/runtime vocabulary; package
root and ./mcp unchanged).

## 30. Confirmation: no commit/push/tag/release/publication/install/deploy

Confirmed — no Git mutation of any kind was performed.

## 31. Unresolved issues

None within the Slice-1 contract. The two out-of-contract items recorded
by the committed contract remain as previously stated: WP-8 full-AUD-001
completion (separate authorization) and WP-13 bundle content acquisition
(WP-13-owned). One implementation-owned composition prerequisite is
recorded in §16 (single control-plane instance per store).

---

## 32. Focused senior-review correction record

Applied per the focused pre-closure correction authorization; resolves the
four non-blocking MINOR findings of the accepted independent senior
implementation review. No WP-8/WP-6/WP-4 source, schema, fixture, package,
lockfile, MCP/runtime adapter, WP-11 file, or committed WP-12 contract was
changed; no new public result category was added; no Slice-2+ capability
was introduced.

### SR-W12-S1-001 — report static-guard test count (MINOR) — CLOSED

Corrected §21: `wp12-static-guard.test.ts` contains **8 tests** (the "9
tests" reference was a documentation error). All test-count references in
this report are now internally consistent (14+13+22+20+9+10+9+5+8 = 110).
No test was changed to make the old count true.

### SR-W12-S1-002 — coordination wording (MINOR) — CLOSED

Corrected §17 to describe the actual model precisely: **fail-fast
process-local mutual exclusion**. A second overlapping same-key acquisition
does NOT queue; it fails closed with `LockContentionError` mapped to
`lock-conflict`; the first operation continues; release occurs in
`finally`; later retry may proceed after release; unrelated keys are
unaffected. The implementation itself was NOT changed (no queue was added)
and the committed contract was NOT changed.

### SR-W12-S1-003 — subjectArtifact runtime brand gate (MINOR) — CLOSED

`core.ts` `validateSubjectArtifact` (approve/issue) now additionally
requires the accepted WP-4 runtime brand (`isBrandedArtifact`, the existing
module-private WeakSet genuineness mechanism — no new brand, no new
validator, no new digest). Mapping: absent host evidence →
`internal-failure` (host-composition failure, unchanged); unbranded
lookalike or spread/clone → `subject-invalid`; branded-but-subject-mismatched
→ `subject-invalid` (existing correlation token). Zero publications on
every rejected path. The artifact remains host-injected trusted evidence
only: it feeds the WP-4 graph subject-resolution maps and grants nothing by
itself; the store-derived lifecycle chain remains the lifecycle authority
(no authority-conjunction change). recordValidation evidence semantics are
unchanged.

### SR-W12-S1-004 — preserve WP-8 ERR-STO-NOT-FOUND (MINOR) — CLOSED

`store-boundary.ts` `readLifecyclePayload` now preserves the WP-8 semantic
absence distinction: when `readRecord` reports `ERR-STO-NOT-FOUND` the
boundary returns the internal-only code `'not-found'`; all other read
failures remain internal `'read-failed'`. The operation layer maps
`'not-found'` → `subject-not-validated` (missing required ValidationRecord,
consistent with LFC-001/002 and the fake-store behavior) and
`'read-failed'` → `store-failure` (infrastructure failure). Real-store and
fake-store now produce the SAME committed public semantics for missing
records. The WP-8 token, errno, paths, and messages stay internal — the
public taxonomy, redaction, and the closed result set are unchanged. No
other read call site needed a mapping change (issue's missing-approval path
already derives absence from enumeration → `issuance-not-authorized`).

**New focused tests (8):** approve unbranded lookalike / branded clone /
mismatched-branded gates (3); issue unbranded lookalike / branded clone /
mismatched-branded gates (3); real-store missing ValidationRecord →
`subject-not-validated` with zero mutation and zero audit events (1);
real-store read malfunction → `store-failure`, never semantic absence (1).
Focused suite: 110 tests, 110 pass, twice.

### FCR-W12-S1-001 — report §23 stale npm-test total (MINOR, documentation) — CLOSED

Corrected during closure: §23 previously carried the pre-correction
`npm test` figure `1638 pass / 1 fail` (1639 total); the actual
focused-correction/closure-rereview result is **1647 total — 1646 pass /
1 fail** (the delta is exactly the 8 tests added by the focused
correction). The sole failure remains the known environmental F8 Pi lane
mismatch (expected Pi 0.83.0, installed Pi 0.84.1); F8 is not
normalized. No implementation semantics were changed.

## 33. Closure record

- Independent senior implementation review: **ACCEPTED**.
- Focused pre-closure correction: **COMPLETE** (four MINOR findings).
- Focused closure rereview: **WP-12 SLICE 1 FOCUSED CORRECTION ACCEPTED
  — READY FOR CLOSURE AUTHORIZATION**.
- Final closure documentation refresh (FCR-W12-S1-001): applied — the
  §23 `npm test` row now records the actual 1647 total / 1646 pass / 1
  fail (sole failure F8, unchanged).

Finding state:

- SR-W12-S1-001 — CLOSED
- SR-W12-S1-002 — CLOSED
- SR-W12-S1-003 — CLOSED
- SR-W12-S1-004 — CLOSED
- FCR-W12-S1-001 — CLOSED

Final verified test totals (closure candidate tree):

- WP-12 focused suite: 110 / 110 pass, twice (0 fail, 0 skip).
- storage unit: 431 pass / 0 fail / 2 pre-existing skips.
- storage crash/recovery: 5 pass.
- trusted: 570 pass; pointofuse-v2: 232 pass; security: 15 pass;
  drafting: 22 pass; writing: 50 pass; MCP unit: 76 pass; runtime:
  31 pass; integration: 100 pass; pi-adapter: 271 pass / 1 fail (F8);
  WP-7 discovery guard: OK; WP-7 validated runner: 165 pass.
- `npm test`: 1647 total — 1646 pass / 1 fail (F8).
- `git diff --check`: clean.

Supported host-composition prerequisite (unchanged, §16): ONE
control-plane instance per store within one process; process-local
coordination; no cross-process exclusion claim; multi-process
composition outside the supported surface.

**WP-12 Slice 1 CLOSED** (after the closure commit succeeds). WP-12 as a
whole is NOT CLOSED; Slices 2–4 remain unstarted.

---

**Slice-1 test inventory:** request/authority boundary 14, recordValidation
13, approve 22, issue 20, coordination 9, store integration 10, reuse 9,
ExecutionBundle 5, static guard 8 — 110 executed tests, all passing.
