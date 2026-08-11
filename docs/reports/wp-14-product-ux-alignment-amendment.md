# WP-14 Product UX Alignment — Contract Amendment Report

**Phase:** documentation/contract only. No source/test/schema/generated
file modified; no implementation of WP-14A/B/C; WP-15 not begun; nothing
staged or committed; no push/tag/release/deploy.

## 1. Baseline

- Repository: `/home/chef/Documents/Project_Gateway_MCP`, branch `main`
- HEAD: `b656e20b24bfaebb9a16cb554ead6421cd6e75e4`
  (`docs: close WP-13 execution integration`)
- Working tree at baseline contained only pre-existing untracked WP-13D
  historical leftovers (`src/retrospective/`,
  `tests/unit/wp13d-retrospective.test.ts`,
  `tests/unit/wp13d-static-guard.test.ts`,
  `docs/reports/wp-13d-retrospective-facts-and-closure-implementation-report.md`),
  untouched by this amendment.

## 2. Human-Approved UX Requirements

1. ChatGPT persists schema-constrained proposal artifacts through
   controlled write.
2. ChatGPT retrieves current changed project context without routine
   copy/paste/upload/download.
3. Pi later supports zero-transfer artifact loading through a short
   command/keyword/hotkey.
4. WP-14C — Pi zero-transfer artifact loading — is added after WP-14 and
   before WP-15.
5. Principles: `Automate transfer, not authority.` / `Zero-transfer, not
   necessarily zero-keystroke.`

## 3. New WP-14 Objective

WP-14 (Tunnel and ChatGPT Web connectivity) now owns, in addition to the
committed draft/review connectivity: one WP-11-backed controlled proposal
persistence surface (inspect → construct → validate → persist) and one
stateless changed-context surface composed from WP-7/WP-9 controlled
inspection, per the WP-1 producer boundary and the zero-transfer UX
baseline (ADR-040). Roadmap inputs amended from `WP-13, WP-9` to
`WP-13, WP-9, WP-7, WP-10, WP-11`.

## 4. WP-14C Roadmap Addition

