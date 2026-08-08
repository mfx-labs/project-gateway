# WP-12 — Pre-Implementation Contract Decision

**Work package:** WP-12 — Local approval and execution control plane.
**Phase:** contract decision only (no implementation authorized by this
document; no source/test/schema/package/runtime change made).
**Status:** accepted implementation baseline — focused senior contract
rereview ACCEPTED (`WP-12 CONTRACT CORRECTION ACCEPTED — READY FOR
HUMAN IMPLEMENTATION AUTHORIZATION`); final precision corrections
FSCR-W12-001 and FSCR-W12-002 applied and committed as the WP-12
pre-implementation contract baseline (documentation closure commit).
WP-12 Slice 1 implementation CLOSED at commit `7282b3b7`
(`feat: close WP-12 approval and issuance slice 1`). WP-12 Slice 2
focused clarification record applied (§25) and focused senior contract
review returned `WP-12 SLICE 2 CONTRACT ACCEPTED — READY FOR HUMAN
IMPLEMENTATION AUTHORIZATION`; the five editorial MINOR findings
SCR-W12-S2-001…005 are CLOSED (§25.27) and this document is committed
as the WP-12 Slice 2 contract baseline (documentation closure commit).
Not self-approved; WP-12 Slice 2 implementation (2A revoke, 2B
`verifyCurrentLifecycleState`) requires a subsequent explicit human
implementation authorization.
**Baseline:** HEAD `9695c5d8a5f42404884f11c02c493ed56d6f9e72`
(`feat: close WP-11 controlled artifact writing slice 1`, parent
`e4b85daee8fc2cd51919232b417d25dee72c7401`); working tree clean; staging
empty.
**Eligibility basis:** the accepted WP-12 eligibility/scope/readiness
analysis (prerequisites WP-4 `45bfd97`, WP-6 `b07fea9`, WP-8 `db1b415` +
`eb7feab` all CLOSED) concluded `WP-12 ELIGIBLE — CONTRACT DECISIONS
REQUIRED BEFORE IMPLEMENTATION` with a blocking decision set of five items.
This document resolves exactly that set.

## 1. Fixed WP-12 scope (accepted roadmap — not reopened)

`docs/design/post-wp5a-roadmap.md` (table row 7, line 732; block at
line 882): WP-12 owns approval decisions, issuance decisions, revocation
decisions, RuntimeGrant production, activation decisions, authoritative
trusted-local lifecycle records, and execution-orchestration decisions;
consumes WP-4 eligibility evaluation / lifecycle rules, WP-6 ceilings and
trusted workspace configuration, WP-8 trusted-local persistence, locks,
audit, retention, and registry context. WP-12 does NOT itself activate
pi-guard (WP-5B), execute Pi or produce `ExecutionResult` (WP-13),
produce `TrustedReceipt` (WP-15), write lifecycle facts into project
repositories, own generic project-file writing, perform Git mutation, or
derive lifecycle authority from repository content.

Preserved stage separation (ADR-002, ADR-011):
approval ≠ issuance ≠ RuntimeGrant ≠ activation ≠ execution. No stage is
collapsed.

## 2. Inherited normative contract (referenced, not restated)

- ADR-002 — trusted-local control-plane zone; approval binds the canonical
  digest of an exact revision; separate approval/issuance/activation;
  state external to repositories; consumers fail closed; ChatGPT never
  approves its own artifacts; a model-issued artifact or command is never
  lifecycle authority.
- ADR-011 — record taxonomy and semantics; revocable vs immutable record
  classes; per-occurrence `RuntimeGrant`; one activation decision per
  reserved occurrence; terminal denied closure; revocation targets only
  usability/publication records.
- `docs/design/trusted-lifecycle-protocol.md` — record responsibilities,
  approval/issuance scope rules, revocation/expiry/supersession, the
  grant/activation/occurrence/attempt/retry protocol, point-of-use
  verification table, prohibited shortcuts, and the eight handoff
  completion criteria (lines 284-300).
- ADR-012 — `ExecutionResult` result lifecycle and publication (not
  WP-12-owned).
- ADR-006 — `ExecutionBundle` composition boundary.
- ADR-027 — `PiEnforcementEvidence` (WP-5B); activation evidence fields.
- `docs/design/capability-vocabulary.md` — `project-gateway.approval-operate`
  and `project-gateway.lifecycle-issue`: control plane only.
- WP-4 `src/lifecycle/graph.ts` — lifecycle rule evaluation
  (LFC-001…LFC-010, EXE-001…EXE-009, PUB-001…PUB-008, MIG-003/004,
  REG-001/002/008) over caller-supplied records.
- WP-8 `src/storage` — store substrate: `publishRecord`, writer locks,
  audit events, retention, registry context; lifecycle-record profiles
  with `semanticOwner: 'WP-2 / WP-12'` and `wp8Production: 'no'`.

## 3. Decision 1 — Control-plane operation surface / transport

**Selected: A — transport-free control-plane decision core first.**

Explicit answers:

- **MCP lifecycle mutation tools: NOT authorized in WP-12.** WP-9
  established inspection-only MCP behavior ("no mutation tools"); no
  accepted repository evidence authorizes lifecycle mutation tools on the
  MCP surface. An approval/activation tool reachable from a ChatGPT
  channel would require anti-spoofing semantics that no accepted contract
  defines, and ADR-002 already prohibits ChatGPT lifecycle authority.
  Selecting MCP merely because an MCP server exists is rejected.
- **Later introduction:** a transport/adapter slice AFTER the transport-free
  core is proven, requiring separate explicit authorization. Any such
  adapter must keep the trusted-operator authority boundary intact and may
  only transport commands whose approver role is host-asserted (never
  derived from the command payload or a model).
- **CLI: NOT required for WP-12 closure.** A CLI is a possible host
  adapter over the canonical boundary, not a normative closure-gate item.
- **Canonical operation boundary (Slice 1):** an injected host command
  executor (`ControlPlaneCommandExecutor`) — the established WP-11
  injected-boundary pattern. The core is transport-free; commands enter as
  typed host-supplied operands; the host owns the command source, the
  trusted configuration, the store boundary, and the approver role.

Transport never defines lifecycle semantics. Rationale: minimum-authority
sequencing, testability (pure decision core + fake store boundary),
and future adapter/transport composition without semantic change.

## 4. Decision 2 — WP-12 slice decomposition

Derived from the ADR-011 / trusted-lifecycle-protocol transition model
(`draft → validation → approval → issuance → eligibility → grant →
activation → occurrence → attempts`): each slice adds the next decision
layer and consumes the previous one. Decomposition:

| Slice | Objective | Operations owned | Records produced | Records consumed | Closure gate |
|---|---|---|---|---|---|
| 1 | Transport-free approval + issuance decision core (incl. validation-record recording) | `recordValidation`, `approve`, `issue` | `ValidationRecord` (recording only; WP-4 runs the assessment), `ApprovalRecord`, `IssuanceRecord` (each publication carries the WP-8 mechanical write-audit, D-6; §15) | Validation evidence (host), WP-6 config/ceilings, WP-8 store | Approval and issuance decisions exist as trusted-local records; LFC-001/002/003 fail-closed; no repository-driven decision; store-only mutation |
| 2 | Revocation + current-state verification | `revoke`, `verifyCurrentLifecycleState` (read-only) | `RevocationRecord` (WP-8 mechanical write-audit, D-6; §15) | Approval/Issuance records + revocation/expiry/supersession state | Derived current state correct across revocation/expiry; verification API deterministic and redacted |
| 3 | RuntimeGrant + activation + occurrence reservation/consumption | `issueRuntimeGrant`, `decideActivation` (accepted/denied), `createOccurrence` (on accepted) | `RuntimeGrant`, `ActivationRecord`, `ExecutionOccurrenceRecord` (each publication carries the WP-8 mechanical write-audit, D-6; §15) | Bundle/artifact validated revisions, approvals/issuances, grant state, ceilings | ADR-011 occurrence protocol: one decision per reserved ID; denied is terminal; atomic reservation consumption under the WP-12 decision coordination lock (§15); ADR-027 activation evidence available |
| 4 | Execution-orchestration decision surface + execution-recording operations | `orchestrationDecision`, `recordExecutionAttempt`, occurrence/attempt correlation surface | Bounded orchestration-decision evidence; `ExecutionAttemptRecord` (via WP-12 record operation, invoked by WP-13; WP-8 mechanical write-audit, D-6) | Accepted activation, occurrence, grant | WP-13 consumable orchestration evidence; attempt recording operational; no execution capability in WP-12 |

Slice prerequisites within WP-12: 2 ← 1; 3 ← 1,2; 4 ← 3.

**WP-12 CLOSED means:** all four slices delivered AND the roadmap closure
gate holds — "All lifecycle decisions external to repository content; fail
closed on missing state" — AND the eight trusted-lifecycle-protocol handoff
criteria are demonstrably satisfiable (exact-subject binding and
current-record evaluation; atomic reservation/one-decision/terminal-denied/
occurrence correlation; per-attempt record and receipt-fact capability;
one-result-instance correlation left to WP-13 with the record substrate
present; receipt correlation capability left to WP-15 with event facts
present; append-only revocation; exact registry-context and
workspace-scoped approval/issuance; fail-closed on unavailable state).
WP-5B-required capability (RuntimeGrant + activation decision/evidence)
is delivered by Slice 3 inside WP-12; WP-13-required orchestration
decisions are delivered by Slice 4 inside WP-12. Nothing WP-12-owned is
deferred outside WP-12.

## 5. Decision 3 — Approved-subject form

**Selected: C — the validated canonical artifact revision, independent of
persistence location, with one canonical normalized subject identity.**

Controlling principle (ADR-002): approval binds the canonical digest of an
exact revision. Filesystem path, filename, project-file presence, and
mutable repository state are never subject identity.

Canonical subject identity (single normalized form for every lifecycle
operation):

```text
(protocolId, protocolVersion, kindId, kindVersion,
 instanceId, revisionId, canonicalDigest)
```

plus operation scope: workspaceId, purpose (approval) / use-class (issuance),
and exact accepted registry context.

**Workspace-binding precision (SCR-W12-008):** workspaceId is NOT part of
the artifact's intrinsic revision identity, but it IS an exact required
component of the lifecycle record subject/binding according to the
accepted protocol record forms (the protocol record subject includes the
trusted workspace ID; the accepted fixtures
`fixtures/lifecycle/valid/validation-bundle.json` and
`fixtures/lifecycle/valid/approval-bundle.json` place `workspace_id`
inside `subject`). Implementations MUST follow the actual protocol record
schemas/fixtures for record construction and correlation rather than
inferring tuple layout from this explanatory prose. Purpose/use-class and
registry snapshot/context remain operation/record scope bindings as
defined by their accepted record types.

Subject input at the trusted boundary: the exact validated canonical
revision bytes (host-supplied, digest-verified by the accepted WP-4/WP-3
digest computation) correlated with the exact successful `ValidationRecord`
(revision/digest/protocol/kind/registry-context bindings). Persisted vs
non-persisted representation is not part of identity: a WP-11-persisted
project file and a WP-10 `ValidDraftProposalResult` both carry the same
canonical revision identity when their digest-covered content is the same
accepted revision. The identity correlation is digest/record-based, never
path-based.

Relationship summary: artifact kind, instanceId, revisionId, canonical
digest, workspace, purpose, registry context, and validation evidence are
all exact bindings of the subject/record (protocol tables), not
derivable-from-path fields.

### ExecutionBundle resolution

**WP-12 MAY approve, issue, and (Slice 3) activate a validated
`ExecutionBundle` revision WITHOUT WP-11 project-file persistence.**
Rationale:

- ADR-002 binds approval to the canonical digest of an exact revision — a
  property of validated content, not of project-file presence. ADR-011's
  bundle approval/issuance binds "exact bundle" (revision identity).
