/**
 * WP-8-B limits module barrel: the 20-limit normative profile.
 */
export {
  LIMIT_BY_NAME,
  LIMIT_DEFINITIONS,
  applyRequestLowering,
  bindLimitProfile,
  defaultLimitProfile,
  limitBoundaryBehavior,
  validateLimitSelection,
} from './limits.js';
export type { LimitDefinition, LimitResult, LimitSource, LimitUnit, LimitValidationResult, SelectedLimitProfile } from './limits.js';
