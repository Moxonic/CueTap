import { DECLICK, fadeIn as rampIn, fadeOut as rampOut, fadeInShape, fadeOutShape, rampShaped } from './fades'
import { cueLength, type Cue, type StopMode } from '../data/types'
import type { PlayableVoice } from './playable'

/** How far ahead the crossfade-loop scheduler queues passes. */
const LOOKAHEAD = 1.0
const SCHED_INTERVAL = 200

interface Pass {
  src: AudioBufferSourceNode
  gain: GainNode
}

/**
 * One playing instance of a cue.
 *
 * Signal chain:  source -> passGain -> fadeGain -> levelGain -> (engine master)
 *
 *  - passGain  is per-pass, and only does work for crossfade loops.
 *  - fadeGain  carries the cue envelope (fade in, fade out, release) as 0..1.
 *  - levelGain carries the user's volume, so it can be dragged live without
 *              colliding with a fade that is already scheduled on fadeGain.
 */
export class Voice implements PlayableVoice {
  readonly id = crypto.randomUUID()
  readonly cueId: string
  readonly cue: Cue

  private ctx: AudioContext
  private buffer: AudioBuffer
  private fadeGain: GainNode
  private levelGain: GainNode
  private passes: Pass[] = []

  /** ctx time at which the in-point is heard */
  private startAt = 0
  /** spacing between loop passes; equals the segment length unless crossfading */
  private period: number
  private segment: number

  private schedTimer: ReturnType<typeof setInterval> | null = null
  private followTimer: ReturnType<typeof setTimeout> | null = null
  private endTimer: ReturnType<typeof setTimeout> | null = null
  private nextPass = 0
  private lastPassAt = Infinity

  stopped = false
  releasing = false

  onEnd: ((v: PlayableVoice) => void) | null = null
  onFollow: ((v: PlayableVoice) => void) | null = null

  constructor(ctx: AudioContext, cue: Cue, buffer: AudioBuffer, dest: AudioNode) {
    this.ctx = ctx
    this.cue = cue
    this.cueId = cue.id
    this.buffer = buffer

    this.segment = Math.min(cueLength(cue), Math.max(0.01, buffer.duration - cue.inPoint))
    this.period =
      cue.loop === 'crossfade' ? Math.max(0.05, this.segment - this.clampedCrossfade()) : this.segment

    this.fadeGain = ctx.createGain()
    this.levelGain = ctx.createGain()
    this.fadeGain.connect(this.levelGain)
    this.levelGain.connect(dest)
    this.levelGain.gain.value = cue.gain
  }

  private clampedCrossfade(): number {
    // A crossfade longer than half the segment would have a pass overlapping
    // two others at once, which the two-source scheme cannot express.
    return Math.max(0.01, Math.min(this.cue.loopCrossfade, cueLength(this.cue) / 2))
  }

  private get looping(): boolean {
    return this.cue.loop !== 'off'
  }

  start(when?: number): void {
    const t = when ?? this.ctx.currentTime + 0.02
    this.startAt = t

    const fadeInDur = Math.min(this.cue.fadeIn, this.segment)
    if (fadeInDur > 0) rampIn(this.fadeGain.gain, 1, t, fadeInDur)
    else this.fadeGain.gain.setValueAtTime(1, t)

    if (this.cue.loop === 'seamless') {
      this.startSeamless(t)
    } else if (this.cue.loop === 'crossfade') {
      this.nextPass = 0
      this.scheduleCrossfadePasses()
      this.schedTimer = setInterval(() => this.scheduleCrossfadePasses(), SCHED_INTERVAL)
    } else {
      this.startOneShot(t, fadeInDur)
    }

    if (!this.looping && this.cue.followAction !== 'none') {
      const at = t + this.segment + this.cue.followDelay
      this.followTimer = setTimeout(
        () => {
          this.followTimer = null
          this.onFollow?.(this)
        },
        Math.max(0, (at - this.ctx.currentTime) * 1000),
      )
    }
  }

  private makeSource(offset: number, duration?: number, when?: number): Pass {
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    const gain = this.ctx.createGain()
    src.connect(gain)
    gain.connect(this.fadeGain)
    const pass: Pass = { src, gain }
    this.passes.push(pass)
    src.onended = () => {
      try {
        gain.disconnect()
      } catch {
        /* already torn down */
      }
      this.passes = this.passes.filter((p) => p !== pass)
      if (!this.looping || this.releasing) this.maybeFinish()
    }
    const at = when ?? this.ctx.currentTime
    if (duration === undefined) src.start(at, offset)
    else src.start(at, offset, duration)
    return pass
  }

  private startOneShot(t: number, fadeInDur: number): void {
    const pass = this.makeSource(this.cue.inPoint, this.segment, t)
    pass.gain.gain.setValueAtTime(1, t)

    const fadeOutDur = Math.min(this.cue.fadeOut, this.segment - fadeInDur)
    if (fadeOutDur > 0) {
      // Land the fade exactly on the out-point.
      rampOut(this.fadeGain.gain, 1, t + this.segment - fadeOutDur, fadeOutDur)
    }
  }

  private startSeamless(t: number): void {
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.loop = true
    src.loopStart = this.cue.inPoint
    src.loopEnd = Math.min(this.cue.outPoint, this.buffer.duration)
    const gain = this.ctx.createGain()
    gain.gain.value = 1
    src.connect(gain)
    gain.connect(this.fadeGain)
    const pass: Pass = { src, gain }
    this.passes.push(pass)
    src.onended = () => {
      try {
        gain.disconnect()
      } catch {
        /* already torn down */
      }
      this.passes = this.passes.filter((p) => p !== pass)
      this.maybeFinish()
    }
    src.start(t, this.cue.inPoint)
  }

