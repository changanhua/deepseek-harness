/**
 * Browser-safe random UUID (RFC 4122 version 4).
 *
 * `crypto.randomUUID` is a secure-context-only Web API: over a plain-HTTP LAN
 * page (non-loopback origin) the global is absent and any call throws
 * `crypto.randomUUID is not a function`. `crypto.getRandomValues` is exposed on
 * every origin, so this is the platform-neutral mint for wire correlation ids.
 * api/ contract layer: zero Node dependencies, importable from the browser.
 */

/**
 * Generate an RFC 4122 version 4 UUID without requiring a secure context.
 * @returns a UUID backed by `crypto.getRandomValues()`, which browsers expose on insecure origins.
 */
export function randomUuid(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
