import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";

import { AutomaticIcon, DateIcon, LocationIcon, ScheduleIcon } from "../../shared/icons";
import { goalkeepersSuffix } from "../../core/capacityLabel";
import { formatMatchDate, formatTime } from "../../core/dateTime";

import type { Match } from "../../core/types/match";

interface NextMatchHeroCardProps {
  match: Match;
  isToday: boolean;
  onOpen: () => void;
}

/**
 * Card-herói da próxima partida.
 *
 * Antes esta informação era um cartão de métrica igual aos outros cinco,
 * mostrando **apenas a data** — sem horário, sem local, sem ocupação. É a
 * pergunta que traz a pessoa ao sistema ("quando é o próximo jogo e quantos já
 * confirmaram?") e agora ela é respondida inteira, de relance.
 */
export function NextMatchHeroCard({ match, isToday, onOpen }: NextMatchHeroCardProps) {
  const { capacity } = match;
  const occupancy = Math.min(100, (match.confirmed_count / Math.max(1, capacity.max_players)) * 100);
  const isFull = match.confirmed_count >= capacity.max_players;
  const missing = Math.max(0, capacity.min_players - match.confirmed_count);

  return (
    <Card
      sx={{
        borderTop: "4px solid",
        borderTopColor: isToday ? "warning.main" : "primary.main",
      }}
    >
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
          <Typography variant="overline" color={isToday ? "warning.main" : "primary.main"}>
            {isToday ? "Hoje" : "Próxima partida"}
          </Typography>
          {match.automatic_draw && match.effective_draw_time && (
            <Chip
              size="small"
              variant="outlined"
              icon={<AutomaticIcon />}
              label={`Sorteio ${formatTime(match.effective_draw_time)}`}
            />
          )}
        </Stack>

        <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
          {match.name || match.recurring_game_name || "Partida"}
        </Typography>

        <Stack spacing={0.25} sx={{ mb: 2 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, color: "text.secondary" }}>
            <DateIcon fontSize="small" />
            <Typography variant="body2">{formatMatchDate(match.scheduled_date)}</Typography>
            <ScheduleIcon fontSize="small" sx={{ ml: 0.5 }} />
            <Typography variant="body2">{formatTime(match.scheduled_time)}</Typography>
          </Stack>
          {match.location && (
            <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, color: "text.secondary" }}>
              <LocationIcon fontSize="small" />
              <Typography variant="body2">{match.location}</Typography>
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            {capacity.teams_count} times × ({capacity.line_players_per_team} de linha
            {goalkeepersSuffix(capacity.goalkeepers_per_team)})
          </Typography>
        </Stack>

        <Box sx={{ mb: 2 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {match.confirmed_count} de {capacity.max_players} confirmados
            </Typography>
            {match.waitlist_count > 0 && (
              <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>
                {match.waitlist_count} na espera
              </Typography>
            )}
          </Stack>
          <LinearProgress
            variant="determinate"
            value={occupancy}
            color={isFull ? "warning" : "primary"}
            sx={{ height: 8, borderRadius: 4 }}
            aria-label={`${match.confirmed_count} de ${capacity.max_players} vagas preenchidas`}
          />
          {/* O motivo de o sorteio não estar liberado fica **na tela**, não num
              tooltip: em toque não existe hover. */}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
            {missing > 0
              ? `Faltam ${missing} para o mínimo de ${capacity.min_players} e liberar o sorteio.`
              : "Mínimo atingido — o sorteio pode ser realizado."}
          </Typography>
        </Box>

        <Button variant="contained" size="large" fullWidth onClick={onOpen}>
          Abrir partida
        </Button>
      </CardContent>
    </Card>
  );
}
