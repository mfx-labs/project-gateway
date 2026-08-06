# WP-8-C — Pre-Implementation Decision Consolidation Report

**Status:** Documentation-only decision baseline established after the human
decision closing OD-001 as **explicit control-plane locator only; no WP-8
host default** (ADR-028; WP-8 contract Appendix G updated). The senior
decision-baseline review returned corrections required (nine findings
W8C-D01…W8C-D09); the **focused correction closed all nine**; the **focused
decision-baseline rereview returned one remaining MAJOR finding (W8C-D10),
one dependent finding (W8C-D11), and three MINOR findings (W8C-D12…W8C-D14)**;
**this final micro revision closes all five** (register in §12); the
**final micro decision-baseline rereview and the final status micro spot
check returned `WP-8-C FINAL STATUS MICRO SPOT CHECK: ACCEPTED` with
`OPEN FINDINGS: 0`**; the **WP-8-C decision baseline is ACCEPTED** and
the **WP-8-C decision-baseline commit** (subject `docs: establish
WP-8-C decision baseline`) is the commit containing this update. No WP-8-C
runtime code, roots, namespaces, metadata, scratch objects, capabilities, or
trusted input objects were created. WP-8-C implementation is **not
authorized**; the next gate is **human authorization of WP-8-C
implementation**; WP-8-D and later are not authorized; no publication
occurred.

---

## 1. Baseline

| Item | Value |
|---|---|
| Repository | `/home/chef/Documents/Project_Gateway_MCP` |
| Branch | `main` |
| Baseline HEAD | `b83120475a4c66606ebb72d9346cf15f10c2f00d` (`feat: establish WP-8-B non-mutating foundation`) |
| Baseline parent | `0965d668204540073b1346947db1c6193f9fd4dc` |
| Contract pre-change SHA-256 | `926c4de0f6498c10a64d2dadc75ed9ee65108c2d31030cc3e124276f208b83b0` |
| Contract post-change SHA-256 | `aeed25790f58d52f77a98a31d8e7d58784a871aa7466422fb1c638a1faf8456f` |
| package-lock SHA-256 | `0fe11d74491a1d6b8a10a6969848a106c1f472417a4cb102b09fcfe7d7b4f0ff` (unchanged) |
| Working tree before change | clean; staging empty; untracked zero; tags zero; no commits after HEAD |

## 2. Human-Approved Decisions (recorded)

- **A. OD-001** — explicit control-plane locator only; no WP-8 host default;
  no environment, argv, cwd, request, repository, artifact, or WP-8-record
  derivation; parent pre-exists; parent owned by the configured trusted
  service UID; parent mode exactly `0700`; WP-8-C does not create, chown, or
  replace the parent; fixed namespace derivations only; the locator alone
  grants no mutation authority.
- **B. Trusted bootstrap input** — separate internal
  `TrustedStorageBootstrapInput`; the WP-6 workspace-configuration schema is
  not extended for storage bootstrap fields.
- **C. Capability binding** — initialization capability binds only to facts
  available before initialization; namespace identities and StoreMetadata
  digests are results, not retroactive bindings.
- **D. Metadata write** — bounded write-all semantics; no
  single-write-completes-buffer assumption.
- **E. Static-guard scoping** — exact module-scoped filesystem and
  capability-brand exceptions.
- **F. Sequencing** — documentation-only decision baseline before
  implementation.

## 3. OD-001 Closure (contract Appendix G)

The WP-8 contract decision inventory row OD-001 is updated from
"Open, non-blocking" to:

**Resolved — explicit control-plane locator only; no WP-8 host default**
(human decision; ADR-028): the trusted control plane supplies one
already-resolved absolute parent locator; WP-8 defines no default
trusted-parent path and derives the locator from no environment variable,
argv value, working directory, request value, repository file, artifact, or
WP-8 record (CSR-001 unchanged); the trusted parent pre-exists, is owned by
the configured trusted service UID with mode `0700`, and is never created,
chowned, or replaced by WP-8; WP-8 derives only `config-v1/` and `store-v1/`
beneath it; the locator alone grants no mutation authority.

