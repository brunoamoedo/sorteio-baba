import { useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  GlobalStyles,
  Typography,
} from "@mui/material";

import { drawsApi } from "../../api/drawsApi";
import { matchesApi, waitlistApi } from "../../api/matchesApi";
import { positionsApi } from "../../api/playersApi";
import { getApiErrorMessage, useApiMutation, useApiQuery } from "../../core/data";
import type { Draw, Team, TeamPlayer } from "../../core/types/draw";
import type { Match, RosterEntry, WaitlistEntry } from "../../core/types/match";
import type { Position } from "../../core/types/player";
import { AppLayout } from "../../shared/layout/AppLayout";
import { AppActionBar } from "../../shared/components/AppActionBar";
import { BottomSheet } from "../../shared/components/BottomSheet";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { useToast } from "../../shared/components/ToastProvider";
import { DrawIcon, RedrawIcon } from "../../shared/icons";
import { useOrganization } from "../organization/OrganizationContext";
import { DrawResultSection } from "./DrawResultSection";
import { DrawSetupSheet } from "./DrawSetupSheet";
import { DrawShuffleOverlay } from "./DrawShuffleOverlay";
import { FormationPicker } from "./FormationPicker";
import { MatchHeaderCard } from "./MatchHeaderCard";
import { matchKeys, useDrawCachePatch, useMatchInvalidation } from "./matchQueries";
import { PlayerActionSheet } from "./PlayerActionSheet";
import { PresencePanel } from "./PresencePanel";
import { QuickConfirmDialog } from "./QuickConfirmDialog";
import { ResultsDialog } from "./ResultsDialog";
import { useDrawSelection } from "./useDrawSelection";
import { WaitlistPanel } from "./WaitlistPanel";
import {
  applyPlayerMove,
  applyPositionChange,
  applySwap,
  describeManualMove,

  teamSkillTotals,
  type ManualMove,
} from "./teamComposition";

/** Tempo mínimo da animação de embaralhamento. O sorteio no servidor costuma
 * responder em poucas centenas de milissegundos; sem esse piso a animação
 * apareceria como um flash e perderia a graça. */
const SHUFFLE_MIN_MS = 1400;

/** Distância (px) que o ponteiro precisa percorrer para o gesto virar arrasto.
 * Sem essa folga, no celular qualquer toque no jogador iniciaria um arrasto e a
 * rolagem da página ficaria presa no campo. */
const DRAG_ACTIVATION_DISTANCE = 8;

/** Texto gravado no `reason` da auditoria de cada alteração manual. Distingue,
 * na trilha, o ajuste do organizador de qualquer outra origem — e diz **qual**
 * ajuste foi. */
const REASON = {
  move: "Movimentação manual do jogador entre times",
  position: "Alteração manual da posição do jogador",
  swap: "Troca manual entre dois jogadores",
  formation: "Alteração manual da formação do time",
} as const;

