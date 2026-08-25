import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert, TextField } from "@mui/material";

import type { MatchWritePayload } from "../../api/matchesApi";
import { formatTime, todayIso } from "../../core/dateTime";
import type { Match } from "../../core/types/match";
import { FormDrawer } from "../../shared/components/FormDrawer";

const DEFAULT_GOALKEEPERS_PER_TEAM = 0;

/** A partida avulsa não pede um mínimo: o sorteio libera com o piso prático do
 * algoritmo (1 de linha por time + os goleiros configurados). Partidas que já
 * têm um mínimo definido (as geradas por jogo recorrente) preservam o valor
 * delas ao serem editadas aqui. */
const DEFAULT_MIN_LINE_PER_TEAM = 1;

export interface MatchFormValues {
  name: string;
  location: string;
  notes: string;
  scheduled_date: string;
  scheduled_time: string;
  draw_time: string;
  teams_count: number;
  goalkeepers_per_team: number;
  max_players_per_team_line: number;
}

interface MatchFormDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: MatchWritePayload) => Promise<void>;
  match?: Match | null;
  isSubmitting: boolean;
  error?: string | null;
}

function buildDefaultValues(match?: Match | null): MatchFormValues {
  if (!match) {
    return {
      name: "",
      location: "",
      notes: "",
      scheduled_date: todayIso(),
      scheduled_time: "21:00",
      draw_time: "",
      teams_count: 2,
      goalkeepers_per_team: DEFAULT_GOALKEEPERS_PER_TEAM,
      max_players_per_team_line: 9,
    };
  }
  return {
    name: match.name,
    location: match.location,
    notes: match.notes,
    scheduled_date: match.scheduled_date,
    scheduled_time: formatTime(match.scheduled_time),
    draw_time: match.draw_time ? formatTime(match.draw_time) : "",
    teams_count: match.teams_count,
    goalkeepers_per_team: match.goalkeepers_per_team,
    // Lido da capacidade calculada pelo backend, não recalculado aqui.
    max_players_per_team_line: match.capacity.line_players_per_team,
  };
}

export function MatchFormDrawer({
  open,
  onClose,
  onSubmit,
  match,
  isSubmitting,
  error,
}: MatchFormDrawerProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, dirtyFields },
  } = useForm<MatchFormValues>({ defaultValues: buildDefaultValues(match) });

  useEffect(() => {
    if (open) reset(buildDefaultValues(match));
  }, [open, match, reset]);

  // Não é um campo do formulário: partida nova usa o piso padrão; partida
  // existente mantém o mínimo que já tinha, para editar o local (por exemplo)
  // não afrouxar a trava do sorteio de uma partida de jogo recorrente.
  const minLine = match
    ? Math.max(
        1,
        Math.floor(match.min_players / Math.max(1, match.teams_count)) - match.goalkeepers_per_team,
      )
    : DEFAULT_MIN_LINE_PER_TEAM;

  /** Nome exibido na listagem quando a partida não tem nome próprio. */
  const inheritedName = match?.recurring_game_name ?? "";

  const teamsCount = watch("teams_count") || 0;
  const maxLine = watch("max_players_per_team_line") || 0;
  // `?? 1` e não `|| 1`: 0 goleiros é um valor válido (goleiro fixo, fora do
  // sorteio) e `||` o converteria em 1, inflando a partida de novo.
  const goalkeepers = watch("goalkeepers_per_team") ?? DEFAULT_GOALKEEPERS_PER_TEAM;
  const totalMin = teamsCount * (minLine + goalkeepers);
  const totalMax = teamsCount * (maxLine + goalkeepers);

  const submit = handleSubmit((values) => {
    const { teams_count, max_players_per_team_line, draw_time, ...rest } = values;
    const base = {
      ...rest,
      teams_count,
      // O backend distingue "sem horário de sorteio" (nunca sorteia sozinha) de
      // um horário informado — string vazia precisa virar null.
      draw_time: draw_time ? draw_time : null,
    };

    // Se o organizador não mexeu na configuração de capacidade, os totais
    // originais são reenviados **intactos**. Antes o formulário sempre
    // reconvertia total → linha → total com arredondamento, então editar apenas
    // o local de uma partida podia alterar silenciosamente quantos jogadores
    // ela comporta — o que agora define quem entra e quem fica na espera.
    const capacityUntouched =
      !!match &&
      !dirtyFields.teams_count &&
      !dirtyFields.max_players_per_team_line &&
      !dirtyFields.goalkeepers_per_team;

    if (capacityUntouched) {
      return onSubmit({ ...base, min_players: match.min_players, max_players: match.max_players });
    }

    return onSubmit({
      ...base,
      min_players_per_team_line: minLine,
      max_players_per_team_line,
    });
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={match ? "Editar partida" : "Nova partida"}
      onSubmit={submit}
      isSubmitting={isSubmitting}
      error={error}
    >
      {/* Partida gerada por jogo recorrente não tem nome próprio: a listagem
          mostra o nome do jogo recorrente. Sem deixar isso explícito, abrir a
          edição dava a impressão de que o nome tinha sido perdido. O nome
          herdado aparece como placeholder e o texto de ajuda explica a origem. */}
      <TextField
        label="Nome da partida"
        autoFocus
        placeholder={inheritedName || "Ex.: Racha de sábado"}
        helperText={
          inheritedName
            ? `Opcional. Em branco, esta partida continua sendo exibida como "${inheritedName}", o nome do jogo recorrente.`
            : "Opcional — ex.: Racha de sábado"
        }
        slotProps={{ inputLabel: { shrink: true } }}
        {...register("name")}
      />
      <TextField
        label="Data"
        type="date"
        slotProps={{ inputLabel: { shrink: true } }}
        error={!!errors.scheduled_date}
        helperText={errors.scheduled_date?.message}
        {...register("scheduled_date", { required: "Informe a data" })}
      />
      <TextField
        label="Horário do jogo"
        type="time"
        slotProps={{ inputLabel: { shrink: true } }}
        error={!!errors.scheduled_time}
        helperText={errors.scheduled_time?.message}
        {...register("scheduled_time", { required: "Informe o horário" })}
      />
      <TextField
        label="Horário do sorteio"
        type="time"
        slotProps={{ inputLabel: { shrink: true } }}
        helperText={
          inheritedName
            ? `Opcional. Em branco, esta partida herda o horário de sorteio de "${inheritedName}".`
            : "Opcional — em branco, não há sorteio automático: a partida só é sorteada pelo botão."
        }
        {...register("draw_time")}
      />
      <TextField label="Local" helperText="Opcional" {...register("location")} />
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
        Cada time terá até {maxLine} de linha
        {goalkeepers > 0 ? ` + ${goalkeepers} goleiro${goalkeepers > 1 ? "s" : ""}` : " (goleiro não entra no sorteio)"}{" "}
        — no máximo <strong>{totalMax} jogadores</strong>. O sorteio libera a partir de {totalMin}{" "}
        confirmados, e quem confirmar acima do máximo entra na <strong>lista de espera</strong>.
      </Alert>
      <TextField label="Observações" multiline minRows={2} {...register("notes")} />
    </FormDrawer>
  );
}
