/**
 * Pure configuration-chain verification (contract 3.6, CSR-012…016).
 *
 * Verifies structure only over caller-supplied values: predecessor linkage,
 * monotonic revisions, genesis rules, duplicate classification, gaps,
 * forks, multiple heads, disconnected chains, and unique verified head
 * selection. Structural predecessor rules (CSR-012) are enforced
 * fail-closed for every input, including inputs that bypassed the snapshot
 * validator (W8B-C01). It never reads configuration records from disk, creates
 * genesis, persists snapshots, materializes an index, performs recovery, or
 * decides whether configuration policy content should be accepted.
 */
import type { ConfigurationChainInput, ConfigurationChainResult, StorageFinding } from '../types.js';
import { parseTypedIdentifier } from '../format/identifier.js';
import { isValidDigestSyntax } from '../format/envelope.js';

export type ChainFindingKind =
  | 'missing-genesis'
  | 'excess-genesis'
  | 'genesis-with-predecessor'
  | 'incomplete-predecessor'
  | 'gap'
  | 'missing-predecessor'
  | 'corrupted-predecessor'
  | 'conflicting-duplicate'
  | 'idempotent-duplicate'
  | 'multiple-heads'
  | 'disconnected-chain'
  | 'non-positive-revision';

/** Deterministic ERR-STO mapping for current-selection failures (CSR-016). */
export function chainFindingErrorCode(kind: ChainFindingKind): string {
  switch (kind) {
    case 'missing-genesis':
      return 'ERR-STO-CONFIG-UNAVAILABLE';
    case 'conflicting-duplicate':
      return 'ERR-STO-CONFLICT-REVISION';
    case 'idempotent-duplicate':
      return 'ERR-STO-DUPLICATE';
    default:
      return 'ERR-STO-INTEGRITY';
  }
}

function finding(kind: ChainFindingKind, message: string, revision?: number): StorageFinding {
  const suffix = revision === undefined ? '' : ` (revision ${revision})`;
  return {
    code: chainFindingErrorCode(kind),
    message: `${message}${suffix}`,
    phase: 'request-validation',
    state: {
      retryable: false,
      recoveryRequired: false,
      primaryStateChanged: 'no',
      durabilityPointReached: 'no',
      auditChanged: 'no',
      verifyBeforeRetry: true,
    },
  };
}

/**
 * Verify a caller-supplied configuration-record set deterministically.
 * Idempotent duplicates (same revision, identical canonical bytes and
 * digest) are deduplicated with an informational finding; every other
 * structural failure is reported and blocks selection.
 *
 * Structural predecessor rules are enforced defensively here even when a
 * caller bypasses `validateConfigurationSnapshotRecord` (CSR-012; corrected
 * W8B-C01): genesis must carry no predecessor fields, and every non-genesis
 * record must positively establish both a canonical predecessor identity
 * and a valid predecessor digest before it may participate in the chain.
 * A structurally invalid record in the supplied set blocks head selection.
 */
