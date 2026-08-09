# WP-12 Slice 3B — Activation + Occurrence + Crash Recovery — Implementation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Phase:** internal implementation phase 3B of Slice 3 (second internal
phase; not a closure unit).
**Status:** implementation complete; left unstaged/uncommitted for
independent senior review.
**3A senior-review verdict carried forward:** `WP-12 SLICE 3A SENIOR REVIEW
ACCEPTED — READY FOR 3B IMPLEMENTATION AUTHORIZATION`. The accepted
non-blocking 3A MINOR findings (SIR-W12-S3A-001/002/003) are NOT
prerequisites and are carried forward for Slice-3 closure housekeeping; no
3B change was expanded to resolve them (no touched line required a
correction).

## 1. Baseline

Repository `/home/chef/Documents/Project_Gateway_MCP`, branch `main`,
HEAD verified before any edit: `b0710990a533ad335261cb44fb47b6c3dc5d0633`
(`docs: establish WP-12 slice 3 contract baseline`); working tree carried
the accepted unstaged 3A implementation (preserved byte-for-byte — 3B
edits are additive on top of it); staging empty; no stash;
`git diff --check` clean. No Git mutation was performed (read-only
inspection only).

## 2. Changed paths (all unstaged/uncommitted)

Production (all under `src/control-plane/`):

- `types.ts` — `decideActivation`/`createOccurrence` operations;
  `activationRole`; `grantId`/`reservedOccurrenceId` request operands;
  host-injected `consumerSupport` and `policyEvidence`; `activation-record`
  / `execution-occurrence-record` class constants; outcomes `activated` /
  `recovered`; evidence fields (decision, runtimeGrantId,
  reservedOccurrenceId, occurrenceRecordId/Class/Digest/AuditEventId,
  activationRecordId); taxonomy token `replay-denied`.
- `subject.ts` — exact-key capture for `decideActivation` and
  `createOccurrence` (grant-id/occurrence-id syntax; role-assertion keys
  `activationRole`/`activationAuthority`).
- `records.ts` — `buildActivationRecordPayload` (five issuance IDs, grant,
  reservation, decision) and `buildExecutionOccurrenceRecordPayload`
  (responsible_role constant `trusted-control-plane`).
- `core.ts` — `decideActivation` decision path (gates A–E, PHASE-1/PHASE-2,
  eight-check evaluation, two-publication accepted transition, durable
  denied decision) and `createOccurrence` recovery path (two-stage read
  discipline, historical-correlation-only repair, graph-entry scoping).
- `graph.ts` — `mapActivationGraphFindings` (rejection mapping).
- `store-boundary.ts` — seven-class publication allowlist.

Tests:

- `tests/unit/wp12-helpers.ts` — activationRole/consumerSupport/
  policyEvidence context overrides; `makeCustomPolicy` / `makeCustomBundle`
  / `makeActivationKit` / `activationDenyRule` (WP-4-validated custom
  policy + bundle with recomputed canonical digests); `seedFullGrantChain`
  kit support.
- `tests/unit/wp12-activation.test.ts` — new focused file (18 tests).
- `tests/unit/wp12-activation-store.test.ts` — new real WP-8 store file
  (10 tests).
- `tests/unit/wp12-static-guard.test.ts` — Slice-3 vocabulary confined to
  owning modules; seven-class allowlist proof; `ExecutionAttemptRecord` and
  all future-work vocabulary still banned family-wide.

Report: `docs/reports/wp-12-slice-3b-implementation-report.md` (this file).

WP-4, WP-6, WP-8 source: NOT modified (`git status` confirms).

## 3. Architecture/delta

The Slice-3A pattern is extended: exact-key untrusted requests + host
context (activation role, consumer/enforcement support, validated
AuthorityPolicy evidence) + the SAME canonical bundle-subject/workspace
coordination key + under-lock re-read/revalidation + the accepted WP-4
lifecycle graph and the accepted point-of-use machinery
(`evaluatePointOfUseEligibility`). No new lock model, no new store, no
second evaluator, no transport. The seven-class publication allowlist is
now exact; `ExecutionAttemptRecord` production stays disabled (Slice 4).

## 4. Contract coverage (decideActivation)

- **Request (S3-D6):** `operation`, `subject` (exact bundle), `workspaceId`,
  `registryEcho` (REQUIRED), `grantId`, `reservedOccurrenceId`. Unknown
  keys → `request-invalid`; role keys → `approver-not-independent`;
  malformed grant/reservation identity → `request-invalid`.
- **Gate A (command boundary):** host context genuine; activation role
  host-asserted (missing → `lifecycle-state-missing`); workspace resolves;
  echo matches (else `registry-context-mismatch`); coordination lock
  acquired (contention → `lock-conflict`).
