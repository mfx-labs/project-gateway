/**
 * WP-9 Slice 5 — runtime static security guards.
 *
 * Proves the local stdio MCP runtime:
 *   - imports the MCP SDK only in runtime/server modules (never in the
 *     accepted domain/storage/adapter layers);
 *   - imports no HTTP/net/server framework, no tunnel-client, no auth/OAuth
 *     dependency;
 *   - never writes to stdout (no console.log / process.stdout) in runtime
 *     production source — stdout is MCP protocol only;
 *   - keeps trust creators localized to the composition root (compose.ts);
 *   - reaches no storage mutation owner from the protocol registration layer;
 *   - registers exactly the six committed inspection tools;
 *   - exposes no trusted creators through package exports;
 *   - the package `bin` entry maps to the runtime CLI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const RUNTIME_SRC = join(REPO, 'src', 'runtime', 'mcp');

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

const runtimeFiles = collectTsFiles(RUNTIME_SRC);
assert.ok(runtimeFiles.length >= 4, 'the runtime source tree must exist');

test('runtime static guard: no stdout writes, no network, no tunnel, no auth, no subprocess in runtime production source', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['console.log', 'console.info', 'console.warn', 'process.stdout.write', 'node:net', 'node:http', 'net.createServer', 'http.createServer', 'WebSocket', 'node:tls', 'node:https', '@modelcontextprotocol/tunnel', 'tunnel-client', 'oauth', 'OAuth', 'child_process', 'spawn(', 'exec(', 'node:dgram']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not use ${forbidden}`);
    }
  }
});

test('runtime static guard: SDK imports appear only in server/cli modules, never in accepted layers', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('@modelcontextprotocol/')) {
      assert.equal(/(server\.ts|cli\.ts)$/.test(file), true, `${rel(file)} may import the SDK only in the server/cli modules`);
    }
  }
  // The accepted layers stay SDK-independent.
  for (const dir of ['src/adapters/mcp', 'src/storage', 'src/api', 'src/schema', 'src/trusted']) {
    for (const file of collectTsFiles(join(REPO, dir))) {
      const content = readFileSync(file, 'utf8');
      assert.equal(content.includes('@modelcontextprotocol'), false, `${rel(file)} must not import the MCP SDK`);
    }
  }
  const rootIndex = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  assert.equal(rootIndex.includes('@modelcontextprotocol'), false, 'src/index.ts must stay SDK-free');
});

test('runtime static guard: trust creators are localized to the composition root and never re-exported', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('compose.ts')) {
      assert.equal(content.includes('createTrustedStorageBootstrapInput'), true, 'compose.ts owns the trusted-input creation');
      assert.equal(content.includes('createStorageBootstrapActionProvenance'), true, 'compose.ts owns the provenance creation');
      assert.equal(content.includes('markValidatedTrustedWorkspaceConfiguration'), true, 'compose.ts owns the configuration brand');
      // In-process capability-generation seeding: the initialization
      // capability is created only to establish the generation entry and is
      // disposed immediately; no mutation operation is ever performed.
      assert.equal(content.includes('createInitializationCapability'), true, 'compose.ts owns the generation seeding');
      assert.equal(content.includes('.dispose()'), true, 'the seeded capability must be disposed');
      assert.equal(content.includes('namespace-initialize'), false, 'no initialization operation may be invoked');
    } else {
      for (const forbidden of ['createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createRecoveryActionProvenance', 'createStorageWriteActionProvenance', 'createInitializationCapability', 'markValidatedTrustedWorkspaceConfiguration']) {
        assert.equal(content.includes(forbidden), false, `${rel(file)} must not create trusted material`);
      }
    }
  }
  const entry = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'index.ts'), 'utf8');
  for (const forbidden of ['createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createRecoveryCapability', 'createWriteCapability']) {
    assert.equal(entry.includes(forbidden), false, `the ./mcp entry must not export ${forbidden}`);
  }
});

test('runtime static guard: no storage mutation vocabulary in the runtime', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['publishRecord', 'publishImmutableRecord', 'executeRecoveryMutation', 'executeRetentionMutation', 'acquireWriterLock', 'releaseWriterLock', 'breakWriterLock', 'executeConfigurationRecovery', 'persistRecoveryConfigurationMetadata', 'unlinkSync', 'writeFileSync', 'mkdirSync', 'rmSync', 'chmodSync', 'renameSync']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('runtime static guard: exactly the six committed tools are registered', () => {
  const serverSrc = readFileSync(join(RUNTIME_SRC, 'server.ts'), 'utf8');
  const types = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'types.ts'), 'utf8');
  // The committed vocabulary remains exactly six.
  assert.equal(/MCP_INSPECTION_TOOLS = \['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class'\]/.test(types), true);
  for (const tool of ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class']) {
    assert.equal(serverSrc.includes(`registerTool(\n    '${tool}'`), true, `server.ts must register ${tool}`);
  }
  // No seventh tool registration.
  const registered = [...serverSrc.matchAll(/registerTool\(\n\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(registered.length, 6, `exactly six registerTool calls, got ${registered.length}`);
  // No admin/registration/health/list-stores tool names anywhere in the runtime.
  for (const forbidden of ['list-stores', 'register-store', 'select-store', 'unregister-store', 'health']) {
    assert.equal(serverSrc.includes(`'${forbidden}'`), false, `no ${forbidden} tool`);
  }
});

test('runtime static guard: the package bin entry maps to the runtime CLI', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { bin?: Record<string, string> };
  assert.equal(pkg.bin?.['project-gateway-mcp'], './dist/runtime/mcp/cli.js');
  assert.equal(Object.keys(pkg.bin ?? {}).length, 1, 'exactly one bin entry');
  // The CLI is the modern stdio entry: serveStdio, never connect(StdioServerTransport).
  const cliSrc = readFileSync(join(RUNTIME_SRC, 'cli.ts'), 'utf8');
  assert.equal(cliSrc.includes("from '@modelcontextprotocol/server/stdio'"), true);
  assert.equal(cliSrc.includes('serveStdio('), true);
  assert.equal(cliSrc.includes('StdioServerTransport'), false, 'the CLI must not hand-connect transports');
  assert.equal(cliSrc.includes('legacy:'), false, 'the CLI must use the SDK default legacy compatibility behavior');
});
