# ADR-028 — Trusted Storage Bootstrap Locator and WP-8-C Pre-Implementation Decision Baseline

## Status

Accepted

Accepted by the externally granted human decision closing OD-001 as
**explicit control-plane locator only; no WP-8 host default** (approval
decision date 2026-08-06; recorded in the WP-8 contract decision
inventory, Appendix G, and in `docs/reports/wp-8c-pre-implementation-decision-consolidation-report.md`).
Acceptance derives from the human decision, not from the documentation
operator. Chronology: the **senior decision-baseline review returned
corrections required** (nine findings W8C-D01…W8C-D09); the **focused
correction addressed them**; the **focused decision-baseline rereview
returned corrections required** and identified W8C-D10…W8C-D14; the
**final micro decision-baseline correction claimed all five closed**
(register below); the **final micro decision-baseline rereview returned
`WP-8-C FINAL MICRO DECISION-BASELINE REREVIEW: CORRECTIONS REQUIRED`**
with one isolated MINOR stale-status issue; the **final status micro
correction claimed that MINOR closed**; the **final status micro spot
check returned `WP-8-C FINAL STATUS MICRO SPOT CHECK: ACCEPTED` with
`OPEN FINDINGS: 0`**; the **WP-8-C decision baseline is ACCEPTED** and
the **WP-8-C decision-baseline commit** (subject `docs: establish
WP-8-C decision baseline`) is the commit containing this update;
**WP-8-C implementation remains unauthorized**; the **next gate is human
authorization of WP-8-C implementation**.
This ADR records
decisions only and authorizes no implementation.

## Context

WP-0 deferred the concrete trusted-local storage parent convention to
OD-001 ("Exact trusted-local parent-directory convention (e.g., XDG
state)"), open and non-blocking with the later gate "at implementation
authorization". CSR-001 already normatively requires the bootstrap
locator to be a trusted host/control-plane input that MUST NOT come from
an environment variable, request value, repository file, artifact, or
WP-8 record, and DS-19 resolved the two-namespace sibling derivation
(`config-v1/`, `store-v1/`) under one trusted parent. The WP-8-C
eligibility and authorization analysis found WP-8-C eligible only after
a human decision on OD-001; the authorization-envelope refinement
produced an implementation-ready envelope. The human decision block
approved: OD-001 closure (decision A), a separate internal
`TrustedStorageBootstrapInput` carrier (decision B), pre-initialization
capability binding (decision C), bounded write-all metadata semantics
(decision D), module-scoped static-guard exceptions (decision E), and a
documentation-only decision baseline before implementation (decision F).

## Decision

**A. OD-001 — explicit control-plane locator only; no WP-8 host default.**

- WP-8 defines no default trusted-parent path and derives the locator
  from no environment variable, argv value, working directory, request
  value, repository file, artifact, or WP-8 record (CSR-001 unchanged).
- The trusted control plane supplies one already-resolved absolute
  parent locator.
- The trusted parent pre-exists; WP-8-C does not create, chown, or
  replace it.
- The trusted parent is owned by the configured trusted service UID and
  has mode exactly `0700`; a parent owned by any other UID under any
  mode is rejected for the supported lane.
- WP-8 derives only `config-v1/` and `store-v1/` beneath it (fixed
  namespace derivations).
- The locator alone grants no mutation authority (SRX-011/012,
  API-007).

The WP-8 contract decision inventory (Appendix G) is updated to
"Resolved — explicit control-plane locator only; no WP-8 host default".

**B. Trusted bootstrap input carrier — non-ambient creation gate.**

- A separate internal `TrustedStorageBootstrapInput` is used; the WP-6
  workspace-configuration schema is NOT extended for storage bootstrap
  fields.
- The carrier is a dedicated future internal module at
  `src/storage/trusted-input/bootstrap-input.ts` under the WP-8-C
  authorized tree. **Actual WP-6 provenance limitation:** a genuine
  WP-6 validated trusted configuration proves trusted configuration
  provenance only; its current provenance contains `sourceKind` and
  does NOT contain the storage-bootstrap action identity, locator,
  configured service UID, forbidden-root set, or limit-profile
  identity.
- **Two independent operands:** the creator requires (A) a genuine
  accepted WP-6 validated trusted-configuration value positively
  verified through the existing accepted genuineness-brand verifier
  `isGenuineValidatedTrustedWorkspaceConfiguration`; and (B) a genuine
  `StorageBootstrapActionProvenance` object. Neither operand implies
  the other; structural equality is never sufficient to establish
  either operand's genuineness.
- **Correlation:** the creator verifies exact equality or canonical
  identity correlation between the two operands for: trusted
  configuration identity, resolved locator, configured service UID,
  forbidden-root set, limit-profile identity, and explicit action
  identity. An action identity is never accepted merely as a string or
  structurally valid field, and it does NOT come from WP-6
  configuration provenance.
