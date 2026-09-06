import { Sheet } from '../components/controls'
import FileMark from '../components/FileMark'
import RecordMark from '../components/RecordMark'
import SpotifyMark from '../components/SpotifyMark'

/**
 * What the ＋ button opens: a choice of where a new cue's audio comes from.
 * One entry point rather than three separate header icons — the three
 * sources are all doing the same job ("add a cue") and belong behind one tap.
 */
export default function AddCue({
  onClose,
  onFiles,
  onSpotify,
  onRecord,
  spotifyConnected,
}: {
  onClose: () => void
  onFiles: () => void
  onSpotify: () => void
  onRecord: () => void
  spotifyConnected: boolean
}) {
  // Each handler owns the final overlay state itself (onFiles closes back to
  // 'none' before triggering the native picker; onSpotify/onRecord switch
  // straight to their own overlay). Calling onClose() again after them here
  // would fire a second setOverlay in the same handler — React batches both
  // and only the last one sticks, silently swallowing whichever overlay the
  // option was supposed to open.
  return (
    <Sheet title="Add a cue" onClose={onClose}>
      <div className="add-options">
        <button className="add-option" onClick={onFiles}>
          <span className="add-icon files">
            <FileMark size={22} />
          </span>
          <span className="add-text">
            <b>Audio files</b>
            <em>From your phone, Drive, Dropbox or OneDrive</em>
          </span>
        </button>

        <button className="add-option" onClick={onSpotify}>
          <span className="add-icon spotify">
            <SpotifyMark size={22} mono={!spotifyConnected} muted={!spotifyConnected} />
          </span>
          <span className="add-text">
            <b>Spotify</b>
            <em>{spotifyConnected ? 'Search and add a track' : 'Connect an account first'}</em>
          </span>
        </button>

        <button className="add-option" onClick={onRecord}>
          <span className="add-icon record">
            <RecordMark size={22} />
          </span>
          <span className="add-text">
            <b>Record</b>
            <em>Microphone or a line input</em>
          </span>
        </button>
      </div>
    </Sheet>
  )
}
