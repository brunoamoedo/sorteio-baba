import type { FormEvent, ReactNode } from "react";
import { Alert, Box, Button, Divider, Drawer, IconButton, Stack, Typography } from "@mui/material";

import { CloseIcon } from "../icons";

interface FormDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  onSubmit: (event: FormEvent) => void;
  isSubmitting?: boolean;
  error?: string | null;
  submitLabel?: string;
  children: ReactNode;
  width?: number;
}

/**
 * Casca do drawer de formulário lateral do design system — título, form,
 * espaçamento e botões Salvar/Cancelar padronizados. Substitui a estrutura
 * repetida em `PlayerFormDrawer`/`RecurringGameFormDrawer`; os campos do
 * formulário continuam específicos de cada tela, passados como `children`.
 *
 * Três correções de mobile em relação à versão anterior:
 *
 * 1. **`width: "100%"`, não `100vw`.** `100vw` inclui a barra de rolagem e
 *    produzia overflow horizontal do documento em navegadores desktop.
 * 2. **Cabeçalho e rodapé fixos.** O formulário de jogador tem 10 campos e um
 *    upload: com as ações no fim do conteúdo, era preciso rolar tudo para
 *    salvar — e quem desistia no meio não achava como sair.
 * 3. **Botão de fechar visível.** A única saída era o "Cancelar" lá embaixo.
 */
export function FormDrawer({
  open,
  onClose,
  title,
  onSubmit,
  isSubmitting = false,
  error,
  submitLabel = "Salvar",
  children,
  width = 420,
}: FormDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: width }, maxWidth: "100vw" } } }}
    >
      <Box
        component="form"
        onSubmit={onSubmit}
        noValidate
        sx={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: "center", gap: 1, px: 2.5, py: 2, flexShrink: 0 }}
        >
          <Typography variant="h3" component="h2" sx={{ flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
          <IconButton onClick={onClose} aria-label="Fechar" edge="end">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Divider />

        <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2.5 }}>
          <Stack spacing={2.5}>
            {children}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Box>

        <Divider />

        <Stack
          direction={{ xs: "column-reverse", sm: "row" }}
          spacing={1.5}
          className="safe-bottom"
          sx={{ px: 2.5, py: 2, flexShrink: 0 }}
        >
          <Button variant="outlined" onClick={onClose} fullWidth>
            Cancelar
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting} fullWidth>
            {isSubmitting ? "Salvando..." : submitLabel}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
