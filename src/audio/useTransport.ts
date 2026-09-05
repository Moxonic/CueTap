import { useEffect, useState } from 'react'
import { engine } from './engine'

export interface CueState {
  playing: boolean
  /** 0..1 through the current pass */
  progress: number
  /** seconds left; Infinity while looping */
  remaining: number
  position: number
  looping: boolean
  releasing: boolean
  voices: number
}

export interface Transport {
  states: Map<string, CueState>
  anyPlaying: boolean
}

const EMPTY: Transport = { states: new Map(), anyPlaying: false }

function snapshot(): Transport {
  const voices = engine.activeVoices()
  const states = new Map<string, CueState>()
  for (const v of voices) {
    const prev = states.get(v.cueId)
    const s: CueState = {
      playing: true,
      progress: v.progress(),
      remaining: v.remaining(),
      position: v.position(),
      looping: v.cue.loop !== 'off',
      releasing: v.releasing,
      voices: (prev?.voices ?? 0) + 1,
    }
    // When a cue is stacked, report the voice that has the most left to run.
    if (!prev || s.remaining > prev.remaining) states.set(v.cueId, s)
    else states.set(v.cueId, { ...prev, voices: s.voices })
  }
  return { states, anyPlaying: voices.length > 0 }
}

/**
 * Playback state for the UI, polled on an animation frame but throttled — 60fps
 * React renders of the whole cue list would cost more battery than they buy in
 * smoothness, and progress bars read fine at ~15fps.
 */
export function useTransport(): Transport {
  const [state, setState] = useState<Transport>(EMPTY)

  useEffect(() => {
    let raf = 0
    let last = 0
    let alive = true

    const tick = (now: number) => {
      if (!alive) return
      if (now - last > 62) {
        last = now
        setState(snapshot())
      }
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const unsub = engine.subscribe(() => {
      setState(snapshot())
      start()
    })
    start()

    return () => {
      alive = false
      unsub()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return state
}
