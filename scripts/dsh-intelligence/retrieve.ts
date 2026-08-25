/**
 * retrieve.ts — Bounded Retriever 的最小词法实现（V0）
 *
 * 从 .agents/dsh-intelligence/knowledge/{patterns,anti-patterns,cases}/ 读取 YAML，
 * 按关键词过滤并返回摘要 + pointer，遵守 token 预算（token-budgets.yaml）。
 * 检索结果是候选，不是事实；存在性/权威性仍由来源确认。
 *
 * 本脚本是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KNOWLEDGE_ROOT = join(ROOT, '.agents', 'dsh-intelligence', 'knowledge')

export interface RetrievedItem {
  id: string
  kind: 'pattern' | 'anti-pattern' | 'case'
  title: string
  path: string
  snippet: string
  score: number
}

const KINDS: Array<{ kind: RetrievedItem['kind']; dir: string }> = [
  { kind: 'pattern', dir: 'patterns' },
  { kind: 'anti-pattern', dir: 'anti-patterns' },
  { kind: 'case', dir: 'cases' },
]

interface KnowledgeRecord {
  id?: string
  title?: string
  statement?: string
  problem_signature?: string[]
  applies_when?: string[]
  tempting_solution?: string
  failure_mechanism?: string
  task_signature?: string
  decision_summary?: string
}

/** 从知识文件里提取可检索字段的文本。 */
function searchableText(record: KnowledgeRecord): string {
  const fields = [record.title, record.statement, record.problem_signature, record.applies_when,
    record.tempting_solution, record.failure_mechanism, record.task_signature, record.decision_summary]
  return fields.filter(f => typeof f === 'string' || Array.isArray(f)).map(f =>
    typeof f === 'string' ? f : (f as unknown[]).join(' ')).join('\n')
}

/** 按关键词做朴素词法匹配；返回 top-N，每项附带简短摘要。 */
export function retrieve(query: string, opts: { kinds?: RetrievedItem['kind'][]; max?: number; maxChars?: number } = {}): RetrievedItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  const max = opts.max ?? 3
  const maxChars = opts.maxChars ?? 240
  const kinds = new Set(opts.kinds ?? ['pattern', 'anti-pattern', 'case'])
  const items: RetrievedItem[] = []

  for (const { kind, dir } of KINDS) {
    if (!kinds.has(kind)) continue
    const dirPath = join(KNOWLEDGE_ROOT, dir)
    if (!existsSync(dirPath)) continue
    for (const file of readdirSync(dirPath).filter(f => f.endsWith('.yaml'))) {
      const abs = join(dirPath, file)
      const record = loadYaml(readFileSync(abs, 'utf8')) as KnowledgeRecord
      const text = searchableText(record).toLowerCase()
      const score = terms.filter(t => text.includes(t)).length
      if (score === 0) continue
      const snippet = (record.statement ?? record.failure_mechanism ?? record.title ?? '').slice(0, maxChars)
      items.push({
        id: record.id ?? file.replace(/\.yaml$/, ''),
        kind,
        title: record.title ?? file.replace(/\.yaml$/, ''),
        path: `.agents/dsh-intelligence/knowledge/${dir}/${file}`,
        snippet,
        score,
      })
    }
  }

  return items.sort((a, b) => b.score - a.score).slice(0, max)
}

function main(): void {
  const args = process.argv.slice(2)
  const query = args.filter(a => !a.startsWith('--')).join(' ') || 'durable'
  const kindFlag = args.find(a => a.startsWith('--kind='))
  const kinds = kindFlag ? [kindFlag.split('=')[1]] as RetrievedItem['kind'][] : undefined
  const items = retrieve(query, { kinds })
  console.log(JSON.stringify(items, null, 2))
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
