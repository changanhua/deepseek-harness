# @changanhua/dsh-image-generation-task-queue

English | [中文](README.zh.md)

Queue v2 `image.generate@1` WorkHandler. Admission resolves image-provider facts before persistence; dispatch generates images and saves them through `ctx.attachments` before reporting durable attachment references.

## Scheduling

Each attempt claims one `image-generation` resource unit. Deployment capacity and Queue batch limits determine parallelism. `maxAttempts` defaults to `1` and is supplied by the handler's Cordis configuration before admission.

## Model Experience

Indirectly, through `@changanhua/dsh-tool-image-generation-task-queue`, which owns image admission schemas and rendered results.

#### KV Cache effect

No direct invalidation; the named tool owns model-visible changes.

## Known Limitations and Deferred Work

- One WorkItem represents one prompt and one resolved provider request.
- Provider failures retain category, side-effect, and retry evidence; Queue policy decides whether a retry is allowed.
