import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type { Match, RecurringGame } from "../core/types/match";

export interface RecurringGameWritePayload {
  name: string;
  weekday: number;
  match_time: string;
  draw_time: string;
  teams_count: number;
  min_players_per_team_line: number;
  max_players_per_team_line: number;
  days_before_to_generate: number;
  is_active: boolean;
}

export const recurringGamesApi = {
  list: (): Promise<RecurringGame[]> => fetchAllPages<RecurringGame>(apiClient, "/recurring-games/"),
  create: async (payload: RecurringGameWritePayload): Promise<RecurringGame> => {
    const { data } = await apiClient.post<RecurringGame>("/recurring-games/", payload);
    return data;
  },
  update: async (id: number, payload: RecurringGameWritePayload): Promise<RecurringGame> => {
    const { data } = await apiClient.patch<RecurringGame>(`/recurring-games/${id}/`, payload);
    return data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/recurring-games/${id}/`);
  },
  /** Gera a próxima partida sob demanda — para quando a ocorrência foi removida
   * ou ainda está fora da janela de antecedência configurada. */
  generateMatch: async (id: number): Promise<Match> => {
    const { data } = await apiClient.post<Match>(`/recurring-games/${id}/generate-match/`);
    return data;
  },
};
