import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The offline file (§6.3 B): one `astrofoto.html` with everything inlined, also the icon, as
 * nothing next to it is copied along.
 */
function offlineFile(): Plugin {
  const icon = 'data:image/svg+xml,' + encodeURIComponent(readFileSync(local('./public/favicon.svg'), 'utf8'));
  return {
    name: 'astrofoto-offline-file',
    enforce: 'post',
    transformIndexHtml: (html) => html.replace('href="./favicon.svg"', `href="${icon}"`).replace(/\s*<link rel="apple-touch-icon"[^>]*>/, ''),
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName === 'index.html');
      if (html) html.fileName = 'astrofoto.html';
    },
  };
}

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  return {
    // Relative paths, so the build works on GitHub Pages and from file://
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __OFFLINE_FILE__: JSON.stringify(offline),
    },
    // The offline file has no service worker
    resolve: offline ? { alias: { 'virtual:pwa-register': local('./src/pwa-none.ts') } } : {},
    publicDir: offline ? false : 'public',
    build: offline ? { outDir: 'dist-offline' } : {},
    server: { watch: { ignored: ['**/dist-offline/**'] } },
    plugins: offline
      ? [viteSingleFile(), offlineFile()]
      : [VitePWA({
          registerType: 'prompt',
          injectRegister: false,
          manifest: {
            name: 'Astrofoto',
            short_name: 'Astrofoto',
            description: 'CCD-piltidest värvifotoni / From CCD frames to a colour image',
            lang: 'et',
            start_url: './',
            scope: './',
            display: 'standalone',
            background_color: '#101830',
            theme_color: '#101830',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
            cleanupOutdatedCaches: true,
          },
        })],
    test: {
      include: ['test/**/*.test.ts'],
    },
  };
});
