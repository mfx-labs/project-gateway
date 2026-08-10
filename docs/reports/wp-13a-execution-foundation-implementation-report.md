# WP-13A — Execution Foundation Implementation Report

**Work package:** WP-13A — execution foundation (slice A of WP-13; no
completion/result work).
**Status:** implementation complete; focused corrections SIR-WP13A-001,
SIR-WP13A-002, SIR-WP13A-001(a)/(b)/(c) APPLIED; final focused rereview
returned `WP-13A FINAL FOCUSED REREVIEW ACCEPTED — READY FOR WP-13A
BASELINE COMMIT`; **WP-13A is ACCEPTED for the baseline commit** (one
commit, subject `feat: establish WP-13A execution foundation`, parent
`9314a4fdaa62dcb54668470ac29d1648a04f92de`). WP-13B/C/D NOT STARTED;
WP-14/WP-15 remain blocked.
**Baseline:** HEAD `9314a4fdaa62dcb54668470ac29d1648a04f92de` (branch
`main`; `docs: establish WP-13 implementation contract baseline`),
unchanged throughout. Nothing staged/committed; no push/tag/release/deploy.
**Authoritative contract:** `docs/reports/wp-13-pre-implementation-contract-decision.md`
(Decisions 1–2 execution scope), ADR-038 (NOT exercised by WP-13A),
`docs/decisions/ADR-006/011/012/020/022/027`, the WP-12 slice-4 boundary
(§6), the WP-5B closure record, and the committed lifecycle schemas.

## 1. Changed paths

New production module family (`src/execution/`):
`types.ts` (vocabulary + narrow composition boundaries) · `retry.ts`
(committed §4 retry rule) · `control-plane.ts` (WP-12 execution boundary
adapter) · `run.ts` (execution-attempt flow) · `index.ts` (barrel).

New tests: `tests/unit/wp13a-execution.test.ts` (21 focused tests) ·
`tests/unit/wp13a-static-guard.test.ts` (5 static guards).

No existing source/test/package/schema file was modified. `package.json`,
`tsconfig*`, and the package export map are unchanged (WP-13A is an
internal module family, imported by path — the established WP-12/WP-11
pattern).

## 2. Execution flow (as implemented)

```
validated input (workspace/occurrence operands only)
→ 1. input hygiene (closed syntax; boundaries present; previous-outcome shape)
→ 2. WP-12 orchestrationDecision (EXE-007 point-of-use; grant currentness;
     allowance) — zero records
→ 3. enforcement gate: evidence/activation correlation (occurrence + grant)
     + LIVE pi-guard snapshot (PROJECTED, projection identity, profile set,
     surfaceStable) — stored evidence never reactivates enforcement
→ 4. retry eligibility (§4): durable-basis check, terminal/retryable
     classification, EXE-006 subject stability, allowance, ordinal =
     durable count + 1
→ 5. WP-12 recordExecutionAttempt(ordinal) — the authoritative recorder/gate
→ 6. WP-5A plan projection via the host boundary for the RECORDED attempt +
     exact correlation (occurrence, attempt, bundle identity, workspace
     binding)
→ 7. ordinal-1 enforcement plan-fingerprint correlation
     (evidence.planFingerprint === fingerprint of the executed plan)
→ 8. Pi execution through the injected host boundary ONLY
→ 9. PiExecutionObservation collection (observePiExecution) + exact
     session/turn/bundle/occurrence/attempt validation
→ 10. bounded outcome (closed disposition vocabulary) + §4.2 retry
     classification
```

Every pre-execution failure stops before any durable attempt recording;
observation failures stop after recording but before any outcome is
returned (the attempt record stands, per protocol: a started attempt that
is otherwise incomplete MUST have an attempt record).

## 3. Reused WP-12/WP-5B/WP-5A primitives (no second authority)

- WP-12 `executeSlice1Command` (`orchestrationDecision`,
  `recordExecutionAttempt`) — unchanged; WP-12 remains the authoritative
  recorder/gate (EXE-005/006/007, REG recordability, registry context).
