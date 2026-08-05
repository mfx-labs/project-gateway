# WP-6 Phase 3B Implementation Report — Authoritative Internal Router and Semantic Authority Integration

**Status:** Implementation report for WP-6 Phase 3B (PointOfUseInputs v2 authoritative internal router and complete v2 semantic authority evaluation), implemented on top of the accepted Phase-3A foundation under the granted WP-6 Phase 3 human implementation authorization. Phase-3 conformance expansion and WP-6 closure are **not** part of this package. Nothing was staged, committed, pushed, tagged, published, released, installed, or deployed.

## Repository, Branch, Baseline HEAD

- Repository: `/home/chef/Documents/Project_Gateway_MCP`; branch `main`.
- Baseline HEAD: `93e6ce177cb70e4baec1b003b7290c0ee5e51eba` (`feat: establish WP-6 Phase 3A boundary foundation`); parent `7d2dc27e28b63ed7cb6b1fa3357c45b869c883f0`.
- Git state before implementation: staging empty; working tree clean; zero untracked paths; zero tags; Phase 3A committed and closed; no Phase-3B implementation; no conformance expansion.

## Authoritative Contract

- Path: `docs/specs/wp-6-phase-3-point-of-use-v2-contract.md`; committed SHA-256 `7d792f0fa61fc4088d4d74254213c452215bbc429dd2498d82901bc69e2a6e48` (verified). No superseded decision from contract Section 24 was reintroduced.

## Files Added

Production (`src/pointofuse/**`):

- `routing.ts` — the authoritative internal configuration-aware router `evaluatePointOfUseEligibilityForConfiguration(configuration, request): PointOfUseRoutingResult`, the presence-based `requiresV2` predicate, workspace resolution, static projection/identity integration, closed branch dispatch, and deterministic boundary/exception handling.
- `evaluate-v2.ts` — the v2 semantic authority path: bridging of detached v1/v2 inputs into the committed evaluator, the grant gate record-type check, capability-ceiling denial computation, `deriveValidatedActiveGrantMaxActions`, `evaluateV2Semantics` (finding accumulation and deterministic finalization), and `finalizeV2Report` (non-circular result identity + deep-frozen `EligibilityReportV2`).

Tests (`tests/pointofuse-v2/**`): `routing.test.ts`, `evaluate-v2.test.ts`, `authority-v2.test.ts`, `numeric-v2.test.ts`, `result-finalization-v2.test.ts`, `boundary-v2.test.ts`.

## Files Modified

- `src/pointofuse/findings-v2.ts` — extended the closed POU2 catalog with POU2-015…POU2-022 (config-not-genuine, config-version, workspace-unknown, legacy-not-permitted, evaluation-exception, global/workspace capability-ceiling semantic findings, grant record-type semantic finding) plus their factories.
- `src/pointofuse/index.ts` — internal barrel exports for the router, `requiresV2`, the v2 evaluation helpers, and the new findings.
- `tests/pointofuse-v2/helpers.ts` — Phase-3B world fixtures (corpus-derived genuine configuration, branded lifecycle chain, registry context, v1/v2 evaluation inputs).

## Files Verified Unchanged

`src/index.ts` (byte-identical; zero diff), `src/api/types.ts` (no additional internal type was strictly required — all Phase-3B types fit the existing internal modules), `src/api/validate.ts`, `src/pointofuse/evaluate.ts` (**no refactor was required**: the committed evaluator is reused as-is through typed bridging — direct v1 output is byte-for-byte identical because the v1 path and the evaluator itself are untouched), `src/pointofuse/router-types.ts`, `router-capture.ts`, `input-capture.ts`, `view-capture.ts`, `lifecycle-snapshot.ts`, `identity-v2.ts`, `src/adapters/**`, `src/trusted/**`, `src/internal/snapshot.ts`, `schemas/**`, `fixtures/**`, `src/conformance/**`, semantic rule catalogs, digest-vector catalogs, generated corpus, `package.json`, `package-lock.json`, ADRs, committed contract documents, existing design documents, and the Phase-3A implementation report.

`src/pointofuse/model-capture.ts` is NOT in the unchanged set: it was modified during the focused correction to enforce recursive canonical-number admissibility at the v2 bare-model boundary (see the Focused Correction section). The shared `src/internal/snapshot.ts` was not modified.

