import { Color, Vector2 } from 'three';
import { POINTER_RAY_GLSL } from '@/engine/pointer';
import { LINEAR_TO_SRGB } from '@/shaders/glsl';

/**
 * V.1 — **Nuvem de pontos aditiva com depth prepass**.
 *
 * Este par de shaders é só metade da técnica. A outra metade não está aqui: é
 * uma malha decimada e invisível do mesmo objeto, desenhada **antes** com
 * `colorWrite: false` e `depthWrite: true` (ver `sections/campo/scene.ts`).
 * O que este material precisa fazer para a técnica funcionar é uma coisa só —
 * `depthWrite: false` **com** `depthTest: true`. Ligar a escrita faria os
 * pontos ocluírem uns aos outros em ordem de desenho, que com blending aditivo
 * é ruído; desligar o teste faria o oclusor não servir para nada.
 *
 * ## O que cada termo do shading resolve
 *
 * - **`visibility`** — o ponto virado para longe da câmera guarda só
 *   `uBackFade` do seu peso. Este termo era o principal antes do oclusor e
 *   deixou de ser: o que sobrevive ao teste de profundidade e ainda aponta
 *   para trás é a parede de uma reentrância vista de perfil — órbita, fossa
 *   temporal, arcada — que é anatomia. Por isso `uBackFade` é generoso.
 * - **`rim`** — o ponto sobre o contorno é o mais claro do quadro, porque é o
 *   contorno que o olho lê como "crânio". Medido contra a direção **radial**,
 *   não contra a normal verdadeira: um crânio tem normal de perfil em toda
 *   sutura e todo forame, e um rim tirado dela cobre o objeto de chuvisco em
 *   vez de desenhar uma silhueta.
 * - **`relief`** — a curvatura do arquivo (+1 no fundo de uma fenda, −1 numa
 *   crista) levanta as suturas e as bordas das órbitas e abaixa a calota. É a
 *   diferença entre um crânio e um ovoide de pontos.
 *
 * ## Cursor como raio (V.4)
 *
 * A repulsão é medida contra o **raio** do cursor, não contra um ponto dele:
 * `pointerOffset` (de `engine/pointer`) cancela a profundidade, então a
 * influência é um cilindro em torno do raio e todo ponto sob o cursor responde
 * — face próxima, parede de órbita ou nuca — em vez de só a fatia que estivesse
 * perto de algum plano arbitrário. O empurrão é gasto **no plano da imagem**,
 * que é onde ele é medido: um empurrão em 3D mandaria parte da nuvem para longe
 * da câmera, ao mesmo custo de vértice e sem leitura nenhuma.
 *
 * ## Nada aqui anda sozinho
 *
 * Não existe `uTime`. A seção não tem órbita automática nem respiração: todo
 * movimento é scroll (V.2) ou cursor (V.4). Um uniform de tempo aqui viraria
 * exatamente o "fade-up genérico" que a spec §6 lista como reprovação — e, num
 * ticker em `demand` sob `prefers-reduced-motion`, animação por tempo é a
 * primeira coisa que quebra.
 */

/**
 * `type` e não `interface`: o `uniforms` do `RawShaderMaterial` é indexado por
 * string e só um type alias ganha a index signature implícita que o three
 * exige. Mesmo motivo do `RelightUniforms`.
 */
