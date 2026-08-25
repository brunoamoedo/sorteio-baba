import { useMemo } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { Card, CardContent, Typography, useTheme } from "@mui/material";

import { statisticsApi } from "../../api/statisticsApi";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import type { PlayerStatistics } from "../../core/types/statistics";
import { AppLayout } from "../../shared/layout/AppLayout";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { matchKeys } from "../matches/matchQueries";
import { PlayerStatsCard } from "./PlayerStatsCard";

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function StatisticsPage() {
  const theme = useTheme();

  const statsQuery = useApiQuery<PlayerStatistics[]>(matchKeys.statistics(), statisticsApi.players);

  const data = useMemo(() => statsQuery.data ?? [], [statsQuery.data]);

  const topByWins = useMemo(
    () =>
      [...data]
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 5)
        .filter((p) => p.wins > 0),
    [data],
  );

  const columns: DataTableColumn<PlayerStatistics>[] = [
    {
      key: "name",
      label: "Jogador",
      sortValue: (p) => p.name,
      render: (p) => (
        <>
          {p.name}
          {p.current_streak_type && p.current_streak_length > 1 && (
            <StatusChip
              sx={{ ml: 1 }}
              label={`${p.current_streak_length}${p.current_streak_type === "win" ? "V" : "D"} seguidas`}
              tone={p.current_streak_type === "win" ? "success" : "default"}
            />
          )}
        </>
      ),
    },
    { key: "matches_played", label: "Jogos", sortValue: (p) => p.matches_played, render: (p) => p.matches_played },
    { key: "wins", label: "Vitórias", sortValue: (p) => p.wins, render: (p) => p.wins },
    { key: "losses", label: "Derrotas", sortValue: (p) => p.losses, render: (p) => p.losses },
    { key: "draws", label: "Empates", sortValue: (p) => p.draws, render: (p) => p.draws },
    {
      key: "win_rate",
      label: "Aproveitamento",
      sortValue: (p) => p.win_rate,
      render: (p) => formatPercent(p.win_rate),
    },
    { key: "presences", label: "Presenças", sortValue: (p) => p.presences, render: (p) => p.presences },
    { key: "absences", label: "Ausências", sortValue: (p) => p.absences, render: (p) => p.absences },
    {
      key: "longest_win_streak",
      label: "Maior seq. vitórias",
      sortValue: (p) => p.longest_win_streak,
      render: (p) => p.longest_win_streak,
    },
    {
      key: "longest_loss_streak",
      label: "Maior seq. derrotas",
      sortValue: (p) => p.longest_loss_streak,
      render: (p) => p.longest_loss_streak,
    },
    {
      key: "avg_team_skill",
      label: "Média ⭐ dos times",
      sortValue: (p) => p.avg_team_skill,
      render: (p) => formatValue(p.avg_team_skill),
    },
    {
      key: "days_since_last_match",
      label: "Dias desde o último jogo",
      sortValue: (p) => p.days_since_last_match,
      render: (p) => formatValue(p.days_since_last_match),
    },
  ];

  return (
    <AppLayout>
      <PageHeader
        title="Estatísticas"
        description="Aproveitamento = vitórias sobre todas as partidas com placar lançado (empates incluídos)."
      />

      {topByWins.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Ranking de vitórias
            </Typography>
            {/* O gráfico é decoração de uma informação que já está na tabela
                abaixo — que é a alternativa textual real. Descrevê-lo aqui
                evita que um leitor de tela anuncie um SVG mudo. */}
            <BarChart
              height={280}
              xAxis={[{ scaleType: "band", data: topByWins.map((p) => p.nickname || p.name) }]}
              series={[
                { data: topByWins.map((p) => p.wins), label: "Vitórias", color: theme.palette.primary.main },
              ]}
              aria-label={`Ranking de vitórias: ${topByWins
                .map((p) => `${p.nickname || p.name} com ${p.wins}`)
                .join(", ")}. Os mesmos dados estão na tabela abaixo.`}
            />
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={data}
        getRowKey={(p) => p.player_id}
        loading={statsQuery.isLoading}
        error={
          statsQuery.isError
            ? getApiErrorMessage(statsQuery.error, "Não foi possível carregar as estatísticas.")
            : null
        }
        onRetry={() => statsQuery.refetch()}
        size="small"
        emptyMessage="Nenhuma estatística disponível ainda."
        defaultSortKey="wins"
        renderCard={(player) => <PlayerStatsCard stats={player} />}
      />
    </AppLayout>
  );
}