- The trusted-lifecycle-protocol transition model begins at "canonical
  revision and identity registration" (WP-3/WP-4 identity machinery);
  persistence location is not a lifecycle authority or a transition
  precondition.
- Trusted subject input: the validated `ExecutionBundle` canonical
  revision (WP-10 can draft it; WP-4 can validate it) supplied as trusted
  host evidence with digest verification, plus exact member revision
  identity (ADR-006 composition).
- Persistence is not lifecycle authority: project files are reviewable
  content; lifecycle state lives in the trusted store (ADR-002 l.29).
- **WP-13 content acquisition is WP-13-owned (SCR-W12-002).** WP-12
  S3/S4 evidence MUST bind exact identity/digest: ExecutionBundle
  protocol/version; kind/version; instanceId; revisionId; canonical
  digest; workspace binding; registry-context binding; `ApprovalRecord`
  identity; `IssuanceRecord` identity; `RuntimeGrant` identity where
  applicable; `ActivationRecord` identity; occurrence identity;
  orchestration-decision identity as applicable. WP-12 does NOT retain or
  publish the canonical ExecutionBundle bytes and is NOT an
  artifact-content store. WP-13, in its later authorized execution
  contract, owns acquisition of the exact canonical bundle content:
  before execution WP-13 MUST (1) acquire candidate canonical content
  through a future WP-13-authorized host content source; (2) recompute
  and verify the accepted canonical digest using the accepted
  artifact-identity machinery; (3) verify protocol/kind/instance/revision
  identity; (4) match the resulting identity and digest EXACTLY to the
  WP-12 orchestration/activation evidence; and (5) fail closed on
  missing, ambiguous, stale, mismatched, or unverifiable content.
  Prohibited: project-file pathname as bundle authority; filename as
  bundle identity; repository presence as lifecycle authority; `latest`
  lookup; mutable repository content satisfying the handoff merely by
  path; WP-12 as an artifact-content store; WP-8 storing ExecutionBundle
  content; WP-11 gaining ExecutionBundle persistence. The activation
  checklist item "the exact bundle reference resolves and its digest
  verifies" remains WP-12's activation-time check, evaluated against
  validated revision evidence — never against a project file.

**WP-11 is NOT changed:** `ExecutionBundle` persistence stays excluded from
WP-11 (the accepted WP-11 contract decision remains untouched). WP-12 is
consequently NOT blocked by the bundle-persistence deferral. Bundle
activation additionally requires each of the four member revisions to have
their own active approval and issuance (ADR-011) — those members are
WP-11-persisted or non-persisted validated revisions identically.

## 6. Decision 4 — Approver workflow / activation UX scope

Three layers, kept separate:

- **A. Normative lifecycle semantics** — unchanged (ADR-002/011, protocol).
- **B. Trusted operator command model** — the minimum required for WP-12
  correctness:
  - Who may submit an approval decision: the trusted local operator via
    the host-injected command boundary. The host asserts the approver
    role; the command payload never supplies it.
  - Trusted approver identity: a trusted-local role bound to the
    host boundary (e.g., host-configured operator identity), never a
    caller-supplied string, artifact field, or model assertion. The host
    MAY associate the role with a local operator principal for operational
    attribution; actor identity is host-owned, is not an artifact
    property, and is not supplied by the command payload. Slice 1 defines
    no delegation, and delegation is NOT authorized; service automation
    does NOT receive the approver role in Slice 1; the default Slice-1
    approver authority is a trusted local human/operator boundary.
  - Approver independence is STRUCTURAL, not a per-artifact identity
    comparison (SCR-W12-003): approval authority exists only in the
    host-asserted trusted-local approver role, which is unavailable to
    ChatGPT/model command operands. Caller-supplied role strings are
    ignored/rejected; artifact fields, annotations, validation records,
    digest possession, and transported proposals can never confer the
    role. The accepted corpus defines no trusted producer-identity field,
    and none is invented; no per-artifact producer comparison exists.
    ChatGPT cannot approve its own artifacts because ChatGPT can never
    possess the trusted approver role (ADR-002).
  - ChatGPT: MAY propose content and MAY transport a proposed approval
    operand to the trusted operator for confirmation; ChatGPT NEVER
    possesses approval authority and can never directly approve. A
    model-issued artifact or command containing an approval-like field is
    never lifecycle authority (ADR-002 l.25) — enforcement is structural
    (approver role is host-asserted), not heuristic.
  - Confirmation/intent: the trusted operator command itself is the
    confirmation; the core requires exact subject identity, workspace,
    purpose, registry context, and validation references and returns
    deterministic evidence. No free-text or annotation fields influence
    the decision.
  - Deny/cancel representation: denial of approve/issue/revoke requests
    produces NO lifecycle record and NO `AuthoritativeAuditEvent` under
    the current WP-8 contract; the host MAY emit non-authoritative
    operational logging, which is not lifecycle state, not authorization
    evidence, and not a lifecycle prerequisite (SCR-W12-001, §15).
    Activation denial produces an `ActivationRecord(denied)` per ADR-011
    (a single historical record transition; no occurrence).
  - Revocation propagation operationally: derived current-state
    evaluation — a revoked approval blocks future matching issuance and
    activation; a revoked issuance blocks future matching activation; a
    revoked grant blocks further grant use. Propagation is derived state
    over append-only records, never record rewriting.
  - Activation authorization: an activation command from the trusted
    operator plus re-validation of all eight protocol activation checks at
    decision time.
- **C. User-interface presentation — explicitly non-normative, deferred.**
  No graphical/interactive UX is required for WP-12 closure. CLI/host API
  is a sufficient implementation surface. UX concerns remain adapter
  concerns outside the closure gate.

## 7. Decision 5 — Point-of-use lifecycle-verification API

**Owner:** WP-12 (Slice 2; read forms refined in Slices 3-4).

**Form:** one read-only pure-evaluator operation over the trusted
observed record set (bounded trusted-store reads during one completed
evaluation; no atomic store-snapshot primitive exists —
SCR-W12-S2-002) — `verifyCurrentLifecycleState` — separate from all
reservation-consuming mutations. ADR-011 does not require activation
verification and activation transition to be one atomic operation; the
transition atomicity requirement is scoped to the activation mutation
itself (Slice 3, WP-12 decision coordination lock; §15).

- Caller trust model: any consumer (host-injected); result is evidence,
  never transferable authority.
- Request: canonical subject identity (Decision 3), workspaceId, purpose /
  use-class, exact accepted registry context, consumer-support declaration,
  capability requirements; ceilings and configuration are host-injected
  (WP-6).
- Checks (per protocol point-of-use table): active matching approval;
  active issuance; current revocation/expiry/supersession state; grant
  state and occurrence binding where applicable; ceiling/policy/consumer
  intersection; registry-context equality.
- Freshness: every privileged use re-runs the query against current store
  state; no cached approval/grant is ever authority.
- Deterministic success evidence: bounded object with the exact record IDs,
  derived current-state facts, registry-context identity (id + digest), and
  the subject identity — data/evidence only.
- Denial taxonomy: typed fail-closed codes (Decision 8); redacted (no
  store paths, errno, stacks, secrets, unrelated records).
- Replay resistance: evidence is bound to the registry context and the
  records observed during the completed evaluation, and to the subject; it
  cannot be replayed as a grant or activation.
- WP-5B consumption: activation evidence object from Slice 3 (activation
  outcome, grant identity, reserved occurrence identity — ADR-027 fields),
  delivered as input to `PiEnforcementEvidence`; WP-5B independently
  verifies the observed tool surface and fails closed on drift or
  unverified pi-guard versions. WP-12 never activates pi-guard.
- WP-13 consumption: orchestration/current-state evidence from Slice 4
  plus exact identity/digest-bound bundle evidence (§5); bundle content
  acquisition and cryptographic correlation are WP-13-owned
  (SCR-W12-002); WP-13 fails closed on missing state (ADR-002 l.40).

## 8. Lifecycle operation matrix

| Operation | Trusted actor | Subject | Required prior state | WP-4 evaluation | WP-6 inputs | WP-8 records read | Locking (§15) | New records | Audit | Invalidates | Idempotency/replay | Failure mode | Consumer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `recordValidation` | Validation host (trusted) | Canonical revision + host-injected accepted WP-4 run evidence (assessment outcome is NEVER a caller-supplied operand; SCR-W12-004) | Accepted WP-4 validation run | The validation run itself (accepted WP-4 result; §22) | Registry context | None (fresh) | Host-side coordination lock (validation decision key) + publishRecord writer lock (§15) | `ValidationRecord` | WP-8 mechanical write-audit (D-6) | Prior same-subject validation not invalidated (later record supersedes for current use) | Exact duplicate (identical full evidence correlation: subject, digest, registry snapshot/context, validator profile/version, validation-result identity) → lifecycle-conflict; a later run under a new snapshot/profile is a new record, not a duplicate (SCR-W12-004) | store-failure / subject-invalid / request-invalid / registry-context-mismatch | Approver (Slice 1) |
| `approve` | Trusted operator (approver role) | Canonical revision (5 kinds incl. bundle) | Valid `ValidationRecord`; no conflicting approval | Eligibility checks; LFC-001/002 via graph | Ceilings; registry context | `ValidationRecord`, existing approvals/revocations | Host-side coordination lock (approval decision key) + publishRecord writer lock (§15) | `ApprovalRecord` | WP-8 mechanical write-audit (D-6) | Prior approval for same subject/workspace/purpose becomes non-current (conflict or supersession) | Exact duplicate → already-approved; re-approval after revocation → requires new command (new record) | lifecycle-state-missing / approver-not-independent / eligibility-denied / ceiling-denied / store-failure | Issuer (Slice 1), activation (Slice 3) |
| `issue` | Trusted operator (issuer role) | Approved canonical revision | Active matching approval; no revocation | LFC-003 via graph | Registry context; ceilings | `ApprovalRecord`, revocation state | Host-side coordination lock (issuance decision key) + publishRecord writer lock (§15) | `IssuanceRecord` | WP-8 mechanical write-audit (D-6) | Prior issuance for same scope becomes non-current | Duplicate → already-issued | issuance-not-authorized / approval-revoked / lifecycle-state-missing | Activation (Slice 3), bounded consumer |
| `revoke` | Trusted operator (revocation authority) | One exact Approval/Issuance/Grant (Slice 3+)/Publication record | Record exists | None (targeting check) | None | Target record, current revocation state | Host-side coordination lock (revocation decision key, §25 C5) + publishRecord writer lock (§15) | `RevocationRecord` | WP-8 mechanical write-audit (D-6) | Target usability for stated scope | Repeat same target+scope → lifecycle-conflict (already revoked) | lifecycle-state-missing (absent/out-of-workspace target) / request-invalid (immutable or malformed target, meaningless scope) / lifecycle-conflict (already revoked) / registry-context-mismatch / store-failure (§25 C1) | Every point-of-use verifier |
| `issueRuntimeGrant` (Slice 3) | Trusted operator (grant authority) | Bundle revision + reserved occurrence ID | Fresh reservation; active bundle+member approvals/issuances; ceilings | EXE-eligible state via graph | Ceilings; policy | Approvals, issuances, reservations, grants | Host-side coordination lock (grant decision key) + publishRecord writer lock (§15) | `RuntimeGrant` | WP-8 mechanical write-audit (D-6) | Prior grant for same reservation | Reservation reused → occurrence-conflict | grant-not-authorized / reservation-invalid / ceiling-denied | Activation authority |
| `verifyCurrentLifecycleState` (Slice 2+) | Any host consumer | Canonical subject + scope | — (read-only) | Eligibility evaluation | Ceilings; config | All relevant records + revocation/expiry/supersession | None (read) | None | None | — | Deterministic for the observed record set of the completed evaluation | lifecycle-state-missing (fail closed) | All downstream consumers |
| `decideActivation` (Slice 3) | Trusted operator (activation authority) | Bundle revision + reserved occurrence ID + grant | All 8 protocol checks | EXE-001…009 via graph | Ceilings; policy | Bundle/member validations, approvals, issuances, grant, reservations, registry context | Host-side coordination lock (activation decision key) + publishRecord writer lock (§15); two records on accepted (SCR-W12-005) | `ActivationRecord` (accepted/denied); `ExecutionOccurrenceRecord` on accepted | WP-8 mechanical write-audit (D-6) | Reservation and grant permanently closed (denied); grant consumed (accepted) | Reservation reuse → occurrence-conflict; replay → fresh reservation required | activation-denied / occurrence-conflict / replay-denied / registry-context-mismatch | WP-5B (evidence), WP-13 (occurrence) |
| `orchestrationDecision` / `recordExecutionAttempt` (Slice 4) | Trusted operator / WP-13 execution recorder | Accepted activation + occurrence (+ attempt) | Accepted activation; occurrence exists | Correlation checks | Registry context | Activation, occurrence, grant | Host-side coordination lock (occurrence/attempt decision key) + publishRecord writer lock (§15) | Bounded orchestration-decision evidence; `ExecutionAttemptRecord` | WP-8 mechanical write-audit (D-6) | — | Duplicate attempt ordinal → attempt-conflict | occurrence-conflict / attempt-ordinal-conflict / store-failure | WP-13 (execution), WP-15 (receipt facts) |