export type PointsUniforms = {
  /** Raio de mundo a que a esfera unitária do arquivo é escalada. */
  uRadius: { value: number };
  /** `gl.size.dpr`, para o tamanho do sprite ficar em px CSS em toda tela. */
  uPixelRatio: { value: number };
  /** Tamanho do sprite, em px por unidade de distância. Ver `SIZE_PER_RADIUS`. */
  uSize: { value: number };
  /** Piso do tamanho atenuado, em px CSS. */
  uMinSize: { value: number };
  /** Teto do tamanho atenuado, em px CSS. Guarda contra bolhas. */
  uMaxSize: { value: number };
  /** Contraste extra de tamanho entre o polo próximo e o distante. */
  uDepthSize: { value: number };

  /** Direção do cursor em view space dividida pela profundidade (V.4). */
  uPointerRay: { value: Vector2 };
  /** Alcance da influência, em unidades de mundo em torno do raio. */
  uPointerRadius: { value: number };
  /** Deslocamento máximo, no plano da imagem, em unidades de mundo. */
  uPointerPush: { value: number };
  /** 0 desliga o cursor sem trocar de programa. */
  uPointerStrength: { value: number };

  /** Peso guardado por um ponto virado para o lado oposto ao da câmera. */
  uBackFade: { value: number };
  /** Meia-largura da faixa em que `visibility` transiciona. */
  uFacingWidth: { value: number };
  /** Expoente do termo de silhueta. */
  uRimSharpness: { value: number };
  /** Quanto um ponto de silhueta é mais claro que um de frente. */
  uRimGain: { value: number };
  /** Peso extra dado ao fundo de uma fenda (curvatura positiva). */
  uSeamLift: { value: number };
  /** Peso subtraído de uma crista (curvatura negativa). */
  uCrestDrop: { value: number };

  /** 0–1: entrada da nuvem quando o binário chega. Não é laço, é um degrau. */
  uFade: { value: number };
  /** Alpha em que a nuvem assenta. Botão mestre do brilho. */
  uOpacity: { value: number };
  /** Multiplicador emissivo global. */
  uIntensity: { value: number };
  /** Quanto a curvatura positiva puxa a cor para a brasa. */
  uSeamTint: { value: number };

  uColorBone: { value: Color };
  uColorSeam: { value: Color };
  uColorCore: { value: Color };
};

/**
 * Raio da nuvem, em unidades de mundo. Quem monta a cena sobrescreve a cada
 * resize — o enquadramento depende da faixa livre que o painel de texto deixa.
 */
export const DEFAULT_RADIUS = 1.35;

/**
 * Tamanho do sprite **por raio de mundo do objeto**.
 *
 * `uSize` está em px por unidade de distância (o shader divide por
 * `-mvPosition.z`), e quem monta a cena o recalcula a cada resize como
 * `SIZE_PER_RADIUS × uRadius`. A proporcionalidade não é conveniência: o que
 * decide se a nuvem lê como superfície ou como poeira é a razão entre o disco
 * do sprite e o **espaçamento entre vizinhos na tela**, e esse espaçamento
 * encolhe junto com o objeto quando a faixa livre é estreita. Um `uSize` fixo
 * dá 4,2 px de sprite para um espaçamento de 5 px no desktop (certo) e os
 * mesmos 4,2 px para um espaçamento de 2,8 px no celular (mancha: 0,9% dos
 * pixels da faixa saturavam, contra 0,1% no desktop).
 *
 * A nuvem subiu de 12.000 para 45.000 pontos (~5,7k → ~21k visíveis depois do
 * prepass), então o espaçamento entre vizinhos encolheu de ~5 px para ~2,5 px
 * e o sprite precisou encolher junto — na mesma proporção, ou a soma aditiva
 * de vizinhos mais próximos vira mancha. `5,7` é a metade do `11,4` do
 * catálogo (12k pontos): produz ~2,1 px de sprite no enquadramento de
 * 1280×720, contra os 4,2 px de antes.
 *
 * Recalibrado por medição de **saturação de pixel**, não por proporção
 * suposta: uma tela cheia de sprites em blend aditivo satura (canal ≥250/255)
 * onde vizinhos se sobrepõem o bastante para clipar. Screenshot da
 * `.campo__stage`, decodificado no próprio navegador (mesma técnica de
 * `measure-contrast.ts`), contando a fração de pixels saturados:
 *
 * | `SIZE_PER_RADIUS` | desktop 1280×720 dpr2 | mobile 375×667 dpr1 |
 * | ------------------ | --------------------- | ------------------- |
 * | 11,4 (valor antigo) | 1,128%                | 1,699%               |
 * | 8,0                 | 0,434%                | 0,520%               |
 * | 6,0                 | 0,138%                | 0,165%               |
 * | **5,7**             | **0,113%**            | **0,128%**           |
 * | 5,0                 | 0,063%                | 0,072%               |
 *
 * `5,7` mira o mesmo alvo do catálogo (~0,12%) e reproduz a mesma propriedade
 * registrada lá: `uSize` proporcional ao raio **iguala** a saturação entre
 * desktop e celular (0,113% vs 0,128%, a ~13% um do outro) em vez de deixar o
 * celular saturar ~9× mais como um `uSize` fixo faria.
 */
