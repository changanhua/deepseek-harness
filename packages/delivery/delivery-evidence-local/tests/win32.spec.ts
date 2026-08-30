import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('koffi')
  vi.resetModules()
})

describe('evidence Windows durable namespace helper', () => {
  it('publishes with the write-through flag', async () => {
    const moves: Array<{ from: string; to: string; flags: number }> = []
    vi.doMock('koffi', () => ({
      default: {
        load: () => ({
          func: (_convention: string, name: string) => name === 'MoveFileExW'
            ? (from: string, to: string, flags: number) => {
              moves.push({ from, to, flags })
              return 1
            }
            : () => 0,
        }),
      },
    }))
    const { publishNewPathWin32 } = await import('../src/win32.ts')

    await publishNewPathWin32('staged-object', 'published-object')

    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ flags: 0x00000008 })
  })

  it('maps every native publication error to a stable errno', async () => {
    const cases = [
      [2, 'ENOENT'],
      [3, 'ENOENT'],
      [5, 'EACCES'],
      [17, 'EXDEV'],
      [80, 'EEXIST'],
      [183, 'EEXIST'],
      [123, 'EINVAL'],
      [9999, 'EIO'],
    ] as const
    for (const [nativeCode, code] of cases) {
      vi.resetModules()
      vi.doMock('koffi', () => ({
        default: {
          load: () => ({
            func: (_convention: string, name: string) => name === 'MoveFileExW'
              ? () => 0
              : () => nativeCode,
          }),
        },
      }))
      const { publishNewPathWin32 } = await import('../src/win32.ts')
      await expect(publishNewPathWin32('from', 'to')).rejects.toMatchObject({ code })
    }
  })
})
