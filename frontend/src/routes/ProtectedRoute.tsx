import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";

import { useAuth } from "../features/auth/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // `isLoading` cobre todo o intervalo entre "existe token" e "usuário
  // resolvido". Enquanto ele for verdadeiro o guard **espera** — nunca conclui
  // "não autenticado", que era o que jogava o usuário de volta ao login logo
  // após o primeiro clique em Entrar.
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 10 }}>
        <CircularProgress aria-label="Carregando sessão" />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
