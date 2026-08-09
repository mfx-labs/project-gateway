# WP-12 Slice 2 — Closure Report

**Work package:** WP-12 — Local approval and execution control plane.
**Slice:** 2 (ONE roadmap closure unit) — internal phases 2A `revoke` and
2B `verifyCurrentLifecycleState`.
**Phase:** closed — senior-reviewed 2A + 2B implementation committed as one
closure unit.
**Status:** `WP-12 SLICE 2 CLOSED` (WP-12 as a whole remains NOT closed).

## 1. Baseline

Repository `/home/chef/Documents/Project_Gateway_MCP`; branch `main`;
pre-closure HEAD `35f97a2e877e64d35ec23d87fded86af6ac6c654` (`docs:
establish WP-12 slice 2 contract baseline`); staging empty; `git diff
--check` clean; no stash; working tree exactly the reviewed Slice-2
implementation tree (14 paths). Verified before any closure edit.

## 2. Exact final path inventory (committed set — 15 paths)

Modified (8): `src/control-plane/core.ts`, `src/control-plane/graph.ts`,
`src/control-plane/records.ts`, `src/control-plane/store-boundary.ts`,
`src/control-plane/subject.ts`, `src/control-plane/types.ts`,
`tests/unit/wp12-helpers.ts`, `tests/unit/wp12-static-guard.test.ts`.

Untracked → added (7): `docs/reports/wp-12-slice-2a-implementation-report.md`,
`docs/reports/wp-12-slice-2b-implementation-report.md`,
`docs/reports/wp-12-slice-2-closure-report.md` (this report),
`tests/unit/wp12-revoke.test.ts`, `tests/unit/wp12-revoke-store.test.ts`,
`tests/unit/wp12-verify.test.ts`, `tests/unit/wp12-verify-store.test.ts`.

No other path changed. No WP-4/WP-6/WP-8/schema/fixture/package/lockfile/
generated/runtime/MCP/adapter file changed.

## 3. Contract baseline

Committed `docs/reports/wp-12-pre-implementation-contract-decision.md` at
HEAD `35f97a2e…` (Decision 5; Slice-2 clarifications C1–C6; final
verification failure mappings §25.4; non-linearizable observed-record-set
semantics §25.17; registry/currentness rules §25.12/§25.15;
capability/consumer intersection §25.16; replay/stale-evidence §25.18;
no-transport boundary §25.20; minimum test contract §25.23). The
implementation reports are not normative.

## 4. Slice-2A accepted review history

2A `revoke` implemented on the contract baseline; focused senior rereview
returned `WP-12 SLICE 2A FOCUSED REREVIEW ACCEPTED — READY FOR 2B
IMPLEMENTATION AUTHORIZATION`. No 2A finding remained open.

## 5. Slice-2B accepted review history

2B `verifyCurrentLifecycleState` implemented on the accepted 2A tree;
independent senior implementation review returned `WP-12 SLICE 2B SENIOR
REVIEW ACCEPTED — READY FOR SLICE 2 CLOSURE AUTHORIZATION` with 0
CRITICAL / 0 MAJOR / 0 MODERATE / 1 MINOR (`SIR-W12-S2B-001`). All
acceptance criteria verified by the review, including independent runtime
probes (§14 scenario; issuance chain; broken validation chain; full
regression execution).

## 6. SIR-W12-S2B-001 — correction

Finding: the static-guard verify token window spanned `function
runVerify(` → `function runOperation(`, leaving the 2B verify helper
bodies outside the guarded window (readObservedState,
applicableRevocationIds, verificationGraph, verifyIntersection,
verifyApprovalForm, verifyIssuanceForm). Runtime proofs already carried
the semantic guarantees (zero publication; zero coordinator use; zero
audit).

Correction (test/guard only; zero production change): window widened to
`function readObservedState(` → `function runOperation(` — the complete
verification implementation surface, all seven verify helpers — and the
forbidden-token set extended to `publishLifecycleRecord`, `publishRecord`,
`buildRecordEnvelope`, `withLock`, `context.coordinate`, `writeAction`.
No broad whole-file exception; per-module allowlists unchanged; runtime
proofs preserved (static guard + runtime proof).

