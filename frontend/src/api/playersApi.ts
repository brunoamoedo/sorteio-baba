import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type {
  BulkResult,
  LinkableUser,
  LoginStatusRow,
  Player,
  Position,
} from "../core/types/player";

export interface PlayerFilters {
  status?: string;
  player_type?: string;
  primary_position?: number;
  search?: string;
}

export const playersApi = {
  // -- Geração de acesso ------------------------------------------------------
  //
  // A senha inicial **não** trafega: é uma constante conhecida dos dois lados,
  // e o servidor nunca devolve senha em resposta nenhuma.

  loginStatus: async (): Promise<LoginStatusRow[]> => {
    const { data } = await apiClient.get<LoginStatusRow[]>("/players/login-status/");
    return data;
  },
  /** Sem `playerIds`, gera para **todos** os mensalistas sem login. */
  generateLogins: async (playerIds?: number[]): Promise<BulkResult> => {
    const { data } = await apiClient.post<BulkResult>("/players/generate-logins/", {
      ...(playerIds?.length ? { player_ids: playerIds } : {}),
    });
    return data;
  },
  resetPassword: async (playerId: number): Promise<{ username: string }> => {
    const { data } = await apiClient.post(`/players/${playerId}/reset-password/`, {});
    return data;
  },

  list: (filters: PlayerFilters = {}): Promise<Player[]> =>
    fetchAllPages<Player>(apiClient, "/players/", filters),
  create: async (payload: FormData): Promise<Player> => {
    const { data } = await apiClient.post<Player>("/players/", payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  update: async (id: number, payload: FormData): Promise<Player> => {
    const { data } = await apiClient.patch<Player>(`/players/${id}/`, payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/players/${id}/`);
  },
  /** Membros da organização, para vincular um login a uma ficha. */
  linkableUsers: async (): Promise<LinkableUser[]> => {
    const { data } = await apiClient.get<LinkableUser[]>("/players/linkable-users/");
    return data;
  },
  /** Ação em lote. `delete` é soft-delete — o histórico de sorteios é preservado. */
  bulk: async (ids: number[], action: BulkPlayerAction): Promise<{ updated: number }> => {
    const { data } = await apiClient.post("/players/bulk/", { ids, action });
    return data;
  },
};

export type BulkPlayerAction = "ativo" | "inativo" | "delete";

export const positionsApi = {
  list: (): Promise<Position[]> =>
    fetchAllPages<Position>(apiClient, "/positions/", { is_active: true }),
};
