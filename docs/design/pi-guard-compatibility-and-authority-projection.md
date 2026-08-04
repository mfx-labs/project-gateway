# pi-guard Compatibility, Authority Projection, and Enforcement Evidence (Planning Draft)

**Status:** Planning draft — not approved. Resolves F-SEQ-2 (pi-guard
compatibility contract) and defines the WP-5B authority-projection and
enforcement-evidence contracts. Normative decisions: ADR-026, ADR-027.
Cross-references: `post-wp5a-roadmap.md`, `capability-vocabulary.md`,
`trusted-workspace-and-ceiling-configuration.md`, ADR-020, ADR-022,
`pi-adapter-architecture.md`.

## Part A — Observed pi-guard 0.1.1 Surface (read-only evidence, 2026-08)

Observed from the external source at `/home/chef/Documents/plan_spec_guard`
(package identity `pi-guard`, version `0.1.1`, private pi package,
extension entry `./extensions/pi-guard/index.ts`). Not installed, not
modified; observations are compatibility evidence only, not project
authority. **The evidence covers `pi-guard` 0.1.1 only.**

- **Modes:** `OFF`, `INSPECT`, `EDIT`, `WRITE`; selector `/guard` plus direct
  commands `/guard inspect|edit|write|off|status`.
- **Mode semantics (observed):** OFF restores the session's original active
  tools; INSPECT allows research tools and read-only `git_inspect` (edit,
  write, Bash blocked); EDIT adds Markdown editing; WRITE adds Markdown
  writing (editing and Bash blocked). Default allowed extensions
  `.md`, `.mdx`.
- **Tool-surface APIs:** guard mode applies an active-tool profile over
  Pi-routed `tool_call` events and tool inventory; reserved research ids
  `bash`, `edit`, `write`, `git_inspect`; `git_inspect` runs bounded
  read-only Git operations.
- **Activation/restoration:** `GuardController` applies a profile and, on
  failure or shutdown, restores the original tool set with verification
  (`restoreAndVerify`); `[PSG_PROFILE_APPLY_FAILED]` fallback to OFF.
