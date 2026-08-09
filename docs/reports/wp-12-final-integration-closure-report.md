# WP-12 — Final Integration and Closure Preparation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Phase:** Final integration / closure preparation (Slices 1–4 as ONE
capability). **Scope:** documentation + one closure campaign; no code change.
**Status:** WP-12 satisfies the committed closure criteria; implementation
remains unstaged/uncommitted pending the final closure review and closure
commit authorization.

## 1. Baseline and combined WP-12 state

- Branch `main`, HEAD `4454dda26b8e866f84ce211bbff2b898d7d22721`
  (`docs: establish WP-12 slice 4 contract baseline`), unchanged throughout.
- Combined WP-12 state: Slices 1–3 committed and closed on prior baselines;
  Slice 4 present in full in the current unstaged working tree
  (9 modified + 4 untracked files; staging empty; no stash).
- Contract: committed `wp-12-pre-implementation-contract-decision.md`
  (esp. §4 eight handoff criteria, §17 closure criteria, §27 S4-D1…D6).
- No Git mutation performed; nothing staged/committed/pushed/tagged/released.

## 2. Slice 1–4 closure status

| Slice | Scope | Status |
|---|---|---|
| 1 | `recordValidation`, `approve`, `issue` | Closed (focused correction accepted; closure review accepted) |
| 2 | `revoke`, `verifyCurrentLifecycleState` | Closed (2A/2B rereview accepted — ready for closure authorization) |
| 3 | `issueRuntimeGrant`, `decideActivation`, `createOccurrence` (recovery) | Closed (final closure review accepted) |
| 4 | `orchestrationDecision`, `recordExecutionAttempt`, `ExecutionAttemptRecord` | Implemented; senior review accepted with corrections; all findings closed (below) |

## 3. Slice-4 finding disposition

- SIR-W12-S4-001 (MODERATE, registry-rotation token divergence) — CLOSED:
  both operations run the same accepted graph REG-recordability gate before
  the point-of-use fallback; genuine WP-8 A→B test pins both →
  `registry-context-mismatch`, zero records/audits.
- SIR-W12-S4-002 (MINOR, policy-denial unpinned) — CLOSED: new focused test
  (`useKit: false`, committed fixture policy) pins both operations →
  `eligibility-denied`, zero publications.
- SIR-W12-S4-003 (MINOR, stale runtime note) — CLOSED: real-store runtime
  restated as ~6–7 minutes.
- FSIR-W12-S4-001 (MINOR, stale counts) — CLOSED: §7 now states full unit
  445/445 and full regression 1818 executed / 1817 pass / 1 F8.
- Accepted interpretations preserved (not reopened): EXE-008 filtering
  (receipt facts are WP-15-owned; not an attempt-start gate), attempt
  policy-kit design (WP-4-validated custom policy; production fails closed
  under the committed fixture policy), S4-D1…D6 semantics.

## 4. Integrated lifecycle architecture (as implemented)

validated subject → `recordValidation` → `approve` → `issue` →
`revoke`/`verifyCurrentLifecycleState` → `issueRuntimeGrant` →
`decideActivation` (accepted → `ActivationRecord` + `ExecutionOccurrenceRecord`;
denied → terminal) → `createOccurrence` (recovery only) →
`orchestrationDecision` (bounded evidence, zero records) →
`recordExecutionAttempt` (durable `ExecutionAttemptRecord` + mechanical
audit; ordinal/allowance/EXE-006 enforced) — all under the canonical
bundle subject/workspace coordination-key family
(`kindId|instanceId|revisionId|digest|workspaceId`), host-side/process-level,
one key per mutation, with the accepted WP-4 graph (LFC/EXE/REG) and WP-4
point-of-use machinery as the single evaluation authorities.

## 5. WP-12 closure-criteria assessment (§17 + §4 eight handoff criteria)

- **All lifecycle decisions external to repository content; fail closed on
  missing state** — satisfied: state lives only in the WP-8 trusted store;
  missing/ambiguous/stale correlation fails closed
  (`lifecycle-state-missing`/`occurrence-conflict`/`eligibility-denied`);
  no project-file lifecycle state.
- **§4 handoff criteria:** (1) exact-subject binding + current-record
  evaluation — `verifyCurrentLifecycleState` + under-lock revalidation; (2)
  atomic occurrence-ID reservation, one accepted/denied activation, terminal
  denied closure, occurrence correlation — Slice 3 (SCR-W12-005 recovery
  pattern); (3) explicit per-attempt records — Slice 4
  `ExecutionAttemptRecord` (receipt facts remain WP-15/WP-13); (4) result
  publication after evaluator provenance — outside WP-12 (ADR-012); (5)
  receipt correlation for privileged scopes — WP-15; (6) append-only
  revocation/supersession of usability records only — Slice 2; (7) exact
  registry snapshot + workspace-scoped approval/issuance — Slices 1–4; (8)
  fail-closed when trusted state unavailable — all slices. All eight are
  satisfiable; nothing WP-12-owned is unimplemented.
