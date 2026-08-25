import type { ComponentType, ReactNode } from "react";
import { Box, Typography } from "@mui/material";

import { EmptyIcon } from "../icons";

interface EmptyStateProps {
  title: string;
  /** Por que está vazio **e** o que fazer a respeito. Um estado vazio que só
   * diz "nada encontrado" deixa a pessoa sem próximo passo. */
  description?: string;
  icon?: ComponentType<{ fontSize?: "small" | "medium" | "large"; sx?: object }>;
  action?: ReactNode;
  /** Versão compacta para dentro de card/tabela. */
  dense?: boolean;
}

/** Estado vazio padrão. Substitui os `Typography` cinza soltos que cada tela
 * escrevia à mão ("Nenhum jogador encontrado." e nada mais). */
export function EmptyState({ title, description, icon, action, dense = false }: EmptyStateProps) {
  const Icon = icon ?? EmptyIcon;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 1,
        py: dense ? 3 : 6,
        px: 2,
      }}
    >
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          width: dense ? 48 : 64,
          height: dense ? 48 : 64,
          borderRadius: "50%",
          bgcolor: "action.hover",
          color: "text.secondary",
          mb: 0.5,
        }}
        aria-hidden
      >
        <Icon fontSize={dense ? "medium" : "large"} />
      </Box>
      <Typography variant={dense ? "subtitle2" : "subtitle1"} sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 1.5 }}>{action}</Box>}
    </Box>
  );
}
