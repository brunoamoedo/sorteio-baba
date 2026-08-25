import { useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Container,
  IconButton,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import { DarkModeIcon, LightModeIcon, MenuIcon } from "../icons";
import { useAuth } from "../../features/auth/AuthContext";
import { useOrganization } from "../../features/organization/OrganizationContext";
import { useColorMode } from "../theme/ColorModeContext";
import { AppDrawer } from "./AppDrawer";
import { BOTTOM_NAV_HEIGHT, BottomNav } from "./BottomNav";
import { UserMenu } from "./UserMenu";
import { resolveActivePath, visibleNavItems } from "./navItems";

export function AppLayout({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  const { currentMembership, memberships, clearOrganization } = useOrganization();
  const { mode, toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const role = currentMembership?.role;
  const navItems = visibleNavItems(role, user?.is_superadmin);

  const activePath = resolveActivePath(
    navItems.map((item) => item.path),
    location.pathname,
  );

  const goTo = (path: string) => {
    navigate(path);
    setMobileNavOpen(false);
  };

  /** Trocar de organização é voltar para a tela de seleção — só faz sentido
   * para quem participa de mais de uma pelada. */
  const canSwitchOrganization = memberships.length > 1;
  const handleSwitchOrganization = () => {
    setMobileNavOpen(false);
    clearOrganization();
    navigate("/");
  };

  return (
    <Box sx={{ minHeight: "100%" }}>
      {/* Um caminho direto para o conteúdo, para quem navega por teclado não
          precisar tabular o menu inteiro em toda página. */}
      <Box
        component="a"
        href="#conteudo"
        sx={{
          position: "absolute",
          left: -9999,
          top: 8,
          zIndex: (t) => t.zIndex.modal + 1,
          px: 2,
          py: 1,
          borderRadius: 1,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          fontWeight: 700,
          "&:focus": { left: 8 },
        }}
      >
        Ir para o conteúdo
      </Box>

      {/* `sticky`: em telas longas (partida com 30 jogadores) o cabeçalho
          continuava rolando para fora e não havia como voltar ao menu sem subir
          a página inteira. */}
      <AppBar component="header" position="sticky" color="default" elevation={0}>
        <Toolbar sx={{ justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, md: 3 }, minWidth: 0 }}>
            {isMobile && (
              <IconButton onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu" edge="start">
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="h6"
                component="p"
                sx={{ fontWeight: 700, whiteSpace: "nowrap", lineHeight: 1.2 }}
              >
                Sorteio da Pelada
              </Typography>
              {/* Sempre visível, inclusive no celular: escondê-lo em `xs` fazia
                  quem participa de mais de uma pelada não saber onde estava. */}
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {currentMembership?.organization.name}
              </Typography>
            </Box>
            {!isMobile && (
              <Tabs
                value={activePath ?? false}
                onChange={(_, value) => navigate(value)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                aria-label="Navegação principal"
                sx={{ minHeight: 48 }}
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Tab
                      key={item.path}
                      label={item.label}
                      value={item.path}
                      icon={<Icon fontSize="small" />}
                      iconPosition="start"
                      sx={{ minHeight: 48, gap: 0.75 }}
                    />
                  );
                })}
              </Tabs>
            )}
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.5, sm: 1 }, flexShrink: 0 }}>
            <Tooltip title={mode === "dark" ? "Tema claro" : "Tema escuro"}>
              <IconButton
                onClick={toggleColorMode}
                aria-label={mode === "dark" ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
              >
                {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
            {/* No celular as ações de conta ficam no rodapé do menu lateral —
                na barra, "Sair" ficava colado no botão de tema e era tocado por
                engano. No desktop não há menu lateral, então elas moram aqui. */}
            {!isMobile && (
              <UserMenu
                userName={user?.username}
                organizationName={currentMembership?.organization.name}
                role={role}
                canSwitchOrganization={canSwitchOrganization}
                onSwitchOrganization={handleSwitchOrganization}
                onLogout={logout}
              />
            )}
          </Box>
        </Toolbar>
      </AppBar>

      <AppDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        items={navItems}
        pathname={location.pathname}
        onNavigate={goTo}
        organizationName={currentMembership?.organization.name}
        role={role}
        userName={user?.username}
        isDark={mode === "dark"}
        onToggleTheme={toggleColorMode}
        canSwitchOrganization={canSwitchOrganization}
        onSwitchOrganization={handleSwitchOrganization}
        onLogout={logout}
      />

      <Container
        component="main"
        id="conteudo"
        maxWidth="lg"
        sx={{
          px: { xs: 2, sm: 3 },
          py: { xs: 2, sm: 3 },
          // Espaço para a barra inferior fixa não cobrir o fim do conteúdo.
          pb: { xs: `${BOTTOM_NAV_HEIGHT + 16}px`, md: 3 },
        }}
      >
        {children}
      </Container>

      <BottomNav
        items={navItems}
        pathname={location.pathname}
        onNavigate={goTo}
        onOpenMenu={() => setMobileNavOpen(true)}
      />
    </Box>
  );
}
