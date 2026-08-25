import { useState } from "react";
import { Box, Card, CardContent, Collapse, Divider, Stack, Typography } from "@mui/material";

import { ExpandIcon } from "../../shared/icons";
import { StatusChip } from "../../shared/components/StatusChip";

import type { PlayerStatistics } from "../../core/types/statistics";

interface PlayerStatsCardProps {
  stats: PlayerStatistics;
}

function percent(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function orDash(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.4 }}>
        {label}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Estatísticas de um jogador como card.
 *
 * A tabela equivalente tem **12 colunas** — em 375px eram cerca de cinco telas
 * de rolagem lateral para ler uma linha. O card mostra as quatro métricas que
 * respondem "como esse jogador vai" e guarda o resto atrás de um toque; nada
 * é removido, só hierarquizado.
 */
export function PlayerStatsCard({ stats }: PlayerStatsCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
            {stats.name}
          </Typography>
          {stats.current_streak_type && stats.current_streak_length > 1 && (
            <StatusChip
              label={`${stats.current_streak_length}${stats.current_streak_type === "win" ? "V" : "D"} seguidas`}
              tone={stats.current_streak_type === "win" ? "success" : "default"}
            />
          )}
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 1,
          }}
        >
          <Metric label="Jogos" value={String(stats.matches_played)} />
          <Metric label="Vitórias" value={String(stats.wins)} />
          <Metric label="Derrotas" value={String(stats.losses)} />
          <Metric label="Aprov." value={percent(stats.win_rate)} />
        </Box>

        <Box
          component="button"
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          sx={{
            mt: 1,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            border: 0,
            background: "none",
            px: 0.5,
            // Alvo mínimo de toque, como nos `Button` do tema — um "botão de
            // texto" montado à mão não herda o override.
            minHeight: 44,
            color: "primary.main",
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {open ? "Menos detalhes" : "Mais detalhes"}
          <ExpandIcon
            fontSize="small"
            sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
          />
        </Box>

        <Collapse in={open} unmountOnExit>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1.5 }}>
            <Metric label="Empates" value={String(stats.draws)} />
            <Metric label="Presenças" value={String(stats.presences)} />
            <Metric label="Ausências" value={String(stats.absences)} />
            <Metric label="Maior seq. vitórias" value={String(stats.longest_win_streak)} />
            <Metric label="Maior seq. derrotas" value={String(stats.longest_loss_streak)} />
            <Metric label="Média ⭐ dos times" value={orDash(stats.avg_team_skill)} />
            <Metric label="Dias desde o último jogo" value={orDash(stats.days_since_last_match)} />
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
