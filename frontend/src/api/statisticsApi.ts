import { apiClient } from "./client";
import type { PlayerStatistics } from "../core/types/statistics";

export const statisticsApi = {
  players: async (): Promise<PlayerStatistics[]> => {
    const { data } = await apiClient.get<PlayerStatistics[]>("/statistics/players/");
    return data;
  },
};
