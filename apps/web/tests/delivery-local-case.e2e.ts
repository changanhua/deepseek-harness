// Human-only workflow over the real Web/Delivery composition. No model call
// or Session transcript participates: the golden records the contract form.
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type Delivery from '@changanhua/dsh-delivery'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode,
} from './scaffold.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE } from './support.ts'

const run = promisify(execFile)

it.each(['git-blob', 'contract-field'] as const)('creates a ready local Case and immutable Packet through the browser using %s on a master repository', async (sourceKind) => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(REPO_ROOT, 'packages/bundle/personal-delivery/cordis.patch.yml'),
    extraInstallAnchors: [join(REPO_ROOT, 'packages/bundle/personal-delivery/package.json')],
  })
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, locale: ZH_BROWSER_LOCALE })
    const repository = scaffold.workspaceCwd
    const git = (...args: string[]) => run('git', ['-C', repository, ...args], { windowsHide: true })
    await git('init', '--initial-branch=master')
    await git('config', 'user.name', 'Delivery Browser Test')
    await git('config', 'user.email', 'browser@example.invalid')
    await mkdir(join(repository, 'checks'))
    await writeFile(join(repository, 'checks', 'local.json'), JSON.stringify({
      format: 'delivery-verification-plan@1',
      checks: [{ id: 'node-version', name: 'Node version', argv: ['node', '--version'], cwd: '.', timeoutMs: 5000, severity: 'required', expectedExitCodes: [0] }],
    }))
    await git('add', 'checks/local.json')
    await git('commit', '-m', 'verification plan')
    const baseCommit = (await git('rev-parse', 'HEAD')).stdout.trim()
    const login = await page.context().request.get(scaffold.authenticatedUrl, { maxRedirects: 0 })
    expect(login.status()).toBe(303)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '交付', exact: true }).click()
    await page.getByRole('textbox', { name: '需求想法', exact: true }).fill('验证本地交付入口')
    await page.getByRole('button', { name: '保存到本地', exact: true }).click()
    await page.getByText('交付 Case 已创建。', { exact: true }).waitFor()
    const frames = join(REPO_ROOT, '.playwright-mcp', 'delivery-local-case', sourceKind)
    await mkdir(frames, { recursive: true })
    await page.screenshot({ path: join(frames, '00-draft.png') })
    await page.locator('summary').filter({ hasText: /^完善推进条件（可选）$/u }).click()
    const form = page.getByRole('form', { name: '完善推进条件（可选）', exact: true })
    await form.getByRole('textbox', { name: '期望结果', exact: true }).fill('创建一个具备可执行验证计划的本地工作包。')
    await form.getByRole('textbox', { name: '允许范围（每行一个）', exact: true }).fill('checks')
    await form.getByRole('textbox', { name: '验收条件（每行一个）', exact: true }).fill('验证计划绑定 master 的当前提交。')
    await form.getByRole('combobox', { name: '基础版本类型', exact: true }).selectOption('ref-head')
    await form.getByRole('textbox', { name: '分支或引用', exact: true }).fill('refs/heads/master')
    await form.getByRole('combobox', { name: '验证来源', exact: true }).selectOption(sourceKind)
    if (sourceKind === 'git-blob') {
      await form.getByRole('textbox', { name: '验证计划路径', exact: true }).fill('checks/local.json')
    } else {
      await form.getByRole('button', { name: '添加检查', exact: true }).click()
      await form.getByRole('textbox', { name: '检查名称', exact: true }).fill('Node version')
      await form.getByRole('textbox', { name: '检查程序', exact: true }).fill('node')
      await form.getByRole('textbox', { name: '检查参数（每行一个）', exact: true }).fill('--version')
      await form.getByRole('textbox', { name: '超时（毫秒）', exact: true }).fill('5000')
    }
    const aria = await captureStableAria(page, 'form[aria-label="完善推进条件（可选）"]', repository)
    await compareOrRefreshGolden(join(REPO_ROOT, 'apps/web/tests/expected/delivery-local-case', sourceKind === 'git-blob' ? 'ready.expected.md' : 'inline.expected.md'), aria, webSnapshotMode())
    await page.screenshot({ path: join(frames, '01-ready-form.png') })
    await form.getByRole('button', { name: '保存新修订', exact: true }).click()
    await page.getByText('Case 修订已保存。', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: '决定原因', exact: true }).fill('已确认范围、基线与验证计划。')
    await page.getByRole('button', { name: '批准当前修订', exact: true }).click()
    await page.getByText('需求决定已记录。', { exact: true }).waitFor()
    const packetForm = page.getByRole('form', { name: '创建工作包', exact: true })
    await packetForm.getByRole('textbox', { name: '允许路径（每行一个）', exact: true }).fill('checks')
    await packetForm.getByRole('button', { name: '创建工作包', exact: true }).click()
    await page.getByText('工作包已创建。', { exact: true }).waitFor()
    const delivery = scaffold.ctx.get('delivery') as Delivery
    const snapshot = delivery.snapshot()
    expect(snapshot.workPackets).toHaveLength(1)
    expect(snapshot.workPackets[0]).toMatchObject({
      baseCommit,
      verificationPlan: { provenance: { kind: sourceKind }, checks: [{ argv: ['node', '--version'] }] },
    })
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: '交付', exact: true }).click()
    await page.getByText('创建一个具备可执行验证计划的本地工作包。', { exact: true }).first().waitFor()
    expect(delivery.snapshot().workPackets).toHaveLength(1)
    await page.screenshot({ path: join(frames, '02-packet.png') })
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})
