export const name = 'mcp-server-throwing-fixture'

export function apply() {
  throw new Error('fixture mount failed')
}
