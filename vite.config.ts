import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * HTTPS is opt-in: `HTTPS=1 npm run dev`.
 *
 * A phone on the LAN needs it, because getUserMedia and service workers require
 * a secure context and a LAN IP is not one. But loopback *is* a secure context,
 * so plain http://127.0.0.1 gets both for free — and avoids two problems the
 * self-signed cert causes:
 *
 *  - Chrome refuses to register a service worker over an untrusted certificate
 *    even after you click through the warning, so the PWA never installs.
 *  - Spotify rejects `localhost` outright and wants an explicit loopback
 *    literal, which http://127.0.0.1:5173 satisfies exactly.
 *
 * So: plain HTTP on loopback for desktop work, HTTPS only when testing on a
 * real phone.
 */
const useHttps = process.env.HTTPS === '1' || process.env.HTTPS === 'true'

export default defineConfig({
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      // Without this the manifest is only emitted by `vite build`, so the phone
      // never offers "Add to Home Screen" while testing against the dev server —
      // which is exactly where the install behaviour needs checking.
      devOptions: { enabled: true, type: 'module' },
      workbox: {
        // The app shell must survive a venue with no network at all.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'CueTap',
        short_name: 'CueTap',
        description: 'Sound cue playback for small theaters and rehearsals.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
})
