# WP-6 Phase 3 — PointOfUseInputs v2 — Normative Contract

**Status:** Consolidated normative specification for WP-6 Phase 3 (PointOfUseInputs v2). Implementation has **not** started. This document consolidates every accepted Phase-3 decision (eligibility review F-P3-EL-01 through F-P3-EL-25 and their corrections) into one internally consistent contract. Human implementation authorization has **not** been granted. WP-6 is **not** closed.

**Authority order:** committed architecture and source code (ADR-024 F-R6, `trusted-workspace-and-ceiling-configuration.md` F-01/F-07/F-EL5, roadmap closure gate, committed `src/**`) take precedence over any earlier review language; later accepted corrections supersede contradictory earlier Phase-3 review language. Superseded alternatives are listed in Section 24 and are non-normative.

---

## 1. Status and Scope

**WP-6 Phase 3 name:** PointOfUseInputs v2 — the capability-aware, configuration-correlated extension of the Artifact Core point-of-use boundary (F-01, Model A; F-R6), implemented as an **internal authoritative router** plus an additive v2 evaluation path.

**Objective:** allow point-of-use effective-authority evaluation to consume sufficient trusted correlation data from the runtime-genuine trusted configuration (capability and numeric ceilings, workspace identity, vocabulary version) while preserving the committed v1 contract, the committed evaluator semantics, deny-wins authority, and the accepted internal trust boundary.

**State:** implementation not started; contract consolidated; human implementation authorization not yet granted; WP-6 not closed.

**Explicit exclusions (Phase 3 implements none of these):**

- containment-decision consumption (Phase-2A/2B decisions remain owned by WP-7/WP-11 at the operation boundary);
- filesystem revalidation;
- persistence;
- any filesystem mutation;
- WP-7, WP-10, WP-11, WP-12 behavior;
- MCP write tools;
- Pi behavior;
- pi-guard behavior;
- package-root trusted-configuration exposure.

---

## 2. Existing V1 Contract

**Current public legacy entry (unchanged):** `evaluatePointOfUseEligibility(inputs: PointOfUseInputs): EligibilityReport` — exported from the package root (`src/index.ts`), defined in `src/api/validate.ts`, delegating to `evaluateEffectiveAuthority` in `src/pointofuse/evaluate.ts`.

**Current v1 input shape (exact, `PointOfUseInputs`):** `currentTime: string`; `workspaceId: string`; `requestedUse` (`capability`, `capabilityVersion?`, `operationClass`, `resourceClass`, `scope`, `workspaceId`); `globalActionCeiling?: number`; `workspaceActionCeiling?: number`; `consumerSupport` (`consumerId`, `supportedProtocolFeatures`, `supportedConsumerCapabilities`, `supportedExtensionNamespaces`); `identity: IdentityStateView`; `resolver: ExactSubjectResolver`; `registry: AcceptedRegistryContext`; `lifecycle: LifecycleStateView`; `revocations: RevocationView`; `bundle: ImmutableModel` (required); `policy: ImmutableModel` (required); `grant?: ImmutableModel`.

**Current v1 result:** the committed `EligibilityReport` (`eligible`, `requestedUse`, `capability`, `scope`, `workspaceId`, `subjectCorrelations`, `firstFailingPhase?`, `categories`, `ruleIds`, `findings`).

**Current v1 hostile-object behavior:** v1 inputs are **not descriptor-captured**; the legacy evaluator reads fields directly. This behavior is preserved exactly for the direct legacy entry.

**Current v1 unknown-field tolerance:** v1 silently tolerates unknown extra fields. This is preserved for the direct legacy entry.

**Direct v1 compatibility status:** the direct v1 utility remains **unchanged and byte-identical**, including its exact hostile-object access behavior, its caller-supplied numeric fields, and its unknown-field tolerance.

**Non-authoritative configuration-aware status:** the direct v1 entry has **no configuration operand**, cannot detect configured capability or numeric ceilings, and cannot enforce them. It is a **documented non-authoritative compatibility utility**; it is not part of the Phase-3 enforcement claim. Its use is contractually restricted to the explicitly identified legacy/test compatibility path (F-R6 rule 5) with no configured ceiling, no required capability-aware semantics, and an explicit consumer declaration.

---

## 3. Authoritative Internal Router

**Internal-only status:** the authoritative router `evaluatePointOfUseEligibilityForConfiguration(configuration, versionedInputs)` is **internal** — it is exported only through an owned internal point-of-use barrel, never from the package root.

**Legitimate caller:** the trusted local control plane (host boundary) — the same trusted code that validates and holds the runtime-genuine configuration.

**Genuine configuration supply:** the genuine configuration is a **separate runtime-genuine argument** (never nested inside the hostile input record); the router checks its runtime brand before any field read.

**Boundary:** no package-root export of the router; no concrete trusted-configuration type exported from the package root; no opaque public handle (none is needed because the router is internal); canonical roots remain trusted-process internal.

**WP-5B consumption boundary:** WP-5B (later package) consumes the router's `EligibilityReport`/`EligibilityReportV2` through an owned internal module and never recomputes the intersection.

**Exact router request union (normative):**

```ts
type VersionedPointOfUseRouterRequest =
  | {
      readonly routeProtocolVersion: "1";
      readonly legacyCompatibilityMode: "explicit-legacy-test";
      readonly inputs: PointOfUseInputs;
    }
  | {
      readonly routeProtocolVersion: "2";
      readonly inputs: PointOfUseInputsV2DataAndViews;
    };
```

