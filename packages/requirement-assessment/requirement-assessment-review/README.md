# Requirement Assessment Review

English | [中文](README.zh.md)

Runs RIR-WP1 Quick Review through the existing LLM runtime. Configure `provider`, `model`, `dshBaseline`, `maxInputBytes`, `maxOutputBytes`, `maxOutputTokens`, and `timeoutMs` explicitly. Use `unknown` when the deployment cannot identify its DSH baseline reliably. No second agent loop is created.

## Authority and lifecycle

`requirementAssessmentReview.review(access, input, signal)` accepts trusted Host access separately from strict user input. Planning is read once before evaluation; the exact context, Focus contents, manual evidence and model request are retained. User evidence is always unverified. Resource references are opaque and are never fetched.

The provider durably reserves each request before model dispatch. Concurrent identical calls share one result; completed retries recover it. Interrupted, rejected or malformed attempts retain their reservation, preventing repeat spending after restart. A user may explicitly start a new request id. Re-evaluation validates the superseded subject before spending.

The runner provides no tools, tool executor, Delivery, Queue or Planning mutation path. It rejects tool calls, incomplete streams, truncation, malformed/refusal JSON and schema violations. Input bounds include complete request framing; output bounds count every streamed chunk, including reasoning and metadata. Caller cancellation, deadline and plugin disposal cancel evaluation; disposal waits for in-flight work to settle. Adapters must honor the runtime cancellation contract.

## Invariant policy

No invariant companion is published: immutable results and reservations are owned by the provider; this package retains only operation-local promises.

## Model Experience

### Fixed quick review

#### What the model sees

`ctx.requirementAssessmentReview`: A fixed versioned system instruction, the eight-dimension/three-stress-test/three-allocation schema and one frozen evidence request. No tools are offered. All five routes remain advisory, without total scores.

#### Token effect

One explicitly requested bounded model call. Invalid output is not repaired through another call. Deployment sets input bytes and output tokens; pending request ids never retry automatically.

#### KV Cache effect

The stable system prefix can be cached by the provider. Each evidence payload is independent; no conversation history is rewritten.

## Known Limitations and Deferred Work

- Configured runtime route and settings are recorded; actual backend model identity remains explicitly unknown unless the runtime provides attestation.
- Failed reservations need an explicit new request id; automatic retry/recovery would risk duplicate spending.
- Mock composition tests establish runtime contracts, not investment quality. The three real-model acceptance cases remain a separate required verification.
- Deep review, automatic research and outcome learning are outside WP1.
