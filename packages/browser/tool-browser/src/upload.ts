/** File paths must come from the user's current request, never from page/tool content. */
export function uploadPathsChosenByUser(events: readonly { type: string; data: unknown }[], files: readonly string[]): boolean {
  const userTexts: string[] = []
  for (const event of events.toReversed()) {
    if (event.type === 'turn/start') break
    if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) continue
    const message = event.data as { source?: { kind?: unknown }; content?: unknown }
    if (message.source?.kind !== 'user' || !Array.isArray(message.content)) continue
    for (const part of message.content as unknown[]) {
      if (typeof part !== 'object' || part === null) continue
      const value = part as { type?: unknown; text?: unknown }
      if (value.type === 'text' && typeof value.text === 'string') userTexts.push(value.text)
    }
  }
  return files.every((file) => {
    const normalize = (value: string): string => /^[a-z]:[\\/]/iu.test(file) || file.startsWith('\\\\')
      ? value.replaceAll('\\', '/').toLowerCase() : value
    const path = normalize(file)
    return userTexts.some((text) => {
      const input = normalize(text)
      let start = input.indexOf(path)
      while (start !== -1) {
        const before = input[start - 1], after = input[start + path.length]
        if ((before === undefined || /[\s"'`（(「：:]/u.test(before))
          && (after === undefined || /[\s"'`）)」，,。;]/u.test(after))) return true
        start = input.indexOf(path, start + 1)
      }
      return false
    })
  })
}
