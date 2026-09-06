/**
 * Spotify OAuth, Authorization Code with PKCE.
 *
 * PKCE rather than the implicit or client-secret flows: this is a public client
 * running entirely in the browser, so there is nowhere to keep a secret, and
 * implicit grant issues no refresh token — a show would lose playback an hour in.
 *
 * The client ID is supplied by the user at runtime and kept in localStorage,
 * rather than baked into the bundle, because this repo is public and every
 * deployment needs its own redirect URI registered anyway.
 */

const AUTH_HOST = 'https://accounts.spotify.com'
const STORE_KEY = 'cuetap.spotify.token'
const CLIENT_KEY = 'cuetap.spotify.clientId'
const VERIFIER_KEY = 'cuetap.spotify.verifier'

/** streaming is what the Web Playback SDK needs; the rest are for search and transfer. */
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ')

interface StoredToken {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

export function getClientId(): string {
  try {
    return localStorage.getItem(CLIENT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setClientId(id: string): void {
  try {
    localStorage.setItem(CLIENT_KEY, id.trim())
  } catch {
    /* private mode */
  }
}

/**
 * The exact string that must be registered in the Spotify dashboard. Shown in
 * Settings so it can be copied rather than guessed — a mismatch here is the
 * single most common reason the flow fails.
 */
export function redirectUri(): string {
  return window.location.origin + window.location.pathname.replace(/\/$/, '') + '/'
}

/**
 * Why Spotify would reject the current address, or null if it is acceptable.
 *
 * Since April 2025 Spotify requires HTTPS, or an explicit loopback IP literal
 * over HTTP. The hostname `localhost` is rejected outright — even over HTTPS —
 * which produces a bare "INVALID_CLIENT: Invalid redirect URI" 400 on their
 * consent page with nothing to explain it. Catching it here turns that into an
 * answer instead of a dead end.
 */
export function redirectUriProblem(): string | null {
  const { protocol, hostname } = window.location
  const loopback = hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'

  if (hostname === 'localhost') {
    return 'Spotify rejects "localhost" as a redirect URI, even over HTTPS. Reopen CueTap on 127.0.0.1 instead.'
  }
  if (protocol !== 'https:' && !loopback) {
    return 'Spotify requires HTTPS, or the literal loopback address 127.0.0.1. This page is plain HTTP.'
  }
  return null
}

/** The same address with localhost swapped for the loopback literal. */
export function loopbackAlternative(): string {
  const u = new URL(window.location.href)
  u.hostname = '127.0.0.1'
  u.search = ''
  return u.toString()
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as StoredToken) : null
  } catch {
    return null
  }
}

/** Anything showing connection state (the header icon) re-reads on change. */
const authListeners = new Set<() => void>()

export function subscribeAuth(fn: () => void): () => void {
  authListeners.add(fn)
  return () => {
    authListeners.delete(fn)
  }
}

function writeToken(t: StoredToken | null): void {
  try {
    if (t) localStorage.setItem(STORE_KEY, JSON.stringify(t))
    else localStorage.removeItem(STORE_KEY)
  } catch {
    /* private mode */
  }
  for (const fn of authListeners) fn()
}

export function isConnected(): boolean {
  return readToken() !== null
}

export function disconnect(): void {
  writeToken(null)
}

function randomString(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => ('0' + b.toString(16)).slice(-2)).join('')
}

async function challengeFrom(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Send the browser to Spotify's consent screen. Never returns. */
export async function beginLogin(): Promise<void> {
  const clientId = getClientId()
  if (!clientId) throw new Error('Set your Spotify Client ID first.')

  // Fail here with a reason rather than bouncing the user to Spotify's own
  // unexplained 400 page.
  const problem = redirectUriProblem()
  if (problem) throw new Error(problem)

  const verifier = randomString(48)
  try {
    sessionStorage.setItem(VERIFIER_KEY, verifier)
  } catch {
    throw new Error('Session storage is unavailable, so the login cannot be completed securely.')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await challengeFrom(verifier),
  })
  window.location.assign(`${AUTH_HOST}/authorize?${params}`)
}

/**
 * Handle the ?code=... leg of the redirect. Returns true if a login completed,
 * so the caller knows to refresh its connected state. Always strips the query
 * so a reload cannot replay a spent code.
 */
export async function completeLoginFromRedirect(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (!code && !error) return false

  const clean = () => {
    url.searchParams.delete('code')
    url.searchParams.delete('error')
    url.searchParams.delete('state')
    window.history.replaceState({}, '', url.toString())
  }

  if (error) {
    clean()
    throw new Error(`Spotify refused the login: ${error}`)
  }

  const verifier = sessionStorage.getItem(VERIFIER_KEY) ?? ''
  sessionStorage.removeItem(VERIFIER_KEY)
  clean()
  if (!verifier) throw new Error('Login could not be verified — start it again from Settings.')

  const res = await fetch(`${AUTH_HOST}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`Spotify token exchange failed: ${await res.text()}`)

  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  writeToken({
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + j.expires_in * 1000,
  })
  return true
}

let refreshing: Promise<string> | null = null

/**
 * A valid access token, refreshed if it is close to expiry. Concurrent callers
 * share one refresh — the SDK asks for a token at the same moment a cue fires,
 * and two refreshes would race to overwrite each other.
 */
export async function getAccessToken(): Promise<string> {
  const t = readToken()
  if (!t) throw new Error('Not connected to Spotify.')
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken
  if (refreshing) return refreshing

  refreshing = (async () => {
    const res = await fetch(`${AUTH_HOST}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: getClientId(),
        grant_type: 'refresh_token',
        refresh_token: t.refreshToken,
      }),
    })
    if (!res.ok) {
      writeToken(null)
      throw new Error('Spotify session expired — reconnect in Settings.')
    }
    const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
    const next: StoredToken = {
      accessToken: j.access_token,
      // Spotify only returns a new refresh token sometimes; keep the old one otherwise.
      refreshToken: j.refresh_token ?? t.refreshToken,
      expiresAt: Date.now() + j.expires_in * 1000,
    }
    writeToken(next)
    return next.accessToken
  })()

  try {
    return await refreshing
  } finally {
    refreshing = null
  }
}

/**
 * Pull a Client ID out of whatever got pasted. People paste "Client ID" plus a
 * newline, or with trailing whitespace from the dashboard; a 32-hex run is
 * unambiguous, so find it rather than making them clean it up by hand.
 */
export function normaliseClientId(raw: string): string {
  const match = raw.match(/[0-9a-f]{32}/i)
  return match ? match[0].toLowerCase() : raw.trim()
}

export function isValidClientId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id.trim())
}
