import { describe, expect, it } from 'vitest'
import { Fenwick } from '../../src/list/fenwick'
import { mulberry32 } from '../../src/mock/dataset'

/** Naive reference implementation: plain array, O(n) prefix sums. */
class Naive {
  h: number[]
  constructor(h: number[]) {
    this.h = h
  }
  sum(to: number): number {
    let s = 0
    for (let i = 0; i < Math.min(Math.max(to, 0), this.h.length); i++) s += this.h[i] ?? 0
    return s
  }
  offsetOf(i: number): number {
    return this.sum(i)
  }
  total(): number {
    return this.sum(this.h.length)
  }
  indexAtOffset(px: number): number {
    if (px <= 0) return 0
    let acc = 0
    for (let i = 0; i < this.h.length; i++) {
      const next = acc + (this.h[i] ?? 0)
      if (px < next) return i
      acc = next
    }
    return this.h.length - 1
  }
}

describe('Fenwick', () => {
  it('fromValues matches incremental set()', () => {
    const rng = mulberry32(7)
    const vals = Array.from({ length: 500 }, () => 1 + Math.floor(rng() * 300))
    const a = Fenwick.fromValues(vals)
    const b = new Fenwick(vals.length)
    vals.forEach((v, i) => b.set(i, v))
    for (const k of [0, 1, 2, 17, 250, 499, 500]) {
      expect(a.sum(k)).toBeCloseTo(b.sum(k))
    }
    expect(a.total()).toBeCloseTo(b.total())
    expect(a.get(123)).toBe(vals[123])
  })

  it('handles update/prefix/indexAtOffset like a naive array over 10k random ops', () => {
    const rng = mulberry32(1234)
    const size = 400
    const h = Array.from({ length: size }, () => 1 + Math.floor(rng() * 300))
    const fw = Fenwick.fromValues(h)
    const naive = new Naive([...h])
    for (let op = 0; op < 10_000; op++) {
      const i = Math.floor(rng() * size)
      const cur = naive.h[i] ?? 0
      if (rng() < 0.5) {
        const v = 1 + Math.floor(rng() * 300)
        fw.set(i, v)
        naive.h[i] = v
      } else {
        const v = Math.max(1, cur + Math.floor(rng() * 100) - 50)
        fw.add(i, v - cur)
        naive.h[i] = v
      }
      if (op % 50 === 0) {
        const k = Math.floor(rng() * (size + 1))
        expect(fw.sum(k)).toBeCloseTo(naive.sum(k))
        const idx = Math.floor(rng() * size)
        expect(fw.offsetOf(idx)).toBeCloseTo(naive.offsetOf(idx))
        expect(fw.get(idx)).toBe(naive.h[idx])
        const px = Math.floor(rng() * (naive.total() + 1))
        expect(fw.indexAtOffset(px)).toBe(naive.indexAtOffset(px))
      }
    }
    expect(fw.total()).toBeCloseTo(naive.total())
  })

  it('indexAtOffset uses half-open row spans and clamps', () => {
    const f = Fenwick.fromValues([10, 20, 30])
    expect(f.indexAtOffset(-5)).toBe(0)
    expect(f.indexAtOffset(0)).toBe(0)
    expect(f.indexAtOffset(9.9)).toBe(0)
    expect(f.indexAtOffset(10)).toBe(1) // boundary belongs to the row below
    expect(f.indexAtOffset(29.9)).toBe(1)
    expect(f.indexAtOffset(30)).toBe(2)
    expect(f.indexAtOffset(59)).toBe(2)
    expect(f.indexAtOffset(60)).toBe(2) // total
    expect(f.indexAtOffset(10_000)).toBe(2) // clamped
    expect(f.offsetOf(0)).toBe(0)
    expect(f.offsetOf(1)).toBe(10)
    expect(f.offsetOf(3)).toBe(60)
    expect(f.offsetOf(99)).toBe(60) // clamped
    expect(f.total()).toBe(60)
  })

  it('add/set with out-of-bounds or zero delta are no-ops', () => {
    const f = Fenwick.fromValues([10, 10])
    f.add(-1, 100)
    f.add(2, 100)
    f.add(0, 0)
    f.set(-3, 50)
    expect(f.total()).toBe(20)
    expect(f.get(2)).toBe(0)
  })

  it('push() appends rows and keeps sums/offsets correct across growth', () => {
    const rng = mulberry32(555)
    const f = Fenwick.fromValues([10, 20, 30])
    const naive = new Naive([10, 20, 30])
    for (let k = 0; k < 5000; k++) {
      const v = 1 + Math.floor(rng() * 300)
      f.push(v)
      naive.h.push(v)
      const i = Math.floor(rng() * naive.h.length)
      const nv = 1 + Math.floor(rng() * 300)
      f.set(i, nv)
      naive.h[i] = nv
      if (k % 100 === 0) {
        expect(f.size).toBe(naive.h.length)
        expect(f.total()).toBeCloseTo(naive.total())
        const j = Math.floor(rng() * naive.h.length)
        expect(f.offsetOf(j)).toBeCloseTo(naive.offsetOf(j))
        const px = Math.floor(rng() * naive.total())
        expect(f.indexAtOffset(px)).toBe(naive.indexAtOffset(px))
      }
    }
    expect(f.total()).toBeCloseTo(naive.total())
  })

  it('scales to 200k rows with correct offsets', () => {
    const rng = mulberry32(99)
    const n = 200_000
    const vals = new Float64Array(n)
    for (let i = 0; i < n; i++) vals[i] = 20 + Math.floor(rng() * 500)
    const f = Fenwick.fromValues(vals)
    expect(f.total()).toBeCloseTo(Array.from(vals).reduce((a, b) => a + b, 0))
    let prev = 0
    for (let i = 0; i < n; i += 9973) {
      expect(f.offsetOf(i)).toBeGreaterThanOrEqual(prev)
      prev = f.offsetOf(i)
      expect(f.indexAtOffset(f.offsetOf(i))).toBe(i)
    }
    f.set(123_456, 999)
    expect(f.offsetOf(123_457) - f.offsetOf(123_456)).toBe(999)
  })
})
