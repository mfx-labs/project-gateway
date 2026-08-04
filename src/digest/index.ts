/**
 * Canonical projections and domain-separated SHA-256 digests for artifact
 * revisions and RegistrySnapshots. Domains are distinct and non-substitutable.
 * Input is never mutated.
 */
import { createHash } from 'node:crypto';
import { jcsSerialize } from '../canonical/jcs.js';

export const ARTIFACT_DIGEST_DOMAIN = 'PGAP-ARTIFACT-REVISION-v1\u0000';
export const REGISTRY_DIGEST_DOMAIN = 'PGAP-REGISTRY-SNAPSHOT-v1\u0000';

export const DIGEST_RE = /^sha-256:[0-9a-f]{64}$/;

export interface ArtifactProjection {
  readonly projection: Readonly<Record<string, unknown>>;
  readonly canonicalUtf8: string;
  readonly digest: string;
  readonly domain: string;
}

export interface RegistryProjection {
  readonly projection: Readonly<Record<string, unknown>>;
  readonly canonicalUtf8: string;
  readonly digest: string;
  readonly domain: string;
}

function computeDigest(domain: string, canonicalUtf8: string): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(canonicalUtf8, 'utf8');
  return 'sha-256:' + hash.digest('hex');
}

/**
 * Build the artifact canonical projection: the parsed model with `annotations`
 * and `revision.digest` removed. Everything else is retained exactly.
 */
export function artifactProjection(model: Readonly<Record<string, unknown>>): ArtifactProjection {
  const projection: Record<string, unknown> = {};
  for (const k of Object.keys(model)) {
    if (k === 'annotations') continue;
    projection[k] = model[k];
  }
  const revision = projection['revision'] as Record<string, unknown> | undefined;
  if (revision && typeof revision === 'object') {
    const next: Record<string, unknown> = {};
    for (const k of Object.keys(revision)) {
      if (k === 'digest') continue;
      next[k] = revision[k];
    }
    projection['revision'] = next;
  }
  const canonicalUtf8 = jcsSerialize(projection);
  const digest = computeDigest(ARTIFACT_DIGEST_DOMAIN, canonicalUtf8);
  return { projection, canonicalUtf8, digest, domain: ARTIFACT_DIGEST_DOMAIN };
}

/** Verify a declared artifact digest against the recomputed canonical digest. */
export function verifyArtifactDigest(model: Readonly<Record<string, unknown>>, declared: string): boolean {
  const { digest } = artifactProjection(model);
  return digest === declared;
}

/**
 * Build the RegistrySnapshot canonical projection: the parsed model with
 * `snapshot_digest` removed.
 */
export function registryProjection(model: Readonly<Record<string, unknown>>): RegistryProjection {
  const projection: Record<string, unknown> = {};
  for (const k of Object.keys(model)) {
    if (k === 'snapshot_digest') continue;
    projection[k] = model[k];
  }
  const canonicalUtf8 = jcsSerialize(projection);
  const digest = computeDigest(REGISTRY_DIGEST_DOMAIN, canonicalUtf8);
  return { projection, canonicalUtf8, digest, domain: REGISTRY_DIGEST_DOMAIN };
}

export function verifyRegistryDigest(model: Readonly<Record<string, unknown>>, declared: string): boolean {
  const { digest } = registryProjection(model);
  return digest === declared;
}

/** Normalized digest syntax comparison. */
export function digestMatches(a: string, b: string): boolean {
  return a === b && DIGEST_RE.test(a);
}
