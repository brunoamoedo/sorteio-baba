import { useForm } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { authApi } from "../../api/authApi";
import { getApiErrorMessage, useApiMutation } from "../../core/data";
import { useAuth } from "./AuthContext";

interface FormValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/**
 * Troca obrigatória da senha no primeiro acesso.
 *
 * **Sem `AppLayout` de propósito**: nada de menu, barra inferior ou botão de
 * voltar. Se a pessoa puder navegar para fora, o "obrigatório" vira decoração.
 * As duas únicas saídas são trocar a senha ou sair do sistema.
 *
 * O bloqueio de verdade é do servidor (`MustChangePasswordMiddleware`): esta
 * tela é a porta, não a fechadura. Esconder o resto no cliente seria sugestão,
 * não controle de acesso.
 */
export function ChangePasswordPage({ onDone }: { onDone: () => void }) {
  const { logout, user } = useAuth();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  const mutation = useApiMutation(
    (values: { current_password: string; new_password: string }) =>
      authApi.changePassword(values),
    { onSuccess: onDone },
  );

  const novaSenha = watch("new_password");

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Paper elevation={3} sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 400 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Defina sua senha
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          Você está usando a senha temporária{user?.username ? ` de ${user.username}` : ""}. Escolha
          uma senha só sua para continuar.
        </Typography>

        <Box
          component="form"
          noValidate
          onSubmit={handleSubmit((values) =>
            mutation
              .mutateAsync({
                current_password: values.current_password,
                new_password: values.new_password,
              })
              .catch(() => {
                /* a mensagem aparece no Alert abaixo */
              }),
          )}
        >
          <Stack spacing={2}>
            <TextField
              label="Senha temporária"
              type="password"
              autoComplete="current-password"
              autoFocus
              error={!!errors.current_password}
              helperText={errors.current_password?.message}
              {...register("current_password", { required: "Informe a senha temporária" })}
            />
            <TextField
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              error={!!errors.new_password}
              helperText={errors.new_password?.message ?? "Pelo menos 8 caracteres."}
              {...register("new_password", {
                required: "Informe a nova senha",
                minLength: { value: 8, message: "Pelo menos 8 caracteres" },
              })}
            />
            <TextField
              label="Repita a nova senha"
              type="password"
              autoComplete="new-password"
              error={!!errors.confirm_password}
              helperText={errors.confirm_password?.message}
              {...register("confirm_password", {
                required: "Repita a nova senha",
                validate: (valor) => valor === novaSenha || "As senhas não conferem",
              })}
            />

            {mutation.isError && (
              <Alert severity="error">
                {getApiErrorMessage(mutation.error, "Não foi possível alterar a senha.")}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={mutation.isPending}
              startIcon={
                mutation.isPending ? <CircularProgress size={18} color="inherit" /> : undefined
              }
            >
              {mutation.isPending ? "Salvando..." : "Salvar e continuar"}
            </Button>

            {/* A única outra saída. Sem ela, quem entrou na conta errada
                ficaria preso nesta tela. */}
            <Button color="inherit" onClick={logout}>
              Sair
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
