/**
 * retrieve.ts — Bounded Knowledge Retriever（V0）
 *
 * 只检索 Architecture Intelligence 自有 Pattern / Anti-pattern / Case；
 * 默认只返回已验证生命周期。candidate 必须显式 --include-candidates。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INTELLIGENCE_ROOT = join(ROOT, '.agents', 'dsh-intelligence')
const KNOWLEDGE_ROOT = join(INTELLIGENCE_ROOT, 'knowledge')
const BUDGET_FILE = join(INTELLIGENCE_ROOT, 'retrieval', 'token-budgets.yaml')

export interface RetrievedItem {
  id: string
  kind: 'pattern' | 'anti-pattern' | 'case'
  title: string
  path: string
  snippet: string
  score: number
  status: string
}

const NORMAL_DIRS: Array<{ kind: RetrievedItem['kind']; dir: string }> = [
  { kind: 'pattern', dir: 'patterns' },
  { kind: 'anti-pattern', dir: 'anti-patterns' },
  { kind: 'case', dir: 'cases' },
]

const NORMAL_STATUSES: Record<RetrievedItem['kind'], Set<string>> = {
  pattern: new Set(['validated', 'current']),
  'anti-pattern': new Set(['validated', 'current']),
  case: new Set(['verified', 'golden', 'current']),
}

interface KnowledgeRecord {
  id?: string
  title?: string
  status?: string
  statement?: string
  problem_signature?: string[]
  applies_when?: string[]
  tempting_solution?: string
  failure_mechanism?: string
  task_signature?: string
  decision_summary?: string
  provenance?: { artifact_kind?: string; lifecycle?: string }
}

interface BudgetConfig {
  budgets?: {
    precedent_max_count?: number
    default_retrieval_payload_max_tokens?: number
  }
}

function loadBudgets(): { maxCount: number; maxPayloadChars: number } {
  if (!existsSync(BUDGET_FILE)) return { maxCount: 3, maxPayloadChars: 24_000 }
  const config = loadYaml(readFileSync(BUDGET_FILE, 'utf8')) as BudgetConfig
  const maxCount = config.budgets?.precedent_max_count ?? 3
  const maxTokens = config.budgets?.default_retrieval_payload_max_tokens ?? 6000
  return { maxCount, maxPayloadChars: maxTokens * 4 }
}

function searchableText(record: KnowledgeRecord): string {
  const fields: Array<string | string[] | undefined> = [
    record.title,
    record.statement,
    record.problem_signature,
    record.applies_when,
    record.tempting_solution,
    record.failure_mechanism,
    record.task_signature,
    record.decision_summary,
  ]
  return fields
    .filter((field): field is string | string[] => typeof field === 'string' || Array.isArray(field))
    .map(field => typeof field === 'string' ? field : field.join(' '))
    .join('\n')
}

function candidateKind(record: KnowledgeRecord): RetrievedItem['kind'] | undefined {
  const kind = record.provenance?.artifact_kind
  return kind === 'pattern' || kind === 'anti-pattern' || kind === 'case' ? kind : undefined
}

function collectRecords(includeCandidates: boolean): Array<{ kind: RetrievedItem['kind']; dir: string; file: string; record: KnowledgeRecord }> {
  const records: Array<{ kind: RetrievedItem['kind']; dir: string; file: string; record: KnowledgeRecord }> = []
  for (const { kind, dir } of NORMAL_DIRS) {
    const dirPath = join(KNOWLEDGE_ROOT, dir)
    if (!existsSync(dirPath)) continue
    for (const file of readdirSync(dirPath).filter(name => name.endsWith('.yaml'))) {
      const record = loadYaml(readFileSync(join(dirPath, file), 'utf8')) as KnowledgeRecord
      if (!NORMAL_STATUSES[kind].has(record.status ?? '')) continue
      records.push({ kind, dir, file, record })
    }
  }

  if (includeCandidates) {
    const dir = 'candidates'
    const dirPath = join(KNOWLEDGE_ROOT, dir)
    if (existsSync(dirPath)) {
      for (const file of readdirSync(dirPath).filter(name => name.endsWith('.yaml'))) {
        const record = loadYaml(readFileSync(join(dirPath, file), 'utf8')) as KnowledgeRecord
        if ((record.status ?? record.provenance?.lifecycle) !== 'candidate') continue
        const kind = candidateKind(record)
        if (kind) records.push({ kind, dir, file, record })
      }
    }
  }
  return records
}

/** 词法匹配；返回结构化摘要和 pointer，不把知识记录当运行事实。 */
export function retrieve(
  query: string,
  opts: {
    kinds?: RetrievedItem['kind'][]
    max?: number
    maxChars?: number
    includeCandidates?: boolean
  } = {},
): RetrievedItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1)
  if (terms.length === 0) return []

  const budgets = loadBudgets()
  const requestedMax = opts.max ?? budgets.maxCount
  const max = Math.max(0, Math.min(requestedMax, budgets.maxCount))
  const maxSnippetChars = opts.maxChars ?? 240
  const kinds = new Set(opts.kinds ?? ['pattern', 'anti-pattern', 'case'])
  const items: RetrievedItem[] = []

  for (const { kind, dir, file, record } of collectRecords(opts.includeCandidates === true)) {
    if (!kinds.has(kind)) continue
    const text = searchableText(record).toLowerCase()
    const score = terms.filter(term => text.includes(term)).length
    if (score === 0) continue
    const snippetSource = record.statement ?? record.failure_mechanism ?? record.title ?? ''
    items.push({
      id: record.id ?? file.replace(/\.yaml$/, ''),
      kind,
      title: record.title ?? file.replace(/\.yaml$/, ''),
      path: `.agents/dsh-intelligence/knowledge/${dir}/${file}`,
      snippet: snippetSource.slice(0, maxSnippetChars),
      score,
      status: record.status ?? record.provenance?.lifecycle ?? 'unknown',
    })
  }

  const sorted = items.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
  const output: RetrievedItem[] = []
  let payloadChars = 0
  for (const item of sorted) {
    if (output.length >= max) break
    const itemChars = JSON.stringify(item).length
    if (payloadChars + itemChars > budgets.maxPayloadChars) break
    output.push(item)
    payloadChars += itemChars
  }
  return output
}

function main(): void {
  const args = process.argv.slice(2)
  const query = args.filter(arg => !arg.startsWith('--')).join(' ') || 'durable'
  const kindFlag = args.find(arg => arg.startsWith('--kind='))
  const kind = kindFlag?.split('=')[1]
  let kinds: RetrievedItem['kind'][] | undefined
  if (kind === 'pattern' || kind === 'anti-pattern' || kind === 'case') kinds = [kind]
  const options: { kinds?: RetrievedItem['kind'][]; includeCandidates?: boolean } = {
    includeCandidates: args.includes('--include-candidates'),
  }
  if (kinds) options.kinds = kinds
  const items = retrieve(query, options)
  console.log(JSON.stringify(items, null, 2))
}

const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) main()
