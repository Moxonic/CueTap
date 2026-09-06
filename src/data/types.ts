export type LoopMode = 'off' | 'seamless' | 'crossfade'

/** What happens to a playing voice when something asks it to stop. */
export type StopMode =
  | 'cut' // hard stop (still gets a 15ms de-click ramp)
  | 'fade' // ramp down over releaseFade
  | 'finishPass' // loops only: play out the current pass, then fade

export type FollowAction = 'none' | 'stopAll' | 'next' | 'goto'

/**
 * Where a cue's audio comes from.
 *
 * 'file' cues run through the Web Audio engine and get everything it offers.
 * 'spotify' cues are played by Spotify's own SDK through a protected pipeline
 * that cannot be routed into an AudioContext, so they are limited to what the
 * SDK exposes: volume, seek, play, pause. See STREAM_LIMITS below.
 */
export type CueSource = 'file' | 'spotify'

export interface SpotifyRef {
  /** spotify:track:... */
  uri: string
  title: string
  artist: string
  artworkUrl?: string
}

export interface Cue {
  id: string
  name: string
  color: string
  source: CueSource
  /** key into the IndexedDB audio blob store; empty for streaming cues */
  audioId: string
  /** set only when source is 'spotify' */
  spotify?: SpotifyRef
  /** full length of the source, seconds */
  duration: number
  /** normalised 0..1 waveform peaks; empty for streaming cues, which expose no waveform */
  peaks: number[]

  /** linear gain, 0..2 (edited in dB in the UI) */
  gain: number
  inPoint: number
  outPoint: number
  fadeIn: number
  /** applied so that it lands exactly on outPoint */
  fadeOut: number

  loop: LoopMode
  loopCrossfade: number
  onStop: StopMode
  releaseFade: number

  followAction: FollowAction
  followTarget?: string
  /** seconds after the cue ends; negative overlaps into the follow cue */
  followDelay: number

  /** null = inherit the show's global mode */
  exclusiveOverride: boolean | null
}

/** What tapping a pad that is already playing does. */
export type PadTrigger =
  | 'toggle' // stop it (right for loops and beds)
  | 'restart' // stop and fire again from the top
  | 'stack' // let it layer on itself (right for one-shot effects)

export interface ShowSettings {
  /** exclusive = one cue at a time; poly = cues stack */
  mode: 'exclusive' | 'poly'
  padTrigger: PadTrigger
  gridCols: number
  gridRows: number
  masterGain: number
  /** release used by STOP ALL and by exclusive-mode takeovers */
  globalRelease: number
  /** wake lock + silent keepalive */
  liveMode: boolean
}

export interface Show {
  id: string
  name: string
  cues: Cue[]
  settings: ShowSettings
  /** index of the standby cue in the list view */
  standby: number
}

export const DEFAULT_SETTINGS: ShowSettings = {
  mode: 'exclusive',
  padTrigger: 'toggle',
  gridCols: 3,
  gridRows: 4,
  masterGain: 1,
  globalRelease: 1.5,
  liveMode: true,
}

export const PAD_COLORS = [
  '#ff9d2e',
  '#ff5f6d',
  '#c15cff',
  '#4d8dff',
  '#22c7b8',
  '#5ed14b',
  '#ffd23f',
  '#8c93a1',
]

export function newShow(): Show {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled show',
    cues: [],
    settings: { ...DEFAULT_SETTINGS },
    standby: 0,
  }
}

/**
 * What a streaming cue cannot do, and why. Kept next to the model so the editor
 * and the docs cannot drift from the engine's actual behaviour.
 */
export const STREAM_LIMITS = {
  /** No second player instance exists, so there is nothing to cross into. */
  crossfadeLoop: 'Spotify has one player, so there is no second voice to crossfade into.',
  /** Looping is a seek, which rebuffers. */
  seamlessLoop: 'Looping seeks back to the in-point, which leaves a short audible gap.',
  /** Audio never enters the AudioContext, so fades are stepped setVolume calls. */
  fades: 'Fades are stepped volume changes rather than sample-accurate ramps.',
  /** Only one Spotify stream can sound at once. */
  layering: 'Only one Spotify cue can play at a time; it cannot layer with another Spotify cue.',
} as const

export function makeCue(
  partial: Pick<Cue, 'name' | 'audioId' | 'duration' | 'peaks'> & Partial<Pick<Cue, 'source' | 'spotify'>>,
  index: number,
): Cue {
  return {
    id: crypto.randomUUID(),
    color: PAD_COLORS[index % PAD_COLORS.length],
    source: 'file',
    gain: 1,
    inPoint: 0,
    outPoint: partial.duration,
    fadeIn: 0,
    fadeOut: 0,
    loop: 'off',
    loopCrossfade: 0.25,
    onStop: 'fade',
    releaseFade: 0.6,
    followAction: 'none',
    followDelay: 0,
    exclusiveOverride: null,
    ...partial,
  }
}

/** The audible span of a cue, in seconds. */
export function cueLength(cue: Cue): number {
  return Math.max(0.01, cue.outPoint - cue.inPoint)
}

export function isExclusive(cue: Cue, settings: ShowSettings): boolean {
  return cue.exclusiveOverride ?? settings.mode === 'exclusive'
}

/** Streaming cues have no waveform and cannot use the crossfade loop. */
export function isStream(cue: Cue): boolean {
  return cue.source === 'spotify'
}

/**
 * Shows saved before streaming cues existed have no `source` field. Normalise on
 * load so nothing downstream has to guard for it.
 */
export function migrateShow(show: Show): Show {
  return {
    ...show,
    cues: show.cues.map((c) => ({
      ...c,
      source: c.source ?? 'file',
      peaks: c.peaks ?? [],
      // A file cue that lost its crossfade support would be a regression, but a
      // stream cue can never honour one, so fold it back to a plain loop.
      loop: c.source === 'spotify' && c.loop === 'crossfade' ? 'seamless' : c.loop,
    })),
  }
}
