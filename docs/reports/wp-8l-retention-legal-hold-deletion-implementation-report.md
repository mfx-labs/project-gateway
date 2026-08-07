# WP-8-L Retention, Legal Hold, and Exact Deletion — Implementation Report

**Slice:** WP-8-L — the first policy-bound deletion path for immutable
storage: exact canonical record deletion under retention policy, exact
audit-event deletion under stricter post-record conditions, legal-hold
enforcement, durable intent/completion evidence, and crash-safe
idempotent execution (contract §15.4, RNT-011…020; ADR-035).

## 1. Scope and Files

Modified (13):

- `docs/specs/wp-8-local-storage-registry-contract.md` — §15.4 and
  RNT-011…020 (narrow amendment: the contract reserved the
  `retention` capability kind (§21.1) and the `retention-evidence`
  evidence kind (6.3) but defined no deletion authority, no hold
  freshness model, and no intent/completion evidence model — see
  ADR-035); pinned SHA-256 updated.
- `src/storage/types.ts` — retention mutation request/action/result/
  hooks/stage types, retention hold-result and evidence-outcome
  vocabularies, retention evidence facts on scan observations,
  retention evidence-state and survivor finding types, assessment
  fields, cursor `lastReportedEventTuple`, and `VerifiedRecordObject`
  descriptor facts (dev/ino/nlink).
- `src/storage/trusted-input/bootstrap-input.ts` — retention-action
  provenance and trusted-retention-request authenticity domains
  (separate module-private brands; cross-kind substitution fails).
- `src/storage/capabilities/authenticity.ts` — the private retention
  capability (operation set `retention-delete-record` /
  `retention-delete-audit`) and the exact-record retention publication
  permit (roles `retention-evidence` /
  `retention-authorized-write-audit`).
- `src/storage/locks/lock.ts` — the normal writer lock now accepts the
  retention capability kind and the two retention operations (retention
  deletion serializes through the ordinary writer lock; it never breaks
  locks).
- `src/storage/publication/publish-record.ts` — the permit-bound
  `publishRetentionBoundRecord` entry point (sink-level confinement;
  temp ordinals 16/17 record-delete, 18/19 audit-delete).
- `src/storage/read/read-record.ts` — `VerifiedRecordObject` carries
  descriptor facts for the exact unlink binding.
- `src/storage/read/history.ts` — root-cause correction (HST-005): the
  reported event slice and the pagination resume boundary now follow the
  normative audit ordering tuple instead of surface scan order.
- `src/storage/recovery/scan.ts` — `extractRetentionEvidenceFacts` and
  the `retentionEvidenceFacts` observation attachment.
- `src/storage/registry/derive.ts` — survivor-aware `auditAssociation`
  (`retentionSurvivors`; dangling audits explained by durable completion
  evidence are never corruption findings).
- `src/storage/recovery/assess.ts` — deterministic retention evidence
  state classification and survivor reporting.
- `src/storage/recovery/index.ts` — barrel exports for the new scan
  helpers.
- `docs/design/post-wp5a-roadmap.md` and
  `docs/design/post-wp5a-planning-status.md` — current-state wording.

Added (4):

- `docs/decisions/ADR-035-wp-8l-retention-legal-hold-deletion.md`
- `src/storage/retention/delete.ts` — the exact unlink primitive (fs
  owner; allowlist `openSync/closeSync/fstatSync/readFileSync/
  unlinkSync/fsyncSync/constants`).
- `src/storage/retention/evidence.ts` — fs-free deterministic
  intent/completion evidence builders, hold-state generation, history
  binding digest, existing-evidence verification, permit-bound
  publication, and durability verification.
- `src/storage/retention/execute.ts` — the fs-free authorized
  retention-mutation composition boundary; `src/storage/retention/
  index.ts` barrel.
- `tests/unit/storage/retention.test.ts` — 33 focused tests.

Modified tests: `tests/unit/storage/static-guard.test.ts` (allowlist,
creator edges, the new WP-8-L confinement test, the retention directory
test, the WP-8-K history-importer update, contract hash pin) and
`tests/security/security.test.ts` (the exact delegated-module set gains
`storage/retention/delete.js`).

