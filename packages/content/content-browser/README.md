---
description: "Browser extension authorization and durable webpage import into Content."
kind: "package-reference"
---

# @changanhua/dsh-content-browser

English | [中文](README.zh.md)

## Summary

Connect a Chromium extension to a DSH service, approve content imports in the signed-in Web application, and save webpage materials into the existing Content library. This Host bridge owns connection grants; Content owns saved entries and retry receipts.

## Table of Contents

- [Use this package](#use-this-package)
- [Authority and recovery](#authority-and-recovery)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

Mount the default service with `webServer`, `connection`, `credentials` and `content`. The Web bundle includes it. The generated `./remote` face supplies `contentBrowser` approval and revocation operations; the loaded [Chrome extension](../../../apps/chrome-extension/README.md) uses `/api/content-browser/v1/info`, `/connect`, `/connect/<requestId>/token` and `/import`.

`requestTTL` defaults to 300000 milliseconds, `pendingLimit` to 32 and `maxRequestBodyBytes` to 1048576. Composition may tighten these limits. A pending connection expires in memory; an approved grant persists in the credentials provider until revoked or replaced for that installation.

`BrowserConnectRequest` exposes request and installation identities, extension ID, expiry and approval status. `BrowserGrantSummary` exposes installation and extension identities, creation time and the `content:import` scope. Neither projection contains token material.

<a id="authority-and-recovery"></a>

## Authority and recovery

The extension retains a random verifier and sends its SHA-256 challenge. A signed-in user explicitly approves the request; opening its link does not authorize it. Token exchange proves the retained verifier. The Host stores only the token hash in a strict versioned, owner-private credentials record. Bearer tokens are returned only to the matching extension Origin through the exchange route, and can only import content.

Connection supplies the configured Host authority check; the bridge separately requires an exact extension Origin and operation credentials. Ordinary `/api` Cookie and cross-site checks are unchanged. Invalid records fail closed. Grant updates, revocation, request abort and plugin disposal invalidate admitted imports before Content commits them. Already committed content remains when a response is lost or access is revoked.

Imports map a UUID capture identity to `web:<captureId>` and the same operation ID. The complete unverified webpage source and body commit together through `save-text`. Retrying the same request returns its durable receipt; changing its content with the same identity conflicts. Token re-delivery stops after revocation or request expiry.

<a id="model-experience"></a>

## Model Experience

None, as this bridge registers no model tools or model context and performs no model requests.

#### KV Cache effect

None; connection and import operations do not enter a model context.

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

- Service URLs use an HTTP(S) origin root; current DSH routes do not support a deployment path prefix. Remote deployment must configure trusted authority and transport security separately.
- Site structure and extraction belong to the extension. Webpage provenance is unverified; the Host never fetches the source URL.
- Pending handshakes do not survive Host restarts. Existing grants and saved content use their providers' persistence; a restarted handshake requires a new request.

<a id="dev-note"></a>

## Dev Note

None.
