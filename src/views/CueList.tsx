import { useEffect, useRef, useState } from 'react'
import type { Transport } from '../audio/useTransport'
import { useStore } from '../data/store'
import { formatClock } from '../lib/format'
import { isStream } from '../data/types'

export default function CueList({
  transport,
  onEdit,
}: {
  transport: Transport
  onEdit: (cueId: string) => void
}) {
  const { show, setStandby, stopCue, fire, moveCue } = useStore()
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const standbyRef = useRef<HTMLLIElement>(null)

  // Keep the standby cue on screen as GO walks down the show.
  useEffect(() => {
    standbyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [show.standby])

  return (
    <ol className="cuelist">
      {show.cues.map((cue, i) => {
        const state = transport.states.get(cue.id)
        const isStandby = i === show.standby
        return (
          <li
            key={cue.id}
            ref={isStandby ? standbyRef : undefined}
            className={[
              'row',
              isStandby ? 'standby' : '',
              state?.playing ? 'playing' : '',
              dragOver === i ? 'dragover' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ ['--pad' as string]: cue.color }}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(i)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDragOver(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null) moveCue(dragFrom, i)
              setDragFrom(null)
              setDragOver(null)
            }}
          >
            {state?.playing && (
              <span className="row-progress" style={{ width: `${Math.round(state.progress * 100)}%` }} aria-hidden />
            )}
            <span className="row-num">{i + 1}</span>
            <button className="row-main" onClick={() => setStandby(i)}>
              <span className="row-name">{cue.name}</span>
              <span className="row-meta">
                {isStream(cue) && <em className="tag spotify">spotify</em>}
                {cue.loop !== 'off' && <em className="tag">{cue.loop === 'seamless' ? 'loop' : 'loop×'}</em>}
                {cue.fadeIn > 0 && <em className="tag">↗{cue.fadeIn}s</em>}
                {cue.fadeOut > 0 && <em className="tag">↘{cue.fadeOut}s</em>}
                {cue.followAction !== 'none' && (
                  <em className="tag follow">
                    {cue.followAction === 'stopAll' ? 'then stop all' : 'then →'}
                    {cue.followDelay !== 0 && ` ${cue.followDelay > 0 ? '+' : ''}${cue.followDelay}s`}
                  </em>
                )}
                <span className="row-time">
                  {state?.playing
                    ? state.looping
                      ? '∞ looping'
                      : `−${formatClock(state.remaining)}`
                    : formatClock(cue.outPoint - cue.inPoint)}
                </span>
              </span>
            </button>
            <div className="row-actions">
              {state?.playing ? (
                <button className="mini stop" onClick={() => stopCue(cue.id)} aria-label={`Stop ${cue.name}`}>
                  ■
                </button>
              ) : (
                <button className="mini play" onClick={() => fire(cue.id)} aria-label={`Play ${cue.name}`}>
                  ▶
                </button>
              )}
              <button className="mini" onClick={() => onEdit(cue.id)} aria-label={`Edit ${cue.name}`}>
                ⋯
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
