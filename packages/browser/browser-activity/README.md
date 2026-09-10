---
description: "Private Host storage, retention, and search for bounded browser activity."
kind: "package-reference"
---

# @changanhua/dsh-browser-activity

English | [中文](README.zh.md)

## Summary

This service owns raw browser activity after upload. Each installation starts without a collection policy. Explicit configuration fixes the Session, sites, event kinds, frequency, text size, retention period, and capacity. Curated knowledge belongs to its destination knowledge system; this domain stores observed facts.

## Table of Contents

- [Use this package](#use-this-package)
- [Storage and recovery](#storage-and-recovery)
- [Model Experience](#model-experience)
- [Known Limitations](#known-limitations)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Compose the service with `browser` and a private `storageDomain` backend. The extension Gateway exposes installation-bound policy, upload, and search operations. Collection requires current `browser:read` and `browser:observe`; the Gateway also requires `session:interact`. Configuring another site's origin does not grant access to it.

Configuration uses a stable request id and the viewed revision. Pausing persists `enabled: false` and invalidates buffered batches; explicit resumption creates another revision. A duplicate configuration request returns the prior revision. Stale controls cannot overwrite newer settings.

History search remains available while Chrome is offline, subject to current Session, grant epoch, scopes, and sites. Revocation fences access immediately, before its persistence completes. Collection and configuration still require an online installation. The optional `browser_activity_search` tool in `tool-browser` binds searches to the calling Agent's Session.

<a id="storage-and-recovery"></a>
## Storage and recovery

The `browser_activity` domain holds one record per installation. Consecutive batches retain only the most recent receipt; an identical retry after restart does not add another event. An uncertain commit disables the activation until storage reopens. Stored events retain their Session and grant epoch; new authorization cannot expose earlier epochs through search.

Each policy retains at most 2,000 events, 4,000 text characters per event, and 30 days of history. Records additionally obey a 4 MiB UTF-8 ceiling. Retention runs while paused and at startup; the default timer is 60 seconds. Search returns at most 100 events and 256 KiB. The Host admits at most 64 installations and 128 pending operations.

<a id="model-experience"></a>
## Model Experience

None. This package registers no model tool or prompt contribution and performs no model requests. Consumers must treat captured page text as source material, not instructions.

<a id="known-limitations"></a>
## Known Limitations

This owner does not collect Chrome events, upload images, or write to SiYuan. Its Loader test verifies SQLite recovery with an external Browser fixture; it does not establish Chrome collection or the complete knowledge workflow.

<a id="dev-note"></a>
### Dev Note

[Records](src/records.ts) enforces batch and retention limits; [engine](src/engine.ts) owns serialized persistence and current authority. [Loader test](tests/loader.spec.ts) checks cold recovery, retry identity, search, and a persisted pause through the real storage stack.
