import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

import type { OrganizationStorage } from "./auth/organizationStorage";
import type { TokenStorage } from "./auth/tokenStorage";

interface CreateHttpClientOptions {
  baseURL: string;
  tokenStorage: TokenStorage;
  organizationStorage: OrganizationStorage;
  /** Chamado **uma única vez** quando a sessão realmente expirou (renovação
   * falhou). Não deve recarregar a página — quem trata é o contexto de auth. */
  onUnauthorized?: () => void;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/** Rotas de autenticação: um 401 aqui significa "credencial inválida", não
 * "sessão expirada". Tratá-las como sessão expirada era o que fazia uma senha
 * errada limpar o storage e recarregar a página inteira — apagando o formulário
 * e o alerta de erro antes de o usuário conseguir lê-lo. */
const AUTH_PATHS = ["/auth/token/", "/auth/token/refresh/"];

function isAuthRequest(config: { url?: string } | undefined): boolean {
  const url = config?.url ?? "";
  return AUTH_PATHS.some((path) => url.includes(path));
}

/**
 * Fábrica de cliente HTTP framework-agnostic: recebe a base URL e as
 * implementações de armazenamento (tokens/organização) da plataforma (web ou
 * mobile), e cuida de anexar o access token + organização corrente, além de
 * renovar o token automaticamente em 401.
 */
export function createHttpClient({
  baseURL,
  tokenStorage,
  organizationStorage,
  onUnauthorized,
}: CreateHttpClientOptions): AxiosInstance {
  // Usa o adapter fetch em vez do XHR padrão: em alguns runtimes o adapter
  // XHR do axios sofre com falhas intermitentes de rede (ERR_FAILED) logo
  // após o preflight de CORS; fetch se mostrou consistentemente confiável.
  const client = axios.create({ baseURL, adapter: "fetch" });

  client.interceptors.request.use((config) => {
    const tokens = tokenStorage.getTokens();
    if (tokens?.access && !isAuthRequest(config)) {
      config.headers.Authorization = `Bearer ${tokens.access}`;
    }
    const organizationId = organizationStorage.getOrganizationId();
    if (organizationId) {
      config.headers["X-Organization-Id"] = String(organizationId);
    }
    return config;
  });

  /**
   * Promise compartilhada da renovação em curso.
   *
   * Antes era uma flag booleana sem fila: quando o token expirava, as várias
   * requisições simultâneas de uma tela (a de partida dispara quatro) tomavam
   * 401 juntas — a primeira renovava e **todas as outras deslogavam o usuário**,
   * que era "jogado para o login sozinho" no meio do uso. Agora as concorrentes
   * aguardam a mesma renovação e são reexecutadas.
   */
  let refreshPromise: Promise<string> | null = null;

  const refreshAccessToken = (): Promise<string> => {
    if (!refreshPromise) {
      const tokens = tokenStorage.getTokens();
      if (!tokens?.refresh) return Promise.reject(new Error("Sem refresh token."));

      refreshPromise = axios
        .post(`${baseURL}/auth/token/refresh/`, { refresh: tokens.refresh }, { adapter: "fetch" })
        .then(({ data }) => {
          // O backend usa ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION: a
          // resposta traz um refresh token NOVO e invalida o anterior. Guardar
          // o antigo (comportamento anterior) fazia a renovação seguinte falhar
          // contra um token já na blacklist — ou seja, sessão caía sozinha ~30
          // minutos depois do login, sempre.
          tokenStorage.setTokens({ access: data.access, refresh: data.refresh ?? tokens.refresh });
          return data.access as string;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    return refreshPromise;
  };

  const handleSessionExpired = () => {
    tokenStorage.clear();
    onUnauthorized?.();
  };

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config as RetriableConfig | undefined;
      const status = error.response?.status;

      if (status !== 401 || !originalRequest || isAuthRequest(originalRequest)) {
        return Promise.reject(error);
      }

      const tokens = tokenStorage.getTokens();
      if (!tokens?.refresh || originalRequest._retry) {
        handleSessionExpired();
        return Promise.reject(error);
      }

      originalRequest._retry = true;
      try {
        const access = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${access}`;
        return await client(originalRequest);
      } catch {
        handleSessionExpired();
        return Promise.reject(error);
      }
    },
  );

  return client;
}
