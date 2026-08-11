/**
 * WP-14C — proposal-context load resolver (Model C; transport-free core).
 *
 * Resolves the intended RESOLVED PROPOSAL SET from the configured artifact
 * location through the committed WP-7 controlled reader, validates every
 * candidate at point of use through the committed WP-4/WP-10 machinery,
 * applies the approved Model-C selection rules, verifies in-set
 * exact-reference consistency (SCR-WP14C-001), and produces the immutable
 * proposal-context load plan.
 *
 * NORMATIVE SEQUENCE (contract §5/§8):
 *
 *   Model-C selection
 *   → resolved proposal set
 *   → exact-reference consistency verification
 *   → render/inject
 *
 * References NEVER select or add artifacts: correlation verifies the
 * already-selected set only. Filesystem presence outside the selected set
 * never satisfies a mandatory in-set reference.
 *
 * AUTHORITY: loading prepares Pi context; it does not authorize Pi
 * execution. No eligibility evidence, registry context, lifecycle
 * verification, RuntimeGrant, or execution operand exists in this module.
 * Deterministic: no clock, no randomness, no process identity, no
 * enumeration-order selection.
 */
import { createDraftProposalWithSchemaRegistry } from '../drafting/proposal.js';
import type { ValidDraftProposalResult } from '../drafting/proposal.js';
import { computeArtifactDigest } from '../api/validate.js';
import { parseRawJsonInput } from '../api/validate.js';
import { exactReferencesEqual } from '../internal/protocol-equality.js';
import { EXACT_REFERENCE_SCHEMA } from '../schema/select.js';
import { lookupValidatedWorkspace } from '../trusted/index.js';
import { WP7_LIMITS } from '../reader/index.js';
import type { OperationResult } from '../reader/index.js';
import {
  MAX_CANDIDATES_PER_KIND,
  MAX_CANDIDATE_BYTES,
  PROPOSAL_CANDIDATE_FILE_RE,
  PROPOSAL_INSTANCE_ID_RE,
  PROPOSAL_LOAD_KINDS,
  PROPOSAL_REVISION_ID_RE,
  type ProposalLoadFailure,
  type ProposalLoadKindId,
  type ProposalLoadLane,
  type ProposalLoadOptions,
  type ProposalLoadPin,
  type ProposalLoadResult,
  type ProposalLoadedArtifact,
} from './types.js';
import { renderProposalLoadPlan } from './plan.js';

