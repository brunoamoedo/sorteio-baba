import { useCallback, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Box, useTheme } from "@mui/material";

import { computeFieldLayout } from "../../core/fieldLayout";
import { parseFormation } from "../../core/formations";
import { PALETTE } from "../../shared/theme/tokens";
import { PlayerToken } from "./PlayerToken";
import type { TeamPlayer } from "../../core/types/draw";

interface FootballPitchProps {
  teamId: number;
  /** Nome do time, usado no rótulo acessível e no aviso de área de destino. */
  teamLabel?: string;
  players: TeamPlayer[];
  /** Formação do time (`"2-2-2"`). Vazio desenha pelo `sort_order` da posição. */
  formation?: string;
  svgRef?: (el: SVGSVGElement | null) => void;
  readOnly?: boolean;
  /** Jogador em modo de seleção — o alvo do próximo toque. */
  selectedTeamPlayerId?: number | null;
  onSelectPlayer?: (teamPlayer: TeamPlayer) => void;
}

/**
 * Campo em SVG.
 *
 * ## Dimensões
 *
 * `120 × 170` (era `100 × 140`): mais largura relativa dá espaço aos nomes, que
 * se sobrepunham em linhas de 4+. E o campo passou a ser **fluido** — o
 * `maxWidth: 240` fixo desperdiçava a largura do celular: num aparelho de
 * 375px havia 343px úteis e o campo usava 240, deixando o nome do jogador em
 * ~9px efetivos. Agora o teto só existe em telas grandes, onde o card já é
 * estreito por outros motivos.
 */
const VIEWBOX_WIDTH = 120;
const VIEWBOX_HEIGHT = 170;

