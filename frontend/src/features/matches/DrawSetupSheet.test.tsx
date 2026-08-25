/**
 * Painel de configuração do sorteio.
 *
 * O que estes testes travam é a coerência entre **o que a tela oferece** e
 * **o que o servidor aceita**. Uma formação de 6 num time de 8 é recusada pelo
 * backend; se a tela deixar escolhê-la (ou trouxer uma escolha antiga que
 * deixou de caber), o organizador vê um erro sobre algo que ele não fez agora.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DrawSetupSheet } from "./DrawSetupSheet";
import { AppThemeProvider } from "../../shared/theme/ColorModeContext";
import type { MatchCapacity } from "../../core/types/match";

function capacidade(overrides: Partial<MatchCapacity> = {}): MatchCapacity {
  return {
    teams_count: 4,
    min_players: 8,
    // Teto configurado: 4 times × 8 de linha.
    max_players: 32,
    goalkeepers_per_team: 0,
    line_players_per_team: 8,
    total_goalkeepers: 0,
    total_line_players: 32,
    ...overrides,
  };
}

function abrir(props: Partial<Parameters<typeof DrawSetupSheet>[0]> = {}) {
  const onDraw = vi.fn();
  render(
    <AppThemeProvider>
      <DrawSetupSheet
        open
        onClose={() => {}}
        capacity={capacidade()}
        confirmedCount={24}
        isDrawing={false}
        onDraw={onDraw}
        isRedraw={false}
        {...props}
      />
    </AppThemeProvider>,
  );
  return { onDraw };
}

/** As formações oferecidas, lidas do radiogroup. */
function opcoes(): string[] {
  return screen
    .getAllByRole("radio")
    .map((cartao) => cartao.getAttribute("aria-label") ?? cartao.textContent ?? "")
    .map((texto) => texto.trim());
}

describe("formações oferecidas", () => {
  it("usa o time real, não o teto configurado", () => {
    // Teto de 8 por time, mas 24 confirmados em 4 times = 6 de linha.
    abrir({ confirmedCount: 24 });

    // O número vem num `<strong>` separado do texto, então a asserção é sobre
    // o texto corrido da tela.
    expect(document.body.textContent).toContain("6 de linha por time");
    expect(document.body.textContent).not.toContain("8 de linha por time");
  });

  it("o subtítulo mostra o mesmo número do corpo", () => {
    abrir({ confirmedCount: 24 });

    // Dizia "8 de linha" no subtítulo e "6 de linha" no corpo, na mesma tela.
    expect(screen.getByText(/4 times × \(6 de linha/)).toBeInTheDocument();
  });

  it("com 8 de linha não oferece formação de 6", async () => {
    abrir({ confirmedCount: 32 });

    const lista = opcoes().join(" ");
    expect(lista).toMatch(/2-2-2-2|4-4/);
    expect(lista).not.toMatch(/\b2-2-2\b(?!-)/);
  });
});

describe("formação anterior que deixou de caber", () => {
  it("é descartada quando o time mudou de tamanho", async () => {
    // A partida foi sorteada com 6 de linha (`2-2-2`); agora tem 8.
    const { onDraw } = abrir({ confirmedCount: 32, initialFormation: "2-2-2" });

    await userEvent.click(screen.getByRole("button", { name: /Sortear/ }));

    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(onDraw.mock.calls[0][0]).not.toBe("2-2-2");
  });

  it("é mantida quando ainda cabe", async () => {
    const { onDraw } = abrir({ confirmedCount: 24, initialFormation: "3-3" });

    await userEvent.click(screen.getByRole("button", { name: /Sortear/ }));

    expect(onDraw).toHaveBeenCalledWith("3-3");
  });
});
