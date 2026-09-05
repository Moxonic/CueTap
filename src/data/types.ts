export type LoopMode = 'off' | 'seamless' | 'crossfade'

/** What happens to a playing voice when something asks it to stop. */
export type StopMode =
  | 'cut' // hard stop (still gets a 15ms de-click ramp)
  | 'fade' // ramp down over releaseFade
  | 'finishPass' // loops only: play out the current pass, then fade

export type FollowAction = 'none' | 'stopAll' | 'next' | 'goto'

export interface Cue {
  id: string
  name: string
  color: string
  /** key into the IndexedDB audio blob store */
  audioId: string
  /** full length of the source file, seconds */
  duration: number
  /** normalised 0..1 waveform peaks, precomputed at import */
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

export function makeCue(partial: Pick<Cue, 'name' | 'audioId' | 'duration' | 'peaks'>, index: number): Cue {
  return {
    id: crypto.randomUUID(),
    color: PAD_COLORS[index % PAD_COLORS.length],
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