Owner: human decision; WP-8 implementation phase (phase 2). Later gate:
none — closed at implementation authorization. No normative requirement was
added, removed, or weakened; the requirement inventory remains 364.

## 4. Trusted Bootstrap Input Carrier (decision B)

- **Exact future module path:** `src/storage/trusted-input/bootstrap-input.ts`
  (future WP-8-C authorized tree; not implemented).
- **Ownership boundary:** WP-8-C trusted-input component; internal only; no
  package-root export.
- **Actual WP-6 provenance limitation:** a genuine WP-6 validated
  trusted configuration proves trusted configuration provenance only;
  its current provenance contains `sourceKind` and does NOT contain
  the storage-bootstrap action identity, locator, configured service
  UID, forbidden-root set, or limit-profile identity.
- **Two independent operands (neither implies the other):** (A) a
  genuine accepted WP-6 validated trusted-configuration value
  positively verified through the existing accepted genuineness-brand
  verifier `isGenuineValidatedTrustedWorkspaceConfiguration`; and (B)
  a genuine `StorageBootstrapActionProvenance` object. Structural
  equality is never sufficient to establish either operand's
  genuineness.
- **Correlation:** the creator verifies exact equality or canonical
  identity correlation between the two operands for: trusted
  configuration identity, resolved locator, configured service UID,
  forbidden-root set, limit-profile identity, and explicit action
  identity. An action identity is never accepted merely as a string or
  structurally valid field, and it does NOT come from WP-6
  configuration provenance.
- **Action-provenance producer (future, not implemented):**
  `src/control-plane/storage-bootstrap-action.ts` — the trusted
  control-plane bootstrap composition root and sole production
  consumer of the action-provenance creator; creates one immutable
  genuine action-provenance object for an explicitly authorized
  bootstrap action binding action identity, resolved locator,
  configured service UID, forbidden-root set, trusted configuration
  identity, and limit-profile identity; no request, environment,
  repository, artifact, or WP-8-record creation path; no package-root
  or MCP exposure. **Production WP-8 initialization integration cannot
  occur until this trusted producer boundary exists**; WP-8-C
  establishes and tests the consumer/verifier contract only and does
  not pretend the production producer exists. Test-only producers may
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
- **Creation:** solely through the gated creator; immutable after
  validation.
- **Fields:** resolved absolute locator; configured trusted service UID;
  forbidden-root identities or validated root set; trusted configuration
  identity; limit-profile identity; explicit control-plane action identity.
- **Prohibited creation paths:** request, environment, repository, artifact,
  or WP-8-record sources.

## 5. Static-Guard Module Allowlist (decision E)

Future `tests/unit/storage/static-guard.test.ts` enforcement model:
module-path allowlist map; per-module allowed API subsets; denial everywhere
else; denial of future issuance markers.

