import { getAccessToken, isConnected } from './auth'
import { playOnDevice } from './api'

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
   * Bring up the SDK device. Idempotent and shared: cues fire concurrently and
   * must not each try to construct a player.
   */
  init(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      if (!isConnected()) throw new Error('Not connected to Spotify.')
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
