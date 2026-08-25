import { useState } from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";

import { recurringGamesApi } from "../../api/recurringGamesApi";
import { goalkeepersSuffixShort } from "../../core/capacityLabel";
import { formatMatchDate, formatTime } from "../../core/dateTime";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import { WEEKDAY_LABELS, type RecurringGame } from "../../core/types/match";
import { AppLayout } from "../../shared/layout/AppLayout";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { matchKeys } from "../matches/matchQueries";
import { useOrganization } from "../organization/OrganizationContext";
import { RecurringGameFormDrawer, type RecurringGameFormValues } from "./RecurringGameFormDrawer";

export function RecurringGamesPage() {
  const { currentMembership } = useOrganization();
  const canManage = currentMembership?.role !== "visualizador";
  const { showToast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringGame | null>(null);
  const [toDelete, setToDelete] = useState<RecurringGame | null>(null);

  const listQuery = useApiQuery<RecurringGame[]>(matchKeys.recurringGames(), recurringGamesApi.list);

  const invalidate = () => {
    queryStore.invalidate(matchKeys.recurringGames());
    queryStore.invalidate(["matches"]);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const createMutation = useApiMutation(recurringGamesApi.create, {
    onSuccess: () => {
      invalidate();
      closeForm();
      showToast("Jogo recorrente criado.");
    },
  });

  const updateMutation = useApiMutation(
    ({ id, values }: { id: number; values: RecurringGameFormValues }) =>
      recurringGamesApi.update(id, values),
    {
      onSuccess: () => {
        invalidate();
        closeForm();
        showToast("Jogo recorrente atualizado.");
      },
    },
  );

  const generateMutation = useApiMutation(recurringGamesApi.generateMatch, {
    onSuccess: (match) => {
      invalidate();
      showToast(
        `✅ Partida de ${formatMatchDate(match.scheduled_date)} gerada! Já dá para confirmar presença.`,
      );
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível gerar a partida."), "error"),
  });

  const deleteMutation = useApiMutation(recurringGamesApi.remove, {
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast("Jogo recorrente removido.");
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível remover o jogo recorrente."), "error"),
  });

  const handleSubmit = async (values: RecurringGameFormValues) => {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, values });
      } else {
        await createMutation.mutateAsync(values);
      }
    } catch {
      /* a mensagem aparece no alerta do drawer */
    }
  };

  const columns: DataTableColumn<RecurringGame>[] = [
    { key: "name", label: "Nome", sortValue: (rg) => rg.name, render: (rg) => rg.name },
    { key: "weekday", label: "Dia da semana", render: (rg) => WEEKDAY_LABELS[rg.weekday] },
    { key: "match_time", label: "Horário do jogo", render: (rg) => formatTime(rg.match_time) },
    { key: "draw_time", label: "Horário do sorteio", render: (rg) => formatTime(rg.draw_time) },
    { key: "teams_count", label: "Times", render: (rg) => rg.teams_count },
    {
      key: "line",
      label: "Linha/time",
      render: (rg) =>
        `${rg.min_players_per_team_line}–${rg.max_players_per_team_line}${goalkeepersSuffixShort(rg.goalkeepers_per_team)}`,
    },
    {
      key: "total",
      label: "Total de jogadores",
      render: (rg) => `${rg.min_players}–${rg.max_players}`,
    },
    {
      key: "is_active",
      label: "Status",
      render: (rg) => (
        <StatusChip label={rg.is_active ? "Ativo" : "Inativo"} tone={rg.is_active ? "success" : "default"} />
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "Ações",
            align: "right" as const,
            render: (rg: RecurringGame) => (
              <>
                <Tooltip title="Gerar a próxima partida agora">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!rg.is_active || generateMutation.isPending}
                      onClick={() => generateMutation.mutate(rg.id)}
                      aria-label={`Gerar próxima partida de ${rg.name}`}
                    >
                      <EventRepeatIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Editar">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setEditing(rg);
                      setFormOpen(true);
                    }}
                    aria-label={`Editar ${rg.name}`}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remover">
                  <IconButton size="small" onClick={() => setToDelete(rg)} aria-label={`Remover ${rg.name}`}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <AppLayout>
      <PageHeader
        title="Jogos Recorrentes"
        action={
          canManage && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Novo jogo recorrente
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={listQuery.data}
        getRowKey={(rg) => rg.id}
        loading={listQuery.isLoading}
        error={
          listQuery.isError
            ? getApiErrorMessage(listQuery.error, "Não foi possível carregar os jogos recorrentes.")
            : null
        }
        onRetry={() => listQuery.refetch()}
        emptyMessage="Nenhum jogo recorrente cadastrado."
      />

      <RecurringGameFormDrawer
        open={formOpen}
        onClose={closeForm}
        onSubmit={handleSubmit}
        recurringGame={editing}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        error={
          createMutation.isError || updateMutation.isError
            ? getApiErrorMessage(
                createMutation.error ?? updateMutation.error,
                "Não foi possível salvar o jogo recorrente.",
              )
            : null
        }
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Remover jogo recorrente"
        description={`Tem certeza que deseja remover "${toDelete?.name}"? As partidas já geradas são preservadas.`}
        confirmLabel="Remover"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </AppLayout>
  );
}