The v1 variant requires **both** literals. The v2 variant **forbids** `legacyCompatibilityMode` (exact-shape rejection).

---

## 4. Router Result Family

**Exact result family (normative):**

```ts
type PointOfUseRoutingResult =
  | {
      readonly kind: "router-failure";
      readonly stage: RouterFailureStage;
      readonly findings: readonly POU2Finding[];
    }
  | {
      readonly kind: "eligibility-v1";
      readonly eligibility: EligibilityReport;
    }
  | {
      readonly kind: "eligibility-v2";
      readonly eligibility: EligibilityReportV2;
    };
```

**Identity availability per variant (normative):**

| Variant | staticInputCorrelationIdentity | pointOfUseResultIdentity |
|---|---|---|
| `router-failure` | absent | absent |
| `eligibility-v1` | absent | absent |
| `eligibility-v2` | present (mandatory) | present (mandatory) |

The discriminator is the explicit `kind` literal — never optional identity fields. There is no partial or hybrid result form. Result kind always matches the safely captured request branch.

---

## 5. V2 Input Shape

**`PointOfUseInputsV2DataAndViews` — complete exact own-key shape (normative):**

- `pointOfUseInputsProtocolVersion: "2"` — required, exact literal (Section 11);
- `workspaceId: string`;
- `requestedUse` (exact `RequestedUse` shape);
- `currentTime: string`;
- `consumerSupport` (exact `ConsumerSupportDeclaration` shape);
- `identity` (callable view);
- `resolver` (callable view);
- `registry` (`AcceptedRegistryContext`: scalars + branded snapshot);
- `lifecycle` (`records` array of branded records + retained callable methods);
- `revocations` (callable view);
- `bundle: ImmutableModel` (bare model, required);
- `policy: ImmutableModel` (bare model, required);
- `grant?: ImmutableModel` (bare model, optional).

**Forbidden in v2 (exact-shape rejection, fail closed):** any nested configuration field; any caller capability ceiling; `globalActionCeiling`; `workspaceActionCeiling`; containment decisions of any kind; and the following exact caller-supplied correlation or trust-bearing fields: `staticInputCorrelationIdentity`; `pointOfUseResultIdentity`; `configurationIdentity`; any caller-supplied configuration digest; any caller-supplied trusted ceiling identity; and any equivalent unrecognized correlation field (rejected by exact-shape validation). The callable field `identity` (the `IdentityStateView`) remains **allowed**; the prohibition covers correlation and trust-bearing **data** fields only.

**Field classification (normative):**

| Field | Class |
|---|---|
| `pointOfUseInputsProtocolVersion`, `workspaceId`, `requestedUse`, `currentTime`, `consumerSupport` data fields, registry scalars | **pure data** (exact-own descriptor capture) |
| `identity`, `resolver`, `revocations`, lifecycle callable methods | **callable views** (receiver-bound adapters, Section 7) |
| `bundle`, `policy`, `grant` | **bare models** (descriptor-captured, Section 13) |
| registry snapshot, lifecycle records | **branded wrappers** (existing WeakSet brands) |
| configuration, capability ceilings, numeric ceilings, containment decisions, correlation/trust-bearing identity fields (Section 5) | **forbidden** |

**Exact nested own-key shapes (normative):**

- `AcceptedRegistryContext`: own keys `registryProtocolId` (string), `registrySnapshotFormatVersion` (string), `registrySnapshotId` (string), `registrySnapshotDigest` (string), `snapshot` (branded registry wrapper).
- `LifecycleStateView` data members used by v2: `records` (array of branded lifecycle record wrappers, handled per Section 12); the callable `findRecord` is governed by the receiver-bound adapter rule (Section 7).
- `RequestedUse`: own keys `capability` (string), `capabilityVersion?` (string), `operationClass` (string), `resourceClass` (string), `scope` (string), `workspaceId` (string).
- `ConsumerSupportDeclaration`: own keys `consumerId` (string), `supportedProtocolFeatures` (string array), `supportedConsumerCapabilities` (string array), `supportedExtensionNamespaces` (string array).

Callable prototype methods remain governed separately by the receiver-bound adapter rule (Section 7).

---

## 6. Exact-Own Descriptor Boundary

**Normative rule:** all router and PointOfUse **protocol-data** fields must be **own properties, data descriptors, enumerable, exactly expected key spelling, captured exactly once**.

Rejected, fail closed, with zero getter invocation and zero Proxy `get`:

- inherited protocol fields (including prototype-supplied `workspaceId`, `requestedUse`, and `requestedUse.workspaceId`);
- accessor fields (rejected without invocation);
- symbol protocol fields;
- unknown fields;
- non-enumerable protocol fields;
- missing descriptors;
- structural traps;
- revoked Proxies.

Capture produces **detached deeply immutable data**; the original protocol records are **never reread**; mutation after capture has no effect.

**Prototype traversal** is permitted **only** for explicitly enumerated callable method names under the receiver-bound view-adapter contract (Section 7). It is never generalized to plain protocol data.

---

## 7. Callable View Adapters

**Receiver-bound extraction (normative):**

