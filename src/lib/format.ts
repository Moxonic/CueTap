export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function gainToDb(gain: number): number {
  if (gain <= 0.0001) return -60
  return Math.max(-60, 20 * Math.log10(gain))
}

export function dbToGain(db: number): number {
  return db <= -60 ? 0 : Math.pow(10, db / 20)
}

export function formatDb(gain: number): string {
  const db = gainToDb(gain)
  if (db <= -60) return '−∞ dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
