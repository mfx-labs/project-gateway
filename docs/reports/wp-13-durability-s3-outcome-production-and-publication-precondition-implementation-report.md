# WP-13 Durability S3 — Outcome Production & Publication Precondition Implementation Report

**Work package:** WP-13 durability S3 — the first production use of
`ExecutionOutcomeRecord`: retrospective-complete outcome production through
the S2 authority boundary, attempt-scoped at-most-one semantics under the
exact shared WP-13C coordination key, material replay/conflict semantics,
opaque identity/timestamp allocation ONLY in the no-existing branch, full
lock release before publication, and the strengthened WP-13C outcome
precondition (ADR-039 §9/§11; durability decision §1–§15/§19/§20).
**Status:** **ACCEPTED** — focused senior review findings
SIR-WP13-DUR-S3-001…004 raised, corrected, and **all four CLOSED**;
focused rereview **ACCEPTED**; `SIR-WP13-DUR-S3-RR-001` retained as an
accepted non-blocking MINOR note; **S3 ACCEPTED** (this baseline commit).
**S4 NOT STARTED / NOT AUTHORIZED**; **WP-13 NOT CLOSED**;
**WP-14/WP-15 blocked**.
**Baseline:** parent `5560125f33e92170c18b14060215e089373d565f` (branch
`main`; `feat: establish WP-13 durability S2 authority boundary`);
committed as `feat: establish WP-13 durability S3 production`. No
push/tag/release/deploy.
**Authoritative contract:** ADR-039 (Accepted), durability decision
§4/§5/§6/§7/§9/§10/§11/§15 (EXE-010…013), committed S1 schema/taxonomy
baseline, committed S2 authority boundary, committed WP-13C publication
authority.

## 1. Exact changed paths

**Modified (tracked):**

| Path | Change |
|---|---|
| `src/publication/publish.ts` | shared `attemptCoordinationKey` import replaces the private key builder; WP-13C outcome precondition (`PUBLICATION-OUTCOME-REJECTED`) under the attempt lock, before first publication OR replay acceptance; **SIR-001 correction:** context omission/forgery fail closed (`outcome.context-missing` / `outcome.context-not-genuine`), no default-allow; **SIR-003 correction:** corrupt outcome-domain entries fail closed, never skipped |
| `src/publication/types.ts` | `PublicationOutcomePrecondition` + `PublicationInput.outcome` (runtime-required, type-optional for legacy source compat); closed category list + `PUBLICATION-OUTCOME-REJECTED` |
| `tests/unit/wp13-durability-s2-static-guard.test.ts` | mint-site guard updated from **zero** production mint sites to **exactly one** explicitly authorized S3 host-composition mint site (`src/outcome-production/compose.ts`) — the guard is extended, never weakened |
| `tests/unit/wp13c-publication.test.ts` | suite updated to the mandatory-precondition world: genuine outcome boundary + branded context in `makeEnv`, per-test exact outcome seeding, precondition-first conflict semantics, new legacy-durable-publication conflict test (SIR-001) |

**New (untracked):**

| Path | Purpose |
|---|---|
| `src/internal/attempt-coordination-key.ts` | ONE shared pure attempt-coordination-key derivation (byte-for-byte the same for outcome production and WP-13C) |
| `src/internal/publication-outcome-context.ts` | **SIR-001:** branded publication-outcome precondition context (module-private WeakSet; factory consumed ONLY by the trusted host composition; never in a barrel) |
| `src/outcome-production/types.ts` | S3 type vocabulary: input model, identity source, closed failure taxonomy, results, `PublicationAuthorityInput` |
| `src/outcome-production/new-outcome.ts` | the no-existing branch: opaque record/evidence id + timestamp allocation, exact construction, schema gate, exact-record permit, S2 publish — **SIR-002:** ONLY the S2 `published` outcome is new-outcome success; every non-published state is a typed `write.not-published` failure |
| `src/outcome-production/produce.ts` | decision core: input hygiene, retrospective-complete correlation gate, canonical observation binding, Model-1 lock, under-lock re-read, cardinality/replay/conflict decision |
| `src/outcome-production/compose.ts` | the ONE production outcome-capability mint site + **SIR-001:** the trusted publication composition (real WP-13C boundary, result-publication capability mint, `publishResult` with the genuine branded context injected) |
| `src/outcome-production/index.ts` | barrel: decision core + composition + closed vocabulary only (no capability internals, no precondition-context factory) |
| `tests/unit/wp13-durability-s3-helpers.ts` | shared focused harness (real WP-8/WP-12/WP-5A/WP-5B/WP-13B/S2 flow; counting/throwing identity + store wrappers; genuine branded precondition context) |
| `tests/unit/wp13-durability-s3-outcome-production.test.ts` | 37 focused tests (§16/§17/§18 + SIR-002 storage-result mapping + trusted publication composition) |
| `tests/unit/wp13-durability-s3-wp13c-precondition.test.ts` | 22 focused tests (§19 + SIR-001 omission/forgery/legacy + SIR-003 corrupt candidates) |
| `tests/unit/wp13-durability-s3-static-guard.test.ts` | 7 static security guards (§20 + SIR-004 ownership checks) |

