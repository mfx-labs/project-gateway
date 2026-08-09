# WP-12 Slice 2B — Implementation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Slice:** 2B — `verifyCurrentLifecycleState` (second internal phase of the
Slice-2 closure unit; follows accepted 2A revoke).
**Phase:** implementation complete — focused tests green (twice) — full
regression acceptable (sole known environmental Pi F8) — awaiting senior
implementation review. Uncommitted, unstaged (per authorization). Not
self-approved.

## 1. Baseline

Repository `/home/chef/Documents/Project_Gateway_MCP`; branch `main`; HEAD
`35f97a2e877e64d35ec23d87fded86af6ac6c654` (`docs: establish WP-12 slice 2
contract baseline`); staging empty; `git diff --check` clean. Working tree
contained exactly the reviewed/accepted uncommitted Slice-2A tree (10 paths)
before any 2B edit. Verified before editing; nothing was reset or discarded.

## 2. Preserved 2A tree

The accepted 2A implementation was preserved EXACTLY except for the minimal
additive changes required by 2B (see §3). No 2A duplicate/subsumption
semantics, reentrancy behavior, registry-echo handling, revocation role
model, or publication boundary was altered. All 138 accepted 2A-focused
tests remain green (included in the 172-test family, §35). The only
shared-helper changes are the two additive `graph.ts` adapter extensions
(optional `extraRegistryEntries` parameter and a new verification-finding
mapper); both are provably behavior-preserving for existing call sites
(optional parameter defaults to absent; the mapper is new and unused by
Slice-1/2A paths).

## 3. Exact files changed

Production (6 modified, all within `src/control-plane/`; no new production
module):

- `src/control-plane/types.ts` — operation union now exactly five
  (`verifyCurrentLifecycleState` added); verify request operands
  (`capabilityRequirements`, `consumerSupport`; shared `registryEcho`);
  `CAPABILITY_IDENTIFIER_RE` (accepted `project-gateway.<class>` grammar);
  operand bounds; `'verified'` outcome; bounded non-authorizing verify
  evidence fields on `Slice1Success.evidence` (recordClass/recordId +
  purpose/useClass + approvalRecordId/issuanceRecordId + registry id/digest
  + verifiedAt + currentState + intersection). No new failure token.
- `src/control-plane/subject.ts` — `verifyCurrentLifecycleState` capture
  branch: exact-key set; canonical subject (existing parser reused);
  workspace-subject binding; `purpose` XOR `useClass` (both/neither →
  request-invalid); shared `parseRegistryEcho` reuse; capability
  syntax capture (malformed → request-invalid); consumer-support shape
  capture (accepted `ConsumerSupportDeclaration` fields; malformed →
  request-invalid). Capture failures now carry the operation when known so
  the command layer can apply the contract's subject-invalid mapping for
  verify only.
- `src/control-plane/graph.ts` — additive only: optional
  `extraRegistryEntries` on `LifecycleGraphInputs` (registry entry check
  extended to applicable revocation records for verification; LFC entry
  scoping unchanged; absent → byte-identical Slice-1 behavior);
  `mapVerificationFindings` (REG → registry-context-mismatch; LFC-001/002 →
  form's missing-approval category; LFC-003 → issuance-not-authorized;
  other → eligibility-denied).
- `src/control-plane/core.ts` — verify decision block (`runVerify`,
  `readObservedState`, `applicableRevocationIds`, `verificationGraph`,
  `verifyIntersection`, `verifyApprovalForm`, `verifyIssuanceForm`);
  `executeSlice1Command` dispatches verify directly after capture with NO
  role gate, NO capability pre-gate, and NO coordination lock; `runOperation`
  switch extended defensively. No accepted body changed.
- `src/control-plane/store-boundary.ts`, `src/control-plane/records.ts` —
  NOT changed by 2B (2A content untouched).

Tests/helpers (2 new + 1 modified):

- `tests/unit/wp12-verify.test.ts` (23 tests) — pure-core focused suite.
- `tests/unit/wp12-verify-store.test.ts` (10 tests) — REAL WP-8 store
  integration suite (SCR-W12-S2-004).
