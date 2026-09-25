import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// Shown in the UI (footer). The Docker build passes VITE_APP_VERSION;
// otherwise it comes from package.json, so every build carries a version.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
process.env.VITE_APP_VERSION ||= version

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
    plugins: [vue()],
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
      include: ['tests/unit/**/*.spec.js']
    }
  }
})
