# ADR-035 — WP-8-L Retention Deletion, Legal-Hold Freshness, and Durable Intent/Completion Evidence

**Status:** Accepted (WP-8-L; human-authorized work package `WP-8-L —
Retention, Legal Hold, and Exact Deletion`).

**Authority chain:** ADR-002 (trust and approval boundary), ADR-023
(post-WP-5A sequencing), ADR-024 (trusted configuration ownership),
ADR-030 (quarantine), ADR-031 (registry index), ADR-032 (external
disposition), ADR-033 (lock recovery), ADR-034 (audit-history
inspection), WP-8 contract §15/RNT-001…010 (retention and deletion),
contract §21 (capability model), CAP-008/009 (mid-operation
invalidation), TAU (authority separation).

## 1. Decision

WP-8-L implements the first policy-bound deletion path for immutable
storage as a **separate private branded retention authority domain** with
durable deletion-intent and deletion-completion evidence and a
**generation-bound legal-hold freshness model**. Retention deletion is NOT
recovery: it never reuses `RecoveryCapability`, recovery action
provenance, or recovery evidence semantics, and recovery authority can
never perform retention deletion (and vice versa).

## 2. Authority Domain and Eligible Classes

- A retention action provenance, trusted retention request, retention
  capability (`RETENTION_OPERATION_SET = {retention-delete-record,
  retention-delete-audit}`), and exact-record retention publication
  permit mirror the recovery-domain construction (module-private
  `WeakSet` brands, gated creators, static-guarded import edges, zero
  production provenance producers in this slice).
- No generic deletion operation exists (`delete-object`,
  `delete-record`, `delete-any`, `purge`, `cleanup`, `retention-admin`,
  `filesystem-delete` are all absent); the mutation request accepts no
  raw path, descriptor, callback, fs function, plan action, or
  caller-supplied deletion boolean.
- The narrow retention-deletable primary class set is the pure immutable
  lifecycle fact classes: `validation-record`, `revocation-record`,
  `execution-occurrence-record`, `execution-attempt-record`,
  `trusted-receipt`, `execution-summary-record`, `migration-record`,
  `supersession-record`. Evidence, metadata, indexes, configuration,
  locks, quarantine, foreign/malformed/tamper-class objects, registry
  snapshots, activation records, and revocable-usability classes are
  excluded. Audit events are deleted only via `retention-delete-audit`.

## 3. Legal-Hold Freshness Model (generation binding, never wall-clock)

The hold-state generation is the deterministic digest
(`PGAP-STORAGE-RETENTION-HOLD-STATE-GENERATION-v1`) over the exact
(trusted-configuration identity, trusted-configuration version) the
authority adjudicated (RNT-007 holds are configured overrides). Storage:

1. accepts only a genuine branded retention action whose provenance
   correlates with the current genuine trusted configuration;
2. re-derives the hold-state generation from the request's current
   configuration at every mutation boundary — before intent publication,
   under the writer lock, and after intent publication — and requires
   exact equality with the decision binding and the durable intent
   binding;
3. honors the closed adjudication outcomes: `active-hold`,
   `unknown-hold-state`, and `stale-hold-decision` prohibit deletion;
   `clear-current-hold-state` permits evaluation only if every other
   gate passes;
4. fails closed when the in-process capability generation advances
   (CAP-008/009: a configuration replacement invalidates the in-flight
   operation before the unlink) or when the durable intent's hold or
   policy binding no longer matches (`hold-blocked` / `policy-blocked`).

A hold appearing after intent publication therefore blocks the unlink:
within one execution via the capability-generation invalidation, and
across executions via the intent's durable hold-state generation binding.
The durable intent is historical evidence of an authorized-but-not-
executed deletion and is never self-executing authority. Freshness is
never guessed from wall-clock TTL.

## 4. History Binding

Retention deletion of a primary binds the committed WP-8-K inspection to
a deterministic digest (`PGAP-STORAGE-RETENTION-HISTORY-BINDING-v1`) over
target facts, verified events in the normative tuple order, recovery
annotations, closed findings, completeness, and generation/surface
tokens. Only a clean complete original lineage is eligible;
`missing-authorized-write`, `ambiguous-history`, contested findings,
truncated results, and `reconstructed-gap` fail closed (the contract does
not permit retention deletion with reconstructed history gaps in this
slice). The binding is re-derived under the writer lock and after intent
publication; a history change after intent fails closed before unlink.

