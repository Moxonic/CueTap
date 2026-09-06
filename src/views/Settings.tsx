import { useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import { Field, Segmented, Sheet, Slider } from '../components/controls'
import { requestPersistence, storageEstimate } from '../data/db'
import { useStore } from '../data/store'
import { formatBytes, formatDb, dbToGain, gainToDb } from '../lib/format'
import type { PadTrigger } from '../data/types'
import {
  beginLogin,
  disconnect,
  getClientId,
  isConnected,
  loopbackAlternative,
  redirectUri,
  redirectUriProblem,
  setClientId,
  subscribeAuth,
  isValidClientId,
  normaliseClientId,
} from '../spotify/auth'
import SpotifyMark from '../components/SpotifyMark'
import { currentUser } from '../spotify/api'
import { spotify } from '../spotify/player'

export default function Settings({ onClose }: { onClose: () => void }) {
  const { show, updateSettings, renameShow, clearShow } = useStore()
  const s = show.settings
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void storageEstimate().then(setStorage)
    // navigator.storage.persisted is absent on older Safari, so `?.()` yields
    // undefined and chaining .then onto it would throw.
    const persistedCheck = navigator.storage?.persisted?.()
    if (persistedCheck) persistedCheck.then(setPersisted).catch(() => setPersisted(null))
    else setPersisted(null)
  }, [])

  return (
    <Sheet title="Settings" onClose={onClose}>
      <input
        className="name-input"
        value={show.name}
        onChange={(e) => renameShow(e.target.value)}
        placeholder="Show name"
      />

      <Field label="Master volume" hint={formatDb(s.masterGain)}>
        <Slider
          value={gainToDb(s.masterGain)}
          min={-40}
          max={6}
          step={0.5}
          onChange={(db) => updateSettings({ masterGain: dbToGain(db) })}
          format={(db) => (db <= -40 ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`)}
        />
      </Field>

      <Field
        label="Playback mode"
        hint={s.mode === 'exclusive' ? 'firing a cue releases the others' : 'cues stack on each other'}
      >
        <Segmented<'exclusive' | 'poly'>
          value={s.mode}
          onChange={(mode) => updateSettings({ mode })}
          options={[
            { value: 'exclusive', label: 'One at a time' },
            { value: 'poly', label: 'Layered' },
          ]}
        />
      </Field>

      <Field label="Tapping a playing pad" hint="individual cues can override this in the cue editor">
        <Segmented<PadTrigger>
          value={s.padTrigger}
          onChange={(padTrigger) => updateSettings({ padTrigger })}
          options={[
            { value: 'toggle', label: 'Stops it', title: 'Best for loops and beds' },
            { value: 'restart', label: 'Restarts', title: 'Stop and fire again from the in-point' },
            { value: 'stack', label: 'Stacks', title: 'Layers on itself — best for one-shot effects' },
          ]}
        />
      </Field>

      <Field label="STOP ALL release" hint="double-tap STOP ALL to cut instantly instead">
        <Slider
          value={s.globalRelease}
          min={0.05}
          max={15}
          step={0.05}
          onChange={(globalRelease) => updateSettings({ globalRelease })}
          format={(v) => `${v.toFixed(2)}s`}
        />
      </Field>

      <div className="two-up">
        <Field label="Pad columns">
          <Slider
            value={s.gridCols}
            min={2}
            max={5}
            step={1}
            onChange={(gridCols) => updateSettings({ gridCols })}
            format={(v) => String(v)}
          />
        </Field>
        <Field label="Pad rows">
          <Slider
            value={s.gridRows}
            min={2}
            max={8}
            step={1}
            onChange={(gridRows) => updateSettings({ gridRows })}
            format={(v) => String(v)}
          />
        </Field>
      </div>

      <Field
        label="Live mode"
        hint="keeps the screen awake and the audio session alive; leave this on during a show"
      >
        <Segmented<'on' | 'off'>
          value={s.liveMode ? 'on' : 'off'}
          onChange={(v) => {
            const liveMode = v === 'on'
            updateSettings({ liveMode })
            if (liveMode) void engine.enableLiveMode()
            else engine.disableLiveMode()
          }}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </Field>

      <SpotifySection />

      <div className="note">
        <p>
          <b>Storage.</b>{' '}
          {storage ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)} available.` : 'Checking…'}{' '}
          {persisted === false && (
            <>
              Your audio is <b>not</b> protected from eviction — the browser may clear it under
              storage pressure.{' '}
              <button
                className="linkish"
                onClick={() => void requestPersistence().then(setPersisted)}
              >
                Request persistent storage
              </button>
              , and install CueTap to your home screen, which makes the request far more likely to
              be granted.
            </>
          )}
          {persisted === true && <>Storage is marked persistent — your audio will not be evicted.</>}
        </p>
        <p>
          <b>Bluetooth.</b> Audio follows whatever output the phone is using, so pairing a speaker
          is enough — there is nothing to configure here. Expect 150–250 ms of latency on A2DP.
        </p>
        <p>
          <b>Foot pedals.</b> Space, Enter, → and Page Down all fire GO, so most Bluetooth
          page-turner pedals work as a GO footswitch. Escape stops everything.
        </p>
      </div>

      {confirmClear ? (
        <div className="confirm">
          <span>Delete every cue and all imported audio?</span>
          <button
            className="danger"
            onClick={() => {
              void clearShow()
              setConfirmClear(false)
              onClose()
            }}
          >
            Yes, clear the show
          </button>
          <button onClick={() => setConfirmClear(false)}>Cancel</button>
        </div>
      ) : (
        <button className="danger" onClick={() => setConfirmClear(true)}>
          Clear show
        </button>
      )}
    </Sheet>
  )
}

