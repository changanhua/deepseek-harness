/**
 * Stage one: design a movie-specific "analysis plugin".
 *
 * Runs the shared 叙事机制诊断师 template (the user-prescribed prompt) against
 * one movie. The LLM returns a bespoke analysis plugin (core question +
 * analysis dimensions + caveats) which stage two then executes. Idempotent:
 * a `done` prompt is kept, so retries never repeat LLM work.
 *
 * Usage: node step1-prompt.mjs [--db <path>] '<movie-json>' | '<title>'
 */

import { callLlm, ensureMovie, openDb, parseArgs, parseJsonObject, recordFailure } from './lib.mjs'

const SYSTEM = [
  '你是一名“叙事机制诊断师”。',
  '我正在建立一个包含大量经典电影的创作机制数据库。',
  '接下来我会给你一部电影。',
  '你的任务不是直接写影评，也不是全面分析这部电影，而是：判断这部电影最值得分析的独特之处，并为它设计一套专属分析方案。',
].join(' ')

const BODY = (movie) => `电影：

《${movie.title}》
导演：${movie.director ?? '未知'}
年份：${movie.year ?? '未知'}
剧情资料：${movie.synopsis ?? '（暂缺，可省略）'}

---

## 一、先回答：这部电影“真正厉害在哪里”

不要按照摄影、表演、剧情、主题这种传统影评目录平均分配篇幅。

请找出：

1. 这部电影最核心的 1 个创作引擎
2. 最值得拆解的 3-6 个特殊机制
3. 哪些普通分析维度对这部电影价值较低
4. 如果只能研究这部电影的一个问题，最应该研究什么

例如：

* 《记忆碎片》可能重点研究信息释放与时间结构
* 《寄生虫》可能重点研究空间、阶级与情节耦合
* 《十二怒汉》可能重点研究立场变化与群体动力
* 《低俗小说》可能重点研究非线性结构、人物魅力和戏剧性对话

但不要机械模仿这些例子。

---

## 二、寻找“异常点”

回答：

### 1. 它违反了哪些通常的创作常识，却仍然成功？

### 2. 它有哪些东西看起来不应该好看，但实际非常好看？

### 3. 如果普通创作者模仿它，最容易学错什么？

### 4. 哪些特征只是表面风格，哪些才是真正产生效果的底层机制？

---

## 三、提出 8-15 个“高信息量问题”

这些问题必须针对这部电影本身。

避免：

“人物塑造怎么样？”
“摄影有什么特点？”
“主题是什么？”

这种任何电影都能问的问题。

应该类似：

“为什么观众明知主角正在做错误的选择，却仍然期待他继续？”

“影片在哪几个节点故意延迟了观众已经预期会发生的事件？延迟产生了什么效果？”

“如果把非线性叙事恢复成时间顺序，这部电影具体会损失什么？”

问题应该能够逼出这部电影真正特殊的机制。

---

## 四、生成「专属分析插件」

最后输出：

### A. 核心研究问题

1-3 个。

### B. 专属分析维度

3-6 个。

每个维度写清：

* 分析什么
* 为什么重要
* 应该寻找哪些电影证据
* 最终希望抽象出什么创作规律

### C. 分析注意事项

指出分析这部电影最容易产生的误判。

---

不要正式分析电影。

你的产物将作为下一阶段分析模型的“电影专属分析插件”。

请严格输出 JSON：{"plugin":"<完整的专属分析插件文本，包含 A.核心研究问题 / B.专属分析维度 / C.分析注意事项>"}`

async function main() {
  const { dbPath, movie } = parseArgs(process.argv.slice(2))
  const db = openDb(dbPath)
  const row = ensureMovie(db, movie)
  if (row?.prompt_status === 'done' && typeof row.prompt === 'string' && row.prompt !== '') {
    console.log(`skip: plugin already done for "${movie.title}"`)
    return
  }
  try {
    const text = await callLlm([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: BODY(movie) },
    ])
    const plugin = parseJsonObject(text).plugin
    if (typeof plugin !== 'string' || plugin.trim() === '') {
      throw new Error(`douban-top250: stage one returned no plugin for "${movie.title}"`)
    }
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE movies SET prompt = ?, prompt_status = 'done', error = NULL, updated_at = ?
      WHERE title = ?
    `).run(plugin.trim(), now, movie.title)
    console.log(`stored analysis plugin for "${movie.title}"`)
  } catch (error) {
    recordFailure(db, movie.title, 'prompt', error)
    throw error
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
