/**
 * Movimentação manual de jogadores na tela de resultado do sorteio.
 *
 * O que estes testes cobrem é o que **é nosso**: o gesto terminou, e a partir
 * daí a composição dos times, o campo em SVG, a lista textual, os indicadores
 * de equilíbrio, as observações, o texto do WhatsApp e a chamada que gera a
 * auditoria têm de acompanhar — sem executar um novo sorteio.
 *
 * A física do arrasto (a que distância o gesto vira drag, qual área está sob o
 * ponteiro) é do dnd-kit, é testada lá, e depende de medições de layout que o
 * jsdom não faz — toda `getBoundingClientRect` devolve zero. Por isso o
 * `DndContext` é substituído por um dublê que guarda os manipuladores, e o
 * teste dispara `onDragEnd` com o mesmo evento que a biblioteca entregaria.
 * Tudo o que está **abaixo** disso é o código real da tela, inclusive o campo
 * em SVG e seus `data-player-id` / `data-team-id`.
 */

import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryStore } from "../../core/data";
import type { Draw, Team, TeamPlayer } from "../../core/types/draw";
import type { Match } from "../../core/types/match";
import { ToastProvider } from "../../shared/components/ToastProvider";
import { MatchDetailPage } from "./MatchDetailPage";

// --------------------------------------------------------------------------
// Dublês
// --------------------------------------------------------------------------

