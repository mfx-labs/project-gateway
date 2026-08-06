# WP-8-D — Focused Decision-Package Rereview

**Review type:** adversarial, read-only focused rereview of the M-1…M-4
corrections applied by the WP-8-D focused decision-package correction.
**Finding source (authoritative):**
`docs/reports/wp-8d-senior-decision-resolution-and-adr-review.md`
(verdict: CORRECTIONS REQUIRED; findings M-1…M-4).
**Corrected inputs checked:** `docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md`,
`docs/reports/wp-8d-decision-resolution-report.md`,
`docs/reports/wp-8d-pre-implementation-decision-consolidation-report.md`,
`docs/design/post-wp5a-roadmap.md`, `docs/design/post-wp5a-planning-status.md`.
**Reference input:** `docs/reports/wp-8d-senior-pre-implementation-security-and-architecture-review.md`.
**Independently checked:** the authoritative WP-8 contract (SHA-256
`aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`, read in
full), committed `src/storage/**` (provision/state classifier semantics,
taxonomy, capabilities/authenticity, errors/codes, layout), committed
`tests/unit/storage/**` (taxonomy assertion sites, static guard),
`tests/security/security.test.ts`, package/export configuration, ADR-028.
This is a focused closure rereview of M-1…M-4 only; no broad redesign
review was performed. No file other than this report was created or
modified; nothing was staged or committed.

---

## 1. Baseline and Inventory Gate