No schema, taxonomy, rule, fixture, manifest, or generated-corpus file is
modified (S1 baselines preserved; no S1 regeneration was needed).

## 2. Trusted production input model (§1)

`OutcomeProductionInput` consumes ONLY already-established trusted/verified
inputs — never inferred, synthesized, or reconstructed:

* `attempt` — the exact durable `ExecutionAttemptRecord` payload;
* `outcome` — the verified terminal `ExecutionAttemptOutcome`;
* `observation` — the genuine branded `PiExecutionObservation`;
* `enforcement?` — optional exactly correlated `PiEnforcementEvidence`;
* `handoff?` — optional complete `ValidatedResultHandoff`;
* `validation?` — the exact durable passing `ValidationRecord` payload,
  required iff a handoff exists;
* `registry` — the current trusted registry context;
* `store` — the S2 `OutcomeStoreBoundary` (outcome candidates + the ONLY
  outcome write path);
* `records` — the WP-12 `ControlPlaneStoreBoundary` (under-lock durable
  attempt re-read);
* `coordinate` — the existing host `DecisionCoordinator` (FSCR-W12-001;
  no new lock implementation);
* `identity` — host-owned opaque `nowUtcIso` / `newRecordId` /
  `newEvidenceId` (D-3 pattern);
* `capability` — the genuine outcome-recorder capability (minted ONLY by
  the S3 host composition);
* `schemaRegistry`, `hooks` (in-lock test/host seam, WP-12 race pattern).

If the trusted retrospective-complete inputs do not exist, NO outcome record
is fabricated: the attempt remains `terminal-unverifiable` under the
accepted contract (EXE-012; no receipt, no facts, no recovery synthesis).
The result quartet is built ONLY from the trusted handoff — the
project-visible `ExecutionResult` file is never consulted (proven by a test
that deletes the result artifact before production and asserts the durable
quartet is still byte-identical to the handoff).

## 3. Retrospective-complete gate (§2)

Before entering outcome production the operation verifies, exactly:

* durable attempt record exists (shape + exact syntax);
* verified terminal outcome belongs to that exact attempt (occurrence /
  attempt / ordinal exact; disposition in the committed 7-value vocabulary);
* genuine correlated observation (WP-5A brand + occurrence / attempt /
  bundle-reference exact);
* workspace / bundle instance / revision / digest / occurrence / attempt /
  ordinal exact throughout;
* when a result association exists: complete handoff, exact passing
  `ValidationRecord` (subject kind `ExecutionResult` 1.0, exact instance,
  exact revision, exact digest, exact workspace, record identity === the
  handoff reference) — no partial association;
* when enforcement evidence exists: exact committed WP-5B correlation
  (below) — retrospective-only, grants no authority.

No inference of a missing outcome; no synthesized observation; no
recomputation of effective authority; no receipt; no reconstruction of
process-local inputs after process loss.

## 4. Observation evidence canonical binding (§3, EXE-011)

* Canonicalization: the committed JCS/NFC discipline — `stripUndefined`
  (committed WP-5B canonical-input helper) → `validateCanonicalInput`
  (NFC, safe integers, no lone surrogates, no ambiguous values) → `jcsSerialize`.
  Invalid canonicalization is a typed `input.observation-canonicalization`
  rejection.
* Content digest: `sha-256:` over that canonical material (raw SHA-256 over
  the canonical UTF-8; the only `node:crypto` consumer in the family,
  static-guard confined to `produce.ts`).
* Raw session/turn correlation ids are NEVER evidence identities: they stay
  inside the digest-bound observation material; `pgw:e:` evidence identity
  is allocated ONLY in the no-existing branch under the attempt lock. A
  test proves the durable record never contains the session/turn id strings
  and the evidence id is the minted `pgw:e:`.
* Replay recomputes the observation digest from the current genuine
  verified observation and compares it to the stored reference.

## 5. Observation / enforcement / result correlations (§17 evidence)

* **Observation:** WP-5A WeakSet brand (`isPiExecutionObservation`; a
  plain clone is rejected `input.observation-not-genuine`); occurrence /
  attempt / bundle exact against the attempt record
  (`input.observation-correlation`); canonicalization gate
  (`input.observation-canonicalization`).