| Future module | Permitted `node:fs` APIs | Other allowances |
|---|---|---|
| `src/storage/root/resolve.ts`, `identity.ts` | `openSync`, `closeSync`, `fstatSync`, `lstatSync`, `realpathSync`; constants `O_RDONLY`, `O_DIRECTORY`, `O_NOFOLLOW` | none |
| `src/storage/probe/probe.ts`, `scratch.ts` | `openSync`, `closeSync`, `fsyncSync`, `fstatSync`, `fchmodSync`, `linkSync`, `unlinkSync`, `mkdirSync`, `rmdirSync`, `symlinkSync`, `writeSync`, `readFileSync`; constants `O_CREAT`, `O_EXCL`, `O_WRONLY`, `O_RDONLY`, `O_NOFOLLOW`, `O_DIRECTORY` | none |
| `src/storage/metadata/bootstrap-persist.ts` | `openSync`, `closeSync`, `writeSync`, `fsyncSync`, `fchmodSync`, `fstatSync`, `readFileSync(fd)` (descriptor-based) or explicit bounded `readSync` loop; constants `O_CREAT`, `O_EXCL`, `O_NOFOLLOW`, `O_WRONLY`, `O_RDONLY`, `O_DIRECTORY`. Path-based `readFileSync(path)` is forbidden for replay verification | none |
| `src/storage/initialization/provision.ts` | `mkdirSync` (exclusive, non-recursive), `openSync` (`O_RDONLY|O_DIRECTORY|O_NOFOLLOW`), `fchmodSync`, `fstatSync`, `closeSync`, `fsyncSync`; constants `O_RDONLY`, `O_DIRECTORY`, `O_NOFOLLOW` | callable only from the initialization orchestrator; requires the still-live genuine one-shot initialization capability; target path must equal one fixed derivation (no arbitrary path operand); after each creation: descriptor-bound verify of type, configured UID, exact mode `0700`, capture device/inode; fail closed before continuing on mismatch; no parent creation, `chown`, repair, deletion, or recursive creation |
| `src/storage/initialization/initialize.ts` | none (fs-free orchestrator; all filesystem work delegated) | sole importer of the trusted-input creator and the capability creator |
| `src/storage/capabilities/authenticity.ts` | **no `node:fs` imports** | ONE of the two exact brand-bearing modules — allowed `new WeakSet` private-brand and issuance markers for the capability brand; exports only `createInitializationCapability` and its types |
| `src/storage/trusted-input/bootstrap-input.ts` | none (pure validation) | ONE of the two exact brand-bearing modules — allowed `new WeakSet` private-brand markers for the trusted-input brand; exports only the `TrustedStorageBootstrapInput` types and the genuineness verifier |
| All other `src/storage/**` | none — filesystem-free (unchanged blanket prohibition) | no brand/factory markers |

Guard invariants: (1) every file's imports ⊆ its allowlist; (2) all
non-allowlisted modules import no `node:fs`; (3) `new WeakSet` brand/factory
markers exist only in the two exact brand-bearing modules
(`trusted-input/bootstrap-input.ts`, `capabilities/authenticity.ts`), each
with a separate private brand collection — no common or interchangeable
brand, no structural or own-symbol brand, process-local only, JSON/spread/
structured-clone/prototype/plain-object forgery fails; (4) future capability
issuance markers (`issueWriteCapability`, `issueReadCapability`,
`issueVerifyCapability`, `issueRecoveryCapability`,
`issueRetentionCapability`, `issueMigrationCapability`) are denied globally;
(5) exact-name named imports only for `node:fs` — no namespace filesystem
imports, no renamed filesystem imports, no CommonJS `require`, no dynamic
import; (6) allowlisted filesystem modules export no filesystem objects,
descriptors, handles, callbacks, or filesystem-typed helper values (fs
privacy); (7) no local re-export of filesystem APIs and no helper module
outside the allowlist wrapping filesystem calls — import-graph checks reject
an allowlisted helper re-exported or consumed outside its exact authorized
owner; (8) the capability creator is imported only by
`initialization/initialize.ts`, the trusted-input creator only by the
exact private composition boundary, and the action-provenance creator
only by the future `src/control-plane/storage-bootstrap-action.ts`
(while that producer does not exist, no module may import the creator);
(9) synthetic negative tests cover
namespace imports, renamed imports, re-export chains, helper indirection,
forbidden consumer imports, and brand markers in wrong paths; (10)
**mandatory negative-test inventory:** bare `fs`; `fs/promises`;
`node:fs/promises`; namespace import; renamed import; CommonJS
`require`; dynamic import; export-from; local re-export chain; helper
indirection; off-allowlist filesystem import; API outside the
module-specific subset; filesystem-bearing export; wrong-path brand
marker; action-provenance creator imported by a wrong consumer;
trusted-bootstrap-input creator imported by a wrong consumer;
initialization-capability creator imported by a wrong consumer; future
write/read/verify/recovery/retention/migration issuance marker. A regex-based
implementation remains acceptable only under this constrained import syntax
plus import-graph checks; no dependency or AST package is authorized.

## 6. Initialization Capability Model (decision C)

Pre-initialization bindings (only facts available before initialization):

- trusted-parent descriptor identity (device/inode from the opened parent
  descriptor);
- fixed namespace derivations (`config-v1/`, `store-v1/`);
- trusted configuration identity;
- configured trusted service UID;
- limit-profile identity;
- explicit control-plane action identity;
- `{namespace-initialize}` operation set;
- private generation identity;
- live/disposed state.