- **identity view:** `findInstance`, `findRevision`, `findPredecessor`, `verifyRegistration`;
- **resolver:** `resolve`;
- **revocation view:** `revocationsByTarget`;
- **lifecycle callable methods:** `findRecord` where retained.

Rules:

- each member is extracted **exactly once** through own-or-prototype data descriptors (accessor descriptors anywhere on the walk rejected without invocation; traps and revoked Proxies fail closed);
- the original receiver is retained and calls are made via `Reflect.apply` (receiver-preserving);
- no protocol-member reread of the original view object after adaptation;
- method replacement after capture has no effect (the adapter holds the extracted reference);
- receiver live state may affect outcomes (documented behavior);
- live outcomes are **excluded from static identity** and are reflected in the **result identity** through the resulting findings and eligibility outcome.

The committed class-style implementations (prototype methods) are accepted through this protocol; a merely structural caller-created object is never labeled "trusted."

---

## 8. Workspace Snapshot and Correlation

**Normative rules:**

- **one detached workspace observation** per evaluation;
- `inputs.workspaceId` obtained from an **own data descriptor**;
- `requestedUse` obtained from an **own data descriptor**;
- `requestedUse.workspaceId` obtained from an **own data descriptor**;
- all three values detached before lookup or evaluation;
- equality checks: `requestedUse.workspaceId === captured inputs.workspaceId` (committed WSP-008 semantics) and the captured workspace must equal the configuration workspace lookup result;
- the **same** captured workspace value is used for configuration workspace lookup, `requiresV2`, requested-use correlation, and the evaluator input — routing and evaluation cannot diverge;
- neither prototype data nor later mutation can influence routing (detached deep capture);
- the original nested input record is never passed into the router-selected evaluator (detached reconstruction for both branches).

---

## 9. Configuration Versions and `requiresV2`

**Current version facts (normative):** supported genuine configuration versions are exactly `"1" | "2"` (closed union; unknown versions fail validation and can never carry the runtime brand). Both versions may contain capability ceilings (`globalCapabilityCeiling`, workspace `capabilities`) and numeric ceilings (`globalActionCeiling`, workspace `actionCeiling`) with identical field shapes; `artifactLocation` is version-2-only and **alone does not force PointOfUse v2**.

**Exact `requiresV2` predicate (normative, presence-based, version-independent):**

```text
requiresV2 =
  configured global capability ceiling present
  OR matched-workspace capability ceiling present
  OR configured global numeric ceiling present
  OR matched-workspace numeric ceiling present
```

- No generic inequality (`configurationVersion !== '1'` is forbidden as a routing predicate).
- No reflective or heuristic future-key detection; a future configuration operand that must force v2 requires an **explicit protocol update** to this contract.
- Unsupported configuration versions fail closed via a closed `'1' | '2'` switch.
- The configuration version that governs `requiresV2` is bound in the static identity.

---

## 10. Closed Branch Truth Table

**Normative table:**

| Request | `requiresV2` | Result |
|---|---:|---|
| valid v1 legacy request | false | detached v1 compatibility evaluation |
| valid v1 legacy request | true | router failure: `legacy-not-permitted` |
| valid v2 request | false | v2 evaluation |
| valid v2 request | true | v2 evaluation |
| malformed or unknown request | any | router failure |
| v2 request carrying legacy-only field | any | router failure |
| v1 request missing legacy declaration | any | router failure |

**Normative rules:** no silent protocol-version conversion; no v1 input passed to the v2 evaluator; no v2 input passed to the v1 evaluator; no automatic upgrade or downgrade; no fallback after branch-specific capture failure; the returned result `kind` always matches the safely captured request branch; the legacy declaration is a request only and never overrides configuration-owned ceiling requirements.

---

## 11. Outer and Inner Version Correlation

**Normative rules:**

- outer `routeProtocolVersion` and inner `pointOfUseInputsProtocolVersion` are both **exact-own enumerable data properties**;
- the router shell is safely captured **before** nested input inspection;
- a v2 route **requires** the nested protocol field;
- both must equal the exact literal `"2"`; each is **separately validated**;
- missing, malformed, inherited, accessor-backed, non-enumerable, numeric, unknown, or future inner values fail closed;
- outer `"2"` with inner ≠ `"2"` never reaches semantic evaluation, static identity, or result construction;
- a nested version mismatch **never triggers v1 fallback**;
- the outer version is **never substituted** into the inner projection;
- **both** versions are bound in the static identity (they express distinct protocol layers).

**Finding precedence (normative):** router-shell structural failure → outer route-version failure → nested v2 input structural failure → missing nested protocol version → nested protocol-version mismatch → workspace capture failure → configuration-version failure → workspace lookup failure. All failures before complete v2 static projection return `router-failure` with no complete identities.

---

## 12. Lifecycle Snapshot

**Normative rules:**

- the lifecycle records array is descriptor-inspected (length and index descriptors); sparse arrays, accessor indexes, inherited indexes, non-enumerable indexes where prohibited, symbol properties, extra properties, structural traps, and revoked Proxies are rejected;
- each record reference is extracted exactly once;
- each record is **brand-checked** (existing `recordWrappers` WeakSet);
- **duplicate record IDs fail closed** (equal-digest and conflicting-digest duplicates alike; no collapsing);
- one **fresh frozen array containing the exact branded wrapper references** is built — the wrappers are **never deep-cloned**; the **deterministic lookup** is built only from that frozen array;
- evaluation and static identity use the **same** detached snapshot;
- the original array and lifecycle `records` property are **never reread**;
- the caller's live `findRecord` is **not an independent semantic source** — semantic lookups use the deterministic lookup derived from the frozen snapshot;
- semantic evaluation reads the wrapper models; identity projection uses the exact `StaticLifecycleRecordProjection` defined in Section 14;
- this is the **sole** lifecycle snapshot representation — no detached record-model projection variant exists.

