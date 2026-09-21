import { describe, expect, test } from 'vitest'
import manifest from '../manifest.json' with { type: 'json' }

describe('personal browser assistant manifest', () => {
  test('can always reach the local DSH Host while page origins remain optional', () => {
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*', 'http://localhost/*'])
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*'])
  })
})
