# WP-12 Slice 3A — RuntimeGrant Foundation + RuntimeGrant Revocation — Implementation Report

**Work package:** WP-12 — Local approval and execution control plane.
**Phase:** internal implementation phase 3A of Slice 3 (not an independent
roadmap slice; not a closure unit).
**Status:** implementation complete; left unstaged/uncommitted for
independent senior review.

## 1. Baseline

Repository `/home/chef/Documents/Project_Gateway_MCP`, branch `main`,
expected HEAD verified before any edit:

- HEAD `b0710990a533ad335261cb44fb47b6c3dc5d0633`
  (`docs: establish WP-12 slice 3 contract baseline`)
- parent `598901832ed10eac399f8c17eee5c738b618fd88`
- working tree clean; staging empty; `git diff --check` clean; no stash;
  no pre-existing Slice-3 implementation.

No `git reset/checkout/clean/stash/branch/push/tag/release/publish/install/
deploy` was performed; Git usage was read-only inspection only.

## 2. Contract baseline hash

`b0710990a533ad335261cb44fb47b6c3dc5d0633` (the committed Slice-3 contract
baseline; authoritative document
`docs/reports/wp-12-pre-implementation-contract-decision.md`).

## 3. Exact changed paths

Production:

- `src/control-plane/types.ts` — operations, revoke target set,
  grant vocabulary, operator grant role, occurrence identity source,
  request fields, result taxonomy token `occurrence-conflict`, grant
  evidence fields.
- `src/control-plane/subject.ts` — `issueRuntimeGrant` exact-key capture
  (attemptLimit/validity/narrowedConstraints/registryEcho parsers),
  role-assertion keys for grant authority.
- `src/control-plane/records.ts` — `buildRuntimeGrantPayload`;
  `RevocationRecordPayloadInput.targetRecordType` extended with
  `RuntimeGrant`.
- `src/control-plane/core.ts` — `issueRuntimeGrant` decision path
  (chain correlation, occurrence allocation/freshness, ceiling/narrowing
  evaluation, graph revalidation, publication); RuntimeGrant-shaped
  coordination-key and canonical-subject derivation for revoke; grant
  role gate; `occurrence-conflict` message.
- `src/control-plane/graph.ts` — `mapGrantGraphFindings`.
- `src/control-plane/identity.ts` — `createCryptoOccurrenceIdSource`
  (`pgw:o:` + 32 hex); wired into `createHostIdentitySource`.
- `src/control-plane/store-boundary.ts` — five-class publication
  allowlist (added `runtime-grant`).

Tests:

- `tests/unit/wp12-helpers.ts` — deterministic occurrence-ID source,
  ceiling config options, `memberSubjectOf`/`grantChainSubjects`/
  `seedFullGrantChain` (real-command genuine chain seeding).
- `tests/unit/wp12-runtime-grant.test.ts` — new focused test file (26 tests).
- `tests/unit/wp12-runtime-grant-store.test.ts` — new real WP-8 store test
  file (15 tests; §35 A–W, §31 reentrancy, §32 old-registry scenario).
- `tests/unit/wp12-revoke.test.ts` — one test updated: `RuntimeGrant` is
  now a legitimate revoke target (Slice 3A), so the immutable-target list
  no longer includes it; a missing grant target maps to
  `lifecycle-state-missing`.
- `tests/unit/wp12-static-guard.test.ts` — 3A vocabulary confined to
  owning modules; five-class publication allowlist proof; 3B/Slice-4
  production vocabulary still banned family-wide.

Report:

- `docs/reports/wp-12-slice-3a-implementation-report.md` (this document).

WP-4, WP-6, WP-8 source: NOT modified (`git status` confirms).

## 4. 3A scope

Exactly the five owned items: `issueRuntimeGrant`; RuntimeGrant record
construction/publication; trusted internal occurrence-ID allocation;
RuntimeGrant extension of the existing `revoke` operation; the shared
coordination/currentness/store support strictly necessary for those
operations.

## 5. Explicit 3B exclusions (not implemented)

`decideActivation`; `ActivationRecord` production; `ExecutionOccurrenceRecord`
production; `createOccurrence` recovery; `activation_limit` consumption;
`ExecutionAttemptRecord`; Slice 4; WP-5B; Pi execution; pi-guard activation.
The static guard proves no 3B/Slice-4 production vocabulary exists anywhere
in the control-plane family, and the publication allowlist remains exactly
five classes.

