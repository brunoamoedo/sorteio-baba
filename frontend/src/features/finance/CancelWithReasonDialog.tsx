import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import type { ReactNode } from "react";

interface CancelWithReasonDialogProps {
  open: boolean;
  title: string;
  /** O que está sendo cancelado, para o organizador conferir antes. */
  summary: ReactNode;
  submitLabel: string;
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (reason: string) => Promise<unknown>;
}

/**
 * Cancelamento com motivo obrigatório — a mesma caixa para estornar uma baixa e
 * para cancelar uma despesa.
 *
 * As duas operações têm a mesma forma (nada é apagado, o registro muda de
 * estado e guarda quem/quando/por quê) e a mesma exigência: **motivo
 * obrigatório**, porque um cancelamento sem motivo é indistinguível de um erro
 * operacional seis meses depois. Duas caixas separadas divergiriam na primeira
 * alteração de texto.
 */
export function CancelWithReasonDialog({
  open,
  title,
  summary,
  submitLabel,
  onClose,
  isSubmitting,
  error,
  onSubmit,
}: CancelWithReasonDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  const semMotivo = reason.trim().length === 0;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={0.5} sx={{ mb: 2 }}>
          {summary}
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          O registro <strong>não é apagado</strong>: ele continua no histórico marcado como
          cancelado, com o seu nome, a data e o motivo.
        </Alert>

        <TextField
          label="Motivo do cancelamento"
          fullWidth
          required
          autoFocus
          multiline
          minRows={2}
          value={reason}
          helperText="Obrigatório — é o que explica o cancelamento numa auditoria futura."
          onChange={(event) => setReason(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Voltar</Button>
        <Button
          variant="contained"
          color="error"
          disabled={semMotivo || isSubmitting}
          onClick={() => {
            void onSubmit(reason.trim()).catch(() => {
              /* o erro aparece no Alert acima */
            });
          }}
        >
          {isSubmitting ? "Cancelando..." : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Resumo padrão de uma linha do financeiro (valor · detalhe · quem registrou). */
export function CancelSummary({ main, meta }: { main: string; meta?: string }) {
  return (
    <>
      <Typography variant="body2">
        <strong>{main}</strong>
      </Typography>
      {meta && (
        <Typography variant="body2" color="text.secondary">
          {meta}
        </Typography>
      )}
    </>
  );
}
