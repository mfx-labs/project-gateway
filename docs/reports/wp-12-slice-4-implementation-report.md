# WP-12 Slice 4 — Execution Orchestration Decision + Attempt Recording — Implementation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Phase:** Slice 4 (final WP-12 slice; not a closure unit).
**Status:** implementation complete; left unstaged/uncommitted for senior
review.
**Contract:** committed §27 S4-D1…D6 (baseline HEAD
`4454dda26b8e866f84ce211bbff2b898d7d22721`).

## 1. Baseline and changed paths

Baseline: branch `main`, HEAD `4454dda26b8e866f84ce211bbff2b898d7d22721`
(`docs: establish WP-12 slice 4 contract baseline`), working tree clean,
staging empty, no stash. No Git mutation performed.

Changed paths (all unstaged/uncommitted):

- Production (`src/control-plane/`): `types.ts` (operations
  `orchestrationDecision`/`recordExecutionAttempt`, `executionRecorderRole`,
  `ordinal` operand, `EXECUTION_ATTEMPT_RECORD_CLASS`, `ATTEMPT_ID_RE`,
  `newAttemptId`, outcomes `orchestrated`/`attempt-recorded`, evidence
  fields, taxonomy token `attempt-ordinal-conflict`); `subject.ts` (two
  exact-key capture paths, ordinal parse, role-assertion keys);
  `records.ts` (`buildExecutionAttemptRecordPayload`); `identity.ts`
  (`createCryptoAttemptIdSource`, wired into `createHostIdentitySource`);
  `graph.ts` (`mapAttemptGraphFindings`); `store-boundary.ts` (eight-class
  allowlist); `core.ts` (shared under-lock attempt decision, the two
  operation paths, role gates, dispatch).
- Tests: `wp12-helpers.ts` (`newAttemptId`, `executionRecorderRole`,
  `makeAttemptPolicy`/`makeAttemptKit`, `seedActivatedOccurrence` kit
  support); `wp12-static-guard.test.ts` (Slice-4 vocabulary confinement,
  eight-class allowlist proof); new `wp12-attempt.test.ts` (18 focused
  tests) and `wp12-attempt-store.test.ts` (9 genuine WP-8 store tests).
- Report: this file.

WP-4, WP-6, WP-8 source: NOT modified.

## 2. Implementation architecture

The Slice-3A/3B pattern is extended. Both operations share one under-lock
decision (`attemptDecisionUnderLock`): re-read all nine lifecycle classes
under the canonical bundle subject/workspace coordination key (derived
C5-style from the occurrence's grant bundle reference via the pre-lock
locator read); Gate B occurrence-anchored correlation (occurrence →
accepted activation → grant → byte-identical bundle reference; non-
disclosing failures); Gate C ordinal semantics (proposed ordinal must equal
durable count + 1, unique/gapless, allowance, EXE-006 retry subject
stability); Gate D grant currentness (revocation + validity window);
point-of-use EXE-007/LFC-007 intersection computed via the accepted
`evaluatePointOfUseEligibility` with the attempt requested use
(`project-gateway.workspace-read` / `read` / `configured-artifact-area` /
`attempt:start`). `orchestrationDecision` returns bounded evidence with
zero records/audits; `recordExecutionAttempt` additionally runs the
accepted graph gate (EXE-004/005/006 + REG recordability of the
occurrence/activation/grant), schema gate, and publishes exactly one
`ExecutionAttemptRecord` with the WP-8 mechanical audit.

## 3. S4-D1…D6 coverage

- **S4-D1:** `orchestrationDecision` performs zero `publishRecord` calls
  (tested: zero publications, zero records); the durable orchestration fact
  is the `ExecutionAttemptRecord` (sole Slice-4 class; allowlist exactly
  eight classes).
- **S4-D2:** exact keys `operation|workspaceId|registryEcho|
  reservedOccurrenceId` (+ `ordinal`); occurrence is the correlation anchor
  only; activation/grant/bundle store-derived; ordinal untrusted
  caller-proposed; attempt ID internally allocated (`pgw:a:` + 32 hex) under
  the lock; host role `executionRecorderRole`; role transport →
  `approver-not-independent`; missing role → `lifecycle-state-missing`;
  caller record IDs rejected as unknown keys.
- **S4-D3:** first = 1; every ordinal must equal durable count + 1
  (unique/gapless, no created_at/record-ID/enumeration winner); retry =
  ordinal > 1 with exact bundle/workspace/occurrence/grant stability
  (EXE-006, explicit gate + graph backstop); duplicate/stale/skipped →
  `attempt-ordinal-conflict`.
