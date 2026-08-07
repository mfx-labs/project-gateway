# WP-8 — Trusted-Local Storage and Registry Contract

**Status:** Authoritative WP-8-A foundation and contract consolidation, corrected per the WP-8-A senior contract review (findings W8A-C01…W8A-C13). Prepared under the human-authorized WP-8-A documentation-only phase. Implementation has **not** started and is **not** authorized. This contract defines normative requirements for later WP-8 implementation phases; it contains no runtime implementation.

**Authority chain:** WP-0 scope and principles; ADR-002 (trust and approval boundary, Accepted); ADR-023 (post-WP-5A sequencing, Accepted — execution order `WP-6 → WP-7 → WP-8 → …`); ADR-024 (trusted workspace and ceiling configuration ownership, Accepted — including trusted-configuration-store persistence assigned to WP-8); approved Post-WP-5A planning package (commit `97022a49d9029449f304a2b1e47f9dc8da4d4a89`); WP-6 closed (`b07fea95d0a1ed20361dec441fc500766969536f`); WP-7 closed (`6b94d811dac8c41062ea4cbd57e56b1fe39b6419`); WP-8-A human authorization (documentation-only foundation and contract consolidation); WP-8-A senior contract review (corrections required).

**Definition of this contract:** WP-8 — Local storage and registry. Trusted-local persistence for lifecycle records, approvals, grants, receipts, audit events (ADR-002 persistence requirement), for the trusted configuration store (ADR-024), and trusted-local directory layouts. WP-8 **stores** accepted trusted-local decisions and evidence; it does not make those decisions.

---

## 1. Scope and Non-Goals

**1.1 Purpose.** WP-8 provides the trusted-local storage substrate that durably persists control-plane lifecycle records and the trusted configuration store outside managed repositories, so that no repository write, branch change, generated text, or prompt injection can grant authority, and so that consumers fail closed when required trusted state cannot be established.

**1.2 Threat model.** The store defends against: repository content attempting to forge, rewrite, or impersonate trusted-local records; untrusted producers (ChatGPT Web, Pi, adapters) attempting to mutate trusted state; path and symlink attacks against the store; partial writes and crashes producing a state that appears authoritative; tampering with stored bytes, ordering, or indexes; and disclosure of trusted state through error surfaces. The model is explicit about its limits: without a separately protected trust anchor, a local actor with write access to the entire store can roll back or rewrite it (Section 9, TML).

**1.3 Trusted and untrusted actors.**

- **Trusted actors:** the trusted local control plane (WP-12 and its explicitly authorized components), a trusted local administrator, and explicitly authorized trusted-local maintenance actions. These are the only actors that may mutate the store.
- **Untrusted actors:** ChatGPT Web, Pi, repository content, artifact documents, adapters, and any request-driven code path. They may read only through explicitly authorized internal interfaces and may never mutate.

**1.4 Relationship to project repositories.** A governed project repository is untrusted project content. The trusted store MUST be located outside every governed project repository and outside every configured workspace root (WP-0, ADR-002). Repository content MUST NOT be able to approve, issue, revoke, activate, rewrite, or forge trusted-local records.

**1.5 Relationship to the local control plane.** The store is the persistence substrate of the trusted local control-plane zone. It persists accepted records and trusted configuration; it never decides approval, issuance, revocation, grant, activation, retention policy, or execution.

**1.6 Supported host lane.** The supported lane is the accepted repository lane: Linux x86_64, POSIX semantics, UTF-8, Node.js 22.23.2, with a local filesystem providing `fsync`/`fdatasync`, atomic hard-link creation, and exclusive file creation. Filesystem compatibility is verified by an explicit initialization probe (Section 11, FSL). Behavior on any other lane or unsupported filesystem MUST fail closed at initialization.

**1.7 Storage operations in scope.** Authorized record publication; exact read by record identity; verify by identity; bounded enumeration; registry-state resolution; audit-history inspection; corruption detection; recovery scanning; retention execution; initialization; format verification; trusted configuration-store persistence (Section 3).

**1.8 Storage operations out of scope.** Lifecycle decision making; execution triggering; policy evaluation; signing-key custody (deferred); public API exposure; MCP tool registration; network access in the MVP.

**1.9 Explicit non-goals.** The store is NOT a general filesystem, database server, shell, Git, or execution interface. WP-8 is NOT a public MCP tool surface. WP-8 MUST NOT expose raw filesystem paths to untrusted callers. WP-8 MUST NOT grant storage mutation authority to WP-7 inspection capabilities. ChatGPT and Pi MUST NOT directly mutate the store merely by executing a task. Cross-process mutation of the store is excluded from the MVP (Section 21, CAP-013).

### Scope requirements

- **SCP-001.** The trusted store MUST be located outside every governed project repository and outside every configured workspace root.
- **SCP-002.** Repository content MUST NOT be able to approve, issue, revoke, activate, rewrite, or forge trusted-local records; no repository-controlled path, file, or artifact may become trusted state.
- **SCP-003.** ChatGPT Web MUST NOT be able to mutate the trusted store directly, including through validated drafts, prompts, or repository content.
- **SCP-004.** Pi MUST NOT be able to mutate the trusted store merely by executing a task; execution-side code paths have no ambient store authority.
- **SCP-005.** WP-7 inspection capabilities (reader, Git, FFF) MUST NOT confer storage mutation authority; storage is never reachable through the WP-7 internal barrel for writes.
- **SCP-006.** The store MUST NOT be a general filesystem, database, shell, Git, or execution interface; only the contract-defined operations exist.
- **SCP-007.** WP-8 MUST NOT be a public MCP tool surface and MUST NOT register any MCP tool or adapter.
- **SCP-008.** WP-8 MUST NOT require network access for the MVP; no network operation is authorized.
- **SCP-009.** The store MUST NOT be located inside, or derived from, any request-controlled or repository-controlled path material.
- **SCP-010.** WP-8 MUST NOT perform approval, issuance, revocation, grant, activation, retention-policy, or execution decisions; it stores records of those decisions made elsewhere.

## 2. Trust and Authority Model

**2.1 Separate authority kinds.** The contract distinguishes: storage authority (who may mutate the store), decision authority (who decides lifecycle state — WP-12 and named trusted roles), execution authority (who may trigger execution — WP-12/WP-13), repository access authority (WP-7 reader), and validation capability (Artifact Core). No one kind implies another.

**2.2 Mutation authority.** Only explicit trusted-local control-plane actions may mutate the store. Mutation authority is an explicit, separately authorized capability of the trusted control plane (Section 21, CAP); it MUST NOT be granted to WP-8 implementation code merely by module import, and it MUST NOT be derivable from repository content, request data, or ambient environment.

**2.3 Bootstrap trust.** The only trusted bootstrap input is a trusted host/control-plane locator for the trusted configuration store (Section 3, CSR). It is not an environment variable, request value, repository file, or WP-8 record. Everything else is derived from trusted configuration and verified store state; no circular trust is permitted.

**2.4 Representation at contract level.** Mutation authority is represented as: (a) an explicit authorized-write capability whose creation is gated by a validated trusted configuration snapshot and an explicit control-plane request; (b) a trusted action identity attached to every write; and (c) a normative rule that no write path exists except through the authorized-write interface. The concrete cross-process authentication mechanism is deferred (DS-18); in-process capability construction, possession, non-transferability, and revocation are normative (Section 21).

**2.5 Consumers.** Trusted-local readers are internal consumers: WP-12 (control-plane decisions), WP-9 (inspection views), WP-5B (enforcement projection), and completion/result consumers — all through internal interfaces. Reads never mutate semantic trusted state.

**2.6 Verification.** Any component may verify a record's integrity (digest, chain, layout) through the verification interface; verification confers no authority.

### Trust and authority requirements

- **TAU-001.** Storage authority, decision authority, execution authority, repository access authority, and validation capability MUST be distinct; no WP-8 interface may conflate them.
- **TAU-002.** Only explicit trusted-local control-plane actions MAY mutate the store; no other actor or code path may write.
- **TAU-003.** WP-8 implementation modules MUST NOT possess ambient mutation authority; import of a WP-8 module MUST NOT by itself authorize writes.
- **TAU-004.** Every authorized write MUST carry a trusted action identity established by trusted configuration or the trusted control plane; anonymous or request-supplied identities MUST be rejected.
- **TAU-005.** Mutation authority MUST NOT be derivable from repository content, request data, environment variables, or process identity alone.
- **TAU-006.** Reads, verification, and enumeration MUST be available as read-only capabilities that never mutate semantic trusted state.
- **TAU-007.** The store MUST fail closed whenever the trusted action identity or the trusted configuration required for a write cannot be positively established.
- **TAU-008.** The store MUST NOT treat its own stored bytes as proof of decision authority; a record's existence or validity never constitutes approval, issuance, grant, or activation.
- **TAU-009.** No recovery, retention, migration, or maintenance procedure MAY invent or re-derive lifecycle decisions that are not present as accepted records.
- **TAU-010.** The contract MUST NOT create new decision authority merely by defining record classes or operations.

## 3. Configuration Store and Bootstrap (W8A-C01)

**3.1 ADR-024 assignment.** ADR-024 assigns trusted-configuration-store persistence to WP-8. The corrected contract therefore owns two persistence namespaces under one trusted parent: the **trusted configuration store** and the **record and registry store**.

**3.2 Bootstrap model.** Three distinct things, never conflated:

1. **Bootstrap locator** — a trusted host/control-plane input that identifies the trusted parent directory (the location of the configuration store). It is supplied by the trusted local control plane at initialization; it is NOT an environment variable, request value, repository file, artifact, or WP-8 record.
2. **Trusted configuration store** — the WP-8-owned namespace `config-v1/` under the trusted parent, persisting the accepted WP-6 trusted configuration records (global/workspace ceilings, workspace registrations, roots).
3. **Record and registry store** — the WP-8-owned namespace `store-v1/` under the same trusted parent, persisting lifecycle records, audit events, and derived indexes.

**3.3 Root structure decision.** The configuration store and the record store use **two versioned namespaces below one trusted parent root**. The record-store root is derived from the trusted parent by fixed layout derivation — it is obtained without trusting record-store contents, and without trusting configuration-store contents either (both are sibling derivations of the bootstrap locator). Neither namespace supplies the other's root.

**3.4 Rules.** No governed repository or workspace supplies either root. Configuration-store initialization is explicit and control-plane-authorized. Configuration-store persistence, integrity, recovery, permissions, versioning, and tamper behavior use the same substrate as the record store (WPR/ITG/CSA apply to both namespaces). Configuration-store and record-store identities are distinct namespace roots with separate root identities; they cannot be confused. Record-store recovery MUST NOT rewrite configuration; recovery is namespace-scoped. Configuration recovery MUST NOT invent control-plane policy; it only verifies and restores persisted configuration records. Root overlap rules are deterministic (SRX).

**3.5 Consumption.** The accepted WP-6 configuration loader consumes configuration through an internal interface; the persistence substrate beneath it is WP-8's responsibility. WP-8 does not define, alter, or evaluate configuration semantics.

### Configuration-store requirements

- **CSR-001.** The bootstrap locator MUST be a trusted host/control-plane input; it MUST NOT come from an environment variable, request value, repository file, artifact, or WP-8 record.
- **CSR-002.** The configuration store and the record store MUST be two versioned namespaces (`config-v1/`, `store-v1/`) below one trusted parent root derived from the bootstrap locator.
- **CSR-003.** The record-store root MUST be derivable from the trusted parent without trusting record-store or configuration-store contents.
- **CSR-004.** No governed repository or workspace MAY supply or overlap either root.
- **CSR-005.** Configuration-store initialization MUST be explicit and control-plane-authorized; no implicit creation is permitted.
- **CSR-006.** Configuration-store persistence MUST satisfy the same durability, integrity, atomicity, crash-safety, containment, permission, and versioning requirements as the record store (WPR, ITG, CSA, FSP, SRX).
- **CSR-007.** Configuration-store and record-store identities MUST be distinct and non-confusable (separate namespace roots, separate root identities, separate version records).
- **CSR-008.** Recovery MUST be namespace-scoped: record-store recovery MUST NOT rewrite configuration, and configuration recovery MUST NOT rewrite records.
- **CSR-009.** Configuration recovery MUST NOT invent, alter, or reinterpret control-plane policy; it verifies and restores persisted configuration records only.
- **CSR-010.** Configuration-store tamper, unsupported-version, malformed-record, and integrity failures MUST fail closed under the applicable ITG, VRS, RFM, and ERM requirements; configuration recovery MUST NOT reinterpret, accept, or repair policy content whose trusted integrity and supported format cannot be positively established.
- **CSR-011.** Configuration updates MUST use the append-only immutable `ConfigurationSnapshotRecord` model of 3.6; in-place mutation of configuration is prohibited.
- **CSR-012.** Every configuration version MUST carry the monotonic revision, predecessor identity and digest (except genesis), payload digest, trusted action identity, and ordering of 3.6.
- **CSR-013.** Current configuration MUST be derived as the unique verified chain head with the highest valid monotonic revision; multiple heads, gaps, predecessor conflicts, duplicate revisions, and conflicting digests MUST fail closed.
- **CSR-014.** Genesis, idempotent replay, duplicate-revision, skipped-revision, forked-history, missing-predecessor, and corrupted-predecessor behaviors MUST follow 3.6 deterministically.
- **CSR-015.** Rollback to an earlier internally valid configuration MUST occur only as a new control-plane-authorized version; rollback resistance remains limited by TML until a separately protected anchor exists.
- **CSR-016.** Current-selection errors MUST be deterministic, mapped to closed error codes, and tested; the derived current-selection index MUST be rebuildable and non-authoritative.

**3.6 Configuration version and update model (corrected W8A-R03).** The configuration store uses an append-only immutable model; in-place mutation is prohibited.

- **Record class:** every accepted configuration update is published as a `ConfigurationSnapshotRecord` (a store-level class in the configuration namespace, outside the lifecycle-record taxonomy; TAX-014) through the same WPR publication substrate.
- **Fields:** snapshot record identity (opaque); monotonic configuration revision (positive integer, strictly increasing); predecessor identity and digest (absent only for the genesis version); configuration payload digest; trusted control-plane action identity; creation timestamp or accepted logical ordering.
- **Genesis:** the first accepted configuration is revision 1 with no predecessor; genesis is created only by an explicit control-plane-authorized action.
- **Current selection:** the current configuration is the unique verified chain head with the highest valid monotonic revision. Multiple heads, revision gaps, predecessor conflicts, duplicate revisions, or conflicting digests fail closed. Any derived current-selection index is rebuildable and non-authoritative.
- **History:** prior accepted versions remain immutable and retained per the configuration retention class.
- **Authority:** WP-8 derives structural chain state (revision order, predecessor linkage, digests) but does NOT decide whether policy content should be accepted; the trusted control plane is the semantic producer of accepted configuration updates.
- **Behaviors:** idempotent replay of the same revision with identical bytes → idempotent duplicate; duplicate revision with different bytes → fail closed; skipped revision → gap, fail closed at selection; forked history → fail closed; missing or corrupted predecessor → fail closed; unsupported configuration version → ERR-STO-UNSUPPORTED-VERSION; rollback to an earlier internally valid configuration is permitted only as a NEW control-plane-authorized version referencing the earlier one — rollback resistance remains limited by TML until a separately protected anchor exists; configuration-store recovery re-verifies the chain and recomputes current selection with evidence.

## 4. Trusted Store Root

**4.1 Source.** The trusted parent root is obtained from the bootstrap locator (CSR); the record-store root is the fixed derivation `<trusted-parent>/store-v1/` and the configuration-store root `<trusted-parent>/config-v1/`. No request may override either root.

**4.2 Resolution decisions.**

- Roots MUST be absolute and canonicalized at initialization.
- Forbidden roots: `/`, the repository roots of governed projects, configured workspace roots, and any path that would overlap them; the two namespace roots MUST NOT overlap each other.
- Symlink/alias handling: each root path is resolved to its canonical absolute form at initialization; the resolved identity (device and inode, and file type) is captured as that root's identity. The final component of each root MUST NOT be a symlink.
- Ownership/permissions: deterministic supported-lane policy (W8A-C02): all store directories are owned by the configured trusted service UID, mode `0700`; regular files mode `0600`; no group or other write access; POSIX ACLs or extended permission mechanisms that grant write access to another principal are unsupported; inability to verify the effective policy fails initialization; trusted configuration cannot relax the policy; any future relaxation requires a reviewed contract-version change.
- Initialization: only an explicit control-plane-authorized initialization action may create the layout; reads and writes against an uninitialized or missing root fail closed.
- Point-of-use revalidation: before any operation that touches a root, that root's identity is revalidated against its captured identity; drift fails closed.

