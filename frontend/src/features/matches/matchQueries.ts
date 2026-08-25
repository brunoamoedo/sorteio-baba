import { useMemo } from "react";

import { queryStore, type QueryKey } from "../../core/data";
import type { Draw, Team } from "../../core/types/draw";

/**
 * Chaves de cache do domínio de partidas, em um lugar só.
 *
 * Cada tipo de dado tem uma raiz própria (`["matches","roster",id]` em vez de
 * `["matches",id,"roster"]`) para que a invalidação por prefixo seja cirúrgica:
 * atualizar o roster não força o recarregamento do sorteio e do histórico.
 */
export const matchKeys = {
  list: (): QueryKey => ["matches", "list"],
  detail: (matchId: number): QueryKey => ["matches", "detail", matchId],
  roster: (matchId: number): QueryKey => ["matches", "roster", matchId],
  waitlist: (matchId: number): QueryKey => ["matches", "waitlist", matchId],
  currentDraw: (matchId: number): QueryKey => ["draws", "current", matchId],
  drawHistory: (matchId: number): QueryKey => ["draws", "history", matchId],
  dashboard: (): QueryKey => ["dashboard", "summary"],
  players: (): QueryKey => ["players"],
  recurringGames: (): QueryKey => ["recurring-games"],
  positions: (): QueryKey => ["positions"],
  statistics: (): QueryKey => ["statistics", "players"],
  auditLogs: (): QueryKey => ["audit-logs"],
};

/**
 * Invalidações da tela de partida. Antes esse bloco de três `invalidateQueries`
 * estava copiado entre `MatchDetailPage` e `QuickConfirmDialog` — e o segundo já
 * tinha esquecido de invalidar a fila/dashboard.
 */
export function useMatchInvalidation(matchId: number) {
  return useMemo(() => {
    const invalidate = (...keys: QueryKey[]) => keys.forEach((key) => queryStore.invalidate(key));

    /** Qualquer mudança de presença mexe no roster, na fila, no contador da
     * partida, na listagem e no dashboard. */
    const presence = () =>
      invalidate(
        matchKeys.roster(matchId),
        matchKeys.waitlist(matchId),
        matchKeys.detail(matchId),
        matchKeys.list(),
        matchKeys.dashboard(),
      );

    /** Sortear também mexe em presença: quando há mais confirmados que a
     * capacidade, o excedente vai para a fila antes do sorteio. Por isso o
     * roster e a fila entram aqui — sem eles, o painel de espera continuava
     * mostrando o estado anterior depois de "Sortear Novamente". */
    const draws = () =>
      invalidate(
        matchKeys.currentDraw(matchId),
        matchKeys.drawHistory(matchId),
        matchKeys.roster(matchId),
        matchKeys.waitlist(matchId),
        matchKeys.detail(matchId),
        matchKeys.list(),
        matchKeys.dashboard(),
        matchKeys.statistics(),
        matchKeys.auditLogs(),
      );

    return { presence, draws, all: () => { presence(); draws(); } };
  }, [matchId]);
}

/**
 * Reescreve a composição de um sorteio **direto no cache**, sem esperar a rede.
 *
 * É o que faz o arrastar-e-soltar parecer instantâneo: o campo em SVG, os
 * indicadores de equilíbrio e o texto do WhatsApp leem todos o mesmo dado em
 * cache, então mudar aqui atualiza tudo de uma vez — sem um segundo "estado dos
 * times" vivendo em paralelo dentro da tela (que inevitavelmente divergiria do
 * servidor).
 *
 * O sorteio vigente e a entrada correspondente no histórico são atualizados
 * juntos porque a tela lê de um ou de outro conforme o chip selecionado.
 *
 * Devolve a função de desfazer: se a chamada à API falhar, a tela volta
 * exatamente ao que estava antes.
 */
export function useDrawCachePatch(matchId: number) {
  return useMemo(
    () => ({
      applyTeams(drawId: number, teams: Team[]): () => void {
        const currentKey = matchKeys.currentDraw(matchId);
        const historyKey = matchKeys.drawHistory(matchId);

        const previousCurrent = queryStore.getSnapshot<Draw | null>(currentKey).data;
        const previousHistory = queryStore.getSnapshot<Draw[]>(historyKey).data;

        if (previousCurrent && previousCurrent.id === drawId) {
          queryStore.setData<Draw>(currentKey, { ...previousCurrent, teams });
        }
        if (previousHistory) {
          queryStore.setData<Draw[]>(
            historyKey,
            previousHistory.map((entry) => (entry.id === drawId ? { ...entry, teams } : entry)),
          );
        }

        return () => {
          if (previousCurrent !== undefined) queryStore.setData(currentKey, previousCurrent);
          if (previousHistory !== undefined) queryStore.setData(historyKey, previousHistory);
        };
      },
    }),
    [matchId],
  );
}
