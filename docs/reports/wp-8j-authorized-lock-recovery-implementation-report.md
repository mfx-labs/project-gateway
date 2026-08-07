# WP-8-J — Externally Adjudicated Lock Recovery — Implementation Report

**Status:** WP-8-J — the `break-writer-lock` recovery mutation — is
implemented under the human decision recorded in ADR-033 and the contract
amendment §12.3.1/LOK-019…022: a persistent writer lock is broken ONLY
through a genuine trusted recovery action that explicitly adjudicates the
exact currently observed writer-lock instance as breakable. The storage
layer performs NO liveness inference (no PID existence, process liveness,
lock age, timestamps, host boot identity, heartbeat absence, lease guess,
caller boolean, or elapsed-time authorization; no subprocess; no `/proc`).
All changes are left unstaged and uncommitted; nothing was pushed, tagged,
released, published, installed, or deployed. Implementation acceptance is
not yet granted.

**Verdict:** `WP-8J AUTHORIZED STALE-LOCK RECOVERY: READY FOR REVIEW`

---

## 1. Baseline and Changed-Path Inventory

| Item | Value |
|---|---|
| Baseline HEAD | `4b0897e24da6246c7d0f03a466e9a50c350e43aa` (`feat: add WP-8-I external disposition`) |
| Contract | **modified by this slice**: §12.3.1 (external adjudication + recovery-break guard + instance-bound removal) and LOK-019…022 (ADR-033); SHA-256 updated to `144875db3a77e726b87ef2e390f5fcb905688ac60a2e1f6b3e517f4b369c0b42` in the static guard |
| Dependencies | unchanged (`ajv@8.20.0` only) |
| Public exports | unchanged; `src/index.ts` and package exports unchanged |

Modified (15):

- `docs/specs/wp-8-local-storage-registry-contract.md` — §12.3.1 and
  LOK-019…022 (the one normative amendment).
- `src/storage/types.ts` — `break-writer-lock` action category + instance
  bindings (`expectedLockRecordDigest`, `expectedLockInstanceId`,
  `expectedLockObservationId`), outcome `lock-broken`, 12 new crash
  stages, `LockRecoveryEvidenceFacts`, `LockRecoveryStateFinding`,
  `lockRecoveryStates` on the assessment, lock guard classifications,
  lock-record digest/instance on lock observations, plan
  `requiredOperation` `break-writer-lock`.
- `src/storage/capabilities/authenticity.ts` — the recovery operation set
  gains `break-writer-lock` (no generic lock-deletion operation).
- `src/storage/locks/lock.ts` — `RECOVERY_BREAK_GUARD_NAME`,
  `STORAGE_WRITER_LOCK_INSTANCE_DOMAIN`,
  `computeWriterLockInstanceIdentity` (non-authoritative),
  `acquireRecoveryBreakGuard`/`releaseRecoveryBreakGuard` (12.3.1),
  `unlinkVerifiedWriterLock` (digest + descriptor-bound final recheck,
  exact unlink, absence verification), `fsyncLocksDirectory`; the fs
  allowlist is unchanged (all required APIs already owned).
- `src/storage/recovery/scan.ts` — `lockObservationId()`,
  `currentLockObservation` (boundary re-verification), lock-record digest
  + instance identity on lock observations, recovery-break-guard
  classification, `extractLockRecoveryEvidenceFacts`, lock-surface
  classification of foreign lock objects (symlink/directory/unreadable)
  instead of scan-fatal failure.
- `src/storage/recovery/evidence.ts` —
  `STORAGE_LOCK_RECOVERY_EVIDENCE_IDENTITY_DOMAIN`
  (`PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1`), operation/outcome
  vocabulary, `buildLockRecoveryEvidenceRecord`,
  `computeLockRecoveryEvidenceIdentity`,
  `verifyExistingLockRecoveryEvidence`.
- `src/storage/recovery/execute.ts` — `break-writer-lock` validation and
  the full lock-recovery mutation flow (guard → re-verify → instance
  recheck → exact removal → fsync → evidence → durability → guard
  release).
- `src/storage/recovery/assess.ts` — `lockRecoveryStates`
  (completed / conflicting / evidence-with-different-lock / dangling),
  guard classifications, external-adjudication wording for the persistent
  lock finding.
- `src/storage/recovery/plan.ts` — the persistent-lock action names
  `break-writer-lock` with explicit external-adjudication wording; guard
  artifacts get disposition actions.
