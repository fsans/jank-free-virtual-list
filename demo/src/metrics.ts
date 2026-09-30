/**
 * Demo metrics: time-to-first-usable-render, CLS via the layout-shift
 * PerformanceObserver, and jump time-to-usable (target row loaded +
 * stable for 2 frames — the watcher lives in useVirtualList).
 */
export class Metrics {
  private readonly t0 = performance.now()
  /** ms from app start to the first landed island (outline + tail rendered). */
  ttfr: number | null = null
  /** Cumulative layout-shift score, entries with recent input excluded. */
  cls = 0
  clsCount = 0
  lastShift = 0
  /** ms for the last jump() until its target row was usable. */
  lastJumpMs: number | null = null
  /** ms for jump(0) — "time to item #1" from the spec. */
  timeToItem1: number | null = null
  private obs: PerformanceObserver | null = null

  start(): void {
    if (this.obs !== null || typeof PerformanceObserver === 'undefined') return
    try {
      this.obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const s = e as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
          if (s.hadRecentInput === true) continue
          const v = s.value ?? 0
          if (v <= 0) continue
          this.cls += v
          this.clsCount++
          this.lastShift = v
        }
      })
      this.obs.observe({ type: 'layout-shift', buffered: true })
    } catch {
      this.obs = null
    }
  }

  stop(): void {
    this.obs?.disconnect()
    this.obs = null
  }

  /** First landed island = first usable render. Idempotent. */
  usableRender(): void {
    if (this.ttfr === null) this.ttfr = Math.round(performance.now() - this.t0)
  }

  jumpUsable(index: number, ms: number): void {
    this.lastJumpMs = Math.round(ms)
    if (index === 0 && this.timeToItem1 === null) this.timeToItem1 = Math.round(ms)
  }

  snapshot(): Record<string, number | null> {
    return {
      ttfr: this.ttfr,
      cls: Math.round(this.cls * 1000) / 1000,
      clsCount: this.clsCount,
      lastShift: this.lastShift,
      lastJumpMs: this.lastJumpMs,
      timeToItem1: this.timeToItem1,
    }
  }
}
