/** Locale namespace registered by the Content library client plugin. */
export const NS = 'content'

/** Simplified Chinese copy for every Content library locale key. */
export const zh = {
  'nav.contentLibrary': '内容库',
  'view.title': '内容库',
  'view.subtitle': '从会话捕获的纯文本回复与后续编辑。',
  'action.refresh': '刷新',
  'action.retry': '重试',
  'capture.action': '捕获到内容库',
  'capture.captured': '已捕获',
  'capture.pending': '正在捕获…',
  'status.opening': '内容库正在打开…',
  'status.unavailable': '内容库当前不可用',
  'status.closed': '内容库已关闭',
  'library.empty': '还没有捕获任何内容。',
  'library.emptyHint': '在会话中点击助手回复操作栏的“捕获到内容库”。',
  'entry.versions': '个版本',
  'entry.draft': '草稿编辑中',
  'entry.favorite': '收藏',
  'entry.archived': '已归档',
  'entry.kind.original': '会话捕获',
  'entry.kind.idea': '手动条目',
  'detail.body': '正文',
  'detail.source': '来源',
  'detail.source.session': '会话消息',
  'detail.source.provided': '手动输入',
  'error.generic': '操作失败，请重试',
  'error.load': '无法读取内容库',
  'error.invalid_request': '请求不合法',
  'error.forbidden': '当前连接未获授权',
  'error.not_found': '内容或来源不存在',
  'error.revision_conflict': '内容已被其他窗口修改，刷新后再试',
  'error.operation_conflict': '请求标识冲突，请重试',
  'error.source_conflict': '这条来源已被捕获为不同内容',
  'error.invalid_transition': '这条消息当前不能被捕获',
  'error.capacity_exceeded': '超出内容库容量限制',
  'error.library_in_use': '内容库正被其他进程使用',
  'error.storage_failed': '内容库存储失败',
  'error.invalid_library': '内容库数据损坏',
  'error.unavailable': '内容库暂时不可用',
  'error.closed': '内容库已关闭',
  'error.transport': '网络连接中断，请重试',
} as const

/** English copy for every Content library locale key. */
export const en: Record<keyof typeof zh, string> = {
  'nav.contentLibrary': 'Content Library',
  'view.title': 'Content Library',
  'view.subtitle': 'Plain-text replies captured from sessions, plus later edits.',
  'action.refresh': 'Refresh',
  'action.retry': 'Retry',
  'capture.action': 'Capture to library',
  'capture.captured': 'Captured',
  'capture.pending': 'Capturing…',
  'status.opening': 'The content library is opening…',
  'status.unavailable': 'The content library is currently unavailable',
  'status.closed': 'The content library is closed',
  'library.empty': 'Nothing has been captured yet.',
  'library.emptyHint': 'Use "Capture to library" in an assistant reply\'s action strip.',
  'entry.versions': 'versions',
  'entry.draft': 'Draft in progress',
  'entry.favorite': 'Favorite',
  'entry.archived': 'Archived',
  'entry.kind.original': 'Session capture',
  'entry.kind.idea': 'Manual entry',
  'detail.body': 'Body',
  'detail.source': 'Source',
  'detail.source.session': 'Session message',
  'detail.source.provided': 'Entered manually',
  'error.generic': 'The operation failed; try again',
  'error.load': 'The content library could not be read',
  'error.invalid_request': 'The request is invalid',
  'error.forbidden': 'This connection is not authorized',
  'error.not_found': 'The content or its source does not exist',
  'error.revision_conflict': 'The content changed elsewhere; refresh and try again',
  'error.operation_conflict': 'The request identity conflicts; try again',
  'error.source_conflict': 'This source was already captured as different content',
  'error.invalid_transition': 'This message cannot be captured right now',
  'error.capacity_exceeded': 'The content library capacity limit was exceeded',
  'error.library_in_use': 'The content library is in use by another process',
  'error.storage_failed': 'The content library write failed',
  'error.invalid_library': 'The content library data is corrupted',
  'error.unavailable': 'The content library is temporarily unavailable',
  'error.closed': 'The content library is closed',
  'error.transport': 'The network connection dropped; try again',
}

/** Stable locale keys shared by both Content library dictionaries. */
export type ContentKey = keyof typeof zh

/** Error codes the Content wire reports, mapped to their dictionary keys. */
const ERROR_KEYS: Partial<Record<string, ContentKey>> = {
  invalid_request: 'error.invalid_request',
  forbidden: 'error.forbidden',
  not_found: 'error.not_found',
  revision_conflict: 'error.revision_conflict',
  operation_conflict: 'error.operation_conflict',
  source_conflict: 'error.source_conflict',
  invalid_transition: 'error.invalid_transition',
  capacity_exceeded: 'error.capacity_exceeded',
  library_in_use: 'error.library_in_use',
  storage_failed: 'error.storage_failed',
  invalid_library: 'error.invalid_library',
  unavailable: 'error.unavailable',
  closed: 'error.closed',
  transport: 'error.transport',
}

/**
 * Dictionary key for one wire error code, falling back to the generic copy so
 * an unknown code never renders raw internals.
 * @param code - the code carried by the failure envelope.
 */
export function contentErrorKey(code: string): ContentKey {
  return ERROR_KEYS[code] ?? 'error.generic'
}
