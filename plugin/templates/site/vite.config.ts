import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const THREE_CHUNK_ID = 'three';

/**
 * Mantém o three fora do chunk de entrada, para que o orçamento de bytes do
 * JS crítico continue mensurável (é o que `measure-bundle.ts` lê).
 */
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