### Store-root requirements

- **SRX-001.** The trusted parent root MUST come from the bootstrap locator only; the two namespace roots MUST be derived by fixed layout derivation; no request may override, extend, or replace them.
- **SRX-002.** All roots MUST be absolute paths; relative roots MUST be rejected.
- **SRX-003.** Each root MUST be canonicalized at initialization, and the canonical resolved identity (device, inode, file type) MUST be captured as that root's identity.
- **SRX-004.** No root MAY be `/`, a governed repository root, a configured workspace root, or any path overlapping them; the two namespace roots MUST NOT overlap each other.
- **SRX-005.** The final component of each root MUST NOT be a symbolic link; a symlink root MUST fail closed at initialization.
- **SRX-006.** Directory ownership and mode are deterministic: directories MUST be owned by the configured trusted service UID with mode `0700`, and regular files MUST be mode `0600`; no group or other-user write access is permitted on any store path.
- **SRX-007 (corrected W8A-R06).** Effective-permission policy: no principal other than the configured trusted service UID may have effective read or write authority beyond the contract policy; directories MUST have effective mode equivalent to `0700`; regular files MUST have effective mode equivalent to `0600`; group-class and other-class permission bits MUST be zero. Any POSIX ACL mask granting effective access to another principal causes the corresponding group-class mode bits to be nonzero and therefore fails the exact-mode check. Harmless ACL metadata that grants no effective access need not be detected merely because it exists.
- **SRX-008.** Inability to verify the effective permission policy (ownership, mode, ACLs) MUST fail initialization; unverifiable state is never accepted.
- **SRX-009.** Trusted configuration MUST NOT relax the permission policy; relaxation requires a reviewed contract-version change.
- **SRX-014.** At creation, every store file and directory MUST be created with an explicit restrictive mode, then verified descriptor-bound: owner UID MUST equal the trusted service UID and the exact final mode MUST be confirmed via `fstat` (or equivalent); inherited effective access from parent directories or default ACLs is rejected by this final-mode verification; the process umask MUST NOT be relied upon.
- **SRX-015.** If the supported lane cannot establish the effective permission policy (owner, exact mode, or effective access), initialization or the affected operation MUST fail closed; verification MUST NOT require spawning external tools (e.g., `getfacl`) and MUST NOT add a dependency.
- **SRX-010.** If a root identity changes after initialization (replacement, remount, deletion, or recreation), every affected operation MUST fail closed with the root-identity-changed error and MUST NOT fall back to path-only access.
- **SRX-011.** If a root does not exist, operations MUST fail closed; no implicit creation is permitted outside an explicit authorized initialization action.
- **SRX-012.** Initialization MUST be an explicit control-plane-authorized action; it MUST NOT be triggered by reads, enumeration, or any untrusted path.
- **SRX-013.** Every store operation MUST revalidate the affected root identity immediately before use (point-of-use revalidation); a disagreement fails closed.

## 5. Directory Layout

**5.1 Versioned layout.** The store uses a versioned layout: `<trusted-parent>/config-v1/` and `<trusted-parent>/store-v1/`. Within each namespace the layout is deterministic and documented; the version is recorded in that namespace's store metadata.

**5.2 Namespaces (minimum, per store namespace).**

- `metadata/` — store metadata and format version;
- `records/` — immutable source records, partitioned deterministically by record class and a fixed-width shard derived from the record identifier digest;
- `index/` — derived, rebuildable indexes and materialized current-state views;
- `audit/` — audit events;
- `tmp/` — temporary write state;
- `locks/` — writer and recovery locks;
- `quarantine/` — quarantined objects (recovery evidence is persisted as
  `StoreEvidenceRecord` records under `records/evidence/`, contract 6.3);
  quarantine execution follows 16.5.

**5.3 Path-component encoding (W8A-C08, corrected W8A-R01).** Exactly one normative encoding model exists; it is layout-version-bound.

- **Accepted identifier grammar (normative input):** every canonical identifier MUST use the accepted WP-2 opaque syntax: one accepted type prefix (`pgw:i:`, `pgw:r:`, `pgw:w:`, `pgw:g:`, or the accepted trusted-record prefix) followed by exactly 32 lowercase hexadecimal characters (`0-9a-f`) representing 128 bits. The identifier is opaque; it MUST NOT encode kind, workspace, time, path, filename, repository, producer, approval, or authority (WP-2).
- **Canonical input:** the complete canonical identifier string as validated by the accepted identity rules (NFC, lowercase, exact prefix and length).
- **Extracted component:** the opaque lowercase-hex identity component — the 32 hexadecimal characters following the type prefix — is used **verbatim** as the record-name component. The type prefix is NOT hex-encoded into the component and NOT repeated in it.
- **Output alphabet and casing:** `0-9a-f`, lowercase only; no padding; no separators.
- **Shard derivation:** the first four characters of the extracted component select the shard directory; shard width is 4 characters, fixed by the layout version.
- **Component derivation:** `<class>/<shard>/<component>.rec` (records), `<class>/<shard>/<component>.aud` (audit events). Record kind or class appears only in the contract-defined parent namespace, never in the identifier component.
- **Length arithmetic (normative):** the extracted component is exactly 32 characters; the encoded filename is exactly 36 characters (`32 + ".rec"`), which MUST fit within the contract-defined `pathComponentBytes` maximum (default 64, hard maximum 128); the full record-relative path MUST fit within `pathBytes` (default 512, hard maximum 1024). Over-limit derivation fails closed.
- **Rejection behavior:** identifiers whose prefix is not accepted, whose opaque component is not exactly 32 lowercase hex characters, whose component contains uppercase characters, invalid characters, or whose canonical form is otherwise non-compliant MUST be rejected before derivation.
- **Empty-value behavior:** no empty identifier is valid; an empty component is rejected.
- **Invalid Unicode behavior:** non-NFC or non-ASCII identifiers are rejected by the accepted identity rules before derivation; no normalization occurs at encoding time.
- **Test vectors:** provided in Appendix H and MUST pass for the supported layout version.
- **Layout-version binding and migration:** the encoding, shard derivation, and length arithmetic are bound to the layout version; any change requires a new layout version, migration authorization (VRS), and compatibility tests.

**5.4 Collision and length.** Component and path lengths are bounded (LMT). Collision avoidance is by construction: the encoding is injective over the supported identifier space, and shards are identifier-derived (first four characters of the extracted opaque component). Case sensitivity is ASCII lowercase; the lane is case-sensitive.

**5.5 Prohibitions.** User-supplied path fragments, repository-derived absolute paths, and path traversal material MUST NOT influence layout paths.

### Layout requirements

- **LAY-001.** The store MUST use the versioned layout with `config-v1/` and `store-v1/` namespaces and the namespace structure of 5.2.
- **LAY-002.** Store format and layout version MUST be recorded in each namespace's `metadata/` and verified at initialization and on every open.
- **LAY-003.** Record paths MUST be derived only from validated canonical identifiers that satisfy the accepted WP-2 opaque grammar of 5.3; the complete identifier is parsed and validated before derivation.
- **LAY-004.** The extracted opaque lowercase-hex component (exactly 32 characters) MUST be used verbatim as the record-name component; no hex re-encoding of the type prefix, padding, or separators is permitted.
- **LAY-005.** Record kind or class MAY appear only in the contract-defined parent namespace, never inside the identifier component; no artifact title, filename, workspace-relative path, user label, query, or repository-derived string MAY be used as a store path component.
- **LAY-006.** The shard derivation and path-component rules MUST be bound to the layout version; any change requires a new layout version, migration authorization, and compatibility tests.
- **LAY-007.** Component and full-path lengths MUST be bounded by fixed layout constants (LMT); over-limit derivation MUST fail closed rather than truncate.
- **LAY-008.** Layout path derivation MUST be deterministic and identical across runs on the supported lane.
- **LAY-009.** The layout MUST distinguish immutable source records from derived index/view data so that indexes can be discarded and rebuilt.
- **LAY-010.** Temporary write state MUST be confined to each namespace's `tmp/`; no partial record may appear under `records/` except through atomic publication (WPR).
- **LAY-011.** Locks MUST be confined to each namespace's `locks/` and MUST NOT be repository-controlled or workspace-visible.
- **LAY-012.** The layout MUST NOT contain any repository path, symlink to repository content, or workspace-visible file.
- **LAY-013.** The two namespaces MUST NOT share records, indexes, locks, or metadata; cross-namespace references are by identity/digest only.
- **LAY-014.** The normative length arithmetic of 5.3 MUST hold for every layout version: the encoded filename (component + suffix) MUST fit within `pathComponentBytes`, and the full record-relative path MUST fit within `pathBytes`; computed values are audited per layout version.

## 6. Record Taxonomy

**6.1 Source of classes.** The persisted record classes are those of the accepted WP-2 trusted lifecycle record model, the control-plane record set, the accepted registry snapshots, and the WP-8-owned store classes. WP-8 defines the persisted form; the semantic owner of each class is the accepting authority document (WP-2 protocol; WP-12 control plane), not WP-8.

**6.2 Record classes (18).**

| Class | Semantic owner | Producer | Immutable | Notes |
|---|---|---|---|---|
| `ValidationRecord` | WP-2 | trusted validator | yes | assessment fact |
| `ApprovalRecord` | WP-2/WP-12 | trusted approver | yes (revocable usability) | revocable-usability class |
| `IssuanceRecord` | WP-2/WP-12 | trusted issuer | yes (revocable usability) | revocable-usability class |
| `RevocationRecord` | WP-2/WP-12 | trusted revocation authority | yes | historical fact |
| `RuntimeGrant` | WP-2/WP-12 | trusted grant authority | yes (revocable usability) | revocable-usability class |
| `ActivationRecord` | WP-2/WP-12 | trusted activation authority | yes | accepted/denied decision |
| `ExecutionOccurrenceRecord` | WP-2/WP-12 | trusted control plane | yes | |
| `ExecutionAttemptRecord` | WP-2/WP-12 | trusted execution recorder | yes | |
| `TrustedReceipt` | WP-2/WP-12 | trusted receipt producer | yes | |
| `ResultPublicationRecord` | WP-2/WP-12 | trusted result publisher | yes (revocable usability) | revocable-usability class |
| `SupersessionRecord` | WP-2/WP-12 | trusted lifecycle authority | yes | |
| `ExecutionSummaryRecord` | WP-2/WP-12 | trusted reporting authority | yes | |
| `MigrationRecord` | WP-2/WP-12 | trusted migration authority | yes | |
| `AuthoritativeAuditEvent` | WP-2/WP-12 | trusted control plane | yes | audit facts |
| Registry snapshot (accepted) | WP-2 | control plane | yes | exact snapshot persistence |
| Store metadata | WP-8 | store initialization | versioned | not a lifecycle record |
| `StoreEvidenceRecord` | WP-8 | store maintenance | yes | one class, closed `evidenceKind` discriminator |
| `ConfigurationSnapshotRecord` | WP-8 (store class, configuration namespace) | trusted control plane (semantic producer) | yes (versioned chain) | append-only configuration versions; current-selection per 3.6 |

**6.3 Evidence class (W8A-C09).** Recovery evidence, retention evidence, quarantine evidence, lock-recovery evidence, initialization evidence, and migration evidence are ONE record class — `StoreEvidenceRecord` — distinguished by a mandatory closed `evidenceKind` discriminator with the exact kinds: `recovery-evidence`, `retention-evidence`, `quarantine-evidence`, `lock-recovery-evidence`, `initialization-evidence`, `migration-evidence`, `audit-reconstruction-evidence`. Every `StoreEvidenceRecord` carries: identity, sequence, creation evidence, the trusted maintenance action identity, referenced record digest(s), the evidence payload, digest binding, retention class, and audit linkage. `StoreEvidenceRecord` is immutable and never a lifecycle decision.

**6.4 Class semantics.** For every class the contract fixes: identity (opaque record ID), revision/sequence semantics, required references (exact record/artifact identities, digests — never paths), digest binding, ordering (logical sequence per class), whether repository content may be referenced (yes, by exact identity/digest only) or authoritative (never), retention class (RNT), and whether replacement/supersession/deletion is permitted (never for immutable classes; supersession is a new record; deletion only under authorized retention).

### Taxonomy requirements

- **TAX-001.** WP-8 MUST persist the WP-2 trusted lifecycle record classes, control-plane record classes, registry snapshots, and store classes of 6.2 without redefining their semantics.
- **TAX-002.** Each record class MUST have a fixed semantic owner recorded in this contract; WP-8 MUST NOT create new decision authority by defining a class.
- **TAX-003.** Every persisted record MUST bind exact identities and digests, never paths, aliases, titles, or repository locations.
- **TAX-004.** Immutable classes MUST NOT be rewritten, deleted, or erased; revocation and supersession are new records (WP-2).
- **TAX-005.** Revocable-usability classes (`ApprovalRecord`, `IssuanceRecord`, `RuntimeGrant`, `ResultPublicationRecord`) MUST support revocation linkage through a new `RevocationRecord`, never in-place mutation.
- **TAX-006.** Repository content MAY be referenced by exact identity/digest only and MUST NOT be authoritative for any lifecycle state.
- **TAX-007.** Store metadata MUST be versioned and distinguishable from lifecycle records; it MUST NOT be treated as a lifecycle decision.
- **TAX-008.** Store maintenance evidence MUST be persisted as `StoreEvidenceRecord` with a mandatory closed `evidenceKind` discriminator; no other evidence class exists.
- **TAX-009.** Every record class MUST define its retention class (RNT); indefinite-retention classes MUST NOT be silently compacted or deleted.
- **TAX-010.** Unknown or future record classes MUST fail closed on read until the store format version supporting them is accepted (VRS).
- **TAX-011.** The record taxonomy MUST be inventoried in the contract appendix and MUST be testable by enumeration.
- **TAX-012.** No record class MAY embed an approval, issuance, revocation, grant, or activation assertion as a self-authored claim (WP-2 envelope prohibition); the record's own persisted form is evidence of the external decision, not the decision itself.
- **TAX-013.** `StoreEvidenceRecord` kinds MUST be validated against the closed kind set; an unknown kind fails closed.
- **TAX-014.** `ConfigurationSnapshotRecord` is a store-level class in the configuration namespace, outside the lifecycle-record taxonomy, with the semantics of 3.6; WP-8 derives structural chain state only.

## 7. Record Format

**7.1 Envelope.** Every persisted record uses an implementation-independent envelope with the following fields (canonical names normative): `recordKind`; `formatVersion`; `recordId` (opaque); `revision` (sequence per record identity); `createdAt` (logical creation time); `trustedActionId` (identity of the trusted action that produced the record); `payload` (the record-class content); `payloadDigest` (canonical digest of the payload); `referenceDigests` (exact references bound by the record); `previousRecordDigest` (chain reference where the class is chained); `integrityMetadata`; `retentionClass`.

**7.2 Canonicalization.** Payload and reference canonicalization reuse the accepted WP-2…WP-4 canonical rules: RFC 8785 JCS serialization after duplicate-key rejection and NFC validation, safe-integer numbers, deterministically ordered set-like arrays. WP-8 MUST NOT silently introduce an incompatible canonicalization profile; any storage-specific profile must be an explicit additive profile recorded in the decision register.

**7.3 Distinguish.** The contract distinguishes: exact persisted bytes; the logical record value; the canonical digest input; and index or materialized-view bytes. Only the canonical digest input is digest-bound; index bytes are derived and rebuildable.

**7.4 Unknown fields.** Unknown fields in persisted records MUST fail closed on verification (strict record schema), consistent with WP-3 strictness.

### Record-format requirements

- **RFM-001.** Every persisted record MUST use the envelope of 7.1 with the normative field names.
- **RFM-002.** The payload digest MUST be computed over the canonical digest input (7.3) using the accepted digest profile (SHA-256, `sha-256:<64-hex>` syntax).
- **RFM-003.** Record identity and references MUST use the accepted opaque identity and digest syntaxes of WP-2; no path-based identity is permitted.
- **RFM-004.** Canonicalization MUST follow the accepted WP-2…WP-4 rules (JCS after duplicate-key rejection and NFC validation, safe integers, deterministic array ordering); a storage-specific profile MUST be explicit and additive.
- **RFM-005.** Unknown, malformed, or non-canonical fields in a persisted record MUST fail closed on verification.
- **RFM-006.** The revision/sequence field MUST be monotonic per record identity; conflicting revisions MUST fail closed (ERM).
- **RFM-007.** Chain references (`previousRecordDigest`) MUST be present exactly where the record class requires chaining and MUST verify.
- **RFM-008.** Exact persisted bytes, logical value, canonical digest input, and index bytes MUST be distinguishable in the layout and in verification diagnostics.
- **RFM-009.** Index and materialized-view bytes MUST NOT be used as digest input for records; they are rebuildable derivatives.
- **RFM-010.** The envelope MUST NOT contain repository paths, workspace-relative paths, or untrusted labels as identity.
- **RFM-011.** Format version MUST be present in every record; unsupported versions fail closed (VRS).
- **RFM-012.** The trusted action identity MUST be present in every record produced by an authorized write.
- **RFM-013.** Record byte size MUST be bounded by the class limit (LMT); over-limit records fail closed at publication.
- **RFM-014.** The record format MUST be deterministic: identical logical records yield identical canonical digest inputs and identical persisted bytes on the supported lane.