## Internal Router Architecture

The router (internal only; reachable exclusively through the internal point-of-use barrel; never exported from the package root) executes:

1. **Configuration genuineness** — the existing trusted-configuration WeakSet brand is verified before any configuration field read; forged, cloned, and Proxy-wrapped configurations fail closed with a `router-failure` (`config-not-genuine`, POU2-015), no identities, no exception leakage. No new configuration brand.
2. **Shell capture** — the exact router request union via the Phase-3A exact-own capture; typed failures per the closed stage precedence.
3. **Branch dispatch** — v1 variant: detached v1 capture → configuration-version check → workspace lookup (single detached value) → `requiresV2` → `legacy-not-permitted` (POU2-018) when required, otherwise detached v1 evaluation through the committed evaluator (`eligibility-v1`, ordinary `EligibilityReport`, no identities). v2 variant: detached v2 capture → configuration-version check → workspace lookup → `requiresV2` (informational on this branch) → static projection → static identity → `evaluateV2Semantics` → `finalizeV2Report` (`eligibility-v2`, both identities).
4. **Exception containment** — the whole router body is wrapped; unexpected failures become a deterministic `router-failure` (`evaluation-exception`, POU2-019) with a static message; static-identity failures map to `static-identity` (POU2-013) and result-identity failures to `identity-construction` (POU2-014), both without partial reports or leaked identities.

## Genuine Configuration Boundary

The router receives the genuine trusted configuration as a separate argument; the existing brand predicate (`isGenuineValidatedTrustedWorkspaceConfiguration`) is used; supported versions are exactly `'1' | '2'` with a defensive closed switch (`config-version`, POU2-016 — unreachable for genuine configurations); canonical roots are never exposed; findings contain no roots or paths.

## Workspace Lookup

The single detached workspace value from Phase-3A is used for the trusted-configuration workspace lookup, `requiresV2`, requested-use correlation, evaluator construction, and the static projection. The hostile input workspace is never reread; unknown workspaces fail as a router boundary failure (`workspace-unknown`, POU2-017) with no semantic evaluation and no identities.

## `requiresV2` Implementation

Exact presence-based predicate: `globalCapabilityCeiling present OR matched-workspace capabilities present OR globalActionCeiling present OR matched-workspace actionCeiling present`. Field presence, not truthiness: zero numeric ceilings count as present; present capability ceilings with absent or empty capabilities count as present. `artifactLocation` alone never forces v2; no generic configuration-version inequality; no reflective future-key detection; no caller override; no capability or numeric values taken from v2 inputs. Computed only after the matched workspace is resolved.

## Closed Routing Table

Implemented exactly per the normative table: v1 + `!requiresV2` → detached v1 evaluation; v1 + `requiresV2` → `legacy-not-permitted`; v2 + either → v2 evaluation; malformed request, v2-with-legacy-field, and v1-without-declaration → router failure. No upgrade, downgrade, reroute, or fallback; the result kind always matches the safely captured branch.

## V1 Compatibility Path

The direct public `evaluatePointOfUseEligibility` is unchanged (API, behavior, hostile-object semantics). The routed v1 branch evaluates the detached reconstructed v1 input through the same committed evaluator; tests prove semantic equivalence (eligible flag, finding message keys, rule IDs) with the direct entry for valid records. No configuration ceiling is silently ignored: any configured capability or numeric ceiling forces `requiresV2`, and a v1 request under a v2-required configuration returns `legacy-not-permitted` before any v1 semantic evaluation.

## V2 Semantic-Evaluation Architecture

The v2 path reuses the committed `evaluateEffectiveAuthority` exactly (no second evaluator, no refactor): bundle/policy structure, subject correlation, registry context, approval chain, lifecycle, activation, revocation, validity windows, grant correlation, consumer support, operation/resource/scope constraints, grant constraint vocabulary, and numeric grant constraints are all committed machinery operating on the Phase-3A detached operands (receiver-bound adapters, frozen lifecycle snapshot, deterministic lookup, captured bare models). The v2-only additions run after the base evaluation: the grant record-type gate (POU2-022), configured capability-ceiling enforcement (POU2-020/POU2-021), combined deterministic finalization (committed `sortFindings`; eligible = no findings; firstFailingPhase, categories, ruleIds, subjectCorrelations recomputed), and non-circular result-identity finalization.

