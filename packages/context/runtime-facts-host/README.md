# @deepseek-ai/dsh-runtime-facts-host

English | [中文](README.zh.md)

Host-process Service Provider for [`@deepseek-ai/dsh-runtime-facts`](../runtime-facts/README.md). It owns the V1 host inventory, takes process and launch-environment snapshots where those are authoritative, and delegates hot-loadable execution-world and Web-server values to their owning services.

## Fact inventory

| Key | Freshness | Exposure | Source |
|---|---|---|---|
| `host.arch` | static | baseline | `process.arch` |
| `host.os` | static | baseline | `process.platform` |
| `runtime.execution-world` | dynamic | baseline | `ctx.subprocess.executionWorld` |
| `host.pid` | static | inspect | `process.pid` |
| `host.proxy.configured` | static | inspect | launch environment |
| `host.proxy.scheme` | static | inspect | sanitized proxy URL |
| `host.proxy.host` | static | inspect | sanitized proxy URL |
| `host.proxy.port` | static | inspect | sanitized proxy URL |
| `host.proxy.source` | static | inspect | fixed `env` category |
| `web.server-url` | dynamic | inspect | current `ctx.webServer` bind |

Every fact is synchronous. An absent subprocess or Web-server service makes its delegated fact unavailable rather than guessing from platform, package identity, configuration, or port state.

## Proxy sanitization

The provider reads one immutable launch-environment snapshot with precedence `HTTPS_PROXY` → `HTTP_PROXY` → `ALL_PROXY` → their lowercase forms. A valid URL yields only `configured`, lowercased `scheme`, `host`, optional numeric `port`, and `source: env`. Username, password, path, query, fragment, variable name, and raw URL are discarded. Missing or malformed input yields `host.proxy.configured: false` and leaves the other proxy facts unavailable.

The provider has no Cordis plugin config. Load `dsh-runtime-facts` first; subprocess and Host Web-server services remain optional and may hot-load independently.

## Model Experience

### Host baseline facts

#### What the model sees

Through the runtime-facts snapshot, the model sees `host.arch` and `host.os`; it also sees `runtime.execution-world` while a subprocess provider is mounted. PID, proxy metadata, and the Web URL are inspect-only and do not enter automatic context.

##### Typical fragment

```markdown
Host runtime facts:
- host.arch: x64
- host.os: win32
- runtime.execution-world: local
```

#### Token effect

Conditional and bounded by three baseline rows. Static host rows remain constant for the plugin lifetime; the execution-world row appears, changes, or disappears with the subprocess service.

#### KV Cache effect

Prefix-stable while these rows remain identical. A subprocess-provider change replaces the active runtime-context snapshot and may invalidate reuse from the changed context token.

## Known Limitations and Deferred Work

- **Host facts are deliberately narrow** — GPU, container, browser, network reachability, workspace, sandbox mode, and command resolution are not inferred here.
- **Proxy presence is not connectivity** — sanitized launch configuration does not prove that the proxy is reachable or used by a particular client.
- **Web URL describes the bound Host server only** — it does not claim browser reachability, route state, or forwarded public origin.