- **Gate B (grant correlation):** grant exists; workspace matches; bundle
  reference matches the exact requested bundle; `reserved_occurrence_id`
  matches. All failures non-disclosing `lifecycle-state-missing`.
- **Gate C (reservation undecided):** any prior accepted or denied
  activation for the reservation, or an existing occurrence → `replay-denied`.
- **Gate D (PHASE-1 five-issuance correlation):** for each of the five
  required subjects (bundle + TaskSpec + AuthorityPolicy + ContextManifest
  + CompletionContract), exactly ONE issuance derived by exact subject +
  workspace + `execution-use` using the accepted Slice-1/2
  current-record-selection primitive (currentness-filtered uniqueness; a
  single historical candidate remains correlatable so expired/revoked-
  but-correlated state reaches PHASE-2). Zero → `lifecycle-state-missing`;
  ambiguity → `lifecycle-conflict`. The correlated issuance's referenced
  approval must exist with exact subject/workspace (malformed chain →
  rejection). No created_at/record-ID/first-enumeration/newest selection.
- **Gate E (PHASE-1 recordability):** the five issuances, five approvals,
  and the grant are REG entries in the accepted graph evaluation; any
  registry incompatibility → `registry-context-mismatch` rejection. LFC/
  EXE integrity findings map to closed rejection tokens
  (`lifecycle-state-missing`, `issuance-not-authorized`, `replay-denied`,
  `eligibility-denied`).
- **PHASE-2 (eight checks; every failure → durable
  `ActivationRecord(denied)`, no occurrence, `decision: 'denied'`):**
  1. bundle reference resolves and digest verifies (evidence correlation;
     failure is a rejection `subject-invalid`);
  2. exactly one of each member (rejection `subject-invalid`);
  3. active matching approval and issuance — currentness of the five
     correlated issuances + five referenced approvals (revoked/expired →
     denial);
  4. required features/capabilities/extensions/consumer support/registry —
     accepted point-of-use evaluation sections 11 + REG (denial);
  5. core bindings resolve to the bundle workspace — point-of-use WSP
     checks + workspace-scoped correlation (denial);
  6. current revocation/validity — chain currentness + grant
     revocation/validity via the accepted machinery (denial);
  7. policy × grant × ceiling × consumer/enforcement intersection via
     `evaluatePointOfUseEligibility` with the fixed activation requested
     use (`project-gateway.workspace-read` / `read` /
     `configured-artifact-area` / `exact:activation`); grant narrowing
     (max-actions vs CURRENT ceilings, read-only, require-exact-resource),
     policy deny/unknown-denied, consumer support, bundle requirements,
     and grant revocation/validity/registry are all enforced by the
     accepted machinery (denial);
  8. `activation_limit` — accepted-record count for the exact bundle
     issuance (immutable-record derived; denied records never consume;
     recovery never double-counts); exhaustion → denial.
- **Decision:** accepted → publish `ActivationRecord(accepted)` FIRST,
  then the mandatory internal `ExecutionOccurrenceRecord` (same lock,
  §15 SCR-W12-005); denied → exactly one `ActivationRecord(denied)` with
  the SAME five issuance IDs, grant, and reservation; zero occurrences.
  The graph candidate for the rejection gate carries decision 'accepted'
  because the evaluation is decision-independent at that point (the
  EXE-002/LFC-008 denied-activation checks describe the post-denial
  derived state and must not reject the just-made denial).

## 5. Activation/recovery behavior

- Complete accepted evidence exists ONLY after both publications are
  durable (§26.16): a failure on the second publication returns
  `store-failure` with NO occurrence identity in the evidence — the
  accepted-but-incomplete transition.
- `createOccurrence` is ONLY the recovery surface (S3-D2): request
  `operation`/`workspaceId`/`registryEcho`/`reservedOccurrenceId`; the
  exact accepted `ActivationRecord` is the authoritative anchor; every
  construction field derives from trusted stored facts. Preconditions:
  exactly one accepted activation for the reservation (none →
  `lifecycle-state-missing`; multiple → `occurrence-conflict`; denied →
  `lifecycle-state-missing`); workspace matches; no existing occurrence
  (→ `occurrence-conflict`); exact historical grant correlation
  (reservation/workspace/bundle bytes). Recovery NEVER allocates another
  occurrence ID, never creates another activation, never re-runs
  activation authority/currentness, never changes accepted→denied, and
  never re-decides eligibility — later grant/approval/issuance revocation
  or expiry does not prevent repair (historical completion, S3-D8).
- Registry A → B recovery (S3-D8/S3-D9): the new
  `ExecutionOccurrenceRecord` is the lifecycle graph ENTRY candidate under
  the CURRENT registry; the historical A activation/grant/issuance records
  are supporting correlation records, never reclassified as current REG
  entries; the occurrence binds B; the A records stay byte-identical.
  Ambiguous/conflicting state fails closed.

