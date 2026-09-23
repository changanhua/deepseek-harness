export const atlasPageFixtures = [
  ['article', { title: '文章', tree: [{ index: 0, parentIndex: null, kind: 'element', tag: 'article' }] }, 'article'],
  ['question feed', { title: '问答', tree: [{ index: 0, parentIndex: null, kind: 'element', role: 'feed' }] }, 'feed'],
  ['directory search', { title: '目录搜索', tree: [{ index: 0, parentIndex: null, kind: 'element', tag: 'ul' }], structure: { collections: [{ kind: 'results', items: [{ index: 0, text: '结果' }] }] } }, 'list'],
  ['form dashboard', { title: '仪表盘', tree: [{ index: 0, parentIndex: null, kind: 'element', tag: 'form' }] }, 'form'],
  ['unknown', { title: '未知', tree: [{ index: 0, parentIndex: null, kind: 'element', tag: 'canvas' }] }, 'unknown'],
] as const
