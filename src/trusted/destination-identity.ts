/**
 * WP-6 Phase 2B: deterministic destination-containment decision identity
 * (Model B).
 *
 * One deterministic identity binds the complete prospective destination
 * decision: destination-containment protocol version, operation class,
 * purpose, trusted configuration identity, host lane, workspace identity,
 * artifact kind, canonical artifact-relative destination, current canonical
 * artifact root, lexical existing-directory prefix components, canonical
 * existing-directory ancestor, destination tail components, target state
 * (`missing`), and the point-of-use revalidation requirement.
 *
 * Algorithm (repository conventions):
 * 1. fixed-shape canonical projection (explicit fixed key set;
 *    locale-independent — JCS sorts keys by code units);
 * 2. serialize with the repository RFC 8785 canonical serializer
 *    (`jcsSerialize`), producing deterministic UTF-8 bytes;
 * 3. SHA-256 over the domain prefix `PGAP-TRUSTED-DESTINATION-v1\0`
 *    followed by the canonical UTF-8 bytes, formatted `sha-256:<hex>`.
 *
 * The domain is distinct from `PGAP-TRUSTED-CONTAINMENT-v1\0` (Phase-2A
 * existing-path containment) and `PGAP-TRUSTED-CONFIG-v1\0` (trusted
 * configuration) under the ADR-009 domain-family convention; the `-v1`
 * suffix labels the hash-domain family, and the Phase-2B protocol version is
 * a digest-covered projection member.
 *
 * The public identity representation is the digest string only: raw paths
 * enter canonical bytes inside trusted-process hashing but are never exposed
 * by the digest, findings, workspace IDs, or any external projection. The
 * identity is prospective correlation data only — never approval identity,
 * authority identity, RuntimeGrant identity, write permission, or receipt
 * identity. No identity is created for any existing final target.
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../canonical/jcs.js';
import type {
  ArtifactDraftKind,
  ProspectiveDestinationTargetState,
} from './destination-types.js';

export const DESTINATION_DECISION_DIGEST_DOMAIN = 'PGAP-TRUSTED-DESTINATION-v1\u0000';

export const DESTINATION_DECISION_DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;

export interface DestinationDecisionIdentityInput {
  readonly destinationContainmentProtocolVersion: string;
  readonly operationClass: string;
  readonly purpose: string;
  readonly configurationIdentity: string;
  readonly hostLane: string;
  readonly workspaceId: string;
  readonly artifactKind: ArtifactDraftKind;
  readonly canonicalArtifactRelativeDestination: string;
  readonly currentCanonicalArtifactRoot: string;
  readonly lexicalExistingDirectoryPrefixComponents: readonly string[];
  readonly canonicalExistingDirectoryAncestor: string;
  readonly destinationTailComponents: readonly string[];
  readonly targetState: ProspectiveDestinationTargetState;
  readonly pointOfUseRevalidationRequired: true;
}

export interface DestinationDecisionIdentity {
  /** Canonical projection (fixed shape). */
  readonly projection: Readonly<Record<string, unknown>>;
  /** Canonical UTF-8 serialization (deterministic bytes). */
  readonly canonicalUtf8: string;
  /** Domain-separated SHA-256 digest. */
  readonly digest: string;
}

function computeDigest(canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(DESTINATION_DECISION_DIGEST_DOMAIN, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

/** Build the canonical projection for a destination-containment decision. */
export function destinationDecisionProjection(
  input: DestinationDecisionIdentityInput,
): Record<string, unknown> {
  return {
    destinationContainmentProtocolVersion: input.destinationContainmentProtocolVersion,
    operationClass: input.operationClass,
    purpose: input.purpose,
    configurationIdentity: input.configurationIdentity,
    hostLane: input.hostLane,
    workspaceId: input.workspaceId,
    artifactKind: input.artifactKind,
    canonicalArtifactRelativeDestination: input.canonicalArtifactRelativeDestination,
    currentCanonicalArtifactRoot: input.currentCanonicalArtifactRoot,
    lexicalExistingDirectoryPrefixComponents: [...input.lexicalExistingDirectoryPrefixComponents],
    canonicalExistingDirectoryAncestor: input.canonicalExistingDirectoryAncestor,
    destinationTailComponents: [...input.destinationTailComponents],
    targetState: input.targetState,
    pointOfUseRevalidationRequired: input.pointOfUseRevalidationRequired,
  };
}

/** Compute the deterministic identity of a prospective destination decision. */
export function computeDestinationDecisionIdentity(
  input: DestinationDecisionIdentityInput,
): DestinationDecisionIdentity {
  const projection = destinationDecisionProjection(input);
  const canonicalUtf8 = jcsSerialize(projection);
  const digest = computeDigest(canonicalUtf8);
  return { projection, canonicalUtf8, digest };
}