- **S4-D4:** proposed ordinal ≤ `attempt_limit` AND durable count <
  `attempt_limit` (graph + point-of-use EXE-005 semantics); durable record
  consumes one; no durable record = zero consumption; abandoned/crashed
  started attempts remain consumed (immutable fact); no counter/mutable
  state; graph + point-of-use remain authoritative.
- **S4-D5:** both operations use the existing canonical bundle
  subject/workspace key family (occurrence-derived); no occurrence-ID lock
  dimension, no new lock family, no nesting; same-bundle reentrancy
  (outer attempt vs inner orchestration decision) → `lock-conflict`.
- **S4-D6:** closed §27.6 mapping implemented (request-invalid,
  approver-not-independent, lifecycle-state-missing, occurrence-conflict,
  attempt-ordinal-conflict incl. EXE-006, eligibility-denied for
  revoked/expired/not-yet-valid grant and point-of-use ineligibility,
  registry-context-mismatch, store-failure, lock-conflict,
  internal-failure). Crash-before-durability → `store-failure`, zero
  records, same ordinal retryable; crash-after-durability → same-ordinal
  retry → `attempt-ordinal-conflict`; no recovery operation.

**Bounded interpretation (recorded for review):** the committed graph rule
EXE-008 ("attempt has no trusted receipt facts") fires for every attempt in
every graph evaluation, but receipt production is WP-15-owned (§9) and
absent by design at Slice-4 attempt start; §27.4 names EXE-004/005/006 as
the attempt-start gate rules (EXE-008 is deliberately not in that list).
`mapAttemptGraphFindings` therefore filters pure EXE-008 findings from the
attempt gate (findings carrying EXE-008 alongside a gate rule are decided
by the gate rule). The graph itself is untouched.

**Policy note:** the committed fixture policy's allow rule carries a
`require-exact-resource` constraint (it authorizes `exact:` scopes only);
the attempt stage scope (`attempt:start`) is a distinct governance stage
that a host policy must explicitly authorize (policy is authority — fail
closed otherwise). Tests use the accepted WP-4-validated custom-policy kit
(`makeAttemptPolicy`/`makeAttemptKit`, rules-replaced, recomputed digest)
whose allow rule authorizes the attempt envelope; the activation envelope
remains authorized by the same policy.

## 4. Request / authority boundary

Exact-key capture per §27.2; unknown keys (grant/activation/attempt record
IDs, subject, consumer support, policy identity, evidence, config) →
`request-invalid` for BOTH operations; role-assertion keys
(`executionRecorderRole`, `executionRecorderAuthority`, `role`) →
`approver-not-independent`; malformed occurrence/ordinal operands →
`request-invalid`; echo mismatch → `registry-context-mismatch`; missing
host `executionRecorderRole` → `lifecycle-state-missing` with zero records.
The occurrence is the only caller correlation operand; all authority is
store-derived under the lock. Host-injected validated bundle evidence must
correlate exactly to the occurrence's bundle reference (host-context
inconsistency fails closed as `internal-failure`); policy evidence is
correlated to the bundle's AuthorityPolicy member (absent → point-of-use
denial). Returned evidence is bounded correlation data only.

## 5. Ordinal / allowance / persistence / crash

Covered in §3. Publication: exactly one `ExecutionAttemptRecord` + one
WP-8 mechanical `authorized-write` audit (verified via
`inspectAuditHistory`); `orchestrationDecision` zero records + zero audits;
rejections/denials zero records; no project files, no lock-layout artifact
(real-store assertions); target records byte-identical (append-only).

## 6. WP-13 boundary

WP-13 MAY consume the bounded orchestration evidence and the durable
`ExecutionAttemptRecord` as correlation/currentness facts — evidence never
confers authority alone. WP-13 still owns execution, bundle-content
acquisition (SCR-W12-002), retry DECISIONS (proposing ordinals through
`recordExecutionAttempt`), `ExecutionResult`, and execution-time
revalidation. WP-12 never executes, never cancels, produces no receipts/
results/summaries.

## 7. Verification results