const OPTIONS_KEYS: ReadonlySet<string> = new Set(['workspaceId', 'pins']);
const PIN_KEYS: ReadonlySet<string> = new Set(['kind', 'instanceId', 'revisionId']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(code: ProposalLoadFailure['code'], message: string): ProposalLoadFailure {
  return Object.freeze({ ok: false, code, message });
}

/** Parse one candidate filename under the committed WP-14A destination convention. */
export function parseCandidateFilename(name: string): { readonly kind: ProposalLoadKindId; readonly instanceId: string; readonly revisionId: string } | null {
  if (typeof name !== 'string') return null;
  const match = PROPOSAL_CANDIDATE_FILE_RE.exec(name);
  if (match === null) return null;
  return { kind: match[1] as ProposalLoadKindId, instanceId: match[2]!, revisionId: match[3]! };
}

/** Closed-field load-options validation (host/operator input; never caller wire input). */
export function validateLoadOptions(options: unknown): { readonly ok: true; readonly options: ProposalLoadOptions } | { readonly ok: false; readonly code: 'invalid-options' | 'unsupported-kind-version'; readonly message: string } {
  if (!isRecord(options)) return { ok: false, code: 'invalid-options', message: 'load options must be an object' };
  for (const key of Object.keys(options)) {
    if (!OPTIONS_KEYS.has(key)) return { ok: false, code: 'invalid-options', message: `unknown load option: ${key}` };
  }
  const workspaceId = options['workspaceId'];
  if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspaceId.length > 128) {
    return { ok: false, code: 'invalid-options', message: 'workspaceId must be a bounded non-empty string' };
  }
  let pins: ProposalLoadPin[] = [];
  const rawPins = options['pins'];
  if (rawPins !== undefined) {
    if (!Array.isArray(rawPins) || rawPins.length === 0 || rawPins.length > MAX_CANDIDATES_PER_KIND) {
      return { ok: false, code: 'invalid-options', message: 'pins must be a bounded non-empty array' };
    }
    if (rawPins.length > 4) {
      return { ok: false, code: 'invalid-options', message: 'at most one pin per supported kind is allowed' };
    }
    const seenKinds = new Set<string>();
    for (const raw of rawPins) {
      if (!isRecord(raw)) return { ok: false, code: 'invalid-options', message: 'each pin must be an object' };
      for (const key of Object.keys(raw)) {
        if (!PIN_KEYS.has(key)) return { ok: false, code: 'invalid-options', message: `unknown pin field: ${key}` };
      }
      const kind = raw['kind'];
      if (typeof kind !== 'string' || !(PROPOSAL_LOAD_KINDS as readonly string[]).includes(kind)) {
        return { ok: false, code: 'unsupported-kind-version', message: 'the pinned kind is outside the closed proposal-load vocabulary' };
      }
      const instanceId = raw['instanceId'];
      const revisionId = raw['revisionId'];
      if (typeof instanceId !== 'string' || !PROPOSAL_INSTANCE_ID_RE.test(instanceId)) {
        return { ok: false, code: 'invalid-options', message: 'pin instanceId must use the schema-enforced pgw:i: identity pattern' };
      }
      if (typeof revisionId !== 'string' || !PROPOSAL_REVISION_ID_RE.test(revisionId)) {
        return { ok: false, code: 'invalid-options', message: 'pin revisionId must use the schema-enforced pgw:r: identity pattern' };
      }
      if (seenKinds.has(kind)) {
        return { ok: false, code: 'invalid-options', message: `duplicate pin for kind ${kind}` };
      }
      seenKinds.add(kind);
      pins.push(Object.freeze({ kind: kind as ProposalLoadKindId, instanceId, revisionId }));
    }
  }
  return { ok: true, options: Object.freeze({ workspaceId, ...(pins.length > 0 ? { pins: Object.freeze(pins) } : {}) }) };
}

/** Derive the workspace-relative artifact-location path (host-side; never caller-supplied). */
function artifactLocationRelativePath(lane: ProposalLoadLane, workspaceId: string): { readonly ok: true; readonly relativePath: string } | { readonly ok: false } {
  const record = lookupValidatedWorkspace(lane.configuration, workspaceId);
  if (record === undefined || record.artifactLocation === undefined) return { ok: false };
  if (record.artifactLocation === record.canonicalRoot) return { ok: true, relativePath: '' };
  if (!record.artifactLocation.startsWith(`${record.canonicalRoot}/`)) return { ok: false };
  return { ok: true, relativePath: record.artifactLocation.slice(record.canonicalRoot.length + 1) };
}

/** Map WP-7 read/list failures onto the closed load vocabulary (typed; never errno/roots). */
function mapInspectionFailure(result: Extract<OperationResult, { readonly ok: false }>, pinned: boolean): ProposalLoadFailure | 'skip-candidate' | 'lane-hostile' {
  switch (result.failure.code) {
    case 'ERR-WS-UNKNOWN':
      return failure('no-candidate', 'the selected workspace is not available on this load lane');
    case 'ERR-NOT-FOUND':
      return pinned ? failure('missing-required', 'the pinned candidate artifact does not exist in the configured artifact location') : 'skip-candidate';
    case 'ERR-CON-DENIED':
    case 'ERR-SYM-ESCAPE':
    case 'ERR-PAT-TRAVERSAL':
      return 'lane-hostile';
    case 'ERR-LIMIT-CONCURRENCY':
    case 'ERR-LIMIT-SIZE':
    case 'ERR-LIMIT-ENTRIES':
    case 'ERR-LIMIT-RESULTS':
      return pinned ? failure('controlled-read-failure', 'the controlled read of the pinned candidate exceeded a committed inspection limit') : 'skip-candidate';
    case 'ERR-FTYPE-UNSUPPORTED':
    case 'ERR-TEXT-MALFORMED':
    case 'ERR-PERM-DENIED':
      return pinned ? failure('controlled-read-failure', 'the pinned candidate could not be read through the controlled read boundary') : 'skip-candidate';
    case 'ERR-OP-CANCELLED':
    case 'ERR-INTERNAL-INVARIANT':
      return failure('controlled-read-failure', 'the controlled inspection could not be completed; no internal details are exposed');
    default:
      return failure('controlled-read-failure', 'the controlled inspection failed; no internal details are exposed');
  }
}

