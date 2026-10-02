import type { Context } from '@deepseek-ai/cordis'
const { installFailLoud, loadEnv, resolveConfigPath } = await import(new URL('../../../../../boot/app-boot/lib/index.js', import.meta.url).href) as typeof import('@deepseek-ai/dsh-app-boot')
const { runFixtureTurn } = await import(new URL('../../../../../test-support/loader-smoke/lib/index.js', import.meta.url).href) as typeof import('@deepseek-ai/dsh-loader-smoke')
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (!configPath) throw new Error('budget fixture needs its Profile overlay')
const uninstall = installFailLoud('budget-profile')
let ctx: Context | undefined
try {
  loadEnv('budget-profile')
  ctx = await bootProductionProfile({ binName: 'budget-profile', profile: 'headless', overlayPaths: [resolveConfigPath(configPath, undefined)] })
  await runFixtureTurn(ctx, { task: 'Complete one authorized request.' })
  await runFixtureTurn(ctx, { task: 'This second request must be denied.' })
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
