declare module '*.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '@joplin/turndown-plugin-gfm' {
  export function gfm(options?: unknown): unknown
  export function strikethrough(options?: unknown): unknown
  export function tables(options?: unknown): unknown
  export function taskListItems(options?: unknown): unknown
  export function highlightedCodeBlock(options?: unknown): unknown
}
