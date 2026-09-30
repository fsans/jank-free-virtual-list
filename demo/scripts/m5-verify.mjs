// Scratch M5 verification (not committed): island loading + compensation A/B.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const loadedCount = () =>
  page.evaluate(() => Number(document.querySelector('.vlist-status')?.textContent?.match(/(\d+) loaded/)?.[1] ?? 0))

async function pickAnchor() {
  return page.evaluate(() => {
    const scroller = document.querySelector('.vlist')
    const top = scroller.getBoundingClientRect().top
    for (const r of document.querySelectorAll('[data-vrow]')) {
      const rect = r.getBoundingClientRect()
      if (rect.bottom > top + 8 && rect.top < top + scroller.clientHeight - 8 && r.classList.contains('row-loaded')) {
        return { index: r.dataset.vrow, top: rect.top, scrollTop: scroller.scrollTop }
      }
    }
    return null
  })
}

/**
 * Scroll up in steps while tracking the CURRENT anchor (topmost visible
 * loaded row, re-evaluated per sample — it changes as landings load rows
 * above). While a given row is the anchor, its top may only move by the
 * script's own scroll steps; anything else is uncompensated drift (jank).
 * On anchor switch, the old anchor's final drift is measured first.
 */
async function stabilityRun(label) {
  await page.evaluate(() => {
    const track = (window.__track = { anchor: null, top: 0, expected: 0 })
    window.__maxDrift = 0
    window.__series = []
    const driftOf = (el, track) => Math.abs(el.getBoundingClientRect().top - (track.top + track.expected))
    window.__sampler = setInterval(() => {
      const scroller = document.querySelector('.vlist')
      const vpTop = scroller.getBoundingClientRect().top
      const vpBottom = vpTop + scroller.clientHeight
      // pickAnchor semantics: topmost visible LOADED row, else topmost visible row
      let firstLoaded = null
      let firstVisible = null
      for (const r of document.querySelectorAll('[data-vrow]')) {
        const rc = r.getBoundingClientRect()
        if (rc.bottom <= vpTop || rc.top >= vpBottom) continue
        if (firstVisible === null) firstVisible = r
        if (r.classList.contains('row-loaded')) {
          firstLoaded = r
          break
        }
      }
      const anchor = firstLoaded ?? firstVisible
      if (anchor === null) return
      const idx = anchor.dataset.vrow
      const t = Date.now()
      if (track.anchor === null) {
        track.anchor = idx
        track.top = anchor.getBoundingClientRect().top
        track.expected = 0
        window.__series.push({ t, a: idx, d: 0, reset: 'init' })
        return
      }
      if (track.anchor !== idx) {
        const oldEl = document.querySelector(`[data-vrow="${track.anchor}"]`)
        if (oldEl) {
          const d = driftOf(oldEl, track)
          if (d > window.__maxDrift) window.__maxDrift = d
          window.__series.push({ t, a: track.anchor, d, reset: 'switch-out' })
        }
        track.anchor = idx
        track.top = anchor.getBoundingClientRect().top
        track.expected = 0
        window.__series.push({ t, a: idx, d: 0, reset: 'switch-in' })
        return
      }
      const d = driftOf(anchor, track)
      if (d > window.__maxDrift) window.__maxDrift = d
      window.__series.push({ t, a: idx, d })
    }, 20)
  })
  const step = 200
  for (let k = 0; k < 3; k++) {
    await page.evaluate((s) => {
      document.querySelector('.vlist').scrollTop -= s
      window.__track.expected += s
    }, step)
    await page.waitForTimeout(650)
  }
  await page.waitForTimeout(1500)
  const res = await page.evaluate(() => {
    clearInterval(window.__sampler)
    const el = document.querySelector(`[data-vrow="${window.__track.anchor}"]`)
    if (el) {
      const d = Math.abs(el.getBoundingClientRect().top - (window.__track.top + window.__track.expected))
      if (d > window.__maxDrift) window.__maxDrift = d
    }
    return { maxDrift: window.__maxDrift, series: window.__series }
  })
  console.log(`${label}: maxDrift=${res.maxDrift.toFixed(2)}px`)
  if (label.includes('ON')) {
    console.log(
      'full series:',
      JSON.stringify(
        res.series.map((s) => ({
          t: s.t - res.series[0].t,
          a: Number(s.a) + 1,
          d: Math.round(s.d),
          ...(s.reset ? { r: s.reset } : {}),
        })),
      ),
    )
  }
  if (res.maxDrift > 2) {
    const bad = res.series.filter((s) => s.d > 2)
    console.log(
      `  drift>2px samples (${bad.length}):`,
      JSON.stringify(bad.slice(0, 12).map((s) => ({ t: s.t - res.series[0].t, a: Number(s.a) + 1, d: Math.round(s.d) }))),
    )
  }
  return res
}