No operations are added for symmetry; each maps to an ADR-011 record class
and a protocol transition.

## 9. Record production/consumption ownership

| Record class | Produced by | Consumed by WP-12 | Notes |
|---|---|---|---|
| `ValidationRecord` | WP-12 (`recordValidation`, Slice 1) — assessment itself by WP-4 | Yes (approve/issue/activate) | Recording only; validator role per taxonomy; every recorded validation field derived exclusively from the accepted WP-4 run result (SCR-W12-004) |
| `ApprovalRecord` | WP-12 (Slice 1) | Yes | Revocable usability record |
| `IssuanceRecord` | WP-12 (Slice 1) | Yes | Revocable usability record |
| `RevocationRecord` | WP-12 (Slice 2) | Yes (derived state) | Append-only; targets only Approval/Issuance/Grant/Publication |
| `RuntimeGrant` | WP-12 (Slice 3) | Yes | Revocable usability record; per-occurrence |
| `ActivationRecord` | WP-12 (Slice 3) | Yes | Immutable historical fact; accepted/denied |
| `ExecutionOccurrenceRecord` | WP-12 (Slice 3, on accepted) | Yes | Immutable; one per accepted activation |
| `ExecutionAttemptRecord` | WP-12 record operation (Slice 4), invoked by WP-13 at attempt start | Correlation only | Execution ownership stays WP-13 |
| `TrustedReceipt` | **Later — WP-15 (normative owner)** | No | WP-12 supplies event facts/correlation substrate only |
| `ResultPublicationRecord` | Later — result publisher (WP-13 context; ADR-012) | No | WP-12 supplies PUB evaluation via graph only |
| `SupersessionRecord` | Not produced by WP-12 S1-S4; result-instance supersession remains ADR-012/result-publisher ownership | Yes (derived state, Slice 2+) | Historical fact; WP-12 MAY consume applicable SupersessionRecord state in current-state evaluation; any future lifecycle-authority supersession operation requires an explicit later contract decision (SCR-W12-006) |
| `ExecutionSummaryRecord` | Later — reporting authority | No | Reporting only |
| `MigrationRecord` | Later — migration authority | No | Not WP-12 |
| `AuthoritativeAuditEvent` | WP-8 only: mechanical authorized-write event at the operation durability point (D-6) plus reconstruction (taxonomy `wp8Production: ['reconstruction-only','write-audit']`); NOT published as a primary record by WP-12 (SCR-W12-001) | Yes (as produced) | Mechanical authorized-write audit correlation; no WP-12 audit-write API is invented |

Production ownership is never inferred from record existence; each row
follows the taxonomy's producer role and the ADR-011 responsibility table.

## 10. Revocation semantics (operational)

- Command subject: exactly one existing `ApprovalRecord`, `IssuanceRecord`,
  `RuntimeGrant` (Slice 3+), or (later) `ResultPublicationRecord`, plus
  scope, effective point, reason.
- Authority: trusted operator in the revocation-authority role (host-
  asserted). No other actor.
- Append-only: revocation creates a new immutable `RevocationRecord`; the
  target record is never mutated, deleted, or marked.
- Current-state derivation: `verifyCurrentLifecycleState` derives
  currentness as (record exists) ∧ (no applicable revocation) ∧ (no
  expiry) ∧ (no supersession for scope).
- Propagation: revoked approval → future matching issuance and activation
  fail closed; revoked issuance → future matching activation fails closed;
  revoked grant → further grant use fails closed; revoked publication →
  use under that scope fails closed.
- Unconsumed activation: a revoked grant or revoked bundle issuance blocks
  activation; the reserved occurrence may be closed by a denied activation
  (terminal) or remain unused (never activated). A revocation does not
  create an activation decision.
- Already-started execution: NOT WP-12 semantics — WP-13 consumes current
  grant/revocation state at each authority-dependent action and fails
  closed; WP-12 does not invent execution cancellation.
- Point-of-use after revocation: fail closed for the revoked scope.
- Replay: revocation is one-way; a repeat of the same target+scope fails
  as lifecycle-conflict (already revoked); revocation never reinstates.
- Audit: the WP-8 mechanical authorized-write audit event accompanying
  the `RevocationRecord` publication (D-6); WP-12 publishes no separate
  `AuthoritativeAuditEvent` record (SCR-W12-001).

## 11. RuntimeGrant + activation contract (settled now, implemented Slice 3)

- Subject: one exact `ExecutionBundle` revision (Decision 3 identity) +
  workspace + fresh reserved occurrence ID (`pgw:o:` + 32 lowercase hex)
  + finite attempt allowance + validity + narrowed authority only.
- Narrowing: grant ⊆ intersection of approved policy (AuthorityPolicy
  revision), ceilings (WP-6 global/workspace), consumer support; never an
  expansion.
- Expiry/revocation: record-level; current use requires validity ∧
  non-revocation.
- Single-occurrence/replay: one reserved ID → exactly one activation
  decision; a later request requires a fresh reservation, fresh grant,
  fresh activation; reuse → occurrence-conflict / replay-denied.
- Activation prerequisites: the eight protocol checklist items, all
  re-evaluated at decision time under the WP-12 decision coordination
  lock (§15).
- Accepted vs denied: `ActivationRecord(accepted)` consumes the
  reservation and creates exactly one `ExecutionOccurrenceRecord`;
  `ActivationRecord(denied)` creates no occurrence/attempt and permanently
  closes the reservation and grant. Denied can never become accepted.
- Atomicity (SCR-W12-005): reservation allocation, grant issuance, and
  the activation decision each run under the WP-12 decision coordination
  lock (§15); `publishRecord` retains its own internal writer lock. An
  accepted activation produces TWO durable publications under the same
  coordination lock — `ActivationRecord(accepted)` first, then
  `ExecutionOccurrenceRecord` with the exact same reserved occurrence
  identity. Crash between the two publications leaves an incomplete
  transition: the lifecycle graph fails closed (EXE-003 or applicable
  accepted finding), no Pi execution may begin, no WP-5B activation
  evidence may be treated as complete, and no new activation decision may
  be created for that reservation. The only protocol-legal repair is
  appending the missing `ExecutionOccurrenceRecord` under the coordination
  lock after verifying exactly one accepted `ActivationRecord` for the
  exact reserved ID, no competing activation, no existing occurrence, and
  matching grant/subject/workspace/registry correlation (§15).
- ADR-027 evidence: activation outcome, grant identity, reserved
  occurrence identity, workspace identity, bundle revision identity →
  inputs to `PiEnforcementEvidence` (WP-5B). Bundle evidence is
  identity/digest-bound (§5): WP-12 carries and retains NO bundle content
  (SCR-W12-002).
- WP-5B may trust: the activation decision and grant identity from the
  trusted store, delivered as evidence; WP-5B must independently fail
  closed on: observed tool-inventory drift, unverified pi-guard versions,
  missing/ambiguous activation evidence, and any attempted authority
  expansion.
- WP-12 does not activate pi-guard and does not execute Pi.

## 12. Execution-orchestration decision boundary

"WP-12 decisions, WP-13 execution" means: WP-12 (Slice 4) produces, per
accepted activation and occurrence:

1. an immutable orchestration decision record (bounded; correlates
   activation, occurrence, grant, bundle revision, workspace, registry
   context), and
2. a bounded authorization evidence object (current-state facts) for
   WP-13's execution start, bound to the exact bundle identity and digest
   per §5 — identity/digest evidence only; WP-12 does NOT retain or
   publish the canonical bundle bytes (content acquisition is
   WP-13-owned, SCR-W12-002), and
3. the `recordExecutionAttempt` operation for attempt start/ordinal
   correlation.

WP-12 does NOT: spawn processes, invoke Pi, invoke pi-guard, stream
execution, produce `ExecutionResult`, retry execution, mutate project
files, or retain/publish ExecutionBundle content (WP-12 is not an
artifact-content store; WP-8 stores no bundle content; WP-11 gains no
bundle persistence — SCR-W12-002). WP-13 remains the execution owner;
retry decisions reuse the occurrence grant under ADR-011 allowance rules
via WP-12's record operations.

## 13. Error/result taxonomy

Closed deterministic categories (mapped to accepted lifecycle findings
where applicable; no duplication):

`request-invalid` · `subject-invalid` · `subject-not-validated` (LFC-001/
002) · `approver-not-independent` · `eligibility-denied` ·
`ceiling-denied` · `lifecycle-state-missing` · `lifecycle-conflict` ·
`already-approved` · `approval-revoked` · `issuance-not-authorized`
(LFC-003) · `already-issued` · `grant-not-authorized` ·
`grant-expired` · `grant-revoked` · `activation-denied` (WP-12
operational result category; an EXE-* finding is cited only where
`validateLifecycleGraph` actually emits that specific finding)
· `occurrence-conflict` (EXE-001/002) · `attempt-ordinal-conflict` ·
`replay-denied` · `registry-context-mismatch` (REG-001/002/008) ·
`store-failure` · `lock-conflict` · `internal-failure`.

Failures map to existing LFC/EXE/PUB/MIG/REG findings where the graph
already decides them; the operation layer adds only the operational
categories above. Errors never expose trusted-store absolute paths, raw
stack traces, raw errno, secrets, internal capability material, or
unrelated lifecycle records. Messages fixed and bounded (WP-11 redaction
pattern).

Precedence (`ceiling-denied` vs `eligibility-denied`): a concrete WP-6
ceiling violation → `ceiling-denied`; other policy/lifecycle/consumer
eligibility intersection failures → `eligibility-denied`; when the
explicit denial cause is a ceiling violation, use the more specific
`ceiling-denied` result rather than the generic `eligibility-denied`
result. Public results never expose internal graph implementation
details.

`approver-not-independent` (structural semantics, SCR-W12-003): an
untrusted operand attempted to assert or transport a trusted operator
role (approver, issuer, or revocation authority); no trusted operator
role — including the revocation-authority role — can ever be conferred by
any operand, artifact field, annotation, validation record, digest
possession, or transported proposal. The approver role, the issuer role,
and the revocation role are all host-injected only. No per-artifact
producer comparison exists. (SCR-W12-S2-001: the token name is unchanged
for taxonomy stability; the category covers transport of ANY trusted
operator role.)

## 14. Authority model

For every mutating operation, the complete conjunction:

1. host-injected runtime-genuine trusted v2 configuration (WP-6
   genuineness machinery), 2. configured/validated workspace and registry
   context, 3. accepted validated subject (Decision 3) with exact
   `ValidationRecord`, 4. host-asserted trusted operator role appropriate
   to the operation (approver/issuer/revocation/grant/activation), 5. no
   conflicting/missing lifecycle state (fail closed), 6. ceiling/policy
   intersection (WP-6/WP-4), 7. the injected control-plane command
   boundary and WP-8 store boundary.

No operation is authorized by an artifact alone, an `AuthorityPolicy`
alone, a command payload alone, a repository file, a model instruction,
possession of a digest, existence of an `ApprovalRecord` alone, a caller
assertion of trust, or a caller-supplied role string; caller-supplied
role assertions are ignored/rejected (SCR-W12-003).

CLIENT / UNTRUSTED OPERAND: subject identity, workspace selector, purpose/
use-class, validation-evidence references, reservation/grant references,
reason strings; Slice 2 additionally: revoke target record type/ID, revoke
scope, effective point, reason code, and — for
`verifyCurrentLifecycleState` — the registry-context correlation echo,
consumer-support declaration, and requested capability requirements
(§25 C3; all exact-key validated; the registry echo is a correlation
operand only and never selects trusted registry state).
HOST-INJECTED TRUSTED CONTEXT: configuration, ceilings, registry context,
store boundary/locks, approver role, operator identity, resolver/evidence
factories. Untrusted operands can never supply store roots, configuration,
record provenance, approver authority, ceilings, lock/evidence objects, or
activation authority (exact-key request validation at the boundary).

## 15. WP-8 storage / lock / atomicity model

- WP-12 consumes `src/storage` unchanged: `publishRecord` for append-only
  record publication (including its mechanical `authorized-write` audit
  event at the WP-8 operation durability point, D-6), retention classes,
  and registry context. WP-8 writer locks (acquire/release with recovery
  guards) are used only in their existing internal role inside
  `publishRecord` and by WP-8's own recovery/retention paths; WP-12
  decision operations do NOT acquire WP-8 writer locks themselves — the
  WP-12 decision coordination lock is host-side/process-level only
  (FSCR-W12-001, next bullet). WP-12 does NOT publish
  `AuthoritativeAuditEvent` records: the audit class is not a general
  primary-publishable lifecycle record in WP-8 (production is
  `reconstruction-only`/`write-audit` only; full AUD-001 is partial,
  D-12) and no WP-12 audit-write API is invented (SCR-W12-001).
- **Decision coordination lock (host-side / process-level).** Each
  mutating WP-12 decision runs under a WP-12 decision coordination lock
  that is HOST-OWNED and PROCESS-LEVEL: a logical serialization mechanism
  keyed by the relevant lifecycle decision key
  (subject/workspace/scope/reservation as applicable), held by the
  trusted control-plane process across the current-state
  read/revalidation and the required `publishRecord` calls. It is NOT a
  second WP-8 writer lock, NOT a custom filesystem lock file inside the
  WP-8 `locks/` directory, NOT a new WP-8 layout artifact, NOT a
  modification of `src/storage/locks`, NOT a nested acquisition of the
  existing WP-8 writer lock, and NOT a new persistence protocol; it MUST
  NOT create any new filesystem entry under the WP-8 `locks/` layout
  (FSCR-W12-001). Fixed lock order: (1) acquire the host-side WP-12
  decision coordination lock; (2) read/re-read current trusted state;
  (3) revalidate ALL decision inputs (approval/issuance/grant/revocation
  state, ceilings, registry context — never a stale pre-lock snapshot);
  (4) invoke `publishRecord` as needed — `publishRecord` internally
  acquires and releases its existing WP-8 filesystem writer lock and is
  never manually nested or re-entered by WP-12; (5) verify durable
  outcomes per WP-8; (6) release the coordination lock. The reverse
  order is never used. The coordination lock prevents competing WP-12
  decisions over the same lifecycle key while WP-8 publication retains
  its accepted internal locking behavior unchanged.
- Single-record operations (`recordValidation`, `approve`, `issue`,
  `revoke`, RuntimeGrant publication): WP-8 per-record
  publication/crash behavior is inherited unchanged.
- Multi-record activation (SCR-W12-005): an accepted activation is TWO
  durable publications under the same coordination lock —
  `ActivationRecord(accepted)` first, then `ExecutionOccurrenceRecord`
  with the exact same reserved occurrence identity — not one grouped
  transaction. If the system crashes after `ActivationRecord(accepted)`
  is durable but before the occurrence is durable: the store contains an
  incomplete activation transition; the lifecycle graph fails closed
  (EXE-003 or applicable accepted finding); no Pi execution may begin; no
  WP-5B activation evidence may be treated as complete; no new activation
  decision may be created for that reservation. Recovery (the only
  protocol-legal repair): under the same coordination lock, after
  verifying exactly one accepted `ActivationRecord` exists for the exact
  reserved occurrence ID, no competing `ActivationRecord` exists, no
  `ExecutionOccurrenceRecord` exists for that occurrence, and
  grant/subject/workspace/registry correlation matches the accepted
  activation, the control plane MAY append ONLY the missing
  `ExecutionOccurrenceRecord` using the exact already-reserved occurrence
  ID. Recovery must NOT create a second activation, allocate a new
  occurrence ID, change accepted → denied, re-decide authority, widen the
  grant, retry execution, or execute Pi. If state is ambiguous or
  conflicting, fail closed and require operator/recovery handling.
- `ActivationRecord(denied)` is a single historical record transition; no
  occurrence is produced; it remains terminal under the accepted ADR-011
  semantics.
- Mechanical WP-8 audit failure follows WP-8's existing
  `recoveryRequired`/verify-before-retry semantics; a missing mechanical
  audit is never permission to duplicate a lifecycle record.
- Ordering: primary record publication first; the mechanical
  `authorized-write` audit event is produced by `publishRecord` at the
  operation durability point (D-6). WP-8 crash/restart behavior (locks,
  recovery guards, durable writes) is inherited, not redesigned.
- Partial failure: typed result; WP-8 guarantees atomic/durable behavior
  PER published record, not across multiple `publishRecord` calls; a
  failed append leaves no half-record for that single record; multi-record
  transitions define their partial-state interpretation explicitly
  (above); operations are not retried automatically (replay rules apply).
- No project-file lifecycle records; lifecycle state exists only in the
  trusted store.

## 16. Selected first slice

**WP-12 Slice 1 — transport-free approval and issuance decision core.**

- Objective: one precise capability — trusted-local approval and issuance
  decisions over validated canonical artifact revisions (including
  ExecutionBundle), persisted as immutable store records, fail-closed.
- Request model (untrusted operands): operation (`approve` | `issue` |
  `recordValidation`), canonical subject identity (Decision 3), workspaceId,
  purpose/use-class, validation-record references, reason (bounded);
  exact-key shape validation.
- Trusted context (host-injected): runtime-genuine v2 configuration (WP-6),
  store boundary (WP-8), approver/issuer role + operator identity, registry
  context, validated subject evidence (exact revision bytes + digest
  verification via accepted digest computation), and the accepted WP-4
  validation run result — the host-injected trusted validation-evidence
  operand of `recordValidation`, using the existing WP-4
  validation-result/report types and fields (SCR-W12-004).
- Subject form: Decision 3 (validated canonical revision; bundle included).
- Authority conjunction: §14 (all seven factors; approver independence
  is structural — the host-asserted role, SCR-W12-003).
- Lifecycle checks: LFC-001/002 (approval requires valid `ValidationRecord`),
  LFC-003 (issuance requires matching active approval, same subject/
  workspace), current revocation/conflict state, ceiling eligibility.
- Records produced: `ValidationRecord` (recording of the accepted WP-4
  run result), `ApprovalRecord`, `IssuanceRecord`. Each publication
  receives the WP-8 mechanical authorized-write audit event (D-6); WP-12
  publishes no `AuthoritativeAuditEvent` records (SCR-W12-001).
- Audit behavior: successful record-producing operations receive the
  WP-8 mechanical authorized-write audit event produced by `publishRecord`
  at the operation durability point (D-6) — no separate WP-12 audit
  write. Denied/non-record-producing operations create NO lifecycle
  record and NO `AuthoritativeAuditEvent`; the host MAY emit
  non-authoritative operational logging, which is not lifecycle state,
  not authorization evidence, and never a lifecycle prerequisite
  (SCR-W12-001, §15).
- Lock/atomicity: host-side, process-level WP-12 decision coordination
  lock (§15), keyed by the lifecycle decision key, distinct from
  `publishRecord`'s internal WP-8 writer lock (never nested or
  re-entered; no new entry under the WP-8 `locks/` layout —
  FSCR-W12-001); fixed lock order (acquire coordination lock → read state
  → revalidate → publishRecord → verify durability → release); revalidate
  all decision inputs under the coordination lock before publication
  (SCR-W12-005).
- Result taxonomy: §13 subset (request-invalid, subject-invalid,
  subject-not-validated, approver-not-independent, eligibility-denied,
  ceiling-denied, lifecycle-state-missing, lifecycle-conflict,
  already-approved, approval-revoked, issuance-not-authorized,
  already-issued, registry-context-mismatch, store-failure, lock-conflict,
  internal-failure); redacted.
- Mutation scope: trusted store records only; zero project-file, Git,
  config, MCP, or execution mutation.
- Prohibited: revocation, grants, activation, orchestration, receipts,
  MCP registration, generic filesystem API, Pi/pi-guard, self-approval,
  repository-derived decisions.
- Minimum tests: approval-without-validation denied (LFC-001/002);
  issuance-without-approval denied (LFC-003); issuance-approval subject/
  workspace mismatch denied; role-assertion rejection (an untrusted
  operand attempting to supply or transport the approver role is
  rejected; the role is host-asserted — SCR-W12-003); exact digest-bound
  subject (mutation of one byte → different subject → no record);
  duplicate approval → already-approved; issuance after revoked approval →
  approval-revoked; missing store state → lifecycle-state-missing;
  ceiling denial; registry-context mismatch; redaction serialization;
  mutation scope (store-only snapshot); hostile request shapes; replay/
  stale evidence; record publication yields the WP-8 mechanical
  write-audit behavior; a denied operation creates zero lifecycle records
  and zero `AuthoritativeAuditEvent` records; optional host operational
  logging never affects lifecycle state (SCR-W12-001); re-validation
  under a new registry snapshot with an unchanged artifact digest is NOT
  blocked as a duplicate (full evidence correlation differs —
  SCR-W12-004); genuine happy-path approve→issue with real store; run
  twice; static guards (no fs/network/process/Git/MCP in the pure core;
  node:fs only in the store boundary consumer).
- Review gate: lifecycle-state separation; fail-closed matrix;
  record integrity; reuse proof (WP-4 graph + WP-8 publication invoked,
  no second evaluator/store/digest); mutation scope; redaction; security
  guards; API-surface review; independent review with findings format.

**Remaining WP-12 slices:** Slice 2 — revocation + current-state
verification; Slice 3 — RuntimeGrant + activation + occurrence; Slice 4 —
execution-orchestration decision surface + attempt recording (§4).

## 17. WP-12 closure criteria (restated)

Roadmap gate: "All lifecycle decisions external to repository content; fail
closed on missing state", satisfied across Slices 1-4, plus the eight
trusted-lifecycle-protocol handoff criteria (§4), plus: WP-5B-required
RuntimeGrant/activation evidence exists (Slice 3); WP-13-required
orchestration decisions and attempt-recording surface exist (Slice 4);
no execution, pi-guard activation, receipt issuance, or project-file
lifecycle state exists in WP-12.

## 18. WP-5B handoff contract

