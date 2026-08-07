# ADR-036 — WP-8-M Configuration Namespace Recovery

**Status:** Accepted (WP-8-M; human-authorized work package `WP-8-M —
Configuration Namespace Recovery`).

**Authority chain:** ADR-002 (trust and approval boundary), ADR-023
(sequencing), ADR-024 (trusted configuration ownership), ADR-028/029
(trusted bootstrap input, capabilities), ADR-030…035 (WP-8-F…WP-8-L),
WP-8 contract §3/CSR-001…016 (configuration store), §16 (recovery),
§21 (capability model), §12.3 (writer lock), SRX (root/permission
policy), TAU/CAP (authority separation).

## 1. Decision

WP-8-M implements bounded, authority-safe recovery of the persistent
configuration namespace as the exact recovery operation
`recover-configuration-namespace`, gated by a **dual-authority
requirement**: genuine recovery authorization AND a genuine trusted
configuration/bootstrap input. The recoverable object is the
configuration-namespace `StoreMetadata` (the only persistent
configuration object; contract 6.2 "Store metadata"), republished with
the exact no-overwrite metadata protocol from bytes derived through the
SAME canonical trusted-input-to-storage transformation as normal
initialization. Zero migration; zero generic configuration writing.

## 2. Dual-Authority Gate and No Self-Authentication

- (A) Recovery authority: genuine branded recovery-action provenance,
  the exact `recover-configuration-namespace` operation, the verified
  store instance (configuration-tolerant revalidation: trusted parent,
  both namespace-root descriptors, fully verified store-records
  `StoreMetadata` as the store identity anchor), generation/surface
  bindings.
- (B) Trusted configuration/bootstrap input: a genuine branded
  `TrustedStorageBootstrapInput` correlated with the genuine WP-6
  trusted configuration, binding the exact configuration identity,
  configuration version, and the deterministic trusted-input identity
  digest (`PGAP-STORAGE-TRUSTED-INPUT-IDENTITY-v1` over the input's
  canonical facts).

An on-disk configuration object never authorizes its own repair: the
expected canonical bytes are derived purely from the genuine trusted
input + verified store facts + a re-run of the compatibility probe —
never from on-disk configuration contents. Recovery authority alone
cannot publish configuration; trusted input alone grants no mutation
authority; a recovery plan, finding, or configuration file content
grants nothing (all tested).

## 3. Recoverable Object and States

The only persistent configuration object is
`config-v1/metadata/metadata.json`. Recoverable state: expected
canonical configuration MISSING (metadata directory present). Exact
healthy configuration: non-mutating `already-present` (no recovery
evidence fabricated — a healthy store is indistinguishable from an
interrupted recovery, so evidence roll-forward is not provable under
contract facts and the idempotency table's fallback applies). All other
states fail closed and are never mutated: conflicting bytes,
malformed, wrong type, wrong UID/mode, symlink, foreign entries,
unsupported version (`migration-required` reserved; no older version is
defined in this contract, so non-supported versions map to
unsupported-configuration-version), interrupted publication (provable
strict prefix of the expected bytes — classified, never overwritten),
missing metadata directory (bootstrap action required; the phase-3
top-level entry set `records`/`audit`/`locks` is the ONLY layout
provisioned by recovery, mirroring the write path's provisioning).

## 4. Canonicalization and Publication

The expected bytes come from the initialization transformation:
recovery-gated compatibility probe + metadata facts (namespace
identities, parent identity, lane, configuration identity, bootstrap
action identity from the trusted input, limit-profile identity) +
`buildStoreMetadata`. Same trusted input + same store ⇒ identical bytes
and digest; clock, PID, nonce, raw path, and the RECOVERY action
identity never enter the configuration bytes. Publication uses the
exact no-overwrite metadata protocol under the normal writer lock via a
dedicated `ConfigurationRecoveryMetadataPermit` (genuine recovery
capability, exact operation, configuration identity/version/digest,
trusted-input identity, exact destination) consumed by the metadata
persistence owner, which re-parses and re-verifies the bytes and
re-derives the destination. EEXIST is byte-exact replay only; a
conflict that appears during recovery fails closed and remains
untouched.

## 5. Evidence

A successful recovery publishes a deterministic `StoreEvidenceRecord`
(`recovery-evidence`; `PGAP-STORAGE-CONFIGURATION-RECOVERY-EVIDENCE-v1`)
plus its mechanical `authorized-write` audit through the existing
exact recovery-evidence permit pipeline, binding store/namespace, the
operation, the recovery action identity, the trusted-input identity
digest, the configuration class/identity/version/digest, the
pre-recovery classification, generation/surface, and the outcome
(`configuration-recovered` | `already-completed`). Evidence never
grants configuration authority and never affects configuration
interpretation.

## 6. Scanner and Consumers

The recovery scan observes the configuration namespace with a
deterministic observation id (the request binds it; a state change
fails the request) and classifies configuration-recovery evidence
states; malformed/conflicting configuration never makes the unrelated
store-records recovery scan fail. The registry index is never updated
or deleted by recovery (WP-8-H staleness semantics apply). The
recovered configuration is consumed by the normal configuration
consumer path exactly as one created by initialization (tested via
`verifyStoreInstance`); the recovery operation itself uses the
configuration-tolerant revalidation exclusively.

## 7. Contract and Documentation Impact

- One narrow contract amendment: §16.7 + CSA-016…018 (the operation
  vocabulary, the dual-authority gate, the recoverable states, the
  no-overwrite rule, the evidence model, the tolerant revalidation,
  the scanner states, the crash model).
- One implementation report:
  `docs/reports/wp-8m-configuration-namespace-recovery-implementation-
  report.md`.
- Current-state wording updated in `post-wp5a-roadmap.md` and
  `post-wp5a-planning-status.md`.

## 8. Out of Scope (unchanged)

Configuration migration, generic configuration editing, arbitrary
configuration replacement, retention/deletion, compaction,
configuration-namespace `ConfigurationSnapshotRecord` production (no
producer exists; recovery never invents configuration records), WP-9,
WP-12.
