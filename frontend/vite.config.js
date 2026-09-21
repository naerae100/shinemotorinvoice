import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The Android shell does not want a service worker.
 *
 * In a browser the worker is what makes the app installable and survive the
 * wifi dropping. Inside the shell the assets are already on the device, in the
 * APK — a worker there caches a copy of a copy, and then serves the old one
 * after an update, which is a bug that presents as "the app did not update"
 * with nothing in a log to explain it.
 *
 * `npm run build:app` sets this; `npm run build` does not. One build, two
 * outputs, no forked code.
 */
const forAppShell = process.env.VITE_APP_SHELL === '1';

export default defineConfig({
  plugins: [
    react(),

    /**
     * Installable on the yard tablet, and the same build for every platform.
     *
     * The operator opens this next to a truck. Going through a browser, typing
     * a URL, and looking at a tab strip is not that — it should be an icon on
     * the home screen that opens full screen. This makes it one, with no second
     * codebase: the manifest and service worker are generated from the app that
     * already exists, and a Capacitor wrapper later ships this same build.
     *
     * What is cached, and what is deliberately not:
     *
     *   The shell — HTML, JS, CSS, fonts, icons — is precached, so the app
     *   opens instantly and survives the wifi dropping out between the office
     *   and the weighbridge.
     *
     *   API responses are NEVER cached. This is a financial record: a stale
     *   price list, a docket total from ten minutes ago, or a supplier's old
     *   bank account are all worse than an honest error. Everything under /api
     *   goes to the network or fails.
     */
    !forAppShell &&
      VitePWA({
        registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],

      manifest: {
        name: 'Shine Motor — Dockets & Invoices',
        // What fits under an icon on an Android home screen.
        short_name: 'Shine Motor',
        description:
          'Purchase dockets, packing lists and export invoices for Shine Motor Corporation.',
        theme_color: '#141F24',
        background_color: '#F8FAFC',

        /**
         * Full screen, not merely standalone.
         *
         * `standalone` drops the browser chrome but keeps Android's status bar
         * — the clock, the battery, and every notification that arrives. On a
         * shared yard tablet that strip is both a distraction mid-docket and
         * about 24dp of an 800px-tall screen that a table of line items could
         * be using. `fullscreen` takes the whole panel.
         *
         * `display_override` is the modern field and is read first;
         * `display` stays as the fallback for anything that ignores it, so an
         * older browser still installs the app rather than refusing the
         * manifest outright.
         */
        display_override: ['fullscreen', 'standalone', 'minimal-ui'],
        display: 'fullscreen',
        // Not locked. The tablet's native orientation is landscape and that is
        // how it sits in the stand, but a locked manifest also stops someone
        // turning it to read a long invoice, and both orientations lay out
        // properly — so this stays the user's choice.
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // Android crops an icon to its own shape; a maskable one has the
          // mark inside the safe zone so the wave is not clipped.
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        // The PDF libraries are large and lazily imported; without this they
        // are left out of the precache and a download fails offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],

        // A single-page app: any unknown path is the shell, except the API.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          {
            // Stated explicitly rather than relying on the denylist, so nobody
            // later adds a caching rule that quietly swallows /api too.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },

      devOptions: {
        // Off in development: a service worker caching a dev build is how you
        // spend an afternoon debugging a change that already shipped.
        enabled: false,
      },
    }),
  ],

  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
});
