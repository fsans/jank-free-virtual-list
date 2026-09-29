import { describe, expect, it } from 'vitest'
import { PayloadCache } from '../../src/list/cache'
import type { Payload } from '../../src/list/types'

const p = (index: number): Payload => ({ id: `e_${index}`, index, type: 'user', text: `t${index}` })

describe('PayloadCache', () => {
  it('stores and retrieves payloads', () => {
    const c = new PayloadCache(10)
    expect(c.setMany([p(1), p(2), p(3)])).toEqual([])
    expect(c.size).toBe(3)
    expect(c.get(2)?.text).toBe('t2')
    expect(c.has(1)).toBe(true)
    expect(c.has(9)).toBe(false)
    expect(c.get(9)).toBeUndefined()
  })

  it('evicts least-recently-used when over budget and reports evicted ids', () => {
    const c = new PayloadCache(3)
    c.setMany([p(1), p(2), p(3)])
    c.get(1) // refresh 1: LRU order is now 2, 3, 1
    const evicted = c.setMany([p(4)])
    expect(evicted).toEqual([2])
    expect(c.has(2)).toBe(false)
    expect(c.has(1)).toBe(true)
    expect(c.size).toBe(3)
  })

  it('re-inserting an existing id does not grow the cache', () => {
    const c = new PayloadCache(3)
    c.setMany([p(1), p(2), p(3)])
    expect(c.setMany([p(2)])).toEqual([])
    expect(c.size).toBe(3)
    expect(c.get(2)?.id).toBe('e_2')
  })

  it('inserting a large island evicts in LRU order until within budget', () => {
    const c = new PayloadCache(4)
    c.setMany([p(1), p(2)])
    const evicted = c.setMany([p(3), p(4), p(5), p(6)])
    expect(evicted).toEqual([1, 2])
    expect(c.size).toBe(4)
    expect([...Array(6).keys()].map((i) => c.has(i + 1))).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ])
  })
})