- `src/storage/recovery/index.ts` — read-side lock-recovery exports only
  (no guard/unlink primitive re-export).
- `src/storage/publication/publish-record.ts` — per-operation temp
  ordinals 14/15 for lock-recovery evidence.
- `tests/unit/storage/static-guard.test.ts` — contract hash pin,
  operation-set literal, and the WP-8-J vocabulary/liveness/no-export
  guards.
- `tests/unit/storage/recovery.test.ts` — the persistent-lock plan action
  now names `break-writer-lock` (the WP-8-J plan semantics).
- `docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`
  — current-state wording only.

New (3):

- `docs/decisions/ADR-033-wp-8j-lock-recovery.md` — the human decision
  (external adjudication), the guard design, the instance-bound removal,
  and the evidence model.
- `tests/unit/storage/lock-recovery.test.ts` — 11 focused tests.
- `docs/reports/wp-8j-authorized-lock-recovery-implementation-report.md`
  (this report).

**Total: 15 modified + 3 new = 18 paths.** The mutation lives in the
existing lock owner (`locks/lock.ts`), which already owns the exact fs
allowlist; no new fs-bearing module was needed.

## 2. Authority Model

`break-writer-lock` is added to the private recovery operation set only.
No `delete-lock`, `clear-locks`, `unlock-store`, `force-unlock`,
`break-any-lock`, or `recovery-admin` operation exists anywhere (static
guard proven). Every boundary verifies the exact operation: the
recovery-break guard acquisition/release, the instance-bound removal, the
evidence publication, and the writer-lock capability gate. A reduced
operation-set authority (closed test seam) can never verify the operation;
production minting always binds the full implemented vocabulary. Zero
production recovery-action-provenance producers remain. A recovery plan
action, scanner finding, or structural object grants nothing (tested).

## 3. Adjudication Model (no local staleness)

The trusted recovery action explicitly represents "this exact currently
observed writer lock is externally authorized for recovery removal". The
storage implementation never decides staleness: no `isStale` field, age
threshold, PID dead/alive check, process-start or boot-time comparison,
heartbeat, lease, or elapsed-time condition exists anywhere in the
recovery path (static guard proven for `isStale`/heartbeat/lease markers
and `/proc`/kill APIs). PID, start time, acquisition time, and max age are
recorded facts in the lock record and the lock observation (observable,
never authorization); time appears only as evidence creation evidence.
Tests prove that implausible pid/age values and arbitrary mtimes never
gate a break.

## 4. Lock-Instance Binding

The request binds the strongest non-secret immutable facts: the canonical
lock-record digest (unique per instance via the random per-acquisition
nonce), the deterministic lock-instance identity
(`PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1` over store identity + lock name +
record digest; grants nothing), the deterministic lock observation
identity (`writer.lock`; recomputed at the boundary), and the
generation/surface tokens. The raw nonce is never exposed or accepted
(ERM-004); no PID, path, descriptor, callback, or fs function is accepted
— those fields do not exist in the action type (static guard proven).

## 5. Serialization: the Recovery-Break Guard

The writer lock cannot serialize its own break (LOK-016 gap; ADR-033
decision 2). Lock-break serialization uses the distinct
`locks/recovery-break.guard`: `O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0600`,
canonical guard record (guard version, store instance, random nonce,
action identity digest, acquisition time), file fsync, locks-directory
fsync. The guard cannot coexist with another lock-break attempt (EEXIST →
ERR-STO-LOCK-UNAVAILABLE), is never acquired by writers, and is not a
second general writer lock. The writer lock is re-verified AFTER guard
acquisition; the guard is released only after durable evidence. A
leftover guard is classified (`recovery-break-guard-present`/`-malformed`)
and requires external disposition — never auto-broken.

## 6. New-Writer Race (LOK-021)

In-model analysis: a trusted new writer can only acquire the lock when the
name is free (O_EXCL), i.e., after the breaker's unlink; the breaker's
post-unlink absence check then observes the new lock and fails closed —
the new lock is never removed, and no evidence is published for it. The
digest-bound final recheck ensures a same-name replacement (any
legitimate new acquisition carries a new random nonce, hence a different
digest) fails closed before removal; a same-bytes copy at a genuinely
different inode fails the descriptor recheck (tested via the stash-inode
technique). The guard prevents a second breaker from spanning another
breaker's unlink (the only in-model path to a wrong-object removal).
Byte-identical replay at a recycled inode is indistinguishable from the
adjudicated instance by any non-secret fact and remains the contract's
TML-002 "replay of an earlier internally valid state" exclusion — an
accepted trust boundary, not a claim of hostile-host tamper resistance.
Tests: old authorization replay against a new legitimate writer lock
fails closed with the new lock untouched; the new writer releases its own
lock normally afterward.