* **Enforcement (WP-5B):** the evidence fingerprint must RECOMPUTE from
  the complete canonical evidence record (committed
  `computeEvidenceFingerprint`); `inputPlanIdentity` must exactly equal the
  committed canonical plan identity over occurrence + attempt + bundle
  instance (committed `computePlanIdentity`); `projectionIdentity` and
  `evidenceFingerprint` must be committed digest syntax. Any mismatch →
  `input.enforcement-correlation`, no write.
* **Result association:** the quartet is copied verbatim from the trusted
  handoff + exact passing `ValidationRecord`; partial association
  (`input.validation-missing`), non-passing (`input.validation-invalid`),
  or wrong subject instance/digest/workspace (`input.validation-mismatch`)
  all fail closed before any write.

## 6. Shared exact attempt coordination key (§4)

`src/internal/attempt-coordination-key.ts` is the ONE pure key derivation,
pinned byte-for-byte for both domains:

`workspace | bundle instance | bundle revision | bundle digest | occurrence | attempt`

Explicitly excluded: result instance, result revision/digest, disposition,
observation evidence id, observation digest, enforcement evidence,
ValidationRecord id, lifecycle record id, `created_at`. WP-13C's former
private builder is replaced by the shared helper (identical key string —
the `|`-join order is preserved); the outcome operation uses the same
helper from the attempt record. The S3 static guard asserts both
`publication/publish.ts` and `outcome-production/produce.ts` import the
shared module and neither builds its own key string. A focused test records
the key of a real outcome operation and a real WP-13C publication for the
same attempt and asserts byte-identical resolution, and different attempts
are proven independent.

## 7. Model-1 lock (§5, §18)

Exactly per the pinned model:

* **Outcome phase:** acquire the attempt coordination key → under-lock
  re-read of the current durable attempt + every outcome candidate →
  uniqueness/replay decision → (no-existing only) publish exactly one
  record through S2 → receive the publication outcome → RELEASE the lock
  completely.
* **Publication phase (only after release):** WP-13C independently acquires
  the SAME key, performs its own re-read/precondition/publication decision,
  and releases normally. No nested acquisition, no reentrant lock, no lock
  handoff object.

Tests prove: the lock is held when the no-existing branch runs (an in-hook
`withLock` on the same key throws `LockContentionError`); the lock is
released before return; a nested `publishValidatedResult` attempted from
inside the outcome lock fails closed as `PUBLICATION-LOCK-CONFLICT`
`lock.conflict`; the production ordering (produce → release → publish with
the same coordinator) succeeds without contention; concurrent exact callers
create-then-replay with zero second allocations/writes; concurrent
divergent callers conflict after the first valid durable outcome wins;
different attempts use independent keys/records. Lock contention behavior
is the existing host coordinator's — no scheduler/retry semantics invented.

## 8. Under-lock durable re-read (§6)

After acquiring the outcome attempt lock: the exact current
`ExecutionAttemptRecord` is re-read through the WP-12 read surface and must
be canonically identical to the trusted input (`state.attempt-diverged`
otherwise); the current registry/storage context is the host-injected
registry used for the record binding; ALL existing `execution-outcome-record`
candidates for the exact attempt are enumerated + individually read. Never
a pre-lock enumeration for uniqueness.

## 9. Replay material definition (§7)

Replay equivalence compares every independently caller-verifiable material
field exactly: registry reference, workspace, bundle
(instance/revision/digest/binding), occurrence, attempt, ordinal,
`execution_attempt_record_id`, disposition, `observation_evidence.kind`,
recomputed `content_digest`, media type, role, enforcement group presence +
exact values, result association presence + exact quartet. The durable
candidate must first pass the committed lifecycle schema gate
(`state.outcome-corrupt` otherwise). EXCLUDED from equivalence — the
operation-assigned values only: `record_id`, `created_at`,
`observation_evidence.evidence_id` (the existing id must keep committed
`pgw:e:` syntax and is preserved exactly; never minted again). Exact replay
returns the existing durable record/id — NO record id, NO evidence id, NO
timestamp, NO permit, NO S2 write, NO WP-8 write (counting/throwing
identity sources + counting store prove zero invocations). Material
divergence → typed `OUTCOME-CONFLICT` `conflict.material-divergence`, no
write. WP-8 duplicate/idempotent storage outcomes are NOT the S3 replay
decision — the S3 decision precedes any write attempt.

## 10. Cardinality (§6, EXE-010)