export function FootballPitch({
  teamId,
  teamLabel,
  players,
  formation,
  svgRef,
  readOnly,
  selectedTeamPlayerId,
  onSelectPlayer,
}: FootballPitchProps) {
  const theme = useTheme();
  const colors = PALETTE[theme.palette.mode === "dark" ? "dark" : "light"];

  const { setNodeRef, isOver } = useDroppable({
    id: `team-${teamId}`,
    data: { teamId },
    disabled: readOnly,
  });

  // O mesmo nó precisa ser a área de drop **e** a referência de exportação.
  // `setNodeRef` do dnd-kit é tipado para HTMLElement, mas aceita qualquer nó
  // do DOM — e o alvo de drop é o próprio `<svg>`.
  const attachRef = useCallback(
    (element: SVGSVGElement | null) => {
      setNodeRef(element as unknown as HTMLElement | null);
      svgRef?.(element);
    },
    [setNodeRef, svgRef],
  );

  const lines = useMemo(() => (formation ? parseFormation(formation) : null), [formation]);

  // Goleiro ganha faixa própria quando existe alguém na posição GOL — a
  // formação nunca o conta.
  const hasGoalkeeper = useMemo(
    () => players.some((player) => player.position_snapshot?.code?.toUpperCase() === "GOL"),
    [players],
  );

  const positioned = useMemo(
    () =>
      computeFieldLayout(
        players.map((player) => ({
          id: player.id,
          positionSortOrder: player.position_snapshot?.sort_order ?? 0,
          lineIndex: player.line_index,
          slotIndex: player.slot_index,
          source: player,
        })),
        { lines, hasGoalkeeperLine: hasGoalkeeper },
      ),
    [players, lines, hasGoalkeeper],
  );

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        // Fluido no celular; teto só onde a tela é larga o bastante para o
        // campo competir com o resto do card.
        maxWidth: { xs: "100%", md: 320 },
        mx: "auto",
        borderRadius: 1,
        overflow: "hidden",
        outline: isOver && !readOnly ? "3px solid" : "none",
        outlineColor: "primary.main",
        transition: "outline-color 120ms, box-shadow 120ms",
        boxShadow: isOver && !readOnly ? 6 : 0,
      }}
    >
      <Box
        component="svg"
        ref={attachRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        // `role="group"`, não `role="img"`: com `img`, várias tecnologias
        // assistivas removem os descendentes da árvore de acessibilidade — e os
        // jogadores, que são elementos interativos, simplesmente sumiam.
        role="group"
        data-team-id={teamId}
        data-testid={`pitch-${teamId}`}
        aria-label={`${teamLabel ? `${teamLabel}: ` : ""}campo com ${players.length} jogadores${
          formation ? `, formação ${formation}` : ""
        }`}
        sx={{ display: "block", width: "100%", height: "auto", touchAction: "manipulation" }}
      >
        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill={colors.pitchGrass} />
        {/* Faixas do gramado — puramente decorativas. */}
        {Array.from({ length: 9 }).map((_, index) => (
          <rect
            key={index}
            x="0"
            y={index * 20}
            width={VIEWBOX_WIDTH}
            height="10"
            fill={colors.pitchStripe}
            opacity="0.5"
          />
        ))}

        {/* Marcações: meio-campo em cima (o campo é a metade defendida por este
            time), grande área e gol embaixo. */}
        <rect
          x="1.5"
          y="1.5"
          width={VIEWBOX_WIDTH - 3}
          height={VIEWBOX_HEIGHT - 3}
          fill="none"
          stroke={colors.pitchLine}
          strokeWidth="0.7"
        />
        <line x1="1.5" y1="10" x2={VIEWBOX_WIDTH - 1.5} y2="10" stroke={colors.pitchLine} strokeWidth="0.5" />
        <circle cx={VIEWBOX_WIDTH / 2} cy="10" r="14" fill="none" stroke={colors.pitchLine} strokeWidth="0.5" />
        <rect x="30" y="139" width="60" height="28" fill="none" stroke={colors.pitchLine} strokeWidth="0.5" />
        <rect x="45" y="158" width="30" height="9" fill="none" stroke={colors.pitchLine} strokeWidth="0.5" />
        <rect x="51" y="166" width="18" height="3" fill={colors.pitchGoal} stroke={colors.pitchLine} strokeWidth="0.5" />

        {/* Rótulo da formação **dentro** do SVG: é o que faz ele aparecer no
            PNG exportado e na impressão. */}
        {formation && (
          <text
            x="4"
            y="7"
            fontSize="5"
            fontWeight="700"
            fill={colors.pitchLine}
            opacity="0.85"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {formation}
          </text>
        )}

        {positioned.map((entry) => (
          <PlayerToken
            key={entry.id}
            teamPlayer={entry.source}
            teamId={teamId}
            x={(entry.x / 100) * VIEWBOX_WIDTH}
            y={(entry.y / 100) * VIEWBOX_HEIGHT}
            nameSize={entry.nameSize}
            maxChars={entry.maxChars}
            isGuest={entry.source.player_type === "convidado"}
            readOnly={readOnly}
            isSelected={selectedTeamPlayerId === entry.source.id}
            onSelect={onSelectPlayer}
          />
        ))}

        {/* Confirmação visual de "solte aqui", desenhada por cima de tudo.
            Só existe durante o arrasto, então nunca entra na exportação. */}
        {isOver && !readOnly && (
          <>
            <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#ffffff" opacity="0.18" />
            <rect
              x="2"
              y="2"
              width={VIEWBOX_WIDTH - 4}
              height={VIEWBOX_HEIGHT - 4}
              fill="none"
              stroke="#ffd54f"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
            {/* O contorno sozinho não diz o que vai acontecer. */}
            <text
              x={VIEWBOX_WIDTH / 2}
              y={VIEWBOX_HEIGHT / 2}
              textAnchor="middle"
              fontSize="7"
              fontWeight="800"
              fill="#ffffff"
              stroke="rgba(0,0,0,0.6)"
              strokeWidth="1.4"
              paintOrder="stroke"
              fontFamily="Inter, system-ui, sans-serif"
            >
              Soltar aqui
            </text>
          </>
        )}
      </Box>
    </Box>
  );
}
