import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Served under /console/ on the shared front door: the proxy strips the /console prefix before
  // forwarding, so the daemon still serves index.html at `/` and hashed assets under `/assets/`, while
  // the browser's asset/API/callback URLs carry the prefix. `base` is the component of every absolute
  // asset URL and populates import.meta.env.BASE_URL, which the API and redirect code read.
  base: '/console/',

  // Nothing is copied verbatim into `dist/`: the console has no runtime config file (its
  // configuration is read from the platform over `/api`, not from a bundled object), so a
  // `public/` directory would only be a way to ship something unintended into the embedded FS.
  publicDir: false,

  plugins: [vue(), tailwindcss()],

  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },

  build: {
    outDir: 'dist',
    // No sourcemaps: the bundle is embedded in and served by the console binary, and a
    // sourcemap would ship the whole source tree to anyone who opened the page.
    sourcemap: false,
    // The daemon serves whatever lands here; keep the asset layout flat and predictable so
    // the `GET /assets/` file-server route in server.go covers all of it.
    assetsDir: 'assets',
  },

  server: {
    // Mirrors the container's published console port (8080) so a `vite dev` session against a
    // separately-running daemon lines up with the deployed URL. Dev is a convenience; the
    // shipped artifact is always the embedded build.
    port: 8080,
    strictPort: true,
  },
})
