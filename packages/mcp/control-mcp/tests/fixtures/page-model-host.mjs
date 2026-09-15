/** Test-only authenticated route, loaded only by the isolated real-Host entry test. */
export const name = 'page-model-host-fixture'
export const inject = ['connection', 'browser', 'dynamicCordisRunner', 'sessionController', 'agents']
export function apply(ctx) {
  let agent
  ctx.connection.rpc.handle('/page-model-fixture', async (method, payload, signal) => {
    try {
      let value
      if (method === 'open') {
        if (agent) throw new Error('fixture Session already exists')
        const created = await ctx.sessionController.create({ cwd: process.cwd(), agentPreset: 'cordis' })
        agent = ctx.agents.get(created.sessionId)
        if (!agent) throw new Error('fixture Agent missing')
        value = { sessionId: created.sessionId }
      } else {
        if (!agent) throw new Error('open fixture Session first')
        switch (method) {
          case 'browser': value = await ctx.browser.execute({ ...payload, sessionId: agent.id }, signal); break
          case 'define': value = ctx.dynamicCordisRunner.define({ ...payload, sessionId: agent.id }); break
          case 'run': value = await ctx.dynamicCordisRunner.run(agent, payload.pluginId, payload.packageId, 'run'); break
          case 'stop': value = await ctx.dynamicCordisRunner.stop(agent, payload.pluginId); break
          case 'inspect': value = ctx.dynamicCordisRunner.inspectPlugin(agent, payload.pluginId); break
          default: throw new Error('unknown fixture operation')
        }
      }
      return { ok: true, value }
    } catch (error) { return { ok: false, error: { code: 'fixture_failed', message: String(error), details: {} } } }
  })
}
