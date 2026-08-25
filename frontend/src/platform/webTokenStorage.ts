import type { TokenStorage } from "../core/auth/tokenStorage";
import type { AuthTokens } from "../core/types/user";

const STORAGE_KEY = "pelada.auth.tokens";

export const webTokenStorage: TokenStorage = {
  getTokens(): AuthTokens | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  },
  setTokens(tokens: AuthTokens): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  },
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
