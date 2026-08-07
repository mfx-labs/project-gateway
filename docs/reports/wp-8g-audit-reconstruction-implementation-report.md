# WP-8-G — Authorized Audit Reconstruction — Implementation Report

**Status:** WP-8-G — the contract-defined audit-reconstruction path for
verified durable records missing their write-audit event — is implemented
under the authorized scope: the third recovery operation
`audit-reconstruction` (contract §16.3, W8A-C11; AUD-011/012; CSA-013/014),
reusing the WP-8-F recovery authority, exact-record publication permit,
recovery evidence, locking, crash-safety, and idempotency infrastructure.
All changes are left unstaged and uncommitted; nothing was pushed, tagged,
released, published, installed, or deployed. Implementation acceptance is
not yet granted.

**Verdict:** `WP-8G AUDIT RECONSTRUCTION: COMMITTED` (after review)

**Human contract decision (recorded):** the existing WP-8 contract remains
normative. No contract amendment is authorized or required. Contract
§16.3, AUD-011, AUD-012, CSA-013, and decision-register DS-28 remain
normative: the reconstructed event is the distinct
`recovery-audit-reconstruction` kind bound to the current trusted RECOVERY
action identity with recovery-time `createdAt` and an explicit gap marker
`{ missingEventKind: 'authorized-write' }`. The missing historical
`authorized-write` event MUST NOT be fabricated. The original trusted
action identity — descriptor-bound and verified from the durable target,
request-bound, and recorded in the recovery evidence — must NOT replace
the recovery action identity in the reconstructed event. The gap-marker
representation is accepted for the current storage model; the derived
numeric/ordered audit-history view is later registry work. This
implementation follows the contract exactly, as the work-package §5/§6
model (exact `authorized-write` event with the original action identity)
was not adopted.

---

## 1. Baseline and Changed-Path Inventory

| Item | Value |
|---|---|
| Baseline HEAD | `1ee2016beeded346fb9eeb4f68bf2dafbf4041db` (`feat: add WP-8-F recovery mutation foundation`) |
| Contract | unchanged (still `93504ea29b5ed0abb0b9fcf4685029939ab1b652049325a8160023ba10c0cd3a`; pinned by the static guard) |
| Dependencies | unchanged (`ajv@8.20.0` only) |
| Public exports | unchanged; `src/index.ts` and package exports unchanged |

Modified (15):

- `src/storage/types.ts` — `RecoveryMutationStage` gains the six
  audit-reconstruction stages; `RecoveryMutationAction` gains the
  `audit-reconstruction` category and its five target bindings; result
  outcome gains `reconstructed`; `ReconstructionStateFinding` and the
  assessment bucket; `reconstructionEvidenceFacts` on record observations.
- `src/storage/capabilities/authenticity.ts` — recovery operation set
  gains `audit-reconstruction`; publication role gains
  `reconstructed-recovery-audit`; the permit audit binding generalizes to
  `referencedRecordId`/`referencedRecordDigest` with role/kind pairing
  and a mint-time exact-operation check; `createRecoveryCapability`
  gains a closed subset `operationSet` seam (production default: the full
  implemented vocabulary).
- `src/storage/audit/write-audit.ts` — `RECOVERY_AUDIT_RECONSTRUCTION_EVENT_KIND`,
  the shared tuple type, and `buildRecoveryAuditReconstructionEvent`
  (authorized-write builder behavior byte-identical).
- `src/storage/locks/lock.ts` — lock operation vocabulary gains
  `audit-reconstruction`.
- `src/storage/publication/publish-record.ts` — permit-bound sink
  validates the reconstruction role/kind/gap-marker payload binding;
  per-operation publication ordinals 6/7.
- `src/storage/recovery/scan.ts` — `recordObservationId`, current-state
  `auditEventsForRecord` and `reconstructionEvidenceForTarget`
  enumerations (read-only, fail-closed on unprovable surfaces), and
  `extractReconstructionEvidenceFacts`.
- `src/storage/recovery/reverify.ts` — `reverifyReconstructionTarget`
  (descriptor-bound target re-verification).
- `src/storage/recovery/evidence.ts` — evidence operation vocabulary
  gains `audit-reconstruction`; audit-permit minting uses the generalized
  referenced-record binding.
- `src/storage/recovery/execute.ts` — `audit-reconstruction` request
  validation and the full mutation flow.