`SIR-W12-S2B-001 — CLOSED`

## 7. Final revoke architecture

2A: untrusted exact-key request (operation, workspaceId, targetRecordType,
targetRecordId, scope, effectiveAt, reasonCode, registryEcho) → host
revocation-authority role gate (request cannot confer the role) → registry
echo correlation → WP-6 trusted workspace resolution → pre-lock locator
read (existence/class/workspace + target-derived lifecycle coordination
key ONLY; never final authority) → process-local coordination lock on the
same subject/workspace key family as approve/issue → under-lock re-read →
duplicate/subsumption check → build exactly one `RevocationRecord` binding
the CURRENT accepted registry → schema gate → WP-8 publication with
mechanical write-audit → bounded result. Target never mutated.

## 8. Final verify architecture

2B: read-only fail-closed current-state evaluator. Untrusted exact-key
request (operation, canonical subject, workspaceId, registryEcho,
capabilityRequirements, consumerSupport, purpose XOR useClass) → NO role
gate → registry echo correlation → WP-6 trusted workspace resolution →
trusted time capture → bounded trusted-store reads (approvals, validations,
revocations, supersessions, issuances; fixed order; fail closed) → form
evaluation (approval or issuance) → accepted WP-4 graph (LFC/REG) with
applicable revocation records as registry entries → capability/consumer/
ceiling intersection → bounded non-authorizing evidence. No coordinator,
no publication, no audit write, no snapshot.

## 9. Authority separation

`revoke` requires host-asserted revocation authority (`revokerRole`);
`verifyCurrentLifecycleState` requires NO trusted operator role and
returns evidence only. Verification evidence cannot be supplied as
authority to recordValidation/approve/issue/revoke: mutation exact-key
capture rejects every verification-evidence field (runtime-tested).
No lifecycle authority derives from model output, artifact content,
repository content, registry echo, reasonCode, verification result, or
digest possession alone.

## 10. Request/trusted-context boundaries

Untrusted request operands are exact-key validated per operation; unknown
keys → `request-invalid`; role-assertion keys → `approver-not-independent`.
The request cannot supply configuration, ceilings, registry context, store,
clock, coordinator, roles, provenance, graph inputs, or filesystem roots.
Trusted context is host-injected only and anchored by the genuine WP-6
configuration brand and the accepted WP-8 store boundary.

## 11. RevocationRecord semantics

Append-only one-way withdrawal record; exact target (record type + record
ID); scope `all-uses` or `execution-use` (approval/issuance targets;
publication-only scopes → `request-invalid`); effectiveAt MAY be future;
reasonCode is descriptive metadata only, never decision-bearing; new
records bind the current accepted registry context (C6). Repeat same
applicable target+scope → `lifecycle-conflict`.

## 12. Duplicate/subsumption semantics

Exact-scope duplicate is existence-based (regardless of effectiveness);
cross-scope `all-uses` subsumption of `execution-use` is effectiveness-
aware (`effectiveAt <= trustedNow`); future `all-uses` does not block an
effective `execution-use` revoke; `execution-use` never subsumes
`all-uses` (broadening allowed).

## 13. Old-registry target semantics

A genuine historical ApprovalRecord/IssuanceRecord created under an older
registry snapshot MAY be revoked; the new RevocationRecord binds the
current accepted context; the target's own registry metadata is never
rewritten. Old-record revocability ≠ old-record currentness (§14).

## 14. Registry-currentness semantics

Registry-bearing records in the usable verification chain (the verified
approval/issuance and applicable revocation records) must match the
current accepted host registry snapshot exactly per the accepted REG rules
(REG-001/002/008, LFC-010) through `evaluateLifecycleRegistryContext`.
Old-registry candidate → `registry-context-mismatch` (real-store tested).
No compatibility algorithm independent of WP-4 REG logic; no record
rewrite.

