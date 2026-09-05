import { getAudio } from '../data/db'

/** Decoded buffers, keyed by audioId. Cues fire from RAM — never from disk. */
const cache = new Map<string, AudioBuffer>()
const inFlight = new Map<string, Promise<AudioBuffer>>()

export async function decodeArrayBuffer(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData detaches the ArrayBuffer it is given, so hand it a copy and
  // keep ours intact for the caller (who still needs to store the original blob).
  return await ctx.decodeAudioData(data.slice(0))
}

export function cacheBuffer(audioId: string, buffer: AudioBuffer): void {
  cache.set(audioId, buffer)
}

export function getCached(audioId: string): AudioBuffer | undefined {
  return cache.get(audioId)
}

export function evict(audioId: string): void {
  cache.delete(audioId)
  inFlight.delete(audioId)
}

/** Pull a blob out of IndexedDB and decode it, deduplicating concurrent requests. */
export function loadBuffer(ctx: BaseAudioContext, audioId: string): Promise<AudioBuffer> {
  const hit = cache.get(audioId)
  if (hit) return Promise.resolve(hit)
  const pending = inFlight.get(audioId)
  if (pending) return pending

  const p = (async () => {
    const blob = await getAudio(audioId)
    if (!blob) throw new Error(`audio ${audioId} is missing from storage`)
    const buf = await decodeArrayBuffer(ctx, await blob.arrayBuffer())
    cache.set(audioId, buf)
    inFlight.delete(audioId)
    return buf
  })()

  inFlight.set(audioId, p)
  p.catch(() => inFlight.delete(audioId))
  return p
}

/**
 * Normalised peak envelope for the waveform display. Returns `count` values in 0..1,
 * taking the max absolute sample per bucket across all channels.
 */
export function computePeaks(buffer: AudioBuffer, count = 480): number[] {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))

  const bucket = buffer.length / count
  const peaks = new Array<number>(count)
  let max = 0

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucket)
    const end = Math.min(buffer.length, Math.floor((i + 1) * bucket))
    // Sub-sample long buckets: a 10 minute file has ~55k samples per bucket and
    // scanning all of them freezes the import for seconds on a phone.
    const stride = Math.max(1, Math.floor((end - start) / 512))
    let peak = 0
    for (const data of channels) {
      for (let j = start; j < end; j += stride) {
        const v = Math.abs(data[j])
        if (v > peak) peak = v
      }
    }
    peaks[i] = peak
    if (peak > max) max = peak
  }

  // Normalise so quiet files still show a readable envelope.
  const scale = max > 0 ? 1 / max : 0
  for (let i = 0; i < count; i++) peaks[i] = Math.round(peaks[i] * scale * 1000) / 1000
  return peaks
}
