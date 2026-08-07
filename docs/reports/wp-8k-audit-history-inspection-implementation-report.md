# WP-8-K Audit-History Inspection — Implementation Report

**Slice:** WP-8-K — bounded, deterministic, read-only audit-history
inspection over authoritative immutable storage (contract §13.4,
HST-001…010, AUD-014; ADR-034).

## 1. Scope and Files

Modified (4):

- `docs/specs/wp-8-local-storage-registry-contract.md` — §13.4 and
  HST-001…010, AUD-014, operations-matrix row (narrow amendment; the
  contract named `inspect-audit-history` (13.1/RDS-006) but defined no
  history model — see ADR-034 for why the normative addition was
  required); pinned SHA-256 updated.
- `src/storage/types.ts` — audit-history request/result/cursor/finding
  types (WP-8-K block).
- `src/storage/read/index.ts` — the capability-free composition
  `inspectAuditHistory` at the read boundary.
- `tests/unit/storage/static-guard.test.ts` — the read-only allowlist
  entry for the new fs owner and the WP-8-K static-guard test; contract
  hash pin updated.
- `tests/security/security.test.ts` — the new read-only fs owner joins
  the delegated-modules set.

Added (3):

- `docs/decisions/ADR-034-wp-8k-audit-history-inspection.md`
- `src/storage/read/history.ts` — the read-only inspection owner
  (allowlist: `readdirSync/openSync/closeSync/fstatSync/readFileSync/
  constants`).
- `tests/unit/storage/audit-history.test.ts` — 20 focused tests.

## 2. Why a Contract Amendment Was Necessary

The contract lists `inspect-audit-history` (§13.1) and requires ordered,
bounded, non-mutating behavior (RDS-006) but defines no history model:
no association rule, no ordering rule, no bounds/continuation semantics,
no finding vocabulary. Deterministic history inspection was impossible
without a normative decision, so one concise ADR (ADR-034) was added and
the contract amended only as narrowly as necessary (§13.4 + HST-001…010
+ AUD-014). No behavior outside history inspection changed.

## 3. Authoritative Source and Association

- The history derives exclusively from verified immutable facts: the
  durable target record (exact class/identity/revision/digest/trusted
  action identity/creation time) and the verified `audit/audit-event/`
  surface. The registry index is never consulted (HST-002).
- An event belongs to the target's history only when its verified
  payload binds the exact target identity AND its canonical envelope,
  digest, derived-location identity, revision binding, reference
  digests, event-kind payload, and trusted action identity verify
  (HST-004). The original `authorized-write` event must additionally
  match the deterministic D-8 expected identity AND byte digest derived
  from the verified target facts — an event with the right record id but
  wrong digest is classified (`wrong-target-digest`), never adopted.
- Event kinds are never flattened: `authorized-write` vs
  `recovery-audit-reconstruction` are distinct reported kinds (HST-003,
  AUD-014). A reconstruction reports `gapMarker.missingEventKind =
  authorized-write`, the recovery action identity from the event, and
  the original trusted action identity from the durable target facts
  (and the evidence payload); the original event is never synthesized
  and the reconstruction event is never rewritten.

## 4. Ordering

Events are ordered by the normative audit ordering tuple (D-8): primary
logical creation time, primary record identity, audit event identity —
with the deterministic event identity as the final tie-break (HST-005,
DTM-003/007). Timestamps are exposed as recorded facts; filesystem
mtime/atime and host directory order never influence the order (tested
with `utimesSync` and reverse creation order).

## 5. Bounds and Pagination

- Scanned audit + evidence entries ≤ `totalScanEntries`; scanned bytes ≤
  `totalScanBytes`; per-object bytes ≤ `recordBytes`; reported
  events/findings/annotations per page ≤ `enumerationResults`.
- The scan bound fails closed (`ERR-STO-LIMIT-EXCEEDED`) when exceeded —
  complete history is produced in one bounded inspection and never
  silently truncated (HST-006).
- Over-limit results return an opaque self-validating continuation
  cursor binding the store/namespace identity, the exact target
  identity and revision, the scan and surface generations, the limit
  shape, and the last reported position (phase, shard, entry). A cursor
  from another store/target/generation/surface/query shape fails closed
  (HST-008). Every page re-verifies the full bounded surface and reports
  only the not-yet-reported items; the page on which both surfaces
  complete carries the deterministic synthesis.

## 6. Snapshot Binding

The query binds the current scan generation and surface generation,
enumerates the audit and store-evidence surfaces with descriptor-verified
readdir brackets (pre/post snapshot per directory), and then re-verifies
both surfaces (entry-set tokens), the generations, and the target record
digest. Any material change during inspection fails closed with
`ERR-STO-ROOT-IDENTITY-CHANGED` (verify-before-retry); events from two
incompatible generations are never merged into one claimed complete
history (HST-009). Tested by publishing a new record+audit and by
replacing the target during inspection.

