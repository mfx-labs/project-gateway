# ADR-016 Addendum — Lane-Specific Identity Oracles (POUV2 static identities)

**Status:** Accepted (PS-6 focused correction gate; the POUV2
lane-specific oracle decision was HUMAN-approved before implementation).
**Applies to:** the POUV2 conformance fixtures whose `expect` carries a
static-input correlation identity, and the conformance runner's static
identity comparison.
**Related:** ADR-016 (conformance fixtures and digest vectors),
ADR-042 (darwin-arm64 trusted host lane), SIR-PS6-001.

## Context

ADR-016 makes the manifest-driven corpus an executable oracle whose
digest values "are protocol contract, not implementation-specific tests"
and requires reviewed protocol evolution for any change that alters
digest values. The POUV2 static-input projection embeds the
`configurationIdentity` of the validated trusted configuration, and
`hostLane` is a first-class member of the configuration identity
projection. With the PS-6 second accepted lane
(`darwin-arm64-posix-utf8-node22`), otherwise-identical POUV2 inputs
legitimately produce different `staticInputCorrelationIdentity` values
per lane. The committed single-lane oracle values (linux lane) therefore
cannot be the expectation for the darwin lane. This addendum is the
reviewed protocol evolution ADR-016 requires.

## Decision

1. **Lane-keyed expected static identities.** For the exactly nine POUV2
   fixtures that assert a static-input correlation identity
   (POUV2-003, 004, 009, 011, 012, 018, 022, 024, 031), the fixture
   `expect` gains a `staticIdentityByLane` object keyed by the accepted
   trusted host lane constants:
   `linux-x86_64-posix-utf8-node22` and
   `darwin-arm64-posix-utf8-node22`. Both accepted lanes MUST be present;
   an incomplete or malformed map is a protocol error and fails closed.
2. **Linux oracle values are byte-preserved.** Every existing Linux
   `expect.static_identity` value and every existing `oracle` field is
   unchanged; the Linux entry of `staticIdentityByLane` equals the
   preserved single-lane value exactly. No existing Linux vector is
   recomputed or mutated.
3. **Shared semantic oracle.** Fixture inputs, the `static_projection`
   oracle, eligibility, findings, rules, and all non-lane-dependent
   expectations remain single and shared. The darwin identity input is
   supplied as one additional literal,
   `oracle.darwinConfigurationIdentity` (the darwin-lane configuration
   identity digest); the darwin expected static identity is independently
   derivable from the shared projection with that literal substituted,
   using the committed JCS primitive and the exact domain prefix.
4. **Selection is keyed only by the validated `TrustedHostLane`.** The
   conformance runner selects the expected static identity solely from
   the lane operand it validated with; no other field participates in the
   selection.
5. **No identity or authority algorithm changed.** The configuration
   identity algorithm, the `configurationIdentity` projection, fixture
   inputs, eligibility semantics, findings, rules, and artifact
   canonicalization are untouched. Only the per-lane *expectation
   selection* for the already lane-bound static identity is recorded.
6. **Authoritative conformance per lane.** Each accepted lane must pass
   all authoritative vectors (648/648). Expected-failure allowances for
   lane-bound identity divergence are forbidden; a lane that cannot pass
   is not a conformance-green lane.

## Consequences

- Linux conformance remains green against byte-identical committed
  Linux oracles; darwin-arm64 conformance is green against the
  lane-keyed darwin expectations.
- Future accepted lanes must add their lane key to every
  `staticIdentityByLane` oracle under this same reviewed protocol
  evolution, or their conformance run fails closed on the incomplete
  oracle.
- The committed corpus bundle regenerates deterministically from the
  fixtures (byte-reproducibility test unchanged).
