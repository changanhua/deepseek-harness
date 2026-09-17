# Agent Note: Browser trusted local mode

Status: implemented

English | [中文](2026-09-16-browser-trusted-local-mode.zh.md)

## Problem

Interactive owner approval is the safe default for an arbitrary browser extension, but the personal Web composition names one owner-selected unpacked Chrome extension and serves it over the loopback Host. Reinstalling that extension creates a new installation identity while old grants remain durable, so repeated setup can consume the manual grant limit and ask the same owner to approve an identity that the composition already selected.

## Decision

`BrowserExtension.Config.trustedExtensionIds` declares extension ids that the local Host accepts without an interactive pairing request. The generic package default is empty. The personal Web composition declares `cimpmgjgfahhppmekdecgnboipoaajcf`; the request `Origin`, request body, and configured id must match exactly before the Host enters this path.

A trusted `/connect` atomically issues the requested scopes and origins with a rotating durable transport token, then returns the connected grant directly. The Chrome extension validates the returned installation, extension, scopes, origins, epoch, and token before it persists the credential and starts the WebSocket. Chrome site permissions remain an independent browser-owned boundary.

Each configured trusted extension has one durable installation slot that does not consume the manually approved grant limit. A new installation advances the grant epoch, replaces every older installation for that extension id, disconnects an older live peer, and invalidates its token. Host startup migrates legacy same-id grants by retaining only the highest epoch and marking it as trusted. Removing the id from configuration makes that trusted record fail closed on the next Host activation. Manually approved extensions retain their bounded pending, approval, capacity, and revocation flow.

The installation token remains mandatory for WebSocket authentication and restart recovery. Configured trust removes the repeated owner decision; it does not remove transport identity, request authority checks, action approval, journal recovery, or page-evidence rules.

## Alternatives considered

**Raise the manual grant limit or evict old grants.** A larger limit postpones the same failure, while implicit eviction makes an unrelated approved installation lose authority. Neither removes a redundant approval decision for the extension already selected by the personal composition.

**Trust every Chrome extension on loopback.** Loopback identifies the machine, not the intended browser principal. The mode remains opt-in and pins exact extension ids so ordinary and third-party extensions continue through the manual approval path.

**Remove installation tokens for the trusted extension.** Extension ids and HTTP `Origin` select the trusted path but do not provide a restart-stable connection credential. Retaining a rotating token preserves WebSocket authentication, epoch fencing, replacement, and captured-credential invalidation.

## Consequences

The personal extension connects without opening the DSH approval page, and reinstalling it cannot accumulate grants or hit manual grant capacity. Existing manual deployments preserve their original behavior because the package default trusts no extension.

This mode deliberately treats the local operating-system account and its configured loopback composition as the owner boundary. A native process can forge an HTTP `Origin`, so the configured extension id is not a cryptographic identity against hostile code already running as that user. Removing the configured id and restarting the Host is the durable revocation path. Different Chrome profiles that share the same extension id also share one trusted slot and replace one another; the personal composition accepts that single-profile trade-off.
