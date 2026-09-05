import { Voice } from './voice'
import { loadBuffer, getCached } from './decode'
import { isExclusive, type Cue, type ShowSettings, type StopMode } from '../data/types'

/**
 * A one-second silent WAV, used to keep the media session alive in Live mode.
 * Built rather than inlined as base64: a zero-length data chunk gives a
 * zero-duration element, which will not loop and so keeps nothing alive.
 */
function silentWavUrl(): string {
  const rate = 8000
  const frames = rate // 1 second, mono, 16-bit
  const bytes = frames * 2
  const buf = new ArrayBuffer(44 + bytes)
  const view = new DataView(buf)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // channels
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, bytes, true)
  // samples are already zero
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

export type FollowRequest = { cue: Cue; voiceId: string }

class Engine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private voices = new Set<Voice>()
  private listeners = new Set<() => void>()
  private keepAlive: HTMLAudioElement | null = null
  private wakeLock: WakeLockSentinel | null = null

  /** Set by the store so a follow-on can resolve "next cue" against the show. */
  onFollow: ((req: FollowRequest) => void) | null = null

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /**
   * Build the audio graph and get it into the `running` state. Must be called from
   * inside a real user gesture — both iOS and Android refuse to start an
   * AudioContext otherwise, and a context created outside one stays suspended.
   */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor({ latencyHint: 'interactive' })

      // Safety limiter: several cues stacking in poly mode should not clip the output.
      this.limiter = this.ctx.createDynamicsCompressor()
      this.limiter.threshold.value = -3
      this.limiter.knee.value = 0
      this.limiter.ratio.value = 20
      this.limiter.attack.value = 0.002
      this.limiter.release.value = 0.12

      this.master = this.ctx.createGain()
      this.master.gain.value = 1
      this.master.connect(this.limiter)
      this.limiter.connect(this.ctx.destination)
    }

    if (this.ctx.state !== 'running') await this.ctx.resume()

    // Kick the hardware with a silent buffer; iOS needs one real render pass
    // before it will actually route audio.
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate)
    const s = this.ctx.createBufferSource()
    s.buffer = b
    s.connect(this.ctx.destination)
    s.start(0)
    this.emit()
  }

  /** Called on visibilitychange — browsers suspend the context when backgrounded. */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
        this.emit()
      } catch {
        /* needs another gesture */
      }
    }
  }

  setMasterGain(value: number): void {
    if (!this.master || !this.ctx) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(this.master.gain.value, now)
    this.master.gain.linearRampToValueAtTime(value, now + 0.05)
  }

  /** Ensure a cue's audio is decoded and in RAM. Cheap if already cached. */
  async prime(cue: Cue): Promise<AudioBuffer | null> {
    if (!this.ctx) return null
    try {
      return await loadBuffer(this.ctx, cue.audioId)
    } catch {
      return null
    }
  }

  async primeAll(cues: Cue[]): Promise<void> {
    for (const c of cues) await this.prime(c)
    this.emit()
  }

  isPlaying(cueId: string): boolean {
    for (const v of this.voices) if (v.cueId === cueId && !v.stopped) return true
    return false
  }

  voicesFor(cueId: string): Voice[] {
    return [...this.voices].filter((v) => v.cueId === cueId && !v.stopped)
  }

  activeVoices(): Voice[] {
    return [...this.voices].filter((v) => !v.stopped)
  }

  /**
   * Fire a cue. Returns null if the audio could not be decoded — the caller shows
   * the error rather than the app failing silently mid-show.
   */
  async fire(cue: Cue, settings: ShowSettings): Promise<Voice | null> {
    if (!this.ctx) return null
    if (this.ctx.state !== 'running') await this.resume()

    // Prefer the already-decoded buffer so a tap is instant; only await on a miss.
    const buffer = getCached(cue.audioId) ?? (await this.prime(cue))
    if (!buffer || !this.master) return null

    if (isExclusive(cue, settings)) {
      for (const v of this.voices) if (!v.stopped) v.release()
    } else {
      // Even in poly mode, one cue should not stack on itself unless asked to.
      if (settings.padTrigger !== 'stack') for (const v of this.voicesFor(cue.id)) v.release()
    }

    const voice = new Voice(this.ctx, cue, buffer, this.master)
    voice.onEnd = (v) => {
      this.voices.delete(v)
      this.emit()
    }
    voice.onFollow = (v) => this.onFollow?.({ cue: v.cue, voiceId: v.id })
    this.voices.add(voice)
    voice.start()
    this.emit()
    return voice
  }

  stopCue(cueId: string, mode?: StopMode, fade?: number): void {
    for (const v of this.voicesFor(cueId)) v.release(mode, fade)
    this.emit()
  }

  stopAll(fade?: number): void {
    for (const v of this.voices) if (!v.stopped) v.release('fade', fade)
    this.emit()
  }

  /** Panic: everything down as fast as is inaudible. */
  panic(): void {
    for (const v of this.voices) if (!v.stopped) v.release('cut')
    this.emit()
  }

  setCueLevel(cueId: string, gain: number): void {
    for (const v of this.voicesFor(cueId)) v.setLevel(gain)
  }

  // --- Live mode: keep the screen and the audio session awake ----------------

  async enableLiveMode(): Promise<void> {
    if (!this.keepAlive) {
      const el = new Audio(silentWavUrl())
      el.loop = true
      el.volume = 0.001
      this.keepAlive = el
    }
    try {
      await this.keepAlive.play()
    } catch {
      /* needs a gesture; the arm screen covers this */
    }
    await this.acquireWakeLock()
  }

  disableLiveMode(): void {
    this.keepAlive?.pause()
    void this.wakeLock?.release().catch(() => {})
    this.wakeLock = null
  }

  async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return
    try {
      this.wakeLock = await navigator.wakeLock.request('screen')
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null
      })
    } catch {
      /* denied, or the tab is hidden — retried on visibilitychange */
    }
  }

  get hasWakeLock(): boolean {
    return this.wakeLock !== null
  }
}

export const engine = new Engine()
