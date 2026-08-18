/** Copy dictionaries for the Skills management feature (popover + section). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.skills'

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Skills',
  popoverTrigger: 'Skills',
  manageAll: 'Manage all',
  emptyState: 'No ordinary session. Select or start a session to see its skills.',
  live: 'Live',
  standing: 'Standing (cold composition)',
  context: '{session} · {fidelity}',
  searchPlaceholder: 'Search skills, providers, roots…',
  selected: 'Active',
  shadowed: 'Shadowed by {winner}',
  withinLayer: 'within the same layer',
  crossLayer: 'across layers',
  modelInvocable: 'Model',
  userInvocable: 'User',
  source: 'Source',
  provider: 'Provider',
  layer: 'Layer',
  diagnostics: 'Diagnostics',
  diagnosticCount: '{count} diagnostic(s)',
  incomplete: 'Discovery was incomplete; some skills may be missing.',
  retry: 'Retry',
  followCurrent: 'Follow current session',
  failedToLoad: 'Loading the skills snapshot failed',
  noSkills: 'No skills found for this session.',
  origin: 'Origin',
  rank: 'rank {rank}',
  relative: '{path}',
  close: 'Close',
}
export type SkillsKey = keyof typeof en

/** Simplified-Chinese strings (key set must mirror `en` exactly). */
export const zh: Record<SkillsKey, string> = {
  nav: '技能',
  popoverTrigger: '技能',
  manageAll: '管理全部',
  emptyState: '没有普通会话。请选择或开始一个会话以查看其技能。',
  live: '实况',
  standing: '静止（冷组合）',
  context: '{session} · {fidelity}',
  searchPlaceholder: '搜索技能、提供方、根…',
  selected: '生效',
  shadowed: '被 {winner} 遮蔽',
  withinLayer: '同层内',
  crossLayer: '跨层',
  modelInvocable: '模型',
  userInvocable: '用户',
  source: '来源',
  provider: '提供方',
  layer: '层',
  diagnostics: '诊断',
  diagnosticCount: '{count} 条诊断',
  incomplete: '发现未完成，某些技能可能缺失。',
  retry: '重试',
  followCurrent: '跟随当前会话',
  failedToLoad: '加载技能快照失败',
  noSkills: '该会话未找到技能。',
  origin: '来源',
  rank: 'rank {rank}',
  relative: '{path}',
  close: '关闭',
}