## 8. Integrity, Authenticity, and Tamper Evidence

**8.1 Distinctions.** Content integrity: stored bytes match their digest. Tamper evidence: modification, deletion, insertion, reordering, or index staleness is detectable. Trusted provenance: the record was produced by a trusted action (trusted action identity; cryptographic authenticity deferred). Cryptographic authenticity: signing — deferred. Decision authority: never derivable from storage. Rollback resistance: not claimed without a separately protected anchor (Section 9, TML).

**8.2 MVP integrity mechanism (decision).** The MVP requires: per-record canonical digest verification; per-record chain verification where chained; record-path and shard verification against the layout derivation; per-namespace metadata digest; and a recovery-time full verification pass. Signing of records and signed checkpoints is **deferred**; until signing exists, digest and chain verification provide integrity and tamper evidence, NOT proof of trusted authorship or rollback resistance, and no WP-8 output may claim otherwise.

**8.3 Detection and behavior.** Modified bytes, missing records, unexpected records, reordered records, broken chains, stale indexes, mismatched digests, duplicate identifiers, conflicting revisions, and unsupported versions MUST be detected and MUST fail closed (error mapping in Section 18); tamper detection MUST NOT be bypassable by request data.

### Integrity requirements

- **ITG-001.** Every verification MUST recompute the record digest from the canonical digest input and compare with the persisted digest.
- **ITG-002.** Chained classes MUST verify the full chain to the chain anchor; a broken chain fails closed.
- **ITG-003.** Record location MUST verify against the deterministic layout derivation (LAY); misplaced records fail closed.
- **ITG-004.** Modified, missing, unexpected, or reordered records MUST be detected by verification or recovery scanning and MUST fail closed.
- **ITG-005.** Stale or inconsistent indexes MUST be detectable and MUST NOT be served as current state; index rebuild MUST be required before use.
- **ITG-006.** Duplicate record identifiers and conflicting revisions MUST be detected and fail closed.
- **ITG-007.** A digest alone MUST NOT be presented as proof of trusted authorship, approval, or decision authority.
- **ITG-008.** Cryptographic authenticity (signing) is deferred; until authorized, WP-8 MUST NOT claim cryptographic authenticity and MUST record the extension point for signed checkpoints.
- **ITG-009.** Signing-key issuance and custody MUST NOT be assigned to WP-8 absent an explicit accepted authority decision; this contract does not assign it.
- **ITG-010.** Tamper detection MUST fail closed for every covered class and MUST be exercised by the test contract (TVR-E).
- **ITG-011.** Store metadata MUST carry a digest covering the metadata and format version; metadata mismatch fails closed.
- **ITG-012.** Integrity verification MUST NOT disclose raw record bytes, sensitive payloads, or trusted root paths in diagnostics.

## 9. Tamper-Evidence Limitations (W8A-C10)

**9.1 Scope of the guarantee.** Digest and chain verification, without a separately protected trust anchor, detect accidental corruption and internal inconsistency. They do NOT detect every attack by an actor capable of rewriting the entire trusted store.

**9.2 Explicitly out of scope for the MVP guarantee.** Complete store rollback (restoring an older but internally valid state); tail deletion with metadata replacement; full self-consistent chain rewrite; replacement of checkpoints and indexes; replay of an earlier internally valid store state.

**9.3 Distinctions.** The contract distinguishes: accidental corruption detection (covered); internal consistency (covered); repository forgery resistance (covered — repository content cannot reach the store); local write-access attacker (partially covered — tampering is detectable only to the extent the attacker cannot also rewrite metadata/anchors); cryptographic authenticity (deferred, DS-07); rollback resistance (NOT covered without an anchor).

**9.4 Extension points.** Signed checkpoints; external monotonic counters; separately protected anchors; another later-authorized mechanism. No claim of rollback resistance is made before such an anchor exists and is authorized.

### Tamper-limitation requirements

- **TML-001.** The MVP guarantee MUST be stated as accidental-corruption detection and internal-consistency verification; it MUST NOT be stated as rollback resistance.
- **TML-002.** Complete store rollback, tail deletion with metadata replacement, full self-consistent chain rewrite, checkpoint/index replacement, and replay of an earlier internally valid state MUST be documented as out of scope without a separately protected anchor.
- **TML-003.** No WP-8 output or diagnostic MAY claim rollback resistance before a separately protected anchor is authorized and implemented.
- **TML-004.** The extension points of 9.4 (signed checkpoints, external monotonic counters, separately protected anchors) MUST be recorded; none is authorized by this contract.
- **TML-005.** Repository forgery resistance MUST remain guaranteed independently of the anchor question (SCP, SRX, FSP).
- **TML-006.** The distinction between accidental corruption, internal consistency, repository forgery, local write-access attackers, cryptographic authenticity, and rollback resistance MUST be maintained in all documentation and diagnostics.
- **TML-007.** Recovery MUST NOT treat an internally consistent but rolled-back store as authoritative without external evidence; the limitation is recorded in recovery evidence.
- **TML-008.** Test evidence MUST include negative tests demonstrating the MVP does not claim rollback resistance (TVR-E).

## 10. Write Protocol (W8A-C03)

**10.1 Publication primitive and durability order (decision, corrected W8A-R02).** The supported-lane publication protocol is the **hard-link publication protocol** with no-replace semantics. Plain `rename` MUST NOT be used for publishing immutable records (rename replaces silently). The protocol order is normative:

1. create a uniquely named temporary file under the store-owned `tmp/` namespace using exclusive creation (`O_CREAT|O_EXCL`) and no-follow semantics;
2. write the complete canonical bytes;
3. `fsync` the temporary file;
4. verify temporary-file identity and type (`fstat`: regular file, correct owner);
5. atomically publish by creating a hard link from the temporary inode to the final record path (`link(2)`); treat `EEXIST` as an existing-target case and verify the existing record;
6. `fsync` the final record directory (adjudication: the final-directory sync precedes the temporary unlink because the published record must be durable through its final name before its only remaining name is removed; this guarantees recovery never faces a published record with no durable name);
7. `unlink` the temporary name;
8. `fsync` the `tmp/` directory (the temporary-name removal becomes durable);
9. publish and synchronize the required audit event;
10. return success.

**10.2 Existing-target semantics.** Identical existing bytes and digest → idempotent duplicate outcome (success with duplicate evidence) only where the class permits; same identifier with different bytes → ERR-STO-DUPLICATE; same identifier with conflicting revision → ERR-STO-CONFLICT-REVISION; same revision with conflicting digest → ERR-STO-CONFLICT-REVISION.

**10.3 Failure semantics.** Hard-link failure other than EEXIST maps per the filesystem lane (Section 11, FSL): cross-device → ERR-STO-CROSS-DEVICE; unsupported → ERR-STO-FS-UNSUPPORTED; permission → ERR-STO-PERM-DENIED; capacity → ERR-STO-NO-SPACE. Temporary-file cleanup failure → quarantine with evidence (CSA). Crash after link but before unlink → orphan temporary file, quarantined at recovery; the published record is valid. Crash after publication but before directory sync → durability unknown, verification required (ERM). Cancellation and timeout are defined per stage (Section 18).

**10.4 Authorized write sequence (normative semantics).** For every authorized write: (1) validate the complete record before any persistence; (2) produce canonical bytes; (3) execute the publication protocol of 10.1; (4) update the derived index only after record publication; (5) append the audit event with the same durability point; (6) return success only after the durability point is reached.

**10.5 Durability point (corrected W8A-R02).** A successful write MUST NOT be reported before ALL of: the record file is synchronized; the hard link is created; the final record directory is synchronized; the temporary name is unlinked; the `tmp/` directory is synchronized (durable removal of the temporary name); and the required audit event is durably published and its directory synchronized. If any element of the durability point cannot be reached, the operation MUST fail with a durability error and MUST NOT report success.

Failure semantics by stage:

- **Final-directory fsync failure (step 6):** the record may or may not be durable through its final name — primary state changed: yes (link exists); durability: unknown; audit state: unchanged; recovery: required; verify before retry: yes; error: ERR-STO-DURABILITY.
- **Temporary unlink failure (step 7):** the record is published and the final name is durable; the temporary name remains — primary state changed: yes; durability: final name durable; audit state: unchanged; recovery: cleanup with evidence; verify before retry: yes; error: ERR-STO-PUBLISH-FAILED.
- **Temporary-directory fsync failure (step 8):** the temporary-name removal is not durable; after a crash the temporary name may reappear — primary state changed: yes; primary durability: reached; temporary-name removal durability: unknown; audit state: unchanged; recovery: required (classify per WPR-023); verify before retry: yes; error: ERR-STO-DURABILITY.
- **Audit creation, publication, or audit-directory fsync failure (step 9):** primary state changed: yes and durable; audit state: possibly absent or partial; recovery: required to complete or reconstruct the audit event (CSA-005, CSA-013); verify before retry: yes; error: ERR-STO-DURABILITY.

**10.6 Transaction boundary (decision).** The atomic unit is one record publication. Multi-record operations (e.g., record + audit event, or batch issuance) are sequences of atomic units with ordered audit events; there is no cross-record atomic rollback in the MVP. Any later multi-record atomic transaction requires a contract revision.

### Write-protocol requirements

- **WPR-001.** No bytes MAY be persisted before the record fully validates (envelope, canonicalization, references, class rules).
- **WPR-002.** Canonical bytes MUST be produced deterministically before persistence (RFM).
- **WPR-003.** Writes MUST use a uniquely named temporary file under `tmp/` created with exclusive creation and no-follow semantics; direct writes under `records/` are prohibited.
- **WPR-004.** Publication MUST use the hard-link protocol of 10.1; plain `rename` MUST NOT be used for immutable records.
- **WPR-005.** The temporary file MUST be `fsync`ed and its identity and type verified (`fstat`: regular file, store owner) before publication.
- **WPR-006.** `EEXIST` at publication MUST be treated as an existing-target case: the existing record MUST be verified and classified per 10.2; no replacement may occur.
- **WPR-007.** After publication the final record directory MUST be `fsync`ed BEFORE the temporary name is unlinked; the temporary name MUST then be unlinked and the `tmp/` directory `fsync`ed (normative order, 10.1).
- **WPR-008.** Success MUST NOT be reported before the corrected durability point of 10.5 is reached, including durable removal of the temporary name and durable audit state.
- **WPR-009.** Index update MUST occur after record publication; an interrupted index update MUST NOT invalidate the published record.
- **WPR-010.** The audit event for the write MUST be appended with the same durability point as the record.
- **WPR-011.** On any pre-publication failure, temporary bytes MUST be removed or quarantined with evidence; no partial record may be visible.
- **WPR-012.** Retry of an identical authorized write MUST be idempotent per class (duplicate evidence or exact duplicate); retry with conflicting content MUST fail closed.
- **WPR-013.** The atomic unit of publication is one record; multi-record operations are ordered sequences with per-unit atomicity (decision recorded).
- **WPR-014.** The write MUST carry the trusted action identity; writes without it are rejected (TAU, CAP).
- **WPR-015.** Hard-link failures MUST map per the filesystem lane (FSL): cross-device, unsupported, permission, or capacity errors as applicable; none may map to an internal-invariant error.
- **WPR-016.** A crash after link but before unlink MUST leave the published record valid; the orphaned temporary name MUST be quarantined by recovery with evidence.
- **WPR-017.** A crash after publication but before directory sync MUST be reported as durability-unknown on recovery; verification is required before the record is treated as durable.
- **WPR-018.** Cancellation or timeout before publication MUST leave no partial state; after publication they MUST NOT report success and MUST require verification (ERM).
- **WPR-019.** Same-identifier, identical-bytes retry after an unknown acknowledgement MUST verify the existing record before declaring idempotent success.
- **WPR-020.** File and directory permissions for published records MUST match the deterministic permission policy (SRX-006); permissive modes fail closed.

- **WPR-021.** The durability point MUST include: durable final record link, durable removal of the temporary name (`tmp/` directory sync), and durable required audit state (10.5).
- **WPR-022.** Stage failures MUST map per 10.5: final-directory fsync, temporary unlink, temporary-directory fsync, and audit creation/publication/directory-sync each carry the stated state, recovery, and verify-before-retry semantics; none may report success.
- **WPR-023.** Recovery MUST classify any crash-reappearing temporary name deterministically into exactly one closed category: (a) orphan referencing an already published immutable record (verify inode/digest against the published record, then remove with evidence); (b) incomplete unpublished temporary (quarantine with evidence); (c) malformed temporary state (quarantine and report); (d) other (quarantine and recovery-required).

## 11. Filesystem Compatibility Lane (W8A-C04)

**11.1 Compatibility contract.** Initialization MUST verify or otherwise positively establish, via a bounded probe under trusted-store initialization that leaves no authoritative state:

- all authoritative namespaces are on the same filesystem/device where the publication protocol requires it;
- hard-link creation is supported;
- directory `fsync` is supported;
- regular-file `fsync` is supported;
- exclusive file creation is supported;
- symlink/no-follow behavior is supported;
- case-sensitivity and path semantics match the layout contract;
- the root is not a network or otherwise unsupported filesystem unless equivalent guarantees are positively established;
- atomic publication properties hold for the selected primitive.

**11.2 Probe.** The probe is bounded, cleanup-safe, confined to `tmp/`, and leaves no authoritative state. Probe failure fails initialization with ERR-STO-FS-UNSUPPORTED and a bounded diagnostic.

**11.3 Failure treatment.** Deterministic mapping for: `ENOSPC` → ERR-STO-NO-SPACE; `EDQUOT` → ERR-STO-QUOTA-EXCEEDED; `EROFS` → ERR-STO-READONLY-FS; `EXDEV` → ERR-STO-CROSS-DEVICE; unsupported hard links or directory `fsync` → ERR-STO-FS-UNSUPPORTED; I/O failure → ERR-STO-IO-FAILURE; permission denial → ERR-STO-PERM-DENIED; root remount or identity drift → ERR-STO-ROOT-IDENTITY-CHANGED. Capacity, quota, read-only, and unsupported-filesystem conditions MUST NOT map to ERR-STO-INTERNAL-INVARIANT. State-change and durability semantics per code are defined in Section 18.

### Filesystem-lane requirements

- **FSL-001.** Initialization MUST verify the compatibility properties of 11.1 before any authoritative operation.
- **FSL-002.** The compatibility probe MUST be bounded, confined to `tmp/`, cleanup-safe, and MUST leave no authoritative state.
- **FSL-003.** Probe failure MUST fail initialization with ERR-STO-FS-UNSUPPORTED and a bounded, disclosure-safe diagnostic.
- **FSL-004.** All authoritative namespaces MUST reside on the same filesystem/device where the publication protocol requires it; a cross-device condition fails closed.
- **FSL-005.** Unsupported hard links, directory `fsync`, or exclusive creation MUST fail closed and MUST NOT fall back to a weaker primitive.
- **FSL-006.** A network or otherwise unsupported filesystem MUST fail closed unless equivalent guarantees are positively established by the probe.
- **FSL-007.** `ENOSPC` and `EDQUOT` MUST map to ERR-STO-NO-SPACE and ERR-STO-QUOTA-EXCEEDED respectively; neither MAY map to an internal-invariant error.
- **FSL-008.** `EROFS` MUST map to ERR-STO-READONLY-FS; `EXDEV` MUST map to ERR-STO-CROSS-DEVICE.
- **FSL-009.** I/O failures MUST map to ERR-STO-IO-FAILURE; permission denial MUST map to ERR-STO-PERM-DENIED; root remount or identity drift MUST map to ERR-STO-ROOT-IDENTITY-CHANGED.
- **FSL-010.** The compatibility contract and probe results MUST be recorded in store metadata and re-verified on open.

## 12. Concurrency and Locking (W8A-C05)

