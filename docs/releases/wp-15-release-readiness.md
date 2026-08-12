# WP-15 Release Readiness (Operator / Release-Authorization Handoff)

**Status:** WP-15 Phase 3B-B documentation; NOT a release announcement.
**Purpose:** the operator/human release-authorization handoff describing
what "release ready" means for WP-15, what evidence is required, and what
a future authorized release operator must preserve.
**Owners:** WP-15 contract (`docs/reports/wp-15-pre-implementation-contract-decision.md`),
operator runbook (`docs/operations/project-gateway-operator-runbook.md`),
Phase 3C matrix (`docs/releases/wp-15-phase-3c-regression-matrix.md`).

---

## 1. Product state

- **WP-15 reaches RELEASE READY only after Phase 3C succeeds.** Phase 3C
  is the authoritative clean-clone regression over the exact closure
  candidate (contract §18/§21) plus the Pi 0.83.0 supported-lane
  verification. Until then the project is implementation-complete but not
  release-ready.
- **RELEASE READY != RELEASED.** WP-15 does not authorize any external
  release action. Under the approved envelope (Approved Decision 4), WP-15
  MUST NOT: push; create/push release tags; create a GitHub Release;
  publish npm/package-registry artifacts; install; deploy. External
  publication/deployment requires separate human release authorization.
- The current package is `private: true`, `"license": "UNLICENSED"`; no
  npm-published artifact exists, and no release tag exists in this
  repository. "Release" therefore means: the closure candidate is the
  exact committed state that a future authorized operator may build,
  package, and (under separate authorization) publish/deploy.

## 2. Supported environment

Exact supported/tested lane (contract §16; runbook §1):

- Linux x86_64 (POSIX filesystem semantics; `TRUSTED_HOST_LANE =
  'linux-x86_64-posix-utf8-node22'`);
- Node.js v22.23.2 (`engines: ">=22.0.0"` in `package.json` is a package
  floor, NOT the tested lane);
- Git 2.45.4 (pinned binary);
- Pi 0.83.0 — `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`;
- pi-guard v0.1.2 verified lane (commit
  `7a7580cc4cbd7926797564c72269394fc29a860a`, tag `v0.1.2`);
- UTF-8 locale.

**Pi 0.83.0 evidence remains REQUIRED for Phase 3C.** The local harness
may run Pi 0.84.1; that is NOT substitute evidence and MUST NOT silently
expand support (contract §16). P3A-WP15-006 (Pi 0.83.0 supported-lane
verification) is therefore recorded:

> **P3A-WP15-006 — OPEN — PHASE 3C EXECUTION PREREQUISITE.** It closes
> only after actual supported Pi 0.83.0 verification is performed and
> reported in the Phase 3C lane evidence. If 0.83.0 verification cannot be
> performed, WP-15 cannot claim the fully supported release-ready lane
> unless the normative contract explicitly permits a qualified limitation
> verdict. It is NOT closed by this documentation gate.

## 3. Pre-release checklist

To be completed at the Phase 3C closure gate by the closure reviewer(s),
with evidence recorded per §6:

- [ ] Exact closure SHA recorded (single candidate; no drift during the
      gate).
- [ ] Clean clone / clean worktree of the exact closure SHA (no untracked
      debris in the evaluated tree; superseded WP-13D-style debris excluded
      by construction, contract §18).
- [ ] `npm ci` succeeds on the clean clone.
- [ ] Deterministic build succeeds (`npm run build`; regenerated bundles
      byte-reproducible from committed fixtures).
- [ ] Default authoritative regression passes on the supported lane
      (contract §18 surface: unit/integration/security/trusted/
      pointofuse-v2/mcp/runtime/drafting/writing/pi-adapter suites;
      `npm test`).
- [ ] Explicit storage suite passes (Lane 2 — `npm run test:storage`,
      provided by Phase 3B-A; executable once the script is present in
      the integrated tree).
- [ ] Crash/process suite passes (Lane 3 — `npm run test:storage-crash`).
- [ ] Loading suite passes (Lane 4 — `npm run test:loading`, provided by
      Phase 3B-A; tests live under `tests/loading/`).
