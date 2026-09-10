import { describe, expect, it } from 'vitest'
import { createSiyuanGateway, type SiyuanMcpCall } from '../src/siyuan-gateway.ts'

function response(text: string): unknown {
  return { content: [{ type: 'text', text }] }
}

describe('SiYuan 原生 MCP 网关', () => {
  it('从文档列表的原生文本中保留稳定 ID、路径和标题', async () => {
    const calls: Array<{ type: string; args: Record<string, unknown> }> = []
    const call: SiyuanMcpCall = async (type, args) => {
      calls.push({ type, args })
      return response('Documents in 20210808180117-czj9bvb (hPath: /AI 生成知识库):\n\n- AI 游戏开发 (id: 20260908130634-78h2om6, hPath: /AI 生成知识库/AI 游戏开发)\n')
    }

    const gateway = createSiyuanGateway(call)
    await expect(gateway.listDocuments('20210808180117-czj9bvb', '/AI 生成知识库', new AbortController().signal)).resolves.toEqual([
      { id: '20260908130634-78h2om6', hPath: '/AI 生成知识库/AI 游戏开发', title: 'AI 游戏开发' },
    ])
    expect(calls).toEqual([{
      type: 'document',
      args: { action: 'list', notebook: '20210808180117-czj9bvb', path: '/AI 生成知识库' },
    }])
    await expect(createSiyuanGateway(async () => response('Documents in another-box (hPath: /AI 生成知识库):\n')).listDocuments(
      '20210808180117-czj9bvb', '/AI 生成知识库', new AbortController().signal,
    )).rejects.toThrow('SiYuan document.list returned another notebook or path')
  })

  it('从创建与文档详情的原生文本中取得文档身份', async () => {
    const calls: Array<Record<string, unknown>> = []
    const call: SiyuanMcpCall = async (type, args) => {
      if (type !== 'document') throw new Error('unexpected type')
      calls.push(args)
      if (args.action === 'create') return response('document created: 20260908130634-78h2om6 (hPath: /AI 生成知识库/AI 游戏开发)')
      return response('ID: 20260908130634-78h2om6\nTitle: \nHPath: /AI 生成知识库/AI 游戏开发\nBox: 20210808180117-czj9bvb\nContent: AI 游戏开发\nMarkdown: \nType: NodeDocument\nCreated: 20260908130634')
    }
    const gateway = createSiyuanGateway(call)

    await expect(gateway.createDocument('20210808180117-czj9bvb', '/AI 生成知识库/AI 游戏开发', 'AI 游戏开发', '# AI 游戏开发', new AbortController().signal)).resolves.toBe('20260908130634-78h2om6')
    await expect(gateway.getDocument('20260908130634-78h2om6', new AbortController().signal)).resolves.toEqual({
      id: '20260908130634-78h2om6', notebook: '20210808180117-czj9bvb', hPath: '/AI 生成知识库/AI 游戏开发', title: 'AI 游戏开发',
    })
    expect(calls[0]).toMatchObject({ action: 'create', path: '/AI 生成知识库/AI 游戏开发' })
    expect(calls[0]).not.toHaveProperty('hPath')
  })

  it('读取原样 Kramdown，并从分页全文搜索中仅去重返回文档 ID', async () => {
    const call: SiyuanMcpCall = async (type, args) => {
      if (type === 'block') return response('{{{row\n\n正文\n\n}}}\n{: id="20260908130634-78h2om6"}')
      if (args.page === 1) return response('Found 2 results (page 1/2):\n\n- [/AI 生成知识库/] NodeDocument\n  AI 游戏开发\n  id: 20260908130634-78h2om6\n\n(grouped by document, 1 documents matched)')
      return response('Found 1 results (page 2/2):\n\n- [/AI 生成知识库/] NodeDocument\n  AI 摄影\n  id: 20260908130636-bb\n\n(grouped by document, 1 documents matched)')
    }
    const gateway = createSiyuanGateway(call)

    await expect(gateway.getKramdown('20260908130634-78h2om6', new AbortController().signal)).resolves.toBe('{{{row\n\n正文\n\n}}}\n{: id="20260908130634-78h2om6"}')
    await expect(gateway.search('20210808180117-czj9bvb', 'DSHKB game-vibe', new AbortController().signal)).resolves.toEqual([
      '20260908130634-78h2om6', '20260908130636-bb',
    ])
  })

  it('拒绝 MCP 错误和无法验证身份的响应', async () => {
    const failed = createSiyuanGateway(async () => ({ isError: true, content: [{ type: 'text', text: 'denied' }] }))
    const malformed = createSiyuanGateway(async () => response('document created: unknown'))

    await expect(failed.listDocuments('box', '/', new AbortController().signal)).rejects.toThrow('knowledge-base: SiYuan MCP error')
    await expect(malformed.createDocument('box', '/AI', 'AI', '# AI', new AbortController().signal)).rejects.toThrow('knowledge-base: unrecognized SiYuan document.create response')
  })

  it('将真实全文检索的无结果文本视为有效空集，缺失路径则保留 MCP 错误', async () => {
    const empty = createSiyuanGateway(async () => response('No results found.'))
    const missingPath = createSiyuanGateway(async () => ({
      isError: true,
      content: [{ type: 'text', text: 'target path not found: /__dsh_gateway_nonexistent_20260908' }],
    }))

    await expect(empty.search('20210808180117-czj9bvb', '__dsh_gateway_nonexistent_20260908__', new AbortController().signal)).resolves.toEqual([])
    await expect(missingPath.listDocuments('20210808180117-czj9bvb', '/__dsh_gateway_nonexistent_20260908', new AbortController().signal)).rejects.toThrow('knowledge-base: SiYuan MCP error: document.list')
  })

  it('拒绝不能安全解释为文档操作结果的内容、路径和身份', async () => {
    const absent = createSiyuanGateway(async () => null)
    const nonText = createSiyuanGateway(async () => ({ content: [{ type: 'image', url: 'https://example.test/a.png' }] }))
    const unknownListLine = createSiyuanGateway(async () => response('Documents in box (hPath: /知识):\nunexpected remote detail\n'))
    const otherPath = createSiyuanGateway(async () => response('document created: doc-1 (hPath: /其他)'))
    const otherDocument = createSiyuanGateway(async () => response('ID: another\nTitle: 标题\nHPath: /知识/条目\nBox: box\nContent: 标题\nType: NodeDocument'))
    const missingDocumentFields = createSiyuanGateway(async () => response('document details unavailable'))

    await expect(absent.getKramdown('block', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan block.get_kramdown response')
    await expect(nonText.getKramdown('block', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan block.get_kramdown response')
    await expect(unknownListLine.listDocuments('box', '/知识', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan document.list response')
    await expect(otherPath.createDocument('box', '/知识/条目', '条目', '# 条目', new AbortController().signal)).rejects.toThrow('returned another hPath')
    await expect(otherDocument.getDocument('expected', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan document.get response')
    await expect(missingDocumentFields.getDocument('expected', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan document.get response')
  })

  it('拒绝分页编号不一致和缺少文档组的非空全文结果', async () => {
    const wrongPage = createSiyuanGateway(async () => response('Found 1 results (page 2/2):\n\n- [/知识/] NodeDocument\n  条目\n  id: doc-1\n'))
    const noDocument = createSiyuanGateway(async () => response('Found 1 results (page 1/1):\n\n- [/知识/] NodeParagraph\n  DSHKB game\n  id: block-1\n'))

    await expect(wrongPage.search('box', 'DSHKB game', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan search.fulltext response')
    await expect(noDocument.search('box', 'DSHKB game', new AbortController().signal)).rejects.toThrow('unrecognized SiYuan search.fulltext response')
  })
})
