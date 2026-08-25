import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayersPrintSheet } from "./PlayersPrintSheet";
import type { Player, Position } from "../../core/types/player";

const POSICOES = [
  { id: 1, code: "GOL", name: "Goleiro" },
  { id: 3, code: "ME", name: "Meio-Campo" },
  { id: 4, code: "AT", name: "Atacante" },
] as unknown as Position[];

function jogador(over: Partial<Player> = {}): Player {
  return {
    id: 1,
    name: "Tassio",
    nickname: "Elsha",
    phone: "(77) 98102-4129",
    skill_level: 5,
    primary_position: 3,
    secondary_position: 4,
    player_type: "mensalista",
    status: "ativo",
    ...over,
  } as unknown as Player;
}

describe("PlayersPrintSheet", () => {
  it("mostra o nível como estrelas cheias e vazias, em cores separadas", () => {
    // As cheias e as vazias são elementos distintos para poderem ter cor
    // própria no PDF. Continua sendo texto, e não ícone: é copiável do arquivo
    // e a contagem sobrevive a uma impressão monocromática.
    render(
      <PlayersPrintSheet players={[jogador({ skill_level: 3 })]} positions={POSICOES} filters={{}} />,
    );
    expect(screen.getByText("★★★")).toBeInTheDocument();
    expect(screen.getByText("☆☆")).toBeInTheDocument();
  });

  it("nível 5 não deixa estrela vazia sobrando", () => {
    render(
      <PlayersPrintSheet players={[jogador({ skill_level: 5 })]} positions={POSICOES} filters={{}} />,
    );
    expect(screen.getByText("★★★★★")).toBeInTheDocument();
    expect(screen.queryByText("☆")).not.toBeInTheDocument();
  });

  it("traz nome, apelido, posições, telefone e situação", () => {
    render(<PlayersPrintSheet players={[jogador()]} positions={POSICOES} filters={{}} />);
    const linha = screen.getByText(/Tassio/).closest("tr")!;
    expect(within(linha).getByText("(Elsha)")).toBeInTheDocument();
    expect(within(linha).getByText("ME / AT")).toBeInTheDocument();
    expect(within(linha).getByText("(77) 98102-4129")).toBeInTheDocument();
    expect(within(linha).getByText("Ativo")).toBeInTheDocument();
  });

  it("marca quem não tem telefone em vez de deixar a célula vazia", () => {
    render(<PlayersPrintSheet players={[jogador({ phone: "" })]} positions={POSICOES} filters={{}} />);
    const linha = screen.getByText(/Tassio/).closest("tr")!;
    expect(within(linha).getByText("—")).toBeInTheDocument();
  });

  it("declara os filtros ativos na folha", () => {
    // A regra que importa: um PDF de "só os mensalistas ativos" não pode ser
    // indistinguível de um PDF do elenco inteiro. Quem recebe contaria os nomes
    // e concluiria que a pelada tem só aqueles jogadores.
    render(
      <PlayersPrintSheet
        players={[jogador()]}
        positions={POSICOES}
        filters={{ status: "ativo", player_type: "mensalista", search: "tas" }}
      />,
    );
    expect(screen.getByText(/somente ativos/)).toBeInTheDocument();
    expect(screen.getByText(/somente mensalistas/)).toBeInTheDocument();
    expect(screen.getByText(/busca "tas"/)).toBeInTheDocument();
  });

  it("diz que é o cadastro inteiro quando não há filtro", () => {
    render(<PlayersPrintSheet players={[jogador()]} positions={POSICOES} filters={{}} />);
    expect(screen.getByText(/todos os jogadores do cadastro/)).toBeInTheDocument();
  });

  it("conta os jogadores no cabeçalho, com singular e plural", () => {
    const { unmount } = render(
      <PlayersPrintSheet players={[jogador()]} positions={POSICOES} filters={{}} />,
    );
    expect(screen.getByText(/1 jogador ·/)).toBeInTheDocument();
    unmount();

    render(
      <PlayersPrintSheet
        players={[jogador(), jogador({ id: 2, name: "Barba", nickname: "" })]}
        positions={POSICOES}
        filters={{}}
      />,
    );
    expect(screen.getByText(/2 jogadores ·/)).toBeInTheDocument();
  });
});