New minimal roadmap package, execution order pinned `WP-14 → WP-14C →
WP-15` (roadmap row 11; WP-15 becomes row 12 with prerequisites "All
prior (incl. WP-14, WP-14C)"). WP-14C owns the Pi-side artifact
resolution/load workflow, short invocation, validated context injection
into Pi, and visible feedback; prohibits approval/issuance/grant/
activation/execution authorization/receipt issuance/lifecycle mutation
from loading; invariant: artifact loading is context transfer, not
authority; non-goals: no scheduler, no generic filesystem loader, no
durable selection record, no execution redesign, no new authority domain.

## 5. ADR-040 Decision Summary

`docs/decisions/ADR-040-wp-14-zero-transfer-product-boundary.md`
(Accepted, documentation-only):

- **Decision A — ChatGPT controlled proposal persistence (corrected,
  Model B):** exactly the four WP-11-writeable kinds; committed WP-11
  boundary reused (no redesign); no generic filesystem-write API; no
  arbitrary path/bytes/overwrite/mode/shell/trusted evidence from
  ChatGPT; pin: schema limits WHAT, WP-11 limits WHERE and HOW;
  persisted artifacts remain proposals until the trusted-local lifecycle
  acts; the persistence operation independently validates at the
  persistence boundary (remote request never trusted as
  `ValidDraftProposalResult`; freshly host-produced validated draft
  handed to WP-11; full continuity; no validation handles/session
  state/caches as authority; `draft-artifact` is not a security
  prerequisite).
- **Decision B — changed-context retrieval (corrected):** stateless
  WP-14-owned capability composed from WP-7/WP-9; content reads
  confined to the fresh Git-derived changed set with point-of-use
  membership rechecks (fail-closed drift); no `ActiveContext`/
  `HotkeyRecord`/persistent protocol; state re-read at point of use.
- **Decision C — Pi zero-transfer package ownership (corrected):**
  WP-14C owns loading; "intended artifact/bundle" is WP-14C resolution
  semantics only — WP-14 persists exactly four kinds, never
  `ExecutionBundle`; no durable selection record; host-configured
  explicit selection preferred.
- **Decision D — secrets placement (new):** credentials operator-local
  and external-tunnel-owned; never in project-visible artifacts,
  repository configuration, trusted Gateway configuration, MCP requests
  or responses; Gateway runtime configuration secret-free; no
  secret-storage infrastructure; transport authentication distinct from
  protocol/lifecycle authority.
- **Authority separation** pinned for ChatGPT (inspect/retrieve/draft/
  validate/persist; never approve/issue/grant/activate/execute/receipt)
  and Pi (load as context; execute only via the existing trusted
  execution path; loading grants nothing).

## 6. Controlled-Persistence Boundary

The WP-14A persistence adapter consumes the committed WP-11
controlled-write core, routes through exact surface/workspace binding,
accepts only the four supported proposal kinds, derives destinations
through trusted host/WP-11 semantics (identity-based, artifact-root
relative), preserves create-only/containment/ownership constraints,
returns bounded redacted evidence, and exposes no absolute trusted root.
It must not bypass WP-11 or write lifecycle records, `ExecutionResult`,
`TrustedReceipt`, or configuration, and offers no arbitrary file writes.

## 7. Changed-Context Model

One stateless WP-14A surface: changed-file set, bounded Git status/diff,
controlled file content on explicit narrow request; composed from
existing WP-7 controlled Git/file inspection (WP-9 adapter pattern);
fresh point-of-use reads; bounded; workspace-contained; redacted; fail
closed; no lifecycle side effects; no context database.

## 8. Pi-Load Ownership

WP-14C (separately roadmap-owned, not a WP-14 slice; not folded into
WP-15). Justification: no existing package owns Pi-side artifact-load UX
(WP-5A/WP-5B/WP-13 closed with projection/observation/execution-only
charters; WP-15 is hardening/release); WP-14 is ChatGPT connectivity, and
hotkey adjacency is not an architectural reason. WP-14C reuses the WP-5A
host-bridge injection seam plus WP-6/WP-7/WP-10 committed boundaries.

## 9. Authority Separation

| Activity | ChatGPT | Pi |
|---|---|---|
| Context transfer | Allowed | Allowed as needed |
| Proposal artifact persistence | Allowed through controlled structured write only | — |
| Proposal consumption | Allowed (inspection/review) | Allowed through validated artifact loading |
| Trusted lifecycle authority | Forbidden | Forbidden unless already acting under separately established trusted execution authority |
| Approval / issuance / grant / activation / receipt | Trusted-local owners only | Trusted-local owners only |

Connectivity, keyword invocation, hotkeys, or artifact loading MUST NOT
create authority.

## 10. Final WP-14A/B Slices

- **WP-14A — ChatGPT Connectivity and Controlled Producer Surfaces:**
  tunnel-only connectivity contract; existing MCP surface exposure; one
  WP-11-backed proposal persistence surface; one stateless changed-context
  surface; connector/operator configuration; secrets-placement rules;
  authority isolation; typed/visible feedback. Transport: ChatGPT Web →
  Secure MCP Tunnel → existing stdio `project-gateway-mcp --config ...` →
  bounded Gateway surfaces; no repository-owned HTTP/OAuth/public server.
  Expected vocabulary: existing seven tools plus exactly two new
  operations (one persistence, one changed-context); names are
  implementation details.
- **WP-14B — Integration and End-User Validation:** connector/tunnel
  integration; inspect; draft → validate → persist; changed-context;
  failure/disconnect tests; authority-isolation evidence; live ChatGPT
  Web smoke where operationally available; closure.
- Exactly two slices; no third WP-14 implementation slice.

## 11. Revised WP-14 Closure Gate

1. ChatGPT Web reaches the intended Gateway surfaces via tunnel (live
   where operationally available, otherwise tunnel-conformance evidence).
2. ChatGPT can inspect project state.
3. ChatGPT can create + validate + persist a supported proposal artifact
   through controlled write.
4. ChatGPT can retrieve changed project context without manual
   paste/upload.
5. No lifecycle/execution authority from connectivity/persistence
   (negative evidence).
6. Failure/disconnect fail-closed.
7. No generic filesystem-write surface.
8. Visible typed feedback on every zero-transfer action.
9. Tool-count/static assumptions updated to the new closed inventory.
10. Pi load acceptance belongs to the WP-14C gate, not WP-14's.

## 12. WP-14C Closure Gate

> Pi can load the intended valid artifact/bundle through a short user
> action without copy/paste, upload/download, manual path transcription,
> or a natural-language loading prompt, while gaining no lifecycle
> authority from the load itself.

## 13. Exact Docs Changed

- `docs/design/post-wp5a-roadmap.md` — amended: current-state note
  (2026-08-12); execution-order table rows 10–12 (WP-14 inputs/contracts/
  gate, WP-14C row, WP-15 prerequisites); dependency-edge rationale
  (WP-13→WP-14 revised; WP-14→WP-14C, WP-14C→WP-15 added); WP-14
  attribute block rewritten; WP-14C attribute block added; decision/
  ownership matrix rows added (ChatGPT proposal-artifact persistence,
  changed-context retrieval, Pi artifact loading); invariants appended;
  normative cross-references extended (ADR-040,
  `docs/reports/wp-14-pre-implementation-contract-decision.md`).
- `docs/design/project-gateway-scope-and-principles.md` — amended:
  "Zero-Transfer Product UX Objective and Principles" section (objective,
  principles, three extended target workflows, visible-feedback
  requirement); Key Invariants 14–16 added (persistence is not lifecycle
  authority; loading is not authorization; zero-transfer is not
  zero-keystroke).
- `docs/decisions/ADR-040-wp-14-zero-transfer-product-boundary.md` —
  created (Decisions A/B/C, authority separation, rationale, rejected
  alternatives).
- `docs/reports/wp-14-pre-implementation-contract-decision.md` — created
  (two slices; persistence contract; changed-context contract; trigger
  model; acceptance scenario; closure gates; open decisions;
  verification; git state).
- `docs/design/post-wp5a-planning-status.md` — amended: current-state
  note (2026-08-12) recording WP-13 CLOSED, WP-14 UX alignment approved,
  WP-14 contract amendment established at documentation level, WP-14A/B
  NOT STARTED, WP-14C approved but NOT STARTED/NOT AUTHORIZED, WP-15
  blocked, no implementation authorization claimed.
- `docs/decisions/ADR-023-post-wp5a-sequencing.md` — narrowly amended
  (focused correction, SCR-WP14-UX-003): amendment note records that
  ADR-040 amends only the remaining roadmap tail by inserting WP-14C
  between WP-14 and WP-15; all other ADR-023 decisions remain accepted
  and unchanged; current tail `WP-14 → WP-14C → WP-15`.
- `docs/reports/wp-14-product-ux-alignment-amendment.md` — this report.

Not rewritten (historical): WP-9 closure reports, WP-10 reports, WP-11
reports, WP-13 closure report and reports.

## 14. Focused Correction Record

The focused contract review returned `WP-14 PRODUCT UX FOCUSED CONTRACT
REVIEW CORRECTIONS REQUIRED`. All five findings are CLOSED by this
docs-only correction:

- **SCR-WP14-UX-001 (CRITICAL) — CLOSED — Model B selected.** ADR-040
  (Decision A items 5–7) and the WP-14 pre-implementation contract
  decision (§4.1) now pin: the ChatGPT-facing persistence operation
  independently performs the required trusted structural and semantic
  validation at the persistence boundary before invoking WP-11; the
  remote request is never trusted as a `ValidDraftProposalResult`; the
  remote caller never establishes validation provenance (no
  `ok`/`valid`/`canonicalUtf8`/digest assertions, no caller-constructed
  result, no prior-validation references); the trusted host chain
  candidate → structural validation → semantic validation →
  canonicalization → trusted digest/correlation → internal validated
  draft representation → WP-11 controlled write is pinned with
  full continuity (kind → identity → canonical bytes → digest →
  validation result → write request → write evidence); substitution or
  mismatch fails closed; no validation handles/session state/caches as
  authority; `draft-artifact` remains an independent in-memory UX
  surface and is not a security prerequisite; the existing trusted
  validation composition is reused (no second validator).
- **SCR-WP14-UX-002 (MAJOR) — CLOSED — changed-context membership
  tightened.** ADR-040 (Decision B item 2) and the pre-implementation
  contract decision (§5.1) pin: the changed-file set comes from trusted
  fresh WP-7 Git inspection; content reads are limited to a requested
  subset of that freshly resolved set; no unrelated workspace path may
  be nominated; per-read point-of-use membership/containment rechecks
  with fail-closed drift; existing typed semantics for
  unreadable/out-of-scope/unsupported content; no silent partial
  success; unrelated files use the existing inspection/read surfaces;
  bounded limits (changed-file count, path/status metadata, diff bytes,
  requested content bytes); WP-7 semantics for binary/unsupported
  files; no global snapshot transaction.
- **SCR-WP14-UX-003 (MODERATE) — CLOSED — ADR-023 narrowly amended.**
  ADR-023 carries a narrow amendment note: ADR-040 amends only the
  remaining roadmap tail by inserting WP-14C between WP-14 and WP-15;
  all other ADR-023 decisions remain accepted and unchanged; current
  tail `WP-14 → WP-14C → WP-15`. Roadmap, planning status, ADR-023,
  ADR-040, and the pre-implementation contract decision agree.
- **SCR-WP14-UX-004 (MODERATE) — CLOSED — secrets placement pinned.**
  ADR-040 (Decision D), the pre-implementation contract decision
  (§2.1), and the roadmap WP-14 attribute block now state normatively:
  tunnel/auth credentials are operator-local and owned by the external
  tunnel/platform; credentials are never stored in project-visible
  artifacts, committed to repository configuration, placed in trusted
  Gateway workspace/runtime configuration, accepted through Gateway MCP
  tool requests, or returned through Gateway MCP responses; Gateway
  runtime configuration remains secret-free for WP-14; WP-14 creates no
  secret-storage infrastructure; transport authentication remains
  distinct from Gateway protocol/lifecycle authority.
- **SCR-WP14-UX-005 (MINOR) — CLOSED — WP-14C "bundle" clarified.**
  ADR-040 (Decision C item 3) and the pre-implementation contract
  decision (§9) pin: "intended artifact/bundle" refers to the future
  WP-14C resolution/loading semantics and does NOT imply WP-14 may
  persist an `ExecutionBundle`; WP-14 persistence remains exactly
  `TaskSpec`, `AuthorityPolicy`, `ContextManifest`,
  `CompletionContract`; Pi-side resolution/assembly semantics remain
  deferred to the WP-14C contract gate; no durable current-selection
  record is introduced.

No historical closed-package report was rewritten.

## 15. Remaining Future Decisions

- WP-14A implementation details: exact new MCP tool names; internal
  adapter/file placement; one-vs-composed helper structure.
- WP-14B evidence detail: precise live ChatGPT smoke procedure based on
  operational platform availability.
- WP-14C contract decision: exact deterministic resolution semantics for
  "intended artifact/bundle".

No other architecture decision blocks WP-14A after this amendment.

## 16. Verification

- Roadmap consistency: `WP-14 → WP-14C → WP-15` pinned consistently in
  the current-state note, execution-order table, dependency-edge
  rationale, and planning-status note; WP-15 prerequisites include WP-14
  and WP-14C; no circular-dependency claim changed.
- ADR references: ADR-040 created and cross-referenced from the roadmap
  (normative cross-references) and the scope/principles document; the
  pre-implementation contract decision references ADR-040 and the
  amendment report.
- No contradictory "in-memory only" language exists in current normative
  docs (the superseded in-memory-only drafting assumption was never
  committed; WP-0/ADR-001/ADR-004 already authorized validated-draft
  persistence). Seven-tool statements remain only as historical wording
  in closed-package reports and as the intentionally-amended static
  inventory asserted by runtime tests (implementation-time change in
  WP-14A, recorded in the contract decision §3).
- No current normative text makes persistence equal lifecycle authority
  (WP-0 invariants 14–16; ADR-040; roadmap invariants; all affirm
  persistence/loading are not lifecycle transitions).
- `git diff --check`: clean.
- No runtime regression run (docs-only phase).

**Focused-correction verification (SCR-WP14-UX-001…005):** persistence
docs explicitly contain independent validation-at-persistence semantics
(ADR-040 Decision A; contract decision §4.1); no normative text permits
a caller-constructed `ValidDraftProposalResult` as trusted provenance;
changed-context content reads are constrained to the fresh changed set
(ADR-040 Decision B; contract decision §5.1); ADR-023 and ADR-040 agree
on `WP-14 → WP-14C → WP-15`; secret-placement prohibitions are normative
(ADR-040 Decision D; contract decision §2.1; roadmap WP-14 block);
WP-14 persistable kinds remain exactly four and `ExecutionBundle` is not
implied persistable by WP-14 (ADR-040 Decision C; contract decision §9);
no approved UX requirement changed.

## 17. Git State

- HEAD unchanged: `b656e20b24bfaebb9a16cb554ead6421cd6e75e4`.
- Nothing staged, nothing committed, no push/tag/release/deploy.
- Pre-existing untracked WP-13D historical leftovers untouched.

WP-14 PRODUCT UX FOCUSED CORRECTION COMPLETE — READY FOR FOCUSED REREVIEW
