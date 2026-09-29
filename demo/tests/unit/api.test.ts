import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dataset } from '../../src/mock/dataset'
import { MockApi } from '../../src/mock/api'

describe('MockApi', () => {
  it('getOutline resolves the RLE outline after ~30ms', async () => {
    const api = new MockApi(new Dataset(42, 1000))
    const t0 = Date.now()
    const outline = await api.getOutline()
    expect(outline.length).toBeLessThan(1000)
    expect(outline.reduce((a, r) => a + r.count, 0)).toBe(1000)
    expect(outline[0]).toHaveProperty('type')
    expect(outline[0]).toHaveProperty('count')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25)
  })

  it('getItems returns payloads for the requested ids', async () => {
    const api = new MockApi(new Dataset(42, 100))
    const items = await api.getItems([5, 10, 999])
    expect(items.map((p) => p.id)).toEqual(['e_5', 'e_10', 'e_999'])
  })

  it('getItems honors an already-aborted signal', async () => {
    const api = new MockApi(new Dataset(42, 10))
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(api.getItems([1], ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('getItems honors abort during latency', async () => {
    const api = new MockApi(new Dataset(42, 100))
    api.setLatency(50, 50)
    const ctrl = new AbortController()
    const p = api.getItems([1, 2], ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  describe('stream', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('emits appends and growth over time', () => {
      const ds = new Dataset(42, 10)
      const api = new MockApi(ds)
      const events: string[] = []
      api.stream((ev) => events.push(ev.kind))
      vi.advanceTimersByTime(10 * 800)
      expect(api.streaming).toBe(true)
      expect(events.length).toBeGreaterThanOrEqual(5)
      expect(events.some((k) => k === 'append')).toBe(true)
      api.stopStream()
      expect(api.streaming).toBe(false)
    })
  })
})