## 2. Why a Contract Amendment Was Necessary

The contract already named the `retention` capability kind (§21.1),
reserved `retention-evidence` in the closed evidence-kind set (6.3), and
defined retention execution authority (RNT-001…010) — but it defined no
retention-deletion authority vocabulary, no legal-hold freshness model,
and no intent/completion evidence model, and RNT-009's "deletion MUST NOT
be permitted for immutable classes" predated any deletion path. One
concise ADR (ADR-035) and one narrow amendment (§15.4 + RNT-011…020)
were therefore added; no taxonomy change was required. The hold
freshness question — the WP-8-L blocking gate — was answered by the
generation-binding model of ADR-035 §3 (below), so no
`PARTIAL — CONTRACT DECISION REQUIRED` stop was needed.

## 3. Retention Authority Domain

`StorageRetentionActionProvenance` → `TrustedRetentionRequest` →
`RetentionCapability` → `RetentionPublicationPermit` mirrors the
recovery-domain construction with its own module-private brands. The
exact operations are `retention-delete-record` and
`retention-delete-audit`; no generic deletion vocabulary exists anywhere
in `src/storage` (static-guarded: `delete-object`, `delete-any`,
`delete-record`, `purge`, `cleanup`, `retention-admin`,
`filesystem-delete` are denied). Zero production retention-action-
provenance producers exist; creators are private and static-guarded
(exact import edges: `createTrustedRetentionRequest` and
`createRetentionCapability` → `retention/execute.ts`;
`createRetentionPublicationPermit` → `retention/evidence.ts`;
permit verifier/liveness → `publication/publish-record.ts`). The
retention capability creator never accepts a recovery operation and the
recovery capability creator never accepts a retention operation; a
`TrustedRecoveryRequest` can never mint a retention capability
(tested).

## 4. Legal-Hold Model and Freshness

The hold-state generation is the deterministic digest over the exact
(trusted-configuration identity, configuration version) the authority
adjudicated. Storage re-derives it from the current genuine trusted
configuration at every mutation boundary (pre-lock, under the writer
lock, post-intent) and requires equality with the decision binding and
the durable intent binding. Outcomes: `active-hold`,
`unknown-hold-state`, `stale-hold-decision` → deletion prohibited
(`hold-blocked`); `clear-current-hold-state` → evaluation proceeds only
if every other gate passes. A hold appearing after intent publication is
detected two ways: (a) in-process, the capability-generation registry
advances on configuration replacement (CAP-008/009) and the post-intent
revalidation fails before the unlink — the identity-bound writer lock
remains for external recovery, never auto-broken; (b) durably, a rerun
whose hold/policy binding no longer matches the durable intent fails
closed as `hold-blocked`/`policy-blocked`. The durable intent is
historical evidence of an authorized-but-not-executed deletion and is
never self-executing authority. Freshness is generation binding, never
wall-clock TTL. No caller-supplied boolean (`canDelete`,
`retentionExpired`, `hasNoHold`, `legalHold`) exists in the request
vocabulary (static-guarded and tested).

## 5. History Eligibility Binding

Retention deletion of a primary reuses the committed WP-8-K
`inspectAuditHistory` and binds the result to a deterministic digest
(`PGAP-STORAGE-RETENTION-HISTORY-BINDING-v1`) over target facts, verified
events in the normative tuple order, recovery annotations, closed
findings, completeness, and generation/surface tokens. Eligibility is a
clean complete original lineage only: `complete` status, `complete`
flag, zero findings, no continuation. `missing-authorized-write`,
`ambiguous-history`, contested lineages, truncated results, and
`reconstructed-gap` all fail closed (`history-incomplete`) — the
contract does not permit retention deletion with reconstructed history
gaps in this slice. The binding is re-derived under the writer lock and
after intent publication; a history change after intent fails closed
before unlink (tested by removing the original audit after intent).

## 6. Primary Deletion Rules

- Eligible classes: `validation-record`, `revocation-record`,
  `execution-occurrence-record`, `execution-attempt-record`,
  `trusted-receipt`, `execution-summary-record`, `migration-record`,
  `supersession-record`.
