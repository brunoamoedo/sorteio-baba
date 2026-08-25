import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import type { RecurringExpense } from "../../core/types/finance";
import { formatMoney } from "./financeShared";

interface FixedCostsDrawerProps {
  open: boolean;
  costs: RecurringExpense[];
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
  onSave: (payload: Omit<RecurringExpense, "id"> & { id?: number }) => Promise<unknown>;
}

/**
 * Cadastro dos custos fixos mensais — quadra, arbitragem, colete, água.
 *
 * É o **contrato** do gasto, não o gasto: cada competência ganha uma despesa
 * gerada a partir daqui, com o valor congelado. Reajustar o aluguel não
 * reescreve os meses que já passaram, pelo mesmo motivo que reajustar a
 * mensalidade não reescreve as competências anteriores.
 *
 * Desativar (em vez de excluir) preserva as despesas já geradas: elas continuam
 * apontando para o cadastro que as originou.
 */
export function FixedCostsDrawer({
  open,
  costs,
  onClose,
  isSubmitting,
  error,
  onSave,
}: FixedCostsDrawerProps) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("10");

  useEffect(() => {
    if (!open) return;
    setDescription("");
    setAmount("");
    setDueDay("10");
  }, [open]);

  const invalido = !description.trim() || !amount || Number(amount) <= 0;
  const totalMensal = costs
    .filter((cost) => cost.is_active)
    .reduce((soma, cost) => soma + Number(cost.amount), 0);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 460 } } } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Custos fixos mensais
          </Typography>
          <IconButton onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          O que a pelada paga todo mês. Use “Gerar custos fixos” para lançá-los numa competência —
          o valor fica congelado no mês gerado.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {costs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nenhum custo fixo cadastrado.
          </Typography>
        ) : (
          <Stack spacing={1} data-testid="fixed-costs-list">
            {costs.map((cost) => (
              <Box
                key={cost.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  opacity: cost.is_active ? 1 : 0.6,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {cost.description}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatMoney(cost.amount)} · vence dia {cost.due_day}
                    {cost.is_active ? "" : " · inativo"}
                  </Typography>
                </Box>
                <Switch
                  checked={cost.is_active}
                  disabled={isSubmitting}
                  slotProps={{ input: { "aria-label": `Ativar ${cost.description}` } }}
                  onChange={(event) =>
                    void onSave({ ...cost, is_active: event.target.checked }).catch(() => {})
                  }
                />
              </Box>
            ))}
            <Typography variant="body2" sx={{ fontWeight: 700, mt: 1 }}>
              Total fixo por mês: {formatMoney(String(totalMensal))}
            </Typography>
          </Stack>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" color="text.secondary">
          Novo custo fixo
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Descrição"
            placeholder="Ex.: Aluguel da quadra"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <TextField
            label="Valor mensal (R$)"
            type="number"
            slotProps={{ htmlInput: { step: "0.01", min: "0.01" } }}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <TextField
            label="Dia de vencimento"
            type="number"
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
            value={dueDay}
            onChange={(event) => setDueDay(event.target.value)}
          />
          <Button
            variant="contained"
            disabled={invalido || isSubmitting}
            onClick={() => {
              void onSave({
                description: description.trim(),
                amount,
                due_day: Number(dueDay) || 10,
                notes: "",
                is_active: true,
              })
                .then(() => {
                  setDescription("");
                  setAmount("");
                })
                .catch(() => {});
            }}
          >
            Cadastrar custo fixo
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
