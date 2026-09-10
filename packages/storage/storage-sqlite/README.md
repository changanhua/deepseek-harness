---
description: "SQLite storage backend for hosts and maintainers choosing, configuring, or debugging document-per-row KV storage in one database file."
kind: "package-reference"
---

# @deepseek-ai/dsh-storage-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-storage-sqlite` hosts routed units in one SQLite database file, storing each record as one JSON document per row. A composition can mount several named instances and require an instance to prove exclusive ownership, commit synchronization, and a private filesystem root before a domain opens. Choose it for frequent point-sized writes or a local queryable database; choose the JSON backend when humans need plain files. The backend is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a composition keeps frequently updated domain data in one database: route the relevant domains to this backend and each unit materializes as tables in the configured database file.

### When to choose it

Choose it when writes are frequent and point-sized — each key maps to exactly one row, so updating one record touches one row instead of rewriting a whole file. Choose the JSON backend when humans inspect or edit the stored data as plain files. The synchronous `node:sqlite` driver blocks the JavaScript thread for the duration of each single-statement call, which is fine at domain-data scale but worth accounting for at high write rates.

### Configuration

The default instance remains compatible with existing configurations. Use explicit ownership, synchronization, identity, and directory controls only for domains that require those guarantees. `:memory:` opens an in-process database whose contents disappear with the process.

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-sqlite'
  config:
    path: /var/lib/dsh/data.db
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: sqlite
```

| Field | Default | Meaning |
|---|---|---|
| `backendName` | `sqlite` | Storage hub registration name |
| `path` | required | SQLite database file path, or `:memory:` |
| `journalMode` | `wal` | Journal mode: `wal`, `delete`, `truncate`, or `persist` |
| `pathBase` | `cwd` | Resolve relative paths from the process cwd or `dsh-home` |
| `ownership` | `shared` | Shared locking or a file-backed `exclusive` connection |
| `synchronous` | SQLite default | `normal`, `full`, or `extra`; `full` and `extra` declare `commit-sync` |
| `applicationId` | unset | File-only non-zero identity; foreign or unversioned databases reject |
| `privateDirectory` | `false` | Create or verify an owner-private local directory before opening |

`exclusive` requires a file-backed `delete` journal and holds the connection lock until close; a second owner fails immediately. `applicationId` also requires a file because an in-memory database cannot retain the identity across reopen. `privateDirectory` creates and verifies each protected DACL component on Windows NTFS and rejects unsafe existing ACLs, reparse points, hard-link aliases, UNC paths, and non-NTFS volumes. It does not isolate another process running as the same Windows user. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-storage-sqlite) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

Missing directories and database files use owner-only POSIX modes when supported. With `privateDirectory`, the backend verifies the real directory and file permissions before SQLite opens. An explicit `applicationId` prevents an empty-looking foreign database from being claimed; incompatible physical or unit versions reject rather than migrate. Writes are durable once resolved under the configured SQLite guarantees.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The backend is a document-per-row layout over one `node:sqlite` connection, designed so a per-key update is a single prepared statement.

### Design concept

- **Document per row.** Each unit table becomes a physical STRICT table `u_<unit>_<table> (key TEXT PRIMARY KEY, value TEXT)` whose `value` column holds the record's JSON text; the global singleton lives in a shared `unit_globals` table. One key update touches exactly one row — the reason to route a high-churn domain here.
- **Single-statement atomicity.** Every write primitive is one prepared statement, so SQLite's per-statement atomicity satisfies the KV contract without explicit transactions; write ordering stays the caller's responsibility (the domain layer's write chain).
- **Names validated before DDL.** Unit and table names must match `UNIT_NAME_RE` before they reach DDL, so no external input is ever interpolated into SQL identifiers.
- **Versions fail loud.** The physical layout version lives in `PRAGMA user_version` (fresh databases stamp it last); unit format versions live in the `units` table. Any other stamped value rejects — no migrations.

### Open sequence

Open disables extension loading, applies connection security settings, verifies the optional private path, acquires the requested lock, and checks journal mode, application identity, and physical version in a transaction before publishing readiness. Fresh metadata and each unit's tables materialize transactionally, so failed initialization leaves neither a version stamp nor a partial unit registration.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: named registration, configuration, guarantees, unit table |
| [`src/schema.ts`](src/schema.ts) | Open sequence, physical layout version, metadata tables, record table naming |
| [`src/private-directory.ts`](src/private-directory.ts) | Private path creation and native permission verification |
| [`src/unit.ts`](src/unit.ts) | One opened unit: prepared statements, JSON value parse, close |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: versions are open-time checks) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this backend's view is not enough: the subsystem reference is the authoritative contract, and the sibling backend shows the alternative medium.

- [Storage subsystem](../../../docs/subsystems/storage.md) — the backend contract, domain semantics, and generated API.
- [Storage package map](../README.md) — the family's packages and their repository position.
- [JSON storage backend](../storage-json/README.md) — the human-readable medium for small, inspectable data.
- [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) — the design behind the backend family and the deferred session-backend migration.

-----

<a id="model-experience"></a>
## Model Experience

### Stored domain records

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists non-session domain data behind `ctx.storage` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Synchronous driver blocks the event loop** — each write is a synchronous `DatabaseSync` call; the block lasts a single statement, which is acceptable at domain-data scale.
- **No busy-wait or lock stealing** — a competing connection rejects immediately; exclusive ownership never waits for, terminates, or recovers another process.
- **Windows ACLs do not isolate the same user** — another process with the same user token can read the database file; capability discovery and Agent authorization require a separate policy layer.
- **Only the current physical layout version opens** — any other stamped `user_version` is rejected rather than migrated (pre-release stance).
- **Open sequence duplicated from the session packages** — `openDatabase` mirrors the session-persistence SQLite open sequence; extraction into a shared medium layer is deferred to the planned session-backend migration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