Zero candidates → no-existing branch; exactly one → material replay
verification; more than one → `OUTCOME-CONFLICT`
`conflict.multiple-outcomes`. No newest-wins, no record-id ordering, no
`created_at` ordering, no enumeration-order selection (proven by reversed
seeding order yielding the identical typed conflict). Malformed/corrupt
candidate state (wrong class marker, schema-invalid payload, unreadable
record) fails closed as `state.outcome-corrupt` / `state.outcome-*`.

## 11. No-existing allocation timing (§8)

ONLY after the under-lock re-read proves zero existing outcome records:
(1) opaque lifecycle record id → (2) opaque observation evidence id →
(3) lifecycle timestamp → (4) exact construction → (5) structural/semantic
validation → (6) exact S2 permit mint → (7) S2
`publishExactOutcomeRecord`. No `newRecordId()` / `newEvidenceId()` / time
source call is reachable before zero-existing is established: the calls
live ONLY in `new-outcome.ts` (the no-existing branch module; static-guard
proves no other family module calls them) and counting/throwing identity
tests prove replay/conflict paths never invoke them. No
deterministic/content-derived record or evidence identity exists.

## 12. Single production capability mint site (§9)

`src/outcome-production/compose.ts` is the ONE production mint site for
`createExecutionOutcomeCapability`: it owns the genuine trusted workspace
configuration and the trusted host action/provenance context, builds the
real S2 boundary, mints the branded generation-bound capability, and holds
it module-privately inside the authority closure. The S2 static mint-site
guard is EXTENDED from zero production mint sites to exactly one (the
mention scan across all of `src/**` now pins capability.ts definition +
compose.ts mint); the guard is not weakened or removed. Capability internals
are never exported; the capability is never handed to arbitrary execution
callers; S2 generation semantics (share-current-generation under an
unchanged configuration; advance on genuine replacement) are preserved; the
result-publisher capability is NOT minted or shared here (two separate
WP-13 domains; independent generation registries, S2-proven).

## 13. Outcome construction (§10)

The committed S1 `ExecutionOutcomeRecord` is constructed exactly:
`record_type`, opaque `record_id`, lifecycle `created_at`,
`responsible_role` const, `registry_snapshot_reference` (committed
`registryReferenceFor`), `workspace_id`, exact `bundle` reference,
`occurrence_id`, `attempt_id`, `ordinal`,
`execution_attempt_record_id` (anchor), `disposition` (committed
vocabulary), `observation_evidence` (REQUIRED: kind const, opaque
`pgw:e:` id, canonical content digest, media type const, role const).
Optional `enforcement_evidence` only when genuine exactly correlated
enforcement evidence exists; optional `result_association` (exact quartet)
only when an evaluator-produced validated result exists. Never included:
publication id/scopes, TrustedReceipt data, project path, session/turn ids
as evidence identity, recovery fields, retry authority, execution
authority.

## 14. Host production ordering (§11)

The S3 composition wires the accepted sequence:
`ExecutionAttemptRecord → execution + verified observation/outcome →
OPTIONAL completion + ValidationRecord → ExecutionOutcomeRecord operation →
OPTIONAL ResultPublicationRecord → later S4 retrospective derivation`.
For a completed/result-producing attempt: completion/ValidationRecord
finishes BEFORE outcome construction; the outcome record persists the
result association BEFORE publication; publication begins only after the
outcome operation released its lock (proven by the same-coordinator
ordering test). A no-result/non-completion path that still reaches
retrospective-complete produces an outcome record with no
`result_association` and no publication. A terminal-unverifiable path
produces no outcome record, no publication, no fabricated result/facts. No
recovery/resume after process loss is implemented.

## 15. WP-13C outcome precondition (§12, §19)

`publishValidatedResult` is strengthened: under WP-13C's own independently
acquired attempt lock, BEFORE first publication or replay acceptance, the
publication must (1) re-read the exact outcome records for the attempt
through the S2 outcome store boundary supplied in the new
`PublicationInput.outcome` context; (2) require exactly one valid matching
`ExecutionOutcomeRecord` (`outcome.missing` / `outcome.multiple` /
`outcome.invalid`); (3) require `result_association` to exist
(`outcome.association-missing`); (4) exact-match the publication
request/handoff against it — result instance, revision digest, association
mode, ValidationRecord id, workspace, bundle instance/revision/digest,
occurrence, attempt (`outcome.mismatch.*`); (5) independently re-read and
re-check the exact passing ValidationRecord (subject kind
`ExecutionResult`, exact instance/revision/digest/workspace, structural +
semantic pass — the committed WP-13C re-read, unchanged). Any failure is a
typed `PUBLICATION-OUTCOME-REJECTED` denial before any publication write.
The outcome record is NOT publication provenance; `ResultPublicationRecord`
remains authoritative for publication.

