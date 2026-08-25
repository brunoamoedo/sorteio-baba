import type { AuthTokens } from "../types/user";

/**
 * Abstração de armazenamento de tokens. A implementação web usa localStorage
 * (ver src/platform/webTokenStorage.ts); um app Expo/React Native forneceria
 * uma implementação equivalente usando AsyncStorage/SecureStore, sem alterar
 * nenhum código de src/core ou src/api.
 */
export interface TokenStorage {
  getTokens(): AuthTokens | null;
  setTokens(tokens: AuthTokens): void;
  clear(): void;
}
