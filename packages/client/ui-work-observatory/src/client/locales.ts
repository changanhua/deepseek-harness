/**
 * Locale bundles for the Work Observatory settings section.
 *
 * The limitation copy deliberately avoids any productivity claim: Agent
 * Running is step wall time and V1 does not split model execution, tool
 * execution, user waits, or child-agent waits inside a step.
 */

/** Locale keys the Work Observatory settings section renders. */
export type WorkObservatoryKey =
  | 'nav' | 'title' | 'description'
  | 'loading' | 'error' | 'retry'
  | 'today' | 'dateLabel'
  | 'humanActive' | 'pageVisible' | 'agentRunning' | 'agentSolo' | 'together'
  | 'timelineVisible' | 'timelineActive' | 'timelineRunning'
  | 'limitation'

/** English copy. */
export const en: Record<WorkObservatoryKey, string> = {
  nav: 'Work Observatory',
  title: 'Work Observatory',
  description: 'Conservative wall-clock evidence of browser presence and Agent steps, kept separate from the Session log.',
  loading: 'Loading work observatory…',
  error: 'Could not load work observatory data.',
  retry: 'Retry',
  today: 'Today',
  dateLabel: 'Date',
  humanActive: 'Human Active',
  pageVisible: 'Page Visible',
  agentRunning: 'Agent Running',
  agentSolo: 'Agent Solo',
  together: 'Together',
  timelineVisible: 'Page visible',
  timelineActive: 'Human active',
  timelineRunning: 'Agent running',
  limitation: 'Agent Running is based on step lifecycle. V1 does not yet separate model execution, tool execution, waiting for the user, and waiting for a child agent within a step.',
}

/** Simplified Chinese copy. */
export const zh: Record<WorkObservatoryKey, string> = {
  nav: '工作观测',
  title: '工作观测',
  description: '浏览器存在与 Agent 步骤的保守墙钟证据，与 Session 日志分开保存。',
  loading: '正在加载工作观测…',
  error: '无法加载工作观测数据。',
  retry: '重试',
  today: '今天',
  dateLabel: '日期',
  humanActive: '人类活跃',
  pageVisible: '页面可见',
  agentRunning: 'Agent 运行',
  agentSolo: 'Agent 独立',
  together: '人机协同',
  timelineVisible: '页面可见',
  timelineActive: '人类活跃',
  timelineRunning: 'Agent 运行',
  limitation: 'Agent Running 基于 step 生命周期，V1 尚未区分 step 内的模型执行、工具执行、等待用户和等待子 Agent。',
}
