import { useCallback, useMemo, useState } from "react";

import type { Team, TeamPlayer } from "../../core/types/draw";

/** O que o organizador pretende fazer com o jogador selecionado. */
export type SelectionIntent = "menu" | "swap" | "move";

export interface DrawSelection {
  /** Jogador selecionado, ou `null` quando não há seleção ativa. */
  player: TeamPlayer | null;
  /** Time do jogador selecionado. */
  teamId: number | null;
  intent: SelectionIntent;
}

const EMPTY: DrawSelection = { player: null, teamId: null, intent: "menu" };

/**
 * Estado do "modo de seleção" — a alternativa ao arrastar.
 *
 * ## Por que existe
 *
 * A única forma de ajustar os times depois do sorteio era **arrastar e
 * soltar**. No celular isso é um gesto impreciso sobre alvos de poucos pixels,
 * e por teclado é simplesmente impossível. O modo de seleção transforma a
 * mesma operação em dois toques: escolher o jogador, escolher o destino.
 *
 * O arrasto continua existindo e não muda — no desktop com mouse ele é o gesto
 * natural. O que muda é ele deixar de ser o **único** caminho.
 *
 * ## O fluxo
 *
 * ```
 * toque no jogador  →  intent "menu"   (abre as ações)
 *   "Trocar com outro jogador"  →  intent "swap"  (o próximo toque escolhe o alvo)
 *   "Mover para outro time"     →  intent "move"  (o próximo toque escolhe o time)
 * ```
 */
export function useDrawSelection() {
  const [selection, setSelection] = useState<DrawSelection>(EMPTY);

  const select = useCallback((player: TeamPlayer, teamId: number) => {
    setSelection((current) => {
      // Tocar de novo no mesmo jogador cancela — é o gesto que a pessoa tenta
      // naturalmente quando se arrepende.
      if (current.player?.id === player.id && current.intent === "menu") return EMPTY;
      return { player, teamId, intent: "menu" };
    });
  }, []);

  const setIntent = useCallback((intent: SelectionIntent) => {
    setSelection((current) => (current.player ? { ...current, intent } : current));
  }, []);

  const clear = useCallback(() => setSelection(EMPTY), []);

  /** Alvos válidos para o intent atual — o que a tela realça. */
  const isValidTarget = useCallback(
    (candidate: TeamPlayer) => {
      if (!selection.player) return false;
      if (selection.intent !== "swap") return false;
      return candidate.id !== selection.player.id;
    },
    [selection],
  );

  const isValidTeamTarget = useCallback(
    (team: Team) => {
      if (!selection.player) return false;
      if (selection.intent !== "move") return false;
      return team.id !== selection.teamId;
    },
    [selection],
  );

  return useMemo(
    () => ({
      selection,
      /** Há uma seleção esperando um alvo (troca ou movimento). */
      isAwaitingTarget: !!selection.player && selection.intent !== "menu",
      select,
      setIntent,
      clear,
      isValidTarget,
      isValidTeamTarget,
    }),
    [selection, select, setIntent, clear, isValidTarget, isValidTeamTarget],
  );
}
