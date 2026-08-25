/**
 * Tela de geração de acesso.
 *
 * O que estes testes travam é o que a tela **promete ao organizador**: que ele
 * enxergue as três situações sem adivinhar (pode receber, já tem, impedido e
 * por quê), que só marque quem a operação realmente alcança, e que "todos" e
 * "os selecionados" sejam duas chamadas diferentes — porque no servidor elas
 * são.
 *
 * O caso da paginação tem um teste só para ele. A `DataTable` mostra 25 linhas
 * por vez, e "selecionar todos" tem de pegar **os 30**, não os 25 visíveis. É
 * uma regra que vive na fronteira entre a página e a tabela: nada quebra hoje
 * se alguém trocar a lista inteira pela fatia da página, e o organizador só
 * descobriria contando os logins que não foram criados.
 */

import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginsPage } from "./LoginsPage";
import { queryStore } from "../../core/data";
import type { BulkResult, LoginStatusRow } from "../../core/types/player";
import { ToastProvider } from "../../shared/components/ToastProvider";
import { AppThemeProvider } from "../../shared/theme/ColorModeContext";
import { setViewport } from "../../test/setup";

// --------------------------------------------------------------------------
// Dublês
// --------------------------------------------------------------------------

const loginStatus = vi.fn();
const generateLogins = vi.fn();
const resetPassword = vi.fn();

vi.mock("../../api/playersApi", () => ({
  playersApi: {
    loginStatus: () => loginStatus(),
    generateLogins: (ids?: number[]) => generateLogins(ids),
    resetPassword: (id: number) => resetPassword(id),
  },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ logout: vi.fn(), user: { username: "aderval", is_superadmin: false } }),
}));

vi.mock("../organization/OrganizationContext", () => ({
  useOrganization: () => ({
    currentMembership: { role: "gerente", organization: { id: 1, name: "Pelada dos Amigos" } },
    memberships: [{ id: 1 }],
    clearOrganization: vi.fn(),
  }),
}));

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function linha(overrides: Partial<LoginStatusRow> = {}): LoginStatusRow {
  return {
    player_id: 1,
    player_name: "Ana",
    player_nickname: "",
    phone: "(11) 91111-1111",
    phone_digits: "11911111111",
    has_login: false,
    username: null,
    must_change_password: null,
    blocked_reason: null,
    ...overrides,
  };
}

function resultado(overrides: Partial<BulkResult> = {}): BulkResult {
  return {
    processed: [],
    skipped: [],
    processed_count: 0,
    skipped_count: 0,
    total: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AppThemeProvider>
        <ToastProvider>
          <LoginsPage />
        </ToastProvider>
      </AppThemeProvider>
    </MemoryRouter>,
  );
}

/** A tela começa carregando; esperar a primeira linha evita asserção em tela vazia. */
async function renderComLinhas(linhas: LoginStatusRow[]) {
  loginStatus.mockResolvedValue(linhas);
  renderPage();
  await screen.findByText(linhas[0].player_name);
}

beforeEach(() => {
  queryStore.clear();
  loginStatus.mockReset();
  generateLogins.mockReset();
  resetPassword.mockReset();
  generateLogins.mockResolvedValue(resultado());
  resetPassword.mockResolvedValue({ username: "11911111111" });
});

// --------------------------------------------------------------------------

describe("as três situações", () => {
  it("mostra quem pode receber, quem já tem e quem está impedido", async () => {
    await renderComLinhas([
      linha({ player_id: 1, player_name: "Ana" }),
      linha({ player_id: 2, player_name: "Bruno", has_login: true, must_change_password: false }),
      linha({ player_id: 3, player_name: "Caio", blocked_reason: "sem telefone" }),
    ]);

    expect(screen.getByText("Sem login")).toBeInTheDocument();
    expect(screen.getByText("Login ativo")).toBeInTheDocument();
    expect(screen.getByText("sem telefone")).toBeInTheDocument();
  });

  it("distingue quem ainda não fez o primeiro acesso", async () => {
    await renderComLinhas([
      linha({ player_id: 2, player_name: "Bruno", has_login: true, must_change_password: true }),
    ]);

    expect(screen.getByText("Primeiro acesso pendente")).toBeInTheDocument();
  });

  it("diz qual é a senha inicial — ela não vem do servidor", async () => {
    await renderComLinhas([linha()]);

    expect(screen.getByText("novasenha123")).toBeInTheDocument();
  });
});

