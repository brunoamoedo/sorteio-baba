/**
 * Troca obrigatória no primeiro acesso.
 *
 * A palavra "obrigatória" é o que estes testes defendem. O bloqueio de verdade
 * é do servidor — esta tela é a porta, não a fechadura —, mas uma porta que
 * oferece um desvio convida a tentar: se aparecer menu, barra inferior ou um
 * "agora não", a pessoa vai clicar e voltar a bater no 403 sem entender por
 * quê. Daí os testes de **ausência**: nenhuma navegação, nenhuma saída além de
 * trocar a senha ou sair da conta.
 *
 * O resto trava o que a tela promete no formulário: a confirmação confere, o
 * erro do servidor aparece em vez de sumir, e o que sobe é `current_password` +
 * `new_password` — nunca a confirmação, que é só do cliente.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangePasswordPage } from "./ChangePasswordPage";
import { setViewport } from "../../test/setup";

const changePassword = vi.fn();
const logout = vi.fn();

vi.mock("../../api/authApi", () => ({
  authApi: {
    changePassword: (payload: { current_password: string; new_password: string }) =>
      changePassword(payload),
  },
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ logout, user: { username: "11911111111" } }),
}));

const onDone = vi.fn();

function renderPage() {
  render(<ChangePasswordPage onDone={onDone} />);
  return userEvent.setup();
}

interface Senhas {
  atual?: string;
  nova?: string;
  repetir?: string;
}

async function preencher(
  user: ReturnType<typeof userEvent.setup>,
  { atual = "novasenha123", nova = "minhaSenhaBoa9", repetir }: Senhas = {},
) {
  await user.type(screen.getByLabelText("Senha temporária"), atual);
  await user.type(screen.getByLabelText("Nova senha"), nova);
  await user.type(screen.getByLabelText("Repita a nova senha"), repetir ?? nova);
  await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));
}

beforeEach(() => {
  changePassword.mockReset();
  changePassword.mockResolvedValue({ detail: "ok", first_access: true });
  logout.mockClear();
  onDone.mockClear();
});

describe("a tela não tem desvio", () => {
  it("não traz navegação nenhuma", () => {
    renderPage();

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("no celular também não aparece barra inferior", () => {
    setViewport("mobile");
    renderPage();

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  /** A única outra saída — sem ela, quem entrou na conta errada fica preso. */
  it("oferece sair da conta, e só", () => {
    renderPage();

    const botoes = screen.getAllByRole("button").map((botao) => botao.textContent);
    expect(botoes).toEqual(["Salvar e continuar", "Sair"]);
  });

  it("sair encerra a sessão", async () => {
    const user = renderPage();

    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("formulário", () => {
  it("envia a senha atual e a nova", async () => {
    const user = renderPage();

    await preencher(user);

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        current_password: "novasenha123",
        new_password: "minhaSenhaBoa9",
      }),
    );
  });

  /** A confirmação é conferência de digitação, não dado de negócio: o servidor
   * não tem o que fazer com ela. */
  it("não manda a confirmação para o servidor", async () => {
    const user = renderPage();

    await preencher(user);

    await waitFor(() => expect(changePassword).toHaveBeenCalled());
    expect(Object.keys(changePassword.mock.calls[0][0])).toEqual([
      "current_password",
      "new_password",
    ]);
  });

  it("recusa quando a confirmação não confere", async () => {
    const user = renderPage();

    await preencher(user, { nova: "minhaSenhaBoa9", repetir: "outraCoisa9" });

    expect(await screen.findByText("As senhas não conferem")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("recusa senha curta antes de incomodar o servidor", async () => {
    const user = renderPage();

    await preencher(user, { nova: "curta1", repetir: "curta1" });

    expect(await screen.findByText("Pelo menos 8 caracteres")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("cobra os três campos", async () => {
    const user = renderPage();

    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));

    expect(await screen.findByText("Informe a senha temporária")).toBeInTheDocument();
    expect(screen.getByText("Informe a nova senha")).toBeInTheDocument();
    // A mensagem do terceiro campo repete o rótulo, então a marca de inválido é
    // o que distingue "cobrado" de "apenas rotulado".
    expect(screen.getByLabelText("Repita a nova senha")).toBeInvalid();
  });

  it("libera o sistema quando o servidor aceita", async () => {
    const user = renderPage();

    await preencher(user);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

describe("erro do servidor", () => {
  /** As regras que só o servidor conhece — "igual à temporária", "senha comum",
   * "parecida com o seu nome" — chegam aqui como mensagem, e a pessoa continua
   * na tela para tentar de novo. */
  it("mostra a recusa e mantém a pessoa na tela", async () => {
    changePassword.mockRejectedValue({
      response: { status: 400, data: { new_password: ["A nova senha não pode ser a temporária."] } },
    });
    const user = renderPage();

    await preencher(user);

    expect(
      await screen.findByText("Nova senha: A nova senha não pode ser a temporária."),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar e continuar" })).toBeInTheDocument();
  });
});
