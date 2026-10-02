import type { Context } from '@deepseek-ai/cordis'
const { installFailLoud, loadEnv, resolveConfigPath } = await import(new URL('../../../../../boot/app-boot/lib/index.js', import.meta.url).href) as typeof import('@deepseek-ai/dsh-app-boot')
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const path = process.argv[2]
if (!path) throw new Error('Plan fixture needs its Profile overlay')
const uninstall = installFailLoud('eval-plan-profile')
let ctx: Context | undefined
try {
  loadEnv('eval-plan-profile')
  ctx = await bootProductionProfile({ binName: 'eval-plan-profile', profile: 'headless', overlayPaths: [resolveConfigPath(path, undefined)] })
} finally { await ctx?.fiber.dispose(); uninstall() }
