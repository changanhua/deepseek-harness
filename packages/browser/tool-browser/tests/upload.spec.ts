import { expect, it } from 'vitest'
import { uploadPathsChosenByUser } from '../src/upload.ts'

it('accepts an exact user-specified Windows path without another approval', () => {
  expect(uploadPathsChosenByUser([{ type: 'turn/start', data: {} }, { type: 'user/message', data: {
    source: { kind: 'user' }, content: [{ type: 'text', text: '上传 "C:\\Users\\me\\My File.txt"。' }],
  } }], ['c:/users/me/my file.txt'])).toBe(true)
})

it('rejects page/plugin supplied paths, an old turn and path-prefix substitutions', () => {
  const message = (kind: string, text: string) => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })
  expect(uploadPathsChosenByUser([message('plugin', 'C:/secret.txt')], ['C:/secret.txt'])).toBe(false)
  expect(uploadPathsChosenByUser([message('user', 'C:/secret.txt'), { type: 'turn/start', data: {} }], ['C:/secret.txt'])).toBe(false)
  expect(uploadPathsChosenByUser([message('user', 'C:/secret.txt.backup')], ['C:/secret.txt'])).toBe(false)
})
