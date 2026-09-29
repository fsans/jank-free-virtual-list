import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dataset } from '../../src/mock/dataset'
import { MockApi } from '../../src/mock/api'
import { IslandLoader } from '../../src/list/loader'

function apiWith(latency: number): MockApi {
  const api = new MockApi(new Dataset(42, 100))
  api.setLatency(latency, latency)
  return api
}

describe('IslandLoader', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps a single request in flight and queues the rest in order', async () => {
    const api = apiWith(50)
    const landed: number[][] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: (items) => landed.push(items.map((p) => p.index)),
    })
    loader.request([1, 2])
    loader.request([3, 4])
    expect(loader.inflightCount).toBe(1)
    expect(loader.queueLength).toBe(1)
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1, 2]])
    expect(loader.inflightCount).toBe(1) // second group started
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1, 2], [3, 4]])
    expect(loader.inflightCount).toBe(0)
    expect(loader.queueLength).toBe(0)
  })

  it('dedups ids that are loaded or already in flight', async () => {
    const api = apiWith(50)
    const landed: number[][] = []
    const loaded = new Set<number>()
    const loader = new IslandLoader(api, {
      isLoaded: (i) => loaded.has(i),
      onLanded: (items) => {
        items.forEach((p) => loaded.add(p.index))
        landed.push(items.map((p) => p.index))
      },
    })
    loader.request([5, 6])
    loader.request([6, 7]) // 6 is in flight -> only 7 is queued
    expect(loader.queueLength).toBe(1)
    loader.request([5]) // already in flight -> dropped entirely
    expect(loader.queueLength).toBe(1)
    await vi.advanceTimersByTimeAsync(60)
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[5, 6], [7]])
  })

  it('skips already-loaded ids when a queued group starts', async () => {
    const api = apiWith(50)
    const landed: number[][] = []
    const loaded = new Set<number>([3, 4])
    const loader = new IslandLoader(api, {
      isLoaded: (i) => loaded.has(i),
      onLanded: (items) => landed.push(items.map((p) => p.index)),
    })
    loader.request([1]) // in flight
    loader.request([3, 4, 9]) // queued; 3 and 4 loaded by the time it starts
    loaded.add(9)
    await vi.advanceTimersByTimeAsync(60)
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1]])
  })

  it('aborts in-flight groups entirely outside the buffered range', async () => {
    const api = apiWith(50)
    const events: string[] = []
    const landed: number[] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: (items) => landed.push(...items.map((p) => p.index)),
      onEvent: (ev) => events.push(ev.type),
    })
    loader.request([1, 2, 3])
    loader.cancelIfOutside(50, 60) // entirely outside [50, 60]
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([])
    expect(events).toContain('load_requested')
    expect(events).toContain('load_cancelled')
    expect(loader.inflightCount).toBe(0)
  })

  it('keeps in-flight groups that overlap the buffered range', async () => {
    const api = apiWith(50)
    const landed: number[] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: (items) => landed.push(...items.map((p) => p.index)),
    })
    loader.request([1, 2, 3])
    loader.cancelIfOutside(2, 60) // overlaps
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([1, 2, 3])
  })

  it('drops queued groups outside the buffered range', async () => {
    const api = apiWith(50)
    const events: string[] = []
    const landed: number[][] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: (items) => landed.push(items.map((p) => p.index)),
      onEvent: (ev) => events.push(ev.type),
    })
    loader.request([1, 2]) // in flight
    loader.request([50, 51]) // queued
    loader.cancelIfOutside(0, 10) // queued group is outside
    expect(loader.queueLength).toBe(0)
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1, 2]])
    expect(events).toContain('load_cancelled')
  })

  it('processes immediate requests before queued ones', async () => {
    const api = apiWith(50)
    const landed: number[][] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: (items) => landed.push(items.map((p) => p.index)),
    })
    loader.request([1])
    loader.request([2])
    loader.request([3], true) // immediate: front of the queue
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1]])
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1], [3]])
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([[1], [3], [2]])
  })

  it('caps the queue by dropping the oldest groups', async () => {
    const api = apiWith(50)
    const events: string[] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: () => {},
      onEvent: (ev) => events.push(ev.type),
    })
    for (let g = 0; g < 12; g++) loader.request([g * 10, g * 10 + 1])
    expect(loader.queueLength).toBe(8)
    expect(events.filter((e) => e === 'load_cancelled').length).toBe(3)
  })

  it('dispose aborts in-flight and queued work', async () => {
    const api = apiWith(50)
    const landed: number[][] = []
    const loader = new IslandLoader(api, {
      isLoaded: () => false,
      onLanded: (items) => landed.push(items.map((p) => p.index)),
    })
    loader.request([1])
    loader.request([2])
    loader.dispose()
    await vi.advanceTimersByTimeAsync(60)
    expect(landed).toEqual([])
    loader.request([3]) // disposed -> ignored
    expect(loader.inflightCount).toBe(0)
  })
})
