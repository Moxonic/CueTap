import { getAccessToken } from './auth'
import type { SpotifyRef } from '../data/types'

const API = 'https://api.spotify.com/v1'

/**
 * Spotify explains itself in a JSON body — {"error":{"status":400,"message":...}}.
 * Throwing away that message leaves nothing but a bare status code to debug
 * with, so pull it out and put it in front of the user.
 */
export async function describeError(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await res.clone().json()) as {
      error?: { message?: string } | string
      error_description?: string
    }
    detail =
      (typeof body.error === 'object' ? body.error?.message : body.error) ??
      body.error_description ??
      ''
  } catch {
    try {
      detail = (await res.clone().text()).slice(0, 200)
    } catch {
      /* body already consumed or empty */
    }
  }
  const suffix = detail ? ` — ${detail}` : ''

  // Also log it: a raw "Failed to load resource: 400" in the console says
  // nothing, and the console is where people look first.
  console.error(`[CueTap] Spotify ${res.status} on ${res.url}: ${detail || '(no message in body)'}`)

  switch (res.status) {
    case 400:
      return (
        `Spotify rejected the request (400)${suffix}. If it mentions bearer authentication, the ` +
        `saved token is not valid: disconnect and connect again in Settings.`
      )
    case 401:
      return `Spotify rejected the session (401)${suffix}. Reconnect in Settings.`
    case 403:
      return (
        `Spotify refused the request (403)${suffix}. Either the account is not Premium, or your ` +
        `dashboard app has not enabled the Web API.`
      )
    case 404:
      return `Spotify found nothing at that endpoint (404)${suffix}.`
    case 429:
      return `Spotify is rate limiting; retry in ${res.headers.get('Retry-After') ?? 'a few'}s.`
    default:
      return `Spotify returned ${res.status}${suffix}.`
  }
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('The saved Spotify token is empty. Disconnect and connect again in Settings.')
  }
  return await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  })
}

export interface TrackHit extends SpotifyRef {
  durationMs: number
}

// Spotify's search endpoint caps `limit` at 10 (default 5); asking for more is a
// bare 400 "Invalid limit". The connection test uses limit=1, which is why it
// passes while a real search fails.
export async function searchTracks(query: string, limit = 10): Promise<TrackHit[]> {
  if (!query.trim()) return []
  const res = await call(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(await describeError(res))
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
    throw new Error(await describeError(res))
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

export interface Diagnosis {
  ok: boolean
  lines: string[]
}

/**
 * Walk the connection end to end and report exactly where it breaks.
 *
 * A bare "400" from a search tells you nothing about whether the token is
 * stale, the account is wrong, or the dashboard app has the Web API switched
 * off. Each step here names its own failure.
 */
export async function diagnose(): Promise<Diagnosis> {
  const lines: string[] = []
  let ok = true

  // 1. Is there a usable token at all?
  let token = ''
  try {
    token = await getAccessToken()
    lines.push(token ? `Token: present (${token.length} chars)` : 'Token: EMPTY')
    if (!token) ok = false
  } catch (e) {
    lines.push(`Token: failed — ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, lines }
  }

  // 2. Identity. Proves the token works and reveals the product tier.
  try {
    const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const j = (await res.json()) as { display_name?: string; id: string; product?: string }
      lines.push(`Account: ${j.display_name || j.id} (${j.product ?? 'unknown'})`)
      if (j.product !== 'premium') {
        ok = false
        lines.push('  Playback needs Premium. Search will still work.')
      }
    } else {
      ok = false
      lines.push(`Account: ${await describeError(res)}`)
    }
  } catch (e) {
    ok = false
    lines.push(`Account: network error — ${e instanceof Error ? e.message : String(e)}`)
  }

  // 3. The exact search call the sheet makes, with a query certain to match.
  try {
    const res = await fetch(`${API}/search?type=track&limit=1&q=${encodeURIComponent('a')}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const j = (await res.json()) as { tracks?: { items?: unknown[] } }
      lines.push(`Search: OK (${j.tracks?.items?.length ?? 0} result)`)
    } else {
      ok = false
      lines.push(`Search: ${await describeError(res)}`)
    }
  } catch (e) {
    ok = false
    lines.push(`Search: network error — ${e instanceof Error ? e.message : String(e)}`)
  }

  return { ok, lines }
}