- `src/storage/recovery/assess.ts` — deterministic `reconstructionStates`
  classification bucket.
- `src/storage/recovery/index.ts` — private barrel exports.
- `tests/unit/storage/recovery-mutation.test.ts` — permit binding field
  rename (`evidenceRecordId` → `referencedRecordId`).
- `tests/unit/storage/static-guard.test.ts` — permit-creator edge,
  mutation-owner set, fs-free set, and the new WP-8-G vocabulary
  confinement assertions.
- `docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`
  — current-state wording only.

New (3):

- `src/storage/recovery/reconstruct.ts` — the audit-reconstruction
  publication builder (pure derivation + exact-record permit minting and
  composition; filesystem-free).
- `tests/unit/storage/audit-reconstruction.test.ts` — 14 focused tests.
- `docs/reports/wp-8g-audit-reconstruction-implementation-report.md`
  (this report).

## 2. Authority Model

- The recovery capability operation set is exactly
  `['orphan-removal', 'quarantine-temporary', 'audit-reconstruction']`
  (no generic `audit-write`, `audit-repair`, `recovery-write`,
  `publish-audit`, or plan-action authority exists; tested).
- Every boundary verifies its exact operation: lock acquisition/release,
  target re-verification, evidence publication, and the publication sink.
  An authority whose exact operation set excludes `audit-reconstruction`
  (minted through the closed subset seam; production minting always uses
  the full implemented vocabulary) cannot verify the operation, cannot
  mint a reconstruction permit (mint-time check), and can never publish a
  reconstructed audit.
- Zero production recovery-action-provenance producers remain (the
  recovery capability is still unreachable in production); the provenance
  creator edge is unchanged.

## 3. Eligible Target Model

Eligible: any content-verified, descriptor-bound durable record in a
store-records `.rec` class with the mechanical audit relationship
(WPR-010/AUD-003) — primary lifecycle/artifact classes and canonical
`StoreEvidenceRecord` instances — at its exact derived canonical
location, with exact UID/mode/type/link-count (`nlink === 1`), canonical
and digest-valid bytes, unambiguous identity, no associated
`authorized-write` audit, no conflicting audit, no reconstruction
evidence, and a current reconstruction-candidate classification bound by
the request.

Ineligible (fail closed): `store-metadata`, `registry-snapshot`
(registry/index files), the audit class itself, configuration classes,
wrong-location or malformed objects, contested identities, digest
mismatches, quarantined/temporary objects, locks, records with a valid
matching audit, conflicting audits, and records requiring external
disposition.

## 4. Reconstruction Derivation

The reconstructed event is the contract's distinct
`recovery-audit-reconstruction` kind:

- identity: the D-8 domain-separated digest over (store/namespace
  identities, target class, target record identity, target revision read
  from the durable record, target digest, event kind, trusted RECOVERY
  action identity) — time-independent, so roll-forward and retry
  matching is deterministic;
- envelope: `AuthoritativeAuditEvent`, `createdAt` = recovery time (never
  the original operation time), `trustedActionId` = the trusted recovery
  action identity;
- payload: `eventKind`, target `recordId`, target `recordDigest`, and the
  explicit `gapMarker: { missingEventKind: 'authorized-write' }`;
- `referenceDigests: [target record digest]`.

The recovery-time bytes are creation evidence: an earlier run's event
with the same identity and payload facts is recognized as exact across
retries regardless of recovery-time drift (the WP-8-F accepted model for
creation evidence).

## 5. Original-Action Identity Source

The original trusted action identity is read from the durable target
envelope (`trustedActionId`; WPR-014) during descriptor-bound
re-verification, compared for exact equality against the request binding,
and recorded in the reconstruction evidence payload
(`originalActionIdentity`). It is NEVER substituted into the
reconstructed audit event (AUD-012). If the durable record's
`trustedActionId` is absent/malformed or differs from the request, the
mutation fails closed (external disposition; no guessing of historical
facts).

## 6. Exact-Permit Confinement

