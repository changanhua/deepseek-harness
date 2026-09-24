# After-Reveal Reference — Request Trace V1

> Guard: do not use this file before the learner has written `prediction_before_reveal` for `trace-real-request`.

## Source pin

```text
repository: changanhua/deepseek-harness
commit:     894fa35e5a3defe51c5615103e993efaa67680f8
```

This reference is an **assessment key for one source revision**, not a timeless DSH contract.

## The compressed trace

```text
waking UserMessage
  ↓
ReactLoopAgent.send/followup
  ↓
Inbox(next-turn)
  ↓ wake
ReactLoopAgent.kick
  ↓
turn()
  ├─ session.append(turn/start)
  └─ preStep(next-turn)
       ├─ Inbox.claim(...)
       ├─ systemPrompt.assemble(...)
       ├─ RuntimeContextProjection.project(...)
       └─ agent/pre-step waterfall
  ↓
entered messages
  ↓
session.append(user/message)
  ↓
step()
  ↓
session.deriveMessages()
  ↓
buildRequest(...)
  ├─ agent/request waterfall
  ├─ llm.prepareCall(...)
  ├─ session.append(request/header) when needed
  ├─ session.append(request/context) when needed
  └─ frozen GenerateOptions.messages = derived Session messages
  ↓
preparedCall.stream(request) / llm.stream(request)
  ↓
assistant/chunk* → assistant/message
  ↓
if tool-call blocks exist
  ↓
executeToolCalls(...)
  ├─ session.append(tool/call)
  ├─ tools scheduler prepare/dispatch/finalize
  └─ session.append(tool/result)
  ↓
step() returns null when another model step is required
  ↓
turn() enters next step
  ↓
step() calls session.deriveMessages() again
  ↓
previous tool/result is now in the model-facing Session surface projection
  ↓
next LLM request sees the Tool Result
```

## Responsibility map

### `packages/core/agent-loop/src/agent.ts` — `ReactLoopAgent.send` / `followup`

- **Receives:** a typed `UserMessage`.
- **Does:** inserts it into the Agent inbox; a waking follow-up targets `next-turn` and wakes the driver.
- **Truth changed:** pending inbox projection, not yet the entered Session message history.
- **Hands off to:** driver wake / `kick()`.

Important distinction: queued input and entered `user/message` are not the same lifecycle state.

### `ReactLoopAgent.turn`

- **Receives:** a running driver reservation.
- **Does:** opens `turn/start`, asks `preStep` to claim input, opens `step/start`, then appends each entered message as `user/message`.
- **Truth changed:** the interaction becomes part of Session only when appended.
- **Hands off to:** `step()`.

The turn has explicit start/end events and contains one or more steps.

### `ReactLoopAgent.preStep`

- **Receives:** target inbox + turn/step position.
- **Does:** claims queued messages, assembles system prompt sections, projects runtime context, then exposes the proposed step through the `agent/pre-step` waterfall.
- **Truth changed:** inbox messages are claimed; prompt/context assembly is a request projection, not durable business truth by itself.
- **Hands off to:** `turn()` with an enter/reject decision.

### `ReactLoopAgent.step`

- **Receives:** the prompt assembly for the step.
- **Does:** calls `this.session.deriveMessages()` and passes that model-history boundary to `buildRequest`; streams the model; appends assistant chunks/message; dispatches tool calls when present.
- **Truth changed:** assistant output is committed through Session events.
- **Hands off to:** tool scheduler or step completion.

The key source-level fact is that model `messages` are not a mutable array owned by the loop. They are re-derived from Session at each model step.

### `ReactLoopAgent.buildRequest`

- **Receives:** current turn/step, tools, system prompt, and `boundaryMessages` from `Session.deriveMessages()`.
- **Does:** resolves effective provider/model config through `agent/request` and `llm.prepareCall`, records request header/context deltas, freezes the final `GenerateOptions`.
- **Truth changed:** request envelope facts that are needed for reconstruction enter Session as `request/header` / `request/context`.
- **Hands off to:** prepared adapter stream or generic `llm.stream`.

### `packages/core/agent-loop/src/tool-calls.ts` — `executeToolCalls`

- **Receives:** ordered model `tool-call` blocks.
- **Does:** parses arguments, classifies execution mode, schedules tools, preserves model-order commit.
- **Truth changed:** each started call gets `tool/call`; each committed result gets `tool/result`.
- **Hands off to:** result context may be inserted into the next-step inbox; the Session result itself is already committed independently.

### `appendToolCall` / `appendToolResult`

- `appendToolCall` appends `tool/call` and returns its event seq.
- `appendToolResult` creates a user-role tool-result message and appends `tool/result` with `surfaceOp: 'append'`, linked to the call seq.

This is the decisive bridge from execution result to future model history.

### `packages/core/session` — `Session`

The package contract states:

- Session is the append-only source of truth for Agent interaction history.
- `session.deriveMessages()` incrementally derives the model-facing message history from the Session surface.
- `user/message`, `assistant/message`, and `tool/result` store full messages on that surface.

Therefore the causal answer to “why does the next model request see the previous Tool Result?” is:

```text
tool execution
→ session.append('tool/result', ..., { surfaceOp: 'append' })
→ Session surface changes
→ next step calls session.deriveMessages()
→ derived messages contain that tool-result message
→ buildRequest uses those derived messages
```

It is **not** because `executeToolCalls()` mutates the previous request's local `messages` array.

## Session truth is not the same as persistence backend

At this source revision:

```text
Session
= live append-only interaction truth

Persistence plugin
= optional subscriber/mirror that stores and reloads Session events
```

`dsh-session` deliberately does not itself implement persistence. Persistence plugins observe `session/event`, participate in `session/flush`, and can reconstruct live Sessions later.

So a learner saying “the database is always the Session truth” is overgeneralizing. For this layer, the authoritative interaction model is the Session event log; durability across process restart depends on the installed persistence backend.

## Follow-up vs steer/inject transfer

All three use the same `send()` / Inbox machinery, but differ in target/wakeup semantics:

- `followup`: `next-turn`, wakeup `true`.
- `steer`: `next-step`, wakeup `true`.
- `inject`: `next-step`, wakeup `false`.

The transferable model is therefore:

```text
message enters Inbox first
→ claim happens at a turn/step boundary
→ entered message is appended to Session
```

The difference is **which boundary** it is eligible for and whether it wakes the driver.

## Common incorrect traces

### Wrong: `User → Session → LLM` with no Inbox

Why wrong: waking/steering/injected messages first live in the Agent inbox and are only appended as `user/message` after a pre-step claim/enter decision.

### Wrong: Tool Result directly mutates the current request messages

Why wrong: the result is appended to Session; a later `deriveMessages()` creates the next request history.

### Wrong: Session = persistence database

Why wrong: Session owns live append-only interaction history; persistence is an optional plugin seam that mirrors/reloads it.

### Wrong: one user message equals exactly one model request

Why wrong: one turn can contain multiple steps, especially after tool calls or next-step input.

## Acceptance key

A passing evidence record should demonstrate, in the learner's own trace:

1. Inbox vs entered Session message distinction.
2. Explicit turn/step boundaries.
3. `Session.deriveMessages()` as the model-history boundary.
4. Assistant output committed to Session.
5. `tool/call` and `tool/result` committed in the tool scheduler.
6. A causal explanation from `tool/result` surface append to the next request's derived messages.
7. Session truth vs persistence-backend distinction.
8. At least one prediction error and one transfer observation using steer/inject or another input path.
