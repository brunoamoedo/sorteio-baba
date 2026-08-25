/**
 * Alteração do valor da mensalidade.
 *
 * O que estes testes travam é a **confirmação explícita**: antes de qualquer
 * alteração acontecer, a tela precisa dizer quantos mensalistas serão afetados,
 * de qual valor para qual, a partir de qual competência, e que as competências
 * anteriores não serão tocadas.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryStore } from "../../core/data";
import type { MemberFee, ResyncRow } from "../../core/types/finance";
import { ChangeFeeDialog } from "./ChangeFeeDialog";
import { currentReference, formatReference } from "./financeShared";

/** A competência sugerida é a **corrente**, não a seguinte: com "mês que vem"
 * o organizador alterava o valor e não via nada mudar na aba de mensalidades.
 * Calcular aqui evita um teste que quebra na virada do mês. */
const SUGERIDA = currentReference();

vi.mock("../../api/financeApi", () => ({
  financeApi: { bulkPreview: vi.fn(), resyncPreview: vi.fn() },
}));

const { financeApi } = await import("../../api/financeApi");

function member(id: number, name: string, amount: string | null = "100.00"): MemberFee {
  return {
    player_id: id,
    player_name: name,
    player_nickname: "",
    current_amount: amount,
    from_plan: true,
    effective_from: null,
    current_reference: "2026-05",
    current_charge_status: null,
    current_charge_id: null,
  };
}

/** Prévia da ressincronização: `eligible_count` é quantas mensalidades daquela
 * competência estão em aberto e ao alcance do novo valor. */
function resyncPreview(elegiveis: number, puladas: ResyncRow[] = []) {
  return {
    reference: SUGERIDA,
    to_update: [],
    skipped: puladas,
    to_update_count: 0,
    skipped_count: puladas.length,
    eligible_count: elegiveis,
    current_amounts: [],
  };
}

const onSubmit = vi.fn().mockResolvedValue(undefined);

function renderDialog(targets: MemberFee[] | null) {
  return render(
    <ChangeFeeDialog
      open
      targets={targets}
      onClose={() => {}}
      isSubmitting={false}
      error={null}
      onSubmit={onSubmit}
    />,
  );
}

beforeEach(() => {
  queryStore.clear();
  vi.mocked(financeApi.bulkPreview).mockResolvedValue({
    players_count: 87,
    effective_from: SUGERIDA,
    current_amounts: ["100.00"],
    already_charged: 0,
  });
  vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(0));
});

describe("alteração individual", () => {
  it("parte do valor atual do mensalista", () => {
    renderDialog([member(1, "João", "100.00")]);

    expect(screen.getByText(/Valor atual: R\$\s100,00/)).toBeInTheDocument();
    expect(screen.getByLabelText("Novo valor (R$)")).toHaveValue(100);
  });

  it("exige confirmação antes de enviar", async () => {
    const user = userEvent.setup();
    renderDialog([member(1, "João")]);

    const valor = screen.getByLabelText("Novo valor (R$)");
    await user.clear(valor);
    await user.type(valor, "120");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const confirmacao = screen.getByTestId("fee-change-confirmation");
    expect(confirmacao).toHaveTextContent("João");
    expect(confirmacao).toHaveTextContent(/R\$\s120,00/);
    expect(confirmacao).toHaveTextContent("As competências anteriores não serão alteradas.");
    // Nada foi enviado ainda.
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirmar alteração" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "120", playerIds: [1] }),
      ),
    );
  });

  it("não deixa continuar com valor vazio ou zero", async () => {
    const user = userEvent.setup();
    renderDialog([member(1, "João", null)]);

    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    await user.type(screen.getByLabelText("Novo valor (R$)"), "0");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });
});

