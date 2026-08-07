# ADR-034 — WP-8-K Read-Only Audit-History Inspection

**Status:** Accepted (WP-8-K implementation; contract §13.4 and
HST-001…010, AUD-014 added by this decision).

## Context

The contract names `inspect-audit-history` as a Section 13 operation
(RDS-006: ordered, bounded, non-mutating) but defines no history model:
no association rule, no ordering rule, no bounds/continuation semantics,
and no finding vocabulary. Without normative rules, "history" is
undefined behavior: any implementation would have to invent association
(digest vs identity), ordering (timestamp vs identity), and over-limit
semantics. WP-8-K therefore requires a narrow normative decision before
deterministic history inspection is possible. The authoritative durable
state is the immutable `audit/audit-event/` surface plus the target
record; the WP-8-H registry index is a derived cache and must never
become the historical source of truth (RGY-001; HST-002).

## Decision

1. **Authoritative source.** History is derived exclusively from
   verified immutable record and audit facts: the durable target record
   (identity, revision, digest, trusted action identity, creation time)
   and the verified `audit/` event surface. The registry index is not
   consulted (it adds no benefit to one-target history and would risk
   stale-view masking).
2. **Association.** An event belongs to the target's history only when
   its verified payload binds the exact target record identity AND its
   canonical envelope, digest, derived-location identity, revision
   binding, reference digests, event-kind payload, and trusted action
   identity all verify. The original `authorized-write` event is
   additionally required to match the deterministic D-8 expected
   identity/digest derived from the verified target facts; any other
   claim with the correct digest is a `duplicate-audit`, and a claim
   with a different digest is `wrong-target-digest`. Malformed,
   unverifiable, dangling, conflicting, and unsupported-version events
   are classified findings — never adopted, never repaired (HST-004).
3. **Original vs reconstructed.** The two event kinds are never
   flattened: `authorized-write` and `recovery-audit-reconstruction`
   (16.3, AUD-011/012) are reported distinctly. A reconstruction reports
   `missingEventKind: authorized-write`, the recovery action identity
   from the event, and the original trusted action identity from the
   durable target facts; the original event is never synthesized and the
   reconstruction event is never rewritten (HST-003, AUD-014). Both
   present → `ambiguous-history`; neither present → the gap state with a
   `missing-authorized-write` finding.
4. **Ordering.** The implemented audit model defines the canonical
   ordering tuple (primary logical creation time, primary record
   identity, audit event identity — D-8; DTM-003/007). Inspection orders
   events by exactly that tuple; timestamps are exposed as recorded
   facts and the deterministic event identity is the final tie-break.
   No other chronological claim is made (HST-005).
5. **Bounds and continuation.** Bounds come from the existing limit
   profile: scanned audit entries ≤ `dirEntries`, scanned evidence
   entries ≤ `dirEntries`, per-object bytes ≤ `recordBytes`, reported
   events/findings/annotations per page ≤ `enumerationResults`. An
   over-limit page returns a continuation cursor — an opaque
   self-validating token binding the store/namespace identity, the exact
   target identity and revision, the scan and surface generations, the
   limit shape, and the last scanned position (phase, shard, entry). A
   cursor from another store, target, generation, surface, or query
   shape fails closed. A page that is not truncated never claims
   completeness when findings exist (HST-006/008).
6. **Snapshot binding.** The query binds the current scan generation and
   surface generation, enumerates the audit surface and the
   store-evidence surface with descriptor-verified directory brackets,
   and then re-verifies both surfaces (entry-set tokens plus the
   generation/surface tokens and the target record digest). Any material
   change during inspection fails closed with
   `ERR-STO-ROOT-IDENTITY-CHANGED` (verify-before-retry); events from
   two incompatible generations are never merged (HST-009).
7. **Evidence linkage.** `StoreEvidenceRecord` objects referencing the
   target (payload `targetRecordId`) are reported as operational
   annotations — never as events in the target's audit history — with
   their verified facts (outcome, target digest, reconstruction audit
   identity, original action identity, recovery action, linkage to a
   durable reconstruction event). Evidence-without-event and
   event-without-evidence are deterministic findings (HST-007).
8. **Read-only.** The implementation is a read-only fs owner
   (readdir/open/close/fstat/readFile allowlist), imports no capability,
   provenance, publication-permit, lock, or recovery-mutation module,
   and performs zero mutation (RDS-006/011, HST-010).

## Consequences

- Contract §13.4 and HST-001…010 plus AUD-014 added; pinned SHA-256
  updated.
- `inspect-audit-history` is available at the read boundary without any
  capability: a genuine trusted configuration + trusted input establish
  the verified store instance (D-5); the query itself never accepts or
  returns authority, paths, nonces, or plan objects.
- Degraded states (malformed/duplicate/wrong-digest audits, reconstruction
  gaps, evidence conflicts, leftover surface corruption) are reported as
  deterministic findings; nothing is repaired.
- Exact-revision inspection only; logical-identity aggregation and
  predecessor/successor inference are not contract-defined and are not
  invented.