- **Action-provenance producer:** the future production owner is
  `src/control-plane/storage-bootstrap-action.ts` — the trusted
  control-plane bootstrap composition root and sole production
  consumer of the action-provenance creator; it creates one immutable
  genuine action-provenance object for an explicitly authorized
  bootstrap action, binding action identity, resolved locator,
  configured service UID, forbidden-root set, trusted configuration
  identity, and limit-profile identity; no request, environment,
  repository, artifact, or WP-8-record creation path; no package-root
  or MCP exposure. This module is NOT implemented or authorized by
  this correction. **Production WP-8 initialization integration cannot
  occur until this trusted producer boundary exists**; WP-8-C may
  establish and test the consumer/verifier contract without pretending
  the production producer already exists. Test-only producers may
  exist only under tests and must not be compiled or exported as
  runtime code.
- **Authenticity domains:** `src/storage/trusted-input/bootstrap-input.ts`
  owns semantically distinct private authenticity domains for
  `StorageBootstrapActionProvenance` and `TrustedStorageBootstrapInput`
  — private weak collections, object-kind discrimination, no brand
  state exported, no structural or own-symbol genuineness, no
  interchangeability between the two kinds; JSON, spread, structured
  clone, prototype imitation, and plain-object forgery fail.
- **Import edges:** the production action-provenance creator is
  imported only by `src/control-plane/storage-bootstrap-action.ts`;
  the trusted-bootstrap-input creator is imported only by
  `src/storage/initialization/initialize.ts`; while the production
  producer does not exist, no module may import the action-provenance
  creator. The creators are NOT exported from the private storage
  barrel (`src/storage/index.ts`) and NOT package-root exported;
  importing the trusted-input module does not authorize minting.
  Future static-guard/import-graph checks enforce both exact edges.
- Internal only; immutable after validation.
- Fields: resolved absolute locator; configured trusted service UID;
  forbidden-root identities or validated root set; trusted
  configuration identity; limit-profile identity; explicit
  control-plane action identity (correlated, never structurally
  assumed).
- No request, environment, repository, artifact, or WP-8-record
  creation path exists.

**C. Capability binding and non-ambient issuance.**

- The initialization capability binds only to facts available before
  initialization: trusted-parent descriptor identity (device/inode),
  fixed namespace derivations, trusted configuration identity,
  configured service UID, limit-profile identity, explicit action
  identity, the `{namespace-initialize}` operation set, the private
  generation identity, and live/disposed state.
- Namespace identities and StoreMetadata digests are initialization
  results, not retroactively added capability bindings; the capability
  is never retroactively mutated.
- Future capabilities may bind to verified metadata only after later
  human authorization; no future capability kind (write, read,
  verification, recovery, retention, migration) has an issuance path
  in WP-8-C.
- **Issuance gate (non-ambient):** `createInitializationCapability`
  requires a genuine branded `TrustedStorageBootstrapInput`, validated
  trusted-parent descriptor identity, the exact `{namespace-initialize}`
  operation set, the correlated configuration identity, the configured
  service UID, the limit-profile identity, and the private generation
  identity. **The capability's genuine action identity derives from the
  verified action-provenance operand already bound into that input** —
  it is never accepted as a separate or structurally assumed value. The
  creator may be imported by
  exactly one future module, `src/storage/initialization/initialize.ts`
  (or another single exact private composition path named in all
  documents). The import restriction is enforced by the future static
  guard. The creator is NOT exported from `src/storage/index.ts`,
  `src/index.ts`, package exports, or any local re-export barrel;
  import alone confers no issuance authority because the genuine
  branded input operand is mandatory.

**D. Metadata write, replay, and scratch model.**

- Bounded write-all semantics: `writeSync` may return partial writes;
  the bootstrap protocol loops until all canonical bytes are written or
  an error occurs. A single-write-completes-buffer assumption is not
  made.
- No-overwrite exclusive creation (`O_CREAT|O_EXCL|O_NOFOLLOW`),
  explicit mode `0600`, descriptor-bound `fchmod`/`fstat` verification,
  file `fsync`, metadata-directory `fsync`, namespace-directory
  `fsync`, uncertain durability mapped to `ERR-STO-DURABILITY`.
