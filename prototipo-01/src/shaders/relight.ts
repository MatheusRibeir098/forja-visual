import { POINTER_RAY_GLSL } from '@/engine/pointer';
import { LINEAR_TO_SRGB } from '@/shaders/glsl';
import type { Color, Texture, Vector2 } from 'three';

/**
 * IV.1 — **Relighting por depth map**.
 *
 * Um plano chato ganha volume porque a luz não é aplicada à geometria, e sim ao
 * *campo de altura* que a textura carrega. Três peças, nesta ordem:
 *
 * 1. **Altura** — 16 bits empacotados em R (byte alto) + G (byte baixo) do
 *    `forja-depth.png`, mais o grão somado por cima (tile separado, regra VI.5).
 * 2. **Normais derivadas do depth** — amostra ±1 texel em x e y e monta
 *    `normalize(vec3(-dH/dx, -dH/dy, 1))`. Nenhum vértice sabe do relevo; só o
 *    fragmento sabe. É isto que faz a face virada para a luz clarear e a oposta
 *    escurecer.
 * 3. **Sombra por ray march** — de cada pixel, caminha em direção à luz
 *    comparando a altura amostrada com a elevação do próprio raio. `uSamples`
 *    vem do tier; em 0 o shader continua rodando, só sem a sombra projetada
 *    (regra do projeto: tier muda número, nunca caminho de código).
 *
 * A luz é um ponto **acima da chapa**, posicionado onde o raio do cursor (V.4)
 * cruza o plano. Cor quente na luz, ambiente frio e baixo: a chapa é carvão e
 * só a brasa tem cor.
 *
 * O módulo é genérico de propósito — a seção "Relevo" reusa o mesmo par de
 * shaders com outro asset, outro plano e outra luz.
 *
 * ── ESPAÇOS DE COORDENADA ──────────────────────────────────────────────────
 * - **uv**: [0,1]² sobre a textura de relevo.
 * - **campo**: uv × vec2(uFieldAspect, 1), ou seja, a altura da chapa vale 1 e
 *   a largura vale o aspecto dela. Toda distância, altura e passo da marcha
 *   estão nesta unidade — inclusive `uHeightScale`, que traz o depth
 *   normalizado (0–1) para cá.
 * - **mundo/view**: unidades do three. `uFieldPerWorld` converte de mundo para
 *   campo; os eixos coincidem, então direções normalizadas valem nos dois.
 */

/**
 * Uniforms do par vertex/fragment. Exportado para que quem monta a cena não
 * precise repetir os literais — errar um nome de uniform é silencioso no three.
 *
 * `type` e não `interface`: o `uniforms` do `RawShaderMaterial` é indexado por
 * string, e só um type alias ganha a index signature implícita que o three
 * exige (mesmo motivo do `ThresholdUniforms` em `engine/composite.ts`).
 */
