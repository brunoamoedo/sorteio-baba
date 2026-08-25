import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, FormControlLabel, MenuItem, Switch, TextField } from "@mui/material";

import { formatTime } from "../../core/dateTime";
import { WEEKDAY_LABELS, type RecurringGame } from "../../core/types/match";
import { FormDrawer } from "../../shared/components/FormDrawer";

export interface RecurringGameFormValues {
  name: string;
  weekday: number;
  match_time: string;
  draw_time: string;
  teams_count: number;
  min_players_per_team_line: number;
  max_players_per_team_line: number;
  goalkeepers_per_team: number;
  days_before_to_generate: number;
  is_active: boolean;
}

interface RecurringGameFormDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: RecurringGameFormValues) => Promise<void>;
  recurringGame?: RecurringGame | null;
  isSubmitting: boolean;
  error?: string | null;
}

function buildDefaultValues(recurringGame?: RecurringGame | null): RecurringGameFormValues {
  if (!recurringGame) {
    return {
      name: "",
      weekday: 1,
      match_time: "21:00",
      draw_time: "20:30",
      teams_count: 2,
      min_players_per_team_line: 4,
      max_players_per_team_line: 9,
      goalkeepers_per_team: 0,
      days_before_to_generate: 7,
      is_active: true,
    };
  }
  return {
    name: recurringGame.name,
    weekday: recurringGame.weekday,
    match_time: formatTime(recurringGame.match_time),
    draw_time: formatTime(recurringGame.draw_time),
    teams_count: recurringGame.teams_count,
    min_players_per_team_line: recurringGame.min_players_per_team_line,
    max_players_per_team_line: recurringGame.max_players_per_team_line,
    goalkeepers_per_team: recurringGame.goalkeepers_per_team,
    days_before_to_generate: recurringGame.days_before_to_generate,
    is_active: recurringGame.is_active,
  };
}

export function RecurringGameFormDrawer({
  open,
  onClose,
  onSubmit,
  recurringGame,
  isSubmitting,
  error,
}: RecurringGameFormDrawerProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm<RecurringGameFormValues>({ defaultValues: buildDefaultValues(recurringGame) });

  useEffect(() => {
    if (open) reset(buildDefaultValues(recurringGame));
  }, [open, recurringGame, reset]);

  const teamsCount = watch("teams_count") || 0;
  const minLine = watch("min_players_per_team_line") || 0;
  const maxLine = watch("max_players_per_team_line") || 0;
  // `?? 1` e não `|| 1`: 0 é um valor válido e significativo aqui (goleiro
  // fixo, fora do sorteio) — `||` o transformaria silenciosamente em 1.
  const goalkeepers = watch("goalkeepers_per_team") ?? 0;
  const totalMin = teamsCount * (minLine + goalkeepers);
  const totalMax = teamsCount * (maxLine + goalkeepers);

  const submit = async (values: RecurringGameFormValues) => {
    await onSubmit(values);
  };

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={recurringGame ? "Editar jogo recorrente" : "Novo jogo recorrente"}
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

      {/* `Controller` (e não `register` + `defaultValue`): o Select do MUI é
          controlado, então editar um segundo jogo recorrente passa a mostrar o
          dia da semana dele, e não o do primeiro que foi aberto. */}
      <Controller
        name="weekday"
        control={control}
        render={({ field }) => (
          <TextField
            select
            label="Dia da semana"
            {...field}
            onChange={(event) => field.onChange(Number(event.target.value))}
          >
            {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={Number(value)}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <TextField
        label="Horário do jogo"
        type="time"
        slotProps={{ inputLabel: { shrink: true } }}
        error={!!errors.match_time}
        helperText={errors.match_time?.message}
        {...register("match_time", { required: "Informe o horário do jogo" })}
      />
      <TextField
        label="Horário do sorteio"
        type="time"
        slotProps={{ inputLabel: { shrink: true } }}
        error={!!errors.draw_time}
        helperText={errors.draw_time?.message}
        {...register("draw_time", { required: "Informe o horário do sorteio" })}
      />
      <TextField
        label="Quantidade de times"
        type="number"
        error={!!errors.teams_count}
        helperText={errors.teams_count?.message}
        {...register("teams_count", {
          required: true,
          valueAsNumber: true,
          min: { value: 2, message: "É necessário pelo menos 2 times" },
        })}
      />
      <TextField
        label="Jogadores de linha por time (mínimo)"
        type="number"
        error={!!errors.min_players_per_team_line}
        helperText={errors.min_players_per_team_line?.message ?? "Sem contar o goleiro"}
        {...register("min_players_per_team_line", {
          required: true,
          valueAsNumber: true,
          min: { value: 1, message: "Pelo menos 1 jogador de linha" },
          validate: (value) =>
            value <= (watch("max_players_per_team_line") || value) ||
            "O mínimo não pode ser maior que o máximo",
        })}
      />
      <TextField
        label="Jogadores de linha por time (máximo)"
        type="number"
        error={!!errors.max_players_per_team_line}
        helperText={errors.max_players_per_team_line?.message ?? "Sem contar o goleiro"}
        {...register("max_players_per_team_line", {
          required: true,
          valueAsNumber: true,
          min: { value: 1, message: "Pelo menos 1 jogador de linha" },
        })}
      />
      <TextField
        label="Goleiros por time"
        type="number"
        error={!!errors.goalkeepers_per_team}
        helperText={
          errors.goalkeepers_per_team?.message ??
          "Use 0 se o goleiro é fixo e não entra no sorteio — a partida passa a contar só jogadores de linha."
        }
        {...register("goalkeepers_per_team", {
          required: true,
          valueAsNumber: true,
          min: { value: 0, message: "Não pode ser negativo" },
          validate: (value) =>
            value <= (watch("max_players_per_team_line") || value) ||
            "Não pode passar do máximo de jogadores de linha por time",
        })}
      />
      <Alert severity="info" variant="outlined">
        Cada time terá {minLine}–{maxLine} de linha
        {goalkeepers > 0 ? ` + ${goalkeepers} goleiro${goalkeepers > 1 ? "s" : ""}` : " (goleiro não entra no sorteio)"}.
        Total da partida:{" "}
        <strong>
          {totalMin}–{totalMax} jogadores
        </strong>
        . Confirmados acima do máximo entram na lista de espera.
      </Alert>
      <TextField
        label="Criar a partida com quantos dias de antecedência"
        type="number"
        error={!!errors.days_before_to_generate}
        helperText={
          errors.days_before_to_generate?.message ??
          "7 = assim que a partida anterior passa. Reduza para abrir as confirmações mais perto do jogo."
        }
        {...register("days_before_to_generate", {
          required: true,
          valueAsNumber: true,
          min: { value: 1, message: "Mínimo de 1 dia" },
          max: { value: 7, message: "Máximo de 7 dias (a recorrência é semanal)" },
        })}
      />

      <Controller
        name="is_active"
        control={control}
        render={({ field }) => (
          <FormControlLabel
            control={
              <Switch
                checked={!!field.value}
                onChange={(event) => field.onChange(event.target.checked)}
              />
            }
            label="Ativo"
          />
        )}
      />
    </FormDrawer>
  );
}
