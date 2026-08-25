import type { ReactNode } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  isSubmitting?: boolean;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}

/** Confirmação de uma ação que altera dados.
 *
 * O corpo vem de quem chama porque a única coisa que uma confirmação genérica
 * ("tem certeza?") acrescenta é um clique: o que faz diferença é dizer
 * **quantos registros** e **o que acontece com eles**. */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  isSubmitting = false,
  children,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={isSubmitting} onClick={onConfirm}>
          {isSubmitting ? "Processando..." : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