## 15. Currentness algorithm

For each required class: enumerate (accepted boundary) → correlate exact
subject/workspace/scope → classify with the accepted `currentnessOf`
(revocation applies when exact target ID matches AND scope is all-uses-or-
matching AND `effectiveAt <= trustedNow`; expiry when
`validUntil <= trustedNow`) → count usable records. 0 → operation-specific
missing/unusable result; 1 → use it; >1 → `lifecycle-conflict`. No
latest/newest/first/ordering selection.

## 16. Approval verification

Exactly one current matching ApprovalRecord: exact subject + exact
workspace + exact purpose + required ValidationRecord chain (LFC-001/002
via the accepted graph) + no applicable effective revocation + not expired
+ current registry + requested intersection. Mappings: no matching →
`lifecycle-state-missing`; explicitly revoked → `approval-revoked`; expired
→ `lifecycle-state-missing`; multiple current → `lifecycle-conflict`.
Revoked/expired approvals are historical and never block a distinct
current approval.

## 17. Issuance verification

Exactly one current matching IssuanceRecord: exact subject + workspace +
useClass + no applicable effective issuance revocation + not expired +
current registry + no ambiguity, whose referenced ApprovalRecord (exact
ID) is itself current and usable. Mappings: no/revoked/expired issuance →
`issuance-not-authorized`; referenced approval explicitly revoked →
`approval-revoked`; referenced approval otherwise missing/unusable →
`issuance-not-authorized`; multiple current issuances → `lifecycle-conflict`.
No `issuance-revoked` token.

## 18. ValidationRecord treatment

Immutable, non-revocable, non-authorizing supporting evidence. The
approval's `validation_record_ids` decide which validation evidence
supports the chain; newer validation never erases older; no
latest-validation selection; validation presence alone cannot produce
verification success.

## 19. Expiry/effectiveAt semantics

Trusted host-injected time source only (no `Date.now()`, no new clock).
Revocation effective when `effectiveAt <= trustedNow` (equality counts);
record expired when `validUntil <= trustedNow` (equality counts). No grace
period, tolerance, cache, or evidence-expiry token.

## 20. WP-6 ceiling/consumer intersection

Current host WP-6 ceilings always re-evaluated at verification time
(never frozen into records); capability vocabulary `isKnownCapability`
reused. Malformed capability identifier → `request-invalid`; well-formed
unknown → `eligibility-denied`; known denied by current ceiling →
`ceiling-denied`; known but consumer-unsupported → `eligibility-denied`.
`ConsumerSupportDeclaration` (accepted type, exact fields) can only
narrow; empty requirements are vacuously satisfied.

## 21. Graph/WP-4 reuse

`evaluateCandidateLifecycleRecord` (accepted WP-4 `validateLifecycleGraph`
+ REG) is the single lifecycle-rule authority. The additive optional
`extraRegistryEntries` on `LifecycleGraphInputs` is verification-only,
absent for approve/issue (byte-identical Slice-1/2A behavior), derived from
trusted-store revocation records relevant to the candidate, bounded to the
REGISTRY entry check (revocations are not LFC subjects), and carries no
caller-controlled registry authority. `mapVerificationFindings` is a
bounded operation-specific mapping over the accepted finding set (REG →
registry-context-mismatch; LFC-001/002 → form's missing-approval category;
LFC-003 → issuance-not-authorized; other → eligibility-denied — fail
closed).

## 22. WP-8 reuse

Only the accepted `readLifecyclePayload`/`enumerateLifecycleRecords`/
`publishLifecycleRecord` boundary surface (genuine WP-8 read/enumerate/
publish machinery). No direct fs; no second store; no WP-8 source change.

## 23. Publication boundary

Publishable lifecycle classes remain exactly four: ValidationRecord,
ApprovalRecord, IssuanceRecord, RevocationRecord (`CONTROL_PLANE_PUBLISH_CLASSES`,
static-guard asserted). `revoke` publishes exactly one RevocationRecord on
success, zero on denial. `verify` publishes nothing.

