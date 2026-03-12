// Plugins
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import Fonts from 'unplugin-fonts/vite'
import Layouts from 'vite-plugin-vue-layouts'
import Vue from '@vitejs/plugin-vue'
import VueRouter from 'unplugin-vue-router/vite'
import Pages from 'vite-plugin-pages'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
// import { visualizer } from 'rollup-plugin-visualizer'


// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isProduction = mode === 'production'
  
  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
      // visualizer({
      //   filename: 'dist/bundle-analysis.html',
      //   open: true,
      //   gzipSize: true
      // }) as any,
      VueRouter({
        dts: 'src/typed-router.d.ts',
      }) as any,
      Pages() as any,
      Layouts() as any,
      AutoImport({
        imports: [
          'vue',
          {
            'vue-router/auto': ['useRoute', 'useRouter'],
          },
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
      Fonts({
        google: {
          families: [{
            name: 'Roboto',
            styles: 'wght@100;300;400;500;700;900',
          }],
        },
      }) as any,
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
