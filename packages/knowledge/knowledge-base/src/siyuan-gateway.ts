/** 将 SiYuan 原生 MCP 的文本响应收窄为知识库需要的已验证数据。 */

export type SiyuanMcpKind = 'document' | 'block' | 'search'

/** 由 Host 适配器提供的唯一网络边界。 */
export type SiyuanMcpCall = (
  type: SiyuanMcpKind,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>

/** SiYuan 文档的经回读确认身份。 */
export interface SiyuanGatewayDocument {
  id: string
  notebook: string
  hPath: string
  title: string
}

/** 原生 MCP 的窄业务接口；未知文本绝不降级为空结果。 */
export interface SiyuanGateway {
  listDocuments(notebook: string, parentPath: string, signal: AbortSignal): Promise<Array<Pick<SiyuanGatewayDocument, 'id' | 'hPath' | 'title'>>>
  createDocument(notebook: string, hPath: string, title: string, markdown: string, signal: AbortSignal): Promise<string>
  getDocument(id: string, signal: AbortSignal): Promise<SiyuanGatewayDocument>
  getKramdown(id: string, signal: AbortSignal): Promise<string>
  search(notebook: string, query: string, signal: AbortSignal): Promise<string[]>
}

interface McpText { type: 'text'; text: string }

function isMcpText(value: unknown): value is McpText {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'type' in value && value.type === 'text' && 'text' in value && typeof value.text === 'string'
}

function textResult(value: unknown, operation: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`knowledge-base: unrecognized SiYuan ${operation} response`)
  }
  const result = value as { content?: unknown; isError?: unknown }
  if (result.isError === true) throw new Error(`knowledge-base: SiYuan MCP error: ${operation}`)
  if (!Array.isArray(result.content) || result.content.length === 0 || !result.content.every(isMcpText)) {
    throw new Error(`knowledge-base: unrecognized SiYuan ${operation} response`)
  }
  return result.content.map(item => item.text).join('')
}

function field(text: string, name: string): string | null {
  return new RegExp(`^${name}: *(.*)$`, 'mu').exec(text)?.[1]?.trim() ?? null
}

/** 未匹配的文本不能进入调用点各自声明的固定捕获组元组。 */
function mustMatch(text: string, expression: RegExp, operation: string): RegExpExecArray {
  const match = expression.exec(text)
  if (!match) throw new Error(`knowledge-base: unrecognized SiYuan ${operation} response`)
  return match
}

/**
 * 用实测的 MCP 文本协议创建 fail-closed 网关。
 *
 * @param call - Host 提供的原生 MCP 调用边界。
 * @returns 只暴露知识投影所需操作的网关。
 */
export function createSiyuanGateway(call: SiyuanMcpCall): SiyuanGateway {
  async function invoke(type: SiyuanMcpKind, args: Record<string, unknown>, signal: AbortSignal, operation: string): Promise<string> {
    signal.throwIfAborted()
    const text = textResult(await call(type, args, signal), operation)
    signal.throwIfAborted()
    return text
  }

  return {
    async listDocuments(notebook, parentPath, signal) {
      const text = await invoke('document', { action: 'list', notebook, path: parentPath }, signal, 'document.list')
      // 此正则固定含 notebook 与 hPath 两个捕获组。
      const header = mustMatch(text, /^Documents in ([^\n]+) \(hPath: ([^\n]+)\):\r?\n?/mu, 'document.list') as unknown as [string, string, string]
      if (header[1] !== notebook || header[2] !== parentPath) {
        throw new Error('knowledge-base: SiYuan document.list returned another notebook or path')
      }
      const remainder = text.slice(header[0].length)
      const documents: Array<Pick<SiyuanGatewayDocument, 'id' | 'hPath' | 'title'>> = []
      for (const line of remainder.split(/\r?\n/u)) {
        if (!line) continue
        // 此正则固定含标题、ID 与 hPath 三个捕获组。
        const match = mustMatch(line, /^- (.+?) \(id: ([^,\n)]+), hPath: ([^\n)]+)\)$/u, 'document.list') as unknown as [string, string, string, string]
        documents.push({ id: match[2], hPath: match[3], title: match[1] })
      }
      return documents
    },

    async createDocument(notebook, hPath, title, markdown, signal) {
      const text = await invoke('document', { action: 'create', notebook, path: hPath, title, markdown }, signal, 'document.create')
      // 此正则固定含文档 ID 与 hPath 两个捕获组。
      const match = mustMatch(text, /^document created: ([^\s(]+) \(hPath: ([^)]+)\)$/mu, 'document.create') as unknown as [string, string, string]
      if (match[2] !== hPath) throw new Error('knowledge-base: SiYuan document.create returned another hPath')
      return match[1]
    },

    async getDocument(id, signal) {
      const text = await invoke('document', { action: 'get', id }, signal, 'document.get')
      const observedId = field(text, 'ID')
      const title = field(text, 'Title') || field(text, 'Content')
      const hPath = field(text, 'HPath')
      const notebook = field(text, 'Box')
      const type = field(text, 'Type')
      if (observedId !== id || !title || hPath === null || notebook === null || type !== 'NodeDocument') {
        throw new Error('knowledge-base: unrecognized SiYuan document.get response')
      }
      return { id, notebook, hPath, title }
    },

    async getKramdown(id, signal) {
      return invoke('block', { action: 'get_kramdown', id }, signal, 'block.get_kramdown')
    },

    async search(notebook, query, signal) {
      const documents = new Set<string>()
      let page = 1
      let pages = 1
      do {
        const text = await invoke('search', {
          action: 'fulltext', notebook, query, method: 0, groupBy: 1, page, pageSize: 100,
        }, signal, 'search.fulltext')
        if (text === 'No results found.') return []
        // 此正则固定含当前页与总页数两个捕获组。
        const match = mustMatch(text, /^Found \d+ results \(page (\d+)\/(\d+)\):/mu, 'search.fulltext') as unknown as [string, string, string]
        if (Number(match[1]) !== page || Number(match[2]) < page) {
          throw new Error('knowledge-base: unrecognized SiYuan search.fulltext response')
        }
        pages = Number(match[2])
        for (const document of text.matchAll(/^- \[[^\]\r\n]*\] NodeDocument\r?\n  [^\r\n]*\r?\n  id: ([^\r\n]+)$/gmu)) {
          // 此正则只有一个必有的文档 ID 捕获组。
          const [, documentId] = document as unknown as [string, string]
          documents.add(documentId)
        }
        if (/^Found ([1-9]\d*) results /mu.test(text) && documents.size === 0) {
          throw new Error('knowledge-base: unrecognized SiYuan search.fulltext response')
        }
        page++
      } while (page <= pages)
      return [...documents]
    },
  }
}