## 6. Publication/audit behavior

- Accepted: exactly two primary records + two WP-8 mechanical
  authorized-write audits (verified via `inspectAuditHistory`).
- Denied: exactly one primary record + one audit.
- Rejection: zero records + zero audits.
- Recovery: exactly one occurrence + one audit.
- No `AuthoritativeAuditEvent` primary publication, no project files, no
  lock artifact (real-store assertions).

## 7. Focused test results

`tests/unit/wp12-activation.test.ts` (18/18 pass): request boundary
(unknown keys, role assertion, malformed/missing operands, echo mismatch,
non-bundle subject, missing host role); rejections (grant missing/wrong
workspace/wrong bundle/reservation mismatch, missing member chain,
ambiguous issuances); durable denials (revoked issuance, revoked approval,
expired-but-correlated issuance, revoked grant, future/expired grant
validity, consumer mismatch, policy deny via the custom kit, ceiling
re-evaluation, `activation_limit` exhaustion with accepted-record
counting); replay after accepted and after denied; crash injection +
`createOccurrence` repair (exactly once, no new occurrence ID, second
repair → `occurrence-conflict`); recovery with no accepted/denied/
competing activation; historical completion after later grant revocation +
issuance revocation.

## 8. Real-store test results

`tests/unit/wp12-activation-store.test.ts` (10/10 pass, genuine WP-8
stores): accepted transition with exact stored bindings (five issuance
IDs, grant/reservation/bundle/workspace, byte-identical bundle references,
two audits); durable denied decision (exactly one record, zero
occurrences, one audit, five issuance IDs on the denied record); rejection
zero records/audits; injected crash after the accepted `ActivationRecord`
→ `store-failure` with no complete evidence → legal repair (exactly one
occurrence, reserved ID reused, one audit, repair conflict on retry);
recovery after grant revocation (historical completion); replay +
`activation_limit` exhaustion; `activation_limit` 2 chain with two accepted
activations and a third durable denial; same-bundle reentrancy
(outer decideActivation + inner decideActivation → `lock-conflict` under
the shared bundle key); registry A → B recovery with graph-entry scoping,
B-bound occurrence, byte-identical A records; zero project-file mutation +
no WP-8 lock-layout artifact.

## 9. Regression results

- `npm run typecheck`, `npm run build`, `npx tsc -p tsconfig.tests.json`:
  clean.
- Complete WP-12 focused family: 241/241 pass (213 pre-3B + 28 new 3B),
  run twice.
- Security family: green.
- Complete `npm test` (unit + integration + security + pi-adapter + mcp +
  runtime + drafting + writing + trusted + pointofuse-v2 + storage-crash +
  WP-7 discovery guard + WP-7 validated runner): executed 1783, pass 1782,
  fail 1, skip 0 (composition: unit 410 + integration/security/runtime/
  drafting/writing/trusted/pointofuse-v2 1020 + pi-adapter/mcp 348 +
  storage-crash 5; the earlier 1778 figure omitted the storage-crash suite).
- `git diff --check`: clean.

## 10. Known F8 status

Unchanged: installed Pi **0.84.1**, expected lane **0.83.0**
(`pi-adapter/compatibility/harness.test.js` — "F8: real Pi 0.83.0 path
supplied explicitly is accepted"). Not normalized. It is the ONLY failure
in the full regression; no NEW WP-12-related failure exists.

## 11. Explicit out-of-scope confirmation

NOT implemented: `ExecutionAttemptRecord`; `orchestrationDecision`;
`recordExecutionAttempt`; Slice 4; Pi execution; pi-guard activation;
WP-5B implementation (the bounded Slice-3 activation evidence required for
the future WP-5B handoff IS produced — §26.16 fields — but no WP-5B
surface exists); WP-13+; MCP/CLI/HTTP lifecycle mutation transport; new
filesystem/store/lock infrastructure; WP-4/WP-6/WP-8 source changes. The
static guard bans the Slice-4/attempt vocabulary family-wide and proves
the seven-class allowlist with `execution-attempt-record` excluded.

## 12. Final HEAD / working tree / staging

- HEAD: `b0710990a533ad335261cb44fb47b6c3dc5d0633` (unchanged).
- Working tree: all 3A + 3B changes present, unstaged.
- Staging: empty. No commit/push/tag/release/publication/install/deploy.

## 13. Unresolved issues

- The real-store 3B file adds ~6–8 minutes to the full suite (accepted
  WP-8 per-operation revalidation cost; the contract requires genuine
  real-store coverage for the two-publication transition and recovery).
- The 3A MINOR findings SIR-W12-S3A-001/002/003 remain open by design
  (carried forward to Slice-3 closure housekeeping).
- No other unresolved issues.
