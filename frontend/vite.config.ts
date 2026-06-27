import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// Plugin: injeta config Firebase no firebase-messaging-sw.js durante o build
function firebaseSWInject() {
  return {
    name: 'firebase-sw-inject',
    writeBundle() {
      const swSrc  = path.resolve(__dirname, 'public/firebase-messaging-sw.js');
      const swDest = path.resolve(__dirname, 'dist/firebase-messaging-sw.js');
      if (!fs.existsSync(swSrc)) return;
      let content = fs.readFileSync(swSrc, 'utf-8');
      const replacements = {
        '__FIREBASE_API_KEY__':             process.env.VITE_FIREBASE_API_KEY             ?? '',
        '__FIREBASE_AUTH_DOMAIN__':         process.env.VITE_FIREBASE_AUTH_DOMAIN         ?? '',
        '__FIREBASE_PROJECT_ID__':          process.env.VITE_FIREBASE_PROJECT_ID          ?? 'jet-os-1',
        '__FIREBASE_STORAGE_BUCKET__':      process.env.VITE_FIREBASE_STORAGE_BUCKET      ?? '',
        '__FIREBASE_MESSAGING_SENDER_ID__': process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
        '__FIREBASE_APP_ID__':              process.env.VITE_FIREBASE_APP_ID              ?? '',
      };
      for (const [k, v] of Object.entries(replacements)) {
        content = content.replaceAll(`self.${k}`, `'${v}'`);
      }
      fs.writeFileSync(swDest, content, 'utf-8');
      console.log('[firebase-sw] Config injetada no SW de mensagens.');
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'JET OS — Operational System',
        short_name: 'JET OS',
        description: 'Sistema operacional completo para gestão de frotas e operações urbanas',
        theme_color: '#0a0f1e',
        background_color: '#0a0f1e',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Adicionar Estação',
            short_name: 'Add Estação',
            url: '/?shortcut=add-station',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Nova Ocorrência',
            short_name: 'Ocorrência',
            url: '/?shortcut=new-incident',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Minha Localização',
            short_name: 'Localização',
            url: '/?shortcut=my-location',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/unpkg\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/firebase-messaging-sw\.js/,
          /^https:\/\/script\.google\.com/,
          /^https:\/\/script\.googleusercontent\.com/,
          /^https:\/\/firestore\.googleapis\.com/,
          /^https:\/\/.*\.cloudfunctions\.net/,
        ],
      },
      devOptions: { enabled: false },
    }),
    firebaseSWInject(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router-dom'))
              return 'vendor-react';
            if (id.includes('firebase/'))
              return 'vendor-firebase';
            if (id.includes('@supabase/'))
              return 'vendor-supabase';
            if (id.includes('maplibre-gl'))
              return 'vendor-map';
            if (id.includes('deck.gl') || id.includes('@deck.gl'))
              return 'vendor-deckgl';
            if (id.includes('heic2any'))
              return 'heic2any';
          }
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
