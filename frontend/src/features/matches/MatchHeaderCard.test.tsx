import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchHeaderCard } from "./MatchHeaderCard";
import { AppThemeProvider } from "../../shared/theme/ColorModeContext";

import type { Match, MatchCapacity } from "../../core/types/match";

const CAPACITY: MatchCapacity = {
  teams_count: 3,
  min_players: 18,
  max_players: 18,
  goalkeepers_per_team: 0,
  line_players_per_team: 6,
  total_goalkeepers: 0,
  total_line_players: 18,
};

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 25,
    recurring_game: 1,
    recurring_game_name: "Pelada de Terça",
    name: "",
    location: "Quadra do Centro",
    notes: "",
    scheduled_date: "2026-08-11",
    scheduled_time: "21:30",
    draw_time: null,
    automatic_draw: false,
    automatic_draw_source: null,
    automatic_draw_at: null,
    effective_draw_time: null,
    automatic_draw_blocked_reason: null,
    teams_count: 3,
    goalkeepers_per_team: 0,
    min_players: 18,
    max_players: 18,
    capacity: CAPACITY,
    recurring_game_divergences: [],
    status: "scheduled",
    draw_executed_at: null,
    confirmed_count: 12,
    waitlist_count: 0,
    created_at: "2026-08-01T12:00:00Z",
    ...overrides,
  } as Match;
}

function renderCard(props: Partial<Parameters<typeof MatchHeaderCard>[0]> = {}) {
  return render(
    <AppThemeProvider>
      <MatchHeaderCard
        match={makeMatch()}
        capacity={CAPACITY}
        confirmedCount={12}
        waitlistCount={0}
        canManage
        automaticDrawDone={false}
        hasDraw={false}
        onOpenNamesList={vi.fn()}
        onOpenResults={vi.fn()}
        {...props}
      />
    </AppThemeProvider>,
  );
}

describe("MatchHeaderCard", () => {
  describe("o essencial fica visível sem expandir", () => {
    it("mostra data, horário e local", () => {
      renderCard();

      expect(screen.getByText("11/08/2026")).toBeInTheDocument();
      expect(screen.getByText("21:30")).toBeInTheDocument();
      expect(screen.getByText("Quadra do Centro")).toBeInTheDocument();
    });

    it("mostra a ocupação como métrica, não enterrada em texto", () => {
      renderCard();

      expect(screen.getByText("12 de 18 confirmados")).toBeInTheDocument();
      expect(screen.getByLabelText("12 de 18 vagas preenchidas")).toBeInTheDocument();
    });

    it("diz quanto falta para liberar o sorteio", () => {
      renderCard();
      expect(screen.getByText(/faltam 6 para o sorteio/i)).toBeInTheDocument();
    });

    it("não diz o que falta quando o mínimo já foi atingido", () => {
      renderCard({ confirmedCount: 18 });
      expect(screen.queryByText(/faltam/i)).not.toBeInTheDocument();
    });

    it("mostra a fila de espera quando existe", () => {
      renderCard({ waitlistCount: 3 });
      expect(screen.getByText("3 na espera")).toBeInTheDocument();
    });
  });

  describe("o que nunca pode ser escondido", () => {
    it("o motivo de o sorteio automático estar travado", () => {
      // Era o problema original: a partida ficava parada depois do horário e
      // nada na tela dizia o porquê. Não pode voltar para trás de um "ver
      // detalhes".
      renderCard({
        match: makeMatch({
          automatic_draw: true,
          automatic_draw_blocked_reason: "Faltam 3 confirmados para o mínimo de 18.",
        }),
      });

      expect(screen.getByText(/faltam 3 confirmados para o mínimo/i)).toBeInTheDocument();
    });

    it("a divergência com o jogo recorrente", () => {
      renderCard({
        match: makeMatch({
          recurring_game_divergences: [
            {
              field: "teams_count",
              label: "Quantidade de times",
              match_value: "2",
              recurring_game_value: "3",
            },
          ],
        }),
      });

      expect(screen.getByText(/quantidade de times/i)).toBeInTheDocument();
    });

    it("o aviso de partida cheia", () => {
      // O texto encolheu (o `Alert` de 133px virou uma linha de 35px), mas a
      // informação que importa — ninguém é descartado — continua na tela.
      renderCard({ confirmedCount: 18 });
      expect(screen.getByText(/partida cheia/i)).toBeInTheDocument();
      expect(screen.getByText(/ninguém é descartado/i)).toBeInTheDocument();
    });
  });

  describe("detalhes sob demanda", () => {
    it("a configuração só aparece ao expandir", async () => {
      renderCard();
      const user = userEvent.setup();

      expect(screen.queryByText(/3 times ×/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /ver detalhes/i }));

      expect(screen.getByText(/3 times ×/)).toBeInTheDocument();
      expect(screen.getByText(/goleiro não entra no sorteio/)).toBeInTheDocument();
    });

    it("as observações da partida só aparecem ao expandir", async () => {
      renderCard({ match: makeMatch({ notes: "Levar coletes" }) });
      const user = userEvent.setup();

      expect(screen.queryByText("Levar coletes")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /ver detalhes/i }));
      expect(screen.getByText("Levar coletes")).toBeInTheDocument();
    });

    it("o horário do sorteio automático fica nos detalhes quando não há bloqueio", async () => {
      renderCard({
        match: makeMatch({
          automatic_draw: true,
          effective_draw_time: "21:00",
          automatic_draw_source: "recurring_game",
        }),
      });
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /ver detalhes/i }));

      expect(screen.getByText(/sorteio automático às 21:00/i)).toBeInTheDocument();
      expect(screen.getByText(/pelada de terça/i)).toBeInTheDocument();
    });
  });

  describe("permissões", () => {
    it("o visualizador não recebe as ações de gestão", () => {
      renderCard({ canManage: false });

      expect(screen.queryByRole("button", { name: /lista de nomes/i })).not.toBeInTheDocument();
    });

    it('"Lançar placar" só aparece depois do sorteio', () => {
      const { rerender } = renderCard({ hasDraw: false });
      expect(screen.queryByRole("button", { name: /lançar placar/i })).not.toBeInTheDocument();

      rerender(
        <AppThemeProvider>
          <MatchHeaderCard
            match={makeMatch()}
            capacity={CAPACITY}
            confirmedCount={18}
            waitlistCount={0}
            canManage
            automaticDrawDone={false}
            hasDraw
            onOpenNamesList={vi.fn()}
            onOpenResults={vi.fn()}
          />
        </AppThemeProvider>,
      );
      expect(screen.getByRole("button", { name: /lançar placar/i })).toBeInTheDocument();
    });
  });
});
