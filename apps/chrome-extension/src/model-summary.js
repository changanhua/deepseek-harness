/** Display the next Session selection; omitted effort belongs to the provider's defaults. */
export const modelSummary = session => {
  const selection = session?.modelSelection?.next ?? session?.modelSelection?.lastUsed
  if (!selection?.model) return '模型：DSH 默认 · 推理强度：默认（尚未取得会话配置）'
  const efforts = { off: '关闭', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' }
  const effort = selection.reasoningEffort
  return `模型：${selection.model} · 推理强度：${effort === undefined ? '默认' : efforts[effort] ?? effort}`
}
