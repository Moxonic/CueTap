import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decorativePeaks } from '../lib/decorPeaks'
import { formatClock, formatTime } from '../lib/format'

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

/** Holding a handle still this long zooms in on it. */
const HOLD_MS = 1000
/** Movement that counts as still dragging rather than holding, in px. */
const HOLD_SLOP = 4
/** How much of the track the zoomed strip shows. */
const ZOOM = 10
/** Never zoom tighter than this many seconds across the strip. */
const MIN_VIEW = 2

/** Tick spacings that read as round numbers of seconds or minutes. */
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/** The coarsest step that still puts roughly six labels across the strip. */
function tickStep(span: number, width: number): number {
  const target = span / Math.max(2, Math.min(8, Math.floor(width / 64)))
  return TICK_STEPS.find((s) => s >= target) ?? TICK_STEPS[TICK_STEPS.length - 1]
}

/** The stretch of the track the strip currently shows, in seconds. */
interface View {
  start: number
  span: number
}

/**
 * Time ruler across the visible stretch. Always on for a decorative shape, where
 * it is the only thing a trim point can be judged against, and on for any cue
 * while zoomed, where the sub-second ticks are the point of zooming.
 */
function drawRuler(ctx: CanvasRenderingContext2D, width: number, h: number, view: View, duration: number): void {
  const step = tickStep(view.span, width)
  const label = step < 1 ? formatTime : formatClock
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'

  // Index-based so 0.1 steps do not accumulate float error into the labels.
  const first = Math.max(1, Math.ceil(view.start / step))
  for (let i = first; i * step < Math.min(duration, view.start + view.span); i++) {
    const t = i * step
    const x = Math.round(((t - view.start) / view.span) * width) + 0.5
    ctx.fillStyle = 'rgba(255,255,255,0.20)'
    ctx.fillRect(x, 0, 1, h)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillText(label(t), x + 3, h - 14)
  }

  if (view.start + view.span >= duration) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.textAlign = 'right'
    ctx.fillText(label(duration), width - 4, h - 14)
    ctx.textAlign = 'left'
  }
}

/**
 * Say what a decorative shape is. Spotify exposes no waveform, so the shape is
 * decoration and trimming by eye against it would be wrong. Drawn on top of the
 * bars, not behind them.
 */
