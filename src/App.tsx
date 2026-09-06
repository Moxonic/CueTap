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
import SpotifySearch from './views/SpotifySearch'
import AddCue from './views/AddCue'
import { completeLoginFromRedirect, isConnected, subscribeAuth } from './spotify/auth'
import { spotify } from './spotify/player'
import Transport from './components/Transport'

export type ViewMode = 'pads' | 'list'

export default function App() {
  const store = useStore()
  const transport = useTransport()
  const [armed, setArmed] = useState(false)
  const [view, setView] = useState<ViewMode>('list')
  const [editing, setEditing] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<'none' | 'add' | 'recorder' | 'settings' | 'spotify'>('none')
  const fileInput = useRef<HTMLInputElement>(null)
  const [spotifyOn, setSpotifyOn] = useState(isConnected())

  const { show, error, setError, go, stopAll, panic, importFiles } = store

  useEffect(() => subscribeAuth(() => setSpotifyOn(isConnected())), [])

  // Fetch the Web Playback SDK as soon as Spotify is connected, so arm() can
  // construct and connect the player inside the tap. And surface SDK errors it
  // reports asynchronously — a bad token or a non-Premium account shows up here,
  // after the REST play call has already returned OK.
  useEffect(() => {
    if (!spotifyOn) return
    void spotify.preload()
    return spotify.subscribe(() => {
      if (spotify.error) setError(spotify.error)
    })
  }, [spotifyOn, setError])

  // Spotify sends the browser back here with ?code=...; consume it once on load.
  useEffect(() => {
    completeLoginFromRedirect().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [setError])

  const arm = useCallback(async () => {
    // Kick the Spotify player up first, while the tap is freshest: init() calls
    // activateElement(), which browsers only honour under a live user gesture.
    // Not awaited — the device can take seconds to report ready and a file-only
    // show must not wait. Errors surface through the spotify.subscribe wiring.
    if (isConnected()) void spotify.init().catch(() => {})
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
          <button className="icon" onClick={() => setOverlay('add')} aria-label="Add a cue">
            ＋
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
          <EmptyState onAdd={() => setOverlay('add')} />
        ) : view === 'pads' ? (
          <PadGrid transport={transport} onEdit={setEditing} />
        ) : (
          <CueList transport={transport} onEdit={setEditing} />
        )}
      </main>

      <Transport view={view} transport={transport} onPanic={panic} />

      {editingCue && <CueEditor cue={editingCue} onClose={() => setEditing(null)} />}
      {overlay === 'add' && (
        <AddCue
          onClose={() => setOverlay('none')}
          onFiles={() => {
            // The picker is a native dialog, not React state, so closing the
            // sheet first and opening it after are independent — no batching
            // hazard here, unlike routing to another overlay (see AddCue.tsx).
            setOverlay('none')
            fileInput.current?.click()
          }}
          onSpotify={() => setOverlay('spotify')}
          onRecord={() => setOverlay('recorder')}
          spotifyConnected={spotifyOn}
        />
      )}
      {overlay === 'recorder' && <Recorder onClose={() => setOverlay('none')} />}
      {overlay === 'settings' && <Settings onClose={() => setOverlay('none')} />}
      {overlay === 'spotify' && <SpotifySearch onClose={() => setOverlay('none')} />}

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <h2>No cues yet</h2>
      <p>Add a cue from your phone's files, Spotify, or by recording something.</p>
      <div className="empty-actions">
        <button className="primary" onClick={onAdd}>
          ＋ Add a cue
        </button>
      </div>
    </div>
  )
}
