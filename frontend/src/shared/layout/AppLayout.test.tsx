import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppLayout } from "./AppLayout";
import { AppThemeProvider } from "../theme/ColorModeContext";
import { setViewport } from "../../test/setup";

const logout = vi.fn();
const clearOrganization = vi.fn();

vi.mock("../../features/auth/AuthContext", () => ({
  useAuth: () => ({ logout, user: { username: "aderval", is_superadmin: false } }),
}));

vi.mock("../../features/organization/OrganizationContext", () => ({
  useOrganization: () => ({
    currentMembership: { role: "jogador", organization: { id: 1, name: "Pelada dos Amigos" } },
    memberships: [{ id: 1 }],
    clearOrganization,
  }),
}));

function renderLayout() {
  return render(
    <MemoryRouter>
      <AppThemeProvider>
        <AppLayout>
          <p>conteúdo</p>
        </AppLayout>
      </AppThemeProvider>
    </MemoryRouter>,
  );
}

describe("AppLayout — saída do sistema", () => {
  beforeEach(() => {
    logout.mockClear();
  });

  /**
   * Regressão real: "Sair" foi movido para o rodapé do menu lateral, mas o menu
   * só abre pelo hamburger ou pela barra inferior — e os dois existem apenas
   * abaixo de `md`. No desktop a sessão ficou sem saída.
   */
  it("permite sair no desktop", async () => {
    setViewport("desktop");
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: /conta de aderval/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Sair" }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("permite sair no celular", async () => {
    setViewport("mobile");
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    await user.click(await screen.findByRole("button", { name: "Sair" }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("não repete as ações de conta na barra do celular", () => {
    setViewport("mobile");
    renderLayout();

    // O avatar é a porta de entrada do desktop; no celular ele duplicaria o
    // rodapé do menu e roubaria espaço da barra.
    expect(screen.queryByRole("button", { name: /conta de/i })).not.toBeInTheDocument();
  });

  it("esconde 'Trocar de organização' de quem só participa de uma", async () => {
    setViewport("desktop");
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: /conta de aderval/i }));

    expect(screen.queryByRole("menuitem", { name: /trocar de organiza/i })).not.toBeInTheDocument();
  });
});
