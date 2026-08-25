import {
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { BottomSheet } from "../../shared/components/BottomSheet";
import { MoveIcon, SwapIcon } from "../../shared/icons";
import { TOUCH } from "../../shared/theme/tokens";
import { getPlayerDisplayName, getTeamLabel } from "./shareFormat";

import type { Position } from "../../core/types/player";
import type { Team, TeamPlayer } from "../../core/types/draw";

interface PlayerActionSheetProps {
  open: boolean;
  onClose: () => void;
  player: TeamPlayer | null;
  teams: Team[];
  currentTeamId: number | null;
  positions: Position[];
  onChangePosition: (positionId: number) => void;
  onStartSwap: () => void;
  onMoveToTeam: (teamId: number) => void;
}

/**
 * Ações de um jogador do resultado — a alternativa por toque ao arrastar.
 *
 * Abre ao tocar num jogador (no campo ou na escalação) e oferece as três
 * operações que o sistema passou a ter: mudar de posição, trocar com outro
 * jogador e mudar de time. Antes só existia a terceira, e só arrastando.
 */
export function PlayerActionSheet({
  open,
  onClose,
  player,
  teams,
  currentTeamId,
  positions,
  onChangePosition,
  onStartSwap,
  onMoveToTeam,
}: PlayerActionSheetProps) {
  if (!player) return null;

  const teamIndex = teams.findIndex((team) => team.id === currentTeamId);
  const currentPositionId = player.position_snapshot?.id ?? "";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={getPlayerDisplayName(player)}
      subtitle={`${teamIndex >= 0 ? getTeamLabel(teamIndex) : ""} · ${
        player.position_snapshot?.name ?? "sem posição"
      } · ${"★".repeat(player.skill_snapshot)}`}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Posição
          </Typography>
          <TextField
            select
            fullWidth
            label="Posição em campo"
            value={currentPositionId}
            onChange={(event) => onChangePosition(Number(event.target.value))}
            helperText="Altera só a posição deste jogador — ninguém muda de time."
          >
            {positions.map((position) => (
              <MenuItem key={position.id} value={position.id}>
                {position.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Trocar
          </Typography>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            startIcon={<SwapIcon />}
            onClick={onStartSwap}
          >
            Trocar com outro jogador
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
            Depois de tocar aqui, escolha o outro jogador. A troca preserva o tamanho dos times.
          </Typography>
        </Box>

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Mover para outro time
          </Typography>
          <List disablePadding>
            {teams.map((team, index) => {
              if (team.id === currentTeamId) return null;
              return (
                <ListItemButton
                  key={team.id}
                  onClick={() => onMoveToTeam(team.id)}
                  sx={{ minHeight: TOUCH.comfortable, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <MoveIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={getTeamLabel(index)}
                    secondary={`${team.team_players.length} jogadores`}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Stack>
    </BottomSheet>
  );
}
