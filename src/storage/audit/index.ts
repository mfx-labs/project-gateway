/**
 * WP-8-D audit module barrel (private to the repository). Publication-only
 * support: the mechanical `authorized-write` event construction. The module
 * is filesystem-free; publication is delegated through the single
 * publication substrate. Only the `authorized-write` kind is implemented
 * (D-12); no full AUD-001 claim is made.
 */
export {
  AUTHORIZED_WRITE_EVENT_KIND,
  AUDIT_RECORD_FORMAT_VERSION,
  STORAGE_AUDIT_EVENT_IDENTITY_DOMAIN,
  buildAuthorizedWriteAuditEvent,
  computeAuditEventIdentity,
} from './write-audit.js';
export type { AuditEventBuildResult, AuthorizedWriteAuditInput } from './write-audit.js';
