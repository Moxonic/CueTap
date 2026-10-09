import { spotify } from '../spotify/player'
import { cueLength, type Cue, type StopMode } from '../data/types'
import { fadeInShape, fadeOutShape } from './fades'
import type { PlayableVoice } from './playable'

/** Envelope/transport tick. 20 steps a second is as smooth as setVolume gets. */
const TICK_MS = 50

/**
 * A playing Spotify cue.
 *
 * Spotify decodes inside a protected pipeline that cannot be connected to an
 * AudioContext, so none of the Web Audio machinery applies: there is no gain
 * node to automate, no second source to crossfade against, and no sample clock
 * to schedule against. Everything here is therefore approximate by construction:
 *
 *  - fades are stepped setVolume calls on a 50ms timer
 *  - looping is a seek back to the in-point, which rebuffers and leaves a gap
 *  - position is extrapolated from the SDK's last state change, with a local
 *    clock covering the moment between a command and the SDK reporting on it
 *
 * The engine treats it like any other voice; the editor is responsible for not
 * offering controls this cannot honour.
 */
export class SpotifyVoice implements PlayableVoice {
  readonly id = crypto.randomUUID()
  readonly cueId: string
  readonly cue: Cue

  stopped = false
  releasing = false
  onEnd: ((v: PlayableVoice) => void) | null = null
  onFollow: ((v: PlayableVoice) => void) | null = null

  private segment: number
  private level: number
  private getMaster: () => number
  private envelope = 1
  private timer: ReturnType<typeof setInterval> | null = null
  private followTimer: ReturnType<typeof setTimeout> | null = null

  /** Local clock: track position (ms) at the last play/seek, and when that landed. */
  private anchorMs = 0
  private anchorAt = 0
  /**
   * When the last play/seek was issued. SDK states from before it describe the
   * previous track or the pre-seek position, and acting on one sends a loop
   * straight back to its in-point.
   */
  private commandAt = 0
  /** Seen this track actually playing since the last command. */
  private sawPlaying = false
  private playing = false
  /** Set while a loop seek is in flight so the tick does not fire it twice. */
  private seeking = false

  private onError: (message: string) => void

  constructor(cue: Cue, getMaster: () => number, onError: (message: string) => void) {
    this.cue = cue
    this.cueId = cue.id
    this.segment = cueLength(cue)
    this.level = cue.gain
    this.getMaster = getMaster
    this.onError = onError
  }

  private get looping(): boolean {
    return this.cue.loop !== 'off'
  }

  private get owns(): boolean {
    return spotify.owner === this.id
  }

  /** cue gain * master * envelope, clamped to what setVolume accepts. */
  private applyVolume(): void {
    if (!this.owns) return
    void spotify.setVolume(Math.max(0, Math.min(1, this.level * this.getMaster() * this.envelope)))
  }

  start(): void {
    spotify.owner = this.id
    this.envelope = this.cue.fadeIn > 0 ? 0 : 1
    this.applyVolume()

    this.commandAt = performance.now()
    void spotify
      .play(this.cue.spotify!.uri, this.cue.inPoint * 1000)
      .then(() => {
        if (this.stopped) {
          // Stopped while the network call was in flight — unless another cue
          // has taken the player since, in which case the audio is theirs.
          if (spotify.owner === null) void spotify.pause()
          return
        }
        this.anchorMs = this.cue.inPoint * 1000
        this.anchorAt = performance.now()
        this.playing = true
        this.applyVolume()
      })
      .catch((e: unknown) => {
        this.onError(String(e instanceof Error ? e.message : e))
        this.finish()
      })

    this.timer = setInterval(() => this.tick(), TICK_MS)

    if (!this.looping && this.cue.followAction !== 'none') {
      this.followTimer = setTimeout(
        () => {
          this.followTimer = null
          this.onFollow?.(this)
        },
        Math.max(0, (this.segment + this.cue.followDelay) * 1000),
      )
    }
  }

  /** Milliseconds into the track. */
  private positionMs(): number {
    const s = spotify.state
    if (s && s.at > this.commandAt && s.uris.includes(this.cue.spotify!.uri)) {
      if (!s.paused) {
        this.sawPlaying = true
        return s.position + (performance.now() - s.at)
      }
      // Spotify parks a track that ran out at 0, paused. Arriving there after
      // playing means the end came before the out-point check caught it.
      if (s.position === 0 && this.sawPlaying) return this.cue.outPoint * 1000
      // Buffering, or paused from elsewhere: the track is not moving, so
      // neither is the cue.
      return s.position
    }
    if (!this.playing) return this.cue.inPoint * 1000
    return this.anchorMs + (performance.now() - this.anchorAt)
  }

