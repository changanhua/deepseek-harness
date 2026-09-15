/** Command-line and stdin-lifetime owner for the control-mcp profile. */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { exitOnStdinEnd, parseCmdline } from '@deepseek-ai/dsh-cmdline'

export const name = 'dsh-control-mcp-startup'
export const inject = ['cmdlineArgs']
export const CONTROL_MCP_STARTUP_SERVICE = 'controlMcpStartup'

/** Accept the zero-option stdio invocation and publish transport readiness. */
export function apply(ctx: Context): void {
  const program = new Command()
    .name('dsh --profile control-mcp')
    .description('Expose one isolated DSH validation run through stdio MCP.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Optional environment:
  DSH_CONTROL_CLI_ENTRY    Host CLI entry; use apps/cli/src/bin.ts for source development
  DSH_CONTROL_HOST_HOME    prepared isolated Host home; otherwise a temporary home is used
  DSH_CONTROL_AUTOSTART    set false only when attaching to an already running Host
`)
  program.action(() => {
    exitOnStdinEnd(ctx, 'dsh-control-mcp.stdin')
    ctx.provide(CONTROL_MCP_STARTUP_SERVICE, { accepted: true })
  })
  parseCmdline(ctx, program)
}
