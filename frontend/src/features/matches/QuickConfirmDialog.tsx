import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";

import { matchesApi } from "../../api/matchesApi";
import { playersApi } from "../../api/playersApi";
import { getApiErrorMessage, useApiMutation, useApiQuery } from "../../core/data";
import type { RosterEntry } from "../../core/types/match";
import type { Player } from "../../core/types/player";
import { BulkNamesInput, splitNames } from "./BulkNamesInput";
import { matchKeys, useMatchInvalidation } from "./matchQueries";
import {
  applyFix,
  QuickConfirmResolutionList,
  toResolutionRows,
  type ResolutionRow,
} from "./QuickConfirmResolutionList";

interface QuickConfirmDialogProps {
  open: boolean;
  matchId: number;
  onClose: () => void;
}

export function QuickConfirmDialog({ open, matchId, onClose }: QuickConfirmDialogProps) {
  const invalidate = useMatchInvalidation(matchId);
  const [namesText, setNamesText] = useState("");
  const [resolutions, setResolutions] = useState<ResolutionRow[] | null>(null);

  const mensalistasQuery = useApiQuery<Player[]>(
    ["players", { player_type: "mensalista", status: "ativo" }],
    () => playersApi.list({ player_type: "mensalista", status: "ativo" }),
    { enabled: open },
  );

  /** Mesma chave da tela da partida: confirmar alguém por aqui invalida o
   * roster e a lista de opções se atualiza sozinha. */
  const rosterQuery = useApiQuery<RosterEntry[]>(
    matchKeys.roster(matchId),
    () => matchesApi.roster(matchId),
    { enabled: open },
  );

  /**
   * Só entram na busca os mensalistas que **ainda não estão confirmados** nesta
   * partida — é a mesma regra que o servidor aplica no reconhecimento
   * automático (`quick_confirm_names`).
   *
   * Oferecer quem já está dentro não corrige nada: o convidado errado sairia, o
   * mensalista continuaria onde estava e a partida perderia uma vaga sem
   * ninguém perceber. O servidor recusa, mas o certo é o nome nem aparecer.
   */
  const availableMensalistas = useMemo(() => {
    const confirmedIds = new Set(
      (rosterQuery.data ?? [])
        .filter((entry) => entry.confirmation_status === "confirmed")
        .map((entry) => entry.player.id),
    );
    return (mensalistasQuery.data ?? []).filter((player) => !confirmedIds.has(player.id));
  }, [mensalistasQuery.data, rosterQuery.data]);

  const quickConfirmMutation = useApiMutation(
    (names: string[]) => matchesApi.quickConfirm(matchId, names),
    {
      onSuccess: (data) => {
        setResolutions(toResolutionRows(data));
        invalidate.presence();
      },
    },
  );

  // `wrongPlayerId` não é parâmetro: o jogador errado é sempre o que está na
  // linha (`rowId`), e passá-lo de fora só criava uma segunda fonte da verdade
  // que o corpo ignorava.
  const reassignMutation = useApiMutation(
    ({ rowId, correctPlayer }: { rowId: number; correctPlayer: Player }) =>
      matchesApi
        .reassignConfirmation(
          matchId,
          resolutions?.find((r) => r.rowId === rowId)?.player_id ?? 0,
          correctPlayer.id,
        )
        .then(() => correctPlayer),
    {
      onSuccess: (correctPlayer, { rowId }) => {
        setResolutions((current) => applyFix(current, rowId, correctPlayer));
        invalidate.presence();
      },
    },
  );

  /**
   * Resolve uma linha `ja_confirmado`: o organizador diz quem era de verdade e
   * essa pessoa é confirmada.
   *
   * Não é uma "correção" (`reassignConfirmation`) porque não há nada errado
   * para desfazer — a linha não confirmou ninguém. É só a confirmação que
   * faltou, pelo mesmo caminho do interruptor da tela da partida.
   */
  const confirmInsteadMutation = useApiMutation(
    ({ correctPlayer }: { rowId: number; correctPlayer: Player }) =>
      matchesApi.setConfirmation(matchId, correctPlayer.id, "confirmed").then(() => correctPlayer),
    {
      onSuccess: (correctPlayer, { rowId }) => {
        setResolutions((current) => applyFix(current, rowId, correctPlayer));
        invalidate.presence();
      },
    },
  );

  const handleClose = () => {
    setNamesText("");
    setResolutions(null);
    quickConfirmMutation.reset();
    reassignMutation.reset();
    confirmInsteadMutation.reset();
    onClose();
  };

  const handleSubmitNames = () => {
    const names = splitNames(namesText);
    if (names.length === 0) return;
    quickConfirmMutation.mutate(names);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Confirmar presença com lista de nomes</DialogTitle>
      <DialogContent>
        {!resolutions ? (
          <>
            <BulkNamesInput
              value={namesText}
              onChange={setNamesText}
              autoFocus
              helper={
                <>
                  Cole a lista do grupo, um nome por linha —{" "}
                  <strong>pode colar com numeração, emojis e anotações</strong> (“3 - Zango
                  ♟️(Sacra) PAGO” é lido como “Zango”). Quem for reconhecido como mensalista já é
                  confirmado; quem não for encontrado entra como convidado (e dá pra corrigir
                  depois). Linhas marcadas com 👋 ou ❌ são listadas como{" "}
                  <strong>fora da lista</strong> e não são confirmadas. Se a partida lotar, o
                  restante vai para a lista de espera.
                </>
              }
            />
            {quickConfirmMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {getApiErrorMessage(quickConfirmMutation.error, "Não foi possível processar a lista.")}
              </Alert>
            )}
          </>
        ) : (
          <>
            {reassignMutation.isError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {getApiErrorMessage(reassignMutation.error, "Não foi possível corrigir o jogador.")}
              </Alert>
            )}
            {confirmInsteadMutation.isError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {getApiErrorMessage(
                  confirmInsteadMutation.error,
                  "Não foi possível confirmar o jogador.",
                )}
              </Alert>
            )}
            <QuickConfirmResolutionList
              rows={resolutions}
              availableMensalistas={availableMensalistas}
              isLoadingOptions={mensalistasQuery.isLoading || rosterQuery.isLoading}
              isFixing={reassignMutation.isPending || confirmInsteadMutation.isPending}
              onFix={(row, player) => {
                // A linha `ja_confirmado` não confirmou ninguém: não há o que
                // desfazer, só o que confirmar.
                if (row.resolution === "ja_confirmado") {
                  confirmInsteadMutation.mutate({ rowId: row.rowId, correctPlayer: player });
                } else {
                  reassignMutation.mutate({ rowId: row.rowId, correctPlayer: player });
                }
              }}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{resolutions ? "Concluir" : "Cancelar"}</Button>
        {!resolutions && (
          <Button
            variant="contained"
            onClick={handleSubmitNames}
            disabled={quickConfirmMutation.isPending || namesText.trim().length === 0}
          >
            {quickConfirmMutation.isPending ? "Processando..." : "Confirmar presença"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
