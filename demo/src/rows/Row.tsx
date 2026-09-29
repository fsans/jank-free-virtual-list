/** A single list row: real content when loaded, skeleton at reserved height otherwise. */
import { memo } from 'react'
import type { CSSProperties } from 'react'
import type { ItemType, Payload } from '../list/types'
import { REAL } from './real'
import { SKELETONS } from './skeletons'

const NO_STYLE: CSSProperties = {}

interface RowProps {
  index: number
  type: ItemType
  payload: Payload | undefined
  /** Reserved height (estimate or measured) — used when the row is a skeleton. */
  height: number
}

export const Row = memo(function Row({ index, type, payload, height }: RowProps) {
  const Real = REAL[type]
  const Skeleton = SKELETONS[type]
  return (
    <div
      className={`row row-${type}${payload ? ' row-loaded' : ''}`}
      data-vrow={index}
      style={payload ? NO_STYLE : { height }}
    >
      <div className="row-gutter">
        <span className={`badge badge-${type}`}>{type}</span>
        <span className="row-no">#{index + 1}</span>
      </div>
      <div className="row-body">
        {payload ? <Real payload={payload} /> : <Skeleton />}
      </div>
    </div>
  )
})
