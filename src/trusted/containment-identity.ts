/**
 * WP-6 Phase 2A: deterministic containment-decision identity.
 *
 * One deterministic identity binds the complete prospective containment
 * decision: containment protocol version, operation class, purpose,
 * trusted configuration identity, host lane, workspace identity, canonical
 * workspace-relative path, canonical resolved internal path, and the
 * point-of-use revalidation requirement.
 *
 * Algorithm (repository conventions):
 * 1. fixed-shape canonical projection (explicit omission rules; fixed key
 *    set; locale-independent — JCS sorts keys by code units);
 * 2. serialize with the repository RFC 8785 canonical serializer
 *    (`jcsSerialize`), producing deterministic UTF-8 bytes;
 * 3. SHA-256 over the domain prefix `PGAP-TRUSTED-CONTAINMENT-v1\0`
 *    followed by the canonical UTF-8 bytes, formatted `sha-256:<hex>`.
 *
 * The public identity representation is the digest string only: raw paths
 * enter canonical bytes inside trusted-process hashing but are never exposed
 * by the digest, findings, workspace IDs, or any external projection. The
 * identity is prospective correlation data only — never approval identity,
 * authority identity, RuntimeGrant identity, or receipt identity.
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../canonical/jcs.js';
import type { ContainmentPurpose } from './containment-types.js';

export const CONTAINMENT_DECISION_DIGEST_DOMAIN = 'PGAP-TRUSTED-CONTAINMENT-v1\u0000';

export const CONTAINMENT_DECISION_DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;

export interface ContainmentDecisionIdentityInput {
  readonly containmentProtocolVersion: string;
  readonly operationClass: string;
  readonly purpose: ContainmentPurpose;
  readonly configurationIdentity: string;
  readonly hostLane: string;
  readonly workspaceId: string;
  readonly canonicalWorkspaceRelativePath: string;
  readonly resolvedAbsolutePath: string;
  readonly pointOfUseRevalidationRequired: true;
}

export interface ContainmentDecisionIdentity {
  /** Canonical projection (fixed shape). */
  readonly projection: Readonly<Record<string, unknown>>;
  /** Canonical UTF-8 serialization (deterministic bytes). */
  readonly canonicalUtf8: string;
  /** Domain-separated SHA-256 digest. */
  readonly digest: string;
}

function computeDigest(canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(CONTAINMENT_DECISION_DIGEST_DOMAIN, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

/** Build the canonical projection for a containment decision. */
export function containmentDecisionProjection(
  input: ContainmentDecisionIdentityInput,
): Record<string, unknown> {
  return {
    containmentProtocolVersion: input.containmentProtocolVersion,
    operationClass: input.operationClass,
    purpose: input.purpose,
    configurationIdentity: input.configurationIdentity,
    hostLane: input.hostLane,
    workspaceId: input.workspaceId,
    canonicalWorkspaceRelativePath: input.canonicalWorkspaceRelativePath,
    resolvedAbsolutePath: input.resolvedAbsolutePath,
    pointOfUseRevalidationRequired: input.pointOfUseRevalidationRequired,
  };
}

/** Compute the deterministic identity of a prospective containment decision. */
export function computeContainmentDecisionIdentity(
  input: ContainmentDecisionIdentityInput,
): ContainmentDecisionIdentity {
  const projection = containmentDecisionProjection(input);
  const canonicalUtf8 = jcsSerialize(projection);
  const digest = computeDigest(canonicalUtf8);
  return { projection, canonicalUtf8, digest };
}
