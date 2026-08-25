import type { ReactNode } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";

import { useOrganization } from "../features/organization/OrganizationContext";
import { OrganizationSelectorPage } from "../features/organization/OrganizationSelectorPage";

export function RequireOrganization({ children }: { children: ReactNode }) {
  const { isLoading, error, retry, memberships, currentMembership } = useOrganization();

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 10 }}>
        <CircularProgress aria-label="Carregando organizações" />
      </Box>
    );
  }

  // Erro tem tela própria e botão de tentar de novo — antes ele era silenciado
  // e aparecia como "nenhuma organização encontrada".
  if (error) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 10, px: 2 }}>
        <Alert
          severity="error"
          sx={{ maxWidth: 480 }}
          action={
            <Button color="inherit" size="small" onClick={retry}>
              Tentar novamente
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  if (memberships.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 10, px: 2 }}>
        <Typography color="text.secondary" align="center">
          Nenhuma organização encontrada para o seu usuário.
        </Typography>
      </Box>
    );
  }

  if (!currentMembership) {
    return <OrganizationSelectorPage />;
  }

  return <>{children}</>;
}
