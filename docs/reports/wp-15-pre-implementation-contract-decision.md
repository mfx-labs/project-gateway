# WP-15 Pre-Implementation Contract Decision — Security Hardening, Release, and Operational Readiness + TrustedReceipt

**Work package:** WP-15 (security hardening, release, and operational
readiness; normative owner of TrustedReceipt issuance — F-08).
**Phase:** contract decision + focused contract correction
(documentation only; no implementation authorized by this document alone
— implementation is authorized by the human-approved **WP-15
Architecture + Execution Authorization Envelope** as amended by
**Architecture Amendment A1**).
**Status:** **WP-15 CONTRACT ACCEPTED / BASELINED. Architecture Amendment
A1: ACCEPTED / NORMATIVE / BASELINED.**
**Baseline:** HEAD `6b2e37e0ffaf42f0c40f2de997d1ff1187f4559a` (branch
`main`; `feat: close WP-14C proposal loading`). WP-15 is
prerequisite-satisfied (WP-13, WP-14, WP-14C all CLOSED; ADR-023 as
amended by ADR-040 pins the tail `WP-14 → WP-14C → WP-15`).
**Authoritative predecessors:** `post-wp5a-roadmap.md` (row 12, WP-15
attribute block, ownership matrix), ADR-011, ADR-012, ADR-023, ADR-040,
ADR-038, lifecycle protocol (`trusted-lifecycle-protocol.md`),
`schemas/lifecycle/1.0/records/trusted-receipt.json`, EXE-008/EXE-012/
PUB-005, WP-13 durability S1–S4 + retrospective simplification
amendment, WP-13C publication authority, WP-8 exact-record publication
primitives.

## Approved Architecture + Execution Authorization Envelope

Four human-approved decisions are normative for this contract:

### Approved Decision 1 — separate receipt and publication-correlation authority domains

WP-15 owns TWO narrowly separated authority domains:

**A. `trusted-receipt-producer`** MAY: fresh-read/rederive trusted
execution facts; verify TrustedReceipt issuance preconditions; publish
exactly `TrustedReceipt`; perform exact replay/conflict checks; emit
required authorized-write audit evidence. MUST NOT: create/update/
supersede `ResultPublicationRecord`; create `SupersessionRecord`; create
`ExecutionResult`; modify result/evaluator provenance; gain generic
lifecycle-write authority.

**B. `receipt-publication-correlation-producer`** operates ONLY after a
matching TrustedReceipt exists and has been freshly verified. MAY: read
the exact existing `ResultPublicationRecord`; create one exact immutable
successor `ResultPublicationRecord`; add the verified receipt
correlation; expose only protocol-permitted receipt-gated privileged
scopes; create the exact `SupersessionRecord` linking old publication →
successor publication. MUST NOT: create or modify `ExecutionResult`;
change result/evaluator provenance; issue TrustedReceipt; alter
unrelated publication facts; revoke/delete historical publication; gain
generic lifecycle-write authority.

No "newest wins". No timestamp or enumeration-order winner. The domains
may exist within one WP-15 package but MUST use distinct
capabilities/permits/provenance.

### Approved Decision 2 — denied activation receipt schema

Correct TrustedReceipt schema semantics so that when
`event_type = activation-decision` AND `disposition = denied`:
`occurrence_id` is NOT required; `attempt_id` is NOT required; neither
may be fabricated solely to satisfy schema shape. The receipt remains
bound to the exact activation-decision event record, workspace, registry
snapshot, disposition, and responsible producer/provenance. Other event
branches retain their existing occurrence/attempt requirements unless
the committed protocol itself proves an equivalent contradiction. Scope
the correction narrowly to docs/schema/fixtures/semantic expectations
required for protocol consistency.

Architecture Amendment A1 pins the exact representation: for
`activation-decision` + `denied`, `occurrence_id` and `attempt_id` MUST
be ABSENT; `null`, empty string, and fabricated IDs are invalid (§4).

### Approved Decision 3 — F-R1

F-R1 (uncollapsed registration-visibility hardening) remains
OPTIONAL / NONBLOCKING. It is NOT part of the WP-15 closure gate. Do not
implement it unless separately required by a concrete blocking finding.

### Approved Decision 4 — release boundary

WP-15 closure means **RELEASE READY**, not externally
published/deployed. WP-15 MAY establish release packaging, runbooks,
supported-lane evidence, full authoritative regression, security audit,
and a release-readiness report. WP-15 MUST NOT under this envelope:
push; create/push release tags; create GitHub Release; publish
npm/package-registry artifacts; install; deploy. Those require separate
human release authorization. Authoritative release verification MUST be
established on the supported **Pi 0.83.0** lane; support MUST NOT be
silently broadened to Pi 0.84.1.

