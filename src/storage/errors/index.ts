/**
 * WP-8 error vocabulary barrel (contract 18; ERM-001…015).
 */
export { ERROR_CODE_DEFINITIONS, ERROR_CODE_SET, READONLY_FS_PHASES, errorCodeDefinition, isClosedErrorCode, readonlyFsState } from './codes.js';
export type { ErrorCodeDefinition } from './codes.js';
export { classifyContentFailure, classifyExistingTarget, selectPrecedence } from './precedence.js';
export type { ContentClassificationInput, ContentFailureClass, ExistingTargetClassificationInput, ExistingTargetClass } from './precedence.js';
