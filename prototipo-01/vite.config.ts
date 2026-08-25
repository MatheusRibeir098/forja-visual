import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { renderPrincipios } from './src/sections/principios/markup';
import type { Plugin } from 'vite';

const THREE_CHUNK_ID = 'three';

/** Keeps three.js out of the critical entry chunk so the 300 KB budget stays measurable. */
function manualChunks(moduleId: string): string | undefined {
  if (moduleId.includes('node_modules/three/')) return THREE_CHUNK_ID;
  return undefined;
}

/**
 * Marcador que `index.html` reserva dentro de `<section id="principios">`.
 * O conteúdo de F6 entra aqui no build **e** no dev server, para que a seção
 * exista antes de qualquer JavaScript rodar — que é o aceite dela (spec §3 F6:
 * "legível com JS desabilitado"). Renderizar no cliente deixaria a prova do P5
 * dependendo justamente do que ela diz não precisar.
 */
const PRINCIPIOS_MARKER = '<!--forja:principios-->';

function inlinePrincipios(): Plugin {
  return {
    name: 'forja-inline-principios',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string): string {
        if (!html.includes(PRINCIPIOS_MARKER)) {
          // Falhar alto: sem o marcador a seção sairia vazia na página, e um
          // vazio silencioso é exatamente o tipo de regressão que ninguém vê.
          throw new Error(`vite: marcador ${PRINCIPIOS_MARKER} ausente em index.html`);
        }
        return html.replace(PRINCIPIOS_MARKER, renderPrincipios('principios'));
      },
    },
  };
}

export default defineConfig({
  plugins: [inlinePrincipios()],
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