await page.goto(url)
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(1500)

// 1. jump to the middle -> islands load there
await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight / 2
})
await page.waitForTimeout(1800)
const mid = await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  const rows = [...document.querySelectorAll('[data-vrow]')]
  const vis = rows.filter((r) => {
    const rc = r.getBoundingClientRect()
    const top = s.getBoundingClientRect().top
    return rc.bottom > top && rc.top < top + s.clientHeight
  })
  return {
    visible: vis.length,
    visibleLoaded: vis.filter((r) => r.classList.contains('row-loaded')).length,
    mounted: rows.length,
  }
})
console.log('== middle ==', JSON.stringify(mid))
console.log('islands loaded in view:', mid.visibleLoaded >= mid.visible * 0.7 ? 'PASS' : 'FAIL')

// 2. stability with compensation ON
const beforeOn = await loadedCount()
const onRun = await stabilityRun('comp ON ')
const driftOn = onRun.maxDrift
const afterOn = await loadedCount()
console.log(`loads landed during ON run: ${afterOn - beforeOn} (${afterOn - beforeOn > 0 ? 'PASS' : 'FAIL'})`)
console.log('ON drift <= 2px:', driftOn <= 2 ? 'PASS' : 'FAIL')

// 3. same procedure with compensation OFF -> must visibly jump
await page.click('.comp-toggle')
await page.waitForTimeout(300)
// move to a fresh region so new islands land during the OFF run
await page.evaluate(() => {
  document.querySelector('.vlist').scrollTop -= 2500
})
// wait until the fresh region has loaded rows visible again
await page
  .waitForFunction(() => {
    const scroller = document.querySelector('.vlist')
    const vpTop = scroller.getBoundingClientRect().top
    const vpBottom = vpTop + scroller.clientHeight
    return [...document.querySelectorAll('[data-vrow]')].some((r) => {
      const rc = r.getBoundingClientRect()
      return rc.bottom > vpTop && rc.top < vpBottom && r.classList.contains('row-loaded')
    })
  }, undefined, { timeout: 8000 })
  .catch(() => console.log('WARN: no loaded row became visible in the OFF region'))
await page.waitForTimeout(800)
const beforeOff = await loadedCount()
const offRun = await stabilityRun('comp OFF')
const driftOff = offRun.maxDrift
const afterOff = await loadedCount()
console.log(`loads landed during OFF run: ${afterOff - beforeOff} (${afterOff - beforeOff > 0 ? 'PASS' : 'FAIL'})`)
console.log('OFF drift > 10px (jank visible):', driftOff > 10 ? 'PASS' : 'FAIL')

await page.click('.comp-toggle') // restore ON

// diagnostics: log events during the ON run, correlated with drift samples
const events = await page.evaluate(() => (window.__vlist ? window.__vlist.log() : []))
const t0 = onRun.series[0]?.t ?? 0
const t1 = onRun.series[onRun.series.length - 1]?.t ?? 0
const inRun = events.filter((e) => e.t >= t0 - 300 && e.t <= t1 + 100)
console.log(
  'ON-run log events:',
  JSON.stringify(
    inRun.map((e) => ({
      dt: e.t - t0,
      event: e.event,
      ...('anchor' in e && e.anchor ? { anchor: e.anchor.id, kind: e.anchor.kind } : {}),
      ...('deltaApplied' in e ? { d: e.deltaApplied } : {}),
      ...('count' in e ? { n: e.count } : {}),
    })),
  ),
)

// model-vs-DOM consistency: fenwick offsetOf(i) vs actual DOM position of row i
const consistency = await page.evaluate(() => {
  const st = window.__vlist.state()
  const scroller = document.querySelector('.vlist')
  const scTop = scroller.getBoundingClientRect().top
  const rows = [...document.querySelectorAll('[data-vrow]')]
  return {
    topSpacer: Math.round(st.topSpacer),
    rows: rows.slice(0, 40).map((r) => {
      const i = Number(r.dataset.vrow)
      const domTop = r.getBoundingClientRect().top - scTop + scroller.scrollTop
      return {
        i,
        diff: Math.round((domTop - st.offsetOf(i)) * 10) / 10,
        h: r.offsetHeight,
        loaded: r.classList.contains('row-loaded') ? 1 : 0,
      }
    }),
  }
})
const bad = consistency.rows.filter((r) => Math.abs(r.diff) > 0.6)
console.log(
  `model-vs-DOM: topSpacer=${consistency.topSpacer}, mismatched rows=${bad.length}`,
  bad.length ? JSON.stringify(bad.slice(0, 10)) : '',
)

const final = await page.evaluate(() => ({
  mounted: document.querySelectorAll('[data-vrow]').length,
}))
console.log('mounted rows < 300:', final.mounted < 300 ? 'PASS' : `FAIL (${final.mounted})`)
console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
