import type { ViewMode } from '../App'
import type { Transport as TransportState } from '../audio/useTransport'
import { useStore } from '../data/store'
import { formatClock } from '../lib/format'

export default function Transport({
  view,
  transport,
  onPanic,
}: {
  view: ViewMode
  transport: TransportState
  onPanic: () => void
}) {
  const { show, go, stopAll } = useStore()
  const standby = show.cues[show.standby]
  const playing = [...transport.states.entries()].filter(([, s]) => s.playing)

  return (
    <footer className="bar bottom">
      {playing.length > 0 && (
        <div className="now">
          {playing.slice(0, 3).map(([id, s]) => {
            const cue = show.cues.find((c) => c.id === id)
            if (!cue) return null
            return (
              <span key={id} className="now-chip" style={{ ['--pad' as string]: cue.color }}>
                <b>{cue.name}</b>
                {s.looping ? '∞' : `−${formatClock(s.remaining)}`}
              </span>
            )
          })}
          {playing.length > 3 && <span className="now-chip more">+{playing.length - 3}</span>}
        </div>
      )}

      <div className="transport">
        <button
          className="stopall"
          onClick={stopAll}
          onDoubleClick={onPanic}
          aria-label="Stop all cues"
          title={`Fade everything out over ${show.settings.globalRelease}s. Double-tap to cut instantly.`}
        >
          <span>STOP</span>
          <small>ALL</small>
        </button>

        {view === 'list' ? (
          <button className="go" onClick={go} disabled={!standby}>
            <span className="go-label">GO</span>
            <span className="go-next">{standby ? standby.name : 'End of show'}</span>
          </button>
        ) : (
          <div className="pad-hint">
            <span className="go-label small">Tap a pad to fire</span>
            <span className="go-next">
              {show.settings.mode === 'exclusive' ? 'One cue at a time' : 'Cues layer'} · hold a pad to edit
            </span>
          </div>
        )}
      </div>
    </footer>
  )
}