## 6. issueRuntimeGrant request shape (exact-key, untrusted)

`operation = issueRuntimeGrant`; `subject` (canonical ExecutionBundle
revision identity); `workspaceId`; `registryEcho` (REQUIRED correlation
echo); `attemptLimit` (1..64); `validity` (`not_before`/`not_after`);
`narrowedConstraints` (non-empty, duplicate-free, schema forms). Unknown
keys → `request-invalid`; role-assertion keys → `approver-not-independent`.
Rejected caller keys include `reservedOccurrenceId`, grant ID,
approval/issuance IDs, policy/member identities, config, ceilings, store,
coordinator, clock, role, provenance, evidence objects.

## 7. Trusted host context

Reused unchanged from Slice 1/2: runtime-genuine WP-6 configuration,
workspace resolution, accepted registry context, genuine WP-8 store
boundary, trusted time, identity source (now including
`newOccurrenceId`), WP-12 decision coordinator, host-asserted roles
(now including `grantRole`), validated bundle evidence
(`subjectArtifact`). No second trust/config/store abstraction was created.

## 8. Grant-role boundary

`issueRuntimeGrant` requires the host-asserted `grantRole`; the command
payload never supplies it. A missing host role fails closed as
`lifecycle-state-missing`; an untrusted role assertion is rejected as
`approver-not-independent` (structural boundary reused; no new token).

## 9. Bundle/member derivation

The exact bundle identity is the canonical subject (request operand) and
must correlate with the branded validated bundle evidence
(`validateSubjectArtifact`; mismatch → `subject-invalid`). The four member
identities (TaskSpec, AuthorityPolicy, ContextManifest, CompletionContract)
are derived from the validated bundle model body exact-artifact references
(`bundleMembersOf`) — never caller-supplied. Kind `ExecutionBundle` is
required (other kinds → `request-invalid`).

## 10. Lifecycle dependency selection

Under the coordination lock, all authoritative state is re-read from the
trusted store (approvals, issuances, validations, revocations,
supersessions, grants, and the freshness-relevant activation/occurrence
classes — read-only). For each of the five required subjects (bundle + 4
members), exactly one CURRENT matching approval and exactly one CURRENT
matching issuance (exact subject + workspace + `execution-use`) must
correlate; the correlated issuance's referenced approval must itself be
current. Missing → `lifecycle-state-missing`; revoked approval →
`approval-revoked`; unusable issuance → `issuance-not-authorized`;
multiple current → `lifecycle-conflict`. No created_at/record-ID/
first-enumeration/newest selection ever occurs. Caller-supplied record IDs
cannot select authority (rejected at capture). A previously returned
`verifyCurrentLifecycleState` success object is never authority (rejected
as unknown key).

## 11. AuthorityPolicy derivation

`AuthorityPolicy` identity comes only from the validated bundle model; its
chain is subject to the same current approval/issuance/currentness
revalidation as every other member (S3-D4 policy prerequisite). No
grant-level policy evaluator was created; full policy × grant × ceiling ×
consumer intersection remains a later activation-time check.

## 12. narrowedConstraints

Untrusted requested narrowing; capture enforces schema-valid shape,
non-empty, duplicate-free, only the four admitted forms
(`max-actions`, `max-resources`, `read-only`, `require-exact-resource`);
malformed/duplicate/unknown → `request-invalid`. The parsed forms are
persisted verbatim on the grant.

## 13. max-actions

The ONLY numeric grant constraint with an accepted current WP-6 ceiling
comparison: requested N must satisfy N ≤ applicable current
`globalActionCeiling` and workspace `actionCeiling` (missing ceilings are
no additional restriction, accepted WP-6 semantics). Violation →
`ceiling-denied`, zero RuntimeGrant. Re-evaluated again at point of use
later (not implemented).

## 14. max-resources (unsupported, fail-closed)

Schema-valid but unsupported by the accepted enforcement architecture
(no WP-6 numeric resource ceiling; no authorized mapping to
`actionCeiling`; no resource-ceiling implementation invented). A request
containing `max-resources` → `eligibility-denied` — NOT `request-invalid`
(malformed-vs-unsupported distinction preserved), NOT `ceiling-denied`.
Future numeric resource enforcement requires separate authorization.

## 15. Boolean constraints