export const SIZE_PER_RADIUS = 5.7;

/** Piso: abaixo de 1 px o ponto pisca entre quadros conforme o sub-pixel. */
export const DEFAULT_MIN_SIZE = 1;

/**
 * Teto do sprite, em px CSS (o `uPixelRatio` entra depois do clamp, então o
 * limite é o mesmo em qualquer dpr). 5,5 porque acima disso os discos da face
 * próxima se sobrepõem e a soma aditiva estoura para branco — que é exatamente
 * o borrão que o depth prepass existe para eliminar.
 */
export const DEFAULT_MAX_SIZE = 5.5;

/**
 * Contraste de tamanho por profundidade. 0,35 dá ao polo próximo sprites ~2×
 * maiores que os do distante, bem além do que a perspectiva sozinha entrega a
 * esta distância de câmera — e é esse gradiente que faz a nuvem ler como volume
 * em vez de decalque.
 */
export const DEFAULT_DEPTH_SIZE = 0.35;

/**
 * Alcance do cursor, em unidades de mundo em torno do raio. 0,55 é ~40% do raio
 * da nuvem: grande o bastante para o gesto pegar uma região reconhecível do
 * crânio, pequeno o bastante para o objeto nunca se desfazer inteiro.
 */
export const DEFAULT_POINTER_RADIUS = 0.55;

/**
 * Empurrão máximo, em unidades de mundo. 0,08 = 6% do raio: o suficiente para a
 * nuvem se abrir sob o cursor e deixar ver o lado de trás pelo buraco, longe de
 * arrancar a silhueta do lugar.
 */
export const DEFAULT_POINTER_PUSH = 0.08;

/**
 * Peso do ponto virado para longe da câmera.
 *
 * 0,3 e não 0,05. Com o oclusor no lugar, o lado de trás é **descartado**, não
 * atenuado; o que ainda aponta para trás e sobrevive ao teste de profundidade é
 * parede de órbita e de fossa temporal vista de perfil. Esmagar esse termo
 * apagaria a anatomia junto com a névoa que ele um dia serviu para conter.
 */
export const DEFAULT_BACK_FADE = 0.3;

/**
 * Meia-largura da transição de `visibility`, em cosseno do ângulo.
 *
 * A faixa é centrada em zero (e não `pow(max(facing, 0), k)`) porque este termo
 * e o `rim` se cruzam exatamente na silhueta: com a curva assimétrica, o ponto
 * de contorno já está escuro onde o rim é máximo, e um cancela o outro.
 */
export const DEFAULT_FACING_WIDTH = 0.35;

export const DEFAULT_RIM_SHARPNESS = 2.4;
export const DEFAULT_RIM_GAIN = 1.6;

/** Fenda ganha 50% de peso, crista perde 25%: a sutura aparece, a calota recua. */
export const DEFAULT_SEAM_LIFT = 0.5;
export const DEFAULT_CREST_DROP = 0.25;

/**
 * Alpha de repouso da nuvem.
 *
 * O texto da seção vive num painel sólido, então o contraste dele não depende
 * daqui; o teto real é a leitura do objeto. 0,3 põe o pico do sprite perto de
 * 0,9 sobre o fundo de carvão, abaixo do branco — nenhum termo desta cadeia
 * chega a 1, por construção.
 */
export const DEFAULT_OPACITY = 0.3;

export const DEFAULT_INTENSITY = 1;

/** Quanto a curvatura positiva puxa a cor para a brasa. */
export const DEFAULT_SEAM_TINT = 0.85;

/**
 * Paleta. Osso frio, brasa nas fendas.
 *
 * Não é osso branco-marfim: crânio bege sobre fundo escuro é a ilustração de
 * banco de imagens da categoria. Aqui a massa é aço pálido e a única cor quente
 * é a mesma laranja da chapa do relevo (`LIGHT_COLOR_HEX` de `relight.ts`) —
 * o site tem uma brasa só, e ela vive nas frestas.
 */
