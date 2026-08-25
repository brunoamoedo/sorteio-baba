import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";

import type { TeamPlayer } from "../../core/types/draw";

interface PlayerTokenProps {
  teamPlayer: TeamPlayer;
  teamId: number;
  /** Coordenadas em unidades do viewBox do campo. */
  x: number;
  y: number;
  /** Tamanho da fonte do nome — calculado pela lotação da linha. */
  nameSize: number;
  /** Máximo de caracteres antes de truncar — idem. */
  maxChars: number;
  isGuest: boolean;
  readOnly?: boolean;
  /** Está selecionado no modo de troca por toque. */
  isSelected?: boolean;
  onSelect?: (teamPlayer: TeamPlayer) => void;
}

function displayName(teamPlayer: TeamPlayer, maxChars: number): string {
  const name = teamPlayer.player_nickname || teamPlayer.player_name;
  return name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
}

/**
 * Jogador desenhado **dentro** do `<svg>` do campo.
 *
 * Antes era um `<div>` do MUI posicionado por cima do SVG. Como
 * `exportUtils.serializeSvg` clona apenas o elemento `<svg>`, o arquivo
 * exportado (SVG, PNG e as imagens do compartilhamento nativo) saía com o campo
 * **vazio, sem nenhum jogador**. Sendo um nó SVG de verdade, o jogador entra na
 * exportação, na impressão e no compartilhamento.
 *
 * A foto foi trocada pela inicial em um círculo de propósito: uma `<image>`
 * apontando para uma URL externa contamina o canvas (CORS) e faria
 * `canvas.toBlob` falhar silenciosamente na exportação em PNG.
 *
 * O elemento carrega `data-player-id`, `data-team-player-id` e `data-team-id`:
 * é por eles que a movimentação liga o desenho ao estado real da aplicação (e
 * é por eles que um teste encontra o jogador no campo sem depender do texto).
 *
 * ## Duas formas de mexer
 *
 * Arrastar (mouse, no desktop) **e** tocar para selecionar (celular e teclado).
 * O arrasto sozinho não bastava: era a única maneira de ajustar os times, e no
 * celular é um gesto impreciso — além de inacessível por teclado.
 */
function PlayerTokenComponent({
  teamPlayer,
  teamId,
  x,
  y,
  nameSize,
  maxChars,
  isGuest,
  readOnly,
  isSelected,
  onSelect,
}: PlayerTokenProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `team-player-${teamPlayer.id}`,
    data: { teamPlayerId: teamPlayer.id, playerId: teamPlayer.player_id, currentTeamId: teamId },
    disabled: readOnly,
  });

  const fullName = teamPlayer.player_nickname || teamPlayer.player_name;
  const radius = Math.max(4.2, nameSize * 1.15);

  const handleSelect = () => {
    if (readOnly || !onSelect) return;
    onSelect(teamPlayer);
  };

  return (
    <g
      // `setNodeRef` do dnd-kit é tipado para HTMLElement, mas funciona com
      // qualquer nó do DOM — inclusive um `<g>` de SVG.
      ref={setNodeRef as unknown as (element: SVGGElement | null) => void}
      {...(readOnly ? {} : listeners)}
      {...(readOnly ? {} : attributes)}
      data-player-id={teamPlayer.player_id}
      data-team-player-id={teamPlayer.id}
      data-team-id={teamId}
      transform={`translate(${x} ${y})`}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (readOnly || !onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      }}
      style={{
        cursor: readOnly ? "default" : "grab",
        // Enquanto arrasta, o que segue o dedo/cursor é o `DragOverlay` da tela
        // — renderizado **fora** do `<svg>` e por isso não cortado na borda do
        // campo, como acontecia quando o próprio `<g>` se deslocava. Aqui fica
        // só o "fantasma" indicando de onde o jogador saiu.
        opacity: isDragging ? 0.3 : 1,
        touchAction: "none",
      }}
      aria-pressed={onSelect && !readOnly ? !!isSelected : undefined}
      aria-label={`${fullName}, ${teamPlayer.position_snapshot?.code ?? "sem posição"}, ${teamPlayer.skill_snapshot} estrelas`}
    >
      <title>{`${fullName} · ${teamPlayer.position_snapshot?.code ?? "—"} · ${teamPlayer.skill_snapshot}⭐`}</title>

      {/* Halo do jogador em arrasto ou selecionado para troca. */}
      {(isDragging || isSelected) && (
        <circle
          r={radius + 2.4}
          cy="-1"
          fill="none"
          stroke="#ffd54f"
          strokeWidth={isSelected ? 1.4 : 1}
          strokeDasharray={isSelected ? undefined : "2 1.5"}
        />
      )}

      <circle
        r={radius}
        cy="-1"
        fill={isGuest ? "#dc2626" : "#ffffff"}
        stroke={isGuest ? "#ffffff" : "#1f2937"}
        strokeWidth="0.7"
      />
      {/* Convidado também por **forma**, não só por cor: o anel tracejado
          sobrevive ao daltonismo e à impressão em preto e branco. */}
      {isGuest && (
        <circle
          r={radius + 1.2}
          cy="-1"
          fill="none"
          stroke="#dc2626"
          strokeWidth="0.6"
          strokeDasharray="1.5 1"
        />
      )}
      <text
        x="0"
        y={radius * 0.35}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight="700"
        fill={isGuest ? "#ffffff" : "#1f2937"}
        fontFamily="Inter, system-ui, sans-serif"
      >
        {fullName.charAt(0).toUpperCase()}
      </text>

      <text
        x="0"
        y={radius + 4.2}
        textAnchor="middle"
        fontSize={nameSize * 0.92}
        fontWeight="600"
        fill="#ffffff"
        stroke="rgba(0,0,0,0.65)"
        strokeWidth="0.9"
        paintOrder="stroke"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {displayName(teamPlayer, maxChars)}
      </text>
      <text
        x="0"
        y={radius + 8}
        textAnchor="middle"
        fontSize={nameSize * 0.75}
        fill="#ffd54f"
        stroke="rgba(0,0,0,0.65)"
        strokeWidth="0.8"
        paintOrder="stroke"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {"★".repeat(teamPlayer.skill_snapshot)}
      </text>
    </g>
  );
}

/** `memo`: cada movimento de arrasto re-renderizava **todos** os jogadores de
 * **todos** os times. */
export const PlayerToken = memo(PlayerTokenComponent);
