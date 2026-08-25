import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Grid, Stack, Typography } from "@mui/material";

import { dashboardApi } from "../../api/dashboardApi";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import type { DashboardSummary } from "../../core/types/match";
import { AppLayout } from "../../shared/layout/AppLayout";
import { EmptyState } from "../../shared/components/EmptyState";
import { PageHeader } from "../../shared/components/PageHeader";
import { PageSkeleton } from "../../shared/components/PageSkeleton";
import { StatTile } from "../../shared/components/StatTile";
import { FinanceIcon, MatchesIcon, PlayersIcon } from "../../shared/icons";
import { matchKeys } from "../matches/matchQueries";
import { NextMatchHeroCard } from "./NextMatchHeroCard";
import { PendingTasksCard } from "./PendingTasksCard";

/** Valor monetário do backend (string decimal) no formato brasileiro. */
function money(value: string | undefined): string {
  if (value === undefined) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Dashboard.
 *
 * A versão anterior eram **seis cartões de peso visual idêntico**: "Próxima
 * partida" (só a data) tinha o mesmo destaque de "Convidados". Não havia
 * hierarquia — e portanto não havia resposta rápida para a pergunta que traz a
 * pessoa aqui.
 *
 * A ordem agora é a da urgência real: o jogo de hoje (ou o próximo) → o que
 * está travado → o elenco → o dinheiro.
 */
export function DashboardPage() {
  const navigate = useNavigate();

  const summaryQuery = useApiQuery<DashboardSummary>(matchKeys.dashboard(), dashboardApi.summary);

  const summary = summaryQuery.data;
  const nextMatch = summary?.next_match ?? null;
  const finance = summary?.finance ?? null;

  if (summaryQuery.isLoading) {
    return (
      <AppLayout>
        <PageSkeleton rows={2} stats={4} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader title="Início" />

      {summaryQuery.isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => summaryQuery.refetch()}>
              Tentar novamente
            </Button>
          }
        >
          {getApiErrorMessage(summaryQuery.error, "Não foi possível carregar o resumo.")}
        </Alert>
      )}

      <Stack spacing={2}>
        {nextMatch && (
          <NextMatchHeroCard
            match={nextMatch}
            isToday={!!summary?.is_today}
            onOpen={() => navigate(`/partidas/${nextMatch.id}`)}
          />
        )}

        {summary?.pending && summary.pending.length > 0 && (
          <PendingTasksCard
            items={summary.pending}
            onOpenMatch={(matchId) => navigate(`/partidas/${matchId}`)}
          />
        )}

        {!summaryQuery.isLoading && !nextMatch && (
          <EmptyState
            icon={MatchesIcon}
            title="Nenhuma partida agendada"
            description="Cadastre um jogo recorrente para as partidas nascerem sozinhas toda semana, ou crie uma partida avulsa."
            action={
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="contained" onClick={() => navigate("/jogos-recorrentes")}>
                  Criar jogo recorrente
                </Button>
                <Button variant="outlined" onClick={() => navigate("/partidas")}>
                  Criar partida avulsa
                </Button>
              </Stack>
            }
          />
        )}

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Elenco
          </Typography>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 4 }}>
              <StatTile
                label="Ativos"
                value={summary?.players.ativos ?? "—"}
                icon={PlayersIcon}
                onClick={() => navigate("/jogadores")}
              />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <StatTile
                label="Mensalistas"
                value={summary?.players.mensalistas ?? "—"}
                onClick={() => navigate("/jogadores")}
              />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <StatTile
                label="Convidados"
                value={summary?.players.convidados ?? "—"}
                onClick={() => navigate("/jogadores")}
              />
            </Grid>
          </Grid>
        </Box>

        {/* O bloco financeiro só existe quando o servidor o envia — quem não
            tem `financial.view` não recebe o dado, nem escondido. */}
        {finance && (
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Financeiro do mês
            </Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, md: 4 }}>
                <StatTile
                  label="Arrecadado"
                  value={money(finance.total_received)}
                  tone="success"
                  icon={FinanceIcon}
                  onClick={() => navigate("/financeiro")}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 4 }}>
                <StatTile
                  label="Em aberto"
                  value={money(finance.total_outstanding)}
                  tone="warning"
                  onClick={() => navigate("/financeiro")}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <StatTile
                  label="Saldo"
                  value={money(finance.balance)}
                  tone={Number(finance.balance) < 0 ? "danger" : "default"}
                  onClick={() => navigate("/financeiro")}
                />
              </Grid>
            </Grid>
          </Box>
        )}
      </Stack>
    </AppLayout>
  );
}