**12.1 Writer model (decision).** The MVP contract requires a **single trusted writer** at a time. This is normative: concurrent authorized writers MUST fail closed with a lock error rather than interleave. Cross-process mutation is excluded from the MVP (CAP-013); the lock model is therefore exercised by in-process writers, but its semantics are specified as if multi-process to remain safe under later authorized expansion.

**12.2 Reader concurrency.** Concurrent readers MUST be safe and MUST NOT require the writer lock. Readers observe only published records.

**12.3 Lock model.** Store-owned lock file at a fixed path under the namespace `locks/` (`locks/writer.lock`):

- acquisition: `O_CREAT|O_EXCL|O_NOFOLLOW` with mode `0600`, followed by directory `fsync`;
- no-follow and file-type validation on every open of the lock;
- lock record fields (normative): lock version; store-instance identity; writer nonce (random, per acquisition); trusted action identity digest (safe reference); process PID; process start time; host boot identity where available; acquisition time; maximum age (from the limit profile);
- release protocol: verify lock identity (nonce + store-instance), `unlink`, directory `fsync`;
- crash behavior: process death does NOT automatically remove a lock file; the lock remains until released or recovered;
- reboot behavior: a boot-identity mismatch classifies the lock as stale;
- stale-lock classification: stale if and only if (boot identity differs from the lock record) OR (boot identity matches AND no live process with the recorded (PID, start time) exists). If liveness cannot be determined, the lock is NOT stale and the store reports lock-unavailable;
- a live lock NEVER becomes stale merely because a configured timeout elapsed;
- explicit stale-lock recovery authority: only an explicitly authorized recovery capability may remove a confirmed stale lock; ordinary writers never break locks;
- recovery evidence and audit ordering: lock recovery produces a `StoreEvidenceRecord` (`lock-recovery-evidence`) and an audit event before any subsequent write;
- PID-reuse defense: start time + nonce, never PID alone;
- concurrent recovery: recovery acquires the lock before any recovery action; a second recovery fails closed;
- cancellation and timeout: bounded lock wait (LMT); timeout fails closed with ERR-STO-LOCK-TIMEOUT.

**12.4 Unsupported filesystems.** Filesystems without the required primitives fail closed at initialization (FSL).

**12.5 Optimistic concurrency.** Not required for the MVP single-writer model; conflicting revisions are rejected by the revision rule. Lost updates are prevented by exclusive creation, hard-link publication, and single-writer enforcement.

### Concurrency requirements

- **LOK-001.** The MVP MUST enforce a single trusted writer; concurrent writers fail closed with a lock error.
- **LOK-002.** Concurrent readers MUST be safe and MUST NOT be blocked by each other or require the writer lock.
- **LOK-003.** Readers MUST only ever observe fully published records.
- **LOK-004.** The writer lock MUST be confined to `locks/` at the fixed path `locks/writer.lock` and MUST NOT be repository-controlled or workspace-visible.
- **LOK-005.** Lock acquisition MUST be exclusive (`O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0600`) followed by directory `fsync`; the lock record MUST contain the normative fields of 12.3.
- **LOK-006.** Lock identity MUST include a writer nonce and the store-instance identity; a bare host PID is never sufficient identity.
- **LOK-007.** Stale-lock classification MUST follow 12.3: boot-identity mismatch or confirmed dead (PID, start time) writer; a live lock MUST NOT become stale merely because a configured timeout elapsed.
- **LOK-008.** If lock liveness cannot be determined, the lock MUST NOT be treated as stale; the store reports lock-unavailable and requires explicit recovery.
- **LOK-009.** Ordinary writers MUST NEVER break locks; only an explicitly authorized recovery capability MAY remove a confirmed stale lock.
- **LOK-010.** Lock recovery MUST produce `lock-recovery-evidence` and an audit event before any subsequent write.
- **LOK-011.** Lock wait MUST be bounded (LMT); timeout fails closed with ERR-STO-LOCK-TIMEOUT.
- **LOK-012.** Cancellation during lock wait or during a write MUST leave no partial state and no orphaned lock claims.
- **LOK-013.** Release MUST verify lock identity (nonce + store-instance), unlink, and `fsync` the locks directory.
- **LOK-014.** Process death MUST NOT automatically remove a lock file; crash and reboot behavior follows 12.3.
- **LOK-015.** PID-reuse defense MUST use start time and nonce; PID alone MUST NOT be used to identify the lock holder.
- **LOK-016.** Recovery MUST acquire the lock before any recovery action; concurrent recovery fails closed.
- **LOK-017.** Conflicting revisions MUST fail closed (RFM-006); no lost-update path exists under the single-writer rule.
- **LOK-018.** Repository-controlled lock files MUST NEVER control trusted-store authority.

## 13. Read and Enumeration Semantics

**13.1 Operations.** read-by-exact-identity; verify-by-exact-identity; bounded-enumerate-class; resolve-registry-state; inspect-audit-history; detect-corruption; recovery-scan. The same operations apply within each namespace scope (config or records) with the namespace bound to the operation identity.

**13.2 Common semantics.** Trusted operands only (validated identities, never request paths); bounds on records and bytes (LMT); deterministic ordering (DTM); copy-on-return; cancellation and timeout; failure mapping (Section 18). Reads MUST NOT mutate semantic trusted state; unavoidable filesystem metadata effects (atime) are outside the guarantee and documented per lane (WP-7 RO-005 convention).

**13.3 Unknown kinds and versions.** Unknown record kinds and unsupported format versions fail closed on read.

### Read requirements

- **RDS-001.** Read-by-identity MUST accept only validated opaque record identities; path or label inputs are rejected.
- **RDS-002.** Read-by-identity MUST verify the record (digest, chain, location) before returning content.
- **RDS-003.** Verify-by-identity MUST return a pass/fail result with the specific failure class (Section 18); it MUST NOT return record content.
- **RDS-004.** Enumeration MUST be bounded by record count and byte limits, MUST be deterministically ordered, and MUST support continuation.
- **RDS-005.** Registry-state resolution MUST derive current state from verified source records (RGY), never from unverified indexes.
- **RDS-006.** Audit-history inspection MUST be ordered and bounded and MUST NOT mutate state.
- **RDS-007.** Corruption detection MUST scan the covered namespaces and report every distinct failure class without stopping at the first failure.
- **RDS-008.** All read results MUST be copy-on-return; no live store handles are exposed.
- **RDS-009.** Reads MUST support cancellation and bounded timeouts; late cancellation MUST NOT corrupt state.
- **RDS-010.** Unknown record kinds and unsupported versions MUST fail closed on read with the mapped error.
- **RDS-011.** Reads MUST NOT mutate semantic trusted state; atime and equivalent OS metadata effects are outside the guarantee and documented per lane.
- **RDS-012.** Read and enumeration diagnostics MUST NOT disclose absolute store paths, raw record bytes, or sensitive payloads.

## 14. Registry Semantics

**14.1 Meaning.** In WP-8, "registry" is the derived, verifiable current-state view over immutable source records (approvals, issuances, grants, revocations, activations, and related classes) plus accepted registry snapshots (WP-2). Source records are authoritative; indexes and views are derived and rebuildable.

**14.2 Derivation.** Current state is derived by replaying verified source records in logical order per class, applying revocation and supersession linkages as new records (WP-2 semantics). Conflict resolution is by the revision/sequence rule; duplicate handling fails closed. Unsupported references fail closed. Stale views are detected by digest/version mismatch and rebuilt; snapshot identity and verification follow WP-2 registry-snapshot rules.

**14.3 Prohibition.** A derived index or cache MUST NOT silently become the source of authority; every view MUST identify the source-record set and version it was derived from.

### Registry requirements

- **RGY-001.** Source records MUST be authoritative; indexes, views, snapshots, and caches are derived.
- **RGY-002.** Current-state views MUST be derived by deterministic replay of verified source records per class.
- **RGY-003.** Revocation and supersession MUST be applied as new records per WP-2; in-place reinterpretation is prohibited.
- **RGY-004.** Conflicts, duplicates, and unsupported references during derivation MUST fail closed, not silently resolve.
- **RGY-005.** Every view MUST bind the exact source-record set and version it was derived from.
- **RGY-006.** Stale or mismatched views MUST be detected and rebuilt before use; unverified views MUST NOT be served.
- **RGY-007.** Indexes MUST be rebuildable from source records alone; loss of an index MUST NOT lose records or authority.
- **RGY-008.** Accepted registry snapshots (WP-2) MUST be persisted as immutable records with exact snapshot identity and digest.
- **RGY-009.** Registry semantics MUST consume accepted Artifact Core lifecycle rules without reimplementing or changing them.
- **RGY-010.** A derived view MUST NOT grant, deny, approve, or activate anything; it only reports derived state.

## 15. Retention and Deletion

**15.1 Authority.** Retention policy is a trusted configuration input supplied by the control plane; WP-8 executes previously authorized retention actions only and MUST NOT decide policy on its own.

**15.2 Classes.** Indefinite-retention classes (all immutable lifecycle, audit, and evidence classes in the MVP); retention-class-tagged classes; audit-event retention; revocation/approval/grant/issuance retention (per record class); evidence retention.

**15.3 Behavior.** No silent garbage collection of authoritative records; retention execution produces `retention-evidence` and deletion audit evidence; secure deletion expectations (unlink within the store root; no overwrite guarantee required in the MVP unless configured); retention failure fails closed and is reported; holds (legal/administrative) are representable as configured retention overrides, not implemented policy.

### Retention requirements

- **RNT-001.** Retention policy MUST come from trusted configuration; WP-8 MUST NOT decide retention policy.
- **RNT-002.** Immutable lifecycle, audit, and evidence records MUST be indefinite-retention in the MVP; silent compaction or deletion is prohibited.
- **RNT-003.** Retention execution MUST be an explicit authorized action per record class and retention class.
- **RNT-004.** Every retention execution MUST produce a `StoreEvidenceRecord` (`retention-evidence`) and deletion audit evidence before reporting success.
- **RNT-005.** Retention failure MUST fail closed and MUST NOT report success.
- **RNT-006.** Retention policy and policy version MUST be recorded and applied atomically per execution batch.
- **RNT-007.** Legal or administrative holds MUST be representable as configured overrides; holds MUST suppress retention execution for the covered records.
- **RNT-008.** Secure deletion expectations MUST be explicit per class; the MVP default is unlink within the store root without overwrite guarantees unless configured otherwise.
- **RNT-009.** Deletion MUST NOT be permitted for immutable classes under any retention action.
- **RNT-010.** Deletion audit evidence MUST be retained per the audit retention class and MUST NOT be deletable by the same action that produced it.

## 16. Crash Safety and Recovery

**16.1 Stage table.** The contract defines required behavior for crashes at every stage: before temporary creation; during temporary write; after file sync before publication; after link creation; after final-directory sync before temporary unlink; after temporary unlink before `tmp/`-directory sync; after `tmp/`-directory sync before audit publication; after publication before index update; during index rebuild; during audit-event creation, publication, or audit-directory sync; while holding the writer lock.

**16.2 Recovery.** Startup or explicit recovery: detect incomplete transactions (temporary files, missing audit events, lock remnants); quarantine orphans with `quarantine-evidence`, classifying crash-reappearing temporary names per WPR-023; roll forward only what is provably complete (published records); never roll back published records; rebuild indexes from source records; re-verify all covered records; produce recovery audit evidence. Recovery MUST NOT guess approval, issuance, grant, revocation, or execution decisions. Recovery is namespace-scoped (CSR-008).

**16.3 Recovery-generated audit reconstruction (W8A-C11).** When a durable primary record exists but its required operation audit event is missing, recovery MAY append a recovery-generated audit event with:

- event kind `recovery-audit-reconstruction` (visibly distinct from the original operation event);
- the trusted recovery action identity;
- source evidence: reference to the original record digest and path-derived identity;
- sequence allocation: the next audit sequence in the class with an explicit gap marker for the missing original event;
- timestamp semantics: the recovery time, never the original operation time;
- idempotency: reconstruction occurs only if no audit event exists for that record and gap; duplicates are rejected;
- ordering: after other recovery evidence for the same recovery run;
- durability point: the same durability point as other audit events;
- bounded disclosure; retention class of audit events.

A recovery-generated event MUST NOT pretend the original operation emitted an event. Recovery evidence MUST NOT create or infer a lifecycle decision.

**16.4 Stale locks.** Stale locks are broken only by explicit recovery with evidence (Section 12).

**16.5 Quarantine execution (WP-8-F `quarantine-temporary`).** The initial
authorized quarantine operation is `quarantine-temporary`: it moves one
crash-reappearing temporary regular file under the verified `tmp/` surface
into the quarantine namespace. Quarantine is a recovery mutation: it is
executed only by an explicitly authorized recovery capability bound to the
exact store, namespace, configuration, recovery action identity, and
operation; it NEVER decides lifecycle state; and it never touches canonical
primary records, audit records, lock files, registry/index files,
directories, symlinks, sockets, FIFOs, devices, or contested identities.

**Eligibility (closed).** A target is eligible if and only if, immediately
before mutation, it is reclassified deterministically as WPR-023 (b)
(incomplete unpublished temporary) or WPR-023 (c) (malformed temporary) AND
all of: regular file; exact expected service UID; exact expected
temporary-file mode; size within `temporaryBytes`; exact descriptor-bound
identity; `nlink === 1`; no verified durable publication twin (WPR-023 (a)
twins use `orphan-removal`, never quarantine); no contested or uncertain
publication relationship; no active writer-lock implication; and the current
observation and assessment evidence match the request exactly. WPR-023 (d)
and otherwise uncertain temporaries are ineligible and remain untouched
(disposition required).

**Destination derivation (deterministic, internal).** The quarantine
destination is `<namespace>/quarantine/temporary/<shard>/<quarantineId>.qtn`
where `<shard>` is the first four lowercase hexadecimal characters of
`quarantineId`, and `quarantineId` is the lowercase SHA-256 domain digest
over (store identity, namespace identity, source temporary entry
designation, WPR-023 classification, exact source content digest, and the
pre-mutation evidence digest), domain-separated as
`PGAP-STORAGE-QUARANTINE-TEMPORARY-v1`. The destination is derived
internally only; no raw path, descriptor, device/inode number, clock value,
random nonce, capability, or recovery action identity enters the digest or
the returned data.

**Provisioning.** `quarantine/`, `quarantine/temporary/`, and
`quarantine/temporary/<shard>/` MAY be lazily provisioned under the writer
lock with exact fixed-directory verification (no-follow; expected UID;
exact directory mode; same verified namespace filesystem). Absent
directories may be created; existing directories must be verified; a
symlink, special file, wrong UID, wrong mode, or replacement fails closed;
no arbitrary caller-provided directory creation exists; created parents are
fsynced.

**Mutation primitive and ordering.** Quarantine uses same-filesystem
hard-link plus unlink (never `rename`, never byte copying, never
overwrite). Order: genuine trusted recovery request; exact
`quarantine-temporary` capability verification; store and namespace
revalidation; request-generation recomputation; surface-generation
recomputation; writer-lock acquisition; immediate source re-verification
(descriptor, UID, mode, `nlink === 1`, size bound, content digest,
observation evidence, current classification); internal `quarantineId` and
destination derivation; exact quarantine-directory provisioning and
verification; destination hard-link no-replace; source/destination same-
inode verification; link-count transition 1 → 2 verification; destination
shard-directory fsync; immediate source-name re-verification; source
unlink; destination-intact and link-count 2 → 1 verification; source
`tmp/`-directory fsync; source-absent and destination-exact verification;
durable recovery evidence publication; corresponding `authorized-write`
audit publication; capability/store revalidation; identity-bound lock
release.

**No-overwrite.** An existing destination is never overwritten. An existing
destination is verified exactly (bytes, identity, classification, evidence
binding) before any idempotent continuation; a destination with different
inode or content fails closed with the conflict/integrity vocabulary and
neither object is modified or unlinked.

**Evidence.** Every quarantine execution publishes a `StoreEvidenceRecord`
(`recovery-evidence`, contract 6.3) with operation `quarantine-temporary`,
binding store and namespace identity, the recovery action identity, the
source temporary entry designation, the source classification, the source
content digest, the pre-mutation evidence digest, the quarantine ID, the
destination logical designation, the resulting state, the request
generation, the surface generation, and the outcome (`quarantined` |
`already-completed`). No raw filesystem path is stored. Success is reported
only after destination durability, source-name removal durability, evidence
durability, and `authorized-write` audit durability.

