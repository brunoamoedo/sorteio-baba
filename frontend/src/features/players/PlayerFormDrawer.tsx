import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { Box, Button, MenuItem, Rating, TextField, Typography } from "@mui/material";

import type { LinkableUser, Player, PlayerFormValues, Position } from "../../core/types/player";
import { FormDrawer } from "../../shared/components/FormDrawer";
import { formatPhone, phoneError } from "../../shared/phone";

interface PlayerFormDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<void>;
  positions: Position[];
  /** Membros da organização — a ficha pode ser vinculada a um deles. */
  linkableUsers: LinkableUser[];
  player?: Player | null;
  isSubmitting: boolean;
  error?: string | null;
}

function buildDefaultValues(player?: Player | null): PlayerFormValues {
  if (!player) {
    return {
      user: "",
      name: "",
      nickname: "",
      phone: "",
      notes: "",
      player_type: "mensalista",
      status: "ativo",
      skill_level: 3,
      primary_position: "",
      secondary_position: "",
    };
  }
  return {
    user: player.user ?? "",
    name: player.name,
    nickname: player.nickname,
    phone: formatPhone(player.phone),
    notes: player.notes,
    player_type: player.player_type,
    status: player.status,
    skill_level: player.skill_level,
    primary_position: player.primary_position,
    secondary_position: player.secondary_position ?? "",
  };
}

/**
 * Todos os campos de seleção usam `<Controller>`.
 *
 * Antes eles combinavam `{...register(...)}` com `defaultValue`, o que deixava o
 * `Select` do MUI **não-controlado**: o `reset()` atualizava o estado interno do
 * formulário, mas o componente continuava mostrando o valor lido no primeiro
 * mount. Na prática, abrir "Editar" em um jogador e depois em outro exibia (e
 * salvava) o Tipo/Status/Posição do primeiro.
 */
