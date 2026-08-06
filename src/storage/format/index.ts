/**
 * WP-8-B format module barrel: taxonomy, typed identifiers, and canonical
 * envelope/digest helpers.
 */
export { RECORD_CLASS_PROFILES, RECORD_CLASS_BY_ID, STORE_EVIDENCE_KIND_SET, isAcceptedRecordClass, recordClassProfile } from './taxonomy.js';
export type { EnvelopeProfile, RecordClassProfile, Wp8Production } from './taxonomy.js';
export { parseTypedIdentifier, isCanonicalTypedIdentifier } from './identifier.js';
export type { IdentifierParseResult, IdentifierRejectReason } from './identifier.js';
export {
  STORAGE_PAYLOAD_DIGEST_DOMAIN,
  STORAGE_RECORD_BYTES_DIGEST_DOMAIN,
  STORAGE_METADATA_DIGEST_DOMAIN,
  canonicalEnvelopeBytes,
  computeDomainDigest,
  computePayloadDigest,
  isValidDigestSyntax,
  isValidVersionSyntax,
  parsePersistedEnvelope,
  payloadDigestMatches,
  validateRecordEnvelope,
  DIGEST_AUTHORSHIP_DISCLAIMER,
} from './envelope.js';
export type { EnvelopeFinding, EnvelopeFindingCode, EnvelopeParseOutcome, EnvelopeValidation } from './envelope.js';
