// Scratch M6 verification (not committed): streaming, pinned/free mode,
// window-resize pin, async image decode via the RO path.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(url)
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(1500)

const st = () => page.evaluate(() => window.__vlist.state())
const distBottom = () =>
  page.evaluate(() => {
    const el = document.querySelector('.vlist')
    return el.scrollHeight - el.clientHeight - el.scrollTop
  })
const check = (label, ok, extra = '') => console.log(`${label}: ${ok ? 'PASS' : 'FAIL'} ${extra}`)

// ---------- 1. streaming while pinned: stays glued to the bottom ----------
let s = await st()
const n0 = s.n
check('starts pinned at bottom', s.mode === 'pinned' && (await distBottom()) <= 4, `mode=${s.mode}`)

await page.evaluate(() => window.__vlist.setStreaming(true))
await page.waitForTimeout(3500)
s = await st()
const d1 = await distBottom()
check(
  'pinned + stream: still at bottom, list grew',
  s.mode === 'pinned' && d1 <= 4 && s.n > n0,
  `mode=${s.mode} dist=${d1.toFixed(1)} n=${s.n} (+${s.n - n0})`,
)

// ---------- 2. scroll up => free; stream keeps anchor stable + pill counts ----------
await page.evaluate(() => {
  document.querySelector('.vlist').scrollTop -= 2500
})
await page.waitForTimeout(400)
s = await st()
check('scroll-up intent => free mode', s.mode === 'free', `mode=${s.mode}`)

const drift = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const scroller = document.querySelector('.vlist')
      const vpTop = scroller.getBoundingClientRect().top
      let anchorEl = null
      for (const r of document.querySelectorAll('[data-vrow]')) {
        const rc = r.getBoundingClientRect()
        if (rc.bottom > vpTop && rc.top < vpTop + scroller.clientHeight && r.classList.contains('row-loaded')) {
          anchorEl = r
          break
        }
      }
      if (!anchorEl) return resolve({ idx: null, maxDrift: 0 })
      const idx = anchorEl.dataset.vrow
      const top0 = anchorEl.getBoundingClientRect().top
      let maxDrift = 0
      const iv = setInterval(() => {
        const el = document.querySelector(`[data-vrow="${idx}"]`)
        if (!el) return
        const d = Math.abs(el.getBoundingClientRect().top - top0)
        if (d > maxDrift) maxDrift = d
      }, 30)
      setTimeout(() => {
        clearInterval(iv)
        resolve({ idx, maxDrift })
      }, 4000)
    }),
)
check('free + stream: anchor row never yanked', drift.maxDrift <= 2, `anchor=${drift.idx} maxDrift=${drift.maxDrift.toFixed(2)}px`)

s = await st()
check('"N new ↓" pill counted appends', s.newCount > 0, `newCount=${s.newCount}`)
const pill = await page.$('.new-pill')
check('pill rendered in DOM', pill !== null)

// ---------- 3. click the pill => pinned at bottom again ----------
if (pill) await pill.click()
else await page.evaluate(() => window.__vlist.jumpToLatest())
await page.waitForTimeout(600)
s = await st()
const d2 = await distBottom()
check('pill click => pinned at bottom, counter reset', s.mode === 'pinned' && d2 <= 4 && s.newCount === 0, `mode=${s.mode} dist=${d2.toFixed(1)}`)

// ---------- 4. window-width resize (text reflow) keeps the anchor ----------
await page.evaluate(() => {
  document.querySelector('.vlist').scrollTop -= 3000
})
await page.waitForTimeout(800)
await page.evaluate(() => {
  const scroller = document.querySelector('.vlist')
  const vpTop = scroller.getBoundingClientRect().top
  for (const r of document.querySelectorAll('[data-vrow]')) {
    const rc = r.getBoundingClientRect()
    if (rc.bottom > vpTop && rc.top < vpTop + scroller.clientHeight && r.classList.contains('row-loaded')) {
      window.__rz = { idx: r.dataset.vrow, top0: rc.top }
      return
    }
  }
})
await page.setViewportSize({ width: 860, height: 800 })
await page.waitForTimeout(1200)
const rz = await page.evaluate(() => {
  const el = document.querySelector(`[data-vrow="${window.__rz.idx}"]`)
  return el ? Math.abs(el.getBoundingClientRect().top - window.__rz.top0) : null
})
check('width resize 1280->860: anchor stays put', rz !== null && rz <= 3, `drift=${rz === null ? 'anchor unmounted' : rz.toFixed(2) + 'px'}`)
await page.setViewportSize({ width: 1280, height: 800 })
await page.waitForTimeout(600)

// ---------- 5. async image decode produced RO compensation traffic ----------
const counts = await page.evaluate(() => {
  const log = window.__vlist.log()
  const c = {}
  for (const e of log) c[e.event] = (c[e.event] ?? 0) + 1
  return c
})
console.log('event counts:', JSON.stringify(counts))
check('resize_observed fired (image decode / reflow deltas)', (counts.resize_observed ?? 0) > 0)
check('stream_append events logged', (counts.stream_append ?? 0) > 0)
check('mode_change events logged', (counts.mode_change ?? 0) >= 2)

const fin = await st()
check('mounted rows < 300', (await page.evaluate(() => document.querySelectorAll('[data-vrow]').length)) < 300)
console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
