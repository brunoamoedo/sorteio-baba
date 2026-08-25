import { useEffect, useState } from "react";
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
} from "@mui/material";

import type { CreateExpensePayload } from "../../api/financeApi";
import { todayIso } from "../../core/dateTime";
import { EXPENSE_KIND_LABELS, type Expense, type ExpenseKind } from "../../core/types/finance";
import { currentReference, formatReference, referenceOptions } from "./financeShared";

interface ExpenseFormDialogProps {
  open: boolean;
  /** Presente = edição. Ausente = lançamento novo. O mesmo formulário serve aos
   * dois: são os mesmos campos, e duas telas divergiriam no primeiro campo
   * acrescentado. */
  expense?: Expense | null;
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: CreateExpensePayload) => Promise<unknown>;
}

/**
 * Lançamento de uma despesa avulsa.
 *
 * A competência é um campo **próprio**, separado da data em que a despesa foi
 * paga: a quadra de abril paga em maio é despesa de abril. Deduzir a
 * competência da data de pagamento jogaria o custo no mês errado — o mesmo erro
 * que o lado da receita evita.
 */
export function ExpenseFormDialog({
  open,
  expense = null,
  onClose,
  isSubmitting,
  error,
  onSubmit,
}: ExpenseFormDialogProps) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState(() => currentReference());
  const [incurredOn, setIncurredOn] = useState(() => todayIso());
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("extra");
  const [notes, setNotes] = useState("");

  const editando = expense !== null;

  useEffect(() => {
    if (!open) return;
    setDescription(expense?.description ?? "");
    setAmount(expense?.amount ?? "");
    setReference(expense?.reference ?? currentReference());
    setIncurredOn(expense?.incurred_on ?? todayIso());
    setDueDate(expense?.due_date ?? "");
    setKind(expense?.kind ?? "extra");
    setNotes(expense?.notes ?? "");
  }, [open, expense]);

  const invalido = !description.trim() || !amount || Number(amount) <= 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{editando ? "Editar despesa" : "Lançar despesa"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Descrição"
            autoFocus
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <TextField
            label="Valor (R$)"
            type="number"
            slotProps={{ htmlInput: { step: "0.01", min: "0.01" } }}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {/* Na edição o tipo é só leitura: ele diz **de onde a despesa veio**
              (custo fixo gerado × lançamento avulso), e trocá-lo transformaria
              um registro em outro sem rastro do que era. */}
          <TextField
            select
            label="Tipo"
            value={kind}
            disabled={editando}
            helperText={
              editando
                ? "O tipo não muda: ele registra a origem da despesa."
                : "Custo fixo cadastrado gera despesa todo mês; extra é avulso."
            }
            onChange={(event) => setKind(event.target.value as ExpenseKind)}
          >
            {(Object.keys(EXPENSE_KIND_LABELS) as ExpenseKind[]).map((option) => (
              <MenuItem key={option} value={option}>
                {EXPENSE_KIND_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Competência"
            value={reference}
            helperText="A que mês esta despesa pertence — independe de quando foi paga."
            onChange={(event) => setReference(event.target.value)}
          >
            {referenceOptions().map((option) => (
              <MenuItem key={option} value={option}>
                {formatReference(option)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Vencimento"
            type="date"
            slotProps={{ inputLabel: { shrink: true } }}
            value={dueDate}
            helperText="Opcional. Informativo — não muda o custo do mês."
            onChange={(event) => setDueDate(event.target.value)}
          />
          <TextField
            label="Pago em"
            type="date"
            slotProps={{ inputLabel: { shrink: true } }}
            value={incurredOn}
            onChange={(event) => setIncurredOn(event.target.value)}
          />
          <TextField
            label="Observação"
            multiline
            minRows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={invalido || isSubmitting}
          onClick={() => {
            void onSubmit({
              description: description.trim(),
              amount,
              reference,
              incurred_on: incurredOn,
              // Vazio vira `undefined`: o servidor entende "sem vencimento",
              // e `""` viraria data inválida.
              due_date: dueDate || undefined,
              kind,
              notes,
            }).catch(() => {
              /* o erro aparece no Alert acima */
            });
          }}
        >
          {isSubmitting
            ? editando
              ? "Salvando..."
              : "Lançando..."
            : editando
              ? "Salvar"
              : "Lançar despesa"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
