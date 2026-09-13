import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    alias: {
      '@': '/src/',
    },
  },
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['nineteen2.nortem.net'],
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});