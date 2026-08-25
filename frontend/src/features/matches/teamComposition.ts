/**
 * Composição dos times **depois** do sorteio: mover um jogador de um time para
 * outro, medir o equilíbrio resultante e descrever a alteração.
 *
 * Tudo aqui é cálculo puro sobre os dados do sorteio (sem DOM, sem React, sem
 * rede) por dois motivos: é o mesmo cálculo que alimenta o campo em SVG, os
 * indicadores, as observações e o texto do WhatsApp — então não pode viver
 * dentro de um componente — e é o que torna a regra testável sem montar tela.
 *
 * Uma movimentação manual **nunca** roda o algoritmo de sorteio de novo: ela só
 * reescreve a composição atual. O `Draw` continua sendo o mesmo, com os scores
 * da execução original.
 */

import { parseFormation } from "../../core/formations";
import type { Team, TeamPlayer } from "../../core/types/draw";
import { getPlayerDisplayName, getTeamLabel } from "./shareFormat";

/** O que aconteceu numa alteração manual. Três formas, porque três operações
 * diferentes precisam de descrições diferentes na tela e na auditoria. */
export type ManualMoveKind = "move" | "position" | "swap";

export interface ManualMove {
  /** Identidade da observação na tela — não é o id do jogador (o mesmo jogador
   * pode ser movido várias vezes). */
  id: string;
  kind: ManualMoveKind;
  teamPlayerId: number;
  playerId: number;
  playerName: string;
  fromTeamId: number;
  fromTeamLabel: string;
  toTeamId: number;
  toTeamLabel: string;
  /** Posição de origem e destino — presentes quando a alteração as envolve. */
  fromPosition?: string;
  toPosition?: string;
  /** O outro jogador, quando a operação é uma troca. */
  otherPlayerName?: string;
}

export interface MoveResult {
  teams: Team[];
  move: ManualMove;
}

export interface TeamMetrics {
  playerCount: number;
  totalSkill: number;
  /** Média de estrelas por jogador. `0` para time vazio. */
  averageSkill: number;
}

export function computeTeamMetrics(team: Team): TeamMetrics {
  const playerCount = team.team_players.length;
  const totalSkill = team.team_players.reduce((sum, player) => sum + player.skill_snapshot, 0);
  return {
    playerCount,
    totalSkill,
    averageSkill: playerCount === 0 ? 0 : totalSkill / playerCount,
  };
}

