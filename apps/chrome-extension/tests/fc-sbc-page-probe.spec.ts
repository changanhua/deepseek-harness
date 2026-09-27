/** @vitest-environment jsdom */
import { afterEach, describe, expect, test } from 'vitest'
import { probeFcSbcPage } from '../src/fc-sbc-page-probe.js'

const fcUrl = 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/'
const render = (html: string, title = 'FC Web App') => {
  document.title = title
  document.body.innerHTML = html
}

afterEach(() => { document.body.replaceChildren(); document.title = '' })

describe('FC SBC 只读页面探针', () => {
  test('真实 FC 27 登录视图不能当作已进入 SBC 的页面', () => {
    render(`
      <main class="ut-root-view">
        <div id="Login" class="ut-login">
          <button>登录</button><button>浏览更多</button>
        </div>
      </main>
    `, 'FC Ultimate Team Web App - EA SPORTS Official Site')

    const result = probeFcSbcPage({ href: fcUrl })

    expect(result).toMatchObject({
      loginRequired: true,
      supported: false,
      taskType: 'unknown',
      marketAccess: { status: 'unknown' },
      inventory: { coverage: 'unread' },
    })
    expect(result.warnings).toEqual(['login-required'])
  })

  test('按真实中文 FC 27 重大比赛布局读取四关与当前关要求', () => {
    render(`
      <main class="ut-root-view">
        <h1 class="title">重大比赛</h1>
        <div class="ut-sbc-challenges-view--challenges">
          <div class="ut-sbc-challenge-table-row-view selected"><h1 class="ut-sbc-challenge-table-row-view--title">意大利对比利时</h1><span>开始挑战</span></div>
          <div class="ut-sbc-challenge-table-row-view"><h1 class="ut-sbc-challenge-table-row-view--title">挪威对葡萄牙</h1><span>开始挑战</span></div>
          <div class="ut-sbc-challenge-table-row-view"><h1 class="ut-sbc-challenge-table-row-view--title">荷兰对德国</h1><span>开始挑战</span></div>
          <div class="ut-sbc-challenge-table-row-view"><h1 class="ut-sbc-challenge-table-row-view--title">英格兰对西班牙</h1><span>开始挑战</span></div>
        </div>
        <div class="ut-sbc-requirements-view">
          <header><h1>意大利对比利时</h1></header>
          <div class="ut-sbc-challenge-requirements-view">
            <h3>挑战要求</h3>
            <ul class="sbc-requirements-checklist">
              <li>意大利 或 比利时: 最少 1 名球员</li>
              <li>阵容中的俱乐部数量：最少 3 个</li>
              <li>白银: 最少 3 名球员</li>
              <li>球员品质： 至少 青铜</li>
              <li>总默契度：最低 14 点</li>
            </ul>
          </div>
          <div class="rewards-container"><span class="ut-sbc-reward-table-cell-view--label">x1 迷你黄金组合包</span></div>
        </div>
        <nav>转会</nav>
      </main>
    `, 'FC Ultimate Team Web App - EA SPORTS Official Site')

    const result = probeFcSbcPage({ href: fcUrl })

    expect(result).toMatchObject({ supported: true, loginRequired: false, taskType: 'puzzle',
      marketAccess: { status: 'unknown' }, inventory: { coverage: 'unread' },
      view: { kind: 'sbc-group', selectedChallenge: { title: '意大利对比利时', visibleIndex: 0 } },
      challengeSet: { title: '重大比赛', visibleChallengeCount: 4 } })
    expect(result.challengeSet.challenges.map(item => item.title)).toEqual([
      '意大利对比利时', '挪威对葡萄牙', '荷兰对德国', '英格兰对西班牙',
    ])
    expect(result.challengeSet.challenges[0]).toMatchObject({ challengeId: 'visible-1',
      requirementLines: ['意大利 或 比利时: 最少 1 名球员', '阵容中的俱乐部数量：最少 3 个',
        '白银: 最少 3 名球员', '球员品质： 至少 青铜', '总默契度：最低 14 点'],
      rewardLines: ['x1 迷你黄金组合包'] })
    expect(result.challengeSet.challenges.slice(1).every(item => item.requirementLines.length === 0)).toBe(true)
  })

  test('从已渲染的拼图 SBC 页面提取挑战、市场权限和可见库存线索', () => {
    render(`
      <main>
        <h1>Marquee Matchups SBC</h1>
        <section data-challenge-id="challenge-one" class="sbc-challenge">
          <h2>England v Spain</h2>
          <p>Requirements</p>
          <p>Min. 3 Players from England</p>
          <p>Min. Team Overall Rating: 79</p>
          <p>Min. Squad Chemistry: 20</p>
          <p>Reward: Small Gold Players Pack</p>
        </section>
        <section class="TransferMarket">Transfer Market Search Buy Now</section>
        <section aria-label="Club">
          <article data-card-id="item-1" class="player-card">82 John Example rare untradeable</article>
          <article data-card-id="item-2" class="player-card">79 Maria Example</article>
        </section>
        <p>SBC Storage has 2 duplicate items</p>
      </main>
    `)

    const result = probeFcSbcPage({ href: fcUrl, capturedAt: '2026-09-25T06:10:00.000Z' })

    expect(result).toMatchObject({
      supported: true,
      taskType: 'puzzle',
      marketAccess: { status: 'visible', evidence: ['buy-now-visible', 'transfer-market-visible'] },
      challengeSet: { visibleChallengeCount: 1, challenges: [{
        challengeId: 'challenge-one',
        title: 'England v Spain',
        completed: false,
      }] },
      inventory: { coverage: 'visible-only', sbcStorageVisible: true },
    })
    expect(result.challengeSet.challenges[0].requirementLines).toEqual(expect.arrayContaining([
      'Min. 3 Players from England',
      'Min. Team Overall Rating: 79',
      'Min. Squad Chemistry: 20',
    ]))
    expect(result.challengeSet.challenges[0].rewardLines).toContain('Reward: Small Gold Players Pack')
    expect(result.inventory.visibleCards).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: 'item-1', rating: 82, locked: true }),
      expect.objectContaining({ instanceId: 'item-2', rating: 79, locked: false }),
    ]))
  })

  test('识别 Item Score SBC 并标记为需要独立执行器', () => {
    render(`
      <main>
        <h1>Upgrade SBC</h1>
        <section class="sbc-challenge">
          <h2>Exchange Items</h2>
          <p>Item Score 12/20</p>
          <p>Submit Items to increase SBC Rating</p>
        </section>
      </main>
    `)

    const result = probeFcSbcPage({ href: fcUrl })

    expect(result).toMatchObject({ supported: true, taskType: 'item-score' })
    expect(result.warnings).toContain('item-score-sbc-requires-separate-executor')
  })

  test('市场权限阻断优先于普通市场文字', () => {
    render(`
      <main>
        <h1>Squad Building Challenges</h1>
        <section>Transfer Market access is not available yet. Earn access by playing.</section>
      </main>
    `)

    const result = probeFcSbcPage({ href: fcUrl })

    expect(result.marketAccess).toMatchObject({ status: 'blocked' })
    expect(result.marketAccess.evidence).toContain('blocked-text')
  })

  test('仓库只标记可见卡片，不推断完整库存', () => {
    render('<main><h1>SBC 仓库</h1><article data-card-id="card-1" class="player-card">82 Example</article></main>')
    const result = probeFcSbcPage({ href: fcUrl })
    expect(result.view).toMatchObject({ kind: 'sbc-storage', selectedChallenge: null })
    expect(result.inventory).toMatchObject({ coverage: 'visible-only', visibleCards: [{ instanceId: 'card-1' }] })
  })

  test('区分 SBC 列表和俱乐部页，未知页面不猜测', () => {
    render('<main><h1>阵容创建挑战</h1><div class="ut-sbc-sets-view"><article>重大比赛</article></div></main>')
    expect(probeFcSbcPage({ href: fcUrl }).view.kind).toBe('sbc-list')
    render('<main><h1>俱乐部</h1><article data-card-id="card-1" class="player-card">82 Example</article></main>')
    expect(probeFcSbcPage({ href: fcUrl }).view.kind).toBe('club')
    render('<main><h1>主页</h1></main>')
    expect(probeFcSbcPage({ href: fcUrl }).view.kind).toBe('unknown')
  })

  test('非 EA FC 页面不抛错但明确 unsupported，且不伪造库存覆盖', () => {
    render('<main><h1>普通页面</h1><p>Buy Now Search Challenge</p></main>', 'Other')

    const result = probeFcSbcPage({ href: 'https://example.test/not-fc' })

    expect(result).toMatchObject({
      supported: false,
      inventory: { coverage: 'unread', visibleCards: [] },
    })
    expect(result.warnings).toContain('unsupported-or-unrecognized-fc-page')
  })
})