function drawStreamWatermark(ctx: CanvasRenderingContext2D): void {
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textBaseline = 'top'
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
  const [zoom, setZoom] = useState<View | null>(null)

  // Read from the hold timer, which outlives the render that started it.
  const points = useRef({ inPoint, outPoint })
  points.current = { inPoint, outPoint }
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number }>({ timer: null, x: 0 })
  /** Where a zoomed drag took hold: handle time and pointer x, for relative moves. */
  const grab = useRef({ t: 0, x: 0 })

  const view: View = zoom ?? { start: 0, span: duration }

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

  useEffect(
    () => () => {
      if (hold.current.timer !== null) clearTimeout(hold.current.timer)
    },
    [],
  )

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

    const xOf = (t: number) => ((t - view.start) / view.span) * width
    const mid = h / 2
    const inX = xOf(inPoint)
    const outX = xOf(outPoint)

    // `shape` is the real analysis for a file cue, and a seeded decoration for a
    // streaming one — Spotify never exposes amplitude, so there is nothing true
    // to draw. Both render through the same bars; the streaming case is marked
    // by the overlay below and dimmed so it does not read as measured data.
    const shape = peaks.length > 0 ? peaks : decor
    const invented = peaks.length === 0 && decor !== null
    const playX = position === null ? null : xOf(position)

    if (shape) {
      for (let x = 0; x < width; x++) {
        const t = view.start + (x / width) * view.span
        const peak = shape[Math.min(shape.length - 1, Math.floor((t / duration) * shape.length))] ?? 0
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
    ctx.fillRect(0, 0, Math.max(0, Math.min(width, inX)), h)
    ctx.fillRect(Math.max(0, outX), 0, Math.max(0, width - Math.max(0, outX)), h)

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
      ctx.moveTo(inX, fi > 0 ? h - 2 : 2)
      if (fi > 0) ctx.lineTo(xOf(inPoint + fi), 2)
      ctx.lineTo(xOf(outPoint - fo), 2)
      if (fo > 0) ctx.lineTo(outX, h - 2)
      ctx.stroke()
    }

    // Last, so the ruler and the disclaimer survive the trim shading above them.
    if (invented || zoom) drawRuler(ctx, width, h, view, duration)
    if (invented) drawStreamWatermark(ctx)
    // `position` only participates for streaming cues, where it drives the
    // elapsed sweep; file cues get their playhead from the DOM element below.
    // `view` is derived from `zoom` and `duration`, both listed.
  }, [peaks, decor, duration, inPoint, outPoint, fadeIn, fadeOut, color, width, position, zoom])

  const timeAt = useCallback(
    (clientX: number): number => {
      const el = wrap.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
    },
    [duration],
  )

  const moveTo = useCallback(
    (t: number, which: 'in' | 'out') => {
      if (which === 'in') onChange(Math.min(t, outPoint - MIN_SPAN), outPoint)
      else onChange(inPoint, Math.max(t, inPoint + MIN_SPAN))
    },
    [onChange, inPoint, outPoint],
  )

  const stopHold = () => {
    if (hold.current.timer !== null) clearTimeout(hold.current.timer)
    hold.current.timer = null
  }

  /** (Re)start the hold countdown from this pointer position. */
  const armHold = (clientX: number, which: 'in' | 'out') => {
    stopHold()
    hold.current.x = clientX
    hold.current.timer = setTimeout(() => {
      hold.current.timer = null
      const span = Math.min(duration, Math.max(MIN_VIEW, duration / ZOOM))
      // Not worth it on a clip already about as short as the zoomed window.
      if (span >= duration * 0.9) return
      const t = points.current[which === 'in' ? 'inPoint' : 'outPoint']
      // Keep the handle at the same spot on screen, so zooming does not move it
      // out from under the finger.
      const start = Math.max(0, Math.min(duration - span, t - (t / duration) * span))
      grab.current = { t, x: hold.current.x }
      setZoom({ start, span })
    }, HOLD_MS)
  }

  const startDrag = (which: 'in' | 'out') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(which)
    armHold(e.clientX, which)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    e.preventDefault()

    if (zoom) {
      // Relative, so the finger travels ZOOM times as far per second of track.
      // Pointer capture keeps reporting past the strip's edges, so dragging off
      // either end pans the window along rather than stopping at it.
      const r = wrap.current?.getBoundingClientRect()
      if (!r) return
      const dt = ((e.clientX - grab.current.x) / r.width) * zoom.span
      const t = Math.max(0, Math.min(duration, grab.current.t + dt))
      moveTo(t, dragging)
      if (t < zoom.start) setZoom({ ...zoom, start: t })
      else if (t > zoom.start + zoom.span) setZoom({ ...zoom, start: t - zoom.span })
      return
    }

    // Only a still finger counts as holding; moving restarts the countdown.
    if (Math.abs(e.clientX - hold.current.x) > HOLD_SLOP) armHold(e.clientX, dragging)
    moveTo(timeAt(e.clientX), dragging)
  }

  const endDrag = () => {
    stopHold()
    setDragging(null)
    setZoom(null)
  }

  const pct = (t: number) => `${((t - view.start) / view.span) * 100}%`

  return (
    <div
      className={`wave${zoom ? ' zoomed' : ''}`}
      ref={wrap}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <canvas ref={canvas} />
      <div className="wave-handle in" style={{ left: pct(inPoint) }} onPointerDown={startDrag('in')}>
        <span />
      </div>
      <div className="wave-handle out" style={{ left: pct(outPoint) }} onPointerDown={startDrag('out')}>
        <span />
      </div>
      {position !== null && <div className="wave-playhead" style={{ left: pct(position) }} aria-hidden />}
      {zoom && <div className="wave-zoom">×{Math.round(duration / zoom.span)}</div>}
    </div>
  )
}
