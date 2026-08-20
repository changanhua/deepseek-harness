/**
 * Browser-safe UUID generation for client-side wire correlation.
 * The single implementation lives in the apiproxy api layer (zero Node deps,
 * browser-safe); this re-export keeps both wire layers on the same mint.
 */

export { randomUuid } from '@deepseek-ai/dsh-host-apiproxy/api'