**Idempotency states (deterministic).** Source present + destination absent:
normal execution. Source present + destination present + same verified
inode: interrupted after the hard link; all facts are re-verified and the
operation continues from the source unlink. Source absent + destination
present + exact expected object + no evidence: interrupted after the source
unlink; the missing recovery evidence and audit are published. Source
absent + destination present + matching evidence: `already-completed`.
Source present + destination present + different inode or content: fail
closed; neither object is modified. Source absent + destination absent:
fail closed; success is never inferred. Matching evidence but destination
missing: fail closed as an integrity failure. Matching evidence but source
still present: fail closed unless the destination is the same verified
inode in an explicitly recoverable interrupted-link state. Repeated
execution is idempotent; conflicting evidence fails closed; no
repair-by-guessing, no rollback of an established quarantine destination.

**Crash-state classification.** Every quarantine crash state is
deterministically classifiable by the recovery scanner (16.2): valid
quarantined temporary with matching evidence; quarantined temporary missing
evidence; evidence referencing a missing quarantine object; source and
destination both present as the same inode; source and destination both
present but conflicting; malformed quarantine filename; foreign quarantine
entry; wrong type/UID/mode; unexpected link count; unknown quarantine class
or shard; quarantine parent/class identity drift (fail closed). A rerun
either completes safely, rolls evidence forward, returns
`already-completed`, or fails closed; stale-lock breaking remains out of
scope (16.4).

### Quarantine requirements

- **QRN-001.** `quarantine-temporary` is the initial authorized quarantine
  operation; no generic `quarantine` authority exists; the recovery
  capability operation set contains exactly the implemented operations.
- **QRN-002.** Quarantine eligibility is the closed WPR-023 (b)/(c)
  regular-file set of 16.5; every other object is ineligible and remains
  untouched.
- **QRN-003.** The quarantine destination is derived deterministically per
  16.5; no caller-supplied path or destination exists.
- **QRN-004.** Quarantine uses same-filesystem hard-link plus unlink;
  `rename`, byte copying, overwrite, and chmod/chown repair are prohibited.
- **QRN-005.** Every quarantine execution publishes durable
  `StoreEvidenceRecord` evidence and its `authorized-write` audit before
  success is reported.
- **QRN-006.** Quarantine idempotency and crash states follow 16.5
  exactly; conflicting destinations and evidence fail closed.

### Crash-safety requirements

- **CSA-001.** A crash before publication MUST leave no visible partial record; temporary files MUST be quarantined with `quarantine-evidence` or removed at recovery.
- **CSA-002.** A crash after publication MUST NOT lose the published record; the durability point determines what must be verified.
- **CSA-003.** A crash between record publication and index update MUST NOT invalidate the record; the index MUST be rebuilt from source records.
- **CSA-004.** A crash during index rebuild MUST leave the old index unusable-flagged or the new index atomically installed; never a half-written index served as current.
- **CSA-005.** A crash during audit-event publication MUST be detectable; recovery MUST complete or reconstruct the missing event per 16.3 (never silently drop it).
- **CSA-006.** Startup recovery MUST be explicit and MUST produce recovery audit evidence before normal operation resumes.
- **CSA-007.** Recovery MUST roll forward only provably complete publications and MUST NOT roll back published records.
- **CSA-008.** Recovery MUST re-verify all covered records and quarantine records that fail verification with `quarantine-evidence`.
- **CSA-009.** Recovery MUST NOT invent approval, issuance, grant, revocation, activation, retention, or execution decisions.
- **CSA-010.** Orphan temporary files MUST be quarantined with evidence; repeated orphan patterns MUST be reported.
- **CSA-011.** Stale locks MUST be broken only by explicit recovery with evidence (LOK).
- **CSA-012.** Recovery failure MUST fail closed with ERR-STO-RECOVERY-FAILED and MUST NOT resume normal operation.
- **CSA-013.** Recovery-generated audit reconstruction MUST follow 16.3 exactly: distinct kind, recovery action identity, gap marker, recovery-time timestamp, idempotency, and ordering.
- **CSA-014.** Reconstruction MUST NOT occur when the original audit event exists; duplicate reconstruction is rejected; reconstruction MUST NOT create or infer lifecycle decisions.
- **CSA-015.** A crash-reappearing temporary name MUST be classified per WPR-023 into exactly one closed category with evidence; classification is deterministic and tested.

## 17. Path Containment and Filesystem Safety

**17.1 Profile.** Trusted-store containment is NOT repository containment. The store defines its own containment profile over the canonical namespace roots: all paths are derived from a root plus layout constants plus safe-encoded identifiers (LAY); no request or repository material enters path construction.

**17.2 Invariants.** Lexical traversal and absolute-path injection rejected; symlink attacks rejected (no-follow for final components, descriptor-bound verification); parent replacement detected via root identity revalidation; hard links confined to store-created files (publication protocol); rename races bounded by the hard-link publication protocol on the supported lane; special files (FIFO, device, socket) rejected; mount/device identity drift detected via root identity; file-type verification from the opened descriptor; permissions and umask enforced; temporary files confined to `tmp/` with exclusive creation; external path disclosure prohibited.

**17.3 Terminology.** Reuses accepted WP-6/WP-7 containment terminology (canonical absolute form, point-of-use revalidation, descriptor binding, O_NOFOLLOW/O_NONBLOCK conventions) where applicable, applied to the store profile.

### Filesystem-safety requirements

- **FSP-001.** Every store path MUST be derived from a canonical namespace root plus layout constants plus safe-encoded identifiers; no other derivation exists.
- **FSP-002.** Lexical traversal and absolute-path injection into store paths MUST be rejected.
- **FSP-003.** Final-component symlinks MUST NOT be followed; symlinked store entries fail closed.
- **FSP-004.** Parent-directory replacement MUST be detected via root identity revalidation and descriptor-bound access; failure fails closed.
- **FSP-005.** Store operations MUST verify file type from the opened descriptor; FIFO, socket, character and block devices MUST be rejected.
- **FSP-006.** Hard links MUST be created only by the publication protocol from store-owned temporary inodes; unexpected link counts fail closed where detectable on the supported lane.
- **FSP-007.** Mount or device identity drift under a namespace root MUST fail closed (root identity revalidation).
- **FSP-008.** Effective permissions MUST be enforced per SRX-006/007/014: descriptor-bound final-mode verification; a permissive mode change or inherited effective access fails closed.
- **FSP-009.** Temporary files MUST be confined to `tmp/` with unique names and exclusive creation; no temporary file may be opened by path from untrusted code.
- **FSP-010.** Diagnostics MUST NOT disclose absolute store paths, workspace paths, or repository paths.
- **FSP-011.** The store containment profile MUST be distinct from repository and workspace containment; mixing profiles is prohibited.
- **FSP-012.** Publication MUST use the hard-link protocol; non-atomic fallbacks are prohibited.
- **FSP-013.** Store directories MUST NOT contain, or be reachable through, symlinks to repository or workspace content.
- **FSP-014.** Every filesystem-touching operation MUST revalidate the affected root identity immediately before the operation (point-of-use).
- **FSP-015.** Permission verification MUST be descriptor-bound and dependency-free on the supported lane; no external permission tooling is required or permitted as a dependency.

## 18. Failure and Error Model (W8A-C04, W8A-C13)

**18.1 Closed code set.** The contract defines exactly **31** closed operational error codes (ERR-STO-*). Conditions MAY map many-to-one where safe; every condition MUST map deterministically. Where an error's state semantics depend on the operation phase, the table carries phase-specific rows (see ERR-STO-READONLY-FS) and the code set remains one code with phase-parameterized semantics. Each code has: triggering condition; operation phase; retryability; recovery requirement; whether the primary trusted state changed; whether the durability point was reached; whether audit state changed; whether verification is required before retry.

| Code | Condition(s) | Retryable | Recovery | Primary state changed | Durability point reached | Audit changed | Verify before retry |
|---|---|---|---|---|---|---|---|
| ERR-STO-REQ-INVALID | malformed/unknown request or operand | no | no | no | no | no | no |
| ERR-STO-CONFIG-UNAVAILABLE | trusted configuration absent/invalid | no | no | no | no | no | no |
| ERR-STO-ROOT-INVALID | root path invalid/forbidden/relative | no | no | no | no | no | no |
| ERR-STO-ROOT-IDENTITY-CHANGED | root identity drift, remount, replacement | no | yes (re-init) | unknown | unknown | no | yes |
| ERR-STO-CONTAINMENT-DENIED | derived path escapes profile | no | no | no | no | no | no |
| ERR-STO-FTYPE-UNSUPPORTED | special file encountered | no | no | no | no | no | no |
| ERR-STO-PERM-DENIED | permission/ownership/ACL violation | no | no | no | no | no | no |
| ERR-STO-NOT-FOUND | record/identity absent | yes | no | no | no | no | no |
| ERR-STO-DUPLICATE | same identifier, different bytes | no | no | yes (rejected) | yes | no | yes |
| ERR-STO-CONFLICT-REVISION | conflicting revision or revision/digest mismatch | no | no | no | no | no | yes |
| ERR-STO-INTEGRITY | digest/chain/location verification failure | no | yes (quarantine) | yes (tamper) | unknown | no | yes |
| ERR-STO-UNSUPPORTED-VERSION | format/record version unsupported | no | no | no | no | no | no |
| ERR-STO-MALFORMED | non-canonical/malformed record bytes | no | no | no | no | no | no |
| ERR-STO-DURABILITY | fsync/durability point unreachable | yes | yes | unknown | unknown | unknown | yes |
| ERR-STO-PUBLISH-FAILED | atomic publication failed (link failure, cleanup failure) | yes | yes | unknown | unknown | unknown | yes |
| ERR-STO-LOCK-UNAVAILABLE | writer lock held/contended or liveness undeterminable | yes | no | no | no | no | no |
| ERR-STO-LOCK-TIMEOUT | lock wait exceeded | yes | no | no | no | no | no |
| ERR-STO-CONCURRENCY | concurrent writer rejected | yes | no | no | no | no | no |
| ERR-STO-CANCELLED | caller cancellation (pre-publication) | no | no | no | no | no | no |
| ERR-STO-TIMEOUT | operation timeout (pre-publication) | yes | no | no | no | no | no |
| ERR-STO-RETENTION-DENIED | retention action not authorized | no | no | no | no | no | no |
| ERR-STO-RECOVERY-REQUIRED | recovery must run before use | no | yes | n/a | n/a | n/a | n/a |
| ERR-STO-RECOVERY-FAILED | recovery could not complete | no | yes | n/a | n/a | n/a | n/a |
| ERR-STO-INTERNAL-INVARIANT | unreachable invariant violated | no | no | unknown | unknown | unknown | yes |
| ERR-STO-NO-SPACE | `ENOSPC` during any store operation | yes | no | unknown | unknown | unknown | yes |
| ERR-STO-QUOTA-EXCEEDED | `EDQUOT` during any store operation | yes | no | unknown | unknown | unknown | yes |
| ERR-STO-READONLY-FS (pre-publication) | `EROFS` or read-only mount detected before any publication | no | no | no | no | no | normally no (yes if any prior/concurrent state is uncertain) |
| ERR-STO-READONLY-FS (post-primary-publication) | `EROFS` detected after primary publication | no | yes where the operation cannot complete | yes or unknown | reached or unknown per completed sync stage | possibly absent or partial | yes |
| ERR-STO-READONLY-FS (post-audit-publication, pre-acknowledgement) | `EROFS` detected after audit publication before acknowledgement | no | no (idempotent replay rules apply) | yes | reached | durable or unknown | yes |
| ERR-STO-CROSS-DEVICE | `EXDEV` during publication | no | no | no | no | no | no |
| ERR-STO-FS-UNSUPPORTED | unsupported filesystem or missing primitive (hard link, dir fsync, O_EXCL) | no | no | no | no | no | no |
| ERR-STO-IO-FAILURE | general I/O failure | yes | yes | unknown | unknown | unknown | yes |
| ERR-STO-LIMIT-EXCEEDED | store-internal limit exceeded (record/payload/temporary/scan bounds) | no | no | no | no | no | no |

**18.2 Precedence (corrected W8A-R04).** Deterministic precedence chain: containment and root-identity failures precede file-type and permission failures; file-type failures precede content checks; syntax and minimum-envelope failures precede version classification; version failures precede canonicalization; canonicalization failures precede digest-integrity verification (integrity verification occurs only after sufficient structural parsing, at the contract-defined point); integrity failures precede duplicate and conflict classification; lock failures precede publication; publication failures precede acknowledgement; cancellation and timeout take precedence over success only before the durability point; after publication, cancellation/timeout MUST NOT report success and MUST return the verify-required outcome (durability/publication-failed class).

**Malformed versus unsupported-version precedence (normative):**

- Malformed syntax or a structurally invalid minimal envelope maps to `ERR-STO-MALFORMED` regardless of any version field content.
- `ERR-STO-UNSUPPORTED-VERSION` applies ONLY when the minimum envelope and the version field are structurally valid, canonical, and parseable, but the declared version is outside the supported set.
- When both the version field and another field are invalid: if the minimum envelope is unparseable → `ERR-STO-MALFORMED`; if the minimum envelope parses but the version is unsupported → `ERR-STO-UNSUPPORTED-VERSION` takes precedence over deeper field checks; if the version is supported but another field is malformed → `ERR-STO-MALFORMED`.
- Integrity verification runs only after the structural, version, and canonicalization checks pass. Duplicate/conflict classification: same identifier and identical canonical bytes/digest → idempotent duplicate (class-dependent success); same identifier and different bytes → ERR-STO-DUPLICATE; conflicting revision → ERR-STO-CONFLICT-REVISION; same revision with conflicting digest → ERR-STO-CONFLICT-REVISION; retry after unknown acknowledgement → verify first (WPR-019); collision at publication → ERR-STO-DUPLICATE path (WPR-006).

**18.3 Disclosure.** Raw filesystem errors (raw errno details), absolute trusted roots, sensitive record bytes, integrity metadata, trusted action identity, capability identity, store-instance identity where sensitive, configuration digest where sensitive, lock nonce, signing or authentication material, and internal stack data MUST NOT appear in any error surface.

### Error-model requirements

- **ERM-001.** Every failure MUST map to exactly one closed ERR-STO-* code; no other operational error class exists.
- **ERM-002.** Conditions MAY map many-to-one where safe, but every condition MUST map deterministically; no condition may map to different codes on different runs.
- **ERM-003.** Unmapped, raw, or unexpected failures MUST map to ERR-STO-INTERNAL-INVARIANT and MUST NOT expose internals.
- **ERM-004.** Errors MUST be disclosure-safe: no raw filesystem errors, raw errno details, absolute trusted roots, sensitive record bytes, integrity metadata, trusted action identity, capability identity, store-instance identity, configuration digest, lock nonce, signing or authentication material, or internal stack data.
- **ERM-005.** Recovery-required codes MUST block normal operation until recovery completes.
- **ERM-006.** Where durability point or state change is unknown, the caller MUST be told to verify; the operation MUST NOT claim success.
- **ERM-007.** The error mapping MUST be complete (every condition to one code) and tested (TVR-A); precedence per 18.2 MUST be tested.
- **ERM-008.** Cancellation and timeout MUST NOT corrupt state; after either, the operation's effect is unknown-and-verifiable, never presumed.
- **ERM-009.** Cancellation or timeout before the durability point MUST report no state change; after the durability point they MUST NOT report success and MUST require verification.
- **ERM-010.** Capacity (`ENOSPC`), quota (`EDQUOT`), read-only (`EROFS`), cross-device (`EXDEV`), and unsupported-filesystem conditions MUST map to their dedicated codes and MUST NOT map to ERR-STO-INTERNAL-INVARIANT; over-limit conditions MUST map to ERR-STO-LIMIT-EXCEEDED (store-internal limits) or ERR-STO-REQ-INVALID (request-lowerable operand limits).
- **ERM-011.** Duplicate and conflict classification MUST follow 18.2 for identical bytes, different bytes, conflicting revision, and revision/digest mismatch.
- **ERM-012.** Idempotent retry after an unknown acknowledgement MUST verify existing state before declaring success (WPR-019).
- **ERM-013.** Every error code MUST carry the fixed phase, retryability, recovery, state-change, durability, audit, and verify-before-retry semantics of 18.1.
- **ERM-014.** Malformed-versus-unsupported-version precedence MUST follow 18.2: unparseable minimum envelope → ERR-STO-MALFORMED; parseable envelope with unsupported version → ERR-STO-UNSUPPORTED-VERSION; integrity verification occurs only after structural, version, and canonicalization checks.
- **ERM-015.** ERR-STO-READONLY-FS MUST carry the phase-aware semantics of 18.1 (pre-publication / post-primary-publication / post-audit-publication); one static state tuple for all EROFS cases is prohibited.

## 19. Limits and Resource Bounds (W8A-C06)