- WP-8 store read path — consumed ONLY through the WP-12 trusted context by
  the boundary adapter (durable attempt enumeration/reads); WP-13A itself
  holds no store boundary and has no publish path.
- WP-5B `computePlanFingerprint` (exact plan correlation) and
  `surfaceStable` (live surface drift gate) — pure, unchanged.
- WP-5A `isPiInvocationPlan`, `isPiExecutionObservation`,
  `observePiExecution` — branded validation + observation collection.
- Committed identity syntaxes (`pgw:w:`, `pgw:o:` regexes from
  control-plane/types) and the execution-result-body disposition vocabulary.
- WP-11-style injected-host-executor pattern for the host boundary (the
  host owns all real I/O; WP-13A is transport-free and I/O-free).

## 4. Point-of-use revalidation

Every attempt re-runs the WP-12 `orchestrationDecision` (EXE-007: registry,
consumer support, revocation, validity, ceilings, policy, grant state) and
requires `grantCurrent === true` and `remainingAllowance >= 1`. Revoked or
expired grants fail closed as `EXEC-REVALIDATION-FAILED` before any
recording (tests: revocation, expiry via the same trusted clock).

## 5. Attempt recording

`recordExecutionAttempt(workspaceId, occurrenceId, ordinal)` with the
ordinal derived by WP-13A as durable attempt count + 1 (S4-D3: unique,
gapless, derived from the immutable `ExecutionAttemptRecord` set). WP-12
re-validates every proposal under its lock; any refusal maps to
`EXEC-ATTEMPT-RECORDING-FAILED` carrying the WP-12 category. The recorded
attempt id is internally allocated by WP-12 and then bound to the plan,
observation, and outcome.

## 6. Pi execution / observation path

Execution happens ONLY through the injected `ExecutionHostBoundary`
(`projectPlan(attemptId)` + `execute({plan})` + `readEnforcementState()`).
WP-13A never spawns processes, never touches the tool inventory, and never
calls any pi-guard API (static-guard proven). The observation is collected
with the committed WP-5A collector and validated for exact
workspace(binding)/bundle/occurrence/attempt/session/turn correlation; the
host-reported session/turn must equal the correlation the bridge captured
from real host events.

## 7. Retry implementation (§4)

- `classifyDisposition` — the committed table: `failed`/`cancelled`/
  `timed-out`/`crashed` retryable; `completed`/`rejected`/`incomplete`
  terminal.
- `evaluateRetryEligibility` — explicit-request-only, pure; requires: durable
  previous attempt (the in-session outcome must be the LATEST durable
  attempt), retryable disposition, grant current, allowance remaining,
  EXE-006 subject stability across the durable set, ordinal = count + 1.
- Ambiguity (missing in-session basis after restart, stale basis, conflicting
  durable state) fails closed as `EXEC-RETRY-AMBIGUOUS` — a fresh activation
  decision (new occurrence) is the only recovery path; terminal outcomes are
  `EXEC-RETRY-DENIED`. No scheduler, no timer, no queue, no auto-retry
  (static + behavioral proof).

## 8. Failure taxonomy (closed)

`EXEC-INPUT-INVALID` · `EXEC-PLAN-UNCORRELATED` · `EXEC-REVALIDATION-FAILED`
· `EXEC-ENFORCEMENT-UNAVAILABLE` · `EXEC-ENFORCEMENT-UNCORRELATED` ·
`EXEC-ENFORCEMENT-STALE` · `EXEC-RETRY-DENIED` · `EXEC-RETRY-AMBIGUOUS` ·
`EXEC-ATTEMPT-RECORDING-FAILED` · `EXEC-OBSERVATION-UNCORRELATED` ·
`EXEC-HOST-FAILURE` · `EXEC-INTERNAL-FAILURE`, each with a stable machine
key; raw host exception text never enters a finding (host-boundary
exceptions are contained — adversarial test).

## 9. Verification results

