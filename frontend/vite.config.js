import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Shown in the UI (status bar). The Docker build passes VITE_APP_VERSION;
// otherwise it comes from package.json, so every build carries a version.
// Written to process.env, which outranks .env files, so a VITE_APP_VERSION
// in .env never wins. The dev server re-runs this file on restart, when
// process.env already holds the value set here, so the build environment's
// own value is captured once per process instead of re-read.
const PACKAGE_JSON = fileURLToPath(new URL('./package.json', import.meta.url))
globalThis.__nethelperBuildVersion ??= process.env.VITE_APP_VERSION || ''
process.env.VITE_APP_VERSION = globalThis.__nethelperBuildVersion
  || JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version

// A long-running dev server read the version at start; restart it when
// package.json changes (a release bump) so the UI doesn't show a stale one.
const restartOnPackageChange = {
  name: 'nethelper-restart-on-package-change',
  apply: 'serve',
  configureServer(server) {
    server.watcher.add(PACKAGE_JSON)
    server.watcher.on('change', (file) => {
      if (path.resolve(file) === PACKAGE_JSON) server.restart()
    })
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dev-server settings come from .env (no VITE_ prefix, so they never reach
  // the browser bundle):
  //   DEV_PROXY_TARGET   backend URL for /api and /socket.io (default http://localhost:3000)
  //   DEV_ALLOWED_HOSTS  extra comma-separated Host headers the dev server accepts
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.DEV_PROXY_TARGET || 'http://localhost:3000'
  const allowedHosts = ['localhost', ...(env.DEV_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)]

  return {
    plugins: [vue(), restartOnPackageChange],
    server: {
      allowedHosts,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (err, req) => {
              console.error('Proxy error:', err.message, req.url)
            })
          }
        },
        '/socket.io': {
          target: proxyTarget,
          ws: true,
          changeOrigin: true,
          secure: false
        }
      }
    },
    // Production bundles drop console.log/info/debug (warn/error stay, for
    // field diagnostics) and debugger statements.
    esbuild: mode === 'production'
      ? { pure: ['console.log', 'console.info', 'console.debug'], drop: ['debugger'] }
      : {},
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@import "@/assets/styles/variables.scss";`
        }
      }
    },
    define: {
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['tests/unit/**/*.spec.js'],
      // Component specs mount Vuetify, whose modules import their own CSS.
      server: { deps: { inline: ['vuetify'] } }
    }
  }
})