## 7. Status and Findings

`historyStatus` (closed): `complete` (original present, no
reconstruction, zero findings), `reconstructed-gap` (original absent,
reconstruction present, uncontested), `ambiguous-history` (contested or
finding-carrying lineage — never treated as clean), and
`missing-authorized-write`. Truncated pages carry no definitive status;
`completeness.complete` is true only for a clean complete original
lineage.

`auditFindings` (closed HST-007 vocabulary): `missing-authorized-write`,
`dangling-audit`, `wrong-target-digest`, `duplicate-audit`,
`conflicting-audit`, `malformed-audit`, `unsupported-audit-version`,
`unverified-audit`, `ambiguous-history`, `evidence-without-event`,
`event-without-evidence`. Every finding carries a deterministic surface
position (shard/entry) and the associated event identity where known.
Nothing is repaired.

## 8. Reconstruction Edge Cases (all tested)

A. original only → `complete`. B. original missing + valid reconstruction
→ `reconstructed-gap` with the gap marker, recovery action, original
action (target fact), and a linked evidence annotation. C. original +
reconstruction → `ambiguous-history`; neither is discarded. D. two
reconstructions for one gap → both reported + `conflicting-audit`
(multiple reconstruction) finding. E. reconstruction with wrong target
digest → `wrong-target-digest`, never adopted. F. evidence without event
→ `evidence-without-event` integrity finding; the evidence remains an
annotation. G. event without evidence → `event-without-evidence`; no
evidence is fabricated.

## 9. Evidence Linkage

`StoreEvidenceRecord` objects whose verified payload declares
`recoveryOperation: audit-reconstruction` and binds the target record
identity are reported as operational annotations — never as events in
the target's audit history — with outcome, target digest, reconstruction
audit identity, original action identity, recovery action identity, and
linkage to the durable reconstruction event when one exists. The
evidence's own audit lineage is a separate history query on the evidence
identity (the distinction is preserved). Other recovery-evidence kinds
(quarantine disposition, index disposition, lock recovery, orphan
removal) reference non-record targets and are not part of this query.

## 10. Read-Only Guarantee

The implementation performs zero storage mutation: no unlink/link/mkdir/
rename/copy/chmod/chown/fsync-for-durability, no publication permit, no
capability, no writer lock, no recovery-break guard, no evidence or audit
publication. The new module is a read-only fs owner with a strict
read-only allowlist; static guards prove it imports no capability,
provenance, permit, lock, or recovery-mutation machinery, that the read
composition is capability-free, and that the result type carries no
authority-shaped fields (HST-010).

## 11. Index Interaction

No fast path is implemented: one-target history derives from verified
immutable facts directly, so a stale, malformed, absent, or current-valid
registry index never affects the result (tested with a junk index
artifact and a committed rebuild; results are byte-identical).

## 12. Retention-Readiness

The result exposes, as pure data: exact target facts (class/identity/
revision/digest/action/creation time), verified events with digests and
kinds, reconstruction/evidence annotations, closed findings, completeness
and truncation state, and generation/surface bindings — everything a
later retention engine needs to answer "which exact revision/event,
which lineage, complete or gapped/conflicted, and which digests support
the conclusion." No `canDelete`/`shouldDelete`/expiry/hold/eligibility
fields exist (later policy layers).

## 13. Tests

| Suite | Result |
|---|---|
| Typecheck / build / test TS compilation | pass |
| Focused audit-history (`audit-history.test.js`) | **20 tests, 20 pass** |
| Audit reconstruction | pass |
| Registry/recovery | pass |
| Registry index | pass |
| Recovery mutation | pass |
| External disposition | pass |
| Lock recovery | pass |
| Complete storage suite | **355 tests, 353 pass, 2 skipped** (pre-existing privilege-gated chown tests) |
| Static guard | **27 tests, 27 pass** |
| Global security | **15 tests, 15 pass** |
| Storage crash suites | 5/5 pass |
| Unit + integration | 269/269 pass |
| Pi adapter / trusted / pointofuse-v2 | 1073/1074 pass — the single accepted baseline Pi mismatch (expected `0.83.0`, installed `0.84.1`) |
| WP-7 regression | 165/165 pass |
| Contract-hash audit | pinned SHA-256 updated to `5050c61c…cd9d95` |
| `git diff --check` | clean |

## 14. Remaining WP-8 Work

Retention execution; legal holds; primary/audit deletion; compaction;
migration; configuration-namespace recovery; disposition of remaining
adjudication-only classes; lifecycle approval decisions; WP-12
integration; WP-9 generation seeding. WP-8-F…WP-8-K remain unclosed
(implementation review pending).