## Architecture Amendment A1 (Human-Approved / Accepted / Baselined) — Focused Contract Correction

A1 is human-approved, accepted, baselined, and normatively binding on
this contract and on future WP-15 implementation:

1. **EXE-008 becomes event-type-aware.** `event_record_id` resolves to
   the exact trusted source class defined for the receipt event type
   rather than universally requiring `ExecutionAttemptRecord`.
2. **EXE-012 remains fail-closed.** Any attempt-correlated
   `TrustedReceipt` attesting retrospective attempt facts requires an
   exact matching trustworthy `ExecutionOutcomeRecord`. No trustworthy
   outcome → `terminal-unverifiable` → receipt-ineligible.
3. **Every retrospective-complete terminal attempt must have exactly one
   trustworthy `ExecutionOutcomeRecord`, including legitimate result-less
   terminal attempts.** `result_association` remains optional. Never
   fabricate a result.
4. **Attempt-related receipts remain retrospective.** They may attest
   earlier attempt-start/enforcement/cancellation/timeout/crash events
   only after durable trusted state is sufficient to prove them. No
   realtime receipt authority and no prospective execution authority.
5. **TrustedReceipt disposition vocabulary is extended only as narrowly
   necessary** to preserve exact committed outcome semantics:
   `incomplete` and `rejected` are added. Neither may be lossy-mapped to
   `failed` or `denied`.
6. **Future implementation may make the minimum necessary
   normative/runtime changes** to: EXE-008/EXE-012 rule text; lifecycle
   graph verifier; TrustedReceipt schema; semantic/conformance
   fixtures/vectors; focused tests; and the committed
   `trusted-execution-outcome-recorder` production eligibility for
   result-less terminal attempts (§6.3). No new authority domain and no
   generic lifecycle-write capability.
7. **activation-decision + denied:** `occurrence_id` MUST be absent;
   `attempt_id` MUST be absent; `null` is invalid; fabricated IDs are
   invalid.
8. **receipt-publication-correlation-producer:** retains existing
   schema-const output roles; uses a distinct WP-15
   capability/permit/provenance domain; MUST NOT reuse the WP-13C
   publication capability; no role-vocabulary/schema-role change.
9. **Superseded untracked WP-13D debris remains untouched.** Authoritative
   regression and "no second derivation engine" evidence are evaluated on
   a clean clone / committed product tree, excluding untracked debris by
   construction.
10. **Release regression explicitly includes** `dist-test/tests/process/*`,
    pointofuse-v2, and the WP-14C loading suite in addition to all
    previously pinned authoritative surfaces.

## 1. WP-15 Ownership (pinned)

- **Objective:** trusted receipt issuance; receipt/publication
  correlation needed for committed privileged consumption; hardening
  review; operational/release readiness; final security/release gate.
- **Inputs:** all prior closed packages; WP-13 durable execution state
  and retrospective facts.
- **Outputs:** `TrustedReceipt`; receipt-correlated successor
  publication where justified; `SupersessionRecord` for the publication
  transition; release-readiness evidence.
- **Owned:** hardening, operations, release, trusted receipt issuance
  (F-08), receipt/publication correlation (Approved Decision 1).
- **Prohibited:** self-issuing receipts from execution code; widening
  any prior package boundary.
- **Non-goals:** execution; prospective authority; artifact approval;
  RuntimeGrant creation; activation; retry authorization; release
  publication/deployment.

## 2. Shared Retrospective Derivation — Mandatory Reuse

Exactly one derivation path:

```text
fresh durable trusted state
→ durable-state resolver (src/retrospective-derivation/resolver.ts)
→ deriveExecutionRetrospectiveFacts(...) (src/retrospective-derivation/facts.ts)
→ receipt precondition verification
→ receipt issuance
```

WP-15 MUST reuse the committed WP-13 shared pure retrospective
derivation. FORBIDDEN: a second WP-15 retrospective derivation engine;
trusting caller-supplied retrospective facts; trusting the
project-visible `ExecutionResult`; trusting timestamps/enumeration order
as truth. Cold restart over the same durable state must derive
structurally equivalent facts (semantic equality, `deepStrictEqual`);
no fact-set byte identity is required (retrospective simplification
amendment §3/§7; WP-13 contract §5.6: reuse "without stamping it").

## 3. TrustedReceipt Event Model (event-type-aware; A1)

Committed event vocabulary (`trusted-receipt.json` `event_type`): all
existing values retained — `activation-decision`, `occurrence-start`,
`attempt-start`, `attempt-end`, `enforcement-denial`, `cancellation`,
`timeout`, `crash`, `result-publication-correlation`. Disposition
vocabulary: the committed values `accepted`, `denied`, `started`,
`completed`, `failed`, `cancelled`, `timed-out`, `crashed` are retained,
and the A1-approved narrow schema extension adds `incomplete` and
`rejected` so exact committed outcome semantics are never lossy-mapped
(`incomplete` MUST NOT map to `failed`; `rejected` MUST NOT map to
`denied`).

