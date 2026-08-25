import type { AxiosInstance } from "axios";

import { MAX_PAGE_SIZE, type PaginatedResponse } from "../core/types/api";

const MAX_PAGES = 50;

/**
 * Lê **todas** as páginas de um endpoint paginado.
 *
 * Antes cada módulo devolvia apenas `data.results` da primeira página
 * (`page_size` global = 20). Uma pelada com 25 mensalistas simplesmente não via
 * 5 deles na tela de Jogadores, sem nenhum aviso — o mesmo valia para partidas,
 * jogos recorrentes, auditoria e histórico de sorteios.
 *
 * O limite de `MAX_PAGES` é uma trava de segurança contra laço infinito; ele
 * cobre 5.000 registros por listagem, muito acima do volume real de uma pelada.
 */
export async function fetchAllPages<T>(
  client: AxiosInstance,
  url: string,
  params: object = {},
): Promise<T[]> {
  const results: T[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await client.get<PaginatedResponse<T>>(url, {
      params: { ...params, page, page_size: MAX_PAGE_SIZE },
    });
    results.push(...data.results);
    if (!data.next) break;
  }

  return results;
}
