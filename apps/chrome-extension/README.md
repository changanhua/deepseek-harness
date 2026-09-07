# DSH Capture

English | [中文](README.zh.md)

This is a Manifest V3 directory that Chrome can load with “Load unpacked”. It needs no build step, `package.json`, or additional dependency.

## Everyday capture

Select text on an HTTP(S) page and use the context-menu item “收藏选区到 DSH”. On ChatGPT or Zhihu, open the extension once and enable that site's quick action to keep a capture button beside its replies or answers. Complete-answer capture rejects known streaming or collapsed states; when the answer body or direct link cannot be identified, use a selection instead. Captures are text; images and attachments are not downloaded.

The default DSH address is `http://127.0.0.1:3080`. The first save opens DSH for explicit approval and then continues the same capture. The service address and installation grant are remembered. The toolbar always opens the reading side panel; connection settings stay behind the gear button. Only a different port or server needs an address change. An address must be an HTTP(S) origin root, without a deployment path prefix.

The manifest requests localhost access and a selection context menu. Persistent ChatGPT and Zhihu page access is optional and requested only when the user enables a site's quick action. Page observers install buttons; capture and transmission follow the user's selection or click. Approval grants only Content import, not the user's Web session. The token and verifier remain in trusted extension storage and are never returned to page scripts or the side panel.

## Failures and recovery

One pending capture binds its text, source and target service before any network request. An unsent draft can be renamed or explicitly discarded. Once sending begins, an uncertain result freezes the request: retry uses the same capture identity and text. Service recovery never automatically uploads the pending material. Changing the service does not move an existing capture to it. A successful server receipt enables opening the saved entry; a bounded list of 64 receipt links keeps earlier page buttons usable without storing another content library.

When updating an unpacked installation, reload it on Chrome's extensions page, then refresh the source webpage to load the new page script. Review any new permissions Chrome presents. This extension requires no build; changes to its DSH Host bridge or Web application require the repository's normal build. The current release changes the extension only relative to the previously built bridge.

## Development verification

From the repository root:

```powershell
pnpm exec vitest run apps/chrome-extension/tests --config vitest.config.ts
```

Focused tests cover safe reading previews, state transitions, target changes, replay after a worker restart, origin restrictions, token polling, selection extraction, and dynamic page buttons. Built-browser acceptance lives in [content-extension.e2e.ts](../web/tests/content-extension.e2e.ts). Live-page acceptance of the original capture flow does not establish compatibility of new site buttons: ChatGPT and Zhihu can change their DOM, and those adapters require live-page rechecking. Remote HTTPS deployment and native permission prompts remain separate acceptance conditions.
