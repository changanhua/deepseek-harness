import { z } from 'zod'
import { ActivityBatchSchema, ActivityQuerySchema, ConfigureActivitySchema, type BrowserActivity } from '@changanhua/dsh-browser-activity'
import type { GrantSummary } from './grants.ts'

type Activity = Pick<BrowserActivity, 'state' | 'configure' | 'append' | 'query'>
const empty = z.object({}).strict()

/** Raw activity is always scoped to the authenticated installation, never a caller-supplied id. */
export class BrowserActivities {
  constructor(private readonly activity: Activity, private readonly grant: GrantSummary, private readonly permit: () => boolean) {}

  async handle(method: string, params: unknown): Promise<unknown> {
    try { return await this.handleAuthorized(method, params) }
    catch (error) {
      if (error instanceof Error && ['activity_configuration_changed', 'activity_configuration_conflict'].includes(error.message)) {
        throw Object.assign(error, { code: error.message })
      }
      throw error
    }
  }

  private async handleAuthorized(method: string, params: unknown): Promise<unknown> {
    const authorize = () => { this.authorize() }
    authorize()
    let value: unknown
    if (method === 'activity.state') {
      empty.parse(params)
      value = await this.activity.state(this.grant.installationId, authorize)
    } else if (method === 'activity.configure') {
      const input = ConfigureActivitySchema.parse(params)
      const authorizeSites = () => {
        authorize()
        if (!input.settings.origins.every(origin => this.grant.origins.includes('*') || this.grant.origins.includes(origin))) {
          throw Object.assign(new Error('observation_not_authorized'), { code: 'observation_not_authorized' })
        }
      }
      authorizeSites()
      value = await this.activity.configure(this.grant.installationId, input, authorizeSites)
    } else if (method === 'activity.append') {
      value = await this.activity.append(this.grant.installationId, ActivityBatchSchema.parse(params), authorize)
    } else if (method === 'activity.query') {
      value = { events: await this.activity.query(this.grant.installationId, ActivityQuerySchema.parse(params), authorize) }
    } else throw new Error('unknown_activity_method')
    authorize()
    return value
  }

  private authorize(): void {
    if (!this.permit() || !['session:interact', 'browser:read', 'browser:observe'].every(scope => this.grant.scopes.includes(scope))) {
      throw Object.assign(new Error('observation_not_authorized'), { code: 'observation_not_authorized' })
    }
  }
}