- `tests/unit/wp12-static-guard.test.ts` — verify vocabulary confined to
  its owning modules; a new guard proves the verify decision block has no
  publication call path and no coordinator dependency; Slice-3+ ban list
  updated (verify token moved from the ban into the allowlist mechanism).

No source outside `src/control-plane/` changed; no WP-4/WP-6/WP-8/WP-11
source, schema, fixture, package, lockfile, or generated file changed
(`npm run build` regeneration produced zero generated drift).

## 4. 2B architecture

`verifyCurrentLifecycleState` is a READ-ONLY, FAIL-CLOSED, transport-free,
NON-AUTHORIZING, non-linearizable, mutation-free current-state evaluator in
the same injected-boundary pattern: untrusted exact-key request →
host-injected trusted context (genuine WP-6 configuration, trusted
workspace resolution, accepted registry context, WP-8 store boundary,
trusted time source, WP-6 ceilings) → bounded trusted-store reads over the
records observed during one completed evaluation → deterministic
classification → accepted WP-4 graph evaluation (LFC/REG) → capability/
consumer/ceiling intersection → bounded evidence. It creates ZERO lifecycle
records, ZERO audit events, ZERO project-file/Git/config mutation, and
takes NO mutation coordination lock. No second state machine, no second
store boundary, no authority export.

## 5. Request model

Exact-key request (unknown keys → request-invalid; role/authority keys →
`approver-not-independent`): `operation = verifyCurrentLifecycleState`;
canonical `subject`; `workspaceId`; REQUIRED `registryEcho`; REQUIRED
`capabilityRequirements`; REQUIRED `consumerSupport`; PLUS exactly ONE
scope selector — `purpose` (approval form) or `useClass` (issuance form).
Both or neither → request-invalid. Repository naming conventions reused;
no aliases.

## 6. Trusted-context model

Host-injected only: `configuration` (runtime-genuine WP-6), `registry`
(accepted context), `operator` (structural roles; verify asserts NO role),
`store` (WP-8 boundary), `coordinate` (present in the accepted host
composition but NEVER called by verify — proven by tests and static guard),
`identity` (trusted time + record-ID source; record-ID source unused by
verify). The request cannot supply config, ceilings, registry, store,
clock, roles, coordinator, provenance, filesystem roots, or graph inputs.

## 7. Subject correlation

The existing `parseCanonicalSubject` (exact Decision-3 identity:
protocolId, protocolVersion, kindId, kindVersion, instanceId, revisionId,
digest + exact workspace binding) is reused; no second parser. Malformed
subject in a verify request maps to `subject-invalid` (contract §23-B),
distinct from other shape failures (request-invalid); this is the only
capture-mapping change and is scoped to verify. Matching uses the accepted
`subjectMatchesCanonical`/`matchingApprovals`/`sameIssuanceScope`
correlation. No path/filename/repository-location/latest-revision
derivation anywhere.

## 8. Registry echo

REQUIRED untrusted correlation operand, shared `parseRegistryEcho`
(exact keys, snapshot-id + digest syntax). Missing/malformed →
request-invalid (capture); differing from host-injected context →
`registry-context-mismatch`; exact match → continue. The echo never
selects, downgrades, or overrides registry state.

## 9. ConsumerSupportDeclaration

The accepted `ConsumerSupportDeclaration` type and fields are reused
exactly (consumerId, supportedProtocolFeatures,
supportedConsumerCapabilities, supportedExtensionNamespaces). Untrusted
declarative input; shape-validated at capture (exact keys, string arrays,
bounds; malformed → request-invalid); creates no authority; can never
widen host ceilings. Unsupported required capability → eligibility-denied.

## 10. Capability requirements

`capabilityRequirements` uses the accepted `project-gateway.<class>`
identifier grammar (`CAPABILITY_IDENTIFIER_RE`, capability-vocabulary.md
convention) — no second grammar. Malformed identifier → request-invalid
(capture); well-formed but unknown/unsupported → eligibility-denied; known
capability denied by the CURRENT host ceiling → ceiling-denied; known
capability incompatible with consumer support → eligibility-denied. No
`unknown-capability` or new token; ceilings are always re-evaluated at
verification time (never frozen).

