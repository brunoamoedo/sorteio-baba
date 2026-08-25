import {
  Avatar,
  Box,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CloseIcon from "@mui/icons-material/Close";
import LoginIcon from "@mui/icons-material/Login";

import type { MatchCapacity, WaitlistEntry } from "../../core/types/match";
import { StatusChip, playerTypeLabel, playerTypeTone } from "../../shared/components/StatusChip";

interface WaitlistPanelProps {
  entries: WaitlistEntry[];
  capacity: MatchCapacity;
  confirmedCount: number;
  canManage: boolean;
  isBusy: boolean;
  onPromote: (playerId: number) => void;
  onMove: (playerId: number, position: number) => void;
  onRemove: (playerId: number) => void;
}

/**
 * Lista de espera da partida.
 *
 * Aparece assim que existe alguém na fila. A ordem exibida é a ordem real de
 * promoção: mensalistas primeiro, depois ordem de inscrição — e o organizador
 * pode reordenar. Promover só é possível quando há vaga; a alternativa
 * (empurrar outro para fora automaticamente) seria destrutiva e silenciosa.
 */
export function WaitlistPanel({
  entries,
  capacity,
  confirmedCount,
  canManage,
  isBusy,
  onPromote,
  onMove,
  onRemove,
}: WaitlistPanelProps) {
  if (entries.length === 0) return null;

  const openSlots = Math.max(0, capacity.max_players - confirmedCount);

  return (
    <Card sx={{ mb: 3 }} className="no-print">
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, gap: 1, mb: 1 }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            ⏳ Lista de espera{" "}
            <Typography component="span" variant="body2" color="text.secondary">
              ({entries.length} aguardando)
            </Typography>
          </Typography>
          <Typography variant="body2" color={openSlots > 0 ? "success.main" : "text.secondary"}>
            {openSlots > 0
              ? `${openSlots} vaga(s) livre(s) — promova quem quiser`
              : `Partida cheia (${capacity.max_players} jogadores)`}
          </Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Quem estiver aqui entra automaticamente assim que alguém desistir. Promover alguém não
          refaz o sorteio — use "Sortear Novamente" quando quiser recalcular os times.
        </Typography>

        <List dense disablePadding>
          {entries.map((entry, index) => (
            <ListItem
              key={entry.id}
              divider={index < entries.length - 1}
              secondaryAction={
                canManage ? (
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title={openSlots > 0 ? "Colocar na partida" : "Sem vaga disponível"}>
                      <span>
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={isBusy || openSlots === 0}
                          onClick={() => onPromote(entry.player_id)}
                          aria-label={`Colocar ${entry.player_name} na partida`}
                        >
                          <LoginIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Subir na fila">
                      <span>
                        <IconButton
                          size="small"
                          disabled={isBusy || index === 0}
                          onClick={() => onMove(entry.player_id, entry.position - 1)}
                          aria-label={`Subir ${entry.player_name} na fila`}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Descer na fila">
                      <span>
                        <IconButton
                          size="small"
                          disabled={isBusy || index === entries.length - 1}
                          onClick={() => onMove(entry.player_id, entry.position + 1)}
                          aria-label={`Descer ${entry.player_name} na fila`}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Tirar da fila">
                      <span>
                        <IconButton
                          size="small"
                          disabled={isBusy}
                          onClick={() => onRemove(entry.player_id)}
                          aria-label={`Tirar ${entry.player_name} da lista de espera`}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ) : null
              }
            >
              <ListItemAvatar>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 20 }}>
                    {entry.position}º
                  </Typography>
                  <Avatar src={entry.player_photo ?? undefined} sx={{ width: 32, height: 32 }}>
                    {entry.player_name[0]}
                  </Avatar>
                </Box>
              </ListItemAvatar>
              <ListItemText
                primary={entry.player_nickname || entry.player_name}
                secondary={
                  <StatusChip
                    label={playerTypeLabel(entry.player_type)}
                    tone={playerTypeTone(entry.player_type)}
                  />
                }
                slotProps={{ secondary: { component: "div" } }}
                sx={{ ml: 1 }}
              />
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}
