import type { ReactNode } from "react";
import { Box, Divider, Drawer, IconButton, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";

import { CloseIcon } from "../icons";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Texto curto abaixo do título — contexto, nunca instrução essencial. */
  subtitle?: string;
  children: ReactNode;
  /** Ações fixas no rodapé (não rolam com o conteúdo). */
  actions?: ReactNode;
  /** Em telas grandes o painel vira um diálogo lateral à direita, que é o
   * gesto natural do desktop. Passe `false` para manter embaixo sempre. */
  sideOnDesktop?: boolean;
}

/**
 * Painel deslizante vindo de baixo — o padrão de "escolher algo" no celular.
 *
 * Existe porque o sistema só tinha diálogo centralizado e drawer lateral: o
 * primeiro obriga o polegar a subir até o meio da tela, o segundo é largo
 * demais para uma escolha simples. O bottom sheet aparece exatamente onde a mão
 * está.
 *
 * O cabeçalho e o rodapé são fixos e só o miolo rola — sem isso, um sheet com
 * muitas opções esconde o botão de confirmar.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  sideOnDesktop = true,
}: BottomSheetProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const asSide = sideOnDesktop && isDesktop;

  return (
    <Drawer
      anchor={asSide ? "right" : "bottom"}
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: asSide
            ? { width: 460, maxWidth: "100%" }
            : {
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                maxHeight: "88vh",
              },
        },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", maxHeight: asSide ? "100%" : "88vh" }}>
        {!asSide && (
          // Alça: sinaliza que o painel é arrastável/fechável, mesmo quando o
          // gesto de arrastar não está implementado.
          <Box sx={{ display: "flex", justifyContent: "center", pt: 1.5, pb: 0.5 }} aria-hidden>
            <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: "divider" }} />
          </Box>
        )}

        <Stack
          direction="row"
          sx={{ alignItems: "flex-start", gap: 1, px: 2, pt: asSide ? 2 : 1, pb: 1.5 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h3" component="h2">
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} aria-label="Fechar" edge="end">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Divider />

        <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 2 }}>{children}</Box>

        {actions && (
          <>
            <Divider />
            <Box className="safe-bottom" sx={{ px: 2, py: 2 }}>
              {actions}
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}
