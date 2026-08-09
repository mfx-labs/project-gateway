# WP-12 Slice 3 — Integration Closure Report

**Work package:** WP-12 — Local approval and execution control plane.
**Phase:** Slice-3 integration/closure preparation (3A + 3B as ONE
capability: RuntimeGrant issuance → RuntimeGrant revocation → activation
decision → accepted occurrence publication → crash recovery).
**Status:** integration complete; all changes left unstaged/uncommitted for
final closure review.
**Carried reviews:** 3A `ACCEPTED — READY FOR 3B IMPLEMENTATION
AUTHORIZATION`; 3B `ACCEPTED — READY FOR SLICE 3 INTEGRATION/CLOSURE`;
six non-blocking MINOR findings (SIR-W12-S3A-001/002/003,
SIR-W12-S3B-001/002/003) closed by this phase.

## 1. Baseline and combined changed paths

Baseline: branch `main`, HEAD `b0710990a533ad335261cb44fb47b6c3dc5d0633`
(committed Slice-3 contract baseline), staging empty, working tree carrying
the accepted unstaged 3A+3B implementation. No Git mutation performed
(read-only inspection only; `git diff --check` clean).

Combined working-tree delta (10 modified + 7 untracked, 1920 insertions /
66 deletions vs HEAD):

- Production (`src/control-plane/`): `types.ts`, `subject.ts`, `records.ts`,
  `core.ts`, `graph.ts`, `store-boundary.ts`, `identity.ts` (3A only).
- Tests: `wp12-helpers.ts`, `wp12-revoke.test.ts`, `wp12-static-guard.test.ts`
  (modified); `wp12-runtime-grant.test.ts`, `wp12-runtime-grant-store.test.ts`,
  `wp12-activation.test.ts`, `wp12-activation-store.test.ts` (new).
- Reports: `wp12-slice-3a-implementation-report.md`,
  `wp12-slice-3b-implementation-report.md`, this file.

WP-4, WP-6, WP-8 source: NOT modified.

## 2. 3A + 3B capability summary

**issueRuntimeGrant** (3A): exact-key untrusted request (subject,
workspaceId, registryEcho, attemptLimit, validity, narrowedConstraints);
host-asserted `grantRole`; internally allocated `pgw:o:` occurrence ID under
the bundle coordination key with collision check; five-subject (bundle +
four members) chain correlation store-derived; `max-actions` vs current WP-6
ceilings → `ceiling-denied`; `max-resources` schema-valid but unsupported →
`eligibility-denied`; exactly one RuntimeGrant + one mechanical audit.

**RuntimeGrant revocation** (3A): existing revoke extended to the
RuntimeGrant target; grant-shaped coordination-key derivation from the
target's exact bundle reference + workspace_id (SAME family as issuance);
Slice-2A duplicate/subsumption/effectiveAt semantics unchanged; old-registry
targetability with the new record binding the current registry; target
byte-identical.

**decideActivation** (3B): exact-key request (subject, workspaceId,
registryEcho, grantId, reservedOccurrenceId); host-asserted `activationRole`;
gates A–E (command boundary, genuine grant correlation, reservation
undecided, PHASE-1 five-issuance correlation, PHASE-1 recordability);
PHASE-2 currentness/eligibility → durable `ActivationRecord(denied)`;
eight checks via the accepted WP-4 graph + point-of-use machinery;
`activation_limit` derived from immutable accepted records; accepted →
`ActivationRecord(accepted)` FIRST then the mandatory
`ExecutionOccurrenceRecord` under the same lock.

**createOccurrence** (3B): recovery-only surface; exactly one accepted
incomplete transition; reuses the reserved occurrence ID; historical
correlation only (no currentness re-decision, no new activation);
registry A → B recovery with the new occurrence as graph entry under B;
ambiguous/conflicting state fails closed.

## 3. Disposition of the six MINOR findings

