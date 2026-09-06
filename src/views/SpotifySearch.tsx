import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../components/controls'
import { useStore } from '../data/store'
import { searchTracks, type TrackHit } from '../spotify/api'
import { isConnected, subscribeAuth } from '../spotify/auth'
import { formatClock } from '../lib/format'
import { SpotifyAccount, SpotifySetup } from './SpotifyConnect'

/**
 * The Spotify window: setup when not connected, account status plus search
 * once connected. Kept as one sheet rather than routing through Settings —
 * everything about Spotify belongs where Spotify itself is used.
 */
export default function SpotifySearch({ onClose }: { onClose: () => void }) {
  const [connected, setConnected] = useState(isConnected())

  useEffect(() => subscribeAuth(() => setConnected(isConnected())), [])

  return (
    <Sheet title="Spotify" onClose={onClose}>
      {connected ? <SpotifyAccount /> : <SpotifySetup />}
      {connected && <SearchPanel onClose={onClose} />}
    </Sheet>
  )
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  const { addSpotifyCues, setError } = useStore()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TrackHit[]>([])
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<TrackHit[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  // Debounced search — typing on a phone would otherwise fire a request per key
  // and hit Spotify's rate limit within a couple of words.
  useEffect(() => {
    if (query.trim().length < 2) {
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
  }, [query, setError])

  const toggle = (t: TrackHit) => {
    setPicked((p) => (p.some((x) => x.uri === t.uri) ? p.filter((x) => x.uri !== t.uri) : [...p, t]))
  }

  const addAll = () => {
    addSpotifyCues(picked)
    onClose()
  }

  return (
    <>
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

      {hits.length > 0 && (
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
      )}

      {picked.length > 0 && (
        <button className="primary" onClick={addAll}>
          Add {picked.length} cue{picked.length === 1 ? '' : 's'}
        </button>
      )}

      <div className="note">
        <p>
          Spotify cues stream at showtime, so they need a working connection and start with about
          half a second to a few seconds of buffering. Good for preshow, interval and playoff
          music; use a local file for anything that has to land on a visual cue.
        </p>
      </div>
    </>
  )
}