- **Trusted-project configuration:** optional `.pi/pi-plan-spec-guard.json`
  with `researchTools` and `allowedExtensions` (trusted-project config;
  distinct from Project Gateway's trusted-local config store). This is
  pi-guard's own opt-in mechanism and is **not** Project Gateway trusted
  governance: Project Gateway authority inputs come exclusively from the
  trusted-local configuration store (ADR-024); repository or project-visible
  files never grant, widen, or alter Project Gateway authority.
- **Web access:** research tools from the trusted `pi-web-access` package are
  integrated only when registered through a supported package-store install;
  other registrations are never auto-allowed.
- **Security boundary (observed statement):** the guard governs Pi-routed
  tool availability; it is not an OS/Git/network/filesystem sandbox, and a
  later trusted handler may change a call after observation.
- **Compatibility limitations relevant to WP-5B:** pi-guard 0.1.1 exposes
  **no external authority-projection input API** — no way for a caller to
  submit a plan-derived enforcement configuration; modes are fixed profiles
  selected by user command/UI. There is no enforcement-evidence output
  contract and no capability-vocabulary mapping.

## Part B — Repository-Owned Compatibility Contract

- **Supported identity and lane:** package identity `pi-guard`; the **only
  verified initial lane is exactly `pi-guard 0.1.1`**. No evidence
  establishes compatibility with any other `0.1.x` version; semantic-version
  range membership alone is insufficient. Any other version is unverified
  and fails closed; supporting another version requires a reviewed
  compatibility record or ADR update.
- **Compatibility predicate for `pi-guard 0.1.1` (all conjuncts must
  hold):**
  1. package identity `pi-guard`;
  2. manifest version exactly `0.1.1`;
  3. public extension identity `pi-guard` (extension entry
     `extensions/pi-guard/index.ts` exporting the default extension
     factory);
  4. required public exports present (default extension factory; mode
     command surface `/guard` with OFF/INSPECT/EDIT/WRITE and
     `/guard inspect|edit|write|off|status`);
  5. supported mode set exactly {OFF, INSPECT, EDIT, WRITE} with the
     documented profile semantics (INSPECT: research + `git_inspect`;
     EDIT: + Markdown editing; WRITE: + Markdown writing; Bash blocked in
     every active mode);
  6. activation entry point: profile application over Pi-routed `tool_call`
     events and active-tool inventory;
  7. restoration behavior: verified restoration to the pre-activation tool
     set on failure/shutdown, with `[PSG_PROFILE_APPLY_FAILED]` fallback to
     OFF;
  8. configuration contract: trusted-project config
     `.pi/pi-plan-spec-guard.json` (`researchTools`, `allowedExtensions`,
     default extensions `.md`/`.mdx`) — pi-guard's own mechanism, never
     Project Gateway governance;
  9. reserved tool identities `bash`, `edit`, `write`, `git_inspect`;
  10. expected failure and rollback semantics: profile-apply failure
      restores original tools and records the failure code;
  11. compatibility fingerprint: deterministic fingerprint over the
      observed public surface (identity, manifest version, extension
      identity, required exports, mode set, reserved ids, config contract
      shape). The fingerprint is evidence for the **observed public
      contract**, not proof that arbitrary private internals remain
      unchanged.
- **Compatibility discovery:** WP-5B verifies the predicate at the
  environment-gated boundary (same pattern as the WP-5A `PGW_PI_PACKAGE_PATH`
  harness). Discovery is explicitly environment-gated, read-only,
  non-networked, non-mutating, deterministic, and fails closed. The
  production contract contains no hardcoded machine-specific path.
- **Required public interface (v1 contract):** mode enumeration
  (`OFF|INSPECT|EDIT|WRITE`), tool-profile application, verified
  restoration, `git_inspect` read-only contract, trusted-project config
  semantics, and (future) the authority-projection input (Part D).
- **Tool inventory source (F-04/F-R1):** Pi 0.83.0 observability, accurately
  stated:
  1. `getAllTools()` returns one effective `ToolInfo` per surviving tool
     name;
  2. Pi resolves registrations into name-keyed maps before the public
     result is returned;
  3. same-name duplicate registrations are collapsed **before** Project
     Gateway can observe them;
  4. the effective collision policy observed in Pi 0.83.0 is first
     surviving registration per name;
  5. shadowed registrations are not observable through `getAllTools()`;
  6. tools excluded by Pi settings are absent from this public inventory
     and cannot be classified as hidden registrations;
  7. inactive but still registered effective tools may be observable
     through `getAllTools()`;
  8. `getActiveTools()` returns active tool names only;
  9. `getActiveTools()` provides no source identity;
  10. `ToolInfo.sourceInfo`, where present, describes only the surviving
      effective registration.
  Project Gateway therefore does **not** claim the Pi 0.83.0 public APIs can
  detect all duplicate registrations, shadowed same-name registrations, all
  hidden registrations, collisions already resolved before observation, or
  every load-order conflict. Tool inventory observation never creates
  permission.
- **Supported-lane effective-surface model (F-R1):** Project Gateway
  observes and binds only to the effective tool surface exposed by Pi:
  `effective tool identity = exact case-sensitive tool name + observable
  surviving sourceInfo + supported Pi identity/version + inventory sampling
  identity`. Project Gateway does not observe Pi's complete registration
  history; it cannot prove that no shadowed same-name registration exists;
  shadowed registrations outside the effective surface are outside the
  inventory-observation guarantee; authority is projected only onto the
  currently effective observable surface; observation of an effective tool
  never grants permission; unknown effective tools are denied; absent
  required effective tools fail projection; source drift of an effective
  name fails closed; effective name-to-source changes across samples fail
  closed; aliases are not inferred; names are exact and case-sensitive.
- **Trusted extension set (F-R1/F-F2):** the effective surface is bound to
  **Trusted Workspace Configuration** (the single owner; see
  `trusted-workspace-and-ceiling-configuration.md`): a trusted set of
  permitted extension/package identities;
  the expected effective source identity for security-relevant tools;
  failure when an effective tool comes from an untrusted or unexpected
  source; failure when source identity is unavailable for a tool whose
  identity is security-critical; defined treatment of built-in tools, of
  trusted web-access tools (registered only through the supported
  package-store path, never auto-allowed), and of temporary/project/user
  extension scopes (only effective tools with trusted expected sources are
  accepted). Repository content cannot expand this trusted extension set.
- **Load-order and shadowing rule (F-R1):** Project Gateway does not rely
  on load order as an authorization mechanism; the surviving effective
  source must match the trusted expected source; a load-order change that
  changes the effective source is inventory drift and fails closed; an
  unobservable shadowed registration that does not become effective cannot
  be claimed as detected; if it later becomes effective, the resulting
  source or inventory identity change is detected at the next mandatory
  sample.
- **Accepted lane limitation (F-R1):** "Pi 0.83.0 does not expose an
  uncollapsed registration inventory through the reviewed public API.
  Project Gateway therefore binds enforcement to the effective observable
  name-to-source surface and cannot assert the absence of shadowed
  same-name registrations." This grants no authority: only the surviving
  effective implementation can be called under the sampled surface; it must
  match trusted source expectations; all effective extras remain denied;
  any observable source change fails closed.
- **Future hardening owner (F-R1):** optional uncollapsed registration
  visibility is assigned to **WP-15 (security hardening and host
  compatibility)** as a non-blocking future deliverable: a reviewed Pi host
  capability exposing all registration events; a separately authorized
  pi-guard/Pi compatibility probe; or a stronger trusted extension manifest
  verified before Pi registration. This future enhancement does not block
  WP-6, remains a WP-5B or WP-15 compatibility/hardening gate where
  relevant, requires separate review before use, and is not falsely
  described as present in Pi 0.83.0.
- **Sampling contract (F-R1, retained):** inventory identity is sampled at
  (a) projection; (b) immediately before activation; (c) immediately after
  activation; (d) each protected turn or invocation boundary; (e)
  restoration verification; and (f) shutdown. Each sample compares the
  effective-surface identity (exact names + observable surviving
  `sourceInfo` + sampling identity). A mismatch **before** activation
  prevents activation; a mismatch **after** activation refuses the
  protected operation, attempts restoration, produces typed enforcement
  evidence, and never silently continues.
- **Tool-name normalization:** exact names from the observed inventory;
  case-sensitive canonical names; no silent prefix matching; unknown tools
  are denied.
- **Unsupported tool behavior:** a required capability that maps to no
  enforceable tool profile fails closed (no activation).
- **Unknown tool behavior:** any tool not positively mapped from the
  projected allowed set is denied.
- **Mode transitions:** only via the projection/activation path (WP-5B)
  or explicit trusted control-plane action; transitions are logged in
  enforcement evidence.
- **Multi-turn behavior:** the enforcement configuration persists for the
  guarded execution scope; each turn re-verifies the active profile.
- **Shutdown restoration:** restoration to the pre-activation tool set is
  verified and recorded (matching observed pi-guard restoration behavior).
- **Compatibility drift handling:** fingerprint drift (version/export
  surface changes) fails closed with a compatibility finding; no
  undocumented fallback.
- **Concurrent activation and restart (F-06/F-R3):** concurrent activation
  attempts are rejected or serialized by the one trusted local owner
  (WP-5B acting on WP-12 activation decisions); no overlapping active
  enforcement sessions may independently mutate the same Pi tool surface;
  nested activation is denied unless it is an **idempotent replay** in
  which all of the following match exactly: plan identity, effective-
  authority identity, approval or activation-decision identity, RuntimeGrant
  identity where separately represented, inventory identity, **compatibility
  identity**, projected enforcement-configuration identity, and target Pi
  session or enforcement-surface identity (F-R3); a conflicting activation
  request fails closed, and compatibility drift never qualifies as an
  idempotent replay. Process restart begins from the host's ordinary
  pre-activation tool state; persisted enforcement evidence does not
  reactivate enforcement automatically; a fresh trusted activation
  decision and a fresh projection are required after restart; stale
  activation evidence is retrospective only. Restoration ownership is
  WP-5B's, and restoration failures are recorded as typed enforcement
  evidence.
- **pi-guard modifications are NOT authorized by this document.** The
  authority-projection input interface is a required future pi-guard-side
  change that requires a separate explicit human authorization (see
  ADR-026). This planning package defines the contract Project Gateway
  needs; it does not design pi-guard internals beyond the public interface.

## Part C — Effective Authority Rule and Ownership

```
effective authority = global ceiling ∩ workspace ceiling ∩ approved
AuthorityPolicy ∩ RuntimeGrant ∩ consumer support
```

- **Artifact Core (WP-4) owns the authoritative intersection evaluation**
  (`evaluatePointOfUseEligibility`; `src/api/validate.ts`), including the
  numeric action-ceiling operands (AUT-001). WP-5B consumes a validated,
  exactly-correlated `EligibilityReport` (correlated via
  `subjectCorrelations.bundleInstance` to the exact bundle) and **must not
  independently reinterpret artifact authority**.
- WP-5B's own computation is limited to: mapping the evaluated capability
  intersection to the tool surface (capability→tool-profile mapping),
  computing the projected allowed/denied tool sets, and verifying
  subset/deny invariants. It never recomputes policy/grant semantics.

## Part D — Authority Projection Contract (WP-5B)

Trusted inputs (all must be validated before projection):

1. validated WP-5A `PiInvocationPlan` (branded, `projection-ready`,
   `piGuardEnforcementPending: true`);
2. global ceiling (WP-6 config);
3. workspace ceiling (WP-6 config);
4. approved `AuthorityPolicy` (validated artifact; exact reference from the
   plan);
5. applicable `RuntimeGrant` (validated lifecycle record; control-plane
   supplied);
6. consumer-support declaration;
7. actual Pi/pi-guard tool surface (observed inventory);
8. compatibility result (Part B).

Deterministic projection rules:

- Inputs are bound by identity: plan fingerprint (rendered plan + exact
  references), ceiling versions, grant identity, policy revision, tool
  inventory fingerprint.
- **Deny wins:** an explicit deny at any operand denies the capability.
- **Unknown denied:** capabilities or tools not positively present are
  denied.
- **Unsupported required capability:** projection fails (no partial output).
- **Absent tool:** a projected capability with no matching tool yields a
  denied tool entry and a finding; if the capability was required,
  projection fails.
- **Extra tool:** tools present in the inventory but not mapped from the
  intersection are projected as denied.
- **Tool aliases:** none in v1 mapping; exact-name mapping only.
- **Tool registration drift:** inventory fingerprint changes after
  projection are detected at activation; mismatch fails closed.
- **Projection result identity:** the canonical `projectionIdentity`
  (single normative definition, F-R4; see Part E) is computed over the
  enforcement configuration plus plan identity, authority-input identities,
  effective-authority identity, compatibility-result identity, effective
  tool-inventory identity, workspace identity, capability-vocabulary
  version, and evaluator/interface version; no separate member set is
  maintained.
- **No partial activation:** activation is atomic with respect to the
  projection: if any verification fails, the previous tool set remains
  active and a fail-closed finding is recorded.
- **Activation boundary:** pi-guard is activated only when (a) a
  control-plane activation decision exists for the exact occurrence/attempt
  (ADR-002), and (b) the projection is complete and verified. WP-5B never
  activates without both.
- **Restoration boundary:** on completion, cancellation, error, or
  shutdown, restoration to the pre-activation tool set is verified and
  recorded in enforcement evidence.

## Part E — Enforcement Evidence Contract

Defined type name: **`PiEnforcementEvidence`**. It is NOT an
`ExecutionResult`, NOT a `TrustedReceipt`, and NOT proof of successful
execution. It never issues authority, approves artifacts, activates a
RuntimeGrant, replaces pi-guard runtime enforcement, or replaces local
approval state.

Fields:

- `inputPlanIdentity` / `planFingerprint`;
- `projectionIdentity` (canonical definition, F-R4);
- `authorityInputIdentities` (ceiling versions, policy revision, grant
  identity, consumer declaration identity);
- `effectiveAuthorityIdentity`;
- `piGuardIdentity` / `piGuardVersion`;
- `piIdentity` / `piVersion`;
- `observedToolInventoryIdentity` (fingerprint);
- `projectedAllowedTools`;
- `projectedDeniedTools`;
- `unsupportedRequiredCapabilities`;
- `activationOutcome` (applied / failed-closed / not-attempted);
- `restorationOutcome` (verified / failed / not-applicable);
- `compatibilityFindings`;
- `timestampSource` (host-supplied only, per ADR-022; never synthesized);
- `evidenceFingerprint` (deterministic SHA-256 over the canonical evidence
  serialization).

### Timestamp and Fingerprint Canonicalization (F-02/F-R2)

Selected model: **projection identity and evidence fingerprint are distinct.**

1. **`projectionIdentity`** — the single canonical definition (F-R4):
   deterministic over the `PiInvocationPlan` identity or fingerprint, the
   exact authority-input identities, the validated effective-authority
   identity, the compatibility-result identity, the observed effective
   tool-inventory identity, the projected Enforcement Configuration
   identity, the applicable workspace identity, the capability-vocabulary
   version, and the evaluator/interface version. It explicitly **excludes**
   timestamps, activation outcome, restoration outcome, runtime
   observations, `ExecutionResult`, `TrustedReceipt`, and incidental host
   diagnostics. Equivalent projection inputs and outcomes share one
   identity regardless of when they occurred.
2. **`evidenceFingerprint`** — deterministic over the **complete canonical
   evidence record**, **including** every present accepted timestamp value
   and the timestamp-source identifier. Equivalent activations at different
   times therefore do not share a fingerprint; the fingerprint changes when
   evidence-instance timestamps change, and it identifies the complete
   evidence instance.

Accepted timestamp values (F-R2), unless a stricter repository-wide
primitive contract applies:

- a timestamp is either a finite non-negative safe integer or a non-empty
  opaque UTF-8 string;
- numeric timestamps must satisfy `Number.isSafeInteger(value)` and
  `value >= 0`; `NaN`, ±Infinity, fractional values, and unsafe integers
  are rejected; negative zero is normalized to canonical zero;
- numeric timestamps serialize as canonical base-10 digits without
  exponent notation;
- string timestamps are opaque, preserved byte-for-byte as supplied after
  UTF-8 validation, with no Unicode normalization, no case conversion, no
  date parsing, and no timezone conversion;
- `null` and `undefined` are not valid timestamp values; an absent
  timestamp field is represented only by field omission, which is distinct
  from zero, empty string, null, and undefined;
- empty timestamp strings are rejected;
- invalid timestamp values make the evidence record malformed and fail
  closed;
- the timestamp-source identifier uses a separately validated
  primitive-string contract;
- present accepted timestamp values and timestamp-source identifiers are
  included in `evidenceFingerprint` and remain excluded from
  `projectionIdentity`;
- two independent implementations must produce identical canonical bytes
  for the same accepted evidence record.

Canonicalization rules (both identities): fixed field order; host-supplied
primitive values preserved exactly as received (per the accepted-value
contract above), never converted or synthesized; absent fields by omission;
serialization is UTF-8 with canonical field ordering and no whitespace
variation; the SHA-256 digest is computed over the canonical UTF-8 bytes.
Timestamp presence or absence never implies authority or execution
success.

Semantic distinctions (must be preserved in every document and
implementation):

- **projection evidence** — the deterministic projection (before
  activation);
- **activation evidence** — `PiEnforcementEvidence` with activation and
  restoration outcomes (contemporaneous);
- **runtime observation** — `PiExecutionObservation` (WP-5A): what the Pi
  host reported (tool-call attempts, completion); observation never proves
  permission;
- **ExecutionResult** — retrospective evaluation of an actual execution
  (WP-13 completion evaluator);
- **TrustedReceipt** — trusted-local receipt, separate and trusted;
  normative issuance owner is WP-15 (input provider: WP-13 retrospective
  facts), never issued from enforcement evidence alone.
