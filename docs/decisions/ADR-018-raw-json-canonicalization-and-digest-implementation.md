# ADR-018 — Raw JSON, Canonicalization, and Digest Implementation

## Status

Accepted

## Context

WP-2/WP-3 require duplicate-member rejection before parser object construction,
NFC validation without transformation, safe-integer restrictions, RFC 8785
canonical serialization, and domain-separated SHA-256 digests for artifacts and
registry snapshots. WP-4 must choose concrete strategies without weakening the
approved protocol.

## Decision

- **Duplicate members:** a purpose-built internal scanner validates the raw text
  first (byte and nesting bounds, UTF-8, duplicate-member detection at every
  object depth with source locations) and only then invokes `JSON.parse` on the
  now-safe text. First-wins or last-wins behavior is impossible because
  duplicates are rejected before construction.
- **Surrogates:** valid escaped surrogate pairs (`\uD83D\uDE00`) and literal
  supplementary characters are accepted and produce the same accepted value;
  isolated escaped high/low surrogates, high surrogates not followed by a low
  surrogate, and raw lone surrogates are rejected. Caller-provided JavaScript
  strings are scanned in UTF-16 code units before UTF-8 encoding so
  `TextEncoder` can never silently replace a lone surrogate with U+FFFD; byte
  input is decoded strictly with fatal errors. No normalization, repair, or
  replacement of invalid input ever occurs.
- **Immutable snapshot:** validated wrappers own a defensive deep snapshot of
  plain JSON values (own data-property descriptors only; no caller prototypes,
  getters, methods, symbols, or class instances; accessors never invoked),
  deeply frozen with null-prototype objects so prototype pollution is invisible.
  Snapshot traversal state is strictly per top-level `snapshotJson()` call: a
  recursion stack distinguishes true cycles from repeated acyclic shared
  references, cleanup uses `try/finally`, and no module-global WeakMap/WeakSet
  holds traversal state, so a failed call cannot affect later calls, other
  inputs, other library instances, or concurrent/reentrant calls. Documented
  repeated-reference policy: repeated acyclic shared references are accepted
  and materialized as independent deeply-frozen JSON subtrees; only actual
  cycles are rejected (deterministically).
- **Private membership branding:** runtime branding uses module-private
  `WeakSet` membership with public type guards (`isBrandedArtifact`,
  `isBrandedRegistry`, `isBrandedRecord`); no brand is stored as an own symbol
  property, string property, exported token, global symbol, or enumerable
  metadata, so `Object.getOwnPropertySymbols(wrapper)` reveals no brand
  capability and a spread, clone, proxy, or forged lookalike is never a member.
  Artifact, registry snapshot, and lifecycle record memberships are distinct;
  membership is valid only within the physical module instance that created the
  wrapper (no `Symbol.for`, no process-global membership). Each wrapper records
  its explicit validation level.
- **Protocol equality (W4-F1):** workspace-binding, exact-reference, and
  bundle-reference equality is owned by one consumer-neutral internal module
  (`src/internal/protocol-equality.ts`) and compares explicit protocol fields
  only; ordinary `JSON.stringify` is never a protocol equality mechanism.
  Cross-artifact, lineage, and lifecycle retry evaluation use these
  comparators, so member insertion order never changes an equality decision.
- **NFC and integers:** digest-covered strings must already be NFC and are
  rejected otherwise; never normalized or repaired. JSON numbers must be safe
  integers in the approved range; unsafe or non-finite numbers are rejected.
- **RFC 8785:** an internal serializer implements JCS for the protocol input set
  (UTF-16 code-unit key ordering, shortest control-character escapes, integer
  number output, `-0` normalized to `0`, array order preserved). It is verified
  against all 19 committed digest vectors; any candidate that silently
  normalizes strings, reorders arrays, or accepts unsafe numbers was rejected.
- **Digests:** `node:crypto` SHA-256 over the domain prefix plus the canonical
  UTF-8 bytes. Artifact domain `PGAP-ARTIFACT-REVISION-v1\0` (projection
  excludes only `annotations` and `revision.digest`); registry domain
  `PGAP-REGISTRY-SNAPSHOT-v1\0` (projection excludes only `snapshot_digest`).
  Domains are distinct and non-substitutable; digest comparison uses the exact
  serialized syntax `sha-256:` plus 64 lowercase hex digits.

## Rationale

Internal scanner and serializer keep the trust surface minimal and deterministic,
and the committed vectors prove correctness. Node's crypto is the platform
SHA-256 implementation already required by the protocol.

## Consequences

- No external parser or canonicalizer dependency is introduced.
- Any change to the scanner or serializer must re-pass all 19 vectors and the
  full conformance corpus.

## Rejected Alternatives

1. **`JSON.parse` with duplicate detection after parsing:** Rejected because it
   cannot distinguish duplicates after construction.
2. **Silent Unicode normalization:** Rejected because it makes validators and
   consumers reason about different content.
3. **Third-party JCS packages:** Rejected in favor of a reviewed internal
   implementation verified by the corpus.
