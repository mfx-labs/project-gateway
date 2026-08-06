/**
 * WP-8-C pure canonical-path overlap rules (SRX-004/CSR-004).
 *
 * The store-containment profile is intentionally distinct from the WP-6
 * workspace containment primitives (which evaluate workspace-root
 * containment for configuration operands); WP-8 root checks use canonical
 * absolute paths resolved by the root module plus descriptor identity.
 * Overlap holds on exact equality or ancestor/descendant relationship.
 */
export function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith(b + '/')) return true;
  if (b.startsWith(a + '/')) return true;
  return false;
}

/** First forbidden root overlapping `canonicalPath`, or undefined. */
export function firstForbiddenOverlap(canonicalPath: string, forbiddenRoots: readonly string[]): string | undefined {
  for (const root of forbiddenRoots) {
    if (pathsOverlap(canonicalPath, root)) return root;
  }
  return undefined;
}

/** The two namespace roots must not overlap each other (fixed derivations cannot). */
export function namespaceRootsDistinct(configRoot: string, storeRoot: string): boolean {
  return !pathsOverlap(configRoot, storeRoot);
}
