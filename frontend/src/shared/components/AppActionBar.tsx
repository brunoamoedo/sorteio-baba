import type { ReactNode } from "react";
import { Box, Paper } from "@mui/material";

import { BOTTOM_NAV_HEIGHT } from "../layout/BottomNav";

interface AppActionBarProps {
  children: ReactNode;
  /** Texto curto acima das ações — o motivo de a ação estar bloqueada, o
   * estado atual. Fica **sempre visível**: é o substituto do tooltip, que não
   * existe em toque. */
  hint?: ReactNode;
}

/**
 * Barra de ação primária fixa no rodapé (celular).
 *
 * Nasce de um problema concreto: na tela da partida, o botão "Sortear times" —
 * a ação central do produto — ficava depois de cinco linhas de configuração e
 * de dois outros botões. No celular era preciso rolar para encontrá-lo.
 *
 * Empilha **acima** da barra de navegação, nunca por cima dela.
 */
export function AppActionBar({ children, hint }: AppActionBarProps) {
  return (
    <>
      {/* Reserva o espaço que a barra fixa ocupa, para o fim do conteúdo não
          ficar permanentemente escondido atrás dela. */}
      <Box sx={{ height: { xs: hint ? 108 : 76, md: 0 } }} aria-hidden />

      <Paper
        elevation={0}
        className="safe-bottom"
        sx={{
          position: { xs: "fixed", md: "static" },
          bottom: { xs: BOTTOM_NAV_HEIGHT, md: "auto" },
          left: 0,
          right: 0,
          zIndex: (t) => t.zIndex.appBar - 1,
          px: { xs: 2, md: 0 },
          py: { xs: 1.5, md: 0 },
          borderTop: { xs: "1px solid", md: "none" },
          borderColor: "divider",
          borderRadius: 0,
          bgcolor: { xs: "background.paper", md: "transparent" },
        }}
      >
        {hint && (
          <Box sx={{ mb: 1, textAlign: { xs: "center", md: "left" } }}>{hint}</Box>
        )}
        {children}
      </Paper>
    </>
  );
}
