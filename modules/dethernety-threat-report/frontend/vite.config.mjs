import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import path from 'path'

export default defineConfig({
  plugins: [vue(), cssInjectedByJsPlugin()],
  resolve: {
    alias: {
      // Use the host's Vue runtime to avoid bundling a second copy.
      vue: path.resolve(__dirname, 'externals/vue-shim.js'),
    },
  },
  build: {
    target: 'esnext',
    lib: {
      entry: './index.js',
      name: 'ThreatReportModule',
      fileName: () => 'bundle.js',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        format: 'es',
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
    cssCodeSplit: false, // ensure CSS goes into the JS for injection
    outDir: './dist',
    emptyOutDir: true,
  },
})