| Suite | Result |
|---|---|
| typecheck + both tsc builds | clean |
| Focused `wp12-attempt.test.js` (19, incl. the SIR-W12-S4-002 fixture-policy regression) | 19/19 pass |
| Real-store `wp12-attempt-store.test.js` (9) | 9/9 pass |
| Complete WP-12 family | 276/276 pass (248 pre-Slice-4 + 28 new) |
| Full unit suite | 445/445 pass |
| integration/security/runtime/drafting/writing/trusted/pointofuse-v2 | 1020/1020 pass |
| pi-adapter + mcp + storage-crash | 352/353 — sole failure = known F8 |
| WP-7 discovery guard / validated runner | OK / 165/165 pass |
| Static guard | 9/9 pass (Slice-4 vocab confined; eight-class allowlist; receipts/results/summaries/migration/pi-guard banned) |
| `git diff --check` | clean |

Full regression total: 445 + 1020 + 353 = 1818 executed, 1817 pass, 1 fail
(F8 only).

## 8. F8 status

Unchanged and environmental: installed Pi **0.84.1** vs expected lane
**0.83.0** (`pi-adapter/compatibility/harness.test.js`). Sole failure;
unrelated to WP-12.

## 9. Static boundary result

The control-plane family remains I/O-free (crypto confined to
`identity.ts`); Slice-4 vocabulary is confined to the owning modules;
`execution-attempt-record` is the 8th allowlist class and the only new
publishable class; `trusted-receipt`, `result-publication-record`,
`execution-summary-record`, `migration-record`, `pi-guard`/`pi_guard`, and
all transport vocabulary stay banned family-wide; the package root and
`./mcp` do not expose the control plane.

## 10. Final state

- HEAD `4454dda26b8e866f84ce211bbff2b898d7d22721` (unchanged); staging
  empty; no stash; nothing committed/staged/pushed/tagged/released.
- Working tree: 9 modified + 3 untracked files (this report and the two
  attempt test files are untracked; production edits unstaged).
- Slice-4 implementation present in full; Slice 4/WP-12 closure NOT claimed.

## 11. Focused correction record (SIR-W12-S4-001/002/003)

Senior review returned `WP-12 SLICE 4 CORRECTIONS REQUIRED`. Dispositions:

- **SIR-W12-S4-001 — CLOSED (MODERATE).** `orchestrationDecision` now runs
  the SAME accepted REG-recordability/correlation gate as
  `recordExecutionAttempt` BEFORE the generic point-of-use eligibility
  fallback: the occurrence is the graph ENTRY candidate (existing minus the
  occurrence itself) with the correlated activation/grant as REG entries,
  evaluated by the accepted `evaluateCandidateLifecycleRecord` and mapped by
  the same `mapAttemptGraphFindings`. No second registry evaluator;
  occurrence/activation/grant correlation remains trusted-store-derived
  (gate B); `recordExecutionAttempt` behavior unchanged. New genuine WP-8
  real-store A→B test proves BOTH operations return
  `registry-context-mismatch` with zero records and a not-found audit probe
  (zero audits) from `orchestrationDecision`.
- **SIR-W12-S4-002 — CLOSED (MINOR).** New focused regression test seeds the
  chain/grant/activation/occurrence with the COMMITTED fixture policy and
  bundle identities (`useKit: false`) and pins BOTH operations to
  `eligibility-denied` with zero unintended lifecycle publication (zero
  attempt records, zero publish calls). No policy machinery or
  `ATTEMPT_REQUESTED_USE` change was made.
- **SIR-W12-S4-003 — CLOSED (MINOR).** The real-store runtime note is
  corrected from "~2 minutes" to the independently observed
  **~6–7 minutes** (measured 6m29s for the nine genuine WP-8 tests),
  consistent with the accepted WP-8 per-operation revalidation cost.
- **FSIR-W12-S4-001 — CLOSED (MINOR).** Final focused rereview found the
  unit-suite count stale after the SIR-W12-S4-002 regression was added:
  §7 now states **445/445** and the full regression composition
  **445 + 1020 + 353 = 1818 executed, 1817 pass, 1 fail** (sole failure =
  known environmental F8). All other reported counts verified unchanged:
  focused 19/19, real-store 9/9, WP-12 family 276/276, 1020/1020,
  352/353, static guard 9/9, WP-7 165/165.

Preserved accepted interpretations (not reopened): EXE-008 filtering,
attempt policy-kit design, S4-D1…D6, ordinal semantics, allowance
consumption, crash/retry semantics, canonical bundle coordination key,
eight-class allowlist, WP-13 boundary.

## 12. Unresolved issues

- The bounded EXE-008 receipt-facts interpretation (§3) and the attempt
  policy note (§3) are recorded for senior review (accepted).
- The real-store attempt suite takes ~6–7 minutes (accepted WP-8
  per-operation revalidation cost).
- Known environmental F8 remains out of scope.
