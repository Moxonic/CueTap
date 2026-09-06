import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decorativePeaks } from '../lib/decorPeaks'
import { formatClock } from '../lib/format'

interface Props {
  peaks: number[]
  duration: number
  inPoint: number
  outPoint: number
  fadeIn: number
  fadeOut: number
  color: string
  /** seconds, or null when the cue is not sounding */
  position: number | null
  /**
   * Stable key for a cue with no waveform data — the Spotify URI. Given one,
   * the strip draws a decorative shape seeded from it, watermarked so it is not
   * read as the real track. See lib/decorPeaks.
   */
  seed?: string
  onChange: (inPoint: number, outPoint: number) => void
}

/** Smallest usable selection, so the handles can never cross. */
const MIN_SPAN = 0.05

/** Tick spacings that read as round numbers of seconds or minutes. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/** The coarsest step that still puts roughly six labels across the strip. */
function tickStep(duration: number, width: number): number {
  const target = duration / Math.max(2, Math.min(8, Math.floor(width / 64)))
  return TICK_STEPS.find((s) => s >= target) ?? TICK_STEPS[TICK_STEPS.length - 1]
}

/**
 * Ruler and disclaimer drawn over a decorative shape.
 *
 * The shape underneath is invented, so the ruler is what a trim point can
 * actually be judged against, and the watermark is what stops the shape being
 * read as the track. Both belong on top of the bars, not behind them.
 */
function drawStreamOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  h: number,
  duration: number,
): void {
  const step = tickStep(duration, width)
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'

  for (let t = step; t < duration; t += step) {
    const x = Math.round((t / duration) * width) + 0.5
    ctx.fillStyle = 'rgba(255,255,255,0.20)'
    ctx.fillRect(x, 0, 1, h)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillText(formatClock(t), x + 3, h - 14)
  }

  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.textAlign = 'right'
  ctx.fillText(formatClock(duration), width - 4, h - 14)
  ctx.textAlign = 'left'

  // Say what this is. Spotify exposes no waveform, so the shape is decoration
  // and trimming by eye against it would be wrong.
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  ctx.fillText('shape is indicative — Spotify exposes no waveform', 4, 3)
}

export default function Waveform({
  peaks,
  duration,
  inPoint,
  outPoint,
  fadeIn,
  fadeOut,
  color,
  position,
  seed,
  onChange,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null)

  // Seeded once per track, not per paint: the shape has to be stable or the
  // strip shimmers on every position tick.
  const decor = useMemo(
    () => (peaks.length === 0 && seed ? decorativePeaks(seed) : null),
    [peaks.length, seed],
  )

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || width === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const h = cv.clientHeight
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, h)

    const mid = h / 2
    const inX = (inPoint / duration) * width
    const outX = (outPoint / duration) * width

    // `shape` is the real analysis for a file cue, and a seeded decoration for a
    // streaming one — Spotify never exposes amplitude, so there is nothing true
    // to draw. Both render through the same bars; the streaming case is marked
    // by the overlay below and dimmed so it does not read as measured data.
    const shape = peaks.length > 0 ? peaks : decor
    const invented = peaks.length === 0 && decor !== null
    const playX = position === null ? null : (position / duration) * width

    if (shape) {
      for (let x = 0; x < width; x++) {
        const peak = shape[Math.floor((x / width) * shape.length)] ?? 0
        const bar = Math.max(1, peak * (h * 0.86))
        const inside = x >= inX && x <= outX
        ctx.fillStyle = inside ? color : 'rgba(255,255,255,0.13)'
        // On a streaming cue the elapsed sweep is the only real position
        // feedback there is, so played bars stay bright and the rest recedes.
        ctx.globalAlpha = !invented || !inside ? 1 : playX !== null && x <= playX ? 0.95 : 0.5
        ctx.fillRect(x, mid - bar / 2, 1, bar)
        ctx.globalAlpha = 1
      }
    } else {
      // No peaks and no seed: a flat band rather than a blank strip.
      ctx.fillStyle = 'rgba(255,255,255,0.13)'
      ctx.fillRect(0, mid - 2, width, 4)
    }

    // Trimmed-away regions get knocked back further.
    ctx.fillStyle = 'rgba(8,10,13,0.55)'
    ctx.fillRect(0, 0, Math.max(0, inX), h)
    ctx.fillRect(outX, 0, Math.max(0, width - outX), h)

    // Fade envelope, drawn over the selection so its shape is readable at a glance.
    // The clamping here has to match Voice.startOneShot exactly: the engine gives
    // the fade in priority and shortens the fade out to whatever is left, so a 2s
    // in and 3s out on a 4s cue is really 2s + 2s. Clamping each independently
    // instead draws the two ramps crossing over, which is not what you hear.
    const span = outPoint - inPoint
    const fi = Math.max(0, Math.min(fadeIn, span))
    const fo = Math.max(0, Math.min(fadeOut, span - fi))
    if (fi > 0 || fo > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const inW = (fi / duration) * width
      const outW = (fo / duration) * width
      ctx.moveTo(inX, fi > 0 ? h - 2 : 2)
      if (fi > 0) ctx.lineTo(inX + inW, 2)
      ctx.lineTo(outX - outW, 2)
      if (fo > 0) ctx.lineTo(outX, h - 2)
      ctx.stroke()
    }

    // Last, so the ruler and the disclaimer survive the trim shading above them.
    if (invented) drawStreamOverlay(ctx, width, h, duration)
    // `position` only participates for streaming cues, where it drives the
    // elapsed sweep; file cues get their playhead from the DOM element below.
  }, [peaks, decor, duration, inPoint, outPoint, fadeIn, fadeOut, color, width, position])

  const timeAt = useCallback(
    (clientX: number): number => {
      const el = wrap.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
    },
    [duration],
  )

  const move = useCallback(
    (clientX: number, which: 'in' | 'out') => {
      const t = timeAt(clientX)
      if (which === 'in') onChange(Math.min(t, outPoint - MIN_SPAN), outPoint)
      else onChange(inPoint, Math.max(t, inPoint + MIN_SPAN))
    },
    [timeAt, onChange, inPoint, outPoint],
  )

  const startDrag = (which: 'in' | 'out') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(which)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    e.preventDefault()
    move(e.clientX, dragging)
  }

  const pct = (t: number) => `${(t / duration) * 100}%`

  return (
    <div
      className="wave"
      ref={wrap}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      <canvas ref={canvas} />
      <div className="wave-handle in" style={{ left: pct(inPoint) }} onPointerDown={startDrag('in')}>
        <span />
      </div>
      <div className="wave-handle out" style={{ left: pct(outPoint) }} onPointerDown={startDrag('out')}>
        <span />
      </div>
      {position !== null && <div className="wave-playhead" style={{ left: pct(position) }} aria-hidden />}
    </div>
  )
}
