import { useCallback, useRef, useState } from "react";

export interface UseApiMutationOptions<TVariables, TData> {
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: unknown, variables: TVariables) => void;
  onSettled?: (data: TData | undefined, error: unknown, variables: TVariables) => void;
}

export interface UseApiMutationResult<TVariables, TData> {
  /** Dispara a mutação. **Nunca rejeita** — a falha vai para `onError`/`error`.
   * Era daqui que saíam as "unhandled promise rejection" do console: chamar
   * `mutateAsync` sem `catch` em `onSubmit` de formulário. */
  mutate: (variables: TVariables, handlers?: UseApiMutationOptions<TVariables, TData>) => void;
  /** Versão que propaga o erro, para quem realmente quer tratá-lo no `await`. */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: TData | undefined;
  reset: () => void;
}

export function useApiMutation<TVariables = void, TData = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: UseApiMutationOptions<TVariables, TData> = {},
): UseApiMutationResult<TVariables, TData> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [data, setData] = useState<TData | undefined>(undefined);

  const mutationRef = useRef(mutationFn);
  mutationRef.current = mutationFn;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Só o disparo mais recente pode escrever no estado: dois cliques rápidos no
  // mesmo botão não deixam mais o resultado do primeiro sobrescrever o segundo.
  const runIdRef = useRef(0);

  const execute = useCallback(
    async (variables: TVariables, handlers?: UseApiMutationOptions<TVariables, TData>) => {
      const runId = ++runIdRef.current;
      setIsPending(true);
      setError(undefined);
      try {
        const result = await mutationRef.current(variables);
        if (runId === runIdRef.current) {
          setData(result);
          setIsPending(false);
        }
        optionsRef.current.onSuccess?.(result, variables);
        handlers?.onSuccess?.(result, variables);
        optionsRef.current.onSettled?.(result, undefined, variables);
        handlers?.onSettled?.(result, undefined, variables);
        return result;
      } catch (caught) {
        if (runId === runIdRef.current) {
          setError(caught);
          setIsPending(false);
        }
        optionsRef.current.onError?.(caught, variables);
        handlers?.onError?.(caught, variables);
        optionsRef.current.onSettled?.(undefined, caught, variables);
        handlers?.onSettled?.(undefined, caught, variables);
        throw caught;
      }
    },
    [],
  );

  const mutate = useCallback(
    (variables: TVariables, handlers?: UseApiMutationOptions<TVariables, TData>) => {
      void execute(variables, handlers).catch(() => {
        /* tratado por onError/estado — nunca vira rejeição não capturada */
      });
    },
    [execute],
  );

  const mutateAsync = useCallback((variables: TVariables) => execute(variables), [execute]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setIsPending(false);
    setError(undefined);
    setData(undefined);
  }, []);

  return { mutate, mutateAsync, isPending, isError: error !== undefined, error, data, reset };
}