export const BONE_COLOR_HEX = '#8fa3b6';
export const SEAM_COLOR_HEX = '#ff7a2a';
/** Crista do sprite: quase branco, nunca branco. */
export const CORE_COLOR_HEX = '#e6edf4';

export function createPointsUniforms(): PointsUniforms {
  return {
    uRadius: { value: DEFAULT_RADIUS },
    uPixelRatio: { value: 1 },
    uSize: { value: SIZE_PER_RADIUS * DEFAULT_RADIUS },
    uMinSize: { value: DEFAULT_MIN_SIZE },
    uMaxSize: { value: DEFAULT_MAX_SIZE },
    uDepthSize: { value: DEFAULT_DEPTH_SIZE },

    uPointerRay: { value: new Vector2(0, 0) },
    uPointerRadius: { value: DEFAULT_POINTER_RADIUS },
    uPointerPush: { value: DEFAULT_POINTER_PUSH },
    uPointerStrength: { value: 0 },

    uBackFade: { value: DEFAULT_BACK_FADE },
    uFacingWidth: { value: DEFAULT_FACING_WIDTH },
    uRimSharpness: { value: DEFAULT_RIM_SHARPNESS },
    uRimGain: { value: DEFAULT_RIM_GAIN },
    uSeamLift: { value: DEFAULT_SEAM_LIFT },
    uCrestDrop: { value: DEFAULT_CREST_DROP },

    uFade: { value: 0 },
    uOpacity: { value: DEFAULT_OPACITY },
    uIntensity: { value: DEFAULT_INTENSITY },
    uSeamTint: { value: DEFAULT_SEAM_TINT },

    uColorBone: { value: new Color(BONE_COLOR_HEX) },
    uColorSeam: { value: new Color(SEAM_COLOR_HEX) },
    uColorCore: { value: new Color(CORE_COLOR_HEX) },
  };
}

/**
 * `RawShaderMaterial` não recebe o prefixo do three, então as matrizes e os
 * atributos padrão são declarados à mão aqui. O renderer continua **enviando**
 * os três (`modelViewMatrix`, `projectionMatrix`, `normalMatrix`) por objeto —
 * o que ele não faz é escrever as linhas de declaração.
 *
 * `position`, `normal` e `curvature` chegam como `Int16` com `normalized: true`
 * e já saem divididos por 32767 da busca de atributo, sem passe de decode
 * (V.5). A escala de mundo é `uRadius`, aplicada aqui.
 */
export const vertex: string = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

in vec3 position;
in vec3 normal;
/** +1 no fundo de uma fenda, −1 numa crista. Ver o script de build. */
in float curvature;

uniform float uRadius;
uniform float uPixelRatio;
uniform float uSize;
uniform float uMinSize;
uniform float uMaxSize;
uniform float uDepthSize;

uniform vec2 uPointerRay;
uniform float uPointerRadius;
uniform float uPointerPush;
uniform float uPointerStrength;

uniform float uBackFade;
uniform float uFacingWidth;
uniform float uRimSharpness;
uniform float uRimGain;
uniform float uSeamLift;
uniform float uCrestDrop;
uniform float uFade;

out float vShade;
out float vCurvature;
out float vEnergy;
out float vVariation;

const float EPSILON = 1e-4;

${POINTER_RAY_GLSL}

/**
 * Variação por ponto sem gastar atributo.
 *
 * O portfólio que originou a técnica manda um \`aSeed\` no buffer; aqui ele
 * custaria 2 bytes por ponto — 24 KB no arquivo, ~12% do payload da seção —
 * para transportar um número que a própria posição já determina. O hash é
 * estável por ponto (a posição não muda entre quadros), que é a única
 * propriedade que a variação precisa ter.
 */
