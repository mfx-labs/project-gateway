# ADR-012 — Execution Result Provenance and Publication

## Status

Accepted

## Context

WP-1 establishes `ExecutionResult` as a retrospective project-visible artifact and explicitly separates it from a trusted receipt, but defers candidate adoption, evaluator provenance, publication, privileged consumption, receipt correlation, revocation, and supersession. Applying prospective-artifact approval and issuance terms unchanged would blur reporting with authority.

## Decision

`ExecutionResult` uses a dedicated result lifecycle. A candidate result is untrusted project-visible content with no trusted attempt-to-result-instance ownership. The first compatible completion evaluator may originate one result instance or adopt one exact validated candidate revision, atomically establishing the unique evaluator-produced result instance for that exact workspace, bundle, occurrence, and attempt. A trusted `ResultPublicationRecord` is required to attest evaluator provenance, that unique result instance, validation, exact result revision/bundle/workspace/occurrence/attempt binding, exact registry context, publication mode, and allowed consumption scope. A second distinct result instance for one attempt fails closed.

`ExecutionResult` does not receive `ApprovalRecord` or `IssuanceRecord`. A published result with evaluator provenance is sufficient for ordinary review. Completion-status consumption, downstream automation, and authoritative reporting additionally require exact matching trusted receipt correlation, current non-revocation, compatible consumer support, and an explicit publication scope. Publication is neither a trusted receipt nor a prospective authorization decision.

Corrections create new immutable revisions of the same unique result instance and preserve its workspace, bundle, occurrence, and attempt association. A `SupersessionRecord` can designate a later revision or publication of that same instance for a stated scope. A `RevocationRecord` can withdraw a publication without deleting historical result content; it cannot revoke an activation, occurrence, attempt, receipt, or supersession event.

## Rationale

The chosen model allows credible evaluator ownership and ordinary review while requiring stronger trusted correlation before a result drives a completion conclusion, automation, or authoritative report. It preserves audit history and prevents a retrospective report from becoming authority or receipt evidence by label.

## Consequences

- Filename, repository location, candidate author, annotation, and embedded evaluator claim cannot establish provenance.
- Human and ChatGPT inspection of candidate content remains permitted only as untrusted review under normal read policy.
- An attempt can have no evaluator-produced result; the protocol does not fabricate one when evaluation evidence is unavailable. If it has one, trusted correlation permits exactly one evaluator-produced result instance.
- Result publication binds receipt correlation only for uses that require it; it never contains or replaces the receipt.
- A withdrawn or superseded result remains historical and inspectable but cannot be used through the withdrawn/superseded scope; competing current publications in one result-instance scope fail closed until explicit revocation or supersession resolves them.
- Result-driven automation still requires independent effective authority for any action it performs.

## Rejected Alternatives

1. **Treat result validation as evaluator provenance:** Rejected because conformance does not establish who assumes result-production responsibility.
2. **Treat results as approved and issued prospective artifacts:** Rejected because retrospective reporting has different trust and use semantics.
3. **Allow automation after evaluator claim alone:** Rejected because execution occurrence facts need trusted receipt correlation.
4. **Require receipt correlation for all human inspection:** Rejected because untrusted or provenance-published review does not itself create authority.
5. **Publish two evaluator-produced result instances for one attempt:** Rejected because it creates competing evaluator ownership; corrections must remain revisions of the first unique instance.
6. **Use publication as a trusted receipt:** Rejected because publication attests result provenance/use scope, not lifecycle or execution-event facts.
7. **Rewrite erroneous result content:** Rejected because immutable correction history requires new revisions and explicit supersession.
