import { useRef, useState } from 'react'
import type { Transport } from '../audio/useTransport'
import { useStore } from '../data/store'
import { formatClock } from '../lib/format'
import SpotifyMark from '../components/SpotifyMark'
import { isStream, type Cue } from '../data/types'

const LONG_PRESS_MS = 450

export default function PadGrid({
  transport,
  onEdit,
}: {
  transport: Transport
  onEdit: (cueId: string) => void
}) {
  const { show, tapPad } = useStore()
  const { gridCols, gridRows } = show.settings
  const slots = Math.max(gridCols * gridRows, show.cues.length)

  return (
    <div
      className="pads"
      // The column count is expressed as a minimum pad size rather than a fixed
      // track count, so the grid can add columns in landscape and on tablets
      // while keeping the pads the size the user asked for. See styles.css.
      style={{ ['--cols' as string]: gridCols }}
      // A pad grid should never scroll-bounce or text-select under a fast hand.
      onContextMenu={(e) => e.preventDefault()}
    >
      {Array.from({ length: slots }, (_, i) => {
        const cue = show.cues[i]
        if (!cue) return <div key={`empty-${i}`} className="pad empty" aria-hidden />
        return (
          <Pad
            key={cue.id}
            cue={cue}
            state={transport.states.get(cue.id)}
            onTrigger={() => tapPad(cue.id)}
            onEdit={() => onEdit(cue.id)}
          />
        )
      })}
    </div>
  )
}

function Pad({
  cue,
  state,
  onTrigger,
  onEdit,
}: {
  cue: Cue
  state: ReturnType<Transport['states']['get']>
  onTrigger: () => void
  onEdit: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const [held, setHeld] = useState(false)

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setHeld(false)
  }

  // Trigger on pointerdown, not click: click waits for the gesture to resolve and
  // costs enough latency to be felt on a spot effect.
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    fired.current = false
    setHeld(true)
    timer.current = setTimeout(() => {
      fired.current = true
      clear()
      onEdit()
    }, LONG_PRESS_MS)
  }

  const up = (e: React.PointerEvent) => {
    e.preventDefault()
    clear()
    if (!fired.current) onTrigger()
  }

  const playing = state?.playing ?? false
  const pct = playing ? Math.round((state?.progress ?? 0) * 100) : 0

  return (
    <button
      className={`pad${playing ? ' playing' : ''}${held ? ' held' : ''}${state?.releasing ? ' releasing' : ''}`}
      style={{ ['--pad' as string]: cue.color }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={clear}
      onPointerLeave={clear}
    >
      <span className="pad-fill" style={{ width: `${pct}%` }} aria-hidden />
      <span className="pad-name">{cue.name}</span>
      <span className="pad-meta">
        {playing ? (
          <>
            {state?.looping ? '∞' : formatClock(state?.remaining ?? 0)}
            {(state?.voices ?? 1) > 1 && <em> ×{state?.voices}</em>}
          </>
        ) : (
          <>
            {isStream(cue) && (
              <em className="tag spotify">
                <SpotifyMark size={11} mono />
              </em>
            )}
            {cue.loop !== 'off' && <em className="tag">loop</em>}
            {cue.followAction !== 'none' && <em className="tag">follow</em>}
            {formatClock(cue.outPoint - cue.inPoint)}
          </>
        )}
      </span>
    </button>
  )
}
