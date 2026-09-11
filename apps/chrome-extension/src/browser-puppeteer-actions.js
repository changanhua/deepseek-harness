const failure = code => Object.assign(new Error(code), { code })
const MAX_SCREENSHOT_BASE64 = 1_500_000
const SCREENSHOT_QUALITIES = [55, 45, 35, 25, 15]

/** Execute one already-reserved action. Returned facts acknowledge the primitive, not the user's whole task. */
export const performPuppeteerAction = async ({ action, handle, frame, page, chromeApi, targetPage, check, resolveDrop, authorizeUrl }) => {
  check()
  if (action.kind === 'click') { await handle.click(); return null }
  if (action.kind === 'double_click') { await handle.click({ count: 2 }); return { input: 'double_click' } }
  if (action.kind === 'right_click') { await handle.click({ button: 'right' }); return { input: 'right_click' } }
  if (action.kind === 'hover') { await handle.hover(); return { input: 'hover' } }
  if (action.kind === 'press') {
    await handle.focus(); check()
    const keys = action.key.split('+'), key = keys.pop()
    if (!key || keys.some(key => !['Control', 'Meta', 'Alt', 'Shift'].includes(key))) throw failure('invalid_key')
    for (const modifier of keys) await page.keyboard.down(modifier)
    try { await page.keyboard.press(key) }
    finally { for (const modifier of keys.reverse()) await page.keyboard.up(modifier) }
    return { input: 'press' }
  }
  if (action.kind === 'fill') {
    await handle.focus(); check()
    const modifier = (await chromeApi.runtime.getPlatformInfo()).os === 'mac' ? 'Meta' : 'Control'
    await page.keyboard.down(modifier)
    await page.keyboard.press('a')
    await page.keyboard.up(modifier); check()
    if (action.value) await page.keyboard.sendCharacter(action.value)
    else await page.keyboard.press('Backspace')
    return null
  }
  if (action.kind === 'select') {
    const selected = await handle.select(...action.values)
    if (selected.length !== action.values.length || action.values.some(value => !selected.includes(value))) throw failure('selection_unverified')
    return { selectionSet: true }
  }
  if (action.kind === 'check') {
    if (await handle.evaluate(node => node.checked) !== action.checked) await handle.click()
    if (await handle.evaluate(node => node.checked) !== action.checked) throw failure('checked_state_unverified')
    return { checked: action.checked }
  }
  if (action.kind === 'upload') {
    await handle.uploadFile(...action.files)
    const count = await handle.evaluate(node => node.files?.length)
    if (count !== action.files.length) throw failure('upload_unverified')
    return { filesSelected: count }
  }
  if (action.kind === 'drag') {
    const drop = await resolveDrop()
    try {
      await drop.scrollIntoView(); check()
      await page.setDragInterception(true)
      await handle.dragAndDrop(drop, { delay: 100 })
      return { input: 'drag' }
    } finally { await drop.dispose() }
  }
  if (action.kind === 'submit') {
    const submitted = await handle.evaluate(node => {
      const form = node.form ?? node.closest('form')
      if (!form || !form.noValidate && !node.formNoValidate && !form.checkValidity()) return false
      form.requestSubmit(node.type === 'submit' || node.type === 'image' ? node : undefined)
      return true
    })
    if (!submitted) throw failure('form_invalid')
    return { formSubmitted: true }
  }
  if (action.kind === 'scroll') {
    return frame.evaluate(({ x, y }) => { scrollTo(x, y); return { x: scrollX, y: scrollY } }, action)
  }
  if (action.kind === 'wait') {
    const end = Date.now() + action.milliseconds
    while (Date.now() < end) { check(); await new Promise(resolve => setTimeout(resolve, Math.min(50, end - Date.now()))) }
    return { waited: action.milliseconds }
  }
  if (action.kind === 'screenshot') {
    if (targetPage.frameId !== 0) throw failure('main_frame_required')
    let data
    for (const quality of SCREENSHOT_QUALITIES) {
      data = await page.screenshot({ type: 'jpeg', quality, encoding: 'base64' })
      if (data.length <= MAX_SCREENSHOT_BASE64) break
    }
    if (data.length > MAX_SCREENSHOT_BASE64) throw failure('screenshot_too_large')
    return { screenshot: { data, mimeType: 'image/jpeg' } }
  }
  if (action.kind === 'navigate') {
    await frame.goto(action.url, { waitUntil: 'domcontentloaded' })
    return { documentReplaced: true, navigated: true }
  }
  if (['back', 'forward', 'reload', 'tab_open', 'tab_close', 'tab_focus'].includes(action.kind) && targetPage.frameId !== 0) throw failure('main_frame_required')
  if (['back', 'forward', 'reload'].includes(action.kind)) {
    if (action.kind !== 'reload') {
      const history = await frame.client.send('Page.getNavigationHistory')
      const target = history.entries[history.currentIndex + (action.kind === 'back' ? -1 : 1)]
      if (!target) return { navigated: false }
      await authorizeUrl(target.url); check()
    }
    const response = await page[{ back: 'goBack', forward: 'goForward', reload: 'reload' }[action.kind]]({ waitUntil: 'domcontentloaded' })
    return response ? { documentReplaced: true, navigated: true } : { navigated: false }
  }
  if (action.kind === 'tab_open') {
    const tab = await chromeApi.tabs.create({ url: action.url, active: true })
    return { tabId: tab.id, opened: true }
  }
  if (action.kind === 'tab_close') {
    await chromeApi.tabs.remove(targetPage.tabId)
    return { documentReplaced: true, closed: true }
  }
  if (action.kind === 'tab_focus') {
    await chromeApi.tabs.update(targetPage.tabId, { active: true })
    return { focused: true }
  }
  throw failure('unsupported_action')
}