/**
 * Spotify connection.
 *
 * The Client ID is entered here rather than compiled in: this repo is public,
 * and every deployment (localhost, LAN address, hosted build) is a different
 * origin that must be registered as a redirect URI in the Spotify dashboard.
 * Showing the exact URI to paste removes the single most common setup failure.
 */
function SpotifySection() {
  const { setError } = useStore()
  const [clientId, setClientIdState] = useState(getClientId())
  const [connected, setConnected] = useState(isConnected())
  const [account, setAccount] = useState<{ name: string; product: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const uri = redirectUri()
  const problem = redirectUriProblem()
  const idOk = isValidClientId(clientId)

  useEffect(() => subscribeAuth(() => setConnected(isConnected())), [])

  useEffect(() => {
    if (!connected) {
      setAccount(null)
      return
    }
    void currentUser().then(setAccount)
  }, [connected])

  const connect = () => {
    setClientId(clientId)
    beginLogin().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const copyUri = () => {
    void navigator.clipboard
      ?.writeText(uri)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => setError(`Copy failed. The redirect URI is: ${uri}`))
  }

  if (connected) {
    return (
      <Field
        label="Spotify"
        icon={<SpotifyMark size={16} />}
        hint={account ? `${account.name} · ${account.product}` : 'connected'}
      >
        {account && account.product !== 'premium' && (
          <div className="warn">
            This account is <b>{account.product}</b>. The Spotify player needs Premium — cues will
            fail to start without it.
          </div>
        )}
        <button
          onClick={() => {
            spotify.teardown()
            disconnect()
          }}
        >
          Disconnect Spotify
        </button>
      </Field>
    )
  }

  // Spotify has no public client, so an app registration is unavoidable. The
  // best that can be done is to put each action next to the step that needs it
  // and validate as we go, rather than describing seven things in a paragraph.
  return (
    <Field label="Spotify" icon={<SpotifyMark size={16} muted />} hint="not connected">
      <ol className="steps">
        <li>
          <span className="step-title">Create a free Spotify app</span>
          <a
            className="step-action"
            href="https://developer.spotify.com/dashboard"
            target="_blank"
            rel="noreferrer noopener"
          >
            Open the Spotify dashboard ↗
          </a>
        </li>

        <li>
          <span className="step-title">Add this redirect URI to it</span>
          {problem ? (
            <div className="warn">
              <b>This address will not work.</b> {problem}
              <button className="linkish" onClick={() => window.location.assign(loopbackAlternative())}>
                Reopen on 127.0.0.1
              </button>
              <small>A different origin, so the Client ID is entered again there.</small>
            </div>
          ) : (
            <button className="step-action copy-uri" onClick={copyUri}>
              {copied ? '✓ Copied' : `Copy ${uri}`}
            </button>
          )}
        </li>

        <li>
          <span className="step-title">Paste its Client ID</span>
          <input
            className="name-input"
            value={clientId}
            // Normalise on paste and on blur, never per keystroke: extracting a
            // 32-hex run from a half-typed value feeds on its own output and
            // corrupts an ID that is being typed by hand.
            onChange={(e) => setClientIdState(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (/[0-9a-f]{32}/i.test(text)) {
                e.preventDefault()
                setClientIdState(normaliseClientId(text))
              }
            }}
            onBlur={() => setClientIdState((v) => normaliseClientId(v))}
            placeholder="32 letters and numbers"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />
          {clientId.length > 0 && !idOk && (
            <small className="step-warn">
              That does not look like a Client ID — it is 32 letters and numbers, from the app page
              on the dashboard.
            </small>
          )}
        </li>
      </ol>

      <button className="primary" disabled={!idOk || !!problem} onClick={connect}>
        Connect Spotify
      </button>

      <div className="note">
        <p>
          Playback needs Spotify <b>Premium</b>. A new dashboard app starts in development mode,
          which is fine — you are already on its allowlist as its owner.
        </p>
      </div>
    </Field>
  )
}
