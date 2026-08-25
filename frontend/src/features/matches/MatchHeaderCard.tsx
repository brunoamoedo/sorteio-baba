import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";

import {
  AutomaticIcon,
  DateIcon,
  ExpandIcon,
  LocationIcon,
  NamesListIcon,
  NotesIcon,
  ScheduleIcon,
  ScoreIcon,
  WaitlistIcon,
} from "../../shared/icons";
import { goalkeepersSuffix } from "../../core/capacityLabel";
import { formatMatchDate, formatTime, formatTimestamp } from "../../core/dateTime";
import { DivergenceWarning } from "./DivergenceWarning";

import type { Match, MatchCapacity } from "../../core/types/match";

interface MatchHeaderCardProps {
  match: Match;
  capacity: MatchCapacity;
  confirmedCount: number;
  waitlistCount: number;
  canManage: boolean;
  /** O sorteio vigente veio do agendamento automático. */
  automaticDrawDone: boolean;
  /** Só aparece quando já existe sorteio. */
  hasDraw: boolean;
  onOpenNamesList: () => void;
  onOpenResults: () => void;
}

/**
 * Cabeçalho da partida: quando, onde e quanta gente.
 *
 * O card anterior empilhava **seis linhas de texto denso** (data, configuração,
 * ocupação, sorteio automático, bloqueio, observações) mais barra de progresso e
 * alertas — em 375px isso passava de 40% da primeira tela antes de qualquer
 * ação, e a informação que importa (quantos confirmaram) ficava no meio do
 * bloco.
 *
 * Agora o essencial fica em duas linhas com métricas em chip, e o resto vai
 * para "ver detalhes". A regra do que **não** pode ser escondido: qualquer
 * coisa que exija ação ou explique um bloqueio — sorteio automático travado,
 * divergência com o jogo recorrente e partida cheia continuam sempre visíveis.
 */
