---
description: "Host and Client workspace control: mutate workspace navigation and follow its complete projection."
kind: "package-reference"
---
# Workspace Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-workspace-controller` owns the Host `ctx.workspaceController` service and the generated Client `ctx.remote.workspace` namespace. Its Remote methods create, rename, remove, and reorder Workspaces, reorder Sessions within a Workspace, archive Sessions from Workspace navigation, and follow the complete Workspace projection. Use it through API Gateway when a Client must change or follow Workspace navigation. The package also owns `ctx.directoryPickerController` and the generated `ctx.remote.directoryPicker` namespace, because the directory-picking seam it carries is abstract and never a Loader entry of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

<a id="project-resources"></a>
### Project resources

The project resource operations save version-1 configuration in `.dsh/resources.json` beneath the registered Workspace. New notes are ordinary UTF-8 Markdown files in `.dsh/resources/`; existing file references and service working directories must resolve inside the project, including through links. Removing an entry retains its files. Text previews and configuration are bounded by `resourceMaxBytes` (262144 by default). Agents read these ordinary files through existing file tools; this package adds no model tools or automatic context injection.

Service recipes contain a foreground command, working directory and optional HTTP(S) address. A human starts them through the Workspace Remote; the local subprocess provider owns their process trees and scrubs inherited credentials. Windows commands use noninteractive PowerShell; other local hosts use `sh`. Processes outlive conversations and stop on controller disposal or normal Host exit; a new Host starts with stopped recipes. `running` describes a process, not application health. Each recipe retains bounded recent stdout/stderr (`resourceLogBytes`, default 65536); `resourceGraceMs` (default 2000) controls termination escalation. There is no automatic restart or durable log archive.

Writes acquire `.dsh/resources.lock` and atomically replace configuration. A concurrent writer receives a busy error and can retry explicitly. A crash may leave the lock: remove that exact lock only after verifying no writer is active. Malformed or unsupported configuration is rejected without replacement. Multiple Hosts do not share process ownership; this is a local project resource facility, not a service supervisor across Hosts.

The Host controller serializes mutations whose correctness depends on current registry state and returns stable `WorkspaceError` values for expected failures. Its `follow()` stream synchronously attaches to durable Workspace changes, emits one complete baseline first, then emits ordered `upsert`, `remove`, `order`, and `archived` increments. A reconnect starts another generation with a replacement baseline, so consumers do not depend on receiving every increment while disconnected.

The Client entry provides `ClientWorkspaceModel` and `createWorkspaceStateStream()`. The model owns Workspace rows, registry order, archived Session ids, unary mutation echoes, and stream/unary race resolution. A newer Host row wins by `updatedAt`; a committed stream order outranks an older unary response; a removed Workspace id cannot be resurrected by delayed data. The package exposes framework-neutral snapshots and subscriptions, leaving navigation policy and React hooks to the UI owner.

-----

<a id="model-experience"></a>
## Model Experience

None, as Workspace organization is browser and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; Workspace mutations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `follow()` replaces the whole projection after reconnect and has no durable cursor or incremental catch-up protocol.
- Process-local deletion markers prevent delayed data from reviving a removed Workspace only for the lifetime of the Client model.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