| Item | Expected | Verified |
|---|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` | exact |
| Branch | `main` | exact |
| HEAD | `bd832606ece489a924b4fcc13ad55789fcb0736f` | exact |
| HEAD subject | `feat: establish WP-8-C trusted storage bootstrap` | exact |
| HEAD parent | `05904e46ded384bab5f250ac72c2734539f1e86f` | exact |
| Staging | empty | empty (`git diff --cached` empty) |
| Commits after HEAD / tags | zero / zero | zero / zero |
| Source/test delta | zero | zero (`git diff HEAD -- src/ tests/` empty; no untracked source/tests) |
| Contract delta | zero | zero (byte-identical; SHA-256 exact) |
| Package/dependency/schema/export delta | zero | zero (`package.json`/lock unchanged; `ajv@8.20.0` only; public exports 42; package exports `"."`, `"./pi-adapter"`) |
| WP-8-D runtime implementation source | none | none (`src/storage/{publication,read,audit,locks}` absent) |
| WP-9 work | none | none (`src/control-plane/`, `src/mcp` absent) |
| Production initialization | unreachable | unreachable (action-provenance creator has zero production importers) |
| Production publication | absent | absent (no write producer, no write-capability issuer, no publication source) |

**Uncommitted WP-8-D documentation inventory before this report (exactly
seven paths, verified):**

1. `docs/reports/wp-8d-pre-implementation-decision-consolidation-report.md`
2. `docs/reports/wp-8d-senior-pre-implementation-security-and-architecture-review.md`
3. `docs/decisions/ADR-029-wp-8d-publication-locking-and-audit-policy.md`
4. `docs/reports/wp-8d-decision-resolution-report.md`
5. `docs/design/post-wp5a-roadmap.md`
6. `docs/design/post-wp5a-planning-status.md`
7. `docs/reports/wp-8d-senior-decision-resolution-and-adr-review.md`

**After creating this report, the complete inventory is exactly eight
documentation paths.**

## 2. Governance Waiver Result

**WP-8-C INDEPENDENT COMMIT VERIFICATION: SKIPPED BY HUMAN DIRECTION**

Recorded as a governance fact. This rereview does not claim that the
baseline commit `bd832606…`, its complete file manifest, or its commit
report was independently verified. The waiver is recorded consistently in
ADR-029, the decision-resolution report, the roadmap, and the planning
status.

## 3. M-1 — Capability-Kind Closure Result

**CLOSED.** Every corrected document (ADR-029 D-7 block and Implementation
Constraints; decision-resolution report §4 D-7 row and §5A;
consolidation report §10, §21 D-7 row, §22 register) states consistently:

- `provision-phase3` is **not a new CAP-001 capability kind** — it is an
  **operation-set extension of the existing initialization-capability
  family**;
- authenticity domain is the existing module-private
  `InitializationCapability` domain in
  `src/storage/capabilities/authenticity.ts`;
- permitted initialization-family operation values are exactly
  `namespace-initialize` and `provision-phase3`;
- issuance uses the existing initialization-family trusted gate with all
  current parent, namespace, configuration, limit-profile, generation,
  and lifetime bindings; **zero production issuance remains** (no
  production producer of the genuine branded operands exists; test-only
  issuance; importing the creator confers no minting authority);
- exact consumer: **`src/storage/publication/index.ts`** — the
  composition module invokes the top-level provisioning sequence
  **before writer-lock acquisition**;
- **ordering pinned:** top-level phase-3 provisioning precedes lock
  acquisition (no circular dependency — `locks/` must pre-exist the
  lock file); class/shard directory creation occurs **only after**
  writer-lock acquisition;
- **top-level authority exactly:** `<namespace>/records`,
  `<namespace>/audit`, `<namespace>/locks` — no raw path operand;
- **class/shard authority exactly:**
  `<namespace>/records/<validated-class-segment>/<validated-four-hex-shard>`
  and `<namespace>/audit/audit-event/<validated-four-hex-shard>`;
- class/shard creation requires a **genuine live `WriteCapability`**;
  class from the closed validated taxonomy; segment from the accepted
  layout derivation; shard an exact canonical four-lowercase-hex value
  from the validated record identity; **no arbitrary segment, no
  arbitrary shard; no other capability may create those targets**;
- the implementation envelope and creator-consumer graph use identical
  naming: the provisioning-capability issuer edge
  (`provision-phase3` operation, initialization-family domain) →
  `src/storage/publication/index.ts` (single production consumer, zero
  production issuance); **no separate provisioning composition module
  exists** — the previously unnamed "provisioning composition" is gone.

No new kind, unnamed composition module, unplaced brand, or unbounded
target remains. The class/shard target restriction also forecloses
cross-class or cross-shard creation by any other capability (write
capability only, derived paths only). **Result: CLOSED.**

## 4. M-2 — Classifier-Policy Closure Result

**CLOSED.** Verified across ADR-029, decision-resolution §5A, and
consolidation §10:

- **Committed WP-8-C behavior stated accurately:** the phase-2
  classifier (`classifyNamespace`, fixed set `['metadata','tmp']`)
  returns FOREIGN when fixed entries are missing **and metadata is
  verified** (`hasVerifiedMetadata ? 'FOREIGN' : 'PROVISIONAL'`); a
  phase-2-initialized store therefore classifies FOREIGN under the
  committed classifier. The prior package's inaccurate claim is
  explicitly corrected.
- **Policy characterization:** the new policy is explicitly a
  **classifier-policy-revision-bound internal software policy** — a
  committed revision of the classifier's fixed-entry constant; it is
  **not request-selectable, not metadata-selectable, not
  repository-selectable, not artifact-selectable** (no operand enters
  the fixed-entry policy; FSP-001/002 unchanged).
- **StoreMetadata format (`'1'`) and layout (`'v1'`) versions remain
  unchanged; no stored phase fact is added; no migration is introduced**
  (VRS-004: no automatic upgrade).
- **Five-state matrix, exactly as required:**
  - **A. Phase-2 initialized** — exact `{metadata,tmp}`, verified
    metadata → `PROVISIONAL / PHASE3-UPGRADE-REQUIRED`;
  - **B. Upgrade in progress** — allowed subset of the phase-3 set, no
    unknown entry → `PROVISIONAL`;
  - **C. Incomplete phase-3** — `metadata,tmp` plus a proper subset of
    `records,audit,locks`, every existing entry valid →
    `PROVISIONAL` **regardless of the metadata-verification flag**;
  - **D. Foreign / invalid** — unknown or deferred entry (`index`,
    `quarantine`); wrong type, UID, or mode; symlink; identity drift;
    malformed or unsupported metadata → the existing fail-closed state
    per precedence (FOREIGN / IDENTITY_DRIFTED / MALFORMED_METADATA /
    UNSUPPORTED_VERSION);
  - **E. Phase-3 initialized** — exact
    `{metadata,tmp,records,audit,locks}`, all verified → `INITIALIZED`.
- **Concurrent first use:** exclusive `mkdir`; `EEXIST` triggers
  descriptor-bound verification (WP-8-C `ensureFixedDirectory` pattern);
  an exact valid directory → idempotent continue; an invalid object →
  fail closed; no object is adopted, repaired, or deleted.
- **Crash retry:** a partial allowed set (states B/C) remains
  `PROVISIONAL`; a deterministic retry creates **only the exact missing
  entries**; a partial set is **never** classified FOREIGN.
- **Upgrade/downgrade:** WP-8-D software upgrades valid phase-2 stores
  (A → E through B/C); older pre-amendment software sees phase-3
  entries as unknown → FOREIGN and fails closed; this downgrade
  behavior is **intentional** and **VRS-008-safe** (fail-closed, no
  reinterpretation of records).
- **No remaining substantive claim** that the committed classifier
  already provides this behavior, that the entry set is selected by
  metadata/layout version, that a stored phase fact exists, or that
  migration is introduced. The phrase `version-bound` is replaced by
  `classifier-policy-revision-bound` everywhere it referred to the entry
  set (the only remaining occurrence is the correction record itself).

Partial and concurrent states cannot silently become FOREIGN under the
new policy: states A/B/C are PROVISIONAL by explicit rule (C independent
of the metadata-verification flag), and only state-D conditions
(unknown/deferred entries, invalid objects, drift, malformed state) reach
fail-closed classification. **Result: CLOSED.**

## 5. M-3 — Taxonomy Array Closure Result

**CLOSED.** Verified across ADR-029 (D-6 block "Canonical array rules
(M-3 pin)"), decision-resolution §4 D-6 row and §5A, and consolidation
§22 D-6 register row:

- `wp8Production` becomes a `readonly` array;
- arrays are **never empty**; **duplicates are forbidden**; the **exact
  declared order is authoritative**; **no runtime sorting or set
  normalization is performed or permitted anywhere**;
- every non-audit profile uses an exact one-element array, from exactly:
  `['no']`, `['initialization']`, `['maintenance']`,
  `['reconstruction-only']`;
- only `authoritative-audit-event` has the two-element array
  `['reconstruction-only', 'write-audit']` (exact declared order);
  `write-audit` appears in no other profile;
- **test envelope names all four committed scalar assertion sites** in
  `tests/unit/storage/taxonomy.test.ts` as implementation-time updates
  to exact array-equality: (1) the `'no'` loop over all non-special
  classes (→ `['no']`); (2) `store-evidence-record` `'maintenance'`
  (→ `['maintenance']`); (3) `store-metadata` `'initialization'`
  (→ `['initialization']`); (4) `authoritative-audit-event`
  `'reconstruction-only'` (→ `['reconstruction-only', 'write-audit']`);
- required future tests: exact array equality; exact order; no
  duplicates; nonempty arrays; only the audit profile has two values;
  only the audit profile contains `'write-audit'`.

All profile literals (BASE `'no'` and the six explicit profiles in the
committed taxonomy) and all consumer assertions have one deterministic
migration rule: scalar → exact one-element array (audit → the pinned
two-element array). Tests are not modified by the correction task (they
are implementation-time envelope items). **Result: CLOSED.**

## 6. M-4 — Current Status Closure Result

**CLOSED.** Verified:

- `docs/design/post-wp5a-planning-status.md` states: current work
  package **WP-8-D — Durable Single-Record Publication, Exact Reads,
  and Locking**; current sub-phase **focused decision-package
  correction**; next gate **WP-8-D FOCUSED DECISION-PACKAGE REREVIEW**;
  implementation readiness not yet granted; implementation, staging,
  and commit not authorized; WP-9 and later not authorized.
- `docs/design/post-wp5a-roadmap.md` states the same current-state
  facts (sub-phase, next gate, readiness, authorizations).
- The stale unqualified "the current work package is WP-8-A …"
  statement is gone.
- Scanned across roadmap, planning status, ADR-029, and both reports
  for unqualified current-state claims: **none remain** asserting that
  WP-8-A is current; that WP-8-C implementation is not accepted (the
  WP-8-C "not yet accepted" phrase is a waypoint inside the labeled
  WP-8-C chronology immediately superseded by "WP-8-C implementation is
  ACCEPTED" in the same paragraph — historical-by-sequence); that the
  seven decisions remain open (they are described as human-approved and
  bound by ADR-029); that implementation readiness is already granted;
  that implementation is authorized; that WP-9 is authorized; or that
  another next gate is current. Historical chronology is sequence-labeled
  and immediately superseded throughout.

**Result: CLOSED.**

## 7. Cross-Document Consistency Result

All five corrected documents treat identically: the M-1 capability
family/domain/consumer/targets (initialization-family operation-set
extension, `InitializationCapability` domain, `publication/index.ts`
consumer, pinned top-level and class/shard targets); the M-2 five-state
matrix and classifier-policy-revision-bound source; the M-3 array rules
(immutable, nonempty, no duplicates, exact declared order, no sorting,
one-element arrays, audit-only two-element array, four test-site
updates); the M-4 current gate (focused decision-package rereview); the
seven human decisions (D-2, D-3, D-5, D-6, D-7, D-8, D-12); ADR-029
Accepted status (via the external human decision); contract-subordinate
status (contract byte-identical, SHA-256 exact); no contract revision;
production publication unreachable; implementation readiness not yet
granted before this rereview; implementation, staging, and commit
unauthorized; WP-9 unauthorized. Baseline tables are scoped to their own
gates and do not describe the current seven/eight-path working tree as a
clean committed state. No stale or contradictory current-state evidence
was found.

## 8. No-Regression Check Result

The M-1…M-4 corrections did not alter or weaken any accepted decision:

- **D-2** zero-production-authority posture — intact (zero production
  provenance producers; future `src/control-plane/storage-write-action.ts`
  static policy only; no importer/export/test hook; publication
  unreachable).
- **D-3** locks-only entropy/process exception — intact (exact module
  `src/storage/locks/lock.ts`; named `randomBytes` + `process.pid`;
  injected bounded values; denied elsewhere).
- **D-5** verified-StoreMetadata capability binding — intact (full
  binding tuple; distinct domains; ADR-028 decision-C gate exercised).
- **D-6** evidence-not-authority rule — intact (the write-audit event
  "grants no authority, cannot approve, activate, issue, or execute
  anything"; AUD-005/TAX-012; no recursion per §22.1).
- **D-8** deterministic audit identity — intact (tuple, `pgw:l:` syntax,
  ordering, no stored sequence, no contract revision).
- **D-12** partial AUD-001 allocation — intact (authorized-write I/T;
  idempotent-duplicate/conflict IL; human-acknowledged).
- **Same-action temp-EEXIST fail-closed protocol** — intact (no
  adoption/reopen/unlink; bounded no-follow `fstat`; idempotent,
  DURABILITY audit-row, and unknown-state outcomes; no new code;
  phase-4 stale-temp cleanup).
- **28 + 3 error disposition** — intact (consolidation §15 exact table;
  decision-resolution §5 MINOR-1 record; totals equal 31; no hidden
  code).
- **No contract revision; no public export or dependency change** —
  intact.

No accepted decision was reopened; no correction contradicts the
contract.

## 9. Contract/package/export/dependency Result

- Contract: byte-identical, SHA-256
  `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f`,
  untouched; no revision required for any corrected item (M-1's
  operation-set extension stays within CAP-001's initialization family;
  M-2's policy revision is enforcement alignment with the already
  normative 5.2 structure under an unchanged layout version; M-3 is an
  internal source-shape change; M-4 is status wording).
- Package: `ajv@8.20.0` only; public exports 42; package exports
  `"."`, `"./pi-adapter"`; `src/index.ts` unchanged; no schema delta.

## 10. Findings by Severity

**BLOCKER:** none — baseline and seven-path inventory established
exactly.

**CRITICAL:** none — no correction creates ambient authority, arbitrary
mutation, overwrite, or lock-breaking authority.

**MAJOR:** none — no correction introduces a new capability kind,
wrong-store adoption, contract contradiction, or forgeable authority.

**MODERATE:** none — provisioning and classification are fully pinned
(consumer, domain, targets, ordering, five-state matrix, concurrent and
crash behavior).

**MINOR:** none — no stale status, terminology, array-rule, or evidence
inconsistency remains.

**NOTE:** none requiring correction. (Implementation-plan items remain as
already recorded: lock-acquisition functions require a genuine capability
operand; the lock module's production consumer edge joins the guard's
consumer graph; the lock-record schema reserves the boot-identity field —
all previously classified NOTE and not part of the M-1…M-4 closure.)

## 11. Blockers / Deviations

**Blockers:** none.

**Deviations:** none beyond the previously recorded and verified D-1
(eligibility input path substitution). No reviewed document was modified
by this rereview; no file other than this report was created.

## 12. Implementation-Readiness Result

**GRANTED.** M-1, M-2, M-3, and M-4 are fully closed, consistently
applied across all five corrected documents, contract-subordinate, and
free of new findings at any severity. The seven human decisions remain
accepted and bound by ADR-029; no contract revision is required;
production write authority remains unreachable; the implementation
envelope and creator-consumer graph are exact. **Implementation
authorization is not granted by this rereview** — it is a separate human
gate.

## 13. Verdict

`WP-8-D FOCUSED DECISION-PACKAGE REREVIEW: ACCEPTED`

```text
OPEN FINDINGS: 0
WP-8-D M-1 PROVISIONING AUTHORITY: ACCEPTED
WP-8-D M-2 CLASSIFIER POLICY: ACCEPTED
WP-8-D M-3 TAXONOMY ARRAY RULES: ACCEPTED
WP-8-D M-4 CURRENT STATUS: ACCEPTED
WP-8-D HUMAN DECISIONS: ACCEPTED
WP-8-D ADR-029: ACCEPTED
WP-8-D CONTRACT REVISION: NOT REQUIRED
WP-8-D PRODUCTION WRITE AUTHORITY: UNREACHABLE
WP-8-D DECISION PACKAGE: ACCEPTED
WP-8-D IMPLEMENTATION READINESS: GRANTED
WP-8-D IMPLEMENTATION AUTHORIZATION: NOT YET GRANTED
WP-8-D STAGING AUTHORIZATION: NOT GRANTED
WP-8-D COMMIT AUTHORIZATION: NOT GRANTED
WP-9 AND LATER AUTHORIZATION: NOT GRANTED
NEXT GATE: HUMAN AUTHORIZATION OF WP-8-D IMPLEMENTATION
PUBLICATION: NOT PERFORMED
```
