# ADR-033 — WP-8-J Externally Adjudicated Lock Recovery

**Status:** Accepted (WP-8-J implementation; contract §12.3.1 and
LOK-019…022 added by this decision).

## Context

The contract (12.3/LOK-007) defined stale-lock classification via liveness
(boot-identity mismatch or a confirmed-dead (PID, start time) writer) and
gave recovery authority to remove "a confirmed stale lock". WP-8-J makes
the human decision normative that the storage layer performs NO liveness
inference as a mutation authorization condition: PID existence, process
liveness, lock age, timestamps, boot identity, heartbeat absence, lease
guesses, caller booleans, and elapsed wall-clock time are recorded facts
or evidence-creation times, never authorization. Whether a lock is
externally adjudicated as breakable is an authority decision carried by a
genuine trusted recovery action. The contract's liveness-based stale
classification is superseded for the recovery path by external
adjudication (12.3.1); ordinary recovery scanning still never classifies
a persistent writer lock as stale automatically and never breaks it.

The contract also defined no lock-break serialization primitive:
LOK-016 ("recovery acquires the lock before any recovery action") cannot
apply to breaking that same lock. Without serialization, two concurrent
breakers could both verify the adjudicated lock and one could remove a
legitimate new writer lock created at the same name after the other
breaker's unlink — an in-model writer losing its lock to the recovery
flow. This decision fixes the serialization and the evidence model.

## Decisions

1. **External adjudication only (human decision).** `break-writer-lock`
   is the sole lock-recovery mutation operation. It is permitted ONLY
   through a genuine trusted recovery action that explicitly adjudicates
   the exact currently observed writer-lock instance as breakable. The
   storage implementation never decides staleness itself: no
   `isStale` flag, age threshold, PID dead/alive check, process-start or
   boot-time comparison, heartbeat, lease, or elapsed-time condition
   exists anywhere in the recovery path. Time appears only as evidence
   creation evidence. No subprocess and no `/proc` access exists.
2. **Recovery-break guard.** Lock-break serialization uses a distinct
   guard at the fixed path `locks/recovery-break.guard`: exclusive
   creation (`O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0600`) with a canonical
   guard record (guard version, store-instance identity, random nonce,
   trusted action identity digest, acquisition time), file `fsync`, and
   locks-directory `fsync` (same primitives as the writer lock). The
   guard cannot coexist with another lock-break attempt and is never
   acquired by writers; it is not a second general writer lock. The
   writer lock is re-verified after guard acquisition and the guard is
   released only after durable evidence. A leftover guard is a foreign
   lock object requiring external disposition (never auto-broken).
3. **Instance-bound removal.** The final removal binds the lock-record
   digest and the deterministic lock-instance identity
   (`PGAP-STORAGE-WRITER-LOCK-INSTANCE-v1` over the verified lock facts),
   never the raw nonce (non-disclosed; ERM-004), PID, or a path. A
   legitimate new writer lock created at the same name after the
   adjudicated lock is gone is never removed: the post-unlink absence
   check and the digest-bound recheck fail closed on any replacement,
   and the guard prevents a second breaker from spanning another
   breaker's unlink.
4. **Evidence model.** Lock recovery publishes the existing
   `StoreEvidenceRecord` with `evidenceKind: recovery-evidence` (the
   implemented TAX-013 vocabulary; ADR-032 decision 4 precedent — a new
   evidence kind would expand the closed implemented taxonomy), the exact
   operation `break-writer-lock`, and the domain-separated identity
   `PGAP-STORAGE-LOCK-RECOVERY-EVIDENCE-v1` over the factual tuple (store
   identity, operation, lock-record digest, lock-instance identity,
   observation identity, outcome). The evidence carries the trusted
   recovery action identity, generation/surface tokens, resulting state,
   and outcome (`lock-broken` | `already-completed`); no raw nonce, no
   raw path. Publication rides the exact-record recovery permit pipeline
   plus the evidence's `authorized-write` audit; generic publication
   remains write-authority-only. Evidence never authorizes breaking any
   other lock instance.

## Consequences

- Contract §12.3.1 and LOK-019…022 added; pinned SHA-256 updated; the
  liveness-based stale classification of 12.3 is superseded for the
  recovery path by external adjudication (12.3.1).
- `break-writer-lock` executes under the recovery-break guard with the
  digest-bound exact unlink primitive; all other lock states
  (malformed, foreign, wrong type/UID/mode, multiple-lock ambiguity,
  leftover guard) remain adjudication/external-disposition.
- Idempotency: present + exact instance + no evidence → break + evidence;
  absent + matching evidence → `already-completed`; absent + no evidence
  → fail closed; present + matching evidence → integrity inconsistency;
  changed digest/instance or conflicting evidence → fail closed.
