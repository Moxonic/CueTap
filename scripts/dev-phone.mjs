/**
 * Start the dev server over HTTPS for testing on a real phone.
 *
 * A phone reaches the dev server on a LAN IP, which browsers do not treat as a
 * secure context, so the recorder and the service worker both need TLS there.
 * Desktop work should use plain `npm run dev` on http://127.0.0.1 instead —
 * loopback is already a secure context, and the self-signed certificate this
 * mode uses stops Chrome registering a service worker at all.
 *
 * A tiny wrapper rather than a cross-env dependency, since setting one
 * environment variable portably is all that is needed.
 */
import { spawn } from 'node:child_process'

const child = spawn('npx', ['vite', '--host'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, HTTPS: '1' },
})

child.on('exit', (code) => process.exit(code ?? 0))