export type RelightUniforms = {
  /** RGBA8 com a altura empacotada em R+G. Amostre com `NearestFilter`. */
  uDepth: { value: Texture | null };
  /** Cor base, em espaço sRGB (deixe o three decodificar via `colorSpace`). */
  uAlbedo: { value: Texture | null };
  /** Tile seamless do grão; só o canal R é lido, 0.5 é neutro. */
  uGrain: { value: Texture | null };
  /** 1/largura e 1/altura da textura de depth, em texels de uv. */
  uTexel: { value: Vector2 };
  /** Encaixe da textura na tela: `uv = (vUv - 0.5) * uUvScale + 0.5 + uUvOffset`. */
  uUvScale: { value: Vector2 };
  /** Deslocamento do enquadramento, em uv. Negativo em y sobe a imagem. */
  uUvOffset: { value: Vector2 };
  /** Largura/altura da textura de relevo — define a unidade de campo em x. */
  uFieldAspect: { value: number };
  /** Repetições do tile de grão por unidade de campo. */
  uGrainTiles: { value: number };
  /** Amplitude do grão, em unidades do depth normalizado. */
  uGrainAmplitude: { value: number };
  /** Unidades de campo por unidade do depth normalizado. */
  uHeightScale: { value: number };
  /** Altura normalizada da superfície intocada da chapa (0.5 neste asset). */
  uPlateHeight: { value: number };
  /** Ganho aplicado ao albedo antes da iluminação — ver `DEFAULT_ALBEDO_GAIN`. */
  uAlbedoGain: { value: number };
  /** `engine.pointer.ray`: direção do cursor em view space dividida por z. */
  uPointerRay: { value: Vector2 };
  /** Fator mundo → campo. Isotrópico: o plano é escalado para cobrir a tela. */
  uFieldPerWorld: { value: number };
  /** Altura da luz acima da superfície da chapa, em unidades de campo. */
  uLightHeight: { value: number };
  /** Cor da luz, já em espaço linear (`new Color('#…')` converte sozinho). */
  uLightColor: { value: Color };
  /** Cor × nível do ambiente, em espaço linear. */
  uAmbientColor: { value: Color };
  uLightIntensity: { value: number };
  /** Distância (campo) em que a luz cai à metade. */
  uLightRadius: { value: number };
  /** Expoente aplicado à queda — ver `DEFAULT_FALLOFF_CURVE`. */
  uFalloffCurve: { value: number };
  uSpecularStrength: { value: number };
  uShininess: { value: number };
  /** Passos do ray march. 0 desliga a sombra projetada, mantendo as normais. */
  uSamples: { value: number };
  /** Alcance da marcha, em unidades de campo. */
  uMarchDistance: { value: number };
  /** Diferença de altura que já produz sombra cheia — largura da penumbra. */
  uShadowSoftness: { value: number };
  /** Quanto a sombra chega a escurecer, 0–1. */
  uShadowStrength: { value: number };
};

// ---------------------------------------------------------------------------
// Defaults — medidos contra o asset descrito em `public/relief/README.md`
// ---------------------------------------------------------------------------

/**
 * Unidades de campo por unidade do depth normalizado.
 *
 * O asset guarda 0.5 na chapa e ~0.15 no fundo da letra: 0.35 de queda
 * normalizada. O bisel medido é de ~12 px sobre uma chapa de 720 px, ou seja
 * 12/720 = 0.0167 unidades de campo de rampa. Para o bisel sair em ~45° — que é
 * o que uma gravação real produz e o que faz a face virada para a luz separar
 * da chapa — a queda tem que valer aproximadamente a largura da rampa:
 * 0.35 · s ≈ 0.0167 ⇒ s ≈ 0.048. 0.05 arredonda e dá 46°.
 */
export const DEFAULT_HEIGHT_SCALE = 0.05;

/** Superfície intocada da chapa no `forja-depth.png` (ver README do asset). */
export const DEFAULT_PLATE_HEIGHT = 0.5;

/**
 * Amplitude do grão, em unidades do depth normalizado.
 *
 * O asset foi gerado com 0.02 e o README diz, com todas as letras, que a
 * amplitude passou a ser ajustável sem regerar o arquivo. Foi preciso: com
 * `DEFAULT_HEIGHT_SCALE`, 0.02 dá 0.001 unidades de campo sobre um texel de
 * 1/720, ou seja até ~20° de inclinação nas normais — a chapa vira lixa e o
 * specular pisca em cada grão. 0.009 mantém o metal texturizado (~9°) e deixa o
 * bisel, que é o assunto, dominar a leitura.
 */
export const DEFAULT_GRAIN_AMPLITUDE = 0.009;

/**
 * Tiles de grão por unidade de campo (= por altura da chapa). Com 4, cada tile
 * de 256 px ocupa 720/4 = 180 px na chapa, então as feições de 16 px e 8 px do
 * tile chegam à tela com ~11 px e ~5.6 px: textura de metal legível a olho nu,
 * longe da ferrugem exagerada.
 */
export const DEFAULT_GRAIN_TILES = 4;

