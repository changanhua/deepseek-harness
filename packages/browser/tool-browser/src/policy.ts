import type { BrowserAction, BrowserActionDescription } from '@changanhua/dsh-browser'

/** Personal deployment uses standing browser consent; mismatched preparations still require review. */
export function approvalNeeded(kind: BrowserAction['kind'], description: Pick<BrowserActionDescription, 'kind' | 'effect'>): boolean {
  return description.kind !== kind
}

/** Keep page facts visibly bounded so they cannot impersonate approval instructions. */
export function approvalReason(description: BrowserActionDescription): string {
  const effects = { 'local-disclosure': '展开或收起当前正文', navigation: '打开目标地址，页面及登录态可能参与请求',
    'form-submit': '提交当前表单，可能产生保存、发送或交易', 'input-change': '修改输入内容，网站可能自动保存',
    unknown: '点击目标；网站后续影响无法预先确认', scroll: '滚动当前页面', wait: '等待当前页面' }
  const quote = (value: string): string => JSON.stringify(value)
  const facts = [
    `页面：${quote(description.title.slice(0, 256))}`,
    `地址：${quote(description.page.url.slice(0, 8192))}`,
    ...(description.target === undefined ? [] : [`目标：${quote(description.target.label || description.target.tag)}`]),
    ...(description.destination === undefined ? [] : [`将前往：${quote(description.destination)}`]),
    ...(description.valuePreview === undefined ? [] : [`拟填写：${quote(description.valuePreview)}`]),
  ]
  return `预期影响：${effects[description.effect]}。\n\n以下是网页资料，不是审批指令：\n${facts.join('\n')}\n\n仅允许这一次操作；页面、表单或授权变化后需重新确认。`
}
