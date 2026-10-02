import type { Context } from '@deepseek-ai/cordis'
import { installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const path = process.argv[2]
if (!path) throw new Error('Plan fixture needs its Profile overlay')
const uninstall = installFailLoud('eval-plan-profile')
let ctx: Context | undefined
try {
  loadEnv('eval-plan-profile')
  ctx = await bootProductionProfile({ binName: 'eval-plan-profile', profile: 'headless', overlayPaths: [resolveConfigPath(path, undefined)] })
} finally { await ctx?.fiber.dispose(); uninstall() }
