# Post-WP-5A Sequencing Resolution Report

**Status:** Human-approved (external decision 2026-08-05; planning commit
`97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review
POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
approval: zero). This report documents the planning package created to
resolve F-SEQ-1, F-SEQ-2, and F-SEQ-3 and its later corrections. It is not
an implementation authorization and does not close any work package. The
document was drafted as a planning draft; the post-commit approval-recording
correction section below records the approval timeline without rewriting
history.

## Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`;
  HEAD `be0a001dad0d486c7631c6654b1154275064d457`
  (`feat: establish WP-5A Pi adapter prototype`); parent
  `45bfd9714cccba04b19d4ebc0f85b8a72c2f9c02`; staging empty; working tree
  clean before drafting; no implementation after WP-5A exists.
- Authoritative sources inspected: WP-0 scope document, artifact core
  architecture/domain/responsibility/identity/lifecycle designs, WP-5A
  architecture/host-compatibility/prompt-projection/observation designs,
  ADR-001…ADR-022, WP-1…WP-5A open-decision records, WP-4/WP-5A reports,
  `src/api/types.ts`, `src/api/validate.ts`, `src/pointofuse/evaluate.ts`,
  and the external pi-guard source (read-only).

## External pi-guard Observations (read-only)

`/home/chef/Documents/plan_spec_guard` — package identity `pi-guard`,
version `0.1.1`; extension entry `extensions/pi-guard/index.ts`; modes
OFF/INSPECT/EDIT/WRITE with verified restoration; reserved research ids
`bash`/`edit`/`write`/`git_inspect`; trusted-project config
`.pi/pi-plan-spec-guard.json` (`researchTools`, `allowedExtensions`);
web-access research tools only via trusted package registration; explicitly
not a sandbox; **no external authority-projection input API** (the missing
interface is documented in ADR-026 and requires separate authorization).
Not installed, not modified, not run.

## Files Created (planning documentation only)

- `docs/design/post-wp5a-roadmap.md` — roadmap + decision/ownership matrix
- `docs/design/trusted-workspace-and-ceiling-configuration.md` — trusted
  configuration contract
- `docs/design/capability-vocabulary.md` — v1 capability vocabulary
- `docs/design/pi-guard-compatibility-and-authority-projection.md` —
  compatibility, projection, and enforcement-evidence contracts
- `docs/design/post-wp5a-planning-status.md` — open-decision dispositions
- `docs/decisions/ADR-023-post-wp5a-sequencing.md`
- `docs/decisions/ADR-024-trusted-workspace-and-ceiling-configuration-ownership.md`
- `docs/decisions/ADR-025-capability-vocabulary-and-versioning.md`
- `docs/decisions/ADR-026-pi-guard-compatibility-lane-and-authority-projection-boundary.md`
- `docs/decisions/ADR-027-enforcement-evidence-semantics.md`
- `docs/design/glossary.md` — nine new canonical terms
- `docs/reports/post-wp5a-sequencing-resolution-report.md` (this report)

No `src/`, `tests/`, `schemas/`, `fixtures/`, package, or configuration
files were touched; no Git mutation performed.

## Authoritative Roadmap (proposed)

Execution order: **WP-6 → WP-7 → WP-8 → WP-9 → WP-10 → WP-11 → WP-12 →
WP-5B → WP-13 → WP-14 → WP-15** (ADR-023; details in
`post-wp5a-roadmap.md`). Numeric identifiers retained; execution order is
authoritative.

## Selected WP-5B Placement

**Option C** (ADR-023): WP-5A → WP-6 → control-plane packages
(WP-7…WP-12) → WP-5B → WP-13. Dependency edges: WP-6→WP-5B normative
(ceilings, workspace identity); WP-12→WP-5B normative (activation
decisions, ADR-002); WP-5B→WP-13 normative (end-to-end execution);
WP-5A→WP-5B normative (plan consumption, ADR-020); WP-4→WP-5B normative
(effective-authority evaluation ownership). No circular dependencies.

## Contract Summaries

- **Trusted configuration (ADR-024):** trusted-local, external to
  repository content; opaque workspace IDs; roots never exposed; unknown
  workspace / malformed config / root escape / symlink escape fail closed;
  ceilings narrow only; changes require explicit local trusted operations.
- **Capability vocabulary (ADR-025):** v1 canonical
  `project-gateway.<class>` IDs for all planned operations; versioned;
  unknown denied; deny wins; intersection semantics; numeric action
  ceilings remain orthogonal action-count limits.
- **pi-guard compatibility (ADR-026):** identity `pi-guard`, lane
  **exactly `pi-guard 0.1.1`** (references elsewhere denying general `0.1.x`
  compatibility are intentional and current), environment-gated fingerprint
  discovery; pi-guard is an enforcement consumer, never an authority
  issuer; missing projection-input interface documented as a separately
  authorized pi-guard-side change.
- **Authority projection:** inputs plan + ceilings + policy + grant +
  consumer support + tool surface + compatibility result; Artifact Core owns
  the intersection evaluation; WP-5B maps capabilities to tool profiles
  with deny-wins, unknown-denied, no partial activation, verified
  restoration.
- **Enforcement evidence (ADR-027):** `PiEnforcementEvidence` — projection/
  activation record; explicitly not ExecutionResult/TrustedReceipt; never
  proof of completion or authorization.

## WP-0 Deferred-Decision Dispositions

Items 1, 2, 5 RESOLVED by earlier closed packages; item 4 RESOLVED
(planning draft: ADR-024/025); items 3, 6 (remaining), 7 DEFERRED WITH
NON-BLOCKING RATIONALE (owners assigned: WP-8, WP-12, WP-5B, WP-15); no
item remains unresolved-and-blocking within this package's scope. WP-5B
eligibility remains gated by WP-6/WP-12 closure and the separate pi-guard
authorization (documented gates, not open design decisions).

## Earliest Proposed Eligible Implementation Package

**WP-6 (trusted workspace and policy configuration core)** — the first
implementation package after approval of this planning package; depends
only on WP-0…WP-4 and the planning contracts. WP-5B remains deferred until
WP-6 and WP-12 are closed and the pi-guard projection interface is
authorized.

## Invariants Preserved

All seventeen expected authority invariants (artifacts never
self-authorize; approval external; RuntimeGrant external; repository cannot
widen governance; pi-guard is enforcement consumer; plans are projections;
observation ≠ permission; CompletionContract grants nothing;
ExecutionResult retrospective; TrustedReceipt separate; unknown denied;
unsupported-required fails closed; deny wins; no partial activation;
effective authority never exceeds operands; opaque workspace IDs; FFF
internal) are stated in the roadmap and preserved in every contract
document.

## Focused Correction (F-01…F-09)

A focused correction pass addressed the independent-review findings; full
dispositions are recorded in `post-wp5a-planning-status.md`:

- **F-01 (MAJOR):** Model A selected — WP-6 owns a reviewed, additive,
  versioned Artifact Core point-of-use boundary extension for capability-set
  ceilings (inputs, vocabulary-version binding, canonicalization,
  intersection, findings, fixtures/vectors; numeric-only shape remains
  valid). Artifact Core stays the only evaluator; WP-5B never recomputes the
  intersection. WP-6 closure gate updated accordingly.
- **F-02 (MODERATE):** `projectionIdentity` (excludes timestamps and
  observations) and `evidenceFingerprint` (includes present timestamps and
  timestamp-source identifiers) are distinct; canonicalization rules
  defined (fixed field order, host-supplied primitives preserved, omission
  for absent timestamps, UTF-8, SHA-256).
- **F-03 (MODERATE):** lane is exactly `pi-guard 0.1.1`; an exact 11-clause
  compatibility predicate is defined; unverified versions fail closed;
  discovery remains environment-gated/read-only/non-networked/
  non-mutating/deterministic/fail-closed; no machine-specific path.
- **F-04 (MODERATE):** `getAllTools()` (registered universe with
  `sourceInfo`) vs `getActiveTools()` (active names) contract; sampling at
  projection/pre-/post-activation/turn/restoration/shutdown; drift fails
  closed before activation and refuses operations after; duplicate/collision
  handling fails closed; source identity required where available, exact
  case-sensitive names, no alias inference.
- **F-05 (MODERATE):** all 11 packages now have complete attribute
  definitions (objective, inputs, outputs, owned components, prohibited
  responsibilities, invariants, test categories, closure gate, non-goals).
- **F-06 (MINOR):** concurrent activations serialized/rejected by one
  trusted owner; no overlapping sessions; nested activation only as
  idempotent replay; restart from host pre-activation state; no automatic
  reactivation; fresh decision + projection required.
- **F-07 (MINOR):** numeric ceiling semantics complete (non-negative safe
  integers; zero denies; missing = no additional restriction, never
  permission; malformed/overflow fail closed at load; minimum finite
  ceiling applies; no wraparound; no Infinity sentinel).
- **F-08 (MINOR):** TrustedReceipt normative owner is WP-15; WP-13 supplies
  retrospective input facts.
- **F-09 (MINOR):** glossary gains Trusted Workspace Configuration,
  Enforcement Configuration, and Compatibility Fingerprint.

## Final Focused Correction (F-R1…F-R6)

- **F-R1 (MAJOR):** Pi 0.83.0 inventory observability corrected — one
  effective `ToolInfo` per surviving name; name-keyed collapse before
  observation; first surviving registration; shadowed/settings-excluded
  registrations not observable; `sourceInfo` describes only the surviving
  effective registration. Effective-surface identity formula adopted;
  trusted extension set bound to Trusted Workspace Configuration; accepted
  shadowing limitation recorded verbatim; optional uncollapsed
  registration-visibility hardening assigned to WP-15 (non-blocking);
  sampling contract retained with per-sample effective-surface comparison.
- **F-R2 (MINOR):** timestamp canonicalization completed (accepted values,
  rejection rules, omission semantics, canonical bytes, dual-implementation
  identity).
- **F-R3 (MINOR):** idempotent replay now requires exact match of plan,
  effective-authority, approval/activation-decision, RuntimeGrant (where
  separate), inventory, compatibility, projected enforcement-configuration,
  and target Pi session/surface identities; compatibility drift never
  qualifies.
- **F-R4 (MINOR):** one canonical `projectionIdentity` definition (single
  member set), added to the evidence field list; Part D references the
  canonical definition.
- **F-R5 (MINOR):** stale text removed — report lane summary now
  "exactly `pi-guard 0.1.1`", glossary count now nine, Model B residual
  removed from the WP-6 closure gate.
- **F-R6 (MINOR):** evaluator interface versioned as `PointOfUseInputs v2`
  with the twelve compatibility rules (configured ceilings cannot be
  omitted; v1 legacy path constrained; mixed versions fail closed;
  identities include the interface version).

## Final Two-Finding Correction (F-F1, F-F2)

- **F-F1 (MINOR):** ADR-026 now carries the authoritative eight-identity
  idempotent-replay rule (plan; effective-authority; approval/activation-
  decision; RuntimeGrant where separate; effective inventory; compatibility;
  projected Enforcement Configuration; target Pi session/surface), with any
  mismatch conflicting and fail-closed, compatibility drift never
  qualifying, prior evidence not authorizing replay, and fresh projection +
  trusted decision required after restart. ADR-026 also states the
  decision-level Pi 0.83.0 inventory boundary (one surviving effective
  `ToolInfo` per name; collapse before observation; shadowed registrations
  and full history unobservable; effective-surface-only binding; trusted
  source matching; unknown/unexpected denied; drift fails closed; no
  duplicate/shadowed/hidden detection claim; limitation creates no
  authority; WP-15 non-blocking hardening). Detailed rules remain in the
  design document.
- **F-F2 (MINOR):** the trusted extension set is now owned solely by
  Trusted Workspace Configuration: the `trustedExtensionSet` contract
  (fourteen coverage items and nine trust rules) is defined in the trusted
  configuration design; ADR-024 records ownership; WP-6 owns contract,
  validation, identity, provenance, canonicalization, fail-closed loading,
  and the trusted update boundary; WP-5B validates the effective Pi surface
  against it; WP-15 owns only optional hardening; the unowned
  "or another trusted-local host configuration" alternative is removed.

## Post-Commit Approval-Recording Correction (clearly labeled)

The planning package was committed at `97022a49…` while its documents still
recorded "Proposed — planning draft; not approved". This section records the
subsequent repository status-recording correction; it does not rewrite
history. Temporal sequence (explicit):

1. **Human approval granted** (external decision; approval decision date
   2026-08-05; accepted final review: POST-WP-5A FINAL DOCUMENTATION SPOT
   CHECK: ACCEPTED; open findings at approval: zero).
2. **Initial planning commit** `97022a49d9029449f304a2b1e47f9dc8da4d4a89`
   established the planning documents (which, at commit time, still carried
   draft status markers).
3. **Later status-recording correction:** ADR-023 through ADR-027 status
   updated to Accepted with the approval evidence; the roadmap and
   planning-status documents updated to record approval and closure. This
   correction records the externally granted approval; the documentation
   operator did not grant it.

## Final Status-Header Correction (F-EL-R1) (clearly labeled)

The three authoritative contract documents
(`capability-vocabulary.md`, `pi-guard-compatibility-and-authority-projection.md`,
`trusted-workspace-and-ceiling-configuration.md`) previously carried
current, unlabeled `(Planning Draft)` H1 suffixes and
`Planning draft — not approved` status blocks even though ADR-024, ADR-025,
and ADR-026 were Accepted and the planning package was human-approved,
authoritative, and closed. This section records the F-EL-R1 status-header
correction; it does not rewrite history and does not change contract
semantics.

Correction:

- The three contract-document H1 suffixes indicating a planning draft were
  removed, and their current status now states
  `Accepted — human-approved and authoritative`.
- The status blocks now record the same approval evidence already used by
  the governing ADRs (external human decision 2026-08-05; planning commit
  `97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review
  POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
  approval: zero). Acceptance derives from the external human decision, not
  from the documentation operator.
- No contract semantics changed; implementation-scope caveats remain; no
  open eligibility-prerequisite finding remains according to this
  correction report. WP-6 remains unauthorized and not started; the
  separate pi-guard-side authorization remains pending.

## Unresolved Findings

None within the planning package. Pending human decisions (not findings):
approval of the roadmap/vocabulary/contracts; separate authorization of the
pi-guard-side projection interface.