### 3.1 Two separate checks (A1)

- **Event-source validity:** does `event_record_id` resolve to the exact
  trusted source class defined for the receipt event type (§3.2)? The
  verifier MUST be event-type-aware and MUST reject source-class
  mismatch. `event_record_id` is NOT silently reinterpreted as always an
  attempt record.
- **Retrospective eligibility:** independent of source-class validity,
  are sufficient trustworthy durable facts present to issue a trusted
  retrospective receipt (outcome coverage and context bindings; §5)?

### 3.2 Normative event-source matrix (A1)

| event_type | Source class (event_record_id) | occurrence | attempt | disposition mapping |
|---|---|---|---|---|
| activation-decision | `ActivationRecord` (exact) | accepted: exact occurrence created by the acceptance (reserved occurrence ID); denied: ABSENT | accepted: not applicable — activation acceptance precedes attempt creation; never invent an attempt (`null` per retained schema convention); denied: ABSENT | accepted → `accepted`; denied → `denied` |
| occurrence-start | `ExecutionOccurrenceRecord` (exact) | exact | not applicable (`null`) | `started` |
| attempt-start | `ExecutionAttemptRecord` (exact) | exact | exact | `started` |
| attempt-end | `ExecutionAttemptRecord` (exact) + exact matching `ExecutionOutcomeRecord` REQUIRED before issuance | exact | exact | outcome disposition recovered one-to-one from the outcome record: `completed`/`failed`/`cancelled`/`timed-out`/`crashed`/`incomplete`/`rejected` |
| enforcement-denial | `ExecutionAttemptRecord` (exact) — pinned: no separate enforcement-denial record class exists; the event is durably proven by the exact attempt record + the exact matching `ExecutionOutcomeRecord` (disposition `rejected`, committed enforcement evidence references present) | exact | exact | `denied` |
| cancellation | two pinned branches: occurrence-level — `ExecutionOccurrenceRecord` (exact; cancelled occurrence before any attempt, protocol §186); attempt-level — `ExecutionAttemptRecord` (exact) + exact matching `ExecutionOutcomeRecord` REQUIRED | exact where applicable (occurrence-level: exact occurrence) | exact where applicable (occurrence-level: not applicable (`null`)) | `cancelled` |
| timeout | `ExecutionAttemptRecord` (exact) + exact matching `ExecutionOutcomeRecord` REQUIRED | exact | exact | `timed-out` |
| crash | `ExecutionAttemptRecord` (exact) + exact matching `ExecutionOutcomeRecord` REQUIRED | exact | exact | `crashed` |
| result-publication-correlation | `ResultPublicationRecord` (exact) with exact result/outcome/attempt/occurrence bindings and a matching verified `TrustedReceipt` | exact | exact | `completed` |

### 3.3 Pinned bindings and outcome coverage (all branches)

