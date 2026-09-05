/**
 * Both iOS and Android refuse to start an AudioContext outside a user gesture, so
 * the app cannot make a sound until something is tapped. Rather than hide that
 * behind the first cue — and have the first cue of a show silently fail — it gets
 * its own deliberate arm step.
 */
export default function ArmScreen({
  onArm,
  cueCount,
  showName,
}: {
  onArm: () => void | Promise<void>
  cueCount: number
  showName: string
}) {
  return (
    <button className="arm" onClick={() => void onArm()}>
      <div className="arm-mark" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <h1>CueTap</h1>
      <p className="arm-show">
        {showName} · {cueCount} cue{cueCount === 1 ? '' : 's'}
      </p>
      <span className="arm-cta">Tap to arm audio</span>
      <p className="arm-note">
        Connect your Bluetooth speaker first, then arm. Bluetooth adds roughly 150–250 ms of
        delay — fine for music and beds, noticeable on tight spot effects.
      </p>
    </button>
  )
}
