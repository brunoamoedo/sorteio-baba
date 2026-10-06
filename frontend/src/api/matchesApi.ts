import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type {
  ConfirmAsGuestResult,
  ConfirmedList,
  Match,
  MyMatch,
  QuickConfirmResolution,
  RosterEntry,
  SetConfirmationResult,
  WaitlistEntry,
} from "../core/types/match";
import type { Team } from "../core/types/draw";

/** Partida avulsa/manual.
 *
 * A capacidade pode ser enviada de duas formas, ambas aceitas pelo backend:
 * pela faixa por time (`*_per_team_line`, convertida com a mesma regra dos
 * jogos recorrentes) ou pelos totais absolutos — usados ao editar uma partida
 * sem mexer na configuração, para o valor original ser preservado sem
 * arredondamento. */
export interface MatchWritePayload {
  name: string;
  location: string;
  notes: string;
  scheduled_date: string;
  scheduled_time: string;
  draw_time: string | null;
  teams_count: number;
  goalkeepers_per_team: number;
  min_players_per_team_line?: number;
  max_players_per_team_line?: number;
  min_players?: number;
  max_players?: number;
}

export const matchesApi = {
  /** Quem confirmou presença — acessível a qualquer participante, inclusive
   * o jogador. Traz nomes, não fichas. */
  confirmed: async (matchId: number): Promise<ConfirmedList> => {
    const { data } = await apiClient.get<ConfirmedList>(`/matches/${matchId}/confirmed/`);
    return data;
  },

  list: (): Promise<Match[]> => fetchAllPages<Match>(apiClient, "/matches/"),
  retrieve: async (id: number): Promise<Match> => {
    const { data } = await apiClient.get<Match>(`/matches/${id}/`);
    return data;
  },
  create: async (payload: MatchWritePayload): Promise<Match> => {
    const { data } = await apiClient.post<Match>("/matches/", payload);
    return data;
  },
  update: async (id: number, payload: MatchWritePayload): Promise<Match> => {
    const { data } = await apiClient.patch<Match>(`/matches/${id}/`, payload);
    return data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/matches/${id}/`);
  },
  /** Auto-serviço: as partidas de quem está logado, com a própria presença. */
  mine: async (): Promise<MyMatch[]> => {
    const { data } = await apiClient.get<MyMatch[]>("/matches/mine/");
    return data;
  },
  /** Confirma/cancela a **própria** presença. Não existe parâmetro de jogador:
   * o servidor resolve pelo login e ignora qualquer id enviado. */
  confirmMe: async (
    matchId: number,
    status: "confirmed" | "declined",
  ): Promise<{ status: string; waitlisted: boolean; waitlist_position: number | null }> => {
    const { data } = await apiClient.post(`/matches/${matchId}/confirm-me/`, { status });
    return data;
  },
  cancel: async (id: number): Promise<Match> => {
    const { data } = await apiClient.post<Match>(`/matches/${id}/cancel/`);
    return data;
  },
  reactivate: async (id: number): Promise<Match> => {
    const { data } = await apiClient.post<Match>(`/matches/${id}/reactivate/`);
    return data;
  },
  roster: async (id: number): Promise<RosterEntry[]> => {
    const { data } = await apiClient.get<RosterEntry[]>(`/matches/${id}/roster/`);
    return data;
  },
  setConfirmation: async (
    matchId: number,
    playerId: number,
    status: "confirmed" | "declined",
  ): Promise<SetConfirmationResult> => {
    const { data } = await apiClient.post<SetConfirmationResult>(
      `/matches/${matchId}/set-confirmation/`,
      { player: playerId, status },
    );
    return data;
  },
  /** Aplica o mesmo status de presença a todos os jogadores ativos de uma vez,
   * respeitando a capacidade da partida (o excedente entra na fila). */
  setAllConfirmations: async (
    matchId: number,
    status: "confirmed" | "declined",
  ): Promise<{ confirmed: number; waitlisted: number; declined: number; updated: number }> => {
    const { data } = await apiClient.post(`/matches/${matchId}/set-all-confirmations/`, { status });
    return data;
  },
  /** Só os gols são enviados — vitória/empate/derrota são derivados no servidor. */
  setResults: async (
    matchId: number,
    results: { team_id: number; goals_scored: number }[],
  ): Promise<Team[]> => {
    const { data } = await apiClient.post<Team[]>(`/matches/${matchId}/set-results/`, { results });
    return data;
  },
  /**
   * `pastedList: false` diz que é **um nome digitado**, não uma lista colada.
   * Fora de uma colagem não existe recolagem para proteger, então só um nome
   * praticamente igual ao de alguém já confirmado conta como repetição — sem
   * isso, "Deyvid" era engolido por "Leonardo David" já confirmado (0.73) e
   * não entrava na partida.
   */
  quickConfirm: async (
    matchId: number,
    names: string[],
    { pastedList = true }: { pastedList?: boolean } = {},
  ): Promise<QuickConfirmResolution[]> => {
    const { data } = await apiClient.post<QuickConfirmResolution[]>(
      `/matches/${matchId}/quick-confirm/`,
      { names, pasted_list: pastedList },
    );
    return data;
  },
  reassignConfirmation: async (
    matchId: number,
    wrongPlayerId: number,
    correctPlayerId: number,
  ): Promise<{ player_id: number; player_name: string; status: string }> => {
    const { data } = await apiClient.post(`/matches/${matchId}/reassign-confirmation/`, {
      wrong_player: wrongPlayerId,
      correct_player: correctPlayerId,
    });
    return data;
  },
  /**
   * O contrário de `reassignConfirmation`: a lista reconheceu um mensalista,
   * mas a linha era um convidado. O mensalista sai e entra um convidado com
   * `name` — reaproveitado se já existir um com esse nome exato.
   */
  confirmAsGuest: async (
    matchId: number,
    wrongPlayerId: number,
    name: string,
  ): Promise<ConfirmAsGuestResult> => {
    const { data } = await apiClient.post<ConfirmAsGuestResult>(
      `/matches/${matchId}/confirm-as-guest/`,
      { wrong_player: wrongPlayerId, name },
    );
    return data;
  },
};

export const waitlistApi = {
  list: async (matchId: number): Promise<WaitlistEntry[]> => {
    const { data } = await apiClient.get<WaitlistEntry[]>(`/matches/${matchId}/waitlist/`);
    return data;
  },
  promote: async (matchId: number, playerId: number): Promise<WaitlistEntry[]> => {
    const { data } = await apiClient.post<WaitlistEntry[]>(
      `/matches/${matchId}/waitlist/promote/`,
      { player: playerId },
    );
    return data;
  },
  move: async (matchId: number, playerId: number, position: number): Promise<WaitlistEntry[]> => {
    const { data } = await apiClient.post<WaitlistEntry[]>(`/matches/${matchId}/waitlist/move/`, {
      player: playerId,
      position,
    });
    return data;
  },
  remove: async (matchId: number, playerId: number): Promise<WaitlistEntry[]> => {
    const { data } = await apiClient.post<WaitlistEntry[]>(`/matches/${matchId}/waitlist/remove/`, {
      player: playerId,
    });
    return data;
  },
};