## 11. Approval-form verification

Success requires EXACTLY ONE usable current ApprovalRecord: exact subject
+ exact workspace + exact purpose + accepted ValidationRecord chain
(LFC-001/002 via the accepted graph) + no applicable effective revocation
+ not expired + exact current registry context + no ambiguity + requested
capability/consumer/ceiling intersection. Mappings: no matching →
lifecycle-state-missing; explicitly revoked → approval-revoked; expired →
lifecycle-state-missing; >1 current → lifecycle-conflict (no newest, no
arbitrary selection); old-registry candidate → registry-context-mismatch;
broken validation chain → lifecycle-state-missing; revoked approvals are
historical and never block a distinct current approval.

## 12. Issuance-form verification

Success requires EXACTLY ONE usable current IssuanceRecord (exact subject
+ workspace + useClass + no applicable effective issuance revocation + not
expired + exact registry + no ambiguity + intersection) whose referenced
ApprovalRecord is itself CURRENT AND USABLE (revocation, expiry, registry,
validation chain, LFC-003 dependency). Mappings: no/revoked/expired
issuance → issuance-not-authorized; referenced approval explicitly revoked
→ approval-revoked; referenced approval otherwise unusable/missing →
issuance-not-authorized; >1 current issuance → lifecycle-conflict. No
`issuance-revoked` token.

## 13. ValidationRecord treatment

ValidationRecords remain immutable, non-revocable, non-authorizing
supporting evidence. The graph's LFC-001/002 rule (approval references ≥1
ValidationRecord with matching subject) is applied to the observed set;
newer validation never erases older; no "latest validation" selection; no
validation currentness invented; ValidationRecord is never returned as
authority.

## 14. RevocationRecord consumption

The accepted 2A `currentnessOf` is reused verbatim: a revocation applies
when exact target ID matches AND scope is all-uses-or-matching AND
`effectiveAt <= trustedNow`; future-dated revocations are historical and
do not invalidate current use until effective; equality counts as
effective. No second revocation evaluator. The graph adapter additionally
includes applicable-scope revocation records (same target + scope,
including future-dated) in the REGISTRY entry check per contract §17
("relevant RevocationRecord state must satisfy the accepted CURRENT
registry rules"); behavior for approve/issue is byte-identical (optional
parameter).

## 15. Expiry

Existing trusted time source; expired when `validUntil <= trustedNow`
(equality counts as expired — `timestampAtOrBefore` reused). No grace
period, tolerance, freshness cache, delayed invalidation, or ambient
`Date.now()`. Malformed stored timestamps are schema-impossible; stored
state that is unreadable/malformed at the envelope level fails closed as
store-failure via the accepted read boundary. No new expiry tokens.

## 16. Registry currentness

The accepted REG rules (REG-001/002/008, LFC-010) are applied through
`evaluateLifecycleRegistryContext` inside the accepted graph evaluation
(entry = verified record; extra entries = applicable revocation records).
Old-registry approvals/issuances may remain historical (and in 2A remain
valid revocation targets) but do not verify as CURRENT usable state →
registry-context-mismatch. Records are never rewritten.

## 17. WP-4 reuse

The accepted WP-4 lifecycle graph (`evaluateCandidateLifecycleRecord` via
the control-plane adapter) owns LFC-001/002/003 and REG rules; the graph
runs with empty artifact maps (verification has no artifact evidence; the
accepted graph skips artifact-resolution checks when the artifact is
absent, while the validation-chain rule still applies). WP-12 owns record
selection, operational currentness (revocation/expiry), multiple-current
detection, and public result mapping. No graph call unrelated to the
verification form is forced; no graph-owned blocking rule is bypassed.

## 18. WP-6 reuse

Runtime-genuine configuration (`isGenuineValidatedTrustedWorkspaceConfiguration`),
trusted workspace resolution (`lookupValidatedWorkspace`), the accepted
capability vocabulary (`isKnownCapability`), and the accepted presence-aware
ceiling gate (`capabilityCeilingDenied`) are reused unchanged. Current
ceilings are always re-evaluated; historical records never freeze old
ceilings and are never mutated by configuration change.