`read-only` and `require-exact-resource` are restriction forms; their
schema shape is validated; they are persisted as narrowing only. They
never become independent allow rules and add no resource/capability
authority. Use-specific enforcement remains activation/point-of-use owned.

## 16. Validity

Request `validity` (`not_before`, `not_after`): both accepted trusted
timestamps, `not_before <= not_after`; malformed/reversed →
`request-invalid`. Future `not_before` allowed; equality at both bounds
valid. No maximum duration, grace period, or automatic truncation was
invented.

## 17. attemptLimit

Untrusted requested narrowing operand, 1..64 inclusive (schema bounds);
malformed/out-of-range → `request-invalid`. Per reserved occurrence; no
attempt consumption, no `ExecutionAttemptRecord`, no activation in 3A.

## 18. Occurrence-ID generation

`reservedOccurrenceId` is allocated INTERNALLY via the host-injected
identity source (`newOccurrenceId`), format `pgw:o:` + 32 lowercase hex
(accepted occurrence schema). Tests inject a deterministic occurrence
source; production uses `createCryptoOccurrenceIdSource` (crypto-random,
matching the accepted opaque-identifier rule). The caller can never supply
the ID.

## 19. Collision handling

Under the coordination lock, immediately after allocation, the ID is
checked against existing reservation-binding state (RuntimeGrant
`reserved_occurrence_id`, and the activation/occurrence reservation
identity fields — read-only freshness consumption of the relevant
existing record classes). Collision → `occurrence-conflict`, zero
RuntimeGrant; no automatic retry within the same command
(one-command/one-allocation). No partial reservation state is ever
published; the RuntimeGrant itself is the durable reservation binding.

## 20. Coordination key

`issueRuntimeGrant` uses exactly ONE key — the canonical
bundle-subject/workspace family
`kindId|instanceId|revisionId|canonicalDigest|workspaceId`
(`coordinationKeyOf`), the same byte/string family accepted in Slice 1/2.
No occurrence dimension, no record-ID key, no multi-key, no nested lock.

## 21. Lock/revalidation order

Preserved fixed order (§15/SCR-W12-005): (1) registry-echo correlation +
workspace resolution (pre-lock), (2) acquire the host-side process-local
WP-12 coordination lock, (3) re-read authoritative state, (4) revalidate
all grant decision inputs, (5) allocate + check the occurrence ID under
the same lock, (6) construct the RuntimeGrant, (7) schema gate, (8)
`publishRecord` (which owns its internal WP-8 writer lock; never acquired
manually, no new filesystem lock artifact), (9) verify durable outcome,
(10) release in `finally`.

## 22. RuntimeGrant schema construction

`buildRuntimeGrantPayload` follows the accepted schema
(`schemas/lifecycle/1.0/records/runtime-grant.json` + fixture
`fixtures/schema-resources/valid/runtime-grant.json`): `record_type =
RuntimeGrant`, `record_id`, `created_at`, `responsible_role =
trusted-runtime-grant-authority`, `registry_snapshot_reference`, `bundle`
(exact-artifact-reference form bound to the exact operation workspace),
`workspace_id`, `reserved_occurrence_id`, `attempt_limit`, `validity`,
`narrowed_constraints`. NOT added: approval IDs, issuance IDs, raw policy,
consumer support, filesystem path, authority token, role object, mutable
reservation object. Every payload passes the accepted WP-4
lifecycle-record schema pipeline (`validateLifecycleRecord`) before
publication.

## 23. Publication/audit behavior

Exactly one `RuntimeGrant` via the genuine WP-8 `publishRecord` through
the single store-boundary adapter; the WP-8 mechanical `authorized-write`
audit accompanies the publication (verified via `inspectAuditHistory`).
No `AuthoritativeAuditEvent` is published as a primary record, no project
file, no lock artifact.

## 24. Success evidence exact shape (bounded correlation data)

`{ ok: true, outcome: 'granted', evidence: { recordClass:
'runtime-grant', recordId, recordDigest?, auditEventId?, subject (bundle),
workspaceId, reservedOccurrenceId, attemptLimit, validity
{not_before, not_after}, narrowedConstraints, registrySnapshotId,
registrySnapshotDigest } }`. No raw grant payload as authority, no trusted
role, no store path, no config, no coordinator, no approval/issuance raw
records, no transferable execution authority. The stored RuntimeGrant is
authoritative; the returned object is correlation evidence for the later
activation boundary (grant identity, occurrence identity, bundle/workspace
binding, registry correlation).

