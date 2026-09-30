// Scratch probe: spec-exact scrollTop-step run, dump drift series with tags.
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
await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight / 2
})
await page.waitForTimeout(1800)

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
    const rec = (a, d, tag, top) =>
      window.__series.push({ t: Math.round(t), a, d: Math.round(d * 100) / 100, tag, top: Math.round(top), st: Math.round(scroller.scrollTop), exp: track.expected })
    if (track.anchor === null) { track.anchor = idx; track.top = anchor.getBoundingClientRect().top; rec(idx, 0, 'init', track.top); return }
    if (track.anchor !== idx) {
      const old = document.querySelector(`[data-vrow="${track.anchor}"]`)
      if (old) rec(track.anchor, Math.abs(old.getBoundingClientRect().top - (track.top + track.expected)), 'sw-out', old.getBoundingClientRect().top)
      track.anchor = idx; track.top = anchor.getBoundingClientRect().top; track.expected = 0
      rec(idx, 0, 'sw-in', track.top)
      return
    }
    const d = Math.abs(anchor.getBoundingClientRect().top - (track.top + track.expected))
    if (d > window.__maxDrift) window.__maxDrift = d
    rec(idx, d, 'same', anchor.getBoundingClientRect().top)
  }, 20)
})

for (let k = 0; k < 30; k++) {
  await page.evaluate(() => {
    document.querySelector('.vlist').scrollTop -= 220
    window.__track.expected += 220
  })
  await page.waitForTimeout(350)
}
await page.waitForTimeout(1600)

const res = await page.evaluate(() => {
  clearInterval(window.__sampler)
  return { maxDrift: window.__maxDrift, series: window.__series }
})
console.log('maxDrift', res.maxDrift)
const big = res.series.filter((s) => s.d > 5)
console.log(`samples>5px: ${big.length}`)
for (const s of big.slice(0, 15)) console.log(JSON.stringify(s))
if (big.length) {
  const t0 = big[0].t
  console.log('context:')
  for (const s of res.series.filter((x) => x.t >= t0 - 300 && x.t <= t0 + 300)) console.log(' ', JSON.stringify(s))
}
await browser.close()