describe("ordem da lista", () => {
  /** A `DataTable` ordena decrescente por padrão — bom para data e valor, ruim
   * para nome: a tela de acesso abria no fim do alfabeto. */
  it("começa pelo começo do alfabeto", async () => {
    await renderComLinhas([
      linha({ player_id: 1, player_name: "Zeca" }),
      linha({ player_id: 2, player_name: "Ana" }),
      linha({ player_id: 3, player_name: "Marcos" }),
    ]);

    const nomes = screen
      .getAllByRole("checkbox", { name: /^Selecionar (?!todos)/ })
      .map((caixa) => caixa.getAttribute("aria-label"));

    expect(nomes).toEqual(["Selecionar Ana", "Selecionar Marcos", "Selecionar Zeca"]);
  });
});

describe("seleção", () => {
  it("não oferece caixa para quem está impedido", async () => {
    await renderComLinhas([
      linha({ player_id: 1, player_name: "Ana" }),
      linha({ player_id: 3, player_name: "Caio", blocked_reason: "sem telefone" }),
    ]);

    expect(screen.getByRole("checkbox", { name: "Selecionar Ana" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Selecionar Caio" })).not.toBeInTheDocument();
  });

  it("não oferece caixa para quem já tem login", async () => {
    await renderComLinhas([
      linha({ player_id: 2, player_name: "Bruno", has_login: true, blocked_reason: "já possui login" }),
    ]);

    expect(screen.queryByRole("checkbox", { name: "Selecionar Bruno" })).not.toBeInTheDocument();
  });

  it("a barra de ações só aparece com alguém marcado", async () => {
    const user = userEvent.setup();
    await renderComLinhas([linha({ player_id: 1, player_name: "Ana" })]);

    expect(screen.queryByRole("region", { name: "Ações em massa" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Selecionar Ana" }));

    expect(screen.getByRole("region", { name: "Ações em massa" })).toBeInTheDocument();
  });

  it("limpar desfaz a seleção", async () => {
    const user = userEvent.setup();
    await renderComLinhas([linha({ player_id: 1, player_name: "Ana" })]);

    await user.click(screen.getByRole("checkbox", { name: "Selecionar Ana" }));
    await user.click(screen.getByRole("button", { name: "Limpar" }));

    expect(screen.queryByRole("region", { name: "Ações em massa" })).not.toBeInTheDocument();
  });

  /**
   * A regra que a arquitetura garante hoje e nada travava: a caixa do topo
   * recebe **a lista inteira**, não a fatia que a `DataTable` está exibindo.
   */
  it("selecionar todos alcança quem está fora da primeira página", async () => {
    const user = userEvent.setup();
    const trinta = Array.from({ length: 30 }, (_, i) =>
      linha({ player_id: i + 1, player_name: `Jogador ${String(i + 1).padStart(2, "0")}` }),
    );
    await renderComLinhas(trinta);

    // A página mostra 25 de 30: sem isso, o teste não estaria provando nada.
    expect(screen.queryByText("Jogador 30")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: "Selecionar todos os jogadores sem login" }),
    );

    const barra = screen.getByRole("region", { name: "Ações em massa" });
    expect(within(barra).getByText("30")).toBeInTheDocument();

    await user.click(within(barra).getByRole("button", { name: /gerar/i }));
    await user.click(screen.getByRole("button", { name: "Gerar" }));

    await waitFor(() => expect(generateLogins).toHaveBeenCalledTimes(1));
    expect(generateLogins.mock.calls[0][0]).toHaveLength(30);
  });
});

describe("gerar logins", () => {
  it("com seleção, envia só os marcados", async () => {
    const user = userEvent.setup();
    await renderComLinhas([
      linha({ player_id: 1, player_name: "Ana" }),
      linha({ player_id: 7, player_name: "Bruno" }),
    ]);

    await user.click(screen.getByRole("checkbox", { name: "Selecionar Bruno" }));
    const barra = screen.getByRole("region", { name: "Ações em massa" });
    await user.click(within(barra).getByRole("button", { name: /gerar/i }));
    await user.click(screen.getByRole("button", { name: "Gerar" }));

    await waitFor(() => expect(generateLogins).toHaveBeenCalledWith([7]));
  });

  /** Sem recorte, o servidor decide o escopo — mandar a lista de ids seria
   * dizer "todos" com uma foto que pode estar velha. */
  it("sem seleção, 'gerar para todos' não manda recorte nenhum", async () => {
    const user = userEvent.setup();
    await renderComLinhas([
      linha({ player_id: 1, player_name: "Ana" }),
      linha({ player_id: 7, player_name: "Bruno" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Gerar para todos (2)" }));
    await user.click(screen.getByRole("button", { name: "Gerar" }));

    await waitFor(() => expect(generateLogins).toHaveBeenCalledWith(undefined));
  });

  it("o botão de todos some quando não há ninguém para receber", async () => {
    await renderComLinhas([
      linha({ player_id: 2, player_name: "Bruno", has_login: true, blocked_reason: "já possui login" }),
    ]);

    expect(screen.getByRole("button", { name: /gerar para todos/i })).toBeDisabled();
  });

  it("avisa quantos ficaram de fora", async () => {
    const user = userEvent.setup();
    generateLogins.mockResolvedValue(
      resultado({ processed_count: 1, skipped_count: 2, total: 3 }),
    );
    await renderComLinhas([linha({ player_id: 1, player_name: "Ana" })]);

    await user.click(screen.getByRole("button", { name: /gerar para todos/i }));
    await user.click(screen.getByRole("button", { name: "Gerar" }));

    expect(await screen.findByText("1 login(s) criado(s) · 2 não gerado(s).")).toBeInTheDocument();
  });
});

describe("resetar senha", () => {
  it("só é oferecido a quem tem login", async () => {
    await renderComLinhas([
      linha({ player_id: 1, player_name: "Ana" }),
      linha({ player_id: 2, player_name: "Bruno", has_login: true, must_change_password: false }),
    ]);

    expect(screen.getAllByRole("button", { name: "Resetar senha" })).toHaveLength(1);
  });

  it("confirma antes e envia a ficha escolhida", async () => {
    const user = userEvent.setup();
    await renderComLinhas([
      linha({ player_id: 9, player_name: "Bruno", has_login: true, must_change_password: false }),
    ]);

    await user.click(screen.getByRole("button", { name: "Resetar senha" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Bruno");

    await user.click(screen.getByRole("button", { name: "Resetar" }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith(9));
  });

  /** A tela diz o que acontece, e diz também o que **não** acontece: ninguém
   * vê a senha atual de ninguém. */
  it("o aviso deixa claro que a senha não é revelada", async () => {
    const user = userEvent.setup();
    await renderComLinhas([
      linha({ player_id: 9, player_name: "Bruno", has_login: true, must_change_password: false }),
    ]);

    await user.click(screen.getByRole("button", { name: "Resetar senha" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(/não vê a senha atual/i);
  });
});

describe("no celular", () => {
  /** Sem o card, a seleção simplesmente não existiria no telefone: abaixo de
   * `md` a `DataTable` troca a tabela pela lista de cards. */
  it("a caixa de seleção continua existindo no card", async () => {
    setViewport("mobile");
    await renderComLinhas([linha({ player_id: 1, player_name: "Ana" })]);

    expect(screen.getByRole("checkbox", { name: "Selecionar Ana" })).toBeInTheDocument();
  });

  it("o telefone aparece junto do nome", async () => {
    setViewport("mobile");
    await renderComLinhas([linha({ player_id: 1, player_name: "Ana" })]);

    expect(screen.getByText("(11) 91111-1111")).toBeInTheDocument();
  });
});
