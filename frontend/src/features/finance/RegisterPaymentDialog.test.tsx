/**
 * Baixa de mensalidade, com e sem multa.
 *
 * O que estes testes travam é a **separação**: a tela nunca mostra um total sem
 * dizer de onde ele veio. "R$ 110,00" sozinho é o tipo de cobrança que vira
 * discussão no grupo; "R$ 100,00 + R$ 10,00 de multa" não.
 *
 * E travam a regra da data: quem decide se a multa incide é a **data do
 * pagamento**, não a de hoje. Lançar hoje uma baixa de quem pagou em dia não
 * pode sugerir o valor com multa.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RegisterPaymentDialog } from "./RegisterPaymentDialog";
import type { Charge } from "../../core/types/finance";

const VENCIMENTO = "2026-08-08";

function charge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: 1,
    player: 1,
    player_name: "Ana",
    player_nickname: "",
    plan: null,
    reference: "2026-08",
    amount: "100.00",
    late_fee_amount: "10.00",
    late_fee_due: "10.00",
    total_due: "110.00",
    due_date: VENCIMENTO,
    status: "pending",
    effective_status: "overdue",
    paid_amount: "0.00",
    outstanding: "110.00",
    notes: "",
    payments: [],
    created_at: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

function renderDialog(dados: Charge) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <RegisterPaymentDialog charge={dados} onClose={() => {}} isSubmitting={false} onSubmit={onSubmit} />,
  );
  return { onSubmit };
}

async function informarData(data: string) {
  const user = userEvent.setup();
  const campo = screen.getByLabelText("Data do pagamento");
  await user.clear(campo);
  await user.type(campo, data);
}

describe("multa na baixa", () => {
  it("não aparece quando a organização não cobra multa", () => {
    renderDialog(
      charge({ late_fee_amount: "0.00", late_fee_due: "0.00", total_due: "100.00", outstanding: "100.00" }),
    );

    expect(screen.queryByTestId("late-fee-warning")).not.toBeInTheDocument();
  });

  it("mostra valor e multa separados quando o pagamento é depois do vencimento", async () => {
    renderDialog(charge());

    await informarData("2026-08-15");

    const aviso = screen.getByTestId("late-fee-warning");
    expect(aviso).toHaveTextContent(/R\$\s100,00/);
    expect(aviso).toHaveTextContent(/R\$\s10,00 de multa/);
    expect(aviso).toHaveTextContent(/R\$\s110,00/);
  });

  it("sugere o total com a multa", async () => {
    renderDialog(charge());

    await informarData("2026-08-15");

    expect(screen.getByLabelText("Valor recebido (R$)")).toHaveValue(110);
  });

  /** O caso que motivou a regra: o dinheiro entrou em dia, o organizador só
   * foi lançar depois. A multa pune o atraso de quem pagou, não a demora de
   * quem registra. */
  it("pagamento em dia lançado com atraso não cobra multa", async () => {
    renderDialog(charge());

    await informarData(VENCIMENTO);

    expect(screen.queryByTestId("late-fee-warning")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Valor recebido (R$)")).toHaveValue(100);
  });

  it("no dia do vencimento ainda não incide", async () => {
    renderDialog(charge());

    await informarData("2026-08-08");

    expect(screen.queryByTestId("late-fee-warning")).not.toBeInTheDocument();
  });

  it("um dia depois já incide", async () => {
    renderDialog(charge());

    await informarData("2026-08-09");

    expect(screen.getByTestId("late-fee-warning")).toBeInTheDocument();
  });

  it("corrigir a data para trás derruba a multa junto", async () => {
    renderDialog(charge());
    await informarData("2026-08-20");
    expect(screen.getByLabelText("Valor recebido (R$)")).toHaveValue(110);

    await informarData("2026-08-05");

    expect(screen.getByLabelText("Valor recebido (R$)")).toHaveValue(100);
    expect(screen.queryByTestId("late-fee-warning")).not.toBeInTheDocument();
  });

  it("desconta o que já foi recebido", async () => {
    renderDialog(charge({ paid_amount: "60.00", outstanding: "50.00" }));

    await informarData("2026-08-15");

    // 100 + 10 de multa − 60 já pagos = 50.
    expect(screen.getByLabelText("Valor recebido (R$)")).toHaveValue(50);
  });

  it("envia a data escolhida, não a de hoje", async () => {
    const { onSubmit } = renderDialog(charge());
    const user = userEvent.setup();

    await informarData("2026-08-15");
    await user.click(screen.getByRole("button", { name: "Registrar baixa" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ paid_at: "2026-08-15", amount: "110.00" }),
    );
  });
});