## 19. Record-selection determinism

For each required class: enumerate (accepted boundary) → correlate exact
subject/workspace/scope → classify currentness (accepted `currentnessOf`)
→ count usable records. 0 → operation-specific absence/failure; 1 → use
it; >1 → lifecycle-conflict. No latest-by-timestamp, lexicographic,
first-array-element, or newest-file selection.

## 20. Multiple-current behavior

More than one current matching ApprovalRecord (approval form) or
IssuanceRecord (issuance form) → lifecycle-conflict, before any
intersection evaluation and before revoked-dependency evaluation.
Revoked/expired records are classified non-current and are historical
facts only.

## 21. Success evidence

Bounded evidence: recordClass + recordId (established result naming) +
exact canonical subject + workspaceId + purpose OR useClass + exact
current ApprovalRecord ID (approval form: the verified record; issuance
form: the referenced approval) + exact current IssuanceRecord ID (issuance
form) + current accepted registry id + digest + trusted verification time
(`verifiedAt`) + derived facts `currentState: 'current'` and
`intersection: 'satisfied'`. NOT included: raw payloads, revocation sets,
store paths, operator identity, roles, config, lock keys, snapshot/evidence
IDs, freshness/expiry tokens, transferable grants.

## 22. Non-authorizing semantics

Verification evidence is a distinct outcome (`verified`) with its own
evidence facts; no mutating operation (approve/issue/revoke, and future
Slice-3+ operations by the same exact-key discipline) accepts any verify
operand — proven by tests: passing a verification result object as an
operand to approve/issue/revoke → request-invalid (unknown key). An old
success result is never sufficient for later privileged work; freshness
comes only from re-evaluation of authoritative current state (§25.18).

## 23. Failure taxonomy / precedence

Only committed categories used. Deterministic precedence per contract
§23: A malformed request/shape → request-invalid; B malformed canonical
subject → subject-invalid (verify only); C registry echo mismatch →
registry-context-mismatch; D store/integrity/read failure → store-failure;
E multiple current → lifecycle-conflict; F explicitly revoked approval →
approval-revoked; G missing/unusable approval → lifecycle-state-missing
(approval form) / issuance-not-authorized (issuance dependency); H
missing/revoked/expired issuance → issuance-not-authorized; I current
ceiling denial → ceiling-denied; J other capability/consumer/policy
incompatibility → eligibility-denied. Graph finding order is never
exposed; the graph mapper fixes REG → LFC → other precedence.

## 24. Read consistency

Verification performs bounded trusted-store reads (five class
enumerations + per-record reads via `readClassPayloads`, fail closed) and
evaluates the records OBSERVED during that completed evaluation. It does
NOT acquire the WP-12 mutation coordination lock, is NOT linearizable, is
NOT an atomic snapshot, reserves nothing, and freezes nothing. No snapshot
primitive is invented. Enumeration/read failures fail closed as
store-failure; semantic absence (missing referenced approval) is
issuance-not-authorized — the accepted semantic/infrastructure
distinction.

## 25. Concurrent revoke race

Explicitly tested (pure suite): a real concurrent revoke published during
the verification read window (after revocation state was observed) is not
reflected in the completing verification — the verifier may complete with
its observed state. This is acceptable because the evidence is
non-authorizing, verification mutates nothing and reserves nothing, and
later privileged use re-evaluates authoritative state (a fresh verification
immediately after the race returns approval-revoked). No lock was added to
hide the race.

## 26. Observed-record-set consistency

Each class read fails closed on any enumeration/read malfunction
(store-failure). Because the store is append-only and the race is the
admitted non-linearizable behavior (§25), no cross-read versioning scheme
is invented; the accepted semantic/infrastructure distinction is applied.

## 27. Store failure / recovery

Any authoritative-store read/enumeration/integrity failure (recovery
required, unreadable record, malformed envelope, quarantine/foreign-entry
condition) → store-failure, bounded and redacted (no ERR-STO-* codes,
paths, errno, stacks, raw findings — tested on the real store). Semantic
absence (not-found) is never store-failure.

## 28. Zero mutation invariant

