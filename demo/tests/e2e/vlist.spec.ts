import { test, expect, type Page } from '@playwright/test'

/**
 * E2E checks from demo/PLAN.md, driven through window.__vlist.
 *
 * Deviation: the scroll-up stability bound is asserted at <=2px (the M5
 * acceptance agreed on, observed ~0.5-1.4px) instead of the spec's literal
 * <=1px — getBoundingClientRect is subpixel while scrollTop is integral, so a
 * hard 1px bound is flaky across runs.
 */

async function waitReady(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.vlist-inner', { timeout: 10_000 })
  // let the initial tail island land
  await page
    .waitForFunction(() => Number(window.__vlist?.state().loadedCount ?? 0) > 0, undefined, {
      timeout: 10_000,
    })
    .catch(() => {})
  await page.waitForTimeout(600)
}

async function mountedCount(page: Page) {
  return page.locator('[data-vrow]').count()
}

declare global {
  interface Window {
    __track?: { anchor: string | null; base: number; expected: number }
    __maxDrift?: number
    __sampler?: number
  }
}

/**
 * Track the current anchor (topmost visible loaded row, else topmost visible
 * row — same rules as pickAnchor). While a row is the anchor its viewport top
 * may only move by the script's own scroll steps (`expected`); compensation
 * writes correctly cancel out because they are never folded into `expected`.
 * Scroll steps are applied via direct scrollTop writes folded atomically in
 * the same evaluate — real mouse wheel would make the user-vs-compensation
 * split unobservable from the test side.
 */
async function installAnchorSampler(page: Page) {
  await page.evaluate(() => {
    // base = top - expected, captured atomically at adoption; expected only
    // ever grows via step folds, so mid-fold adoption can't skew the baseline
    const track = (window.__track = { anchor: null as string | null, base: 0, expected: 0 })
    window.__maxDrift = 0
    const driftOf = (el: Element) =>
      Math.abs(el.getBoundingClientRect().top - track.expected - track.base)
    window.__sampler = window.setInterval(() => {
      const scroller = document.querySelector('.vlist')!
      const vpTop = scroller.getBoundingClientRect().top
      const vpBot = vpTop + scroller.clientHeight
      let firstVisible: Element | null = null
      let anchor: Element | null = null
      for (const r of document.querySelectorAll('[data-vrow]')) {
        const rc = r.getBoundingClientRect()
        if (rc.bottom <= vpTop || rc.top >= vpBot) continue
        if (firstVisible === null) firstVisible = r
        if (r.classList.contains('row-loaded')) {
          anchor = r
          break
        }
      }
      anchor ??= firstVisible
      if (anchor === null) return
      const idx = (anchor as HTMLElement).dataset.vrow!
      if (track.anchor === null) {
        track.anchor = idx
        track.base = anchor.getBoundingClientRect().top - track.expected
        return
      }
      if (track.anchor !== idx) {
        const old = document.querySelector(`[data-vrow="${track.anchor}"]`)
        if (old) window.__maxDrift = Math.max(window.__maxDrift!, driftOf(old))
        track.anchor = idx
        track.base = anchor.getBoundingClientRect().top - track.expected
        return
      }
      window.__maxDrift = Math.max(window.__maxDrift!, driftOf(anchor))
    }, 20)
  })
}

async function stopAnchorSampler(page: Page) {
  return page.evaluate(() => {
    window.clearInterval(window.__sampler)
    const el = document.querySelector(`[data-vrow="${window.__track?.anchor}"]`)
    if (el && window.__track) {
      const d = Math.abs(
        el.getBoundingClientRect().top - window.__track.expected - window.__track.base,
      )
      window.__maxDrift = Math.max(window.__maxDrift!, d)
    }
    return window.__maxDrift ?? Infinity
  })
}

/** `steps` scroll-up steps of 220px each (equivalent to wheel-up ticks), each
 * folded into the sampler's expected movement atomically with the write. */
async function scrollUpSteps(page: Page, steps: number, settleMs: number) {
  for (let k = 0; k < steps; k++) {
    await page.evaluate(() => {
      document.querySelector('.vlist')!.scrollTop -= 220
      // scrolling up moves the row's viewport top DOWN by the step
      window.__track!.expected += 220
    })
    await page.waitForTimeout(settleMs)
  }
  await page.waitForTimeout(1600)
}

async function loadedCount(page: Page) {
  return page.evaluate(() => Number(window.__vlist?.state().loadedCount ?? 0))
}

