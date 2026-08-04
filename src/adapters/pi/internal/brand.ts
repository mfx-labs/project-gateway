/**
 * Adapter-local membership branding (module-private WeakSets).
 *
 * Plans and observations carry no brand property, symbol, or exported token;
 * `Object.getOwnPropertySymbols` reveals nothing and ordinary property copying
 * cannot forge membership.
 */
const planWrappers = new WeakSet<object>();
const observationWrappers = new WeakSet<object>();

export function brandPlanWrapper(wrapper: object): void {
  planWrappers.add(wrapper);
}
export function brandObservationWrapper(wrapper: object): void {
  observationWrappers.add(wrapper);
}
export function isBrandedPlan(value: unknown): boolean {
  return value !== null && typeof value === 'object' && planWrappers.has(value as object);
}
export function isBrandedObservation(value: unknown): boolean {
  return value !== null && typeof value === 'object' && observationWrappers.has(value as object);
}