export function MatchHeaderCard({
  match,
  capacity,
  confirmedCount,
  waitlistCount,
  canManage,
  automaticDrawDone,
  hasDraw,
  onOpenNamesList,
  onOpenResults,
}: MatchHeaderCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const isFull = confirmedCount >= capacity.max_players;
  const missing = Math.max(0, capacity.min_players - confirmedCount);
  const occupancy = Math.min(100, (confirmedCount / Math.max(1, capacity.max_players)) * 100);

  return (
    <Card sx={{ mb: 3 }} className="no-print">
      <CardContent>
        <Stack
          direction={{ xs: "column", md: "row" }}
          sx={{ justifyContent: "space-between", alignItems: { md: "flex-start" }, gap: 2 }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {/* Linha 1 — quando e onde. */}
            <Stack
              direction="row"
              sx={{ alignItems: "center", gap: 0.75, flexWrap: "wrap", rowGap: 0.25 }}
            >
              <DateIcon fontSize="small" sx={{ color: "text.secondary" }} />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {formatMatchDate(match.scheduled_date)}
              </Typography>
              <ScheduleIcon fontSize="small" sx={{ color: "text.secondary", ml: 0.5 }} />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {formatTime(match.scheduled_time)}
              </Typography>
              {match.location && (
                <>
                  <LocationIcon fontSize="small" sx={{ color: "text.secondary", ml: 0.5 }} />
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {match.location}
                  </Typography>
                </>
              )}
            </Stack>

            {/* Linha 2 — a métrica que traz o organizador à tela. */}
            <Stack
              direction="row"
              sx={{ alignItems: "center", gap: 0.75, mt: 1, flexWrap: "wrap", rowGap: 0.5 }}
            >
              <Chip
                size="small"
                color={isFull ? "warning" : "default"}
                label={`${confirmedCount} de ${capacity.max_players} confirmados`}
                sx={{ fontWeight: 700 }}
              />
              {waitlistCount > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  icon={<WaitlistIcon />}
                  label={`${waitlistCount} na espera`}
                />
              )}
              {missing > 0 && (
                <Typography variant="caption" color="text.secondary">
                  faltam {missing} para o sorteio
                </Typography>
              )}
            </Stack>
          </Box>

          {canManage && (
            // Lado a lado **também no celular**: empilhados, dois botões curtos
            // custavam ~100px de altura no topo da tela. A ação primária
            // (sortear) mora na barra fixa do rodapé; estas são secundárias.
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "stretch", flexShrink: 0, "& > *": { flex: { xs: 1, md: "0 0 auto" } } }}
              className="no-print"
            >
              <Button variant="outlined" startIcon={<NamesListIcon />} onClick={onOpenNamesList}>
                Lista de nomes
              </Button>
              {hasDraw && (
                <Button variant="outlined" startIcon={<ScoreIcon />} onClick={onOpenResults}>
                  Lançar placar
                </Button>
              )}
            </Stack>
          )}
        </Stack>

        <Box sx={{ mt: 1.5 }}>
          <LinearProgress
            variant="determinate"
            value={occupancy}
            color={isFull ? "warning" : "primary"}
            sx={{ height: 6, borderRadius: 3 }}
            aria-label={`${confirmedCount} de ${capacity.max_players} vagas preenchidas`}
          />
        </Box>

        {/* --- O que nunca é escondido: bloqueio, divergência e lotação. --- */}

        {match.automatic_draw_blocked_reason && (
          <Alert severity="warning" icon={<AutomaticIcon />} sx={{ mt: 2 }}>
            {match.automatic_draw_blocked_reason}
          </Alert>
        )}

        <DivergenceWarning
          divergences={match.recurring_game_divergences}
          recurringGameName={match.recurring_game_name}
        />

        {/* Como texto auxiliar, não `Alert`: a mesma informação num alerta com
            ícone e três linhas de explicação ocupava 133px — um terço da
            primeira tela — para dizer algo que o chip laranja "18 de 18" ao
            lado já sinaliza. Nada foi removido, só encolhido. */}
        {isFull && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1, fontWeight: 600 }}>
            Partida cheia — novas confirmações vão para a lista de espera, ninguém é descartado.
          </Typography>
        )}

        {/* --- O resto, sob demanda. --- */}

        <Box
          component="button"
          type="button"
          onClick={() => setShowDetails((current) => !current)}
          aria-expanded={showDetails}
          sx={{
            mt: 1,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            border: 0,
            background: "none",
            px: 0.5,
            minHeight: 44,
            color: "primary.main",
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showDetails ? "Ocultar detalhes" : "Ver detalhes da partida"}
          <ExpandIcon
            fontSize="small"
            sx={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
          />
        </Box>

        <Collapse in={showDetails} unmountOnExit>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {/* A configuração vem do backend (`capacity`), nunca recalculada
                aqui — é a mesma fonte que o sorteio usa. */}
            <Typography variant="body2" color="text.secondary">
              {capacity.teams_count} times × ({capacity.line_players_per_team} de linha
              {goalkeepersSuffix(capacity.goalkeepers_per_team)}) ={" "}
              <strong>{capacity.max_players} jogadores</strong>
              {capacity.goalkeepers_per_team === 0 && " · goleiro não entra no sorteio"}
            </Typography>

            {/* Só aparece quando o backend diz que a partida tem agendamento
                válido. Partida avulsa sem horário de sorteio não mostra nada. */}
            {match.automatic_draw && (
              <Stack direction="row" sx={{ alignItems: "flex-start", gap: 0.75 }}>
                <AutomaticIcon
                  fontSize="small"
                  sx={{ color: automaticDrawDone ? "success.main" : "text.secondary", mt: 0.25 }}
                />
                <Typography
                  variant="body2"
                  color={automaticDrawDone ? "success.main" : "text.secondary"}
                >
                  Sorteio automático às{" "}
                  {match.effective_draw_time && formatTime(match.effective_draw_time)}
                  {match.automatic_draw_source === "recurring_game" &&
                    ` (do jogo recorrente${match.recurring_game_name ? ` "${match.recurring_game_name}"` : ""})`}
                  {automaticDrawDone && match.draw_executed_at
                    ? ` · executado em ${formatTimestamp(match.draw_executed_at)}`
                    : ""}
                </Typography>
              </Stack>
            )}

            {match.notes && (
              <Stack direction="row" sx={{ alignItems: "flex-start", gap: 0.75 }}>
                <NotesIcon fontSize="small" sx={{ color: "text.secondary", mt: 0.25 }} />
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line" }}>
                  {match.notes}
                </Typography>
              </Stack>
            )}
          </Stack>
        </Collapse>
      </CardContent>
    </Card>
  );
}
