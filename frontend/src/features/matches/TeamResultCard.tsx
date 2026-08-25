import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";

import { DownloadIcon, FormationIcon, ImageIcon } from "../../shared/icons";
import type { Team, TeamPlayer, TeamResultOutcome } from "../../core/types/draw";
import { StatusChip } from "../../shared/components/StatusChip";
import { FootballPitch } from "./FootballPitch";
import { getPlayerDisplayName, getTeamColor, getTeamLabel } from "./shareFormat";
import { computeTeamMetrics, formatAverage, formationReport } from "./teamComposition";

const RESULT_LABELS: Record<TeamResultOutcome, string> = {
  win: "🏆 Vitória",
  draw: "🤝 Empate",
  loss: "❌ Derrota",
};

const RESULT_COLORS: Record<TeamResultOutcome, "success" | "default" | "error"> = {
  win: "success",
  draw: "default",
  loss: "error",
};

interface TeamResultCardProps {
  team: Team;
  teamIndex: number;
  readOnly: boolean;
  svgRef: (element: SVGSVGElement | null) => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  /** Jogador selecionado no modo de troca por toque. */
  selectedTeamPlayerId?: number | null;
  /** A tela está esperando o alvo de uma troca — muda o texto de ajuda. */
  isAwaitingTarget?: boolean;
  onSelectPlayer?: (teamPlayer: TeamPlayer, teamId: number) => void;
  onChangeFormation?: (team: Team) => void;
}

/** Card de um time no resultado do sorteio: cabeçalho colorido com a
 * identidade do time (mesma cor/emoji usados na mensagem de compartilhamento),
 * a escalação em lista legível — o que se lê no celular à beira do campo — e,
 * abaixo, o campo em SVG (que continua sendo a área de arrastar e soltar e a
 * fonte da exportação em SVG/PNG). */
export function TeamResultCard({
  team,
  teamIndex,
  readOnly,
  svgRef,
  onExportSvg,
  onExportPng,
  selectedTeamPlayerId,
  isAwaitingTarget,
  onSelectPlayer,
  onChangeFormation,
}: TeamResultCardProps) {
  const theme = useTheme();
  // A cor de identidade acompanha o tema: vários dos tons originais sumiam
  // sobre o fundo escuro.
  const accent = getTeamColor(teamIndex, theme.palette.mode === "dark" ? "dark" : "light");
  const result = team.result;
  const label = getTeamLabel(teamIndex);
  // Indicadores derivados da composição **atual** do time: depois de uma
  // movimentação manual eles mudam junto, mesmo que o time fique pior.
  const metrics = computeTeamMetrics(team);
  const formation = formationReport(team);

  return (
    <Card
      data-testid={`team-card-${team.id}`}
      sx={{
        height: "100%",
        borderTop: `4px solid ${accent}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          bgcolor: alpha(accent, 0.12),
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 800, letterSpacing: 0.5 }}>
          🏆 {label.toUpperCase()}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          {result && (
            <Chip
              label={
                result.goals_scored != null
                  ? `${RESULT_LABELS[result.result]} · ${result.goals_scored}`
                  : RESULT_LABELS[result.result]
              }
              size="small"
              color={RESULT_COLORS[result.result]}
            />
          )}
          <Chip label={`${metrics.totalSkill} ⭐`} size="small" variant="outlined" />
        </Stack>
      </Box>

      <CardContent sx={{ flex: 1 }}>
        {/* Indicadores de equilíbrio do time. Recalculados a cada render a
            partir de `team.team_players`, e não lidos de um campo pronto do
            servidor: é o que faz uma movimentação manual aparecer aqui na hora
            — inclusive quando ela desequilibra os times. */}
        <Stack
          direction="row"
          spacing={1.5}
          data-testid={`team-metrics-${team.id}`}
          sx={{ flexWrap: "wrap", rowGap: 0.5, mb: 1.5, color: "text.secondary" }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            👥 {metrics.playerCount} {metrics.playerCount === 1 ? "jogador" : "jogadores"}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            ⭐ Nível total: {metrics.totalSkill}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            ⭐ Média: {formatAverage(metrics.averageSkill)}
          </Typography>
        </Stack>

        {/* Formação do time, com atalho para trocá-la sem sortear de novo. */}
        {formation && (
          <Stack
            direction="row"
            sx={{ alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap", rowGap: 0.5 }}
          >
            <Chip
              icon={<FormationIcon />}
              label={
                formation.unplaced > 0
                  ? `${formation.formation} (+${formation.unplaced})`
                  : formation.formation
              }
              size="small"
              color={formation.satisfied ? "default" : "warning"}
              variant="outlined"
            />
            {!readOnly && onChangeFormation && (
              <Button size="small" onClick={() => onChangeFormation(team)} className="no-print">
                Trocar formação
              </Button>
            )}
          </Stack>
        )}

        <Stack spacing={0.25} sx={{ mb: 2 }} data-testid={`team-roster-${team.id}`}>
          {team.team_players.map((teamPlayer) => {
            const selected = selectedTeamPlayerId === teamPlayer.id;
            const clickable = !readOnly && !!onSelectPlayer;
            return (
              <Box
                key={teamPlayer.id}
                component={clickable ? "button" : "div"}
                type={clickable ? "button" : undefined}
                onClick={clickable ? () => onSelectPlayer(teamPlayer, team.id) : undefined}
                aria-pressed={clickable ? selected : undefined}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 0.5,
                  px: clickable ? 1 : 0,
                  minWidth: 0,
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  border: 0,
                  borderRadius: 1,
                  bgcolor: selected ? "action.selected" : "transparent",
                  outline: selected ? "2px solid" : "none",
                  outlineColor: "primary.main",
                  cursor: clickable ? "pointer" : "default",
                  minHeight: clickable ? 44 : undefined,
                }}
              >
                {/* `span`, não o `<p>` padrão: o chip de convidado é um `<div>`
                    e o React acusava aninhamento inválido no console. */}
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
                >
                  👤 {getPlayerDisplayName(teamPlayer)}
                  {/* Convidado sempre destacado em vermelho — a mesma regra vale
                      no campo em SVG, no PNG exportado e na impressão. */}
                  {teamPlayer.player_type === "convidado" && (
                    <StatusChip label="Convidado" tone="error" sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                  {teamPlayer.position_snapshot?.code ?? "—"} · {teamPlayer.skill_snapshot}⭐
                </Typography>
              </Box>
            );
          })}
          {team.team_players.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nenhum jogador neste time.
            </Typography>
          )}
        </Stack>

        <Box className="no-print" sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
          <Tooltip title="Exportar SVG">
            <IconButton size="small" onClick={onExportSvg} aria-label={`Exportar SVG do ${label}`}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Exportar PNG">
            <IconButton size="small" onClick={onExportPng} aria-label={`Exportar PNG do ${label}`}>
              <ImageIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <FootballPitch
          teamId={team.id}
          teamLabel={label}
          players={team.team_players}
          formation={team.formation}
          readOnly={readOnly}
          svgRef={svgRef}
          selectedTeamPlayerId={selectedTeamPlayerId}
          onSelectPlayer={
            onSelectPlayer ? (teamPlayer) => onSelectPlayer(teamPlayer, team.id) : undefined
          }
        />

        {!readOnly && (
          <Typography
            className="no-print"
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.5, textAlign: "center" }}
          >
            {/* As **duas** formas são descritas. A instrução anterior só citava
                o arrasto — que era, de fato, o único caminho existente. */}
            {isAwaitingTarget
              ? "Agora toque no jogador com quem trocar."
              : "Toque em um jogador para trocar de posição ou de time — ou arraste-o para outro campo."}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
