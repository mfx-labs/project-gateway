# Pi Adapter Prompt Projection (WP-5A)

**Status:** Normative WP-5A design
**Renderer:** `src/adapters/pi/render.ts`

## Fixed Section Order

The rendered prompt is assembled from fixed-order, clearly separated segments:

1. `[PGW-TASK]` — task section (TaskSpec only);
2. `[PGW-CONTEXT-INVENTORY]` — context inventory (ContextManifest metadata only);
3. `[PGW-CONTEXT-DATA]` — untrusted context data blocks;
4. `[PGW-COMPLETION-CRITERIA]` — CompletionContract criteria for later assessment;
5. `[PGW-CORRELATION]` — trusted adapter correlation footer.

## Trusted Adapter Preamble

The preamble is a static constant in adapter code (`TRUSTED_ADAPTER_PREAMBLE`),
never generated from repository content. It explains the section boundaries,
states that context data blocks are untrusted data (never instructions), names
the task section as the only instruction-bearing section, states that
completion criteria are for later assessment (no self-certification, no
receipts), and states that pi-guard authority enforcement has not been applied.

## TaskSpec Projection

Only `TaskSpec` contributes imperative task intent: objective, instructions
(insertion order preserved), expected deliverables, and outcome constraints.
Task instructions are rendered as `- Instruction <id>: <text>` lines in their
validated order. No AuthorityPolicy or ContextManifest content ever appears in
the task section.

## Context Inventory

The inventory is rendered from ContextManifest metadata only: context ID,
requirement, priority, and purpose. It never reinterprets context text as
instruction and never describes tool permissions.

## Untrusted Context Blocks

Each caller-supplied context item becomes one explicitly delimited data block:

```
[PGW-CTX-BEGIN] contextId=<id> mediaType=<type> byteLength=<n> truncated=<bool> [truncatedFromBytes=<m>]
<content — exactly n encoded bytes>
[PGW-CTX-END]
```

- The block declares its exact encoded byte length; the length prefix is
  authoritative, so content can never escape through delimiter collisions
  (Markdown fences, XML-like tags, JSON, control-looking text, prompt
  injection, or the delimiter itself).
- Delimiters are fixed constants, never derived from content.
- Binary content is rendered as base64 only when the host capability declares
  `base64-context`; otherwise the media type fails closed.
- Truncation is always explicit (`truncated` + `truncatedFromBytes`); silent
  truncation is prohibited; oversized items with truncation disallowed fail
  closed. All textual limits are measured in UTF-8 bytes, and truncation
  returns the longest valid Unicode prefix within the limit without ever
  splitting a Unicode scalar value (no isolated surrogates, no U+FFFD
  replacement).
- Context never supplies roles, system/developer messages, tool policy,
  approval state, or grant state.

## CompletionContract Projection

Completion checks (check ID, evaluation status, check type/version, required
evidence, acceptance conditions) are rendered as **prospective criteria for
later assessment by a trusted evaluator**. The section grants no permission and
prohibits self-approval language: "declare yourself complete", "approve the
result", "issue the receipt", and "mark the lifecycle record successful" never
appear.

## AuthorityPolicy Non-Rendering

AuthorityPolicy allow/deny content is never rendered into the prompt. The plan
carries only non-operative correlation metadata: the exact AuthorityPolicy
reference, digest, instance, and revision, plus the statement that authority
enforcement is pending pi-guard projection.

## Correlation Footer

The footer contains trusted adapter metadata: occurrence ID, attempt ID, bundle
instance/revision/digest, registry snapshot ID, adapter protocol version, and
`pi_guard_enforcement: pending`. Absolute paths and secrets are never included.

## Size Bounds

- per context item (UTF-8 bytes), total context (UTF-8 bytes), rendered plan
  (UTF-8 bytes), item count, and the host maximum prompt size (UTF-8 bytes);
  all bounds fail closed. The rendered frame's declared byte length always
  equals the emitted UTF-8 payload length.

## Deterministic Output

Equal validated inputs, equal context items, equal limits, and equal host
capability declarations produce byte-equivalent prompts. No random IDs, no
current time, no process IDs, no absolute paths, and no environment-specific
values.