**19.1 Complete limit profile (20 normative limits; count corrected W8A-R07).** The following table is normative. Hard maxima are contract-defined and MUST NOT be exceeded by trusted configuration. Trusted configuration MAY select defaults within the hard range. Request data MAY lower a limit but MUST NOT raise it. Repository content MUST NOT widen or select limits. Exact-limit behavior and limit-plus-one behavior are defined per limit; over-limit fails closed unless the class explicitly defines bounded truncation.

| Limit | Unit | Default | Hard min | Hard max | Source | Config-selectable | Request may lower | Request may raise | Exact limit | +1 | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `recordBytes` | bytes | 1 MiB | 1 KiB | 64 MiB | layout constant / config | within range | yes | no | accepted | fail closed | ERR-STO-LIMIT-EXCEEDED / truncation only where class defines it |
| `payloadBytes` | bytes | 512 KiB | 256 B | 16 MiB | layout constant / config | within range | yes | no | accepted | fail closed | record rejected at validation |
| `referencesPerRecord` | count | 64 | 1 | 1024 | layout constant / config | within range | yes | no | accepted | fail closed | record rejected |
| `pathComponentBytes` | bytes | 64 | 8 | 128 | layout constant | no | yes | no | accepted | fail closed | derivation rejected (LAY-007) |
| `pathBytes` | bytes | 512 | 64 | 1024 | layout constant | no | yes | no | accepted | fail closed | derivation rejected |
| `dirEntries` | entries | 4096 | 16 | 65536 | config | within range | yes | no | accepted | fail closed | enumeration bounded |
| `enumerationResults` | records | 1024 | 16 | 65536 | config | within range | yes | no | accepted | accepted | continuation |
| `auditEventsPerOperation` | events | 1 | 1 | 64 | config | within range | yes | no | accepted | fail closed | batch rejected |
| `recordsPerTransaction` | records | 1 | 1 | 64 | config | within range | yes | no | accepted | fail closed | batch rejected |
| `temporaryBytes` | bytes | 64 MiB | 1 MiB | 1 GiB | layout constant / config | within range | yes | no | accepted | fail closed | write aborted pre-publication |
| `totalScanEntries` | entries | 1 MiB | 1024 | 16 MiB | config | within range | yes | no | accepted | fail closed | scan truncated with evidence |
| `totalScanBytes` | bytes | 4 GiB | 16 MiB | 64 GiB | config | within range | yes | no | accepted | fail closed | scan truncated with evidence |
| `recoveryScanEntries` | entries | 1 MiB | 1024 | 16 MiB | config | within range | yes | no | accepted | fail closed | recovery fails closed |
| `retainedVersions` | versions | 1 | 1 | 256 | config | within range | yes | no | accepted | fail closed | older versions quarantined |
| `lockWait` | ms | 5000 | 100 | 120000 | config | within range | yes | no | accepted | fail closed | ERR-STO-LOCK-TIMEOUT |
| `operationTimeout` | ms | 30000 | 1000 | 300000 | config | within range | yes | no | accepted | fail closed | ERR-STO-TIMEOUT |
| `concurrentReaders` | readers | 16 | 1 | 64 | config | within range | yes | no | accepted | fail closed | read rejected |
| `writers` | writers | 1 | 1 | 1 | contract constant | no | no | no | n/a | n/a | ERR-STO-CONCURRENCY |
| `quarantineEntries` | entries | 4096 | 64 | 65536 | config | within range | yes | no | accepted | fail closed | quarantine full → recovery required |
| `indexRebuildWork` | entries | 1 MiB | 1024 | 16 MiB | config | within range | yes | no | accepted | fail closed | rebuild fails closed |

**19.2 Binding.** The complete selected limit profile MUST be bound to the trusted-configuration version, the trusted-configuration identity or digest, the store metadata, and the operation identity where relevant. A change in the selected profile changes the configuration version and invalidates previously issued mutation capabilities (CAP). Security hard maxima are contract-defined; no "implementation-selected" security limit exists.

### Limits requirements

- **LMT-001.** Every limit of 19.1 MUST have the defined default, hard minimum, hard maximum, source, and behavior; no unbounded operation exists.
- **LMT-002.** Request data MUST NOT raise any security limit; requests MAY lower limits.
- **LMT-003.** Repository content MUST NOT widen or select any limit.
- **LMT-004.** Over-limit behavior MUST fail closed except where the contract explicitly defines bounded truncation for the class.
- **LMT-005.** Exact-limit and limit-plus-one behavior MUST be defined per limit as in 19.1 and tested (TVR-G).
- **LMT-006.** Enumeration and recovery scans MUST be bounded and continue-able.
- **LMT-007.** Temporary bytes MUST be bounded; over-limit write fails closed before publication.
- **LMT-008.** Lock wait and operation timeouts MUST be bounded and fail closed on expiry.
- **LMT-009.** Retained versions per record identity MUST be bounded per class.
- **LMT-010.** Aggregate store scan bounds MUST apply to recovery and corruption detection.
- **LMT-011.** The selected limit profile MUST be bound to the trusted-configuration version and identity, store metadata, and operation identity.
- **LMT-012.** Security hard maxima MUST be contract-defined; implementation-selected security limits do not exist.
- **LMT-013.** Trusted configuration MAY select values only within the hard range; out-of-range selection fails configuration validation.

## 20. Internal API and Package Boundary

**20.1 Future internal module boundary (not implemented).** The later implementation exposes internal capability interfaces only: trusted-configuration input; read capability; authorized-write capability; verification capability; recovery capability; retention capability; result/error types; lifecycle (initialize/dispose) requirements.

**20.2 Boundary rules.** No package-root export; no public MCP tool registration; no adapter registration; no direct ChatGPT or Pi access; no ambient mutation authority; no raw filesystem path API for untrusted callers. WP-12 and later packages consume the internal read/verify/registry interfaces; the authorized-write interface is consumed only by the trusted control plane.

### API-boundary requirements

- **API-001.** WP-8 MUST NOT export anything from the package root; internal composition only.
- **API-002.** WP-8 MUST NOT register MCP tools, adapters, or public services.
- **API-003.** Internal interfaces MUST separate read, authorized-write, verify, recovery, and retention capabilities; no omnibus interface exists.
- **API-004.** The authorized-write capability MUST be consumable only by the trusted control plane; no other internal consumer may obtain it.
- **API-005.** Untrusted callers MUST NOT receive raw filesystem paths or path-based APIs.
- **API-006.** Result and error types MUST be closed unions with the ERR-STO-* codes (Section 18).
- **API-007.** No interface MAY expose ambient mutation authority; mutation requires an explicit authorized-write capability object (Section 21).
- **API-008.** WP-12 and later packages MAY consume the internal read, verify, registry-view, and audit interfaces.
- **API-009.** Interfaces MUST be disposal-aware; dispose MUST release locks, descriptors, and temporary state.
- **API-010.** Interface identity and versioning MUST follow the accepted internal-barrel conventions (WP-6 Phase 3, WP-7 INT-001/PKG-005 pattern).
- **API-011.** No direct ChatGPT or Pi access path exists in any interface.
- **API-012.** The trusted configuration input MUST be the accepted WP-6 genuine validated configuration; no other configuration source is accepted.

## 21. Authorized-Write Capability Model (W8A-C07)

**21.1 Capability set.** Separate opaque capabilities: initialization; authorized write; read; verification; recovery; retention; migration (later authorized). Mutation-capable capabilities are: initialization, authorized write, recovery, retention, migration (when authorized). Read and verification are non-mutating.

**21.2 Mutation-capable capability rules.** For every mutation-capable capability:

- trusted creation gate: creation requires a validated trusted-configuration snapshot, the store-instance identity, and an explicit control-plane request; there is no public constructor;
- trusted factory owner: the WP-8 store module owns the factory; the factory refuses creation without the gate;
- validated configuration prerequisite: the capability binds to the configuration snapshot version and identity and to the store-instance identity;
- operation-set binding: each capability binds the exact operation set it may perform;
- lifetime: bounded by the configuration snapshot validity and the store instance;
- possession boundary: in-process only; possession is explicit and non-transferable;
- transfer rule: capabilities MUST NOT be transferred between components or callers;
- serialization prohibition: capabilities MUST NOT be serializable (JSON, structured clone, or any byte form);
- worker/process boundary: capabilities MUST NOT cross worker or process boundaries; cross-process mutation is excluded from the MVP (normative);
- forgery resistance: no construction from JSON, paths, environment variables, PIDs, record bytes, repository content, or request data; the factory is the only creation path;
- revocation: disposal of the capability or replacement of the trusted-configuration snapshot invalidates previously issued mutation capabilities;
- use-after-dispose: any operation through a disposed capability fails closed;
- generation/nonce binding: each capability carries a generation nonce bound to the configuration snapshot and store instance;
- capture by consumers: consumers MUST NOT capture, store, or forward capabilities;
- logging and disclosure: capability identity MUST NOT appear in logs or diagnostics.

**21.3 Decision authority.** WP-12 or another later trusted control-plane package decides when to request capability creation; WP-8 validates the capability boundary but does not make lifecycle decisions.

### Capability requirements

- **CAP-001.** WP-8 MUST expose separate opaque capabilities for initialization, write, read, verification, recovery, retention, and migration (when authorized); no omnibus capability exists.
- **CAP-002.** Mutation-capable capabilities MUST have a trusted creation gate: validated configuration snapshot + store-instance identity + explicit control-plane request; no public constructor exists.
- **CAP-003.** The capability factory MUST refuse creation without the gate; no alternative creation path exists.
- **CAP-004.** Every mutation capability MUST bind the configuration snapshot version and identity, the store-instance identity, and its exact operation set.
- **CAP-005.** Capabilities MUST be in-process, non-transferable, and MUST NOT be serializable (JSON, structured clone, or byte forms).
- **CAP-006.** Capabilities MUST NOT cross worker or process boundaries; cross-process mutation is excluded from the MVP.
- **CAP-007 (corrected W8A-R05).** Scoped authenticity guarantee: within the supported Node.js runtime and the contract-defined module/export surface, no caller lacking a live module-private branded capability created by the gated factory may successfully invoke a mutation operation. The contract does not claim mathematical or host-wide impossibility; authenticity is guaranteed by the module boundary and the private-brand mechanism (CAP-014), and hostile construction channels are explicitly rejected (CAP-015).
- **CAP-008.** Disposal or trusted-configuration replacement MUST invalidate previously issued mutation capabilities. Mid-operation invalidation semantics are normative: at operation admission, the implementation validates and captures the module-private capability brand, capability generation, store-instance identity, validated configuration-snapshot identity, operation-set identity, selected limit-profile identity, and lifetime/disposal state; the operation remains semantically bound to those captured immutable inputs, and a later configuration update MUST NOT silently replace the configuration, limits, or authority operands of the in-flight operation.
- **CAP-009.** Use of a disposed or invalidated capability MUST fail closed. Capability validity MUST be rechecked at every contract-defined mutation boundary, including at minimum: before the first trusted-state mutation; immediately before primary publication; before required audit publication; and before reporting successful completion. If invalidation is detected before any trusted-state mutation, the operation MUST abort fail closed (trusted state changed: no; durability reached: no; ordinary success MUST NOT be reported; error: ERR-STO-REQ-INVALID, invalid capability operand). If invalidation is detected after primary publication or after any potentially durable mutation, the implementation MUST NOT fabricate rollback, MUST stop advancing except for contract-required containment, recovery, or evidence actions, MUST return the applicable phase-aware error (ERR-STO-DURABILITY class where state or durability is unknown), MUST report state and durability truthfully, and MUST require verification before retry; ordinary success MUST NOT be reported. If primary and audit state are already durable when invalidation is detected before acknowledgement, the durable state remains authoritative according to the existing record rules, the caller receives a phase-aware verify-before-retry result rather than ordinary success, and idempotent replay rules apply.
- **CAP-010.** Each capability MUST carry a generation nonce bound to the configuration snapshot and store instance; nonce mismatch fails closed.
- **CAP-011.** Consumers MUST NOT capture, store, or forward capabilities; capability identity MUST NOT appear in logs or diagnostics.
- **CAP-012.** WP-8 MUST NOT decide when to create capabilities; the trusted control plane requests creation.
- **CAP-013.** Cross-process mutation MUST be excluded from the MVP; the in-process capability model is normative and complete for a write-capable phase.
- **CAP-014.** Each capability MUST carry module-private authenticity state (a module-private `WeakSet`/`WeakMap`, private class field, closure-held token, or equivalent supported-runtime mechanism) that is not structurally representable by public object fields; generation MUST be bound to store-instance identity, validated configuration snapshot identity, operation-set identity, generation nonce, and lifetime state; every use MUST revalidate the private brand and all bindings. Disposal, configuration replacement, store-identity change, generation mismatch, operation-set mismatch, or private-brand failure MUST follow the mid-operation invalidation rule of CAP-008/009: invalidation never changes an in-flight operation to use newer configuration, never retroactively authorizes an operation, never invents rollback, never erases already durable state, and never permits a stale capability to begin a new mutation. Technical copying of the same authentic reference inside its owning trusted component does not bypass generation, lifetime, disposal, snapshot, operation-set, or store-instance checks.
- **CAP-015.** The following MUST be rejected as non-authentic at use (fail closed): plain structural objects, copied fields, forged prototypes, proxies, JSON parse results, structured clones, serialized/deserialized objects, worker messages, process messages, object-spread copies, reflection-created lookalikes, and captured stale references after disposal or configuration replacement.
- **CAP-016.** Reference copying of the same live authentic capability within the same trusted component is permitted by the runtime but forwarding beyond the owning trusted component is prohibited by contract; trusted consumers MUST NOT capture or store capabilities; ownership, disposal, and concurrency behavior follow CAP-008…011.

## 22. Audit Model

**22.1 Audited events.** Initialization; authorized write; idempotent duplicate; conflict; audited reads where required; integrity failure; tamper detection; recovery; recovery-audit reconstruction; retention; deletion; lock recovery; configuration change; format migration.

**22.2 Semantics.** Audit events are immutable; ordered; linked to the audited record; digest-bound; durable with the same durability point as the operation; audit failure fails the operation (no silent drop); disclosure-bounded; retention per class. Audit events record evidence, not authority.

### Audit requirements

- **AUD-001.** Every event class of 22.1 MUST produce an audit event.
- **AUD-002.** Audit events MUST be immutable, ordered, and linked to the audited record or action.
- **AUD-003.** Audit events MUST be digest-bound and durable at the operation's durability point.
- **AUD-004.** Audit failure MUST fail the operation; audit events MUST NOT be silently dropped.
- **AUD-005.** Audit events MUST record evidence (who/what/when/binding) and MUST NOT grant authority.
- **AUD-006.** Audit disclosure MUST be bounded; no sensitive payload, trusted root path, capability identity, or lock nonce in audit diagnostics.
- **AUD-007.** Audit retention MUST follow the audit retention class; audit events MUST NOT be deleted by the action they record.
- **AUD-008.** Lock recovery and stale-lock breaking MUST produce audit evidence.
- **AUD-009.** Format migration MUST produce audit evidence covering the migration (VRS).
- **AUD-010.** Reads are unaudited by default; audited-read requirements, where configured, MUST NOT weaken ordering or durability.
- **AUD-011.** Recovery-generated audit events MUST use the distinct kind `recovery-audit-reconstruction` and MUST be visibly distinguishable from original operation events (CSA-013).
- **AUD-012.** Recovery-generated audit events MUST NOT imply that the original operation emitted the event; the recovery action identity and recovery time are recorded.
- **AUD-013.** Audit-stage failures (audit creation, audit publication, audit-directory sync) MUST be distinguished per 10.5: primary state may be durable while audit state is absent or partial; recovery completes or reconstructs with evidence; success is never reported with incomplete audit state.

## 23. Versioning and Migration

**23.1 Versions.** Store format version per namespace (layout, `config-v1`/`store-v1`); record format versions per class; supported-version set; unknown-version behavior (fail closed). Read compatibility within the supported set; write compatibility only at the current version. The path encoding and shard algorithm are bound to the layout version (LAY-006).

**23.2 Migration.** Upgrade authorization is human; migration planning, atomicity, rollback, partial-migration, and downgrade behavior are defined before any migration runs; original records are preserved (migration produces new records — WP-2 `MigrationRecord` semantics); migration produces audit evidence and `migration-evidence`. Automatic destructive migration is prohibited.

### Versioning requirements

