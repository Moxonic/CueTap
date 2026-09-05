import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// HTTPS is not optional here: getUserMedia (the recorder) and service worker
// registration are both blocked on a plain http:// LAN address, which is exactly
// how you reach the dev server from a phone. basicSsl issues a self-signed cert —
// the phone will warn once, then remember it.
export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
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