/**
 * Ganho do albedo.
 *
 * O asset é carvão #1c1c1e — 0.0116 em linear. Usado cru, **nenhuma**
 * intensidade de luz plausível tira a chapa do preto: a reflectância é baixa
 * demais para um modelo direto. O ganho recoloca a base em ~0.116 (aço escuro
 * real) preservando o que o arquivo de fato carrega: a variação do desgaste e o
 * escurecimento de 30% dentro dos sulcos.
 */
export const DEFAULT_ALBEDO_GAIN = 10;

/**
 * Altura da luz sobre a chapa, em unidades de campo.
 *
 * Varrido em 0.50 / 0.35 / 0.22. A 0.50 a luz chega quase de frente, os biséis
 * param de separar da chapa e a imagem inteira vira um marrom uniforme — foi o
 * que a primeira captura mostrou. A 0.22 a luz rasa: a poça encolhe para o
 * tamanho de uma letra, a queda entre o cursor e o canto oposto passa de 4× para
 * 15×, e a sombra projetada dentro do sulco fica com ~29 px em vez de 18.
 * Abaixo de ~0.18 a sombra passa a cobrir letras inteiras.
 */
export const DEFAULT_LIGHT_HEIGHT = 0.22;

/**
 * Distância (campo) em que a luz cai à metade.
 *
 * Começou em 0.85 e a captura reprovou: a 0.85 a queda ainda devolve 42% da luz
 * a uma unidade de campo de distância, e a chapa inteira ficava marrom — o
 * contrário do conceito, que pede carvão com **uma** brasa. 0.35 põe a meia-luz
 * a um terço de altura de chapa, que é a largura de uma haste de letra.
 */
export const DEFAULT_LIGHT_RADIUS = 0.35;

/**
 * Expoente sobre a queda. Sozinha, `r²/(r²+d²)` tem cauda longa demais: o canto
 * oposto ao cursor ainda recebia ~10%. Com 1.6 a mesma curva mantém o miolo
 * (0.59 sob o cursor) e derruba a cauda para ~0.4% na diagonal, onde o ambiente
 * frio assume. Acima de ~2 a borda da poça vira anel visível.
 */
export const DEFAULT_FALLOFF_CURVE = 1.6;

/**
 * Intensidade da luz. Com o ganho do albedo (0.116 de reflectância) e a queda
 * acima, a chapa logo abaixo da brasa sai em ~0.37 linear (byte 165), meia
 * chapa adiante cai para o byte 89 e a diagonal oposta chega ao byte 12, abaixo
 * do próprio ambiente — carvão com uma brasa, não uma chapa laranja.
 */
export const DEFAULT_LIGHT_INTENSITY = 5.5;

/** #ff7a2a — a única cor do hero. Laranja de forja, não laranja de UI. */
export const LIGHT_COLOR_HEX = '#ff7a2a';

/** Ambiente frio-neutro: contrapeso da brasa sem virar "gradiente azul". */
export const AMBIENT_COLOR_HEX = '#a8aeb8';

/**
 * Nível do ambiente. 0.075 × a reflectância de 0.16 dá 0.0053 linear, que é o
 * byte 17 em sRGB: a chapa fora da brasa continua desenhada (dá para ver que é
 * metal) sem competir com a luz.
 */
export const AMBIENT_LEVEL = 0.075;

/**
 * Specular apertado: brilho de aresta viva, não de plástico. 0.35/90 na primeira
 * captura abriu uma mancha molhada de meia letra ao lado do cursor — com a luz
 * alta, o vetor médio fica quase alinhado numa área grande. 0.12 e expoente 130
 * recolhem o brilho para o topo dos biséis; o specular não é multiplicado pelo
 * albedo, então acima de ~0.15 ele estoura sozinho sob o cursor.
 */
export const DEFAULT_SPECULAR_STRENGTH = 0.12;
export const DEFAULT_SHININESS = 130;

