import { describe, expect, it } from 'vitest'
import { absorbIslets, BUFFER_VIEWPORTS, MAX_GROUP_SIZE, planLoad, planTail } from '../../src/list/planner'

/** Deterministic uniform-height source: `h` px per row. */
function uniform(n: number, h: number) {
  return {
    n,
    offsetOf: (i: number) => Math.max(0, Math.min(i, n)) * h,
    heightOf: () => h,
    indexAtOffset: (px: number) => (px <= 0 ? 0 : Math.max(0, Math.min(Math.floor(px / h), n - 1))),
  }
}

const none = {
  isLoaded: () => false,
  isInflight: () => false,
}

describe('planLoad', () => {
  it('buffers 1.5 viewports in the scroll direction, 0.5 opposite', () => {
    const u = uniform(1000, 100) // rows of 100px, viewport 800px = 8 rows
    // visible rows [100, 103]
    const up = planLoad({ ...u, ...none, visibleStart: 100, visibleEnd: 103, direction: -1, viewportPx: 800 })
    expect(up.start).toBe(88) // 1200px above
    expect(up.end).toBe(108) // 400px below

    const down = planLoad({ ...u, ...none, visibleStart: 100, visibleEnd: 103, direction: 1, viewportPx: 800 })
    expect(down.start).toBe(96) // 400px above
    expect(down.end).toBe(116) // 1200px below

    const jump = planLoad({ ...u, ...none, visibleStart: 100, visibleEnd: 103, direction: 0, viewportPx: 800 })
    expect(jump.start).toBe(88)
    expect(jump.end).toBe(116)
    expect(BUFFER_VIEWPORTS).toEqual({ inDirection: 1.5, opposite: 0.5 })
  })

  it('excludes loaded and in-flight ids', () => {
    const u = uniform(1000, 100)
    const plan = planLoad({
      ...u,
      visibleStart: 100,
      visibleEnd: 103,
      direction: 0,
      viewportPx: 800,
      isLoaded: (i) => i >= 88 && i <= 90,
      isInflight: (i) => i === 116,
    })
    expect(plan.ids).not.toContain(88)
    expect(plan.ids).not.toContain(89)
    expect(plan.ids).not.toContain(90)
    expect(plan.ids).not.toContain(116)
    expect(plan.ids.length).toBe(29 - 4) // [88,116] minus the 4 excluded
    expect(plan.capped).toBe(false)
  })

  it('caps the group keeping ids closest to the visible range', () => {
    const u = uniform(1000, 100)
    const plan = planLoad({
      ...u,
      ...none,
      visibleStart: 100,
      visibleEnd: 103,
      direction: 0,
      viewportPx: 800,
      maxGroupSize: 5,
    })
    expect(plan.capped).toBe(true)
    expect(plan.ids).toEqual([99, 100, 101, 102, 103])
    expect(MAX_GROUP_SIZE).toBe(200)
  })

  it('handles empty and out-of-range visible ranges', () => {
    const u = uniform(10, 100)
    const empty = planLoad({ ...u, ...none, visibleStart: 5, visibleEnd: 4, direction: 0, viewportPx: 800 })
    expect(empty.ids).toEqual([])
    const clamped = planLoad({ ...u, ...none, visibleStart: 5, visibleEnd: 20, direction: 0, viewportPx: 800 })
    expect(clamped.ids.every((i) => i >= 0 && i <= 9)).toBe(true)
  })
})

describe('absorbIslets', () => {
  const u = uniform(100, 100)
  const x = { n: 100, viewportPx: 500, isLoaded: () => false, heightOf: u.heightOf }

  it('absorbs a small unloaded pocket bounded by a loaded row', () => {
    expect(absorbIslets(25, 30, { ...x, isLoaded: (i) => i === 20 })).toEqual({ start: 21, end: 30 })
    expect(absorbIslets(25, 30, { ...x, isLoaded: (i) => i === 36 })).toEqual({ start: 25, end: 35 })
  })

  it('does not absorb a pocket taller than the viewport', () => {
    expect(absorbIslets(25, 30, { ...x, isLoaded: (i) => i === 10 })).toEqual({ start: 25, end: 30 })
  })

  it('treats list bounds as pocket boundaries', () => {
    expect(absorbIslets(3, 97, x)).toEqual({ start: 0, end: 99 })
  })

  it('leaves the range alone when it abuts loaded rows', () => {
    expect(absorbIslets(25, 30, { ...x, isLoaded: (i) => i === 24 })).toEqual({ start: 25, end: 30 })
  })
})

describe('planTail', () => {
  it('returns the newest items', () => {
    expect(planTail(1000)).toEqual({ start: 950, end: 999 })
    expect(planTail(1000, 10)).toEqual({ start: 990, end: 999 })
    expect(planTail(30)).toEqual({ start: 0, end: 29 })
    expect(planTail(0)).toEqual({ start: 0, end: -1 })
  })
})
