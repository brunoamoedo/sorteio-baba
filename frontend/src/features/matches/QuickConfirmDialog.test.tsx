/**
 * Reconhecimento de mensalistas a partir da lista colada.
 *
 * A regra verificada aqui: quando o organizador precisa apontar o mensalista
 * certo, **só aparecem os que ainda não estão confirmados na partida**. Oferecer
 * quem já está dentro não corrige nada — o convidado errado sairia, o
 * mensalista continuaria onde estava e a partida perderia uma vaga em silêncio.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryStore } from "../../core/data";
import type { QuickConfirmResolution, RosterEntry } from "../../core/types/match";
import type { Player } from "../../core/types/player";
import { ToastProvider } from "../../shared/components/ToastProvider";
import { QuickConfirmDialog } from "./QuickConfirmDialog";

vi.mock("../../api/matchesApi", () => ({
  matchesApi: {
    roster: vi.fn(),
    quickConfirm: vi.fn(),
    reassignConfirmation: vi.fn(),
    setConfirmation: vi.fn(),
  },
  waitlistApi: { list: vi.fn() },
}));

vi.mock("../../api/playersApi", () => ({
  playersApi: { list: vi.fn() },
}));

const { matchesApi } = await import("../../api/matchesApi");
const { playersApi } = await import("../../api/playersApi");

const MATCH_ID = 1;

function player(id: number, name: string): Player {
  return {
    id,
    user: null,
    user_name: null,
    user_email: null,
    name,
    nickname: "",
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
const FIRMINO = player(3, "Felipe Santiago Firmino");

function rosterEntry(source: Player, status: RosterEntry["confirmation_status"]): RosterEntry {
  return { player: source, confirmation_status: status, waitlist_position: null };
}

function resolution(overrides: Partial<QuickConfirmResolution>): QuickConfirmResolution {
  return {
    input_name: "Fulano",
    parsed_name: "Fulano",
    resolution: "convidado_criado",
    confidence: 0.4,
    player_id: 99,
    player_name: "Fulano",
    player_type: "convidado",
    waitlisted: false,
    waitlist_position: null,
    ...overrides,
  };
}

function renderDialog() {
  return render(
    <ToastProvider>
      <QuickConfirmDialog open matchId={MATCH_ID} onClose={() => {}} />
    </ToastProvider>,
  );
}

/** Cola uma lista e espera a conferência aparecer. */
async function pasteList(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole("textbox"), text);
  await user.click(screen.getByRole("button", { name: "Confirmar presença" }));
  await screen.findByText(text);
}

