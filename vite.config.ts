import { defineConfig } from 'vitest/config';
import { pwaPlugin } from './tools/pwa-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [pwaPlugin()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { game: 'index.html', studio: 'editor.html' },
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
