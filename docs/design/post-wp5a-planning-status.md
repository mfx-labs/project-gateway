# Post-WP-5A Planning Status and Open-Decision Dispositions (Planning Draft)

**Status:** Planning draft — not approved. Records dispositions for every
WP-0 deferred decision affected by post-WP-5A sequencing, trusted authority
configuration, capability vocabulary, and pi-guard compatibility. Each
disposition is one of RESOLVED (by this planning package or earlier closed
packages), DEFERRED WITH NON-BLOCKING RATIONALE, or STILL BLOCKING.
Approval of the planning package is pending independent review.

## WP-0 Deferred Decisions (project-gateway-scope-and-principles.md)

1. **Canonical artifact representation, digest calculation, revision
   identity, cross-artifact reference rules** — **RESOLVED** (WP-1…WP-3;
   committed).
2. **Complete field-level artifact semantics, JSON Schemas, validation
   error behavior** — **RESOLVED** (WP-1…WP-4; committed).
3. **Trusted local approver workflow, record retention, revocation
   propagation, activation UX** — **DEFERRED WITH NON-BLOCKING RATIONALE**:
   owned by WP-12 (approval/activation) and WP-8 (retention) in the adopted
   roadmap (ADR-023); no implementation before WP-12 begins; non-blocking
   for WP-6…WP-11.
4. **Concrete capability vocabulary and the trusted configuration format
   for global and workspace ceilings** — **RESOLVED (planning draft)**:
   vocabulary in `capability-vocabulary.md` (ADR-025); configuration
   contract in `trusted-workspace-and-ceiling-configuration.md`
   (ADR-024); implementation owner WP-6. Pending human approval of the
   planning package before any implementation.
5. **Execution-bundle issuance and runtime-grant lifecycle details** —
   **RESOLVED** (WP-2 protocol, WP-4 evaluation; committed).
6. **Adapter contracts, consumer capability-negotiation protocol,
   extension registry governance** — **PARTIALLY RESOLVED / DEFERRED WITH
   NON-BLOCKING RATIONALE**: WP-5A resolved the Pi adapter lane (ADR-020…
   022); remaining negotiation/registry items are owned by WP-5B (pi-guard
   lane, ADR-026) and WP-15 (extension governance hardening); non-blocking
   for WP-6…WP-12.
7. **Exact project-visible and trusted local directory layouts** —
   **DEFERRED WITH NON-BLOCKING RATIONALE**: owned by WP-8 (trusted-local
   layouts) and WP-7/WP-11 (project-visible layouts); non-blocking for
   WP-6.

## Sequencing Dispositions

- **WP-5B eligibility** — **STILL BLOCKING until closed**: WP-6 (ceilings,
  workspace identity) and WP-12 (activation decisions) are normative
  prerequisites (ADR-023); the pi-guard projection interface requires
  separate explicit authorization (ADR-026). These are open gates, not
  open design decisions of this package.
- **WP-6 eligibility** — **NOT BLOCKED by any open decision**: WP-6
  depends on WP-0…WP-4 and the planning contracts; no unresolved decision
  blocks it once the planning package is approved.

## Focused-Correction Dispositions (F-01…F-09)

- **F-01 (capability-set ceiling evaluator integration)** — CORRECTED.
  Owning document: `post-wp5a-roadmap.md` (evaluator-integration section),
  `trusted-workspace-and-ceiling-configuration.md`, ADR-024. Model A
  selected: WP-6 owns the reviewed Artifact Core point-of-use boundary
  extension (additive, versioned interface extension; numeric-only shape
  remains valid). Effect on WP-6 future eligibility: required closure item
  (WP-6 cannot close without the evaluator extension implemented and
  fixtures passing); does not block WP-6 start. Implementation remains
  unauthorized.
- **F-02 (timestamp/fingerprint canonicalization)** — CORRECTED. Owning
  document: ADR-027 and `pi-guard-compatibility-and-authority-projection.md`
  Part E. Model: `projectionIdentity` excludes timestamps/observations;
  `evidenceFingerprint` includes present timestamps and timestamp-source
  identifiers; canonicalization rules defined. Effect on WP-6 eligibility:
  none. Implementation remains unauthorized.
- **F-03 (pi-guard lane)** — CORRECTED. Owning document: ADR-026 and
  compatibility design Part A/B. Lane is exactly `pi-guard 0.1.1`; exact
  compatibility predicate defined; unverified versions fail closed.
  Effect: pi-guard lane remains a future implementation gate (WP-5B) but is
  no longer an undefined contract. Implementation remains unauthorized.
- **F-04 (tool inventory)** — CORRECTED. Owning document: ADR-026 and
  compatibility design Part B. `getAllTools`/`getActiveTools` contract,
  sampling points, drift rule, duplicate/collision and source-identity
  handling defined. Effect on WP-6 eligibility: none. Implementation
  remains unauthorized.
- **F-05 (roadmap attributes)** — CORRECTED. Owning document:
  `post-wp5a-roadmap.md` (per-package attribute definitions). All 11
  packages now carry objective, inputs, outputs, owned components,
  prohibited responsibilities, invariants, test categories, closure gate,
  non-goals. Effect: future eligibility reviews need no invented
  attributes. Implementation remains unauthorized.
- **F-06 (concurrent activation/restart)** — CORRECTED. Owning document:
  ADR-026 and compatibility design Part B/D. Single trusted owner;
  serialized/rejected concurrent activations; restart begins from host
  pre-activation state; no automatic reactivation from persisted evidence.
  Effect on WP-6 eligibility: none. Implementation remains unauthorized.