/** Opções visíveis do Autocomplete aberto. */
function visibleOptions(): string[] {
  const listbox = screen.queryByRole("listbox");
  if (!listbox) return [];
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

beforeEach(() => {
  queryStore.clear();
  vi.mocked(playersApi.list).mockResolvedValue([BARBA, MACEDO, FIRMINO]);
  vi.mocked(matchesApi.roster).mockResolvedValue([
    rosterEntry(BARBA, "confirmed"),
    rosterEntry(MACEDO, "pending"),
    rosterEntry(FIRMINO, "declined"),
  ]);
  vi.mocked(matchesApi.reassignConfirmation).mockResolvedValue(undefined as never);
  vi.mocked(matchesApi.setConfirmation).mockResolvedValue({
    status: "confirmed",
    waitlisted: false,
    waitlist_position: null,
    promoted: [],
  } as never);
});

describe("escolha do mensalista certo", () => {
  it("oferece só os mensalistas que não estão confirmados na partida", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.quickConfirm).mockResolvedValue([
      resolution({ input_name: "Zé da Padaria", parsed_name: "Zé da Padaria" }),
    ]);
    renderDialog();

    await pasteList(user, "Zé da Padaria");

    const search = screen.getByPlaceholderText("Não é essa pessoa? Busque o nome certo");
    await user.click(search);

    const options = visibleOptions();
    // Barba está confirmado: não pode aparecer. Macedo (pendente) e Firmino
    // (recusado) continuam disponíveis — só "confirmado" tira da lista.
    expect(options).toEqual(["Macedo", "Felipe Santiago Firmino"]);
    expect(options).not.toContain("Barba");
  });

  it("avisa quando não sobrou nenhum mensalista para escolher", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.roster).mockResolvedValue([
      rosterEntry(BARBA, "confirmed"),
      rosterEntry(MACEDO, "confirmed"),
      rosterEntry(FIRMINO, "confirmed"),
    ]);
    vi.mocked(matchesApi.quickConfirm).mockResolvedValue([resolution({ input_name: "Zé" })]);
    renderDialog();

    await pasteList(user, "Zé");
    await user.click(screen.getByPlaceholderText("Não é essa pessoa? Busque o nome certo"));

    expect(
      await screen.findByText("Todos os mensalistas já estão confirmados nesta partida"),
    ).toBeInTheDocument();
  });

  it("uma linha 'já confirmado' não corrige ninguém — confirma quem faltou", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.quickConfirm).mockResolvedValue([
      resolution({
        input_name: "Santiago",
        parsed_name: "Santiago",
        resolution: "ja_confirmado",
        player_id: BARBA.id,
        player_name: "Barba",
        player_type: "mensalista",
        confidence: 0.8,
      }),
    ]);
    renderDialog();

    await pasteList(user, "Santiago");

    expect(screen.getByText("Barba já estava confirmado")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("É outra pessoa? Busque quem deveria entrar");
    await user.click(search);
    await user.click(await screen.findByRole("option", { name: "Macedo" }));

    // Confirma o jogador escolhido; **não** chama a correção, porque a linha
    // não confirmou ninguém que precise ser desfeito.
    await waitFor(() =>
      expect(matchesApi.setConfirmation).toHaveBeenCalledWith(MATCH_ID, MACEDO.id, "confirmed"),
    );
    expect(matchesApi.reassignConfirmation).not.toHaveBeenCalled();
  });

  it("uma linha de convidado não reconhecido continua usando a correção", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.quickConfirm).mockResolvedValue([
      resolution({ input_name: "Macedu", parsed_name: "Macedu", player_id: 99 }),
    ]);
    renderDialog();

    await pasteList(user, "Macedu");

    await user.click(screen.getByPlaceholderText("Não é essa pessoa? Busque o nome certo"));
    await user.click(await screen.findByRole("option", { name: "Macedo" }));

    await waitFor(() =>
      expect(matchesApi.reassignConfirmation).toHaveBeenCalledWith(MATCH_ID, 99, MACEDO.id),
    );
    expect(matchesApi.setConfirmation).not.toHaveBeenCalled();
  });
});

describe("a conferência fecha a conta com o que foi colado", () => {
  it("relaciona linhas lidas e quem entrou, e diz por que alguém não entrou", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.quickConfirm).mockResolvedValue([
      resolution({
        input_name: "Leo David",
        parsed_name: "Leo David",
        resolution: "mensalista",
        player_id: MACEDO.id,
        player_name: "Macedo",
        player_type: "mensalista",
        confidence: 0.77,
      }),
      resolution({
        input_name: "2-",
        parsed_name: "",
        resolution: "linha_invalida",
        player_id: null,
        player_name: null,
        player_type: null,
        confidence: 0,
      }),
    ]);
    renderDialog();

    await pasteList(user, "Leo David");

    // O número de linhas e o de confirmados aparecem juntos: era a ausência
    // dessa ligação que deixava "colei 24, entraram 23" passar sem ninguém ver.
    const summary = screen.getByText(/linhas lidas/).closest(".MuiAlert-message");
    expect(summary?.textContent).toContain("2");
    expect(summary?.textContent).toContain("1 linha não entrou");
    expect(summary?.textContent).toContain("1 sem nome");
  });

  it("uma linha sem nome é listada, não descartada, e pode virar alguém", async () => {
    const user = userEvent.setup();
    vi.mocked(matchesApi.quickConfirm).mockResolvedValue([
      resolution({
        input_name: "2-",
        parsed_name: "",
        resolution: "linha_invalida",
        player_id: null,
        player_name: null,
        player_type: null,
        confidence: 0,
      }),
    ]);
    renderDialog();

    await pasteList(user, "2-");

    expect(screen.getByText("Sem nome — não confirmado")).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText("Era alguém? Busque quem deveria entrar"));
    await user.click(await screen.findByRole("option", { name: "Macedo" }));

    // A linha não confirmou ninguém: é confirmação, não correção.
    await waitFor(() =>
      expect(matchesApi.setConfirmation).toHaveBeenCalledWith(MATCH_ID, MACEDO.id, "confirmed"),
    );
    expect(matchesApi.reassignConfirmation).not.toHaveBeenCalled();
  });
});
