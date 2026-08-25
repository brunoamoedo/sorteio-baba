import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert, MenuItem, TextField } from "@mui/material";

import type { AddMemberPayload } from "../../api/membersApi";
import { ROLE_LABELS, type MembershipRole } from "../../core/types/organization";
import { FormDrawer } from "../../shared/components/FormDrawer";

interface AddMemberDrawerProps {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (payload: AddMemberPayload) => Promise<unknown>;
}

/** Adiciona alguém à organização corrente.
 *
 * O **e-mail é a chave**: se já existe login com ele, o vínculo aponta para
 * esse login — a mesma pessoa não vira dois cadastros ao entrar na segunda
 * pelada. Só quando o e-mail é desconhecido é que uma senha inicial é pedida. */
export function AddMemberDrawer({
  open,
  onClose,
  isSubmitting,
  error,
  onSubmit,
}: AddMemberDrawerProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddMemberPayload>();

  useEffect(() => {
    if (open) reset({ email: "", role: "jogador", password: "", username: "" });
  }, [open, reset]);

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="Adicionar pessoa"
      onSubmit={handleSubmit(async (values) => {
        try {
          await onSubmit(values);
        } catch {
          /* a mensagem aparece no alerta do drawer */
        }
      })}
      isSubmitting={isSubmitting}
      error={error}
    >
      <TextField
        label="E-mail"
        type="email"
        autoFocus
        error={!!errors.email}
        helperText={errors.email?.message ?? "Se já existir um login com este e-mail, ele é reaproveitado."}
        {...register("email", { required: "Informe o e-mail" })}
      />
      <TextField select label="Perfil" defaultValue="jogador" {...register("role")}>
        {(Object.keys(ROLE_LABELS) as MembershipRole[]).map((role) => (
          <MenuItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Nome de usuário (opcional)"
        helperText="Só para um acesso novo. Em branco, é derivado do e-mail."
        {...register("username")}
      />
      <TextField
        label="Senha inicial"
        type="password"
        helperText="Necessária apenas se ainda não existir login com este e-mail."
        {...register("password")}
      />
      <Alert severity="info" variant="outlined">
        O perfil vale <strong>só nesta organização</strong>. A mesma pessoa pode ter outro perfil em
        outra pelada, usando o mesmo login.
      </Alert>
    </FormDrawer>
  );
}