## 5. Intent/Completion Evidence and Mutation Sequence

Intent domains `PGAP-STORAGE-RETENTION-RECORD-DELETE-INTENT-v1` /
`PGAP-STORAGE-RETENTION-AUDIT-DELETE-INTENT-v1`; completion domains
`PGAP-STORAGE-RETENTION-RECORD-DELETE-COMPLETION-v1` /
`PGAP-STORAGE-RETENTION-AUDIT-DELETE-COMPLETION-v1`. Identities are
deterministic over the factual tuples (time and action identity never
enter an identity); each evidence record carries its mechanical
`authorized-write` audit. The mutation sequence is the §15.4 twenty-step
chain: authenticate the trusted retention action; verify the policy/hold
decision; verify store and namespace; derive the authoritative history
(record flow) or verify the exact audit/association (audit flow); verify
the exact history binding; acquire the normal writer lock; recompute
generation/surface; re-verify hold/policy bindings; descriptor-bound
target re-verification; classify the intent/completion state; publish the
durable deletion intent (before any unlink); post-intent revalidation;
exact unlink; absence verification; containing-directory fsync; durable
completion evidence; completion audit; durability verification; store/
authority revalidation; identity-bound lock release. The registry-mode
generation and surface tokens are stable across intent publication (the
evidence class is excluded from the structural token and the generation
binds only store/limits facts), so the decision snapshot binding is
well-defined pre- and post-intent.

## 6. Idempotency

Target present + no intent → validate → intent → unlink → completion.
Target present + matching intent + no completion → reverify → unlink →
completion. Target absent + matching intent + no completion → completion
roll-forward (the containing-directory fsync makes the absence durable
before completion; the roll-forward path re-verifies the hold/policy
bindings and fails closed on mismatch — the intent is never self-
executing). Target absent + matching intent + matching completion →
`already-completed`. Target absent + no intent → fail closed (absence
without intent never counts as retention completion). Target present +
completion → integrity inconsistency. Target or binding changed after
intent → fail closed; a replacement is never deleted; hold/policy changes
after intent fail closed as `hold-blocked`/`policy-blocked`; the caller
may obtain a new decision. Conflicting intent/completion evidence at the
deterministic derived identities fails closed.

## 7. Audit Deletion (stricter rule)

`retention-delete-audit` deletes exactly one immutable audit event only
when: the audit event's envelope association binds the exact referenced
primary identity/digest; the referenced primary is a retention-deletable
class and ABSENT; durable `retention-delete-record` completion evidence
for that exact referenced class/identity/digest exists (primary absence
alone is never inferred); the audit's own retention decision and hold
state are valid; and the deletion does not destroy evidence of an
unresolved retention/recovery action (the intent/completion state machine
and the primary gates cover this). No cascade exists: each audit deletion
is exact and independently authorized.

## 8. Scanner Distinction (survivors)

Surviving audit events of a retention-deleted primary are intentional
retention survivors, never corruption: the registry/recovery audit
association classifies a dangling audit as a survivor when durable
retention deletion completion evidence binds its exact referenced
primary, and the recovery assessment never proposes survivor
disposition. Retention evidence states are classified deterministically
(`completed`, `evidence-with-live-target`, `intent-pending`,
`roll-forward-eligible`, `conflicting`, `dangling-evidence`).

## 9. Contract and Documentation Impact

- One narrow contract amendment: contract §15.4 + RNT-011…020 (the
  contract already reserved `retention-evidence` in the closed
  `evidenceKind` set and the `retention` capability kind in §21.1; no
  taxonomy change was required).
- One implementation report: `docs/reports/wp-8l-retention-legal-hold-
  deletion-implementation-report.md`.
- Current-state wording updated in `post-wp5a-roadmap.md` and
  `post-wp5a-planning-status.md`.
- WP-8-K correction (root cause, HST-005): the audit-history inspection
  now delivers reported events in the normative audit ordering tuple and
  paginates in tuple order (previously the page slice and resume boundary
  followed surface scan order, which disagreed with the tuple whenever
  shard prefixes differed from creation order — a latent ordering defect
  that also made the budget tests depend on inode luck).

## 10. Out of Scope (unchanged)

Generic deletion, recovery-based deletion, recursive deletion,
compaction, migration, configuration-namespace recovery, automatic
disposition of remaining foreign objects, WP-9, WP-12, and audit-history
inspection of absent targets (the distinction is exposed through the
durable intent/completion evidence and the surviving audit events, which
remain readable).
