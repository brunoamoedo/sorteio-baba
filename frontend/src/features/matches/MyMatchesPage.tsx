import { Alert, Button, Card, CardContent, Stack, Typography } from "@mui/material";

import { matchesApi } from "../../api/matchesApi";
import { formatMatchDate, formatTime } from "../../core/dateTime";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import type { MyMatch } from "../../core/types/match";
import { AppLayout } from "../../shared/layout/AppLayout";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { ConfirmedPlayersList } from "./ConfirmedPlayersList";

const MY_MATCHES_KEY = ["matches", "mine"];

/** Auto-serviço do jogador.
 *
 * O jogador nunca informa quem é: a rota resolve a ficha dele a partir do
 * login. Um `player` enviado pelo cliente é ignorado no servidor — por isso
 * esta tela só manda "vou" ou "não vou". */
export function MyMatchesPage() {
  const { showToast } = useToast();
  const query = useApiQuery<MyMatch[]>(MY_MATCHES_KEY, matchesApi.mine);

  const confirmMutation = useApiMutation(
    ({ matchId, status }: { matchId: number; status: "confirmed" | "declined" }) =>
      matchesApi.confirmMe(matchId, status),
    {
      onSuccess: (result) => {
        queryStore.invalidate(MY_MATCHES_KEY);
        if (result.waitlisted) {
          showToast(
            `⏳ Partida cheia — você entrou na lista de espera (${result.waitlist_position}º).`,
            "info",
          );
        } else {
          showToast(result.status === "confirmed" ? "✅ Presença confirmada!" : "Presença cancelada.");
        }
      },
      onError: (error) =>
        showToast(getApiErrorMessage(error, "Não foi possível atualizar sua presença."), "error"),
    },
  );

  const matches = query.data ?? [];

  return (
    <AppLayout>
      <PageHeader title="Minhas Partidas" />

      {query.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {getApiErrorMessage(query.error, "Não foi possível carregar suas partidas.")}
        </Alert>
      )}

      {!query.isLoading && matches.length === 0 && (
        <Alert severity="info">Nenhuma partida por aqui no momento.</Alert>
      )}

      {matches.some((match) => match.my_player_id === null) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Seu login ainda não está vinculado a uma ficha de jogador nesta organização — por isso
          você não consegue confirmar presença. Peça ao gerente para fazer a vinculação.
        </Alert>
      )}

      <Stack spacing={1.5}>
        {matches.map((match) => {
          const confirmado = match.my_confirmation_status === "confirmed";
          const semFicha = match.my_player_id === null;
          const encerrada = match.status === "completed" || match.status === "canceled";

          return (
            <Card key={match.id}>
              <CardContent>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
                >
                  <div>
                    <Typography variant="body1" sx={{ fontWeight: 700 }}>
                      {match.name || match.recurring_game_name || "Partida"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      📅 {formatMatchDate(match.scheduled_date)} às{" "}
                      {formatTime(match.scheduled_time)}
                      {match.location && ` · 📍 ${match.location}`}
                    </Typography>
                    <ConfirmedPlayersList
                      matchId={match.id}
                      confirmedCount={match.confirmed_count}
                      maxPlayers={match.capacity.max_players}
                    />
                  </div>

                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <StatusChip
                      label={confirmado ? "Você vai" : "Você não confirmou"}
                      tone={confirmado ? "success" : "default"}
                    />
                    {!encerrada && (
                      <Button
                        variant={confirmado ? "outlined" : "contained"}
                        disabled={semFicha || confirmMutation.isPending}
                        onClick={() =>
                          confirmMutation.mutate({
                            matchId: match.id,
                            status: confirmado ? "declined" : "confirmed",
                          })
                        }
                      >
                        {confirmado ? "Não vou" : "Confirmar presença"}
                      </Button>
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </AppLayout>
  );
}
