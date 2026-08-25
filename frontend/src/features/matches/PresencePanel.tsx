import { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import { AddIcon, ConfirmIcon, DeclineIcon, SearchIcon } from "../../shared/icons";
import { EmptyState } from "../../shared/components/EmptyState";
import { PlayerAvatar } from "../../shared/components/PlayerAvatar";
import { SegmentedControl } from "../../shared/components/SegmentedControl";
import { StatusChip, playerTypeLabel, playerTypeTone } from "../../shared/components/StatusChip";

import type { RosterEntry } from "../../core/types/match";

type PresenceFilter = "todos" | "confirmados" | "pendentes" | "espera";

interface PresencePanelProps {
  roster: RosterEntry[];
  isLoading: boolean;
  confirmedCount: number;
  canManage: boolean;
  /** Jogadores com uma mudança de presença em voo. */
  pendingPlayers: ReadonlySet<number>;
  onToggle: (playerId: number, confirmed: boolean) => void;
  onConfirmAll: () => void;
  onClearAll: () => void;
  isBulkPending: boolean;
  guestName: string;
  onGuestNameChange: (value: string) => void;
  onAddGuest: () => void;
  isAddingGuest: boolean;
}

/** Remove acentos e caixa para a busca casar "Joao" com "João" — é o que a
 * pessoa digita com pressa à beira do campo. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Lista de confirmação de presença.
 *
 * Extraída de `MatchDetailPage` e resolvendo três problemas de uma vez:
 *
 * - **Busca e filtro** (P-21): com 25–30 jogadores cadastrados, achar uma
 *   pessoa era rolagem longa. Agora há um campo de busca e um filtro por
 *   situação, com os contadores visíveis.
 * - **Ordem estável** (P-22): a lista se reordenava a cada toque (confirmados
 *   sobem), então a linha recém-tocada **saltava para longe do dedo** — e o
 *   toque seguinte caía em outra pessoa. A ordem agora é congelada enquanto a
 *   tela está aberta; um botão explícito reordena quando o organizador quiser.
 * - **Campo "adicionar pelo nome"** (P-23): empilha no celular em vez de
 *   espremer o botão ao lado de um campo com duas linhas de ajuda.
 */
export function PresencePanel({
  roster,
  isLoading,
  confirmedCount,
  canManage,
  pendingPlayers,
  onToggle,
  onConfirmAll,
  onClearAll,
  isBulkPending,
  guestName,
  onGuestNameChange,
  onAddGuest,
  isAddingGuest,
}: PresencePanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PresenceFilter>("todos");

  /**
   * Ordem congelada.
   *
   * `roster` chega do servidor já ordenado (confirmados no topo). Guardamos a
   * **posição** de cada jogador na primeira vez que a lista chega e passamos a
   * ordenar por ela — assim confirmar alguém não move a linha embaixo do dedo.
   * Jogadores que aparecem depois (um convidado recém-criado) entram no fim.
   *
   * Em `ref`, não em estado: congelar a ordem não deve disparar render, e
   * gravar estado durante o render é justamente o que o React desaconselha.
   * `resequence` existe só para forçar a releitura quando o organizador pede
   * a reordenação explicitamente.
   */
  const frozenOrder = useRef<Map<number, number> | null>(null);
  const [resequence, setResequence] = useState(0);

  const reorder = () => {
    frozenOrder.current = new Map(roster.map((entry, index) => [entry.player.id, index]));
    setResequence((n) => n + 1);
  };

  const orderedRoster = useMemo(() => {
    if (roster.length === 0) return roster;

    if (frozenOrder.current === null) {
      frozenOrder.current = new Map(roster.map((entry, index) => [entry.player.id, index]));
      return roster;
    }

    const known = frozenOrder.current;
    const position = (entry: RosterEntry) =>
      known.get(entry.player.id) ?? Number.MAX_SAFE_INTEGER;
    return [...roster].sort((a, b) => position(a) - position(b));
    // `resequence` entra nas dependências de propósito: é o gatilho de
    // recalcular quando a ordem é refeita a pedido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, resequence]);

  const counts = useMemo(
    () => ({
      todos: roster.length,
      confirmados: roster.filter((entry) => entry.confirmation_status === "confirmed").length,
      pendentes: roster.filter(
        (entry) => entry.confirmation_status !== "confirmed" && entry.waitlist_position === null,
      ).length,
      espera: roster.filter((entry) => entry.waitlist_position !== null).length,
    }),
    [roster],
  );

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return orderedRoster.filter((entry) => {
      const matchesFilter =
        filter === "todos" ||
        (filter === "confirmados" && entry.confirmation_status === "confirmed") ||
        (filter === "pendentes" &&
          entry.confirmation_status !== "confirmed" &&
          entry.waitlist_position === null) ||
        (filter === "espera" && entry.waitlist_position !== null);
      if (!matchesFilter) return false;
      if (!term) return true;
      return (
        normalize(entry.player.name).includes(term) ||
        normalize(entry.player.nickname ?? "").includes(term)
      );
    });
  }, [orderedRoster, filter, search]);

  /** A ordem foi congelada e já não reflete quem está confirmado. */
  const orderIsStale = useMemo(() => {
    if (!frozenOrder.current) return false;
    const atual = orderedRoster.map((entry) => entry.confirmation_status === "confirmed");
    // Fica "velha" quando existe um confirmado depois de um não-confirmado.
    return atual.some((confirmado, index) => confirmado && atual.slice(0, index).includes(false));
  }, [orderedRoster, frozenOrder]);

  return (
    <Box className="no-print" sx={{ mb: 3 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, gap: 1, mb: 1.5 }}
      >
        <Typography variant="h2" component="h2">
          Confirmação de presença{" "}
          <Typography component="span" variant="body2" color="text.secondary">
            ({confirmedCount} de {roster.length})
          </Typography>
        </Typography>
        {canManage && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ConfirmIcon />}
              disabled={isBulkPending}
              onClick={onConfirmAll}
            >
              Confirmar todos
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<DeclineIcon />}
              disabled={isBulkPending || confirmedCount === 0}
              onClick={onClearAll}
            >
              Desmarcar
            </Button>
          </Stack>
        )}
      </Stack>

      {canManage && (
        <Box
          component="form"
          sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1, mb: 1.5 }}
          onSubmit={(event) => {
            event.preventDefault();
            onAddGuest();
          }}
        >
          <TextField
            fullWidth
            label="Adicionar jogador pelo nome"
            placeholder="Ex.: Zé da Padaria"
            helperText="Se o nome for de um mensalista, ele é reconhecido e confirmado; senão entra como convidado."
            value={guestName}
            onChange={(event) => onGuestNameChange(event.target.value)}
          />
          <Button
            type="submit"
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={!guestName.trim() || isAddingGuest}
            sx={{ whiteSpace: "nowrap", flexShrink: 0, alignSelf: { sm: "flex-start" }, height: { sm: 56 } }}
          >
            Adicionar
          </Button>
        </Box>
      )}

      {/* Busca e filtro só aparecem quando há gente suficiente para justificar
          — numa pelada de 10 pessoas eles seriam só ruído. */}
      {roster.length > 8 && (
        <Stack spacing={1} sx={{ mb: 1.5 }}>
          <TextField
            fullWidth
            placeholder="Buscar jogador"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{
              input: { startAdornment: <SearchIcon sx={{ mr: 1, color: "text.secondary" }} /> },
              htmlInput: { "aria-label": "Buscar jogador na lista de presença" },
            }}
          />
          <SegmentedControl
            label="Filtrar por situação"
            value={filter}
            onChange={setFilter}
            segments={[
              { value: "todos", label: "Todos", count: counts.todos },
              { value: "confirmados", label: "Confirmados", count: counts.confirmados },
              { value: "pendentes", label: "Pendentes", count: counts.pendentes },
              ...(counts.espera > 0
                ? [{ value: "espera" as const, label: "Espera", count: counts.espera }]
                : []),
            ]}
          />
        </Stack>
      )}

      {orderIsStale && (
        <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 0.5 }}>
          {/* Reordenar é **explícito**: a lista não se reorganiza sozinha
              embaixo do dedo de quem está confirmando presença. */}
          <Button
            size="small"
            onClick={reorder}
          >
            Reordenar (confirmados no topo)
          </Button>
        </Stack>
      )}

      {/* A contagem de resultados anunciada para leitor de tela — filtrar sem
          retorno audível é uma ação no escuro. */}
      <output aria-live="polite" style={{ position: "absolute", left: -9999 }}>
        {visible.length} jogador(es) na lista
      </output>

      {/* O `Card` envolve a lista em vez de **ser** a lista: com
          `List component={Card}` o `<ul>` vira `<div>`, os `<li>` ficam órfãos
          e o leitor de tela deixa de anunciar "lista de N itens". */}
      <Card>
        <List disablePadding>
            {isLoading && (
            <ListItem>
              <ListItemText primary="Carregando jogadores..." />
            </ListItem>
          )}

          {!isLoading &&
            visible.map((entry) => {
              const isPending = pendingPlayers.has(entry.player.id);
              const isConfirmed = entry.confirmation_status === "confirmed";
              return (
                <ListItem
                  key={entry.player.id}
                  divider
                  secondaryAction={
                    canManage ? (
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        {isPending && <CircularProgress size={16} />}
                        <Switch
                          checked={isConfirmed}
                          disabled={isPending}
                          slotProps={{
                            input: { "aria-label": `Confirmar presença de ${entry.player.name}` },
                          }}
                          onChange={(event) => onToggle(entry.player.id, event.target.checked)}
                        />
                      </Stack>
                    ) : (
                      <StatusChip
                        label={isConfirmed ? "Confirmado" : "Não confirmado"}
                        tone={isConfirmed ? "success" : "default"}
                      />
                    )
                  }
                >
                  <ListItemAvatar>
                    <PlayerAvatar
                      name={entry.player.name}
                      photo={entry.player.photo_thumb ?? entry.player.photo}
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        {entry.player.name}
                        <StatusChip
                          label={playerTypeLabel(entry.player.player_type)}
                          tone={playerTypeTone(entry.player.player_type)}
                        />
                        {entry.waitlist_position !== null && (
                          <StatusChip
                            label={`${entry.waitlist_position}º na espera`}
                            tone="warning"
                          />
                        )}
                      </Box>
                    }
                    secondary={entry.player.nickname}
                    slotProps={{ primary: { component: "div" } }}
                  />
                </ListItem>
              );
            })}

          {!isLoading && visible.length === 0 && (
            <EmptyState
              dense
              title={
                roster.length === 0
                  ? "Nenhum jogador ativo cadastrado."
                  : "Nenhum jogador com esse filtro."
              }
              description={
                roster.length > 0 && (search || filter !== "todos")
                  ? "Ajuste a busca ou volte para “Todos”."
                  : undefined
              }
              action={
                roster.length > 0 && (search || filter !== "todos") ? (
                  <Button
                    onClick={() => {
                      setSearch("");
                      setFilter("todos");
                    }}
                  >
                    Limpar busca e filtro
                  </Button>
                ) : undefined
              }
            />
          )}
        </List>
      </Card>
    </Box>
  );
}
