/**
 * Shared WP-5A test world construction (non-test helper module).
 *
 * This module intentionally lives OUTSIDE any `*.test.ts` file so that test
 * files never import test files (F1): Node's test runner registers every test
 * in every imported module, so sharing helpers through a test file caused the
 * projection tests to execute redundantly in each importing process.
 */
import { buildWorld, cloneModel, corpusArtifactSet, customArtifact } from '../helpers.js';
import type { ArtifactSet } from '../helpers.js';

/** Build a world whose bundle references a custom member artifact exactly. */
export function buildWorldWith(set: ArtifactSet, member: 'task' | 'policy' | 'context' | 'completion'): ReturnType<typeof buildWorld> {
  const memberModel = set[member === 'task' ? 'task' : member === 'policy' ? 'policy' : member === 'context' ? 'context' : 'completion'];
  const bundle = cloneModel(set.bundle);
  const revision = memberModel['revision'] as Record<string, unknown>;
  const kindId = (memberModel['kind'] as Record<string, unknown>)['id'];
  const binding = memberModel['workspace_binding'] as Record<string, unknown>;
  const memberName = member === 'task' ? 'task' : member === 'policy' ? 'authority_policy' : member === 'context' ? 'context_manifest' : 'completion_contract';
  (bundle['body'] as Record<string, unknown>)[memberName] = {
    target_protocol_version: '1.0',
    target_kind: { id: kindId, version: '1.0' },
    target_instance_id: memberModel['instance_id'],
    target_revision_id: revision['id'],
    target_digest: revision['digest'],
    target_workspace_binding: binding,
  };
  const customBundle = customArtifact(bundle, () => {});
  return buildWorld({ ...set, bundle: customBundle });
}

export type { ArtifactSet };