## 25. Failure mapping (closed taxonomy only)

`request-invalid` (malformed/hostile request, unknown keys, non-bundle
subject); `approver-not-independent` (role transport); `subject-invalid`
(evidence mismatch); `lifecycle-state-missing` (missing dependency);
`approval-revoked` (revoked required approval); `issuance-not-authorized`
(unusable required issuance); `eligibility-denied` (max-resources
unsupported); `ceiling-denied` (concrete max-actions violation);
`occurrence-conflict` (reservation collision); `registry-context-mismatch`
(echo mismatch); `store-failure`; `lock-conflict`; `internal-failure`.
No new tokens (`reservation-invalid`, `resource-ceiling-denied`,
`grant-role-denied`, `occurrence-id-conflict`, `grant-already-exists` NOT
added).

## 26. RuntimeGrant revoke extension

The existing `revoke` operation's target set is extended from
`ApprovalRecord | IssuanceRecord` to also accept `RuntimeGrant` (the
accepted RevocationRecord schema target enum already admits it). No
separate `revokeRuntimeGrant` operation; `ResultPublicationRecord` not
pulled forward; immutable historical classes remain `request-invalid`.

## 27. Grant-shaped revoke key

For a RuntimeGrant target, the pre-lock locator read derives the SAME
canonical bundle-subject/workspace key from the target's `bundle` exact
reference (`target_kind.id | target_instance_id | target_revision_id |
target_digest`) plus `workspace_id` — never the grant record ID alone or
the reserved occurrence ID alone. After acquiring the key, the target and
all required revocation state are re-read under the lock (the pre-lock
read has no decision authority).

## 28. Duplicate/subsumption behavior

Slice-2 semantics reused unchanged: exact target type + target ID +
exact scope duplicate is existence-based `lifecycle-conflict` (even
future-dated); effective `all-uses` subsumes `execution-use`; future
`all-uses` does not subsume before `effectiveAt`; `execution-use` never
subsumes `all-uses`; equality `effectiveAt == trustedNow` is effective;
`reasonCode` descriptive only. RuntimeGrant currentness via the shared
`currentnessOf` helper (the grant's use scope falls back to
`execution-use`, matching the operational scope enum).

## 29. Old-registry target behavior

A historical registry-A RuntimeGrant MAY be revoked under current
registry B; targetability does not require the target's registry to equal
the current context; the new `RevocationRecord` binds the CURRENT
registry; the target remains byte-identical. Historical targetability ≠
current usability (C6 distinction preserved).

## 30. Append-only/byte-identity proof

Real-store tests assert `payloadDigestOf(target-before) ==
payloadDigestOf(target-after)` for every grant revocation; exactly one
`RevocationRecord` per accepted revoke; no target mutation/deletion/mark.

## 31. Reentrancy proof

Two actual operation-vs-operation tests under the shared bundle key (one
context/coordinator): outer `issueRuntimeGrant` + inner `revoke`(same
bundle grant) → inner `lock-conflict`, outer completes; outer
`revoke`(grant) + inner `issueRuntimeGrant`(same bundle) → inner
`lock-conflict`, outer completes, and after release the retry issue
succeeds (grant chain still current).

## 32. Real-store tests

`tests/unit/wp12-runtime-grant-store.test.js` (15 tests, genuine
initialized WP-8 stores, real publication/audit/read/enumeration):
A–D happy path + exact binding + internal allocation + one grant/one
audit; E malformed → zero publication; F role transport → zero
publication; G missing dependency → zero; H revoked dependency → zero;
I–J max-actions within/above ceiling; K max-resources eligibility-denied
zero publication; L–N future not_before + attempt 1/64; O occurrence
collision zero grant; P–Q revoke → exactly one RevocationRecord +
byte-identical target; R–T duplicate conflict + equality effectiveAt +
future all-uses coexistence; U old-registry grant revocation →
current-registry-bound new record + byte-identical target + mechanical
audit; V–W no project-file mutation + no WP-8 lock-layout artifact;
reentrancy A/B.

## 33. Static guard

