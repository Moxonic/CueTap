import { useCallback, useEffect, useRef, useState } from 'react'
import { Sheet } from '../components/controls'
import { useStore } from '../data/store'
import { formatClock } from '../lib/format'
import { engine } from '../audio/engine'

/** iOS produces mp4/aac, Android webm/opus. decodeAudioData reads both. */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus']
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) return t
  }
  return undefined
}

export default function Recorder({ onClose }: { onClose: () => void }) {
  const { importBlob, setError } = useStore()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [peakHold, setPeakHold] = useState(0)
  const [saving, setSaving] = useState(false)

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const analyser = useRef<AnalyserNode | null>(null)
  const sourceNode = useRef<MediaStreamAudioSourceNode | null>(null)
  const raf = useRef(0)
  const startedAt = useRef(0)

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = 0
    try {
      sourceNode.current?.disconnect()
    } catch {
      /* already gone */
    }
    sourceNode.current = null
    analyser.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    recorder.current = null
  }, [])

  useEffect(() => teardown, [teardown])

  const start = async () => {
    try {
      // The browser defaults are tuned for voice calls: echo cancellation, noise
      // suppression and AGC will gate, pump and hollow out music. All off.
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      })
      stream.current = s

      if (engine.ctx) {
        const node = engine.ctx.createMediaStreamSource(s)
        const an = engine.ctx.createAnalyser()
        an.fftSize = 1024
        node.connect(an)
        // Deliberately not connected to the destination — monitoring the mic
        // through the same speaker is a feedback loop.
        sourceNode.current = node
        analyser.current = an
      }

      const mimeType = pickMimeType()
      const rec = new MediaRecorder(s, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.onstop = () => {
        void finish(rec.mimeType || mimeType || 'audio/webm')
      }
      recorder.current = rec
      rec.start(250)

      startedAt.current = performance.now()
      setRecording(true)
      setPeakHold(0)
      meter()
    } catch (e) {
      setError(
        `Microphone unavailable: ${String(e)}. On a phone this usually means the page is not on https:// — ` +
          `use the https address the dev server prints, or install the app to your home screen.`,
      )
    }
  }

  const meter = () => {
    const buf = new Float32Array(1024)
    const loop = () => {
      const an = analyser.current
      if (an) {
        an.getFloatTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i])
          if (v > peak) peak = v
        }
        setLevel(peak)
        setPeakHold((p) => Math.max(p * 0.995, peak))
      }
      setElapsed((performance.now() - startedAt.current) / 1000)
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
  }

  const stop = () => {
    setRecording(false)
    setSaving(true)
    recorder.current?.stop()
  }

  const finish = async (mimeType: string) => {
    const blob = new Blob(chunks.current, { type: mimeType })
    chunks.current = []
    teardown()
    if (blob.size === 0) {
      setError('The recording came back empty — nothing was captured.')
      setSaving(false)
      return
    }
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const cue = await importBlob(blob, `Recording ${stamp}`)
    setSaving(false)
    if (cue) onClose()
  }

  const clipping = peakHold > 0.98

  return (
    <Sheet title="Record" onClose={() => (recording ? stop() : onClose())}>
      <div className={`meter${clipping ? ' clip' : ''}`}>
        <div className="meter-fill" style={{ width: `${Math.min(100, level * 100)}%` }} />
        <div className="meter-peak" style={{ left: `${Math.min(100, peakHold * 100)}%` }} />
      </div>

      <div className="rec-time">{formatClock(elapsed)}</div>

      <button
        className={`rec-button${recording ? ' on' : ''}`}
        onClick={() => (recording ? stop() : void start())}
        disabled={saving}
      >
        {saving ? 'Saving…' : recording ? 'Stop and save' : 'Start recording'}
      </button>

      <div className="note">
        <p>
          <b>Recording from Spotify, YouTube or Apple Music</b> — play the track on a{' '}
          <b>different device</b> or through a speaker and capture it here. Those apps block direct
          audio capture at the operating-system level, so the microphone (or a line input via a
          USB-C/Lightning audio interface) is the only route that works.
        </p>
        <p>
          On iOS, opening the microphone switches the phone into record mode and will duck or
          interrupt anything playing on the same phone — including CueTap.
        </p>
        <p>
          Aim for peaks around 70–90% on the meter. Processing is disabled so the recording keeps
          its dynamics; that also means nothing is protecting you from clipping.
        </p>
      </div>
    </Sheet>
  )
}