**Mandatory context (SIR-WP13-DUR-S3-001 correction):** the precondition context
is REQUIRED at runtime — `publishValidatedResult` verifies the genuine branded
context before use; an omitted context (legacy caller) or a forged
structurally-compatible context is a typed `PUBLICATION-OUTCOME-REJECTED`
denial (`outcome.context-missing` / `outcome.context-not-genuine`) with zero
publication write. The TypeScript property is kept optional solely for source
compatibility with the uneditable superseded closure; runtime omission
deterministically fails closed. The context is constructed ONLY by the trusted
S3 host composition from the genuine S2 boundary (branded, factory confined),
and the composition's `publishResult` is the production-capable publication
wiring that injects it.

## 16. Publication replay behavior (§13)

The precondition applies to BOTH first publication and replay acceptance: a
durable existing publication alone never bypasses outcome consistency.
For a durable existing exact publication: the outcome precondition is
verified first, then the committed idempotent publication semantics may
return the existing publication (test: correct outcome → idempotent
success; divergent outcome → `outcome.mismatch.instance` denied with the
existing publication untouched; a later second outcome record →
`outcome.multiple` denied — never silently preferring publication or
outcome). ADR-012 §8 supersession behavior clarified in S1 (EXE-013 graph
exemption) is preserved unchanged: later supersession records are not
forced to equal the original attempt outcome association beyond the
committed EXE-013 scope, and the S1 supersession suites remain green
untouched.

## 17. Crash / no-recovery semantics (§14)

Preserved exactly: attempt exists + no outcome → `terminal-unverifiable`
(valid lifecycle state; no inference); outcome exists + no publication →
valid `terminal-unpublished` publication dimension; process loss before
first publication → no automatic completion rerun, no automatic publication
rerun, no scheduler/resume protocol. S3 adds no background or restart
protocol (static-guard: no timer/scheduler primitives, no resume
vocabulary).

## 18. Failure mappings (§15)

| Failure | Category / code |
|---|---|
| Trusted input/correlation invalid (attempt/outcome/observation/enforcement/handoff/validation/registry/store/identity/capability shape, unknown key) | `OUTCOME-INPUT-INVALID` `input.*` |
| Outcome lock contention surfaced by the committed coordinator | `OUTCOME-LOCK-CONFLICT` `lock.conflict` |
| Multiple durable outcome records | `OUTCOME-CONFLICT` `conflict.multiple-outcomes` |
| Existing outcome material divergence | `OUTCOME-CONFLICT` `conflict.material-divergence` |
| Malformed/corrupt existing outcome state / attempt re-read divergence | `OUTCOME-CONFLICT` `state.outcome-corrupt` / `state.attempt-diverged` / `state.outcome-*` |
| Identity/time source failure in the no-existing branch | `OUTCOME-IDENTITY-FAILURE` `identity.*` |
| S2 permit/publication failure (S2 authority failures pass through distinctly) | `OUTCOME-CAPABILITY-DENIED` / `OUTCOME-WRITE-FAILED` / `OUTCOME-INPUT-INVALID` / `OUTCOME-INTERNAL-FAILURE` (S2 codes preserved) |
| Missing outcome at WP-13C publication | `PUBLICATION-OUTCOME-REJECTED` `outcome.missing` |
| Omitted outcome-precondition context (legacy caller) | `PUBLICATION-OUTCOME-REJECTED` `outcome.context-missing` |
| Forged / non-genuine outcome-precondition context | `PUBLICATION-OUTCOME-REJECTED` `outcome.context-not-genuine` |
| Corrupt/unreadable outcome-domain entry (wrong class marker, schema-invalid, unreadable) | `PUBLICATION-OUTCOME-REJECTED` `outcome.invalid` / `outcome.state-unverifiable` |
| Non-published S2/WP-8 storage outcome in the no-existing branch (idempotent-duplicate / duplicate / conflict-revision / future states) | `OUTCOME-WRITE-FAILED` `write.not-published` |
| Outcome result association missing / invalid / multiple | `PUBLICATION-OUTCOME-REJECTED` `outcome.association-missing` / `outcome.invalid` / `outcome.multiple` |
| Outcome/publication association mismatch | `PUBLICATION-OUTCOME-REJECTED` `outcome.mismatch.*` |
| ValidationRecord mismatch/invalidity | `PUBLICATION-LIFECYCLE-REJECTED` `lifecycle.validation-record-*` (committed codes) |

`terminal-unverifiable` is never reinterpreted as lifecycle corruption
(EXE-012; the lifecycle graph emits no finding for it — S1 semantics
unchanged).

## 19. Focused concurrency / adversarial evidence

