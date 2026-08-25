import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import type { RegisterPaymentPayload } from "../../api/financeApi";
import { formatMatchDate, todayIso } from "../../core/dateTime";
import {
  PAYMENT_METHOD_LABELS,
  type Charge,
  type PaymentMethod,
} from "../../core/types/finance";

interface RegisterPaymentDialogProps {
  charge: Charge | null;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (payload: RegisterPaymentPayload) => Promise<unknown>;
}

function formatMoney(value: string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RegisterPaymentDialog({
  charge,
  onClose,
  isSubmitting,
  onSubmit,
}: RegisterPaymentDialogProps) {
  const { register, handleSubmit, reset, watch, setValue } = useForm<RegisterPaymentPayload>();
  const dataDoPagamento = watch("paid_at");

  useEffect(() => {
    if (!charge) return;
    // O valor sugerido é **o que falta**, não o total: numa cobrança com baixa
    // parcial, sugerir o total faria o organizador registrar a mais.
    reset({
      amount: charge.outstanding,
      paid_at: todayIso(),
      method: "pix",
      notes: "",
    });
  }, [charge, reset]);

  // A multa depende da **data do pagamento**, e essa data é editável: lançar
  // hoje um pagamento feito em dia não pode sugerir o valor com multa. O
  // servidor recalcula de qualquer jeito — isto é só para o número na tela não
  // contradizer o que vai ser cobrado.
  const multa = useMemo(() => {
    if (!charge || !dataDoPagamento) return 0;
    return dataDoPagamento > charge.due_date ? Number(charge.late_fee_amount) : 0;
  }, [charge, dataDoPagamento]);

  const sugerido = useMemo(() => {
    if (!charge) return "0";
    const falta = Number(charge.amount) + multa - Number(charge.paid_amount);
    return Math.max(0, falta).toFixed(2);
  }, [charge, multa]);

  useEffect(() => {
    if (charge && dataDoPagamento) setValue("amount", sugerido);
  }, [charge, dataDoPagamento, sugerido, setValue]);

  if (!charge) return null;

  const jaPago = Number(charge.paid_amount) > 0;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Dar baixa — {charge.player_name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Competência {charge.reference} · vencimento {formatMatchDate(charge.due_date)} ·{" "}
          {formatMoney(charge.amount)}
        </Typography>

        {multa > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }} data-testid="late-fee-warning">
            Pagamento após o vencimento: {formatMoney(charge.amount)} +{" "}
            <strong>{formatMoney(String(multa))} de multa</strong> ={" "}
            {formatMoney(String(Number(charge.amount) + multa))}.
          </Alert>
        )}

        {jaPago && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Já recebido: {formatMoney(charge.paid_amount)}. Falta{" "}
            <strong>{formatMoney(charge.outstanding)}</strong>.
          </Alert>
        )}

        <Stack
          component="form"
          id="payment-form"
          spacing={2}
          sx={{ mt: 1 }}
          onSubmit={handleSubmit(async (values) => {
            try {
              await onSubmit(values);
            } catch {
              /* o toast do chamador mostra o erro */
            }
          })}
        >
          <TextField
            label="Valor recebido (R$)"
            type="number"
            slotProps={{ htmlInput: { step: "0.01", min: "0.01" } }}
            helperText={
              multa > 0
                ? "Já inclui a multa. Pode ser parcial — a mensalidade só quita no total."
                : "Pode ser parcial — a mensalidade só quita quando o total é atingido."
            }
            {...register("amount", { required: true })}
          />
          <TextField
            label="Data do pagamento"
            type="date"
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="É ela que decide se a multa incide — não a data de hoje."
            {...register("paid_at", { required: true })}
          />
          <TextField select label="Forma" defaultValue="pix" {...register("method")}>
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
              <MenuItem key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Observação" multiline minRows={2} {...register("notes")} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="payment-form" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? "Registrando..." : "Registrar baixa"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