## Proof That Direct V1 Behavior Remains Unchanged

`src/pointofuse/evaluate.ts` and `src/api/validate.ts` have zero diff lines; the direct entry's code path is untouched; the v1 suite (84 effective-authority tests + 33 core tests) passes unchanged; the routed v1 branch is additive and internal.

## RuntimeGrant Gate Behavior

The grant is a mandatory eligibility gate and deny-only constraint source, never a capability set (HCR-01). The committed evaluator establishes structure, record correlation (bundle/workspace/registry), lifecycle correlation, activation, revocation, validity window, and narrowed-constraint vocabulary before any contribution; the v2 grant gate adds the record-type check (`record_type === 'RuntimeGrant'`, POU2-022) so a non-grant record cannot act as the grant. Absence, invalidity, inactivity, revocation, expiry, or correlation failure denies eligibility as an ordinary complete semantic evaluation (`eligibility-v2`, both identities) and contributes no authority and no numeric limit.

## Capability-Set Computation

`effective capability set = configured global capability ceiling ∩ configured workspace capability ceiling ∩ approved applicable AuthorityPolicy ∩ validated consumer support` (policy and consumer are enforced by the committed evaluator; the v2 stage adds the two configured ceilings). Absence is not an empty set; a PRESENT ceiling with absent or empty capabilities denies every capability (committed Phase-1 presence-aware semantics); no operand expands another; deny wins. Capability findings use category `AGGREGATE-RESPONSIBILITY-FAILURE` with closed rule IDs (`000-GLOBAL-CAPABILITY-CEILING` / `000-WORKSPACE-CAPABILITY-CEILING`) that sort before every numeric finding under the committed deterministic ordering, so capability denials precede numeric denials in the report (contract evaluation order: capability intersection before numeric narrowing).

## Configured Numeric Model C

V2 carries no caller numeric fields (an input carrying them fails exact-shape rejection → router failure). Configured global and workspace numeric ceilings are passed as the committed evaluator's numeric operands, so the committed AUT-001/LFC-008 checks implement the minimum-narrowing semantics (`effective numeric limit = min(configured global if present, configured workspace if present, validated active grant max-actions if present)`). `deriveValidatedActiveGrantMaxActions` computes the grant-side operand (minimum of structurally valid numeric `max-actions` entries; undefined when the grant is absent or any entry is malformed — malformed entries already produce the committed `pou.grant-unknown-constraint` denial). The derived scalar is never part of the static identity; numeric limits never grant capability; capability authorization precedes numeric narrowing.

## Finding-Catalog Additions and Precedence

POU2-001…POU2-014 (Phase-3A, unchanged); POU2-015 config-not-genuine; POU2-016 config-version; POU2-017 workspace-unknown; POU2-018 legacy-not-permitted; POU2-019 evaluation-exception; POU2-020 semantic global capability-ceiling denial; POU2-021 semantic workspace capability-ceiling denial; POU2-022 semantic grant record-type denial. Router boundary findings carry `stage` and no identities; semantic findings use the committed Finding shape. Precedence: boundary stages (genuineness → shell → versions → capture → workspace → identity construction) before semantic stages; capability findings before numeric findings (closed rule-ID ordering); committed phase/category/ruleId sort governs semantic ordering; no root, path, secret, stack, or hostile-value leakage.

## Boundary Versus Semantic Finalization

Boundary and identity failures → `router-failure`, no identities, no partial report. Semantic denials (policy, grant, capability ceiling, numeric) → complete `eligibility-v2` with both identities; finalization never terminates merely because eligibility is false. `EligibilityReportV2` is deeply frozen; the base report is never mutated; the result identity is computed from the finalized normalized base report and the static identity (non-circular).

## Static and Result Identity Integration

Static identity is built only after genuine configuration, branch validation, v2 capture, workspace resolution, lifecycle snapshot, bare-model capture, and the complete static projection (contract Section 14: exact version literals, tagged ceilings, captured bundle/policy/grant, four-scalar registry, sorted lifecycle projections). Live callable outcomes, containment, roots, derived grant state, and final findings are excluded. Result identity binds the static identity plus the normalized report (findings project stable protocol fields only).

## Package-Export Verification

