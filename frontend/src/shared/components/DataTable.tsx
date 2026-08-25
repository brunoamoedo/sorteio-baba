import { useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import { EmptyState } from "./EmptyState";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Presente só em colunas ordenáveis — habilita o clique no cabeçalho. */
  sortValue?: (row: T) => string | number | null;
  width?: string | number;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  getRowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  /** Mensagem de erro do carregamento. Sem isso, uma falha aparecia como
   * "nenhum registro encontrado" — indistinguível de uma lista vazia. */
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  /** Ação oferecida no estado vazio ("Cadastrar o primeiro jogador"). */
  emptyAction?: ReactNode;
  size?: "small" | "medium";
  defaultSortKey?: string;
  defaultSortDesc?: boolean;
  skeletonRows?: number;
  /** A partir de quantas linhas a paginação local aparece. */
  pageSize?: number;
  /** Seleção em massa. Quando informado, a tabela ganha uma coluna de caixas e
   * o cabeçalho seleciona/limpa **todas as linhas do filtro atual** — não só as
   * da página visível, que é a pegadinha clássica desse controle. */
  selection?: {
    selectedIds: ReadonlySet<string | number>;
    onChange: (ids: ReadonlySet<string | number>) => void;
  };
  /**
   * Desenho de uma linha como **card**, usado abaixo de `md`.
   *
   * Sem esta prop o componente se comporta exatamente como antes (tabela em
   * qualquer largura) — nenhuma tela existente muda por acidente.
   */
  renderCard?: (row: T) => ReactNode;
}