## 7. Mutation Primitive

`unlinkVerifiedWriterLock` (lock owner): descriptor no-follow read,
canonical parse, FINAL recheck of the exact lock-record digest + dev/ino
+ nlink, unlink of exactly that one name, absence verification; the
composition fsyncs the locks directory and verifies the postcondition
(evidence, evidence audit, name absence). No other lock, no recursive
`locks/` deletion, no rename/copy/overwrite/truncate/chmod/chown repair.
Malformed/foreign lock objects and leftover guards remain
adjudication/external-disposition.

## 8. Evidence Model

`StoreEvidenceRecord` with `evidenceKind: recovery-evidence` (the
implemented TAX-013 vocabulary; ADR-032 decision 4 precedent), the exact
`break-writer-lock` operation, and the domain-separated identity
`PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1` over (store identity, evidence
kind, operation, lock-record digest, lock-instance identity, observation
identity, outcome). The evidence carries the trusted recovery action
identity, generation/surface tokens, `resultingState: { writerLockRemoved:
true }`, and outcome (`lock-broken` | `already-completed`); no raw nonce,
no raw path (payload guarded). Publication rides the exact-record permit
pipeline plus the evidence's `authorized-write` audit (temp ordinals
14/15); generic publication remains write-authority-only. Evidence never
authorizes breaking any other lock instance (the instance identity and
digest are bound; tests prove a different current lock fails closed).

## 9. Idempotency / Conflict States (LOK-022)

| State | Result |
|---|---|
| Lock present, exact adjudicated instance, no evidence | break + publish evidence → `lock-broken` |
| Lock absent, matching evidence | `already-completed` |
| Lock absent, no evidence | fail closed (`ERR-STO-NOT-FOUND`; no inference) |
| Lock present, matching evidence | fail closed (integrity inconsistency) |
| Lock present, different digest/instance | fail closed |
| Malformed/foreign/wrong-UID-mode lock, multiple-lock ambiguity | fail closed / external disposition |
| Conflicting evidence | fail closed |
| Leftover recovery-break guard | external disposition (never auto-broken) |

No repair-by-guessing.

## 10. Scanner / Assessment

- Persistent canonical lock: `writer-lock-present` with the record digest
  and instance identity observable; the finding reason states external
  adjudication; never classified stale by time (liveness facts are
  recorded, never adjudication).
- `lockRecoveryStates`: `completed-lock-recovery` (evidence durable +
  referenced lock absent), `conflicting-lock-recovery-evidence` (evidence
  + exact live lock), `evidence-with-different-lock` (evidence + a
  different current lock; the evidence does not authorize it),
  `dangling-lock-recovery-evidence` (incomplete/closed-vocabulary
  payloads). Absence without evidence is never labeled completed
  (ambiguous with never-broken; the execution reports it as the
  deterministic fail-closed result).
- Foreign lock objects (symlink, directory, unreadable) are now
  CLASSIFIED (`writer-lock-foreign`/`-malformed`) instead of failing the
  whole recovery scan — matching the quarantine-surface precedent; the
  scan keeps assessing the store.
- The raw nonce is never exposed in observations, findings, plans, or
  evidence.

## 11. Recovery Plan

A canonical persistent writer lock produces an action naming
`break-writer-lock` (category `lock-recovery`, safety `unsafe`) whose
reason states that external adjudication is required; guard artifacts
produce disposition actions. Plans remain non-authoritative: no
capability, nonce, PID, raw path, callback, or liveness inference;
passing a plan action into execution fails closed (tested).

## 12. Crash Model

Fixed 12-stage inventory (asserted): `before-recovery-break-guard`,
`after-recovery-break-guard`, `after-lock-target-verification`,
`after-lock-instance-recheck`, `before-lock-unlink`, `after-lock-unlink`,
`before-locks-directory-fsync`, `after-locks-directory-fsync`,
`before-lock-evidence-publication`, `after-lock-evidence-publication`,
`after-lock-evidence-audit-publication`, `before-recovery-break-guard-release`.