`src/index.ts` byte-identical; the package export map is unchanged; the direct v1 entry unchanged; all Phase-3A names and all Phase-3B names are absent from the package root. Export-count inventory: the Phase-3A negative-export list asserts **14 names**; the Phase-3B negative-export list asserts **18 Phase-3B internal names** (the router and `requiresV2`; eight evaluate-v2 helpers; eight POU2-015…022 finding factories); the combined distinct name count is **31**, because the router name `evaluatePointOfUseEligibilityForConfiguration` appears in both review lists. The internal router is reachable only through the internal point-of-use barrel; no concrete trusted-configuration API is public; no new deep-import subpath.

## Test Files and Exact Counts

Phase-3A (after the focused correction and the final minor correction):

- `router-capture.test.ts` — 19; `input-capture.test.ts` — 32; `view-capture.test.ts` — 18; `lifecycle-snapshot.test.ts` — 14; `model-capture.test.ts` — 18; `identity-v2.test.ts` — 19; `boundary-scope.test.ts` — 7. Phase-3A total: **127**.

Phase-3B (all executed directly under `dist-test/tests/pointofuse-v2/`):

- `routing.test.ts` — 20 (A: genuineness 4; B: requiresV2 5; C: truth table 7; D: v1 compatibility 5 — including the denied-v1 deep-equivalence test).
- `evaluate-v2.test.ts` — 16 (E: successful v2 2; F: grant gate 14).
- `authority-v2.test.ts` — 22 (G: capability ceilings 12; H: grant constraints 10).
- `numeric-v2.test.ts` — 19 (I: numeric Model C).
- `result-finalization-v2.test.ts` — 19 (J: boundary vs semantic 9; K: identity behavior 5; L: ordering/normalization 4).
- `boundary-v2.test.ts` — 9 (M: package/scope boundary incl. the complete 18-name export inventory).

Phase-3B total: **105**. Combined focused total (Phase-3A 127 + Phase-3B 105): **232/232 pass** (every test exactly once; updated counts in the Focused Correction section). Helper-only file: `helpers.ts`.

## Exact Commands

- `npx tsc -p tsconfig.json --noEmit` — production typecheck.
- `npx tsc -p tsconfig.tests.json` — test build (emits `dist-test/tests/pointofuse-v2/**`).
- `node --test "dist-test/tests/pointofuse-v2/*.test.js"` — all focused suites.
- `node --test dist-test/tests/pointofuse-v2/<file>.test.js` — per-file runs.
- `npm test` — repository-default suite. The default suite does **not** include the focused `pointofuse-v2` suites (the package script globs unit/integration/security/pi-adapter/trusted only); focused suites are executed explicitly as above. No package-script change was made.

## Typecheck Results

Production typecheck PASS; test typecheck PASS.

## All Verification Totals

- Phase-3A focused: **127/127**; Phase-3B focused: **105/105**; combined focused: **232/232** (every test exactly once; totals after the focused correction and the final minor correction).
- Repository-default: **1115/1115**.
- Trusted: **570/570**; legacy WP-4/WP-5A: **515/515**; shared snapshot: **30/30** (combined non-trusted run 545/545, explicitly combined).
- Integration/conformance assertions: **90/90** (conformance 531/531, schemas 51/51, semantic rules 114/114, digest vectors 19/19).
- Generated corpus: byte-reproducible (`npm run generate` → zero diff beyond the authorized new paths).

## Generated-Corpus Result

Byte-reproducible; no corpus, fixture, vector, manifest, semantic-rule, or conformance change exists (Phase 3C deferred).

## Known Limitations

1. The committed evaluator's fail-closed grant-constraint branches treat PASSING `read-only` and `require-exact-resource` constraints as unknown-constraint denials (committed behavior — violation-only branches fall through); Phase 3B preserves this behavior and documents it in the authority tests.
2. The result-identity defensive failure path is reachable only through non-JCS-representable normalized values; the committed report surface cannot carry such values through ordinary evaluation, so the path is exercised at the identity layer (unit-level, no production seam). The static-identity defensive catch is retained as an internal-failure containment path only: after the M-1 correction, no valid captured projection can reach it because of number representation (finite non-integer and unsafe numbers are rejected at v2 bare-model capture).
3. `deriveValidatedActiveGrantMaxActions` is the contract's grant-side operand of the minimum formula; narrowing itself is enforced by the committed per-constraint checks — no duplicate numeric machinery was introduced.
4. Phase-3B adds no conformance fixtures, semantic rules, vectors, runner context, corpus expansion, or default-script integration (Phase 3C).

