/**
 * WP-8-C root module barrel (private to the repository). Exports the pure
 * verification predicates, the overlap rules, and the descriptor-bound
 * resolution/revalidation functions. Filesystem descriptors never leave this
 * module's functions as return values.
 */
export { validateAndCaptureParent, checkForbiddenRootOverlap, revalidateParentIdentity } from './resolve.js';
export type { RootValidationResult } from './resolve.js';
export { verifyDirectoryStat, verifyRegularFileStat, comparePrePostStat } from './identity.js';
export type { DirectoryStatLike, PrePostComparison, StatVerification } from './identity.js';
export { pathsOverlap, firstForbiddenOverlap, namespaceRootsDistinct } from './overlap.js';