**Ordering:** original array order has no semantic meaning for evaluation; identity uses a canonical ordering sorted by `recordId`.

---

## 13. Runtime Trust Table

**Normative table (final):**

| Operand | Runtime mechanism |
|---|---|
| trusted configuration | **existing runtime brand** (`validatedConfigurations` WeakSet; `isGenuineValidatedTrustedWorkspaceConfiguration`) |
| registry wrapper | **existing runtime brand** (`registryWrappers`; `isBrandedRegistry`) |
| lifecycle records | **existing runtime brand** (`recordWrappers`; `isBrandedRecord`) |
| bundle | **captured bare model** (descriptor-safe deep capture; structural + semantic validation; no brand) |
| policy | **captured bare model** (same) |
| grant | **captured bare model** (same) |
| callable views | **receiver-adapted structural views** (Section 7; no brand) |
| lifecycle lookup | **derived from the detached snapshot** |

**No brand is claimed for bare bundle, policy, or grant models.** No new brand is introduced. A structural object is never labeled runtime-genuine.

**Finding boundary (normative):** boundary capture failure; genuine-brand failure; malformed bare-model structural failure; and semantic approval/activation denial are **distinct** finding families with distinct stages — never one vague "operand validation" stage.

---

## 14. Static Input Correlation Identity

**Name:** `staticInputCorrelationIdentity`.

**Purpose:** audit correlation for the **captured static input only**.

**It does not prove:** grant validity; grant activity; live view state; equal eligibility results; replay resistance; authorization. Equal static identity guarantees equal captured static operands under the canonical projection; it does not guarantee equal live-view outcomes or equal reports.

**Complete canonical projection (normative — exact fixed shape, unknown keys prohibited):**

```ts
interface PointOfUseStaticInputProjection {
  readonly projectionProtocolVersion: '1';
  readonly outerRouterVersion: '2';              // safely captured routeProtocolVersion; exact literal only
  readonly innerPointOfUseInputsVersion: '2';    // safely captured pointOfUseInputsProtocolVersion; exact literal only
  readonly configurationVersion: '1' | '2';
  readonly configurationIdentity: string;
  readonly capabilityVocabularyVersion: string;
  readonly inputWorkspaceId: string;
  readonly requestedUseWorkspaceId: string;
  readonly requestedUse: RequestedUseProjection;       // exact Section 5 shape
  readonly currentTime: string;
  readonly configuredGlobalCapabilityCeiling: TaggedCapabilitySet;
  readonly configuredWorkspaceCapabilityCeiling: TaggedCapabilitySet;
  readonly configuredGlobalNumericCeiling: TaggedNumericValue;
  readonly configuredWorkspaceNumericCeiling: TaggedNumericValue;
  readonly consumerSupport: ConsumerSupportProjection;
  readonly bundle: TaggedCapturedModel;                // required input; always 'present'
  readonly policy: TaggedCapturedModel;                // required input; always 'present'
  readonly grant: StaticGrantProjection;
  readonly registry: RegistryProjection;
  readonly lifecycleRecords: readonly StaticLifecycleRecordProjection[];
}

type TaggedCapabilitySet =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly capabilities: readonly string[] }; // canonical sorted, deduplicated

type TaggedNumericValue =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: number }; // non-negative safe integer

type TaggedCapturedModel =
  | { readonly state: 'present'; readonly capturedModel: ImmutableJsonValue }; // deeply frozen captured JSON model value; canonicalized when the complete projection is JCS-serialized

type StaticGrantProjection =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly capturedModel: ImmutableJsonValue };

interface RegistryProjection {
  readonly registryProtocolId: string;
  readonly registrySnapshotFormatVersion: string;
  readonly registrySnapshotId: string;
  readonly registrySnapshotDigest: string;
}

interface StaticLifecycleRecordProjection {
  readonly recordId: string;
  readonly model: ImmutableJsonValue;                  // deeply frozen captured JSON model value; canonicalized when the complete projection is JCS-serialized
}

interface ConsumerSupportProjection {
  readonly consumerId: string;
  readonly supportedProtocolFeatures: readonly string[];        // canonical sorted; duplicates rejected
  readonly supportedConsumerCapabilities: readonly string[];   // canonical sorted; duplicates rejected
  readonly supportedExtensionNamespaces: readonly string[];    // canonical sorted; duplicates rejected
}
```

(Exact member spellings are normative; the supporting type names above are the canonical shape. `ImmutableJsonValue` means a deeply frozen plain JSON value embedded directly in the projection — never a pre-serialized JCS string, byte array, buffer, or byte member.)

**Member rules (normative):**

