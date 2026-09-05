// Generates the PWA icons as PNGs with no image dependencies —
// raw RGBA scanlines, deflated with node's built-in zlib.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 = compression / filter / interlace, all 0

  // one filter byte (0 = None) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const src = y * size * 4
    const dst = y * (size * 4 + 1)
    raw[dst] = 0
    rgba.copy(raw, dst + 1, src, src + size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coverage of the pixel at (px,py) by a rounded rect — 3x3 supersampled for smooth edges. */
function roundRectCoverage(px, py, x, y, w, h, r) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const cx = px + (sx + 0.5) / 3
      const cy = py + (sy + 0.5) / 3
      if (cx < x || cy < y || cx > x + w || cy > y + h) continue
      // distance from the nearest corner circle centre
      const dx = Math.max(x + r - cx, 0, cx - (x + w - r))
      const dy = Math.max(y + r - cy, 0, cy - (y + h - r))
      if (dx * dx + dy * dy <= r * r) hits++
    }
  }
  return hits / 9
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4)
  const bg = [0x12, 0x15, 0x1a]
  const padOff = [0x2c, 0x33, 0x3d]
  const padOn = [0xff, 0x9d, 0x2e]

  // full-bleed background so the maskable variant survives any mask shape
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = bg[0]
    buf[i * 4 + 1] = bg[1]
    buf[i * 4 + 2] = bg[2]
    buf[i * 4 + 3] = 255
  }

  // 2x2 pad grid, inset far enough to stay inside a maskable safe zone
  const inset = size * 0.235
  const gap = size * 0.052
  const cell = (size - inset * 2 - gap) / 2
  const radius = cell * 0.24

  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 2; gx++) {
      const lit = gx === 0 && gy === 0
      const col = lit ? padOn : padOff
      const x = inset + gx * (cell + gap)
      const y = inset + gy * (cell + gap)
      const x0 = Math.max(0, Math.floor(x) - 1)
      const y0 = Math.max(0, Math.floor(y) - 1)
      const x1 = Math.min(size, Math.ceil(x + cell) + 1)
      const y1 = Math.min(size, Math.ceil(y + cell) + 1)
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const a = roundRectCoverage(px, py, x, y, cell, cell, radius)
          if (a <= 0) continue
          const i = (py * size + px) * 4
          for (let c = 0; c < 3; c++) buf[i + c] = Math.round(buf[i + c] * (1 - a) + col[c] * a)
        }
      }
    }
  }

  return encodePng(size, buf)
}

mkdirSync(OUT, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(resolve(OUT, name), draw(size))
  console.log('wrote', name, `${size}x${size}`)
}
