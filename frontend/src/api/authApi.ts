import { apiClient } from "./client";
import type { AuthTokens, User } from "../core/types/user";

export interface LoginPayload {
  username: string;
  password: string;
}

export const authApi = {
  login: async (payload: LoginPayload): Promise<AuthTokens> => {
    const { data } = await apiClient.post<AuthTokens>("/auth/token/", payload);
    return data;
  },
  me: async (): Promise<User> => {
    const { data } = await apiClient.get<User>("/auth/me/");
    return data;
  },
  /** Troca da própria senha — e a saída do primeiro acesso. */
  changePassword: async (payload: {
    current_password: string;
    new_password: string;
  }): Promise<{ detail: string; first_access: boolean }> => {
    const { data } = await apiClient.post("/auth/change-password/", payload);
    return data;
  },
};