- Exact record only: unrelated records and ALL audits survive (no
  cascade, no directory/family/revision-group deletion).
- The twenty-step §15.4 sequence runs under the normal writer lock;
  registry-mode generation/surface tokens are stable across intent
  publication (the evidence class is excluded from the structural token
  and the generation binds only store/limits facts).
- The unlink primitive (`retention/delete.ts`) re-verifies
  descriptor-bound: no-follow open, regular file, exact UID, exact mode
  `0600`, size bound, dev/ino/nlink binding, exact canonical-byte
  digest, then unlinks exactly one name, verifies absence, and fsyncs
  the exact containing directory. Symlink replacements, mode changes,
  directory/type replacements, and digest changes fail closed (tested).
- After deletion the live registry record set no longer shows the
  primary; indexes are never mutated and fall stale per WP-8-H.

## 7. Audit Deletion Rules

`retention-delete-audit` deletes exactly one immutable audit event only
when: the audit envelope's association binds the exact referenced
primary identity/digest (event kind, payload, reference digests, trusted
action); the referenced primary is a retention-deletable class and
ABSENT; durable `retention-delete-record` completion evidence exists for
that exact referenced class/identity/digest with a completed outcome
(primary absence alone is never inferred); the audit's own retention
decision and hold state are valid; and no unresolved intent/completion
state blocks it. Primary deletion precedes audit deletion; audit
deletion never precedes primary deletion; each audit deletion is exact
and independently authorized — never a cascade. The authorized-write
audit of a still-present evidence record is unreachable (the referenced
class must be retention-deletable).

## 8. Durable Intent and Completion Evidence

- Intent domains: `PGAP-STORAGE-RETENTION-RECORD-DELETE-INTENT-v1`,
  `PGAP-STORAGE-RETENTION-AUDIT-DELETE-INTENT-v1`; completion domains:
  `PGAP-STORAGE-RETENTION-RECORD-DELETE-COMPLETION-v1`,
  `PGAP-STORAGE-RETENTION-AUDIT-DELETE-COMPLETION-v1`.
- Identities are deterministic domain digests over the exact factual
  tuples (store/namespace, operation, target class/identity/revision/
  digest, policy identity/version, decision identity, hold-state
  generation, hold result, history binding, and for completions the
  exact intent evidence identity). Time and action identity never enter
  an identity; replay yields identical identities.
- The intent (with its mechanical `authorized-write` audit) is durable
  BEFORE any unlink and binds the intended resulting state; the
  completion (with its audit) is published only AFTER the unlink and
  the containing-directory fsync and binds the intent identity/digest
  and the resulting state with outcome `deleted`/`already-completed`.
- Evidence uses the EXISTING `retention-evidence` kind (no new
  evidence kind; TAX-013 closed).

## 9. Idempotency

Target present + no intent → intent → unlink → completion. Target
present + matching intent + no completion → reverify → unlink →
completion. Target absent + matching intent + no completion →
completion roll-forward (the directory fsync makes the absence durable
before completion; hold/policy bindings re-verified; mismatch fails
closed). Target absent + matching intent + matching completion →
`already-completed`. Target absent + no intent → fail closed (absence
without intent never counts as retention completion). Target present +
completion → integrity inconsistency. Conflicting intent/completion at
the derived identities → fail closed; hold/policy change after intent →
`hold-blocked`/`policy-blocked`; replacements are never deleted (tested
for both target classes).

## 10. Crash Model

A fixed 14-stage inventory (`RetentionMutationStage`) covers both target
classes: `before-writer-lock`, `after-writer-lock`,
`before-intent-publication`, `after-intent-publication`,
`after-intent-audit-publication`, `after-post-intent-revalidation`,
`before-target-unlink`, `after-target-unlink`,
`before-directory-fsync`, `after-directory-fsync`,
`before-completion-publication`, `after-completion-publication`,
`after-completion-audit-publication`, `before-writer-lock-release`. The
crash test asserts the full inventory in order for both flows and
simulates a crash at every stage: intent durability, target presence,
lock retention, and the deterministic rerun outcome (`deleted` through
the completion stage, `already-completed` after) are asserted per stage;
the writer lock left by a crash is never auto-broken (fixture release
per the accepted crash harness). Every post-crash state is classifiable
by the scanner (`intent-pending`, `roll-forward-eligible`, `completed`,
`evidence-with-live-target`, `conflicting`, `dangling-evidence`).

