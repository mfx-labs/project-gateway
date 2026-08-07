# ADR-032 — WP-8-I Externally Authorized Disposition

**Status:** Accepted (WP-8-I implementation; contract §16.6/DPS-001…007 was
added by this decision).

## Context

The committed recovery assessment classifies several object families as
`requires-external-disposition`: WPR-023 (d) temporaries (16.5 "remain
untouched (disposition required)"), malformed/foreign/conflicting
quarantine artifacts, and conflicting registry-index artifacts (WP-8-H §7
"rebuild collides; disposition required"). The contract previously
defined NO disposition mutation primitive: scanner classification and
recovery-plan data are explicitly non-authoritative, and the WP-8-F/8-G
slices deliberately left disposition untouched. This decision fixes, per
target class, whether disposition is a storage mutation or
adjudication-only, and the exact primitive, authority, and evidence
model.

## Decisions

1. **WPR-023 (d) temporaries remain preservation/adjudication-only in the
   MVP.** The storage layer must never mutate a WPR-023 (d) target: its
   state is "other (quarantine and recovery-required)" — the residual
   class whose content relationship to a publication is unknowable from
   durable facts (wrong type/UID/mode, changed-during-read, special
   files). Unlinking or transitioning it would be the same guessing the
   contract forbids, and quarantining it would silently convert an
   uncertain state into a durable one. The operation
   `dispose-wpr023d-temporary` therefore only re-verifies and returns the
   deterministic `disposition-required` result; no mutation and no
   evidence is ever produced for it. Preservation is the default when
   durable facts are insufficient to justify destruction.
2. **Isolated quarantine regular files may be explicitly unlinked.** A
   malformed, foreign, or conflicting quarantine object that is a
   policy-compliant regular file (exact UID/mode, bounded size,
   `nlink === 1`, descriptor-bound, exact digest) is a fully identified,
   isolated, already-quarantined artifact: its content is bounded and
   digest-bound, it is not a canonical record or audit, it is not linked
   to any other name, and it occupies no derived record identity. Unlike
   WPR-023 (d), every durable fact needed to identify it exactly is
   knowable. Explicit external authorization plus exact re-verification
   therefore justifies unlink-with-evidence. The remaining quarantine
   states (wrong-type, wrong-UID/mode, unexpected-hard-link, valid,
   missing-evidence, interrupted-link, directories, symlinks, special
   files, uncertain identities) stay adjudication-only: their destruction
   would require guessing (a symlinked name, a contested link count, or a
   live valid quarantine) or would destroy recoverable state.
3. **Conflicting derived index objects may be explicitly unlinked.** The
   index is derived cache (RGY-007): it grants nothing, and the
   authoritative registry is rebuilt from records/audits alone. A
   conflicting artifact occupying the exact deterministic derived index
   identity is a fully identified, bounded, digest-bound regular file
   whose bytes fail the canonical identity/root re-derivation; it blocks
   the authorized rebuild forever (no-replace publication collides).
   External authorization plus exact re-verification justifies unlink of
   exactly that one artifact so the rebuild can publish the correct
   index. Stale historical indexes, current-valid indexes, unrelated
   malformed or foreign entries, directories, symlinks, and recursive
   `index/` deletion remain prohibited: they are either harmless derived
   state or not identifiable as the exact conflicting object.
4. **Generic deletion and a new evidence kind were rejected.** A generic
   `delete-object`/`dispose-any` operation would let one authority cover
   multiple target classes whose destruction rationale differs (and some
   classes — WPR-023 (d), tamper-class records, locks — must never be
   deleted by this mechanism), violating least authority. A new
   `disposition-evidence` kind would expand the closed TAX-013 evidence
   taxonomy for what is still a recovery action: the existing
   `StoreEvidenceRecord` with `evidenceKind: recovery-evidence` already
   carries the recovery action identity, digest bindings, and audit
   linkage, and the exact disposition operation in the payload
   distinguishes the mutation deterministically. Per-operation
   domain-separated evidence identities keep the evidence replay
   idempotent without a taxonomy change.

## Consequences

- `dispose-wpr023d-temporary` is adjudication-only; `dispose-quarantined-temporary`
  and `dispose-conflicting-index` execute the exact unlink-plus-directory-
  fsync primitive for their eligible subclasses with durable
  `recovery-evidence` and its `authorized-write` audit before success.
- The contract gained §16.6 and DPS-001…007; its pinned SHA-256 was
  updated. No other contract change was required.