- `outerRouterVersion` and `innerPointOfUseInputsVersion` are the exact literal `'2'` only: `staticInputCorrelationIdentity` exists only on `eligibility-v2`; both versions have already been safely captured and validated before static projection construction; v1 evaluations receive no static identity; no valid static projection may contain version `'1'`; future protocol versions require a `projectionProtocolVersion` update rather than widening this projection;
- every member is required in the fixed shape; optional operands use **explicit tagged absence** (`state: 'absent'`) — omission is never used as absence, and the two representations are never mixed;
- capability ceilings and consumer-support arrays are canonical sorted with duplicates rejected **before projection**;
- numeric values are non-negative safe integers (configuration values are load-time validated);
- `bundle` and `policy` are required v2 inputs and project as `present` with the full captured model embedded as a deeply frozen `ImmutableJsonValue` — not pre-serialized; no non-authoritative instance/revision tuple is used;
- `grant` uses the exact tagged union above (`present` = full captured model embedded as a deeply frozen `ImmutableJsonValue`);
- `registry` binds exactly the four authoritative correlation scalars of the accepted registry context; the captured snapshot model is not duplicated in the projection (its digest binds it);
- `lifecycleRecords` is sorted canonically by `recordId`; each entry projects the record ID and the captured record model as a deeply frozen `ImmutableJsonValue` (the committed record wrapper carries no digest field, so no digest is invented);
- the projection **prohibits unknown keys**; no additional identity operand may be added without a `projectionProtocolVersion` update;
- callable function serialization, live identity-view outcomes, live resolver outcomes, and live revocation outcomes are **excluded**;
- the complete projection is **JCS-serialized exactly once**: object-key canonicalization inside every captured model occurs as part of that single whole-projection serialization, and arrays preserve their protocol-defined order; the SHA-256 input is `PGAP-POINT-OF-USE-INPUT-v2\0` + the UTF-8 bytes of that one canonical JCS serialization (formatted `sha-256:<hex>`); the canonical serialized bytes remain internal and are **not themselves embedded as projection members**; independent recomputation vectors are required in tests without the production constructor.

---

## 15. RuntimeGrant Static and Semantic Treatment

**Static treatment (normative):**

- **Capability authority (normative):** the committed RuntimeGrant schema contains **no capability allow-list** — no capability field exists on the grant, and the narrowed-constraint vocabulary (`read-only`, `max-actions`, `require-exact-resource`, `scope`, `operation-class`, `resource-class`, unknown → fail closed) contains no capability member. RuntimeGrant is therefore **never described as a capability set**; it participates as a mandatory prerequisite gate plus deny-only narrowing (Section 16).

- grant absence is represented by an **explicit tagged absence** member in the fixed-shape projection;
- grant presence is projected as the **complete descriptor-captured grant model** embedded as a **deeply frozen `ImmutableJsonValue`** — not pre-serialized; the value is canonicalized when the complete projection is JCS-serialized (no invented instance/revision/digest tuple);
- JCS object-key ordering applies (code-unit sorted, order-independent);
- array order is **preserved as captured** (the grant model is model-byte identity; `narrowed_constraints` has no declared set semantics);
- malformed-but-safely-captured models are represented as embedded captured JSON model values (the projection canonicalizes captured data during whole-projection serialization; it does not validate);
- unsupported capture values (functions, cycles, unsupported prototypes) fail at boundary capture → `router-failure`, no identities;
- the projection contains no secrets; canonical bytes remain internal.

**Post-static validation order (normative):**

1. structurally validate the captured grant model;
2. correlate to bundle, workspace, registry, lifecycle records, and the current evaluation (committed `LFC-008`/`WSP-008`/`REG-008`/`LFC-010` semantics);
3. establish lifecycle, activation, revocation, and validity-window state (committed `LFC-007`/`EXE-001`/`EXE-005`/`EXE-007` semantics);
4. validate narrowed-constraint shape and vocabulary (committed `LFC-008`/`SEC-003` semantics);
5. derive `validatedActiveGrantMaxActions` (absent | non-negative safe integer) — the minimum of the structurally valid numeric `max-actions` entries, provided no malformed entry exists (a malformed entry is a committed fail-closed denial);
6. serve as the mandatory point-of-use gate and contribute deny-only narrowing (operation class, resource class, scope, read-only, `max-actions`, and every other recognized narrowed constraint) and numeric narrowing **only when all prerequisite checks pass**; the grant never introduces a capability absent from configuration, policy, or consumer support.

**Normative consequences:** an invalid or inactive grant contributes **no capability authority and no numeric limit**; a grant semantic denial is an ordinary complete evaluation (both identities); static identity never claims a validated grant state.

---

## 16. Capability Authority Evaluation

**Validation before contribution (normative):** only these **validated** operands participate:

- configured global capability ceiling (genuine configuration);
- configured workspace capability ceiling (genuine configuration);
- approved, applicable AuthorityPolicy (lifecycle-chain-approved; bundle/workspace-correlated);
- active, unrevoked, temporally valid, correlated RuntimeGrant;
- validated consumer support declaration.

**Effective capability set (normative):** the committed RuntimeGrant schema and narrowed-constraint vocabulary contain **no capability allow-list**, so the RuntimeGrant is not a capability-set member. The effective capability set is:

```text
effective capability set
=
configured global capability ceiling
∩ configured workspace capability ceiling
∩ approved applicable AuthorityPolicy
∩ validated consumer support
```

**RuntimeGrant participation (normative — gate plus narrowing, reconciled with F-01/F-R6):** F-01's five-set intersection names the active RuntimeGrant as a member; because the grant carries no capability allow-list, its intersection contribution is exactly a mandatory prerequisite gate with deny-only constraints:

```text
point-of-use eligibility requires
an active, unrevoked, temporally valid,
bundle/workspace/registry-correlated RuntimeGrant
```

The validated active grant then narrows: operation class, resource class, scope, read-only, `max-actions`, and every other recognized narrowed constraint. Absence, inactivity, revocation, expiry, or correlation failure denies eligibility; the grant never introduces a capability absent from configuration, policy, or consumer support; grant narrowed constraints can only deny or narrow.

- **Deny wins**; unknown denied; unsupported-required-semantics denied.
- Capability extraction is never used before operand validation.
- **No operand can expand configuration authority.**
- Containment is absent (it is a WP-7/WP-11 host-boundary safety predicate, never an authority operand).
- Capability authorization occurs **before** numeric narrowing.

---

## 17. Numeric Authority

**Final model: Model C — configuration-derived only (normative).** PointOfUseInputs v2 contains **no caller numeric fields** (`globalActionCeiling` and `workspaceActionCeiling` are forbidden and rejected as unknown fields). Caller numeric fields exist only on the direct v1 compatibility contract (unchanged).

**Effective numeric limit (normative):**

```text
effective numeric limit
=
minimum(
  configured global numeric ceiling if present,
  configured workspace numeric ceiling if present,
  validated active RuntimeGrant max-actions if present
)
```

**Rules (normative):**

- all values are non-negative safe integers; `NaN`, ±Infinity, fractional, negative, and overflow fail closed (configured values at configuration load; grant constraint as a committed semantic denial);
- configured values are load-time validated; absence and zero are distinct; zero is present and denying;
- grant malformed constraint → committed `pou.grant-unknown-constraint` (LFC-008/SEC-003) denial;
- numeric denial is an ordinary complete semantic evaluation (`eligibility-v2`, both identities);
- capability authorization occurs before numeric narrowing;
- numeric ceilings **never grant** a missing capability and never create authority.

---

## 18. Semantic Evaluation and Finalization Pipeline

**Control-flow classes (normative):**

**A. Boundary failure** — configuration genuineness, shell capture, route/declaration identification, nested capture, inner-version validation, configuration-version, workspace lookup, branch table, detached-input construction, view adaptation, lifecycle snapshot, brand/bare-model capture, static projection, static identity. Terminates immediately with `{ kind: 'router-failure', stage, findings }`; **no** static identity, **no** result identity, **no** semantic evaluation.

**B. Complete semantic evaluation** — once the genuine configuration, safely captured router request and v2 input, receiver-bound adapters, detached lifecycle snapshot, validated static operands, and complete static canonical projection all exist: compute `staticInputCorrelationIdentity`; evaluate semantic rules with **finding accumulation** (ordinary deny findings do not terminate the pipeline; only structural preconditions such as missing bundle/policy or invalid chain subjects short-circuit their dependent sub-pipeline, exactly as the committed evaluator does); continue through deterministic report finalization; construct the normalized report base; compute `pointOfUseResultIdentity`; construct the final immutable `EligibilityReportV2`. **A denied semantic evaluation is a complete evaluation and receives both identities.**

**C. Unexpected internal exception** — during semantic evaluation or identity construction: deterministic `router-failure` (stage `evaluation-exception` / `identity-construction`) with a typed finding; never an escaping exception; never mixed with ordinary deny findings; never a partial v2 report.

**Final executable order (normative):**

1. configuration genuineness;
2. router and branch selection;
3. detached v2 capture, including the complete grant model or its absence;
4. lifecycle snapshot and callable-view adaptation;
5. complete static projection (configured numeric ceilings and the captured grant model bound);
6. static identity;
7. grant and other semantic validation;
8. derive the validated capability sets (policy, consumer) and establish the validated active grant as the mandatory gate with its narrowed constraints;
9. deny-wins capability intersection;
10. operation and scope constraints;
11. derive `validatedActiveGrantMaxActions`;
12. configured/grant numeric minimum narrowing;
13. normalized base report;
14. non-circular result identity;
15. final immutable `EligibilityReportV2`.

Boundary failures (1–6) → `router-failure`, no identities; semantic denials (7–12) → complete `eligibility-v2` with both identities; identity failures (6, 14) → `router-failure`, no partial report.

---

## 19. EligibilityReportV2 and Result Identity

**Type (normative):**

```ts
interface EligibilityReportV2 extends EligibilityReport {
  readonly staticInputCorrelationIdentity: string;
  readonly pointOfUseResultIdentity: string;
}
```

**Non-circular result projection (normative):**

```text
pointOfUseResultIdentityProjection =
{
  pointOfUseResultIdentityProtocolVersion: "1",
  routingVariant: "v2",
  staticInputCorrelationIdentity: <string>,   // outer member only; not inside normalizedReport
  normalizedReport: <NormalizedEligibilityReportWithoutResultIdentity>
}
```

The projection excludes `pointOfUseResultIdentity` itself, mutable object identity, functions, canonical bytes, and non-protocol fields.

**Normalization (normative):**

- `findings`: ordered sequence in the report's own deterministic order; each finding projects `phase`, `category`, `messageKey` (never localized prose), `ruleIds` (sorted set), `subjectIdentity`, `location`;
- `categories`: set-like — sorted, deduplicated;
- `ruleIds`: set-like — sorted, deduplicated;
- `subjectCorrelations`: map — JCS code-unit key ordering;
- `requestedUse`: fixed-shape projection (all subfields incl. optional `capabilityVersion`);
- optional fields: explicit omission;
- ordered vs set-like collections distinguished exactly as above.