Explicit statements:

- namespace identities are initialization **results**;
- StoreMetadata digests are initialization **results**;
- the capability is never retroactively mutated;
- future capabilities may bind to verified metadata only after later human
  authorization;
- no future capability kind (write, read, verification, recovery,
  retention, migration) has an issuance path in WP-8-C;
- **issuance is non-ambient:** `createInitializationCapability` requires a
  genuine branded `TrustedStorageBootstrapInput`, validated
  trusted-parent descriptor identity, the exact `{namespace-initialize}`
  operation set, the correlated configuration identity, the configured
  service UID, the limit-profile identity, and the private generation
  identity; **the capability's genuine action identity derives from the
  verified action-provenance operand already bound into that input** and
  is never accepted as a separate or structurally assumed value; the
  creator is importable only by
  `src/storage/initialization/initialize.ts` (single exact consumer,
  enforced by the future static guard) and is not exported from
  `src/storage/index.ts`, `src/index.ts`, package exports, or any local
  re-export barrel; import alone confers no issuance authority because the
  genuine branded input operand is mandatory.

## 7. StoreMetadata Digest and Write Model (decision D)

Digest construction (non-self-referential; accepted WP-8-B helpers):

- payload (stable facts) → canonical payload bytes (RFC 8785 via
  `jcsSerialize`) → payload digest via
  `computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, …)`;
- persisted envelope (payload + payloadDigest + formatVersion + recordKind +
  metadata format version) → canonical persisted bytes → record-byte digest
  via `computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, …)`;
- neither digest includes itself in its own digest input (the payload digest
  is computed over payload fields only; the record digest is computed over
  envelope bytes that contain the payload digest but not the record digest).

Write model (metadata bootstrap protocol; not generalized into record
publication):

- no-overwrite exclusive creation: `open(path, O_CREAT|O_EXCL|O_NOFOLLOW|O_WRONLY, 0o600)`;
- explicit mode `0600`, then descriptor-bound `fchmod` + `fstat` verification
  (owner UID equals the configured trusted service UID; exact mode);
- canonical bytes written with a **bounded write-all loop** (`writeSync` may
  return partial writes; loop until all bytes written or an error occurs);
- file `fsync`;
- metadata-directory `fsync`;
- namespace-directory `fsync`;
- `EEXIST` → **descriptor-bound, no-follow replay verification**: (1)
  open the existing metadata with `O_RDONLY|O_NOFOLLOW`; (2) `fstat` the
  descriptor; (3) verify regular-file type, configured UID, exact mode
  `0600`, device/inode, and expected location; (4) read through the
  descriptor using `readFileSync(fd)` or an explicit bounded `readSync`
  loop; (5) **mandatory post-read revalidation** — `fstat` is performed
  again and the pre-read and post-read device, inode, regular-file
  type, configured UID, exact mode `0600`, and size are compared; any
  mismatch fails closed with the applicable existing error code; (6)
  parse raw JSON
  with duplicate-key rejection; (7) verify canonical bytes; (8) verify
  metadata format version; (9) verify the payload digest; (10) verify the
  record-byte digest; (11) verify namespace identity; (12) verify
  trusted-parent identity; (13) verify every expected stable field; (14)
  exact match only → verification-only idempotence; (15) any mismatch →
  deterministic fail closed. The descriptor-bound read remains
  sufficient under the accepted mode-`0700` trusted-directory,
  single-writer initialization threat model. Path-based
  `readFileSync(path)` is forbidden for replay verification;
- uncertain durability → `ERR-STO-DURABILITY` (verify-before-retry, never
  fabricated success).

Scratch collision and ownership (probe): scratch creation uses
`O_CREAT|O_EXCL|O_NOFOLLOW`; no-overwrite is mandatory; `EEXIST` fails
closed; an action never claims an existing object; matching action digest
and ordinal do NOT establish ownership of a pre-existing object; only a
successfully created object recorded by the current live action may be
removed; prior/dead-action objects remain untouched and require later
maintenance handling within the existing error vocabulary. Scratch names
are derived from the genuine action-identity digest and a bounded
per-action ordinal — no randomness, clock, PID, environment, or cwd is
used.