/**
 * Alcance do ray march, em unidades de campo.
 *
 * A sombra mais longa que este relevo pode projetar é
 * `profundidade / tan(elevação)`. A profundidade é 0.35 · 0.05 = 0.0175; com a
 * luz a 0.22 de altura, meia chapa adiante a elevação é ~24°, o que dá 0.04
 * (≈ 29 px). 0.06 cobre o caso e para antes de a marcha cruzar letras vizinhas.
 * Mais longe que isso a luz já caiu abaixo do ambiente e não há sombra para ver.
 */
export const DEFAULT_MARCH_DISTANCE = 0.06;

/**
 * Largura da penumbra, em altura de campo. 0.006 é cerca de um terço da
 * profundidade do sulco (0.0175): larga o bastante para poucos passos de marcha
 * não deixarem escada na borda, estreita o bastante para a sombra continuar
 * lendo como sombra e não como mancha.
 */
export const DEFAULT_SHADOW_SOFTNESS = 0.006;

/**
 * Sombra nunca 100%: um sulco totalmente preto apaga o desenho da letra. 15% de
 * luz vazada é o que o ambiente de uma forja de fato devolve para dentro do
 * corte.
 */
export const DEFAULT_SHADOW_STRENGTH = 0.85;

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * Vertex de um plano real (não do triângulo de tela cheia): o fragment precisa
 * da posição em view space para resolver o raio do cursor na profundidade do
 * próprio fragmento — que é o que mantém a técnica correta quando o plano
 * deixar de ser perpendicular à câmera.
 */
export const vertex: string = /* glsl */ `
precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec2 vUv;
out vec3 vMv;

void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vMv = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const fragment: string = /* glsl */ `
precision highp float;

in vec2 vUv;
in vec3 vMv;
out vec4 outColor;

uniform sampler2D uDepth;
uniform sampler2D uAlbedo;
uniform sampler2D uGrain;

uniform vec2 uTexel;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
uniform float uFieldAspect;
uniform float uGrainTiles;
uniform float uGrainAmplitude;
uniform float uHeightScale;
uniform float uPlateHeight;
uniform float uAlbedoGain;

uniform vec2 uPointerRay;
uniform float uFieldPerWorld;
uniform float uLightHeight;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform float uLightIntensity;
uniform float uLightRadius;
uniform float uFalloffCurve;
uniform float uSpecularStrength;
uniform float uShininess;

uniform int uSamples;
uniform float uMarchDistance;
uniform float uShadowSoftness;
uniform float uShadowStrength;

${POINTER_RAY_GLSL}
${LINEAR_TO_SRGB}

/**
 * Altura da chapa em unidades de campo. O depth vem em 16 bits quebrados em
 * dois canais de 8 (R alto, G baixo) — por isso a textura precisa de
 * NearestFilter: o filtro linear interpolaria o byte baixo no ponto em que ele
 * estoura e cravaria picos no relevo.
 */
float plateHeight(vec2 uv) {
  vec4 texel = texture(uDepth, uv);
  float packed = (texel.r * 255.0 * 256.0 + texel.g * 255.0) / 65535.0;
  return packed * uHeightScale;
}

/** Grão de metal, somado à altura. Tile seamless, 0.5 = neutro. */
float grainHeight(vec2 uv) {
  float sampled = texture(uGrain, uv * vec2(uFieldAspect, 1.0) * uGrainTiles).r;
  return (sampled - 0.5) * 2.0 * uGrainAmplitude * uHeightScale;
}

float surfaceHeight(vec2 uv) {
  return plateHeight(uv) + grainHeight(uv);
}

/**
 * Ray march até a luz. Anda no campo somando a inclinação do próprio raio; onde
 * a chapa está acima do raio, o pixel de origem está atrás de alguma coisa.
 *
 * O grão fica **fora** desta amostragem de propósito: ele vale 0.001 unidades
 * de campo contra 0.0175 do sulco, então não decide oclusão nenhuma e dobraria
 * o número de fetches do laço, que é o custo dominante do shader.
 */