Proven on the real store: a counting publish wrapper around the genuine
boundary records ZERO publications during verification; all five lifecycle
class counts are unchanged before/after; the verified target is
byte-identical; workspace root stays empty; no lock artifact remains.
Not inferred — tested.

## 29. WP-8 store boundary reuse

Only the accepted `readLifecyclePayload` / `enumerateLifecycleRecords`
boundary surface is used (through `readClassPayloads`). No direct fs, no
second store reader, no WP-8 source change, no publication, and the
publishable-class allowlist remains EXACTLY the four accepted classes
(ValidationRecord, ApprovalRecord, IssuanceRecord, RevocationRecord).

## 30. Zero audit side effect

Real-store before/after `inspectAuditHistory` on the verified record:
findings deep-equal before and after verification; no audit event is
created (verification performs no authorized write). Also asserted:
verification evidence carries no `auditEventId`.

## 31. No coordinator use

Proven three ways: (1) runtime — a recording/asserting coordinator records
ZERO `withLock` calls during successful verification (pure + real store);
(2) runtime — verification succeeds while another operation HOLDS the
lifecycle key (no lock dependency); (3) static — the verify decision block
in `core.ts` (between `function runVerify(` and `function runOperation(`)
contains no `publishLifecycleRecord`, `withLock`, or `context.coordinate`
token.

## 32. Replay / staleness

Tested: verify succeeds → 2A revoke publishes → the old success object is
rejected as an operand by approve/issue/revoke (request-invalid) → a fresh
verification returns approval-revoked. Same mechanism covers expiry
advancement, ceiling narrowing, and registry change (each tested as a
fresh verification failing per current state). No freshness/expiry tokens;
historical records are never mutated.

## 33. Current ceiling narrowing

Real-store test: an approval seeded under a permissive genuine ceiling
(file-edit permitted) is verified under a narrowed genuine host
configuration — verification re-evaluates CURRENT ceilings and returns
ceiling-denied for the requested capability, while a no-capability
verification of the same historical approval still succeeds and the record
is never mutated.

## 34. Consumer-support denial

Tested: a known capability permitted by the host ceiling but absent from
the ConsumerSupportDeclaration → eligibility-denied (never
ceiling-denied); an unknown-but-well-formed capability →
eligibility-denied; a capability excluded by the CURRENT ceiling →
ceiling-denied.

## 35. Focused test results

WP-12 control-plane focused family (`wp12-*.test.js`): **172 tests, 172
pass, 0 fail, 0 skip — two consecutive runs** (110 Slice-1 + 20 revoke
pure + 8 revoke real-store + 23 verify pure + 10 verify real-store + 1
new static-guard test). Static guard suite: 9 tests green.

