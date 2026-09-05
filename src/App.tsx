import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from './audio/engine'
import { useTransport } from './audio/useTransport'
import { useStore } from './data/store'
import PadGrid from './views/PadGrid'
import CueList from './views/CueList'
import CueEditor from './views/CueEditor'
import Recorder from './views/Recorder'
import Settings from './views/Settings'
import ArmScreen from './views/ArmScreen'
import Transport from './components/Transport'

export type ViewMode = 'pads' | 'list'

export default function App() {
  const store = useStore()
  const transport = useTransport()
  const [armed, setArmed] = useState(false)
  const [view, setView] = useState<ViewMode>('list')
  const [editing, setEditing] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<'none' | 'recorder' | 'settings'>('none')
  const fileInput = useRef<HTMLInputElement>(null)

  const { show, error, setError, go, stopAll, panic, importFiles } = store

  const arm = useCallback(async () => {
    await engine.unlock()
    if (show.settings.liveMode) await engine.enableLiveMode()
    engine.setMasterGain(show.settings.masterGain)
    setArmed(true)
  }, [show.settings.liveMode, show.settings.masterGain])

  // Browsers suspend the AudioContext when the page is backgrounded, and the
  // screen wake lock is dropped outright. Both need reclaiming on the way back.
  useEffect(() => {
    if (!armed) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void engine.resume()
      if (show.settings.liveMode) void engine.acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [armed, show.settings.liveMode])

  // Bluetooth page-turner pedals present to the OS as a keyboard, so honouring
  // space / arrows gives hands-free GO for free.
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        go()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        stopAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [armed, go, stopAll])

  if (store.loading) return <div className="boot">Loading show…</div>
  if (!armed) return <ArmScreen onArm={arm} cueCount={show.cues.length} showName={show.name} />

  const editingCue = show.cues.find((c) => c.id === editing) ?? null

  return (
    <div className="app">
      <header className="bar top">
        <button
          className="seg"
          onClick={() => setView(view === 'pads' ? 'list' : 'pads')}
          aria-label={`Switch to ${view === 'pads' ? 'list' : 'pad'} view`}
        >
          {view === 'pads' ? '☰ List' : '⊞ Pads'}
        </button>
        <div className="title" onClick={() => setOverlay('settings')}>
          <span className="name">{show.name}</span>
          <span className="sub">
            {show.cues.length} cue{show.cues.length === 1 ? '' : 's'} ·{' '}
            {show.settings.mode === 'exclusive' ? 'one at a time' : 'layered'}
          </span>
        </div>
        <div className="top-actions">
          <button className="icon" onClick={() => fileInput.current?.click()} aria-label="Add audio files">
            ＋
          </button>
          <button className="icon" onClick={() => setOverlay('recorder')} aria-label="Record">
            ●
          </button>
          <button className="icon" onClick={() => setOverlay('settings')} aria-label="Settings">
            ⚙
          </button>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac,.caf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void importFiles(files)
        }}
      />

      <main className="stage">
        {show.cues.length === 0 ? (
          <EmptyState onAdd={() => fileInput.current?.click()} onRecord={() => setOverlay('recorder')} />
        ) : view === 'pads' ? (
          <PadGrid transport={transport} onEdit={setEditing} />
        ) : (
          <CueList transport={transport} onEdit={setEditing} />
        )}
      </main>

      <Transport view={view} transport={transport} onPanic={panic} />

      {editingCue && <CueEditor cue={editingCue} onClose={() => setEditing(null)} />}
      {overlay === 'recorder' && <Recorder onClose={() => setOverlay('none')} />}
      {overlay === 'settings' && <Settings onClose={() => setOverlay('none')} />}

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ onAdd, onRecord }: { onAdd: () => void; onRecord: () => void }) {
  return (
    <div className="empty">
      <h2>No cues yet</h2>
      <p>
        Add audio from your phone. The system file picker also reaches Google Drive, Dropbox and
        OneDrive if those apps are installed.
      </p>
      <div className="empty-actions">
        <button className="primary" onClick={onAdd}>
          Add audio files
        </button>
        <button onClick={onRecord}>Record something</button>
      </div>
    </div>
  )
}
