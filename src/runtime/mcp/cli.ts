#!/usr/bin/env node
/**
 * WP-9 Slice 5 — local stdio MCP runtime CLI (project-gateway-mcp).
 *
 * Trusted composition root: loads the operator-owned startup configuration
 * (--config), reconstructs genuine trusted registrations through the
 * private/trusted composition pipeline, builds the committed host-owned
 * registry, and serves the six read-only inspection tools over stdio MCP
 * through the official SDK's `serveStdio` entry (which owns protocol
 * negotiation/framing for the modern 2026-07-28 protocol generation and
 * SDK-managed legacy compatibility).
 *
 * STDOUT IS MCP PROTOCOL ONLY — no banners, no stdout logging. All operational
 * diagnostics go to bounded stderr.
 *
 * The OpenAI Secure MCP Tunnel, ChatGPT connector configuration, and all
 * tunnel protocol work are NOT part of this CLI (WP-14 owns that
 * integration); the local CLI is the command an external tunnel client will launch.
 */
import { readFileSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadRuntimeConfig } from './config.js';
import { composeTrustedRegistry } from './compose.js';
import { createMcpServer } from './server.js';
import { writeDiagnostic } from './diagnostics.js';

const USAGE = 'usage: project-gateway-mcp --config <file>\n';

interface CliArgs {
  readonly configPath: string;
}

function parseArgs(argv: readonly string[]): { readonly ok: true; readonly args: CliArgs } | { readonly ok: false; readonly message: string } {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stderr.write(USAGE);
    process.exit(0);
  }
  if (argv.length !== 2 || argv[0] !== '--config') {
    return { ok: false, message: USAGE };
  }
  const rawPath = argv[1];
  if (rawPath === undefined || rawPath.length === 0) return { ok: false, message: USAGE };
  return { ok: true, args: { configPath: rawPath } };
}

function packageIdentity(): { readonly name: string; readonly version: string } {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { readonly name?: string; readonly version?: string };
    return { name: pkg.name ?? 'project-gateway-mcp', version: pkg.version ?? '0.0.0' };
  } catch {
    return { name: 'project-gateway-mcp', version: '0.0.0' };
  }
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(parsed.message);
    process.exit(2);
  }
  const loaded = loadRuntimeConfig(parsed.args.configPath);
  if (!loaded.ok) {
    writeDiagnostic(loaded.message);
    process.exit(1);
  }
  const composed = composeTrustedRegistry(loaded.config);
  if (!composed.ok) {
    writeDiagnostic(composed.message);
    process.exit(1);
  }
  const identity = packageIdentity();
  const server = createMcpServer(composed.registry, identity);
  // The SDK owns the stdio transport, the era decision (modern 2026-07-28
  // opening plus SDK-managed legacy compatibility), framing, and shutdown on
  // EOF. No manual JSON-RPC parsing/writing; no session state; no listener.
  serveStdio(() => server, {
    onerror: (error) => writeDiagnostic(`runtime error: ${error.message}`),
  });
}

main();
