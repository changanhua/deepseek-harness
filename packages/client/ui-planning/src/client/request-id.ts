let sequence = 0

/** Keep command admission available on HTTP origins without Web Crypto UUID support. */
export function nextPlanningRequestId(): string {
  const browser: { readonly crypto?: { readonly randomUUID?: () => string } } = globalThis
  return browser.crypto?.randomUUID?.() ?? `planning-ui-${Date.now()}-${++sequence}`
}