describe("alteração em massa", () => {
  it("mostra quantos mensalistas serão afetados, vindo do servidor", async () => {
    renderDialog(null); // null = todos

    expect(await screen.findByText("Quantidade selecionada: 87 mensalistas")).toBeInTheDocument();
    expect(financeApi.bulkPreview).toHaveBeenCalledWith(SUGERIDA, undefined);
  });

  it("resume valor anterior, novo valor e competência antes de confirmar", async () => {
    const user = userEvent.setup();
    renderDialog(null);
    await screen.findByText("Quantidade selecionada: 87 mensalistas");

    await user.type(screen.getByLabelText("Novo valor (R$)"), "120");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const confirmacao = screen.getByTestId("fee-change-confirmation");
    expect(confirmacao).toHaveTextContent("87 mensalistas");
    expect(confirmacao).toHaveTextContent(/R\$\s100,00/);
    expect(confirmacao).toHaveTextContent(/R\$\s120,00/);
    expect(confirmacao).toHaveTextContent(formatReference(SUGERIDA));
  });

  it("avisa que as competências já lançadas não mudam", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(5));
    const user = userEvent.setup();
    renderDialog(null);
    await screen.findByText("Quantidade selecionada: 87 mensalistas");

    await user.type(screen.getByLabelText("Novo valor (R$)"), "120");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByTestId("fee-change-confirmation")).toHaveTextContent(
      `5 mensalidade(s) de ${formatReference(SUGERIDA)} já foram lançadas`,
    );
  });

  it("envia a seleção quando o alvo é um subconjunto", async () => {
    const user = userEvent.setup();
    renderDialog([member(1, "João"), member(2, "Pedro")]);

    await user.type(screen.getByLabelText("Novo valor (R$)"), "150");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar alteração" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ playerIds: [1, 2] })),
    );
  });

  it("sugere a competência corrente, não a seguinte", async () => {
    renderDialog(null);
    await screen.findByText("Quantidade selecionada: 87 mensalistas");

    expect(screen.getByLabelText("Aplicar a partir da competência")).toHaveTextContent(
      formatReference(currentReference()),
    );
  });

  it("voltar da confirmação não altera nada", async () => {
    const user = userEvent.setup();
    renderDialog(null);
    await screen.findByText("Quantidade selecionada: 87 mensalistas");

    await user.type(screen.getByLabelText("Novo valor (R$)"), "120");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.queryByTestId("fee-change-confirmation")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/**
 * A caixa de ressincronização.
 *
 * Alterar o valor nunca foi retroativo, e continua não sendo — o que mudou é
 * que agora existe um caminho **explícito** para aplicar o valor novo às
 * mensalidades que ninguém pagou ainda. O que estes testes travam é justamente
 * o "explícito": a caixa nasce desmarcada, e o que ela promete tem de bater com
 * o que o servidor diz que está ao alcance.
 */
describe("aplicar às mensalidades em aberto", () => {
  const CAIXA = /Aplicar também às/;

  it("não aparece quando não há mensalidade em aberto", async () => {
    renderDialog([member(1, "João")]);
    await waitFor(() => expect(financeApi.resyncPreview).toHaveBeenCalled());

    expect(screen.queryByRole("checkbox", { name: CAIXA })).not.toBeInTheDocument();
  });

  it("aparece desmarcada quando há mensalidades em aberto", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(19));
    renderDialog([member(1, "João")]);

    const caixa = await screen.findByRole("checkbox", { name: CAIXA });
    expect(caixa).not.toBeChecked();
    expect(screen.getByText(/19/)).toBeInTheDocument();
  });

  it("marcada, o resumo passa a dizer que elas serão atualizadas", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(19));
    const user = userEvent.setup();
    renderDialog([member(1, "João")]);

    await user.click(await screen.findByRole("checkbox", { name: CAIXA }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const confirmacao = screen.getByTestId("fee-change-confirmation");
    expect(confirmacao).toHaveTextContent("19 mensalidade(s) em aberto");
    expect(confirmacao).toHaveTextContent("também serão atualizadas");
  });

  it("marcada, avisa o que fica de fora e por quê", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(
      resyncPreview(19, [
        { charge_id: 1, player_id: 1, player_name: "Ana", current_amount: "45.00", reason: "já paga" },
        { charge_id: 2, player_id: 2, player_name: "Bia", current_amount: "45.00", reason: "já paga" },
        { charge_id: 3, player_id: 3, player_name: "Caio", current_amount: "45.00", reason: "cancelada" },
      ]),
    );
    const user = userEvent.setup();
    renderDialog(null);

    await user.click(await screen.findByRole("checkbox", { name: CAIXA }));
    await user.type(screen.getByLabelText("Novo valor (R$)"), "90");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // Agrupado por motivo: numa pelada de 30 mensalistas, listar nome por nome
    // viraria um parágrafo.
    expect(screen.getByTestId("fee-change-confirmation")).toHaveTextContent(
      "2 já paga · 1 cancelada",
    );
  });

  it("envia a decisão junto da alteração", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(19));
    const user = userEvent.setup();
    renderDialog([member(1, "João")]);

    await user.click(await screen.findByRole("checkbox", { name: CAIXA }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar alteração" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ resync: true })),
    );
  });

  it("sem marcar, envia resync falso", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(19));
    const user = userEvent.setup();
    renderDialog([member(1, "João")]);
    await screen.findByRole("checkbox", { name: CAIXA });

    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar alteração" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ resync: false })),
    );
  });

  it("reabrir o diálogo volta com a caixa desmarcada", async () => {
    vi.mocked(financeApi.resyncPreview).mockResolvedValue(resyncPreview(19));
    const user = userEvent.setup();
    const { rerender } = renderDialog([member(1, "João")]);

    await user.click(await screen.findByRole("checkbox", { name: CAIXA }));

    rerender(
      <ChangeFeeDialog
        open={false}
        targets={[member(1, "João")]}
        onClose={() => {}}
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );
    rerender(
      <ChangeFeeDialog
        open
        targets={[member(1, "João")]}
        onClose={() => {}}
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );

    expect(await screen.findByRole("checkbox", { name: CAIXA })).not.toBeChecked();
  });
});
