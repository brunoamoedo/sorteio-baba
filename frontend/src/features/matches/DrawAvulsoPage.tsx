import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { drawsApi } from "../../api/drawsApi";
import { matchesApi } from "../../api/matchesApi";
import { playersApi } from "../../api/playersApi";
import { getApiErrorMessage, useApiMutation, useApiQuery } from "../../core/data";
import { nowTime, todayIso } from "../../core/dateTime";
import type { Match } from "../../core/types/match";
import type { Player } from "../../core/types/player";
import { AppLayout } from "../../shared/layout/AppLayout";
import { PageHeader } from "../../shared/components/PageHeader";
import { useToast } from "../../shared/components/ToastProvider";
import { DrawIcon } from "../../shared/icons";
import { BulkNamesInput, splitNames } from "./BulkNamesInput";
import { MensalistaSearchAutocomplete, mensalistaLabel } from "./MensalistaSearchAutocomplete";
import {
  applyFix,
  QuickConfirmResolutionList,
  toResolutionRows,
  type ResolutionRow,
} from "./QuickConfirmResolutionList";

/** O goleiro do racha avulso costuma ser combinado na hora, fora do sorteio —
 * o mesmo padrão da partida manual. */
const DEFAULT_GOALKEEPERS_PER_TEAM = 0;

/**
 * Capacidade que **cabe exatamente esta lista**.
 *
 * A partida avulsa nasce dimensionada pelos nomes que o organizador trouxe: se
 * o teto fosse fixo, colar 16 nomes numa partida de 14 mandaria dois para a
 * lista de espera sem que ninguém tivesse pedido isso — numa tela cujo objetivo
 * é sortear quem está ali, agora.
 *
 * O mínimo por time é 1 de linha: o piso prático do algoritmo, o mesmo que a
 * partida manual usa.
 */
export function capacityForList(
  namesCount: number,
  teamsCount: number,
  goalkeepersPerTeam: number,
): { minLine: number; maxLine: number; total: number } {
  const teams = Math.max(2, teamsCount);
  const perTeam = Math.max(1, Math.ceil(namesCount / teams));
  // Nunca abaixo de 1, e nunca abaixo do número de goleiros — o servidor recusa
  // um time que só comporta goleiro.
  const maxLine = Math.max(1, goalkeepersPerTeam, perTeam - goalkeepersPerTeam);
  return { minLine: 1, maxLine, total: teams * (maxLine + goalkeepersPerTeam) };
}

/**
 * Sorteio Avulso — da lista de nomes ao sorteio, em uma tela.
 *
 * O caminho é o mesmo da partida que já existia (criar partida → confirmar
 * presença pela lista → sortear), só que sem obrigar o organizador a percorrer
 * três telas para jogar hoje. Nada aqui reimplementa reconhecimento de nome: a
 * lista vai para o **mesmo** `quick-confirm` da tela da partida, e a conferência
 * é o mesmo componente.
 */
