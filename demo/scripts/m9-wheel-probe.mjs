// Scratch probe: wheel-up stability run, capture drift series + event log at spikes.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)))

await page.goto(url)
await page.waitForSelector('.vlist-inner', { timeout: 10000 })
await page.waitForFunction(() => window.__vlist?.state().loadedCount > 0, undefined, { timeout: 10000 })
await page.waitForTimeout(800)

await page.evaluate(() => window.__vlist.setOpts({ latency: [400, 400] }))

// jump to middle
await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight / 2
})
await page.waitForTimeout(1800)

// install sampler (same as spec)
await page.evaluate(() => {
  const track = (window.__track = { anchor: null, top: 0, expected: 0 })
  window.__maxDrift = 0
  window.__series = []
  window.__sampler = setInterval(() => {
    const scroller = document.querySelector('.vlist')
    const vpTop = scroller.getBoundingClientRect().top
    const vpBot = vpTop + scroller.clientHeight
    let firstVisible = null, anchor = null
    for (const r of document.querySelectorAll('[data-vrow]')) {
      const rc = r.getBoundingClientRect()
      if (rc.bottom <= vpTop || rc.top >= vpBot) continue
      if (firstVisible === null) firstVisible = r
      if (r.classList.contains('row-loaded')) { anchor = r; break }
    }
    anchor ??= firstVisible
    if (!anchor) return
    const idx = anchor.dataset.vrow
    const t = performance.now()
    const push = (d, tag) => {
      if (d > window.__maxDrift) window.__maxDrift = d
      window.__series.push({ t, a: idx, d: Math.round(d), tag, st: Math.round(scroller.scrollTop) })
    }
    if (track.anchor === null) { track.anchor = idx; track.top = anchor.getBoundingClientRect().top; push(0, 'init'); return }
    if (track.anchor !== idx) {
      const old = document.querySelector(`[data-vrow="${track.anchor}"]`)
      if (old) push(Math.abs(old.getBoundingClientRect().top - (track.top + track.expected)), 'sw-out:' + track.anchor)
      track.anchor = idx; track.top = anchor.getBoundingClientRect().top; track.expected = 0
      window.__series.push({ t, a: idx, d: 0, tag: 'sw-in', st: Math.round(scroller.scrollTop) })
      return
    }
    push(Math.abs(anchor.getBoundingClientRect().top - (track.top + track.expected)), 'same')
  }, 20)
})

await page.hover('.vlist')
for (let k = 0; k < 30; k++) {
  const before = await page.evaluate(() => document.querySelector('.vlist').scrollTop)
  await page.mouse.wheel(0, -220)
  await page.waitForTimeout(350)
  await page.evaluate((prev) => {
    const st = document.querySelector('.vlist').scrollTop
    window.__track.expected += st - prev
  }, before)
}
await page.waitForTimeout(1600)

const res = await page.evaluate(() => {
  clearInterval(window.__sampler)
  return { maxDrift: window.__maxDrift, series: window.__series }
})
console.log('maxDrift', res.maxDrift)
// print samples around big drifts
const big = res.series.filter((s) => s.d > 100)
console.log('big drift samples:', JSON.stringify(big.slice(0, 20)))
if (big.length) {
  const t0 = big[0].t
  const win = res.series.filter((s) => s.t >= t0 - 200 && s.t <= t0 + 400)
  console.log('series around first spike:', JSON.stringify(win))
  const events = await page.evaluate(([a, b]) => window.__vlist.log().filter((e) => e.t >= a && e.t <= b), [
    performance.timeOrigin + t0 - 300,
    performance.timeOrigin + t0 + 600,
  ])
  console.log(
    'events around spike:',
    JSON.stringify(
      events.map((e) => ({
        dt: Math.round(e.t - performance.timeOrigin - t0),
        ev: e.event,
        ...(e.anchor ? { anchor: e.anchor.id, kind: e.anchor.kind } : {}),
        ...(e.deltaApplied !== undefined ? { d: Math.round(e.deltaApplied) } : {}),
        ...(e.scrollTopAfter !== undefined ? { st: Math.round(e.scrollTopAfter) } : {}),
        ...(e.scrollTop !== undefined ? { st: Math.round(e.scrollTop) } : {}),
        ...(e.count !== undefined ? { n: e.count } : {}),
      })),
    ),
  )
}
await browser.close()