interface ReadOutcome {
  readonly ok: true;
  readonly content: string;
  readonly truncated: boolean;
}

async function readCandidate(
  lane: ProposalLoadLane,
  workspaceId: string,
  relativeDir: string,
  filename: string,
  pinned: boolean,
): Promise<ReadOutcome | ProposalLoadFailure | 'skip-candidate' | 'lane-hostile'> {
  const path = relativeDir === '' ? filename : `${relativeDir}/${filename}`;
  const read = await lane.reader.readText(
    { operation: 'read-text', workspaceId, path, maxBytes: MAX_CANDIDATE_BYTES },
    {},
  );
  if (read.ok !== true) {
    return mapInspectionFailure(read, pinned);
  }
  const value = read.value as { readonly text: string; readonly byteLength: number; readonly truncated: boolean };
  if (value.truncated) {
    // Incomplete content can never be validated. For pinned candidates this
    // is an unreadable candidate; for unpinned candidates it is not a valid
    // candidate.
    return pinned
      ? failure('controlled-read-failure', 'the pinned candidate exceeds the accepted artifact byte bound and cannot be validated')
      : 'skip-candidate';
  }
  return { ok: true, content: value.text, truncated: false };
}

/**
 * Validate one candidate at point of use through the committed WP-10
 * validation composition, and verify filename/content identity + revision
 * correlation. Filename identity alone is never trusted.
 *
 * The persisted artifact is the WP-14A canonical form (revision.digest
 * ABSENT by construction of the committed canonical projection): the
 * committed draft composition parses it, recomputes the derived digest,
 * reconstructs the envelope, and runs the full WP-4 structural + semantic
 * pipeline. Canonical-byte continuity is additionally verified: the exact
 * file bytes must equal the recomputed canonical bytes.
 */
export function validateCandidate(
  lane: ProposalLoadLane,
  content: string,
  expected: { readonly kind: ProposalLoadKindId; readonly instanceId: string; readonly revisionId: string },
): { readonly ok: true; readonly draft: ValidDraftProposalResult } | { readonly ok: false; readonly reason: 'invalid' | 'identity-mismatch' | 'non-canonical' } {
  const parsed = parseRawJsonInput(content, { subjectClass: 'artifact' });
  if (!parsed.ok) return { ok: false, reason: 'invalid' };
  const model = parsed.model;
  if (model === null || typeof model !== 'object' || Array.isArray(model)) return { ok: false, reason: 'invalid' };
  const { canonicalUtf8 } = computeArtifactDigest(model as Readonly<Record<string, unknown>>);
  if (canonicalUtf8 !== content) {
    // The exact persisted bytes must be the exact canonical bytes validated
    // for this operation; any substitution or non-canonical form fails closed.
    return { ok: false, reason: 'non-canonical' };
  }
  const draft = createDraftProposalWithSchemaRegistry({ kind: expected.kind, content }, lane.schemaRegistry);
  if (draft.ok !== true || draft.valid !== true) return { ok: false, reason: 'invalid' };
  if (draft.proposal.instanceId !== expected.instanceId || draft.proposal.revisionId !== expected.revisionId) {
    return { ok: false, reason: 'identity-mismatch' };
  }
  return { ok: true, draft };
}

interface CandidateDiscovery {
  readonly ok: true;
  readonly candidates: readonly { readonly filename: string; readonly kind: ProposalLoadKindId; readonly instanceId: string; readonly revisionId: string }[];
}

