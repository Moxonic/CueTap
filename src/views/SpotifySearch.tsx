import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../components/controls'
import { useStore } from '../data/store'
import { searchTracks, type TrackHit } from '../spotify/api'
import { isConnected } from '../spotify/auth'
import { formatClock } from '../lib/format'
import SpotifyMark from '../components/SpotifyMark'

export default function SpotifySearch({
  onClose,
  onNeedsSetup,
}: {
  onClose: () => void
  onNeedsSetup: () => void
}) {
  const { addSpotifyCues, setError } = useStore()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TrackHit[]>([])
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<TrackHit[]>([])
  const input = useRef<HTMLInputElement>(null)
  const connected = isConnected()

  useEffect(() => {
    input.current?.focus()
  }, [])

  // Debounced search — typing on a phone would otherwise fire a request per key
  // and hit Spotify's rate limit within a couple of words.
  useEffect(() => {
    if (!connected || query.trim().length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    setBusy(true)
    const t = setTimeout(() => {
      void searchTracks(query)
        .then((r) => {
          if (!cancelled) setHits(r)
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, connected, setError])

  const toggle = (t: TrackHit) => {
    setPicked((p) => (p.some((x) => x.uri === t.uri) ? p.filter((x) => x.uri !== t.uri) : [...p, t]))
  }

  const addAll = () => {
    addSpotifyCues(picked)
    onClose()
  }

  if (!connected) {
    return (
      <Sheet title="Add from Spotify" onClose={onClose}>
        <div className="stream-banner">
          <SpotifyMark size={18} />
          <span>Not connected</span>
        </div>
        <div className="note">
          <p>
            <b>Not connected to Spotify.</b> Connect your account in Settings first — it needs a
            Spotify Premium account and a Client ID from your own Spotify developer app.
          </p>
        </div>
        <button className="primary" onClick={onNeedsSetup}>
          Open Spotify settings
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet
      title="Add from Spotify"
      onClose={onClose}
      actions={
        picked.length > 0 ? (
          <button className="primary mini-wide" onClick={addAll}>
            Add {picked.length}
          </button>
        ) : undefined
      }
    >
      <input
        ref={input}
        className="name-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Spotify for a track…"
        enterKeyHint="search"
      />

      {busy && <div className="hint">Searching…</div>}

      {!busy && query.trim().length >= 2 && hits.length === 0 && (
        <div className="hint">No tracks found.</div>
      )}

      <ul className="hits">
        {hits.map((t) => {
          const on = picked.some((x) => x.uri === t.uri)
          return (
            <li key={t.uri}>
              <button className={`hit${on ? ' on' : ''}`} onClick={() => toggle(t)}>
                {t.artworkUrl ? (
                  <img src={t.artworkUrl} alt="" width={44} height={44} />
                ) : (
                  <span className="hit-art" />
                )}
                <span className="hit-text">
                  <b>{t.title}</b>
                  <em>{t.artist}</em>
                </span>
                <span className="hit-time">{formatClock(t.durationMs / 1000)}</span>
                <span className="hit-check">{on ? '✓' : '+'}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="note">
        <p>
          Spotify cues stream at showtime, so they need a working connection and start with about
          half a second to a few seconds of buffering. Good for preshow, interval and playoff
          music; use a local file for anything that has to land on a visual cue.
        </p>
      </div>
    </Sheet>
  )
}