No lifecycle or `ConfigurationSnapshotRecord` publication is permitted;
hard-link publication is not used for metadata (exclusive single-file
bootstrap is explicitly sufficient; WPR remains phase 3).

## 8. Initialization State and Partial-State Rules (decision F)

- fully `ABSENT` aggregate may initialize;
- exact fully `INITIALIZED` aggregate is verification-only (idempotent
  `already-initialized`, no writes);
- `PROVISIONAL` state without durable metadata may be verified and continued
  only under a **new genuine one-shot initialization capability**;
- one namespace `INITIALIZED` and the other `ABSENT`/`PROVISIONAL` is
  fail-closed partial authoritative state;
- `MALFORMED`, `FOREIGN`, `IDENTITY-DRIFTED`, `UNSUPPORTED-VERSION`, and
  unknown-entry states are fail closed;
- no repair, reconstruction, deletion, or authoritative-state cleanup occurs
  in WP-8-C;
- only the currently live action's own scratch objects (probe files and
  symlinks under its own `tmp/`) may be removed;
- error mapping stays inside the closed 31-code vocabulary; no new error
  code.

## 9. Proposed Implementation Authorization Envelope (proposal only — NOT granted)

- **Source paths:** `src/storage/root/**`, `src/storage/initialization/**`
  (including the provisioning owner `src/storage/initialization/provision.ts`),
  `src/storage/probe/**`, `src/storage/metadata/**`,
  `src/storage/capabilities/**`, `src/storage/trusted-input/**`,
  extensions to `src/storage/types.ts` and the private `src/storage/index.ts`.
- **Test paths:** `tests/unit/storage/{root,initialization,probe,metadata,capabilities,trusted-input}.test.ts`
  plus the extended `static-guard.test.ts`.
- **Documentation paths:** `docs/reports/wp-8c-*.md`, current-state planning
  updates.
- **Filesystem API allowlist and static-guard exceptions:** per §5; the two
  exact brand-bearing modules are `trusted-input/bootstrap-input.ts` and
  `capabilities/authenticity.ts`; directory provisioning is owned solely
  by `initialization/provision.ts`.
- **Exact mutation operations:** create `config-v1/` and `store-v1/`
  (exclusive `mkdir`, mode `0700`); create each namespace's `metadata/` and
  `tmp/`; create per-namespace immutable StoreMetadata via the §7 protocol;
  probe scratch files/symlinks under `tmp/` with cleanup; `fchmod`/`fsync`
  on created descriptors; no `chown`, no removal of namespace directories,
  no repair, no parent creation.
- **Trusted-input carrier interface:** gated creator per §4 (genuine WP-6
  validated configuration verified via
  `isGenuineValidatedTrustedWorkspaceConfiguration` + genuine
  `StorageBootstrapActionProvenance`; correlation per §4); branded,
  immutable, internal; single
  consumer `initialization/initialize.ts`; no barrel/package-root export.
- **Action-provenance producer boundary:** `src/control-plane/storage-bootstrap-action.ts`
  is defined as the future production owner; it is NOT part of WP-8-C
  implementation and is not authorized; production WP-8 initialization
  integration cannot occur until that boundary exists; WP-8-C
  establishes and tests only the consumer/verifier contract; test-only
  producers confined to tests.
- **Initialization capability issuance boundary:**
  `createInitializationCapability` only; requires the genuine branded
  `TrustedStorageBootstrapInput` plus all correlated bindings; operation
  set `{namespace-initialize}`; one-shot; disposal on success and
  failure; imported only by `initialization/initialize.ts` (static-guard
  enforced); no future-kind issuance paths.
