/** Envelope de paginação do DRF. Estava duplicado em quatro módulos de api. */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Página máxima aceita pelo backend (`DefaultPagination.max_page_size`). */
export const MAX_PAGE_SIZE = 100;
