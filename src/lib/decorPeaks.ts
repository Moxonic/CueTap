/**
 * A waveform shape for cues that have no waveform.
 *
 * Spotify decodes in a protected pipeline that never reaches an AudioContext,
 * and the Audio Analysis endpoint that once carried a loudness envelope was
 * closed to apps registered after November 2024. So there is no amplitude to
 * draw for a Spotify track and there is no way to obtain one.
 *
 * What this produces is decoration: a plausible arrangement — sections at
 * different energies, a beat emphasis, an intro and an outro — seeded from the
 * track URI so a given track always draws the same way and the strip does not
 * shimmer between renders. It is NOT the track. Callers must mark it as such;
 * Waveform prints a watermark over it. Never trim by eye against this shape —
 * use the playhead buttons or the clock.
 */

/** FNV-1a, enough to spread URIs across the seed space. */
function hash(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and stable across engines, which matters here. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Normalised 0..1 heights, one per bar. */
export function decorativePeaks(seed: string, count = 480): number[] {
  const rnd = mulberry32(hash(seed))

  // Four to seven sections at their own energies, so the shape reads as an
  // arrangement rather than as uniform noise.
  const sections = 4 + Math.floor(rnd() * 4)
  const level: number[] = []
  for (let i = 0; i < sections; i++) level.push(0.34 + rnd() * 0.62)

  // A periodic accent, so the texture looks rhythmic at bar level.
  const beat = 6 + Math.floor(rnd() * 6)
  const half = Math.floor(beat / 2)

  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const t = i / count
    const s = Math.min(sections - 1, Math.floor(t * sections))
    // Bleed into the next section so boundaries are transitions, not steps.
    const local = t * sections - s
    const base = level[s] * (1 - local * 0.35) + level[Math.min(sections - 1, s + 1)] * local * 0.35
    const accent = i % beat === 0 ? 1.18 : i % beat === half ? 1.07 : 1
    const grain = 0.72 + rnd() * 0.5
    // Ease the very start and end so it does not begin and end at full tilt.
    const ends = Math.min(1, t * 14) * Math.min(1, (1 - t) * 10)
    out.push(Math.max(0.05, Math.min(1, base * accent * grain * ends)))
  }
  return out
}