- **StoreMetadata protocol:** §7.
- **Partial-state behavior:** §8.
- **Error allocation:** closed 31-code vocabulary (`ERR-STO-ROOT-INVALID`,
  `ERR-STO-ROOT-IDENTITY-CHANGED`, `ERR-STO-PERM-DENIED`,
  `ERR-STO-FS-UNSUPPORTED`, `ERR-STO-READONLY-FS`, `ERR-STO-CROSS-DEVICE`,
  `ERR-STO-NO-SPACE`, `ERR-STO-QUOTA-EXCEEDED`, `ERR-STO-IO-FAILURE`,
  `ERR-STO-CONFIG-UNAVAILABLE`, `ERR-STO-MALFORMED`,
  `ERR-STO-UNSUPPORTED-VERSION`, `ERR-STO-INTEGRITY`, `ERR-STO-DURABILITY`,
  `ERR-STO-RECOVERY-REQUIRED`, `ERR-STO-REQ-INVALID`,
  `ERR-STO-INTERNAL-INVARIANT`); no new code.
- **Conservative requirement claims:** implemented-and-tested
  (CSR-001…005, 007; SRX-001…009/011/012/014/015 at initialization scope;
  FSL-001…010; **CAP-001 implemented and tested for the initialization
  capability kind only** — initialization is the only runtime capability
  kind in WP-8-C, write/read/verify/recovery/retention/migration remain
  type-level vocabulary with no issuance path and no claim for later
  integration; CAP-002…007/010…016 for the initialization kind;
  API-001/002/005/006/007/009/010/011; FSP-006/007/008/010/011;
  SRE-001/002/004/005/012; VRS-001/002);
  implemented-only-for-initialization (SRX-010/013, CAP-008/009 admission);
  integrated later (per-operation SRX-013, publication-boundary CAP-008/009,
  API-003/004, FSL-010 open-time re-verification); deferred/not owned
  (CSR-006, AUD-001, CSA, WPR, LOK, RDS, RGY, RNT, TAU-001…007).
- **Test evidence:** full test decomposition per the refinement (parent
  ownership/mode; symlink/alias rejection; overlap; exclusive creation;
  provisional state; probe success/failure; scratch cleanup; partial
  aggregate; metadata no-overwrite and fsync-failure injection; exact and
  partial replay; capability forgery; private-brand scope; guard path
  exception; one-shot disposal; stale generation; wrong binding; worker/
  structured-clone rejection; no public export; no package/dependency delta).
  UID mismatch: pure stat-policy unit tests with synthetic ownership data;
  integration asserts created-object `fstat.uid` equals the configured
  trusted UID; root-privileged UID-switch tests optional, never required.
- **Package/export/dependency restrictions:** `src/index.ts` unchanged;
  `package.json`/`package-lock.json` unchanged; exports 42; dependencies
  `ajv@8.20.0` only; no new dependency, subprocess, or native addon.
- **Git governance:** no staging or commit without later authorization;
  no push, tag, release, publication, installation, or deployment.

## 10. Changed Paths (documentation only)

- `docs/specs/wp-8-local-storage-registry-contract.md` — modified (Appendix
  G OD-001 row closed).
- `docs/design/post-wp5a-roadmap.md` — modified (current-state wording).
- `docs/design/post-wp5a-planning-status.md` — modified (current-state
  wording).
- `docs/decisions/ADR-028-trusted-storage-bootstrap-locator-and-wp-8c-decision-baseline.md`
  — created (next valid ADR identifier after ADR-027).
- `docs/reports/wp-8c-pre-implementation-decision-consolidation-report.md`
  — created (this report).

No source, test, schema, package, or dependency file changed.

## 11. Inventories and Audits

- Contract requirement inventory: **364 normative requirements** by the
  authoritative Appendix-A prefix-sum method (unchanged — OD-001 is a
  decision row, not a requirement). Counting-methodology reconciliation:
  the coarse unique-ID extraction over the same contract yields **345 IDs
  including DS/OD decision rows**; the two numbers measure different sets
  (appendix prefix counts vs. unique ID patterns); the authoritative
  requirement count remains 364; the pre/post ID sets have a verified
  **zero delta**; no normative requirement was added, removed, or
  modified — only the OD-001 decision status and constraints were
  updated.
- Error inventory: **31** (unchanged). Record classes: **18** (unchanged).
  Limits: **20** (unchanged).
- Public exports: **42** (unchanged). Package exports: `"."`,
  `"./pi-adapter"` (unchanged). Dependencies: `ajv@8.20.0` only (unchanged).
