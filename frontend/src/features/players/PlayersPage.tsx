import { useEffect, useMemo, useState } from "react";
import { Box, Button, MenuItem, Paper, Rating, Stack, TextField, Typography } from "@mui/material";
import IconButton from "@mui/material/IconButton";

import {
  playersApi,
  positionsApi,
  type BulkPlayerAction,
  type PlayerFilters,
} from "../../api/playersApi";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import { useDebouncedValue } from "../../core/hooks/useDebouncedValue";
import type { LinkableUser, Player, Position } from "../../core/types/player";
import { AppLayout } from "../../shared/layout/AppLayout";
import { AddIcon, DeleteIcon, EditIcon, PrintIcon, SearchIcon } from "../../shared/icons";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { FilterSheet, type ActiveFilterChip } from "../../shared/components/FilterSheet";
import { PageHeader } from "../../shared/components/PageHeader";
import { PlayerAvatar } from "../../shared/components/PlayerAvatar";
import {
  StatusChip,
  playerStatusTone,
  playerTypeLabel,
  playerTypeTone,
} from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { matchKeys } from "../matches/matchQueries";
import { useOrganization } from "../organization/OrganizationContext";
import { PlayerCard } from "./PlayerCard";
import { PlayerFormDrawer } from "./PlayerFormDrawer";
import { PlayersPrintSheet } from "./PlayersPrintSheet";

