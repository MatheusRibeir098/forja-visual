import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { renderPrincipios } from './src/sections/principios/markup';
import type { IndexHtmlTransformContext, Plugin } from 'vite';

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

/**
 * Caminho absoluto do `index.html` real da aplicação (resolvido a partir da
 * localização deste arquivo, não do `cwd`, para não depender de onde o
 * comando é disparado). É contra esse caminho que o plugin decide se deve
 * exigir o marcador.
 */
const ROOT_INDEX_HTML = resolve(fileURLToPath(new URL('.', import.meta.url)), 'index.html');

function inlinePrincipios(): Plugin {
  return {
    name: 'forja-inline-principios',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string, ctx: IndexHtmlTransformContext): string {
        // `transformIndexHtml` roda para qualquer .html servido pelo Vite —
        // inclusive as páginas de inspeção em dev/*.html, que não têm (e não
        // precisam ter) o marcador de F6. `ctx.filename` é o caminho absoluto
        // do arquivo no disco (tanto em dev quanto em build, já que dev/*.html
        // não são entry points do build); comparar contra ele é mais robusto
        // que checar a URL da requisição, que pode ser reescrita/proxiada.
        // Só o index.html real da aplicação precisa (e deve) falhar alto.
        if (ctx.filename !== ROOT_INDEX_HTML) {
          return html;
        }
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
