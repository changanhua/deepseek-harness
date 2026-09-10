# Agent Note: Storage backend guarantees and private SQLite ownership

Status: implemented

English | [中文](2026-09-06-storage-backend-guarantees.zh.md)

## Problem

Some authoritative domains require properties stronger than the generic KV contract. A backend name or medium type does not prove that only one Host owns the medium, that resolved commits use an explicit synchronization level, or that the database lives in an owner-private directory. Treating those properties as assumptions lets a route silently weaken the domain that consumes it.

The SQLite provider also registered one fixed name. A composition could not mount a normal shared instance beside a stricter instance without adding another provider or changing every existing consumer.

## Decision

`StorageBackend.guarantees` declares a closed set of configured properties: `single-writer`, `commit-sync`, and `private-root`. A `DomainSpec` can list required guarantees. `DomainFacility.open()` compares the requirement with the routed backend before opening its KV facet and rejects a missing declaration with `backend-requirement-unsatisfied`.

The declaration is routing metadata, not proof by itself. A backend advertises a guarantee only for configuration that selects the corresponding enforcement, and its real `open()` still fails when the medium does not satisfy that configuration. Domains without requirements and backends without declarations retain the generic contract.

The SQLite provider accepts a `backendName`, so one composition can register independent instances. Relative paths retain the process-cwd default; `pathBase: dsh-home` explicitly anchors a path under the resolved Harness home.

## SQLite enforcement

`ownership: exclusive` is valid only for a file database with a `delete` journal. The connection uses zero busy timeout, obtains a real `BEGIN EXCLUSIVE` lock before readiness, and retains exclusive locking until close. A competing owner fails; the provider never waits for, terminates, or steals from another process.

`synchronous: full` and `synchronous: extra` declare `commit-sync` after SQLite returns the selected value. `applicationId` is file-only and rejects foreign, partially initialized, and mismatched databases before the provider creates storage tables. Connection security settings, journal mode, application identity, physical format, and base schema are checked before readiness; schema and unit materialization use transactions.

`privateDirectory` declares `private-root`. On Windows, the provider accepts local NTFS paths only, rejects reparse points and hard-link aliases, creates and revalidates each missing directory with a protected DACL, and validates existing directory and file ACLs without rewriting them. The fixed PowerShell helper receives the shared scrubbed parent environment plus only its two explicit path inputs. The allowed identities are the current user, SYSTEM, and local Administrators. On POSIX filesystems it requires owner-only targets, rejects symbolic-link databases, and rejects unsafe writable ancestors.

## Alternatives considered

**Infer guarantees from the backend name.** Rejected because two SQLite instances can intentionally have different locking, synchronization, and directory policies. A name indicates routing identity, not medium behavior.

**Let the domain open any backend and inspect it afterward.** Rejected because a semantic consumer would depend on provider internals, and an incompatible medium could be touched before the failure.

**Use a PID or age-based lock file.** Rejected because stale-owner recovery would duplicate operating-system ownership semantics and risks taking a live database. SQLite already releases its connection lock when the owning process exits.

**Apply Windows permissions after creating the database.** Rejected because content could exist before the restriction and an inherited ACL could remain broader than intended. New private directories receive their DACL at creation; existing paths are validation-only.

## Consequences

A sensitive domain can fail closed when routing loses a required property, while existing domains keep their current behavior. Named SQLite instances avoid a second storage control plane and keep policy in composition.

Exclusive ownership deliberately blocks direct concurrent readers, including file-copy backup tools. Backup and additional interfaces must use the owning Host or close it first.

Windows ACLs separate Windows principals, not processes running as the same user. Agent capability discovery and authorization remain separate policy responsibilities; `private-root` does not claim same-user process isolation, administrator isolation, or protection from faulty storage hardware.
