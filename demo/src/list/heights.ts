import { Fenwick } from './fenwick'
import { INITIAL_ESTIMATES, ITEM_TYPES, type ItemType, type OutlineEntry } from './types'

/** Expand a run-length encoded outline into a flat per-index type array. */
export function expandOutline(outline: readonly OutlineEntry[]): ItemType[] {
  const out: ItemType[] = []
  for (const r of outline) for (let k = 0; k < r.count; k++) out.push(r.type)
  return out
}

/** Recent measurements kept per type for the running-median estimate. */
export const CALIBRATION_RING = 256

/**
 * Height model for the whole list.
 *
 * - `heightOf(i)` = measured height if known, else the current per-type estimate.
 * - A Fenwick tree holds the *baked* height of every row (estimate initially)
 *   so `offsetOf` / `indexAtOffset` / `total` are O(log n) at 200k rows.
 * - `measure()` records exact rendered heights of real rows and samples them.
 * - `calibrate()` moves each type's estimate to the median of its recent
 *   samples. `flushCalibration()` then re-bakes UNMEASURED rows in batches —
 *   never all 200k Fenwick entries at once.
 */
export class HeightsStore {
  readonly n: number
  private readonly types: readonly ItemType[]
  private readonly fenwick: Fenwick
  private readonly measured: Float32Array // 0 = not measured; real rows are never 0 tall
  private estimates: Record<ItemType, number>
  private readonly rings: Record<ItemType, number[]>
  private readonly ringPos: Record<ItemType, number>

  constructor(types: readonly ItemType[], initial: Record<ItemType, number> = INITIAL_ESTIMATES) {
    const est: Record<ItemType, number> = { ...INITIAL_ESTIMATES, ...initial }
    this.n = types.length
    this.types = types
    this.estimates = est
    this.measured = new Float32Array(this.n)
    const init = new Float64Array(this.n)
    for (let i = 0; i < this.n; i++) init[i] = est[types[i] ?? 'user']
    this.fenwick = Fenwick.fromValues(init)
    this.rings = {} as Record<ItemType, number[]>
    this.ringPos = {} as Record<ItemType, number>
    for (const t of ITEM_TYPES) {
      this.rings[t] = []
      this.ringPos[t] = 0
    }
  }

  typeOf(i: number): ItemType {
    return this.types[i] ?? 'user'
  }

  isMeasured(i: number): boolean {
    return i >= 0 && i < this.n && (this.measured[i] ?? 0) !== 0
  }

  estimateOf(type: ItemType): number {
    return this.estimates[type]
  }

  /** Effective height of row i: exact if measured, else the current estimate. */
  heightOf(i: number): number {
    const m = this.measured[i]
    return m !== undefined && m !== 0 ? m : this.estimates[this.typeOf(i)]
  }

  /**
   * Record the exact rendered height of a real (loaded) row; sample it for
   * calibration. Returns whether the baked height changed.
   */
  measure(i: number, h: number): boolean {
    if (i < 0 || i >= this.n || !(h > 0)) return false
    const changed = this.fenwick.get(i) !== h
    this.measured[i] = h
    this.fenwick.set(i, h)
    const t = this.typeOf(i)
    const ring = this.rings[t]
    if (ring.length < CALIBRATION_RING) ring.push(h)
    else {
      ring[this.ringPos[t]] = h
      this.ringPos[t] = (this.ringPos[t] + 1) % CALIBRATION_RING
    }
    return changed
  }

  /**
   * Recompute per-type estimates as the median of recent measurements.
   * Returns the types whose estimate changed.
   */
  calibrate(): ItemType[] {
    const changed: ItemType[] = []
    for (const t of ITEM_TYPES) {
      const ring = this.rings[t]
      if (ring.length === 0) continue
      const sorted = [...ring].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      const median =
        sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      if (median !== this.estimates[t]) {
        this.estimates[t] = median
        changed.push(t)
      }
    }
    return changed
  }

  /**
   * Bake current estimates into the Fenwick entries of UNMEASURED rows.
   * Scans all n rows (cheap array reads) but writes at most `budget` entries
   * per call, so it can be called once per frame. Returns how many stale rows
   * remain unbaked.
   */
  flushCalibration(budget = 4000): number {
    let writes = 0
    let stale = 0
    for (let i = 0; i < this.n; i++) {
      if ((this.measured[i] ?? 0) !== 0) continue
      const est = this.estimates[this.types[i] ?? 'user']
      if (this.fenwick.get(i) === est) continue
      if (writes < budget) {
        this.fenwick.set(i, est)
        writes++
      } else stale++
    }
    return stale
  }

  /** Baked offset math (uses baked heights; flushCalibration keeps them close). */
  offsetOf(i: number): number {
    return this.fenwick.offsetOf(i)
  }

  indexAtOffset(px: number): number {
    return this.fenwick.indexAtOffset(px)
  }

  total(): number {
    return this.fenwick.total()
  }
}