## 11. Post-Deletion History/Registry Behavior

- The deleted primary disappears from the live registry record set;
  surviving audit events remain observable and are classified as
  intentional `retentionSurvivors` by the scanner (via the durable
  completion evidence), never as corruption findings or disposition
  candidates.
- The distinction between retention deletion and unexplained record
  loss is exposed through the durable intent/completion evidence
  records and the surviving audit events (both readable by identity);
  audit-history inspection of an absent target remains fail-closed by
  design (HST-002 requires the durable target).

## 12. Security Boundary

Proven by static guards and tests: retention authority separate from
recovery authority (no recovery capability/action can perform retention
deletion and vice versa); no generic deletion operation; exact
retention permit/authority creator edges; only the retention deletion
owner (`retention/delete.ts`) performs the unlink; no recursive
removal/rename/copy/chmod/chown; no subprocess/network; no raw paths;
no history-result → capability edge (structural history results grant
nothing — tested); no legal-hold boolean → authority; no package-root
retention export; zero production retention provenance producers. The
retention request accepts only closed logical bindings; all target
locations derive internally from verified facts.

## 13. Tests

| Suite | Result |
|---|---|
| Typecheck / build / test TS compilation | pass |
| Focused retention/deletion (`retention.test.js`) | **33 tests, 33 pass** |
| Audit-history (`audit-history.test.js`) | **20 tests, 20 pass** (the HST-005 ordering correction made the previously flaky ordering/budget tests deterministic) |
| Audit reconstruction | pass |
| Registry/recovery | pass |
| Registry index | pass |
| Recovery mutation | pass |
| External disposition | pass |
| Lock recovery | pass |
| Complete storage suite (incl. static guard 28 tests) | **387 tests, 387 pass** |
| Global security | **15 tests, 15 pass** |
| Storage crash suites (`storage-crash`) | **5 tests, 5 pass** |
| Contract-hash audit | pinned SHA-256 updated to `a516522e…a404c3` |
| `git diff --check` | clean |

The complete repository battery (unit + integration + security +
pi-adapter + trusted + pointofuse-v2 + WP-7 regression + storage suites)
is reported in §14.

## 14. Full Verification

- `npm run build` — pass.
- `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.tests.json` —
  pass.
- Default workflow battery (`npm test`): **1358 tests, 1357 pass,
  1 fail** — the single failure is the accepted Pi environment
  baseline (expected Pi `0.83.0`, installed `0.84.1`; default workflow
  `1357/1358` accepted for this slice).
- Per-suite totals: unit top-level 169/169; integration 100/100;
  security 15/15; pi-adapter 272 (271 pass + the accepted Pi mismatch);
  trusted 570/570; pointofuse-v2 232/232; WP-7 regression 165/165;
  storage suite 387 pass + 2 pre-existing privilege-gated skips;
  storage crash suites 5/5. Grand total across all suites:
  **1917 tests — 1914 pass, 1 accepted Pi mismatch, 2 pre-existing
  skips, 0 other failures**.
- Static guard: 28/28; global security: 15/15.
- `git diff --check` clean.

## 15. Correction Section — Independent Review Finding L-1

Retrospective independent review of the WP-8-L implementation returned
finding **L-1 — Recovery scan misclassifies durable retention-deletion
intent evidence as dangling-evidence; intent-pending and
roll-forward-eligible are unreachable.** This section records the
finding, the root cause, and the correction. The correction is applied
forward from current HEAD; no historical commit was rewritten.

### Root cause (confirmed)

Retention intent evidence legitimately carries NO `outcome` field;
`extractRetentionEvidenceFacts` rejected evidence unless
`typeof outcome === "string"`, and the downstream retention
classification additionally required `outcome === "deleted" ||
"already-completed"` before reaching the intent-state logic. Genuine
durable intent evidence was therefore classified as malformed/dangling,
making `intent-pending` and `roll-forward-eligible` unreachable. The
evidence producer was not changed; the scanner now understands the
committed retention evidence model.