WP-5B receives: activation decision evidence + `RuntimeGrant` identity +
reserved occurrence identity (ADR-027 fields) from WP-12 Slice 3, and the
`verifyCurrentLifecycleState` evidence form for pre-activation checks.
WP-5B must independently fail closed on tool-inventory drift, unverified
pi-guard versions, missing/ambiguous activation evidence, and authority
expansion. WP-5B must not invent approval/grant/activation semantics
(ADR-023). WP-12 never activates pi-guard.

## 19. WP-13 handoff contract

WP-13 receives: orchestration decision evidence + accepted activation/
occurrence identity + `recordExecutionAttempt` operation (Slice 4), and
exact identity/digest-bound lifecycle authorization evidence per Decision
3/§5 (bundle protocol/kind/instance/revision/digest, workspace, registry
context, approval/issuance/grant/activation/occurrence identities).
WP-13 owns execution, attempt ordering, result production, and (with
WP-15) receipt facts — and, per SCR-W12-002 (§5), acquisition and
cryptographic correlation of the exact canonical ExecutionBundle content
through a future WP-13-authorized host content source; WP-12 is not an
artifact-content store and hands over identity/digest evidence only.
WP-13 fails closed on missing lifecycle state (ADR-002 l.40) and on
missing, ambiguous, stale, mismatched, or unverifiable bundle content.
WP-12 never executes.

## 20. Contract consistency review results

- Self-approval loopholes: closed — approval authority exists only in
  the host-asserted trusted-local approver role; ChatGPT can never hold
  the role (structural independence, SCR-W12-003); no producer-identity
  field is invented.
- Repository-driven authority: closed — identity is digest/record-bound;
  paths and repository content have no effect; lifecycle state only in the
  trusted store.
- Approval/issuance collapse: closed — separate records, LFC-003 enforced.
- Grant/activation collapse: closed — separate records; grant never
  activates; activation never grants (ADR-011).
- Execution leaking into WP-12: closed — WP-12 owns decisions/records only.
- Lifecycle persistence in project files: closed — store-only.
- ExecutionBundle dead-end: resolved — bundle approvals/issuance/activation
  operate on validated revision identity without WP-11 persistence; WP-11
  unchanged; validated bundle content acquisition/correlation is
  WP-13-owned (SCR-W12-002).
- Missing current-state verification surface: resolved — Decision 5.
- Replay/staleness ambiguity: resolved — revalidation under lock; fresh
  reservation per activation; deterministic denial taxonomy.
- Ungrounded transport authority: resolved — Decision 1 (transport-free
  core; no MCP; CLI optional adapter).
- WP-5B/WP-13 handoff ambiguity: resolved — §18-19.
- Audit contract: corrected — record-producing operations rely on the
  WP-8 mechanical write-audit (D-6); denials create no authoritative audit
  record (SCR-W12-001, §15).
- Multi-record atomicity: corrected — decision coordination lock; the
  activation pair's partial state fails closed with a single
  protocol-legal recovery (SCR-W12-005, §15).
- Validation recording: corrected — `recordValidation` is bound to the
  accepted WP-4 run result; caller-supplied outcomes are rejected
  (SCR-W12-004, §22).
- Supersession ownership: corrected — no `SupersessionRecord` production
  in WP-12 S1-S4 (SCR-W12-006, §9).
- Record subject/workspace binding: corrected — workspaceId is a required
  record-subject component, not intrinsic revision identity
  (SCR-W12-008, §5).

All check items pass. No unresolved blocker remains within the corrected
decision set; the future WP-8 full-AUD-001 completion and WP-13 bundle
content acquisition are explicit out-of-contract items requiring their
own separate authorization (§22).

## 21. ADR policy note

No new ADR is created by this phase. The decisions resolve WP-12-owned
contract questions within the scope of accepted ADR-002/ADR-011/ADR-023/
ADR-027 and the trusted-lifecycle-protocol; none changes or establishes a
cross-work-package architectural boundary outside that accepted scope
(the MCP prohibition maintains the WP-9 boundary; the ExecutionBundle
subject form interprets ADR-002/011 within their terms). If the senior
contract review judges that any decision requires ADR elevation, that is a
separate human authorization; this document records the request point.
The focused correction record (§22) confirms: no new ADR is required —
WP-13 bundle content acquisition is a handoff refinement of the accepted
ownership boundary; structural approver independence is the accepted
ADR-002 boundary with no new record fields; WP-8 full-AUD-001 completion
would require separate authorization when pursued.

## 22. Focused senior-contract-review correction record

Applied per the focused WP-12 pre-implementation contract-correction
authorization; resolves the senior-contract-review findings. This section
is authoritative over the original wording it supersedes; superseded
locations are listed per finding. No ADR was created; no source, test,
schema, fixture, package, lockfile, tsconfig, script, runtime
configuration, or WP-8/WP-11 contract was changed. The review contains no
finding SCR-W12-007; no such ID is addressed here. Final precision
findings FSCR-W12-001 and FSCR-W12-002, raised by the focused senior
rereview and CLOSED by Revision 3, are recorded at the end of this
section.

### SCR-W12-001 — audit contract (MAJOR) — RESOLVED

- Authoritative audit scope: record-producing operations receive the WP-8
  mechanical `authorized-write` audit event produced by `publishRecord`
  at the operation durability point (D-6). WP-12 publishes no separate
  `AuthoritativeAuditEvent` record; `AuthoritativeAuditEvent` is not a
  general primary-publishable lifecycle record in WP-8 (production
  `reconstruction-only`/`write-audit`; full AUD-001 is partial, D-12).
- Denied/non-record-producing decisions: no lifecycle record, no
  `AuthoritativeAuditEvent`; host-side non-authoritative operational
  logging MAY exist but is not lifecycle state, not authorization
  evidence, and never a lifecycle prerequisite; its absence changes
  nothing.
- WP-8 unchanged: no WP-12 audit-write API is invented; full
  decision-level/denial-level authoritative audit is NOT part of the
  currently authorized WP-12 contract; completing WP-8 phase-4/full
  AUD-001 would require separate authorization, and WP-12 does not depend
  on it for Slice 1 implementation or closure.