float hashPoint(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

void main() {
  vec3 basePosition = position * uRadius;
  vec4 mvPosition = modelViewMatrix * vec4(basePosition, 1.0);

  // V.4: onde o raio do cursor passa *nesta* profundidade. O z do ponto se
  // cancela, então o alcance é um cilindro em torno do raio.
  vec2 offset = pointerOffset(mvPosition.xyz, uPointerRay);
  float offsetLength = length(offset);
  float influence =
    uPointerStrength * (1.0 - smoothstep(0.0, uPointerRadius, offsetLength));
  mvPosition.xy += (offset / max(offsetLength, EPSILON)) * influence * uPointerPush;

  gl_Position = projectionMatrix * mvPosition;

  // Tudo em view space: o vetor para o olho é a direção de volta à origem, e a
  // normalMatrix já carrega a rotação do modelo *e* a da câmera.
  vec3 toCamera = normalize(-mvPosition.xyz);
  float facing = dot(normalize(normalMatrix * normal), toCamera);

  // Direção para fora do centro do modelo — uma normal grosseira, mas *lisa*.
  // É contra ela que a silhueta é medida: a normal verdadeira de um crânio fica
  // de perfil em toda sutura, e um rim tirado dela chuvisca o objeto inteiro em
  // vez de desenhar um contorno.
  vec3 outward = normalize(position + vec3(EPSILON));
  float radialFacing = dot(normalize(normalMatrix * outward), toCamera);

  float visibility = mix(uBackFade, 1.0, smoothstep(-uFacingWidth, uFacingWidth * 0.8, facing));
  float rim = pow(1.0 - abs(radialFacing), uRimSharpness);

  float seam = max(curvature, 0.0);
  float crest = max(-curvature, 0.0);
  float relief = 1.0 + uSeamLift * seam - uCrestDrop * crest;

  vShade = visibility * (1.0 + uRimGain * rim) * relief * uFade;
  vCurvature = curvature;
  vEnergy = influence;
  vVariation = hashPoint(position);

  // Profundidade com sinal ao longo do eixo do olho, em raios: +1 é o polo
  // próximo da nuvem, −1 o distante.
  float centreDepth = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  float depth = clamp((mvPosition.z - centreDepth) / uRadius, -1.0, 1.0);

  // Atenuação por distância travada nas duas pontas: um ponto perto da câmera
  // não pode virar bolha, um longe não pode sumir entre dois pixels.
  float size = uSize * (0.7 + vVariation * 0.6) * (1.0 + uDepthSize * depth);
  gl_PointSize = clamp(size / max(-mvPosition.z, EPSILON), uMinSize, uMaxSize) * uPixelRatio;
}
`;

export const fragment: string = /* glsl */ `
precision highp float;

uniform vec3 uColorBone;
uniform vec3 uColorSeam;
uniform vec3 uColorCore;
uniform float uOpacity;
uniform float uIntensity;
uniform float uSeamTint;

in float vShade;
in float vCurvature;
in float vEnergy;
in float vVariation;

out vec4 fragColor;

${LINEAR_TO_SRGB}

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float distanceToCentre = length(offset);

  // Sprite redondo procedural: sem textura, borda macia, descarte duro fora
  // dela. O descarte é o que impede o quad do ponto de somar um quadrado de
  // alpha quase-zero sobre o vizinho — com blending aditivo, "quase zero" vezes
  // milhares de pontos é uma névoa visível.
  float disc = 1.0 - smoothstep(0.16, 0.5, distanceToCentre);
  if (disc <= 0.001) discard;

  float core = 1.0 - smoothstep(0.0, 0.26, distanceToCentre);

  // A cor carrega a anatomia: brasa no fundo das fendas, aço nas cristas.
  float tint = clamp(max(vCurvature, 0.0) * uSeamTint + vEnergy * 0.5, 0.0, 1.0);
  vec3 color = mix(uColorBone, uColorSeam, tint);
  color = mix(color, uColorCore, core * (0.14 + vEnergy * 0.3));

  float exposure = uIntensity * (0.55 + vVariation * 0.35);
  // Toda a forma vive no alpha, e só nele — aplicá-la também à exposição a
  // elevaria ao quadrado e estouraria o orçamento de brilho.
  float alpha = disc * uOpacity * vShade;

  fragColor = vec4(linearToSrgb(color * exposure), alpha);
}
`;