- **Descriptor-bound replay (no path-based reads):** on `EEXIST`, the
  existing metadata is verified by (1) opening with
  `O_RDONLY|O_NOFOLLOW`; (2) `fstat`; (3) verifying regular-file type,
  configured UID, exact mode `0600`, device/inode, and expected
  location; (4) reading through the descriptor via `readFileSync(fd)`
  or an explicit bounded `readSync` loop; (5) **mandatory post-read
  revalidation** — `fstat` is performed again and the pre-read and
  post-read device, inode, regular-file type, configured UID, exact
  mode `0600`, and size are compared, any mismatch failing closed with
  the applicable existing error code; (6) parsing raw JSON with
  duplicate-key
  rejection; (7) verifying canonical bytes; (8) verifying metadata
  format version; (9) verifying the payload digest; (10) verifying the
  record-byte digest; (11) verifying namespace identity; (12)
  verifying trusted-parent identity; (13) verifying every expected
  stable field; (14) exact match only → idempotent verification; (15)
  any mismatch → deterministic fail closed. The descriptor-bound read
  remains sufficient under the accepted mode-`0700` trusted-directory,
  single-writer initialization threat model. Path-based
  `readFileSync(path)` is forbidden for replay verification.
- **Scratch collision and ownership:** scratch creation uses
  `O_CREAT|O_EXCL|O_NOFOLLOW`; no-overwrite is mandatory; `EEXIST`
  fails closed; an action never claims an existing object; matching
  action digest and ordinal do NOT establish ownership of a
  pre-existing object; only a successfully created object recorded by
  the current live action may be removed; prior/dead-action objects
  remain untouched and require later maintenance handling within the
  existing error vocabulary. Scratch names are derived from the
  genuine action-identity digest and a bounded per-action ordinal; no
  randomness, clock, PID, environment, or cwd is used.

**E. Static-guard scoping — two-brand model and ownership map.**

- Module-scoped exceptions replace the blanket prohibition only where
  the contract requires filesystem or capability-brand markers:
  `src/storage/root/**` (resolution/identity),
  `src/storage/probe/**` (probe/scratch),
  `src/storage/metadata/bootstrap-persist.ts` (metadata persistence),
  and `src/storage/initialization/provision.ts` (fixed-directory
  provisioning) receive narrow, API-specific `node:fs` allowlists;
  every other `src/storage/**` module remains filesystem-free.
- **Two exact brand-bearing modules (Model A):**
  `src/storage/trusted-input/bootstrap-input.ts` (trusted-input
  brand) and `src/storage/capabilities/authenticity.ts` (capability
  brand). Each owns a separate private `WeakSet`; no brand collection
  is exported; no common or interchangeable brand; no structural or
  own-symbol brand; process-local only; JSON, spread, structured
  clone, prototype imitation, and plain-object forgery fail; the
  static guard grants `new WeakSet` only to these two exact paths.
- **Directory provisioning owner:**
  `src/storage/initialization/provision.ts` alone owns
  fixed-directory provisioning (`config-v1/`, `store-v1/`, each
  namespace's `metadata/`, each namespace's `tmp/`), callable only
  from the initialization orchestrator under the still-live genuine
  one-shot initialization capability, with target paths restricted to
  the fixed derivations (no arbitrary path operand), exclusive
  non-recursive creation, descriptor-bound verification of type, UID,
  and mode `0700` after each creation, and no parent creation,
  `chown`, repair, deletion, or recursive creation. The probe
  component retains only scratch-object authority under an already
  verified `tmp/`.
- Future capability issuance markers are denied globally; the
  capability creator is imported only by the exact initialization
  module; the trusted-input creator is imported only by the exact
  private composition boundary; the action-provenance creator is
  imported only by the future `src/control-plane/storage-bootstrap-action.ts`
  (while that producer does not exist, no module may import the
  creator).
- `tests/unit/storage/static-guard.test.ts` enforces module-path
  allowlists, exact-name named imports only for `node:fs` (no
  namespace imports, no renamed imports, no `require`, no dynamic
  import), allowed API subsets, import-graph checks (allowlisted
  filesystem modules export no filesystem objects, descriptors,
  handles, callbacks, or filesystem-typed helpers; no local re-export
  of filesystem APIs; no helper module outside the allowlist wraps
  filesystem calls), denial everywhere else, and denial of future
  issuance paths, with synthetic negative tests for namespace
  imports, renamed imports, re-export chains, helper indirection,
  forbidden consumer imports, and brand markers in wrong paths.

**F. Sequencing.**

- A documentation-only decision baseline is established before any
  WP-8-C implementation: this ADR, the contract Appendix G update, the
  decision-consolidation report, and current-state planning updates.
- WP-8-C implementation, staging, and commit remain unauthorized; the
  next gate is the WP-8-C final status micro spot check.

## Consequences

- The WP-8 contract requirement inventory is unchanged (364 normative
  requirements by the authoritative Appendix-A prefix-sum method; the
  coarse unique-ID extraction yields 345 IDs including DS/OD decision
  rows — two documented counting methods measuring different sets,
  with a verified zero delta on the pre/post ID sets); only the OD-001
  decision-inventory row was closed; no normative requirement was
  added, removed, or weakened.