export function DrawAvulsoPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [namesText, setNamesText] = useState("");
  const [name, setName] = useState("");
  const [scheduledDate, setScheduledDate] = useState(todayIso());
  const [scheduledTime, setScheduledTime] = useState(nowTime());
  const [teamsCount, setTeamsCount] = useState(2);
  const [goalkeepersPerTeam, setGoalkeepersPerTeam] = useState(DEFAULT_GOALKEEPERS_PER_TEAM);

  const [match, setMatch] = useState<Match | null>(null);
  const [resolutions, setResolutions] = useState<ResolutionRow[] | null>(null);

  const names = useMemo(() => splitNames(namesText), [namesText]);
  const capacity = useMemo(
    () => capacityForList(names.length, teamsCount, goalkeepersPerTeam),
    [names.length, teamsCount, goalkeepersPerTeam],
  );

  const mensalistasQuery = useApiQuery<Player[]>(
    ["players", { player_type: "mensalista", status: "ativo" }],
    () => playersApi.list({ player_type: "mensalista", status: "ativo" }),
  );

  /** Quem ainda não está na lista digitada. Oferecer de novo quem já está só
   * produz linha duplicada — que o servidor relata como `ja_confirmado` e o
   * organizador tem de ir conferir à toa. */
  const availableToAdd = useMemo(() => {
    const alreadyListed = new Set(names.map((line) => line.toLocaleLowerCase()));
    return (mensalistasQuery.data ?? []).filter(
      (player) => !alreadyListed.has(mensalistaLabel(player).toLocaleLowerCase()),
    );
  }, [mensalistasQuery.data, names]);

  /** Na conferência, corrigir uma linha só pode apontar para quem ainda não foi
   * reconhecido — a mesma regra do diálogo da tela da partida. */
  const availableToFix = useMemo(() => {
    const takenIds = new Set(
      (resolutions ?? [])
        .filter((row) => row.resolution === "mensalista")
        .map((row) => row.player_id),
    );
    return (mensalistasQuery.data ?? []).filter((player) => !takenIds.has(player.id));
  }, [mensalistasQuery.data, resolutions]);

  const createAndConfirm = useApiMutation(
    async () => {
      const created = await matchesApi.create({
        name: name.trim(),
        location: "",
        notes: "",
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        // Partida avulsa não entra no sorteio automático: quem está nesta tela
        // vai sortear com o botão, agora.
        draw_time: null,
        teams_count: teamsCount,
        goalkeepers_per_team: goalkeepersPerTeam,
        min_players_per_team_line: capacity.minLine,
        max_players_per_team_line: capacity.maxLine,
      });
      const confirmed = await matchesApi.quickConfirm(created.id, names);
      return { created, confirmed };
    },
    {
      onSuccess: ({ created, confirmed }) => {
        setMatch(created);
        setResolutions(toResolutionRows(confirmed));
      },
    },
  );

  const reassignMutation = useApiMutation(
    ({ row, player }: { row: ResolutionRow; player: Player }) =>
      matchesApi
        .reassignConfirmation(match?.id ?? 0, row.player_id ?? 0, player.id)
        .then(() => player),
    { onSuccess: (player, { row }) => setResolutions((c) => applyFix(c, row.rowId, player)) },
  );

  const confirmInsteadMutation = useApiMutation(
    ({ player }: { row: ResolutionRow; player: Player }) =>
      matchesApi.setConfirmation(match?.id ?? 0, player.id, "confirmed").then(() => player),
    { onSuccess: (player, { row }) => setResolutions((c) => applyFix(c, row.rowId, player)) },
  );

  const drawMutation = useApiMutation(() => drawsApi.trigger(match?.id ?? 0), {
    onSuccess: () => {
      showToast("Times sorteados!", "success");
      // A tela da partida é a dona do resultado (formação, campo, placar,
      // mensagem de WhatsApp). Duplicar isso aqui criaria uma segunda tela de
      // resultado para manter.
      navigate(`/partidas/${match?.id}`);
    },
  });

  const confirmedCount =
    resolutions?.filter((row) => row.resolution === "mensalista" || row.resolution === "convidado_criado")
      .length ?? 0;

  return (
    <AppLayout>
      <PageHeader title="Sorteio avulso" />

      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        {!resolutions ? (
          <>
            <Alert severity="info" variant="outlined">
              Monte a lista de quem vai jogar hoje e sorteie na hora. Uma{" "}
              <strong>partida avulsa</strong> é criada com esses nomes — ela aparece em Partidas e
              pode ser cancelada por lá se você desistir.
            </Alert>

            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  1. Quem vai jogar
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <BulkNamesInput value={namesText} onChange={setNamesText} autoFocus minRows={6} />
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Ou acrescente um mensalista pelo nome — ele entra como mais uma linha da lista.
                  </Typography>
                  <MensalistaSearchAutocomplete
                    options={availableToAdd}
                    loading={mensalistasQuery.isLoading}
                    clearOnPick
                    placeholder="Buscar mensalista"
                    noOptionsText="Todos os mensalistas já estão na lista"
                    onPick={(player) =>
                      setNamesText((current) =>
                        current.trim() ? `${current.trimEnd()}\n${mensalistaLabel(player)}` : mensalistaLabel(player),
                      )
                    }
                  />
                </Box>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  2. Como sortear
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <TextField
                    label="Nome da partida"
                    placeholder="Ex.: Racha de sábado"
                    helperText="Opcional"
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                      label="Data"
                      type="date"
                      fullWidth
                      slotProps={{ inputLabel: { shrink: true } }}
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                    />
                    <TextField
                      label="Horário"
                      type="time"
                      fullWidth
                      slotProps={{ inputLabel: { shrink: true } }}
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                      label="Quantidade de times"
                      type="number"
                      fullWidth
                      value={teamsCount}
                      onChange={(e) => setTeamsCount(Number(e.target.value))}
                      slotProps={{ htmlInput: { min: 2 } }}
                    />
                    <TextField
                      label="Goleiros por time"
                      type="number"
                      fullWidth
                      helperText="0 = goleiro fixo, fora do sorteio"
                      value={goalkeepersPerTeam}
                      onChange={(e) => setGoalkeepersPerTeam(Number(e.target.value))}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Stack>
                  <Alert severity="info" variant="outlined">
                    {names.length === 0 ? (
                      <>Cole ou busque os nomes acima para montar a partida.</>
                    ) : (
                      <>
                        <strong>{names.length}</strong>{" "}
                        {names.length === 1 ? "nome na lista" : "nomes na lista"} em{" "}
                        <strong>{Math.max(2, teamsCount)} times</strong> — até {capacity.maxLine} de
                        linha por time
                        {goalkeepersPerTeam > 0
                          ? ` + ${goalkeepersPerTeam} goleiro${goalkeepersPerTeam > 1 ? "s" : ""}`
                          : ""}
                        . A partida é criada com espaço para todo mundo, então{" "}
                        <strong>ninguém vai para a lista de espera</strong>.
                      </>
                    )}
                  </Alert>
                </Stack>
              </CardContent>
            </Card>

            {createAndConfirm.isError && (
              <Alert severity="error">
                {getApiErrorMessage(createAndConfirm.error, "Não foi possível criar a partida.")}
              </Alert>
            )}

            <Button
              variant="contained"
              size="large"
              disabled={names.length === 0 || createAndConfirm.isPending}
              onClick={() => createAndConfirm.mutate()}
            >
              {createAndConfirm.isPending ? "Criando partida..." : "Criar partida e conferir lista"}
            </Button>
          </>
        ) : (
          <>
            <Alert severity="success" variant="outlined">
              Partida criada com <strong>{confirmedCount}</strong>{" "}
              {confirmedCount === 1 ? "confirmado" : "confirmados"}. Confira o que o sistema
              entendeu de cada linha e sorteie.
            </Alert>

            {reassignMutation.isError && (
              <Alert severity="error">
                {getApiErrorMessage(reassignMutation.error, "Não foi possível corrigir o jogador.")}
              </Alert>
            )}
            {confirmInsteadMutation.isError && (
              <Alert severity="error">
                {getApiErrorMessage(
                  confirmInsteadMutation.error,
                  "Não foi possível confirmar o jogador.",
                )}
              </Alert>
            )}

            <Card variant="outlined">
              <CardContent>
                <QuickConfirmResolutionList
                  rows={resolutions}
                  availableMensalistas={availableToFix}
                  isLoadingOptions={mensalistasQuery.isLoading}
                  isFixing={reassignMutation.isPending || confirmInsteadMutation.isPending}
                  onFix={(row, player) => {
                    if (row.resolution === "ja_confirmado") {
                      confirmInsteadMutation.mutate({ row, player });
                    } else {
                      reassignMutation.mutate({ row, player });
                    }
                  }}
                />
              </CardContent>
            </Card>

            {drawMutation.isError && (
              <Alert severity="error">
                {getApiErrorMessage(drawMutation.error, "Não foi possível sortear os times.")}
              </Alert>
            )}

            <Divider />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                variant="contained"
                size="large"
                startIcon={<DrawIcon />}
                disabled={drawMutation.isPending}
                onClick={() => drawMutation.mutate()}
                sx={{ flex: 1 }}
              >
                {drawMutation.isPending ? "Sorteando..." : "Sortear times"}
              </Button>
              <Button variant="outlined" onClick={() => navigate(`/partidas/${match?.id}`)}>
                Abrir a partida
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </AppLayout>
  );
}