## 24. Mechanical audit

The only audit behavior is WP-8's mechanical authorized-write audit event
at the publication durability point (one per successful revoke; asserted
in real-store tests). No `AuthoritativeAuditEvent` is published by WP-12;
verification creates zero audit events (real-store `inspectAuditHistory`
before/after deep-equal).

## 25. Zero-mutation verify proof

On genuine WP-8 stores, a counting publish wrapper around the genuine
boundary records ZERO publications during verification; all five lifecycle
class counts unchanged; the verified target is byte-identical (payload
digest); audit history unchanged; `store-v1/locks` empty; workspace root
empty. Not inferred — tested.

## 26. No-coordinator verify proof

Runtime: a recording coordinator logs ZERO `withLock` calls during
successful verification, and verification succeeds while another operation
HOLDS the lifecycle key. Static: the guarded verification surface contains
no `withLock`/`context.coordinate` token. No hidden lock via shared helper.

## 27. Observed-record-set consistency

Verification is non-linearizable by contract: bounded trusted-store reads
evaluated as one completed evaluation; no atomic snapshot, no reservation,
no transaction, no store freeze, no snapshot ID. Internally inconsistent
observed sets fail closed (issuance without its observed approval →
`issuance-not-authorized`; chain gaps → LFC findings; record IDs immutable,
append-only). The admitted verify↔revoke race (verify may complete with
pre-revoke observed state) is acceptable only because evidence is
non-authorizing; a fresh verify re-evaluates authoritative state.

## 28. Stale-evidence semantics

An old successful verification result is never sufficient for later
privileged work and cannot be replayed as approval/issuance/revocation
authority (mutation capture rejects it — `request-invalid`). Freshness =
re-evaluation of authoritative current state; no freshness token or
evidence expiry.

## 29. Failure taxonomy/redaction

Only committed §13 categories are used (request-invalid, subject-invalid,
approver-not-independent, eligibility-denied, ceiling-denied,
lifecycle-state-missing, lifecycle-conflict, approval-revoked,
issuance-not-authorized, registry-context-mismatch, store-failure,
lock-conflict, internal-failure). NOT added: target-unknown,
revoker-not-independent, already-revoked, non-current, stale-evidence,
verification-denied, approval-expired, issuance-revoked, snapshot-stale.
Store failures map to `store-failure` with no ERR-STO-* codes, paths,
errno, stacks, raw findings, or raw payloads; semantic absence stays
distinct from infrastructure failure.

## 30. Static guards

Family is I/O-free; single lifecycle-rule and schema authority reused;
exactly one WP-8 store boundary; no audit-event publication or writer-lock
API; Slice-2B verify vocabulary confined to core/types/subject; the
complete verification surface (readObservedState → runOperation) is
publication-/builder-/write-action-/coordinator-free; Slice-3+ vocabulary
banned family-wide; publication allowlist exactly four classes; no
package-root/`./mcp` control-plane exposure; no Git/MCP/transport/runtime
vocabulary.

## 31. Real-store integration

2B real-store suite (10 tests) + 2A real-store suite (8 tests) on genuine
initialized WP-8 stores: current approval/issuance success, actual
RevocationRecord consumption both classes, future/equality effectiveAt,
expiry boundaries, multiple-current conflicts, old-registry mismatch,
genuine read malfunction redaction, ceiling narrowing with genuine
configuration, publication/audit/lock/workspace zero-delta, duplicate
revocation, old-registry target revocation, reentrancy.

## 32. Integrated 2A→2B proof (final closure run)

Real-store A–H scenarios, all green: (A) current ApprovalRecord → verify
approval success; (B) revoke ApprovalRecord → RevocationRecord appended →
target unchanged → fresh verify → `approval-revoked`; (C) future-dated
approval revocation → verify remains current before effectiveAt;
(D) `effectiveAt == now` → verify sees revocation; (E) current
IssuanceRecord → issuance verify success; (F) revoke IssuanceRecord →
fresh verify → `issuance-not-authorized`; (G) revoked required
ApprovalRecord (issuance current) → `approval-revoked`; (H) future
all-uses + effective execution-use → execution use correctly revoked.
Historical records immutable throughout.

