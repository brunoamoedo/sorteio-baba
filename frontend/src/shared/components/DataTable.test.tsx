import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type DataTableColumn } from "./DataTable";
import { AppThemeProvider } from "../theme/ColorModeContext";
import { setViewport } from "../../test/setup";

interface Row {
  id: number;
  nome: string;
  nivel: number;
}

const ROWS: Row[] = [
  { id: 1, nome: "Bruno", nivel: 4 },
  { id: 2, nome: "Ana", nivel: 2 },
  { id: 3, nome: "Carlos", nivel: 5 },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "nome", label: "Jogador", render: (row) => row.nome, sortValue: (row) => row.nome },
  { key: "nivel", label: "Nível", render: (row) => `${row.nivel}★`, sortValue: (row) => row.nivel },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <AppThemeProvider>
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(row) => row.id}
        {...props}
      />
    </AppThemeProvider>,
  );
}

describe("DataTable", () => {
  describe("desktop", () => {
    it("desenha uma tabela de verdade", () => {
      renderTable();

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /jogador/i })).toBeInTheDocument();
      expect(screen.getByText("Bruno")).toBeInTheDocument();
    });

    it("mantém a tabela mesmo quando `renderCard` é informado", () => {
      // A prop é opcional e só vale abaixo de `md`: informá-la não pode mudar
      // o desenho no desktop.
      renderTable({ renderCard: (row) => <div data-testid="card">{row.nome}</div> });

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.queryByTestId("card")).not.toBeInTheDocument();
    });

    it("ordena ao clicar no cabeçalho", async () => {
      const user = userEvent.setup();
      renderTable({ defaultSortKey: undefined });

      await user.click(screen.getByRole("button", { name: /jogador/i }));

      const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
      // Primeira ordenação é descendente (padrão do componente).
      expect(cells[0]).toBe("Carlos");
    });

    it("aciona a linha por teclado, não só por clique", async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      renderTable({ onRowClick });

      const rows = screen.getAllByRole("button").filter((el) => el.tagName === "TR");
      expect(rows.length).toBe(3);

      rows[0].focus();
      await user.keyboard("{Enter}");

      expect(onRowClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("celular", () => {
    it("troca a tabela por cards quando `renderCard` existe", () => {
      setViewport("mobile");
      renderTable({ renderCard: (row) => <div data-testid="card">{row.nome}</div> });

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("card")).toHaveLength(3);
    });

    it("sem `renderCard`, continua sendo tabela (nenhuma tela muda por acidente)", () => {
      setViewport("mobile");
      renderTable();

      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    it("oferece ordenação por seletor, já que não há cabeçalho para clicar", async () => {
      setViewport("mobile");
      renderTable({ renderCard: (row) => <div data-testid="card">{row.nome}</div> });

      const seletor = screen.getByRole("combobox", { name: /ordenar por/i });
      expect(seletor).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(seletor);
      const opcoes = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(opcoes.map((o) => o.textContent)).toEqual(["Padrão", "Jogador", "Nível"]);
    });

    it("preserva a seleção em massa no modo card", async () => {
      setViewport("mobile");
      const onChange = vi.fn();
      renderTable({
        renderCard: (row) => <div data-testid="card">{row.nome}</div>,
        selection: { selectedIds: new Set<string | number>(), onChange },
      });

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/selecionar linha 1/i));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect([...onChange.mock.calls[0][0]]).toEqual([1]);
    });

    it('"selecionar todos" marca todas as linhas do filtro, não só as visíveis', async () => {
      setViewport("mobile");
      const onChange = vi.fn();
      renderTable({
        renderCard: (row) => <div data-testid="card">{row.nome}</div>,
        selection: { selectedIds: new Set<string | number>(), onChange },
      });

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/selecionar todos os resultados/i));

      expect([...onChange.mock.calls[0][0]]).toEqual([1, 2, 3]);
    });
  });

  describe("estados", () => {
    it("mostra erro com opção de tentar de novo, distinguindo de lista vazia", async () => {
      const onRetry = vi.fn();
      renderTable({ rows: undefined, error: "Falhou a rede", onRetry });

      expect(screen.getByText("Falhou a rede")).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: /tentar novamente/i }));
      expect(onRetry).toHaveBeenCalled();
    });

    it("estado vazio traz título e ação", () => {
      renderTable({
        rows: [],
        emptyMessage: "Nenhum jogador",
        emptyAction: <button type="button">Cadastrar</button>,
      });

      expect(screen.getByText("Nenhum jogador")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cadastrar" })).toBeInTheDocument();
    });
  });
});