  private tick(): void {
    if (this.stopped) return

    // Another Spotify cue has taken the player; this one's audio is gone.
    if (!this.owns) {
      this.finish()
      return
    }

    const elapsed = this.positionMs() / 1000 - this.cue.inPoint

    if (this.releasing) {
      // A release fade is running; the ramp is driven in releaseStep.
      return
    }

    // Scheduled fade in / fade out within the cue.
    if (this.cue.fadeIn > 0 && elapsed < this.cue.fadeIn) {
      this.envelope = fadeInShape(Math.max(0, elapsed) / this.cue.fadeIn)
      this.applyVolume()
    } else if (!this.looping && this.cue.fadeOut > 0 && elapsed > this.segment - this.cue.fadeOut) {
      const t = (elapsed - (this.segment - this.cue.fadeOut)) / this.cue.fadeOut
      this.envelope = fadeOutShape(Math.max(0, Math.min(1, t)))
      this.applyVolume()
    } else if (this.envelope !== 1) {
      this.envelope = 1
      this.applyVolume()
    }

    if (elapsed >= this.segment && this.playing && !this.seeking) {
      if (this.looping) this.loopAround()
      else this.finish()
    }
  }

  private loopAround(): void {
    this.seeking = true
    this.commandAt = performance.now()
    this.sawPlaying = false
    void spotify
      .seek(this.cue.inPoint * 1000)
      // A track that ran to its end is left paused, and a seek alone keeps it there.
      .then(() => spotify.resume())
      .then(() => {
        this.anchorMs = this.cue.inPoint * 1000
        this.anchorAt = performance.now()
        this.seeking = false
      })
  }

  position(): number {
    const p = this.positionMs() / 1000
    if (!this.looping) return Math.min(p, this.cue.outPoint)
    return p
  }

  progress(): number {
    const elapsed = Math.max(0, this.positionMs() / 1000 - this.cue.inPoint)
    return Math.min(1, (elapsed % this.segment) / this.segment)
  }

  remaining(): number {
    if (this.looping && !this.releasing) return Infinity
    return Math.max(0, this.segment - (this.positionMs() / 1000 - this.cue.inPoint))
  }

  setLevel(gain: number): void {
    this.level = gain
    this.applyVolume()
  }

  release(mode?: StopMode, fadeSeconds?: number): void {
    if (this.stopped || this.releasing) return
    const how: StopMode = mode ?? this.cue.onStop

    if (this.followTimer !== null) {
      clearTimeout(this.followTimer)
      this.followTimer = null
    }

    if (how === 'finishPass') {
      // Play out to the out-point, then stop, rather than looping again.
      this.releasing = true
      const left = Math.max(0, this.segment - (this.positionMs() / 1000 - this.cue.inPoint))
      setTimeout(() => this.fadeOutAndStop(Math.min(this.cue.releaseFade, 0.25)), left * 1000)
      return
    }

    this.releasing = true
    this.fadeOutAndStop(how === 'cut' ? 0 : Math.max(0, fadeSeconds ?? this.cue.releaseFade))
  }

  /** Step the volume down over `seconds`, then pause. */
  private fadeOutAndStop(seconds: number): void {
    if (this.stopped) return
    if (seconds <= 0) {
      this.finish()
      return
    }
    const from = this.envelope
    const startedAt = performance.now()
    const step = setInterval(() => {
      if (this.stopped) {
        clearInterval(step)
        return
      }
      if (!this.owns) {
        clearInterval(step)
        this.finish()
        return
      }
      const t = Math.min(1, (performance.now() - startedAt) / (seconds * 1000))
      this.envelope = from * fadeOutShape(t)
      this.applyVolume()
      if (t >= 1) {
        clearInterval(step)
        this.finish()
      }
    }, TICK_MS)
  }

  private finish(): void {
    if (this.stopped) return
    this.stopped = true
    this.playing = false
    if (this.timer !== null) clearInterval(this.timer)
    if (this.followTimer !== null) clearTimeout(this.followTimer)
    this.timer = null
    this.followTimer = null
    if (this.owns) {
      spotify.owner = null
      void spotify.pause().then(() => {
        // Leave the SDK at full volume so the next cue's own envelope starts
        // clean — unless that cue has already started and set its own.
        if (spotify.owner === null) void spotify.setVolume(1)
      })
    }
    this.onEnd?.(this)
  }
}
