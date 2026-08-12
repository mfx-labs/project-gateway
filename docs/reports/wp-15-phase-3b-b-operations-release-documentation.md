# WP-15 Phase 3B-B — Operations & Release Documentation — Implementation Report

**Work package:** WP-15 Phase 3B-B (operations and release documentation
lane; documentation-only gate).
**Status:** implementation complete; unstaged/uncommitted for integration.
**Baseline:** HEAD `a6f85231c718157ef245ef7f1aa82f7729e59140` (branch
`main`; `feat: establish WP-15 Phase 2 receipt publication correlation`),
verified before any edit. Nothing staged; no commit; no push/tag/release/
deploy.
**Normative basis:** WP-15 contract
(`docs/reports/wp-15-pre-implementation-contract-decision.md`; A1;
Approved Decisions 1–4; §16 supported environment; §18 authoritative
release regression; §19 operations/release readiness; §21 closure gate).
**Gate brief:** WP-15 Phase 3B-B lane instructions (Phase 3A findings
P3A-WP15-004/005/006).

## 1. Changed paths (documentation only)

New documents (4):

- `docs/operations/project-gateway-operator-runbook.md` — consolidated
  operator runbook (prerequisites, startup, trust boundary, storage,
  crash/partial failure, revocation, troubleshooting, known limitations).
- `docs/releases/wp-15-release-readiness.md` — operator/human
  release-authorization handoff (product state, supported environment,
  pre-release checklist, rollback model, version posture, evidence
  bundle, P3A-WP15-006 status).
- `docs/releases/wp-15-phase-3c-regression-matrix.md` — conjunctive
  Phase 3C execution matrix (Lanes 0–5) with the parallel-execution model.
- `docs/reports/wp-15-phase-3b-b-operations-release-documentation.md` —
  this report.

No source, test, `package.json`, schema, fixture, generated-corpus, or
supported-environment-policy change. F-R1 not implemented. Phase 3C not
begun. WP-13D debris untracked and byte-untouched.

## 2. P3A-WP15-004 closure evidence (MODERATE — OPERATIONS BLOCKER)

Closed by `docs/operations/project-gateway-operator-runbook.md`:

- operator-facing prerequisites with the exact supported lane and the
  `engines >=22.0.0` package-floor clarification;
- startup paths using only committed commands/configuration
  (`npm ci`, `npm run build`, `project-gateway-mcp --config <file>`,
  WP-14B tunnel/connector onboarding, trusted workspace configuration);
- operational trust boundary (ChatGPT read/write surface, no
  self-approval/issuance/activation, RuntimeGrant issuance owner, receipt
  alone ≠ privileged publication, exact successor + supersession
  required);
- storage location model, immutability, backup copy/restore expectations
  with no invented transactional guarantees;
- crash/partial-failure semantics (immutable partial states, no rollback,
  State A/B, idempotent replay/recovery, operator action after retryable
  failure);
- revocation semantics (effect, currentness, immutability, revocation ≠
  deletion);
- troubleshooting covering all required symptoms (MCP startup failure,
  workspace/config rejection, capability/currentness rejection,
  corrupted/conflicting state, partial-state recovery, test/discovery
  failure, wrong Pi version, dirty tree / WP-13D-style debris);
- known limitations (process-local coordination, exact environment,
  Pi 0.84.x unverified, F-R1 optional, no generic execution MCP, no
  external release under WP-15).

All statements trace to committed contracts/docs (runbook §header and
per-section references); no invented commands or guarantees.

## 3. P3A-WP15-005 closure evidence (MINOR — RELEASE-READINESS BLOCKER)

Closed by `docs/releases/wp-15-release-readiness.md` +
`docs/releases/wp-15-phase-3c-regression-matrix.md`:

- RELEASE READY only after Phase 3C; RELEASE READY ≠ RELEASED; no
  push/tag/publish/install/deploy under the envelope;
- exact supported/tested lane; Pi 0.83.0 evidence REQUIRED for Phase 3C;
  local Pi 0.84.1 explicitly not substitute evidence;
- Markdown pre-release checklist (closure SHA, clean clone, `npm ci`,
  deterministic build, default regression, storage suite, crash/process
  suite, loading suite, Pi 0.83.0 lane, zero open blocking security
  findings, docs present, package/export integrity, clean tree, separate
  human release authorization);
- rollback model appropriate to the actual package (private, unpublished,
  no tags exist — rollback = restore previous known-good committed SHA;
  never mutate durable historical records; preserve audit/history);
- version posture (`0.1.0` exactly as committed; bump/tag/publication not
  performed by WP-15);
- release evidence bundle (closure SHA, environment versions, lane
  reports, exact commands, pass/fail/skip, known accepted skips,
  clean-tree proof, final verdict);
- conjunctive Phase 3C matrix (Lanes 0–5; one required failure → closure
  blocked; no majority/partial verdict) and the parallel-execution model
  (same SHA, independent clones, matching environment, local builds,
  isolated temp/storage, no candidate modification, centralized verdict).

## 4. P3A-WP15-006 status

Recorded in `docs/releases/wp-15-release-readiness.md` §2 and the matrix
Lane 5:

**P3A-WP15-006 — OPEN — PHASE 3C EXECUTION PREREQUISITE.** NOT closed by
this gate. It closes only after actual supported Pi 0.83.0 verification
(`SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`, pi-guard v0.1.2
lane) is performed and reported in Phase 3C Lane 5 evidence. If 0.83.0
verification cannot be performed, WP-15 cannot claim the fully supported
release-ready lane unless the normative contract explicitly permits a
qualified limitation verdict. Support is not broadened; Pi 0.84.1 is not
substitute evidence.

## 5. Supported-version wording

All four documents use the committed lane facts: Linux x86_64; Node
v22.23.2 (with the `engines >=22.0.0` floor clarification); Git 2.45.4;
Pi 0.83.0 (`pi-0.83.0-extension-api-v1`); pi-guard v0.1.2 (commit
`7a7580cc4cbd7926797564c72269394fc29a860a`); UTF-8;
`TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22'`. Verified against
`package.json`, `src/adapters/pi/types.ts`, `src/trusted/host-lane.ts`,
`docs/design/pi-adapter-host-compatibility.md`,
`docs/design/pi-guard-compatibility-and-authority-projection.md`, and
WP-15 contract §16.

## 6. Rollback semantics

Documented in release-readiness §4: no release tags exist; rollback for a
future authorized release operator = preserve the recorded previous
known-good committed SHA, restore package/build/deployment to that SHA,
never mutate durable historical lifecycle records as "rollback" (corrected
state is expressed by new records: revocation, new supersession), and
preserve audit/history. No tag invented.

## 7. Phase 3C matrix

`docs/releases/wp-15-phase-3c-regression-matrix.md`: Lane 0 (clean clone +
exact SHA + `npm ci`), Lane 1 (build/typecheck/default regression),
Lane 2 (`npm run test:storage`), Lane 3 (`npm run test:storage-crash`,
present at baseline), Lane 4 (`npm run test:loading`), Lane 5 (Pi 0.83.0
compatibility/enforcement), Lane 6 (final clean-tree/integrity check). Lanes 2 and 4 are provided by Phase 3B-A
(`scripts/run-test-surface.mjs dist-test/tests/unit/storage` and
`.../tests/loading`; the scripts were absent at baseline HEAD and landed
concurrently in the same working tree); each lane is executable only when
its script is present, and the gate MUST NOT claim a lane otherwise.
All lanes conjunctive; one required failure → closure blocked; no
majority/partial verdict. Parallel execution permitted only per the
§Parallel-execution constraints; final verdict centralized. Closure SHA
deliberately not hardcoded.

## 8. Existing-doc consistency

Cross-checked against WP-14B operator onboarding, trusted
workspace/ceiling configuration (ADR-024), lifecycle/trust ADRs (011,
012, 022, 024, 026, 028, 029, 030, 031, 035, 037, 038, 040), WP-8
storage/registry contract, WP-15 contract, and current package metadata.
The new docs reference committed sources instead of duplicating normative
contracts; no contradictory instructions were introduced (e.g., no claim
that `test:storage`/`test:loading` exist at baseline HEAD; the concurrent
Phase 3B-A landing that adds them is reflected in §7 and the matrix; no
claim of release tags; no claim of Pi 0.84.x support). Historical
reports were not rewritten.

## 9. Documentation verification

- `git diff --check` — clean (no new tracked diffs; new docs are
  untracked files; see §10).
- Focused grep/path checks — all referenced paths and lane constants
  verified to exist (documents listed in §1; `package.json` scripts;
  `src/adapters/pi/types.ts`; `src/trusted/host-lane.ts`; `tests/loading/`;
  `dist-test/tests/process/storage-crash` script target).
- Package metadata facts quoted (version `0.1.0`, `private`, `UNLICENSED`,
  `bin.project-gateway-mcp`, `engines`, `exports`, scripts) verified
  against `package.json`.
- No runtime tests executed (documentation-only gate).

## 10. Git state

HEAD `a6f85231c718157ef245ef7f1aa82f7729e59140` unchanged; branch
`main`; nothing staged by this lane; no commit; no push/tag/release/
deploy. This lane's working-tree footprint is exactly the four new
files of §1 (untracked). During this gate, the parallel **Phase 3B-A**
lane landed its own uncommitted changes in the same working tree
(`package.json` adds `test:storage`/`test:loading`;
`tests/pointofuse-v2/boundary-v2.test.ts`; `tests/unit/storage/`;
`scripts/run-test-surface.mjs`;
`docs/reports/wp-15-phase-3b-a-regression-surface-remediation.md`) —
observed, not authored, by this lane, and consistent with this lane's
Lane 2/Lane 4 binding (§7). The pre-existing untracked WP-13D debris
(`src/retrospective/`, `tests/unit/wp13d-*.test.ts`,
`docs/reports/wp-13d-*.md`) remains byte-untouched and excluded from
every walk.

## 11. Envelope exception status

**NONE.** Documentation-only; no source/test/package/schema/fixture/
policy change; no support broadening; no new authority; no Phase 3C
execution; no external release action.

## 12. Expected outcome

- **P3A-WP15-004 CLOSED** (operator runbook delivered; §2).
- **P3A-WP15-005 CLOSED** (release-readiness handoff + Phase 3C matrix
  delivered; §3).
- **P3A-WP15-006 OPEN / OWNED BY PHASE 3C** (recorded; §4).
- **Envelope exception NONE.**

WP-15 PHASE 3B-B COMPLETE — OPERATIONS AND RELEASE EVIDENCE READY FOR INTEGRATION