/** Discover candidate filenames of one kind in the configured artifact location (WP-7 list-directory). */
async function discoverCandidates(lane: ProposalLoadLane, workspaceId: string, relativeDir: string, kind: ProposalLoadKindId): Promise<CandidateDiscovery | ProposalLoadFailure | 'lane-hostile'> {
  const listed = await lane.reader.listDirectory(
    { operation: 'list-directory', workspaceId, path: relativeDir, maxEntries: WP7_LIMITS.MAX_DIRECTORY_ENTRIES },
    {},
  );
  if (listed.ok !== true) {
    const mapped = mapInspectionFailure(listed, false);
    if (mapped === 'skip-candidate') return { ok: true, candidates: [] };
    if (mapped === 'lane-hostile') return 'lane-hostile';
    return mapped;
  }
  const value = listed.value as { readonly entries: readonly { readonly name: string; readonly kindHint: string }[]; readonly truncated?: boolean; readonly count?: number };
  if (value.truncated === true) {
    // The WP-7 listing is incomplete: uniqueness cannot be established from
    // the visible subset, and bounded enumeration order must never produce
    // a false unique selection. Fail closed before any Model-C 0/1/>1
    // resolution (SIR-WP14C-002).
    return failure('controlled-read-failure', 'the configured artifact location listing is incomplete; candidate uniqueness cannot be safely established');
  }
  const candidates: { filename: string; kind: ProposalLoadKindId; instanceId: string; revisionId: string }[] = [];
  for (const entry of value.entries) {
    if (entry.kindHint !== 'file' && entry.kindHint !== 'symlink') continue;
    const parsed = parseCandidateFilename(entry.name);
    if (parsed === null || parsed.kind !== kind) continue;
    candidates.push({ filename: entry.name, kind: parsed.kind, instanceId: parsed.instanceId, revisionId: parsed.revisionId });
  }
  if (candidates.length > MAX_CANDIDATES_PER_KIND) {
    return failure('ambiguous-selection', `more than ${MAX_CANDIDATES_PER_KIND} candidate files for one kind; selection is not unambiguous`);
  }
  return { ok: true, candidates };
}

/**
 * SCR-WP14C-001: in-set exact-reference consistency over the already-selected
 * set. Exported for focused testing only; NOT part of the public loading
 * surface (absent from the package barrel).
 */
export function verifyInSetCorrelation(
  lane: ProposalLoadLane,
  workspaceId: string,
  loaded: readonly { readonly kind: ProposalLoadKindId; readonly draft: ValidDraftProposalResult }[],
): ProposalLoadFailure | null {
  const manifest = loaded.find((l) => l.kind === 'ContextManifest');
  if (manifest === undefined) return null;
  const items = (manifest.draft.proposal.model['body'] as Readonly<Record<string, unknown>> | undefined)?.['items'];
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const selector = item['selector'];
    if (!isRecord(selector) || selector['selector_type'] !== 'project-gateway.artifact-revision') continue;
    const reference = selector['artifact'];
    // Committed reference-schema validation (the exact schema the committed
    // self-resolution machinery applies).
    const schemaResult = lane.schemaRegistry.validate(EXACT_REFERENCE_SCHEMA, reference);
    if (!schemaResult.valid) {
      return failure('incompatible-set', 'a ContextManifest artifact-revision selector is not a valid exact artifact reference');
    }
    const ref = reference as Readonly<Record<string, unknown>>;
    const targetKind = ref['target_kind'] as Readonly<Record<string, unknown>>;
    const targetKindId = typeof targetKind?.['id'] === 'string' ? targetKind['id'] : '';
    if (!(PROPOSAL_LOAD_KINDS as readonly string[]).includes(targetKindId)) {
      // External/declarative selector: never resolved, never scanned, no
      // effect on load success.
      continue;
    }
    // Mandatory in-set: the exact target MUST already be present in the
    // resolved proposal set. Filesystem presence outside the set never
    // satisfies the reference; nothing is scanned or loaded to satisfy it.
    // Field comparison reuses the committed authoritative exact-reference
    // equality primitive (protocol version, target kind id AND version,
    // instance, revision, digest, workspace binding; fail-closed on
    // missing/malformed fields) over a synthetic reference built from the
    // loaded artifact's freshly validated identity (SIR-WP14C-003).
    const found = loaded.find((l) => {
      if (l.kind !== targetKindId) return false;
      const model = l.draft.proposal.model as Readonly<Record<string, unknown>>;
      const targetReference: Readonly<Record<string, unknown>> = {
        target_protocol_version: String((model['protocol'] as Readonly<Record<string, unknown>> | undefined)?.['version'] ?? ''),
        target_kind: model['kind'],
        target_instance_id: l.draft.proposal.instanceId,
        target_revision_id: l.draft.proposal.revisionId,
        target_digest: l.draft.proposal.digest,
        target_workspace_binding: model['workspace_binding'],
      };
      return exactReferencesEqual(reference, targetReference);
    });
    if (found === undefined) {
      return failure('incompatible-set', 'a ContextManifest artifact-revision selector targets a proposal artifact that is not in the resolved proposal set');
    }
  }
  return null;
}

