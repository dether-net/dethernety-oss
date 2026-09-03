// Plugins
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import Fonts from 'unplugin-fonts/vite'
import Vue from '@vitejs/plugin-vue'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

// The MDI webfont is reachable only through a CSS @font-face rule, so the browser
// does not request it until a glyph first paints. In this app that is late: main.ts
// holds app.mount() behind Apollo init, auth-mode resolution and module loading, so
// the font download starts only after every module network call has finished.
//
// It bites hardest returning from the OIDC provider. /auth/callback paints an icon,
// which starts the download, then handleCallback redirects to home and cancels it —
// leaving the next document to render the icons as empty squares until a
// cache-bypassing reload. Preloading starts the fetch at HTML parse on every
// document, so it is in flight long before any of that.
//
// The filename is content-hashed, so the href has to come from the emitted bundle
// rather than being written into index.html. Build-only: in dev the font resolves
// straight from node_modules and there is no hash to look up.
const preloadIconFont = (base: string) => ({
  name: 'preload-icon-font',
  transformIndexHtml: {
    order: 'post' as const,
    handler (html: string, ctx: { bundle?: Record<string, unknown> }) {
      if (!ctx.bundle) return html
      const woff2 = Object.keys(ctx.bundle).find(f => /materialdesignicons-webfont-[^/]*\.woff2$/.test(f))
      if (!woff2) return html
      return {
        html,
        tags: [{
          tag: 'link',
          attrs: {
            rel: 'preload',
            as: 'font',
            type: 'font/woff2',
            href: `${base}${woff2}`,
            // Fonts are fetched in CORS mode even same-origin; without this the
            // preload is discarded and re-requested, which defeats the point.
            crossorigin: '',
          },
          injectTo: 'head-prepend' as const,
        }],
      }
    },
  },
})


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'
  
  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
      AutoImport({
        imports: [
          'vue',
          'vue-router',
        ],
        dts: 'src/auto-imports.d.ts',
        eslintrc: {
          enabled: true,
        },
        vueTemplate: true,
      }) as any,
      Components({
        dts: 'src/components.d.ts',
      }) as any,
      Vue({
        template: { transformAssetUrls },
      }) as any,
      // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
      Vuetify({
        autoImport: true,
        styles: {
          configFile: 'src/styles/settings.scss',
        },
      }) as any,
      // No `google:` block. It injected a stylesheet link to fonts.googleapis
      // plus an inline onload handler — three CSP violations on every page
      // load, and a third-party request from a deployment that may be
      // air-gapped. Roboto is now imported from the bundled roboto-fontface
      // package in plugins/vuetify.ts instead, so the typeface is unchanged.
      Fonts() as any,
      preloadIconFont(process.env.VITE_BASE_PATH || '/') as any,
    ],
    define: { 'process.env': {} },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        'vuetify/labs/VNumberInput': path.resolve(__dirname, 'node_modules/vuetify/lib/components/VNumberInput'),
      },
      extensions: [
        '.js',
        '.json',
        '.jsx',
        '.mjs',
        '.ts',
        '.tsx',
        '.vue',
      ],
    },
    build: {
      // Production build configuration
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: !isProduction,
      minify: isProduction,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/vue/') || id.includes('node_modules/vue-router/') || id.includes('node_modules/pinia/')) {
              return 'vendor-vue'
            }
            if (id.includes('node_modules/@apollo/client/') || id.includes('node_modules/graphql/')) {
              return 'vendor-apollo'
            }
            if (id.includes('node_modules/vuetify/')) {
              return 'vendor-ui'
            }
            if (id.includes('node_modules/@vue-flow/')) {
              return 'vue-flow'
            }
            if (id.includes('node_modules/@jsonforms/vue-vuetify/')) {
              return 'json-forms-vue-vuetify'
            }
            if (id.includes('node_modules/@jsonforms/')) {
              return 'json-forms'
            }
          },
        },
      },
    },
    server: {
      allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0'],
      host: '0.0.0.0',
      port: 3005,
      proxy: {
        '/graphql': {
          target: 'http://localhost:3003/graphql',
          ws: true,
        },
        '/modules': {
          target: 'http://localhost:3003',
          changeOrigin: true,
          secure: false
        },
      },
    },
    // https://vitejs.dev/config/
    optimizeDeps: {
      // Exclude vuetify since it has an issue with vite dev - TypeError: makeVExpansionPanelTextProps is not a function - the makeVExpansionPanelTextProps is used before it is defined
      exclude: ['vuetify'],
    },
  }
})
