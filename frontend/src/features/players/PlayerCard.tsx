import { Box, Card, CardContent, Stack, Typography } from "@mui/material";

import { EditIcon, DeleteIcon, StarIcon } from "../../shared/icons";
import { OverflowMenu } from "../../shared/components/OverflowMenu";
import { PlayerAvatar } from "../../shared/components/PlayerAvatar";
import {
  StatusChip,
  playerStatusTone,
  playerTypeLabel,
  playerTypeTone,
} from "../../shared/components/StatusChip";

import type { Player } from "../../core/types/player";

interface PlayerCardProps {
  player: Player;
  positionName: string;
  canManage: boolean;
  onEdit: (player: Player) => void;
  onDelete: (player: Player) => void;
}

/**
 * Jogador como card — a visão do celular.
 *
 * A tabela equivalente media 684px de largura num viewport de 343px: a pessoa
 * precisava rolar lateralmente para ver metade das colunas. Aqui a mesma
 * informação cabe em duas linhas, e as duas ações (editar, remover) saem de
 * dois alvos de 34px colados um no outro para um menu único de 44px.
 */
export function PlayerCard({ player, positionName, canManage, onEdit, onDelete }: PlayerCardProps) {
  return (
    <Card>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
          <PlayerAvatar name={player.name} photo={player.photo_thumb ?? player.photo} size={44} />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
              {player.name}
            </Typography>

            <Stack
              direction="row"
              sx={{ alignItems: "center", gap: 0.5, flexWrap: "wrap", rowGap: 0.25 }}
            >
              {player.nickname && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  “{player.nickname}” ·
                </Typography>
              )}
              {/* Estrelas como número + ícone em vez de cinco ícones: no card
                  a largura é o recurso escasso, e "4★" lê igual de rápido. */}
              <Typography
                variant="caption"
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, fontWeight: 700 }}
                aria-label={`Nível ${player.skill_level} de 5`}
              >
                {player.skill_level}
                <StarIcon fontSize="small" sx={{ fontSize: 13, color: "warning.main" }} />
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                · {positionName}
              </Typography>
            </Stack>

            <Stack direction="row" sx={{ gap: 0.5, mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
              <StatusChip
                label={playerTypeLabel(player.player_type)}
                tone={playerTypeTone(player.player_type)}
              />
              {/* "Ativo" é o esperado e não precisa de chip; "Inativo" precisa,
                  porque muda o comportamento (fora do sorteio e do roster). */}
              {player.status === "inativo" && (
                <StatusChip label="Inativo" tone={playerStatusTone(player.status)} />
              )}
            </Stack>
          </Box>

          {canManage && (
            <OverflowMenu
              label={`Ações de ${player.name}`}
              actions={[
                { label: "Editar", icon: EditIcon, onClick: () => onEdit(player) },
                {
                  label: "Remover",
                  icon: DeleteIcon,
                  destructive: true,
                  onClick: () => onDelete(player),
                },
              ]}
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
