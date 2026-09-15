import { describe, expect, it } from 'vitest'
import { markdownIdentity, plainKramdown } from '../src/siyuan.ts'

it.each([
  ['中文加粗标点', '**说明：**请检查。', '**说明：** 请检查。'],
  ['中文空白保留', '前文 **说明：**请检查。 后文', '前文 **说明：** 请检查。 后文'],
  ['格式之间的空白', '`前文` **说明：**请检查。 `后文`', '`前文` **说明：** 请检查。 `后文`'],
  ['中文前置空白', '使用`World`检查。', '使用 `World` 检查。'],
  ['相邻代码加粗', '**`甲` `乙`**', '**`甲`** **`乙`**'],
  ['加粗内代码拆分', '**Godot 的 `Export PCK/ZIP` 仅导出数据。**', '**Godot 的** **`Export PCK/ZIP`** **仅导出数据。**'],
  ['代码边缘空格', '`World`：当前世界。', '`World` ：当前世界。'],
  ['加粗边缘空格', '**World**：当前世界。', '**World** ：当前世界。'],
  ['换行表示', '**入口：** 地址  \n**版本：** v1', '**入口：** 地址\n**版本：** v1'],
  ['列表标记', '- 项目甲\n* 项目乙\n- 项目丙', '- 项目甲\n- 项目乙\n- 项目丙'],
  ['列表留白', '- 项目甲\n\n  正文\n\n- 项目乙\n\n  正文', '- 项目甲\n\n  正文\n- 项目乙\n\n  正文'],
  ['表格排版', '|甲|乙|\n|---|---|\n|A|B|', '| 甲 | 乙 |\n| ----- | ---- |\n| A | B |'],
])('按真实思源行为核对%s，保持文字与结构', (_name, before, after) => {
  expect(markdownIdentity(before)).toBe(markdownIdentity(after))
})
it('内容指纹仍区分代码、链接、强调、标题与列表顺序', () => {
  for (const [before, after] of [
    ['`a b`', '`ab`'], ['[来源](https://a.example)', '[来源](https://b.example)'],
    ['**关键**', '关键'], ['# 标题', '## 标题'], ['1. 甲\n2. 乙', '1. 乙\n2. 甲'],
    ['**含 `代码`**', '**含** `代码`'], ['正文', '另一段正文'],
    ['API`Key`', 'API `Key`'], ['foo`bar`', 'foo `bar`'],
  ]) expect(markdownIdentity(before!)).not.toBe(markdownIdentity(after!))
})
it('Kramdown 清理只删除非代码的原生属性，保留代码块与字面属性', () => {
  const value = '- {: id="20260908140721-32mi1je" updated="20260908140721"}正文\n  {: id="20260908140721-j3q42gb"}\n\n> 引用\n> {: id="20260908140721-4ldc7ng"}\n>\n\n~~~text\n{: id="20260908140721-32mi1je"}\n~~~'
  const clean = plainKramdown(value)
  expect(clean).toContain('- 正文')
  expect(clean).toContain('~~~text\n{: id="20260908140721-32mi1je"}\n~~~')
  expect(clean).not.toContain('j3q42gb')
  expect(markdownIdentity('\\# **说明：**内容')).not.toBe(markdownIdentity('# **说明：**内容'))
})

describe('SiYuan Kramdown 格式归一化', () => {
  it('移除思源块属性和列表属性，保留正文、链接与代码的阅读语义', () => {
    const authored = '## 试玩记录\n\n- 观察输入反馈\n- [来源](https://example.test/source)\n\n`dsh` 不应改写。'
    const returned = '## 试玩记录\n{: id="20260908130000-aaaaaaa" updated="20260908130000"}\n\n- {: id="20260908130000-bbbbbbb"} 观察输入反馈\n- {: id="20260908130000-ccccccc"} [来源](https://example.test/source)\n\n`dsh` 不应改写。\n{: id="20260908130000-ddddddd"}'

    expect(plainKramdown(returned)).toContain('- 观察输入反馈')
    expect(markdownIdentity(returned)).toBe(markdownIdentity(authored))
    expect(markdownIdentity(returned)).not.toBe(markdownIdentity(authored.replace('https://example.test/source', 'https://example.test/other')))
  })

  it('将思源常见的换行和中文强调标点还原为同一阅读文本', () => {
    const authored = '**提示：** 下一步记录玩家动作。\n\n先观察， 再调整。'
    const returned = '**提示：**下一步记录玩家动作。\n\n先观察，\n再调整。'

    expect(markdownIdentity(returned)).toBe(markdownIdentity(authored))
  })

  it('不清洗代码围栏中看似块属性的原文', () => {
    const markdown = '```text\n{: id="literal"}\n```'
    expect(plainKramdown(markdown)).toContain('{: id="literal"}')
    expect(markdownIdentity(markdown)).not.toBe(markdownIdentity('```text\n\n```'))
    const nested = '~~~~text\n```\n{: id="20260908140721-32mi1je"}\n```\n~~~~'
    expect(plainKramdown(nested)).toBe(nested)
  })
})
