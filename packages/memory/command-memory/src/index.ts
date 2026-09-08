/** Human review commands for project memory. @module @changanhua/dsh-command-memory */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { MemoryError } from '@changanhua/dsh-memory'
import { parseMemoryCommand } from './parse.ts'
import { boundedMemoryCommand, renderMemoryList, renderMemoryShow } from './render.ts'

/** Cordis plugin identity. */
export const name = 'command-memory'
/** The human command plane and memory Definition are the only runtime services consumed. */
export const inject = ['commands', 'projectMemory']

/** Human output limits do not grant any model write or approval authority. */
export interface Config {
  /** Complete result byte limit; minimum reserves room for a durable mutation acknowledgment. */
  maxOutputBytes?: number
}

/** Bounded human result size, with a 16 KiB default. */
export const Config: z<Config> = z.object({
  maxOutputBytes: z.number().step(1).min(1024).max(16 * 1024).default(16 * 1024),
})

const USAGE = '用法：/memory list [页码] | show <编号>[@版本] | accept <编号>@<版本> [--review-after ISO时间] | reject <编号>@<版本> | retire <编号>@<版本>'

/** Register direct human inspection and exact-revision decisions without creating a model turn. */
export function apply(ctx: Context, config: Config = {}): void {
  const { maxOutputBytes } = Config(config) as Required<Config>
  ctx.commands.register({
    name: 'memory', description: '查看、确认、修订或撤回当前项目记忆',
    input: { hint: 'list [页码] | show <编号>[@版本] | accept/reject/retire <编号>@<版本>' },
    handler: invocation => execute(ctx, invocation, maxOutputBytes),
  })
}

async function execute(ctx: Context, invocation: CommandInvocation, maxBytes: number): Promise<CommandResult> {
  const command = parseMemoryCommand(invocation.rawInput)
  if (command.kind === 'invalid') return { kind: 'error', text: USAGE }
  try {
    const records = await ctx.projectMemory.inspect(invocation.agent, {
      commandId: invocation.commandId,
      ...command.kind === 'list' ? {} : { id: command.id },
      ...command.kind !== 'list' && command.revision !== undefined ? { revision: command.revision } : {},
    }, invocation.signal)
    if (command.kind === 'list') return boundedMemoryCommand(renderMemoryList(records, command.page), maxBytes)
    const record = records.find(value => value.id === command.id)
    if (record === undefined) throw new MemoryError('not-found', 'memory is not available in this project')
    if (command.kind === 'show') {
      const current = await ctx.projectMemory.read(invocation.agent, command.id, invocation.signal)
      if (current.recordVersion !== record.recordVersion) throw new MemoryError('version-conflict', 'memory changed during inspection')
      return boundedMemoryCommand(renderMemoryShow(record, current, command.revision), maxBytes)
    }
    const result = await ctx.projectMemory.decide(invocation.agent, {
      id: command.id, revision: command.revision, expectedVersion: record.recordVersion,
      action: command.kind, commandId: invocation.commandId,
      ...command.reviewAfter === undefined ? {} : { reviewAfter: command.reviewAfter },
    }, invocation.signal)
    const action = { accept: '已接纳', reject: '已拒绝候选', retire: '已撤回' }[command.kind]
    return boundedMemoryCommand(`${action}：${result.id}@${result.revision}。`, maxBytes)
  } catch (error) {
    invocation.signal.throwIfAborted()
    if (!(error instanceof MemoryError)) throw error
    const messages: Partial<Record<MemoryError['code'], string>> = {
      'workspace-unavailable': '当前会话没有可用的已注册项目。',
      'not-found': '当前项目中没有可访问的这条记忆或版本。',
      'source-changed': '来源已变化，请先提出带新来源的修订，再确认。',
      'source-unavailable': '来源暂时不可读，恢复后再复核。',
      'version-conflict': '记忆已变化，请重新查看后再操作。',
      'invalid-transition': '这个版本已不能执行该操作，请重新查看当前状态。',
      'capacity-exceeded': '内容超过输出上限，请按单条记忆或指定版本查看。',
      unauthorized: '此操作需要对应的人工记忆命令。',
      'invalid-input': '参数或复核时间无效。',
    }
    return { kind: 'error', text: messages[error.code] ?? '记忆操作未完成，请查看当前状态后重试。' }
  }
}