## 33. Slice-1 regression

All 110 Slice-1 tests green. Shared helpers (`currentnessOf`,
`matchingApprovals`, `sameIssuanceScope`, `parseCanonicalSubject`,
`subjectMatchesCanonical`, `timestampAtOrBefore`) byte-identical to the
committed HEAD; `evaluateCandidateLifecycleRecord` degenerates to HEAD
behavior when `extraRegistryEntries` is absent; capture mapping unchanged
(subject-invalid scoped to verify only).

## 34. WP-12 focused totals

**172 pass / 0 fail / 0 skip — two consecutive runs** (110 Slice-1 + 20
revoke pure + 8 revoke real-store + 23 verify pure + 10 verify real-store
+ 1 static guard). The SIR-W12-S2B-001 correction modified the existing
guard test in place (no count change).

## 35. Full regression

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass (51 schemas, 358 corpus; zero generated drift) |
| `npx tsc -p tsconfig.tests.json` | pass |
| WP-12 focused family (×2) | 172 / 172 pass |
| storage unit | 431 pass / 0 fail / 2 pre-existing skip |
| storage crash/recovery | 5 pass |
| lifecycle/unit | 169 pass |
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
| `npm test` | 1709 total — 1708 pass / 1 fail (F8) |

## 36. F8 environmental status

Sole failure, unchanged and unrelated: `tests/pi-adapter/compatibility/
harness.test.js` — "F8: real Pi 0.83.0 path supplied explicitly is
accepted" — installed Pi is 0.84.1 while the compatibility lane expects
0.83.0. Not normalized; no pi-adapter file touched.

## 37. git diff --check

Clean before staging, on the staged set (`git diff --cached --check`), and
after commit.

## 38. Staged path inventory

Exactly the 15 authorized paths (§2): 8 modified + 7 added. No
generated output, no unexpected path.

## 39. Cached-diff verification

`git diff --cached` inspected in full: every changed path belongs to
Slice 2; no WP-4/WP-6/WP-8/schema/fixture/package/lockfile/generated/
runtime/MCP/adapter change; no Slice-3+ code; no unrelated documentation
change; `git diff --cached --check` clean.

## 40. Commit metadata

Subject: `feat: close WP-12 revocation and lifecycle verification slice 2`.
Parent: exactly `35f97a2e877e64d35ec23d87fded86af6ac6c654`. Single commit;
not amended.

## 41. Final working tree/staging

Working tree clean; staging empty; `git diff --check` clean; no residual
untracked Slice-2 file.

## 42. No Slice-3+

No RuntimeGrant, issueRuntimeGrant, activation, decideActivation,
occurrence reservation, ExecutionOccurrenceRecord, ExecutionAttemptRecord,
orchestration, PiEnforcementEvidence, ExecutionResult, TrustedReceipt, or
execution capability (static guard + inspection).

## 43. No transport

No MCP tool, MCP verification method, CLI, HTTP, stdio mutation surface,
network API, package-root lifecycle-authority export, or `./mcp`
lifecycle-authority export. Both operations remain internal host-composed
control-plane behavior.

## 44. No push/tag/release/publication/install/deploy

Confirmed — none performed; no package operations; no Git mutation beyond
the single authorized closure commit.

## 45. WP-12 remaining work

WP-12 as a whole remains NOT CLOSED. Remaining: Slice 3 (RuntimeGrant +
activation + occurrence reservation/consumption) and Slice 4
(execution-orchestration decision + attempt recording). Next gate:
READ-ONLY WP-12 SLICE 3 CONTRACT / IMPLEMENTATION-READINESS ANALYSIS.
Slice 3 implementation is not started by this closure.

---

WP-12 SLICE 2 CLOSED
