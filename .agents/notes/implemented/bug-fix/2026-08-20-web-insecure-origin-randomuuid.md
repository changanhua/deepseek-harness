# Agent Note: Mint wire ids without a secure context

Status: implemented

English | [中文](2026-08-20-web-insecure-origin-randomuuid.zh.md)

## Problem

`crypto.randomUUID` is a Web API the browser exposes only inside a secure context (HTTPS or a loopback host). Opening the dsh web GUI over plain HTTP at a LAN address (`http://<lan-ip>:3080`) is not a secure context, so the global is undefined and every call throws `crypto.randomUUID is not a function`.

Three browser-reachable call sites depended on it:

- The GUI's RPC carrier minted every unary call's rpcId through `AbstractApiClient.mintRpcId()`, so the very first `host.describe` handshake crashed the page.
- The composer's `browserDraftAttachment()` hit the same call when attaching a picture.
- `dsh-llm`'s `createMessage` (message-id generation) called it directly, and connection's browser bundle inlines the llm message module through the INLINE_SAFE wire layer; the fixture client calls `createUserMessage` on the browser side, so this path also executed and threw.

The existing insecure-origin test (connection's `client-apply.client.spec.ts`) exercised only the generic `rpc.call` channel, which already used a `getRandomValues`-backed mint; the `AbstractApiClient` unary path — the one the whole GUI actually uses — was never covered and stayed broken.

## Decision

Browser-side wire correlation ids no longer depend on `crypto.randomUUID`. The apiproxy api layer (zero Node deps, browser-safe) owns one `randomUuid()`: RFC 4122 v4 backed by `crypto.getRandomValues`, which every origin exposes. `AbstractApiClient.mintRpcId()` mints through it, the connection package's `random-uuid.ts` re-exports that single implementation (its `rpc.call` and fixture mints already used it), and ui-conversation's `browserDraftAttachment()` imports the same helper from the apiproxy api layer for image-draft ids. No new value export was added to the connection client entry.

`dsh-llm` is a leaf package (apiproxy depends on it, so it cannot import the apiproxy implementation), `dsh-brand` is deliberately type-only, and a new util package would be disproportionate for one 14-line pure function — so llm's `createMessage` carries its own identical `getRandomValues`-backed `randomUuid` as a module-private helper. The two leaf packages each inline the same stateless function, consistent with the INLINE_SAFE philosophy that wire helpers with no shared runtime identity inline freely.

The new apiproxy carrier test stubs `globalThis.crypto` to the insecure-origin shape (getRandomValues only, no randomUUID) and drives a unary `session.list` through `mintRpcId`, asserting the call succeeds and the minted id is UUID v4.

## Testing

`fetch-carrier.spec.ts` carries the insecure-origin unary test. The connection, ui-conversation, and llm suites stay green, including llm's `message.spec.ts` identity assertions. Node ≥22 always provides `crypto.getRandomValues` on `globalThis.crypto`, so host-side behavior is unchanged. The rebuilt browser bundles (verified over the live GUI origin) contain `randomUuid` and no callable `crypto.randomUUID()`.

## Alternatives considered

**Guard `crypto.randomUUID` behind a capability check and fall back.** Rejected: two code paths for one mint, with the fallback still needing the `getRandomValues` implementation — the check adds a branch, not an implementation.

**Move the mint into the connection package and export it.** Rejected: apiproxy cannot depend on a client package, and the api layer is the existing browser-safe shared home for wire helpers (`RpcId`, `transportError` already live there). It also turned out the client bundle purity gate forbids a sibling UI plugin importing the connection client's value exports.

**House the UUID generator in `dsh-brand` or a new util package so llm and apiproxy share one implementation.** Rejected: `dsh-brand` is explicitly type-only ("no runtime code"); standing up a new util package (aggregates, manifest, tsconfig references) is disproportionate for a 14-line pure function. Two leaf packages that cannot depend on each other each inline the same stateless function instead.

**Copy the `getRandomValues` implementation into each call site as throwaway local code.** Rejected for the apiproxy/connection/ui-conversation cluster, which share one implementation through the api layer; only llm, the one package that cannot reach that layer, carries its own copy.

## Consequences

The dsh web GUI works over plain-HTTP LAN origins without HTTPS or a loopback host. RPC ids, draft-attachment ids, and message ids remain v4 UUIDs, so consumers matching on the shape are unaffected. `randomUuid` becomes a public export of the apiproxy api layer (an already-public browser-safe channel); no other public surface widened, and the llm copy stays module-private. The two inlined copies of the 14-line function are the accepted cost of the leaf-package boundary; a future shared util package could consolidate them.
