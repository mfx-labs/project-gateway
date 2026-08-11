# WP-14B — Operator Onboarding: Tunnel Launch and ChatGPT Connector

**Status:** Current operator-facing documentation (WP-14B).
**Applies to:** the external Secure MCP Tunnel / ChatGPT connector path for
the local Gateway stdio runtime (`project-gateway-mcp`).

## 1. Model

Transport is external and operator-owned. The Gateway ships ONE local stdio
MCP CLI:

```text
project-gateway-mcp --config <file>
```

The external Secure MCP Tunnel launches this command (the tunnel's
`--mcp.command`), bridges MCP over the stdio pair, and exposes it to the
ChatGPT connector as a registered MCP server. The Gateway itself contains
no HTTP server, no OAuth server, no TLS endpoint, no token exchange, no
daemon, no scheduler, no service manager, and no secret store (runtime
static guards enforce this). Tunnel/auth credentials live with the
external tunnel/platform only and never enter Gateway configuration,
artifacts, MCP requests/responses, or committed examples.

## 2. Configure the Gateway Surface

Operator-owned startup configuration (JSON, closed fields):

```json
{
  "surfaces": [
    {
      "surfaceId": "main",
      "locator": "/path/to/gateway-store",
      "configurationIdentity": "sha-256:<64-hex>",
      "configurationVersion": "2",
      "workspaces": [
        {
          "workspaceId": "pgw:w:<32-hex>",
          "root": "/path/to/project",
          "artifactLocation": "/path/to/project/artifacts"
        }
      ],
      "gitPath": "/usr/bin/git",
      "gitHome": "/var/lib/gateway/git-home",
      "gitTmpdir": "/var/lib/gateway/git-tmp"
    }
  ]
}
```

Field notes:

- `locator` is the directory containing the initialized trusted store
  (`store-v1/`, `config-v1/`). `configurationIdentity`/`configurationVersion`
  must match the store metadata.
- `workspaces` enables the two WP-14A producer surfaces (`persist-artifact`,
  `inspect-changes`). Version `2` configuration is required for
  `artifactLocation` (a strict descendant of `root`, existing directory).
- `gitPath` must be the supported pinned Git binary (2.45.4); a
  non-conforming binary fails startup closed.
- `gitHome`/`gitTmpdir` are EMPTY, operator-owned directories OUTSIDE every
  workspace root — the isolated environment for the controlled Git child
  process. The operator's real home directory can never be used (it is not
  empty). Absent fields fail startup closed with a typed message.
- A surface without `workspaces` still serves the seven inspection/drafting
  tools; the two WP-14A tools return the typed `unsupported` outcome for it.

No credentials appear anywhere in this file. `--config` is the only CLI
argument; the config file should be `chmod 600` operator-owned.

## 3. Launch Through the Tunnel

Run the tunnel with the Gateway CLI as its MCP command, e.g. (conceptual;
exact flags belong to the external tunnel platform):

```text
secure-mcp-tunnel --mcp.command "project-gateway-mcp --config /etc/gateway/gateway-config.json"
```

The Gateway process speaks MCP over stdio only; the tunnel owns the
listener, TLS, and authentication. Startup failures (missing/invalid
config, store mismatch, lane misconfiguration) exit nonzero with a bounded
stderr diagnostic and no stdout output — the tunnel sees a clean child
failure.

## 4. Connect ChatGPT

Register the tunnel-published MCP server in the ChatGPT connector using
the external platform's normal server-registration flow (server URL and
operator-issued credentials belong to the tunnel/platform, never to the
Gateway). After registration the connector discovers the Gateway's closed
nine-tool vocabulary:

`validate-artifact`, `inspect-stored-record`, `inspect-registry`,
`inspect-audit-history`, `verify-record`, `enumerate-class`,
`draft-artifact`, `persist-artifact`, `inspect-changes`.

Verify discovery by listing the registered server's tools in the ChatGPT
connector UI (or equivalent); the nine names above must appear and no
approve/issue/activate/execute/receipt tool may exist.

## 5. Invoke the Workflows

Short invocation semantics are UX only — no protocol state exists behind
them. Conceptually:

- `@gateway changes` — retrieves the current changed project state. The
  supported equivalent today is the direct `inspect-changes` tool call
  (workspace + optional `diff`/`paths`); a ChatGPT Skill/App may wrap it in
  the short phrasing if the platform supports custom workflows.
- "create a task spec" — ChatGPT drafts the artifact content, then calls
  `persist-artifact` (which independently revalidates under Model B; the
  derived destination needs no path input).
- Review flows — ChatGPT calls `inspect-changes` itself; no file/diff
  paste is required.

Every action returns concise typed feedback (persisted evidence, changed
set, or a typed failure). No `ActiveContext`, `HotkeyRecord`, browser
automation, event bus, or daemon exists or is planned.

## 6. Credential Placement

- Tunnel/auth credentials: operator-local, external tunnel/platform-owned
  (their own store/environment). Never in Gateway configuration, artifacts,
  MCP requests or responses, fixtures, or committed examples.
- Gateway runtime configuration is secret-free by contract (ADR-040
  Decision D).
- Transport authentication is distinct from Gateway protocol/lifecycle
  authority: authenticating to the tunnel grants no Gateway authority.

## 7. Shut Down Cleanly

- Close the ChatGPT/connector session: the tunnel closes the stdio pair;
  the Gateway exits cleanly on EOF (verified behavior; no half-written
  state — persistence is create-only through WP-11, and a failed write
  cleans its partial target or reports indeterminate state typed).
- For direct control, terminate the Gateway process (`SIGTERM`/`SIGINT`);
  the tunnel reports the child exit. No in-flight MCP request is
  acknowledged after shutdown.
