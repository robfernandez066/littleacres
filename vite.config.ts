import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/littleacres/',
  // Baked into the bundle at build time; the dev overlay shows it so a stale
  // service-worker build is always identifiable (see DevOverlay).
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5177,
    strictPort: true,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Little Acres',
        short_name: 'Little Acres',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#3f6b3d',
        background_color: '#fdf6e3',
        start_url: '/littleacres/',
        scope: '/littleacres/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
