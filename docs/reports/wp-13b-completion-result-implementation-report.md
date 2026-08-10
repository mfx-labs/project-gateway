# WP-13B — Completion & Result Implementation Report

**Work package:** WP-13B — completion evaluation and ExecutionResult production
(slice B of WP-13; no publication/retrospective-facts work).
**Status:** implementation complete; focused corrections SIR-WP13B-001…005
APPLIED (see §12), residual SIR-WP13B-002 FIFO recovery defect CLOSED, and
final focused rereview **ACCEPTED** (SIR-WP13B-001…005 all CLOSED; verdict
`WP-13B FINAL FOCUSED REREVIEW ACCEPTED — READY FOR WP-13B BASELINE
COMMIT`); unstaged/uncommitted for baseline commit.
**Baseline:** HEAD `7818fcdcfa283b7240bf2d9ae409813075e07496` (branch `main`;
`feat: establish WP-13A execution foundation`), unchanged throughout. Nothing
staged/committed; no push/tag/release/deploy.
**Authoritative contract:**
`docs/reports/wp-13-pre-implementation-contract-decision.md` §3.1/§3.2/§3.4
(SCR-WP13-002 validation path; SCR-WP13-003 result-write semantics), ADR-006/
011/012, ADR-008 (opaque artifact instance/revision identity), the committed
`execution-result`/`execution-result-body`/`completion-contract-body`/
`validation-record` schemas, and the WP-13A execution foundation
(`ExecutionAttemptOutcome`, `PiExecutionObservation`, enforcement evidence).

## 1. Changed paths

New production module family (`src/completion/`): `types.ts` (vocabulary +
narrow boundaries) · `evaluator.ts` (completion decision gate + check
evaluation; pure) · `result.ts` (canonical result model, opaque
instance/revision identity, committed-projection digest, exact canonical
bytes; pure) · `writer.ts` (the narrow fd-anchored result-write executor; the
ONLY node:fs module in the family) · `control-plane.ts` (WP-12
`recordValidation` boundary adapter) · `run.ts` (the completion flow) ·
`index.ts` (barrel).

New tests: `tests/unit/wp13b-completion.test.ts` (20 focused) ·
`tests/unit/wp13b-static-guard.test.ts` (4 static guards).

