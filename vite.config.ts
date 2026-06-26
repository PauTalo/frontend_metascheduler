import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }: { mode: string }) => {
  const env = loadEnv(mode, '.', '')
  const proxyTarget = env.VITE_METASCHEDULER_API_PROXY_TARGET || 'http://localhost:8000'
  const sshAuthProxyTarget = env.VITE_SSH_AUTH_PROXY_TARGET || 'http://localhost:4000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
        '/ssh-auth': {
          target: sshAuthProxyTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/ssh-auth/, ''),
        },
      },
    },
  }
})