`event_record_id` exact; `workspace_id` exact (must equal the source
record's workspace); `occurrence_id`/`attempt_id` exact where applicable
(§3.2), `null` only where a branch pins "not applicable", ABSENT only
for denied activation (§4); bundle/reference correlation via the
committed exact-reference machinery (`bundleReferencesEqual` /
`exactReferencesEqual`) where the source record carries a bundle;
`registry_snapshot_reference` required on every receipt (committed
`registryReferenceFor` binding); `responsible_role =
trusted-receipt-producer`.

Outcome-coverage summary (A1): every attempt-correlated retrospective
receipt (attempt-start, attempt-end, enforcement-denial, attempt-level
cancellation, timeout, crash) requires the exact matching trustworthy
`ExecutionOutcomeRecord`; no outcome → no attempt-correlated
retrospective receipt (EXE-012 fail-closed). Attempt-related receipts
are retrospective only — they may attest earlier
attempt-start/enforcement/cancellation/timeout/crash events only after
durable trusted state is sufficient to prove them; there is NO realtime
receipt authority and NO prospective execution authority.

## 4. Denied-Activation Conditional Schema (Approved Decision 2 + A1)

Exact conditional rule for `event_type = activation-decision` AND
`disposition = denied`:

- `event_record_id` REQUIRED (exact `ActivationRecord` with
  `decision = denied`);
- `workspace_id` REQUIRED;
- `registry_snapshot_reference` REQUIRED;
- `occurrence_id` MUST BE ABSENT;
- `attempt_id` MUST BE ABSENT.

NOT permitted in the denied branch: `null`; empty string; any
real-looking or fabricated opaque ID; any placeholder. A denial creates
no occurrence and no attempt (lifecycle protocol §176); the receipt
remains bound to the exact activation-decision event record, workspace,
registry snapshot, disposition, and responsible producer/provenance.

All other event branches retain their existing occurrence/attempt
requirements, and the committed `null` inapplicability convention is NOT
broadened (e.g., accepted activation and occurrence-start receipts keep
present-`null` "not applicable" fields).

Fixture/conformance expectations (A1):

- PASS: denied-activation receipt with both `occurrence_id` and
  `attempt_id` absent;
- FAIL: `occurrence_id: null`; `attempt_id: null`; either field
  carrying a real-looking or fabricated ID; non-denied branch missing
  required occurrence/attempt context where applicable.

Contract includes the minimum corresponding
schema/semantic/fixture/conformance corrections for these expectations.

## 5. Receipt Issuance Eligibility (fresh trust checks; A1)

Immediately before issuing each receipt, under its event-level lock, the
`trusted-receipt-producer` independently re-verifies all relevant durable
facts in two separate checks:

**Event-source validity (A1).** The exact event record exists and its
record class equals the source class defined for the receipt
`event_type` (§3.2); source-class mismatch fails closed. The verifier
MUST be event-type-aware; `event_record_id` is never silently
reinterpreted as an attempt record.

**Retrospective eligibility (A1).** Sufficient trustworthy durable facts
exist for a trusted retrospective receipt:

- occurrence/attempt correlation is exact where applicable (EXE-008:
  attempt receipts require a valid accepted-activation occurrence
  context);
- workspace is exact;
- ExecutionBundle/reference bindings are exact where applicable
  (`bundleReferencesEqual` / `exactReferencesEqual`);
- registry snapshot/reference is current/valid as required;
- relevant issuance/grant/revocation state is rechecked (protocol §19:
  point-of-use checks verify current exact trusted state before
  issuance);
- exact matching `ExecutionOutcomeRecord` REQUIRED for every
  attempt-correlated retrospective receipt (attempt-start, attempt-end,
  enforcement-denial, attempt-level cancellation, timeout, crash);
  EXE-012 fail-closed: no trustworthy outcome → `terminal-unverifiable`
  → receipt-ineligible → no issuance;
- occurrence-level receipts (activation-decision, occurrence-start,
  occurrence-level cancellation) carry no attempt correlation and
  require no outcome coverage;
- result-publication-correlation additionally requires the exact valid
  `ResultPublicationRecord` with exact result/outcome/attempt/occurrence
  bindings and a matching verified `TrustedReceipt`;
- conflicting durable associations fail closed (resolver cardinality:
  >1 outcome or >1 publication → no issuance);
- no receipt from guessed, incomplete, stale, or project-visible facts.

EXE-008 consistency (A1): every retrospective-complete attempt must have
its trusted receipt facts; the attempt-side receipt-facts requirement is
eligibility-conditioned — `terminal-unverifiable` attempts are the
fail-closed exception and are receipt-ineligible, never a receipt
obligation. EXE-012 consistency: no attempt-correlated retrospective
receipt without an exact matching trustworthy `ExecutionOutcomeRecord`.

## 6. Terminal-State Receipt Matrix (normative; A1)

### 6.1 Retrospective-complete classifier (A1)

- A terminal attempt is `retrospective-complete` iff the trusted durable
  state contains exactly one valid `ExecutionOutcomeRecord` for that
  exact attempt/bundle/workspace/occurrence context.
- A terminal attempt is `terminal-unverifiable` iff the lifecycle attempt
  is terminal or otherwise no longer progressing but no trustworthy exact
  `ExecutionOutcomeRecord` exists.
- Retrospective completeness is NEVER inferred from: a missing result;
  timestamps; process exit alone; enumeration order; the project-visible
  `ExecutionResult`.

### 6.2 Result-less terminal attempts (A1)

A legitimate result-less terminal attempt is retrospective-complete ONLY
when an `ExecutionOutcomeRecord` exists and its `result_association` is
absent/null according to committed schema semantics. **result-less ≠
outcome-less.** No `ExecutionOutcomeRecord` means `terminal-unverifiable`
— never "legitimate result-less". Result/publication facts are never
fabricated (protocol §190).

### 6.3 Durable outcome requirement (A1)

This contract authorizes the future WP-15 implementation correction
(minimum necessary; no new authority domain; no generic lifecycle-write
capability) so that every retrospectively trustworthy terminal attempt —
including legitimate result-less terminal attempts — receives exactly one
trustworthy `ExecutionOutcomeRecord` within the committed
`trusted-execution-outcome-recorder` domain, preserving: exact attempt
binding; exact occurrence/workspace/bundle binding; optional
`result_association`; no fabricated result; idempotent replay/conflict
behavior; the existing immutable durable-record model. This is NOT
generic execution-state mutation.

### 6.4 Receipt matrix

| Durable state | Receipt behavior |
|---|---|
| Completed attempt + valid published result | attempt-end receipt (outcome-covered) and result-publication-correlation receipt (correlation producer) |
| Retrospective-complete + result association present + publication missing (`terminal-unpublished`) | true attempt-fact receipts (outcome-covered); NO result-publication-correlation receipt; privileged consumption remains blocked (PUB-005) |
| Legitimate result-less terminal attempt (outcome record exists; `result_association` absent/null) | outcome-covered attempt-fact receipts only; result/publication facts never fabricated |
| Terminal-unverifiable (no trustworthy outcome record) | NO attempt-correlated receipt (EXE-012; valid lifecycle state; receipt-ineligible) |
| Incomplete/crashed durability state lacking trustworthy required facts | fail closed; no inference, no fabrication |
| Conflicting outcome/result/publication association | fail closed; no issuance |
| Denied activation with no occurrence/attempt | `activation-decision`/`denied` receipt; occurrence/attempt ABSENT (A1; §4) |
| Missing enforcement evidence | committed facts only; enforcement facts never invented |

## 7. Receipt Identity / Cardinality / Replay

- **Subject:** receipt subject = exact event record (`event_record_id` +
  `event_type` + `disposition` + bindings).
- **Cardinality:** multiple receipts per attempt may exist for distinct
  events (attempt-start + attempt-end + enforcement-denial + …);
  EXE-008 requires at least one attempt-correlated receipt for every
  retrospective-complete attempt (`terminal-unverifiable` attempts are
  the fail-closed exception; §5/§6).
- **Identity:** receipt record IDs remain opaque, non-content-derived
  `pgw:l:` per committed lifecycle identity policy (no deterministic
  "latest" receipt; no overwrite).
- **Under the event-level lock:**
  - **Exact replay:** an already-issued receipt materially identical for
    the same event/bindings/disposition/context → idempotent success, no
    second record published (ADR-038 SCR-WP13-003 pattern: read-verify
    before publish).
  - **Conflict:** an existing receipt for the same intended event subject
    with material divergence (different disposition, bindings, digest,
    registry context) → fail closed, no write.
- Distinct legitimate receipt events are distinguished by the exact
  event-record identity + event type; never by timestamps or enumeration
  order.

## 8. `trusted-receipt-producer` Authority Domain

Smallest pattern consistent with committed trusted authority domains
(ADR-038 / WP-13C / WP-12 store boundary):

- responsible role: `trusted-receipt-producer` (schema const);
- module-private branded capability/provenance (WeakSet brand;
  domain-separated provenance identity domain; generation-bound
  CAP-008…CAP-016 discipline; minted only by the trusted host
  composition);
- exact single-record-class write allowlist: `TrustedReceipt`;
- exact read allowlist for fresh under-lock verification:
  `trusted-receipt`, `execution-attempt-record`,
  `execution-occurrence-record`, `execution-outcome-record`,
  `activation-record`, `runtime-grant`, `revocation-record`,
  `validation-record`, `result-publication-record` (extends the WP-13C
  read allowlist with `execution-outcome-record` and `trusted-receipt`);
- event-level coordination lock (WP-12 §15 / ADR-038 pattern) keyed on
  the exact event-record identity;
- under-lock reread of all relevant durable state;
- exact replay/conflict decision (section 7);
- `publishRecord`-backed durability through a single-class store
  boundary (envelope model per RFM-001);
- required authorized-write audit evidence (D-6 mechanical audit at the
  operation durability point);
- `registryReferenceFor` registry-reference binding.

No generic record-store mutation API.

## 9. Receipt / Publication Separation

Pinned: `ExecutionResult ≠ ResultPublicationRecord ≠ TrustedReceipt`.
Receipt issuance MUST NOT mutate or replace either of the other two.
WP-13 ordinary-review publication remains historical and immutable.
Privileged receipt-gated consumption is enabled only through the
separately authorized correlation producer (Approved Decision 1.B).

## 10. `receipt-publication-correlation-producer` Authority Domain

Preconditions (all re-verified fresh under its lock):

- a matching `TrustedReceipt` durably exists and is freshly reverified
  (exact event/bindings/disposition/context);
- the exact existing `ResultPublicationRecord` exists;
- exact result/evaluator/validation provenance remains valid
  (PUB-003/PUB-004/RES-007 checks);
- the publication is eligible for receipt-gated successor formation
  (ordinary-review predecessor; no already-conflicting successor/
  supersession).

Output (exactly two record classes):

1. one exact immutable successor `ResultPublicationRecord`;
2. one exact `SupersessionRecord` linking old publication → successor.

Successor publication MUST preserve: exact `ExecutionResult`
identity/reference; evaluator/validation provenance; non-receipt
publication facts that are not normatively changed;
workspace/attempt/occurrence correlations. It MAY change only the
protocol-owned receipt-gating surface: exact `receipt_correlations` and
receipt-enabled privileged scopes already permitted by committed
protocol (`completion-status`, `downstream-automation`,
`authoritative-reporting`). No new privileged scope outside the
committed vocabulary. No mutation of the historical predecessor.

**Read allowlist (exact, closed under-lock set; A1):**
`trusted-receipt`; `result-publication-record`; `supersession-record`;
`validation-record`; `execution-outcome-record`;
`execution-attempt-record`; `execution-occurrence-record`;
`activation-record`; `revocation-record` (predecessor
currentness/non-revocation under the PUB-004 active-publication check);
plus host-provided registry snapshot/reference material. NOT included
(not required by committed correlation/provenance verification):
`approval-record`, `issuance-record`, `runtime-grant`,
`execution-summary-record`, `migration-record`,
`authoritative-audit-event`.

**Write allowlist (EXACTLY):** successor `ResultPublicationRecord`;
`SupersessionRecord`. No other class.

**Role attribution (A1):** the produced records retain their committed
schema role constants — the successor `ResultPublicationRecord` carries
the existing committed publisher role; the `SupersessionRecord` carries
the existing committed lifecycle-authority role. **Schema role
attribution ≠ capability identity.** The WP-15 correlation producer
holds a distinct module-private capability, distinct permit/provenance,
distinct write allowlist, and a distinct lock/replay domain. It MUST NOT
receive or reuse the WP-13C publication capability. No
`components.json` role-vocabulary change is authorized.

## 11. Correlation Ordering (deterministic sequence)

```text
fresh durable read
→ retrospective derivation (shared primitive)
→ receipt eligibility verification
→ receipt event lock
→ receipt replay/conflict check
→ publish TrustedReceipt
→ fresh receipt verification
→ publication-correlation lock
→ predecessor publication reread
→ successor replay/conflict check
→ publish successor ResultPublicationRecord
→ publish exact SupersessionRecord
→ audit evidence
```

Lock composition follows existing patterns (event-level receipt lock;
publication-level correlation lock); no global transaction is invented.
Partial-state semantics are explicit: a receipt may validly exist while
the correlated successor publication is not yet produced — in that state
privileged consumption remains blocked (PUB-005); retry is idempotent
and resumes safely without fabricating or replacing historical records.
An already-durable TrustedReceipt is NEVER rolled back.

Intermediate-state pinning (A1; focused-review conclusion preserved):

- **Receipt durable, successor absent:** safe. Privileged consumption
  remains blocked (PUB-005 — the ordinary-review predecessor carries no
  receipt correlation). Exact retry resumes from the durable receipt.
- **Successor durable, SupersessionRecord not yet durable:** safe under
  committed currentness semantics — the predecessor carries no receipt
  correlation, so no ambiguous two-correlated-publication state exists
  (PUB-006); per-scope currentness holds. Exact retry MUST complete the
  `SupersessionRecord` idempotently before the correlation operation
  reports success.

No global transaction. No rollback of the receipt or the successor.

## 12. PUB-005 Consumer Correctness (A1 wording correction)

The committed PUB-005 verifier currently enforces the committed minimum:
privileged scopes (`completion-status`, `downstream-automation`,
`authoritative-reporting`) require non-empty `receipt_correlations` on an
active scoped publication. That committed minimum remains required and is
not widened by WP-15.

WP-15 imposes the stronger exact-binding requirement at its own
producer/correlation boundary and does NOT falsely attribute it to the
existing verifier: the correlation producer MUST create the exact receipt
correlation — the successor publication carries the exact matching
`receipt_correlations` the committed verifier reads; the matching
`TrustedReceipt` exists and verifies with exact
event/bindings/disposition/context; exact publication/result/event
bindings and all existing publication validity/provenance checks pass;
receipt-required scope semantics are satisfied (protocol
§222/§232–234). Receipt existence elsewhere in storage is insufficient.

The successor publication must carry the exact correlation WP-15's own
boundary guarantees. WP-15 focused implementation MAY strengthen
verification where necessary and within the approved receipt-correlation
semantics. No unrelated point-of-use widening is authorized.

## 13. Supersession Semantics

Committed immutable supersession semantics: predecessor publication
remains immutable; successor is a new record; `SupersessionRecord`
names the exact predecessor and successor with the stated scope/context;
no "newest wins"; no timestamp-based winner; conflicting successors fail
closed; replay of the exact same successor transition is idempotent
where committed patterns permit (ADR-012 §8 correction path; ADR-038
consequences: supersession production assigned here by the envelope).
Not broadened into generic publication editing.

## 14. Receipt Is Retrospective Only

`TrustedReceipt attests verified retrospective facts; it creates no
prospective authority.`

Receipt issuance/correlation MUST NOT: approve artifact drafts; issue
lifecycle authority; create RuntimeGrant; activate execution; reactivate
pi-guard; authorize retry; create a new occurrence/attempt; mutate
TaskSpec; mutate AuthorityPolicy; mutate ContextManifest; mutate
CompletionContract.

## 15. Hardening Scope

- **REQUIRED:** TrustedReceipt authority implementation; publication
  correlation implementation; denied-activation schema/protocol
  correction; final security audit; release packaging; operational/
  recovery runbooks; package/export integrity; authoritative closure
  regression; supported-environment evidence.
- **A1-authorized normative/runtime corrections (minimum necessary; no
  new authority domain, no generic lifecycle-write capability):**
  event-type-aware EXE-008/EXE-012 rule text; lifecycle graph verifier
  (event-source resolution by §3.2, eligibility-conditioned attempt
  receipt-facts check, outcome-coverage check); TrustedReceipt schema
  (denied absent-only conditional §4; disposition vocabulary extension
  with `incomplete`/`rejected`); `trusted-execution-outcome-recorder`
  production eligibility so every retrospectively trustworthy terminal
  attempt — including legitimate result-less terminal attempts —
  receives exactly one `ExecutionOutcomeRecord` with optional
  `result_association` (§6.3); semantic/conformance fixtures/vectors;
  focused tests.
- **OPTIONAL:** F-R1 (Approved Decision 3 — not in the closure gate).
- **EXCLUDED / DEFERRED:** unrelated migration work (WP-8-N DS-13),
  compaction, historical accepted nonblocking findings already
  dispositioned, unrelated technical debt. Not pulled into the release
  gate.

## 16. Supported Environment

Supported release lane (committed): Linux x86_64; Node v22.23.2; Git
2.45.4 where applicable; Pi 0.83.0 supported extension API lane
(`SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`); committed pi-guard
compatibility lane (v0.1.2); UTF-8 and existing supported assumptions.
The current local Pi 0.84.1 mismatch MUST NOT silently expand support.
If authoritative regression cannot be executed on Pi 0.83.0, closure
must report that exact release-readiness limitation and STOP before
claiming supported-lane release readiness.

## 17. Security Closure Rule

`No open security findings` is auditable as: every blocking review
finding CLOSED; every security finding affecting supported-runtime
correctness/authority CLOSED; accepted nonblocking observations remain
only with explicit disposition; explicitly deferred/non-MVP items do not
become open findings; environment-only mismatches are separately
classified and do not silently alter support; security and conformance
suites pass on the supported release lane. Security closure is NOT
defined as "zero observations of any kind".

## 18. Authoritative Release Regression (A1: clean clone + explicit surface)

One full regression gate run ONCE at meaningful WP-15 closure /
release-readiness, on a **clean clone / committed product tree at the
exact WP-15 closure candidate SHA**. The authoritative regression MUST
NOT inherit arbitrary untracked local files: superseded untracked WP-13D
debris (`src/retrospective/`, `tests/unit/wp13d-*.test.ts`,
`docs/reports/wp-13d-*.md`) is excluded by clean-clone construction and
is NOT product behavior. "No second derivation engine exists" (§21)
means no second derivation engine exists in the committed product tree;
closure verifies that the clean clone contains only committed WP-15
product/test sources. No `.gitignore` addition is made merely to hide
the debris.

Explicit suite surface (semantic ownership: where a suite is already
included by a broader command, state the ownership rather than executing
it twice):

- default unit/integration surfaces;
- conformance;
- security;
- trusted/control-plane/lifecycle;
- pointofuse-v2;
- WP-7 validated runner (reader/git/fff/security; accepted count
  manifest);
- MCP;
- runtime;
- drafting;
- writing;
- execution;
- Pi adapter (unit/integration/security/compatibility/enforcement);
- storage/recovery/crash: `dist-test/tests/process/*`;
- WP-14 integration;
- WP-14C loading: `dist-test/tests/loading/*` (absent from the default
  `npm test` script; the gate adds it).

No brittle exact-total global-count requirement unless a count encodes a
real security invariant.

## 19. Operations / Release Readiness

Required evidence: clean supported-lane build; clean startup/
configuration; operator onboarding/runbook; recovery/failure behavior;
package/export integrity; security audit; authoritative regression;
known limitations; release artifact/package preparation as locally
applicable. External mutation remains unauthorized: no push; no tag; no
GitHub Release; no npm publish; no install/deploy (Approved Decision 4).

## 20. Minimal Implementation Shape

ONE WP-15 package with internal phases only:

- **Phase 1:** TrustedReceipt schema/rule correction + receipt authority
  core.
- **Phase 2:** receipt/publication correlation producer.
- **Phase 3:** hardening / operations / authoritative release gate.

No formal WP-15A/B/C roadmap packages unless a real dependency forces
it. The approved execution envelope allows these phases to proceed
mechanically after this contract baseline is accepted.

## 21. Closure Gate (A1-corrected)

WP-15 closes only when ALL are proven:

1. event-type-aware receipt verification is implemented (EXE-008
   receipt-event validation resolves `event_record_id` by the §3.2
   source matrix; source-class mismatch fails closed);
2. denied-activation receipts use absent-only occurrence/attempt
   representation (`null` and fabricated IDs invalid; §4);
3. every attempt-correlated retrospective receipt has an exact matching
   trustworthy `ExecutionOutcomeRecord` (EXE-012 fail-closed);
4. legitimate result-less state is distinguished from outcome-less
   `terminal-unverifiable` state (§6.1–6.2);
5. `incomplete`/`rejected` disposition semantics are preserved exactly
   (no lossy mapping; §3.2);
6. the shared WP-13 retrospective derivation is reused; no second
   derivation engine exists in the committed product tree;
7. the two authority domains remain separate: write allowlists,
   capabilities, permits, and provenance are distinct (schema role
   attribution ≠ capability identity; §8/§10);
8. the PUB-005 receipt-correlation path operates fail-closed with the
   exact correlation created by the correlation producer (§10/§12);
9. result/publication/receipt separation remains intact and receipts
   create no prospective authority (§9/§14);
10. F-R1 remains optional/nonblocking (Approved Decision 3);
11. the supported Pi 0.83.0 lane is verified (Approved Decision 4;
    §16);
12. the authoritative clean-clone regression passes (§18 surface);
13. no open blocking security findings under the auditable rule (§17);
14. release readiness is complete — operational/runbook/package/export/
    recovery readiness evidence and the release-readiness verdict;
15. external publication/deployment remains unauthorized: WP-15 closure
    MUST NOT perform push, tag, publication, installation, or
    deployment (Approved Decision 4).

## 22. Human Authorization State

This contract is ACCEPTED and BASELINED by this commit. At the instant
immediately before this commit, WP-15 implementation had NOT STARTED.
After this baseline commit, WP-15 implementation is **AUTHORIZED UNDER
THE EXISTING EXECUTION ENVELOPE**. The next implementation phase is
**WP-15 Phase 1 — TrustedReceipt schema/rule correction + receipt
authority core.**

The WP-15 Architecture + Execution Authorization Envelope remains
ACTIVE and pre-authorizes implementation; focused verification; senior
review; finding-specific correction; focused rereview; closure review;
authoritative regression; and local closure commit. STOP AND ESCALATE
only on an envelope exception. External release actions remain **NOT
AUTHORIZED**: no push/tag/publication/install/deploy without separate
human release authorization.

## Focused Correction Ledger (SCR-WP15-001…006)

- **SCR-WP15-001 (CRITICAL) — CLOSED.** Event-type-aware receipt-event
  verification pinned (§3.1–3.2, §5); EXE-012 fail-closed outcome
  coverage pinned (§3.3, §5); EXE-008/EXE-012 rule and verifier
  corrections authorized (§15, A1 item 6).
- **SCR-WP15-002 (MAJOR) — CLOSED.** Retrospective-complete classifier
  (§6.1); result-less ≠ outcome-less (§6.2); durable outcome requirement
  (§6.3); full 7-value outcome disposition mapping with
  `incomplete`/`rejected` (§3.2); §6 matrix contradiction removed
  (§6.4).
- **SCR-WP15-003 (MODERATE) — CLOSED.** Denied-activation absent-only
  representation pinned; `null`/empty/fabricated invalid; `null`
  inapplicability convention not broadened for other branches (§4).
- **SCR-WP15-004 (MODERATE) — CLOSED.** Correlation-producer read
  allowlist, exact write allowlist, schema-const role attribution, and
  capability distinctness pinned; WP-13C capability reuse forbidden
  (§10).
- **SCR-WP15-005 (MODERATE) — CLOSED.** Clean-clone authoritative
  regression; superseded untracked WP-13D debris excluded by
  construction; "no second derivation engine" scoped to the committed
  product tree (§18, §21).
- **SCR-WP15-006 (MINOR) — CLOSED.** Release suite surface explicit with
  paths and semantic ownership (§18).

## Remaining Architecture Decisions

NONE.

WP-15 CONTRACT ACCEPTED / BASELINED — PHASE 1 IMPLEMENTATION AUTHORIZED
