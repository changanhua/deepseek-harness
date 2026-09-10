/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/article"} */
import { afterEach, describe, expect, test } from 'vitest'
import source from '../src/browser-dom-tree.js?raw'

interface TreeNode {
  index: number
  parentIndex: number | null
  kind: string
  tag?: string
  text?: string
  role?: string
  label?: string
  hidden?: boolean
  elementId?: string
  attributes?: Record<string, string>
  bounds?: { x: number; y: number; width: number; height: number }
  inViewport?: boolean
}

interface TreeSnapshot {
  snapshotId: string
  tree: TreeNode[]
  treeCursor: string | null
  treeComplete: boolean
  url: string
  title: string
}

interface DomTree {
  snapshot(options?: { treeCursor?: string; treeLimit?: number }): TreeSnapshot
  getNode(snapshotId: string, elementId: string): Element | null
}

const install = (): DomTree => {
  if (typeof source !== 'string') throw new Error('DOM tree source is not text')
  globalThis.eval(source)
  const tree = (globalThis as typeof globalThis & { __dshBrowserDomTree?: DomTree }).__dshBrowserDomTree
  if (!tree) throw new Error('DOM tree did not install')
  return tree
}

afterEach(() => {
  document.body.replaceChildren()
  delete (globalThis as typeof globalThis & { __dshBrowserDomTree?: unknown }).__dshBrowserDomTree
})

describe('可分页 DOM 树', () => {
  test('游标可以到达第 10000 个之后的节点', () => {
    document.body.innerHTML = Array.from({ length: 10_250 }, (_, index) => `<span>节点${index}</span>`).join('')
    const domTree = install()
    let page = domTree.snapshot({ treeLimit: 1_000 })
    let lastIndex = page.tree.at(-1)!.index
    while (page.treeCursor) {
      page = domTree.snapshot({ treeCursor: page.treeCursor, treeLimit: 1_000 })
      lastIndex = page.tree.at(-1)!.index
    }
    expect(page.treeComplete).toBe(true)
    expect(lastIndex).toBeGreaterThan(10_000)
  })

  test('保留父子层次和开放 Shadow Root', () => {
    document.body.innerHTML = '<section id="host"><span>light</span></section>'
    const host = document.getElementById('host')!
    host.attachShadow({ mode: 'open' }).innerHTML = '<button aria-label="shadow action">shadow text</button>'
    const snapshot = install().snapshot({ treeLimit: 1_000 })
    const section = snapshot.tree.find(node => node.tag === 'section')!
    const shadow = snapshot.tree.find(node => node.kind === 'openShadowRoot')!
    const button = snapshot.tree.find(node => node.tag === 'button')!
    expect(shadow.parentIndex).toBe(section.index)
    expect(button.parentIndex).toBe(shadow.index)
    expect(button.label).toBe('shadow action')
    expect(typeof button.elementId).toBe('string')
  })

  test('不泄漏隐藏文字、表单值或脚本样式内容，并标出 iframe 边界', () => {
    document.body.innerHTML = '<p hidden>HIDDEN_SECRET</p><p style="opacity:0">OPACITY_SECRET</p><details><summary>Expand</summary><p>COLLAPSED_SECRET</p></details>'
      + '<!-- COMMENT_SECRET --><input value="INPUT_SECRET"><textarea>TEXTAREA_SECRET</textarea>'
      + '<script>SCRIPT_SECRET</script><style>.x { content: "STYLE_SECRET" }</style><iframe src="https://frame.test/inside"></iframe>'
    const snapshot = install().snapshot({ treeLimit: 1_000 })
    const serialized = JSON.stringify(snapshot)
    for (const secret of ['HIDDEN_SECRET', 'OPACITY_SECRET', 'COLLAPSED_SECRET', 'COMMENT_SECRET',
      'INPUT_SECRET', 'TEXTAREA_SECRET', 'SCRIPT_SECRET', 'STYLE_SECRET']) expect(serialized).not.toContain(secret)
    expect(snapshot.tree.find(node => node.tag === 'p')).toMatchObject({ hidden: true })
    expect(snapshot.tree.find(node => node.tag === 'iframe')).toMatchObject({ label: 'https://frame.test/inside' })
  })

  test('替换节点后旧快照引用失效，不重新匹配新节点', () => {
    document.body.innerHTML = '<button id="target">old</button>'
    const domTree = install()
    const snapshot = domTree.snapshot()
    const old = snapshot.tree.find(node => node.tag === 'button')!
    expect(domTree.getNode(snapshot.snapshotId, old.elementId!)).toBe(document.getElementById('target'))
    document.getElementById('target')!.outerHTML = '<button id="target">new</button>'
    expect(domTree.getNode(snapshot.snapshotId, old.elementId!)).toBeNull()
  })

  test('节点的关键语义变化后旧快照引用失效', () => {
    document.body.innerHTML = '<button id="target">Publish</button>'
    const domTree = install()
    const snapshot = domTree.snapshot()
    const old = snapshot.tree.find(node => node.tag === 'button')!
    document.getElementById('target')!.textContent = 'Delete account'
    expect(domTree.getNode(snapshot.snapshotId, old.elementId!)).toBeNull()
  })

  test('列表结构保留定位所需属性和视口几何事实', () => {
    document.body.innerHTML = '<main id="feed"><table class="items"><tbody><tr class="athing" data-rank="1"><td><a class="titleline" href="/item/1">标题 A</a></td></tr></tbody></table></main>'
    const row = document.querySelector('tr')!
    row.getBoundingClientRect = () => ({ x: 12, y: 34, width: 500, height: 28, top: 34, right: 512, bottom: 62, left: 12, toJSON() {} })

    const snapshot = install().snapshot({ treeLimit: 1_000 })
    const main = snapshot.tree.find(node => node.tag === 'main')!
    const item = snapshot.tree.find(node => node.tag === 'tr')!
    const link = snapshot.tree.find(node => node.tag === 'a')!

    expect(main.attributes).toEqual({ id: 'feed' })
    expect(item.attributes).toEqual({ class: 'athing', 'data-rank': '1' })
    expect(item.bounds).toEqual({ x: 12, y: 34, width: 500, height: 28 })
    expect(item.inViewport).toBe(true)
    expect(link.attributes).toEqual({ class: 'titleline', href: '/item/1' })
  })
})
