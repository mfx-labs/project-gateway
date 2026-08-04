# ADR-021 — Pi Prompt and Context Projection

## Status

Accepted

## Context

A Pi invocation plan must carry task intent, untrusted context data, and
prospective completion criteria in one deterministic prompt without letting
context or policy content become instruction authority.

## Decision

- **TaskSpec-only task authority:** the task section is the only
  artifact-derived section that may contain direct task intent; instructions
  preserve validated order.
- **Context as data:** resolved context items are caller-supplied, bound to
  ContextManifest entries (exact set: unknown, duplicate, missing required, and
  extra items rejected), ordered by manifest order, and rendered as untrusted
  data blocks with fixed delimiters and an authoritative length prefix, so
  content cannot escape its boundary through delimiter collisions; context
  never supplies roles, system/developer messages, tool policy, approval, or
  grant state.
- **CompletionContract criteria:** completion checks render as prospective
  criteria for later assessment, never as permission, tool authority, approval,
  or self-certification instructions.
- **No AuthorityPolicy rendering:** AuthorityPolicy is correlated by exact
  reference and digest only; allow/deny content is never rendered as
  executable instructions.
- **Deterministic boundary representation:** fixed section order, fixed
  delimiters, length-prefixed blocks, and deterministic ordering of members,
  context items, findings, and correlations; equal inputs produce
  byte-equivalent prompts.

## Rationale

Length-prefixed framing makes boundaries unambiguous regardless of content;
fixed delimiters remove any content-dependent ambiguity; TaskSpec-only intent
and non-rendered policy preserve the no-authority boundary.

## Consequences

- Context injection attempts (including "ignore previous instructions" text)
  remain inert inside their data blocks.
- The adapter never tells Pi that it is permitted to use specific tools.
