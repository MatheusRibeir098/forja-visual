import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const THREE_CHUNK_ID = 'three';

/** Keeps three.js out of the critical entry chunk so the 300 KB budget stays measurable. */
function manualChunks(moduleId: string): string | undefined {
  if (moduleId.includes('node_modules/three/')) return THREE_CHUNK_ID;
  return undefined;
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    reportCompressedSize: true,
    rollupOptions: {
      output: { manualChunks },
    },
  },
});
