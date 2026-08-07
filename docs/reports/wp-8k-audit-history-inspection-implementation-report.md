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
| Focused audit-history (`audit-history.test.js`) | **36 tests, 36 pass** (20 original + 16 correction tests) |
| Audit reconstruction | pass |
| Registry/recovery | pass |
| Registry index | pass |
| Recovery mutation | pass |
| External disposition | pass |
| Lock recovery | pass |
| Retention (WP-8-L) | pass |
| Config recovery (WP-8-M) | pass |
| Complete storage suite | **427 tests, 425 pass, 2 skipped** (pre-existing privilege-gated chown tests) |
| Static guard | pass (44 tests incl. global security) |
| Storage crash suites | 5/5 pass |
| WP-7 regression | 165/165 pass |
| Pi adapter / trusted / pointofuse-v2 (full `npm test`) | 1358 tests, 1357 pass, 1 fail — the single accepted baseline Pi mismatch (expected `0.83.0`, installed `0.84.1`) |
| `git diff --check` | clean |

## 14. Correction Section — Independent Review Disposition (F1–F4 + cursor versioning)

Retrospective independent review of the WP-8-K implementation returned
corrections required. This section records the disposition and the
correction. The correction is applied forward from current HEAD; no
historical commit was rewritten.

### F1 (HST-005 reported-event ordering) — already resolved by WP-8-L

The normative D-8 audit ordering tuple (primary logical creation time,
primary record identity, event identity) governs reported event delivery
and tuple-based pagination/resume, independent of filesystem enumeration
order. No further change was required. The correction adds a
**deterministic adversarial ordering fixture** that *proves* the premise
before asserting: a pure digest search constructs a pair of reconstruction
events whose surface enumeration order opposes their normative tuple
order; the test asserts the premise explicitly and fails if it cannot be
constructed, and additionally walks the pair under a one-result budget to
prove tuple-ordered paginated delivery.

### F2 — reconstruction-event association (corrected)

A `recovery-audit-reconstruction` candidate is now adopted only when every
contract-required association fact independently verifies:

- canonical envelope validity, exact event kind, exact target record
  identity, exact target digest (`wrong-target-digest`), exact gap marker
  (`missingEventKind: authorized-write`), and reference-digest linkage;
- envelope revision exactly `1`, record kind exactly
  `AuthoritativeAuditEvent`, creation evidence in the producer's UTC
  ISO-8601 format, and payload-digest binding (`malformed-audit`);
- **deterministic identity re-derivation through the SAME canonical D-8
  identity derivation as the committed WP-8-G producer
  (`computeAuditEventIdentity`)** over the store instance, target
  class/identity/revision/digest, the event kind, and the event's own
  trusted action identity — the declared event identity must equal it
  (`conflicting-audit`), which binds envelope revision, trusted action
  identity, declared event identity, target revision, and target digest;
- **exact linkage to reconstruction recovery evidence where evidence
  exists**: the evidence's recovery action identity must equal the
  event's trusted action identity and the evidence's
  `reconstructionAuditDigest` must equal the durable event's canonical
  digest (`conflicting-audit`; the event is removed from the verified
  set before the page slice, synthesis, and continuation are derived).

The reconstructed event's `trustedActionId` is the current
recovery/reconstruction action identity; the original historical action
remains a separate recovery-evidence fact and is never substituted into
or fabricated for the event. Deterministic probes A–I cover envelope
revision tamper, `trustedActionId` tamper, declared-identity tamper
placed at its derived location, target-digest tamper, target-revision
tamper, gap-marker tamper, evidence-action inconsistency, canonical-byte
tamper (creation evidence and payload digest), and the unchanged valid
reconstruction; A–H are never adopted and assert the exact finding/status,
and I remains valid. No weaker hand-rolled verifier was introduced.

### F3 — cross-page snapshot coherence (corrected)

Every page now derives a deterministic **bounded `historySnapshotIdentity`**
(domain-separated digest, `PGAP-STORAGE-AUDIT-HISTORY-SNAPSHOT-v1`) over:

- the verified target facts (class, identity, revision, canonical digest);
- the audit entries relevant to the query (every entry that produces a
  classification for this walk, with canonical content digests; the
  silently-skipped other-record events are excluded so that unrelated
  publication — including WP-8-L intent evidence publication — never
  invalidates an outstanding walk);
- the reconstruction-evidence entries relevant to the target (names +
  canonical content digests; retention and other recovery evidence is
  excluded for the same reason);
- the query shape (limit profile).

Never mtime, directory inode alone, entry count, registry index, or wall
clock; order-independent (sorted entry lists); bounded by the same scan
limits (an identity that cannot be derived within the limits fails closed
and no resumable cursor is issued). Every page verifies the **complete**
bounded surfaces — verification is never cut short by the reporting
budget — so the identity, the page slice, and the synthesis always derive
from the full authoritative surface. The continuation cursor binds the
identity; on resume the identity is recomputed and compared **before any
page data is returned**; any material change between pages (new/removed/
changed audit event, new reconstruction event, changed/new relevant
recovery evidence, target-record change) fails closed with
`ERR-STO-ROOT-IDENTITY-CHANGED`. Deterministic multi-page probes A–F
cover earlier-tuple publication, later-tuple publication, reconstruction
publication, relevant evidence publication, target tamper (all fail
closed), and irrelevant registry-index mutation (the walk remains
correct — the index is not part of history truth).

### F4 — annotation pagination (corrected)

Evidence findings and annotations are reported only on the first page on
which the audit surface is fully reported, resuming by the **explicit
evidence-surface position** (`lastEvidenceShard`/`lastEvidenceEntry`) —
never by an empty `phase: audit` position — and the returned
`reconstructionEvidence` collection is the page's reported slice (the
full verified set remains internal to the synthesis). Across a complete
walk each annotation is returned exactly once: the deterministic
multi-page fixture (3 events + 2 annotations under a one-result budget,
4 pages) asserts no duplicate/omitted annotation, no duplicate/omitted
event, normative tuple order, and final status/findings from the same
bound snapshot.

### Cursor format versioning (corrected)

The continuation cursor now carries an explicit `formatVersion` marker
(currently `1`) and the authoritative `historySnapshotIdentity`. Current
code fails closed — before any interpretation of the resume state — on
old WP-8K cursors (pre-HST-005 shape), cursors missing the version or
snapshot fields, unsupported future versions, tampered versions,
structurally ambiguous positions, cross-target/cross-revision cursors,
and cursors whose bound snapshot identity does not match the recomputed
identity. No best-effort interpretation of old cursor state is attempted;
cursor compatibility is not required across this pre-release internal
storage implementation.

### Finding/status consistency (regression-tested)

Returned events, annotations, findings, reconstruction synthesis/status,
and completeness all derive from the same authoritative snapshot: the
correction adds a regression test proving every page of a contested
walk binds one snapshot identity, truncated pages carry no definitive
status, and the final synthesis equals a fresh walk's synthesis. The
original authorized-write path is unchanged and a regression test proves
a tampered original (bytes changed at the exact expected identity) is
never adopted as verified original history.

## 15. Current WP-8 Assurance State

- WP-8K (audit-history inspection) was originally implemented and
  committed at `20d689918fca8d197f91e5c90bd7bac09c414867`.
- WP-8L (retention, legal hold, and exact deletion) and WP-8M
  (configuration-namespace recovery) were subsequently implemented.
- The WP-8 closure commit exists at
  `db1b41539331d10704f87cf480a49beacacf9168`.
- A retrospective independent review later found WP-8K defects (F2
  reconstruction association, F3 cross-page snapshot binding, F4
  annotation pagination, cursor format versioning; F1 already resolved
  by WP-8L).
- The current forward correction is **unstaged and uncommitted** at the
  current HEAD.
- **WP-8 closure assurance is therefore pending.** WP-8 must NOT be
  treated as assurance-revalidated until: (1) the WP-8K independent
  rereview passes; (2) the WP-8L independent retrospective review
  passes; (3) the WP-8M independent retrospective review passes; and
  (4) the closure state is revalidated.

This section is the current assurance state; it does not re-close WP-8,
and no part of this report claims the correction is independently
accepted or that a review has passed.