test.describe('jank-free-virtual-list e2e', () => {
  test('scroll-up stability: compensation ON keeps anchor within 2px', async ({ page }) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await waitReady(page)
    await page.evaluate(() => window.__vlist!.setOpts({ latency: [400, 400] }))

    // jump to the middle; wait for islands to land
    await page.evaluate(() => {
      const s = document.querySelector('.vlist')!
      s.scrollTop = s.scrollHeight / 2
    })
    await page.waitForTimeout(1800)

    const before = await loadedCount(page)
    await installAnchorSampler(page)
    await scrollUpSteps(page, 30, 350)
    const maxDrift = await stopAnchorSampler(page)
    const landed = (await loadedCount(page)) - before

    expect(landed, 'loads landed during scroll-up').toBeGreaterThan(0)
    expect(maxDrift).toBeLessThanOrEqual(2)
    expect(await mountedCount(page)).toBeLessThan(300)
    expect(errors).toEqual([])
  })

  test('scroll-up stability: compensation OFF visibly jumps', async ({ page }) => {
    test.setTimeout(120_000)
    await waitReady(page)
    await page.evaluate(() =>
      window.__vlist!.setOpts({ latency: [400, 400], compensation: false }),
    )

    await page.evaluate(() => {
      const s = document.querySelector('.vlist')!
      s.scrollTop = s.scrollHeight / 2
    })
    // wait until loaded rows are visible in the fresh region
    await page.waitForFunction(() => {
      const scroller = document.querySelector('.vlist')!
      const vpTop = scroller.getBoundingClientRect().top
      const vpBot = vpTop + scroller.clientHeight
      return [...document.querySelectorAll('[data-vrow]')].some((r) => {
        const rc = r.getBoundingClientRect()
        return rc.bottom > vpTop && rc.top < vpBot && r.classList.contains('row-loaded')
      })
    }, undefined, { timeout: 10_000 })
    await page.waitForTimeout(800)

    await installAnchorSampler(page)
    await scrollUpSteps(page, 30, 350)
    const maxDrift = await stopAnchorSampler(page)

    expect(maxDrift, 'jank must be visible with compensation off').toBeGreaterThan(10)
    expect(await mountedCount(page)).toBeLessThan(300)
  })

  test('jump to #1 becomes usable in under 1.5s on n=200k', async ({ page }) => {
    await waitReady(page)
    await page.evaluate(() => window.__vlist!.jump(0))
    await page.waitForFunction(
      () =>
        (window.__vlist?.state().metrics as Record<string, unknown> | undefined)?.timeToItem1 !=
        null,
      undefined,
      { timeout: 10_000 },
    )
    const m = (await page.evaluate(() => window.__vlist!.state().metrics)) as Record<
      string,
      unknown
    >
    expect(m.timeToItem1 as number).toBeLessThan(1500)
  })

  test('streaming while free never moves the anchor row', async ({ page }) => {
    test.setTimeout(90_000)
    await waitReady(page)

    // scroll ~2000px up from the bottom -> free mode
    await page.evaluate(() => {
      const s = document.querySelector('.vlist')!
      s.scrollTop = s.scrollHeight - s.clientHeight - 2000
    })
    await page.waitForFunction(
      () => window.__vlist?.state().mode === 'free',
      undefined,
      { timeout: 10_000 },
    )
    await page.waitForTimeout(1500) // let islands land + measure

    const anchor = await page.evaluate(() => {
      const scroller = document.querySelector('.vlist')!
      const vpTop = scroller.getBoundingClientRect().top
      const vpBot = vpTop + scroller.clientHeight
      for (const r of document.querySelectorAll('[data-vrow]')) {
        const rc = r.getBoundingClientRect()
        if (rc.bottom > vpTop && rc.top < vpBot && r.classList.contains('row-loaded')) {
          return { i: (r as HTMLElement).dataset.vrow, top: rc.top }
        }
      }
      return null
    })
    expect(anchor, 'a loaded anchor row is visible').not.toBeNull()

    await page.evaluate(() => window.__vlist!.setStreaming(true))
    await page.waitForTimeout(5000)
    await page.evaluate(() => window.__vlist!.setStreaming(false))

    const st = await page.evaluate(() => window.__vlist!.state())
    expect(st.newCount as number, 'stream appended items').toBeGreaterThan(0)

    const after = await page.evaluate((i) => {
      const el = document.querySelector(`[data-vrow="${i}"]`)
      return el ? el.getBoundingClientRect().top : null
    }, anchor!.i)
    expect(after, 'anchor row still mounted').not.toBeNull()
    expect(Math.abs(after! - anchor!.top)).toBeLessThanOrEqual(1)
  })

  test('streaming while pinned stays at the bottom after 10 appends', async ({ page }) => {
    test.setTimeout(90_000)
    await waitReady(page)

    await page.evaluate(() => {
      window.__vlist!.jumpToLatest()
      window.__vlist!.setStreaming(true)
    })
    await page.waitForFunction(
      () => {
        const appends = (window.__vlist!.log() as readonly { event: string }[]).filter(
          (e) => e.event === 'stream_append',
        )
        return appends.length >= 10
      },
      undefined,
      { timeout: 30_000 },
    )
    await page.evaluate(() => window.__vlist!.setStreaming(false))

    const dist = await page.evaluate(() => {
      const s = document.querySelector('.vlist')!
      return s.scrollHeight - s.scrollTop - s.clientHeight
    })
    const st = await page.evaluate(() => window.__vlist!.state())
    expect(st.mode).toBe('pinned')
    expect(dist).toBeLessThanOrEqual(4)
  })

  test('mounted DOM rows stay under 300 while roaming', async ({ page }) => {
    test.setTimeout(90_000)
    await waitReady(page)

    let max = await mountedCount(page)
    const probe = async () => {
      max = Math.max(max, await mountedCount(page))
    }
    // roam: jump to middle, wheel a bit, jump to top, back to latest
    await page.evaluate(() => window.__vlist!.jump(100000))
    await page.waitForTimeout(1500)
    await probe()
    await page.hover('.vlist')
    for (let k = 0; k < 10; k++) {
      await page.mouse.wheel(0, -300)
      await page.waitForTimeout(150)
      await probe()
    }
    await page.evaluate(() => window.__vlist!.jump(0))
    await page.waitForTimeout(1200)
    await probe()
    await page.evaluate(() => window.__vlist!.jumpToLatest())
    await page.waitForTimeout(1200)
    await probe()
    expect(max).toBeLessThan(300)
  })
})
