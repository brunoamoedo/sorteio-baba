import { Fragment, useMemo, useRef } from "react";
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import {
  Box,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { AutomaticIcon, PrintIcon, TrophyIcon } from "../../shared/icons";
import { useToast } from "../../shared/components/ToastProvider";
import { formatTimestamp } from "../../core/dateTime";
import { exportPngFile, exportSvgFile, shareResult } from "./exportUtils";
import { ManualMovesNotes } from "./ManualMovesNotes";
import { formatDrawResultMessage, getPlayerDisplayName, getTeamLabel } from "./shareFormat";
import { TeamResultCard } from "./TeamResultCard";
import { skillSpread, teamSkillTotals, type ManualMove } from "./teamComposition";
import { WhatsAppShareCard } from "./WhatsAppShareCard";

import type { Draw, Team, TeamPlayer } from "../../core/types/draw";

interface DrawResultSectionProps {
  /** Sorteio exibido — o vigente ou uma versão do histórico. */
  draw: Draw;
  /** Todos os sorteios desta partida, para o seletor de versões. */
  history: Draw[];
  currentDrawId: number | undefined;
  selectedDrawId: number | null;
  onSelectDraw: (drawId: number) => void;
  /** Só o sorteio vigente aceita edição. */
  canEditTeams: boolean;
  isViewingCurrent: boolean;
  // -- Arrastar (desktop) --
  sensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  draggedPlayer: TeamPlayer | null;
  // -- Seleção por toque --
  selectedTeamPlayerId: number | null;
  isAwaitingTarget: boolean;
  onSelectPlayer?: (teamPlayer: TeamPlayer, teamId: number) => void;
  onChangeFormation?: (team: Team) => void;
  // -- Observações das alterações manuais --
  manualMoves: ManualMove[];
  manualBaseline: number[] | null;
}

/**
 * Resultado do sorteio: seletor de versões, cards dos times com o campo em
 * SVG, observações das alterações manuais e a mensagem para o WhatsApp.
 *
 * Extraída de `MatchDetailPage`. O que é **exclusivo** desta seção mora aqui —
 * as referências dos SVGs (usadas só na exportação e no compartilhamento), o
 * texto do WhatsApp, o indicador de equilíbrio e os avisos de cópia. O pai só
 * passa o que ele mesmo controla: o sorteio, os sensores de arrasto e o estado
 * da seleção por toque.
 */
export function DrawResultSection({
  draw,
  history,
  currentDrawId,
  selectedDrawId,
  onSelectDraw,
  canEditTeams,
  isViewingCurrent,
  sensors,
  onDragStart,
  onDragEnd,
  onDragCancel,
  draggedPlayer,
  selectedTeamPlayerId,
  isAwaitingTarget,
  onSelectPlayer,
  onChangeFormation,
  manualMoves,
  manualBaseline,
}: DrawResultSectionProps) {
  const { showToast } = useToast();

  /** Um `<svg>` por time — a fonte da exportação em SVG/PNG e das imagens do
   * compartilhamento nativo. Vive aqui porque só esta seção usa. */
  const svgRefs = useRef<Map<number, SVGSVGElement>>(new Map());

  const shareText = useMemo(() => formatDrawResultMessage(draw.teams), [draw.teams]);

  /** Equilíbrio em linguagem de organizador.
   *
   * `Equilíbrio: 4.25` é um número sem unidade nem referência — não diz se
   * está bom. A diferença de estrelas entre o time mais forte e o mais fraco,
   * sim. O número técnico fica no `title`, para quem quiser. */
  const balance = useMemo(() => {
    const spread = skillSpread(teamSkillTotals(draw.teams));
    if (spread === 0) return { text: "Times equilibrados", tone: "success.main" as const };
    if (spread <= 2) {
      return {
        text: `Times equilibrados — diferença de ${spread} estrela${spread > 1 ? "s" : ""}`,
        tone: "success.main" as const,
      };
    }
    if (spread <= 4) {
      return {
        text: `Diferença de ${spread} estrelas entre os times`,
        tone: "text.secondary" as const,
      };
    }
    return { text: `Times desiguais — ${spread} estrelas de diferença`, tone: "warning.main" as const };
  }, [draw.teams]);

  return (
    <>
      {/* Seletor de versões. Eram chips com data e hora completas: com quatro
          sorteios eles ocupavam três linhas de 32px no celular. */}
      {history.length > 1 && (
        <Box className="no-print" sx={{ mb: 2 }}>
          <TextField
            select
            fullWidth
            size="small"
            label="Versão do sorteio"
            value={selectedDrawId ?? currentDrawId ?? ""}
            onChange={(event) => onSelectDraw(Number(event.target.value))}
            sx={{ maxWidth: { sm: 340 } }}
          >
            {history.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {formatTimestamp(item.created_at)}
                {item.is_current ? " (atual)" : ""}
                {item.formation ? ` · ${item.formation}` : ""}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, gap: 1, mb: 2 }}
      >
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap", rowGap: 0.5 }}>
          <TrophyIcon sx={{ color: "warning.main" }} />
          <Typography variant="h2" component="h2">
            Resultado do sorteio
          </Typography>
          {draw.trigger === "automatic" && (
            <Chip icon={<AutomaticIcon />} label="Automático" size="small" color="success" />
          )}
          {!isViewingCurrent && (
            <Chip label="Versão histórica — somente leitura" size="small" color="warning" />
          )}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }} className="no-print">
          <Typography
            variant="body2"
            color={balance.tone}
            sx={{ fontWeight: 600 }}
            title={`Equilíbrio: ${draw.score_balance.toFixed(2)} · Repetição: ${draw.score_repetition.toFixed(2)}`}
          >
            {balance.text}
          </Typography>
          <Tooltip title="Imprimir">
            <IconButton size="small" onClick={() => window.print()} aria-label="Imprimir resultado">
              <PrintIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            flexWrap: "wrap",
            alignItems: "stretch",
            gap: 2,
          }}
        >
          {draw.teams.map((team, teamIndex) => (
            <Fragment key={team.id}>
              {teamIndex > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 auto",
                    fontWeight: 800,
                    color: "text.secondary",
                  }}
                  aria-hidden
                >
                  ⚽ VS ⚽
                </Box>
              )}
              <Box sx={{ flex: "1 1 300px", minWidth: 0 }}>
                <TeamResultCard
                  team={team}
                  teamIndex={teamIndex}
                  readOnly={!canEditTeams}
                  selectedTeamPlayerId={selectedTeamPlayerId}
                  isAwaitingTarget={isAwaitingTarget}
                  onSelectPlayer={onSelectPlayer}
                  onChangeFormation={onChangeFormation}
                  svgRef={(el) => {
                    if (el) svgRefs.current.set(team.id, el);
                    else svgRefs.current.delete(team.id);
                  }}
                  onExportSvg={() => {
                    const svg = svgRefs.current.get(team.id);
                    if (svg) exportSvgFile(svg, `${getTeamLabel(teamIndex)}.svg`);
                  }}
                  onExportPng={() => {
                    const svg = svgRefs.current.get(team.id);
                    if (svg) void exportPngFile(svg, `${getTeamLabel(teamIndex)}.png`);
                  }}
                />
              </Box>
            </Fragment>
          ))}
        </Box>

        {/* A prévia do arrasto vive **fora** do campo (portal do dnd-kit):
            um `<g>` do SVG some ao cruzar a borda do próprio campo, então
            o jogador desaparecia justamente no caminho para o outro time. */}
        <DragOverlay dropAnimation={null}>
          {draggedPlayer && (
            <Chip
              label={`${getPlayerDisplayName(draggedPlayer)} · ${"★".repeat(draggedPlayer.skill_snapshot)}`}
              color="primary"
              sx={{ fontWeight: 800, cursor: "grabbing", boxShadow: 8, pointerEvents: "none" }}
            />
          )}
        </DragOverlay>
      </DndContext>

      <ManualMovesNotes moves={manualMoves} teams={draw.teams} baselineTotals={manualBaseline} />

      <WhatsAppShareCard
        text={shareText}
        onCopied={() => showToast("Texto copiado para o WhatsApp!")}
        onCopyFallback={() =>
          showToast("Texto selecionado — use Ctrl+C (ou toque e segure) para copiar.", "info")
        }
        onShare={() => void shareResult(shareText, Array.from(svgRefs.current.values()))}
      />
    </>
  );
}
