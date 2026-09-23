# @deepseek-ai/dsh-llm-vision-relay

Composite vision-relay routes for the LLM seam: a text-only model can be selected
through a route that accepts images, because a separate vision model reads each
image first and the request carries attributable text evidence instead of pixels.

## Model

The plugin registers the `vision-relay` provider on `ctx.llm`. Each configured
route is one model id under that provider and dispatches to its declared
`target` route after rewriting the request.

```
user selects vision-relay / glm-5.3
        ↓
resolveModel → declares [text, image]  (the composite route really accepts images)
        ↓
stream() → collect every image block recursively, including images nested in tool results
        ↓
evidence cache hit?  ── no ──→ one relay call to the vision model, all misses batched
        ↓
replace each image block with <image-evidence fidelity="derived"> text
        ↓
ctx.llm.prepareCall(target) → stream the target adapter's chunks through unchanged
```

Two declarations stay honest and separate:

- the **target** route keeps declaring what it can really accept (text only);
- the **composite** route declares `image`, and only because this adapter removes
  every image before the target runs.

`resolveModel` inherits the target's `context`, `defaultMaxTokens`, and
`reasoning` so selectors show the capacity the answering model actually has,
while the composite route supplies its own modality list.

## Token and request effects

- One relay call carries **all uncached images** of a request, not one call per image.
- Evidence is cached per `attachmentId + relay provider + relay model + recipe`, so
  the same image under a later question costs nothing to re-derive.
- A single transcript is capped (`MAX_EVIDENCE_CHARS`), because evidence is an
  intermediate artifact rather than a transcript of record.
- Each user turn that introduces a new image costs exactly one extra model call;
  turns without images bypass the relay entirely and add nothing.

## Model-experience notes

The target model does not see the image; it sees a `<image-evidence>` envelope that
states its `fidelity="derived"` nature and that text found inside the image is
untrusted data, never an instruction. A model may therefore be confidently wrong
about detail the vision model did not transcribe — the envelope says so at the
point of use rather than relying on a system-prompt caveat elsewhere.

## Configuration

The row mounts dormant: with no settings section it registers nothing, holds no
route, and adds no model to any picker. Configuration lives in the user settings
document (`$DSH_HOME/settings.yaml`), where both the relay model and the routes
are deployment-specific:

```yaml
llm-vision-relay:
  relay:
    provider: deepseek-official
    model: deepseek-flash
  routes:
    glm-5.3:
      name: glm-5.3 + DeepSeek Vision
      target:
        provider: opencode-go
        model: glm-5.3
```

Each key under `routes` is the model id the composite route is selected by,
offered under the single `vision-relay` provider. A route appears in the picker
only while the section declares it, and emptying the section takes the composite
routes away again.

Because a route relays to a real model, the target provider must already be
configured — a route naming a provider no adapter serves fails to register and
the plugin keeps the previously registered routes.

## Known Limitations and Deferred Work

- **Usage attribution is not split.** One assistant turn records one usage, so a
  relay turn's token accounting merges the vision call into the composite route.
  Per-call relay usage records are deferred; until then a bill cannot separate the
  vision model's share from the target's.
- **Evidence lives in process memory.** The cache is a per-plugin `Map`, so it is
  warm only for the life of the Host process. A durable `ImageEvidence` storage
  domain is the intended replacement, and it must verify that the asking session
  actually holds the attachment before serving a cross-session hit.
- **Replay identity is not isolated.** Because rewriting happens per request, an
  evicted cache entry re-derives evidence that may differ word-for-word from the
  cost originally recorded for that history.
- **A relay target must not be another relay route.** Self-targeting is rejected at
  reconciliation, but a chain through two configured relay routes is not detected.
- **An unusable target is reported, not refused.** A route whose target model the
  target adapter cannot resolve stays listed, without the target's capacities, and
  fails only when a call reaches it — so one bad route does not hide its siblings
  from a selector. The failure is logged once per route per configuration; nothing
  validates target model ids at reconciliation, where the lookup is asynchronous.
- **The target's resolved header is the only one it accepts.** A prepared call
  rejects a dispatched request whose provider, model, reasoning effort,
  temperature, maxTokens, or stop differ from the header `prepareCall` resolved
  for it. The adapter therefore dispatches the target's own `config` and offers
  the caller's controls to `prepareCall` as preferences, so the target decides
  which of them it can honour; forwarding the composite route's header instead
  fails every turn with `INVALID_PREPARED_CALL`. A target that rejects the
  requested reasoning effort falls back to its own default for that turn.
- **`read_image` still needs the composite route selected.** The tool gates on the
  calling route's declared modalities; selecting the target directly bypasses the relay.

No invariant companion is published because this package rewrites request messages and registers adapter routes, and every relation it relies on — one route set per provider, one evidence envelope per image — is enforced synchronously in the operation that establishes it.
