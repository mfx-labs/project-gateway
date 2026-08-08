/**
 * WP-12 Slice 1 — host identity source helpers.
 *
 * The decision core receives record identity and trusted timestamps from
 * the host-injected identity source (D-3 pattern; never request-supplied).
 * This module provides a production-appropriate crypto-random record
 * identity source (`pgw:l:` + 32 lowercase hex) for host composition roots.
 * Tests inject deterministic sources instead.
 *
 * No authority is created here; identity sources only assign opaque,
 * non-reusable record identities and trusted timestamps.
 */
import { randomBytes } from 'node:crypto';
import type { ControlPlaneIdentitySource } from './types.js';

/**
 * Crypto-random opaque record identity source. Each call returns a fresh
 * `pgw:l:<32 lowercase hex>` identity (128 bits of randomness, matching the
 * accepted opaque-identifier rule).
 */
export function createCryptoRecordIdSource(): () => string {
  return () => `pgw:l:${randomBytes(16).toString('hex')}`;
}

/** Host identity source combining the crypto record-ID source and a host clock. */
export function createHostIdentitySource(nowUtcIso: () => string): ControlPlaneIdentitySource {
  const newRecordId = createCryptoRecordIdSource();
  return Object.freeze({ nowUtcIso, newRecordId });
}
