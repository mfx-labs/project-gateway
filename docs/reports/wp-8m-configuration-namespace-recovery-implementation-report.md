# WP-8-M Configuration Namespace Recovery — Implementation Report

**Slice:** WP-8-M — bounded, authority-safe recovery of the persistent
configuration namespace: the exact recovery operation
`recover-configuration-namespace` with a dual-authority gate (genuine
recovery authorization AND genuine trusted configuration/bootstrap
input), exact no-overwrite republication of the expected canonical
configuration metadata derived through the SAME trusted-input-to-storage
transformation as normal initialization, deterministic recovery
evidence, a strict version/migration boundary, and a fixed crash
inventory (contract §16.7, CSA-016…018; ADR-036).

## 1. Scope and Files

Modified (13):

- `docs/specs/wp-8-local-storage-registry-contract.md` — §16.7 and
  CSA-016…018 (narrow amendment: the contract defined configuration
  persistence (3.6) and recovery (16) but no configuration-namespace
  recovery operation, no dual-authority gate, no recoverable-state
  table, and no evidence model — see ADR-036); pinned SHA-256 updated.
- `src/storage/types.ts` — the `recover-configuration-namespace` action
  category + exact action fields, the configuration metadata state
  vocabulary, configuration-recovery evidence facts on scan
  observations, configuration observation + evidence-state types,
  assessment fields, the fixed crash-stage vocabulary, and the
  `configuration-recovered`/`already-present` outcomes.
- `src/storage/capabilities/authenticity.ts` — the operation joins the
  private recovery operation set; the exact
  `ConfigurationRecoveryMetadataPermit` (creator + verifier + liveness).
- `src/storage/locks/lock.ts` — the normal writer lock accepts the
  operation (recovery never breaks locks).
- `src/storage/metadata/bootstrap-persist.ts` — the permit-gated
  `persistRecoveryConfigurationMetadata` entry (independent byte
  re-parse/re-verify, destination re-derivation, exact no-overwrite
  protocol, byte-exact EEXIST replay only).
