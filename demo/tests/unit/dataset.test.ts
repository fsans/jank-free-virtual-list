import { describe, expect, it } from 'vitest'
import { Dataset, drawTarget, mulberry32 } from '../../src/mock/dataset'

describe('Dataset', () => {
  it('generates exactly n items with a mixed type distribution', () => {
    const ds = new Dataset(42, 200_000)
    expect(ds.n).toBe(200_000)
    const counts = new Map<string, number>()
    for (let i = 0; i < ds.n; i++) {
      const t = ds.typeOf(i)
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(200_000)
  })

  it('is deterministic for a given seed', () => {
    const a = new Dataset(42, 1000)
    const b = new Dataset(42, 1000)
    for (let i = 0; i < 1000; i += 97) expect(a.typeOf(i)).toBe(b.typeOf(i))
    expect(a.payloadOf(11)).toEqual(b.payloadOf(11))
  })

  it('differs across seeds', () => {
    const sig = (seed: number) => {
      const d = new Dataset(seed, 500)
      return Array.from({ length: 500 }, (_, i) => d.typeOf(i)).join(',')
    }
    expect(sig(1)).not.toBe(sig(3))
  })

  it('outline is run-length encoded and consistent with typeOf', () => {
    const ds = new Dataset(7, 5000)
    const outline = ds.outline()
    expect(outline.length).toBeLessThan(5000)
    let i = 0
    for (const r of outline) {
      for (let k = 0; k < r.count; k++) {
        expect(ds.typeOf(i)).toBe(r.type)
        i++
      }
    }
    expect(outline.reduce((acc, r) => acc + r.count, 0)).toBe(5000)
  })

  it('derives payloads with stable ids', () => {
    const ds = new Dataset(9, 100)
    for (const i of [0, 1, 57, 99]) {
      const p = ds.payloadOf(i)
      expect(p.id).toBe(`e_${i}`)
      expect(p.index).toBe(i)
      expect(p.type).toBe(ds.typeOf(i))
    }
    const img = ds.payloadOf(3)
    if (img.type === 'image') {
      expect(typeof img.src).toBe('string')
      expect(img.aspect ?? 0).toBeGreaterThan(0)
    }
  })

  it('grows the last row when it is an assistant item', () => {
    const ds = new Dataset(1, 10)
    ds.append('user')
    const idx = ds.append('assistant')
    const before = ds.payloadOf(idx).text ?? ''
    const grown = ds.growLastAssistant()
    expect(grown?.index).toBe(idx)
    expect(grown?.text.length).toBeGreaterThan(0)
    const after = ds.payloadOf(idx).text ?? ''
    expect(after.length).toBeGreaterThan(before.length)
    expect(after.startsWith(before)).toBe(true)
    // growth stays at the bottom: a newer non-assistant row blocks it
    ds.append('tool')
    expect(ds.growLastAssistant()).toBeNull()
  })

  it('image payloads carry a decode delay within 200-1500ms', () => {
    const ds = new Dataset(11, 2000)
    let checked = 0
    for (let i = 0; i < ds.n && checked < 20; i++) {
      if (ds.typeOf(i) !== 'image') continue
      const p = ds.payloadOf(i)
      expect(p.decodeMs).toBeGreaterThanOrEqual(200)
      expect(p.decodeMs).toBeLessThanOrEqual(1500)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('drawTarget', () => {
  it('stays within the type range', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 200; i++) {
      const t = drawTarget('assistant', rng, 1)
      expect(t).toBeGreaterThanOrEqual(36)
      expect(t).toBeLessThanOrEqual(320)
    }
  })

  it('collapses to the midpoint at variance 0', () => {
    expect(drawTarget('user', Math.random, 0)).toBe(62)
  })
})
