import { describe, expect, it } from 'vitest'
import { expandOutline, HeightsStore } from '../../src/list/heights'
import { Dataset } from '../../src/mock/dataset'
import { INITIAL_ESTIMATES, type ItemType } from '../../src/list/types'

const all = (n: number, t: ItemType): ItemType[] => Array.from({ length: n }, () => t)

describe('expandOutline', () => {
  it('expands run-length encoding to a flat type array', () => {
    expect(expandOutline([{ type: 'user', count: 3 }, { type: 'code', count: 2 }])).toEqual([
      'user',
      'user',
      'user',
      'code',
      'code',
    ])
    expect(expandOutline([])).toEqual([])
    const ds = new Dataset(42, 5000)
    const types = expandOutline(ds.outline())
    expect(types.length).toBe(5000)
    expect(types[2500]).toBe(ds.typeOf(2500))
  })
})

describe('HeightsStore', () => {
  it('starts every row at its type estimate', () => {
    const hs = new HeightsStore(['user', 'code', 'tool'])
    expect(hs.heightOf(0)).toBe(INITIAL_ESTIMATES.user)
    expect(hs.heightOf(1)).toBe(INITIAL_ESTIMATES.code)
    expect(hs.heightOf(2)).toBe(INITIAL_ESTIMATES.tool)
    expect(hs.isMeasured(1)).toBe(false)
    expect(hs.offsetOf(1)).toBe(INITIAL_ESTIMATES.user)
    expect(hs.total()).toBe(INITIAL_ESTIMATES.user + INITIAL_ESTIMATES.code + INITIAL_ESTIMATES.tool)
  })

  it('measure() records exact heights and reports changes', () => {
    const hs = new HeightsStore(['user', 'user'])
    expect(hs.measure(0, 100)).toBe(true)
    expect(hs.measure(0, 100)).toBe(false) // idempotent
    expect(hs.heightOf(0)).toBe(100)
    expect(hs.isMeasured(0)).toBe(true)
    expect(hs.offsetOf(1)).toBe(100)
    expect(hs.total()).toBe(100 + INITIAL_ESTIMATES.user)
    expect(hs.measure(-1, 10)).toBe(false)
    expect(hs.measure(5, 10)).toBe(false)
  })

  it('calibrate() moves estimates to the median once enough samples exist', () => {
    const hs = new HeightsStore(all(30, 'tool')) // estimate 36
    for (let i = 0; i < 15; i++) hs.measure(i, 40)
    expect(hs.calibrate()).toEqual([]) // below CALIBRATION_MIN_SAMPLES
    hs.measure(15, 40)
    expect(hs.calibrate()).toEqual(['tool']) // 16 samples, |40-36| >= deadband
    expect(hs.estimateOf('tool')).toBe(40)
    expect(hs.calibrate()).toEqual([]) // stable
    // other types untouched
    expect(hs.estimateOf('user')).toBe(INITIAL_ESTIMATES.user)
  })

  it('calibrate() ignores median moves inside the deadband', () => {
    const hs = new HeightsStore(all(30, 'user')) // estimate 56
    for (let i = 0; i < 20; i++) hs.measure(i, 58) // |58-56| = 2 < 4
    expect(hs.calibrate()).toEqual([])
    expect(hs.estimateOf('user')).toBe(56)
  })

  it('flushCalibration() re-bakes unmeasured rows in budgeted batches', () => {
    const hs = new HeightsStore(all(30, 'tool')) // estimate 36
    for (let i = 0; i < 20; i++) hs.measure(i, 44)
    hs.calibrate() // estimate 44; rows 20-29 stale
    expect(hs.flushCalibration(2)).toBe(2) // 2 of the 10 stale rows re-baked
    // rows 20,21 baked at 44; rows 22,23,24 still 36
    expect(hs.offsetOf(25)).toBe(20 * 44 + 2 * 44 + 3 * 36)
    expect(hs.flushCalibration()).toBe(8) // the remaining 8
    expect(hs.offsetOf(25)).toBe(25 * 44)
    expect(hs.total()).toBe(30 * 44)
  })

  it('flushCalibration() never touches measured rows', () => {
    const hs = new HeightsStore(all(30, 'tool'))
    for (let i = 0; i < 10; i++) hs.measure(i, 60)
    for (let i = 0; i < 10; i++) hs.measure(i, 50) // ring: 10x60 + 10x50 -> median 55
    hs.calibrate()
    expect(hs.estimateOf('tool')).toBe(55)
    hs.flushCalibration()
    expect(hs.heightOf(0)).toBe(50) // exact, not the estimate
    expect(hs.offsetOf(1)).toBe(50)
    expect(hs.total()).toBe(10 * 50 + 20 * 55)
  })

  it('scales to a 200k-row outline', () => {
    const ds = new Dataset(42, 200_000)
    const types = expandOutline(ds.outline())
    const hs = new HeightsStore(types)
    expect(hs.n).toBe(200_000)
    expect(hs.total()).toBeGreaterThan(0)
    expect(hs.offsetOf(100_000)).toBeGreaterThan(0)
    expect(hs.indexAtOffset(hs.total() - 1)).toBe(199_999)
    expect(hs.flushCalibration()).toBe(0) // nothing stale yet
  })
})