/** Tabela genérica do design system — substitui a montagem manual de
 * Table/TableHead/TableBody repetida em Jogadores, Jogos Recorrentes,
 * Partidas, Estatísticas e Auditoria. Cobre: ordenação por coluna (opcional),
 * loading com skeleton, erro com "tentar novamente", estado vazio, linha
 * clicável, paginação e — abaixo de `md`, quando `renderCard` é informado —
 * uma lista de cards no lugar da tabela.
 *
 * ## Por que a lista de cards
 *
 * A única estratégia mobile da tabela era `overflowX: auto`. Na prática, a
 * listagem de jogadores media **684px** de largura num viewport de 343px: a
 * pessoa rolava lateralmente para ver a metade da informação, e o cabeçalho
 * saía da tela junto. Ordenação, seleção e paginação continuam valendo nos dois
 * modos — quem troca é só o desenho da linha. */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = "Nenhum registro encontrado.",
  emptyAction,
  size,
  defaultSortKey,
  defaultSortDesc = true,
  skeletonRows = 5,
  pageSize = 25,
  selection,
  renderCard,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDesc, setSortDesc] = useState(defaultSortDesc);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);

  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const asCards = isCompact && !!renderCard;

  const sortedRows = useMemo(() => {
    if (!rows) return rows;
    const column = columns.find((c) => c.key === sortKey);
    if (!column?.sortValue) return rows;
    const sorter = column.sortValue;
    return [...rows].sort((a, b) => {
      const aValue = sorter(a);
      const bValue = sorter(b);
      // Nulos sempre por último, independentemente da direção — antes viravam
      // -Infinity e apareciam no topo na ordem crescente.
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDesc ? bValue.localeCompare(aValue, "pt-BR") : aValue.localeCompare(bValue, "pt-BR");
      }
      if (aValue < bValue) return sortDesc ? 1 : -1;
      if (aValue > bValue) return sortDesc ? -1 : 1;
      return 0;
    });
  }, [rows, columns, sortKey, sortDesc]);

  const total = sortedRows?.length ?? 0;
  const visibleRows = useMemo(() => {
    if (!sortedRows) return sortedRows;
    const start = page * rowsPerPage;
    return sortedRows.slice(start, start + rowsPerPage);
  }, [sortedRows, page, rowsPerPage]);

  const allIds = useMemo(() => (rows ?? []).map(getRowKey), [rows, getRowKey]);
  const selectedCount = selection ? allIds.filter((id) => selection.selectedIds.has(id)).length : 0;
  const allSelected = selectedCount > 0 && selectedCount === allIds.length;

  const toggleAll = () => {
    if (!selection) return;
    selection.onChange(allSelected ? new Set() : new Set(allIds));
  };

  const toggleOne = (id: string | number) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  const columnCount = columns.length + (selection ? 1 : 0);

  const handleSort = (key: string) => {
    setPage(0);
    if (key === sortKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const sortableColumns = columns.filter((column) => column.sortValue);

  if (error) {
    return (
      <Alert
        severity="error"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Tentar novamente
            </Button>
          ) : undefined
        }
      >
        {error}
      </Alert>
    );
  }

  const emptyBlock = (
    <EmptyState title={emptyMessage} action={emptyAction} dense={!asCards} />
  );

  const pagination = !loading && total > pageSize && (
    <TablePagination
      component="div"
      count={total}
      page={page}
      onPageChange={(_, nextPage) => setPage(nextPage)}
      rowsPerPage={rowsPerPage}
      onRowsPerPageChange={(event) => {
        setRowsPerPage(Number(event.target.value));
        setPage(0);
      }}
      rowsPerPageOptions={asCards ? [] : [25, 50, 100]}
      labelRowsPerPage={asCards ? "" : "Linhas por página"}
      labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
      sx={asCards ? { "& .MuiTablePagination-toolbar": { pl: 1 } } : undefined}
    />
  );

  // -- Lista de cards (celular) --------------------------------------------
  if (asCards) {
    return (
      <Box>
        {/* Sem cabeçalho de tabela não há onde clicar para ordenar — o
            seletor abaixo devolve essa capacidade no celular. */}
        {sortableColumns.length > 0 && (
          <Stack direction="row" sx={{ gap: 1, mb: 1.5, alignItems: "center" }}>
            <TextField
              select
              size="small"
              label="Ordenar por"
              value={sortKey ?? ""}
              onChange={(event) => {
                setSortKey(event.target.value || undefined);
                setPage(0);
              }}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">Padrão</MenuItem>
              {sortableColumns.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  {column.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              onClick={() => setSortDesc((prev) => !prev)}
              disabled={!sortKey}
              sx={{ whiteSpace: "nowrap" }}
            >
              {sortDesc ? "↓ Maior" : "↑ Menor"}
            </Button>
          </Stack>
        )}

        {selection && allIds.length > 0 && (
          <FormControlLabel
            sx={{ mb: 0.5 }}
            control={
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onChange={toggleAll}
                slotProps={{ input: { "aria-label": "Selecionar todos os resultados do filtro" } }}
              />
            }
            label={
              <Typography variant="body2">
                {selectedCount > 0 ? `${selectedCount} selecionado(s)` : "Selecionar todos"}
              </Typography>
            }
          />
        )}

        <Stack spacing={1.5}>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, index) => (
              <Paper key={`skeleton-${index}`} sx={{ p: 2 }}>
                <Skeleton variant="text" width="55%" />
                <Skeleton variant="text" width="80%" />
              </Paper>
            ))}

          {!loading &&
            visibleRows?.map((row) => {
              const id = getRowKey(row);
              const card = renderCard(row);
              if (!selection) return <Box key={id}>{card}</Box>;
              return (
                <Stack key={id} direction="row" sx={{ alignItems: "flex-start", gap: 0.5 }}>
                  <Checkbox
                    checked={selection.selectedIds.has(id)}
                    onChange={() => toggleOne(id)}
                    slotProps={{ input: { "aria-label": `Selecionar linha ${id}` } }}
                    sx={{ mt: 1 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>{card}</Box>
                </Stack>
              );
            })}

          {!loading && total === 0 && emptyBlock}
        </Stack>

        {pagination}
      </Box>
    );
  }

  // -- Tabela (tablet e desktop) -------------------------------------------
  return (
    <Paper>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size={size}>
          <TableHead>
            <TableRow>
              {selection && (
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedCount > 0 && !allSelected}
                    onChange={toggleAll}
                    disabled={allIds.length === 0}
                    slotProps={{ input: { "aria-label": "Selecionar todos os resultados do filtro" } }}
                  />
                </TableCell>
              )}
              {columns.map((column) => (
                <TableCell key={column.key} align={column.align} sx={{ width: column.width }}>
                  {column.sortValue ? (
                    <TableSortLabel
                      active={sortKey === column.key}
                      direction={sortKey === column.key && sortDesc ? "desc" : "asc"}
                      onClick={() => handleSort(column.key)}
                    >
                      {column.label}
                    </TableSortLabel>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading &&
              Array.from({ length: skeletonRows }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {selection && <TableCell padding="checkbox" />}
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading &&
              visibleRows?.map((row) => (
                <TableRow
                  key={getRowKey(row)}
                  hover={!!onRowClick}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  selected={selection?.selectedIds.has(getRowKey(row))}
                  // A linha clicável precisa ser alcançável por teclado: antes
                  // era um `<tr onClick>` puro, invisível para quem navega com
                  // Tab e para leitores de tela.
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  sx={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {selection && (
                    <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selection.selectedIds.has(getRowKey(row))}
                        onChange={() => toggleOne(getRowKey(row))}
                        slotProps={{ input: { "aria-label": `Selecionar linha ${getRowKey(row)}` } }}
                      />
                    </TableCell>
                  )}
                  {columns.map((column) => (
                    <TableCell key={column.key} align={column.align}>
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && total === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>{emptyBlock}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pagination}
    </Paper>
  );
}
