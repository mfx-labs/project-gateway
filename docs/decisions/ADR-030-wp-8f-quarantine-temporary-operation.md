# ADR-030 — WP-8-F Quarantine-Temporary Operation

## Status

Accepted (implementation decision within the authorized WP-8-F recovery
mutation foundation, following the human contract decision that defined
the initial quarantine operation `quarantine-temporary`). This ADR is
**normative for WP-8-F quarantine implementation policy** but
**subordinate to the authoritative WP-8 contract**
(`docs/specs/wp-8-local-storage-registry-contract.md`, §5.2, §16.5,
QRN-001…006). It **does not authorize implementation beyond the WP-8-F
slice** — no stale-lock breaking, deletion, retention, migration, WP-9, or
WP-12 — and it does not modify, reopen, or deviate from any §28 contract
decision (DS-01…29).

## Context

WP-8-F is contract §29 phase 4 — the authorized recovery mutation
foundation — on the operational baseline commit
`f3677e61c3ce048f9dde7ac7dc6de5ad8f2c9f8e` (`feat: add WP-8-E registry
recovery read slice`). The WP-8-F worktree implements the authority-gated
orphan-removal foundation (recovery capability, trusted recovery request,
immediate re-verification, WPR-023 (a) cleanup, durable recovery
evidence). The contract reserves `quarantine/` (§5.2) and requires
crash-reappearing temporaries to be quarantined with evidence (WPR-023,
CSA-001/008/010), but defined no quarantine destination, primitive, or
operation. The human contract decision closed that gap: the initial
quarantine operation is `quarantine-temporary`, limited to WPR-023 (b)/(c)
regular temporary files, using a deterministic destination and the
hard-link plus unlink primitive.

## Decision

1. **Deterministic destination.** Quarantine needs a deterministic
   destination because quarantine is a recoverable, idempotent, crash-safe
   store mutation: the destination must be re-derivable from the evidence
   and the scanned object so that interrupted states, replay, and
   crash-state classification are mechanical. A caller-supplied or
   free-form destination would make the mutation non-replayable and the
   scanner unable to associate evidence with objects. The destination is
   therefore `<namespace>/quarantine/temporary/<shard>/<quarantineId>.qtn`
   with `quarantineId` a domain-separated SHA-256 digest over (store
   identity, namespace identity, source temporary entry designation,
   WPR-023 classification, exact source content digest, pre-mutation
   evidence digest) — the same factual tuple the evidence binds.

2. **Hard-link plus unlink.** Quarantine uses the same-filesystem
   hard-link plus unlink primitive because it is the store's accepted
   atomic publication/removal substrate (WPR; the write path already
   publishes records and removes temporary names with link(2)/unlink(2)):
   link(2) never overwrites (EEXIST is classified), both names share one
   inode so the link-count transition (1 → 2 → 1) is the deterministic
   crash-recovery signal, and the source bytes are never copied or
   rewritten. `rename` is rejected because it is not the store's accepted
   mutation primitive, does not give the same verifiable link-count
   transitions, and cross-directory rename semantics would weaken the
   crash-state classification.

3. **First scope limited to WPR-023 (b)/(c) regular temporaries.** The
   first quarantine scope is limited to WPR-023 (b) incomplete-unpublished
   and WPR-023 (c) malformed temporary regular files because these are the
   crash-reappearing states with no durable publication relationship: (a)
   inode twins are already served by `orphan-removal`; (d) and otherwise
   uncertain objects require external disposition and must not be moved by
   an automatic mutation. Regular files with `nlink === 1`, exact UID and
   mode, bounded size, and exact evidence make the mutation fully
   verifiable before and after the move.

4. **Rejected alternatives.** `rename` (not the store's primitive; weaker
   crash signals; see 2), byte copying (breaks the single-inode invariant
   and the digest binding), chmod/chown repair (mutation must never repair
   policy by privilege), and broad quarantine of arbitrary or uncertain
   objects (would move state that requires human or control-plane
   disposition) are all rejected. No generic `quarantine` authority exists:
   the recovery capability operation set contains exactly the implemented
   operations (`orphan-removal`, `quarantine-temporary`), and every
   mutation verifies its exact operation.

## Consequences

- The `quarantine/` namespace gains a fixed, scanner-visible layout
  (`temporary/<shard>/<quarantineId>.qtn`) provisioned lazily under the
  writer lock with exact fixed-directory verification.
- Quarantine execution follows the orphan-removal authority, re-verification,
  evidence, crash-stage, and static-guard model; the recovery scanner
  classifies every quarantine crash state and binds the quarantine
  structure into the recovery-mode surface generation.
- WPR-023 (b)/(c) temporaries are now movable with evidence; (a) remains
  `orphan-removal`; (d) and uncertain objects remain disposition-required.
- This ADR creates no new lifecycle authority and no production
  capability/provenance producer.