  /**
   * Queue every crossfade pass that begins inside the lookahead window. Passes are
   * scheduled ahead of time on the audio clock, not fired from a timer, so the seam
   * stays sample-accurate no matter how busy the main thread gets.
   */
  private scheduleCrossfadePasses(): void {
    if (this.stopped || this.releasing) return
    const xf = this.clampedCrossfade()
    const horizon = this.ctx.currentTime + LOOKAHEAD

    while (this.startAt + this.nextPass * this.period <= horizon) {
      const at = this.startAt + this.nextPass * this.period
      const pass = this.makeSource(this.cue.inPoint, this.segment, at)

      if (this.nextPass === 0) {
        // Nothing to cross from — start at full and only fade out at the seam.
        pass.gain.gain.setValueAtTime(1, at)
      } else {
        rampShaped(pass.gain.gain, 0, 1, at, xf, fadeInShape)
      }
      rampShaped(pass.gain.gain, 1, 0, at + this.segment - xf, xf, (t) => 1 - fadeOutShape(t))

      this.lastPassAt = at
      this.nextPass++
    }
  }

  /** Seconds into the source file that is currently sounding. */
  position(): number {
    if (this.stopped) return this.cue.inPoint
    const elapsed = Math.max(0, this.ctx.currentTime - this.startAt)
    if (!this.looping) return Math.min(this.cue.inPoint + elapsed, this.cue.outPoint)
    return this.cue.inPoint + (elapsed % this.period)
  }

  /** 0..1 through the current pass. */
  progress(): number {
    const elapsed = Math.max(0, this.ctx.currentTime - this.startAt)
    if (!this.looping) return Math.min(1, elapsed / this.segment)
    return (elapsed % this.period) / this.period
  }

  /** Seconds until the cue ends. Infinity while looping freely. */
  remaining(): number {
    if (!this.looping) return Math.max(0, this.startAt + this.segment - this.ctx.currentTime)
    if (!this.releasing) return Infinity
    // A loop that has been asked to finish runs to the end of the current pass.
    const elapsed = this.ctx.currentTime - this.startAt
    const passEnd = this.startAt + (Math.floor(elapsed / this.period) + 1) * this.period
    return Math.max(0, passEnd - this.ctx.currentTime)
  }

  setLevel(gain: number): void {
    const now = this.ctx.currentTime
    this.levelGain.gain.cancelScheduledValues(now)
    this.levelGain.gain.setValueAtTime(this.levelGain.gain.value, now)
    this.levelGain.gain.linearRampToValueAtTime(gain, now + 0.02)
  }

  /**
   * Ask this voice to stop. `mode` overrides the cue's own stop behaviour (used by
   * STOP ALL and by exclusive-mode takeovers, which impose a common release).
   */
  release(mode?: StopMode, fadeSeconds?: number): void {
    if (this.stopped || this.releasing) return
    const how: StopMode = mode ?? this.cue.onStop
    const now = this.ctx.currentTime

    if (this.followTimer !== null) {
      clearTimeout(this.followTimer)
      this.followTimer = null
    }

    if (how === 'finishPass' && this.looping) {
      this.releasing = true
      this.stopScheduler()
      // Let the pass that is sounding complete, then stop on its natural boundary.
      const elapsed = now - this.startAt
      const passEnd =
        this.cue.loop === 'crossfade'
          ? this.lastPassAt + this.segment
          : this.startAt + (Math.floor(elapsed / this.period) + 1) * this.period
      const tail = Math.max(DECLICK, passEnd - now)
      const shaped = Math.min(this.cue.releaseFade, tail)
      if (shaped > DECLICK) rampOut(this.fadeGain.gain, this.fadeGain.gain.value, passEnd - shaped, shaped)
      this.hardStopAt(passEnd + 0.01)
      return
    }

    if (how === 'finishPass') {
      // One-shot: "finish the pass" just means let it play out.
      this.releasing = true
      return
    }

    this.releasing = true
    this.stopScheduler()
    const dur = how === 'cut' ? DECLICK : Math.max(DECLICK, fadeSeconds ?? this.cue.releaseFade)
    rampOut(this.fadeGain.gain, this.fadeGain.gain.value, now, dur)
    this.hardStopAt(now + dur + 0.01)
  }

  private hardStopAt(when: number): void {
    for (const p of this.passes) {
      try {
        p.src.stop(when)
      } catch {
        /* already stopped */
      }
    }
    // Belt and braces: a source that never started (scheduled beyond its stop time)
    // will not fire onended, so finish on a timer too.
    if (this.endTimer !== null) clearTimeout(this.endTimer)
    this.endTimer = setTimeout(
      () => {
        this.endTimer = null
        this.finish()
      },
      Math.max(0, (when - this.ctx.currentTime) * 1000) + 60,
    )
  }

  private stopScheduler(): void {
    if (this.schedTimer !== null) {
      clearInterval(this.schedTimer)
      this.schedTimer = null
    }
  }

  private maybeFinish(): void {
    if (this.passes.length === 0) this.finish()
  }

  private finish(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopScheduler()
    if (this.followTimer !== null) clearTimeout(this.followTimer)
    if (this.endTimer !== null) clearTimeout(this.endTimer)
    this.followTimer = null
    this.endTimer = null
    for (const p of this.passes) {
      try {
        p.src.stop()
      } catch {
        /* already stopped */
      }
      try {
        p.gain.disconnect()
      } catch {
        /* already torn down */
      }
    }
    this.passes = []
    try {
      this.fadeGain.disconnect()
      this.levelGain.disconnect()
    } catch {
      /* already torn down */
    }
    this.onEnd?.(this)
  }
}
