/**
 * Cache de estado de servidor do sistema.
 *
 * Substitui o React Query mantendo a mesma semântica que as telas já usavam
 * (chave hierárquica + invalidação por prefixo + deduplicação de requisições em
 * voo), porém sem dependência externa e sem nenhuma API de browser — continua
 * reaproveitável por um app Expo, no mesmo espírito de `core/`.
 *
 * Regra de ouro adotada aqui, e que corrige o bug do login: **nunca existe um
 * estado em que a query está habilitada, sem dado e sem estar carregando**. Era
 * exatamente essa janela (query com `null` em cache revalidando em segundo
 * plano) que fazia o guard de rota concluir "não autenticado" e devolver o
 * usuário para a tela de login no primeiro clique.
 */

export type QueryKeyPart = string | number | boolean | null | undefined | object;
export type QueryKey = readonly QueryKeyPart[];

export type QueryStatus = "idle" | "pending" | "success" | "error";

export interface QuerySnapshot<T = unknown> {
  data: T | undefined;
  error: unknown;
  status: QueryStatus;
  isFetching: boolean;
  updatedAt: number;
}

interface QueryRecord {
  key: QueryKey;
  snapshot: QuerySnapshot;
  fetcher?: () => Promise<unknown>;
  inFlight?: Promise<unknown>;
  listeners: Set<() => void>;
}

const IDLE: QuerySnapshot = {
  data: undefined,
  error: undefined,
  status: "idle",
  isFetching: false,
  updatedAt: 0,
};

/** Chave estável: objetos (filtros) têm as chaves ordenadas para que
 * `{status, search}` e `{search, status}` produzam o mesmo hash. */
export function hashKey(key: QueryKey): string {
  return JSON.stringify(key, (_field, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((accumulator, field) => {
          accumulator[field] = (value as Record<string, unknown>)[field];
          return accumulator;
        }, {});
    }
    return value;
  });
}

function matchesPrefix(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((part, index) => hashKey([part]) === hashKey([key[index]]));
}

export class QueryStore {
  private records = new Map<string, QueryRecord>();

  private record(key: QueryKey): QueryRecord {
    const hash = hashKey(key);
    let record = this.records.get(hash);
    if (!record) {
      record = { key, snapshot: IDLE, listeners: new Set() };
      this.records.set(hash, record);
    }
    return record;
  }

  private update(record: QueryRecord, patch: Partial<QuerySnapshot>): void {
    record.snapshot = { ...record.snapshot, ...patch };
    record.listeners.forEach((listener) => listener());
  }

  getSnapshot<T>(key: QueryKey): QuerySnapshot<T> {
    return this.record(key).snapshot as QuerySnapshot<T>;
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const record = this.record(key);
    record.listeners.add(listener);
    return () => {
      record.listeners.delete(listener);
    };
  }

  /** Dispara a busca. Requisições concorrentes para a mesma chave compartilham
   * a mesma promise — em `StrictMode` (efeito executado duas vezes) e em telas
   * que montam a mesma query em dois pontos, a rede é chamada uma vez só. */
  fetch<T>(key: QueryKey, fetcher: () => Promise<T>, options: { force?: boolean } = {}): Promise<T> {
    const record = this.record(key);
    record.fetcher = fetcher as () => Promise<unknown>;

    if (record.inFlight && !options.force) {
      return record.inFlight as Promise<T>;
    }

    this.update(record, { isFetching: true, status: record.snapshot.data === undefined ? "pending" : record.snapshot.status });

    const promise = fetcher()
      .then((data) => {
        this.update(record, {
          data,
          error: undefined,
          status: "success",
          isFetching: false,
          updatedAt: Date.now(),
        });
        return data;
      })
      .catch((error: unknown) => {
        this.update(record, { error, status: "error", isFetching: false });
        throw error;
      })
      .finally(() => {
        if (record.inFlight === promise) record.inFlight = undefined;
      });

    record.inFlight = promise as Promise<unknown>;
    return promise;
  }

  /** Marca como desatualizado e refaz a busca de toda chave que comece pelo
   * prefixo e esteja sendo observada por alguma tela. */
  invalidate(prefix: QueryKey): void {
    for (const record of this.records.values()) {
      if (!matchesPrefix(record.key, prefix)) continue;
      if (record.listeners.size === 0 || !record.fetcher) {
        record.snapshot = { ...record.snapshot, updatedAt: 0 };
        continue;
      }
      void this.fetch(record.key, record.fetcher, { force: true }).catch(() => {
        /* o estado de erro já foi registrado no snapshot */
      });
    }
  }

  /**
   * Remove as entradas do cache. Diferente de gravar `null` como dado (o que o
   * logout fazia antes), aqui a query volta ao estado "sem dado nenhum" — que é
   * o que o guard de rota precisa enxergar para esperar em vez de concluir que
   * o usuário não está autenticado.
   */
  remove(prefix: QueryKey): void {
    for (const [hash, record] of this.records.entries()) {
      if (!matchesPrefix(record.key, prefix)) continue;
      record.inFlight = undefined;
      record.fetcher = undefined;
      record.snapshot = IDLE;
      record.listeners.forEach((listener) => listener());
      if (record.listeners.size === 0) this.records.delete(hash);
    }
  }

  setData<T>(key: QueryKey, data: T): void {
    const record = this.record(key);
    this.update(record, { data, status: "success", error: undefined, updatedAt: Date.now() });
  }

  /**
   * Esvazia o cache inteiro (troca de sessão).
   *
   * Registros **com ouvintes ativos são zerados no lugar, não descartados**. Se
   * fossem removidos do mapa, o próximo `getSnapshot` criaria um registro novo e
   * o componente continuaria inscrito no objeto antigo — nunca mais seria
   * notificado. Na prática isso travava a tela de login: o token era gravado, o
   * `/auth/me` respondia 200, e a interface simplesmente não reagia.
   */
  clear(): void {
    for (const [hash, record] of this.records.entries()) {
      record.inFlight = undefined;
      record.fetcher = undefined;
      record.snapshot = IDLE;
      record.listeners.forEach((listener) => listener());
      if (record.listeners.size === 0) this.records.delete(hash);
    }
  }
}

export const queryStore = new QueryStore();
