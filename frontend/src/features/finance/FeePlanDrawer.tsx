import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert, TextField } from "@mui/material";

import type { MembershipFeePlan } from "../../core/types/finance";
import { FormDrawer } from "../../shared/components/FormDrawer";

type FeePlanFormValues = Omit<MembershipFeePlan, "id">;

interface FeePlanDrawerProps {
  open: boolean;
  onClose: () => void;
  plan: MembershipFeePlan | null;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (payload: FeePlanFormValues & { id?: number }) => Promise<unknown>;
}

/** Contrato de mensalidade da organização.
 *
 * É o que a geração automática usa: toda madrugada a task lança uma cobrança
 * por mensalista ativo, com este valor e este vencimento. Sem plano ativo,
 * nada é gerado — o lançamento continua sendo manual. */
export function FeePlanDrawer({
  open,
  onClose,
  plan,
  isSubmitting,
  error,
  onSubmit,
}: FeePlanDrawerProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FeePlanFormValues>();

  useEffect(() => {
    if (!open) return;
    reset(
      plan ?? {
        name: "Mensalidade",
        amount: "",
        period: "monthly",
        due_day: 10,
        late_fee_amount: "0",
        is_active: true,
      },
    );
  }, [open, plan, reset]);

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={plan ? "Editar plano de mensalidade" : "Novo plano de mensalidade"}
      onSubmit={handleSubmit(async (values) => {
        try {
          await onSubmit({ ...values, id: plan?.id, due_day: Number(values.due_day) });
        } catch {
          /* a mensagem aparece no alerta do drawer */
        }
      })}
      isSubmitting={isSubmitting}
      error={error}
    >
      <TextField
        label="Nome do plano"
        error={!!errors.name}
        helperText={errors.name?.message}
        {...register("name", { required: "Informe o nome" })}
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
        label="Dia do vencimento"
        type="number"
        slotProps={{ htmlInput: { min: 1, max: 31 } }}
        error={!!errors.due_day}
        helperText={
          errors.due_day?.message ?? "Em mês curto, o dia 31 escorrega para o último dia."
        }
        {...register("due_day", {
          required: true,
          valueAsNumber: true,
          min: { value: 1, message: "Entre 1 e 31" },
          max: { value: 31, message: "Entre 1 e 31" },
        })}
      />
      <TextField
        label="Multa por atraso (R$)"
        type="number"
        slotProps={{ htmlInput: { step: "0.01", min: "0" } }}
        error={!!errors.late_fee_amount}
        helperText={
          errors.late_fee_amount?.message ??
          "Acréscimo de quem paga depois do vencimento. Zero desativa a multa."
        }
        {...register("late_fee_amount", {
          min: { value: 0, message: "A multa não pode ser negativa" },
        })}
      />
      <Alert severity="info" variant="outlined">
        Com o plano <strong>ativo</strong>, a mensalidade de cada mensalista é lançada
        automaticamente todo mês. Convidados não são cobrados. Você também pode lançar na hora pelo
        botão <strong>Gerar mês</strong>.
      </Alert>
    </FormDrawer>
  );
}
