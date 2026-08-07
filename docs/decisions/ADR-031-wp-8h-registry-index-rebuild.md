# ADR-031 — WP-8-H Persistent Registry Index and `indexBytes` Limit

**Status:** Accepted (WP-8-H implementation; contract §5.2 `index/` was
already normative; this ADR records the narrow derived-cache design and the
single limits-table amendment it required).

## Context

The contract defines `index/` as "derived, rebuildable indexes and
materialized current-state views" (5.2; LAY-009), requires stale/inconsistent
indexes to be detectable and never served as current (ITG-005), requires the
index to be rebuilt from source records after crashes (CSA-003/004, 16.2),
and requires indexes to be rebuildable from source records alone with no loss
of records or authority (RGY-001/007). The contract does NOT define the index
file layout, content model, publication authority, or the byte bound of a
persistent index snapshot. WP-8-H chooses the narrowest derived-cache design
that preserves complete rebuildability.

## Decisions

1. **One canonical immutable index snapshot per derived state.** The index
   family is `index/registry-index/<shard4>/<indexId>.idx` where `indexId` is
   a deterministic domain digest over (model version, verified store and
   namespace identities, registry scan generation, registry surface
   generation, record root, audit root, observation root, scan bounds, index
   bounds, scan counters). The snapshot content is the complete verified
   registry-mode observation set (records, audit events, foreign entries at
   the records/audit surfaces) with bounded stat facts (the freshness
   manifest), the structure-level scan findings, and the scan facts. The
   registry view is re-derived purely from the stored observations, so the
   fast path and the authoritative path share one derivation. Older snapshots
   are disposable derived state; a newer snapshot never overwrites them.
2. **Publication authority is the recovery capability with the exact
   operation `registry-index-rebuild` and an exact-record
   `RecoveryPublicationPermit` (role `registry-index`)**, keeping sink-level
   confinement equivalent to the WP-8-F exact-record permits. The write path
   never publishes the index: a write makes the index stale, the fast path
   detects the staleness through the live entry-set probe and falls back, and
   the authorized rebuild refreshes it (WPR-009/CSA-003/ITG-005 tolerate
   exactly this). A long read-only scan never holds the writer lock; the
   lock is taken only for the publication phase and the store
   generation/surface/probe are re-checked under it (stale builds fail
   closed).
3. **`indexBytes` limit (the one contract amendment).** The 19.1 limits table
   gains `indexBytes` (bytes; default 64 MiB; hard min 1 MiB; hard max
   1 GiB; config; exact accepted; plus-one fail-closed; "rebuild fails
   closed"), bounding the canonical index snapshot. `indexRebuildWork`
   (entries) bounds the indexed observation count, identity groups,
   conflicts, associations, and represented findings; every bound fails the
   build deterministically — an over-bound store never produces a partial
   index and the authoritative scan remains fully usable.
4. **Freshness is proven by a readdir + no-follow lstat entry-set probe.**
   Records and audits are immutable and appear only through atomic hard-link
   publication, so an exact match of the live entry set (names + stat facts)
   against the index manifest proves the store is unchanged for every
   legitimate store evolution. Content tampering with identical names and
   stat facts requires store write access and is out of the MVP trust anchor
   (TML-002), exactly as for the authoritative scan itself.
5. **The recovery scanner classifies index artifacts** (current-valid,
   stale with a deterministic reason, malformed, unsupported-version,
   conflicting, wrong type/UID/mode, foreign, incomplete index temporary)
   and the advisory plan recommends rebuild; a conflicting index at the
   derived identity requires disposition (rebuild would collide). Index
   deletion/disposition stays out of scope.
6. **No migration machinery.** A semantic change to the canonical index
   interpretation bumps `REGISTRY_INDEX_MODEL_VERSION`; older versions are
   classified and trigger rebuild.

## Rejected Alternatives

- Per-write index publication (contract 10.4 step 4 realized as a
  write-path duty): rejected — a full-store rebuild per write is a massive
  regression; the contract's own WPR-009/CSA-003/ITG-005 model tolerates
  stale indexes between writes and rebuilds, and the fast path falls back
  whenever the index is not current.
- A multi-file or mutable index engine: rejected — one canonical immutable
  snapshot plus deterministic generation identity is the narrowest design
  that preserves complete rebuildability (WP-8-H §4).
- Index publication through the generic write capability: rejected — the
  exact-record recovery permit keeps sink-level confinement.
