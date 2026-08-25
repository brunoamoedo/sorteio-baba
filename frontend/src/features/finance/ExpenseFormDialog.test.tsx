/**
 * Lançamento de despesa.
 *
 * A regra que estes testes travam é a mesma do lado da receita: **competência
 * não é a data do pagamento**. A quadra de abril paga em maio é despesa de
 * abril, e o formulário precisa deixar os dois campos independentes.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseFormDialog } from "./ExpenseFormDialog";
import { currentReference, formatReference } from "./financeShared";

const onSubmit = vi.fn().mockResolvedValue(undefined);

function renderDialog() {
  return render(
    <ExpenseFormDialog
      open
      onClose={() => {}}
      isSubmitting={false}
      error={null}
      onSubmit={onSubmit}
    />,
  );
}

beforeEach(() => {
  onSubmit.mockClear();
});

describe("lançar despesa", () => {
  it("começa como custo extra na competência corrente", () => {
    renderDialog();

    expect(screen.getByLabelText("Tipo")).toHaveTextContent("Custo extra");
    expect(screen.getByLabelText("Competência")).toHaveTextContent(
      formatReference(currentReference()),
    );
  });

  it("exige descrição e valor maior que zero", async () => {
    const user = userEvent.setup();
    renderDialog();
    const enviar = screen.getByRole("button", { name: "Lançar despesa" });

    expect(enviar).toBeDisabled();

    await user.type(screen.getByLabelText("Descrição"), "Bola nova");
    expect(enviar).toBeDisabled();

    await user.type(screen.getByLabelText("Valor (R$)"), "0");
    expect(enviar).toBeDisabled();
  });

  it("envia competência e data de pagamento como campos independentes", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Descrição"), "Aluguel da quadra");
    await user.type(screen.getByLabelText("Valor (R$)"), "400");
    // Competência de abril...
    await user.click(screen.getByLabelText("Competência"));
    await user.click(await screen.findByRole("option", { name: "Abr/2026" }));
    // ...paga em maio. O rótulo virou "Pago em" quando o vencimento entrou
    // como campo próprio — a data de pagamento e a de vencimento são coisas
    // diferentes e precisavam de nomes diferentes.
    const data = screen.getByLabelText("Pago em");
    await user.clear(data);
    await user.type(data, "2026-05-15");

    await user.click(screen.getByRole("button", { name: "Lançar despesa" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Aluguel da quadra",
          amount: "400",
          reference: "2026-04",
          incurred_on: "2026-05-15",
          kind: "extra",
        }),
      ),
    );
  });

  it("permite marcar a despesa como custo fixo mensal", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Descrição"), "Arbitragem");
    await user.type(screen.getByLabelText("Valor (R$)"), "120");
    await user.click(screen.getByLabelText("Tipo"));
    await user.click(await screen.findByRole("option", { name: "Custo fixo mensal" }));
    await user.click(screen.getByRole("button", { name: "Lançar despesa" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "fixed" })),
    );
  });
});

describe("vencimento", () => {
  it("é opcional — sem ele, o payload não manda a data", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Descrição"), "Bola nova");
    await user.type(screen.getByLabelText("Valor (R$)"), "150");
    await user.click(screen.getByRole("button", { name: "Lançar despesa" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ due_date: undefined }),
      ),
    );
  });

  it("é enviado quando informado, separado de 'Pago em'", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Descrição"), "Aluguel");
    await user.type(screen.getByLabelText("Valor (R$)"), "300");
    const vencimento = screen.getByLabelText("Vencimento");
    await user.clear(vencimento);
    await user.type(vencimento, "2026-08-10");
    const pago = screen.getByLabelText("Pago em");
    await user.clear(pago);
    await user.type(pago, "2026-08-14");

    await user.click(screen.getByRole("button", { name: "Lançar despesa" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ due_date: "2026-08-10", incurred_on: "2026-08-14" }),
      ),
    );
  });
});
