import { useCallback, useEffect, useRef, useState } from 'react'
import { Field, Sheet } from '../components/controls'
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
  const [armed, setArmed] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const analyser = useRef<AnalyserNode | null>(null)
  const sourceNode = useRef<MediaStreamAudioSourceNode | null>(null)
  const raf = useRef(0)
  const startedAt = useRef(0)
  // The meter loop outlives any single render, so it reads recording state from
  // a ref rather than closing over a stale value.
  const recordingRef = useRef(false)

  const closeStream = useCallback(() => {
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
    setArmed(false)
    setLevel(0)
  }, [])

  const runMeter = useCallback(() => {
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
      if (recordingRef.current) setElapsed((performance.now() - startedAt.current) / 1000)
      raf.current = requestAnimationFrame(loop)
    }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(loop)
  }, [])

  /**
   * Open an input and start metering, without recording yet. Having the level
   * live before the take is what makes an external interface usable — auto gain
   * is off, so the only way to set the level is to watch it.
   */
  const openStream = useCallback(
    async (id?: string) => {
      closeStream()
      try {
        // The browser defaults are tuned for voice calls: echo cancellation, noise
        // suppression and AGC will gate, pump and hollow out music. All off.
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            ...(id ? { deviceId: { exact: id } } : {}),
          },
        })
        stream.current = s

        if (engine.ctx) {
          const node = engine.ctx.createMediaStreamSource(s)
          const an = engine.ctx.createAnalyser()
          an.fftSize = 1024
          node.connect(an)
          // Deliberately not connected to the destination — monitoring the input
          // through the same speaker is a feedback loop.
          sourceNode.current = node
          analyser.current = an
        }

        setArmed(true)
        setPeakHold(0)
        runMeter()

        // Labels are blank until a permission has been granted, so the device
        // list is only worth reading once a stream is open.
        try {
          const list = await navigator.mediaDevices.enumerateDevices()
          setDevices(list.filter((d) => d.kind === 'audioinput'))
        } catch {
          /* enumeration is optional */
        }
      } catch (e) {
        setError(
          `Audio input unavailable: ${String(e)}. On a phone this usually means the page is not on ` +
            `https:// — use the https address the dev server prints, or install the app to your home screen.`,
        )
      }
    },
    [closeStream, runMeter, setError],
  )

  // Arm on open so levels are visible before committing to a take.
  useEffect(() => {
    void openStream()
    return closeStream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-open when a different input is chosen, but never mid-take.
  const changeDevice = (id: string) => {
    setDeviceId(id)
    if (!recordingRef.current) void openStream(id || undefined)
  }

  const start = () => {
    const s = stream.current
    if (!s) return
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(s, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    rec.onstop = () => void finish(rec.mimeType || mimeType || 'audio/webm')
    recorder.current = rec
    rec.start(250)

    startedAt.current = performance.now()
    recordingRef.current = true
    setRecording(true)
    setElapsed(0)
    setPeakHold(0)
  }

  const stop = () => {
    recordingRef.current = false
    setRecording(false)
    setSaving(true)
    recorder.current?.stop()
  }

  const finish = async (mimeType: string) => {
    const blob = new Blob(chunks.current, { type: mimeType })
    chunks.current = []
    recorder.current = null
    if (blob.size === 0) {
      setError('The recording came back empty — nothing was captured.')
      setSaving(false)
      return
    }
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const cue = await importBlob(blob, `Recording ${stamp}`)
    setSaving(false)
    if (cue) {
      closeStream()
      onClose()
    }
  }

  const clipping = peakHold > 0.98
  const usingExternal =
    deviceId !== '' && !/built-?in|internal|iphone|ipad|android/i.test(currentLabel(devices, deviceId))

  return (
    <Sheet title="Record" onClose={() => (recording ? stop() : (closeStream(), onClose()))}>
      {devices.length > 1 && (
        <Field label="Input" hint={armed ? 'live' : 'not armed'}>
          <select className="select" value={deviceId} onChange={(e) => changeDevice(e.target.value)}>
            <option value="">Default input</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Input ${i + 1}`}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className={`meter${clipping ? ' clip' : ''}`}>
        <div className="meter-fill" style={{ width: `${Math.min(100, level * 100)}%` }} />
        <div className="meter-peak" style={{ left: `${Math.min(100, peakHold * 100)}%` }} />
      </div>

      <div className="rec-time">{formatClock(elapsed)}</div>

      <button
        className={`rec-button${recording ? ' on' : ''}`}
        onClick={() => (recording ? stop() : start())}
        disabled={saving || !armed}
      >
        {saving ? 'Saving…' : recording ? 'Stop and save' : armed ? 'Start recording' : 'Arming input…'}
      </button>

      <div className="note">
        <p>
          Record voice cues, announcements, or anything in the room. Plug in a USB-C audio
          interface and it appears under <b>Input</b> above, at line level and in stereo.
        </p>
        <p>
          Aim for peaks around 70–90%. Auto gain is off so the recording keeps its dynamics, which
          also means nothing is protecting you from clipping.
          {usingExternal && <> Set the level on the interface, not in the app.</>}
        </p>
      </div>
    </Sheet>
  )
}

function currentLabel(devices: MediaDeviceInfo[], id: string): string {
  return devices.find((d) => d.deviceId === id)?.label ?? ''
}