## 36. Full regression

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` | pass (51 schemas, 358 corpus inputs; zero generated drift) |
| `npx tsc -p tsconfig.tests.json` | pass |
| WP-12 focused family (×2) | 172 / 172 pass each |
| storage unit | 431 pass / 0 fail / 2 pre-existing skips |
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
| `npm test` | **1709 total — 1708 pass / 1 fail** (F8) |
| `git diff --check` | clean |

## 37. Known environment failure

Exactly one, unchanged and unrelated: `tests/pi-adapter/compatibility/
harness.test.js` — "F8: real Pi 0.83.0 path supplied explicitly is
accepted" fails because installed Pi is **0.84.1** while the suite expects
**0.83.0**. Not normalized; no pi-adapter file touched.

## 38. git diff --check

Clean.

## 39. Final HEAD

`35f97a2e877e64d35ec23d87fded86af6ac6c654` — unchanged.

## 40. Working tree / staging

Working tree: 6 modified control-plane modules (5 accepted 2A + the 2B
additive `graph.ts`) + 3 modified test files + 4 new test files + the 2A
report, all unstaged and uncommitted. Staging: empty. Slice-2 work remains
fully uncommitted for independent senior implementation review.

## 41. Slice-3+ absent

No RuntimeGrant, issueRuntimeGrant, activation, decideActivation,
occurrence reservation, ExecutionOccurrenceRecord, ExecutionAttemptRecord,
orchestration, PiEnforcementEvidence production, ExecutionResult,
TrustedReceipt, or execution capability. No future placeholders with
behavior (static guard: Slice-3+ production vocabulary ban unchanged
family-wide).

## 42. Transport absent

No MCP tool, MCP verification method, CLI, HTTP, stdio transport,
package-root authority export, or `./mcp` authority export. Verification
remains internal host-composed control-plane behavior (static guard:
package-root/`./mcp` bans hold).

## 43. No commit/push/tag/release/publication/install/deploy

Confirmed — no Git mutation of any kind was performed; no package
operations.

## 44. Unresolved issue

None. One deliberate documented boundary: verification is non-linearizable
by contract; a verification racing a concurrent revoke may complete with
its observed pre-revoke state, which is acceptable only because the
evidence is non-authorizing (proven, §25). The registry-entry check for
applicable revocations includes future-dated applicable-scope records per
contract §17's "relevant RevocationRecord state" clause (fail-closed
direction; real-store tested).

WP-12 SLICE 2B VERIFY CURRENT LIFECYCLE STATE IMPLEMENTED — READY FOR SENIOR REVIEW

## 45. Senior review outcome (post-review closure addendum)

The independent senior implementation review returned:

`WP-12 SLICE 2B SENIOR REVIEW ACCEPTED — READY FOR SLICE 2 CLOSURE AUTHORIZATION`

Findings: 0 CRITICAL, 0 MAJOR, 0 MODERATE, 1 MINOR
(SIR-W12-S2B-001 — static-guard precision). All acceptance criteria of the
review were satisfied; the single MINOR was non-blocking and is closed by
the final closure correction (§46).

## 46. SIR-W12-S2B-001 — static-guard precision (CLOSED)

Finding: the static-guard verify token window spanned `function runVerify(`
→ `function runOperation(`, covering `runVerify` alone and leaving the 2B
verify helper bodies (`readObservedState`, `applicableRevocationIds`,
`verificationGraph`, `verifyIntersection`, `verifyApprovalForm`,
`verifyIssuanceForm`) outside the guarded window. Runtime proofs (counting
publish wrapper; recording coordinator; real-store audit/class-count
checks) already carried the semantic guarantees, so the finding was
precision-only.

Correction (test/guard only — zero production change): the window now
spans `function readObservedState(` → `function runOperation(`, covering
ALL seven verify helpers, and the forbidden-token set is extended to
`publishLifecycleRecord`, `publishRecord`, `buildRecordEnvelope`,
`withLock`, `context.coordinate`, `writeAction`. The guard now catches any
future publication, publishable-record-builder, storage write-action, or
coordinator-lock token added inside ANY 2B verification helper. No
whole-file exception was created; existing per-module allowlists are
unchanged; runtime proofs are preserved (static guard + runtime proof).

`SIR-W12-S2B-001 — CLOSED`

## 47. Final integrated verification totals (post-review closure runs)

- WP-12 focused family: **172 pass / 0 fail / 0 skip — two consecutive
  runs** (110 Slice-1 + 20 revoke pure + 8 revoke real-store + 23 verify
  pure + 10 verify real-store + 1 static guard; the guard correction
  modified the existing guard test in place, so the count is unchanged).
- Integrated real-store Slice-2 end-to-end (A–H closure scenarios):
  current approval → verify success; revoke approval → RevocationRecord
  appended + target unchanged + fresh verify → `approval-revoked`;
  future-dated revocation → verify remains current; `effectiveAt == now`
  → revoked; current issuance → issuance verify success; revoke issuance
  → `issuance-not-authorized`; revoked required approval →
  `approval-revoked`; future all-uses + effective execution-use →
  `approval-revoked`. All green on genuine WP-8 stores.
- Full regression: see the Slice-2 closure report (§35) — sole failure F8
  (installed Pi 0.84.1 vs expected 0.83.0 compatibility lane), unchanged
  and environmental.
- `git diff --check` clean throughout.

Slice-2 closure authorization granted by the closure task; Slice 2 is
committed as ONE closure unit (2A + 2B) under
`feat: close WP-12 revocation and lifecycle verification slice 2`.

WP-12 SLICE 2B ACCEPTED AND CLOSED WITHIN WP-12 SLICE 2