Two tracked-file modifications (both minimal, both documented):
- `src/control-plane/subject.ts` — **op-scoped canonical-subject kind
  extension**: `parseCanonicalSubject` accepts an optional extra kind, and the
  `recordValidation` operation parse passes `ExecutionResult`. This is the
  smallest change that makes the contract-mandated path ("existing WP-12
  `recordValidation`" → durable result `ValidationRecord`) actually accept the
  committed `ExecutionResult` artifact kind. ADR-012 is preserved by scope:
  `approve`/`issue`/`revoke`/grant/activation keep rejecting `ExecutionResult`
  subjects (the shared `SLICE_1_KIND_IDS` allowlist is unchanged) — verified
  empirically and by focused test (`recordValidation` → records;
  approve/issue → `subject-syntax`). No store-allowlist widening
  (validation-record was already inside the WP-12 eight-class set), no new
  authority path, WP-12 remains the trusted producer.
- `tests/security/security.test.ts` — the global I/O scan now excludes
  `/completion/` by boundary, exactly like `/writing/`, `/reader/`,
  `/runtime/`, `/adapters/`; the dedicated stricter guard
  (`wp13b-static-guard.test.ts`) proves node:fs appears ONLY in `writer.ts`
  and the rest of the family is I/O-free (no network/process/timer/crypto
  surface).

One tracked documentation clarification (SIR-WP13B-005): the directly
conflicting destination sentence in
`docs/reports/wp-13-pre-implementation-contract-decision.md` §3.4 is updated —
the project-visible result destination is deterministic for the exact
workspace + bundle + occurrence + attempt, NOT derived from the opaque result
instance/revision identifiers; the file content itself carries and binds the
opaque instance/revision. No other contract text changed; ADR-008 and result
identity semantics are untouched.

## 2. Completion-evaluation flow

```
validated input → 1. input hygiene (containers + boundary members; safe-call
containment) → 2. completion decision gate (§4.2; EXE-008/009) → 3. exact
attempt correlation (outcome/observation/attempt facts; workspace binding)
→ 4. adoption candidate parse (exact compatible candidate only) → 5. opaque
identities + committed evidence references (originate: trusted identity
boundary; adopt: candidate-preserved) → 6. canonical result model → 7.
adoption byte-equality gate → 8. WP-4 self-validation (validateArtifactSelf)
→ 9. narrow fd-anchored result write (exclusive create / adoption-recovery)
→ 10. WP-12 recordValidation (trusted producer) → 11. bounded validated-result
handoff.
```

The decision gate is deterministic: `completed` + available observation +
validated CompletionContract → produce; `rejected` → NO result (EXE-009:
denied attempt never gains a result association); `incomplete` → NO result
(ambiguous); `failed`/`cancelled`/`timed-out`/`crashed` → NO result
(retryable; completion evaluation happens only for a completed attempt);
absent observation / contract → NO result `evidence-unavailable` /
`contract-unavailable` (EXE-008: never fabricated).

The evaluator consumes only committed/validated inputs: the WP-13A outcome,
the branded PiExecutionObservation, the validated CompletionContract, the
WP-5B enforcement evidence fingerprint, and the WP-12 attempt facts. It
never recomputes authority, never reinterprets WP-12/WP-5B decisions, and
never fabricates observations/results.

## 3. Originate/adopt behavior (ADR-012 §3.2)

- **Originate:** the evaluator builds the canonical result model with FRESH
  OPAQUE instance/revision identifiers obtained through the host-injected
  trusted identity boundary (`ResultIdentitySource`, D-3 pattern; ADR-008) —
  one immutable instance per exact attempt.
- **Adopt:** the host supplies candidate bytes; WP-13B requires the candidate
  to be (a) parsable (duplicate-rejecting scanner), (b) carrying the exact
  opaque instance/revision identities and the exact committed
  enforcement-evidence reference (content_digest = the current WP-5B
  fingerprint) for the attempt, and (c) **byte-identical to the canonical
  result** for the attempt (the contract's exact-compatible candidate; §3.4
  "exact canonical bytes/digest expected for the result"). Adoption preserves
  the candidate's already-valid opaque identities verbatim and never
  re-derives them; adoption never changes digest-covered content; byte
  equality alone never confers evaluator provenance (validation + the future
  WP-13C trusted publication remain required).
- **Crash recovery / replay:** because fresh origination mints NEW opaque ids
  (different bytes), a re-run of a completed attempt RECOVERS by re-supplying
  the existing artifact as the adoption candidate (ADR-012 §3.4 recovery
  semantics): the destination is recognized `already-exact`, the same opaque
  instance/revision are preserved, and the WP-12 record replay returns the
  same durable ValidationRecord id (idempotent). A re-run WITHOUT adoption
  fails closed at the writer (`RESULT-WRITE-CONFLICT`) — a second distinct
  result instance for one attempt can never be written (one-candidate locus
  preserved by the deterministic per-attempt destination).
- **One-instance invariant:** the deterministic destination is per-attempt
  (`results/<occurrence>/<attempt>/execution-result.json`); a second distinct
  instance for the same attempt produces different bytes at the same
  destination → typed `RESULT-WRITE-CONFLICT` fail closed. An absent
  evaluator result is never fabricated; a denied/rejected attempt never gains
  a result association.

## 4. Result identity / canonicalization (SIR-WP13B-001 applied)

- Instance identity: OPAQUE `pgw:i:<32 hex>` supplied by the trusted identity
  boundary; revision identity: OPAQUE `pgw:r:<32 hex>` supplied by the same
  boundary. Both follow ADR-008 exactly: opaque, 128 random bits, assigned
  through the trusted host identity mechanism, never encoding workspace,
  lifecycle, or content semantics. NO content-derived derivation domains
  exist (all `PGAP-EXECUTION-RESULT-*` and observation-evidence derivation
  domains introduced by the first WP-13B draft are REMOVED; the static guard
  forbids their reintroduction).
- No new identity registrar or identity protocol: the `ResultIdentitySource`
  boundary is the same host-injected D-3 pattern as the committed WP-12
  identity sources (crypto-random opaque ids, committed prefix syntaxes);
  containment is safeCall → exact shape validation → use; malformed/throwing
  returns fail typed and closed (`identity.*-exception` /
  `identity.*-malformed` / `input.identity-source-invalid`).
- Artifact digest: the committed `artifactProjection` digest (canonical
  projection excluding `revision.digest` and `annotations`); verified stable
  over the complete envelope. The digest covers the opaque instance id and
  revision id directly — no digest/identity circularity workaround exists and
  none is needed; instance, revision, and digest remain distinct.
- File bytes: the exact JCS serialization of the complete envelope
  (digest-covered content). Fresh origination with a fresh identity source
  produces fresh opaque ids (and therefore a fresh digest/bytes); the
  deterministic evaluation facts (disposition, reported bindings, observed
  outputs, violations, committed evidence fingerprint) are identical.
- Evidence references (committed mechanisms only): exactly ONE
  `external-evidence` reference for the WP-5B enforcement evidence —
  `content_digest` is the committed evidence fingerprint (sha-256 over the
  canonical evidence serialization; WP-5B), `evidence_id` is an opaque
  `pgw:e:<32 hex>` from the trusted identity boundary, `observation_role`
  `evaluation-evidence` (committed enum). No content-derived evidence-ID
  protocol is minted; the execution observation is EMBEDDED content in the
  result body (reported facts), not an external-evidence reference — WP-13B
  never persists the observation as external content, so no fabricated
  external reference is produced for it.

## 5. Result-write / recovery behavior (SCR-WP13-003; SIR-WP13B-002/-003/-004 applied)

`writer.ts` — the narrow executor:
- **fd-anchored containment (SIR-WP13B-003, the established WP-11/WP-6
  pattern):** the verified workspace root is opened `O_RDONLY|O_DIRECTORY|
  O_NOFOLLOW` and retained as a descriptor; every directory component of the
  destination chain is opened RELATIVE to the previously verified descriptor
  (`/proc/self/fd/<fd>/<component>`) with `O_DIRECTORY|O_NOFOLLOW`,
  fstat-verified (directory, service uid), and resolution-path verified
  (`readlink(/proc/self/fd/<fd>)` must equal the expected canonical path).
  The final exclusive create and the EEXIST recovery read both happen
  relative to the same verified parent descriptor — no parent-swap window
  exists between containment verification and the final operation.
- **EEXIST/adoption path (SIR-WP13B-002):** the existing final component is
  opened `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` through the verified parent
  descriptor and fstat-verified (ordinary regular file, service uid) BEFORE
  any read. O_NONBLOCK is the established repository pattern for
  type-inspection opens (reader lane) and guarantees a FIFO at the
  destination can NEVER block the open (residual FIFO defect CLOSED). A
  symlink (dangling or pointing at the exact expected bytes), FIFO,
  directory, device, socket, or other non-regular type fails closed as
  `exclusive-create-conflict` — a symlink to the exact expected bytes NEVER
  returns `already-exact`, and NO bytes are read before successful
  regular-file fstat verification (explicit adversarial tests, incl. a
  child-process promptness guard for the FIFO case).
- Exclusive create (`O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW`, mode 0600) of
  exactly one final component; no overwrite/replace/truncate/update; no
  directory creation (missing parent → typed `missing-parent`); exact
  canonical bytes; conflicting existing bytes → typed
  `exclusive-create-conflict`; byte-identical existing ORDINARY FILE →
  `already-exact` adoption/recovery (crash recovery between artifact creation
  and trusted publication).
- **Byte ceiling (SIR-WP13B-004):** the arbitrary 1 MiB acceptance ceiling is
  REMOVED. The writer reuses the COMMITTED WP-3 artifact input byte bound
  (`INPUT_BYTE_LIMITS.artifact` — the same bound the committed WP-4 intake
  applies via `parseRawJsonInput(subjectClass: 'artifact')` and the WP-11
  writer reuses as `WRITE_CANONICAL_UTF8_MAX_BYTES`). No implementation-local
  ceiling exists: the writer accepts every payload the committed intake
  accepts and rejects over-limit content with the SAME bound the committed
  intake uses (tested at the bound boundary and flow-level). WP-13B's model
  builder produces bodies well under the bound (one summary output ≤ 8192
  chars, ≤ 128 violations × 4096, bounded checks/evidence); any content that
  would exceed the bound is rejected by the committed intake
  (RESULT-VALIDATION-REJECTED) before the writer is reached.
- Typed codes: `exclusive-create-conflict`, `containment-denied`,
  `ownership-mismatch`, `parent-not-verified`, `missing-parent`, `io-failure`,
  `bytes-too-large`, `invalid-operand` — mapped to
  `RESULT-WRITE-CONFLICT` / `RESULT-CONTAINMENT-DENIED` / `RESULT-WRITE-FAILED`.

Destination (SIR-WP13B-005 clarification): deterministic for the exact
workspace + bundle + occurrence + attempt — NOT derived from the opaque
result instance/revision identifiers; the file content itself carries and
binds the opaque instance/revision. The contract sentence in §3.4 is updated
accordingly; binding remains by digest, never by path (§3.5).

## 6. WP-4 → WP-12 ValidationRecord path (SCR-WP13-002)

1. `validateArtifactSelf` (committed WP-4 pipeline, offline schema registry)
   over the canonical result model — rejection fails closed as
   `RESULT-VALIDATION-REJECTED` (bounded message; no raw findings text);
2. the accepted WP-4 report + branded `ValidatedArtifact` are supplied
   through the existing WP-12 `recordValidation` command (the boundary
   clones the trusted context with `validationEvidence`/`subjectArtifact`);
3. WP-12 remains the trusted producer/recorder (role `trusted-validator`),
   records the durable passing `ValidationRecord` with the exact
   `ExecutionResult` subject (kind acceptance is op-scoped — see §1);
4. an exact existing record for the same subject is recognized idempotently
   (`lifecycle-conflict` → exact-subject lookup) so crash recovery between the
   write and the record never stalls;
5. the handoff carries the exact `validationRecordId`.

## 7. Validated-result handoff for WP-13C

`ValidatedResultHandoff` — bounded identities/digests/provenance only:
workspace/occurrence/attempt/ordinal, exact bundle reference, disposition,
association mode (originated/adopted), opaque result instance/revision/digest,
the deterministic artifact relative path (binding is by digest, never by
path), the durable ValidationRecord id, evaluator provenance
(`project-gateway.completion-evaluator.v1` /
`project-gateway.completion-evaluation.v1`), the committed enforcement
evidence reference, and the write outcome. No publication, no scopes, no
receipts.

## 8. Failure taxonomy (closed)

`COMPLETION-INPUT-INVALID` · `COMPLETION-INTERNAL-FAILURE` ·
`RESULT-VALIDATION-REJECTED` · `RESULT-CANDIDATE-INVALID` ·
`RESULT-WRITE-CONFLICT` · `RESULT-CONTAINMENT-DENIED` · `RESULT-WRITE-FAILED`
· `VALIDATION-RECORDING-FAILED`, each with a stable machine key. Identity
boundary failures (SIR-WP13B-001): `input.identity-source-invalid` (shape),
`identity.instance-id-exception` / `identity.revision-id-exception` /
`identity.evidence-id-exception` (throwing), `identity.instance-id-malformed`
/ `identity.revision-id-malformed` / `identity.evidence-id-malformed`
(return shape). Every injected boundary call is safe-call contained with
return-shape validation (the SIR-WP13A-001 pattern): malformed containers/
members, throwing boundaries, and malformed returns map to typed failures;
raw exception text never reaches findings (tested with secret markers). No
fallback success; no authority inferred from exceptions; a completed write
that later fails leaves the durable artifacts for recovery.

## 9. Test evidence (SIR-WP13B-005 ledger corrected)

| Suite | Result |
|---|---|
| typecheck (`tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.tests.json --noEmit`) | clean |
| Focused WP-13B (`wp13b-completion.test.js`) | **21/21 pass** (15 pre-correction + 6 added SIR-WP13B coverage: identity-boundary containment, symlinked-final-destination rejection, FIFO final-component rejection + child-process FIFO promptness guard, parent-swap anchored containment, committed byte ceiling, subject-gate scope) |
| WP-13B static guards (`wp13b-static-guard.test.js`) | **4/4 pass** (identity-domain/crypto guards added) |
| WP-13A suites (`wp13a-execution` + `wp13a-static-guard`) | **43/43 pass** (no regression from the subject-gate change) |
| Full unit suite (`dist-test/tests/unit/*.test.js`, incl. WP-12/WP-4/WP-11 writing) | **513/513 pass** |
| WP-11 writing + point-of-use suites (`dist-test/tests/writing` + `pointofuse-v2`) | **282/282 pass** |
| Pi-adapter suite (incl. WP-5B enforcement) | **338/339** — sole failure = the known pre-existing environmental F8 (installed Pi 0.84.1 vs supported 0.83.0 lane; unchanged) |
| Global security scan (`tests/security/security.test.js`) | **15/15 pass** (completion boundary excluded like writing/reader/runtime; dedicated guard proves writer-only fs) |
| `git diff --check` | clean |

## 10. Explicit WP-13C/D exclusions (NOT implemented)

ADR-038 result-publication authority · ResultPublicationRecord ·
publication coordination lock · publication scopes · receipt correlation ·
ExecutionRetrospectiveFacts · TrustedReceipt · retry changes · new lifecycle
record classes · new storage/lock protocol · WP-14/WP-15. No WP-13C/D
behavior is stubbed with fake success paths — the modules simply do not
exist; the handoff is the bounded seam WP-13C consumes.

## 11. Final Git state

Branch `main`; HEAD `7818fcdcfa283b7240bf2d9ae409813075e07496` (unchanged);
modified tracked: `src/control-plane/subject.ts` (op-scoped
`recordValidation` ExecutionResult subject kind; ADR-012 gates preserved),
`tests/security/security.test.ts` (boundary exclusion),
`docs/reports/wp-13-pre-implementation-contract-decision.md` (destination
clarification sentence, SIR-WP13B-005); untracked new: `src/completion/`
(7 files), `tests/unit/wp13b-completion.test.ts`,
`tests/unit/wp13b-static-guard.test.ts`. Nothing staged; no push/tag/
release/deploy. WP-13C/D NOT STARTED; WP-14/WP-15 remain blocked.

## 12. Focused correction record (SIR-WP13B-001…005)

| Finding | Severity | Disposition |
|---|---|---|
| SIR-WP13B-001 — deterministic content-derived result instance/revision identity | MODERATE | CLOSED — all content-derived identity domains removed; opaque ADR-008 identities via the host-injected trusted identity boundary (D-3 pattern); adoption preserves candidate opaque ids; evidence references use only committed identity material (WP-5B fingerprint + opaque `pgw:e:`); identity boundary contained (safeCall → shape → use); static guard forbids the removed domains. |
| SIR-WP13B-002 — EEXIST read follows a symlinked final component | MODERATE | CLOSED — EEXIST recovery opens the final component `O_RDONLY|O_NOFOLLOW` (extended to `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` in the final FIFO correction) through the verified parent descriptor and fstat-verifies ordinary regular file + service uid before any read; symlink/FIFO/directory/device/socket fail closed; adversarial symlink-to-exact-bytes and FIFO tests added. Residual FIFO blocking defect CLOSED: O_NONBLOCK (established reader-lane pattern) guarantees the FIFO open never blocks; FIFO fails closed as `exclusive-create-conflict`; verified promptly (child-process timeout guard). |
| SIR-WP13B-003 — path-based containment TOCTOU | MODERATE | CLOSED — writer rewritten to the established WP-11/WP-6 fd-anchored pattern (root descriptor anchor, fd-relative no-follow descent, fstat + resolution-path verification per component, anchored create/read/cleanup); parent-swap race-coverage test added (WP-11 seam pattern). |
| SIR-WP13B-004 — uncommitted 1 MiB acceptance ceiling | MINOR | CLOSED — the committed WP-3 artifact input bound (`INPUT_BYTE_LIMITS.artifact`, the same bound the committed WP-4 intake and WP-11 writer use) is reused; no implementation-local ceiling; tested at the bound boundary and flow-level. |
| SIR-WP13B-005 — report ledger / destination wording | MINOR | CLOSED — ledger corrected to actual counts (focused 20/20, static guards 4/4); contract §3.4 destination sentence clarified as attempt-level deterministic, not derived from instance/revision ids. |

**SIR-WP13B-001…005: ALL CLOSED** (incl. the residual SIR-WP13B-002 FIFO
recovery defect). Prior accepted architecture/identity/byte-bound
conclusions (opaque ADR-008 identities, fd-anchored writer, committed
`INPUT_BYTE_LIMITS.artifact` byte bound, op-scoped `recordValidation`
subject acceptance, handoff boundary) are unchanged by the final FIFO
correction.

## 13. Final focused rereview record

Focused rereview verdict: **WP-13B FINAL FOCUSED REREVIEW ACCEPTED — READY
FOR WP-13B BASELINE COMMIT** (SIR-WP13B-001…005 CLOSED).

Final evidence ledger: focused WP-13B **21/21** · static guards **4/4** ·
full unit **513/513** · security **15/15** · writing + pointofuse-v2
**282/282** · WP-13A **43/43** · both typechecks clean · `git diff --check`
clean. WP-13C/D **NOT STARTED**; WP-14/WP-15 remain blocked.

---

**WP-13B BASELINE COMMIT READY**
