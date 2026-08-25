/**
 * prepare-private-eval.ts — 只创建 private-eval 目录与模板，不生成任何答案。
 *
 * 边界：
 *  - 写 `.dsh-intelligence/private-evals/**`（gitignored，永不提交）；
 *  - prompt 模板只含 requirement/constraints；rubric 模板只含判卷标准，二者分离；
 *  - 不生成答案、不注入 retrieval/snapshot/晋升、不读取 visible-tasks 内容。
 *
 * 用法：tsx scripts/dsh-intelligence/prepare-private-eval.ts --init
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const PROMPT_TEMPLATE = `# Private holdout prompt template
# 模型可见面：只含需求与约束。绝不要在这里放 expected_design / baseline_trap 等答案。
id: holdout-000
category: seam-placement
prompt:
  requirement: >-
    （替换为真实需求：描述要解决的问题、目标用户与验收行为，不包含任何架构答案）
  constraints:
    - （替换为约束，例如：跨进程持久化 / 模型可见可回放 / 不新增 packages 等）
`

const RUBRIC_TEMPLATE = `# Private holdout rubric template
# Evaluator 可见面：不可见判卷标准。绝不进入模型输入。
id: holdout-000
category: seam-placement
rubric:
  blocking_findings:
    - id: bf-01
      severity: P0
      rule_id: placement.parallel-runtime
      condition: （描述判定条件，例如：方案重新拥有 Agent/Session/Tool/LLM 生命周期）
    - id: bf-02
      severity: P0
      rule_id: seam.incomplete
      condition: （描述判定条件）
  expected_properties:
    - （描述期望设计应具备的可验证性质，例如：领域 owner 只引用现有 DSH owner）
  forbidden_patterns:
    - （描述禁止出现的方案模式）
  severity_weights:
    P0: 8
    P1: 3
    P2: 1
`

const MANIFEST_TEMPLATE = `{
  "run_id": "<run-id>",
  "created_at": "",
  "identity": { "prompt_hash": "", "model": "", "temperature": 0, "max_tokens": 0, "seed": null },
  "note": "baseline = 无 Intelligence 能力；intelligence = 启用 Contract Kernel/Retriever/ADP。"
}
`

/** 幂等初始化 private-eval 骨架（存在则跳过，不覆盖）。 */
export function initPrivateEvalSkeleton(root = ROOT): string[] {
  const created: string[] = []
  const mkdir = (p: string) => { mkdirSync(p, { recursive: true }) }

  const tasksDir = join(root, '.dsh-intelligence', 'private-evals', 'tasks')
  const runsDir = join(root, '.dsh-intelligence', 'private-evals', 'runs')
  const sampleRun = join(runsDir, 'sample-run')
  mkdir(tasksDir); mkdir(join(sampleRun, 'baseline')); mkdir(join(sampleRun, 'intelligence'))
  created.push(tasksDir, join(sampleRun, 'baseline'), join(sampleRun, 'intelligence'))

  const promptFile = join(tasksDir, 'task-000.prompt.yaml')
  const rubricFile = join(tasksDir, 'task-000.rubric.yaml')
  const manifestFile = join(sampleRun, 'manifest.json')
  for (const [file, content] of [
    [promptFile, PROMPT_TEMPLATE],
    [rubricFile, RUBRIC_TEMPLATE],
    [manifestFile, MANIFEST_TEMPLATE],
  ] as const) {
    if (!existsSync(file)) { writeFileSync(file, content, 'utf8'); created.push(file) }
  }
  return created
}

function main(): void {
  const created = initPrivateEvalSkeleton()
  console.log(`private-eval skeleton ready (${created.length} path(s)):`)
  for (const p of created) console.log(`  ${p.replace(ROOT + '\\', '')}`)
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
