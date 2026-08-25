import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, IconButton, Tooltip, Typography } from "@mui/material";

import { AddIcon, DeleteIcon, EditIcon } from "../../shared/icons";

import { matchesApi, type MatchWritePayload } from "../../api/matchesApi";
import { goalkeepersSuffixShort } from "../../core/capacityLabel";
import { formatMatchDate, formatTime } from "../../core/dateTime";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import type { Match, MatchStatus } from "../../core/types/match";
import { AppLayout } from "../../shared/layout/AppLayout";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip, matchStatusTone } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { useOrganization } from "../organization/OrganizationContext";
import { DivergenceWarning } from "./DivergenceWarning";
import { MatchCard } from "./MatchCard";
import { matchKeys } from "./matchQueries";
import { MatchFormDrawer } from "./MatchFormDrawer";

const STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "Agendada",
  confirming: "Confirmando presença",
  drawn: "Sorteada",
  in_progress: "Em andamento",
  completed: "Concluída",
  canceled: "Cancelada",
};

/** Rótulo da partida na listagem: nome próprio quando existir, senão o jogo
 * recorrente de origem, senão "Avulsa" — mesma precedência do `__str__` do
 * model no backend. */
function matchLabel(match: Match): string {
  return match.name || match.recurring_game_name || "Avulsa";
}

export function MatchesPage() {
  const navigate = useNavigate();
  const { currentMembership } = useOrganization();
  const canManage = currentMembership?.role !== "visualizador";
  const { showToast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Match | null>(null);
  const [toDelete, setToDelete] = useState<Match | null>(null);

  const matchesQuery = useApiQuery<Match[]>(matchKeys.list(), matchesApi.list);

  const invalidate = () => {
    queryStore.invalidate(["matches"]);
    queryStore.invalidate(matchKeys.dashboard());
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const createMutation = useApiMutation(matchesApi.create, {
    onSuccess: () => {
      invalidate();
      closeForm();
      showToast("Partida criada.");
    },
  });

  const updateMutation = useApiMutation(
    ({ id, payload }: { id: number; payload: MatchWritePayload }) => matchesApi.update(id, payload),
    {
      onSuccess: (updated) => {
        invalidate();
        closeForm();
        // O backend executa na hora um sorteio automático que ficou vencido
        // (ex.: a edição acabou de habilitar um horário que já passou) — a
        // resposta do PATCH já volta como "Sorteada" e o aviso explica o pulo.
        if (updated.status === "drawn" && editing?.status !== "drawn") {
          showToast("🤖 Partida atualizada — o sorteio automático configurado já venceu e foi executado!");
        } else {
          showToast("Partida atualizada.");
        }
      },
    },
  );

  const deleteMutation = useApiMutation(matchesApi.remove, {
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast("Partida removida.");
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível remover a partida."), "error"),
  });

  const handleSubmit = async (payload: MatchWritePayload) => {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
    } catch {
      /* a mensagem aparece no alerta do drawer */
    }
  };

  const columns: DataTableColumn<Match>[] = [
    {
      key: "name",
      label: "Partida",
      sortValue: (m) => matchLabel(m),
      render: (match) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {matchLabel(match)}
          </Typography>
          {match.location && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {match.location}
            </Typography>
          )}
          <DivergenceWarning
            compact
            divergences={match.recurring_game_divergences}
            recurringGameName={match.recurring_game_name}
          />
        </>
      ),
    },
    {
      key: "scheduled_date",
      label: "Data",
      sortValue: (m) => m.scheduled_date,
      render: (match) => formatMatchDate(match.scheduled_date),
    },
    {
      key: "scheduled_time",
      label: "Horário",
      render: (match) => (
        <>
          <Typography variant="body2">{formatTime(match.scheduled_time)}</Typography>
          {/* Só as partidas com agendamento válido sinalizam o sorteio
              automático; a avulsa sem horário de sorteio não mostra nada. */}
          {match.automatic_draw && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              🤖 Sorteio {match.effective_draw_time && formatTime(match.effective_draw_time)}
            </Typography>
          )}
        </>
      ),
    },
    {
      key: "confirmed_count",
      label: "Confirmados",
      sortValue: (m) => m.confirmed_count,
      render: (match) => (
        <>
          <Typography variant="body2">
            {match.confirmed_count} / {match.capacity.max_players}
          </Typography>
          {match.waitlist_count > 0 && (
            <Typography variant="caption" color="warning.main">
              ⏳ {match.waitlist_count} na espera
            </Typography>
          )}
        </>
      ),
    },
    {
      key: "teams_count",
      label: "Configuração",
      render: (match) =>
        `${match.capacity.teams_count} times × (${match.capacity.line_players_per_team}${goalkeepersSuffixShort(match.capacity.goalkeepers_per_team)})`,
    },
    {
      key: "status",
      label: "Status",
      render: (match) => (
        <StatusChip label={STATUS_LABELS[match.status]} tone={matchStatusTone(match.status)} />
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "Ações",
            align: "right" as const,
            render: (match: Match) => (
              <>
                <Tooltip title="Editar">
                  <IconButton
                    size="small"
                    aria-label={`Editar partida de ${match.scheduled_date}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing(match);
                      setFormOpen(true);
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remover">
                  <IconButton
                    size="small"
                    aria-label={`Remover partida de ${match.scheduled_date}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setToDelete(match);
                    }}
                  >
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
        title="Partidas"
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
              Nova partida
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={matchesQuery.data}
        getRowKey={(match) => match.id}
        loading={matchesQuery.isLoading}
        error={
          matchesQuery.isError
            ? getApiErrorMessage(matchesQuery.error, "Não foi possível carregar as partidas.")
            : null
        }
        onRetry={() => matchesQuery.refetch()}
        onRowClick={(match) => navigate(`/partidas/${match.id}`)}
        emptyMessage="Nenhuma partida encontrada."
        emptyAction={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Criar a primeira partida
            </Button>
          ) : undefined
        }
        defaultSortKey="scheduled_date"
        renderCard={(match) => (
          <MatchCard
            match={match}
            label={matchLabel(match)}
            canManage={canManage}
            onOpen={(m) => navigate(`/partidas/${m.id}`)}
            onEdit={(m) => {
              setEditing(m);
              setFormOpen(true);
            }}
            onDelete={setToDelete}
          />
        )}
      />

      <MatchFormDrawer
        open={formOpen}
        onClose={closeForm}
        onSubmit={handleSubmit}
        match={editing}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        error={
          createMutation.isError || updateMutation.isError
            ? getApiErrorMessage(
                createMutation.error ?? updateMutation.error,
                "Não foi possível salvar a partida.",
              )
            : null
        }
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Remover partida"
        description={
          toDelete
            ? `Tem certeza que deseja remover a partida de ${formatMatchDate(
                toDelete.scheduled_date,
              )}? O histórico de sorteios é preservado e, se ela veio de um jogo recorrente, não será recriada automaticamente.`
            : ""
        }
        confirmLabel="Remover"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </AppLayout>
  );
}