| Suite | Result |
|---|---|
| typecheck (`tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.tests.json --noEmit`) | clean |
| Focused WP-13A (`wp13a-execution.test.js`) | **38/38 pass** (21 original + 9 SIR-WP13A-001 adversarial + 8 SIR-WP13A-001(a)/(b)/(c) malformed-return) |
| WP-13A static guards (`wp13a-static-guard.test.js`) | **5/5 pass** |
| Full unit suite (`dist-test/tests/unit/*.test.js`, incl. WP-12 family) | **488/488 pass** |
| Pi-adapter suite (unit/integration/security/compatibility/enforcement incl. WP-5B) | **338/339** — sole failure = the known pre-existing environmental F8 (installed Pi 0.84.1 vs supported 0.83.0 lane; `harness.test.js`; unchanged) |
| Global security scan (`tests/security/security.test.js`) | **15/15 pass** (new module family is I/O-free; no allowlist change) |
| `git diff --check` | clean |

## 10. Focused correction record

### SIR-WP13A-001 — boundary containment — CLOSED

Every required nested container is shape-validated before destructuring or
property access, and every injected boundary call goes through the bounded
`safeCall` pattern (`src/execution/run.ts`):

- **Input validation (`EXEC-INPUT-INVALID`):** root input container,
  request operands, the three boundary containers (`host`, `controlPlane`,
  `identity`), every required boundary member (all seven members checked
  to be functions), the enforcement container and every evidence/activation
  member the flow accesses, and the previous-outcome container. Malformed,
  null, or missing containers return typed failures — never a raw
  TypeError.
- **Boundary calls (`safeCall`):** `orchestrationDecision`,
  `durableAttempts`, `recordExecutionAttempt` (control plane),
  `readEnforcementState`, `projectPlan`, `execute` (Pi host),
  `observePiExecution` (observation collection), and `nowUtcIso` (identity)
  are all contained; boundary return shapes are validated
  (`isDecisionResult`, `isDurableAttemptFact`, `enforcementSnapshotShape`,
  plan-result and execution-facts record checks) so no malformed return can
  throw downstream.
- **Taxonomy mapping:** caller/input shape → `EXEC-INPUT-INVALID`;
  Pi-host boundary → `EXEC-HOST-FAILURE` (`host.enforcement-state-*`,
  `host.plan-*`, `host.execute-*`, `host.execution-facts-malformed`);
  trusted/internal boundaries → `EXEC-INTERNAL-FAILURE`
  (`control-plane.*-exception`/`*-malformed`, `identity.time-source-invalid`,
  `observation.build-failed`). No new categories were introduced.
- **Guarantees preserved:** raw exception text never escapes (the exception
  is discarded — adversarial tests assert a secret marker never appears in
  any message or code); no stack/error-object leaks; no fallback success;
  no authority inference from exceptions; execution remains fail closed
  (pre-execution boundary failures record nothing and execute nothing).
- **Adversarial tests (9 new):** `enforcement: undefined` / `null`;
  non-function `orchestrationDecision`; throwing `orchestrationDecision`,
  `durableAttempts`, `recordExecutionAttempt`, `readEnforcementState`,
  `projectPlan`, `nowUtcIso`, `host.execute`; each asserts the closed
  category/code, that the secret raw text never leaks, and that no Pi
  execution occurs after any pre-execution boundary failure (host execute
  counter zero).
- **Semantics preserved:** all accepted authority/retry/observation
  behavior is unchanged (the 21 original focused tests pass unchanged).

### SIR-WP13A-001(a) — host.execute return shape — CLOSED