/** Média com uma casa decimal, no formato brasileiro ("3,2"). */
export function formatAverage(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function findTeamPlayer(teams: Team[], teamPlayerId: number): { team: Team; index: number } | null {
  for (const team of teams) {
    const index = team.team_players.findIndex((player) => player.id === teamPlayerId);
    if (index >= 0) return { team, index };
  }
  return null;
}

/**
 * Move um jogador para outro time e devolve a **nova** composição (os times
 * originais não são alterados — o resultado substitui o estado, em vez de
 * mutá-lo no lugar).
 *
 * Devolve `null` quando não há o que fazer: jogador desconhecido, time de
 * destino inexistente ou soltar o jogador no time em que ele já estava. Quem
 * chama usa isso para não gravar observação nem chamar a API à toa.
 *
 * O objeto do jogador é reaproveitado como está, e não recriado: nome, apelido,
 * id, nível, posição e tipo (mensalista/convidado) acompanham a mudança de time
 * por construção. A posição dele **dentro do campo** não é guardada aqui — o
 * campo recalcula o desenho a partir da composição (`computeFieldLayout`), então
 * o jogador entra na linha da posição dele no time novo, sem sobreposição.
 */
export function applyPlayerMove(
  teams: Team[],
  teamPlayerId: number,
  targetTeamId: number,
  /** Identidade da observação. O padrão descreve a movimentação; quem registra
   * uma lista (a tela) passa um id sequencial, porque mover o mesmo jogador de
   * ida e volta produziria observações diferentes com a mesma descrição. */
  moveId?: string,
): MoveResult | null {
  const found = findTeamPlayer(teams, teamPlayerId);
  if (!found) return null;

  const sourceIndex = teams.indexOf(found.team);
  const targetIndex = teams.findIndex((team) => team.id === targetTeamId);
  if (targetIndex < 0 || targetIndex === sourceIndex) return null;

  const teamPlayer: TeamPlayer = found.team.team_players[found.index];

  const nextTeams = teams.map((team, index) => {
    if (index === sourceIndex) {
      return {
        ...team,
        team_players: team.team_players.filter((player) => player.id !== teamPlayerId),
      };
    }
    if (index === targetIndex) {
      return { ...team, team_players: [...team.team_players, teamPlayer] };
    }
    return team;
  });

  return {
    teams: nextTeams,
    move: {
      id: moveId ?? `${teamPlayerId}-${sourceIndex}-${targetIndex}`,
      kind: "move",
      teamPlayerId,
      playerId: teamPlayer.player_id,
      playerName: getPlayerDisplayName(teamPlayer),
      fromTeamId: found.team.id,
      fromTeamLabel: getTeamLabel(sourceIndex),
      toTeamId: teams[targetIndex].id,
      toTeamLabel: getTeamLabel(targetIndex),
    },
  };
}

/**
 * Altera a posição de um jogador **dentro do time dele**.
 *
 * Devolve a nova composição e a descrição da alteração, ou `null` quando não há
 * o que fazer (jogador desconhecido, ou a posição pedida é a que ele já tem).
 *
 * A vaga no desenho (`line_index`/`slot_index`) é limpa: quem muda de posição
 * perde a vaga antiga, e o servidor devolve a nova composição com a vaga certa
 * na revalidação. Enquanto isso o campo o desenha na linha da posição nova.
 */
export function applyPositionChange(
  teams: Team[],
  teamPlayerId: number,
  position: { id: number; code: string; name: string; sort_order: number; is_active: boolean },
  moveId?: string,
): MoveResult | null {
  const found = findTeamPlayer(teams, teamPlayerId);
  if (!found) return null;

  const teamPlayer = found.team.team_players[found.index];
  if (teamPlayer.position_snapshot?.id === position.id) return null;

  const teamIndex = teams.indexOf(found.team);
  const updated: TeamPlayer = {
    ...teamPlayer,
    position_snapshot: position,
    line_index: null,
    slot_index: null,
  };

  const nextTeams = teams.map((team, index) =>
    index === teamIndex
      ? {
          ...team,
          team_players: team.team_players.map((player) =>
            player.id === teamPlayerId ? updated : player,
          ),
        }
      : team,
  );

  return {
    teams: nextTeams,
    move: {
      id: moveId ?? `pos-${teamPlayerId}-${position.id}`,
      kind: "position",
      teamPlayerId,
      playerId: teamPlayer.player_id,
      playerName: getPlayerDisplayName(teamPlayer),
      fromTeamId: found.team.id,
      fromTeamLabel: getTeamLabel(teamIndex),
      toTeamId: found.team.id,
      toTeamLabel: getTeamLabel(teamIndex),
      fromPosition: teamPlayer.position_snapshot?.code ?? "—",
      toPosition: position.code,
    },
  };
}

/**
 * Troca dois jogadores de lugar: time, posição e vaga.
 *
 * Ao contrário de mover, **preserva o tamanho dos times** — é a operação certa
 * quando o time de destino já está completo.
 *
 * Devolve `null` se algum dos dois não for encontrado ou se forem o mesmo.
 */
export function applySwap(
  teams: Team[],
  teamPlayerAId: number,
  teamPlayerBId: number,
  moveId?: string,
): MoveResult | null {
  if (teamPlayerAId === teamPlayerBId) return null;

  const foundA = findTeamPlayer(teams, teamPlayerAId);
  const foundB = findTeamPlayer(teams, teamPlayerBId);
  if (!foundA || !foundB) return null;

  const playerA = foundA.team.team_players[foundA.index];
  const playerB = foundB.team.team_players[foundB.index];
  const indexA = teams.indexOf(foundA.team);
  const indexB = teams.indexOf(foundB.team);

  // Cada um assume exatamente o lugar do outro no desenho.
  const newA: TeamPlayer = {
    ...playerA,
    position_snapshot: playerB.position_snapshot,
    line_index: playerB.line_index,
    slot_index: playerB.slot_index,
  };
  const newB: TeamPlayer = {
    ...playerB,
    position_snapshot: playerA.position_snapshot,
    line_index: playerA.line_index,
    slot_index: playerA.slot_index,
  };

  const nextTeams = teams.map((team, index) => {
    if (index !== indexA && index !== indexB) return team;

    const players = team.team_players
      .filter((player) => player.id !== teamPlayerAId && player.id !== teamPlayerBId)
      .slice();

    // Mesmo time: os dois voltam para cá. Times diferentes: cada um recebe o
    // que veio do outro.
    if (indexA === indexB) {
      players.push(newA, newB);
    } else if (index === indexA) {
      players.push(newB);
    } else {
      players.push(newA);
    }

    return { ...team, team_players: players };
  });

  return {
    teams: nextTeams,
    move: {
      id: moveId ?? `swap-${teamPlayerAId}-${teamPlayerBId}`,
      kind: "swap",
      teamPlayerId: teamPlayerAId,
      playerId: playerA.player_id,
      playerName: getPlayerDisplayName(playerA),
      otherPlayerName: getPlayerDisplayName(playerB),
      fromTeamId: foundA.team.id,
      fromTeamLabel: getTeamLabel(indexA),
      toTeamId: foundB.team.id,
      toTeamLabel: getTeamLabel(indexB),
      fromPosition: playerA.position_snapshot?.code,
      toPosition: playerB.position_snapshot?.code,
    },
  };
}

export function describeManualMove(move: ManualMove): string {
  if (move.kind === "position") {
    return `${move.playerName} passou de ${move.fromPosition} para ${move.toPosition} no ${move.fromTeamLabel}.`;
  }
  if (move.kind === "swap") {
    const mesmoTime = move.fromTeamId === move.toTeamId;
    return mesmoTime
      ? `${move.playerName} e ${move.otherPlayerName} trocaram de posição no ${move.fromTeamLabel}.`
      : `${move.playerName} e ${move.otherPlayerName} trocaram de time (${move.fromTeamLabel} ↔ ${move.toTeamLabel}).`;
  }
  return `${move.playerName} foi movido manualmente do ${move.fromTeamLabel} para o ${move.toTeamLabel}.`;
}

/** Soma de estrelas de cada time, na ordem em que aparecem na tela. */
export function teamSkillTotals(teams: Team[]): number[] {
  return teams.map((team) => computeTeamMetrics(team).totalSkill);
}

/** Distância entre o time mais forte e o mais fraco, em estrelas. É a medida
 * que o organizador enxerga ("um time tem 7 estrelas a mais que o outro"). */
export function skillSpread(totals: number[]): number {
  if (totals.length === 0) return 0;
  return Math.max(...totals) - Math.min(...totals);
}

export interface WeakestSplitReport {
  /** Nível dos jogadores mais fracos em campo. */
  weakestLevel: number;
  /** Quantos jogadores desse nível existem no sorteio. */
  weakestCount: number;
  /** Maior quantidade deles em um mesmo time. */
  maxInSameTeam: number;
  /** Maior quantidade **aceitável** por time: 1 quando dá para dar um a cada
   * time, senão a divisão mais equilibrada possível. */
  allowedPerTeam: number;
  /** A regra dos piores continua respeitada na composição atual. */
  satisfied: boolean;
}

export interface FormationReport {
  formation: string;
  /** Quantos jogadores o desenho comporta. */
  slots: number;
  /** Quantos estão de fato no time (fora o goleiro). */
  linePlayers: number;
  /** Jogadores sem vaga fixa — excedentes ou movidos para um time cheio. */
  unplaced: number;
  /** A composição atual ainda cabe na formação. */
  satisfied: boolean;
}

/**
 * Confere a formação **na composição que está na tela**.
 *
 * O sorteio nasce respeitando o desenho escolhido, mas o organizador pode
 * quebrá-lo movendo alguém para um time já completo. O sistema não desfaz a
 * decisão dele — apenas diz, com números, o que aconteceu.
 *
 * Devolve `null` quando o time não tem formação (aí não há o que conferir).
 */
export function formationReport(team: Team): FormationReport | null {
  if (!team.formation) return null;

  const lines = parseFormation(team.formation);
  if (!lines) return null;

  const slots = lines.reduce((sum, size) => sum + size, 0);
  const isGoalkeeper = (player: TeamPlayer) =>
    player.position_snapshot?.code?.toUpperCase() === "GOL";

  const linePlayers = team.team_players.filter((player) => !isGoalkeeper(player));
  const unplaced = linePlayers.filter((player) => player.line_index === null).length;

  return {
    formation: team.formation,
    slots,
    linePlayers: linePlayers.length,
    unplaced,
    satisfied: unplaced === 0 && linePlayers.length <= slots,
  };
}

/**
 * Confere a regra dos piores **na composição que está na tela**.
 *
 * O sorteio já nasce respeitando a regra (é uma restrição do algoritmo), mas o
 * organizador pode desfazê-la ao arrastar um jogador — e nesse caso o sistema
 * não desfaz a alteração dele: apenas avisa, junto dos demais indicadores.
 */
export function weakestSplitReport(teams: Team[]): WeakestSplitReport | null {
  const players = teams.flatMap((team) => team.team_players);
  if (players.length === 0 || teams.length < 2) return null;

  const weakestLevel = Math.min(...players.map((player) => player.skill_snapshot));
  const perTeam = teams.map(
    (team) => team.team_players.filter((player) => player.skill_snapshot === weakestLevel).length,
  );
  const weakestCount = perTeam.reduce((sum, count) => sum + count, 0);
  const maxInSameTeam = Math.max(...perTeam);
  const allowedPerTeam = Math.max(1, Math.ceil(weakestCount / teams.length));

  return {
    weakestLevel,
    weakestCount,
    maxInSameTeam,
    allowedPerTeam,
    satisfied: maxInSameTeam <= allowedPerTeam,
  };
}
