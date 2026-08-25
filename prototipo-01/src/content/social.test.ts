import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN, renderSocialMeta, social } from './social';

/**
 * O que estes testes protegem é a única falha do cartão de compartilhamento que
 * não dá para ver localmente: um caminho relativo em `og:image`/`og:url`. O robô
 * do LinkedIn lê o HTML fora do contexto do site e não tem contra o que
 * resolvê-lo — o link sai sem imagem e ninguém descobre antes de publicar.
 */
function contentOf(html: string, key: string): string | undefined {
  const pattern = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)" />`);
  return pattern.exec(html)?.[1];
}

describe('renderSocialMeta', () => {
  const html = renderSocialMeta();

  it('escreve título, descrição e imagem', () => {
    expect(contentOf(html, 'og:title')).toBe(social.title);
    expect(contentOf(html, 'og:description')).toBe(social.description);
    expect(contentOf(html, 'description')).toBe(social.description);
    expect(contentOf(html, 'og:image')).toBeDefined();
  });

  it('usa URL absoluta em og:url e nas imagens', () => {
    for (const key of ['og:url', 'og:image', 'twitter:image']) {
      expect(contentOf(html, key)).toMatch(/^https:\/\/[^/]+\//);
    }
  });

  it('declara as dimensões reais do arquivo em public/', () => {
    expect(contentOf(html, 'og:image:width')).toBe('1200');
    expect(contentOf(html, 'og:image:height')).toBe('630');
  });

  it('pede o cartão grande do Twitter/X', () => {
    expect(contentOf(html, 'twitter:card')).toBe('summary_large_image');
  });

  it('mantém o domínio numa origem só, sem barra final', () => {
    expect(SITE_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
    expect(contentOf(html, 'og:url')).toBe(`${SITE_ORIGIN}/`);
  });

  it('escapa aspas do conteúdo para não quebrar o atributo', () => {
    // `imageAlt` traz aspas tipográficas; o teste garante que nenhum `"` cru
    // vaze para dentro de content="...".
    const alt = contentOf(html, 'og:image:alt');
    expect(alt).toBeDefined();
    expect(alt).not.toContain('"');
  });

  it('recua cada tag com o indent recebido', () => {
    expect(renderSocialMeta('    ')).toContain('\n    <meta');
  });
});
