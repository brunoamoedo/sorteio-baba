import { useCallback, useMemo, useState } from "react";

/**
 * Seleção múltipla de linhas — a base das ações em massa.
 *
 * Extraído da aba Mensalistas, que já resolvia o caso: guardar os **ids** num
 * `Set`, e não os objetos. Guardar objetos parece mais prático até a lista
 * recarregar: aí a seleção passa a apontar para cópias antigas, e a ação em
 * massa envia dados que já não existem.
 *
 * A pegadinha clássica deste controle é o "selecionar todos" que marca só a
 * página visível — quem tem 87 mensalistas marca a caixa, vê "todos
 * selecionados" e altera 20. Por isso `toggleAll` recebe **os ids do conjunto
 * inteiro** que está em tela (já filtrado), e não uma fatia.
 *
 * A outra é a seleção que sobrevive à troca de filtro: o organizador marca
 * cinco, filtra por outra competência e executa uma ação sobre gente que não
 * está mais na tela. Quem usa o hook chama `keepOnly` quando o filtro muda —
 * ver `REGRAS_DE_NEGOCIO.md` §3.
 */
export function useSelection<T extends number | string = number>(): {
  selected: ReadonlySet<T>;
  count: number;
  isSelected: (id: T) => boolean;
  toggle: (id: T) => void;
  /** Marca todos os `ids` se algum estiver fora; desmarca todos se já estão. */
  toggleAll: (ids: readonly T[]) => void;
  allSelected: (ids: readonly T[]) => boolean;
  someSelected: (ids: readonly T[]) => boolean;
  /** Descarta o que saiu da tela — chamar quando o filtro muda. */
  keepOnly: (ids: readonly T[]) => void;
  clear: () => void;
} {
  const [selected, setSelected] = useState<ReadonlySet<T>>(() => new Set<T>());

  const toggle = useCallback((id: T) => {
    setSelected((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, []);

  const toggleAll = useCallback((ids: readonly T[]) => {
    setSelected((atual) => {
      const todosMarcados = ids.length > 0 && ids.every((id) => atual.has(id));
      if (todosMarcados) {
        // Desmarca só os visíveis: quem estava selecionado fora do filtro
        // atual continua selecionado, coerente com `keepOnly`.
        const proximo = new Set(atual);
        ids.forEach((id) => proximo.delete(id));
        return proximo;
      }
      return new Set([...atual, ...ids]);
    });
  }, []);

  const keepOnly = useCallback((ids: readonly T[]) => {
    setSelected((atual) => {
      const permitidos = new Set(ids);
      const proximo = new Set([...atual].filter((id) => permitidos.has(id)));
      // Evita re-render quando nada saiu.
      return proximo.size === atual.size ? atual : proximo;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set<T>()), []);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      isSelected: (id: T) => selected.has(id),
      toggle,
      toggleAll,
      allSelected: (ids: readonly T[]) => ids.length > 0 && ids.every((id) => selected.has(id)),
      someSelected: (ids: readonly T[]) =>
        ids.some((id) => selected.has(id)) && !ids.every((id) => selected.has(id)),
      keepOnly,
      clear,
    }),
    [selected, toggle, toggleAll, keepOnly, clear],
  );
}
