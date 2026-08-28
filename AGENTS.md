# AGENTS.md

> **语言规则：所有思考和回复必须使用中文。** 每次 compact 后重新读到此文件时，立即恢复中文思考和中文回复，不要用英文。

DeepSeek Harness is a plugin-based agent harness on vendored Cordis: **everything is a plugin**. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Pre-release stance

Compatibility and format-version rules are owned by the [Session package](packages/core/session/README.md) and [storage subsystem](docs/subsystems/storage.md); current formats may reject older data instead of shipping compatibility shims.

## Repository layout

Repository layout and package groups: see [packages/README.md](packages/README.md).

## Commands

Use repository scripts for install, test, typecheck, build, hygiene, docs, and e2e validation. See [docs/development.md](docs/development.md) and [docs/testing.md](docs/testing.md) for the command matrix.

Only `dsh` profiles launch supported Node applications; package bins, demos, and public SDK argv escapes are forbidden ([application launch](docs/architecture.md#application-launch)).

## Conventions

Package design, ownership, lifecycle, runtime-invariant, and Agent Note rules live in [packages/AGENTS.md](packages/AGENTS.md) and [.agents/notes/README.md](.agents/notes/README.md). Type, tunable, dependency, and source/artifact rules live in [docs/development.md](docs/development.md); validation, secrets, and provider-e2e policy live in [docs/testing.md](docs/testing.md); concurrency, subprocess, and teardown rules live in [docs/defensive-patterns.md](docs/defensive-patterns.md). Fork-specific differences are recorded in [FORK-DIVERGENCE.md](FORK-DIVERGENCE.md).
