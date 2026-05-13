import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':  ['react', 'react-dom'],
          'firebase-app':  ['firebase/app', 'firebase/auth'],
          'firebase-db':   ['firebase/firestore', 'firebase/storage', 'firebase/functions'],
          'leaflet':       ['leaflet'],
          'i18n':          ['i18next', 'react-i18next']
        }
      }
    }
  },
  server: { port: 3000 }
});