/**
 * WP-9 MCP inspection surface (slice 1) — static security guards.
 *
 * Proves the adapter is a pure read-only routing layer:
 *   - imports NO filesystem API, subprocess, or shell;
 *   - never reaches storage publication, recovery mutation, retention
 *     execution, lock mutation, configuration recovery mutation, or any
 *     capability/provenance/trusted-input CREATOR;
 *   - consumes only read-only/pure domain modules (exact allowlist);
 *   - exposes no authority creator or permit through its entry point;
 *   - contains no timers, randomness, or environment dependence;
 *   - the `./mcp` package export maps to the adapter entry point only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const MCP_SRC = join(REPO, 'src', 'adapters', 'mcp');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const mcpFiles = collectTsFiles(MCP_SRC);
assert.ok(mcpFiles.length >= 4, 'the MCP adapter source tree must exist');

test('mcp static guard: no filesystem, subprocess, shell, timers, randomness, or environment access', () => {
  for (const file of mcpFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['node:fs', 'node:child_process', 'child_process', 'execSync', 'spawnSync', 'spawn(', 'exec(', 'process.env', 'Math.random', 'Date.now', 'setTimeout', 'setInterval', 'require(']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not use ${forbidden}`);
    }
  }
});

test('mcp static guard: imports stay inside the exact read-only/pure domain allowlist', () => {
  const allowedPrefixes = [
    './types.js',
    './validate.js',
    './context.js',
    './inspect.js',
    './registry.js',
    './drafting.js',
    './persist.js',
    './changes.js',
    './index.js',
    'node:buffer',
    '../../api/validate.js',
    '../../drafting/proposal.js',
    '../../schema/registry.js',
    '../../trusted/index.js',
    '../../writing/controlled-write.js',
    '../../writing/types.js',
    '../../reader/index.js',
    '../../storage/read/index.js',
    '../../storage/read/read-record.js',
    '../../storage/read/history.js',
    '../../storage/registry/compose.js',
    '../../storage/trusted-input/bootstrap-input.js',
    '../../storage/format/index.js',
    '../../storage/format/taxonomy.js',
    '../../storage/format/identifier.js',
    '../../storage/types.js',
  ];
  for (const file of mcpFiles) {
    const content = readFileSync(file, 'utf8');
    const importMatches = content.matchAll(/^import[^\n]*?from\s+['"]([^'"]+)['"]/gm);
    for (const match of importMatches) {
      const specifier = match[1]!;
      const allowed = allowedPrefixes.some((p) => specifier === p || specifier.startsWith(p));
      assert.equal(allowed, true, `${rel(file)} imports ${specifier} outside the read-only allowlist`);
    }
    // The storage BARREL must never be imported (it re-exports mutation).
    assert.equal(content.includes("'../../storage/index.js'"), false, `${rel(file)} must not import the storage barrel`);
    // No mutation vocabulary anywhere in the adapter.
    for (const forbidden of ['publishRecord', 'publishImmutableRecord', 'publishRecoveryBoundRecord', 'executeRecoveryMutation', 'executeRetentionMutation', 'acquireWriterLock', 'releaseWriterLock', 'breakWriterLock', 'executeConfigurationRecovery', 'persistRecoveryConfigurationMetadata', 'createWriteCapability', 'createRecoveryCapability', 'createRetentionCapability', 'createInitializationCapability', 'createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createStorageWriteActionProvenance', 'createRecoveryActionProvenance', 'createRetentionActionProvenance', 'createTrustedWriteRequest', 'createTrustedRecoveryRequest', 'createTrustedRetentionRequest', 'unlinkSync', 'renameSync', 'writeFileSync', 'mkdirSync', 'rmSync', 'chmodSync', 'chownSync', 'copyFileSync', 'openSync']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
    // WP-9 Slice 2: the adapter may consume the WP-8K read-only history API
    // but never reconstruction producers/mutators or recovery evidence
    // publication (reconstruction authority stays out of the MCP layer).
    for (const forbidden of ['buildRecoveryAuditReconstructionEvent', 'buildAuditReconstructionEvidenceRecord', 'publishRecoveryEvidence', 'reconstruct.ts', 'recovery/reconstruct', 'recovery/evidence']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
    // The only history dependency allowed is the accepted read-only entry.
    if (content.includes('inspectAuditHistory')) {
      assert.equal(content.includes("from '../../storage/read/index.js'"), true, `${rel(file)} must import inspectAuditHistory only from the read composition`);
    }
    // WP-14A persistence adapter: the ONLY write-capable adapter. It must
    // not contain any generic write primitive vocabulary.
    if (file.endsWith('persist.ts')) {
      assert.equal(content.includes('writeFileSync'), false, 'persist.ts must not use generic write vocabulary');
      assert.equal(content.includes('openSync'), false, 'persist.ts must not open files');
    }
  }
});

test('mcp static guard: entry point exports no authority creator, permit, or raw reader', () => {
  const entry = readFileSync(join(MCP_SRC, 'index.ts'), 'utf8');
  for (const forbidden of ['createRecoveryCapability', 'createWriteCapability', 'createRetentionCapability', 'createConfigurationRecoveryMetadataPermit', 'createRecoveryPublicationPermit', 'createTrustedStorageBootstrapInput', 'persistRecoveryConfigurationMetadata', 'publishRecord', 'executeRecoveryMutation', 'readFileSync', 'openSync']) {
    assert.equal(entry.includes(forbidden), false, `entry must not export ${forbidden}`);
  }
  assert.equal(/createMcpInspectionSurface/.test(entry), true, 'the entry must export the surface factory');
  assert.equal(/createInspectionContext/.test(entry), true, 'the entry must export the context factory');
});

test('mcp static guard: package export maps ./mcp to the adapter entry point only', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { exports?: Record<string, { types?: string; import?: string }> };
  assert.equal(pkg.exports?.['./mcp']?.import, './dist/adapters/mcp/index.js');
  assert.equal(pkg.exports?.['./mcp']?.types, './dist/adapters/mcp/index.d.ts');
});

test('mcp static guard: the closed tool inventory includes exactly the six committed tools', () => {
  const types = readFileSync(join(MCP_SRC, 'types.ts'), 'utf8');
  assert.equal(/MCP_INSPECTION_TOOLS = \['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class'\]/.test(types), true, 'the closed tool inventory must be exactly the six-tool vocabulary');
});

test('mcp static guard: WP-14A controlled-producer vocabularies are exactly one tool each and stay separate', () => {
  const persist = readFileSync(join(MCP_SRC, 'persist.ts'), 'utf8');
  assert.equal(/MCP_PERSIST_TOOLS = \['persist-artifact'\]/.test(persist), true, 'the persistence vocabulary must be exactly the one-tool vocabulary');
  const changes = readFileSync(join(MCP_SRC, 'changes.ts'), 'utf8');
  assert.equal(/MCP_CHANGES_TOOLS = \['inspect-changes'\]/.test(changes), true, 'the changed-context vocabulary must be exactly the one-tool vocabulary');
  // The WP-14A adapters never extend the WP-9 inspection vocabulary.
  assert.equal(persist.includes('MCP_INSPECTION_TOOLS ='), false, 'persist.ts must not redefine the inspection vocabulary');
  assert.equal(changes.includes('MCP_INSPECTION_TOOLS ='), false, 'changes.ts must not redefine the inspection vocabulary');
  // The persistence adapter is Model B: it must reference the trusted
  // validation composition and the WP-11 core, and its closed request
  // envelope must NEVER admit caller validation provenance fields.
  assert.equal(persist.includes('createDraftProposalWithSchemaRegistry'), true, 'persist.ts must reuse the accepted validation composition');
  assert.equal(persist.includes('persistValidatedArtifactDraft'), true, 'persist.ts must route through the committed WP-11 core');
  const persistKeys = persist.match(/PERSIST_REQUEST_KEYS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/);
  assert.ok(persistKeys !== null, 'the closed persist envelope must be declared');
  for (const forbidden of ['draft', 'ok', 'valid', 'canonicalUtf8', 'digest', 'validation', 'destination', 'overwrite']) {
    assert.equal(persistKeys[1]!.includes(`'${forbidden}'`), false, `the persist envelope must never admit caller ${forbidden} provenance`);
  }
  // The changed-context adapter composes the WP-7 boundaries only.
  assert.equal(changes.includes('git-status'), true, 'changes.ts must derive the changed set from fresh Git inspection');
  assert.equal(changes.includes('read-text'), true, 'changes.ts must route content reads through the WP-7 read boundary');
});

test('mcp static guard: multi-store registration is host composition, not a tool, and exposes no authority (WP-9 Slice 4)', () => {
  const registry = readFileSync(join(MCP_SRC, 'registry.ts'), 'utf8');
  // The registry is NOT an inspection tool: it never registers a tool name.
  assert.equal(/MCP_INSPECTION_TOOLS/.test(registry), false, 'registry.ts must not extend the tool vocabulary');
  // Registration inputs are trusted composition operands only; no fs/path fields.
  for (const forbidden of ['readonly locator', 'readonly root', 'readonly path', 'node:fs', 'node:child_process', 'process.env', 'Math.random', 'Date.now', 'createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createRecoveryCapability', 'createWriteCapability', 'publishRecord', 'executeRecoveryMutation', 'executeRetentionMutation', 'acquireWriterLock', 'unlinkSync', 'writeFileSync', 'mkdirSync', 'rmSync', 'openSync', 'net.createServer', 'http.createServer', '@modelcontextprotocol']) {
    assert.equal(registry.includes(forbidden), false, `registry.ts must not reach ${forbidden}`);
  }
  // The registry routes only through the committed surface; it never exposes
  // trusted inputs, contexts, or capabilities.
  assert.equal(registry.includes('trustedConfiguration'), true, 'registration inputs carry the trusted configuration operand');
  assert.equal(/readonly trustedInput: unknown/.test(registry), true, 'the trusted input remains an opaque host operand');
  assert.equal(registry.includes('createInspectionContext'), true, 'registration uses the exact single-store verification');
  assert.equal(registry.includes('createMcpInspectionSurface'), true, 'routing delegates to the committed surface');
  assert.equal(/SURFACE_ID_RE = \/\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\$\//.test(registry), true, 'the closed logical selector pattern must reject path/locator material');
  // The entry point exports the registry factory but no authority.
  const entry = readFileSync(join(MCP_SRC, 'index.ts'), 'utf8');
  assert.equal(/createMcpInspectionRegistry/.test(entry), true, 'the ./mcp entry exports the registry factory');
  for (const forbidden of ['createTrustedStorageBootstrapInput', 'createRecoveryCapability', 'createWriteCapability', 'persistRecoveryConfigurationMetadata']) {
    assert.equal(entry.includes(forbidden), false, `entry must not export ${forbidden}`);
  }
});

test('mcp static guard: the adapter is transport-free (no server/runtime imports) and dependency-free', () => {
  for (const file of mcpFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['@modelcontextprotocol', 'mcp/', 'net.createServer', 'http.createServer', 'WebSocket', 'node:net', 'node:http']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not import a transport or server runtime`);
    }
  }
});

test('mcp static guard: drafting adapter routes through the accepted Slice 1 core with the exact registered registry (WP-10 Slice 2)', () => {
  const drafting = readFileSync(join(MCP_SRC, 'drafting.ts'), 'utf8');
  // The adapter composes the accepted Slice 1 injection seam — it never reimplements drafting.
  assert.equal(drafting.includes('createDraftProposalWithSchemaRegistry'), true, 'the adapter must consume the accepted core seam');
  assert.equal(/createDraftProposal\(/.test(drafting), false, 'the adapter must not call the default-registry wrapper');
  assert.equal(drafting.includes('context.schemaRegistry'), true, 'routing must use the exact registered registry instance');
  // The exact accepted WP-9 selector grammar is reused, never re-derived.
  assert.equal(drafting.includes('SURFACE_ID_RE'), true, 'the closed surfaceId grammar must be the accepted constant');
  assert.equal(drafting.includes('SURFACE_ID_MAX_LENGTH'), true, 'the selector bound must be the accepted constant');
  // No storage, lifecycle, authority, execution, or workspace vocabulary
  // (tokens chosen to avoid the boundary documentation itself).
  for (const forbidden of ['trustedConfiguration', 'trustedInput', 'verifyStoreInstance', 'publishRecord', 'createWriteCapability', 'createReadCapability', 'RuntimeGrant', 'approve', 'issue(', 'activate(', 'locator:', 'readFileSync', 'require(']) {
    assert.equal(drafting.includes(forbidden), false, `drafting.ts must not reach ${forbidden}`);
  }
  // The drafting vocabulary is separate from the inspection inventory (the
  // docstring may reference the constant; the code must not import it).
  assert.equal(/MCP_DRAFT_TOOLS = \['draft-artifact'\]/.test(drafting), true, 'the future drafting vocabulary is exactly one tool');
  const importSection = drafting.split('\n').filter((l) => l.startsWith('import'));
  assert.equal(importSection.some((l) => l.includes('MCP_INSPECTION_TOOLS')), false, 'drafting.ts must not import the inspection inventory');
  // The inspection registry is NOT widened into drafting operations.
  const registry = readFileSync(join(MCP_SRC, 'registry.ts'), 'utf8');
  assert.equal(registry.includes('createDraftProposal'), false, 'the inspection registry must not route drafting');
  assert.equal(registry.includes('MCP_DRAFT_TOOLS'), false, 'the inspection registry must not know the drafting vocabulary');
  // The entry point exports the drafting registry/context but no authority.
  const entry = readFileSync(join(MCP_SRC, 'index.ts'), 'utf8');
  assert.equal(/createMcpDraftingRegistry/.test(entry), true, 'the ./mcp entry exports the drafting registry factory');
  assert.equal(/createDraftingContext/.test(entry), true, 'the ./mcp entry exports the drafting context factory');
  for (const forbidden of ['createTrustedStorageBootstrapInput', 'createRecoveryCapability', 'createWriteCapability', 'persistRecoveryConfigurationMetadata']) {
    assert.equal(entry.includes(forbidden), false, `entry must not export ${forbidden}`);
  }
});
