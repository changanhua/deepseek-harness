/** Bounded human memory inspection with quoted source material. @module @changanhua/dsh-command-memory/render */
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import assert from 'node:assert/strict'
import { MemoryError } from '@changanhua/dsh-memory'
import type { MemoryInspectedRecord, MemoryReadResult, MemoryRevision, MemorySourceObservation } from '@changanhua/dsh-memory'

/** Human navigation page size; the provider's record cap bounds total pages. */
export const MEMORY_LIST_PAGE_SIZE = 20

const safeLabel = (value: string): string => value.replace(/[\r\n]+/gu, ' ').replace(/[\\`*_[\]<>|]/gu, '\\$&')
const statusLabel = (value: MemoryReadResult['eligibility']): string => ({
  usable: '可用', 'source-changed': '来源已变化', 'source-unavailable': '来源暂不可读',
  'review-due': '需要重新复核', conflicted: '存在冲突', withdrawn: '没有生效版本',
})[value]

function quote(value: string): string {
  const length = Math.max(3, ...(value.match(/`+/gu) ?? []).map(run => run.length + 1))
  const fence = '`'.repeat(length)
  return `${fence}text\n${value}\n${fence}`
}

function sourceLines(observation: MemorySourceObservation): string[] {
  const source = observation.source
  const label = source.kind === 'file' ? source.path : `${source.sessionId} / 事件 ${source.seq} (${source.eventType})`
  const status = { current: '内容一致', changed: '内容已变化', unavailable: '暂不可读', 'not-checked': '尚未检查' }[observation.status]
  return [`- ${safeLabel(label)}：${status}；SHA-256 ${source.sha256}`,
    ...observation.preview === undefined ? [] : [quote(observation.preview)]]
}

/**
 * Render a stable id page without copying every record's body or history.
 * @param records - Authorized project records with immutable revision histories.
 * @param page - Positive one-based page requested by the parsed command.
 * @returns A page summary with inspection and next-page commands.
 */
export function renderMemoryList(records: readonly MemoryInspectedRecord[], page: number): string {
  const ordered = [...records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const pages = Math.max(1, Math.ceil(ordered.length / MEMORY_LIST_PAGE_SIZE))
  if (page > pages) return `没有第 ${page} 页。当前共 ${pages} 页。`
  const visible = ordered.slice((page - 1) * MEMORY_LIST_PAGE_SIZE, page * MEMORY_LIST_PAGE_SIZE)
  const lines = [`项目记忆：共 ${ordered.length} 条，第 ${page} 页 / 共 ${pages} 页。`, '']
  for (const record of visible) {
    const latest = record.revisions.at(-1)
    assert(latest !== undefined, 'memory record schema requires at least one immutable revision')
    const title = Array.from(latest.title).slice(0, 60).join('')
    lines.push(`- ${record.id} — ${safeLabel(title)}；生效 ${record.activeRevision ?? '无'}，待确认 ${record.candidateRevision ?? '无'}`)
  }
  lines.push('', '查看：/memory show <编号>')
  if (page < pages) lines.push(`下一页：/memory list ${page + 1}`)
  return lines.join('\n')
}

/**
 * Show exact active, candidate, or selected historical content with observed source previews.
 * @param record - Authorized record and source observations for inspected revisions.
 * @param current - Current eligibility and review deadline for the same record.
 * @param selected - Exact historical revision; omission selects active and candidate content.
 * @returns Quoted revision content, observed source status, and human decision commands.
 */
export function renderMemoryShow(record: MemoryInspectedRecord, current: MemoryReadResult, selected?: number): string {
  const wanted = selected === undefined ? new Set([record.activeRevision, record.candidateRevision]) : new Set([selected])
  const revisions = record.revisions.filter(revision => wanted.has(revision.revision))
  const lines = [
    `记忆：${record.id}`, `主题：${safeLabel(record.topicKey)}`,
    `当前状态：${statusLabel(current.eligibility)}；生效版本 ${record.activeRevision ?? '无'}；待确认版本 ${record.candidateRevision ?? '无'}。`,
    ...current.reviewAfter === undefined ? [] : [`复核期限：${current.reviewAfter}`], '',
  ]
  for (const revision of revisions) {
    const label = revision.revision === record.candidateRevision ? '待确认' : revision.revision === record.activeRevision ? '已接纳' : '历史'
    lines.push(`版本 ${revision.revision}（${label}）：${safeLabel(revision.title)}`, quote(revision.statement))
    if (revision.conditions.length > 0) lines.push('适用条件：', quote(revision.conditions))
    const checks = record.sourceChecks.find(value => value.revision === revision.revision)
    lines.push('来源依据：')
    for (const observation of checks?.observations ?? uncheckedSources(revision)) lines.push(...sourceLines(observation))
    if (checks !== undefined) lines.push(`检查时间：${checks.checkedAt}`)
    lines.push('')
  }
  lines.push(`历史共 ${record.revisions.length} 个版本；按版本查看：/memory show ${record.id}@<版本号>`)
  if (record.candidateRevision !== null) {
    lines.push(`接纳：/memory accept ${record.id}@${record.candidateRevision}`, `拒绝：/memory reject ${record.id}@${record.candidateRevision}`)
  }
  if (record.activeRevision !== null) lines.push(`撤回：/memory retire ${record.id}@${record.activeRevision}`)
  return lines.join('\n')
}

function uncheckedSources(revision: MemoryRevision): MemorySourceObservation[] {
  return revision.sources.map(source => ({ source, status: 'not-checked' }))
}

/**
 * Bound the complete user-visible command result; mutation acknowledgments stay compact.
 * @param text - Human-readable output, with untrusted content already quoted.
 * @param maxBytes - Maximum UTF-8 size of the complete serialized result.
 * @returns A success result, or throws capacity-exceeded for oversized content.
 */
export function boundedMemoryCommand(text: string, maxBytes: number): CommandResult {
  const result: CommandResult = { kind: 'success', text }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) {
    throw new MemoryError('capacity-exceeded', 'inspection is too large; choose one memory revision')
  }
  return result
}
