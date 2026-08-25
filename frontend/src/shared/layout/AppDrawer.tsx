import {
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from "@mui/material";

import { CloseIcon, DarkModeIcon, LogoutIcon, MatchesIcon, SwitchOrgIcon } from "../icons";
import { TOUCH } from "../theme/tokens";
import { resolveActivePath, type NavItem } from "./navItems";

import { ROLE_LABELS, type MembershipRole } from "../../core/types/organization";

interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  pathname: string;
  onNavigate: (path: string) => void;
  organizationName: string | undefined;
  role: MembershipRole | undefined;
  userName: string | undefined;
  isDark: boolean;
  onToggleTheme: () => void;
  canSwitchOrganization: boolean;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

/**
 * Menu hamburger.
 *
 * Três decisões de projeto, todas vindas do uso real (organizador à beira do
 * campo, uma mão, celular):
 *
 * 1. **Ícone + texto, sempre.** O ícone acelera o reconhecimento; sozinho ele
 *    vira adivinhação e piora a acessibilidade. Os dois juntos, nunca um só.
 * 2. **Ações destrutivas/raras no rodapé.** Tema, trocar de organização e sair
 *    ficam na zona do polegar, longe da navegação que se usa o tempo todo — e
 *    "Sair" deixa de ficar colado no botão de tema na barra superior, onde era
 *    tocado por engano.
 * 3. **A organização em destaque no topo.** Em multi-organização, agir na
 *    pelada errada é o erro mais caro que a interface permite.
 */
export function AppDrawer({
  open,
  onClose,
  items,
  pathname,
  onNavigate,
  organizationName,
  role,
  userName,
  isDark,
  onToggleTheme,
  canSwitchOrganization,
  onSwitchOrganization,
  onLogout,
}: AppDrawerProps) {
  const activePath = resolveActivePath(
    items.map((item) => item.path),
    pathname,
  );

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      // Fechado ele nem esta no DOM, mas imprimir com o menu aberto e um
      // acidente barato de evitar.
      className="no-print"
      slotProps={{ paper: { sx: { width: { xs: "86vw", sm: 300 }, maxWidth: 320 } } }}
    >
      <Box
        component="nav"
        aria-label="Menu principal"
        sx={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
              <MatchesIcon fontSize="small" />
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                {organizationName ?? "Sorteio da Pelada"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {userName}
                {role ? ` · ${ROLE_LABELS[role]}` : ""}
              </Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="Fechar menu" edge="end">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        <Divider />

        <List sx={{ flex: 1, overflowY: "auto", px: 1, py: 1 }}>
          {items.map((item) => {
            const Icon = item.icon;
            const selected = item.path === activePath;
            return (
              <ListItemButton
                key={item.path}
                selected={selected}
                onClick={() => onNavigate(item.path)}
                aria-current={selected ? "page" : undefined}
                sx={{
                  minHeight: TOUCH.comfortable,
                  mb: 0.25,
                  // Barra à esquerda + cor: o estado ativo não depende só de um
                  // fundo levemente diferente, que some no tema escuro.
                  borderLeft: "3px solid",
                  borderLeftColor: selected ? "primary.main" : "transparent",
                  "&.Mui-selected": {
                    bgcolor: (t) =>
                      t.palette.mode === "dark"
                        ? "rgba(76, 175, 111, 0.16)"
                        : "rgba(28, 134, 57, 0.10)",
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: selected ? "primary.main" : "inherit" }}>
                  {/* `aria-hidden`: o rótulo do item já diz tudo, e o leitor de
                      tela não deve anunciar o ícone duas vezes. */}
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  slotProps={{
                    primary: {
                      sx: {
                        fontWeight: selected ? 700 : 500,
                        color: selected ? "primary.main" : undefined,
                      },
                    },
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>

        <Divider />

        {/* Zona do polegar: o que é raro, destrutivo ou de configuração. */}
        <List sx={{ px: 1, py: 1 }} className="safe-bottom">
          <ListItemButton
            onClick={onToggleTheme}
            sx={{ minHeight: TOUCH.comfortable }}
            aria-label={isDark ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <DarkModeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Tema escuro" />
            <Switch checked={isDark} tabIndex={-1} slotProps={{ input: { "aria-hidden": true } }} />
          </ListItemButton>

          {canSwitchOrganization && (
            <ListItemButton onClick={onSwitchOrganization} sx={{ minHeight: TOUCH.comfortable }}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <SwitchOrgIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Trocar organização" />
            </ListItemButton>
          )}

          <ListItemButton onClick={onLogout} sx={{ minHeight: TOUCH.comfortable, color: "error.main" }}>
            <ListItemIcon sx={{ minWidth: 36, color: "error.main" }}>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Sair" />
          </ListItemButton>
        </List>
      </Box>
    </Drawer>
  );
}