- `src/storage/probe/probe.ts` — the recovery-gated
  `runCompatibilityProbeRecovery` (identical probe, gated on the exact
  operation; the probe facts keep the expected bytes identical to
  initialization's).
- `src/storage/read/read-record.ts` — the configuration-tolerant store
  revalidation `verifyStoreInstanceConfigurationTolerant` (parent +
  both namespace descriptors + fully verified store-records metadata;
  configuration metadata observed, never required); exported store
  constants.
- `src/storage/read/index.ts` — `revalidateStoreConfigurationTolerant`
  and `configurationNamespaceRootFor`.
- `src/storage/initialization/provision.ts` — the recovery-gated
  phase-3 top-level provisioning (exact `records`/`audit`/`locks` entry
  set in both namespaces; the only layout recovery creates).
- `src/storage/recovery/scan.ts` — the configuration metadata
  classification (surface + byte-exact), the deterministic observation
  id, the configuration-namespace scan observation (recovery mode),
  `extractConfigurationRecoveryEvidenceFacts`.
- `src/storage/recovery/assess.ts` — the configuration observation
  pass-through and the configuration-recovery evidence state
  classification.
- `src/storage/recovery/evidence.ts` — the trusted-input identity
  digest, the configuration-recovery evidence builder + identity
  domain, the existing-evidence verifier, the durability verifier, the
  operation joins the evidence operation vocabulary.
- `src/storage/recovery/{execute,compose,index}.ts` — the dispatch, the
  tolerant recovery-scan revalidation, the barrel exports.
- `src/storage/publication/publish-record.ts` — the recovery evidence
  temp-ordinal slot for the operation.
- `docs/design/post-wp5a-roadmap.md` and
  `docs/design/post-wp5a-planning-status.md` — current-state wording.

Added (4):

- `docs/decisions/ADR-036-wp-8m-configuration-namespace-recovery.md`
- `src/storage/recovery/config-recovery.ts` — the fs-free dual-gated
  composition boundary.
- `docs/reports/wp-8m-configuration-namespace-recovery-implementation-
  report.md` (this report).
- `tests/unit/storage/config-recovery.test.ts` — 21 focused tests.

Modified tests: `tests/unit/storage/static-guard.test.ts` (creator
edges, the new WP-8M confinement test, the operation-literal owners,
contract hash pin).

## 2. Why a Contract Amendment Was Necessary

The contract defined configuration persistence (CSR/3.6) and recovery
(§16) but no configuration-namespace recovery operation, no dual
authority rule, no recoverable-state table, no trusted-input identity
digest, and no recovery evidence model for configuration. One concise
ADR (ADR-036) and one narrow amendment (§16.7 + CSA-016…018) were
added. The trusted-input freshness question — the WP-8M blocking gate —
is answered by the dual-authority gate + the deterministic trusted-input
identity digest + the in-process capability-generation binding
(CAP-008/009), so no `PARTIAL — CONTRACT DECISION REQUIRED` stop was
needed.

## 3. Configuration Authority Model

The only persistent configuration object is the configuration-namespace
`StoreMetadata` at the fixed destination `config-v1/metadata/metadata.json`
(contract 6.2 "Store metadata" — authoritative, store-owned, derived at
initialization from trusted input). `ConfigurationSnapshotRecord`
(3.6/TAX-014) has NO production producer and a healthy store has none;
recovery never invents configuration records. The operation
`recover-configuration-namespace` exists ONLY in the private recovery
operation vocabulary; no generic configuration write/replace/repair
vocabulary exists anywhere (static-guarded). The recovery capability can
never invent or modify trusted configuration facts; the trusted input
alone grants no filesystem mutation authority; a recovery plan, scan
finding, or configuration file content grants nothing (tested).

## 4. Trusted-Input Binding

The request binds: expected configuration identity, expected
configuration version, the deterministic trusted-input identity digest
(`PGAP-STORAGE-TRUSTED-INPUT-IDENTITY-v1` over the genuine input's
canonical facts), the expected configuration digest, the current-state
observation id, and the generation/surface tokens. The flow re-derives
every binding from the genuine branded input + the genuine WP-6 trusted
configuration and requires exact equality at every boundary (pre-lock,
under the writer lock). A trusted-configuration change before
publication fails closed (capability-generation advance; the stale
configuration is never published and no evidence claims success under
the stale input — tested).

## 5. Recoverable / Ineligible States

Recoverable: expected canonical configuration MISSING (metadata
directory present). Non-mutating: exact healthy configuration →
`already-present` (no recovery evidence fabricated — a healthy store is
indistinguishable from an interrupted recovery, so evidence roll-forward
is not provable under contract facts). Fail-closed (never overwritten,
never repaired): conflicting bytes, malformed, wrong type, wrong
UID/mode, symlink, foreign entries, unsupported version, interrupted
publication (provable strict prefix of the expected bytes — classified,
never unlinked), missing metadata DIRECTORY (bootstrap action required;
recovery provisions only the exact phase-3 top-level entry set
`records`/`audit`/`locks`, mirroring the write path). Older-version
transformation is `migration-required` and reserved: no older version is
defined in this contract, so non-supported versions map to
`unsupported-configuration-version`; zero migration.

## 6. Canonicalization Model

The expected bytes come from the initialization transformation:
recovery-gated compatibility probe (identical probe facts) + metadata
facts (namespace identities, parent identity, lane, configuration
identity, the BOOTSTRAP action identity from the trusted input,
limit-profile identity) + `buildStoreMetadata`. Same trusted input +
same store ⇒ identical bytes and digest (tested by byte comparison with
the pre-damage metadata). Clock, PID, random nonce, raw path, host
enumeration order, and the RECOVERY action identity never enter the
configuration bytes or identity.

## 7. Publication Confinement

`persistRecoveryConfigurationMetadata` consumes ONLY the exact
`ConfigurationRecoveryMetadataPermit` (genuine recovery capability,
exact operation, configuration identity/version/digest, trusted-input
identity, exact destination `metadata/metadata.json`), re-parses and
re-verifies the canonical bytes (kind, supported version, payload
digest, identity/version bindings), re-derives the destination, and
publishes with the exact no-overwrite protocol (O_CREAT|O_EXCL|O_NOFOLLOW,
fchmod, write-all, file fsync, metadata-dir fsync, namespace-dir
fsync). EEXIST is byte-exact replay only; a conflict that appears during
recovery fails closed and remains untouched (tested by injection
between scan and publication). The permit cannot publish lifecycle
records, audit events, evidence records, registry indexes, another
configuration kind, or another version.

## 8. Trusted-Input Race and Conflict Results

- Race: the trusted configuration changes to B before publication →
  the capability generation advances, the publication boundary fails
  closed, the stale configuration is never published, no evidence
  exists, the identity-bound writer lock remains for external recovery
  (never auto-broken) — tested.
- Conflict: a conflicting canonical object injected after the initial
  scan → the under-lock re-classification fails the request (observation
  id + state mismatch), the immutable no-replace publication fails, the
  conflict remains untouched, no success evidence exists, the state is
  scanner-classifiable as conflicting — tested.

## 9. Version/Migration Boundary

Missing current-version configuration → recovery candidate; valid
supported current-version → healthy/already-present; unsupported/future
version → fail closed (`unsupported-configuration-version`); conflicting
same-version bytes → external disposition; `migration-required` is
reserved (no older version defined; zero migration in this slice).
Recovery never transforms an old configuration into a new version.

## 10. Evidence Model

Deterministic `StoreEvidenceRecord` (`recovery-evidence`; identity
domain `PGAP-STORAGE-CONFIGURATION-RECOVERY-EVIDENCE-v1`) plus its
mechanical `authorized-write` audit, published through the existing
exact recovery-evidence permit pipeline. Binds: store/namespace, the
operation, the recovery action identity, the trusted-input identity
digest, the configuration class/identity/version/digest, the
pre-recovery classification, the observation id, generation/surface,
and the outcome (`configuration-recovered` | `already-completed`). No
raw configuration path; no trusted-input internals beyond the public
identity digest. Evidence never grants configuration authority and never
affects configuration interpretation (tested: the evidence is a plain
`StoreEvidenceRecord`; the recovered configuration is consumed exactly
like an initialized one).

## 11. Crash/Idempotency Model

Fixed 11-stage inventory: `before-writer-lock`, `after-writer-lock`,
`after-current-state-verification`, `before-configuration-publication`,
`after-configuration-publication`,
`before-configuration-durability-confirmation`,
`after-configuration-durability`, `before-evidence-publication`,
`after-evidence-publication`, `after-evidence-audit-publication`,
`before-writer-lock-release` — asserted in order and crash-tested at
every stage with deterministic reruns (recover / already-present /
already-completed), lock retention and fixture release, and scanner
classifiability. Idempotency table: missing + no evidence → recover;
exact + matching evidence → `already-completed` (same deterministic
evidence identity); exact + no evidence → `already-present`;
missing + matching evidence → integrity failure; conflicting
evidence → fail closed; trusted input changed → fail closed;
configuration changed between verify and publish → fail closed; a stale
writer lock is never auto-broken.

## 12. Scanner/Assessment Integration

The recovery scan (recovery mode) observes the configuration namespace
with a deterministic observation id and the closed state vocabulary
(configuration-healthy / configuration-missing /
configuration-directory-missing / malformed-configuration /
conflicting-configuration / unsupported-configuration-version /
wrong-type-configuration / wrong-uid-mode-configuration /
interrupted-configuration-publication / foreign-configuration-entry /
migration-required) and classifies configuration-recovery evidence
states (completed / conflicting / evidence-without-configuration /
dangling). Malformed/conflicting configuration never makes the
unrelated store-records recovery scan fail. The recovery scan and the
recovery operation use the configuration-tolerant revalidation (fully
verified store-records metadata anchor; configuration metadata observed,
never trusted); every other operation keeps the strict fail-closed
pipeline. The registry index is never updated or deleted by recovery
(WP-8-H staleness semantics apply).

## 13. Security Boundary

Proven by static guards and tests: dual authority (both gates genuine);
no configuration self-authentication (expected bytes never derived from
on-disk configuration; no parsed-on-disk-configuration → trusted-input
creator edge); no overwrite (byte-exact EEXIST replay only; no
truncate/replace/rename/chmod/chown/unlink); no generic configuration
writer vocabulary; the recovery capability never reaches the generic
publication substrate; exact permit creator/verifier edges; no raw
path/JSON/callback/plan-action operands; no migration API; no
subprocess/network; zero production recovery provenance producers; no
package-root authority export.

## 14. Tests

| Suite | Result |
|---|---|
| Typecheck / build / test TS compilation | pass |
| Focused configuration-recovery (`config-recovery.test.js`) | **21 tests, 21 pass** |
| Bootstrap/configuration tests | pass |
| Retention tests | pass |
| Audit-history / audit-reconstruction | pass |
| Registry/recovery / registry-index / recovery-mutation | pass |
| Lock recovery / external disposition | pass |
| Complete storage suite (incl. static guard 29 tests) | **409 tests, 409 pass + 2 pre-existing privilege-gated skips** |
| Global security | **15 tests, 15 pass** |
| Storage crash suites | **5 tests, 5 pass** |
| Contract-hash audit | pinned SHA-256 updated to `8b1b0756…95dbf8` |
| `git diff --check` | clean |

## 15. Full Verification

- `npm run build`, `tsc -p tsconfig.json --noEmit`,
  `tsc -p tsconfig.tests.json` — pass.
- Default workflow battery (`npm test`): **1358 tests, 1357 pass,
  1 fail** — the single failure is the accepted Pi environment baseline
  (expected Pi `0.83.0`, installed `0.84.1`; default workflow
  `1357/1358` accepted for this slice).
- Per-suite totals: unit top-level 169/169; integration 100/100;
  security 15/15; pi-adapter 272 (271 pass + the accepted Pi mismatch);
  trusted 570/570; pointofuse-v2 232/232; WP-7 regression 165/165;
  storage suite 409 pass + 2 pre-existing skips; storage crash suites
  5/5. Grand total across all suites: **1939 tests — 1936 pass,
  1 accepted Pi mismatch, 2 pre-existing skips, 0 other failures**.

## 16. Remaining WP-8 Work

Compaction; configuration migration; `ConfigurationSnapshotRecord`
production (no producer exists); configuration-namespace recovery of
non-metadata objects; disposition of the remaining adjudication-only
classes; lifecycle approval decisions; WP-12 integration; WP-9
generation seeding; WP-8 closure evidence (implementation review of
WP-8-F…WP-8-M pending; WP-8 remains not closed).
