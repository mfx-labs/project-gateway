/**
 * WP-8-C/WP-8-D trusted bootstrap input, write action provenance, and
 * trusted write request (ADR-028 decisions B/D10-D12; ADR-029 D-2/D-5).
 *
 * Four semantically distinct private authenticity domains live in this
 * module: `StorageBootstrapActionProvenance`, `TrustedStorageBootstrapInput`,
 * `StorageWriteActionProvenance`, and `TrustedWriteRequest`. Each uses its
 * own module-private `WeakSet`; no brand collection is exported; there is no
 * structural or own-symbol brand; genuineness is process-local only; JSON,
 * spread, structured clone, prototype imitation, Proxy, and reflection-
 * created lookalikes are not members and fail every verifier. Cross-kind
 * substitution fails every verifier (CAP-014/015).
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

// ─── WP-8-D: write-action provenance and trusted write request (D-2/D-5) ──
// Two further semantically distinct private authenticity domains in this
// module: `StorageWriteActionProvenance` and `TrustedWriteRequest`. Same
// model as the bootstrap domains: separate module-private `WeakSet`s, no
// structural or own-symbol genuineness, process-local only, cross-kind
// substitution fails every verifier (CAP-014/015).

/**
 * Fields bound into one genuine storage write action (producer-owned). The
 * sole future production consumer is
 * `src/control-plane/storage-write-action.ts` (WP-12 trusted control plane);
 * that producer does NOT exist in WP-8-D, so the creator below has zero
 * production importers (static-guard enforced; D-2).
 */
export interface StorageWriteActionProvenance {
  readonly actionIdentity: string;
  /** Already-resolved absolute trusted-parent locator. */
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly limitProfile: SelectedLimitProfile;
}

/** Accepted immutable trusted write request (correlated, gated; D-5). */
export interface TrustedWriteRequest {
  readonly actionIdentity: string;
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly limitProfile: SelectedLimitProfile;
}

export type WriteInputRejectionReason =
  | 'not-genuine-configuration'
  | 'not-genuine-action-provenance'
  | 'configuration-identity-mismatch'
  | 'locator-mismatch'
  | 'service-uid-mismatch'
  | 'forbidden-roots-mismatch'
  | 'limit-profile-mismatch';

export interface WriteInputResult {
  readonly ok: boolean;
  readonly request?: TrustedWriteRequest;
  readonly reason?: WriteInputRejectionReason;
  readonly message?: string;
}

const writeActionProvenanceBrand = new WeakSet<object>();
const trustedWriteRequestBrand = new WeakSet<object>();

function freezeWriteProvenance(fields: StorageWriteActionProvenance): StorageWriteActionProvenance {
  Object.freeze(fields.forbiddenRoots);
  Object.freeze(fields.limitProfile);
  return Object.freeze(fields);
}

function freezeWriteRequest(request: TrustedWriteRequest): TrustedWriteRequest {
  Object.freeze(request.forbiddenRoots);
  Object.freeze(request.limitProfile);
  return Object.freeze(request);
}

/**
 * Storage-side write-action-provenance creator (D-2). The sole future
 * production consumer is `src/control-plane/storage-write-action.ts`; in
 * WP-8-D no production module imports this function (static-guard enforced).
 * Tests may use it as a test-only producer; test-only producers never create
 * a runtime or package export path.
 */
export function createStorageWriteActionProvenance(fields: StorageWriteActionProvenance): StorageWriteActionProvenance {
  if (fields.actionIdentity.length === 0) throw new TypeError('actionIdentity must be non-empty');
  if (!fields.locator.startsWith('/')) throw new TypeError('locator must be absolute');
  if (!Number.isSafeInteger(fields.serviceUid) || fields.serviceUid < 0) throw new TypeError('serviceUid must be a non-negative safe integer');
  if (!/^sha-256:[0-9a-f]{64}$/.test(fields.configurationIdentity)) throw new TypeError('configurationIdentity must use sha-256:<64-hex> syntax');
  const provenance = freezeWriteProvenance(fields);
  writeActionProvenanceBrand.add(provenance);
  return provenance;
}

/** True only for the exact object minted by the gated creator in this process. */
export function isGenuineStorageWriteActionProvenance(value: unknown): value is StorageWriteActionProvenance {
  return value !== null && typeof value === 'object' && writeActionProvenanceBrand.has(value as object);
}

/**
 * Gated trusted-write-request creator (D-5). Imported only by
 * `src/storage/publication/index.ts` (static-guard enforced). Both operands
 * must be genuine; correlation is verified by exact equality or canonical
 * identity. Action identity is taken only from the genuine write-action
 * provenance, never from WP-6 configuration provenance or any structural
 * string. The creator confers no minting authority without the genuine
 * branded operands.
 */
export function createTrustedWriteRequest(
  trustedConfiguration: unknown,
  actionProvenance: unknown,
  raw: { readonly locator: string; readonly serviceUid: number; readonly forbiddenRoots: readonly string[]; readonly limitProfile: SelectedLimitProfile },
): WriteInputResult {
  if (!isGenuineValidatedTrustedWorkspaceConfiguration(trustedConfiguration)) {
    return { ok: false, reason: 'not-genuine-configuration', message: 'trusted configuration evidence is not genuine' };
  }
  if (!isGenuineStorageWriteActionProvenance(actionProvenance)) {
    return { ok: false, reason: 'not-genuine-action-provenance', message: 'storage write action provenance is not genuine' };
  }
  const config = trustedConfiguration as { readonly identity: string };
  const provenance = actionProvenance as StorageWriteActionProvenance;
  if (config.identity !== provenance.configurationIdentity) {
    return { ok: false, reason: 'configuration-identity-mismatch', message: 'trusted configuration identity does not correlate with the write action provenance' };
  }
  if (raw.locator !== provenance.locator) {
    return { ok: false, reason: 'locator-mismatch', message: 'locator does not correlate with the write action provenance' };
  }
  if (raw.serviceUid !== provenance.serviceUid) {
    return { ok: false, reason: 'service-uid-mismatch', message: 'service UID does not correlate with the write action provenance' };
  }
  if (!sameStringSet(raw.forbiddenRoots, provenance.forbiddenRoots)) {
    return { ok: false, reason: 'forbidden-roots-mismatch', message: 'forbidden-root set does not correlate with the write action provenance' };
  }
  if (!sameLimitProfile(raw.limitProfile, provenance.limitProfile)) {
    return { ok: false, reason: 'limit-profile-mismatch', message: 'limit profile does not correlate with the write action provenance' };
  }
  const request = freezeWriteRequest({
    actionIdentity: provenance.actionIdentity,
    locator: provenance.locator,
    serviceUid: provenance.serviceUid,
    forbiddenRoots: [...provenance.forbiddenRoots],
    configurationIdentity: provenance.configurationIdentity,
    limitProfile: { ...provenance.limitProfile },
  });
  trustedWriteRequestBrand.add(request);
  return { ok: true, request };
}

/** True only for the exact object minted by the gated creator in this process. */
export function isGenuineTrustedWriteRequest(value: unknown): value is TrustedWriteRequest {
  return value !== null && typeof value === 'object' && trustedWriteRequestBrand.has(value as object);
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