export function verifyConfigurationChain(inputs: readonly ConfigurationChainInput[]): ConfigurationChainResult {
  const findings: StorageFinding[] = [];
  const byId = new Map<string, ConfigurationChainInput>();
  const byRevision = new Map<number, ConfigurationChainInput[]>();
  // Any structurally invalid caller-supplied record blocks head selection.
  let structuralBlock = false;

  for (const input of inputs) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
      findings.push(finding('non-positive-revision', 'configuration revision must be a positive integer', input.revision));
      continue;
    }
    if (input.revision === 1) {
      if (input.predecessorId !== undefined || input.predecessorDigest !== undefined) {
        findings.push(finding('genesis-with-predecessor', 'genesis (revision 1) must not carry a predecessor identity or digest', input.revision));
        structuralBlock = true;
        continue;
      }
    } else {
      if (input.predecessorId === undefined || !parseTypedIdentifier(input.predecessorId).ok) {
        findings.push(finding('incomplete-predecessor', 'non-genesis configuration record must carry a canonical predecessor identity', input.revision));
        structuralBlock = true;
        continue;
      }
      if (input.predecessorDigest === undefined || !isValidDigestSyntax(input.predecessorDigest)) {
        findings.push(finding('incomplete-predecessor', 'non-genesis configuration record must carry a valid predecessor digest', input.revision));
        structuralBlock = true;
        continue;
      }
    }
    const existing = byId.get(input.recordId);
    if (existing !== undefined) {
      if (existing.canonicalUtf8 === input.canonicalUtf8 && existing.recordDigest === input.recordDigest) {
        findings.push(finding('idempotent-duplicate', 'idempotent duplicate snapshot record', input.revision));
      } else {
        findings.push(finding('conflicting-duplicate', 'conflicting duplicate snapshot record', input.revision));
      }
      continue;
    }
    byId.set(input.recordId, input);
    const sameRevision = byRevision.get(input.revision) ?? [];
    sameRevision.push(input);
    byRevision.set(input.revision, sameRevision);
  }

  // Conflicting duplicates by revision (different records claiming the same revision).
  for (const [revision, group] of byRevision) {
    if (group.length > 1) {
      findings.push(finding('conflicting-duplicate', 'multiple distinct records claim the same configuration revision', revision));
    }
  }

  const records = [...byId.values()];
  const genesis = records.filter((r) => r.revision === 1);
  if (genesis.length === 0) findings.push(finding('missing-genesis', 'no genesis (revision 1) configuration snapshot present'));
  if (genesis.length > 1) findings.push(finding('excess-genesis', 'more than one genesis configuration snapshot present'));

  // Head detection: records not referenced as a predecessor.
  const referenced = new Set<string>();
  for (const r of records) {
    if (r.predecessorId !== undefined) referenced.add(r.predecessorId);
  }
  const heads = records.filter((r) => !referenced.has(r.recordId));
  if (heads.length > 1) findings.push(finding('multiple-heads', 'multiple configuration heads present'));

  // Walk the unique-head candidate chain if exactly one head exists AND no
  // structurally invalid record was supplied (W8B-C01).
  let selectedHead: ConfigurationChainInput | undefined;
  if (!structuralBlock && heads.length === 1) {
    const head = heads[0];
    if (head !== undefined) {
      const chainOk = verifyPredecessorWalk(head, byId, findings);
      if (chainOk) selectedHead = head;
    }
  }

  // Disconnected chain: any record unreachable from the selected head.
  if (selectedHead !== undefined) {
    const reachable = new Set<string>([selectedHead.recordId]);
    let cursor: ConfigurationChainInput | undefined = selectedHead;
    while (cursor?.predecessorId !== undefined) {
      const prev = byId.get(cursor.predecessorId);
      if (prev === undefined) break;
      reachable.add(prev.recordId);
      cursor = prev;
    }
    for (const r of records) {
      if (!reachable.has(r.recordId)) {
        findings.push(finding('disconnected-chain', 'configuration record is disconnected from the selected head', r.revision));
      }
    }
  }

  return { heads, selectedHead, findings };
}

/** Verify predecessor linkage, revision contiguity, and digest integrity along the head's chain. */
function verifyPredecessorWalk(head: ConfigurationChainInput, byId: ReadonlyMap<string, ConfigurationChainInput>, findings: StorageFinding[]): boolean {
  let ok = true;
  const seen = new Set<string>([head.recordId]);
  let cursor: ConfigurationChainInput | undefined = head;
  let expectedRevision = head.revision - 1;
  while (cursor !== undefined && cursor.predecessorId !== undefined) {
    const prev = byId.get(cursor.predecessorId);
    if (prev === undefined) {
      findings.push(finding('missing-predecessor', 'predecessor record is missing', cursor.revision));
      ok = false;
      break;
    }
    // Non-genesis records passed the structural pre-validation (W8B-C01), so
    // the predecessor digest is positively established here; compare
    // unconditionally rather than gating on an optional field.
    if (prev.recordDigest !== cursor.predecessorDigest) {
      findings.push(finding('corrupted-predecessor', 'predecessor digest does not match the referenced record', cursor.revision));
      ok = false;
      break;
    }
    if (prev.revision !== expectedRevision) {
      findings.push(finding('gap', 'configuration revision gap in the chain', cursor.revision));
      ok = false;
      break;
    }
    if (seen.has(prev.recordId)) {
      findings.push(finding('corrupted-predecessor', 'cyclic predecessor reference in the chain', cursor.revision));
      ok = false;
      break;
    }
    seen.add(prev.recordId);
    cursor = prev;
    expectedRevision -= 1;
  }
  if (ok && cursor !== undefined && cursor.revision !== 1) {
    findings.push(finding('missing-genesis', 'chain does not terminate at genesis (revision 1)', cursor.revision));
    ok = false;
  }
  return ok;
}

/**
 * Rollback-as-new-version structural representation (CSR-015): a return to
 * earlier policy content is representable only as a NEW control-plane-
 * authorized version that is the immediate successor of the current head.
 * The function verifies structure only; it never interprets policy content.
 */
export function isRollbackRepresentableAsNewVersion(currentHeadRevision: number | undefined, candidateRevision: number, candidatePredecessorMatchesHead: boolean): boolean {
  return candidateRevision === (currentHeadRevision === undefined ? 1 : currentHeadRevision + 1) && candidatePredecessorMatchesHead;
}
