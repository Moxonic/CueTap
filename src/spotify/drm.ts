/**
 * Whether this browser can decrypt Spotify's stream, or a reason it cannot.
 *
 * The Web Playback SDK decodes inside an EME pipeline and needs a Widevine (or
 * PlayReady / FairPlay) CDM. Without one it fails deep inside the SDK with an
 * uncaught "No supported keysystem was found" and leaves a dead player behind,
 * so probe for it first and turn that into an answer.
 *
 * Its own module because both the player and the connection test need it, and
 * the player already imports the API layer.
 */

let cached: Promise<string | null> | null = null

/** A reason Spotify playback cannot work here, or null if the CDM is present. */
export function drmProblem(): Promise<string | null> {
  if (cached) return cached
  cached = (async () => {
    if (typeof navigator.requestMediaKeySystemAccess !== 'function') {
      return 'This browser has no Encrypted Media Extensions, which Spotify playback requires.'
    }
    const config: MediaKeySystemConfiguration[] = [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      },
    ]
    for (const ks of [
      'com.widevine.alpha',
      'com.microsoft.playready.recommendation',
      'com.apple.fps',
    ]) {
      try {
        await navigator.requestMediaKeySystemAccess(ks, config)
        return null
      } catch {
        /* try the next key system */
      }
    }
    return (
      'This browser has no Widevine DRM, which Spotify playback requires. ' +
      'Use Chrome or Edge; in Firefox turn on "Play DRM-controlled content"; ' +
      'on Chrome check chrome://components for the Widevine module. ' +
      'Search still works without it.'
    )
  })()
  return cached
}
