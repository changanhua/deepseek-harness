# @changanhua/dsh-image-generation-arkcli

English | [中文](README.zh.md)

Host provider that implements `ctx.imageGeneration` through ArkCLI. Admission resolves the active Agent Plan profile, canonical image model, and supported parameters. Generation consumes those persisted facts, invokes `arkcli +gen`, fully decodes the result, and removes its private temporary directory.

## Config

`executable` and `argvPrefix` select the ArkCLI launcher. Output, image byte/pixel, aspect-ratio, process-grace, and quiescence fields bound host resource use and fail loudly when invalid.

## Model Experience

Indirectly, through the image-generation Queue handler and its model-facing admission tool.

#### KV Cache effect

No direct invalidation; the owning tool controls model-visible schemas and results.

## Known Limitations and Deferred Work

- The active profile must be an Agent Plan profile with a compatible image model.
- One generation invocation must produce exactly one PNG or JPEG file.
- Retry classification reports provider evidence but does not authorize a retry.