After every crash: no canonical record/audit mutation except the recovery
evidence itself; no unrelated lock removed; the scanner classifies the
state deterministically; a held guard blocks concurrent breakers and is
never auto-broken (fixture release in the harness, matching the accepted
crash model); the fresh rerun completes (pre-unlink stages), fails closed
(unlink done, evidence absent — no inference), or returns
`already-completed` (evidence durable). No generic stale-lock inference
appears in any crash path.

## 13. Post-Break Writer Behavior

After durable removal + evidence: a normal writer acquires a fresh lock
through the accepted path; the new lock has a distinct identity (new
random nonce → distinct digest/instance); the previous recovery evidence
does not authorize breaking the new lock; replaying the old recovery
action against the new lock fails closed with the new lock untouched;
the new writer releases its own lock normally (all tested).

## 14. Security Boundary

The lock-recovery mutation lives in the existing lock owner
(`locks/lock.ts`) with its unchanged exact fs allowlist
(`openSync, closeSync, writeSync, readFileSync, fsyncSync, fstatSync,
unlinkSync, constants`) — no new fs-bearing module, no allowlist change.
No subprocess, `/proc`, kill/signal, process enumeration, rename/copy,
recursive removal, chmod/chown, generic unlink exposure, or arbitrary
lock path exists (static guard proven). Static guards prove:
`break-writer-lock` is the sole new lock mutation operation; no
PID/liveness heuristic exists; scanner findings cannot mint authority;
the recovery barrel never exports the guard/unlink primitives; the
lock-recovery flow uses raw mutation fs APIs nowhere and reaches the
generic publication substrate nowhere; evidence payloads carry no nonce
or path.

## 15. Tests and Exact Counts

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | pass |
| Build | `npm run build` | pass |
| Test TS compilation | `npx tsc -p tsconfig.tests.json` | pass |
| Focused lock-recovery | `node --test dist-test/tests/unit/storage/lock-recovery.test.js` | **11 tests, 11 pass, 0 fail** |
| Normal lock tests | `node --test dist-test/tests/unit/storage/locks.test.js` | pass |
| External disposition | `node --test dist-test/tests/unit/storage/external-disposition.test.js` | **19 tests, 19 pass** |
| Recovery mutation | `node --test dist-test/tests/unit/storage/recovery-mutation.test.js` | **18 tests, 18 pass** |
| Quarantine | `node --test dist-test/tests/unit/storage/quarantine.test.js` | **12 tests, 12 pass** |
| Audit reconstruction | `node --test dist-test/tests/unit/storage/audit-reconstruction.test.js` | **14 tests, 14 pass** |
| Registry index | `node --test dist-test/tests/unit/storage/registry-index.test.js` | **11 tests, 11 pass** |
| Registry/recovery | `node --test dist-test/tests/unit/storage/registry.test.js dist-test/tests/unit/storage/recovery.test.js` | **41 tests, 41 pass** |
| Complete storage suite | `node --test "dist-test/tests/unit/storage/*.test.js"` | **334 tests, 332 pass, 2 skipped** (pre-existing privilege-gated chown tests) |
| Static guard | `node --test dist-test/tests/unit/storage/static-guard.test.js` | **26 tests, 26 pass** |
| Global security | `node --test dist-test/tests/security/security.test.js` | **15 tests, 15 pass** |
| Crash suites | recovery-mutation (10-stage), quarantine (15-stage), audit-reconstruction (12-stage), registry-index (8-stage), disposition (12-stage ×2), lock-recovery (12-stage) | all pass within the storage suite |
| Default workflow | `npm test` | **1357/1358 pass; 1 pre-existing environment-pinned failure** (pi-adapter harness expects Pi `0.83.0`, installed `0.84.1`; reproduced on the baseline) |
| WP-7 regression | `node scripts/run-wp7-tests.mjs` | **165/165 pass** |
| Contract-hash audit | static guard (pinned SHA-256 `144875db…`) | pass |
| `git diff --check` | — | clean |

## 16. Remaining WP-8 Build Work

Primary/audit deletion; retention; legal holds; migration; full
audit-history inspection; configuration-namespace recovery; disposition
of the remaining adjudication-only classes (foreign objects, tamper-class
records, dangling audits, leftover recovery-break guards); lifecycle
approval decisions; WP-12 integration; WP-9 generation seeding.

## 17. Git State

All changes are unstaged and uncommitted (`git status` shows the modified
and untracked paths of §1 only). Nothing was pushed, tagged, released,
published, installed, or deployed. The next gate is the WP-8-J
implementation review.
