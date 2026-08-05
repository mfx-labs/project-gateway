# WP-6 Phase 3 Contract Consolidation Report

**Status:** Consolidation of the complete accepted WP-6 Phase 3 (PointOfUseInputs v2) contract into one normative specification. No implementation occurred; no files other than the two authorized documents were created or modified; nothing was staged, committed, or pushed.

## Repository and Full HEAD

- Repository: `/home/chef/Documents/Project_Gateway_MCP`
- Branch: `main`
- Full HEAD: `ee803d54fccc06a47a8a031c07ca6d1165c81dcb` — `feat: establish WP-6 prospective destination containment`
- Parent: `8fd2d85ef4f51c8871b70dd7cae7161c4a8c9758`

## Git State

**Before consolidation:**
- staging empty;
- working tree clean;
- zero untracked paths;
- zero tags;
- no Phase-3 implementation; no PointOfUseInputs v2; no router; no persistence or mutation implementation.

**After consolidation (and after this HCR-01…HCR-04 correction round):**
- staging empty;
- exactly two authorized untracked files (`docs/specs/wp-6-phase-3-point-of-use-v2-contract.md` and `docs/reports/wp-6-phase-3-contract-consolidation-report.md`);
- no other working-tree changes;
- zero tags.

The post-consolidation working tree is **not** clean (it contains the two authorized untracked documents).

## Exact Two-Path Change Inventory

This consolidation created exactly two paths and modified no other path:

1. `docs/specs/wp-6-phase-3-point-of-use-v2-contract.md` — the normative contract (25 sections, in the mandated order).
2. `docs/reports/wp-6-phase-3-contract-consolidation-report.md` — this report.

Neither path existed before this task. The final holistic review (HCR-01…HCR-04) subsequently required corrections to exactly these two existing untracked files; this correction round modified **only** those two paths (HCR-01: RuntimeGrant capability authority; HCR-02: exact closed static projection; HCR-03: lifecycle representation and forbidden-identity terminology; HCR-04: Git-state description). No production code, tests, schemas, fixtures, vectors, generated corpus, package files, ADRs, or existing design documents were touched. `docs/specs/` is a new directory created solely for this specification.

## Test Baseline (recorded at consolidation HEAD)

- Production typecheck: PASS; test typecheck: PASS.
- Repository-default tests: 1115/1115 (0 fail, 0 skipped, 0 todo).
- Trusted suite: 570/570 (Phase 1 150, Phase 2A 126, Phase 2B-P 115, Phase 2B 179).
- Legacy WP-4/WP-5A: 545/545; shared snapshot 30/30.
- Conformance 531/531, schemas 51/51, semantic rules 114/114, digest vectors 19/19 (asserted; integration 90/90).
- Generated corpus: byte-reproducible (regeneration produced zero diff).

## Source Documents Reviewed

- Committed architecture: ADR-024 (F-R6 rules 1–12, quoted), ADR-025, ADR-026, ADR-027; `post-wp5a-roadmap.md` (F-01/Model A, F-R6, closure gate); `trusted-workspace-and-ceiling-configuration.md` (F-01, F-07, F-EL5, F-5, Phase-1/2A/2B-P/2B sections); `capability-vocabulary.md`.
- Committed code: `src/api/types.ts` (v1 `PointOfUseInputs`, `RequestedUse`, `ConsumerSupportDeclaration`, `EligibilityReport`); `src/pointofuse/evaluate.ts` (14-stage committed evaluator, `finish()`, grant checks, numeric checks); `src/api/validate.ts`; `src/index.ts` (16 package-root exports); `src/internal/snapshot.ts` (brands + descriptor capture); `src/trusted/**` (closed `'1' | '2'` union, ceiling fields, configuration brand, barrel); `src/internal/phase.ts`; `schemas/lifecycle/1.0/records/runtime-grant.json`.
- Phase reports: Phase-1, Phase-2A, Phase-2B-P, Phase-2B implementation reports.
- Phase-3 review trail: the eligibility review and all focused corrections F-P3-EL-01 through F-P3-EL-25 (each later accepted correction superseding contradictory earlier language).

## Consolidated Decisions

All final accepted decisions are consolidated in the normative contract, including:

- v1 contract preserved byte-identical as a documented non-authoritative compatibility utility (Section 2);
- authoritative **internal** router with the exact two-literal router request union (Section 3);
- exact router result family with per-variant identity availability (Section 4);
- exact v2 input shape with field classification and forbidden fields (Section 5);
- exact-own descriptor boundary with method-only prototype traversal (Sections 6–7);
- one detached workspace observation (Section 8);
- closed `'1' | '2'` configuration versions and the presence-based `requiresV2` predicate (Section 9);
- closed branch truth table with `legacy-not-permitted` and no rerouting (Section 10);
- outer/inner version correlation with both versions static-identity-bound (Section 11);
- detached lifecycle snapshot with duplicate-ID fail-closed (Section 12);
- runtime trust table with no phantom brands (Section 13);
- `staticInputCorrelationIdentity` with the complete canonical projection and truthful non-guarantees (Section 14);
- RuntimeGrant captured-model static projection and post-validation semantic derivation (Section 15);
- four-set effective capability intersection plus the mandatory active RuntimeGrant gate and deny-only constraints, deny wins, no expansion (Section 16);
- numeric Model C (configuration-derived only, three-source minimum) (Section 17);
- constructible semantic-finalization pipeline (Section 18);
- non-circular result identity with exact normalization (Section 19);
- finding families and deterministic precedence (Section 20);
- conformance/corpus impact (no WP-3 schema change; F-01-authorized fixture/rule/vector additions) (Section 21);
- exact implementation surface (Section 22);
- consolidated test matrix (Section 23);
- superseded decisions (Section 24);
- implementation authorization gate (Section 25).

## Superseded Decisions Removed

The normative contract contains **no** superseded alternatives as options. Section 24 lists, as explicitly non-normative, every major withdrawn decision: nested configuration field; package-root public router; package-root concrete configuration API and opaque handle; caller capability ceilings; caller numeric fields in v2 (both optional-narrowing and exact-duplication models); containment decisions in v2 (and their brands/identity revalidation); a single `evaluationInputIdentity`; static identity containing a pre-validated grant max-actions scalar; phantom bundle/policy/grant brands; self-referential result identity; mutable lifecycle array; silent v1-to-v2 rerouting; generic configuration-version inequality; prototype traversal for plain protocol data; a generic `variant: 'v1'` tag without an executable declaration; "later stages are skipped after any failure" for ordinary eligibility findings; partial-capture digests labeled complete identities.

## Contradictions Found and How Resolved

1. **Numeric ambiguity (F-P3-EL-24):** optional caller narrowing vs exact correlation copies → resolved by Model C (configuration-derived only); caller numeric fields forbidden in v2; ADR-024/F-R6 rules 3–4 interpreted as internal derivation satisfying "supply," with no caller duplication.
2. **Grant identity timing (F-P3-EL-25):** static identity binding a pre-validated grant max-actions scalar vs construction before semantic validation → resolved by binding the captured grant model in static identity and deriving the validated scalar only after semantic validation.
3. **Semantic-denial constructibility (F-P3-EL-20):** "both identities on semantic denials" vs "later stages skipped after any failure" → resolved by the three-class control flow (boundary failure / complete semantic evaluation / internal exception) with static identity before evaluation and accumulation-to-finalization.
4. **Routing bypass (F-P3-EL-04, F-P3-EL-18):** legacy entry vs authoritative enforcement → resolved by the internal authoritative router plus explicitly non-authoritative legacy utility, and the closed branch truth table.
5. **Workspace observation (F-P3-EL-11):** multiple workspace readings → resolved by one detached workspace value used for lookup, `requiresV2`, correlation, and evaluation.
6. **Version semantics (F-P3-EL-15):** generic inequality vs closed routing → resolved by the presence-based `requiresV2` over the closed `'1' | '2'` union with the version facts table.
7. **View trust (F-P3-EL-05, F-P3-EL-16):** "type-check without invocation" and own-or-prototype data extraction → resolved by exact-own data descriptors plus receiver-bound callable adapters with zero-getter/zero-Proxy guarantees.
8. **Identity completeness (F-P3-EL-06, F-P3-EL-12):** incomplete single identity → resolved by distinct static and result identities with non-circular projection and truthful guarantees.
9. **Brand claims (F-P3-EL-21):** phantom brands for bare models → resolved by the runtime trust table using only the three existing WeakSet brands.
10. **Package boundary (F-P3-EL-22):** router usability vs configuration secrecy → resolved by the internal router with the traced legitimate caller path and zero package-root additions.
11. **Lifecycle mutability (F-P3-EL-13):** pass-through records array → resolved by one detached frozen snapshot shared by duplicate checking, lookup, evaluation, and identity.

**HCR corrections (final holistic review):**