- WP-8-C implementation must follow the module boundary, static-guard
  allowlist, capability model, metadata protocol, and state-machine
  rules recorded in the decision-consolidation report
  (`docs/reports/wp-8c-pre-implementation-decision-consolidation-report.md`).
- The commit workflow for the mutation-capable phase is: implementation
  → senior security review → correction/rereview → commit execution with
  post-commit verification → independent high-risk baseline verification
  → phase closure. No step of that workflow is authorized by this ADR.

## Correction Register (W8C-D01…D09; final micro W8C-D10…D14)

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| W8C-D01 | MAJOR | ambient trusted-bootstrap-input minting (raw structural validation only) | CLOSED (focused correction) — non-ambient creation gate: genuine WP-6 validated configuration positively verified via `isGenuineValidatedTrustedWorkspaceConfiguration`, genuine correlated action-provenance operand, one private composition boundary, one allowed consumer (`initialization/initialize.ts`), no barrel/package-root export |
| W8C-D02 | MAJOR | contradictory brand authority (input brand required but only `authenticity.ts` allowed `WeakSet`) | CLOSED (focused correction) — two-brand Model A: `trusted-input/bootstrap-input.ts` and `capabilities/authenticity.ts`, separate private `WeakSet`s, guard grants `new WeakSet` only to these two exact paths |
| W8C-D03 | MAJOR | ambient initialization-capability issuance | CLOSED (focused correction) — `createInitializationCapability` requires the genuine branded `TrustedStorageBootstrapInput` plus all correlated bindings; imported only by `initialization/initialize.ts`; enforced by the static guard; no barrel/package-root export |
| W8C-D04 | MODERATE | no exact directory-provisioning owner | CLOSED (focused correction) — `src/storage/initialization/provision.ts` owns fixed-directory provisioning with a narrow API allowlist, capability gate, fixed target derivations, and descriptor-verify-after-create |
| W8C-D05 | MODERATE | metadata replay not descriptor-bound / no-follow | CLOSED (focused correction) — 15-step descriptor-bound `O_RDONLY|O_NOFOLLOW` replay model; path-based `readFileSync(path)` forbidden |
| W8C-D06 | MODERATE | static-guard enforcement model incomplete | CLOSED (focused correction) — exact-name named imports only, no namespace/renamed/require/dynamic imports, fs-privacy rule, import-graph and re-export checks, synthetic negative tests |
| W8C-D07 | MINOR | count methodologies not documented | CLOSED (focused correction) — Appendix-A prefix-sum 364 (authoritative) vs coarse unique-ID 345 incl. DS/OD rows; zero ID-set delta documented |
| W8C-D08 | MINOR | dead-action scratch attribution unstated | CLOSED (focused correction) — scratch names derived from action-identity digest + per-action ordinal; live action deletes only its recorded names; unattributable scratch never deleted/adopted/repaired |
| W8C-D09 | MINOR | CAP-001 claim not initialization-scoped | CLOSED (focused correction) — CAP-001 implemented and tested for the initialization capability kind only; other kinds remain type-level vocabulary |
| W8C-D10 | MAJOR | action-provenance model falsely claimed the storage-bootstrap action identity is recorded in WP-6 validated-configuration provenance | CLOSED (final micro) — WP-6 provenance limitation recorded (`sourceKind` only; no action identity, locator, service UID, forbidden-root set, or limit-profile identity); two independent operands (genuine WP-6 evidence + genuine `StorageBootstrapActionProvenance`); correlation via exact equality/canonical identity; producer `src/control-plane/storage-bootstrap-action.ts` defined but NOT implemented; production integration blocked until the trusted producer boundary exists; test-only producers confined to tests |
| W8C-D11 | dependent | capability action binding not tied to the verified action-provenance operand | CLOSED (final micro) — the capability's genuine action identity derives from the verified action-provenance operand already bound into the trusted input; never accepted as a separate or structurally assumed value |
| W8C-D12 | MINOR | WP-6 provenance limitation not recorded | CLOSED (final micro) — limitation documented: genuine WP-6 validated configuration proves trusted configuration provenance only; neither operand implies the other; structural equality never establishes genuineness |
| W8C-D13 | MINOR | metadata post-read revalidation discretionary | CLOSED (final micro) — mandatory post-read `fstat` comparison (device, inode, regular-file type, configured UID, exact mode `0600`, size); any mismatch fails closed with the applicable existing error code |
| W8C-D14 | MINOR | scratch collision rule absent | CLOSED (final micro) — `O_CREAT|O_EXCL|O_NOFOLLOW` mandatory; `EEXIST` fails closed; an action never claims an existing object; matching digest+ordinal do not establish ownership; only successfully created, recorded objects may be removed |