| Finding | Disposition |
|---|---|
| SIR-W12-S3A-001 (grant negative coverage) | CLOSED — 4 new focused tests in `wp12-runtime-grant.test.ts`: store publish failure → `store-failure` (zero grant); store read/enumerate failure → `store-failure`; host bundle evidence mismatch → `subject-invalid`; multiple current issuances or approvals for one required subject → `lifecycle-conflict`. |
| SIR-W12-S3A-002 (3A report count) | CLOSED — §39 corrected to the independently verified 1755 executed / 1754 pass / 1 fail with composition note. |
| SIR-W12-S3A-003 (dead guard allowance) | CLOSED — `pgw:o:` removed from the core.ts allowance in `wp12-static-guard.test.ts` (core.ts has zero occurrences; the guard still passes, so the tripwire is now exact). |
| SIR-W12-S3B-001 (recovery REG mapping) | CLOSED — `createOccurrenceUnderLock` now maps graph findings via `mapActivationGraphFindings` into the §26.19 createOccurrence token set: REG → `registry-context-mismatch`; broken chain correlation (LFC, incl. `issuance-not-authorized`) → `lifecycle-state-missing`; anything else → `store-failure`. No `issuance-not-authorized`/`eligibility-denied`/`replay-denied` escapes into the recovery surface. |
| SIR-W12-S3B-002 (three missing activation tests) | CLOSED — 3 new focused tests in `wp12-activation.test.ts`: PHASE-1 registry incompatibility (chain + grant under A, decision under B) → `registry-context-mismatch` rejection with zero records; first publication (`ActivationRecord`) failure → `store-failure` with zero records; `activation_limit` already consumed by an incomplete accepted transition → next fully correlated decision is a durable denial (and recovery would not double-count). |
| SIR-W12-S3B-003 (3B report count) | CLOSED — §9 corrected to the independently verified 1783 executed / 1782 pass / 1 fail with composition note. |

All fixes are narrow and semantics-preserving; no contract change was
required and no blocker was encountered.

## 4. Integrated contract-conformance assessment

The combined 3A+3B implementation was re-reviewed against committed §26 as
one capability:

- **Authority/request boundaries:** exact-key requests only; roles
  (`grantRole`, `activationRole`, `revokerRole`) host-asserted; role
  transport → `approver-not-independent`; occurrence IDs never caller-
  supplied; approval/issuance/policy/consumer operands never caller-
  supplied (rejected as unknown keys); grant/reservation IDs are
  correlation operands only, verified against the authoritative grant
  record (workspace + bundle bytes + reservation).
- **One coordination-key family:** `kindId|instanceId|revisionId|digest|
  workspaceId` for issueRuntimeGrant, decideActivation, createOccurrence
  (activation-derived), and grant revoke (grant-bundle-derived); identical
  strings verified by construction and by the operation-vs-operation
  reentrancy tests (issue↔revoke, revoke↔issue, activation↔activation).
- **Five-issuance correlation/currentness split:** PHASE-1 exact historical
  correlation with deterministic currentness-filtered uniqueness (no
  created_at/record-ID/first-enumeration/newest selection); PHASE-2
  currentness failures → durable denial, never rejection; missing/ambiguous
  chains → rejection with zero records.
- **max-actions / max-resources:** grant-issue ceiling comparison
  (`ceiling-denied`) and issue-time narrowing; re-evaluated at activation
  against the CURRENT configuration; `max-resources` fail-closed
  (`eligibility-denied` at issue; unsupported-form handling at point of use)
  — no resource ceiling invented.
- **One decision per reservation:** Gate C + EXE-001/002 graph backstops;
  replay after accepted and after denied → `replay-denied`; denied is
  terminal; grant closed by denial.
- **activation_limit:** accepted-record-derived count for the exact bundle
  issuance ID; denied consumes zero; accepted consumes on durability
  (incomplete transition included — now directly tested); recovery never
  double-counts; same-bundle key serializes count reads.
- **Cardinality:** accepted = ActivationRecord + exactly one occurrence +
  2 audits; denied = exactly one ActivationRecord + 0 occurrences + 1 audit;
  rejection = 0 records + 0 audits; recovery = exactly one occurrence + 1
  audit (second repair → `occurrence-conflict`).
- **Incomplete accepted transition:** second-publication failure →
  `store-failure`, no complete evidence; createOccurrence is the only
  repair; first-publication failure → `store-failure`, nothing durable.
- **Recovery:** historical completion after later grant/issuance revocation
  and expiry; no authority re-decision; no new occurrence ID; registry
  A → B with graph-entry scoping (REG rules are entry-scoped) and
  byte-identical A records.
- **Revocation races:** bundle-key revokes (approval/issuance/grant of the
  bundle, grant revoke) serialize with activation under the shared key;
  member-key revokes are the accepted serial-order/point-of-use race
  (revoke-first → denial observed by the under-lock re-read).