export function PlayerFormDrawer({
  open,
  onClose,
  onSubmit,
  positions,
  linkableUsers,
  player,
  isSubmitting,
  error,
}: PlayerFormDrawerProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<PlayerFormValues>({ defaultValues: buildDefaultValues(player) });

  // Depende também de `open`: reabrir o drawer sempre parte dos dados atuais,
  // descartando uma edição anterior cancelada.
  useEffect(() => {
    if (open) reset(buildDefaultValues(player));
  }, [open, player, reset]);

  // Enquanto as posições não chegam (query separada), o Select fica vazio de
  // propósito — exibir um valor sem a `MenuItem` correspondente gera aviso do
  // MUI e um campo aparentemente em branco.
  const positionsReady = positions.length > 0;

  const submit = async (values: PlayerFormValues) => {
    const formData = new FormData();
    formData.append("name", values.name);
    formData.append("nickname", values.nickname);
    formData.append("phone", values.phone);
    formData.append("notes", values.notes);
    formData.append("player_type", values.player_type);
    formData.append("status", values.status);
    formData.append("skill_level", String(values.skill_level));
    formData.append("primary_position", String(values.primary_position));
    formData.append("secondary_position", values.secondary_position ? String(values.secondary_position) : "");
    // String vazia = desvincular. O DRF converte "" em `null` num campo
    // `allow_null`, que é exatamente o que "sem login vinculado" significa.
    formData.append("user", values.user ? String(values.user) : "");
    if (values.photo && values.photo.length > 0) {
      formData.append("photo", values.photo[0]);
    }
    await onSubmit(formData);
  };

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={player ? "Editar jogador" : "Novo jogador"}
      onSubmit={handleSubmit(submit)}
      isSubmitting={isSubmitting}
      error={error}
    >
      <TextField
        label="Nome"
        autoFocus
        error={!!errors.name}
        helperText={errors.name?.message}
        {...register("name", { required: "Informe o nome" })}
      />
      <TextField label="Apelido" {...register("nickname")} />
      <Controller
        name="phone"
        control={control}
        // Vazio passa: nem toda ficha tem telefone. Preenchido, tem que estar
        // certo — o número vira o **usuário do login** da pessoa.
        rules={{ validate: (value) => phoneError(String(value ?? "")) ?? true }}
        render={({ field }) => (
          <TextField
            label="Telefone"
            placeholder="(11) 91434-4257"
            error={!!errors.phone}
            helperText={errors.phone?.message ?? "DDD + 9 + o número. É com ele que a pessoa entra no sistema."}
            // `inputMode` abre o teclado numérico no celular, que é onde este
            // cadastro é preenchido de verdade.
            slotProps={{ htmlInput: { inputMode: "tel" } }}
            value={field.value}
            onChange={(event) => field.onChange(formatPhone(event.target.value))}
            onBlur={field.onBlur}
            name={field.name}
          />
        )}
      />
      <TextField label="Observações" multiline minRows={2} {...register("notes")} />

      <Controller
        name="player_type"
        control={control}
        render={({ field }) => (
          <TextField select label="Tipo" {...field}>
            <MenuItem value="mensalista">Mensalista</MenuItem>
            <MenuItem value="convidado">Convidado</MenuItem>
          </TextField>
        )}
      />

      <Controller
        name="status"
        control={control}
        render={({ field }) => (
          <TextField
            select
            label="Status"
            helperText="Jogadores inativos não aparecem no roster nem entram no sorteio."
            {...field}
          >
            <MenuItem value="ativo">Ativo</MenuItem>
            <MenuItem value="inativo">Inativo</MenuItem>
          </TextField>
        )}
      />

      <Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Nível técnico
        </Typography>
        <Controller
          name="skill_level"
          control={control}
          render={({ field }) => (
            <Rating
              value={field.value}
              onChange={(_, value) => field.onChange(value ?? 1)}
              aria-label="Nível técnico do jogador"
            />
          )}
        />
      </Box>

      <Controller
        name="primary_position"
        control={control}
        rules={{ required: "Selecione a posição principal" }}
        render={({ field }) => (
          <TextField
            select
            label="Posição principal"
            error={!!errors.primary_position}
            helperText={
              errors.primary_position?.message ?? (positionsReady ? undefined : "Carregando posições...")
            }
            {...field}
            value={positionsReady ? field.value : ""}
            disabled={!positionsReady}
          >
            {positions.map((position) => (
              <MenuItem key={position.id} value={position.id}>
                {position.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <Controller
        name="secondary_position"
        control={control}
        render={({ field }) => (
          <TextField
            select
            label="Posição secundária (opcional)"
            {...field}
            value={positionsReady ? field.value : ""}
            disabled={!positionsReady}
          >
            <MenuItem value="">Nenhuma</MenuItem>
            {positions.map((position) => (
              <MenuItem key={position.id} value={position.id}>
                {position.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <Button variant="outlined" component="label">
        Foto
        <input type="file" accept="image/*" hidden {...register("photo")} />
      </Button>

      {/* Vínculo com o login. É o que dá ao jogador acesso a "Minhas Partidas"
          e "Minhas Mensalidades" — sem ele, o perfil Jogador não encontra a
          ficha e não consegue confirmar a própria presença. */}
      <Controller
        name="user"
        control={control}
        render={({ field }) => (
          <TextField
            select
            label="Login vinculado (opcional)"
            helperText="Dá a esta pessoa acesso de Jogador às próprias partidas e mensalidades."
            {...field}
          >
            <MenuItem value="">Sem login vinculado</MenuItem>
            {linkableUsers.map((linkable) => {
              // Já vinculado a **outra** ficha: aparece desabilitado em vez de
              // sumir, senão o gerente não entende por que o nome não está lá.
              const ocupado =
                !!linkable.linked_player_name && linkable.id !== player?.user;
              return (
                <MenuItem key={linkable.id} value={linkable.id} disabled={ocupado}>
                  {linkable.username}
                  {ocupado ? ` — já é ${linkable.linked_player_name}` : ""}
                </MenuItem>
              );
            })}
          </TextField>
        )}
      />
    </FormDrawer>
  );
}
