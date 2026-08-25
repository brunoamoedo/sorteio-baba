import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { queryStore, type QueryKey, type QuerySnapshot } from "./queryStore";

export interface UseApiQueryOptions {
  /** Quando falso, a query não busca nada e fica em repouso. */
  enabled?: boolean;
  /** Por quantos milissegundos o dado em cache é considerado fresco. */
  staleTime?: number;
}

export interface UseApiQueryResult<T> {
  data: T | undefined;
  error: unknown;
  /**
   * `true` enquanto a query está habilitada e ainda **não tem dado nem erro**.
   *
   * Derivado do dado, não de um estado interno de "primeira busca": é o que
   * garante que nenhuma tela veja o par (habilitada, sem dado, sem carregar) —
   * a janela em que o guard de rota antigamente concluía "não autenticado" e
   * devolvia o usuário para o login no primeiro clique.
   */
  isLoading: boolean;
  /** Há uma requisição em voo (inclusive revalidação com dado já em tela). */
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<T | undefined>;
}

export function useApiQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options: UseApiQueryOptions = {},
): UseApiQueryResult<T> {
  const { enabled = true, staleTime = 0 } = options;

  // A identidade da função de busca costuma mudar a cada render (arrow inline).
  // Guardá-la numa ref impede que isso vire um laço de requisições.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const keyHash = JSON.stringify(key);

  const subscribe = useCallback(
    (listener: () => void) => queryStore.subscribe(key, listener),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash],
  );
  const getSnapshot = useCallback(
    () => queryStore.getSnapshot<T>(key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash],
  );

  const snapshot: QuerySnapshot<T> = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const run = useCallback(
    (force: boolean) =>
      queryStore.fetch<T>(key, () => fetcherRef.current(), { force }).catch(() => undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash],
  );

  useEffect(() => {
    if (!enabled) return;
    const isFresh =
      snapshot.status === "success" &&
      snapshot.updatedAt > 0 &&
      Date.now() - snapshot.updatedAt < staleTime;
    if (isFresh) return;
    // Uma query que falhou **precisa** poder tentar de novo ao remontar: sem
    // isso, um 401 durante o logout deixava a chave em erro permanente e a tela
    // seguinte (dashboard, por exemplo) nascia quebrada após o próximo login.
    // Não há laço: as dependências são só a chave e `enabled`, então isto roda
    // uma vez por montagem/troca de chave.
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keyHash, run]);

  // Identidade estável para poder entrar em listas de dependências sem
  // provocar recálculos a cada render.
  const refetch = useCallback(() => run(true), [run]);

  return {
    data: snapshot.data,
    error: snapshot.error,
    isLoading: enabled && snapshot.data === undefined && snapshot.status !== "error",
    isFetching: snapshot.isFetching,
    isError: snapshot.status === "error",
    isSuccess: snapshot.status === "success",
    refetch,
  };
}
