/**
 * Accepted capability vocabulary v1 (WP-6 Phase 1).
 *
 * The canonical capability identifiers are the accepted v1 vocabulary from
 * `docs/design/capability-vocabulary.md` (ADR-025 Accepted). The vocabulary is
 * owned by Artifact Core protocol and maintained only through reviewed core
 * changes; repository content cannot extend it. Configuration-side ceiling
 * declarations must reference exactly these identifiers; unknown identifiers
 * fail closed.
 *
 * Vocabulary version: the v1 vocabulary is the accepted configuration-side
 * vocabulary version `v1` for this package.
 */
export const CAPABILITY_VOCABULARY_VERSION = 'v1';

export const CAPABILITY_VOCABULARY_V1: readonly string[] = Object.freeze([
  'project-gateway.workspace-read',
  'project-gateway.project-inspect',
  'project-gateway.git-inspect',
  'project-gateway.artifact-draft',
  'project-gateway.controlled-write',
  'project-gateway.file-edit',
  'project-gateway.file-create',
  'project-gateway.file-delete',
  'project-gateway.file-move',
  'project-gateway.shell-execute',
  'project-gateway.git-mutate',
  'project-gateway.network-external',
  'project-gateway.service-local',
  'project-gateway.tool-inventory-inspect',
  'project-gateway.pi-model-execute',
  'project-gateway.pi-tool-execute',
  'project-gateway.approval-operate',
  'project-gateway.lifecycle-issue',
]);

const VOCABULARY_SET: ReadonlySet<string> = new Set(CAPABILITY_VOCABULARY_V1);

import { compareStrings } from './ordering.js';

export function isKnownCapability(id: string): boolean {
  return VOCABULARY_SET.has(id);
}

/** Canonical set ordering: sorted (code-unit order), deduplicated (input duplicates are rejected by the validator). */
export function canonicalCapabilitySet(capabilities: readonly string[]): readonly string[] {
  return Object.freeze([...capabilities].sort(compareStrings));
}