- **VRS-001.** Store and record format versions MUST be explicit and recorded in metadata and every record.
- **VRS-002.** Unknown or unsupported versions MUST fail closed on open, read, and write.
- **VRS-003.** Reads MUST be supported for the accepted version set; writes MUST occur only at the current version.
- **VRS-004.** Upgrade authorization MUST be human; no automatic version upgrade exists.
- **VRS-005.** Migration MUST preserve original records; migration produces new records with explicit correlation (WP-2 `MigrationRecord`) and `migration-evidence`.
- **VRS-006.** Migration MUST be atomic or explicitly staged with rollback defined before execution.
- **VRS-007.** Partial migration MUST be detectable and MUST fail closed until resolved.
- **VRS-008.** Downgrade behavior MUST be defined and MUST NOT reinterpret records created at a newer version.
- **VRS-009.** Migration MUST produce audit evidence.
- **VRS-010.** Automatic destructive migration is prohibited.

## 24. Determinism

**24.1 Deterministic behavior.** Path derivation; record encoding; digest computation; enumeration order; registry derivation; conflict reporting; recovery ordering; audit ordering; error precedence; retry/idempotency results. Host filesystem order nondeterminism is neutralized by explicit ordering (sort by logical sequence and identity).

### Determinism requirements

- **DTM-001.** Path derivation MUST be deterministic (LAY).
- **DTM-002.** Record encoding and digest computation MUST be deterministic (RFM).
- **DTM-003.** Enumeration, registry derivation, recovery, and audit ordering MUST be deterministic; host directory order MUST NOT influence results.
- **DTM-004.** Conflict and error reporting MUST have deterministic precedence (Section 18.2).
- **DTM-005.** Retry and idempotency MUST produce deterministic outcomes per class.
- **DTM-006.** Generated layout and record bytes MUST be reproducible on the supported lane (TVR-H).
- **DTM-007.** No clock-derived value MAY affect digest or identity; timestamps are logical record data only.
- **DTM-008.** Determinism MUST be verified by repeat-generation tests (TVR-H).

## 25. Security Requirements

**25.1 Consolidated security properties.** Repository forgery resistance; trusted-root isolation; path containment; symlink/replacement resistance; special-file rejection; atomicity; crash safety; tamper detection (with the documented limitations of Section 9); unauthorized-write rejection; least authority; bounded reads/writes; disclosure control; dependency boundary; internal-only API; no execution; no public export; no approval/issuance decisions; no ambient credentials; no network in the MVP.

### Security requirements

- **SRE-001.** The store MUST resist repository forgery: no repository content can create, modify, or emulate trusted records (SCP, TAU, ITG).
- **SRE-002.** Trusted-root isolation MUST hold against request, repository, and workspace material (SRX, FSP, CSR).
- **SRE-003.** Path containment MUST hold for every operation (FSP).
- **SRE-004.** Symlink and replacement attacks MUST fail closed (FSP, SRX).
- **SRE-005.** Special files MUST be rejected (FSP-005).
- **SRE-006.** Atomicity and crash safety MUST hold per WPR/CSA.
- **SRE-007.** Tamper detection MUST fail closed within the documented guarantee (ITG, TML).
- **SRE-008.** Unauthorized writes MUST be rejected (TAU, CAP, WPR).
- **SRE-009.** Least authority MUST hold: each interface exposes only its capability (API, CAP).
- **SRE-010.** Reads and writes MUST be bounded (LMT).
- **SRE-011.** Disclosure control MUST hold on every surface (ERM, RDS, AUD, FSP, CAP).
- **SRE-012.** The dependency boundary MUST remain the accepted dependency set; WP-8 implementation MUST NOT add dependencies without human authorization (TVR-A).
- **SRE-013.** WP-8 MUST NOT execute anything, spawn processes, or invoke Git (SCP-006).
- **SRE-014.** WP-8 MUST NOT hold ambient credentials or signing material (TAU-003, ITG-009).
- **SRE-015.** WP-8 MUST NOT require network access in the MVP (SCP-008).

## 26. Test and Verification Contract (W8A-C12)

**26.1 Required categories for later implementation phases.**

- **A. Contract and static tests:** requirement inventory; error mapping and precedence; operation inventory; path-layout inventory (including encoding test vectors, Appendix H); record-kind inventory; package/public-boundary checks; dependency checks; capability-boundary checks.
- **B. Storage behavior:** create; exact read; idempotent retry; duplicate; conflict; enumerate; rebuild; retention execution; recovery; configuration-store persistence.
- **C. Durability and crash injection:** failure at every write stage; fsync failure; link failure; unlink failure; directory-sync failure; process termination; stale temporary files; stale locks; index interruption.
- **D. Path and filesystem hostility:** traversal; symlink; parent replacement; root replacement; hard-link scenarios; FIFO; socket; device; permission denial; mount/device identity drift; ACL effective-grant denial.
- **E. Integrity and tamper:** byte modification; deletion; insertion; reordering; duplicate identifiers; conflicting revisions; broken chain; stale index; unsupported version; malformed canonical bytes; negative tests for the rollback-resistance limitation (TML).
- **F. Concurrency:** concurrent readers; concurrent writer attempts; lock contention; writer crash; reboot-simulated stale lock; liveness-undeterminable lock; cancellation; timeout; PID-reuse-relevant scenarios.
- **G. Limits:** exact boundary; boundary plus one; aggregate limits; recovery-scan limits; enumeration limits; capacity/quota/read-only injection.
- **H. Compatibility and determinism:** repeatable layout; repeatable bytes; repeatable digest; deterministic ordering; supported Linux/Node/filesystem lane; explicit unsupported-lane failure; encoding test vectors.
- **I. Mutation evidence:** trusted store; project workspace; HOME; TMPDIR; unrelated repositories; package/runtime source — future tests MUST prove that only the trusted store changes during an authorized storage mutation.

**26.2 Matrix completeness.** Appendix E maps every normative requirement to at least one acceptance category or explicitly named static verification. The mapping is verified mechanically at review: no requirement is orphaned; no matrix row references a nonexistent requirement; every operation has behavior, error, security, and mutation tests; every prohibited responsibility has a boundary test; every deferred feature has a gate test preventing premature use.

### Test-contract requirements

- **TVR-001.** Later phases MUST provide the test categories A–I of 26.1 with per-category requirement mapping.
- **TVR-002.** Crash injection MUST cover every write stage of CSA-001…005 including link, unlink, and directory-sync stages.
- **TVR-003.** Tamper tests MUST cover every detection class of ITG and MUST fail closed; negative tests MUST document the rollback-resistance limitation (TML-008).
- **TVR-004.** Containment tests MUST cover every FSP invariant on the supported lane, including ACL effective-grant denial.
- **TVR-005.** Concurrency tests MUST prove single-writer enforcement, reader safety, stale-lock classification, and liveness-undeterminable behavior.
- **TVR-006.** Limit tests MUST cover exact-limit and limit-plus-one behavior for every limit of 19.1.
- **TVR-007.** Determinism tests MUST prove repeatable layout, bytes, and digest across runs.
- **TVR-008.** Unsupported-lane and unsupported-filesystem behavior MUST be explicitly tested (fail-closed initialization, FSL).
- **TVR-009.** Mutation-evidence tests MUST prove only the trusted store changes during an authorized storage mutation (workspace/HOME/TMPDIR/unrelated repos/runtime source unchanged).
- **TVR-010.** Package and public-boundary checks MUST prove zero package-root exports and zero registrations.
- **TVR-011.** Dependency checks MUST prove the accepted dependency set is unchanged.
- **TVR-012.** The test lifecycle MUST integrate into the repository default verification workflow without weakening the accepted WP-7 lifecycle.
- **TVR-013.** The acceptance matrix (Appendix E) MUST be mechanically verified complete: no orphaned requirement, no nonexistent reference, and every prohibited responsibility and deferred feature has a boundary/gate test.
- **TVR-014.** Capability tests MUST cover every hostile construction channel of CAP-015 (plain objects, copied fields, forged prototypes, proxies, JSON, structured clones, serialization, worker/process messages, spread, reflection lookalikes, stale references) plus use-after-disposal and use-after-configuration-replacement, and MUST exercise mid-operation invalidation at each mutation boundary of CAP-009 (before first mutation, before primary publication, before audit publication, before success acknowledgement) asserting the phase-aware outcomes.
- **TVR-015.** Permission tests MUST verify effective modes and owner on the supported lane, including a default-ACL/inherited-effective-access scenario proving descriptor-bound final-mode verification rejects inherited access, and the fail-closed path when effective policy cannot be established.

## 27. Completion Evidence

**27.1 WP-8 closure evidence.** Before WP-8 can close, later phases must provide: accepted contract (this document, as corrected); implementation review; correction cycle if required; focused tests; crash-injection evidence; tamper tests; containment tests; concurrency tests; deterministic generation where applicable; regression and conformance results; public/package-boundary verification; dependency audit; closure report; clean Git state; separately authorized baseline and closure commits.

### Completion requirements

- **CLE-001.** WP-8 closure requires an accepted implementation contract revision review against this contract.
- **CLE-002.** WP-8 closure requires the full test evidence of TVR categories A–I with zero open findings.
- **CLE-003.** WP-8 closure requires crash-injection, tamper, containment, and concurrency evidence.
- **CLE-004.** WP-8 closure requires regression and conformance green on the accepted verification lifecycle.
- **CLE-005.** WP-8 closure requires package/public-boundary and dependency audit evidence.
- **CLE-006.** WP-8 closure requires a closure report and clean Git state.
- **CLE-007.** WP-8 closure requires separately authorized baseline and closure commits; no implicit closure.
- **CLE-008.** WP-8 implementation phases MUST NOT claim closure without satisfying CLE-001…007.

## 28. Decision Register (corrected)

| ID | Question | Resolution | Rationale / inputs | Implementation consequence | Test consequence | Reopen gate |
|---|---|---|---|---|---|---|
| DS-01 | Single vs multi writer | **Single trusted writer (MVP, normative)** | TAU separation; LOK-001 | writer lock; exclusive create; hard-link publication | F-concurrency tests | human authorization |
| DS-02 | Immutable source records | **Yes — append-only source records** | WP-2 model; ADR-002 | hard-link publication; no in-place update | B/E tests | human authorization |
| DS-03 | Derived registry indexes | **Yes — rebuildable derivatives, never authoritative** | RGY | index rebuild path | B rebuild tests | human authorization |
| DS-04 | Store layout versioning | **Versioned namespaces `config-v1`/`store-v1`; encoding version-bound** | VRS; LAY-006 | layout constants; encoding module | H determinism tests | human authorization |
| DS-05 | Record encoding | **Envelope + accepted JCS canonicalization; additive profiles only** | WP-2…WP-4; RFM | canonical-bytes pipeline | E tamper/malformed tests | human authorization |
| DS-06 | Digest profile | **SHA-256 (`sha-256:<64-hex>`), record + chain + metadata digests** | WP-2 syntax; ITG | digest verification | E tests | human authorization |
| DS-07 | Signing requirement | **DEFERRED — no signing in MVP; extension point for signed checkpoints; no authorship or rollback claim** | ITG-008/009; TML | integrity without authenticity or rollback resistance | E/TML negative tests | human authorization |
| DS-08 | Transaction boundary | **One record per atomic unit; ordered sequences; no cross-record rollback in MVP** | WPR-013 | publication pipeline | C crash injection | contract revision |
| DS-09 | Durability point | **Temp fsync + hard link + final-directory fsync + temp unlink + tmp-directory fsync + audit publish/sync before success (corrected W8A-R02)** | WPR-008/021/022; W8A-R02 | staged sync ordering | C tests | human authorization |
| DS-10 | Lock model | **Whole-store lock; fixed path; nonce+start-time+boot identity; stale only on confirmed dead writer; explicit recovery authority** | LOK; W8A-C05 | lock module | F tests | contract revision |
| DS-11 | Recovery model | **Namespace-scoped: quarantine, roll-forward complete publications, rebuild indexes, re-verify, reconstruct missing audit with distinct evidence; never decide** | CSA; TAU-009; W8A-C11 | recovery scanner | C/D tests | human authorization |
| DS-12 | Retention authority | **Control-plane trusted configuration; WP-8 executes only; holds supported** | RNT | retention executor | B retention tests | human authorization |
| DS-13 | Migration authority | **DEFERRED — human-authorized; original records preserved; no automatic destructive migration** | VRS-004/005/010 | none in MVP | H version tests | human authorization |
| DS-14 | Audit ordering | **Audit append at the operation durability point; immutable; linked; digest-bound; recovery reconstruction distinct** | AUD; CSA-013 | audit pipeline | C audit tests | human authorization |
| DS-15 | Public/internal boundary | **Internal-only barrel; zero package-root exports; no registrations** | API; WP-7 PKG-005 pattern | internal barrel | A boundary tests | human authorization |
| DS-16 | Dependency policy | **No dependency additions without human authorization; ajv-only accepted set** | SRE-012 | package manifest | A dependency checks | human authorization |
| DS-17 | Multi-record atomic transactions | **DEFERRED — not in MVP; requires contract revision** | WPR-013 | none in MVP | none in MVP | contract revision |
| DS-18 | Trusted action identity and authentication | **In-process capability construction, possession, non-transferability, revocation normative; authenticity scoped to the supported runtime and module boundary (private-brand mechanism); mid-operation invalidation per CAP-008/009; external authentication/cross-process attestation deferred; cross-process mutation excluded from MVP** | TAU; CAP; W8A-C07; W8A-R05; W8A-F04 | branded capability object | A/F hostile-channel + invalidation-boundary tests | human authorization |
| DS-19 | Configuration-store bootstrap | **Trusted host/control-plane bootstrap locator; `config-v1` and `store-v1` sibling namespaces under one trusted parent; no circular trust** | ADR-024; CSR; W8A-C01 | two-namespace substrate | B/C tests | human authorization |
| DS-20 | Root permission policy | **Trusted service UID; dirs 0700, files 0600; no group/other write; ACL write-grant unsupported; no config relaxation** | SRX-006…009; W8A-C02 | permission enforcement | D tests | contract-version change |
| DS-21 | Publication primitive | **Hard-link publication with no-replace semantics; EEXIST verification; rename prohibited for immutable records** | WPR; W8A-C03 | link-based publisher | C/E tests | contract revision |
| DS-22 | Filesystem compatibility | **Explicit init probe; same-device, hard link, dir/file fsync, O_EXCL, no-follow, case-sensitivity; dedicated FS error codes** | FSL; W8A-C04 | compatibility probe | H tests | human authorization |
| DS-23 | Limit profile | **Complete normative table; hard maxima contract-defined; config selects within range; profile bound to config version/identity + store metadata** | LMT; W8A-C06 | limits module | G tests | contract revision |
| DS-24 | Write-capability model | **Opaque gated capabilities; in-process; non-transferable; non-serializable; revoked by disposal/config replacement** | CAP; W8A-C07 | capability factory | A/F tests | human authorization |
| DS-25 | Path encoding | **Parse and validate the canonical WP-2 typed identifier; extract its exactly 32-character lowercase hexadecimal opaque component verbatim; derive the shard from the first four opaque characters; bind the algorithm and vectors to the layout version** | LAY-003…006; W8A-C08; W8A-R01 | encoding module | H vectors | new layout version + migration |
| DS-26 | Evidence taxonomy | **One `StoreEvidenceRecord` class with closed `evidenceKind` discriminator** | TAX-008/013; W8A-C09 | evidence records | B/E tests | human authorization |
| DS-27 | Rollback anchor | **DEFERRED — no anchor in MVP; signed checkpoints / external monotonic counters / protected anchors are extension points; no rollback-resistance claim** | TML; W8A-C10 | none in MVP | TML negative tests | human authorization |
| DS-28 | Recovery-audit reconstruction | **Distinct `recovery-audit-reconstruction` kind; gap marker; recovery-time timestamp; idempotent; never implies original emission** | CSA-013/014; AUD-011/012; W8A-C11 | recovery audit writer | C tests | human authorization |
| DS-29 | Configuration update/current-selection model | **Append-only immutable configuration version records; unique verified chain head with highest valid revision; WP-8 derives structure, never policy acceptance** | CSR-011…016; W8A-R03 | configuration chain module | B/C tests | human authorization |

### Decision-register requirements

- **DCS-001.** The decisions of §28 MUST bind later implementation phases unless reopened by the stated authority.
- **DCS-002.** Deferred decisions (DS-07, DS-13, DS-17, DS-18 authentication portion, DS-27) MUST NOT be resolved by implementation; each requires human authorization.
- **DCS-003.** No implementation-critical decision remains ambiguous **within an explicitly phase-bounded implementation** (Section 29): every §28 row is resolved or explicitly deferred with an owner and gate, and the future phase decomposition states which deferred decisions must close before which phase.
- **DCS-004.** Reopening any §28 decision MUST require the stated human authorization and a recorded rationale.
- **DCS-005.** The decision register MUST be maintained in the foundation report's decision inventory and re-audited at each later WP-8 phase.
- **DCS-006.** A deferred decision MUST NOT be implemented by implication or convenience.
- **DCS-007.** If a later phase determines a §28 resolution is unsafe, it MUST stop and request reopening; it MUST NOT silently deviate.
- **DCS-008.** The decision register is authoritative planning; it does not authorize implementation.

