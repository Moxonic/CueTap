/**
 * The Spotify mark.
 *
 * Spotify's developer guidelines require their own logo be used to identify a
 * Spotify integration, so this stands in for the generic note glyph everywhere
 * a Spotify cue or connection is indicated.
 *
 * `mono` draws the arcs in the current text colour on a transparent ground, for
 * use inside a coloured chip where a green circle would fight the chip.
 */
export default function SpotifyMark({ size = 20, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Spotify"
      focusable="false"
    >
      {!mono && <circle cx="12" cy="12" r="12" fill="#1DB954" />}
      <g
        fill="none"
        stroke={mono ? 'currentColor' : '#ffffff'}
        strokeLinecap="round"
        // The three arcs bow upward and shrink top to bottom.
      >
        <path d="M5.2 9.3C9 7.6 15.4 8 19 10.1" strokeWidth={mono ? 2.4 : 2.5} />
        <path d="M6.6 12.8C9.8 11.4 14.9 11.8 17.9 13.5" strokeWidth={mono ? 2 : 2.1} />
        <path d="M7.7 16.1C10.3 15 14.2 15.3 16.6 16.7" strokeWidth={mono ? 1.7 : 1.7} />
      </g>
    </svg>
  )
}