`wp12-static-guard.test.ts` extended: 3A vocabulary
(`issueRuntimeGrant`, `RuntimeGrant`, `runtime-grant`, `pgw:o:`,
occurrence/reservation tokens, constraint forms, `grantRole`,
`newOccurrenceId`) allowed ONLY in exact owning modules; `activation-record`
/`execution-occurrence-record` class-ID literals allowed only in core.ts as
read-only freshness reads; `decideActivation`, `createOccurrence`,
`ActivationRecord`, `ExecutionOccurrenceRecord`, `ExecutionAttemptRecord`
and all future-work vocabulary remain banned family-wide; the family stays
I/O-free (no fs/network/process/timers/env; crypto confined to
`identity.ts`); package root and `./mcp` do not expose the control plane.

## 34. Five-class publication allowlist

The store boundary's `CONTROL_PLANE_PUBLISH_CLASSES` is EXACTLY
`validation-record | approval-record | issuance-record | revocation-record
| runtime-grant`; the static guard asserts the three 3B classes
(`activation-record`, `execution-occurrence-record`,
`execution-attempt-record`) are absent from the allowlist literal. The
full seven-class Slice-3 allowlist is a final-Slice-3 state, not a reason
to pre-enable 3B classes. No WP-8 source modification.

## 35. Slice-1 regression

All previously accepted Slice-1 behavior green: 213-test WP-12 family
runs twice with 0 failures (baseline 172 + 41 new 3A tests); approval/
issuance/validation semantics, request mappings, and four old primary
record classes unchanged; verify remains read-only/lock-free (the verify
surface slice in the static guard still passes).

## 36. Slice-2 regression

Approval/issuance revoke semantics unchanged (the only revoke-test edit
removes `RuntimeGrant` from the immutable-target list — it is now a
legitimate target — and asserts a missing grant target maps to
`lifecycle-state-missing`). Slice-2B verification behavior unchanged.

## 37. Focused test run 1

`node --test dist-test/tests/unit/wp12-runtime-grant.test.js`: 26/26 pass.

## 38. Focused test run 2

`node --test dist-test/tests/unit/wp12-runtime-grant-store.test.js`: 15/15
pass (real WP-8 stores).

## 39. Full regression

Complete `npm test` (clean:generated + build + tsc tests + unit +
integration + security + pi-adapter + mcp + runtime + drafting + writing +
trusted + pointofuse-v2 + storage-crash + WP-7 discovery guard + WP-7
validated runner): executed 1755, pass 1754, fail 1, skip 0
(composition: unit 382 + integration/security/runtime/drafting/writing/
trusted/pointofuse-v2 1020 + pi-adapter/mcp 348 + storage-crash 5; the
earlier 1753 figure was an arithmetic slip). The single
failure is the pre-existing known environmental F8 Pi compatibility case
(see §40). WP-7 validated runner: 165/165.

## 40. F8/environmental status

The known environmental Pi compatibility failure remains unchanged:
installed Pi **0.84.1**, expected lane **0.83.0**
(`pi-adapter/compatibility/harness.test.js` — "F8: real Pi 0.83.0 path
supplied explicitly is accepted"). Not normalized, per instructions. No
other failure exists; no NEW WP-12-related failure was introduced.

## 41. git diff --check

Clean (no whitespace errors).

## 42. Final HEAD

`b0710990a533ad335261cb44fb47b6c3dc5d0633` (unchanged).

## 43. Working tree

All 3A changes present, unstaged. (The implementation report itself is
part of the unstaged changes.)

## 44. Staging

Empty. Nothing was staged or committed; 3A is an internal phase, not a
closure unit.

## 45. No ActivationRecord / occurrence production

Static guard proves no 3B/Slice-4 production vocabulary; the five-class
allowlist excludes the activation/occurrence/attempt classes; no code path
constructs or publishes those records. The only references to those
classes are read-only freshness checks under the coordination lock.

## 46. No Slice-4+

No orchestration, attempt recording, WP-13, WP-5B, Pi, or pi-guard
implementation; no `ExecutionAttemptRecord`.

## 47. No transport

No MCP tool, CLI, HTTP, network, package-root lifecycle-authority export,
or `./mcp` exposure. The control plane remains transport-free.

## 48. No commit/push/tag/release/publication/install/deploy

None performed.

## 49. Unresolved issues

- The real-store test file `wp12-runtime-grant-store.test.js` takes
  ~6.5 minutes (accepted WP-8 enumeration scans 65536 shards per class;
  the contract requires genuine real-store coverage for §35 A–W, so the
  cost is inherent and was not optimized away by weakening coverage).
- No other unresolved issues. The known environmental F8 Pi-version
  mismatch remains out of scope (§40).
