/** One skeleton component per ItemType — shape approximates the real row. */
import type { ComponentType } from 'react'
import type { ItemType } from '../list/types'

function UserSkeleton() {
  return (
    <div className="sk">
      <div className="sk-line" style={{ width: '62%' }} />
      <div className="sk-line" style={{ width: '88%' }} />
    </div>
  )
}

function AssistantSkeleton() {
  return (
    <div className="sk">
      {[0, 1, 2].map((p) => (
        <div className="sk-para" key={p}>
          <div className="sk-line" style={{ width: '96%' }} />
          <div className="sk-line" style={{ width: '71%' }} />
        </div>
      ))}
    </div>
  )
}

function ToolSkeleton() {
  return (
    <div className="sk">
      <div className="sk-line sk-thin" style={{ width: '42%' }} />
    </div>
  )
}

function CodeSkeleton() {
  const widths = ['90%', '74%', '83%', '60%', '88%', '52%']
  return (
    <div className="sk sk-mono">
      {widths.map((w, k) => (
        <div className="sk-line" key={k} style={{ width: w }} />
      ))}
    </div>
  )
}

function ImageSkeleton() {
  return (
    <div className="sk">
      <div className="sk-image">image</div>
    </div>
  )
}

function DiffSkeleton() {
  const widths = ['46%', '68%', '58%', '72%', '40%']
  return (
    <div className="sk sk-mono">
      {widths.map((w, k) => (
        <div className="sk-line sk-thin" key={k} style={{ width: w }} />
      ))}
    </div>
  )
}

export const SKELETONS: Record<ItemType, ComponentType> = {
  user: UserSkeleton,
  assistant: AssistantSkeleton,
  tool: ToolSkeleton,
  code: CodeSkeleton,
  image: ImageSkeleton,
  diff: DiffSkeleton,
}
