/**
 * Trusted configuration provenance (WP-6 Phase 1).
 *
 * Provenance is mandatory and participates in configuration identity.
 * The only accepted source kind is the trusted local control plane:
 *
 *   { "sourceKind": "trusted-local-control-plane" }
 *
 * Rules:
 * - repository-controlled content can never supply or replace trusted
 *   provenance; any other source kind (including repository, `.pi`, or
 *   project-visible values) fails closed;
 * - missing or malformed provenance fails closed;
 * - provenance values never expose secrets or physical roots through public
 *   findings (findings carry only the offending location);
 * - repository-local `.pi` configuration files are not Project Gateway
 *   governance and cannot appear as provenance.
 */
export const TRUSTED_SOURCE_KIND = 'trusted-local-control-plane';

export interface ValidatedTrustedConfigurationProvenance {
  readonly sourceKind: typeof TRUSTED_SOURCE_KIND;
}

export function isTrustedSourceKind(value: string): boolean {
  return value === TRUSTED_SOURCE_KIND;
}
