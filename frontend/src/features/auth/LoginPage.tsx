import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";

import { useAuth } from "./AuthContext";
import type { LoginPayload } from "../../api/authApi";

export function LoginPage() {
  const { login, loginError, clearLoginError, isLoggingIn, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginPayload>({ defaultValues: { username: "", password: "" } });

  // A navegação acontece **quando a sessão fica pronta**, não logo depois da
  // resposta do login. Antes o `navigate("/")` disparava com o usuário ainda
  // não resolvido e o guard de rota devolvia todo mundo para cá — daí a
  // necessidade do segundo clique.
  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  const onSubmit = async (payload: LoginPayload) => {
    // `login` propaga o erro; sem este catch a rejeição escapava do
    // `handleSubmit` do react-hook-form e virava "unhandled rejection".
    try {
      await login(payload);
    } catch {
      /* a mensagem já está em `loginError` */
    }
  };

  const isBusy = isLoggingIn || (isAuthenticated && isLoading);

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
      <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 360 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
          Sorteio da Pelada
        </Typography>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2}>
            {/* O campo aceita os três: o `username` é uma invenção do sistema,
                que o jogador não escolheu e não lembra — o telefone e o e-mail
                são dados que ele reconhece como seus. */}
            <TextField
              label="Usuário, e-mail ou telefone"
              autoFocus
              autoComplete="username"
              error={!!errors.username}
              helperText={errors.username?.message ?? "Pode entrar com o seu telefone"}
              {...register("username", {
                required: "Informe o usuário, e-mail ou telefone",
                onChange: () => clearLoginError(),
              })}
            />
            <TextField
              label="Senha"
              type="password"
              autoComplete="current-password"
              error={!!errors.password}
              helperText={errors.password?.message}
              {...register("password", {
                required: "Informe a senha",
                onChange: () => clearLoginError(),
              })}
            />
            {loginError && <Alert severity="error">{loginError}</Alert>}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={isBusy}
              startIcon={isBusy ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {isBusy ? "Entrando..." : "Entrar"}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
