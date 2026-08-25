/**
 * Posicionamento dos jogadores dentro do campo — cálculo **puro**, sem DOM e
 * sem React.
 *
 * Coordenadas em percentual (0–100), independentes de viewBox, para poderem
 * ser reaproveitadas por qualquer renderer (SVG web hoje, `react-native-svg`
 * num futuro app Expo).
 *
 * ## Dois modos
 *
 * 1. **Com formação** (`lines` informado): as faixas do campo são as linhas da
 *    formação, e cada jogador vai para a vaga que o servidor gravou
 *    (`line_index`/`slot_index`). É o modo novo.
 * 2. **Sem formação**: agrupa por `positionSortOrder` distinto, exatamente
 *    como antes desta funcionalidade. Sorteios antigos e sorteios feitos sem
 *    escolher formação continuam desenhados assim.
 *
 * ## O problema de sobreposição
 *
 * O cálculo anterior distribuía `x = (i+1)/(n+1) * 100` e usava fonte e
 * truncamento fixos. Com 4 jogadores numa linha o espaçamento é de 20 unidades,
 * enquanto o nome (11 caracteres a `fontSize 3.9`) ocupa ~22 — os nomes se
 * sobrepunham. Agora fonte e truncamento **encolhem com a lotação da linha**, e
 * linhas cheias ganham um deslocamento vertical alternado.
 */

export interface FieldPlayer {
  id: number;
  positionSortOrder: number;
  /** Vaga gravada pelo servidor. Nulo em sorteio sem formação. */
  lineIndex?: number | null;
  slotIndex?: number | null;
}

export interface PlayerCoordinate {
  id: number;
  x: number;
  y: number;
  /** Tamanho da fonte do nome, relativo ao viewBox. */
  nameSize: number;
  /** Máximo de caracteres antes de truncar. */
  maxChars: number;
}

export interface FieldLayoutOptions {
  /** Linhas da formação, da defesa para o ataque. Ausente = modo antigo. */
  lines?: number[] | null;
  /** Desenhar a faixa de goleiro embaixo. */
  hasGoalkeeperLine?: boolean;
}

const TOP_MARGIN = 10;
const BOTTOM_MARGIN = 84;
/** Faixa reservada ao goleiro, abaixo da linha mais defensiva. */
const GOALKEEPER_Y = 93;

/** Fonte do nome por lotação da linha. Uma linha de 2 pode ser generosa; uma de
 * 5 precisa caber. */
export function nameSizeFor(playersInLine: number): number {
  return Math.max(2.8, Math.min(4.4, 4.4 - 0.35 * (playersInLine - 2)));
}

/** Truncamento por lotação da linha. */
export function maxCharsFor(playersInLine: number): number {
  if (playersInLine <= 2) return 12;
  if (playersInLine === 3) return 10;
  if (playersInLine === 4) return 8;
  return 7;
}

/** Deslocamento vertical alternado. A partir de 4 numa linha, alternar ±3
 * unidades separa os nomes sem mexer na leitura da formação. */
function verticalStagger(playersInLine: number, indexInLine: number): number {
  if (playersInLine < 4) return 0;
  return indexInLine % 2 === 0 ? -3 : 3;
}

function spread(indexInLine: number, playersInLine: number): number {
  return ((indexInLine + 1) / (playersInLine + 1)) * 100;
}

function yForLine(lineIndex: number, lineCount: number, topMargin: number): number {
  if (lineCount <= 1) return (topMargin + BOTTOM_MARGIN) / 2;
  // Linha 0 é a mais defensiva e fica **embaixo**; a última, no ataque, em cima.
  return BOTTOM_MARGIN - (lineIndex / (lineCount - 1)) * (BOTTOM_MARGIN - topMargin);
}

export function computeFieldLayout<T extends FieldPlayer>(
  players: T[],
  options: FieldLayoutOptions = {},
): (T & PlayerCoordinate)[] {
  const { lines, hasGoalkeeperLine = false } = options;

  const topMargin = TOP_MARGIN;
  const goalkeepers = hasGoalkeeperLine
    ? players.filter((player) => player.lineIndex === null || player.lineIndex === undefined)
    : [];

  // -- Modo formação -------------------------------------------------------
  if (lines && lines.length > 0) {
    const positioned = players.map((player) => {
      const lineIndex = player.lineIndex;

      // Sem vaga: é o goleiro (quando há faixa própria) ou o jogador
      // excedente de um time com um a mais que a formação comporta. Nos dois
      // casos ele é desenhado, nunca escondido.
      if (lineIndex === null || lineIndex === undefined) {
        const bucket = hasGoalkeeperLine ? goalkeepers : players.filter((p) => p.lineIndex == null);
        const indexInBucket = bucket.findIndex((p) => p.id === player.id);
        const y = hasGoalkeeperLine ? GOALKEEPER_Y : yForLine(0, lines.length, topMargin);
        return {
          ...player,
          x: spread(indexInBucket, bucket.length),
          y,
          nameSize: nameSizeFor(bucket.length),
          maxChars: maxCharsFor(bucket.length),
        };
      }

      const playersInLine = lines[lineIndex] ?? 1;
      const slotIndex = player.slotIndex ?? 0;
      return {
        ...player,
        x: spread(slotIndex, playersInLine),
        y: yForLine(lineIndex, lines.length, topMargin) + verticalStagger(playersInLine, slotIndex),
        nameSize: nameSizeFor(playersInLine),
        maxChars: maxCharsFor(playersInLine),
      };
    });

    return positioned;
  }

  // -- Modo antigo: agrupa pela posição cadastrada -------------------------
  const sortOrders = Array.from(new Set(players.map((p) => p.positionSortOrder))).sort(
    (a, b) => a - b,
  );
  const lineCount = sortOrders.length;

  return players.map((player) => {
    const lineIndex = sortOrders.indexOf(player.positionSortOrder);
    const y = yForLine(lineIndex, lineCount, topMargin);

    const playersInLine = players.filter((p) => p.positionSortOrder === player.positionSortOrder);
    const indexInLine = playersInLine.findIndex((p) => p.id === player.id);

    return {
      ...player,
      x: spread(indexInLine, playersInLine.length),
      y: y + verticalStagger(playersInLine.length, indexInLine),
      nameSize: nameSizeFor(playersInLine.length),
      maxChars: maxCharsFor(playersInLine.length),
    };
  });
}