## 29. Future Phase Decomposition (informative planning; not authorized)

The following sequence is recommended for later human authorization. No phase identifier is created by this contract; no phase is authorized by this contract. Each phase requires its own human authorization and review gate.

1. **Non-mutating format and validation foundation.** Prerequisites: this contract accepted; DS-05/06/25 resolved (done). Owned: record envelope, canonicalization, digest, path-encoding, taxonomy validation, error types — all non-mutating. Prohibited: any write, lock, or persistence. Deferred decisions that must be closed first: none (DS-07/13/17/27 do not gate a non-mutating phase). Gate: focused review.
2. **Trusted-root and configuration-store bootstrap.** Prerequisites: phase 1; DS-19/20/22 resolved (done). Owned: root resolution, permission policy enforcement, compatibility probe, `config-v1` namespace, initialization. Clarification (W8A-R08/I): this phase MAY define and validate configuration record formats and bootstrap/root identities, and MAY create and verify empty versioned namespaces and metadata ONLY if explicitly authorized for this phase; it MUST NOT publish any persistent configuration record — seeding or publishing the first immutable configuration version belongs to the durable publication phase (phase 3) or a later separately authorized phase, because publication requires the durable publication substrate. Prohibited: lifecycle-record writes AND persistent configuration-record publication. Deferred decisions that must be closed first: DS-18 (in-process capability model is already normative; only external authentication remains deferred). Gate: review.
3. **Durable single-record publication and exact reads.** Prerequisites: phases 1–2; DS-01/02/08/09/10/21 resolved (done). Owned: hard-link publication, writer lock, exact read/verify, capability factory (write/read), durability. Prohibited: registry derivation, retention, migration. Deferred decisions that must be closed first: none. Gate: review + crash-injection evidence.
4. **Audit, registry indexes, and recovery.** Prerequisites: phase 3; DS-03/11/14/26/28 resolved (done). Owned: audit pipeline, index rebuild, registry views, recovery scanner, recovery-audit reconstruction, quarantine. Prohibited: retention execution, migration. Deferred decisions that must be closed first: DS-27 stays deferred (recovery operates within documented limits). Gate: review + tamper/recovery evidence.
5. **Retention and later migrations.** Prerequisites: phase 4; DS-12 resolved (done); DS-13 (migration) MUST be explicitly authorized before migration work. Owned: retention execution, holds, migration (only after DS-13 authorization). Prohibited: lifecycle decisions. Deferred decisions that must be closed first: DS-13; DS-27 only if migration must claim rollback resistance. Gate: review.
6. **Integration and closure.** Prerequisites: phases 1–5. Owned: internal-barrel integration with WP-12 consumers, verification-lifecycle integration, closure evidence (CLE). Prohibited: anything outside the accepted contract. Gate: WP-8 closure review + separately authorized closure commit.

### Future-phase requirements

- **FPH-001.** No future phase MAY begin without its own human authorization; this contract authorizes none.
- **FPH-002.** Each phase MUST satisfy its stated prerequisites and MUST NOT implement areas listed as prohibited for it.
- **FPH-003.** A phase MUST NOT implement a deferred decision before the decision's stated gate closes it.
- **FPH-004.** The decomposition is informative planning; the human authorization for any phase MAY restructure it with a recorded rationale.
- **FPH-005.** Persistent configuration-record publication (including seeding the first immutable configuration version) MUST NOT occur before the durable publication phase is implemented and accepted; a non-mutating or bootstrap phase may define and validate formats and identities only.

---

## Appendix A — Requirement Inventory by Prefix

| Prefix | Area | Count |
|---|---|---|
| SCP | Scope and non-goals | 10 |
| TAU | Trust and authority model | 10 |
| CSR | Configuration store and bootstrap | 16 |
| SRX | Trusted store root | 15 |
| LAY | Directory layout | 14 |
| TAX | Record taxonomy | 14 |
| RFM | Record format | 14 |
| ITG | Integrity and tamper evidence | 12 |
| TML | Tamper-evidence limitations | 8 |
| WPR | Write protocol | 23 |
| FSL | Filesystem compatibility lane | 10 |
| LOK | Concurrency and locking | 18 |
| RDS | Read and enumeration semantics | 12 |
| RGY | Registry semantics | 10 |
| RNT | Retention and deletion | 10 |
| CSA | Crash safety and recovery | 15 |
| FSP | Path containment and filesystem safety | 15 |
| ERM | Failure and error model | 15 |
| LMT | Limits and resource bounds | 13 |
| API | Internal API and package boundary | 12 |
| CAP | Authorized-write capability model | 16 |
| AUD | Audit model | 13 |
| VRS | Versioning and migration | 10 |
| DTM | Determinism | 8 |
| SRE | Security requirements | 15 |
| TVR | Test and verification contract | 15 |
| CLE | Completion evidence | 8 |
| DCS | Decision register | 8 |
| FPH | Future phase decomposition | 5 |

**Total: 364 normative requirements.**

## Appendix B — Operation-to-Requirement Matrix

| Operation | Primary requirements |
|---|---|
| Initialize (incl. compatibility probe, config namespace) | SRX-001…015, LAY-001/002, CSR-001…016, FSL-001…010, CSA-006, AUD-001, VRS-002 |
| Authorized write | WPR-001…023, TAU-002…005/007, RFM-001…014, LOK-001/004…015, CAP-001…016, AUD-002/003, CSA-001…005, ERM-010…013 |
| Read by identity | RDS-001/002/008/009/012, ITG-001…004, ERM |
| Verify by identity | RDS-003, ITG-001…006, ERM |
| Enumerate class | RDS-004/008/009, LMT-006/010, DTM-003 |
| Resolve registry state | RDS-005, RGY-001…010, DTM-003 |
| Inspect audit history | RDS-006/008, AUD-002…007 |
| Detect corruption | RDS-007, ITG-004/005, LMT-010, TML-007 |
| Recovery scan | CSA-001…015, RDS-007, AUD-008/011/012, ITG-004, TML-006/007 |
| Retention execution | RNT-001…010, AUD-004, LMT-004, TAX-008 |
| Format verification | LAY-002, VRS-001…003, ITG-011, FSL-010 |
| Migration (future) | VRS-004…010, AUD-009, TAX-008, FPH-001…005 |

## Appendix C — Error Condition-to-Code Matrix

Normative mapping in §18.1: 31 codes, deterministic many-to-one condition mapping, per-code phase/retryability/recovery/state/durability/audit/verify semantics with phase-aware rows where required (ERR-STO-READONLY-FS). Completeness, precedence, and malformed-versus-version classification normative (ERM-001…015). Mid-operation capability invalidation maps to existing codes: ERR-STO-REQ-INVALID before any mutation; ERR-STO-DURABILITY class (verify-required) after primary publication or potentially durable mutation (CAP-009); no new code is required.

## Appendix D — Security-Property Matrix

| Property | Requirements |
|---|---|
| Repository forgery resistance | SCP-001/002, TAU-008, SRE-001 |
| Trusted-root isolation | SRX-001…015, CSR-001…016, SRE-002 |
| Path containment | FSP-001…015, SRE-003 |
| Symlink/replacement resistance | FSP-003/004, SRX-005/010, SRE-004 |
| Special-file rejection | FSP-005, SRE-005 |
| Atomicity | WPR-003…007, SRE-006 |
| Crash safety | CSA-001…015, SRE-006 |
| Tamper detection (documented limits) | ITG-001…012, TML-001…008, SRE-007 |
| Unauthorized-write rejection | TAU-002…005/007, CAP-001…016, SRE-008 |
| Least authority | API-003/004/007, CAP-002…012, SRE-009 |
| Bounded operations | LMT-001…013, SRE-010 |
| Disclosure control | ERM-004, RDS-012, AUD-006, FSP-010, CAP-011, SRE-011 |
| Dependency boundary | SRE-012, TVR-011 |
| Internal-only API | API-001…012, SRE-013…015 |
| No execution | SCP-006, SRE-013 |
| No approval/issuance decisions | SCP-010, TAU-008/009, SRE-001 |
| No ambient credentials | TAU-003, ITG-009, CAP-007, SRE-014 |
| No network | SCP-008, SRE-015 |

## Appendix E — Test-Acceptance Matrix (complete)

Every prefix maps to categories; each row's test obligation applies to every requirement in that prefix range. Static checks named explicitly where no runtime category applies.

| Requirements | Acceptance categories |
|---|---|
| SCP-001…010 | A (boundary/static), I (mutation) |
| TAU-001…010 | A (static), F (concurrency/capability) |
| CSR-001…016 | A (static), B (config-store behavior), C (crash), D (containment) |
| SRX-001…015 | A (static), D (hostility), H (lane) |
| LAY-001…014 | A (inventory), H (determinism/vectors), D (containment) |
| TAX-001…014 | A (inventory), B (enumeration), E (integrity) |
| RFM-001…014 | A (static), E (tamper/malformed), H (determinism) |
| ITG-001…012 | E (integrity/tamper), B (verify) |
| TML-001…008 | E (negative tamper-limitation tests), A (documentation claims) |
| WPR-001…023 | B (storage behavior), C (crash injection), E (duplicate/conflict), G (limits) |
| FSL-001…010 | H (lane), C (fsync/link failure), G (capacity/quota injection) |
| LOK-001…018 | F (concurrency/locks), C (writer crash), D (lock hostility) |
| RDS-001…012 | B (reads), E (verify), G (enumeration limits) |
| RGY-001…010 | B (registry derivation/rebuild), E (stale views) |
| RNT-001…010 | B (retention execution), A (authority static), E (deletion evidence) |
| CSA-001…015 | C (crash injection), D (recovery hostility), B (recovery behavior) |
| FSP-001…015 | D (path/filesystem hostility), B (publication) |
| ERM-001…015 | A (error mapping/precedence static), B/E/G (mapped failures) |
| LMT-001…013 | G (limits), A (profile binding static) |
| API-001…012 | A (boundary static), I (mutation evidence) |
| CAP-001…016 | A (capability static), F (concurrency/possession), I (mutation), E (mid-operation invalidation phase outcomes) |
| AUD-001…013 | B (audit behavior), C (audit durability), E (audit integrity) |
| VRS-001…010 | H (version compatibility), B (unsupported-version) |
| DTM-001…008 | H (determinism/repeat generation) |
| SRE-001…015 | A (static), D/E/F/G/I (per-property) |
| TVR-001…015 | A (matrix completeness verification), H (lifecycle integration) |
| CLE-001…008 | A (closure-gate static), H (regression) |
| DCS-001…008 | A (decision-register static), H (phase gating) |
| FPH-001…005 | A (phase-gate static) |

Every requirement appears in at least one row; every row references only existing requirements; operation behavior/error/security/mutation coverage is complete (TVR-013 verifies mechanically at review).

## Appendix F — Ownership/Responsibility Matrix

| Responsibility | Owner |
|---|---|
| Lifecycle decisions (approval/issuance/revocation/grant/activation) | Trusted control plane (WP-12), WP-2 semantics |
| Persisted record formats and layout (both namespaces) | WP-8 (this contract) |
| Trusted configuration-store persistence | WP-8 (ADR-024), semantics WP-6 |
| Durability, crash safety, containment of the store | WP-8 |
| Retention policy decisions | Trusted control plane via trusted configuration |
| Retention execution | WP-8 (authorized actions only) |
| Registry snapshot semantics | WP-2; persisted form WP-8 |
| Validation/eligibility evaluation | Artifact Core (WP-4) |
| Enforcement projection | WP-5B (later) |
| MCP inspection surface | WP-9 (later) |
| Drafting/writing | WP-10/WP-11 (later), WP-1 producer boundary |
| Execution | WP-13 (later) |
| Bootstrap locator provision | Trusted host/control plane |

## Appendix G — Open Decision Inventory

| ID | Question | Status | Owner | Later gate |
|---|---|---|---|---|
| DS-07 | Signing mechanism | Deferred | Human authorization | Pre-implementation of authenticity |
| DS-13 | Migration authorization | Deferred | Human authorization | Before any migration work (phase 5) |
| DS-17 | Multi-record atomic transactions | Deferred | Contract revision | Before any batch-atomic feature |
| DS-18 | External authentication / cross-process attestation | Deferred (in-process capability model normative) | Human authorization | Before any cross-process mutation phase |
| DS-27 | Rollback anchor (signed checkpoints / monotonic counters / protected anchors) | Deferred | Human authorization | Before any rollback-resistance claim |
| OD-001 | Exact trusted-local parent-directory convention (e.g., XDG state) | **Resolved — explicit control-plane locator only; no WP-8 host default** (human decision; ADR-028): the trusted control plane supplies one already-resolved absolute parent locator; WP-8 defines no default trusted-parent path and derives the locator from no environment variable, argv value, working directory, request value, repository file, artifact, or WP-8 record (CSR-001 unchanged); the trusted parent pre-exists, is owned by the configured trusted service UID with mode `0700`, and is never created, chowned, or replaced by WP-8; WP-8 derives only `config-v1/` and `store-v1/` beneath it; the locator alone grants no mutation authority | Human decision; WP-8 implementation phase (phase 2) | None — closed at implementation authorization |
| OD-002 | Lock-file layout details | RESOLVED (normative lock record fields, LOK-005) | — | — |
| OD-003 | Retention-policy configuration format | Open, non-blocking (authority normative) | WP-12/WP-8 (phase 5) | At retention implementation |

No open decision blocks the phase-bounded implementation sequence of §29; every deferred decision has an owner and gate, and phase 1 (non-mutating foundation) is fully unblocked.

## Appendix H — Path-Encoding Test Vectors (normative, corrected W8A-R01)

Model: parse the canonical WP-2 identifier; extract the opaque lowercase-hex component (exactly 32 characters) verbatim; shard = first 4 characters; filename = `<component>.rec`; record kind/class in the parent namespace only. Encoded filename length is exactly 36 characters and MUST fit within `pathComponentBytes` (default 64, hard maximum 128).

| Case | Identifier | Extracted component | Shard | Record-relative path (class `approval`) |
|---|---|---|---|---|
| Minimum valid (all-zero identity) | `pgw:r:00000000000000000000000000000000` | `00000000000000000000000000000000` | `0000` | `records/approval/0000/00000000000000000000000000000000.rec` |
| Representative record identifier | `pgw:r:0123456789abcdef0123456789abcdef` | `0123456789abcdef0123456789abcdef` | `0123` | `records/approval/0123/0123456789abcdef0123456789abcdef.rec` |
| Maximum-length valid (32 hex chars by grammar) | `pgw:r:ffffffffffffffffffffffffffffffff` | `ffffffffffffffffffffffffffffffff` | `ffff` | `records/approval/ffff/ffffffffffffffffffffffffffffffff.rec` |
| Leading-zero identity | `pgw:r:00112233445566778899aabbccddeeff` | `00112233445566778899aabbccddeeff` | `0011` | `records/approval/0011/00112233445566778899aabbccddeeff.rec` |

| Rejection vector | Identifier | Behavior |
|---|---|---|
| Uppercase rejection | `pgw:r:0123456789ABCDEF0123456789ABCDEF` | rejected before derivation (non-lowercase component) |
| Invalid character | `pgw:r:0123456789abcdef0123456789abcdeg` | rejected (non-hex character `g`) |
| Wrong prefix | `pgw:x:0123456789abcdef0123456789abcdef` | rejected (unaccepted type prefix) |
| Too-short identity | `pgw:r:0123456789abcdef0123456789abcd` | rejected (component length 30 ≠ 32) |
| Too-long identity | `pgw:r:0123456789abcdef0123456789abcdef01` | rejected (component length 34 ≠ 32) |
| Empty component | `pgw:r:` | rejected (empty-value) |
| Non-NFC / non-ASCII input | (any non-NFC identifier) | rejected by the accepted identity rules before derivation |

Shard check: for `pgw:r:abcdef0123456789abcdef0123456789`, component = `abcdef0123456789abcdef0123456789`, shard = `abcd`, record-relative path = `records/<class>/abcd/abcdef0123456789abcdef0123456789.rec`. A record placed under any shard other than the derived shard fails verification (ITG-003).

---

**End of WP-8 contract (second corrected version).**