- Superseded wording: §4 slice-table "+ `AuthoritativeAuditEvent`" /
  "+ audit" record productions; §6B deny/cancel bullet; §8 matrix Audit
  column; §9 `AuthoritativeAuditEvent` row; §10 audit bullet; §15
  previous bullets 2-3 ("append audit event(s)"; "record first, audit
  correlation second"); §16 records-produced and audit-behavior bullets
  and the minimum-test "audit event presence and immutability".

### SCR-W12-002 — ExecutionBundle content handoff (MAJOR) — RESOLVED

- WP-12 S3/S4 evidence binds exact bundle identity/digest (protocol/
  kind/instance/revision/digest, workspace, registry context, approval/
  issuance/grant/activation/occurrence/orchestration identities).
- WP-12 does NOT retain or publish the canonical bundle bytes and is not
  an artifact-content store; WP-8 stores no bundle content; WP-11 gains
  no ExecutionBundle persistence (unchanged).
- WP-13 owns acquisition of the exact canonical bundle content (future
  WP-13-authorized host content source) and MUST recompute/verify the
  accepted canonical digest, verify protocol/kind/instance/revision
  identity, match identity and digest EXACTLY to WP-12 evidence, and fail
  closed on missing/ambiguous/stale/mismatched/unverifiable content.
  Path, filename, repository presence, and `latest` lookup are never
  bundle authority.
- Superseded wording: §5 final ExecutionBundle bullet ("WP-13 receives
  … validated revision content from the trusted subject evidence"); §12
  item 2; §19 content-handoff sentence.

### SCR-W12-003 — approver independence (MODERATE) — RESOLVED

- Approver independence is structural: approval authority exists only in
  the host-asserted trusted-local approver role, unavailable to
  ChatGPT/model command operands; caller-supplied role strings, artifact
  fields, annotations, validation records, digest possession, and
  transported proposals cannot confer the role.
- No producer-identity field is invented; the accepted corpus defines no
  trusted producer identity, and no per-artifact producer comparison
  exists. The ADR-002 non-self-approval invariant holds because ChatGPT
  can never possess the trusted approver role.
- Actor: host-owned operator principal for operational attribution only;
  Slice 1 defines no delegation and delegation is not authorized; service
  automation does not receive the approver role in Slice 1; the default
  Slice-1 approver authority is a trusted local human/operator boundary.
- Superseded wording: §6B producer/approver-independence bullet; §16
  authority-conjunction bullet and minimum-test "approver=producer
  denied"; §20 self-approval bullet; §13 `approver-not-independent`
  semantics (now structural).

### SCR-W12-004 — recordValidation binding (MODERATE) — RESOLVED

- `recordValidation` receives the WP-4 result ONLY through host-injected
  trusted validation evidence (the existing WP-4 validation-result/report
  types and fields); it correlates the result to the exact digest-verified
  canonical subject and derives every recorded `ValidationRecord` field
  (validator profile, structural/semantic outcomes, registry reference,
  findings) from that result.
- It rejects caller-supplied validation conclusions, mismatched
  subject/digest/registry context, and unsupported/unknown result forms;
  never changes a WP-4 denial into success; never creates validation
  authority from a command payload. "Assessment outcome" is not an
  untrusted request operand. Failure mapping (FSCR-W12-002, closed
  taxonomy): evidence-to-subject correlation failures → `subject-invalid`;
  unsupported/malformed evidence forms → `request-invalid`; a validly
  shaped subject/evidence pair whose trusted accepted registry context
  differs from the required operation context →
  `registry-context-mismatch`.
- Duplicate semantics: an exact duplicate is a conflict only when the
  full accepted evidence correlation is identical (subject, digest,
  registry snapshot/context, validator profile/version, validation-result
  identity); a later legitimate run under a new snapshot or profile is a
  new record. `ValidationRecord` remains non-authorizing; approval still
  requires the accepted lifecycle prerequisites.
- Superseded wording: §8 `recordValidation` row subject and
  idempotency/replay cells; §16 trusted-context bullet (now names the
  accepted WP-4 run result).

### SCR-W12-005 — multi-record atomicity + lock composition (MODERATE) — RESOLVED

- WP-12 decision coordination lock: HOST-SIDE / PROCESS-LEVEL decision
  serialization only — host-owned, keyed logically by the relevant
  lifecycle decision key (subject/workspace/scope/reservation as
  applicable), never a WP-8 filesystem lock artifact and never a new
  entry under the WP-8 `locks/` layout (FSCR-W12-001) — with fixed order:
  acquire
  coordination lock → read state → revalidate → `publishRecord` (which
  manages its own internal writer lock) → verify durable outcomes →
  release. Reverse order never used; the internal `publishRecord` lock is
  never held manually while calling `publishRecord`.
- Single-record operations inherit WP-8 per-record behavior unchanged.
- Accepted activation = two durable publications (`ActivationRecord`
  then `ExecutionOccurrenceRecord`, same reserved ID) under one
  coordination lock; crash between them leaves an incomplete transition
  that fails closed (graph EXE-003 or applicable finding), blocks Pi
  execution and complete WP-5B evidence, and forbids a new decision for
  that reservation. The only protocol-legal repair is appending the
  missing occurrence under the coordination lock after the stated
  verifications; recovery never creates a second activation, a new
  occurrence ID, accepted→denied changes, authority re-decision, grant
  widening, retries, or Pi execution. Ambiguous/conflicting state fails
  closed for operator/recovery handling.
- `ActivationRecord(denied)` is a single historical record transition;
  mechanical audit failure follows WP-8 `recoveryRequired`/
  verify-before-retry semantics and never permits duplicating a lifecycle
  record.
- Superseded wording: §11 atomicity bullet; §15 previous bullets 2-4;
  §16 lock/atomicity bullet; §8 matrix locking column.

### SCR-W12-006 — SupersessionRecord ownership (MINOR) — RESOLVED

- WP-12 S1-S4 introduces no `SupersessionRecord` production; WP-12 MAY
  consume applicable `SupersessionRecord` state in current-state
  evaluation; result-instance supersession remains ADR-012/result-
  publisher ownership; any future lifecycle-authority supersession
  operation requires an explicit later contract decision. Production
  ownership is never inferred from taxonomy existence.
- Superseded wording: §9 `SupersessionRecord` row.

### SCR-W12-008 — record subject/workspace binding (MINOR) — RESOLVED

- workspaceId is not part of the artifact's intrinsic revision identity
  but IS an exact required component of the lifecycle record
  subject/binding per the accepted protocol forms (fixtures place
  `workspace_id` inside `subject`); implementations follow the actual
  protocol record schemas/fixtures, not explanatory tuple prose.
- Superseded wording: §5 "plus operation scope" paragraph (now followed
  by the binding-precision statement).

### Error-taxonomy precision (non-blocking) — RESOLVED

- `activation-denied` is a WP-12 operational result category; an EXE-*
  finding is cited only where `validateLifecycleGraph` actually emits it.
- Precedence: a concrete WP-6 ceiling violation → `ceiling-denied`; other
  policy/lifecycle/consumer intersection failures → `eligibility-denied`;
  the more specific `ceiling-denied` wins when the explicit cause is a
  ceiling violation. Public results never expose internal graph
  implementation details.
- Superseded wording: §13 tokens and closing paragraph.

### FSCR-W12-001 — coordination lock precision (MINOR) — CLOSED

The WP-12 decision coordination lock is HOST-SIDE / PROCESS-LEVEL
decision serialization only: host-owned, keyed logically by the relevant
lifecycle decision key (subject/workspace/scope/reservation as
applicable), and held across current-state read/revalidation and the
required `publishRecord` calls. It is NOT a second WP-8 writer lock, NOT
a custom filesystem lock file inside the WP-8 `locks/` directory, NOT a
new WP-8 layout artifact, NOT a modification of `src/storage/locks`, NOT
a nested acquisition of the existing WP-8 writer lock, and NOT a new
persistence protocol. The coordination mechanism MUST NOT create any new
filesystem entry under the WP-8 `locks/` layout. `publishRecord` remains
unchanged and owns its existing filesystem writer lock internally;
activation recovery semantics are unchanged. Superseded wording: §15
"built on the accepted WP-8 lock substrate"; §11 "over the WP-8 lock
substrate"; §16 and §8 matrix locking cells (now "host-side coordination
lock").

### FSCR-W12-002 — validation-evidence error token (MINOR) — CLOSED

`validation-evidence-invalid` is removed; it is not part of the closed
result taxonomy. The `recordValidation` failure mapping uses the closed
tokens: `subject-invalid` for accepted WP-4 evidence whose subject does
not correlate with the requested/canonical subject (digest,
protocol/kind/instance/revision mismatch; registry-context mismatch that
is fundamentally evidence-to-subject correlation); `request-invalid` for
unsupported WP-4 validation-result representation and malformed or
uninterpretable command/reference shapes; `registry-context-mismatch`
when the subject/evidence pair is validly shaped but the trusted accepted
registry context differs from the required operation context. Internal
WP-4 report structures are never exposed in public results. Superseded
wording: §8 `recordValidation` failure-mode cell.

## 23. References

`docs/design/post-wp5a-roadmap.md:732,882-888,952,964`;
`docs/decisions/ADR-002-…:21-42`; `docs/decisions/ADR-011-…:13-42`;
`docs/design/trusted-lifecycle-protocol.md:29-300`;
`docs/decisions/ADR-012-…`; `docs/decisions/ADR-006-…`;
`docs/decisions/ADR-027-…:30-52`; `docs/design/capability-vocabulary.md:52-53`;
`docs/design/post-wp5a-planning-status.md:592-598,620-621`;
`src/lifecycle/graph.ts`; `src/api/validate.ts:403-406`;
`src/storage/format/taxonomy.ts:62-70`; `src/storage/publication/index.ts:242`;
`src/storage/locks/lock.ts`; `src/storage/audit/index.ts` (D-12: only the
`authorized-write` kind; partial AUD-001); `src/storage/publication/index.ts`
(mechanical write-audit at the durability point; audit class not
primary-publishable); ADR-029 D-6/D-12; `src/internal/report.ts` /
`src/api/types.ts` (WP-4 `ValidationReport`); `src/lifecycle/graph.ts`
(EXE-003); `fixtures/lifecycle/valid/validation-bundle.json` /
`fixtures/lifecycle/valid/approval-bundle.json` (record subject includes
`workspace_id`); closure commits `45bfd97` (WP-4),
`b07fea9` (WP-6), `db1b415`/`eb7feab` (WP-8), `9695c5d` (WP-11).

## 24. State

Focused senior contract rereview verdict: `WP-12 CONTRACT CORRECTION
ACCEPTED — READY FOR HUMAN IMPLEMENTATION AUTHORIZATION`. Accepted
finding status: SCR-W12-001 — CLOSED; SCR-W12-002 — CLOSED;
SCR-W12-003 — CLOSED; SCR-W12-004 — CLOSED; SCR-W12-005 — CLOSED;
SCR-W12-006 — CLOSED; SCR-W12-008 — CLOSED; FSCR-W12-001 — CLOSED by
final precision correction; FSCR-W12-002 — CLOSED by final precision
correction; error-taxonomy precision — ACCEPTED.

Revision 3 (final precision + closure): FSCR-W12-001 (host-side /
process-level coordination lock; no WP-8 filesystem lock artifact) and
FSCR-W12-002 (closed-taxonomy failure mapping for `recordValidation`)
applied in place; this document is committed as the WP-12
pre-implementation contract baseline. No source, test, schema, fixture,
package, lockfile, tsconfig, script, runtime configuration, WP-8/WP-11
contract, or ADR was created or modified by this phase. No push, tag,
release, publication, installation, or deployment occurred. WP-12
Slice 1 is authorized only by a subsequent explicit human implementation
authorization; this closure document does NOT start implementation.

Slice-2 focused clarification (documentation only; §25): resolves the
bounded Slice-2 clarifications C1–C6 — `target-unknown` matrix wording
removed (C1), verification result/condition model (C2), verify/revoke
request models (C3), effectiveAt/scope rules (C4), revoke coordination-key
composition (C5), and old-registry target revocation (C6). No public
taxonomy token was added; no source, test, schema, fixture, package,
lockfile, or WP-4/WP-6/WP-8/Slice-1 change was made. Left unstaged and
uncommitted for focused senior contract review.

## 25. WP-12 Slice 2 focused clarification record

**Scope:** documentation only. Resolves exactly the bounded Slice-2
clarifications C1–C6 identified by the WP-12 Slice 2 eligibility /
contract-readiness analysis. No source, test, schema, fixture, package,
lockfile, tsconfig, script, runtime configuration, WP-4, WP-6, WP-8, or
closed WP-12 Slice-1 change is made by this record. This section is
authoritative over any superseded wording it corrects; superseded
locations are listed per clarification. No public result token is added;
the §13 closed taxonomy is unchanged. No ADR is created (§21 policy note
applies: this record resolves WP-12-owned questions within accepted
ADR-002/011/012/023/025/027 and trusted-lifecycle-protocol scope).

### 25.1 Fixed Slice-2 scope (unchanged, restated)

Slice 2 = revocation + current lifecycle-state verification. Operations:
`revoke`, `verifyCurrentLifecycleState` (read-only). Primary record
production: `RevocationRecord` only. Operational revocation targets in
Slice 2: `ApprovalRecord`, `IssuanceRecord` only. `RuntimeGrant`
revocation is available only after RuntimeGrant exists (Slice 3);
`ResultPublicationRecord` revocation is a later result-publication
context. Slice 2 does NOT revoke `ValidationRecord`, `ActivationRecord`,
`ExecutionOccurrenceRecord`, `ExecutionAttemptRecord`, `TrustedReceipt`,
`SupersessionRecord`, `ExecutionSummaryRecord`, `MigrationRecord`, or
`AuthoritativeAuditEvent` (LFC-005/006; schema target enum). Preserved:
append-only history; no target mutation/deletion; no execution
cancellation semantics; no MCP/CLI/HTTP transport; no cross-process
locking; no WP-8 layout extension; one control-plane instance per store
per process (§16).

### 25.2 C1 — `target-unknown` resolved (removed, not added)

The operation-matrix token `target-unknown` (§8 `revoke` row, former
failure-mode cell) is stale matrix wording: it is absent from the §13
closed taxonomy, is NOT added to it, and no revocation-specific or
verification-specific public token is created. Normative revoke failure
mapping (closed categories only):

| Condition | Public result |
|---|---|
| A. Syntactically valid target record ID does not exist | `lifecycle-state-missing` |
| B. Target exists but is outside the host-authorized workspace/context | `lifecycle-state-missing` (the existence of an out-of-scope target is never disclosed) |
| C. Target class is structurally valid but not an operationally revocable Slice-2 class (e.g., ValidationRecord, ActivationRecord, ExecutionOccurrenceRecord, other immutable historical fact) | `request-invalid` |
| D. Malformed target identifier or malformed target type | `request-invalid` |
| E. Matching target already revoked for the exact applicable target/scope | `lifecycle-conflict` |
| F. Store lookup/integrity failure (unreadable, recovery-required, malformed envelope/payload) | `store-failure` |
| G. Registry-context echo differs from the host current accepted context | `registry-context-mismatch` |
| H. Registry-context echo missing or malformed | `request-invalid` |

This closes the stale matrix/taxonomy discrepancy without expanding the
closed taxonomy. §8 `revoke` row corrected accordingly.

The registry-context echo is a REQUIRED untrusted operand of the revoke
request (SCR-W12-S2-003): missing or malformed → `request-invalid`;
differing → `registry-context-mismatch`. It never selects, downgrades,
overrides, or authorizes registry context — the authoritative registry
context remains host-injected.

### 25.3 C2 — `verifyCurrentLifecycleState` result model

`verifyCurrentLifecycleState` is a READ-ONLY FAIL-CLOSED VERIFIER.
SUCCESS means the requested lifecycle state is CURRENT AND USABLE for the
exact requested subject/workspace/scope/capability context at the
completed evaluation. No success result whose semantic meaning is
"verified successfully, but current=false" exists for authority-relevant
state; non-current/unusable state returns an existing typed failure
(25.4). Success creates no transferable authority.

Success evidence is a bounded non-authorizing object containing only:
canonical subject identity; workspaceId; requested purpose or useClass;
exact current `ApprovalRecord` ID where required; exact current
`IssuanceRecord` ID where required; exact registry snapshot reference
(id + digest); verification time from the trusted host time source; and
bounded derived facts showing the required chain was present,
non-revoked, non-expired, and registry-matching, plus the
capability/ceiling/consumer-support evaluation outcome. NOT added:
snapshot ID, verification evidence ID, freshness token, transferable
grant, role token, evidence expiry, store path, raw record payload
collection — none are required by the accepted contract.

### 25.4 C2 — exact verification failure mapping

APPROVAL-LEVEL: no matching/current approval → `lifecycle-state-missing`;
matching approval explicitly revoked → `approval-revoked`; matching
approval expired → `lifecycle-state-missing`; multiple CURRENT matching
approvals → `lifecycle-conflict`.

ISSUANCE-LEVEL: no matching/current issuance → `issuance-not-authorized`;
matching issuance revoked → `issuance-not-authorized`; matching issuance
expired → `issuance-not-authorized`; required matching approval
missing/non-current: explicitly revoked approval → `approval-revoked`,
otherwise no usable current approval → `issuance-not-authorized`;
multiple CURRENT matching issuances → `lifecycle-conflict`.

COMMON: registry-context mismatch → `registry-context-mismatch`; concrete
WP-6 ceiling violation → `ceiling-denied`; consumer-support / requested-
capability / policy eligibility denial → `eligibility-denied`;
unknown-but-well-formed requested capability → `eligibility-denied`;
unknown workspace / required lifecycle state unavailable →
`lifecycle-state-missing`; malformed request → `request-invalid`;
malformed subject → `subject-invalid`; store/integrity/recovery/
unreadable-state failure → `store-failure`; unexpected internal failure →
`internal-failure`.

NOT created: `approval-expired`, `issuance-revoked`, `non-current`,
`target-unknown`, `snapshot-stale`, or any other new public token.

### 25.5 C3 — `verifyCurrentLifecycleState` request model

Transport-free, host-composed, exact-key request variants. Untrusted
request data may contain only: COMMON: operation; canonical subject;
workspaceId; exact registry-context echo/reference;
capabilityRequirements; consumerSupport — PLUS exactly one scope form:
APPROVAL FORM (`purpose`) or ISSUANCE FORM (`useClass`); `purpose` and
`useClass` MUST NOT both be supplied. Existing accepted enums/types are
used (Slice-1 purpose/use-class vocabulary; `ConsumerSupportDeclaration`
form); no new scope vocabulary is invented.

REGISTRY CONTEXT: the request-side registry value is an UNTRUSTED
CORRELATION ECHO only; it never defines trusted registry state. The
authoritative accepted registry context is HOST-INJECTED. The echo is a
REQUIRED untrusted operand: missing or malformed → `request-invalid`;
the operation compares the operand echo against the host-injected
accepted registry context and a differing echo →
`registry-context-mismatch`. The request may not replace, configure,
select, downgrade, or override the authoritative registry.

CONSUMER SUPPORT: `ConsumerSupportDeclaration` is untrusted declarative
input describing what the requesting consumer claims to support; it
creates no lifecycle authority. CAPABILITY REQUIREMENTS: the requested
capability set is untrusted operands. Capability identifiers follow the
accepted `project-gateway.<class>` convention and the accepted capability
vocabulary/parser rules; no second capability grammar is invented
(SCR-W12-S2-005). MALFORMED capability identifier (fails the accepted
capability identifier syntax) → `request-invalid`. WELL-FORMED but
UNKNOWN/UNSUPPORTED capability identifier → `eligibility-denied`
(accepted deny-wins / unknown-denied point-of-use semantics). KNOWN
capability denied by a current host ceiling → `ceiling-denied`. KNOWN
capability incompatible with consumer support/policy →
`eligibility-denied`. No `unknown-capability` or other new token is
added. Current WP-6 ceilings are always host-injected and re-evaluated.

### 25.6 C3 — `revoke` request model

Exact-key revoke request operands (repository naming conventions):
`operation = revoke`; `workspaceId`; target record type; target record
ID; `scope`; `effectiveAt`; `reasonCode`; registry-context echo/reference
(REQUIRED untrusted operand; missing/malformed → `request-invalid`;
differing → `registry-context-mismatch` — SCR-W12-S2-003).
HOST-INJECTED trusted context: genuine WP-6 configuration; trusted
workspace; accepted registry context; revocation-authority role;
operator identity; trusted time source; WP-8 store boundary;
process-local coordinator; record-ID source; write-action provenance.
The request must NOT supply: revocation role, operator authority, store
boundary, config, ceilings, trusted registry context, record provenance,
lock object, or audit authority. Caller attempts to assert/transport
trusted role authority continue to use the existing structural
`approver-not-independent` category; `revoker-not-independent` is NOT
added.

### 25.7 C4 — effectiveAt semantics

`effectiveAt` must be an accepted protocol timestamp; it MAY be in the
future (no invented bounded future window); it becomes effective when
`effectiveAt <= trustedNow`; equality counts as effective. The existing
host-injected trusted time source is used; ambient `Date.now()` is not a
new authority source. A future-dated `RevocationRecord` is a valid
historical/authoritative record and is not yet effective for currentness
evaluation; no mutation of the target occurs at the effective point;
currentness is always derived. Malformed `effectiveAt` → `request-invalid`.

### 25.8 C4 — revocation scope rules

The accepted schema scope enum is unchanged. Slice 2 validates
target-class applicability operationally: for `ApprovalRecord` /
`IssuanceRecord` targets, permitted scopes are `all-uses` and
`execution-use`; publication/result-only scopes (`ordinary-review`,
`completion-status`, `downstream-automation`, `authoritative-reporting`)
used against an approval/issuance target → `request-invalid`. A
meaningless scope is never reinterpreted as `all-uses`. This is
operation-level semantic validation only.

SCOPE APPLICATION: a `RevocationRecord` applies when target record ID
matches exactly AND scope is `all-uses` OR matches the requested
lifecycle use AND `effectiveAt <= trustedNow`. `reasonCode` is
descriptive metadata only and MUST NOT change applicability, authority,
scope, priority, or currentness.

### 25.9 C5 — revoke coordination-key composition

The closed Slice-1 host-side/process-local coordinator is reused; no new
lock system. Two-stage read discipline:

PRE-LOCK LOCATOR READ: read the target record only to obtain the exact
target, its canonical lifecycle subject/workspace correlation, and the
lifecycle coordination key. The pre-lock read is NOT final decision
authority. Target absent → `lifecycle-state-missing`; target malformed/
unreadable → `store-failure`; target outside the trusted workspace →
`lifecycle-state-missing`.

COORDINATION KEY: the same subject/workspace lifecycle-key family as the
closed Slice-1 operations (the canonical target subject identity
dimensions used by the Slice-1 lifecycle decision key), so revoke
competes correctly with approve/issue for the same lifecycle subject. A
target-record-ID-only lock key is NOT used where it would allow
`revoke(ApprovalRecord A)` and `issue(subject of A)` to hold different
locks.

UNDER LOCK (after acquiring the process-local coordination lock): (1)
re-read the target; (2) re-read relevant `RevocationRecord`s; (3)
revalidate target class; (4) revalidate workspace; (5) revalidate scope;
(6) revalidate the current accepted host context; (7) detect an existing
applicable revocation; (8) build the candidate `RevocationRecord`; (9)
run the accepted schema/lifecycle checks; (10) publish exactly one
`RevocationRecord` through WP-8; (11) verify the durable result; (12)
release in `finally`. Stale pre-lock state never decides the revocation.
Fail-fast semantics preserved: overlapping same-key operation →
`lock-conflict`; no queue requirement; no WP-8 filesystem lock artifact
(FSCR-W12-001).

### 25.10 C6 — revocation of a historical record from an old registry context

TARGET RECORD CONTEXT vs NEW REVOCATION DECISION CONTEXT are distinct. A
genuine existing `ApprovalRecord`/`IssuanceRecord` created under an older
registry snapshot MAY be revoked; the operation does not require the
historical target's own `registry_snapshot_reference` to equal the
current accepted registry context merely for the target to be revocable.
The target identity remains exact and immutable. The NEW `RevocationRecord`
MUST bind the CURRENT host-injected accepted registry context, and the
request-side registry echo is REQUIRED and must match that current
accepted context (missing/malformed → `request-invalid`; differing →
`registry-context-mismatch`; SCR-W12-S2-003). This
allows trusted-local authority to revoke an old historical usability
record without pretending the old record was created under the new
registry. NOT done: rewriting target registry metadata; migrating the
target; treating revocation as registry migration; requiring target
re-issuance before revocation. At point of use, the new `RevocationRecord`
itself must satisfy the current accepted registry-context rules
applicable to the evaluation (REG-001/002/008, LFC-010). Verification
currentness and revocation targetability are different questions (§15
distinction retained).

### 25.11 Revocation target semantics

Slice-2 successful revoke publishes exactly one `RevocationRecord`, leaves
the target byte-for-byte unchanged, produces the WP-8 mechanical
write-audit only, and creates no additional lifecycle record. Repeat same
applicable target+scope → `lifecycle-conflict`. Revocation is append-only
and one-way. Revocation does NOT: erase an `ApprovalRecord`/`IssuanceRecord`,
delete any store object, create a new approval/issuance, create a
`RuntimeGrant`, create an activation, cancel Pi, cancel an
`ExecutionOccurrence`, revoke a `ValidationRecord`, or create a
`SupersessionRecord`. Re-approval/re-issuance remains a new later trusted
command and a new record, consistent with the closed Slice-1 behavior.

### 25.12 Currentness rules (per class)

No single naïve generic `current()` rule applies to every class.
APPROVAL CURRENTNESS: usable only when exact subject matches; exact
workspace matches; requested purpose matches; the accepted
`ValidationRecord` chain is available as required; no applicable effective
`RevocationRecord`; not expired; exact accepted registry context matches;
no lifecycle conflict/ambiguity. ISSUANCE CURRENTNESS: usable only when
exact subject matches; exact workspace matches; requested useClass
matches; its referenced `ApprovalRecord` is current and usable; no
applicable effective `RevocationRecord` targets the issuance; issuance
not expired; exact accepted registry context matches; no lifecycle
conflict/ambiguity. VALIDATIONRECORD: immutable; not revocable; not
itself authorizing; supporting correlation evidence only; newer
validation does not erase older validation; approval references decide
which validation evidence supports the chain. MULTIPLE CURRENT RECORDS:
more than one current matching `ApprovalRecord` or `IssuanceRecord` →
`lifecycle-conflict`; never select one arbitrarily.

### 25.13 Supersession

For Slice-2 approval/issuance currentness, `SupersessionRecord` is
INAPPLICABLE: the accepted schema targets artifact-revision /
result-publication forms, not `ApprovalRecord`/`IssuanceRecord`. Do not
mark approval superseded, do not mark issuance superseded, do not produce
`SupersessionRecord`, and do not require supersession state in Slice-2
approval/issuance currentness (SCR-W12-006). The Slice-1 helper's
defensive supersession handling is schema-unreachable for lifecycle
records; implementation may preserve it harmlessly or document its
removal when extracting the shared currentness helper. No new supersession
semantics are invented.

### 25.14 Trusted time

The existing host-injected control-plane time source is used. Currentness
boundary: revocation effective when `effectiveAt <= now`; record expired
when `validUntil <= now`; equality counts as effective/expired. NOT
invented: grace period, clock tolerance, validity cache, evidence expiry,
or ambient-time authority distinct from the existing host source.
Malformed stored authoritative timestamps are impossible through schema
validation; unreadable/malformed stored authoritative state fails closed
as `store-failure`.

### 25.15 Registry currentness

The existing WP-4 registry-context evaluation is reused; no second
registry compatibility algorithm. For CURRENT approval/issuance
verification, registry-bearing records in the usable chain must match the
CURRENT accepted host registry snapshot exactly as required by the
accepted REG rules (REG-001/002/008, LFC-010). An older record may remain
historical but fail current point-of-use verification. This is distinct
from C6: an old historical target MAY still be revoked; the new
`RevocationRecord` binds the current context.

### 25.16 Capability / ceiling / consumer intersection

`verifyCurrentLifecycleState` re-evaluates current host state using the
existing WP-6 primitives. A previous `ApprovalRecord`/`IssuanceRecord`
never freezes old ceilings: if current ceilings narrow, verification may
now fail. Concrete host WP-6 ceiling violation → `ceiling-denied`; other
consumer-support / policy / requested-capability incompatibility →
`eligibility-denied` (§13 precedence). Capability-syntax boundary
(SCR-W12-S2-005): MALFORMED capability identifier → `request-invalid`;
well-formed but UNKNOWN/UNSUPPORTED → `eligibility-denied`; known
capability denied by current host ceiling → `ceiling-denied`; known
capability incompatible with consumer support/policy →
`eligibility-denied`. Historical records are never
mutated when configuration changes. `ConsumerSupportDeclaration` and
`capabilityRequirements` are evidence/operands, not authority.

### 25.17 Verification read consistency

Explicit guarantee: `verifyCurrentLifecycleState` does NOT acquire the
process-local mutation coordination lock, does NOT reserve lifecycle
state, is NOT linearizable, is NOT a grant, does NOT freeze the store,
and does NOT produce transferable authority. It performs bounded
trusted-store reads and evaluates the state observed during that
completed evaluation. Success evidence is valid only as NON-AUTHORIZING
CURRENT-STATE EVIDENCE FOR THAT COMPLETED EVALUATION. Admitted race
(verify reads a current `ApprovalRecord` → concurrent revoke publishes →
verify may complete with the earlier observed state) is acceptable
because: (1) verification evidence itself authorizes nothing; (2)
downstream privileged use must re-run verification or independently
revalidate current authoritative state; (3) all later mutations
re-read/revalidate under their own decision coordination lock. No
stronger linearizability than WP-8 provides is claimed; no lock is added
merely to hide this property.

### 25.18 Stale / replay semantics

An old successful verification result is NEVER sufficient for a later
privileged operation and cannot be replayed as approval, issuance,
revocation authority, RuntimeGrant, activation, or orchestration
decision. No explicit freshness token or evidence expiry is needed;
freshness comes from RE-EVALUATION OF AUTHORITATIVE CURRENT STATE.
Revocation, expiry, configuration narrowing, registry change, or any new
conflicting state may invalidate an older result.

### 25.19 WP-8 unavailable / recovery state

Fail closed. WP-8 failures — `recoveryRequired`, unreadable authoritative
record, malformed envelope/payload, quarantine/foreign-entry conditions,
store integrity failure, enumeration/read failure — map publicly to
`store-failure` unless a more specific already-committed semantic-absence
mapping applies (e.g., `ERR-STO-NOT-FOUND` → internal `not-found` for
target-existence semantics). Internal WP-8 error codes stay internal;
`ERR-STO-*`, filesystem paths, errno, raw findings, stack traces, and
recovery internals are never exposed. Semantic record absence is not an
infrastructure failure.

### 25.20 Transport / export boundary

Slice 2 remains transport-free. Both operations stay in the internal
control-plane family. NOT added: MCP tool, CLI, stdio mutation surface,
HTTP endpoint, network API, package-root lifecycle-authority export, or
`./mcp` lifecycle-authority export. `verifyCurrentLifecycleState` being
READ-ONLY does NOT automatically authorize MCP exposure; any transport
adapter requires separate future authorization (Decision 1).

### 25.21 Implementation decomposition

Slice 2 remains ONE roadmap closure unit. For implementation/review, two
internal phases: 2A — revoke (request model; trusted revocation role;
`RevocationRecord` builder; target lookup; coordination; duplicate/
applicability checks; WP-8 publication; mechanical audit; result
mapping); 2B — `verifyCurrentLifecycleState` (shared currentness
extraction; approval verification; issuance verification; revocation/
expiry evaluation; registry evaluation; WP-6 ceiling/consumer
intersection; bounded evidence; no mutation). Dependency: 2B depends on
2A being available so currentness can be tested end-to-end against actual
`RevocationRecord`s. This internal order does not split or change the
committed roadmap Slice-2 closure semantics.

### 25.22 Final Slice-2 taxonomy subset

Slice 2 uses only existing committed §13 categories: `request-invalid`,
`subject-invalid`, `approver-not-independent`, `eligibility-denied`,
`ceiling-denied`, `lifecycle-state-missing`, `lifecycle-conflict`,
`approval-revoked`, `issuance-not-authorized`,
`registry-context-mismatch`, `store-failure`, `lock-conflict`,
`internal-failure`. `target-unknown` is not added; no revocation-specific
or verification-specific public tokens are added. Operation-specific
mappings are fixed in 25.2/25.4 so implementation does not guess.

### 25.23 Minimum test contract

REVOKE: revoke current ApprovalRecord; revoke current IssuanceRecord;
future-dated revocation; `effectiveAt == now`; immutable/non-revocable
target → `request-invalid`; nonexistent target →
`lifecycle-state-missing`; target outside trusted workspace →
`lifecycle-state-missing`; duplicate applicable revocation →
`lifecycle-conflict`; wrong/meaningless scope → `request-invalid`; registry
echo mismatch → `registry-context-mismatch`; untrusted revocation-role
assertion rejected (`approver-not-independent`); target remains
byte-identical; exactly one `RevocationRecord`; mechanical audit only; no
unrelated mutation; same-key revoke contention → `lock-conflict`; revoke
racing issue uses the same lifecycle coordination-key family; historical
old-registry target revoked into current registry context.

VERIFY: current approval success; current issuance success; no approval →
`lifecycle-state-missing`; revoked approval → `approval-revoked`; expired
approval → `lifecycle-state-missing`; no issuance →
`issuance-not-authorized`; revoked issuance → `issuance-not-authorized`;
expired issuance → `issuance-not-authorized`; multiple current approvals
→ `lifecycle-conflict`; multiple current issuances →
`lifecycle-conflict`; registry mismatch → `registry-context-mismatch`;
ceiling narrowed after historical issuance → `ceiling-denied`; unsupported
capability → `eligibility-denied`; malformed request → `request-invalid`;
store unavailable → `store-failure`; bounded/redacted success evidence;
verification performs zero mutation; verification produces no audit
event; verify racing revoke demonstrates evidence is advisory/
non-linearizable; a replayed prior success result cannot be supplied as
later authority.

REAL WP-8 STORE (SCR-W12-S2-004): the minimum test matrix explicitly
requires REAL WP-8 store coverage for BOTH 2A and 2B; fake stores remain
useful for focused failure injection but are NOT sufficient alone for
Slice-2 closure. 2A revoke on a real store must cover: an actual
`ApprovalRecord`/`IssuanceRecord` target; an actual `RevocationRecord`
publication; the target remaining byte-identical; exactly one
`RevocationRecord`; the actual WP-8 mechanical write-audit; duplicate
revocation behavior; an old-registry historical target; and no
residual/new WP-12 lock artifact. 2B verify on a real store must cover:
actual current lifecycle records; actual `RevocationRecord` consumption;
expired/current state evaluation; an actual registry context; the actual
store read/enumeration path; zero publication; zero audit side effect;
and malformed/unavailable-store mapping where practical.

STATIC / REUSE: no direct fs; no network/process/Git; no MCP/CLI; no
Slice-3+ production vocabulary; no second store; no second audit path; no
second lifecycle graph; no new WP-8 lock artifact; publishable lifecycle
classes become exactly `ValidationRecord`, `ApprovalRecord`,
`IssuanceRecord`, `RevocationRecord`.

### 25.24 Consistency assessment

This record was checked against the full committed contract: the closed
result taxonomy (§13) is unchanged and `target-unknown` no longer appears
in any normative Slice-2 table or text (its only remaining mentions are
this record's own resolution statement, §25.2) (§8 row corrected); approval/issuance revocation, immutable
target classes, old-registry targets, new-record current-registry binding,
future effectiveAt, scope applicability, `reasonCode` non-authority,
revoke coordination key, pre-lock locator vs under-lock revalidation,
re-approval/re-issuance after revocation, verification currentness,
`approval-revoked`/`issuance-not-authorized` mappings, multiple-current
`lifecycle-conflict`, trusted time, registry exact matching, supersession
inapplicability, consumer/ceiling intersection, advisory read
consistency, stale evidence, WP-8 `store-failure`, transport exclusion,
and the Slice-3 boundary (RuntimeGrant revocation arrives with Slice 3;
Slice-2 evidence forms remain extensible for Slices 3-4 read refinements
per Decision 5) are all stated above without contradiction. An
implementer can build 2A `revoke` and 2B `verifyCurrentLifecycleState`
without inventing any semantic decision: every public result, currentness
rule, request operand, authority source, registry rule, locking rule,
and freshness rule is fixed by this record within the accepted
architecture.

### 25.25 ADR assessment

No new ADR is created or required. As with the Slice-1 correction phase
(§21), these resolutions interpret accepted ADR-002/011/012/025/027 and
the trusted-lifecycle-protocol within their terms and change no
cross-work-package architectural boundary. The MCP prohibition, the
closed-taxonomy discipline, the host-side/process-level coordination
boundary (FSCR-W12-001), and the Slice-3 RuntimeGrant/activation
ownership are preserved unchanged. If the focused senior contract review
judges that any resolution requires ADR elevation, that is a separate
human authorization; this record documents the request point.

### 25.26 State

All six bounded Slice-2 clarifications C1–C6 are resolved in this record
(25.2–25.10), with supporting normative restatement (25.11–25.23). The
focused senior contract review returned `WP-12 SLICE 2 CONTRACT ACCEPTED
— READY FOR HUMAN IMPLEMENTATION AUTHORIZATION`; the five editorial
MINOR findings SCR-W12-S2-001…005 are CLOSED by this final polish (§27).
The record is documentation only. This documentation closure does NOT
start Slice-2 implementation; 2A revoke and 2B
`verifyCurrentLifecycleState` require a subsequent explicit human
implementation authorization.

### 25.27 Focused senior contract review record (final polish)

Review verdict: `WP-12 SLICE 2 CONTRACT ACCEPTED — READY FOR HUMAN
IMPLEMENTATION AUTHORIZATION`. Accepted decisions: C1 — ACCEPTED;
C2 — ACCEPTED; C3 — ACCEPTED; C4 — ACCEPTED; C5 — ACCEPTED;
C6 — ACCEPTED. Findings: 0 CRITICAL, 0 MAJOR, 0 MODERATE, 5 MINOR
(non-blocking, editorial/precision-only), all CLOSED:

- **SCR-W12-S2-001 — CLOSED** — §13 `approver-not-independent` wording
  generalized from approver-specific to ANY trusted operator role
  (approver, issuer, revocation authority); all roles host-injected;
  token name unchanged; no `revoker-not-independent` token added.
- **SCR-W12-S2-002 — CLOSED** — Decision 5 and matrix wording aligned
  with the non-linearizable verification model: "trusted store snapshot"
  and "deterministic per snapshot" replaced by trusted observed record
  set / records observed during the completed evaluation / deterministic
  for the observed record set; no snapshot ID or freshness token added.
- **SCR-W12-S2-003 — CLOSED** — the revoke (and verify) registry-context
  echo is a REQUIRED untrusted correlation-only operand: missing or
  malformed → `request-invalid`; differing →
  `registry-context-mismatch`; authoritative registry stays host-injected;
  synchronized in §25.2, §25.5, §25.6, §25.10.
- **SCR-W12-S2-004 — CLOSED** — §25.23 now explicitly requires REAL
  WP-8 store coverage for both 2A and 2B (publication, byte-identical
  target, single record, mechanical audit, duplicate and old-registry
  behavior, no lock artifact; verify: real currentness consumption,
  zero publication/audit, real read/enumeration path, failure mapping);
  fake stores are not sufficient alone for closure.
- **SCR-W12-S2-005 — CLOSED** — capability-syntax boundary made
  explicit: malformed identifier (fails accepted
  `project-gateway.<class>` syntax) → `request-invalid`; well-formed but
  unknown/unsupported → `eligibility-denied`; known capability denied by
  current host ceiling → `ceiling-denied`; known capability incompatible
  with consumer/policy → `eligibility-denied`; no `unknown-capability`
  or other token added.

Final consistency assessment: the complete contract was re-read after the
five fixes; no contradictory Slice-2 wording remains. An implementer can
build 2A `revoke` and 2B `verifyCurrentLifecycleState` without inventing
any semantic decision. No ADR is created (ADR assessment unchanged from
§25.25). This record is committed as the WP-12 Slice 2 contract
baseline; it does NOT start implementation.