### Intent/completion extraction model (corrected)

`extractRetentionEvidenceFacts` now models retention evidence as a
discriminated union over the ACTUAL committed payload shapes:

- **`kind: 'intent'`** — durable deletion intent. No `outcome` is
  required or accepted; every intent-required fact is verified
  (operation, target class/identity/revision/digest, trusted policy
  identity/version, decision identity, hold-state generation, hold
  result, history binding for the record flow, referenced primary
  completion binding for the audit flow), and the envelope identity MUST
  equal the deterministic intent identity re-derived over those facts
  plus the verified store instance (the committed WP-8L derivations).
  Missing a required intent field stays malformed.
- **`kind: 'completion'`** — deletion completion. Requires the exact
  completion facts: closed outcome (`deleted` / `already-completed`;
  unknown outcomes fail closed), the exact bound intent identity and
  intent bytes digest, and the per-operation bindings; the envelope
  identity MUST equal the deterministic completion identity.

### Restored scanner state behavior (assess.ts)

- Intent + target present (exact digest) → `intent-pending` (never
  `dangling-evidence`).
- Intent + target cleanly absent → `roll-forward-eligible`; a
  replaced/tampered/wrong-type object at the target location is
  `conflicting`, never clean absence (§13 semantics: absence is proven
  only by the derived target location having no observation).
- Completion + target present → `evidence-with-live-target`; completion
  + clean absence → `completed`; multiple distinct completions for one
  target → `conflicting`.
- Completion without a matching durable intent (missing intent, wrong
  operation, wrong target bindings, wrong intent bytes digest, record
  completion paired with an audit intent) → `dangling-evidence`;
  audit-deletion completion without the referenced primary-deletion
  completion → `dangling-evidence`.
- Multiple distinct intents for one target → `conflicting` (never a
  merged pending state). Malformed/identity-mismatched claims →
  `dangling-evidence`. The record flow resolves target presence on the
  records surface; the audit flow resolves it on the audit-event
  surface (`pgw:l:` target identities). The classification is purely
  observational: it mints no authority and enables no mutation.

### Record vs audit coverage and pairing

Both WP-8L flows are corrected and probed: primary record deletion
intent/completion and audit deletion intent/completion. Pairing is by
exact normative identities/bindings — target id/revision/digest,
operation, intent identity + bytes digest, referenced primary
completion — never loose target-ID-only matching.

### Intermediate crash-state tests (the coverage gap that let L-1 escape)

New tests assert the scanner state BETWEEN the crash and any rerun, for
every fixed crash stage and both target classes:

- primary: durable intent + target present → `intent-pending`;
  durable intent + target absent (post-unlink stages) →
  `roll-forward-eligible`; intent + completion → `completed`;
- audit: the same three states over the audit-event target;
- then the existing genuine retention execution is rerun and the
  existing behavior is confirmed unchanged (matching intent continues,
  hold/history/policy requirements remain enforced, completion becomes
  durable, `completed` follows, writer-lock semantics unchanged).

Additional deterministic tests cover conflicting intents, valid +
malformed intent sets, completion without matching intent, wrong target
digest, wrong retention operation, wrong evidence domain, unrelated
evidence exclusion (recovery/quarantine/other-target), and the replaced-
target conflict state.

### Mutation-boundary preservation

No retention execution code changed. The correction touches only the
read-only scanner/extractor (`recovery/scan.ts`), the observational
assessment (`recovery/assess.ts`), and the registry survivor lookup
(`registry/derive.ts`); retention authority, legal-hold semantics,
history binding, exact unlink, intent-before-unlink ordering, completion
publication, roll-forward mutation semantics, WP-8K history, and WP-8M
configuration recovery are unchanged. Static guards prove the scanner
classification remains observational (no retention authority/mutation
imports; identity verification only through the committed pure
derivations).

## 16. Remaining WP-8 Work

Compaction; migration; configuration-namespace recovery; disposition of
the remaining adjudication-only classes; lifecycle approval decisions;
WP-12 integration; WP-9 generation seeding; WP-8 closure evidence
(implementation review of WP-8-F…WP-8-L pending; WP-8 remains not
closed).