`host.execute` results are fully shape-validated before `ok` is read
(`hostRunResultShape`, inside `safeCall`): the value must be an object with a
boolean `ok`; `ok:true` requires a record `facts` container (every consumed
member — session/turn correlation and bridge — is then typed before use);
`ok:false` requires a string `code`. The host failure `message` is NEVER
trusted or forwarded: a fixed bounded WP-13A message ('the Pi host failed
the execution attempt') is always used, and raw/malformed host content is
discarded. `null`, arrays, primitives, incomplete `{ok:true}`, malformed
`{ok:false}`, non-string messages, and object-valued messages all return
typed `EXEC-HOST-FAILURE` (`host.execution-result-malformed` or
`host.execute-failed:<code>`) — never a throw, never a leak, and the
recorded attempt stays in place (durable semantics after recording).

### SIR-WP13A-001(b) — orchestration decision evidence shape — CLOSED

`isOrchestrationDecisionResult` (inside `safeCall`) validates the FULL nested
evidence shape WP-13A consumes before any property access or correlation
logic: the evidence container, the canonical subject container (all eight
identity fields, non-empty strings), the exact bundle-reference identity
fields used by `bundleIdentityMatches` (kind/instance/revision/digest), the
grant correlation (`runtimeGrantId`), and the workspace/occurrence/
activation correlations. Malformed or missing subject evidence fails closed
as `EXEC-INTERNAL-FAILURE` (`control-plane.orchestration-malformed`) —
`isRecord(evidence)` alone is never treated as sufficient. The same
full-shape discipline is applied to the attempt-recording result
(`isAttemptRecordedResult`).

### SIR-WP13A-001(c) — attempt-record evidence / id extraction — CLOSED

The `String(...)` conversion that could fabricate `"undefined"`/`"null"`
identities is removed. `isAttemptRecordedResult` requires an ACTUAL valid
attempt identity (`ATTEMPT_ID_RE`) and record identity (`RECORD_ID_RE`)
before continuing; the success `attemptRecordId` is taken directly from the
validated `attemptRecordId ?? recordId` (both already syntax-validated).
Malformed/missing identities fail closed as `EXEC-INTERNAL-FAILURE`
(`control-plane.attempt-recording-malformed`) — no fabricated id ever
reaches a finding or a success result.

### SIR-WP13A-001 (parent) — boundary containment — CLOSED

The malformed-return sweep over every boundary-return path in
`src/execution/run.ts` (orchestrationDecision, durableAttempts,
recordExecutionAttempt, readEnforcementState, projectPlan, execute,
observation collection, nowUtcIso, and the pure helpers over
boundary-derived data — retry evaluation, surfaceStable,
computePlanFingerprint) found no remaining escape/leak path: every path is
call → `safeCall` containment → exact return-shape validation → only then
property access/use. The parent SIR-WP13A-001 is CLOSED.

### SIR-WP13A-002 — report ledger — CLOSED

The implementation report previously recorded the global security scan as
20/20; that count conflated the 15 security-scan tests with the 5 WP-13A
static guards. Corrected: the global security scan is **15/15**, and the
WP-13A static guards remain **5/5**, recorded as separate lines in §9.

## 11. Explicit WP-13B/C/D exclusions (NOT implemented)

CompletionContract evaluation · ExecutionResult creation/adoption · result
artifact writing · WP-12 `recordValidation` for results ·
ADR-038 result-publication authority · ResultPublicationRecord ·
publication coordination lock · ExecutionRetrospectiveFacts · TrustedReceipt
· receipt scopes · ExecutionSummaryRecord · automatic retry scheduler · new
lifecycle records · new authority evaluator · new pi-guard activation logic.
Seams left for later slices: the bounded `ExecutionAttemptOutcome`
(retry-rule input for WP-13B completion evaluation), the validated
`PiExecutionObservation` (WP-13B completion input), and the host boundaries
(unchanged composition points). No later authority behavior is stubbed with
fake success paths — the modules simply do not exist.

## 12. Final Git state

Baseline commit (accepted): `feat: establish WP-13A execution foundation`
with parent `9314a4fdaa62dcb54668470ac29d1648a04f92de`, containing exactly
the eight reviewed paths (five `src/execution/` modules, the two WP-13A
test files, and this report). No package/schema/config modification; no
WP-13B/C/D code; no completion/result/publication/receipt implementation.
Final verified evidence: focused WP-13A **38/38**; static guards **5/5**;
full unit **488/488**; global security **15/15**; Pi-adapter **338/339**
(sole failure = the unchanged environmental F8, installed Pi 0.84.1 vs
supported 0.83.0 lane); both typechecks clean. No push/tag/release/deploy;
WP-13B/C/D NOT STARTED; WP-14/WP-15 remain blocked.
