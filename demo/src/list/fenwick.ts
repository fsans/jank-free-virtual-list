/**
 * Fenwick (binary indexed) tree over per-row heights.
 *
 * Gives O(log n) prefix sums for the whole-list offset math: `offsetOf(i)`
 * (top of row i), `indexAtOffset(px)` (the row containing an absolute offset)
 * and `total()`. This is what lets 200k rows have a correct scrollbar without
 * ever recomputing all offsets per frame.
 */
export class Fenwick {
  private readonly tree: Float64Array
  private readonly vals: Float64Array

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 0) throw new Error(`Fenwick: invalid size ${size}`)
    this.tree = new Float64Array(size + 1)
    this.vals = new Float64Array(size)
  }

  /** O(n) build from initial values (e.g. skeleton estimates for every row). */
  static fromValues(values: ArrayLike<number>): Fenwick {
    const f = new Fenwick(values.length)
    const prefix = new Float64Array(values.length + 1)
    for (let i = 0; i < values.length; i++) {
      const v = values[i] ?? 0
      f.vals[i] = v
      prefix[i + 1] = (prefix[i] ?? 0) + v
    }
    for (let j = 1; j <= f.size; j++) f.tree[j] = (prefix[j] ?? 0) - (prefix[j - (j & -j)] ?? 0)
    return f
  }

  /** Current value stored at index i (0 if out of bounds). */
  get(i: number): number {
    return i >= 0 && i < this.size ? (this.vals[i] ?? 0) : 0
  }

  /** heights[i] += delta. */
  add(i: number, delta: number): void {
    if (i < 0 || i >= this.size || delta === 0) return
    this.vals[i] = (this.vals[i] ?? 0) + delta
    for (let j = i + 1; j <= this.size; j += j & -j) this.tree[j] = (this.tree[j] ?? 0) + delta
  }

  /** heights[i] = value. */
  set(i: number, value: number): void {
    this.add(i, value - this.get(i))
  }

  /** Sum of heights[0..to), clamped to [0, size]. */
  sum(to: number): number {
    const k = Math.min(Math.max(to, 0), this.size)
    let s = 0
    for (let j = k; j > 0; j -= j & -j) s += this.tree[j] ?? 0
    return s
  }

  total(): number {
    return this.sum(this.size)
  }

  /** Top offset of row i: sum of the heights of all rows above it. */
  offsetOf(i: number): number {
    return this.sum(i)
  }

  /**
   * Index of the row containing absolute offset `px`. Row i spans
   * [offsetOf(i), offsetOf(i+1)), so a px exactly on a boundary belongs to the
   * row below it. Result clamped to [0, size-1].
   */
  indexAtOffset(px: number): number {
    if (this.size === 0 || px <= 0) return 0
    // largest k with sum(k) <= px, via Fenwick binary descent
    let k = 0
    let acc = 0
    let bit = 1
    while (bit * 2 <= this.size) bit <<= 1
    for (; bit > 0; bit >>= 1) {
      const next = k + bit
      const node = this.tree[next]
      if (next <= this.size && acc + (node ?? 0) <= px) {
        k = next
        acc += node ?? 0
      }
    }
    return Math.min(k, this.size - 1)
  }
}