const dnd = vi.hoisted(() => ({
  handlers: {} as {
    onDragStart?: (event: unknown) => void;
    onDragEnd?: (event: unknown) => void;
    onDragCancel?: (event: unknown) => void;
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragStart,
    onDragEnd,
    onDragCancel,
  }: {
    children: ReactNode;
    onDragStart?: (event: unknown) => void;
    onDragEnd?: (event: unknown) => void;
    onDragCancel?: (event: unknown) => void;
  }) => {
    dnd.handlers = { onDragStart, onDragEnd, onDragCancel };
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PointerSensor: class PointerSensor {},
  // Arrastar por teclado passou a ser suportado — sem este sensor, o gesto era
  // impossível para quem não usa mouse, e arrastar era o único caminho.
  KeyboardSensor: class KeyboardSensor {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock("../../shared/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../organization/OrganizationContext", () => ({
  useOrganization: () => ({ currentMembership: { role: "organizador" } }),
}));

vi.mock("../../api/drawsApi", () => ({
  drawsApi: {
    trigger: vi.fn(),
    currentForMatch: vi.fn(),
    listForMatch: vi.fn(),
    movePlayer: vi.fn(),
  },
}));

vi.mock("../../api/matchesApi", () => ({
  matchesApi: {
    retrieve: vi.fn(),
    roster: vi.fn(),
    setConfirmation: vi.fn(),
    setAllConfirmations: vi.fn(),
    quickConfirm: vi.fn(),
    setResults: vi.fn(),
  },
  waitlistApi: { list: vi.fn(), promote: vi.fn(), remove: vi.fn(), move: vi.fn() },
}));

const { drawsApi } = await import("../../api/drawsApi");
const { matchesApi, waitlistApi } = await import("../../api/matchesApi");

// --------------------------------------------------------------------------
// Dados
// --------------------------------------------------------------------------

const TEAM_A = 10;
const TEAM_B = 20;

const POSITIONS = {
  ZAG: { id: 2, code: "ZAG", name: "Zagueiro", sort_order: 2, is_active: true },
  ATA: { id: 4, code: "ATA", name: "Atacante", sort_order: 4, is_active: true },
};

function teamPlayer(
  id: number,
  name: string,
  skill: number,
  position = POSITIONS.ATA,
): TeamPlayer {
  return {
    id,
    player_id: 100 + id,
    player_name: name,
    player_nickname: "",
    player_photo: null,
    player_type: "mensalista",
    position_snapshot: position,
    skill_snapshot: skill,
    used_secondary_position: false,
    line_index: null,
    slot_index: null,
  };
}

function makeTeam(id: number, name: string, players: TeamPlayer[]): Team {
  return {
    id,
    name,
    color: "",
    order_index: id === TEAM_A ? 0 : 1,
    formation: "",
    total_skill: players.reduce((sum, player) => sum + player.skill_snapshot, 0),
    team_players: players,
    result: null,
  };
}

function makeDraw(): Draw {
  return {
    id: 7,
    match: 1,
    algorithm: "simulated_annealing",
    trigger: "manual",
    formation: "",
    weights: {},
    score_balance: 0,
    score_position: 0,
    score_repetition: 0,
    score_weakest_split: 0,
    score_guest_balance: 0,
    total_score: 0,
    iterations_run: 100,
    is_current: true,
    executed_by_name: "organizador",
    created_at: "2026-08-10T20:00:00Z",
    teams: [
      makeTeam(TEAM_A, "Time A", [
        teamPlayer(1, "João", 1, POSITIONS.ZAG),
        teamPlayer(2, "Pedro", 3),
        teamPlayer(3, "Carlos", 4),
      ]),
      makeTeam(TEAM_B, "Time B", [
        teamPlayer(4, "Bruno", 1, POSITIONS.ZAG),
        teamPlayer(5, "Rafael", 4),
        teamPlayer(6, "Diego", 5),
      ]),
    ],
  };
}

const MATCH: Match = {
  id: 1,
  recurring_game: null,
  recurring_game_name: null,
  name: "Pelada de segunda",
  location: "Quadra do bairro",
  notes: "",
  scheduled_date: "2026-08-10",
  scheduled_time: "21:00",
  draw_time: null,
  automatic_draw: false,
  automatic_draw_source: null,
  automatic_draw_at: null,
  effective_draw_time: null,
  automatic_draw_blocked_reason: null,
  teams_count: 2,
  goalkeepers_per_team: 0,
  min_players: 6,
  max_players: 12,
  capacity: {
    teams_count: 2,
    min_players: 6,
    max_players: 12,
    goalkeepers_per_team: 0,
    line_players_per_team: 6,
    total_goalkeepers: 0,
    total_line_players: 12,
  },
  recurring_game_divergences: [],
  status: "drawn",
  draw_executed_at: "2026-08-10T20:00:00Z",
  confirmed_count: 6,
  waitlist_count: 0,
  created_at: "2026-08-01T12:00:00Z",
};

/** Servidor de mentira: guarda a composição e aplica a movimentação, para que
 * a revalidação disparada depois do sucesso devolva o estado **já alterado** —
 * como o backend faria. */
let serverDraw: Draw;

function moveOnServer(teamPlayerId: number, targetTeamId: number): void {
  const moved = serverDraw.teams
    .flatMap((team) => team.team_players)
    .find((player) => player.id === teamPlayerId);
  if (!moved) return;
  serverDraw = {
    ...serverDraw,
    teams: serverDraw.teams.map((team) => ({
      ...team,
      team_players:
        team.id === targetTeamId
          ? [...team.team_players.filter((player) => player.id !== teamPlayerId), moved]
          : team.team_players.filter((player) => player.id !== teamPlayerId),
    })),
  };
}

// --------------------------------------------------------------------------
// Utilitários de teste
// --------------------------------------------------------------------------

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/partidas/1"]}>
        <Routes>
          <Route path="/partidas/:id" element={<MatchDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** Dispara o fim de um arrasto com o mesmo formato de evento do dnd-kit. */
async function dropPlayerOnTeam(teamPlayerId: number, fromTeamId: number, toTeamId: number) {
  await act(async () => {
    dnd.handlers.onDragEnd?.({
      active: {
        id: `team-player-${teamPlayerId}`,
        data: { current: { teamPlayerId, playerId: 100 + teamPlayerId, currentTeamId: fromTeamId } },
      },
      over: { id: `team-${toTeamId}`, data: { current: { teamId: toTeamId } } },
    });
  });
}

/** Só a escalação em texto do card — sem os rótulos desenhados dentro do SVG,
 * que repetem os mesmos nomes. */
function roster(teamId: number) {
  return within(screen.getByTestId(`team-roster-${teamId}`));
}

function pitchPlayerIds(teamId: number): number[] {
  const pitch = screen.getByTestId(`pitch-${teamId}`);
  return Array.from(pitch.querySelectorAll("[data-player-id]")).map((node) =>
    Number(node.getAttribute("data-player-id")),
  );
}

/** Lê a mensagem pronta para o WhatsApp.
 *
 * A prévia passou a ser colapsada — no celular ela empurrava o botão "Copiar"
 * para fora da tela —, então o campo só existe depois de expandi-la. */
async function shareText(): Promise<string> {
  // Específico pelo texto: a tela tem mais de um botão expansível (o card da
  // partida também tem "ver detalhes"), e um seletor genérico por
  // `aria-expanded` abria o errado.
  const toggle = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => /ver a mensagem/i.test(button.textContent ?? ""),
  );
  if (toggle) {
    await act(async () => {
      toggle.click();
    });
  }
  return (screen.getByLabelText("Mensagem para o WhatsApp") as HTMLTextAreaElement).value;
}

beforeEach(async () => {
  queryStore.clear();
  serverDraw = makeDraw();
  dnd.handlers = {};

  vi.mocked(matchesApi.retrieve).mockResolvedValue(MATCH);
  vi.mocked(matchesApi.roster).mockResolvedValue([]);
  vi.mocked(waitlistApi.list).mockResolvedValue([]);
  vi.mocked(drawsApi.currentForMatch).mockImplementation(async () => serverDraw);
  vi.mocked(drawsApi.listForMatch).mockImplementation(async () => [serverDraw]);
  vi.mocked(drawsApi.movePlayer).mockImplementation(async (_drawId, teamPlayerId, targetTeamId) => {
    moveOnServer(teamPlayerId, targetTeamId);
  });
});

async function renderDrawnMatch() {
  renderPage();
  await screen.findByTestId(`team-card-${TEAM_A}`);
}

// --------------------------------------------------------------------------
// Testes
// --------------------------------------------------------------------------

describe("movimentação manual de jogadores entre times", () => {
  it("move o jogador do time de origem para o time de destino", async () => {
    await renderDrawnMatch();

    expect(roster(TEAM_A).getByText(/João/)).toBeInTheDocument();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    expect(roster(TEAM_A).queryByText(/João/)).not.toBeInTheDocument();
    expect(roster(TEAM_B).getByText(/João/)).toBeInTheDocument();
  });

  it("atualiza a lista textual dos dois times", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    expect(roster(TEAM_A).getAllByText(/^👤/)).toHaveLength(2);
    expect(roster(TEAM_B).getAllByText(/^👤/)).toHaveLength(4);
  });

  it("atualiza o campo em SVG, mantendo os jogadores identificados", async () => {
    await renderDrawnMatch();

    expect(pitchPlayerIds(TEAM_A)).toEqual([101, 102, 103]);
    expect(pitchPlayerIds(TEAM_B)).toEqual([104, 105, 106]);

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    expect(pitchPlayerIds(TEAM_A)).toEqual([102, 103]);
    expect(pitchPlayerIds(TEAM_B)).toContain(101);
  });

  it("preserva nível, posição e identidade do jogador movido", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    const token = screen
      .getByTestId(`pitch-${TEAM_B}`)
      .querySelector('[data-player-id="101"]') as SVGGElement;

    expect(token.getAttribute("aria-label")).toBe("João, ZAG, 1 estrelas");
    // O jogador passa a pertencer ao time de destino também no DOM do campo.
    expect(token.getAttribute("data-team-id")).toBe(String(TEAM_B));
    expect(token.getAttribute("data-team-player-id")).toBe("1");
    // João chega com o mesmo "ZAG · 1⭐" do Bruno, que já estava no time.
    expect(roster(TEAM_B).getAllByText(/ZAG · 1⭐/)).toHaveLength(2);
  });

  it("atualiza os indicadores de equilíbrio dos dois times", async () => {
    await renderDrawnMatch();

    expect(screen.getByTestId(`team-metrics-${TEAM_A}`)).toHaveTextContent("👥 3 jogadores");
    expect(screen.getByTestId(`team-metrics-${TEAM_A}`)).toHaveTextContent("Nível total: 8");

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    const teamA = screen.getByTestId(`team-metrics-${TEAM_A}`);
    expect(teamA).toHaveTextContent("👥 2 jogadores");
    expect(teamA).toHaveTextContent("Nível total: 7");
    expect(teamA).toHaveTextContent("Média: 3,5");

    const teamB = screen.getByTestId(`team-metrics-${TEAM_B}`);
    expect(teamB).toHaveTextContent("👥 4 jogadores");
    expect(teamB).toHaveTextContent("Nível total: 11");
    expect(teamB).toHaveTextContent("Média: 2,8");
  });

  it("atualiza o texto pronto para o WhatsApp", async () => {
    await renderDrawnMatch();

    // Cada nome carrega a posição — quem lê no grupo precisa saber onde vai
    // jogar, e a mensagem antes trazia só o nome.
    expect(await shareText()).toContain(
      "🏆 Time 1 🔵:\n👤 João (ZAG)\n👤 Pedro (ATA)\n👤 Carlos (ATA)",
    );

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    const depois = await shareText();
    expect(depois).toContain("🏆 Time 1 🔵:\n👤 Pedro (ATA)\n👤 Carlos (ATA)");
    expect(depois).toContain(
      "🏆 Time 2 🔴:\n👤 Bruno (ZAG)\n👤 Rafael (ATA)\n👤 Diego (ATA)\n👤 João (ZAG)",
    );
  });

  it("registra a observação abaixo do campo — e só depois de haver alteração", async () => {
    await renderDrawnMatch();

    expect(screen.queryByTestId("manual-moves-notes")).not.toBeInTheDocument();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    const notes = within(screen.getByTestId("manual-moves-notes"));
    expect(notes.getByText("⚠️ Observações das alterações")).toBeInTheDocument();
    expect(
      notes.getByText("João foi movido manualmente do Time 1 🔵 para o Time 2 🔴."),
    ).toBeInTheDocument();
  });

  it("avisa, com números, quando a alteração desequilibra os times", async () => {
    await renderDrawnMatch();

    // Sem alteração nenhuma não existe aviso: 8 x 10 é o que o sorteio entregou.
    expect(screen.queryByTestId("balance-warning")).not.toBeInTheDocument();

    await dropPlayerOnTeam(6, TEAM_B, TEAM_A); // Diego (5⭐) para o outro time

    expect(screen.getByTestId("balance-warning")).toHaveTextContent(
      "o sorteio entregou 8 / 10 estrelas (diferença de 2) e agora está 13 / 5 (diferença de 8)",
    );
  });

  it("para de avisar quando uma alteração seguinte devolve o equilíbrio", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(2, TEAM_A, TEAM_B); // Pedro (3⭐): 8 x 10 vira 5 x 13
    expect(screen.getByTestId("balance-warning")).toBeInTheDocument();

    await dropPlayerOnTeam(6, TEAM_B, TEAM_A); // Diego (5⭐): volta para 10 x 8
    expect(screen.queryByTestId("balance-warning")).not.toBeInTheDocument();
    // As observações continuam lá: as duas movimentações aconteceram.
    expect(within(screen.getByTestId("manual-moves-notes")).getAllByRole("listitem")).toHaveLength(
      2,
    );
  });

  it("avisa quando a alteração manual junta os piores jogadores, sem desfazê-la", async () => {
    await renderDrawnMatch();

    // João (1⭐) indo para o time do Bruno (1⭐) desfaz a separação dos piores.
    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    expect(screen.getByTestId("manual-moves-notes")).toHaveTextContent(
      /2 jogadores de 1 estrela\(s\) ficaram no mesmo time/,
    );
    // O sistema avisa, mas a decisão do organizador continua valendo.
    expect(roster(TEAM_B).getByText(/João/)).toBeInTheDocument();
  });

  it("manda a movimentação para a auditoria do servidor, com motivo", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    // O motivo deixou de citar o arrasto: a mesma movimentação pode vir do
    // toque ou do teclado, e o texto antigo ("arrastar e soltar no campo")
    // passaria a mentir na trilha de auditoria.
    await waitFor(() =>
      expect(drawsApi.movePlayer).toHaveBeenCalledWith(
        7,
        1,
        TEAM_B,
        "Movimentação manual do jogador entre times",
      ),
    );
  });

  it("não executa um novo sorteio", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);
    await waitFor(() => expect(drawsApi.movePlayer).toHaveBeenCalled());

    expect(drawsApi.trigger).not.toHaveBeenCalled();
    // A tela continua no mesmo sorteio: nenhum `Draw` novo apareceu.
    expect(screen.getByTestId(`team-card-${TEAM_A}`)).toBeInTheDocument();
    expect(serverDraw.id).toBe(7);
  });

  it("aceita várias movimentações em sequência", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);
    await dropPlayerOnTeam(6, TEAM_B, TEAM_A);
    await dropPlayerOnTeam(2, TEAM_A, TEAM_B);

    expect(pitchPlayerIds(TEAM_A)).toEqual([103, 106]);
    expect(pitchPlayerIds(TEAM_B)).toEqual([104, 105, 101, 102]);

    const notes = within(screen.getByTestId("manual-moves-notes")).getAllByRole("listitem");
    expect(notes.map((item) => item.textContent)).toEqual([
      "João foi movido manualmente do Time 1 🔵 para o Time 2 🔴.",
      "Diego foi movido manualmente do Time 2 🔴 para o Time 1 🔵.",
      "Pedro foi movido manualmente do Time 1 🔵 para o Time 2 🔴.",
    ]);
  });

  it("ignora o jogador solto no time em que já estava", async () => {
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_A);

    expect(drawsApi.movePlayer).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manual-moves-notes")).not.toBeInTheDocument();
    expect(pitchPlayerIds(TEAM_A)).toEqual([101, 102, 103]);
  });

  it("desfaz a alteração na tela quando o servidor recusa", async () => {
    vi.mocked(drawsApi.movePlayer).mockRejectedValue(new Error("500"));
    await renderDrawnMatch();

    await dropPlayerOnTeam(1, TEAM_A, TEAM_B);

    await waitFor(() => expect(screen.queryByTestId("manual-moves-notes")).not.toBeInTheDocument());
    expect(pitchPlayerIds(TEAM_A)).toEqual([101, 102, 103]);
    expect(pitchPlayerIds(TEAM_B)).toEqual([104, 105, 106]);
  });
});
