import { useTransport } from '../audio/useTransport'
import { Field, Segmented, Sheet, Slider } from '../components/controls'
import Waveform from '../components/Waveform'
import SpotifyMark from '../components/SpotifyMark'
import { useStore } from '../data/store'
import { formatDb, formatTime, dbToGain, gainToDb } from '../lib/format'
import {
  isStream,
  PAD_COLORS,
  STREAM_LIMITS,
  type Cue,
  type FollowAction,
  type LoopMode,
  type StopMode,
} from '../data/types'

export default function CueEditor({ cue, onClose }: { cue: Cue; onClose: () => void }) {
  const { show, updateCue, deleteCue, fire, stopCue, moveCue } = useStore()
  const transport = useTransport()
  const state = transport.states.get(cue.id)
  const set = (patch: Partial<Cue>) => updateCue(cue.id, patch)
  const span = cue.outPoint - cue.inPoint
  const looping = cue.loop !== 'off'
  const index = show.cues.findIndex((c) => c.id === cue.id)
  const stream = isStream(cue)
  // Mirrors Voice.startOneShot: the fade in gets priority and the fade out is
  // shortened to whatever is left, so say so rather than showing a value that
  // will not be heard.
  const effectiveFadeOut = Math.max(0, Math.min(cue.fadeOut, span - Math.min(cue.fadeIn, span)))

  return (
    <Sheet
      title="Cue"
      onClose={onClose}
      actions={
        state?.playing ? (
          <button className="mini stop" onClick={() => stopCue(cue.id)}>
            ■
          </button>
        ) : (
          <button className="mini play" onClick={() => fire(cue.id)}>
            ▶
          </button>
        )
      }
    >
      {stream && (
        <div className="stream-banner">
          <SpotifyMark size={18} />
          <span>
            {cue.spotify?.title} — {cue.spotify?.artist}
          </span>
        </div>
      )}

      <input
        className="name-input"
        value={cue.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Cue name"
      />

      <div className="swatches">
        {PAD_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch${c === cue.color ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => set({ color: c })}
            aria-label={`Colour ${c}`}
          />
        ))}
      </div>

      <Field label="Order" hint={`cue ${index + 1} of ${show.cues.length}`}>
        {/* Touch browsers do not fire HTML5 drag events, so the list view's
            drag-to-reorder is desktop-only. These work everywhere. */}
        <div className="wave-tools">
          <button disabled={index <= 0} onClick={() => moveCue(index, index - 1)}>
            ↑ Move earlier
          </button>
          <button disabled={index >= show.cues.length - 1} onClick={() => moveCue(index, index + 1)}>
            ↓ Move later
          </button>
          <button disabled={index <= 0} onClick={() => moveCue(index, 0)}>
            ⤒ To start
          </button>
          <button
            disabled={index >= show.cues.length - 1}
            onClick={() => moveCue(index, show.cues.length - 1)}
          >
            ⤓ To end
          </button>
        </div>
      </Field>

      <Field label="Trim" hint={`${formatTime(cue.inPoint)} → ${formatTime(cue.outPoint)} · ${formatTime(span)}`}>
        <Waveform
          peaks={cue.peaks}
          duration={cue.duration}
          inPoint={cue.inPoint}
          outPoint={cue.outPoint}
          fadeIn={cue.fadeIn}
          fadeOut={cue.fadeOut}
          color={cue.color}
          position={state?.playing ? state.position : null}
          onChange={(inPoint, outPoint) => set({ inPoint, outPoint })}
        />
        <div className="wave-tools">
          <button onClick={() => set({ inPoint: 0, outPoint: cue.duration })}>Reset trim</button>
          {state?.playing && (
            <>
              <button onClick={() => set({ inPoint: Math.min(state.position, cue.outPoint - 0.05) })}>
                In at playhead
              </button>
              <button onClick={() => set({ outPoint: Math.max(state.position, cue.inPoint + 0.05) })}>
                Out at playhead
              </button>
            </>
          )}
        </div>
      </Field>

      <Field label="Volume" hint={formatDb(cue.gain)}>
        <Slider
          value={gainToDb(cue.gain)}
          min={-60}
          max={6}
          step={0.5}
          onChange={(db) => set({ gain: dbToGain(db) })}
          format={(db) => (db <= -60 ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`)}
        />
      </Field>

      <div className="two-up">
        <Field label="Fade in">
          <Slider
            value={cue.fadeIn}
            min={0}
            max={Math.max(10, Math.min(30, span))}
            step={0.1}
            onChange={(v) => set({ fadeIn: v })}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </Field>
        <Field
          label="Fade out"
          hint={
            looping
              ? 'used on release'
              : effectiveFadeOut < cue.fadeOut
                ? `plays as ${effectiveFadeOut.toFixed(1)}s — the fade in takes the rest`
                : undefined
          }
        >
          <Slider
            value={cue.fadeOut}
            min={0}
            max={Math.max(10, Math.min(30, span))}
            step={0.1}
            onChange={(v) => set({ fadeOut: v })}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </Field>
      </div>

      <Field
        label="Loop"
        hint={
          stream
            ? cue.loop === 'off'
              ? 'plays once'
              : 'seeks back — short gap at the seam'
            : cue.loop === 'crossfade'
              ? 'blends the seam — for material with no clean loop point'
              : cue.loop === 'seamless'
                ? 'sample-accurate, no drift'
                : 'plays once'
        }
      >
        <Segmented<LoopMode>
          value={cue.loop}
          onChange={(v) => set({ loop: v })}
          options={
            stream
              ? [
                  { value: 'off', label: 'One shot' },
                  { value: 'seamless', label: 'Loop', title: STREAM_LIMITS.seamlessLoop },
                ]
              : [
                  { value: 'off', label: 'One shot' },
                  { value: 'seamless', label: 'Seamless' },
                  { value: 'crossfade', label: 'Crossfade' },
                ]
          }
        />
        {!stream && cue.loop === 'crossfade' && (
          <Slider
            value={cue.loopCrossfade}
            min={0.05}
            max={Math.max(0.5, Math.min(8, span / 2))}
            step={0.05}
            onChange={(v) => set({ loopCrossfade: v })}
            format={(v) => `${v.toFixed(2)}s blend`}
          />
        )}
      </Field>

      <Field label="When stopped" hint="how this cue behaves when something stops it">
        <Segmented<StopMode>
          value={cue.onStop}
          onChange={(v) => set({ onStop: v })}
          options={[
            { value: 'cut', label: 'Cut', title: 'Stop immediately' },
            { value: 'fade', label: 'Fade', title: 'Ramp down over the release time' },
            {
              value: 'finishPass',
              label: 'Finish',
              title: looping ? 'Play out the current loop pass, then stop' : 'Let it play to the end',
            },
          ]}
        />
        {cue.onStop !== 'cut' && (
          <Slider
            value={cue.releaseFade}
            min={0.05}
            max={15}
            step={0.05}
            onChange={(v) => set({ releaseFade: v })}
            format={(v) => `${v.toFixed(2)}s release`}
          />
        )}
      </Field>

      <Field
        label="When finished"
        hint={looping ? 'a loop never finishes on its own — set it to One shot to use follows' : undefined}
      >
        <Segmented<FollowAction>
          value={cue.followAction}
          onChange={(v) => set({ followAction: v })}
          options={[
            { value: 'none', label: 'Stop' },
            { value: 'next', label: 'Next cue' },
            { value: 'goto', label: 'Go to…' },
            { value: 'stopAll', label: 'Stop all' },
          ]}
        />
        {cue.followAction === 'goto' && (
          <select
            className="select"
            value={cue.followTarget ?? ''}
            onChange={(e) => set({ followTarget: e.target.value })}
          >
            <option value="">Choose a cue…</option>
            {show.cues
              .filter((c) => c.id !== cue.id)
              .map((c, i) => (
                <option key={c.id} value={c.id}>
                  {i + 1}. {c.name}
                </option>
              ))}
          </select>
        )}
        {cue.followAction !== 'none' && cue.followAction !== 'stopAll' && (
          <Slider
            value={cue.followDelay}
            min={-15}
            max={30}
            step={0.1}
            onChange={(v) => set({ followDelay: v })}
            format={(v) =>
              v < 0 ? `${v.toFixed(1)}s — overlaps` : v === 0 ? 'immediately' : `+${v.toFixed(1)}s gap`
            }
          />
        )}
      </Field>

      <Field label="Playback" hint={`show default: ${show.settings.mode === 'exclusive' ? 'one at a time' : 'layered'}`}>
        <Segmented<'inherit' | 'exclusive' | 'poly'>
          value={cue.exclusiveOverride === null ? 'inherit' : cue.exclusiveOverride ? 'exclusive' : 'poly'}
          onChange={(v) => set({ exclusiveOverride: v === 'inherit' ? null : v === 'exclusive' })}
          options={[
            { value: 'inherit', label: 'Follow show' },
            { value: 'exclusive', label: 'Solo', title: 'Firing this cue stops everything else' },
            { value: 'poly', label: 'Layer', title: 'This cue plays over whatever is already running' },
          ]}
        />
      </Field>

      {stream && (
        <div className="note">
          <p>
            <b>What differs on a Spotify cue.</b> Spotify decodes in a protected pipeline that
            cannot be routed into the audio engine, so this cue is driven through the SDK's own
            controls instead.
          </p>
          <p>
            {STREAM_LIMITS.fades} {STREAM_LIMITS.seamlessLoop} {STREAM_LIMITS.layering} It also
            needs a network connection and takes up to a few seconds to start, so keep it for
            preshow, interval and playoff music rather than anything that has to land on a visual.
          </p>
        </div>
      )}

      <button
        className="danger"
        onClick={() => {
          deleteCue(cue.id)
          onClose()
        }}
      >
        Delete cue
      </button>
    </Sheet>
  )
}
