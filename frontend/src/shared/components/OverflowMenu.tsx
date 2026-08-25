import { useState, type ComponentType, type MouseEvent } from "react";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";

import { MoreIcon } from "../icons";
import { TOUCH } from "../theme/tokens";

export interface OverflowAction {
  label: string;
  icon?: ComponentType<{ fontSize?: "small" | "medium" | "large" }>;
  onClick: () => void;
  /** Pinta a ação de vermelho (remover, cancelar, desmarcar). */
  destructive?: boolean;
  disabled?: boolean;
  /** Explica **na tela** por que a ação está desabilitada. Vira o texto
   * secundário do item, não um tooltip: não existe hover em toque. */
  disabledReason?: string;
}

interface OverflowMenuProps {
  actions: OverflowAction[];
  /** Rótulo acessível do botão — sempre identifique o alvo ("Ações de João"). */
  label: string;
  size?: "small" | "medium";
}

/**
 * Menu de ações (⋮).
 *
 * Substitui as fileiras de `IconButton size="small"` que as listagens usavam:
 * três alvos de 34px lado a lado, com "Remover" colado em "Editar", é o arranjo
 * que mais produz toque errado no celular — e o custo do erro é justamente o
 * maior (exclusão).
 *
 * Aqui há um alvo só, de 44px, e cada ação vira uma linha com rótulo em texto.
 */
export function OverflowMenu({ actions, label, size = "medium" }: OverflowMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const open = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchor(event.currentTarget);
  };

  const close = (event?: MouseEvent) => {
    event?.stopPropagation();
    setAnchor(null);
  };

  const visible = actions.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <>
      <Tooltip title={label}>
        <IconButton size={size} onClick={open} aria-label={label} aria-haspopup="menu">
          <MoreIcon fontSize={size === "small" ? "small" : "medium"} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => close()}
        onClick={(event) => event.stopPropagation()}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        {visible.map((action) => {
          const Icon = action.icon;
          return (
            <MenuItem
              key={action.label}
              disabled={action.disabled}
              onClick={(event) => {
                close(event);
                action.onClick();
              }}
              sx={{ minHeight: TOUCH.comfortable, color: action.destructive ? "error.main" : undefined }}
            >
              {Icon && (
                <ListItemIcon sx={{ color: action.destructive ? "error.main" : undefined }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
              )}
              <ListItemText
                primary={action.label}
                secondary={action.disabled ? action.disabledReason : undefined}
              />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
