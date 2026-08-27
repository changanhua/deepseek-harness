# @deepseek-ai/dsh-tool-image-generation-task-queue

English | [中文](README.zh.md)

Agent-facing Queue v2 admission tools for `image.generate@1`. `image_generate_enqueue` submits one finished prompt and provider-supported output settings. `image_generate_enqueue_batch` atomically submits ordered, individually titled prompts with one positive `maxParallel` bound. Both tools derive owner authority from the current Session and leave provider execution controls to the host.

## Model Experience

Indirectly, through the `image_generate_enqueue` and `image_generate_enqueue_batch` tool schemas and their rendered Queue ids.

#### KV Cache effect

The tool schema changes the reusable request prefix when this plugin is mounted or removed.

## Known Limitations and Deferred Work

- Batch admission requires every prompt and output setting to be complete before the call.
- The caller must supply a live Agent session and cannot select Queue execution internals.
