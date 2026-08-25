import { useEffect, useState } from "react";

/**
 * Atrasa a propagação de um valor que muda a cada tecla digitada.
 *
 * Usado nos campos de busca: sem isso, cada letra virava uma chave de cache
 * nova e, portanto, uma requisição — digitar "Rodrigo" disparava sete chamadas
 * à API (e consumia sete vezes a cota de throttling).
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
