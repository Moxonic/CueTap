import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { engine } from '../audio/engine'
import { cacheBuffer, computePeaks, decodeArrayBuffer, evict } from '../audio/decode'
import * as db from './db'
import { makeCue, migrateShow, newShow, type Cue, type Show, type ShowSettings } from './types'
import type { TrackHit } from '../spotify/api'

interface StoreValue {
  show: Show
  loading: boolean
  error: string | null
  setError: (e: string | null) => void

  fire: (cueId: string) => void
  /** Pad behaviour: honours settings.padTrigger for a cue that is already playing. */
  tapPad: (cueId: string) => void
  stopCue: (cueId: string) => void
  stopAll: () => void
  panic: () => void
  go: () => void
  setStandby: (index: number) => void

  importFiles: (files: File[]) => Promise<void>
  importBlob: (blob: Blob, name: string) => Promise<Cue | null>
  addSpotifyCues: (tracks: TrackHit[]) => void
  updateCue: (id: string, patch: Partial<Cue>) => void
  deleteCue: (id: string) => void
  moveCue: (from: number, to: number) => void
  updateSettings: (patch: Partial<ShowSettings>) => void
  renameShow: (name: string) => void
  clearShow: () => Promise<void>
}

const Ctx = createContext<StoreValue | null>(null)

