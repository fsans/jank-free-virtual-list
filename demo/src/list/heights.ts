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
/** Calibrate a type only after this many samples (early medians jump around). */
export const CALIBRATION_MIN_SAMPLES = 16
/** And only when the median moved at least this far (avoids constant re-bakes). */
export const CALIBRATION_DEADBAND_PX = 4

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
  private count: number
  private types: ItemType[]
  private readonly fenwick: Fenwick
  private measured: Float32Array // 0 = not measured; real rows are never 0 tall
  private estimates: Record<ItemType, number>
  private readonly rings: Record<ItemType, number[]>
  private readonly ringPos: Record<ItemType, number>

  constructor(types: readonly ItemType[], initial: Record<ItemType, number> = INITIAL_ESTIMATES) {
    const est: Record<ItemType, number> = { ...INITIAL_ESTIMATES, ...initial }
    this.count = types.length
    this.types = [...types]
    this.estimates = est
    this.measured = new Float32Array(this.count + 1024)
    const init = new Float64Array(this.count)
    for (let i = 0; i < this.count; i++) init[i] = est[types[i] ?? 'user']
    this.fenwick = Fenwick.fromValues(init)
    this.rings = {} as Record<ItemType, number[]>
    this.ringPos = {} as Record<ItemType, number>
    for (const t of ITEM_TYPES) {
      this.rings[t] = []
      this.ringPos[t] = 0
    }
  }

  get n(): number {
    return this.count
  }

  typeOf(i: number): ItemType {
    return this.types[i] ?? 'user'
  }

  /**
   * Append a row of the given type (streaming). Bakes the current estimate
   * for that type; returns the new row's index.
   */
  appendRow(type: ItemType): number {
    const i = this.count++
    this.types.push(type)
    if (i >= this.measured.length) {
      const m = new Float32Array(Math.max(this.measured.length * 2, 1024))
      m.set(this.measured)
      this.measured = m
    }
    this.fenwick.push(this.estimates[type])
    return i
  }

  isMeasured(i: number): boolean {
    return i >= 0 && i < this.count && (this.measured[i] ?? 0) !== 0
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
   * The height currently baked into the Fenwick tree — the layout truth the
   * spacers use. Skeleton rows must render at THIS height (not `heightOf`)
   * so the DOM always matches the offset math, even mid-drain.
   */
  bakedHeightOf(i: number): number {
    return this.fenwick.get(i)
  }

  /**
   * Record the exact rendered height of a real (loaded) row; sample it for
   * calibration. Returns whether the baked height changed.
   */
  measure(i: number, h: number): boolean {
    if (i < 0 || i >= this.count || !(h > 0)) return false
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
   * Recompute per-type estimates as the median of recent measurements, once a
   * type has enough samples and only when the median moved beyond the
   * deadband. Returns the types whose estimate changed.
   */
  calibrate(): ItemType[] {
    const changed: ItemType[] = []
    for (const t of ITEM_TYPES) {
      const ring = this.rings[t]
      if (ring.length < CALIBRATION_MIN_SAMPLES) continue
      const sorted = [...ring].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      const median =
        sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      if (Math.abs(median - this.estimates[t]) >= CALIBRATION_DEADBAND_PX) {
        this.estimates[t] = median
        changed.push(t)
      }
    }
    return changed
  }

  /**
   * Bake current estimates into the Fenwick entries of UNMEASURED rows.
   * Scans rows in index order but writes at most `budget` entries per call,
   * so it can be called once per frame. Returns the number of rows re-baked
   * this call (0 means nothing stale remains).
   */
  flushCalibration(budget = 4000): number {
    let writes = 0
    for (let i = 0; i < this.count && writes < budget; i++) {
      if ((this.measured[i] ?? 0) !== 0) continue
      const est = this.estimates[this.types[i] ?? 'user']
      if (this.fenwick.get(i) === est) continue
      this.fenwick.set(i, est)
      writes++
    }
    return writes
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