## Focused Correction (M-1, M-2, m-1, m-2)

Bounded corrections applied after the Phase-3B senior review; no router, authority, RuntimeGrant, capability, numeric, lifecycle, or identity architecture decision was reopened, and no Phase-3C work was begun.

### Corrected Paths (exact)

- `src/pointofuse/model-capture.ts` (modified) — canonical-number boundary validation.
- `tests/pointofuse-v2/model-capture.test.ts` (modified) — canonical-number unit tests (+3).
- `tests/pointofuse-v2/result-finalization-v2.test.ts` (modified) — fractional static-identity test rewritten (+2 net).
- `tests/pointofuse-v2/routing.test.ts` (modified) — denied-v1 deep-equivalence test (+1).
- `tests/pointofuse-v2/boundary-v2.test.ts` (modified) — complete 18-name negative-export coverage (+2).

No other file changed. `src/pointofuse/routing.ts` required no change: the router already maps the shared model-capture failure to `findingModelCapture` (POU2-011, stage `model-capture`).

### M-1 — Canonical-Number Boundary Rule

**Why the prior classification was wrong:** a finite non-integer value such as `1.5` is JSON-representable (the committed `snapshotJson` accepts it) but NOT canonical-input-representable (the committed RFC 8785 serializer accepts exactly safe integers; `-0` is normalized to `0` and is admissible). The prior implementation let such values reach static-identity construction, where the committed canonicalizer threw, and the router mislabeled the failure as `static-identity` (POU2-013). Per the normative contract (Sections 14/15) captured models are embedded as JSON values and canonicalized during whole-projection serialization — a numeric value must never be able to fail static identity; non-canonical numbers belong at the capture boundary.

**Exact new behavior:** `captureBareModel` now walks the DETACHED captured JSON value (never the hostile source; zero getter/Proxy `get`; no mutation; key-order and array-order preserved) and rejects any number that is not a safe integer. Admissibility is exactly the committed JCS numeric profile: safe integers accepted (including `-0`, which the serializer normalizes to `0`); finite non-integer values (`1.5`) and unsafe integers (`2**53`) rejected; non-finite values remain rejected by the committed `snapshotJson`. The failure is the EXISTING typed model-capture boundary failure — `model-capture` stage, POU2-011 (`findingModelCapture`) — with no static identity, no result identity, and no semantic evaluation. No new finding code was introduced; no shared `snapshotJson` change; direct v1 behavior unchanged; no policy/grant/bundle/schema semantic validation was added (malformed-but-canonical content such as a string-valued `max-actions` still captures and becomes a complete semantic denial with both identities). The static-identity catch remains solely as a defensive internal-failure containment path.

### M-2 — Denied-V1 Deep Equivalence

`routing.test.ts` adds a routed-v1 versus direct-v1 denied-result equivalence test: a valid v1 input whose requested capability is denied by policy and consumer support (deterministic denial) under a configuration with `requiresV2` false; equivalent FRESH inputs for the direct public entry and the routed branch; `assert.deepEqual` over the COMPLETE reports — `eligible`, `requestedUse`, `capability`, `scope`, `workspaceId`, `subjectCorrelations`, `firstFailingPhase`, `categories`, `ruleIds`, and every ordered finding with all stable fields. Direct v1 production code untouched.

### m-2 — Complete Negative-Export Coverage

`boundary-v2.test.ts` now asserts the complete Phase-3B internal surface — **18 names** — absent from the package-root namespace: the router and `requiresV2` (routing.ts); `bridgeV1Input`, `bridgeV2Input`, `capabilityDenialFindings`, `deriveValidatedActiveGrantMaxActions`, `evaluateDetachedV1`, `evaluateV2Semantics`, `finalizeV2Report`, `grantGateFindings` (evaluate-v2.ts); `findingConfigNotGenuine`, `findingConfigVersion`, `findingWorkspaceUnknown`, `findingLegacyNotPermitted`, `findingEvaluationException`, `semanticGlobalCapabilityCeilingDenial`, `semanticWorkspaceCapabilityCeilingDenial`, `semanticGrantRecordTypeDenial` (findings-v2.ts). Additional assertions: `src/index.ts` contains no Phase-3B name at the source level; the package exports map remains exactly `{'.', './pi-adapter'}` with no wildcard, no `./src` deep-import, no `pointofuse`/`api` subpath. The package-root surface is unchanged.

