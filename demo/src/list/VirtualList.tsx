/** The virtualized list: scroller + spacers + mounted rows. */
import type { ReactNode } from 'react'
import type { MockApi } from '../mock/api'
import { Row } from '../rows/Row'
import { useVirtualList } from './useVirtualList'

export default function VirtualList({ api }: { api: MockApi }) {
  const v = useVirtualList(api)
  const hs = v.heights

  const rows: ReactNode[] = []
  if (hs) {
    for (let i = v.mountedStart; i <= v.mountedEnd; i++) {
      rows.push(
        <Row key={i} index={i} type={hs.typeOf(i)} payload={v.payloadOf(i)} height={hs.heightOf(i)} />,
      )
    }
  }

  return (
    <div className="vlist-wrap">
      <div className="vlist-status">
        <span>
          {v.n.toLocaleString()} items · {v.loadedCount} loaded · {rows.length} mounted
        </span>
        <span className={`mode-badge mode-${v.mode}`}>{v.mode}</span>
      </div>
      <div className="vlist" ref={v.setScroller} onScroll={v.onScroll}>
        {v.ready ? (
          <div className="vlist-inner">
            <div className="vlist-spacer" style={{ height: v.topSpacer }} />
            {rows}
            <div className="vlist-spacer" style={{ height: v.bottomSpacer }} />
          </div>
        ) : (
          <div className="vlist-boot">loading outline…</div>
        )}
      </div>
    </div>
  )
}