export function PlayersPage() {
  const { currentMembership } = useOrganization();
  const canManage = currentMembership?.role !== "visualizador";
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Omit<PlayerFilters, "search">>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [playerToDelete, setPlayerToDelete] = useState<Player | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string | number>>(new Set());
  const [bulkToConfirm, setBulkToConfirm] = useState<BulkPlayerAction | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search);
  const activeFilters = useMemo<PlayerFilters>(
    () => ({ ...filters, search: debouncedSearch || undefined }),
    [filters, debouncedSearch],
  );

  const playersQuery = useApiQuery<Player[]>([...matchKeys.players(), activeFilters], () =>
    playersApi.list(activeFilters),
  );
  const positionsQuery = useApiQuery<Position[]>(matchKeys.positions(), positionsApi.list);
  const linkableUsersQuery = useApiQuery<LinkableUser[]>(
    ["players", "linkable-users"],
    playersApi.linkableUsers,
    { enabled: canManage },
  );

  /** A seleção é sempre "os jogadores deste filtro". Trocar o filtro muda o
   * conjunto, e manter os ids antigos marcados aplicaria a ação a gente que
   * nem está na tela — o erro clássico de seleção em massa com filtro. */
  useEffect(() => setSelectedIds(new Set()), [activeFilters]);

  const selectedCount = selectedIds.size;

  const invalidatePlayers = () => {
    queryStore.invalidate(matchKeys.players());
    // A lista de logins vinculáveis muda junto: vincular uma ficha ocupa um
    // login, desvincular libera.
    queryStore.invalidate(["players", "linkable-users"]);
    // Mudar um jogador afeta roster, contadores e estatísticas.
    queryStore.invalidate(["matches"]);
    queryStore.invalidate(matchKeys.dashboard());
    queryStore.invalidate(matchKeys.statistics());
  };

  const closeForm = () => {
    setFormOpen(false);
    // Limpar o item em edição evita reabrir o drawer com dados do anterior.
    setEditingPlayer(null);
  };

  const createMutation = useApiMutation(playersApi.create, {
    onSuccess: () => {
      invalidatePlayers();
      closeForm();
      showToast("Jogador criado.");
    },
  });

  const updateMutation = useApiMutation(
    ({ id, formData }: { id: number; formData: FormData }) => playersApi.update(id, formData),
    {
      onSuccess: () => {
        invalidatePlayers();
        closeForm();
        showToast("Jogador atualizado.");
      },
    },
  );

  const deleteMutation = useApiMutation(playersApi.remove, {
    onSuccess: () => {
      invalidatePlayers();
      setPlayerToDelete(null);
      showToast("Jogador removido.");
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível remover o jogador."), "error"),
  });

  const bulkMutation = useApiMutation(
    ({ ids, action }: { ids: number[]; action: BulkPlayerAction }) => playersApi.bulk(ids, action),
    {
      onSuccess: (data, { action }) => {
        invalidatePlayers();
        setSelectedIds(new Set());
        setBulkToConfirm(null);
        const label =
          action === "delete" ? "removido(s)" : action === "ativo" ? "ativado(s)" : "inativado(s)";
        showToast(`${data.updated} jogador(es) ${label}.`);
      },
      onError: (error) =>
        showToast(getApiErrorMessage(error, "Não foi possível aplicar a ação em lote."), "error"),
    },
  );

  const runBulk = (action: BulkPlayerAction) =>
    bulkMutation.mutate({ ids: [...selectedIds].map(Number), action });

  const openCreateForm = () => {
    setEditingPlayer(null);
    setFormOpen(true);
  };

  const openEditForm = (player: Player) => {
    setEditingPlayer(player);
    setFormOpen(true);
  };

  const handleFormSubmit = async (formData: FormData) => {
    try {
      if (editingPlayer) {
        await updateMutation.mutateAsync({ id: editingPlayer.id, formData });
      } else {
        await createMutation.mutateAsync(formData);
      }
    } catch {
      /* a mensagem aparece no alerta do drawer */
    }
  };

  const positionName = (id: number | null) =>
    positionsQuery.data?.find((p) => p.id === id)?.name ?? "—";

  const hasActiveFilters = !!filters.status || !!filters.player_type || !!debouncedSearch;

  /** O que está filtrado agora, em chips removíveis — a busca não entra aqui
   * porque o campo dela já está visível na tela. */
  const activeFilterChips: ActiveFilterChip[] = [
    ...(filters.status
      ? [
          {
            key: "status",
            label: filters.status === "ativo" ? "Ativos" : "Inativos",
            onClear: () => setFilters((f) => ({ ...f, status: undefined })),
          },
        ]
      : []),
    ...(filters.player_type
      ? [
          {
            key: "player_type",
            label: filters.player_type === "mensalista" ? "Mensalistas" : "Convidados",
            onClear: () => setFilters((f) => ({ ...f, player_type: undefined })),
          },
        ]
      : []),
  ];

  const columns: DataTableColumn<Player>[] = [
    {
      key: "name",
      label: "Jogador",
      sortValue: (p) => p.name,
      render: (player) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <PlayerAvatar name={player.name} photo={player.photo_thumb ?? player.photo} />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {player.name}
            </Typography>
            {player.nickname && (
              <Typography variant="caption" color="text.secondary">
                {player.nickname}
              </Typography>
            )}
          </Box>
        </Box>
      ),
    },
    { key: "position", label: "Posição", render: (player) => positionName(player.primary_position) },
    {
      key: "skill_level",
      label: "Nível",
      sortValue: (p) => p.skill_level,
      render: (player) => (
        <Rating value={player.skill_level} readOnly size="small" aria-label={`${player.skill_level} estrelas`} />
      ),
    },
    {
      key: "player_type",
      label: "Tipo",
      render: (player) => (
        <StatusChip label={playerTypeLabel(player.player_type)} tone={playerTypeTone(player.player_type)} />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (player) => (
        <StatusChip
          label={player.status === "ativo" ? "Ativo" : "Inativo"}
          tone={playerStatusTone(player.status)}
        />
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "Ações",
            align: "right" as const,
            render: (player: Player) => (
              <>
                <IconButton size="small" onClick={() => openEditForm(player)} aria-label={`Editar ${player.name}`}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => setPlayerToDelete(player)}
                  aria-label={`Remover ${player.name}`}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <AppLayout>
      {/* Sai no papel; invisível na tela. Leva **os jogadores que estão à
          vista**, com os filtros aplicados — e a folha diz quais eram, senão um
          PDF filtrado passa por elenco completo. */}
      <PlayersPrintSheet
        players={playersQuery.data ?? []}
        positions={positionsQuery.data ?? []}
        organizationName={currentMembership?.organization?.name}
        filters={activeFilters}
      />

      {/* Tudo daqui para baixo é a tela: busca, filtros, seleção e os
          botões de editar e apagar. Nada disso pertence a um documento, e
          um contêiner só evita ter de marcar cada componente — vários nem
          repassam `className`. */}
      <Box className="no-print">
        <PageHeader
          title="Jogadores"
          action={
            <Stack direction="row" spacing={1}>
              {/* Gera o PDF pelo diálogo do próprio navegador ("Salvar como
                  PDF"), no computador e no celular. O que vai para o papel é a
                  `PlayersPrintSheet`, não esta lista — ver `printStyles.ts`. */}
              <Button
                variant="outlined"
                startIcon={<PrintIcon />}
                onClick={() => window.print()}
                disabled={!playersQuery.data?.length}
              >
                Gerar PDF
              </Button>
              {canManage && (
                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateForm}>
                  Novo jogador
                </Button>
              )}
            </Stack>
          }
        />


        {/* A busca fica sempre à mão — é o filtro que se usa de verdade. Os
            demais moram no painel, para não consumirem meia tela no celular. */}
        <TextField
          fullWidth
          label="Buscar jogador"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: "text.secondary" }} /> } }}
          sx={{ mb: 2 }}
        />

        <FilterSheet
          open={filtersOpen}
          onOpen={() => setFiltersOpen(true)}
          onClose={() => setFiltersOpen(false)}
          active={activeFilterChips}
          onClearAll={() => setFilters({})}
          resultCount={playersQuery.data?.length}
        >
          <TextField
            select
            fullWidth
            label="Status"
            value={filters.status ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="ativo">Ativo</MenuItem>
            <MenuItem value="inativo">Inativo</MenuItem>
          </TextField>
          <TextField
            select
            fullWidth
            label="Tipo"
            value={filters.player_type ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, player_type: e.target.value || undefined }))}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="mensalista">Mensalista</MenuItem>
            <MenuItem value="convidado">Convidado</MenuItem>
          </TextField>
        </FilterSheet>

        <DataTable
          columns={columns}
          rows={playersQuery.data}
          getRowKey={(player) => player.id}
          selection={canManage ? { selectedIds, onChange: setSelectedIds } : undefined}
          loading={playersQuery.isLoading}
          error={
            playersQuery.isError
              ? getApiErrorMessage(playersQuery.error, "Não foi possível carregar os jogadores.")
              : null
          }
          onRetry={() => playersQuery.refetch()}
          emptyMessage="Nenhum jogador encontrado."
          emptyAction={
            canManage && !hasActiveFilters ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateForm}>
                Cadastrar o primeiro jogador
              </Button>
            ) : undefined
          }
          renderCard={(player) => (
            <PlayerCard
              player={player}
              positionName={positionName(player.primary_position)}
              canManage={canManage}
              onEdit={openEditForm}
              onDelete={setPlayerToDelete}
            />
          )}
        />

        {/* Barra de ação em lote **fixa**: antes ela ficava no topo e sumia da
            tela assim que a pessoa rolava a lista para escolher mais gente. */}
        {canManage && selectedCount > 0 && (
          <Paper
            elevation={8}
            className="safe-bottom"
            sx={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: { xs: 60, md: 0 },
              zIndex: (t) => t.zIndex.appBar - 1,
              borderRadius: 0,
              borderTop: "1px solid",
              borderColor: "divider",
              px: 2,
              py: 1.5,
            }}
          >
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" }, maxWidth: 1200, mx: "auto" }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, flexGrow: 1 }}>
                {selectedCount} jogador(es) selecionado(s)
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                <Button size="small" disabled={bulkMutation.isPending} onClick={() => runBulk("ativo")}>
                  Ativar
                </Button>
                <Button size="small" disabled={bulkMutation.isPending} onClick={() => runBulk("inativo")}>
                  Inativar
                </Button>
                <Button
                  size="small"
                  color="error"
                  disabled={bulkMutation.isPending}
                  onClick={() => setBulkToConfirm("delete")}
                >
                  Remover
                </Button>
                <Button size="small" color="inherit" onClick={() => setSelectedIds(new Set())}>
                  Limpar
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}

        <PlayerFormDrawer
          open={formOpen}
          onClose={closeForm}
          onSubmit={handleFormSubmit}
          positions={positionsQuery.data ?? []}
          linkableUsers={linkableUsersQuery.data ?? []}
          player={editingPlayer}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          error={
            createMutation.isError || updateMutation.isError
              ? getApiErrorMessage(
                  createMutation.error ?? updateMutation.error,
                  "Não foi possível salvar o jogador. Confira os dados.",
                )
              : null
          }
        />

        <ConfirmDialog
          open={!!playerToDelete}
          title="Remover jogador"
          description={`Tem certeza que deseja remover ${playerToDelete?.name}? O histórico de sorteios é preservado.`}
          confirmLabel="Remover"
          isConfirming={deleteMutation.isPending}
          onConfirm={() => playerToDelete && deleteMutation.mutate(playerToDelete.id)}
          onClose={() => setPlayerToDelete(null)}
        />

        <ConfirmDialog
          open={bulkToConfirm === "delete"}
          title="Remover jogadores selecionados"
          description={`Tem certeza que deseja remover ${selectedCount} jogador(es)? O histórico de sorteios é preservado.`}
          confirmLabel="Remover"
          isConfirming={bulkMutation.isPending}
          onConfirm={() => runBulk("delete")}
          onClose={() => setBulkToConfirm(null)}
        />
      </Box>
    </AppLayout>
  );
}
