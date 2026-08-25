import { useState } from "react";
import {
  Avatar,
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";

import { LogoutIcon, SwitchOrgIcon } from "../icons";
import { TOUCH } from "../theme/tokens";
import { ROLE_LABELS, type MembershipRole } from "../../core/types/organization";

interface UserMenuProps {
  userName?: string;
  organizationName?: string;
  role?: MembershipRole;
  canSwitchOrganization: boolean;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

/** As iniciais do nome, para o avatar. Duas no máximo — três já não cabem. */
function initials(name: string): string {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeiras = [partes[0], partes[partes.length - 1]].slice(0, partes.length === 1 ? 1 : 2);
  return primeiras.map((parte) => parte[0]!.toUpperCase()).join("");
}

/**
 * Menu da conta na barra superior — **a saída do sistema no desktop**.
 *
 * "Sair" tinha sido movido para o rodapé do menu lateral, mas esse menu só abre
 * pelo hamburger ou pela barra inferior, e os dois existem apenas abaixo de
 * `md`. O resultado é que no desktop não havia nenhuma forma de encerrar a
 * sessão: quem entrasse com a conta errada precisava limpar o navegador.
 *
 * Aqui as mesmas ações de conta do rodapé do menu ficam onde o desktop as
 * procura — no canto superior direito, atrás do avatar.
 */
export function UserMenu({
  userName,
  organizationName,
  role,
  canSwitchOrganization,
  onSwitchOrganization,
  onLogout,
}: UserMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const nome = userName ?? "Conta";

  const fechar = () => setAnchor(null);
  const executar = (acao: () => void) => () => {
    fechar();
    acao();
  };

  return (
    <>
      <Tooltip title="Conta">
        <IconButton
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label={`Conta de ${nome}`}
          aria-haspopup="menu"
          aria-expanded={anchor ? true : undefined}
          sx={{ p: 0.5 }}
        >
          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: "primary.main" }}>
            {initials(nome)}
          </Avatar>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={fechar}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { minWidth: 220, mt: 0.5 } } }}
      >
        {/* Identificação, não ação: sem `MenuItem` para não ser focável nem
            parecer clicável. */}
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
            {nome}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {[organizationName, role && ROLE_LABELS[role]].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
        <Divider />

        {canSwitchOrganization && (
          <MenuItem onClick={executar(onSwitchOrganization)} sx={{ minHeight: TOUCH.min }}>
            <ListItemIcon>
              <SwitchOrgIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Trocar de organização" />
          </MenuItem>
        )}

        <MenuItem
          onClick={executar(onLogout)}
          sx={{ minHeight: TOUCH.min, color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Sair" />
        </MenuItem>
      </Menu>
    </>
  );
}
