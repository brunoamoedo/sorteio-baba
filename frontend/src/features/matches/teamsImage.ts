import { PALETTE, TEAM_COLORS } from "../../shared/theme/tokens";
import type { Team, TeamPlayer, TeamResultOutcome } from "../../core/types/draw";
import { getPlayerDisplayName } from "./shareFormat";

/**
 * Imagem única com **todos** os times do sorteio, para mandar no grupo.
 *
 * Antes o compartilhamento anexava um PNG por time (o campo em SVG de cada
 * card): com 3 ou 4 times o grupo recebia uma sequência de imagens e ninguém
 * via a escalação completa de uma vez. Aqui os times saem lado a lado, em
 * grade, num só arquivo.
 *
 * ## Por que canvas, e não o SVG do campo
 *
 * O texto precisa caber no card: um apelido comprido tem de ser cortado com
 * reticências, nunca vazar para o card vizinho. Só o canvas mede o texto
 * (`measureText`) antes de desenhar.
 *
 * ## Tamanho de letra fixo
 *
 * Com mais times a imagem **cresce** (mais colunas, mais linhas) — o card e a
 * fonte nunca encolhem. É o que garante que, mesmo com 6 ou 8 times, o nome
 * continua legível depois da compressão do WhatsApp.
 *
 * ## Sem emoji
 *
 * Emoji no canvas depende da fonte do aparelho — em vários ele sai como um
 * quadrado. A identidade do time (🔵 🔴 …) vira um círculo desenhado na
 * própria cor do time, que é a mesma do emoji da mensagem.
 *
 * A imagem usa sempre a paleta clara: ela é vista fora do sistema, no tema de
 * quem recebe, e o fundo claro é o que lê bem nos dois.
 */

const COLORS = PALETTE.light;
const TEAM_PALETTE = TEAM_COLORS.light;

const FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

/** Medidas da imagem, em pixels reais do PNG. */
export const TEAMS_IMAGE = {
  /** Largura mínima: o padrão de imagem do WhatsApp. Com 1 ou 2 times a grade
   * fica centralizada dentro dela. */
  minWidth: 1080,
  padding: 56,
  gap: 28,
  cardWidth: 470,
  /** Faixa de cor + nome do time + linha de resumo. */
  cardHeaderHeight: 124,
  cardPaddingY: 16,
  rowHeight: 58,
  titleHeight: 150,
  footerHeight: 72,
  radius: 24,
} as const;

/** Colunas da grade conforme a quantidade de times: 2 lado a lado, 3 numa
 * linha só, 4 em 2×2, até 9 em três colunas e, acima disso, quatro. */
export function teamsImageColumns(teamCount: number): number {
  if (teamCount <= 3) return Math.max(teamCount, 1);
  if (teamCount === 4) return 2;
  if (teamCount <= 9) return 3;
  return 4;
}

export interface TeamsImageLayout {
  columns: number;
  rows: number;
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
  /** Canto superior esquerdo de cada card, na ordem dos times. */
  cards: { x: number; y: number }[];
}

/** Grade da imagem — função pura, sem canvas, para poder ser testada.
 *
 * Todos os cards têm a altura do time com mais jogadores: os cards de uma
 * mesma linha ficam alinhados e nenhum nome é cortado na vertical. A última
 * linha, quando incompleta, fica centralizada. */
export function computeTeamsImageLayout(teamCount: number, maxPlayers: number): TeamsImageLayout {
  const L = TEAMS_IMAGE;
  const columns = teamsImageColumns(teamCount);
  const rows = Math.max(Math.ceil(teamCount / columns), 1);

  const gridWidth = columns * L.cardWidth + (columns - 1) * L.gap;
  const width = Math.max(L.minWidth, gridWidth + 2 * L.padding);
  const cardHeight = L.cardHeaderHeight + 2 * L.cardPaddingY + Math.max(maxPlayers, 1) * L.rowHeight;
  const gridHeight = rows * cardHeight + (rows - 1) * L.gap;
  const height = L.padding + L.titleHeight + gridHeight + L.footerHeight + L.padding;

  const cards = Array.from({ length: teamCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const inThisRow = Math.min(columns, teamCount - row * columns);
    const rowWidth = inThisRow * L.cardWidth + (inThisRow - 1) * L.gap;
    const startX = (width - rowWidth) / 2;
    return {
      x: startX + col * (L.cardWidth + L.gap),
      y: L.padding + L.titleHeight + row * (cardHeight + L.gap),
    };
  });

  return { columns, rows, width, height, cardWidth: L.cardWidth, cardHeight, cards };
}

const OUTCOME_LABELS: Record<TeamResultOutcome, string> = {
  win: "Vitória",
  draw: "Empate",
  loss: "Derrota",
};

/** Linha de resumo do card: quantidade, formação e, se lançado, o resultado.
 * As estrelas ficam de fora de propósito — a imagem vai para o grupo, e o
 * nível de cada um é informação do organizador. */
