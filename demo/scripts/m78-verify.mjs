// Scratch M7+M8 verification (not committed): jump-to-item + debugger.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
const check = (label, ok, extra = '') => console.log(`${label}: ${ok ? 'PASS' : 'FAIL'} ${extra}`)
const st = () => page.evaluate(() => window.__vlist.state())

await page.goto(url)
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(1800)

// ---------- M8: panel present with all the pieces ----------
check('debug panel mounted', await page.$('.dbg'))
check('minimap canvas present', await page.$('.minimap'))
check('log list present', await page.$('.dbg-log-list'))
const toggles = await page.evaluate(() =>
  [...document.querySelectorAll('.dbg-controls label')].map((l) => l.textContent.trim()),
)
console.log('  toggles:', JSON.stringify(toggles))

// ---------- M7: jump to #1 ----------
let s = await st()
const t0 = Date.now()
await page.evaluate(() => window.__vlist.jump(0))
await page.waitForFunction(
  () => window.__vlist.state().metrics?.timeToItem1 != null,
  undefined,
  { timeout: 8000 },
)
await page.waitForTimeout(300)
s = await st()
const row1 = await page.evaluate(() => {
  const el = document.querySelector('[data-vrow="0"]')
  const scr = document.querySelector('.vlist')
  return el ? el.getBoundingClientRect().top - scr.getBoundingClientRect().top : null
})
check(
  'jump to #1 lands it at viewport top',
  row1 !== null && Math.abs(row1) < 200,
  `top=${row1?.toFixed(1)} tti1=${s.metrics.timeToItem1}ms`,
)
check('timeToItem1 < 1500ms', s.metrics.timeToItem1 < 1500, `${s.metrics.timeToItem1}ms`)
check('jump left bottom => free mode', s.mode === 'free', `mode=${s.mode}`)

// ---------- jump to a random middle row ----------
await page.evaluate(() => window.__vlist.jump(123456))
await page.waitForTimeout(1500)
s = await st()
const mid = await page.evaluate(() => {
  const el = document.querySelector('[data-vrow="123456"]')
  const scr = document.querySelector('.vlist')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const t = scr.getBoundingClientRect()
  return { top: r.top - t, loaded: el.classList.contains('row-loaded') }
})
check('jump(123456) mounts + loads target', mid !== null && mid.loaded, JSON.stringify(mid))
check('jump_usable logged for mid jump', s.metrics.lastJumpMs !== null, `lastJumpMs=${s.metrics.lastJumpMs}`)

// ---------- jump to latest => pinned ----------
await page.evaluate(() => window.__vlist.jumpToLatest())
await page.waitForTimeout(500)
s = await st()
const dist = await page.evaluate(() => {
  const el = document.querySelector('.vlist')
  return el.scrollHeight - el.clientHeight - el.scrollTop
})
check('jumpToLatest => pinned at bottom', s.mode === 'pinned' && dist <= 4, `dist=${dist.toFixed(1)}`)

// ---------- UI controls drive the same path ----------
await page.click('.vlist-controls button:first-child') // "top #1"
await page.waitForTimeout(1200)
const top1 = await page.evaluate(() => document.querySelector('[data-vrow="0"]') !== null)
check('"top #1" button jumps', top1)

// ---------- debug flags: row overlays + anchor outline ----------
await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.dbg-controls label')]
  for (const l of labels) {
    if (l.textContent.includes('row overlays') || l.textContent.includes('anchor outline'))
      l.querySelector('input').click()
  }
})
await page.waitForTimeout(300)
check('row overlay class applied', await page.$('.vlist.dbg-index'))
check('anchor row highlighted', await page.$('.row.anchor-hl'))

// ---------- log has the spec'd event vocabulary ----------
const vocab = await page.evaluate(() => {
  const names = new Set(window.__vlist.log().map((e) => e.event))
  return [...names]
})
console.log('  events seen:', JSON.stringify(vocab))
for (const ev of ['scroll', 'load_landed', 'anchor_picked', 'jump', 'jump_usable', 'mode_change'])
  check(`log has '${ev}'`, vocab.includes(ev))

// ---------- filter input narrows the log list ----------
await page.fill('.dbg-log-head input', 'jump')
await page.waitForTimeout(200)
const shown = await page.evaluate(() =>
  [...document.querySelectorAll('.dbg-ev-name')].map((e) => e.textContent),
)
check('log filter works', shown.length > 0 && shown.every((n) => n.includes('jump')), `${shown.length} rows`)

// ---------- metrics snapshot sane ----------
s = await st()
console.log('  metrics:', JSON.stringify(s.metrics))
check('ttfr recorded', typeof s.metrics.ttfr === 'number' && s.metrics.ttfr < 3000)
const mounted = await page.evaluate(() => document.querySelectorAll('[data-vrow]').length)
check('mounted rows < 300', mounted < 300, `${mounted}`)
console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
