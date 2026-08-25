import { Card, CardContent, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";

import { InfoIcon, WaitlistIcon, WarningIcon } from "../../shared/icons";
import { TOUCH } from "../../shared/theme/tokens";

import type { DashboardPendingItem } from "../../core/types/match";

interface PendingTasksCardProps {
  items: DashboardPendingItem[];
  onOpenMatch: (matchId: number) => void;
}

const ICONS = {
  draw_blocked: WarningIcon,
  waitlist: WaitlistIcon,
  below_minimum: InfoIcon,
  divergence: WarningIcon,
} as const;

/**
 * Pendências que esperam ação.
 *
 * O caso que motivou o bloco: um sorteio automático vencido por falta de
 * confirmados ficava parado, e **nada na tela inicial dizia isso** — a
 * explicação só aparecia ao abrir a partida. Quem não abrisse, não sabia.
 */
export function PendingTasksCard({ items, onOpenMatch }: PendingTasksCardProps) {
  if (items.length === 0) return null;

  return (
    <Card>
      <CardContent sx={{ pb: 0.5 }}>
        <Typography variant="overline" color="text.secondary">
          Pendências
        </Typography>
      </CardContent>
      <List dense sx={{ pt: 0 }}>
        {items.map((item, index) => {
          const Icon = ICONS[item.kind];
          const color = item.severity === "warning" ? "warning.main" : "text.secondary";
          return (
            <ListItemButton
              key={`${item.kind}-${index}`}
              onClick={() => item.match && onOpenMatch(item.match)}
              disabled={!item.match}
              sx={{ minHeight: TOUCH.comfortable, alignItems: "flex-start", py: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 36, color, mt: 0.25 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={item.message}
                slotProps={{ primary: { variant: "body2", sx: { fontWeight: 500 } } }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Card>
  );
}
