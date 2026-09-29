import type { Payload } from './types'

/**
 * LRU payload cache. When over budget, the least-recently-used payloads are
 * evicted — far islands go back to skeletons. Measured heights are NOT stored
 * here: they live in the HeightsStore and survive eviction by design.
 */
export class PayloadCache {
  private map = new Map<number, Payload>()

  constructor(readonly budget = 5000) {}

  get size(): number {
    return this.map.size
  }

  has(i: number): boolean {
    return this.map.has(i)
  }

  /** Read a payload, refreshing its LRU recency. */
  get(i: number): Payload | undefined {
    const p = this.map.get(i)
    if (p !== undefined) {
      this.map.delete(i)
      this.map.set(i, p)
    }
    return p
  }

  /** Insert payloads; returns the ids evicted to stay within budget. */
  setMany(items: readonly Payload[]): number[] {
    for (const p of items) {
      this.map.delete(p.index)
      this.map.set(p.index, p)
    }
    const evicted: number[] = []
    while (this.map.size > this.budget) {
      const oldest = this.map.keys().next()
      if (oldest.done === true) break
      this.map.delete(oldest.value)
      evicted.push(oldest.value)
    }
    return evicted
  }

  clear(): void {
    this.map.clear()
  }
}
