# PS-6 — Gateway Host-Lane Parameterization Implementation Report

**Gate type:** PS-6 implementation (readiness verdict `READY`; baseline
`7f3b4afdb43704e7dac82da7b086d8367347c641`). Narrowly scoped Gateway-side
report; the product-level evidence is in the pi-shuttle PS-6 implementation
report. Changes uncommitted/unstaged; no push/tag/publication.

## 1. Exact changes

| File | Change |
|---|---|
| `src/trusted/host-lane.ts` | Closed accepted-lane set: `TRUSTED_HOST_LANE` (unchanged value) + `DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22'`; `TrustedHostLane` union type; `ACCEPTED_HOST_LANES` frozen two-member set; `isSupportedHostLane` set-membership type guard; pure shared mapping `trustedHostLaneForPlatformArch(platform, arch)` (linux+x64 / darwin+arm64 → lane; everything else → null). |
| `src/trusted/types.ts` | `ValidatedTrustedWorkspaceConfiguration.hostLane` widened from the single-lane literal to `TrustedHostLane`. |
| `src/trusted/validate.ts` | The validated configuration now retains the **validated operand** (`hostLane` after the TCF-027/028 gates) instead of stamping the Linux constant. Identity projection/JCS untouched. |
| `src/trusted/containment-validate.ts` | Lane check uses the closed predicate (`isSupportedHostLane(configuration.hostLane)`); TCP-011 semantics unchanged, unknown lanes still fail closed. |
| `src/trusted/index.ts` | Exports the new lane constants, type, set, predicate, and mapping. |
| `src/runtime/mcp/cli.ts` | The ONE host-lane derivation at the operator CLI boundary: `trustedHostLaneForPlatformArch(process.platform, process.arch)`; null → stderr diagnostic + exit 2 before any validation/composition; `--help` hygiene still works on any platform; lane passed to `runBootstrapCommand` and `composeTrustedRegistry` (bootstrap and runtime/start share the same derivation). |
| `src/bootstrap/run.ts` | `runBootstrapCommand(argv, hostLane)`; `buildActionInputs` threads the lane into every `StorageBootstrapActionInput`. |
| `src/control-plane/storage-bootstrap-action.ts` | `StorageBootstrapActionInput.hostLane` (required trusted operand — documented as a host observation, never operator-config-controlled); `bootstrapStore` uses it as the validation operand. |
| `src/runtime/mcp/lanes.ts` | `buildWorkspaceLanes` input gains required `hostLane`; used as the validator operand. |
| `src/runtime/mcp/compose.ts` | `composeTrustedRegistry(config, deps, hostLane = TRUSTED_HOST_LANE)`; threads the lane into `buildWorkspaceLanes`. Default keeps existing direct callers (tests) unchanged; production CLI always passes the derived lane. |
| `src/conformance/runner.ts` | `ConformanceRunner({ hostLane })` — explicit lane operand, default Linux; never ambiently probed. |
| `docs/decisions/ADR-042-darwin-arm64-trusted-host-lane-and-apfs-compatibility.md` | New ADR (decisions 1–12, §3 of this report). |
| `docs/operations/project-gateway-operator-runbook.md` | Host-lane table rows, package-floor paragraph, and known-limitations environment row updated (lane set + APFS stance); no unrelated contract wording touched. |

No change: `src/storage/probe/probe.ts` (lane-neutral; records
`caseSensitive:false` without failing), storage initialization/metadata
(lane-bound via `configurationIdentity`), `src/runtime/mcp/config.ts`
(lane stays a trusted operand, never a config field), MCP surface,
authority semantics, package version, pi-guard.

## 2. Tests (focused, exact totals)

| Suite | Result |
|---|---|
| `tests/trusted/*` (incl. rewritten `host-lane.test.ts`; new `containment-host-lane.test.ts`) | **576 pass / 0 fail / 0 skip** |
| `tests/unit/bootstrap-action.test.ts` (+2 PS-6 tests: lane identity difference; cross-lane replay fail-closed with byte-identical store + own-lane replay still green) | **17 pass / 0 fail** |
| `tests/integration/conformance.test.ts` (+darwin-lane runner test) | **17 pass / 0 fail** |
| `tests/runtime/*` (bootstrap CLI subprocess — exercises the CLI lane derivation; server/compose) | **53 pass / 0 fail** |
| `tests/mcp/unit/*` | **0 fail** |
| `npm run test:storage` (directly affected storage surface) | **431 pass / 2 skip** (pre-existing privilege-gated chown skips, unrelated) |
| `bootstrap-static-guard` + storage unit subset (initialization/read/metadata/recovery) | **50 pass / 2 skip** (same pre-existing skips) |
| `npm run build` / `npm run typecheck` / `tsc -p tsconfig.tests.json` | clean |

Broad unrelated Gateway regression was not run (focused verdict possible:
the changed dependency graph — validator operand, containment predicate,
bootstrap/runtime threading, conformance operand — is fully covered by the
suites above).

## 3. ADR-042 decisions recorded

Accepted host-lane set exactly {linux-x86_64, darwin-arm64}; macOS Intel
unsupported; default case-insensitive APFS supported; no case-fold/normalization
introduced; identity from canonical filesystem spelling; fixed lowercase
store layout; dev/ino namespace identity; host lane identity-bound;
cross-lane replay fails closed; probe may record `caseSensitive:false`
without alone failing; fsync/no-follow/exclusive-create are probe evidence;
artifact Unicode/JCS semantics unchanged.

## 4. Notable evidence

- Linux vs darwin-arm64 identity digests differ for identical inputs
  (tested at the validator and bootstrap layers).
- A Linux-created store replayed under the darwin lane fails closed
  (`ERR-STO-INTEGRITY`, FOREIGN aggregate classification), metadata
  byte-identical, no repair; own-lane replay afterwards still green.
- The darwin-lane conformance run diverges from Linux in exactly the 9
  POUV2 fixtures whose oracles embed linux-lane identity digests — no
  other fixture class differs (lane-bound identity, by design).
- The conformance runner accepts an explicit darwin-arm64 operand with no
  ambient probing.

## 5. Git status (end of gate)

Untracked pre-existing debris unchanged (WP-13D files ×4). Modified: the
11 source files, 4 test files, ADR-042, runbook. New: ADR-042,
`tests/trusted/containment-host-lane.test.ts`. Nothing staged/committed;
no remotes touched.