**Result identity guarantees (normative):** equal normalized report projection produces equal digest; different projections are expected to produce different digests subject to cryptographic collision assumptions; the digest is **audit correlation only** — not authorization input, not replay resistance. Exact domain: `PGAP-POINT-OF-USE-RESULT-v2\0`. Independently recomputable.

---

## 20. Finding Families and Precedence

**Finding families (normative, closed):**

- router boundary findings (per `RouterFailureStage`: config-not-genuine, shell-structural, route-tag, legacy-declaration, workspace-capture, config-version, workspace-unknown, legacy-not-permitted, input-capture, view-adaptation, lifecycle-snapshot, operand-brand, model-capture, inner-version missing/mismatch, static-projection, static-identity, identity-construction, evaluation-exception);
- configuration brand failures;
- capture failures (hostile/inherited/accessor/symbol/unknown/non-enumerable/trap/revoked-proxy);
- version failures (outer, inner, configuration);
- workspace failures (committed WSP-003/004/008 semantics);
- legacy-not-permitted;
- bare-model structural failures;
- semantic lifecycle/approval/grant findings (committed LFC-001/002/003/006/007/008, EXE-001/005/007, REG-005/006/008/010, PUB-005/008, AUT-001/002/003, SEC-003, ART-007, BND-001/007 semantics — reused unchanged; grant findings are gate and narrowing findings — the grant is never a capability-set operand);
- capability ceiling findings (new POU2 ceiling family; exact identifiers implementation-owned);
- numeric findings (committed `pou.global-ceiling`, `pou.workspace-ceiling`, `pou.grant-ceiling`, `pou.grant-workspace-ceiling`, `pou.grant-unknown-constraint`);
- identity-construction failures;
- internal exception findings.

**Deterministic precedence (normative):**

1. boundary stages in the Section 18/11 order (genuineness → shell → route/declaration → nested capture → inner version → config version → workspace → branch → input construction → views → lifecycle → brands/models → static projection → static identity);
2. semantic findings in the committed evaluator's phase-ordered deterministic order (structure → workspace → chain → lifecycle → grant → activation → revocation → consumer → policy → grant constraints);
3. capability ceiling findings after operand validation (capability intersection precedes numeric narrowing);
4. numeric findings never precede policy, grant, lifecycle, or consumer validation findings;
5. identity-construction and internal-exception findings are router-boundary failures.

Findings remain deterministic, deeply immutable, root-safe, path-safe, secret-free, and free of canonical-path disclosure.

---

## 21. Conformance and Generated Artifacts

**Normative decisions:**

- **No WP-3 schema change** is required (v2 is a trusted-process API type; the grant/lifecycle schemas are authoritative and unchanged); any future schema need must be separately justified.
- **Conformance and corpus changes are required and authorized** by F-01: new conformance fixtures, semantic AUT-* rules, and digest/semantic vectors covering capability ceilings and numeric Model C; the conformance runner gains a v2 context variant.
- Generated artifacts (schema bundle, corpus bundle) remain **byte-reproducible**; counts rise from the committed baseline (531/51/114/19) — the new totals are implementation-owned and must be recorded exactly.
- The package root, schemas catalog, and digest-vector sets of prior phases remain unchanged except for the intentional conformance additions.

---

## 22. Exact Implementation Surface

**Files likely added (all internal):** `src/pointofuse/router-types.ts`; `src/pointofuse/routing.ts`; `src/pointofuse/input-capture.ts`; `src/pointofuse/view-capture.ts`; `src/pointofuse/lifecycle-snapshot.ts`; `src/pointofuse/model-capture.ts`; `src/pointofuse/evaluate-v2.ts`; `src/pointofuse/identity-v2.ts`; `src/pointofuse/findings-v2.ts`; an internal point-of-use barrel for owned consumers.

**Files likely modified:** `src/api/types.ts` (internal v2 types); `src/pointofuse/evaluate.ts` (v2 additive extension; committed v1 sequence untouched); `src/api/validate.ts` (internal router wrapper; legacy wrapper unchanged); `src/conformance/runner.ts` (v2 context variant); conformance fixtures, manifest, semantic rules, digest vectors, generated corpus (F-01-authorized); tests; `docs/design/trusted-workspace-and-ceiling-configuration.md` (Phase-3 section; F-07 three-source enumeration); the implementation report.

**Files required unchanged:** `src/index.ts` (package root — **no Phase-3 exports added**); `src/internal/snapshot.ts`; `src/trusted/**` (consumed only); `src/adapters/**` production code; `package.json`/`package-lock.json` (no dependency or script change); WP-3 schemas; ADR-024; all Phase-1/2A/2B-P/2B modules and identities.

**Exports (normative):** package-root exports — **none added, all preserved**; internal exports — the router, v2 types, envelope, and helpers through the owned internal barrel only.

**Adapters:** no production adapter change; the pi-adapter test helper migrates to the internal router with a genuine configuration.

**Documentation:** the design-document Phase-3 section and this consolidated contract; the implementation report.

---

## 23. Required Test Matrix

