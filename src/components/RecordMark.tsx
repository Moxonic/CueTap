/**
 * Record glyph for the header: a filled disc inside a ring.
 *
 * The bullet character it replaces read as a generic dot at toolbar size, which
 * looked like a status light rather than a control. Red plus the ring is the
 * universal record affordance, and it matches the shape of the big button
 * inside the recorder sheet.
 */
export default function RecordMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Record"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.55" />
      <circle cx="12" cy="12" r="6" fill="currentColor" />
    </svg>
  )
}
