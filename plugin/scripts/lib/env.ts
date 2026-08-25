/**
 * Quanto da máquina **não** é a medição.
 *
 * Motivo de existir (protótipo 01, 2026-08-25): o p5 do tier desktop caía para 30 fps em
 * ~40% das execuções e dois devs gastaram ~20 min cada cortando efeitos para consertar. Não
 * era o efeito: era o Spotify do dono a 48% de CPU, com processo de GPU próprio, disputando
 * a placa integrada. A mediana nunca se moveu. O medidor tinha todos os dados para dizer
 * isso e não dizia — então agora diz.
 *
 * A amostra é tirada **antes** de subir preview e Chrome, num intervalo curto: assim o que
 * ela mede é o ruído da máquina, não o nosso próprio trabalho.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';

export interface ProcessLoad {
  readonly name: string;
  /** Porcentagem de **um** núcleo consumida no intervalo amostrado. */
  readonly cpuPercent: number;
}

export interface EnvironmentSnapshot {
  readonly cpuCount: number;
  readonly loadPerCore: number;
  /** Núcleos inteiros ocupados por processos alheios; `null` fora do Linux. */
  readonly foreignBusyCores: number | null;
  readonly topProcesses: readonly ProcessLoad[];
  readonly contended: boolean;
  readonly reasons: readonly string[];
}

/**
 * Calibração dos limites, medida numa área de trabalho Linux ociosa (Hyprland + barra +
 * navegador aberto sem uso): o ruído de fundo normal fica em ~1 núcleo somado, com o
 * compositor e a barra entre 20% e 30% de um núcleo cada. Marcar isso como contenção faria
 * toda reprovação legítima virar "inconclusivo", que é o oposto do objetivo. Os limites
 * abaixo passam longe desse ruído e pegam o caso que custou caro: um Spotify a ~48% de um
 * núcleo com processo de GPU próprio, mais um navegador pessoal com dezenas de processos.
 */
const BUSY_PROCESS_PERCENT = 40;
/** Programas que abrem contexto gráfico próprio e brigam pela mesma GPU. */
const GPU_HUNGRY =
  /chrome|chromium|firefox|electron|spotify|discord|obs|steam|vlc|mpv|blender|code|slack|teams|zoom/i;
const GPU_HUNGRY_PERCENT = 25;
const LOAD_PER_CORE_LIMIT = 0.6;
const FOREIGN_CORES_LIMIT = 1.5;
const TOP_PROCESSES = 5;
const DEFAULT_WINDOW_MS = 1_200;
const DEFAULT_CLOCK_TICKS = 100;

interface ProcTicks {
  readonly name: string;
  readonly ticks: number;
}