/**
 * Resolve the intended resolved proposal set (Model C). Deterministic;
 * every invocation performs fresh discovery, fresh controlled reads, fresh
 * validation, fresh selection, and fresh correlation. `supersedesLoadId`
 * is session metadata (in-memory prior-load identification) rendered into
 * the plan; it never affects selection.
 */
export async function resolveProposalLoad(lane: ProposalLoadLane, options: unknown, extras: { readonly supersedesLoadId?: string } = {}): Promise<ProposalLoadResult> {
  const validated = validateLoadOptions(options);
  if (!validated.ok) return failure(validated.code, validated.message);
  const opts = validated.options;

  const relative = artifactLocationRelativePath(lane, opts.workspaceId);
  if (!relative.ok) {
    return failure('no-candidate', 'the selected workspace has no configured artifact location on this load lane');
  }

  const pinsByKind = new Map<ProposalLoadKindId, ProposalLoadPin>();
  for (const pin of opts.pins ?? []) pinsByKind.set(pin.kind, pin);

  const loaded: { kind: ProposalLoadKindId; draft: ValidDraftProposalResult }[] = [];
  const omittedKinds: ProposalLoadKindId[] = [];

  for (const kind of PROPOSAL_LOAD_KINDS) {
    const pin = pinsByKind.get(kind);
    if (pin !== undefined) {
      // Explicitly pinned: the exact configured identity/revision is REQUIRED.
      const filename = `${kind}.${pin.instanceId}.${pin.revisionId}.json`;
      const read = await readCandidate(lane, opts.workspaceId, relative.relativePath, filename, true);
      if (read === 'skip-candidate' || read === 'lane-hostile') {
        return failure(read === 'skip-candidate' ? 'missing-required' : 'controlled-read-failure', read === 'skip-candidate' ? 'the pinned candidate artifact does not exist in the configured artifact location' : 'the configured artifact location is not safely readable');
      }
      if (!read.ok) return read;
      const validatedArtifact = validateCandidate(lane, read.content, { kind: pin.kind, instanceId: pin.instanceId, revisionId: pin.revisionId });
      if (!validatedArtifact.ok) {
        return failure('invalid-artifact', validatedArtifact.reason === 'identity-mismatch' ? 'the pinned candidate content identity does not match its filename identity' : 'the pinned candidate failed trusted validation');
      }
      loaded.push({ kind, draft: validatedArtifact.draft });
      continue;
    }
    // Unpinned: uniqueness-only fallback.
    const discovery = await discoverCandidates(lane, opts.workspaceId, relative.relativePath, kind);
    if (discovery === 'lane-hostile') {
      return failure('controlled-read-failure', 'the configured artifact location is not safely readable');
    }
    if (!discovery.ok) return discovery;
    const valid: { filename: string; draft: ValidDraftProposalResult }[] = [];
    for (const candidate of discovery.candidates) {
      const read = await readCandidate(lane, opts.workspaceId, relative.relativePath, candidate.filename, false);
      if (read === 'lane-hostile') return failure('controlled-read-failure', 'the configured artifact location is not safely readable');
      if (read === 'skip-candidate' || !read.ok) continue;
      const validatedArtifact = validateCandidate(lane, read.content, candidate);
      if (!validatedArtifact.ok) continue;
      valid.push({ filename: candidate.filename, draft: validatedArtifact.draft });
    }
    if (valid.length === 0) {
      omittedKinds.push(kind);
      continue;
    }
    if (valid.length > 1) {
      return failure('ambiguous-selection', `more than one valid candidate exists for ${kind}; selection is not unambiguous`);
    }
    loaded.push({ kind, draft: valid[0]!.draft });
  }

  if (loaded.length === 0) {
    return failure('no-candidate', 'no proposal artifact resolved in the configured artifact location');
  }

  // SCR-WP14C-001: correlation verifies the selected set; it never selects
  // additional artifacts.
  const correlationFailure = verifyInSetCorrelation(lane, opts.workspaceId, loaded);
  if (correlationFailure !== null) return correlationFailure;

  const plan = renderProposalLoadPlan({
    workspaceId: opts.workspaceId,
    loaded,
    omittedKinds,
    ...(extras.supersedesLoadId !== undefined ? { supersedesLoadId: extras.supersedesLoadId } : {}),
  });
  return { ok: true, plan };
}
