/**
 * WP-14C — proposal-context load branding (module-private WeakSet).
 *
 * Load plans carry no brand property, symbol, or exported token;
 * `Object.getOwnPropertySymbols` reveals nothing and ordinary property
 * copying cannot forge membership. Distinct from the WP-5A plan brand:
 * a proposal-context load can never be mistaken for an execution-authorized
 * `PiInvocationPlan`.
 */
const loadPlanWrappers = new WeakSet<object>();

export function brandLoadPlanWrapper(wrapper: object): void {
  loadPlanWrappers.add(wrapper);
}

export function isBrandedLoadPlan(value: unknown): boolean {
  return value !== null && typeof value === 'object' && loadPlanWrappers.has(value as object);
}
