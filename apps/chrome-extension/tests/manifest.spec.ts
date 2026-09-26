import { describe, expect, test } from 'vitest'
import manifest from '../manifest.json' with { type: 'json' }

describe('personal browser assistant manifest', () => {
  test('requests all HTTP and HTTPS sites by default for both browser connections', () => {
    expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*'])
    expect(manifest).not.toHaveProperty('optional_host_permissions')
  })
})
