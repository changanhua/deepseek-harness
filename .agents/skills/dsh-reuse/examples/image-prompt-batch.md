# Example: batch image prompts and durable generation

## Need

Generate ten book covers through Queue without paying for ten one-shot Agent starts. Each book needs a high-quality, independently selected visual direction, while Ark authentication, model discovery, and image execution should be shared.

## Internal evidence

- `ctx.skills` discovers and loads project, user, and packaged prompting instructions.
- Queue v2 owns typed homogeneous Batches, durable WorkItems, Attempts, Results, resource claims, and Handler registration.
- `agent.run@1` starts a restricted one-shot DSH worker and is an expensive fallback, not the image execution path.
- The image-generation Service Definition and Ark Provider own authentication, client reuse, model resolution, and provider errors.

## Community evidence

Community image-prompt Skills contain useful composition, lighting, palette, typography, and model-adapter knowledge. A candidate that asks questions, executes its own provider script, modifies itself, or emits one unstructured prompt does not fit unattended batch compilation unchanged.

## Decision

`vendor/fork` the useful prompting knowledge into a pinned, text-only project Skill, then use a `bridge` for durable execution:

```text
project image-prompt-batch Skill
        ↓ one originating-Agent model step
strict array of typed image intents
        ↓ atomic Queue Batch admission
task-queue-handler-image
        ↓
ctx.imageGeneration
        ↓
Ark Provider
```

The Skill participates once before Queue admission. Compiled prompts and provenance are persisted in WorkItems or Batch shared data, so retries do not reload the Skill or regenerate successful prompts. Queue core never imports the Skill or Ark Provider; the Handler Bridge consumes the Queue and image-generation Service Definitions.

## Minimum new work

- a reviewed `image-prompt-batch` project Skill with strict JSON output and no scripts or self-modification;
- an `image.generate@1` WorkKind and Handler Bridge;
- a batch admission tool accepting compiled typed items;
- Ark image Provider reuse rather than one ArkCLI discovery per item;
- validation for item count, stable item IDs, exact title text, prompt bounds, aspect ratio, and result artifacts;
- a ten-cover benchmark proving one Skill load, one prompt-compilation step, zero DSH worker starts, shared Provider setup, and item-local retries.

## Rejected alternatives

- **One `agent.run@1` per image** — repeats Agent startup, Skill loading, resource discovery, and discretionary validation.
- **Load the Skill inside each image Handler** — couples execution to Agent instructions and repeats model work on retries.
- **Make Queue core understand prompting or Ark** — violates domain ownership and Provider substitution.
- **Create a generic batch compiler before a second consumer exists** — adds an abstraction before current evidence requires it.
