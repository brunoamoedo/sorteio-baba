import { BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";

import { MenuIcon } from "../icons";
import { resolveActivePath, type NavItem } from "./navItems";

/** Altura da barra, sem a faixa de segurança do sistema. O conteúdo da página
 * reserva este espaço para não ficar coberto. */
export const BOTTOM_NAV_HEIGHT = 60;

interface BottomNavProps {
  items: NavItem[];
  pathname: string;
  onNavigate: (path: string) => void;
  onOpenMenu: () => void;
}

/**
 * Navegação primária do celular.
 *
 * O menu hamburger sozinho não resolve o uso com uma mão: ele exige alcançar o
 * canto superior esquerdo — o ponto mais distante do polegar. Esta barra deixa
 * as rotas mais usadas do papel a um toque, e o botão "Menu" abre o resto.
 *
 * Só aparece abaixo de `md`; no desktop as abas da barra superior já cumprem
 * esse papel.
 */
export function BottomNav({ items, pathname, onNavigate, onOpenMenu }: BottomNavProps) {
  // No máximo 4 + "Menu": com mais que isso os rótulos truncam e os alvos
  // ficam menores que o mínimo de toque.
  const barItems = items.filter((item) => item.inBottomBar).slice(0, 4);
  const activePath = resolveActivePath(
    barItems.map((item) => item.path),
    pathname,
  );

  return (
    <Paper
      elevation={0}
      className="safe-bottom no-print"
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (t) => t.zIndex.appBar,
        borderTop: "1px solid",
        borderColor: "divider",
        display: { xs: "block", md: "none" },
      }}
    >
      <BottomNavigation
        value={activePath ?? false}
        showLabels
        sx={{ height: BOTTOM_NAV_HEIGHT, bgcolor: "transparent" }}
      >
        {barItems.map((item) => {
          const Icon = item.icon;
          return (
            <BottomNavigationAction
              key={item.path}
              value={item.path}
              label={item.shortLabel ?? item.label}
              icon={<Icon fontSize="small" />}
              onClick={() => onNavigate(item.path)}
              aria-current={item.path === activePath ? "page" : undefined}
              sx={{ minWidth: 0, px: 0.5, "& .MuiBottomNavigationAction-label": { fontSize: 11 } }}
            />
          );
        })}
        <BottomNavigationAction
          value="__menu__"
          label="Menu"
          icon={<MenuIcon fontSize="small" />}
          onClick={onOpenMenu}
          aria-label="Abrir menu completo"
          sx={{ minWidth: 0, px: 0.5, "& .MuiBottomNavigationAction-label": { fontSize: 11 } }}
        />
      </BottomNavigation>
    </Paper>
  );
}
