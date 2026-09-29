import { describe, expect, it } from 'vitest'
import { pickAnchor } from '../../src/list/anchor'

describe('pickAnchor', () => {
  it('returns the topmost visible LOADED row', () => {
    const visible = [
      { index: 5, loaded: false },
      { index: 6, loaded: true },
      { index: 7, loaded: true },
    ]
    expect(pickAnchor(visible)).toEqual({ index: 6, kind: 'loaded' })
  })

  it('falls back to the topmost visible skeleton when nothing is loaded', () => {
    const visible = [
      { index: 5, loaded: false },
      { index: 6, loaded: false },
    ]
    expect(pickAnchor(visible)).toEqual({ index: 5, kind: 'skeleton' })
  })

  it('a partially visible top row still counts and wins as a loaded anchor', () => {
    // only 10px of row 0 pokes into the viewport, but it is visible and loaded
    expect(pickAnchor([{ index: 0, loaded: true }])).toEqual({ index: 0, kind: 'loaded' })
    // partially visible skeleton on top, loaded row below -> loaded wins
    expect(
      pickAnchor([
        { index: 0, loaded: false },
        { index: 1, loaded: true },
      ]),
    ).toEqual({ index: 1, kind: 'loaded' })
  })

  it('returns null for an empty viewport', () => {
    expect(pickAnchor([])).toBeNull()
  })
})