- **F-07 (numeric ceiling semantics)** — CORRECTED. Owning document:
  `trusted-workspace-and-ceiling-configuration.md`, ADR-024,
  `capability-vocabulary.md`. Domain, zero, missing, overflow, malformed,
  canonical form, intersection rules defined. Effect on WP-6 eligibility:
  closure item. Implementation remains unauthorized.
- **F-08 (TrustedReceipt owner)** — CORRECTED. Owning document:
  `post-wp5a-roadmap.md` ownership matrix and WP-13/WP-15 attribute blocks.
  Normative owner: WP-15; input provider: WP-13. Effect on WP-6
  eligibility: none. Implementation remains unauthorized.
- **F-09 (glossary terms)** — CORRECTED. Owning document:
  `docs/design/glossary.md` (Trusted Workspace Configuration, Enforcement
  Configuration, Compatibility Fingerprint). Effect on WP-6 eligibility:
  none.

## Final-Focused-Correction Dispositions (F-R1…F-R6)

- **F-R1 (MAJOR — Pi 0.83.0 tool-inventory observability).** CORRECTED.
  Authoritative document: `pi-guard-compatibility-and-authority-projection.md`
  Part B and ADR-026. Pi 0.83.0 observability is stated accurately (one
  effective `ToolInfo` per surviving name; name-keyed collapse before
  observation; first surviving registration; shadowed and settings-excluded
  registrations not observable; `sourceInfo` describes only the surviving
  effective registration). Project Gateway binds to the effective
  observable surface, never claims duplicate/shadowed/hidden detection, and
  records the accepted shadowing limitation with a non-blocking future
  hardening owner (WP-15). Effect on planning approval: none beyond this
  correction; effect on WP-6 eligibility: none. Implementation remains
  unauthorized.
- **F-R2 (MINOR — timestamp canonicalization).** CORRECTED. Authoritative
  document: ADR-027 and the evidence section. Accepted values, rejection
  rules, omission semantics, canonical serialization, and dual-implementation
  byte-identity are defined. Effect on WP-6 eligibility: none. Implementation
  remains unauthorized.
- **F-R3 (MINOR — idempotent replay identity).** CORRECTED. Authoritative
  document: ADR-026 and the activation/restart section. Replay requires
  exact match of plan, effective-authority, approval/activation-decision,
  RuntimeGrant (where separate), inventory, **compatibility**, projected
  enforcement-configuration, and target Pi session/surface identities;
  compatibility drift never qualifies. Effect on WP-6 eligibility: none.
  Implementation remains unauthorized.
- **F-R4 (MINOR — projectionIdentity unification).** CORRECTED.
  Authoritative document: evidence section (single canonical member set)
  and ADR-027; `projectionIdentity` added to the evidence field list; the
  Part D "projection result identity" now references the canonical
  definition with no separate member set. Effect on WP-6 eligibility: none.
  Implementation remains unauthorized.
- **F-R5 (MINOR — stale text).** CORRECTED. Authoritative documents:
  planning report (lane summary and glossary count) and roadmap (Model B
  residual removed from the WP-6 closure gate). Remaining `0.1.x`/Model B
  references are intentional, labeled, or rejected-alternative contexts.
  Effect on WP-6 eligibility: none. Implementation remains unauthorized.
- **F-R6 (MINOR — evaluator interface version).** CORRECTED. Authoritative
  document: ADR-024 (`PointOfUseInputs v2` with the twelve rules), with
  cross-references in the trusted-configuration design, capability
  vocabulary, roadmap, and report. Effect on WP-6 eligibility: closure item
  (v2 implementation and conformance migration); does not block WP-6 start.
  Implementation remains unauthorized.

## Final Two-Finding Dispositions (F-F1, F-F2)

- **F-F1 (MINOR — ADR-026 replay predicate and inventory framing).**
  CORRECTED. Authoritative document: ADR-026 (authoritative eight-identity
  idempotent-replay rule; decision-level Pi 0.83.0 inventory boundary with
  effective-surface binding, shadowing limitation, and WP-15 non-blocking
  hardening; cross-references the detailed design). No abbreviated replay
  predicate remains. Effect on planning approval: none; effect on WP-6
  eligibility: none. Implementation remains unauthorized.
- **F-F2 (MINOR — trusted extension set ownership).** CORRECTED.
  Authoritative documents: `trusted-workspace-and-ceiling-configuration.md`
  (`trustedExtensionSet` contract and trust rules), ADR-024 (ownership),
  roadmap (WP-6 owned contracts), and
  `pi-guard-compatibility-and-authority-projection.md` (single-owner
  binding; unowned alternative phrase removed). Trusted Workspace
  Configuration is the single owner; WP-6 implements; WP-5B consumes for
  Pi/pi-guard enforcement; WP-15 owns only optional hardening. Effect on
  planning approval: none; effect on WP-6 eligibility: closure item (WP-6
  cannot close without the trusted-extension-set contract); does not block
  WP-6 start. Implementation remains unauthorized.

## F-SEQ Dispositions

- **F-SEQ-1 (capability vocabulary + trusted ceiling format)** — RESOLVED
  in planning draft (ADR-024, ADR-025, vocabulary and configuration
  documents).
- **F-SEQ-2 (pi-guard compatibility contract)** — RESOLVED in planning
  draft (ADR-026; compatibility/projection/evidence contract document);
  pi-guard-side interface change remains a separately authorized item.
- **F-SEQ-3 (roadmap)** — RESOLVED in planning draft (ADR-023;
  `post-wp5a-roadmap.md`).

## Known Non-Blocking Limitations

- pi-guard 0.1.1 has no external authority-projection input API; the
  required interface is documented (ADR-026) and requires separate
  authorization — a deferred implementation item, not an unresolved
  architecture decision of this package.
- The v1 capability vocabulary is proposed and pending human review; no
  implementation consumes it before approval.
