import { TEAM_COLORS, type ThemeMode } from "../../shared/theme/tokens";
import type { Team, TeamPlayer } from "../../core/types/draw";

/** Emoji de identidade de cada time.
 *
 * **Continua sendo emoji de propósito**: ele vai na mensagem colada no
 * WhatsApp, que não tem os ícones do sistema, e é assim que o jogador
 * reconhece o time dele no grupo. É conteúdo, não decoração de interface. */
const TEAM_EMOJIS = ["🔵", "🔴", "🟠", "🟢", "🟣", "🟡", "⚫", "⚪", "🟤"];

export function getTeamEmoji(teamIndex: number): string {
  return TEAM_EMOJIS[teamIndex % TEAM_EMOJIS.length];
}

/** Cor de destaque de cada time, na mesma ordem (e no mesmo sentido) dos
 * emojis acima — o card do time e a bolinha do emoji contam a mesma história.
 *
 * Os tons vêm dos tokens do tema, com variante por modo: vários dos originais
 * sumiam sobre o fundo escuro. */
export function getTeamColor(teamIndex: number, mode: ThemeMode = "light"): string {
  const palette = TEAM_COLORS[mode];
  return palette[teamIndex % palette.length];
}

export function getTeamLabel(teamIndex: number): string {
  return `Time ${teamIndex + 1} ${getTeamEmoji(teamIndex)}`;
}

export function getPlayerDisplayName(teamPlayer: TeamPlayer): string {
  return teamPlayer.player_nickname || teamPlayer.player_name;
}

/** Convidado é identificado em todo lugar em que o jogador aparece — tela,
 * campo em SVG, PNG exportado, impressão e a mensagem do grupo.
 *
 * A posição entra entre parênteses: quem lê no grupo precisa saber onde vai
 * jogar, e antes a mensagem trazia só o nome. */
function shareLine(teamPlayer: TeamPlayer): string {
  const suffix = teamPlayer.player_type === "convidado" ? " _(convidado)_" : "";
  const position = teamPlayer.position_snapshot?.code;
  return `👤 ${getPlayerDisplayName(teamPlayer)}${position ? ` (${position})` : ""}${suffix}`;
}

const OUTCOME_TEXT: Record<string, string> = {
  win: "🏆 Vitória",
  draw: "🤝 Empate",
  loss: "❌ Derrota",
};

/** Linha de placar da mensagem. Com 2 times sai no formato clássico
 * "Time 1 2 x 1 Time 2"; com 3 ou mais (onde não existe um placar único),
 * lista o resultado de cada time. Retorna vazio se nada foi lançado. */
function formatScoreLine(teams: Team[]): string {
  const withResult = teams.filter((team) => team.result);
  if (withResult.length === 0) return "";

  const everyGoalKnown = teams.every((team) => team.result?.goals_scored != null);

  if (teams.length === 2 && everyGoalKnown) {
    const [first, second] = teams;
    return `🏆 ${getTeamLabel(0)} ${first.result?.goals_scored} x ${second.result?.goals_scored} ${getTeamLabel(1)} 🏆`;
  }

  return teams
    .map((team, index) => {
      const outcome = team.result ? OUTCOME_TEXT[team.result.result] : "—";
      const goals = team.result?.goals_scored;
      return `${getTeamLabel(index)}: ${outcome}${goals != null ? ` (${goals} gols)` : ""}`;
    })
    .join("\n");
}

/** Mensagem pronta para colar no WhatsApp. Os jogadores saem na mesma ordem em
 * que o algoritmo os atribuiu ao time — sem reordenar por estrelas ou nome.
 *
 * A **formação** de cada time acompanha o cabeçalho quando existe: é a
 * informação que faltava para o grupo entender o desenho, e ela muda de time
 * para time. */
export function formatDrawResultMessage(teams: Team[]): string {
  const sections = teams.map((team, index) => {
    const players = team.team_players.map(shareLine).join("\n");
    const formation = team.formation ? ` — ${team.formation}` : "";
    return `🏆 ${getTeamLabel(index)}${formation}:\n${players}`;
  });

  const score = formatScoreLine(teams);

  return [
    "⚽🔥 SORTEIO DOS TIMES 🔥⚽",
    "",
    sections.join("\n\n🆚\n\n"),
    "",
    "⚽ Boa partida! 🔥",
    ...(score ? ["", "Placar:", score] : []),
  ].join("\n");
}
