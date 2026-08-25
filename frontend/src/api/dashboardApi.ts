import { apiClient } from "./client";
import type { DashboardSummary } from "../core/types/match";

export const dashboardApi = {
  summary: async (): Promise<DashboardSummary> => {
    const { data } = await apiClient.get<DashboardSummary>("/dashboard/summary/");
    return data;
  },
};
