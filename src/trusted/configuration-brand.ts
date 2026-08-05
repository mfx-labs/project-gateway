/**
 * WP-6 Phase 2A security correction F-2A-01: runtime genuineness brand for
 * validated trusted configurations.
 *
 * Only a runtime-genuine configuration produced by the successful Phase-1
 * validator may provide workspace roots to later trusted consumers (the
 * containment evaluator, workspace lookup). Structural TypeScript
 * compatibility, a matching digest string, deep freezing, or successful
 * identity recomputation is NOT sufficient proof of genuineness.
 *
 * Runtime branding uses module-private WeakSet membership (the accepted
 * WP-5A runtime-branding pattern):
 * - no brand is stored as an own symbol property, string property, exported
 *   token, global symbol, or enumerable metadata;
 * - `Object.getOwnPropertySymbols(configuration)` reveals no brand
 *   capability;
 * - a spread, clone, JSON round-trip, structured reconstruction, forged
 *   lookalike, or Proxy wrapper is not a member;
 * - the brand is process-local, non-persistent, and never serialized;
 * - the brand does not mutate the validated object and does not participate
 *   in canonical bytes, configuration identity, projections, findings, or
 *   declarations;
 * - multiple successful validations produce multiple independently branded
 *   valid objects;
 * - membership is valid only within the physical module instance that
 *   created the brand (no `Symbol.for`, no process-global membership).
 *
 * Branding introduces no authority beyond proving that Phase-1 validation
 * produced the exact object.
 */

const validatedConfigurations = new WeakSet<object>();

/**
 * Mark a successfully validated trusted configuration object as runtime
 * genuine. Called only from the Phase-1 validator's success path after
 * complete validated-object construction and deep freezing. Never exported
 * from the trusted barrel or the package root.
 */
export function markValidatedTrustedWorkspaceConfiguration(configuration: object): void {
  validatedConfigurations.add(configuration);
}

/**
 * True only when `value` is the exact object returned by a successful
 * Phase-1 validation in this process. Structural lookalikes, clones, and
 * Proxy wrappers are not genuine.
 */
export function isGenuineValidatedTrustedWorkspaceConfiguration(value: unknown): boolean {
  return value !== null && typeof value === 'object' && validatedConfigurations.has(value as object);
}
