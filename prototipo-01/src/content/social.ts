/**
 * Metadados de compartilhamento — o cartão que Open Graph e Twitter Cards
 * montam quando o link é colado no LinkedIn, no Slack ou no WhatsApp.
 *
 * Vive em `content/` pela mesma regra das outras seções: é **texto exibido**,
 * ainda que exibido fora da página. O `index.html` não guarda nenhuma dessas
 * strings — `renderSocialMeta()` escreve as tags no marcador `<!--forja:social-->`
 * durante o `transformIndexHtml` (ver `vite.config.ts`), do mesmo jeito que F6.
 *
 * Este módulo é importado **só** pelo `vite.config.ts`. Nada aqui entra no
 * bundle do cliente.
 */

/* -------------------------------------------------------------------------
 * ⚠️  TROCAR DEPOIS DO PRIMEIRO DEPLOY  ⚠️
 *
 * `og:url` e `og:image` não aceitam caminho relativo: o robô do LinkedIn lê o
 * HTML fora do contexto do site e não tem contra o que resolver `/og-image.jpg`.
 * Por isso o domínio precisa estar escrito por extenso — e este é o **único**
 * lugar do repositório onde ele aparece.
 *
 * O valor abaixo é o palpite do subdomínio da Vercel, não uma URL confirmada.
 * Assim que o primeiro deploy responder, troque esta linha pelo domínio real
 * (sem barra final) e refaça o build. Enquanto ela estiver errada, o cartão de
 * preview vem sem imagem.
 * ------------------------------------------------------------------------- */
export const SITE_ORIGIN = 'https://forja-visual.vercel.app';

/** Arquivo em `public/`, capturado do próprio hero — ver `og:image:width/height`. */
const OG_IMAGE_PATH = '/og-image.jpg';
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

interface Social {
  /** Linha do cartão. Curta o bastante para o LinkedIn não cortar no meio. */
  title: string;
  /** Usada em `<meta name="description">`, `og:description` e `twitter:description`. */
  description: string;
  /** Descrição da imagem para quem lê o cartão por leitor de tela. */
  imageAlt: string;
  siteName: string;
  locale: string;
}

export const social: Social = {
  title: 'Forja Visual — por que todo site gerado por IA parece o mesmo',
  description:
    'A causa não é falta de biblioteca: o modelo entrega a média de tudo que viu, e a média é a opção menos distintiva. Esta página é o oposto disso.',
  imageAlt:
    'O título “Forja Visual” em serifa oversized sobre um campo escuro de limalha de ferro.',
  siteName: 'Forja Visual',
  locale: 'pt_BR',
};

/** Escapa o que vai dentro de um atributo HTML — o conteúdo tem aspas e travessões. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function meta(kind: 'name' | 'property', key: string, content: string | number): string {
  return `<meta ${kind}="${key}" content="${escapeAttribute(String(content))}" />`;
}

/**
 * As tags de compartilhamento, prontas para substituir o marcador. `indent` é o
 * recuo do marcador no `index.html`, repetido em cada linha para o HTML gerado
 * sair alinhado com o resto do `<head>`.
 */
export function renderSocialMeta(indent = ''): string {
  const pageUrl = `${SITE_ORIGIN}/`;
  const imageUrl = `${SITE_ORIGIN}${OG_IMAGE_PATH}`;

  const tags = [
    meta('name', 'description', social.description),

    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', social.siteName),
    meta('property', 'og:locale', social.locale),
    meta('property', 'og:url', pageUrl),
    meta('property', 'og:title', social.title),
    meta('property', 'og:description', social.description),
    meta('property', 'og:image', imageUrl),
    meta('property', 'og:image:type', 'image/jpeg'),
    meta('property', 'og:image:width', OG_IMAGE_WIDTH),
    meta('property', 'og:image:height', OG_IMAGE_HEIGHT),
    meta('property', 'og:image:alt', social.imageAlt),

    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', social.title),
    meta('name', 'twitter:description', social.description),
    meta('name', 'twitter:image', imageUrl),
    meta('name', 'twitter:image:alt', social.imageAlt),
  ];

  return tags.join(`\n${indent}`);
}