Consolidated normative categories (each states its security or compatibility purpose):

| Category | Purpose |
|---|---|
| Routing | enforcement path is router-selected; no bypass via caller choice; branch result-kind correctness |
| Exact-own capture | hostile/inherited/accessor/symbol/non-enumerable/trap/revoked-proxy data cannot supply protocol values; zero getter/Proxy `get` |
| Outer/inner versions | version correlation cannot diverge silently; no fallback; no identity on mismatch |
| Workspace snapshot | one immutable workspace observation; no routing/evaluation divergence; mutation immunity |
| Receiver preservation | callable views extracted once; `Reflect.apply` receiver semantics; method replacement has no effect |
| Lifecycle snapshot | one detached frozen array; duplicate IDs fail closed; lookup/evaluation/identity share the snapshot |
| Runtime trust | only real brands used; forged branded values rejected; bare models never labeled genuine |
| Grant identity | captured-model projection; static identity does not claim validity/activity; semantic denials change result identity only |
| Capability intersection | validation before contribution; the RuntimeGrant is a mandatory gate with deny-only constraints, never a capability set; deny wins; no expansion |
| Numeric Model C | three-source minimum; absence/zero; malformed grant constraint; capability before narrowing; no caller fields |
| Static identity | independent recomputation; one-operand differences; excluded live state acknowledged |
| Result identity | non-circular; normalization exact; collision claims phrased as cryptographic assumptions |
| Boundary vs semantic results | router failures carry no identities; semantic denials carry both; exceptions deterministic |
| V1 regression | direct legacy utility byte-identical; authoritative detached v1 branch semantically equivalent on valid records |
| Package boundary | no package-root Phase-3 exports; root-bearing types absent; internal router path |
| Conformance | new fixtures/rules/vectors; corpus byte-reproducible |
| Secrecy and no-I/O | findings/identities/reports disclose no roots or paths; no fs/network/process/clock/randomness; no write/persistence tokens |

Duplicate test descriptions from the correction trail are removed; the category set above is exhaustive and non-overlapping.

---

## 24. Superseded Decisions

The following decisions were made during the Phase-3 review trail and are **withdrawn / superseded; non-normative**:

- nested configuration field inside the v2 input record (superseded: configuration is a separate runtime-genuine argument);
- package-root public router export (superseded: internal authoritative router; no package-root Phase-3 exports);
- package-root concrete trusted-configuration API and opaque public configuration handle (superseded: internal supply; no handle);
- caller-supplied capability ceilings (forbidden);
- caller numeric fields in v2, including optional caller narrowing and exact caller/configuration numeric duplication (superseded: Model C — configuration-derived only; caller numeric fields exist only on the direct v1 contract);
- containment decisions inside PointOfUseInputs v2, including decision-genuineness brands and decision-identity revalidation inside Phase 3 (superseded: zero containment decisions; boundary unchanged; WP-7/WP-11 own the decisions);
- a single `evaluationInputIdentity` claimed as the identity of the complete evaluated input (superseded: distinct `staticInputCorrelationIdentity` + `pointOfUseResultIdentity` with truthful guarantees);
- static identity binding a pre-validated "active grant max-actions" scalar (superseded: static identity binds the captured grant model; the derived scalar exists only after semantic validation);
- phantom runtime brands for bare bundle/policy/grant models (superseded: captured bare models; no new brands);
- self-referential result-identity projection (superseded: non-circular projection excluding `pointOfUseResultIdentity`);
- mutable/pass-through lifecycle records array (superseded: one detached frozen snapshot and deterministic lookup);
- silent v1-to-v2 rerouting, upgrades, downgrades, or fallback after branch-specific failure (superseded: closed branch truth table; `legacy-not-permitted`);
- generic configuration-version inequality as a routing predicate (superseded: closed presence-based `requiresV2`);
- prototype traversal for plain protocol data (superseded: exact-own data descriptors; prototype traversal limited to enumerated callable methods);
- a generic `variant: 'v1'` router tag without an executable legacy declaration (superseded: two-literal declaration `routeProtocolVersion: "1"` + `legacyCompatibilityMode: "explicit-legacy-test"`);
- optional caller numeric narrowing (Model A) and exact correlation copies (Model B) as numeric models (superseded by Model C);
- a RuntimeGrant capability allow-list or an "active RuntimeGrant capability set" (superseded — HCR-01: the committed grant schema and narrowed-constraint vocabulary contain no capability field; the grant is a mandatory gate plus deny-only narrowing);
- "later stages are skipped after any failure" wording for ordinary eligibility findings (superseded: semantic denials complete finalization; only boundary failures and structural preconditions terminate early);
- partial-capture digests labeled complete static-input identities (superseded: router failures before complete static projection carry no identities).

Superseded decisions are non-normative and must not be implemented.

---

## 25. Implementation Authorization Gate

Implementation of WP-6 Phase 3 may begin only after **all** of the following:

1. this consolidated contract is complete and internally consistent (this document);
2. one final holistic read-only contract review returns **zero findings** (no blocker, major, moderate, minor, or unresolved note);
3. explicit human implementation authorization is granted.

The final holistic review must verify the consolidated contract against committed architecture and source code, and must confirm that no superseded decision (Section 24) has been reintroduced. Until then, no Phase-3 code is written, no files are staged or committed, PointOfUseInputs v2 is not started, and WP-6 remains not closed.
