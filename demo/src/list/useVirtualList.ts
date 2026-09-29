/**
 * Core virtualizer hook: skeleton map from the outline, island loading with
 * anchor-row scroll compensation, LRU payload cache, estimate calibration
 * drain, and pinned/free mode.
 *
 * Layout: `[top spacer][mounted rows in normal flow][bottom spacer]` inside a
 * scroll container with `overflow-anchor: none`.
 *
 * Compensation (the anti-jank core): before a load commits, pick the anchor
 * (topmost visible loaded row, else topmost visible skeleton) and record its
 * viewport-relative top. After the commit settles in a layout-phase effect,
 * restore that top by adjusting scrollTop — all before paint. Async row
 * resizes (ResizeObserver) correct the sum of height deltas of rows ABOVE the
 * anchor inside the same callback. Calibration re-bakes go through the same
 * pending-compensation path.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Payload } from './types'
import { expandOutline, HeightsStore } from './heights'
import { planLoad, planTail } from './planner'
import type { Direction } from './planner'
import { pickAnchor } from './anchor'
import type { Anchor, VisibleRow } from './anchor'
import { PayloadCache } from './cache'
import { IslandLoader } from './loader'
import { RingLog } from '../debug/logger'
import type { MockApi } from '../mock/api'

export type ListMode = 'pinned' | 'free'

interface PendingComp {
  anchorIndex: number
  anchorKind: Anchor['kind']
  topBefore: number
  /** scrollTop when the compensation was opened (for user-scroll separation). */
  scrollTopAtLand: number
  /** Cumulative scrollTop written by this compensation so far. */
  compApplied: number
  reason: 'load' | 'resize' | 'measure'
}

export interface VirtualListState {
  ready: boolean
  n: number
  mode: ListMode
  loadedCount: number
  cacheSize: number
  inflight: number
  queueLength: number
  compensation: boolean
  setCompensation: (on: boolean) => void
  log: RingLog
  scrollTop: number
  viewportH: number
  visibleStart: number
  visibleEnd: number
  mountedStart: number
  mountedEnd: number
  topSpacer: number
  bottomSpacer: number
  heights: HeightsStore | null
  payloadOf: (i: number) => Payload | undefined
  setScroller: (el: HTMLDivElement | null) => void
  onScroll: () => void
}

const EMPTY_RANGE = {
  visibleStart: 0,
  visibleEnd: -1,
  mountedStart: 0,
  mountedEnd: -1,
  topSpacer: 0,
  bottomSpacer: 0,
}

const FLUSH_BUDGET = 4000
const r2 = (x: number) => Math.round(x * 100) / 100

