import { getAccessToken } from './auth'
import type { SpotifyRef } from '../data/types'

const API = 'https://api.spotify.com/v1'

async function call(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken()
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Error('Spotify rejected the session — reconnect in Settings.')
  if (res.status === 403) {
    throw new Error('Spotify refused playback. This usually means the account is not Premium.')
  }
  if (res.status === 429) {
    throw new Error(`Spotify is rate limiting; retry in ${res.headers.get('Retry-After') ?? 'a few'}s.`)
  }
  return res
}

export interface TrackHit extends SpotifyRef {
  durationMs: number
}

export async function searchTracks(query: string, limit = 20): Promise<TrackHit[]> {
  if (!query.trim()) return []
  const res = await call(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`)
  const j = (await res.json()) as {
    tracks: {
      items: {
        uri: string
        name: string
        duration_ms: number
        artists: { name: string }[]
        album: { images: { url: string; width: number }[] }
      }[]
    }
  }
  return j.tracks.items.map((t) => ({
    uri: t.uri,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    // Smallest image is plenty for a pad thumbnail and cheapest on a phone.
    artworkUrl: [...t.album.images].sort((a, b) => a.width - b.width)[0]?.url,
    durationMs: t.duration_ms,
  }))
}

/** Start a track on our own SDK device, at an offset. */
export async function playOnDevice(deviceId: string, uri: string, positionMs: number): Promise<void> {
  const res = await call(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) }),
  })
  // 202 means the device is still waking up; the SDK retries on its own.
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Spotify could not start the track: ${res.status} ${await res.text()}`)
  }
}

export async function currentUser(): Promise<{ name: string; product: string } | null> {
  try {
    const res = await call('/me')
    if (!res.ok) return null
    const j = (await res.json()) as { display_name?: string; id: string; product?: string }
    return { name: j.display_name || j.id, product: j.product ?? 'unknown' }
  } catch {
    return null
  }
}
