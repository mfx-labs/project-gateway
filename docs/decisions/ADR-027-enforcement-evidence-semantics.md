# ADR-027 — Enforcement Evidence Semantics

## Status

Accepted

Accepted by the externally granted human approval of the Post-WP-5A
planning package (approval decision date 2026-08-05; planning commit
`97022a49d9029449f304a2b1e47f9dc8da4d4a89`; accepted final review:
POST-WP-5A FINAL DOCUMENTATION SPOT CHECK: ACCEPTED; open findings at
approval: zero). Acceptance derives from the external human decision, not
from the documentation operator.

## Context

WP-5A produces projections (`PiInvocationPlan`) and observations
(`PiExecutionObservation`); WP-13 will produce retrospective
`ExecutionResult`s; trusted receipts are separate trusted-local records
(ADR-012). Enforcement itself (WP-5B) needs a structured record of what
was projected, activated, and restored — without being confused with any
of those other record types.

## Decision

- Define the structured object **`PiEnforcementEvidence`** (contract in
  `pi-guard-compatibility-and-authority-projection.md` Part E) with fields
  for plan identity/fingerprint, authority-input identities,
  effective-authority identity, pi-guard and Pi identity/version, observed
  tool-inventory identity, projected allowed/denied tools, unsupported
  required capabilities, activation outcome, restoration outcome,
  compatibility findings, host-supplied timestamp source, and a
  deterministic evidence fingerprint.
- **`PiEnforcementEvidence` is not** an `ExecutionResult`, not a
  `TrustedReceipt`, not proof of execution success or completion, and not
  proof of authorization. It never issues authority, approves artifacts,
  activates a RuntimeGrant, replaces pi-guard runtime enforcement, or
  replaces local approval state.
- The following record classes are explicitly distinguished everywhere:
  projection evidence (pre-activation), activation evidence
  (`PiEnforcementEvidence`, contemporaneous), runtime observation
  (`PiExecutionObservation`, never permission), `ExecutionResult`
  (retrospective, WP-13), `TrustedReceipt` (separate and trusted; normative
  owner WP-15, input provider WP-13).
- Evidence timestamps come only from host-supplied sources (ADR-022
  timestamp rule); none are synthesized.
- **Two distinct identities (F-02/F-R2/F-R4):** `projectionIdentity` has
  one canonical definition (plan identity/fingerprint; exact authority-input
  identities; validated effective-authority identity; compatibility-result
  identity; observed effective tool-inventory identity; projected
  Enforcement Configuration identity; applicable workspace identity;
  capability-vocabulary version; evaluator/interface version) and
  **excludes** timestamps, activation/restoration outcomes, runtime
  observations, `ExecutionResult`, `TrustedReceipt`, and incidental host
  diagnostics. `evidenceFingerprint` is deterministic over the **complete
  canonical evidence record including present accepted timestamp values
  and timestamp-source identifiers**. Accepted timestamp values: finite
  non-negative safe integers (canonical base-10, no exponent notation,
  negative zero normalized) or non-empty opaque UTF-8 strings (byte-for-byte
  preservation, no normalization/conversion/parsing); `null`/`undefined`
  invalid; absent fields only by omission (distinct from zero, empty
  string, null, undefined); empty strings rejected; invalid values make the
  record malformed and fail closed; timestamp-source identifiers use a
  separately validated primitive-string contract; two independent
  implementations must produce identical canonical bytes for the same
  accepted record. Timestamp presence or absence never implies authority or
  execution success.

## Rationale

A named, bounded evidence type with an explicit non-authority contract
prevents enforcement records from being misread as execution proof or
receipts, and gives WP-13 (input provider) and WP-15 (normative receipt
owner) unambiguous input for result evaluation and trusted-receipt
issuance.

## Consequences

- WP-5B emits `PiEnforcementEvidence` only; it never emits
  `ExecutionResult` or `TrustedReceipt`.
- Observations never prove permission; enforcement evidence never proves
  completion.
- No adapter, artifact, or repository file may promote enforcement
  evidence to a receipt.

## Rejected Alternatives

1. **Reusing `ExecutionResult` for enforcement:** rejected — it is
  retrospective execution evaluation, not projection/activation record.
2. **Reusing `TrustedReceipt`:** rejected — receipts are trusted-local and
  separate; enforcement evidence is observational.