| Suite | Result |
|---|---|
| S3 outcome-production tests (37: new outcome ×2, enforcement variants, allocation timing ×2, real S2→WP-8 audit path, trusted publication composition, exact replay ×2, divergence ×5, cardinality ×2, corrupt/stale state ×3, storage-result mapping ×2, correlation rejections ×9, Model-1 lock ×5, same-key ×1, different-attempt ×1) | **37/37 pass** |
| S3 WP-13C precondition tests (22: allowed ×1, no/multiple/invalid/association-missing ×4, mismatch instance/digest/mode/validation ×4, key-dimension denials ×1, ValidationRecord absent/wrong ×2, replay idempotent/divergent/multiple ×3, context omission ×2, context forgery ×1, corrupt candidates ×4) | **22/22 pass** |
| S3 static guards (7: fs/timer/crypto confinement; S2-only write surface; identity/time invocation ownership incl. bracket-call spellings; shared pinned key across src/**; capability-module import ownership; publication-surface confinement; no WP-13D/WP-15/recovery vocabulary) | **7/7 pass** |
| S2 authority + S2 static guards + WP-13C publication (updated to the mandatory-precondition world: 19 tests incl. the legacy-durable-publication conflict path) + WP-13C static guards | **45/45 pass** |
| Full unit regression (`dist-test/tests/unit/*.test.js` incl. storage, WP-12, WP-13A/B/C) | **655/657 pass** — the 2 failures are the superseded untracked WP-13D E2E tests (see §23) |
| Integration + trusted + runtime + security (incl. full conformance 628/628) | **716/716 pass** |
| Storage unit + mcp + writing + drafting + pointofuse-v2 | **811 pass / 0 fail** (2 pre-existing chown skips) |
| WP-7 discovery guard | OK (source↔compiled) |
| Both TypeScript typechecks | clean |
| `git diff --check` | clean |

Pi-adapter battery not re-run (no Pi/shared adapter path modified).

## 20. S1/S2 no-drift (§21)

S1 static counts unchanged and re-verified by the passing suites: schemas
52, lifecycle types 15, taxonomy 19, rules 120, RULE matrix 236/118,
manifest 628, corpus 391. No schema/rule/fixture/corpus file modified; no
S1 regeneration performed. S2 authority behavior unchanged: one-class sink,
exact permit, independent generation registry, WP-12 isolation (eight-class
allowlist untouched; `execution-outcome-record` appears nowhere in the
WP-12 boundary). The only tracked modifications are the mandated WP-13C
strengthening (publish/types), the shared key refactor inside
`publication/publish.ts`, and the extended S2 mint-site guard.

## 21. Superseded WP-13D isolation (§22)

`src/retrospective/**`, `tests/unit/wp13d-retrospective.test.ts`,
`tests/unit/wp13d-static-guard.test.ts`, and
`docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`
remain untracked and unmodified (byte-identical). No
`ExecutionRetrospectiveFacts` re-source, no 21-field cold derivation, no
total-process-loss restart derivation, no publication null/[] derivation,
no terminal-unverifiable fact suppression, no WP-15 handoff, no receipt
logic. No publication security exception was added to keep the legacy paths
working. The superseded pre-durability closure path no longer possesses
sufficient publication precondition authority: its old runtime assertions
now fail by design (see §23).

## 22. Final Git state

Branch `main`; HEAD `5560125f33e92170c18b14060215e089373d565f` (unchanged).
Working tree: 4 modified tracked files (WP-13C strengthening incl. the
mandatory branded precondition context, the S2 mint-site guard extension,
and the WP-13C suite update to the mandatory-precondition world), 14 new
untracked S3 paths (2 internal modules incl. the branded precondition
context, 5 outcome-production modules, 1 shared test harness, 3 S3 test
suites, 3 report/harness-adjacent files as listed), plus the 4 pre-existing
untracked superseded WP-13D paths (unmodified). Nothing staged; no
push/tag/release/deploy. S4/S5 not begun; WP-14/WP-15 remain blocked.

---

## 23. Focused correction — SIR-WP13-DUR-S3-001…004

### 23.1 SIR-WP13-DUR-S3-001 — WP-13C outcome precondition is fail-closed and genuine (CRITICAL)

**Previous default-allow behavior:** the precondition context was optional
at runtime — `if (outcome === undefined) return ok` — so a legacy caller
omitting the context could publish/replay without any outcome consistency.

**Exact correction:**

* `publishValidatedResult` now requires the outcome-precondition context:
  omission → `PUBLICATION-OUTCOME-REJECTED` `outcome.context-missing`;
  a structurally-compatible forged context → `outcome.context-not-genuine`.
  Both are typed denials with ZERO publication write; there is no
  legacy/default-allow branch. The TypeScript property remains optional
  solely for source compatibility (the uneditable superseded closure);
  runtime omission deterministically fails closed.
* **Genuine context ownership:** `src/internal/publication-outcome-context.ts`
  holds a module-private WeakSet brand; `createPublicationOutcomePrecondition`
  (the factory) is consumed ONLY by the trusted S3 host composition and is
  never exported from any barrel. `publishValidatedResult` verifies the
  brand before touching the store — an arbitrary caller cannot fabricate
  the outcome view WP-13C reads (proven by the forgery test: a fake store
  returning a fabricated matching outcome is rejected before any read).
* **Production composition:** `createExecutionOutcomeAuthority` now also
  builds the real WP-13C publication boundary, mints the result-publication
  capability, and injects the genuine branded context through its
  `publishResult` entry — every production-capable WP-13C call receives the
  genuine context structurally; nothing relies on documentation.
* **Omission/forgery evidence (focused tests):** omitted context on a fresh
  publication → denied, zero records; omitted context on REPLAY → denied
  (an existing durable publication cannot be replayed by a legacy caller);
  forged context → `outcome.context-not-genuine`, zero durable writes;
  the trusted composition with the genuine S2 boundary → publication
  succeeds; exact replay → idempotent success only after the durable
  outcome precondition is rechecked (a later second outcome record denies
  the replay); a legacy-shape direct caller cannot publish by omitting the
  context.
* **Legacy WP-13D disposition:** the superseded untracked closure path
  (`src/retrospective/**`, old wp13d tests) is NOT edited and gets NO
  compatibility bypass. Its old runtime assertions now fail because the
  superseded path no longer possesses sufficient publication precondition
  authority: exactly two superseded E2E tests fail (see §24) and are
  recorded as superseded/non-authoritative. Production correctness takes
  precedence.

### 23.2 SIR-WP13-DUR-S3-002 — non-published WP-8 states cannot become S3 success (MAJOR)

**Exact accepted S2 storage result set** (`OutcomePublicationResult`):
`ok:true` with `published` | `idempotent-duplicate` | `duplicate` |
`conflict-revision`; `ok:false` with the four S2 categories (the S2 boundary
maps WP-8 `failed`/`temp-exists-retry` to `OUTCOME-WRITE-FAILED`
`write.publish-failed`).

**New fail-closed mapping (no-existing branch):** success is returned ONLY
when S2/WP-8 confirms the new record was actually `published`. Every other
`ok:true` outcome (`idempotent-duplicate`, `duplicate`, `conflict-revision`
— and any future non-published state) maps to a typed `OUTCOME-WRITE-FAILED`
`write.not-published`; `ok:false` S2 results pass through with their S2
category/code. A storage duplicate is NEVER reinterpreted as semantic
replay — the replay decision already occurred under the attempt lock; a
later explicit invocation performs a fresh under-lock decision.

**Proof no fresh undurable identity can be returned as success:** the
freshly allocated record/evidence identities are returned ONLY on the
`published` branch; every non-published outcome returns a failure result
that carries no success outcome and no identities (test asserts
`'outcome' in result === false` across the full injected result set).

### 23.3 SIR-WP13-DUR-S3-003 — corrupt outcome candidates cannot disappear (MINOR)

Every entry discovered through the `execution-outcome-record` storage
domain is now checked before candidate filtering: unreadable →
`outcome.state-unverifiable`; non-object payload or wrong `record_type`
(class/path inconsistent) → `outcome.invalid`; schema-invalid (committed
lifecycle gate) → `outcome.invalid`. Corrupt entries are NEVER silently
skipped. One valid + one corrupt outcome therefore never collapses into one
clean valid outcome for publication purposes. Adversarial tests cover:
wrong class marker, malformed payload, unreadable candidate, and one valid
+ one corrupt candidate (both a wrong-class-marker and a schema-invalid
second record) — all deny publication/replay with zero writes.

### 23.4 SIR-WP13-DUR-S3-004 — strengthened static ownership guards (MINOR)

No new analysis framework; the weakest single-symbol checks were replaced
with module/path ownership checks:

* **Capability mint:** a source scan across ALL of `src/**` asserts the
  outcome capability MODULE is imported ONLY by `capability.ts`
  (definition), `produce.ts` (genuineness check), `new-outcome.ts`
  (exact-record permit mint), and `compose.ts` (the single mint site) —
  alias imports, renamed imports, re-exports, and direct relative imports
  from any other production module are rejected. The mint primitive itself
  remains confined to `compose.ts`.
* **Shared attempt key:** `attemptCoordinationKey` is referenced in exactly
  three production files (the helper, `produce.ts`, `publication/publish.ts`);
  no second private helper and no direct `.join('|')` reconstruction exists
  in either domain.
* **Identity/time allocation:** only `new-outcome.ts` may INVOKE the
  outcome identity/time interface — the guard catches both `name(`
  dot-call and `name'](` bracket-call spellings (plus optional-bracket
  forms) in every other family file.
* **Publication surface:** the result-publication surface (boundary
  factory, capability mint, `publishValidatedResult`) is confined to
  `compose.ts` (runtime) and `types.ts` (type-only vocabulary); the family
  barrel exports none of it and never imports the precondition-context
  factory (only `compose.ts` does).

These guards are regression tripwires; the branded runtime checks
(capability brand, precondition-context brand, permit brand) remain the
real authority defense.

### 23.5 Correction verification

| Suite | Result |
|---|---|
| Omission-bypass tests (fresh + replay + legacy shape) | **3/3 pass** |
| Forged-outcome-context test | **1/1 pass** |
| Genuine production publication composition test | **1/1 pass** |
| Publication replay precondition test (recheck on replay) | **1/1 pass** |
| Corrupt-candidate fail-closed tests (4 vectors) | **4/4 pass** |
| S2 storage-result mapping tests (published + 6 non-published states) | **7/7 pass** |
| S3 outcome production/replay/allocation tests | **37/37 pass** |
| Model-1 lock tests | **5/5 pass** |
| S3 static guards (7) | **7/7 pass** |
| S2 authority + S2 static guards | **22/22 pass** |
| WP-13C publication suites (updated; 19 tests incl. the legacy-durable-publication conflict path) + WP-13C static guards | **26/26 pass** |
| Relevant WP-8/WP-12 suites (within full unit + storage globs) | green |
| Both TypeScript typechecks | clean |
| `git diff --check` | clean |

### 23.6 Superseded WP-13D assertion disposition

Exactly two superseded untracked E2E tests now fail — both because the
superseded pre-durability closure path no longer possesses sufficient
publication precondition authority (its `publishValidatedResult` invocation
omits the genuine context and is denied before any write):

* `WP-13D E2E: real A→B→C→D completed+published closure derives complete
  facts from committed state` — asserts `closure.stages.publication.ok ===
true`; the stage is now a typed denial (`PUBLICATION-OUTCOME-REJECTED`
`outcome.context-missing`);
* `WP-13D E2E: adversarial cross-stage correlation mismatch fails closed
  (tampered handoff)` — its closure run no longer produces a durable
  publication record, so the follow-on committed-state reads crash on the
  null publication reference.

The other 13 superseded WP-13D tests (pure derivation + no-publication
E2Es) still pass. These two are recorded as superseded/non-authoritative;
no compatibility bypass was added. This is the accepted cost of the
mandatory precondition.

### 23.7 Preserved S3 invariants (no drift)

Shared exact coordination key, Model-1 non-nested locking, under-lock
attempt/outcome reread, observation canonical digest binding, WP-5B
enforcement correlation, trusted result handoff correlation, replay
material definition, cardinality 0/1/>1, no-existing-only allocation
timing, single production outcome capability mint, no recovery/scheduler,
ADR-012 §8 supersession behavior, and S1/S2 boundaries — all unchanged and
re-verified by the suites above. S1 static counts remain: schemas 52,
lifecycle types 15, taxonomy 19, rules 120, RULE matrix 236/118, manifest
628, corpus 391; WP-12 eight-class allowlist and the S2 one-class
exact-permit sink untouched; no schema/rule/fixture regeneration.

## 24. Acceptance metadata (baseline commit gate)

| Item | Status |
|---|---|
| Initial review findings | SIR-WP13-DUR-S3-001 (CRITICAL), 002 (MAJOR), 003 (MINOR), 004 (MINOR) — raised |
| Corrections | implemented; focused correction suites 125/125 |
| Focused rereview | **ACCEPTED** — SIR-WP13-DUR-S3-001…004 **all CLOSED** |
| RR-001 | `SIR-WP13-DUR-S3-RR-001` (MINOR, guard tripwire note) retained as **accepted non-blocking** |
| S3 | **ACCEPTED** — this baseline commit |
| S4 | **NOT STARTED / NOT AUTHORIZED** (retrospective simplification amendment NOT applied) |
| WP-13 | **NOT CLOSED** |
| WP-14 / WP-15 | **blocked** |
| Superseded WP-13D | remains untracked/uncommitted, byte-untouched, outside this baseline |

No implementation change beyond the accepted rereview delta; this section
records acceptance/status metadata only.

---

**WP-13 DURABILITY S3 ACCEPTED — BASELINE COMMITTED**