type WaitlistAction =
  | { type: "promote"; playerId: number }
  | { type: "remove"; playerId: number }
  | { type: "move"; playerId: number; position: number };

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const matchId = Number(id);
  const { currentMembership } = useOrganization();
  const canManage = currentMembership?.role !== "visualizador";
  const { showToast } = useToast();
  const invalidate = useMatchInvalidation(matchId);
  const drawCache = useDrawCachePatch(matchId);

  /** Um arrasto só começa depois de andar alguns pixels — o mesmo sensor
   * atende mouse, toque e caneta, porque o dnd-kit usa Pointer Events.
   *
   * O `KeyboardSensor` faltava: sem ele, arrastar era impossível por teclado, e
   * arrastar era a **única** forma de ajustar os times. Hoje o caminho
   * principal para teclado e toque é o modo de seleção (`useDrawSelection`),
   * mas o arrasto por teclado também passou a funcionar. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor),
  );

  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [selectedDrawId, setSelectedDrawId] = useState<number | null>(null);
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [quickConfirmOpen, setQuickConfirmOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);
  /** Jogadores com uma mudança de presença em voo — o Switch fica travado e
   * mostra progresso em vez de "não responder" e voltar sozinho. */
  const [pendingPlayers, setPendingPlayers] = useState<ReadonlySet<number>>(new Set());
  /** Alterações manuais feitas neste sorteio, na ordem em que aconteceram —
   * a fonte das "Observações das alterações" abaixo do campo. */
  const [manualMoves, setManualMoves] = useState<ManualMove[]>([]);
  /** Estrelas por time como o **algoritmo** entregou, congeladas na primeira
   * alteração manual. Sem essa referência não dá para afirmar que uma alteração
   * piorou o equilíbrio — e era esse o buraco: a tela avisava "houve alteração
   * manual" sem dizer que ela tinha aberto 7 estrelas entre os times. */
  const [manualBaseline, setManualBaseline] = useState<number[] | null>(null);
  /** Jogador em movimento, para desenhar a prévia que acompanha o ponteiro. */
  const [draggedPlayer, setDraggedPlayer] = useState<TeamPlayer | null>(null);
  /** Painel de configuração do sorteio (formação, resumo, regras). */
  const [setupOpen, setSetupOpen] = useState(false);
  /** Time cuja formação está sendo trocada depois do sorteio. */
  const [formationTeam, setFormationTeam] = useState<Team | null>(null);

  /** Seleção por toque — a alternativa ao arrastar. */
  const drawSelection = useDrawSelection();

  const failed = (fallback: string) => (error: unknown) =>
    showToast(getApiErrorMessage(error, fallback), "error");

  const matchQuery = useApiQuery<Match>(matchKeys.detail(matchId), () => matchesApi.retrieve(matchId));
  const rosterQuery = useApiQuery<RosterEntry[]>(matchKeys.roster(matchId), () =>
    matchesApi.roster(matchId),
  );
  const waitlistQuery = useApiQuery<WaitlistEntry[]>(matchKeys.waitlist(matchId), () =>
    waitlistApi.list(matchId),
  );
  const currentDrawQuery = useApiQuery<Draw | null>(matchKeys.currentDraw(matchId), () =>
    drawsApi.currentForMatch(matchId),
  );
  /** O histórico continua sendo carregado junto com a tela **de propósito**:
   * é ele que decide se os chips de versões aparecem. Adiá-lo economizaria uma
   * requisição e, em troca, esconderia do organizador a existência de sorteios
   * anteriores — exatamente o tipo de "otimização" que vira funcionalidade
   * perdida. */
  const drawHistoryQuery = useApiQuery<Draw[]>(matchKeys.drawHistory(matchId), () =>
    drawsApi.listForMatch(matchId),
  );

  const markPending = (playerId: number, pending: boolean) =>
    setPendingPlayers((current) => {
      const next = new Set(current);
      if (pending) next.add(playerId);
      else next.delete(playerId);
      return next;
    });

  const confirmMutation = useApiMutation(
    ({ playerId, status }: { playerId: number; status: "confirmed" | "declined" }) =>
      matchesApi.setConfirmation(matchId, playerId, status),
    {
      onSuccess: (result) => {
        invalidate.presence();
        if (result.waitlisted) {
          showToast(`⏳ Partida cheia — entrou na lista de espera (${result.waitlist_position}º).`, "info");
        } else if (result.promoted.length > 0) {
          showToast(`⬆️ ${result.promoted.map((p) => p.name).join(", ")} saiu da espera e entrou no jogo!`);
        }
      },
      onError: failed("Não foi possível alterar a presença."),
      onSettled: (_data, _error, variables) => markPending(variables.playerId, false),
    },
  );

  const setAllMutation = useApiMutation(
    (status: "confirmed" | "declined") => matchesApi.setAllConfirmations(matchId, status),
    {
      onSuccess: (data, status) => {
        invalidate.presence();
        setClearAllOpen(false);
        if (status === "confirmed") {
          showToast(
            data.waitlisted > 0
              ? `✅ ${data.confirmed} confirmados — ${data.waitlisted} foram para a lista de espera.`
              : `✅ Presença confirmada para ${data.confirmed} jogador(es)!`,
          );
        } else {
          showToast("Presenças desmarcadas.");
        }
      },
      onError: failed("Não foi possível atualizar as presenças."),
    },
  );

  /** Adicionar um convidado pelo nome usa o mesmo reconhecimento do "Sortear
   * com lista de nomes": se o nome bater com um mensalista, confirma o
   * mensalista em vez de criar um convidado duplicado. */
  const addGuestMutation = useApiMutation(
    (name: string) => matchesApi.quickConfirm(matchId, [name], { pastedList: false }),
    {
      onSuccess: (results) => {
        invalidate.presence();
        setGuestName("");
        const resolution = results[0];
        if (!resolution) return;
        if (resolution.resolution === "fora_da_lista") {
          showToast(
            `“${resolution.input_name}” está marcado como fora da lista (👋/❌) — ninguém foi confirmado.`,
            "info",
          );
          return;
        }
        if (resolution.resolution === "linha_invalida") {
          showToast(
            `Não consegui ler um nome em “${resolution.input_name}” — ninguém foi adicionado. ` +
              "Digite só o nome, sem numeração nem emoji.",
            "info",
          );
          return;
        }
        if (resolution.resolution === "ja_confirmado") {
          showToast(
            `${resolution.player_name} já está confirmado nesta partida — nada foi alterado. ` +
              "Se for outra pessoa de nome parecido, confirme por ela na lista abaixo.",
            "info",
          );
          return;
        }
        if (resolution.waitlisted) {
          showToast(
            `⏳ ${resolution.player_name} entrou na lista de espera (${resolution.waitlist_position}º) — partida cheia.`,
            "info",
          );
          return;
        }
        showToast(
          resolution.resolution === "mensalista"
            ? `✅ Reconhecido como ${resolution.player_name} (mensalista) e confirmado!`
            : `✅ ${resolution.player_name} adicionado como convidado e confirmado!`,
        );
      },
      onError: failed("Não foi possível adicionar o jogador."),
    },
  );

  const waitlistMutation = useApiMutation(
    (action: WaitlistAction) => {
      if (action.type === "promote") return waitlistApi.promote(matchId, action.playerId);
      if (action.type === "remove") return waitlistApi.remove(matchId, action.playerId);
      return waitlistApi.move(matchId, action.playerId, action.position);
    },
    {
      onSuccess: (_data, action) => {
        invalidate.presence();
        if (action.type === "promote") showToast("⬆️ Jogador colocado na partida!");
        if (action.type === "remove") showToast("Jogador retirado da lista de espera.");
      },
      onError: failed("Não foi possível atualizar a lista de espera."),
    },
  );

  const drawMutation = useApiMutation(
    (formation: string) => drawsApi.trigger(matchId, formation ? { formation } : {}),
    {
      onSuccess: () => {
        setSelectedDrawId(null);
        invalidate.draws();
      },
    },
  );

  /** Posições da organização — alimentam a troca de posição de um jogador. */
  const positionsQuery = useApiQuery<Position[]>(matchKeys.positions(), positionsApi.list, {
    enabled: canManage,
  });

  const resultsMutation = useApiMutation(
    (results: { team_id: number; goals_scored: number }[]) => matchesApi.setResults(matchId, results),
    {
      onSuccess: () => {
        invalidate.draws();
        showToast("⚽ Placar atualizado!");
      },
      onError: failed("Não foi possível salvar o placar."),
    },
  );

  /**
   * Movimentação manual de um jogador entre times.
   *
   * A composição na tela já foi trocada **antes** da chamada (ver
   * `handleDragEnd`): o jogador precisa aterrissar no time de destino no mesmo
   * gesto, não meio segundo depois. Se a API recusar, `rollback` devolve os
   * times ao que eram e a observação correspondente é retirada da lista.
   *
   * Sucesso não refaz o sorteio — só revalida os dados do servidor, que já
   * refletem a troca (e trazem junto a auditoria atualizada).
   */
  const moveMutation = useApiMutation(
    ({
      drawId,
      teamPlayerId,
      targetTeamId,
    }: {
      drawId: number;
      teamPlayerId: number;
      targetTeamId: number;
      move: ManualMove;
      rollback: () => void;
    }) => drawsApi.movePlayer(drawId, teamPlayerId, targetTeamId, REASON.move),
    {
      onSuccess: (_data, variables) => {
        invalidate.draws();
        showToast(describeManualMove(variables.move));
      },
      onError: (error, variables) => {
        variables.rollback();
        setManualMoves((moves) => moves.filter((move) => move.id !== variables.move.id));
        showToast(getApiErrorMessage(error, "Não foi possível mover o jogador."), "error");
      },
    },
  );

  /** Alterar a posição de um jogador dentro do time — operação que não
   * existia. Mesmo padrão do movimento: pinta a tela na hora e desfaz se o
   * servidor recusar. */
  const positionMutation = useApiMutation(
    ({
      drawId,
      teamPlayerId,
      positionId,
    }: {
      drawId: number;
      teamPlayerId: number;
      positionId: number;
      move: ManualMove;
      rollback: () => void;
    }) => drawsApi.setPlayerPosition(drawId, { teamPlayerId, positionId, reason: REASON.position }),
    {
      onSuccess: (_data, variables) => {
        invalidate.draws();
        showToast(describeManualMove(variables.move));
      },
      onError: (error, variables) => {
        variables.rollback();
        setManualMoves((moves) => moves.filter((move) => move.id !== variables.move.id));
        showToast(getApiErrorMessage(error, "Não foi possível alterar a posição."), "error");
      },
    },
  );

  /** Trocar dois jogadores. **Uma** chamada: como duas movimentações, uma
   * falha no meio deixaria os times inconsistentes. */
  const swapMutation = useApiMutation(
    ({
      drawId,
      a,
      b,
    }: {
      drawId: number;
      a: number;
      b: number;
      move: ManualMove;
      rollback: () => void;
    }) => drawsApi.swapPlayers(drawId, a, b, REASON.swap),
    {
      onSuccess: (_data, variables) => {
        invalidate.draws();
        showToast(describeManualMove(variables.move));
      },
      onError: (error, variables) => {
        variables.rollback();
        setManualMoves((moves) => moves.filter((move) => move.id !== variables.move.id));
        showToast(getApiErrorMessage(error, "Não foi possível trocar os jogadores."), "error");
      },
    },
  );

  /** Trocar a formação de um time depois do sorteio. Não recalcula nada: os
   * mesmos jogadores, outro desenho. */
  const formationMutation = useApiMutation(
    ({ drawId, teamId, formation }: { drawId: number; teamId: number; formation: string }) =>
      drawsApi.setTeamFormation(drawId, teamId, formation, REASON.formation),
    {
      onSuccess: () => {
        invalidate.draws();
        setFormationTeam(null);
        showToast("Formação do time atualizada.");
      },
      onError: failed("Não foi possível alterar a formação."),
    },
  );

  const match = matchQuery.data;
  /** Confirmados no topo, depois quem está na espera, depois o resto — e em
   * ordem alfabética dentro de cada grupo. Com 25 jogadores cadastrados e 18
   * confirmados, o que interessa conferir (quem já está dentro) ficava
   * espalhado no meio da lista alfabética.
   *
   * A ordem é recalculada a cada mudança de presença, então quem você acabou
   * de confirmar sobe na hora — o que é o comportamento certo para conferir,
   * mas move a linha logo depois do toque. */
  const roster = useMemo(() => {
    const rank = (entry: RosterEntry) =>
      entry.confirmation_status === "confirmed" ? 0 : entry.waitlist_position !== null ? 1 : 2;
    return [...(rosterQuery.data ?? [])].sort(
      (a, b) => rank(a) - rank(b) || a.player.name.localeCompare(b.player.name, "pt-BR"),
    );
  }, [rosterQuery.data]);
  const waitlist = useMemo(() => waitlistQuery.data ?? [], [waitlistQuery.data]);
  const confirmedCount = match?.confirmed_count ?? 0;
  const capacity = match?.capacity;

  const currentDraw = currentDrawQuery.data ?? null;
  const drawHistory = useMemo(() => drawHistoryQuery.data ?? [], [drawHistoryQuery.data]);
  const draw = selectedDrawId ? (drawHistory.find((d) => d.id === selectedDrawId) ?? currentDraw) : currentDraw;
  const isViewingCurrent = !draw || draw.is_current;
  const canEditTeams = canManage && isViewingCurrent;

  /** As observações pertencem a **um** sorteio: sortear de novo (ou abrir uma
   * versão do histórico) começa uma folha em branco, porque as alterações
   * anteriores não descrevem mais o que está na tela. */
  const manualMoveSeq = useRef(0);
  const notedDrawId = useRef<number | null>(null);
  useEffect(() => {
    const drawId = draw?.id ?? null;
    if (notedDrawId.current === drawId) return;
    notedDrawId.current = drawId;
    setManualMoves([]);
    setManualBaseline(null);
  }, [draw?.id]);

  /** Ficou sem nenhuma alteração manual (a última falhou e foi desfeita): a
   * referência de equilíbrio deixa de fazer sentido e volta a ser a do sorteio. */
  useEffect(() => {
    if (manualMoves.length === 0) setManualBaseline(null);
  }, [manualMoves.length]);

  /** O sorteio vigente veio do agendamento automático (e não do botão). */
  const automaticDrawDone = currentDraw?.trigger === "automatic";

  /** Abrir a tela pode **criar** o sorteio: o backend executa na hora um
   * sorteio automático vencido, durante o GET da partida. As consultas do
   * sorteio saem em paralelo com a da partida, então elas podem ter voltado
   * vazias um instante antes de o sorteio existir — e a tela mostrava "Sortear
   * Times" numa partida recém-sorteada, até alguém recarregar. Quando a
   * partida diz `drawn` mas nenhum sorteio veio, busca de novo (uma vez). */
  const drawsSettled = !currentDrawQuery.isLoading && !drawHistoryQuery.isLoading;
  const missingDraw = match?.status === "drawn" && !currentDraw && drawsSettled;
  const refetchedForDraw = useRef(false);
  useEffect(() => {
    if (!missingDraw || refetchedForDraw.current) return;
    refetchedForDraw.current = true;
    invalidate.draws();
  }, [missingDraw, invalidate]);

  const canDraw =
    !!capacity && confirmedCount >= capacity.min_players && canManage && !drawMutation.isPending;

  const confirmedNames = useMemo(
    () =>
      roster
        .filter((entry) => entry.confirmation_status === "confirmed")
        .map((entry) => entry.player.nickname || entry.player.name),
    [roster],
  );

  /**
   * Registra uma alteração manual na tela: pinta a composição nova na hora,
   * guarda a observação e devolve o `rollback` para quem chama usar se o
   * servidor recusar.
   *
   * Centralizado porque as três operações (mover, trocar posição, trocar dois)
   * seguem exatamente o mesmo protocolo — e a primeira delas precisa congelar
   * a referência de equilíbrio.
   */
  const registerManualChange = (result: { teams: typeof draw extends null ? never : Team[]; move: ManualMove }) => {
    if (!draw) return () => {};
    const baseline = teamSkillTotals(draw.teams);
    const rollback = drawCache.applyTeams(draw.id, result.teams);
    setManualBaseline((current) => current ?? baseline);
    setManualMoves((moves) => [...moves, result.move]);
    return rollback;
  };

  const nextMoveId = (prefix: string) => `${draw?.id}-${prefix}-${manualMoveSeq.current++}`;

  /** Toque num jogador: abre o menu de ações, ou conclui a troca pendente. */
  const handleSelectPlayer = (teamPlayer: TeamPlayer, teamId: number) => {
    if (!canEditTeams || !draw) return;

    const { selection } = drawSelection;
    if (selection.intent === "swap" && selection.player && selection.player.id !== teamPlayer.id) {
      const result = applySwap(draw.teams, selection.player.id, teamPlayer.id, nextMoveId("swap"));
      drawSelection.clear();
      if (!result) return;

      const rollback = registerManualChange(result);
      swapMutation.mutate({
        drawId: draw.id,
        a: selection.player.id,
        b: teamPlayer.id,
        move: result.move,
        rollback,
      });
      return;
    }

    drawSelection.select(teamPlayer, teamId);
  };

  const handleChangePosition = (positionId: number) => {
    const { selection } = drawSelection;
    if (!draw || !selection.player) return;

    const position = positionsQuery.data?.find((item) => item.id === positionId);
    if (!position) return;

    const result = applyPositionChange(
      draw.teams,
      selection.player.id,
      position,
      nextMoveId("pos"),
    );
    drawSelection.clear();
    if (!result) return;

    const rollback = registerManualChange(result);
    positionMutation.mutate({
      drawId: draw.id,
      teamPlayerId: result.move.teamPlayerId,
      positionId,
      move: result.move,
      rollback,
    });
  };

  const handleMoveToTeam = (targetTeamId: number) => {
    const { selection } = drawSelection;
    if (!draw || !selection.player) return;

    const result = applyPlayerMove(
      draw.teams,
      selection.player.id,
      targetTeamId,
      nextMoveId("move"),
    );
    drawSelection.clear();
    if (!result) return;

    const rollback = registerManualChange(result);
    moveMutation.mutate({
      drawId: draw.id,
      teamPlayerId: result.move.teamPlayerId,
      targetTeamId,
      move: result.move,
      rollback,
    });
  };

  /** Sortear: embaralha na tela enquanto o servidor calcula, e ao terminar
   * leva o usuário direto para o resultado. */
  const handleDraw = (formation: string) => {
    const isRedraw = !!currentDraw;
    const startedAt = Date.now();
    setSetupOpen(false);
    setIsShuffling(true);

    drawMutation.mutate(formation, {
      onSettled: (_data, error) => {
        const remaining = Math.max(0, SHUFFLE_MIN_MS - (Date.now() - startedAt));
        window.setTimeout(() => {
          setIsShuffling(false);
          if (error) {
            showToast(getApiErrorMessage(error, "Não foi possível realizar o sorteio."), "error");
            return;
          }
          showToast(isRedraw ? "🔄 Novo sorteio realizado!" : "✅ Times sorteados com sucesso!");
          window.requestAnimationFrame(() => {
            resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }, remaining);
      },
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const teamPlayerId = event.active.data.current?.teamPlayerId as number | undefined;
    const player = draw?.teams
      .flatMap((team) => team.team_players)
      .find((teamPlayer) => teamPlayer.id === teamPlayerId);
    setDraggedPlayer(player ?? null);
  };

  /**
   * Soltou o jogador. Isto **não dispara um novo sorteio**: é uma correção
   * manual do organizador sobre o resultado que já existe.
   *
   * A ordem é: recalcular a composição (puro), pintar a tela na hora (cache),
   * registrar a observação e só então avisar o servidor — que grava a mudança
   * e a auditoria.
   */
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggedPlayer(null);
    if (!canEditTeams || !draw) return;

    const { active, over } = event;
    if (!over) return;

    const teamPlayerId = active.data.current?.teamPlayerId as number | undefined;
    const targetTeamId = over.data.current?.teamId as number | undefined;
    if (teamPlayerId === undefined || targetTeamId === undefined) return;

    const moveId = `${draw.id}-${teamPlayerId}-${manualMoveSeq.current++}`;
    const result = applyPlayerMove(draw.teams, teamPlayerId, targetTeamId, moveId);
    // Soltar no próprio time (ou em cima de um jogador do mesmo time) não é
    // alteração nenhuma — nada de chamada à API nem de observação.
    if (!result) return;

    // A referência é a composição de **antes** desta alteração, e só na
    // primeira: nas seguintes ela já está congelada.
    const rollback = registerManualChange(result);

    moveMutation.mutate({
      drawId: draw.id,
      teamPlayerId,
      targetTeamId,
      move: result.move,
      rollback,
    });
  };

  if (matchQuery.isLoading) {
    return (
      <AppLayout>
        <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
          <CircularProgress aria-label="Carregando partida" />
        </Box>
      </AppLayout>
    );
  }

  if (matchQuery.isError || !match || !capacity) {
    return (
      <AppLayout>
        <Alert severity="error" sx={{ mt: 2 }} action={<Button onClick={() => matchQuery.refetch()}>Tentar novamente</Button>}>
          {getApiErrorMessage(matchQuery.error, "Não foi possível carregar esta partida.")}
        </Alert>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <GlobalStyles styles={{ "@media print": { ".no-print": { display: "none !important" } } }} />
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }} className="no-print">
        {match.name || match.recurring_game_name || "Partida"}
      </Typography>

      <MatchHeaderCard
        match={match}
        capacity={capacity}
        confirmedCount={confirmedCount}
        waitlistCount={waitlist.length}
        canManage={canManage}
        automaticDrawDone={automaticDrawDone}
        hasDraw={!!currentDraw}
        onOpenNamesList={() => setQuickConfirmOpen(true)}
        onOpenResults={() => setResultsDialogOpen(true)}
      />

      <WaitlistPanel
        entries={waitlist}
        capacity={capacity}
        confirmedCount={confirmedCount}
        canManage={canManage}
        isBusy={waitlistMutation.isPending}
        onPromote={(playerId) => waitlistMutation.mutate({ type: "promote", playerId })}
        onMove={(playerId, position) => waitlistMutation.mutate({ type: "move", playerId, position })}
        onRemove={(playerId) => waitlistMutation.mutate({ type: "remove", playerId })}
      />

      <PresencePanel
        roster={roster}
        isLoading={rosterQuery.isLoading}
        confirmedCount={confirmedCount}
        canManage={canManage}
        pendingPlayers={pendingPlayers}
        onToggle={(playerId, confirmed) => {
          markPending(playerId, true);
          confirmMutation.mutate({ playerId, status: confirmed ? "confirmed" : "declined" });
        }}
        onConfirmAll={() => setAllMutation.mutate("confirmed")}
        onClearAll={() => setClearAllOpen(true)}
        isBulkPending={setAllMutation.isPending}
        guestName={guestName}
        onGuestNameChange={setGuestName}
        onAddGuest={() => {
          const name = guestName.trim();
          if (name) addGuestMutation.mutate(name);
        }}
        isAddingGuest={addGuestMutation.isPending}
      />

      <div ref={resultsRef} />

      {isShuffling && <DrawShuffleOverlay names={confirmedNames} />}

      {draw && !isShuffling && (
        <DrawResultSection
          draw={draw}
          history={drawHistory}
          currentDrawId={currentDraw?.id}
          selectedDrawId={selectedDrawId}
          onSelectDraw={setSelectedDrawId}
          canEditTeams={canEditTeams}
          isViewingCurrent={isViewingCurrent}
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggedPlayer(null)}
          draggedPlayer={draggedPlayer}
          selectedTeamPlayerId={drawSelection.selection.player?.id ?? null}
          isAwaitingTarget={drawSelection.isAwaitingTarget}
          onSelectPlayer={canEditTeams ? handleSelectPlayer : undefined}
          onChangeFormation={canEditTeams ? setFormationTeam : undefined}
          manualMoves={manualMoves}
          manualBaseline={manualBaseline}
        />
      )}

      {currentDraw && (
        <ResultsDialog
          open={resultsDialogOpen}
          onClose={() => setResultsDialogOpen(false)}
          teams={currentDraw.teams}
          onSubmit={(results) => resultsMutation.mutateAsync(results)}
          isSubmitting={resultsMutation.isPending}
        />
      )}

      {/* Barra de ação primária fixa no rodapé do celular. O botão de sortear
          ficava depois de cinco linhas de configuração e de dois outros
          botões — no celular era preciso rolar para achar a ação central do
          produto. */}
      {canManage && (
        <AppActionBar
          hint={
            !canDraw ? (
              // O motivo do bloqueio **na tela**, não num tooltip: não existe
              // hover em toque, e sem isto o botão desabilitado não explicava
              // nada.
              <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>
                Faltam {capacity.min_players - confirmedCount} confirmado(s) para o mínimo de{" "}
                {capacity.min_players}
              </Typography>
            ) : undefined
          }
        >
          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={currentDraw ? <RedrawIcon /> : <DrawIcon />}
            disabled={!canDraw || isShuffling}
            onClick={() => setSetupOpen(true)}
            sx={{ fontWeight: 800, fontSize: 16 }}
          >
            {currentDraw ? "Sortear novamente" : "Sortear times"}
          </Button>
        </AppActionBar>
      )}

      <DrawSetupSheet
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        capacity={capacity}
        confirmedCount={confirmedCount}
        // "Sortear novamente" respeita a formação escolhida antes (requisito
        // 20): a pessoa não precisa reescolher tudo a cada tentativa.
        initialFormation={currentDraw?.formation}
        isDrawing={isShuffling || drawMutation.isPending}
        isRedraw={!!currentDraw}
        onDraw={handleDraw}
      />

      <PlayerActionSheet
        open={!!drawSelection.selection.player && drawSelection.selection.intent === "menu"}
        onClose={drawSelection.clear}
        player={drawSelection.selection.player}
        teams={draw?.teams ?? []}
        currentTeamId={drawSelection.selection.teamId}
        positions={positionsQuery.data ?? []}
        onChangePosition={handleChangePosition}
        onStartSwap={() => drawSelection.setIntent("swap")}
        onMoveToTeam={handleMoveToTeam}
      />

      <BottomSheet
        open={!!formationTeam}
        onClose={() => setFormationTeam(null)}
        title="Formação do time"
        subtitle="Reencaixa os mesmos jogadores em outro desenho — não sorteia de novo."
      >
        {formationTeam && draw && (
          <FormationPicker
            linePlayers={
              formationTeam.team_players.filter(
                (player) => player.position_snapshot?.code?.toUpperCase() !== "GOL",
              ).length
            }
            value={formationTeam.formation}
            onChange={(value) =>
              formationMutation.mutate({
                drawId: draw.id,
                teamId: formationTeam.id,
                formation: value,
              })
            }
          />
        )}
      </BottomSheet>

      <QuickConfirmDialog open={quickConfirmOpen} matchId={matchId} onClose={() => setQuickConfirmOpen(false)} />

      <ConfirmDialog
        open={clearAllOpen}
        title="Desmarcar todas as presenças"
        description={`Isso marca os ${confirmedCount} confirmados como ausentes e esvazia a lista de espera. O sorteio já realizado não é afetado.`}
        confirmLabel="Desmarcar todos"
        isConfirming={setAllMutation.isPending}
        onConfirm={() => setAllMutation.mutate("declined")}
        onClose={() => setClearAllOpen(false)}
      />
    </AppLayout>
  );
}