- **Bounded complete activation evidence:** §26.16 fields only (decision,
  activation/occurrence record identities, grant ID, reservation, workspace,
  bundle revision, registry correlation); five issuance IDs never included;
  no raw records, roles, store paths, or transferable authority.
- **Seven-class publication allowlist:** exactly validation/approval/
  issuance/revocation/runtime-grant/activation/execution-occurrence; the
  static guard asserts `execution-attempt-record` absent from the allowlist
  literal.
- **Zero leakage:** no ExecutionAttemptRecord, orchestration,
  recordExecutionAttempt, Pi/pi-guard, WP-5B surface, transport, filesystem
  authority, or execution capability anywhere in the family (static guard +
  grep).

## 5. Verification results (post-closure tree)

| Suite | Result |
|---|---|
| typecheck + both tsc builds | clean |
| Focused `wp12-runtime-grant.test.js` (30 tests incl. 4 new) | 30/30 pass |
| Focused `wp12-activation.test.js` (21 tests incl. 3 new) | 21/21 pass |
| Real-store `wp12-runtime-grant-store.test.js` (15) | 15/15 pass |
| Real-store `wp12-activation-store.test.js` (10, incl. A→B recovery, crash, reentrancy) | 10/10 pass |
| Complete WP-12 family | 248/248 pass (213 pre-3A baseline + 35 3A/3B/closure) |
| Full unit suite | 417/417 pass |
| integration/security/runtime/drafting/writing/trusted/pointofuse-v2 | 1020/1020 pass |
| pi-adapter + mcp + storage-crash | 352/353 — sole failure = known F8 |
| WP-7 discovery guard / validated runner | OK / 165/165 pass |
| `git diff --check` | clean |

Full regression total: 1790 executed, 1789 pass, 1 fail (F8 only).

## 6. Publication and authority-boundary checks

- Primary publications in the decision core are confined to the five
  Slice-1/2/3A classes + activation/occurrence (seven total); the WP-8
  mechanical write-audit accompanies every publication; no
  AuthoritativeAuditEvent primary publication; no project-file or
  WP-8 lock-layout artifact (real-store assertions).
- No package-root or `./mcp` lifecycle-authority export; the control plane
  remains transport-free; the family stays I/O-free (crypto confined to
  `identity.ts`).
- Every grant/activation/occurrence payload is schema-gated before
  publication; stored records are authoritative; returned evidence is
  bounded correlation data.

## 7. Known F8 status

Unchanged and environmental: installed Pi **0.84.1** vs expected lane
**0.83.0** (`pi-adapter/compatibility/harness.test.js` — "F8: real Pi
0.83.0 path supplied explicitly is accepted"). It is the only failure in
the full regression and is unrelated to WP-12.

## 8. Slice 4 absence

Confirmed absent: `ExecutionAttemptRecord` construction/publication,
attempt orchestration, `orchestrationDecision`, `recordExecutionAttempt`,
and all future-work vocabulary remain banned family-wide by the static
guard; the publication allowlist excludes the attempt class; no Slice-4,
WP-5B, WP-13+, or transport work exists in the tree.

## 9. Final state

- HEAD: `b0710990a533ad335261cb44fb47b6c3dc5d0633` (unchanged).
- Working tree: all 3A + 3B + closure changes present, unstaged.
- Staging: empty. Nothing committed, staged, pushed, tagged, or released.

## 10. Unresolved findings

None. All six MINOR findings are closed; no CRITICAL/MAJOR/MODERATE finding
exists at any review stage. The only known issue remains the environmental
F8 (out of scope, unchanged).

## 11. Final closure review record

Final read-only closure review verdict: `WP-12 SLICE 3 FINAL CLOSURE
REVIEW ACCEPTED — READY FOR IMPLEMENTATION CLOSURE COMMIT`.

- **FCR-W12-S3-001 — CLOSED (MINOR, editorial).** The combined working-tree
  delta is `10 modified + 7 untracked` (four new test files plus three new
  reports); the earlier `10 modified + 6 untracked` wording in §1 was a
  count-only arithmetic slip and is corrected above. Non-behavioral; no
  implementation change resulted.

WP-12 SLICE 3 INTEGRATION COMPLETE — READY FOR FINAL CLOSURE REVIEW