The WP-8-F `RecoveryPublicationPermit` is reused with a dedicated role
`reconstructed-recovery-audit` (the work package's suggested role name
`reconstructed-authorized-write-audit` embeds its conflicting
`authorized-write` event-kind claim and was not adopted). The permit
binds: the genuine recovery capability, operation
`audit-reconstruction`, the audit class, the exact audit identity/digest/
canonical-byte digest/derived destination, the exact referenced target
record identity and digest, the exact event kind
`recovery-audit-reconstruction` (role/kind pairing enforced at mint), and
the exact trusted recovery action identity. The sink additionally
requires the payload gap marker. All substitutions fail before directory
provisioning or publication. The permit creator is imported only by
`recovery/evidence.ts` and `recovery/reconstruct.ts` (the "other single
exact recovery publication builder"); the verifier only by the exact
publication sink; no barrel or package-root export.

## 7. Mutation Ordering

1. genuine trusted configuration + genuine recovery provenance →
2. store revalidation + capability issue → 3. assessment-generation and
surface-generation recomputation → 4. writer-lock acquisition (never
broken or replaced) → 5. descriptor-bound target re-verification →
6. current audit-state enumeration and classification (exact absent, no
conflict, no contest) → 7. current evidence-state enumeration → 8. exact
reconstructed-audit derivation → 9. exact-permit minting and publication
→ 10. reconstructed-audit durability confirmation → 11. reconstruction
evidence construction → 12. evidence publication + its `authorized-write`
audit → 13. verification of all required durability points (audit,
evidence, evidence audit) → 14. capability/root revalidation → 15. lock
release. Success is reported only after all three durability points are
verified; no existing durable record is overwritten, renamed, copied,
deleted, or modified.

## 8. Evidence Model

`StoreEvidenceRecord` (`recovery-evidence`, operation
`audit-reconstruction`) binding: store/namespace identity (identity
domain), recovery action identity (envelope `trustedActionId`), target
class/identity/digest, original trusted action identity, reconstructed
audit identity and digest, pre-reconstruction missing-audit finding id,
assessment generation, surface generation, outcome (`reconstructed` |
`already-completed`), and resulting state. Identity domain:
`PGAP-STORAGE-AUDIT-RECONSTRUCTION-EVIDENCE-v1` over the factual tuple
(no clock, nonce, path, or recovery action identity enters it). No raw
paths anywhere. The evidence's own `authorized-write` audit is published
at the same durability point (6.3 audit linkage).

## 9. Idempotency / Conflict States

| State | Result |
|---|---|
| Target present, exact audit absent, evidence absent | normal reconstruction (`reconstructed`) |
| Target present, exact audit present, evidence absent | evidence roll-forward (`reconstructed`) |
| Target present, exact audit present, matching evidence | `already-completed` |
| Target present, original `authorized-write` audit present (gap filled by the write path; CSA-014) | `already-completed`, no invented evidence |
| Target present, conflicting audit (wrong digest, malformed association, unreadable surface) | fail closed |
| Target present, multiple contesting audits (duplicate reconstruction events, duplicate originals) | fail closed, external disposition |
| Target changed/replaced/contested (nlink ≠ 1) | fail closed |
| Target missing | fail closed |
| Matching evidence present, reconstructed audit missing | fail closed (integrity failure; never republish from evidence alone) |
| Conflicting/duplicate evidence | fail closed |
| Audit references wrong target or digest | conflicting/dangling; fail closed; no automatic second event |

## 10. Scanner Integration

The recovery assessment now distinguishes, per target:
`audit-without-evidence` (roll-forward), `complete`, `evidence-without-audit`
(integrity), `conflicting-audit`, `duplicate-audit`, `malformed-evidence`,
and `dangling-evidence`; missing-audit-eligible targets remain in
`reconstructionCandidates`. Registry views continue to treat the target by
its durable record facts (RGY-010); reconstruction evidence and
reconstructed audits grant no lifecycle or mutation authority.

## 11. Crash Model

Fixed 12-stage inventory (asserted in tests):
`before-lock-acquisition`, `after-lock-acquisition`,
`after-target-verification`, `after-audit-absence-verification`,
`before-reconstructed-audit-publication`,
`after-reconstructed-audit-publication`,
`before-reconstructed-audit-durability-confirmation`,
`after-reconstructed-audit-durability-confirmation`,
`before-evidence-publication`, `after-evidence-publication`,
`after-evidence-audit-publication`, `before-lock-release`. After every
injected crash: the target record is untouched, no existing audit is
modified, no overwrite occurs, the scanner classifies the state
deterministically, a fresh assessment/request continues safely (audit
publication is payload-idempotent, evidence rolls forward, completed
states return already-completed), conflicting states fail closed, and a
held crash lock is never automatically broken (tests release it as a
fixture step, matching the WP-8-F harness).

## 12. Security-Boundary Changes

No new filesystem-bearing module: `reconstruct.ts` is fs-free and the
read-only current-state enumerations live in the existing `scan.ts`
owner (no allowlist change). Permit creator/verifier edges are exact;
the recovery capability never reaches the generic sink; generic
publication remains write-authority-only; no generic audit publication
API; no public/package export; no rename/copy/delete/chmod/chown repair,
subprocess, or network. New static-guard assertions cover the closed
operation vocabulary, the role owners, the event-kind literal owner, and
the permit creator edge.

## 13. Tests and Exact Counts

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | pass |
| Build | `npm run build` | pass |
| Test TS compilation | `npx tsc -p tsconfig.tests.json` | pass |
| Focused audit-reconstruction | `node --test dist-test/tests/unit/storage/audit-reconstruction.test.js` | **14 tests, 14 pass, 0 fail** |
| Existing recovery-mutation | `node --test dist-test/tests/unit/storage/recovery-mutation.test.js` | **18 tests, 18 pass, 0 fail** |
| Quarantine | `node --test dist-test/tests/unit/storage/quarantine.test.js` | **12 tests, 12 pass, 0 fail** |
| Complete storage suite | `node --test "dist-test/tests/unit/storage/*.test.js"` | **290 tests, 288 pass, 2 skipped** (pre-existing privilege-gated chown tests), 0 fail |
| Static guard | `node --test dist-test/tests/unit/storage/static-guard.test.js` | **23 tests, 23 pass, 0 fail** |
| Global security | `node --test dist-test/tests/security/security.test.js` | **15 tests, 15 pass, 0 fail** |
| Default workflow | `npm test` | **1357/1358 pass; 1 pre-existing environment-pinned failure** (pi-adapter harness expects Pi `0.83.0`, installed `0.84.1`; reproduced identically on the baseline `1ee2016` with `git stash`) |
| WP-7 regression | `node scripts/run-wp7-tests.mjs` | **165/165 pass** |
| Contract-hash audit | static guard (pinned SHA-256) | pass |
| `git diff --check` | — | clean |

All storage crash suites (recovery-mutation 10-stage, quarantine
15-stage, audit-reconstruction 12-stage) pass within the storage suite.

## 14. Contract Decision Record

1. **RESOLVED — human contract decision:** the work-package §5/§6
   requirement (exact `authorized-write` event with the original trusted
   action identity) was NOT adopted; contract §16.3/AUD-011/AUD-012/
   CSA-013/DS-28 remain normative. The distinct
   `recovery-audit-reconstruction` kind with the recovery action identity,
   recovery-time timestamp, and gap marker is confirmed; the missing
   historical `authorized-write` event is never fabricated; the original
   trusted action identity remains evidence-only (descriptor-bound,
   request-bound, recorded in the recovery evidence, never substituted
   into the reconstructed event). No contract amendment is required.
2. **Gap marker representation — accepted:** §16.3's "sequence allocation
   with a gap marker" cannot carry a stored numeric sequence (the WP-8-D
   audit model has no stored sequence; D-8). The explicit payload
   `gapMarker: { missingEventKind: 'authorized-write' }` is accepted for
   the current storage model; the derived numeric/ordered audit-history
   view is later registry work.
3. **Original-audit-present state:** when the original `authorized-write`
   audit appears (write-path retry) after an assessment, the mutation
   returns `already-completed` without evidence — the work-package §9
   roll-forward row applies to the exact reconstruction audit, which is
   the only audit this operation publishes.
4. **Reduced operation-set capability minting** exists only as a closed
   test seam; production minting binds the full implemented vocabulary
   (the WP-8-F model), so "orphan-only authority" is provable only at the
   capability/permit/sink gates, not through production issuance.

## 15. Remaining WP-8 Build Work

WPR-023 (d) and other external-disposition paths; quarantine-object
disposition for malformed/foreign/conflicting quarantine states;
stale-lock breaking with lock-recovery evidence; full audit-history
inspection; index rebuild and stale-index detection;
configuration-namespace recovery; retention; legal holds; migration;
lifecycle approval decisions; WP-12 integration; WP-9 generation seeding.

## 16. Git State

All changes were unstaged and uncommitted at report time (`git status`
showed the modified and untracked paths of §1 only); nothing was pushed,
tagged, released, published, installed, or deployed. The next gate is the
WP-8-F/WP-8-G implementation review.
