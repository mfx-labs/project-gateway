/**
 * trustedExtensionSet configuration-side model (WP-6 Phase 1, F-F2).
 *
 * Contract-level representation of the trusted-local extension policy bound to
 * Trusted Workspace Configuration. Phase 1 validates and freezes declarations
 * only; it performs no Pi tool sampling, no comparison against a live
 * effective tool surface, and no pi-guard activation (those are WP-5B).
 *
 * Membership grants no capability or authority: the set only narrows the
 * permitted effective host surface; effective authority and consumer support
 * are evaluated elsewhere and are never implied by membership.
 */

export const EXTENSION_SCOPES = ['user', 'project', 'temporary', 'package', 'top-level'] as const;

export type ExtensionScope = (typeof EXTENSION_SCOPES)[number];

export interface ValidatedExtensionIdentity {
  readonly packageId: string;
  readonly version: string;
}

export interface ValidatedExpectedToolSource {
  readonly toolName: string;
  readonly packageId: string;
  readonly scope: ExtensionScope;
}

export interface ValidatedTrustedExtensionSet {
  readonly version: string;
  /** Canonical sorted, deduplicated permitted extension/package identities. */
  readonly permittedExtensionIds: readonly string[];
  /** Canonical sorted, deduplicated supported built-in tool identities. */
  readonly supportedBuiltinToolIds: readonly string[];
  /** Canonical sorted trusted web-access declarations (identity + version). */
  readonly trustedWebAccess: readonly ValidatedExtensionIdentity[];
  /** Canonical sorted expected effective sources for security-relevant tools. */
  readonly expectedToolSources: readonly ValidatedExpectedToolSource[];
}

import { compareStrings } from './ordering.js';

/** Package/tool identity grammar: non-empty, printable, no whitespace or path separators. */
const IDENTITY_PATTERN = /^[^\s/\\:]{1,128}$/;

export function isValidExtensionIdentity(value: string): boolean {
  return IDENTITY_PATTERN.test(value);
}

export function isExtensionScope(value: string): value is ExtensionScope {
  return (EXTENSION_SCOPES as readonly string[]).includes(value);
}

export function canonicalSortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareStrings));
}
