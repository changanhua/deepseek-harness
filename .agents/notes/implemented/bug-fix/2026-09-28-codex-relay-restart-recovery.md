# Agent Note: Codex relay restart recovery

Status: implemented

English | [中文](2026-09-28-codex-relay-restart-recovery.zh.md)

## Problem

The standalone relay loses in-memory grants on restart while Chrome retains credentials. Retrying the same WebSocket cannot rebuild a missing grant. Treating every rejection as permission to pair again would bypass a deliberate denial.

## Decision

The [connector](../../../../packages/mcp/browser-extension-mcp/README.md#connection-recovery) distinguishes authenticated grant loss from revocation, untrusted origins and malformed handshakes. Only `4409 credentials_expired` permits automatic renewal through the existing connect endpoint. The extension preserves installation identity and persists renewal intent before retrying; one pairing promise and the existing channel backoff serialize automatic, manual and worker-triggered recovery. Explicit disconnect and terminal denial stop recovery across worker restarts.

The relay configuration owns the installation revocation list. Both pairing and WebSocket authentication enforce it, independently of the extension's persisted terminal hold. Existing origin and token checks remain mandatory. The [browser execution authority decision](../architecture/2026-09-08-browser-execution-authority.md) continues to own operation identity, write exclusion and receipt lookup; renewing a connection grants no authority to replay an unknown action.

## Alternatives considered

Re-pairing on generic `1008` conflates malformed messages with recoverable state loss. Reconstructing grants directly from a token skips the existing pairing endpoint. Persisting every relay grant adds storage ownership unnecessarily; the configured trust and revocation policy can decide fresh pairing.

## Consequences

Relay restarts recover without reloading Chrome. Permanent rejection requires the owner to resolve the denial and explicitly clear the extension's hold. Configuration changes require a relay restart. Recovery remains bounded and does not guarantee eventual connectivity during a long outage.

Focused protocol and extension tests cover rejection categories, concurrent renewal, interrupted pairing and worker persistence. The isolated real-extension scenario restarts only the relay, refreshes page evidence, verifies a lost-response click is not replayed, and confirms revocation survives worker wake. Missing receipts remain unknown; a recovered journal receipt, rather than connectivity, can establish an operation's outcome.