export function useVirtualList(api: MockApi): VirtualListState {
  const [heights, setHeights] = useState<HeightsStore | null>(null)
  const [rev, setRev] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [mode, setMode] = useState<ListMode>('pinned')
  const [compensation, setCompensationState] = useState(true)

  const cacheRef = useRef<PayloadCache | null>(null)
  if (cacheRef.current === null) cacheRef.current = new PayloadCache(5000)
  const logRef = useRef<RingLog | null>(null)
  if (logRef.current === null) logRef.current = new RingLog()
  const log = logRef.current

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const observedRef = useRef(new Set<HTMLElement>())
  const heightsRef = useRef<HeightsStore | null>(null)
  const rafRef = useRef<number | null>(null)
  const loaderRef = useRef<IslandLoader | null>(null)
  const pendingCompRef = useRef<PendingComp | null>(null)
  const settledRef = useRef(true)
  const flushNeededRef = useRef(false)
  const compensationRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const modeRef = useRef<ListMode>('pinned')
  const lastVisRef = useRef<[number, number]>([0, -1])

  useLayoutEffect(() => {
    heightsRef.current = heights
    compensationRef.current = compensation
  })

  /** Anchor over the live viewport: topmost visible loaded, else topmost skeleton. */
  const currentAnchor = useCallback((): Anchor | null => {
    const hs = heightsRef.current
    const el = scrollerRef.current
    if (!hs || !el || el.clientHeight <= 0) return null
    const start = hs.indexAtOffset(el.scrollTop)
    const end = Math.min(hs.n - 1, hs.indexAtOffset(el.scrollTop + el.clientHeight - 1))
    const visible: VisibleRow[] = []
    for (let i = start; i <= end; i++) {
      visible.push({ index: i, loaded: cacheRef.current?.has(i) ?? false })
    }
    return pickAnchor(visible)
  }, [])

  const anchorTopOf = useCallback((anchorIndex: number): number | null => {
    const el = scrollerRef.current
    const anchorEl = el?.querySelector<HTMLElement>(`[data-vrow="${anchorIndex}"]`)
    if (!el || !anchorEl) return null
    return anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top
  }, [])

  // ---- outline: the index-only query that reserves the whole scroll range ----
  useEffect(() => {
    let alive = true
    api.getOutline().then((outline) => {
      if (!alive) return
      setHeights(new HeightsStore(expandOutline(outline)))
    })
    return () => {
      alive = false
    }
  }, [api])

  // ---- island loader + the initial tail load ----
  useEffect(() => {
    if (!heights) return
    const loader = new IslandLoader(api, {
      isLoaded: (i) => cacheRef.current?.has(i) ?? false,
      onLanded: (items) => {
        // Pick the anchor and record its top BEFORE committing. Stale groups
        // that land entirely BELOW the anchor only populate the cache.
        const anchor = currentAnchor()
        let comp: PendingComp | null = null
        if (anchor && items.some((p) => p.index <= anchor.index)) {
          const top = anchorTopOf(anchor.index)
          if (top !== null) {
            comp = {
              anchorIndex: anchor.index,
              anchorKind: anchor.kind,
              topBefore: top,
              scrollTopAtLand: scrollerRef.current?.scrollTop ?? 0,
              compApplied: 0,
              reason: 'load',
            }
            log.push('anchor_picked', {
              anchor: { id: `e_${anchor.index}`, kind: anchor.kind },
              anchorTopBefore: r2(top),
            })
          }
        }
        if (comp) pendingCompRef.current = comp
        const evicted = cacheRef.current?.setMany(items) ?? []
        if (evicted.length > 0) {
          log.push('evict', { count: evicted.length, first: evicted[0], last: evicted[evicted.length - 1] })
        }
        log.push('load_landed', { ids: items.map((p) => p.id), count: items.length, compensated: comp !== null })
        setRev((r) => r + 1)
      },
      onEvent: (ev) => {
        log.push(ev.type, { ids: ev.ids.map((i) => `e_${i}`), count: ev.ids.length })
        setRev((r) => r + 1)
      },
    })
    loaderRef.current = loader
    const tail = planTail(heights.n)
    const ids: number[] = []
    for (let i = tail.start; i <= tail.end; i++) ids.push(i)
    loader.request(ids, true)
    return () => {
      loader.dispose()
      loaderRef.current = null
    }
  }, [api, heights, currentAnchor, anchorTopOf, log])

  // ---- scroller attachment: one shared ResizeObserver ----
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el
      if (el) {
        if (roRef.current === null) {
          roRef.current = new ResizeObserver((entries) => {
            const hs = heightsRef.current
            const scr = scrollerRef.current
            const anchor = currentAnchor()
            let delta = 0
            for (const entry of entries) {
              const t = entry.target as HTMLElement
              if (t === scrollerRef.current) {
                // viewport/window resize: pin the anchor through the re-render
                if (pendingCompRef.current === null && hs && scr && anchor) {
                  const top = anchorTopOf(anchor.index)
                  if (top !== null) {
                    pendingCompRef.current = {
                      anchorIndex: anchor.index,
                      anchorKind: anchor.kind,
                      topBefore: top,
                      scrollTopAtLand: scr.scrollTop,
                      compApplied: 0,
                      reason: 'resize',
                    }
                  }
                }
                const h = t.clientHeight
                setViewportH((prev) => (prev === h ? prev : h))
                continue
              }
              if (!hs || !scr) continue
              const i = Number(t.dataset.vrow)
              if (!Number.isFinite(i) || !(cacheRef.current?.has(i) ?? false)) continue
              const before = hs.heightOf(i)
              // subpixel: offsetHeight rounds to int and would clobber the
              // precise measurement taken by the layout-effect measure path
              const box = entry.borderBoxSize
              const after =
                box.length > 0 ? (box[0]?.blockSize ?? 0) : t.getBoundingClientRect().height
              if (!(after > 0) || before === after) continue
              log.push('resize_observed', { id: `e_${i}`, measured: after, previous: before })
              hs.measure(i, after)
              // rows above the anchor shift content; rows at/below do not
              if (anchor !== null && i < anchor.index) delta += after - before
              setRev((r) => r + 1)
            }
            if (delta !== 0 && compensationRef.current && scr) {
              scr.scrollTop += delta
              log.push('delta_applied', {
                reason: 'resize',
                deltaApplied: r2(delta),
                anchor: anchor ? { id: `e_${anchor.index}`, kind: anchor.kind } : null,
                scrollTopAfter: Math.round(scr.scrollTop),
              })
            }
          })
        }
        roRef.current.observe(el)
        setViewportH(el.clientHeight)
      } else if (roRef.current !== null) {
        roRef.current.disconnect()
        roRef.current = null
        observedRef.current.clear()
      }
    },
    [currentAnchor, anchorTopOf, log],
  )

  // ---- island planning (rAF-throttled on scroll) ----
  const planAround = useCallback(
    (st: number, direction: Direction, viewportPx: number) => {
      const hs = heightsRef.current
      const loader = loaderRef.current
      if (!hs || hs.n === 0 || viewportPx <= 0) return
      const visibleStart = hs.indexAtOffset(st)
      const visibleEnd = Math.min(hs.n - 1, hs.indexAtOffset(st + viewportPx - 1))
      if (visibleStart !== lastVisRef.current[0] || visibleEnd !== lastVisRef.current[1]) {
        lastVisRef.current = [visibleStart, visibleEnd]
        log.push('visible_range', { start: visibleStart, end: visibleEnd })
      }
      const plan = planLoad({
        visibleStart,
        visibleEnd,
        direction,
        viewportPx,
        n: hs.n,
        offsetOf: (i) => hs.offsetOf(i),
        heightOf: (i) => hs.heightOf(i),
        indexAtOffset: (px) => hs.indexAtOffset(px),
        isLoaded: (i) => cacheRef.current?.has(i) ?? false,
        isInflight: (i) => loader?.isInflight(i) ?? false,
      })
      // the user flung elsewhere: abort groups entirely outside the buffer
      loader?.cancelIfOutside(plan.start, plan.end)
      if (plan.ids.length > 0) loader?.request(plan.ids)
    },
    [log],
  )

  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollerRef.current
      if (!el) return
      const st = el.scrollTop
      const direction: Direction = st === lastScrollTopRef.current ? 0 : st < lastScrollTopRef.current ? -1 : 1
      lastScrollTopRef.current = st
      setScrollTop(st)
      const distFromBottom = el.scrollHeight - el.clientHeight - st
      const next: ListMode = distFromBottom <= 4 ? 'pinned' : 'free'
      if (modeRef.current !== next) {
        modeRef.current = next
        log.push('mode_change', { mode: next })
      }
      setMode(next)
      log.push('scroll', { scrollTop: Math.round(st), direction, mode: next })
      planAround(st, direction, el.clientHeight)
    })
  }, [log, planAround])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const range = useMemo(() => {
    if (!heights || viewportH <= 0) return EMPTY_RANGE
    const n = heights.n
    if (n === 0) return EMPTY_RANGE
    const visibleStart = heights.indexAtOffset(scrollTop)
    const visibleEnd = Math.min(n - 1, heights.indexAtOffset(scrollTop + viewportH - 1))
    const mountedStart = heights.indexAtOffset(Math.max(0, scrollTop - viewportH))
    const mountedEnd = Math.min(n - 1, heights.indexAtOffset(scrollTop + 2 * viewportH))
    const topSpacer = heights.offsetOf(mountedStart)
    const bottomSpacer = Math.max(0, heights.total() - heights.offsetOf(mountedEnd + 1))
    return { visibleStart, visibleEnd, mountedStart, mountedEnd, topSpacer, bottomSpacer }
  }, [heights, viewportH, scrollTop, rev])

  // ---- measure mounted real rows pre-paint; drain calibration in batches ----
  // Newly mounted rows that were loaded but never measured render at natural
  // heights != their estimates; rows ABOVE the anchor shifting content get the
  // same pre-paint compensation as load landings.
  useLayoutEffect(() => {
    const hs = heights
    const el = scrollerRef.current
    const ro = roRef.current
    if (!hs || !el) return
    const anchor = currentAnchor()
    let changed = false
    let deltaAbove = 0
    const seen = new Set<HTMLElement>()
    el.querySelectorAll<HTMLElement>('[data-vrow]').forEach((rowEl) => {
      seen.add(rowEl)
      if (ro !== null && !observedRef.current.has(rowEl)) {
        ro.observe(rowEl)
        observedRef.current.add(rowEl)
      }
      const i = Number(rowEl.dataset.vrow)
      if (!Number.isFinite(i) || !(cacheRef.current?.has(i) ?? false)) return
      const before = hs.bakedHeightOf(i)
      const after = rowEl.getBoundingClientRect().height
      if (before === after) return
      changed = true
      hs.measure(i, after)
      if (anchor !== null && i < anchor.index) deltaAbove += after - before
    })
    if (ro !== null) {
      for (const prev of observedRef.current) {
        if (!seen.has(prev)) {
          ro.unobserve(prev)
          observedRef.current.delete(prev)
        }
      }
    }
    if (deltaAbove !== 0 && compensationRef.current) {
      el.scrollTop += deltaAbove
      log.push('delta_applied', {
        reason: 'measure',
        deltaApplied: r2(deltaAbove),
        anchor: anchor ? { id: `e_${anchor.index}`, kind: anchor.kind } : null,
        scrollTopAfter: Math.round(el.scrollTop),
      })
    }
    if (changed && pendingCompRef.current === null && anchor !== null) {
      const top = anchorTopOf(anchor.index)
      if (top !== null) {
        // hold this anchor through the calibration drain that may follow
        pendingCompRef.current = {
          anchorIndex: anchor.index,
          anchorKind: anchor.kind,
          topBefore: top,
          scrollTopAtLand: el.scrollTop,
          compApplied: 0,
          reason: 'measure',
        }
      }
    }
    if (changed) {
      const calibrated = hs.calibrate()
      if (calibrated.length > 0) flushNeededRef.current = true
    }
    let flushed = 0
    if (flushNeededRef.current) {
      flushed = hs.flushCalibration(FLUSH_BUDGET)
      if (flushed === 0) flushNeededRef.current = false
    }
    settledRef.current = !changed && flushed === 0
    if (changed || flushed > 0) setRev((r) => r + 1)
  }, [heights, range.mountedStart, range.mountedEnd, viewportH, rev])

  // ---- compensation: restore the anchor's viewport top, before paint ----
  // The target moves with user scrolling (userScroll = total scrollTop change
  // minus our own writes); only the residual height change above the anchor
  // is corrected, so compensation never fights the user.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    const pc = pendingCompRef.current
    if (!el || !pc) return
    const top = anchorTopOf(pc.anchorIndex)
    if (top === null) {
      // anchor not mounted (user scrolled elsewhere); drop once settled
      if (settledRef.current) pendingCompRef.current = null
      return
    }
    const userScroll = el.scrollTop - pc.scrollTopAtLand - pc.compApplied
    const targetTop = pc.topBefore - userScroll
    const adjustment = top - targetTop
    if (compensationRef.current && adjustment !== 0) {
      el.scrollTop += adjustment
      pc.compApplied += adjustment
      log.push('delta_applied', {
        reason: pc.reason,
        deltaApplied: r2(adjustment),
        anchor: { id: `e_${pc.anchorIndex}`, kind: pc.anchorKind },
        anchorTopBefore: r2(pc.topBefore),
        anchorTopAfter: r2(top),
        scrollTopAfter: Math.round(el.scrollTop),
      })
    }
    if (settledRef.current) pendingCompRef.current = null
  })

  // ---- pinned mode: keep the newest content on screen ----
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || mode !== 'pinned') return
    const max = el.scrollHeight - el.clientHeight
    if (max > 0 && Math.abs(el.scrollTop - max) > 0.5) el.scrollTop = max
  }, [mode, heights, rev, viewportH])

  const setCompensation = useCallback((on: boolean) => {
    compensationRef.current = on
    setCompensationState(on)
  }, [])

  const payloadOf = useCallback((i: number) => cacheRef.current?.get(i), [rev])

  return {
    ready: heights !== null,
    n: heights?.n ?? 0,
    mode,
    loadedCount: cacheRef.current?.size ?? 0,
    cacheSize: cacheRef.current?.size ?? 0,
    inflight: loaderRef.current?.inflightCount ?? 0,
    queueLength: loaderRef.current?.queueLength ?? 0,
    compensation,
    setCompensation,
    log,
    scrollTop,
    viewportH,
    visibleStart: range.visibleStart,
    visibleEnd: range.visibleEnd,
    mountedStart: range.mountedStart,
    mountedEnd: range.mountedEnd,
    topSpacer: range.topSpacer,
    bottomSpacer: range.bottomSpacer,
    heights,
    payloadOf,
    setScroller,
    onScroll,
  }
}