### m-1 — Deferred Phase-3C Rule IDs (RESOLVED in Phase 3C1, Model B)

Phase 3B emitted five provisional rule IDs that were not registered in the committed 114-rule catalog. **Phase 3C1 resolved the debt under Model B** (replace provisional IDs with final catalog-compliant IDs): the committed catalog conventions (family-dash-NNN rule IDs such as `AUT-*`/`LFC-*`) prohibit the placeholder `000-*` form and the use of finding codes (`POU2-020/021/022`) as rule IDs. The final mapping, applied in `src/pointofuse/findings-v2.ts` and registered in `src/semantic/rules.ts`:

| Provisional rule ID | Final rule ID | Emitting factory | Notes |
|---|---|---|---|
| `000-GLOBAL-CAPABILITY-CEILING` | `AUT-000` | `semanticGlobalCapabilityCeilingDenial` | Final catalog rule "Configured capability ceiling denies" (registered; sorting anchor: `AUT-000` sorts before the numeric findings' `AUT-001`/`LFC-008` anchors under the committed comparator, preserving capability-before-numeric report order). |
| `POU2-020` | — (removed from ruleIds) | `semanticGlobalCapabilityCeilingDenial` | POU2-020 remains the finding CODE; finding codes are not rule IDs. |
| `000-WORKSPACE-CAPABILITY-CEILING` | `AUT-000` | `semanticWorkspaceCapabilityCeilingDenial` | Same registered rule; the finding remains distinct by message key and finding code POU2-021. |
| `POU2-021` | — (removed from ruleIds) | `semanticWorkspaceCapabilityCeilingDenial` | POU2-021 remains the finding CODE. |
| `POU2-022` | `LFC-012` | `semanticGrantRecordTypeDenial` | Final catalog rule "RuntimeGrant record type"; `LFC-008` retained alongside. POU2-022 remains the finding CODE. |

Finding code, stage, category, message key, eligibility, report order, and authority semantics are unchanged — only the emitted `ruleIds` metadata changed. The semantic catalog count is now **116** (114 + `AUT-000` + `LFC-012`); the Phase-3B report's earlier "deferred" status is superseded by the Phase-3C1 registration, conformance fixtures, vectors, and corpus expansion (see `docs/reports/wp-6-phase-3c1-conformance-integration-implementation-report.md`). **WP-6 Phase 3 cannot close until registration, fixtures, vectors, conformance coverage, and the closure review are complete (Phase 3C2).**

### Updated Test Files and Counts (after correction)

Phase-3A files (one file gained tests):

- `model-capture.test.ts` — 18 (12 committed + 3 M-1 canonical-number tests: finite non-integer rejection across bundle/policy/grant shapes; unsafe-integer rejection with `-0`/safe-integer acceptance; JCS-serializability of accepted models; + 3 final-minor-canonical edge probes: `Number.MAX_SAFE_INTEGER` acceptance; negative safe integer with nested placement; `-0`/`0` canonical equivalence incl. equal static-input identities).

Phase-3B files:

- `routing.test.ts` — 20 (19 + 1 denied-v1 deep-equivalence).
- `evaluate-v2.test.ts` — 16 (unchanged).
- `authority-v2.test.ts` — 22 (unchanged).
- `numeric-v2.test.ts` — 19 (unchanged).
- `result-finalization-v2.test.ts` — 19 (17 − 1 fractional-static-identity + 3 M-1 boundary/semantic tests).
- `boundary-v2.test.ts` — 9 (7 + 2 m-2 export-boundary tests).

Phase-3A total: **127**; Phase-3B total: **105**; combined focused: **232/232** (every test exactly once; none skipped). The previous combined totals (221, then 229) were NOT preserved artificially; the actual new total after the denied-v1, canonical-boundary, and final-minor edge-probe tests is 232.

### Final Minor Correction (three canonical-number edge probes + report accuracy)

- Added exactly three probes to `tests/pointofuse-v2/model-capture.test.ts`: (A) `Number.MAX_SAFE_INTEGER` is accepted with the exact value preserved, deep freeze retained, and committed JCS accepting it; (B) a negative safe integer (`-42`) is accepted, including nested placement, with committed JCS accepting the captured value; (C) `-0` and `0` capture equivalently — `jcsSerialize(capturedNegativeZero) === jcsSerialize(capturedPositiveZero)`, serialization contains canonical `0` (never `-0`), and embedding the two captures in otherwise identical static projections yields equal static-input identities via the existing production helpers (`buildStaticInputProjection` + `computeStaticInputCorrelationIdentity`; no production seam). No production implementation changed; all existing tests retained (fractional rejection, unsafe-integer rejection, nested recursive validation, bundle/policy/grant shared behavior, malformed-but-canonical semantic behavior, JCS-serializability).
- Report accuracy: `src/pointofuse/model-capture.ts` removed from the "Files Verified Unchanged" inventory (it was modified in the focused correction); Phase-3B negative-export count corrected to **18 names** (Phase-3A 14; combined distinct 31 — the router name appears in both lists); per-file and total test counts corrected to the measured values above.

### Rerun Verification Totals (after correction)

- Production typecheck PASS; test typecheck PASS.
- Focused: model-capture 18/18; result-finalization-v2 19/19; routing 20/20; boundary-v2 9/9; Phase-3A **127/127**; Phase-3B **105/105**; combined **232/232**.
- Repository-default **1115/1115**; trusted **570/570**; legacy **515/515**; shared snapshot **30/30**; integration **90/90** (conformance 531/531, schemas 51/51, semantic rules 114/114, digest vectors 19/19).
- Generated corpus: byte-reproducible (zero diff beyond the authorized paths).

### Scope Verification (correction)

No conformance fixture, semantic rule catalog, vector, runner, corpus, package script, schema, ADR, contract, or design document changed; no Phase-3C file change; no package-script change; no unauthorized path. The rule catalog count remains 114. Regression confirmations: brand-first behavior, single workspace observation, `requiresV2`, routing truth table, direct v1 behavior, RuntimeGrant gate, committed constraint behavior, four-set capability intersection, numeric Model C, finding accumulation, static projection shape, one-pass JCS, live-view identity behavior, result finalization, and the package boundary are all unchanged (full suites green above).

### Git State (after correction)

- Staging empty; no commit; no push; no tag; no release; no deployment; HEAD unchanged `93e6ce177cb70e4baec1b003b7290c0ee5e51eba`.
- Working tree: 5 modified tracked paths (`src/pointofuse/findings-v2.ts`, `src/pointofuse/index.ts`, `src/pointofuse/model-capture.ts`, `tests/pointofuse-v2/helpers.ts`, `tests/pointofuse-v2/model-capture.test.ts`) + 9 untracked paths (Phase-3B production/test files and this report). No unauthorized path.

### Correction Verdict

**WP-6 PHASE 3B FOCUSED CORRECTION: READY FOR CORRECTION REVIEW**

## Deferred Phase-3C Work

Conformance fixture additions; semantic rule catalog additions; digest or semantic vector additions; conformance runner v2 context; generated corpus expansion; default test-script integration; WP-6 Phase-3 closure review. None implemented in Phase 3B.

## Blockers

None.

## Git State After Implementation

- Staging empty; no commit; no push; no tag; no release; no deployment; HEAD unchanged `93e6ce177cb70e4baec1b003b7290c0ee5e51eba`.
- Working tree: 5 modified tracked paths (`src/pointofuse/findings-v2.ts`, `src/pointofuse/index.ts`, `src/pointofuse/model-capture.ts`, `tests/pointofuse-v2/helpers.ts`, `tests/pointofuse-v2/model-capture.test.ts`) + 9 untracked paths (Phase-3B production/test files and this report). No unauthorized path.

## Readiness Verdict

**WP-6 PHASE 3B FOCUSED CORRECTION: READY FOR CORRECTION REVIEW**

OPEN MAJOR FINDINGS: 0
OPEN MODERATE FINDINGS: 0
OPEN MINOR FINDINGS: 0
PHASE 3B IMPLEMENTATION: CORRECTED
PHASE 3B IMPLEMENTATION COMMITTED: NO
PHASE 3C IMPLEMENTATION AUTHORIZATION: NOT GRANTED
NEXT GATE: PHASE 3B FOCUSED CORRECTION REVIEW
WP-6 STATUS: NOT CLOSED
