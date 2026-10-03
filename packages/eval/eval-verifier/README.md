---
description: "Check frozen outputs in a one-shot Profile without loading task code or calling a model."
kind: "package-reference"
---

# @changanhua/dsh-eval-verifier

English | [中文](README.zh.md)

## Summary

The checker validates the complete input shape, expected cell coverage and deterministic criteria. It writes one bounded report with the actual Profile, configuration and persistent Session identity. Host observation still owns authentication of the process and report.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The local Gate runner creates this private Profile with Sessions and SessionPersistence. It supplies exclusive input/output paths and byte limits; the app waits for appReady, materializes its owned Session handle, writes the report once, closes the handle and exits through appExit.

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.md)
- [Eval contracts](../../../docs/subsystems/eval.md)
- [Architecture](../../../docs/architecture.md)

<a id="model-experience"></a>
## Model Experience

None, as this package adds no model prompt or tool.

#### KV Cache effect

Existing Session prefixes remain unchanged; continuation only appends this round’s input. The checker makes no model request.

## Known Limitations and Deferred Work

No invariant companion is published because public state derives from existing owners or one ledger without a separate cached projection.

<a id="known-limitations-and-deferred-work"></a>

- This app does not grade arbitrary prose, compare baselines, execute task plugins or certify self-development. The pure verifySnapshot function returns an unbound runtime identity; only the Profile lifecycle supplies actual runtime facts. There is no separately cached service projection to justify an invariant companion.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
