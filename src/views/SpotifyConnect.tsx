import { useEffect, useState } from 'react'
import { Field } from '../components/controls'
import SpotifyMark from '../components/SpotifyMark'
import { useStore } from '../data/store'
import { currentUser, diagnose, type Diagnosis } from '../spotify/api'
import { spotify } from '../spotify/player'
import {
  beginLogin,
  disconnect,
  getClientId,
  isValidClientId,
  loopbackAlternative,
  normaliseClientId,
  redirectUri,
  redirectUriProblem,
  setClientId,
} from '../spotify/auth'

/**
 * First-run setup, shown inside the Spotify sheet itself.
 *
 * Spotify has no public client, so registering a dashboard app cannot be
 * skipped. What can be done is to put each action next to the step that needs
 * it, and refuse to start a login that is already known to fail.
 */
export function SpotifySetup() {
  const { setError } = useStore()
  const [clientId, setClientIdState] = useState(getClientId())
  const [copied, setCopied] = useState(false)
  const uri = redirectUri()
  const problem = redirectUriProblem()
  const idOk = isValidClientId(clientId)

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

  return (
    <>
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
          which is fine — you are already on its allowlist as its owner. Make sure <b>Web API</b> is
          ticked among the app's APIs, or searching will be refused.
        </p>
      </div>
    </>
  )
}

/** Account status, connection test and disconnect, for the connected state. */
export function SpotifyAccount() {
  const [account, setAccount] = useState<{ name: string; product: string } | null>(null)
  const [report, setReport] = useState<Diagnosis | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void currentUser().then(setAccount)
  }, [])

  return (
    <Field
      label="Connection"
      icon={<SpotifyMark size={16} />}
      hint={account ? `${account.name} · ${account.product}` : 'connected'}
    >
      {account && account.product !== 'premium' && (
        <div className="warn">
          This account is <b>{account.product}</b>. Search works, but playback needs Premium — cues
          will fail to start.
        </div>
      )}

      {report && <pre className={`diag${report.ok ? ' ok' : ''}`}>{report.lines.join('\n')}</pre>}

      <div className="wave-tools">
        <button
          disabled={testing}
          onClick={() => {
            setTesting(true)
            setReport(null)
            void diagnose()
              .then(setReport)
              .finally(() => setTesting(false))
          }}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          onClick={() => {
            spotify.teardown()
            disconnect()
            setReport(null)
          }}
        >
          Disconnect
        </button>
      </div>
    </Field>
  )
}
