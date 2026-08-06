/**
 * WP-8-C trusted bootstrap input and action provenance (ADR-028 decisions
 * B/D10-D12).
 *
 * Two semantically distinct private authenticity domains live in this
 * module: `StorageBootstrapActionProvenance` and `TrustedStorageBootstrapInput`.
 * Each uses its own module-private `WeakSet`; no brand collection is
 * exported; there is no structural or own-symbol brand; genuineness is
 * process-local only; JSON, spread, structured clone, prototype imitation,
 * Proxy, and reflection-created lookalikes are not members and fail every
 * verifier.
 *
 * The action-provenance creator has exactly one future production consumer:
 * `src/control-plane/storage-bootstrap-action.ts` (the trusted control-plane
 * bootstrap composition root). That producer does NOT exist in WP-8-C, so no
 * production source module may import the creator (enforced by the static
 * guard); test-only use is permitted from the authorized storage test files.
 *
 * The trusted-bootstrap-input creator is imported only by
 * `src/storage/initialization/initialize.ts` (enforced by the static guard).
 *
 * Actual WP-6 provenance limitation (W8C-D10/D12): a genuine WP-6 validated
 * trusted configuration proves trusted configuration provenance only; its
 * current provenance contains `sourceKind` and does NOT contain the
 * storage-bootstrap action identity, locator, service UID, forbidden-root
 * set, or limit-profile identity. Action identity comes only from a genuine
 * `StorageBootstrapActionProvenance`; neither operand implies the other.
 */
import { isGenuineValidatedTrustedWorkspaceConfiguration } from '../../trusted/configuration-brand.js';
import type { SelectedLimitProfile } from '../limits/limits.js';

/** Fields bound into one genuine storage-bootstrap action (producer-owned). */
export interface StorageBootstrapActionProvenance {
  readonly actionIdentity: string;
  /** Already-resolved absolute trusted-parent locator. */
  readonly locator: string;
  readonly serviceUid: number;
  /** Canonical absolute paths of governed repository/workspace roots. */
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly limitProfile: SelectedLimitProfile;
}

/** Accepted immutable trusted bootstrap input (correlated, gated). */
export interface TrustedStorageBootstrapInput {
  readonly actionIdentity: string;
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly limitProfile: SelectedLimitProfile;
}

export type TrustedInputRejectionReason =
  | 'not-genuine-configuration'
  | 'not-genuine-action-provenance'
  | 'configuration-identity-mismatch'
  | 'locator-mismatch'
  | 'service-uid-mismatch'
  | 'forbidden-roots-mismatch'
  | 'limit-profile-mismatch';

export interface TrustedInputResult {
  readonly ok: boolean;
  readonly input?: TrustedStorageBootstrapInput;
  readonly reason?: TrustedInputRejectionReason;
  readonly message?: string;
}

const actionProvenanceBrand = new WeakSet<object>();
const trustedInputBrand = new WeakSet<object>();

function freezeProvenance(fields: StorageBootstrapActionProvenance): StorageBootstrapActionProvenance {
  Object.freeze(fields.forbiddenRoots);
  Object.freeze(fields.limitProfile);
  return Object.freeze(fields);
}

function freezeInput(input: TrustedStorageBootstrapInput): TrustedStorageBootstrapInput {
  Object.freeze(input.forbiddenRoots);
  Object.freeze(input.limitProfile);
  return Object.freeze(input);
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

function sameLimitProfile(a: SelectedLimitProfile, b: SelectedLimitProfile): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i]!;
    if (key !== keysB[i] || a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Storage-side action-provenance creator. The sole future production
 * consumer is `src/control-plane/storage-bootstrap-action.ts`; in WP-8-C no
 * production module imports this function (static-guard enforced). Tests may
 * use it as a test-only producer; test-only producers never create a runtime
 * or package export path.
 */
export function createStorageBootstrapActionProvenance(fields: StorageBootstrapActionProvenance): StorageBootstrapActionProvenance {
  if (fields.actionIdentity.length === 0) throw new TypeError('actionIdentity must be non-empty');
  if (!fields.locator.startsWith('/')) throw new TypeError('locator must be absolute');
  if (!Number.isSafeInteger(fields.serviceUid) || fields.serviceUid < 0) throw new TypeError('serviceUid must be a non-negative safe integer');
  if (!/^sha-256:[0-9a-f]{64}$/.test(fields.configurationIdentity)) throw new TypeError('configurationIdentity must use sha-256:<64-hex> syntax');
  const provenance = freezeProvenance(fields);
  actionProvenanceBrand.add(provenance);
  return provenance;
}

/** True only for the exact object minted by the gated creator in this process. */
export function isGenuineStorageBootstrapActionProvenance(value: unknown): value is StorageBootstrapActionProvenance {
  return value !== null && typeof value === 'object' && actionProvenanceBrand.has(value as object);
}

/**
 * Gated trusted-bootstrap-input creator. Imported only by
 * `src/storage/initialization/initialize.ts` (static-guard enforced). Both
 * operands must be genuine; correlation is verified by exact equality or
 * canonical identity. Action identity is taken only from the genuine action
 * provenance, never from WP-6 configuration provenance.
 */
export function createTrustedStorageBootstrapInput(
  trustedConfiguration: unknown,
  actionProvenance: unknown,
  raw: { readonly locator: string; readonly serviceUid: number; readonly forbiddenRoots: readonly string[]; readonly limitProfile: SelectedLimitProfile },
): TrustedInputResult {
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(trustedConfiguration)) {
    return { ok: false, reason: 'not-genuine-configuration', message: 'trusted configuration evidence is not genuine' };
  }
  if (!isGenuineStorageBootstrapActionProvenance(actionProvenance)) {
    return { ok: false, reason: 'not-genuine-action-provenance', message: 'storage bootstrap action provenance is not genuine' };
  }
  const config = trustedConfiguration as { readonly identity: string };
  const provenance = actionProvenance as StorageBootstrapActionProvenance;
  if (config.identity !== provenance.configurationIdentity) {
    return { ok: false, reason: 'configuration-identity-mismatch', message: 'trusted configuration identity does not correlate with the action provenance' };
  }
  if (raw.locator !== provenance.locator) {
    return { ok: false, reason: 'locator-mismatch', message: 'locator does not correlate with the action provenance' };
  }
  if (raw.serviceUid !== provenance.serviceUid) {
    return { ok: false, reason: 'service-uid-mismatch', message: 'service UID does not correlate with the action provenance' };
  }
  if (!sameStringSet(raw.forbiddenRoots, provenance.forbiddenRoots)) {
    return { ok: false, reason: 'forbidden-roots-mismatch', message: 'forbidden-root set does not correlate with the action provenance' };
  }
  if (!sameLimitProfile(raw.limitProfile, provenance.limitProfile)) {
    return { ok: false, reason: 'limit-profile-mismatch', message: 'limit profile does not correlate with the action provenance' };
  }
  const input = freezeInput({
    actionIdentity: provenance.actionIdentity,
    locator: provenance.locator,
    serviceUid: provenance.serviceUid,
    forbiddenRoots: [...provenance.forbiddenRoots],
    configurationIdentity: provenance.configurationIdentity,
    limitProfile: { ...provenance.limitProfile },
  });
  trustedInputBrand.add(input);
  return { ok: true, input };
}

/** True only for the exact object minted by the gated creator in this process. */
export function isGenuineTrustedStorageBootstrapInput(value: unknown): value is TrustedStorageBootstrapInput {
  return value !== null && typeof value === 'object' && trustedInputBrand.has(value as object);
}