function teamSummary(team: Team): string {
  const count = team.team_players.length;
  const parts = [`${count} ${count === 1 ? "jogador" : "jogadores"}`];
  if (team.formation) parts.push(team.formation);
  if (team.result) {
    const goals = team.result.goals_scored;
    parts.push(`${OUTCOME_LABELS[team.result.result]}${goals != null ? ` · ${goals}` : ""}`);
  }
  return parts.join(" · ");
}

/** Corta o texto com reticências até caber em `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayerRow(
  ctx: CanvasRenderingContext2D,
  teamPlayer: TeamPlayer,
  index: number,
  accent: string,
  x: number,
  y: number,
  width: number,
) {
  const L = TEAMS_IMAGE;
  const centerY = y + L.rowHeight / 2;
  const left = x + 28;
  const right = x + width - 28;

  // Número do jogador num círculo tingido com a cor do time.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(left + 18, centerY, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 20px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(String(index + 1), left + 18, centerY + 1);

  let nameRight = right;

  // Convidado: o mesmo destaque vermelho da tela, do campo e da mensagem.
  if (teamPlayer.player_type === "convidado") {
    const label = "CONVIDADO";
    ctx.font = `800 17px ${FONT}`;
    const pillWidth = ctx.measureText(label).width + 24;
    const pillX = right - pillWidth;
    ctx.fillStyle = COLORS.danger;
    roundedRect(ctx, pillX, centerY - 15, pillWidth, 30, 15);
    ctx.fill();
    ctx.fillStyle = COLORS.primaryContrast;
    ctx.textAlign = "center";
    ctx.fillText(label, pillX + pillWidth / 2, centerY + 1);
    nameRight = pillX - 12;
  }

  ctx.font = `600 31px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  const nameLeft = left + 52;
  ctx.fillText(fitText(ctx, getPlayerDisplayName(teamPlayer), nameRight - nameLeft), nameLeft, centerY + 1);
}

function drawTeamCard(
  ctx: CanvasRenderingContext2D,
  team: Team,
  teamIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const L = TEAMS_IMAGE;
  const accent = TEAM_PALETTE[teamIndex % TEAM_PALETTE.length];

  // Card com sombra leve.
  ctx.save();
  ctx.shadowColor = COLORS.border;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = COLORS.surface;
  roundedRect(ctx, x, y, width, height, L.radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, x, y, width, height, L.radius);
  ctx.clip();

  // Cabeçalho tingido + faixa de identidade, como no card da tela.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, width, L.cardHeaderHeight);
  ctx.restore();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, width, 12);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  // Marcador de identidade: a "bolinha" do emoji, na cor do time.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x + 28 + 16, y + 56, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 38px ${FONT}`;
  ctx.fillText(`TIME ${teamIndex + 1}`, x + 28 + 44, y + 57);

  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(fitText(ctx, teamSummary(team), width - 56), x + 28, y + 98);

  const listTop = y + L.cardHeaderHeight + L.cardPaddingY;
  team.team_players.forEach((teamPlayer, index) => {
    const rowY = listTop + index * L.rowHeight;
    if (index > 0) {
      ctx.fillStyle = COLORS.border;
      ctx.fillRect(x + 28, rowY, width - 56, 1);
    }
    drawPlayerRow(ctx, teamPlayer, index, accent, x, rowY, width);
  });

  if (team.team_players.length === 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 26px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("Nenhum jogador", x + 28, listTop + L.rowHeight / 2);
  }

  ctx.restore();
}

async function waitForFonts() {
  try {
    await Promise.all([
      document.fonts.load(`800 38px ${FONT}`),
      document.fonts.load(`600 31px ${FONT}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Sem a Inter, o canvas cai na fonte do sistema — a imagem sai mesmo assim.
  }
}

/** Desenha a imagem com todos os times e devolve o PNG. `subtitle` vai abaixo
 * do título (a data do sorteio, por exemplo). */
export async function renderTeamsImage(teams: Team[], subtitle?: string): Promise<Blob | null> {
  const L = TEAMS_IMAGE;
  const maxPlayers = Math.max(0, ...teams.map((team) => team.team_players.length));
  const layout = computeTeamsImageLayout(teams.length, maxPlayers);

  await waitForFonts();

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // Título
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText("SORTEIO DOS TIMES", layout.width / 2, L.padding + 36);
  ctx.fillStyle = COLORS.primary;
  roundedRect(ctx, layout.width / 2 - 60, L.padding + 78, 120, 6, 3);
  ctx.fill();
  if (subtitle) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(subtitle, layout.width / 2, L.padding + 116);
  }

  teams.forEach((team, index) => {
    const { x, y } = layout.cards[index];
    drawTeamCard(ctx, team, index, x, y, layout.cardWidth, layout.cardHeight);
  });

  // Rodapé
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.muted;
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText("Boa partida!", layout.width / 2, layout.height - L.padding - L.footerHeight / 2 + 12);

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}
