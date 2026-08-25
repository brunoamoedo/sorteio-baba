import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert, MenuItem, TextField } from "@mui/material";

import type { CreateChargePayload } from "../../api/financeApi";
import { todayIso } from "../../core/dateTime";
import type { Player } from "../../core/types/player";
import { FormDrawer } from "../../shared/components/FormDrawer";

interface ChargeFormDrawerProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (payload: CreateChargePayload) => Promise<unknown>;
}

/** Competência do mês corrente (`AAAA-MM`), calculada pelo calendário local. */
function currentReference(): string {
  return todayIso().slice(0, 7);
}

export function ChargeFormDrawer({
  open,
  onClose,
  players,
  isSubmitting,
  error,
  onSubmit,
}: ChargeFormDrawerProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateChargePayload>();

  useEffect(() => {
    if (!open) return;
    reset({
      player: undefined as unknown as number,
      reference: currentReference(),
      amount: "",
      // Vencimento no dia 10, o costume da pelada. É só um ponto de partida.
      due_date: `${currentReference()}-10`,
      notes: "",
    });
  }, [open, reset]);

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="Nova mensalidade"
      onSubmit={handleSubmit(async (values) => {
        try {
          await onSubmit({ ...values, player: Number(values.player) });
        } catch {
          /* a mensagem aparece no alerta do drawer */
        }
      })}
      isSubmitting={isSubmitting}
      error={error}
    >
      <TextField
        select
        label="Jogador"
        defaultValue=""
        error={!!errors.player}
        helperText={errors.player?.message}
        {...register("player", { required: "Escolha o jogador" })}
      >
        {players.map((player) => (
          <MenuItem key={player.id} value={player.id}>
            {player.nickname ? `${player.name} (${player.nickname})` : player.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Competência"
        placeholder="2026-08"
        helperText={errors.reference?.message ?? "Mês de referência, no formato AAAA-MM"}
        error={!!errors.reference}
        {...register("reference", {
          required: "Informe a competência",
          pattern: { value: /^\d{4}-\d{2}$/, message: "Use o formato AAAA-MM" },
        })}
      />
      <TextField
        label="Valor (R$)"
        type="number"
        slotProps={{ htmlInput: { step: "0.01", min: "0.01" } }}
        error={!!errors.amount}
        helperText={errors.amount?.message}
        {...register("amount", { required: "Informe o valor" })}
      />
      <TextField
        label="Vencimento"
        type="date"
        slotProps={{ inputLabel: { shrink: true } }}
        error={!!errors.due_date}
        helperText={errors.due_date?.message}
        {...register("due_date", { required: "Informe o vencimento" })}
      />
      <TextField label="Observações" multiline minRows={2} {...register("notes")} />
      <Alert severity="info" variant="outlined">
        Cada jogador tem <strong>uma</strong> mensalidade por competência. Depois do vencimento, a
        cobrança aparece como <strong>Atrasada</strong> sozinha — não é preciso marcar nada.
      </Alert>
    </FormDrawer>
  );
}