function clockTicksPerSecond(): number {
  const probe = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' });
  const parsed = Number((probe.stdout ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLOCK_TICKS;
}

/**
 * utime + stime de cada processo, direto de `/proc/<pid>/stat`.
 *
 * Usa `/proc` em vez de `ps` de propósito: o `%CPU` do `ps` é a média sobre a vida inteira
 * do processo, não o consumo agora — exatamente o número que confundiria quem tenta saber
 * se a máquina está ocupada *nesta* medição.
 */
function sampleProcTicks(selfPid: number): Map<number, ProcTicks> | null {
  if (!existsSync('/proc')) return null;

  const sample = new Map<number, ProcTicks>();
  for (const entry of readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue;

    let raw: string;
    try {
      raw = readFileSync(`/proc/${entry}/stat`, 'utf8');
    } catch {
      // Processo morreu entre o readdir e o read — normal, ignora.
      continue;
    }

    // O nome do processo vem entre parênteses e pode conter espaços e ')'.
    const nameEnd = raw.lastIndexOf(')');
    const nameStart = raw.indexOf('(');
    if (nameStart === -1 || nameEnd === -1 || nameEnd < nameStart) continue;
    const name = raw.slice(nameStart + 1, nameEnd);

    // Depois do ')' o campo 1 é o estado; utime e stime são os campos 12 e 13 dali.
    const fields = raw.slice(nameEnd + 2).split(' ');
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) continue;

    sample.set(pid, { name, ticks: utime + stime });
  }
  return sample;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function diffProcesses(
  before: Map<number, ProcTicks>,
  after: Map<number, ProcTicks>,
  elapsedMs: number,
  ticksPerSecond: number,
): ProcessLoad[] {
  const elapsedTicks = (elapsedMs / 1000) * ticksPerSecond;
  if (elapsedTicks <= 0) return [];

  const loads: ProcessLoad[] = [];
  for (const [pid, later] of after) {
    const earlier = before.get(pid);
    // Processo que nasceu dentro da janela não tem base de comparação: fica de fora em vez
    // de entrar com o tempo de CPU acumulado desde o boot.
    if (earlier === undefined) continue;
    const usedTicks = later.ticks - earlier.ticks;
    if (usedTicks <= 0) continue;
    loads.push({
      name: later.name,
      cpuPercent: Math.round((usedTicks / elapsedTicks) * 1000) / 10,
    });
  }
  return loads.sort((a, b) => b.cpuPercent - a.cpuPercent);
}

function assessContention(
  loadPerCore: number,
  foreignBusyCores: number | null,
  processes: readonly ProcessLoad[],
): readonly string[] {
  const reasons: string[] = [];

  if (loadPerCore > LOAD_PER_CORE_LIMIT) {
    reasons.push(
      `carga média de ${loadPerCore.toFixed(2)} por núcleo (limite ${LOAD_PER_CORE_LIMIT})`,
    );
  }
  if (foreignBusyCores !== null && foreignBusyCores > FOREIGN_CORES_LIMIT) {
    reasons.push(`${foreignBusyCores.toFixed(2)} núcleo(s) ocupados por processos alheios`);
  }
  for (const process of processes) {
    const hungry = GPU_HUNGRY.test(process.name);
    const limit = hungry ? GPU_HUNGRY_PERCENT : BUSY_PROCESS_PERCENT;
    if (process.cpuPercent < limit) continue;
    reasons.push(
      hungry
        ? `${process.name} a ${process.cpuPercent}% de um núcleo — abre contexto gráfico próprio e disputa a mesma GPU`
        : `${process.name} a ${process.cpuPercent}% de um núcleo`,
    );
  }

  return reasons;
}

/** Amostra a máquina por `windowMs` e diz se dá para confiar num número de FPS agora. */
export async function probeEnvironment(
  windowMs = DEFAULT_WINDOW_MS,
): Promise<EnvironmentSnapshot> {
  const cpuCount = Math.max(1, cpus().length);
  const ticksPerSecond = clockTicksPerSecond();
  const selfPid = process.pid;

  const before = sampleProcTicks(selfPid);
  const startedAt = Date.now();
  await delay(windowMs);
  const after = before === null ? null : sampleProcTicks(selfPid);
  const elapsedMs = Date.now() - startedAt;

  const processes =
    before === null || after === null
      ? []
      : diffProcesses(before, after, elapsedMs, ticksPerSecond);
  const foreignBusyCores =
    before === null || after === null
      ? null
      : Math.round((processes.reduce((sum, p) => sum + p.cpuPercent, 0) / 100) * 100) / 100;

  const loadPerCore = Math.round(((loadavg()[0] ?? 0) / cpuCount) * 100) / 100;
  const topProcesses = processes.slice(0, TOP_PROCESSES);
  const reasons = assessContention(loadPerCore, foreignBusyCores, topProcesses);

  return {
    cpuCount,
    loadPerCore,
    foreignBusyCores,
    topProcesses,
    contended: reasons.length > 0,
    reasons,
  };
}

/**
 * Bloco de texto pronto para o relatório dos medidores. Os maiores consumidores são
 * impressos **sempre**, e não só quando passam do limite: quem lê o número precisa poder
 * julgar sozinho se a máquina estava limpa quando ele foi tirado.
 */
export function formatEnvironment(snapshot: EnvironmentSnapshot): string {
  const busy =
    snapshot.foreignBusyCores === null
      ? 'consumo alheio indisponível (sem /proc)'
      : `${snapshot.foreignBusyCores.toFixed(2)} núcleo(s) em uso por outros processos`;
  const head = `  ambiente     ${snapshot.cpuCount} núcleos · carga ${snapshot.loadPerCore.toFixed(2)}/núcleo · ${busy}`;
  const top = snapshot.topProcesses
    .slice(0, 3)
    .map((entry) => `${entry.name} ${entry.cpuPercent.toFixed(0)}%`)
    .join(' · ');
  const detail = top === '' ? '' : `\n               maiores: ${top}`;

  if (!snapshot.contended) {
    return `${head}${detail}\n               máquina ociosa o bastante — número confiável`;
  }
  const lines = snapshot.reasons.map((reason) => `                 · ${reason}`);
  return `${head}${detail}\n               ⚠ CONTENÇÃO DETECTADA:\n${lines.join('\n')}`;
}
