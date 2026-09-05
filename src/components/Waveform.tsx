import { useCallback, useEffect, useRef, useState } from 'react'

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
  onChange: (inPoint: number, outPoint: number) => void
}

/** Smallest usable selection, so the handles can never cross. */
const MIN_SPAN = 0.05

export default function Waveform({
  peaks,
  duration,
  inPoint,
  outPoint,
  fadeIn,
  fadeOut,
  color,
  position,
  onChange,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null)

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

    for (let x = 0; x < width; x++) {
      const peak = peaks[Math.floor((x / width) * peaks.length)] ?? 0
      const bar = Math.max(1, peak * (h * 0.86))
      const inside = x >= inX && x <= outX
      ctx.fillStyle = inside ? color : 'rgba(255,255,255,0.13)'
      ctx.fillRect(x, mid - bar / 2, 1, bar)
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
  }, [peaks, duration, inPoint, outPoint, fadeIn, fadeOut, color, width])

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
