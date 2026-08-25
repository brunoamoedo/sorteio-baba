/**
 * Sorteio avulso — da lista colada ao sorteio.
 *
 * O que estes testes protegem é a promessa da tela: a partida nasce do tamanho
 * da lista (ninguém vai para a espera sem ter pedido), o reconhecimento de nomes
 * continua sendo o **do servidor**, e sortear leva para a tela da partida, que é
 * a dona do resultado.
 */

import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryStore } from "../../core/data";
import type { Match, QuickConfirmResolution } from "../../core/types/match";
import type { Player } from "../../core/types/player";
import { ToastProvider } from "../../shared/components/ToastProvider";
import { capacityForList, DrawAvulsoPage } from "./DrawAvulsoPage";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

vi.mock("../../shared/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../api/matchesApi", () => ({
  matchesApi: {
    create: vi.fn(),
    quickConfirm: vi.fn(),
    reassignConfirmation: vi.fn(),
    setConfirmation: vi.fn(),
  },
  waitlistApi: { list: vi.fn() },
}));

vi.mock("../../api/drawsApi", () => ({ drawsApi: { trigger: vi.fn() } }));
vi.mock("../../api/playersApi", () => ({ playersApi: { list: vi.fn() } }));

const { matchesApi } = await import("../../api/matchesApi");
const { drawsApi } = await import("../../api/drawsApi");
const { playersApi } = await import("../../api/playersApi");

const MATCH_ID = 77;

function player(id: number, name: string, nickname = ""): Player {
  return {
    id,
    user: null,
    user_name: null,
    user_email: null,
    name,
    nickname,
    photo: null,
    photo_thumb: null,
    phone: "",
    notes: "",
    player_type: "mensalista",
    status: "ativo",
    skill_level: 3,
    primary_position: 1,
    secondary_position: null,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
  };
}

const BARBA = player(1, "Barba");
const MACEDO = player(2, "Macedo");

function resolution(overrides: Partial<QuickConfirmResolution>): QuickConfirmResolution {
  return {
    input_name: "Fulano",
    parsed_name: "Fulano",
    resolution: "mensalista",
    confidence: 1,
    player_id: 1,
    player_name: "Fulano",
    player_type: "mensalista",
    waitlisted: false,
    waitlist_position: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DrawAvulsoPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** O campo grande da lista é o primeiro `textbox` da tela. */
function namesField(): HTMLElement {
  return screen.getAllByRole("textbox")[0];
}

beforeEach(() => {
  queryStore.clear();
  navigate.mockClear();
  vi.mocked(playersApi.list).mockResolvedValue([BARBA, MACEDO]);
  vi.mocked(matchesApi.create).mockResolvedValue({ id: MATCH_ID } as Match);
  vi.mocked(matchesApi.quickConfirm).mockResolvedValue([
    resolution({ input_name: "Barba", parsed_name: "Barba", player_name: "Barba" }),
    resolution({
      input_name: "Zé da Padaria",
      parsed_name: "Zé da Padaria",
      resolution: "convidado_criado",
      player_id: 99,
      player_name: "Zé da Padaria",
      player_type: "convidado",
      confidence: 0.3,
    }),
  ]);
  vi.mocked(drawsApi.trigger).mockResolvedValue({ id: 5 } as never);
});

describe("capacidade derivada da lista", () => {
  it("cabe a lista inteira, sem sobra para a lista de espera", () => {
    // 14 nomes em 2 times sem goleiro: 7 de linha por time, 14 vagas.
    expect(capacityForList(14, 2, 0)).toEqual({ minLine: 1, maxLine: 7, total: 14 });
  });

  it("arredonda para cima quando a divisão não é exata", () => {
    // 15 em 2 times não divide: o teto sobe para 16 em vez de deixar alguém de fora.
    const { total } = capacityForList(15, 2, 0);
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it("desconta os goleiros das vagas de linha", () => {
    expect(capacityForList(14, 2, 1)).toEqual({ minLine: 1, maxLine: 6, total: 14 });
  });

  it("nunca deixa o time menor que os goleiros que ele reserva", () => {
    // O servidor recusa `goalkeepers_per_team > max_players_per_team_line`.
    const { maxLine, total } = capacityForList(4, 2, 2);
    expect(maxLine).toBeGreaterThanOrEqual(2);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("três nomes ainda cabem em dois times", () => {
    expect(capacityForList(3, 2, 0).total).toBeGreaterThanOrEqual(3);
  });
});

describe("montagem da lista", () => {
  it("acrescenta o mensalista buscado como mais uma linha e o tira da busca", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByPlaceholderText("Buscar mensalista"));
    await user.click(await screen.findByRole("option", { name: "Macedo" }));

    expect(namesField()).toHaveValue("Macedo");

    // Já está na lista: oferecer de novo só produziria uma linha duplicada.
    await user.type(screen.getByPlaceholderText("Buscar mensalista"), "Mac");
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Macedo" })).not.toBeInTheDocument(),
    );
  });

  it("não deixa criar a partida com a lista vazia", async () => {
    renderPage();
    expect(screen.getByRole("button", { name: /Criar partida e conferir lista/ })).toBeDisabled();
  });
});

describe("criação e conferência", () => {
  it("cria a partida dimensionada para a lista e manda os nomes ao servidor", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(namesField(), "Barba\nZé da Padaria");
    await user.click(screen.getByRole("button", { name: /Criar partida e conferir lista/ }));

    await waitFor(() => expect(matchesApi.create).toHaveBeenCalled());
    expect(vi.mocked(matchesApi.create).mock.calls[0][0]).toMatchObject({
      teams_count: 2,
      goalkeepers_per_team: 0,
      min_players_per_team_line: 1,
      max_players_per_team_line: 1,
      draw_time: null,
    });

    // O reconhecimento é o do servidor: a tela só entrega as linhas.
    expect(matchesApi.quickConfirm).toHaveBeenCalledWith(MATCH_ID, ["Barba", "Zé da Padaria"]);

    // E a conferência mostra o que ele entendeu de cada linha.
    expect(await screen.findByText("Mensalista")).toBeInTheDocument();
    expect(screen.getByText("Convidado (não reconhecido)")).toBeInTheDocument();
  });

  it("sorteia e leva para a tela da partida, que é a dona do resultado", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(namesField(), "Barba");
    await user.click(screen.getByRole("button", { name: /Criar partida e conferir lista/ }));
    await user.click(await screen.findByRole("button", { name: "Sortear times" }));

    await waitFor(() => expect(drawsApi.trigger).toHaveBeenCalledWith(MATCH_ID));
    expect(navigate).toHaveBeenCalledWith(`/partidas/${MATCH_ID}`);
  });

  it("corrige na conferência pelo mesmo caminho da tela da partida", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.reassignConfirmation).mockResolvedValue(undefined as never);
    renderPage();

    await user.type(namesField(), "Barba\nZé da Padaria");
    await user.click(screen.getByRole("button", { name: /Criar partida e conferir lista/ }));

    await user.click(
      await screen.findByPlaceholderText("Não é essa pessoa? Busque o nome certo"),
    );
    await user.click(await screen.findByRole("option", { name: "Macedo" }));

    await waitFor(() =>
      expect(matchesApi.reassignConfirmation).toHaveBeenCalledWith(MATCH_ID, 99, MACEDO.id),
    );
  });
});
