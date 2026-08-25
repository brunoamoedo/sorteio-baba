import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PresencePanel } from "./PresencePanel";
import { AppThemeProvider } from "../../shared/theme/ColorModeContext";

import type { RosterEntry } from "../../core/types/match";

function entry(
  id: number,
  name: string,
  overrides: Partial<RosterEntry> = {},
): RosterEntry {
  return {
    player: {
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
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
    confirmation_status: "pending",
    waitlist_position: null,
    ...overrides,
  } as RosterEntry;
}

/** Mais de 8 jogadores: é o piso a partir do qual a busca e o filtro aparecem
 * (numa pelada pequena eles seriam só ruído). */
function bigRoster(): RosterEntry[] {
  return [
    entry(1, "João Busquets", { confirmation_status: "confirmed" }),
    entry(2, "Pedro Álvares", { confirmation_status: "confirmed" }),
    entry(3, "Carlos", { confirmation_status: "confirmed" }),
    entry(4, "Bruno"),
    entry(5, "Rafael"),
    entry(6, "Diego"),
    entry(7, "Sérgio"),
    entry(8, "Almada", { waitlist_position: 1 }),
    entry(9, "Zango", { waitlist_position: 2 }),
  ];
}

function renderPanel(props: Partial<Parameters<typeof PresencePanel>[0]> = {}) {
  const onToggle = vi.fn();
  const utils = render(
    <AppThemeProvider>
      <PresencePanel
        roster={bigRoster()}
        isLoading={false}
        confirmedCount={3}
        canManage
        pendingPlayers={new Set()}
        onToggle={onToggle}
        onConfirmAll={vi.fn()}
        onClearAll={vi.fn()}
        isBulkPending={false}
        guestName=""
        onGuestNameChange={vi.fn()}
        onAddGuest={vi.fn()}
        isAddingGuest={false}
        {...props}
      />
    </AppThemeProvider>,
  );
  return { ...utils, onToggle };
}

function visibleNames(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("PresencePanel", () => {
  describe("busca", () => {
    it("filtra pelo nome digitado", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/buscar jogador/i), "carlos");

      expect(visibleNames()).toHaveLength(1);
      expect(visibleNames()[0]).toContain("Carlos");
    });

    it("ignora acento — é o que a pessoa digita com pressa", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/buscar jogador/i), "joao");

      expect(visibleNames()[0]).toContain("João Busquets");
    });

    it("acha por apelido", async () => {
      renderPanel({
        roster: [
          ...bigRoster(),
          entry(10, "Wesley Pereira", { player: { ...entry(10, "Wesley Pereira").player, nickname: "Zico" } } as Partial<RosterEntry>),
        ],
      });
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/buscar jogador/i), "zico");

      expect(visibleNames()[0]).toContain("Wesley Pereira");
    });

    it("oferece saída quando a busca não acha ninguém", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/buscar jogador/i), "xyz");

      expect(screen.getByText(/nenhum jogador com esse filtro/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /limpar busca e filtro/i }));
      expect(visibleNames()).toHaveLength(9);
    });
  });

  describe("filtro por situação", () => {
    it("mostra a contagem de cada grupo", () => {
      renderPanel();

      expect(screen.getByRole("button", { name: /todos \(9\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /confirmados \(3\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /pendentes \(4\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /espera \(2\)/i })).toBeInTheDocument();
    });

    it("filtra por confirmados", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /confirmados/i }));

      expect(visibleNames()).toHaveLength(3);
    });

    it("filtra por quem está na espera", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /espera/i }));

      expect(visibleNames()).toHaveLength(2);
    });

    it("não oferece o grupo de espera quando não há ninguém esperando", () => {
      renderPanel({
        roster: bigRoster().map((item) => ({ ...item, waitlist_position: null })),
      });

      expect(screen.queryByRole("button", { name: /espera/i })).not.toBeInTheDocument();
    });
  });

  describe("ordem estável", () => {
    it("a linha não salta quando a presença muda", async () => {
      // Era o problema: a lista se reordenava a cada toque (confirmados sobem),
      // e a linha recém-tocada saía de baixo do dedo — o toque seguinte caía em
      // outra pessoa.
      const { rerender, onToggle } = renderPanel();
      const antes = visibleNames();

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/confirmar presença de Bruno/i));
      expect(onToggle).toHaveBeenCalledWith(4, true);

      // O servidor devolve a lista reordenada (Bruno subiu para o topo).
      const reordenado = [
        { ...bigRoster()[3], confirmation_status: "confirmed" as const },
        ...bigRoster().filter((item) => item.player.id !== 4),
      ];
      rerender(
        <AppThemeProvider>
          <PresencePanel
            roster={reordenado}
            isLoading={false}
            confirmedCount={4}
            canManage
            pendingPlayers={new Set()}
            onToggle={onToggle}
            onConfirmAll={vi.fn()}
            onClearAll={vi.fn()}
            isBulkPending={false}
            guestName=""
            onGuestNameChange={vi.fn()}
            onAddGuest={vi.fn()}
            isAddingGuest={false}
          />
        </AppThemeProvider>,
      );

      // A ordem na tela **não** mudou, apesar de o servidor ter reordenado.
      expect(visibleNames().map((n) => n.split("Mensalista")[0])).toEqual(
        antes.map((n) => n.split("Mensalista")[0]),
      );
    });
  });

  describe("listas pequenas", () => {
    it("não mostra busca nem filtro — seriam só ruído", () => {
      renderPanel({ roster: bigRoster().slice(0, 5) });

      expect(screen.queryByLabelText(/buscar jogador/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /pendentes/i })).not.toBeInTheDocument();
    });
  });

  describe("permissões", () => {
    it("o visualizador vê a situação mas não o interruptor", () => {
      renderPanel({ canManage: false });

      expect(screen.queryByLabelText(/confirmar presença de/i)).not.toBeInTheDocument();
      expect(screen.getAllByText(/confirmado/i).length).toBeGreaterThan(0);
      // E não recebe o campo de adicionar jogador.
      expect(screen.queryByLabelText(/adicionar jogador pelo nome/i)).not.toBeInTheDocument();
    });
  });
});