export function useStore(): StoreValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore must be used inside <StoreProvider>')
  return v
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, 60) || 'Cue'
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [show, setShow] = useState<Show>(() => newShow())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The follow-on callback fires from an audio timer, long after render, so it
  // needs the live show rather than the one captured at subscribe time.
  const showRef = useRef(show)
  showRef.current = show

  // --- load / persist -------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const saved = await db.loadShow()
        if (!cancelled && saved) setShow(migrateShow({ ...newShow(), ...saved }))
      } catch (e) {
        if (!cancelled) setError(`Could not load the saved show: ${String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => {
      void db.saveShow(show).catch((e) => setError(`Could not save the show: ${String(e)}`))
    }, 300)
    return () => clearTimeout(t)
  }, [show, loading])

  useEffect(() => {
    engine.setMasterGain(show.settings.masterGain)
  }, [show.settings.masterGain])

  // --- firing ---------------------------------------------------------------

  const fireCue = useCallback((cue: Cue) => {
    void engine.fire(cue, showRef.current.settings).then((v) => {
      if (!v) setError(`"${cue.name}" could not be played — its audio is missing from storage.`)
    })
  }, [])

  const fire = useCallback(
    (cueId: string) => {
      const cue = showRef.current.cues.find((c) => c.id === cueId)
      if (cue) fireCue(cue)
    },
    [fireCue],
  )

  const tapPad = useCallback(
    (cueId: string) => {
      const s = showRef.current
      const cue = s.cues.find((c) => c.id === cueId)
      if (!cue) return
      if (engine.isPlaying(cueId) && s.settings.padTrigger === 'toggle') {
        engine.stopCue(cueId)
        return
      }
      fireCue(cue)
    },
    [fireCue],
  )

  const stopCue = useCallback((cueId: string) => engine.stopCue(cueId), [])
  const stopAll = useCallback(() => engine.stopAll(showRef.current.settings.globalRelease), [])
  const panic = useCallback(() => engine.panic(), [])

  const setStandby = useCallback((index: number) => {
    setShow((s) => ({ ...s, standby: Math.max(0, Math.min(index, Math.max(0, s.cues.length - 1))) }))
  }, [])

  const go = useCallback(() => {
    const s = showRef.current
    const cue = s.cues[s.standby]
    if (!cue) return
    fireCue(cue)
    setShow((prev) => ({ ...prev, standby: Math.min(prev.standby + 1, Math.max(0, prev.cues.length - 1)) }))
  }, [fireCue])

  // Follow-on actions resolve against the show, so they live here rather than in
  // the engine, which knows nothing about cue order.
  useEffect(() => {
    engine.onFollow = ({ cue }) => {
      const s = showRef.current
      const index = s.cues.findIndex((c) => c.id === cue.id)
      switch (cue.followAction) {
        case 'stopAll':
          engine.stopAll(s.settings.globalRelease)
          break
        case 'next': {
          const nxt = s.cues[index + 1]
          if (nxt) {
            fireCue(nxt)
            setShow((prev) => ({ ...prev, standby: Math.min(index + 2, Math.max(0, prev.cues.length - 1)) }))
          }
          break
        }
        case 'goto': {
          const target = s.cues.find((c) => c.id === cue.followTarget)
          if (target) {
            fireCue(target)
            const ti = s.cues.indexOf(target)
            setShow((prev) => ({ ...prev, standby: Math.min(ti + 1, Math.max(0, prev.cues.length - 1)) }))
          }
          break
        }
        default:
          break
      }
    }
    return () => {
      engine.onFollow = null
    }
  }, [fireCue])

  // --- library --------------------------------------------------------------

  const ingest = useCallback(async (blob: Blob, name: string, indexHint: number): Promise<Cue> => {
    if (!engine.ctx) throw new Error('audio engine is not started')
    const audioId = crypto.randomUUID()
    const buffer = await decodeArrayBuffer(engine.ctx, await blob.arrayBuffer())
    await db.putAudio(audioId, blob)
    cacheBuffer(audioId, buffer)
    return makeCue(
      { name, audioId, duration: buffer.duration, peaks: computePeaks(buffer) },
      indexHint,
    )
  }, [])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      void db.requestPersistence()
      const added: Cue[] = []
      const failed: string[] = []
      const start = showRef.current.cues.length
      for (const file of files) {
        try {
          added.push(await ingest(file, baseName(file.name), start + added.length))
        } catch {
          failed.push(file.name)
        }
      }
      if (added.length) setShow((s) => ({ ...s, cues: [...s.cues, ...added] }))
      if (failed.length) {
        setError(
          `Could not decode ${failed.length} file${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}. ` +
            `Try MP3, M4A/AAC, WAV or OGG.`,
        )
      }
    },
    [ingest],
  )

  const importBlob = useCallback(
    async (blob: Blob, name: string): Promise<Cue | null> => {
      void db.requestPersistence()
      try {
        const cue = await ingest(blob, name, showRef.current.cues.length)
        setShow((s) => ({ ...s, cues: [...s.cues, cue] }))
        return cue
      } catch (e) {
        setError(`Could not save the recording: ${String(e)}`)
        return null
      }
    },
    [ingest],
  )

  /**
   * Spotify cues carry no blob and no waveform — the track lives on Spotify and
   * is addressed by URI, so there is nothing to store locally beyond the
   * reference and the cue's own settings.
   */
  const addSpotifyCues = useCallback((tracks: TrackHit[]) => {
    if (tracks.length === 0) return
    setShow((s) => {
      const added = tracks.map((t, i) =>
        makeCue(
          {
            name: `${t.title} — ${t.artist}`,
            source: 'spotify',
            spotify: { uri: t.uri, title: t.title, artist: t.artist, artworkUrl: t.artworkUrl },
            audioId: '',
            duration: t.durationMs / 1000,
            peaks: [],
          },
          s.cues.length + i,
        ),
      )
      return { ...s, cues: [...s.cues, ...added] }
    })
  }, [])

  // Streaming failures surface at fire time (network, token, Premium), long
  // after the cue was created, so they need a channel to the UI.
  useEffect(() => {
    engine.onStreamError = (msg) => setError(msg)
    return () => {
      engine.onStreamError = null
    }
  }, [])

  const updateCue = useCallback((id: string, patch: Partial<Cue>) => {
    setShow((s) => ({ ...s, cues: s.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
    // Volume is the one edit that should be audible immediately on a playing cue.
    if (patch.gain !== undefined) engine.setCueLevel(id, patch.gain)
  }, [])

  const deleteCue = useCallback((id: string) => {
    engine.stopCue(id, 'cut')
    const current = showRef.current
    const cue = current.cues.find((c) => c.id === id)
    const remaining = current.cues.filter((c) => c.id !== id)

    // Reclaim the blob only when no other cue still points at it. Done outside
    // the state updater — React may invoke that more than once per call.
    if (cue && !remaining.some((c) => c.audioId === cue.audioId)) {
      evict(cue.audioId)
      void db.deleteAudio(cue.audioId)
    }

    setShow((s) => {
      const cues = s.cues.filter((c) => c.id !== id)
      return { ...s, cues, standby: Math.max(0, Math.min(s.standby, cues.length - 1)) }
    })
  }, [])

  const moveCue = useCallback((from: number, to: number) => {
    setShow((s) => {
      if (from === to || from < 0 || from >= s.cues.length) return s
      const cues = [...s.cues]
      const [item] = cues.splice(from, 1)
      cues.splice(Math.max(0, Math.min(to, cues.length)), 0, item)
      return { ...s, cues }
    })
  }, [])

  const updateSettings = useCallback((patch: Partial<ShowSettings>) => {
    setShow((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  }, [])

  const renameShow = useCallback((name: string) => setShow((s) => ({ ...s, name })), [])

  const clearShow = useCallback(async () => {
    engine.panic()
    const fresh = newShow()
    setShow(fresh)
    await db.saveShow(fresh)
    await db.pruneOrphanAudio(fresh)
  }, [])

  // The engine has no context until the arm screen is tapped, so priming has to
  // wait for that as well as for the show to load.
  const [engineReady, setEngineReady] = useState(engine.ready)
  useEffect(() => engine.subscribe(() => setEngineReady(engine.ready)), [])

  // Decode everything up front so the first tap on any pad is instant rather
  // than waiting on IndexedDB and a decode.
  useEffect(() => {
    if (loading || !engineReady) return
    void engine.primeAll(show.cues.filter((c) => c.source !== 'spotify'))
    // Only when the set of audio files changes, not on every cue edit.
  }, [loading, engineReady, show.cues.map((c) => c.audioId).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<StoreValue>(
    () => ({
      show,
      loading,
      error,
      setError,
      fire,
      tapPad,
      stopCue,
      stopAll,
      panic,
      go,
      setStandby,
      importFiles,
      importBlob,
      addSpotifyCues,
      updateCue,
      deleteCue,
      moveCue,
      updateSettings,
      renameShow,
      clearShow,
    }),
    [
      show,
      loading,
      error,
      fire,
      tapPad,
      stopCue,
      stopAll,
      panic,
      go,
      setStandby,
      importFiles,
      importBlob,
      addSpotifyCues,
      updateCue,
      deleteCue,
      moveCue,
      updateSettings,
      renameShow,
      clearShow,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