- **WP-5B substrate:** `RuntimeGrant` + accepted activation decision evidence
  + reserved occurrence identity (ADR-027 fields) + pre-activation
  `verifyCurrentLifecycleState` form — present.
- **WP-13 substrate:** `orchestrationDecision` bounded evidence + durable
  `ExecutionAttemptRecord` + `recordExecutionAttempt` ordinal-proposal
  surface + identity/digest evidence — present. Execution, bundle-content
  acquisition (SCR-W12-002), retry decisions, `ExecutionResult`,
  execution-time revalidation remain WP-13-owned; receipt production
  remains WP-15-owned.

## 6. Publication / authority boundaries (exact)

- **Publication allowlist — exactly eight classes:** `validation-record`,
  `approval-record`, `issuance-record`, `revocation-record`, `runtime-grant`,
  `activation-record`, `execution-occurrence-record`,
  `execution-attempt-record` (Slice 4 adds ONLY the attempt class;
  `trusted-receipt`, `result-publication-record`, `execution-summary-record`,
  `migration-record` stay unpublishable).
- **Authority:** all mutating operator roles (approver, issuer, revoker,
  grant, activation, execution-recorder) are host-asserted only; caller
  role/record-ID/subject/policy/evidence injection is rejected
  (`approver-not-independent`/`request-invalid`); caller correlation
  operands never become authority; bounded evidence is correlation data,
  never transferable authority (ADR-027).
- **No execution capability:** no Pi/pi-guard activation, no
  `ExecutionResult`, no receipt production, no bundle-content storage, no
  transport/MCP/CLI/HTTP lifecycle mutation surface anywhere in WP-12
  (static-guard enforced).

## 7. Verification results (closure campaign, run once)

| Suite | Result |
|---|---|
| typecheck + both tsc builds | clean |
| Complete WP-12 family (`wp12-*.test.js`) | 276/276 |
| Static guard | 9/9 |
| Full unit suite | 445/445 |
| integration/security/runtime/drafting/writing/trusted/pointofuse-v2 | 1020/1020 |
| pi-adapter + mcp + storage-crash | 353 — 352 pass, 1 fail = F8 only |
| WP-7 discovery guard / validated runner | OK / 165/165 |
| `git diff --check` | clean |

Full regression total: 445 + 1020 + 353 = **1818 executed, 1817 pass,
1 fail (F8 only)** — matches the Slice-4 implementation report exactly.

## 8. F8 status

Unchanged and environmental: installed Pi **0.84.1** vs expected compatibility
lane **0.83.0** (`pi-adapter/compatibility/harness.test.js`). Sole failure;
unrelated to WP-12.

## 9. Exact changed-path inventory (all unstaged/uncommitted)

- Modified: `src/control-plane/core.ts`, `graph.ts`, `identity.ts`,
  `records.ts`, `store-boundary.ts`, `subject.ts`, `types.ts`;
  `tests/unit/wp12-helpers.ts`, `tests/unit/wp12-static-guard.test.ts`.
- Untracked: `docs/reports/wp-12-slice-4-implementation-report.md`,
  `tests/unit/wp12-attempt.test.ts`, `tests/unit/wp12-attempt-store.test.ts`,
  and this report.
- WP-4 (`src/lifecycle`), WP-6 (`src/trusted`), WP-8 (`src/storage`)
  source: untouched. No generated/debug artifacts included (generated
  bundles/dist are gitignored). No WP-13 implementation exists.

## 10. Unresolved findings

None. All Slice-4 review findings (SIR-W12-S4-001/002/003,
FSIR-W12-S4-001) are closed; all Slice-1/2/3 findings were closed in their
respective closure reports. Accepted interpretation notes (EXE-008 filter,
attempt policy kit, real-store runtime cost) are recorded, not unresolved.

## 11. Final state and closure eligibility

- HEAD `4454dda26b8e866f84ce211bbff2b898d7d22721` (unchanged); working tree
  = 9 modified + 4 untracked (this report added); staging empty; no stash;
  no push/tag/release/install/deploy.
- WP-12 satisfies every committed closure criterion (§17; §4 handoff
  criteria 1–8; WP-5B and WP-13 handoff readiness; exact eight-class
  publication boundary; no execution/transport leakage).
- Remaining gates: final closure review of this report, then explicit
  closure-commit authorization. WP-13/WP-5B not begun.
