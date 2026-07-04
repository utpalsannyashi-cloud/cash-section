import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
    resolve: {
          alias: {
                  '@': fileURLToPath(new URL('./src', import.meta.url))
          }
    },
    plugins: [
          react(),
          VitePWA({
                  registerType: 'autoUpdate',
                  includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
                  manifest: {
                            name: 'Cash Section',
                            short_name: 'Cash Section',
                            description: 'Split bills and settle up with your group, on the spot.',
                            theme_color: '#0F172A',
                            background_color: '#0F172A',
                            display: 'standalone',
                            start_url: '/',
                            icons: [
                              { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                              { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                              { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                                      ]
                  },
                  workbox: {
                            globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
                            navigateFallback: '/index.html',
                            navigateFallbackDenylist: [/^\/api\//, /^\/offline\.html$/],
                            runtimeCaching: [
                              {
                                            urlPattern: ({ request }) => request.mode === 'navigate',
                                            handler: 'NetworkFirst',
                                            options: {
                                                            cacheName: 'pages-cache',
                                                            networkTimeoutSeconds: 5,
                                                            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }
                                            }
                              },
                              {
                                            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1') || url.pathname.startsWith('/storage/v1'),
                                            handler: 'NetworkFirst',
                                            options: {
                                                            cacheName: 'supabase-cache',
                                                            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }
                                            }
                              }
                                      ]
                  }
          })
        ],
    server: { port: 5173 }
});
