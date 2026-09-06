import type { Cue, StopMode } from '../data/types'

/**
 * What the engine needs from a playing cue, regardless of where its audio comes
 * from. `Voice` implements this over Web Audio; `SpotifyVoice` implements it over
 * the Spotify SDK. Keeping the engine to this surface is what lets STOP ALL,
 * exclusive mode and follow-on work across both without special cases.
 */
export interface PlayableVoice {
  readonly id: string
  readonly cueId: string
  readonly cue: Cue
  stopped: boolean
  releasing: boolean
  onEnd: ((v: PlayableVoice) => void) | null
  onFollow: ((v: PlayableVoice) => void) | null

  start(when?: number): void
  release(mode?: StopMode, fadeSeconds?: number): void
  /** seconds into the source that is currently sounding */
  position(): number
  /** 0..1 through the current pass */
  progress(): number
  /** seconds until the cue ends; Infinity while looping freely */
  remaining(): number
  setLevel(gain: number): void
}