- [ ] Pi 0.83.0 lane verified (Lane 5 — compatibility/enforcement evidence
      on the supported Pi 0.83.0 lane; P3A-WP15-006 closes only here).
- [ ] Zero open blocking security findings (auditable rule, contract §17).
- [ ] Operator runbook and release-readiness docs present and consistent
      with the committed tree.
- [ ] Package/export integrity verified (`package.json` exports, `bin`,
      `files`; no unintended surface change).
- [ ] Tree clean after verification (`git status` clean on the closure
      clone; `git diff --check` clean).
- [ ] Human external-release authorization obtained SEPARATELY (WP-15
      performs no external release action itself).

## 4. Rollback

WP-15 does not authorize publication/deployment, so there is no deployed
artifact to roll back today. The rollback model a **future authorized
release operator** must preserve:

- **Preserve the exact previous known-good commit.** The previous
  known-good state is a committed SHA (this repository currently has NO
  release tags; do not reference a tag that does not exist). Before any
  future release, record the previous known-good closure SHA (e.g., the
  parent of the release candidate, or the previously verified closure
  commit) in the release evidence.
- **Restore package/build/deployment to the previous known-good release.**
  Rollback is source-and-build-level: check out the recorded previous
  known-good SHA, `npm ci`, `npm run build`, redeploy the resulting
  artifacts, and re-run the release gate's verification on the restored
  SHA.
- **Never mutate durable historical lifecycle records as "rollback".**
  Lifecycle records, TrustedReceipts, publications, supersessions, audit
  events, and evidence are immutable; rollback must not delete, rewrite,
  or "undo" them. A corrected state is expressed by new records (e.g.,
  revocation for active authority; a new supersession for publication
  currentness), never by mutating history (runbook §6; WP-8 RNT-002/RNT-009).
- **Preserve audit/history.** Audit and evidence records are
  indefinite-retention and must survive any rollback of application
  state. Store data (both namespaces) is preserved; only the running
  build/deployment is restored (runbook §4 for copy/restore expectations).

## 5. Version / release posture

- Current package version, exactly as committed: **`0.1.0`**
  (`package.json` → `"version": "0.1.0"`; package `@project-gateway/artifact-core`,
  `private: true`, `UNLICENSED`).
- **Version bump, tagging, and publication are NOT performed by WP-15.**
  They are separate human release-authorization actions. Until then the
  committed version remains `0.1.0` and no tag exists.
- The `bin` surface (`project-gateway-mcp` → `dist/runtime/mcp/cli.js`)
  and the `exports` map (`./pi-adapter`, `./loading`, `./mcp`) are part of
  the package/export integrity checklist item above.

## 6. Release evidence

The expected evidence bundle produced at the Phase 3C gate:

1. **Closure SHA** — the exact candidate, recorded before lane execution;
2. **Environment versions** — OS/arch, Node v22.23.2, Git 2.45.4,
   Pi 0.83.0 lane identity, pi-guard v0.1.2, locale;
3. **Phase 3C lane reports** — one report per lane (Lanes 0–5 of
   `docs/releases/wp-15-phase-3c-regression-matrix.md`), including which
   lanes ran in parallel and on which independent clones;
4. **Exact commands** — each command with its working tree state;
5. **Pass/fail/skip evidence** — totals per suite, mismatches, and any
   recorded failures;
6. **Known accepted skips** — recorded baseline items dispositioned at the
   gate. The two standing pre-existing baseline items recorded at Phase
   1B/2 are: (a) the superseded untracked WP-13D E2E tests
   (non-authoritative, excluded by clean-clone construction), and (b) the
   pointofuse-v2 `m-2` package-exports pin, which Phase 3B-A remediates
   (P3A-WP15-001 closed; no longer a standing skip once the combined tree
   is integrated). Any new skip must be explicitly accepted;
7. **Clean-tree proof** — `git status` clean and `git diff --check` clean
   on the closure clone after all lanes;
8. **Final closure verdict** — the consolidated human decision that all
   required lanes are conjunctively satisfied and WP-15 is RELEASE READY
   (not RELEASED).
