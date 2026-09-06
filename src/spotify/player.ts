import { getAccessToken, isConnected } from './auth'
import { playOnDevice } from './api'
import { drmProblem } from './drm'

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js'

/** Minimal shape of the bits of the Web Playback SDK we actually use. */
interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, cb: (arg: never) => void): boolean
  setVolume(v: number): Promise<void>
  seek(ms: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  getCurrentState(): Promise<{ position: number; paused: boolean; duration: number } | null>
  /**
   * Unlock the SDK's internal <audio> element. Browsers require this to be
   * called from a user gesture; without it playback transfers to the device
   * name but no audio plays and transport calls fail with "no list was loaded".
   * Present since SDK 1.5.7; typed optional so an older SDK does not crash.
   */
  activateElement?(): Promise<void>
}

declare global {
  interface Window {
    Spotify?: { Player: new (opts: Record<string, unknown>) => SpotifyPlayer }
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

let sdkLoad: Promise<void> | null = null

function loadSdk(): Promise<void> {
  if (sdkLoad) return sdkLoad
  sdkLoad = new Promise<void>((resolve, reject) => {
    if (window.Spotify) return resolve()
    // The SDK calls this global when it is ready; it must exist before the script runs.
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const s = document.createElement('script')
    s.src = SDK_SRC
    s.async = true
    s.onerror = () => reject(new Error('Could not load the Spotify player (no network?).'))
    document.head.appendChild(s)
  })
  return sdkLoad
}

class SpotifyPlayback {
  private player: SpotifyPlayer | null = null
  private deviceId = ''
  private ready: Promise<void> | null = null
  private listeners = new Set<() => void>()

  /** Last known transport state, refreshed by the SDK's own player_state_changed. */
  lastPosition = 0
  lastPaused = true
  error: string | null = null

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  get connected(): boolean {
    return this.deviceId !== ''
  }

  /**
   * Fetch the SDK script ahead of time, without constructing a player. Called
   * when Spotify connects so that at arm time `init()` can run `connect()`
   * synchronously inside the tap — the SDK's audio element is only unlocked for
   * autoplay if `connect()` happens within a user gesture.
   */
  preload(): Promise<void> {
    return loadSdk().catch(() => {
      /* retried by init() */
    })
  }

  /**
   * Bring up the SDK device. Idempotent and shared: cues fire concurrently and
   * must not each try to construct a player.
   */
  init(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      if (!isConnected()) throw new Error('Not connected to Spotify.')

      // Before the SDK gets a chance to fail unrecoverably inside its own
      // pipeline. Recorded on `error` so the arm step surfaces it too, not only
      // the first cue that tries to play.
      const drm = await drmProblem()
      if (drm) {
        this.error = drm
        this.emit()
        throw new Error(drm)
      }

      await loadSdk()
      if (!window.Spotify) throw new Error('Spotify player failed to initialise.')

      const player = new window.Spotify.Player({
        name: 'CueTap',
        getOAuthToken: (cb: (t: string) => void) => {
          void getAccessToken().then(cb).catch(() => {})
        },
        // The SDK's own volume; per-cue level is applied on top of this.
        volume: 1,
      })

      // Unlock the audio element. This must ride on a user gesture, which is why
      // init() is called from the arm tap and the SDK is preloaded beforehand —
      // so this line runs while the tap is still the active user activation.
      // Without it the first cue fails with "no list was loaded".
      try {
        await player.activateElement?.()
      } catch {
        /* no gesture in scope; the play call will report the real failure */
      }

      player.addListener('ready', ((e: { device_id: string }) => {
        this.deviceId = e.device_id
        this.error = null
        this.emit()
      }) as never)

      player.addListener('not_ready', (() => {
        this.deviceId = ''
        this.emit()
      }) as never)

      player.addListener('player_state_changed', ((s: { position: number; paused: boolean } | null) => {
        if (!s) return
        this.lastPosition = s.position
        this.lastPaused = s.paused
      }) as never)

      for (const kind of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
        player.addListener(kind, ((e: { message: string }) => {
          this.error =
            kind === 'account_error'
              ? 'Spotify playback needs a Premium account.'
              : `Spotify: ${e.message}`
          this.emit()
        }) as never)
      }

      const ok = await player.connect()
      if (!ok) throw new Error('Spotify player refused to connect.')
      this.player = player

      // 'ready' is asynchronous; wait for the device id before reporting success.
      const deadline = Date.now() + 10_000
      while (!this.deviceId && Date.now() < deadline) {
        if (this.error) throw new Error(this.error)
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!this.deviceId) throw new Error('Spotify player did not come up in time.')
    })()

    this.ready.catch(() => {
      // Allow a later retry rather than caching the failure forever.
      this.ready = null
    })
    return this.ready
  }

  async play(uri: string, positionMs: number): Promise<void> {
    await this.init()
    await playOnDevice(this.deviceId, uri, positionMs)
    this.lastPaused = false
  }

  async pause(): Promise<void> {
    try {
      await this.player?.pause()
      this.lastPaused = true
    } catch {
      /* already stopped */
    }
  }

  async seek(ms: number): Promise<void> {
    try {
      await this.player?.seek(Math.max(0, Math.round(ms)))
    } catch {
      /* transient */
    }
  }

  async setVolume(v: number): Promise<void> {
    try {
      await this.player?.setVolume(Math.max(0, Math.min(1, v)))
    } catch {
      /* transient */
    }
  }

  /** Live position in ms, or null when nothing is loaded. */
  async position(): Promise<number | null> {
    try {
      const s = await this.player?.getCurrentState()
      if (!s) return null
      this.lastPosition = s.position
      this.lastPaused = s.paused
      return s.position
    } catch {
      return null
    }
  }

  teardown(): void {
    try {
      this.player?.disconnect()
    } catch {
      /* nothing to do */
    }
    this.player = null
    this.deviceId = ''
    this.ready = null
    this.emit()
  }
}

export const spotify = new SpotifyPlayback()