- `src/index.ts` byte-identical to HEAD.
- `git diff --check` clean (verified below).

## 12. Correction Register (W8C-D01…D09)

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| W8C-D01 | MAJOR | ambient trusted-bootstrap-input minting | CLOSED — §4 non-ambient creation gate (genuine WP-6 configuration via `isGenuineValidatedTrustedWorkspaceConfiguration` + genuine correlated action-provenance operand; one composition boundary; single consumer `initialization/initialize.ts`; no barrel/package-root export) |
| W8C-D02 | MAJOR | contradictory brand authority | CLOSED — §5 two-brand Model A (`trusted-input/bootstrap-input.ts`, `capabilities/authenticity.ts`; separate private `WeakSet`s; `new WeakSet` granted only to these two exact paths) |
| W8C-D03 | MAJOR | ambient initialization-capability issuance | CLOSED — §6/§9 issuance gate (genuine branded input mandatory; single consumer; static-guard enforced; no barrel/package-root export) |
| W8C-D04 | MODERATE | no exact directory-provisioning owner | CLOSED — §5/§9 `initialization/provision.ts` sole owner of fixed-directory provisioning with narrow API allowlist, capability gate, fixed target derivations, descriptor-verify-after-create |
| W8C-D05 | MODERATE | metadata replay not descriptor-bound / no-follow | CLOSED — §7 15-step `O_RDONLY|O_NOFOLLOW` descriptor-bound replay; path-based `readFileSync(path)` forbidden; allowlist updated to `readFileSync(fd)`/`readSync` |
| W8C-D06 | MODERATE | static-guard enforcement model incomplete | CLOSED — §5 exact-name imports only, fs-privacy, import-graph/re-export checks, synthetic negative tests, no dependency/AST package |
| W8C-D07 | MINOR | count methodologies not documented | CLOSED — §11 both methods documented (364 authoritative vs 345 coarse); zero ID-set delta |
| W8C-D08 | MINOR | dead-action scratch attribution unstated | CLOSED — §7 action-digest + per-action ordinal scratch naming; live action deletes only recorded names; unattributable scratch never deleted/adopted/repaired |
| W8C-D09 | MINOR | CAP-001 claim not initialization-scoped | CLOSED — §9 CAP-001 scoped to the initialization capability kind only; other kinds type-level vocabulary |
| W8C-D10 | MAJOR | action-provenance model falsely claimed the action identity is recorded in WP-6 validated-configuration provenance | CLOSED (final micro) — §4 WP-6 provenance limitation recorded; two independent operands; correlation via exact equality/canonical identity; producer `src/control-plane/storage-bootstrap-action.ts` defined, not implemented; production integration blocked until the producer boundary exists; test-only producers confined to tests |
| W8C-D11 | dependent | capability action binding not tied to the verified action-provenance operand | CLOSED (final micro) — §6 capability action identity derives from the verified action-provenance operand bound into the trusted input |
| W8C-D12 | MINOR | WP-6 provenance limitation not recorded | CLOSED (final micro) — §4 limitation documented (`sourceKind` only; neither operand implies the other; structural equality never establishes genuineness) |
| W8C-D13 | MINOR | metadata post-read revalidation discretionary | CLOSED (final micro) — §7 mandatory post-read `fstat` comparison (device, inode, type, UID, mode `0600`, size); mismatch fails closed |
| W8C-D14 | MINOR | scratch collision rule absent | CLOSED (final micro) — §7 `O_CREAT|O_EXCL|O_NOFOLLOW` mandatory; `EEXIST` fails closed; no claiming of existing objects; digest+ordinal do not establish ownership |

## 13. Git State (revised)

The **WP-8-C decision-baseline commit** (subject `docs: establish
WP-8-C decision baseline`) is the commit containing this update, on top
of HEAD `b83120475a4c66606ebb72d9346cf15f10c2f00d`; no push, tag,
release, publication, installation, or deployment; no WP-8-C runtime
code exists; no WP-8-D work begun.

**WP-8-C DECISION BASELINE: ACCEPTED**
**OPEN FINDINGS: 0**
