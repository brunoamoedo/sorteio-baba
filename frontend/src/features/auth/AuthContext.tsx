import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { authApi, type LoginPayload } from "../../api/authApi";
import { onSessionExpired } from "../../core/auth/sessionEvents";
import { getApiErrorMessage, getApiStatus, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import { webOrganizationStorage } from "../../platform/webOrganizationStorage";
import { webTokenStorage } from "../../platform/webTokenStorage";
import type { AuthTokens, User } from "../../core/types/user";

export const ME_QUERY_KEY = ["me"] as const;
export const MEMBERSHIPS_QUERY_KEY = ["organizations", "mine"] as const;

interface AuthContextValue {
  user: User | null | undefined;
  /** Verdadeiro enquanto existe token mas o usuário ainda não foi resolvido.
   * Os guards de rota **precisam** esperar nesse estado. */
  isLoading: boolean;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
  loginError: string | null;
  clearLoginError: () => void;
  /** Relê o usuário do servidor. Usado depois da troca de senha, para a marca
   * de primeiro acesso sumir sem exigir um novo login. */
  reloadUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hasTokens, setHasTokens] = useState(() => !!webTokenStorage.getTokens());

  const meQuery = useApiQuery<User>(ME_QUERY_KEY, authApi.me, { enabled: hasTokens });

  /**
   * Limpa a sessão por completo.
   *
   * O logout antigo gravava `null` no cache da query `["me"]`
   * (`setQueryData(["me"], null)`). Isso não apagava a query — deixava um dado
   * "válido" igual a `null` com status de sucesso. No login seguinte a query
   * revalidava em segundo plano: **não estava carregando** (já tinha dado) e
   * **não tinha usuário** (o dado era `null`), então o guard de rota concluía
   * "não autenticado" e devolvia o usuário para /login. Só no segundo clique,
   * com o cache já preenchido pela primeira tentativa, o login "funcionava".
   *
   * Remover as entradas devolve a query ao estado "sem dado nenhum", que é
   * justamente o que `isLoading` usa para fazer o guard esperar.
   */
  const clearSession = useCallback(() => {
    webTokenStorage.clear();
    webOrganizationStorage.clear();
    setHasTokens(false);
    // Esvazia o cache inteiro, não só as duas chaves de sessão: o próximo login
    // pode ser de outro usuário (ou de outra organização) e não pode enxergar
    // nada do anterior — nem dados, nem os erros 401 deixados pelas requisições
    // que estavam em voo no momento do logout.
    queryStore.clear();
  }, []);

  // Sessão expirada de verdade (renovação do token falhou) chega por aqui, sem
  // recarregar a página.
  useEffect(() => onSessionExpired(clearSession), [clearSession]);

  const setSessionTokens = useCallback((tokens: AuthTokens) => {
    // Um login novo nunca pode reaproveitar o cache de outro usuário.
    queryStore.clear();
    webTokenStorage.setTokens(tokens);
    setHasTokens(true);
  }, []);

  const loginMutation = useApiMutation(authApi.login, { onSuccess: setSessionTokens });
  const { mutateAsync: runLogin, reset: resetLogin, isPending: isLoggingIn, error: rawLoginError } =
    loginMutation;

  const login = useCallback(
    async (payload: LoginPayload) => {
      await runLogin(payload);
    },
    [runLogin],
  );

  const value = useMemo<AuthContextValue>(() => {
    const user = hasTokens ? meQuery.data : null;
    return {
      user,
      // Enquanto houver token e o usuário não estiver resolvido, é carregamento
      // — jamais "não autenticado".
      isLoading: hasTokens && meQuery.isLoading,
      isAuthenticated: hasTokens && !!user,
      isLoggingIn,
      login,
      logout: clearSession,
      loginError: rawLoginError
        ? // 401 no login é sempre credencial inválida — a mensagem em inglês do
          // SimpleJWT não deve vazar para a tela.
          getApiStatus(rawLoginError) === 401
          ? "Usuário ou senha inválidos."
          : getApiErrorMessage(rawLoginError, "Não foi possível entrar. Tente novamente.")
        : null,
      clearLoginError: resetLogin,
      reloadUser: () => queryStore.invalidate(ME_QUERY_KEY),
    };
  }, [
    hasTokens,
    meQuery.data,
    meQuery.isLoading,
    isLoggingIn,
    login,
    clearSession,
    rawLoginError,
    resetLogin,
    setSessionTokens,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  }
  return context;
}
