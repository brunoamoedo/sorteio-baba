import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type { Draw, Team, TeamPlayer } from "../core/types/draw";

/** Opções do sorteio. Tudo opcional — sem nada, o sorteio é exatamente o de
 * antes de a formação existir. */
export interface DrawOptions {
  formation?: string;
  /** Formação por time, indexada pela **ordem** do time (0, 1, 2…). */
  formations_by_team?: Record<number, string>;
}

export const drawsApi = {
  trigger: async (matchId: number, options: DrawOptions = {}): Promise<Draw> => {
    const { data } = await apiClient.post<Draw>(`/matches/${matchId}/draw/`, options);
    return data;
  },
  currentForMatch: async (matchId: number): Promise<Draw | null> => {
    const draws = await fetchAllPages<Draw>(apiClient, "/draws/", {
      match: matchId,
      is_current: true,
    });
    return draws[0] ?? null;
  },
  listForMatch: (matchId: number): Promise<Draw[]> =>
    fetchAllPages<Draw>(apiClient, "/draws/", { match: matchId }),

  /** Move um jogador entre times do mesmo sorteio. `reason` vai para o campo
   * homônimo da auditoria — é o que distingue, na trilha, um ajuste manual do
   * organizador de qualquer outra origem. */
  movePlayer: async (
    drawId: number,
    teamPlayerId: number,
    targetTeamId: number,
    reason = "",
  ): Promise<void> => {
    await apiClient.post(`/draws/${drawId}/move-player/`, {
      team_player_id: teamPlayerId,
      target_team_id: targetTeamId,
      reason,
    });
  },

  /** Altera a posição (e/ou a vaga no desenho) de um jogador **dentro do time
   * dele**. Operação que não existia: a única edição pós-sorteio era mover
   * entre times. */
  setPlayerPosition: async (
    drawId: number,
    params: {
      teamPlayerId: number;
      positionId?: number | null;
      lineIndex?: number | null;
      slotIndex?: number | null;
      reason?: string;
    },
  ): Promise<TeamPlayer> => {
    const { data } = await apiClient.post<TeamPlayer>(`/draws/${drawId}/set-position/`, {
      team_player_id: params.teamPlayerId,
      position_id: params.positionId ?? null,
      line_index: params.lineIndex ?? null,
      slot_index: params.slotIndex ?? null,
      reason: params.reason ?? "",
    });
    return data;
  },

  /** Troca dois jogadores de lugar — **uma** chamada, uma transação no
   * servidor. Como duas chamadas de "mover", uma falha no meio deixaria os
   * times inconsistentes e a auditoria registraria meia troca. */
  swapPlayers: async (
    drawId: number,
    teamPlayerA: number,
    teamPlayerB: number,
    reason = "",
  ): Promise<TeamPlayer[]> => {
    const { data } = await apiClient.post<TeamPlayer[]>(`/draws/${drawId}/swap-players/`, {
      team_player_a: teamPlayerA,
      team_player_b: teamPlayerB,
      reason,
    });
    return data;
  },

  /** Troca a formação de um time depois do sorteio, reencaixando quem já está
   * nele. Não sorteia de novo e não move ninguém entre times. */
  setTeamFormation: async (
    drawId: number,
    teamId: number,
    formation: string,
    reason = "",
  ): Promise<Team> => {
    const { data } = await apiClient.post<Team>(`/draws/${drawId}/set-formation/`, {
      team_id: teamId,
      formation,
      reason,
    });
    return data;
  },
};
