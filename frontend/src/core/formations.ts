/**
 * Formações — espelho TypeScript de `apps/draws/domain/formations.py`.
 *
 * Existe para a tela montar as opções **sem ir à rede** a cada mudança de
 * configuração do sorteio (o organizador mexe no número de times e a lista
 * precisa responder na hora). O servidor continua sendo a autoridade: é ele
 * que valida a formação no momento do sorteio e recusa o que não fecha.
 *
 * Qualquer alteração nas regras aqui precisa ser feita **nos dois lados** —
 * `tests/test_formations.py` e `formations.test.ts` cobrem os mesmos casos de
 * propósito, e é isso que denuncia uma divergência.
 */

export interface Formation {
  /** Notação que o usuário conhece: `"2-2-2"`. */
  key: string;
  lines: number[];
  linePlayers: number;
  lineCount: number;
  /** É a sugestão do sistema (a mais equilibrada para este elenco). */
  balanced: boolean;
}

const MAX_PER_LINE = 4;
const MAX_LINES_SMALL = 3;
const MAX_LINES_LARGE = 4;
const SMALL_SQUAD_THRESHOLD = 6;

export function parseFormation(value: string): number[] | null {
  if (!value) return null;
  const parts = value.trim().split("-");
  if (parts.length < 2) return null;

  const lines = parts.map((part) => Number(part));
  if (lines.some((size) => !Number.isInteger(size) || size < 1)) return null;
  return lines;
}

export function formatFormation(lines: number[]): string {
  return lines.join("-");
}

/** Variância dos tamanhos de linha. Menor = mais equilibrada. */
function balanceScore(lines: number[]): number {
  const mean = lines.reduce((sum, size) => sum + size, 0) / lines.length;
  return lines.reduce((sum, size) => sum + (size - mean) ** 2, 0) / lines.length;
}

function compositions(total: number, parts: number, maxPerPart: number): number[][] {
  if (parts === 1) {
    return total >= 1 && total <= maxPerPart ? [[total]] : [];
  }

  const result: number[][] = [];
  const limit = Math.min(maxPerPart, total - parts + 1);
  for (let first = 1; first <= limit; first += 1) {
    for (const rest of compositions(total - first, parts - 1, maxPerPart)) {
      result.push([first, ...rest]);
    }
  }
  return result;
}

/**
 * Todas as formações válidas para N jogadores de linha, da mais equilibrada
 * para a menos.
 *
 * No empate de equilíbrio vence quem tem **mais linhas**: com 6 jogadores,
 * `2-2-2` e `3-3` empatam em variância, mas `3-3` é um time sem meio-campo.
 */
export function generateFormations(linePlayers: number): Formation[] {
  if (!Number.isInteger(linePlayers) || linePlayers < 2) return [];

  const maxLines = linePlayers <= SMALL_SQUAD_THRESHOLD ? MAX_LINES_SMALL : MAX_LINES_LARGE;
  const maxPerLine = Math.min(MAX_PER_LINE, Math.ceil(linePlayers / 2));

  const all: number[][] = [];
  for (let parts = 2; parts <= Math.min(maxLines, linePlayers); parts += 1) {
    all.push(...compositions(linePlayers, parts, maxPerLine));
  }

  all.sort((a, b) => {
    const byBalance = balanceScore(a) - balanceScore(b);
    if (byBalance !== 0) return byBalance;
    const byLines = b.length - a.length;
    if (byLines !== 0) return byLines;
    return formatFormation(a).localeCompare(formatFormation(b));
  });

  return all.map((lines, index) => ({
    key: formatFormation(lines),
    lines,
    linePlayers,
    lineCount: lines.length,
    balanced: index === 0,
  }));
}

export function defaultFormation(linePlayers: number): Formation | null {
  return generateFormations(linePlayers)[0] ?? null;
}

/** A formação cabe neste elenco? Só a soma importa — um arranjo fora do
 * catálogo que distribua exatamente os jogadores é legítimo. */
export function isValidFormation(lines: number[], linePlayers: number): boolean {
  return lines.reduce((sum, size) => sum + size, 0) === linePlayers;
}

/**
 * Para cada linha da formação, qual posição cadastrada ela representa.
 *
 * A formação pode ter mais linhas do que a organização tem posições de linha
 * (4 linhas para ZAG/ME/AT). Duas linhas então compartilham a mesma posição —
 * e o campo continua desenhando as quatro faixas, porque a linha é guardada
 * separada da posição.
 */
export function mapLinesToPositions<T>(lineCount: number, linePositions: T[]): T[] {
  if (linePositions.length === 0 || lineCount <= 0) return [];
  if (lineCount === 1) return [linePositions[0]];

  return Array.from({ length: lineCount }, (_, index) =>
    linePositions[Math.round((index * (linePositions.length - 1)) / (lineCount - 1))],
  );
}
