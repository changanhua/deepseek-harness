import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('koffi')
  vi.resetModules()
})

describe('workspace Windows durable namespace helper', () => {
  it('propagates a write-through publication failure with a stable errno', async () => {
    let flags: number | undefined
    vi.doMock('koffi', () => ({
      default: {
        load: () => ({
          func: (_convention: string, name: string) => name === 'MoveFileExW'
            ? (_from: string, _to: string, value: number) => {
              flags = value
              return 0
            }
            : () => 5,
        }),
      },
    }))
    const { publishNewPathWin32 } = await import('../src/win32.ts')

    await expect(publishNewPathWin32('staged-lease', 'published-lease')).rejects.toMatchObject({
      code: 'EACCES',
      path: 'staged-lease',
      dest: 'published-lease',
    })
    expect(flags).toBe(0x00000008)
  })

  it('maps the remaining native publication failures', async () => {
    const cases = [
      [2, 'ENOENT'],
      [3, 'ENOENT'],
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