float marchShadow(vec3 origin, vec3 lightDir, float lightDistance) {
  if (uSamples <= 0) return 1.0;

  float reach = min(uMarchDistance, lightDistance);
  float stepSize = reach / float(uSamples);
  float occlusion = 0.0;

  for (int i = 1; i <= uSamples; i += 1) {
    float travelled = float(i) * stepSize;
    vec3 probe = origin + lightDir * travelled;
    float sampled = plateHeight(probe.xy / vec2(uFieldAspect, 1.0));
    float above = sampled - probe.z;

    // Oclusor perto pesa mais que oclusor longe: é o que dá penumbra e, de
    // quebra, dissolve a borda dura no fim do alcance finito da marcha. O
    // denominador leva um passo a mais para a última amostra não valer zero.
    float weight = 1.0 - travelled / (reach + stepSize);
    occlusion = max(occlusion, smoothstep(0.0, uShadowSoftness, above) * weight);
  }

  return 1.0 - occlusion * uShadowStrength;
}

void main() {
  vec2 uv = (vUv - 0.5) * uUvScale + 0.5 + uUvOffset;
  vec2 field = uv * vec2(uFieldAspect, 1.0);
  // Texel medido em campo. Com a textura e o campo compartilhando o aspecto,
  // ele é quadrado: 1.7778/1280 == 1/720.
  vec2 texelField = uTexel * vec2(uFieldAspect, 1.0);

  float height = surfaceHeight(uv);

  // --- normais tiradas do depth, não da geometria ---
  vec2 stepX = vec2(uTexel.x, 0.0);
  vec2 stepY = vec2(0.0, uTexel.y);
  float left = surfaceHeight(uv - stepX);
  float right = surfaceHeight(uv + stepX);
  float down = surfaceHeight(uv - stepY);
  float up = surfaceHeight(uv + stepY);
  vec3 normal = normalize(vec3(
    -(right - left) / (2.0 * texelField.x),
    -(up - down) / (2.0 * texelField.y),
    1.0
  ));

  // --- V.4: a luz mora onde o raio do cursor cruza a chapa ---
  // pointerOffset devolve o vetor do raio até o fragmento **na profundidade do
  // próprio fragmento**; invertido, é o caminho do fragmento até a luz. Com o
  // plano perpendicular à câmera o termo ray*mv.z é o mesmo em toda a tela —
  // deixa de ser assim que o plano inclina, e a fórmula já cobre os dois casos.
  vec2 toLightPlanar = -pointerOffset(vMv, uPointerRay) * uFieldPerWorld;
  float lightZ = uPlateHeight * uHeightScale + uLightHeight;
  vec3 toLight = vec3(toLightPlanar, lightZ - height);
  float lightDistance = length(toLight);
  vec3 lightDir = toLight / max(lightDistance, 1e-4);

  float shadow = marchShadow(vec3(field, height), lightDir, lightDistance);

  // Queda: metade da luz em uLightRadius, com um expoente por cima para cortar
  // a cauda. Inverso do quadrado puro apagaria a chapa a menos de meia tela do
  // cursor; sem o expoente, o canto oposto continuaria laranja.
  float ratio = lightDistance / uLightRadius;
  float falloff = pow(1.0 / (1.0 + ratio * ratio), uFalloffCurve);

  vec3 viewDir = normalize(-vMv);
  vec3 halfway = normalize(lightDir + viewDir);
  float diffuse = max(dot(normal, lightDir), 0.0);
  // Sem o step, o specular acenderia faces que a luz nem alcança.
  float specular =
    pow(max(dot(normal, halfway), 0.0), uShininess) * uSpecularStrength * step(1e-4, diffuse);

  vec3 albedo = texture(uAlbedo, uv).rgb * uAlbedoGain;
  float lit = falloff * shadow * uLightIntensity;

  vec3 color = albedo * (uAmbientColor + uLightColor * diffuse * lit) + uLightColor * specular * lit;

  outColor = vec4(linearToSrgb(color), 1.0);
}
`;
