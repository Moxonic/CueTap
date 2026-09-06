/**
 * Local-file glyph: a small waveform, matching the stroke style of RecordMark
 * so the three "add a cue" icons read as one family.
 */
export default function FileMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Audio file"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 13v-2" />
      <path d="M8 16v-8" />
      <path d="M12 18.5v-13" />
      <path d="M16 16v-8" />
      <path d="M20 13v-2" />
    </svg>
  )
}