12. **HCR-01 (RuntimeGrant capability authority):** the consolidated contract's intersection formula named the active RuntimeGrant as a capability-set member without an exact source → resolved by the gate-plus-constraints model: the committed grant schema contains no capability allow-list, so the effective capability set is global ∩ workspace ∩ approved policy ∩ consumer support, and the validated active grant is a mandatory prerequisite gate with deny-only narrowing (reconciled explicitly with F-01/F-R6 in Sections 15, 16, 18, 20, 23, 24).
13. **HCR-02 (exact closed static projection):** "binds at minimum" and "registry identity/model" → resolved by one fixed-shape `PointOfUseStaticInputProjection` with exact keys, tagged absence for every optional operand, exact registry (four scalars) and lifecycle (`recordId` + captured model as embedded `ImmutableJsonValue`) projections, unknown-key prohibition, and a `projectionProtocolVersion` update rule.
14. **HCR-03 (lifecycle representation and identity terminology):** mixed lifecycle representations → resolved by the sole Model A representation (fresh frozen array of branded wrapper references; no deep-clone; identity via the exact record projection); the forbidden-field list was narrowed from the vague "any caller-supplied identity field" to exact enumerated correlation/trust-bearing fields while the callable `identity` view remains allowed; exact nested own-key shapes were added for `AcceptedRegistryContext`, lifecycle data members, `RequestedUse`, and `ConsumerSupportDeclaration`.
15. **HCR-04 (report Git status):** this report previously described the post-consolidation tree as clean → corrected to the exact before/after Git-state description above; the post-consolidation working tree is not clean (two authorized untracked files).

**HCRR corrections (final holistic rereview):**

16. **HCRR-01 (exact v2 version literals):** `outerRouterVersion` and `innerPointOfUseInputsVersion` in `PointOfUseStaticInputProjection` narrowed from `'1' | '2'` to the exact literal `'2'` — static identity exists only on `eligibility-v2`, both versions are safely captured and validated before projection construction, v1 evaluations receive no static identity, and future protocol versions require a projection-protocol update rather than widening the v2 projection. Configuration version `'1' | '2'`, the router request union, the v1 compatibility branch, and the result family are unchanged.
17. **HCRR-02 (one-pass JCS representation):** `bundle.capturedModel`, `policy.capturedModel`, `grant.capturedModel`, and `lifecycleRecords[].model` are deeply frozen `ImmutableJsonValue` members embedded directly in the fixed projection — not pre-serialized JCS strings, byte arrays, buffers, or byte members; the complete projection is JCS-serialized exactly once (object-key canonicalization inside every captured model occurs as part of that single whole-projection serialization; arrays preserve protocol-defined order); the SHA-256 input is `PGAP-POINT-OF-USE-INPUT-v2\0` + the UTF-8 bytes of the one canonical JCS serialization; canonical serialized bytes remain internal and are not embedded as members. Result identity domain `PGAP-POINT-OF-USE-RESULT-v2\0` and independent recomputation vectors are unchanged.

No architecture, routing, authority, trust, RuntimeGrant, lifecycle, numeric, package-boundary, or result-family decision was reopened by the HCRR corrections.

## Unresolved Decisions

None. Every decision relevant to security, API, identity, routing, or authority is fixed in the normative contract; remaining freedom is limited to non-normative naming (exact `POU2-###` code strings, digest domain string already fixed in-contract, module split, conformance context variant, test layout), which is explicitly implementation-owned and cannot alter the normative semantics.

## Confirmation That No Implementation Occurred

No Phase-3 production code, tests, schemas, fixtures, vectors, generated corpus, package files, or existing implementation modules were created or modified. The working tree contains exactly the two authorized documents as untracked additions. Nothing was staged, committed, pushed, tagged, published, released, installed, or deployed. PointOfUseInputs v2 implementation has not started.

## Exact Final Status

**WP-6 PHASE 3 FINAL IDENTITY-SCHEMA CORRECTION: READY FOR IMPLEMENTATION AUTHORIZATION**

OPEN HOLISTIC FINDINGS: 0
OPEN CONTRACT DECISIONS: 0
OPEN INTERNAL CONTRADICTIONS: 0
ARCHITECTURE DECISIONS REOPENED: 0
IMPLEMENTATION STARTED: NO
IMPLEMENTATION AUTHORIZATION: NOT YET GRANTED
NEXT GATE: EXPLICIT HUMAN IMPLEMENTATION AUTHORIZATION
WP-6 STATUS: NOT CLOSED

This correction resolved HCR-01 through HCR-04 and HCRR-01 through HCRR-02. No architecture decision was reopened. The consolidated contract remains the sole normative Phase-3 specification; superseded decisions remain non-normative; no implementation occurred.
