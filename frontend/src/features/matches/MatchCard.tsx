import { Box, Card, CardActionArea, CardContent, LinearProgress, Stack, Typography } from "@mui/material";

import { AutomaticIcon, DateIcon, DeleteIcon, EditIcon, LocationIcon } from "../../shared/icons";
import { OverflowMenu } from "../../shared/components/OverflowMenu";
import { StatusChip, matchStatusTone } from "../../shared/components/StatusChip";
import { goalkeepersSuffixShort } from "../../core/capacityLabel";
import { formatMatchDate, formatTime } from "../../core/dateTime";
import { DivergenceWarning } from "./DivergenceWarning";

import type { Match, MatchStatus } from "../../core/types/match";

const STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "Agendada",
  confirming: "Confirmando presença",
  drawn: "Sorteada",
  in_progress: "Em andamento",
  completed: "Concluída",
  canceled: "Cancelada",
};

interface MatchCardProps {
  match: Match;
  label: string;
  canManage: boolean;
  onOpen: (match: Match) => void;
  onEdit: (match: Match) => void;
  onDelete: (match: Match) => void;
}

/** Partida como card. A ocupação vira barra de progresso — no celular, "14/18"
 * com uma barra é lido de relance, enquanto a mesma informação numa célula de
 * tabela exige procurar a coluna. */
export function MatchCard({ match, label, canManage, onOpen, onEdit, onDelete }: MatchCardProps) {
  const { capacity } = match;
  const occupancy = Math.min(100, (match.confirmed_count / Math.max(1, capacity.max_players)) * 100);
  const isFull = match.confirmed_count >= capacity.max_players;

  return (
    <Card>
      <CardActionArea onClick={() => onOpen(match)} sx={{ alignItems: "stretch" }}>
        <CardContent sx={{ py: 1.75 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
                {label}
              </Typography>

              <Stack
                direction="row"
                sx={{ alignItems: "center", gap: 0.5, color: "text.secondary", mt: 0.25 }}
              >
                <DateIcon sx={{ fontSize: 14 }} />
                <Typography variant="caption">
                  {formatMatchDate(match.scheduled_date)} · {formatTime(match.scheduled_time)}
                </Typography>
              </Stack>

              {match.location && (
                <Stack
                  direction="row"
                  sx={{ alignItems: "center", gap: 0.5, color: "text.secondary" }}
                >
                  <LocationIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption" noWrap>
                    {match.location}
                  </Typography>
                </Stack>
              )}

              {/* Só partidas com agendamento válido sinalizam o automático — a
                  avulsa sem horário de sorteio não mostra nada. */}
              {match.automatic_draw && match.effective_draw_time && (
                <Stack
                  direction="row"
                  sx={{ alignItems: "center", gap: 0.5, color: "text.secondary" }}
                >
                  <AutomaticIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">
                    Sorteio automático às {formatTime(match.effective_draw_time)}
                  </Typography>
                </Stack>
              )}
            </Box>

            <Stack sx={{ alignItems: "flex-end", gap: 0.5, flexShrink: 0 }}>
              <StatusChip label={STATUS_LABELS[match.status]} tone={matchStatusTone(match.status)} />
            </Stack>
          </Stack>

          <Box sx={{ mt: 1.5 }}>
            <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {match.confirmed_count} de {capacity.max_players} confirmados
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {capacity.teams_count} times × ({capacity.line_players_per_team}
                {goalkeepersSuffixShort(capacity.goalkeepers_per_team)})
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={occupancy}
              color={isFull ? "warning" : "primary"}
              aria-label={`${match.confirmed_count} de ${capacity.max_players} vagas preenchidas`}
            />
            {match.waitlist_count > 0 && (
              <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: "block" }}>
                {match.waitlist_count} na lista de espera
              </Typography>
            )}
          </Box>

          <DivergenceWarning
            compact
            divergences={match.recurring_game_divergences}
            recurringGameName={match.recurring_game_name}
          />
        </CardContent>
      </CardActionArea>

      {canManage && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", px: 1, pb: 0.5, mt: -1 }}>
          <OverflowMenu
            label={`Ações da partida ${label}`}
            actions={[
              { label: "Editar", icon: EditIcon, onClick: () => onEdit(match) },
              {
                label: "Remover",
                icon: DeleteIcon,
                destructive: true,
                onClick: () => onDelete(match),
              },
            ]}
          />
        </Box>
      )}
    </Card>
  );
}
