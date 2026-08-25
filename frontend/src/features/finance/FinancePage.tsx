import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { AddIcon, RedrawIcon as AutorenewIcon, SettingsIcon } from "../../shared/icons";

import {
  financeApi,
  type CreateChargePayload,
  type CreateExpensePayload,
  type RegisterPaymentPayload,
} from "../../api/financeApi";
import { playersApi } from "../../api/playersApi";
import { formatMatchDate } from "../../core/dateTime";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import {
  CHARGE_STATUS_LABELS,
  EXPENSE_KIND_LABELS,
  type BulkResult,
  type Charge,
  type ChargeStatus,
  type Expense,
  type ExpenseKind,
  type FinancialCapability,
  type FinancialSummary,
  type MemberFee,
  type MembershipFeePlan,
  type Payment,
  type RecurringExpense,
} from "../../core/types/finance";
import type { Player } from "../../core/types/player";
import { AppLayout } from "../../shared/layout/AppLayout";
import { BulkActionBar } from "../../shared/components/BulkActionBar";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { useSelection } from "../../shared/hooks/useSelection";
import { FilterSheet, type ActiveFilterChip } from "../../shared/components/FilterSheet";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatTile } from "../../shared/components/StatTile";
import { StatusChip } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { matchKeys } from "../matches/matchQueries";
import { CancelSummary, CancelWithReasonDialog } from "./CancelWithReasonDialog";
import {
  BulkDueDateDialog,
  BulkPaymentDialog,
  BulkResultDialog,
  GenerateChargesDialog,
} from "./BulkActionDialogs";
import { ChargeCard } from "./ChargeCard";
import { ChangeFeeDialog } from "./ChangeFeeDialog";
import { ChargeFormDrawer } from "./ChargeFormDrawer";
import { ExpenseFormDialog } from "./ExpenseFormDialog";
import { FeePlanDrawer } from "./FeePlanDrawer";
import { FixedCostsDrawer } from "./FixedCostsDrawer";
import { MemberFinanceDrawer } from "./MemberFinanceDrawer";
import { RegisterPaymentDialog } from "./RegisterPaymentDialog";
import {
  currentReference,
  financeKeys,
  formatMoney,
  formatReference,
  referenceOptions,
} from "./financeShared";

const STATUS_TONE: Record<ChargeStatus, "success" | "warning" | "error" | "default"> = {
  paid: "success",
  pending: "warning",
  overdue: "error",
  canceled: "default",
};

interface ChargeFilterState {
  status: ChargeStatus | "";
  reference: string;
  player: string;
  dueAfter: string;
  dueBefore: string;
  amountMin: string;
  amountMax: string;
  paidAfter: string;
  paidBefore: string;
}

const EMPTY_FILTERS: ChargeFilterState = {
  status: "",
  reference: "",
  player: "",
  dueAfter: "",
  dueBefore: "",
  amountMin: "",
  amountMax: "",
  paidAfter: "",
  paidBefore: "",
};

export function FinancePage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<"charges" | "members" | "expenses">("charges");
  const [filters, setFilters] = useState<ChargeFilterState>(EMPTY_FILTERS);
  const [summaryReference, setSummaryReference] = useState(() => currentReference());
  const [formOpen, setFormOpen] = useState(false);
  const [chargeToPay, setChargeToPay] = useState<Charge | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [feeTargets, setFeeTargets] = useState<MemberFee[] | null | undefined>(undefined);
  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<number>>(new Set());
  // Seleção da aba Mensalidades — a das ações em massa (gerar, vencimento,
  // baixa). Separada da de Mensalistas de propósito: são listas diferentes,
  // e uma seleção compartilhada faria a ação de uma aba agir sobre a outra.
  const chargeSelection = useSelection<number>();
  const [openMember, setOpenMember] = useState<MemberFee | null>(null);
  const [paymentToCancel, setPaymentToCancel] = useState<{ payment: Payment; charge: Charge } | null>(
    null,
  );
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [fixedCostsOpen, setFixedCostsOpen] = useState(false);
  const [expenseToCancel, setExpenseToCancel] = useState<Expense | null>(null);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);
  const [expenseKindFilter, setExpenseKindFilter] = useState<ExpenseKind | "">("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<"generate" | "due-date" | "payment" | null>(null);
  const [bulkResult, setBulkResult] = useState<{ title: string; result: BulkResult } | null>(null);

  /** As permissões vêm do servidor: a tela não deduz o que pode fazer a partir
   * do papel, senão a regra passaria a existir em dois lugares. */
  const capabilitiesQuery = useApiQuery<FinancialCapability[]>(
    financeKeys.capabilities(),
    financeApi.capabilities,
  );
  const can = (capability: FinancialCapability) =>
    (capabilitiesQuery.data ?? []).includes(capability);
  /** Quem pode ao menos uma das ações em massa vê a seleção. Cada ação ainda
   * confere a sua própria capacidade. */
  const podeOperarEmMassa = can("financial.manage") || can("financial.register_payment");

  /**
   * Carregamento por aba.
   *
   * Eram **sete** consultas disparadas juntas ao abrir a tela — várias delas
   * lendo todas as páginas da API — para mostrar uma aba só. Agora o painel e
   * as permissões vêm no início (são o cabeçalho, sempre visível) e cada aba
   * busca o que ela precisa, quando é aberta. Os dados já buscados ficam em
   * cache: voltar para uma aba não refaz a consulta.
   */
  const summaryQuery = useApiQuery<FinancialSummary>(
    [...financeKeys.summary(), summaryReference],
    () => financeApi.summary(summaryReference || undefined),
  );
  const plansQuery = useApiQuery<MembershipFeePlan[]>(financeKeys.plans(), financeApi.listPlans);

  const chargesQuery = useApiQuery<Charge[]>(financeKeys.charges(), () => financeApi.listCharges(), {
    // A ficha do mensalista (aba "Mensalistas") também lê as cobranças.
    enabled: tab === "charges" || tab === "members",
  });
  const playersQuery = useApiQuery<Player[]>(matchKeys.players(), () => playersApi.list(), {
    enabled: tab === "charges" || formOpen,
  });
  const memberFeesQuery = useApiQuery<MemberFee[]>(
    financeKeys.memberFees(),
    () => financeApi.memberFees(),
    { enabled: tab === "members" || tab === "charges" },
  );
  const expensesQuery = useApiQuery<Expense[]>(
    financeKeys.expenses(),
    () => financeApi.listExpenses(),
    { enabled: tab === "expenses" },
  );
  const fixedCostsQuery = useApiQuery<RecurringExpense[]>(
    financeKeys.recurringExpenses(),
    financeApi.listRecurringExpenses,
    { enabled: tab === "expenses" },
  );
  // Um plano ativo por organização é o caso real; a lista existe para o dia em
  // que houver mais de um (mensalidade e taxa de arbitragem, por exemplo).
  const activePlan = (plansQuery.data ?? []).find((plan) => plan.is_active) ?? null;

  const invalidate = () => {
    queryStore.invalidate(["finance"]);
  };
  const failed = (fallback: string) => (error: unknown) =>
    showToast(getApiErrorMessage(error, fallback), "error");

  const createMutation = useApiMutation(
    (payload: CreateChargePayload) => financeApi.createCharge(payload),
    {
      onSuccess: () => {
        invalidate();
        setFormOpen(false);
        showToast("Mensalidade lançada.");
      },
    },
  );

  /** Ações em massa. Todas devolvem resultado parcial — processadas, puladas e
   * o motivo de cada pulada —, e o toast diz as três coisas: um "pronto"
   * genérico esconderia justamente o que precisa de atenção. */
  const resumo = (r: { processed_count: number; skipped_count: number }, verbo: string) =>
    r.skipped_count > 0
      ? `${r.processed_count} ${verbo} · ${r.skipped_count} não ${verbo === "criada(s)" ? "criada(s)" : "processada(s)"}.`
      : `${r.processed_count} ${verbo}.`;

  const bulkGenerateMutation = useApiMutation(
    (payload: { reference: string; player_ids?: number[] }) =>
      financeApi.generateChargesFor(payload),
    {
      onSuccess: (result) => {
        invalidate();
        chargeSelection.clear();
        setBulkResult({ title: "Mensalidades geradas", result });
        showToast(resumo(result, "criada(s)"));
      },
      onError: failed("Não foi possível gerar as mensalidades."),
    },
  );

  const bulkDueDateMutation = useApiMutation(
    (payload: { due_day: number; charge_ids: number[] }) => financeApi.bulkDueDate(payload),
    {
      onSuccess: (result) => {
        invalidate();
        chargeSelection.clear();
        setBulkResult({ title: "Vencimento alterado", result });
        showToast(resumo(result, "alterada(s)"));
      },
      onError: failed("Não foi possível alterar o vencimento."),
    },
  );

  const bulkPaymentMutation = useApiMutation(
    (payload: { charge_ids: number[]; paid_at: string; method: string; notes?: string }) =>
      financeApi.bulkRegisterPayment(payload),
    {
      onSuccess: (result) => {
        invalidate();
        chargeSelection.clear();
        setBulkResult({ title: "Baixa em massa", result });
        showToast(resumo(result, "baixa(s) registrada(s)"));
      },
      onError: failed("Não foi possível registrar as baixas."),
    },
  );

  /** Baixa individual — o caminho de sempre, para uma mensalidade só. */
  const paymentMutation = useApiMutation(
    ({ chargeId, ...payload }: RegisterPaymentPayload & { chargeId: number }) =>
      financeApi.registerPayment(chargeId, payload),
    {
      onSuccess: () => {
        invalidate();
        setChargeToPay(null);
        showToast("Baixa registrada.");
      },
      onError: failed("Não foi possível registrar a baixa."),
    },
  );

  const planMutation = useApiMutation(financeApi.savePlan, {
    onSuccess: () => {
      invalidate();
      setPlanOpen(false);
      showToast("Plano de mensalidade salvo.");
    },
    onError: failed("Não foi possível salvar o plano."),
  });

  const cancelPaymentMutation = useApiMutation(
    ({ paymentId, reason }: { paymentId: number; reason: string }) =>
      financeApi.cancelPayment(paymentId, reason),
    {
      onSuccess: () => {
        invalidate();
        setPaymentToCancel(null);
        showToast("Baixa cancelada — o pagamento continua no histórico.");
      },
      onError: failed("Não foi possível cancelar a baixa."),
    },
  );

  const feeMutation = useApiMutation(
    async ({
      amount,
      effectiveFrom,
      reason,
      playerIds,
      resync,
    }: {
      amount: string;
      effectiveFrom: string;
      reason: string;
      playerIds: number[] | null;
      resync: boolean;
    }) => {
      const alterado =
        playerIds !== null && playerIds.length === 1
          ? await financeApi
              .setMemberFee({
                player: playerIds[0],
                amount,
                effective_from: effectiveFrom,
                reason,
              })
              .then(() => ({ players_count: 1 }))
          : await financeApi.bulkSetMemberFee({
              players: playerIds ?? undefined,
              amount,
              effective_from: effectiveFrom,
              reason,
            });

      // A ressincronização vem **depois** e só se pedida: o valor precisa já
      // estar vigente para as cobranças em aberto receberem o novo número.
      // São duas operações no servidor, auditadas em separado — a tela junta,
      // o registro não.
      const ressincronizado = resync
        ? await financeApi.resyncCharges({
            reference: effectiveFrom,
            player_ids: playerIds ?? undefined,
            reason,
          })
        : null;

      return { ...alterado, ressincronizado };
    },
    {
      onSuccess: (result) => {
        invalidate();
        setFeeTargets(undefined);
        setSelectedMembers(new Set());

        const alteracao =
          result.players_count === 1
            ? "Mensalidade alterada"
            : `Mensalidade de ${result.players_count} mensalistas alterada`;

        if (!result.ressincronizado) {
          showToast(`${alteracao} — as competências anteriores não foram tocadas.`);
          return;
        }

        const { updated_count, skipped_count } = result.ressincronizado;
        const puladas = skipped_count > 0 ? ` · ${skipped_count} não alterada(s)` : "";
        showToast(`${alteracao} · ${updated_count} em aberto atualizada(s)${puladas}.`);
      },
      onError: failed("Não foi possível alterar a mensalidade."),
    },
  );

  const expenseMutation = useApiMutation(
    (payload: CreateExpensePayload) => financeApi.createExpense(payload),
    {
      onSuccess: () => {
        invalidate();
        setExpenseFormOpen(false);
        showToast("Despesa lançada.");
      },
      onError: failed("Não foi possível lançar a despesa."),
    },
  );

  const updateExpenseMutation = useApiMutation(
    ({ id, ...payload }: Partial<CreateExpensePayload> & { id: number }) =>
      financeApi.updateExpense(id, payload),
    {
      onSuccess: () => {
        invalidate();
        setExpenseToEdit(null);
        showToast("Despesa alterada.");
      },
      onError: failed("Não foi possível alterar a despesa."),
    },
  );

  const cancelExpenseMutation = useApiMutation(
    ({ expenseId, reason }: { expenseId: number; reason: string }) =>
      financeApi.cancelExpense(expenseId, reason),
    {
      onSuccess: () => {
        invalidate();
        setExpenseToCancel(null);
        showToast("Despesa cancelada — o lançamento continua no histórico.");
      },
      onError: failed("Não foi possível cancelar a despesa."),
    },
  );

  const fixedCostMutation = useApiMutation(financeApi.saveRecurringExpense, {
    onSuccess: () => {
      invalidate();
      showToast("Custo fixo salvo.");
    },
    onError: failed("Não foi possível salvar o custo fixo."),
  });

  const generateFixedMutation = useApiMutation(
    () => financeApi.generateFixedExpenses(summaryReference || undefined),
    {
      onSuccess: (result) => {
        invalidate();
        showToast(
          result.created > 0
            ? `✅ ${result.created} custo(s) fixo(s) lançado(s).`
            : "Nada a lançar — os custos fixos desta competência já existem.",
        );
      },
      onError: failed("Não foi possível gerar os custos fixos."),
    },
  );

  // Filtros aplicados na tela. "Atrasado" é derivado e não existe no banco, e
  // os demais campos vêm todos na lista — filtrar aqui evita uma ida ao
  // servidor a cada tecla e mantém as duas visões (aba e detalhe) coerentes.
  const charges = useMemo(() => {
    const dentro = (valor: string, min: string, max: string) =>
      (!min || Number(valor) >= Number(min)) && (!max || Number(valor) <= Number(max));
    const pagoNoPeriodo = (charge: Charge) => {
      if (!filters.paidAfter && !filters.paidBefore) return true;
      return charge.payments.some(
        (payment) =>
          payment.status === "registered" &&
          (!filters.paidAfter || payment.paid_at >= filters.paidAfter) &&
          (!filters.paidBefore || payment.paid_at <= filters.paidBefore),
      );
    };

    return (chargesQuery.data ?? []).filter(
      (charge) =>
        (!filters.status || charge.effective_status === filters.status) &&
        (!filters.reference || charge.reference === filters.reference) &&
        (!filters.player || String(charge.player) === filters.player) &&
        (!filters.dueAfter || charge.due_date >= filters.dueAfter) &&
        (!filters.dueBefore || charge.due_date <= filters.dueBefore) &&
        dentro(charge.amount, filters.amountMin, filters.amountMax) &&
        pagoNoPeriodo(charge),
    );
  }, [chargesQuery.data, filters]);

  const members = memberFeesQuery.data ?? [];
  const summary = summaryQuery.data;

  /** O painel também é da aba aberta.
   *
   * Com "Despesas" na tela, mostrar "Receita" e "Em aberto" é ruído: são
   * números da receita, não do que está sendo olhado. O **saldo** aparece nas
   * duas porque é o que fecha a conta — e é a informação mais importante da
   * tela quando está negativo. */
  const cards: {
    label: string;
    value: string | undefined;
    tone?: "default" | "success" | "warning" | "danger";
  }[] =
    tab === "expenses"
      ? [
          {
            label: "Custos fixos",
            value: summary && formatMoney(summary.expenses.fixed.amount),
          },
          {
            label: "Custos extras",
            value: summary && formatMoney(summary.expenses.extra.amount),
          },
          {
            label: `Despesas de ${formatReference(summaryReference)}`,
            value: summary && formatMoney(summary.expenses.total),
            tone: "warning",
          },
          {
            label: "Saldo",
            value: summary && formatMoney(summary.balance),
            tone: !!summary && Number(summary.balance) < 0 ? "danger" : "default",
          },
        ]
      : [
          {
            label: `Receita de ${formatReference(summaryReference)}`,
            value: summary && formatMoney(summary.total_received),
            tone: "success",
          },
          {
            label: "Em aberto",
            value: summary && formatMoney(summary.total_outstanding),
            tone: "warning",
          },
          { label: "Despesas", value: summary && formatMoney(summary.expenses.total) },
          // Saldo é caixa: o que entrou menos o que saiu. Pode ser negativo, e
          // nesse caso o número precisa gritar.
          {
            label: "Saldo",
            value: summary && formatMoney(summary.balance),
            tone: !!summary && Number(summary.balance) < 0 ? "danger" : "default",
          },
        ];

  /** Chips do que está filtrado agora. Os nove campos moram no painel; aqui só
   * fica o resumo do que realmente está em vigor. */
  const activeChargeFilters: ActiveFilterChip[] = (
    [
      filters.status && {
        key: "status",
        label: CHARGE_STATUS_LABELS[filters.status],
        onClear: () => setFilters((f) => ({ ...f, status: "" })),
      },
      filters.reference && {
        key: "reference",
        label: formatReference(filters.reference),
        onClear: () => setFilters((f) => ({ ...f, reference: "" })),
      },
      filters.player && {
        key: "player",
        label:
          (playersQuery.data ?? []).find((p) => String(p.id) === filters.player)?.name ?? "Jogador",
        onClear: () => setFilters((f) => ({ ...f, player: "" })),
      },
      (filters.dueAfter || filters.dueBefore) && {
        key: "due",
        label: "Vencimento",
        onClear: () => setFilters((f) => ({ ...f, dueAfter: "", dueBefore: "" })),
      },
      (filters.amountMin || filters.amountMax) && {
        key: "amount",
        label: "Valor",
        onClear: () => setFilters((f) => ({ ...f, amountMin: "", amountMax: "" })),
      },
      (filters.paidAfter || filters.paidBefore) && {
        key: "paid",
        label: "Pagamento",
        onClear: () => setFilters((f) => ({ ...f, paidAfter: "", paidBefore: "" })),
      },
    ] as (ActiveFilterChip | "" | undefined | false)[]
  ).filter(Boolean) as ActiveFilterChip[];

  const openMemberFromCharge = (charge: Charge) =>
    setOpenMember(
      members.find((member) => member.player_id === charge.player) ?? {
        player_id: charge.player,
        player_name: charge.player_name,
        player_nickname: charge.player_nickname,
        current_amount: null,
        from_plan: true,
        effective_from: null,
        current_reference: charge.reference,
        current_charge_status: charge.effective_status,
        current_charge_id: charge.id,
      },
    );

  // "Selecionar todas" marca **todo o conjunto filtrado**, não a página
  // visível — e trocar o filtro descarta quem saiu da tela, para a ação em
  // massa nunca atingir quem o organizador não está mais vendo.
  const idsVisiveis = useMemo(() => charges.map((charge) => charge.id), [charges]);
  useEffect(() => {
    chargeSelection.keepOnly(idsVisiveis);
  }, [idsVisiveis, chargeSelection]);

  const chargeColumns: DataTableColumn<Charge>[] = [
    ...(podeOperarEmMassa
      ? [
          {
            key: "select",
            label: "",
            render: (charge: Charge) => (
              <Checkbox
                size="small"
                checked={chargeSelection.isSelected(charge.id)}
                slotProps={{
                  input: { "aria-label": `Selecionar mensalidade de ${charge.player_name}` },
                }}
                onChange={() => chargeSelection.toggle(charge.id)}
              />
            ),
          } as DataTableColumn<Charge>,
        ]
      : []),
    {
      key: "player",
      label: "Jogador",
      sortValue: (c) => c.player_name,
      render: (charge) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {charge.player_name}
          </Typography>
          {charge.player_nickname && (
            <Typography variant="caption" color="text.secondary">
              {charge.player_nickname}
            </Typography>
          )}
        </>
      ),
    },
    {
      key: "reference",
      label: "Competência",
      sortValue: (c) => c.reference,
      render: (c) => formatReference(c.reference),
    },
    {
      key: "amount",
      label: "Valor",
      sortValue: (c) => Number(c.amount),
      render: (charge) => (
        <>
          <Typography variant="body2">{formatMoney(charge.amount)}</Typography>
          {Number(charge.paid_amount) > 0 && Number(charge.outstanding) > 0 && (
            <Typography variant="caption" color="warning.main">
              falta {formatMoney(charge.outstanding)}
            </Typography>
          )}
        </>
      ),
    },
    {
      key: "due_date",
      label: "Vencimento",
      sortValue: (c) => c.due_date,
      render: (charge) => formatMatchDate(charge.due_date),
    },
    {
      key: "paid_at",
      label: "Pagamento",
      render: (charge) => {
        const ativa = charge.payments.filter((payment) => payment.status === "registered");
        if (ativa.length === 0) return "—";
        return formatMatchDate(ativa[ativa.length - 1].paid_at);
      },
    },
    {
      key: "status",
      label: "Status",
      render: (charge) => (
        <StatusChip
          label={CHARGE_STATUS_LABELS[charge.effective_status]}
          tone={STATUS_TONE[charge.effective_status]}
        />
      ),
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (charge) => (
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          {can("financial.register_payment") &&
            charge.effective_status !== "paid" &&
            charge.effective_status !== "canceled" && (
              <Button size="small" variant="outlined" onClick={() => setChargeToPay(charge)}>
                Dar baixa
              </Button>
            )}
          <Button size="small" onClick={() => openMemberFromCharge(charge)}>
            Ver ficha
          </Button>
        </Stack>
      ),
    },
  ];

  const memberColumns: DataTableColumn<MemberFee>[] = [
    {
      key: "select",
      label: "",
      render: (member) => (
        <Checkbox
          size="small"
          checked={selectedMembers.has(member.player_id)}
          slotProps={{ input: { "aria-label": `Selecionar ${member.player_name}` } }}
          onChange={(event) =>
            setSelectedMembers((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(member.player_id);
              else next.delete(member.player_id);
              return next;
            })
          }
        />
      ),
    },
    {
      key: "player",
      label: "Mensalista",
      sortValue: (m) => m.player_name,
      render: (member) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {member.player_name}
          </Typography>
          {member.player_nickname && (
            <Typography variant="caption" color="text.secondary">
              {member.player_nickname}
            </Typography>
          )}
        </>
      ),
    },
    {
      key: "amount",
      label: "Mensalidade atual",
      sortValue: (m) => Number(m.current_amount ?? 0),
      render: (member) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {formatMoney(member.current_amount)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {member.from_plan
              ? "valor do plano"
              : `desde ${formatReference(member.effective_from)}`}
          </Typography>
        </>
      ),
    },
    {
      key: "current",
      label: "Competência atual",
      render: (member) =>
        member.current_charge_status ? (
          <StatusChip
            label={CHARGE_STATUS_LABELS[member.current_charge_status]}
            tone={STATUS_TONE[member.current_charge_status]}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            não lançada
          </Typography>
        ),
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (member) => (
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          {can("financial.edit_fee") && (
            <Button size="small" variant="outlined" onClick={() => setFeeTargets([member])}>
              Alterar valor
            </Button>
          )}
          <Button size="small" onClick={() => setOpenMember(member)}>
            Ver ficha
          </Button>
        </Stack>
      ),
    },
  ];

  const expenses = (expensesQuery.data ?? []).filter(
    (expense) =>
      (!expenseKindFilter || expense.kind === expenseKindFilter) &&
      (!summaryReference || expense.reference === summaryReference),
  );

  const expenseColumns: DataTableColumn<Expense>[] = [
    {
      key: "description",
      label: "Despesa",
      sortValue: (e) => e.description,
      render: (expense) => (
        <>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              textDecoration: expense.status === "canceled" ? "line-through" : "none",
            }}
          >
            {expense.description}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {EXPENSE_KIND_LABELS[expense.kind]}
            {expense.recurring_description ? " · gerado do cadastro" : ""}
          </Typography>
        </>
      ),
    },
    {
      key: "reference",
      label: "Competência",
      sortValue: (e) => e.reference,
      render: (e) => formatReference(e.reference),
    },
    {
      key: "amount",
      label: "Valor",
      sortValue: (e) => Number(e.amount),
      render: (e) => formatMoney(e.amount),
    },
    {
      key: "due_date",
      label: "Vencimento",
      sortValue: (e) => e.due_date ?? "",
      render: (e) => (e.due_date ? formatMatchDate(e.due_date) : "—"),
    },
    {
      key: "incurred_on",
      label: "Pago em",
      sortValue: (e) => e.incurred_on,
      render: (e) => formatMatchDate(e.incurred_on),
    },
    {
      key: "status",
      label: "Situação",
      render: (expense) =>
        expense.status === "canceled" ? (
          <StatusChip label="Cancelada" tone="error" />
        ) : (
          <StatusChip label="Registrada" tone="success" />
        ),
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (expense) =>
        can("financial.manage") && expense.status === "registered" ? (
          <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
            <Button size="small" onClick={() => setExpenseToEdit(expense)}>
              Editar
            </Button>
            <Button size="small" color="error" onClick={() => setExpenseToCancel(expense)}>
              Cancelar
            </Button>
          </Stack>
        ) : null,
    },
  ];

  const selecionados = members.filter((member) => selectedMembers.has(member.player_id));
  const cobrancasSelecionadas = charges.filter((charge) => chargeSelection.isSelected(charge.id));

  return (
    <AppLayout>
      <PageHeader
        title="Financeiro"
        // As ações são **da aba aberta**. Antes o cabeçalho era o mesmo nas
        // três: com "Despesas" na tela, o organizador via "Gerar mês" e "Nova
        // mensalidade" — ações que não têm nada a ver com o que está olhando.
        action={
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {tab !== "expenses" && can("financial.edit_fee") && (
              <Button startIcon={<SettingsIcon />} onClick={() => setPlanOpen(true)}>
                {activePlan ? `Plano: ${formatMoney(activePlan.amount)}` : "Configurar plano"}
              </Button>
            )}
            {tab === "charges" && can("financial.manage") && (
              <>
                <Button
                  startIcon={<AutorenewIcon />}
                  disabled={!activePlan || bulkGenerateMutation.isPending}
                  onClick={() => setBulkAction("generate")}
                >
                  Gerar mês
                </Button>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormOpen(true)}>
                  Nova mensalidade
                </Button>
              </>
            )}
            {/* A aba Despesas não põe ação no cabeçalho: ela já tem as suas
                logo acima da lista ("Lançar despesa", "Custos fixos", "Gerar
                custos fixos"). Repetir aqui daria dois caminhos para a mesma
                coisa na mesma tela. */}
          </Stack>
        }
      />

      <Stack direction="row" sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Competência do painel"
          sx={{ minWidth: 200 }}
          value={summaryReference}
          onChange={(event) => setSummaryReference(event.target.value)}
        >
          <MenuItem value="">Todas as competências</MenuItem>
          {referenceOptions().map((option) => (
            <MenuItem key={option} value={option}>
              {formatReference(option)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((card) => (
          <Grid key={card.label} size={{ xs: 6, md: 3 }}>
            <StatTile
              label={card.label}
              value={card.value ?? "—"}
              tone={card.tone}
              loading={summaryQuery.isLoading}
            />
          </Grid>
        ))}
      </Grid>

      <Tabs value={tab} onChange={(_event, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="charges" label="Mensalidades" />
        <Tab value="members" label="Mensalistas" />
        <Tab value="expenses" label="Despesas" />
      </Tabs>

      {tab === "charges" ? (
        <>
          <FilterSheet
            open={filtersOpen}
            onOpen={() => setFiltersOpen(true)}
            onClose={() => setFiltersOpen(false)}
            active={activeChargeFilters}
            onClearAll={() => setFilters(EMPTY_FILTERS)}
            resultCount={charges.length}
          >
            <TextField
              select
              fullWidth
              label="Status"
              value={filters.status}
              onChange={(event) =>
                setFilters((f) => ({ ...f, status: event.target.value as ChargeStatus | "" }))
              }
            >
              <MenuItem value="">Todos</MenuItem>
              {(Object.keys(CHARGE_STATUS_LABELS) as ChargeStatus[]).map((status) => (
                <MenuItem key={status} value={status}>
                  {CHARGE_STATUS_LABELS[status]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="Competência"
              value={filters.reference}
              onChange={(event) => setFilters((f) => ({ ...f, reference: event.target.value }))}
            >
              <MenuItem value="">Todas</MenuItem>
              {referenceOptions().map((option) => (
                <MenuItem key={option} value={option}>
                  {formatReference(option)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="Mensalista"
              value={filters.player}
              onChange={(event) => setFilters((f) => ({ ...f, player: event.target.value }))}
            >
              <MenuItem value="">Todos</MenuItem>
              {(playersQuery.data ?? []).map((player) => (
                <MenuItem key={player.id} value={String(player.id)}>
                  {player.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                type="date"
                label="Vencimento de"
                slotProps={{ inputLabel: { shrink: true } }}
                value={filters.dueAfter}
                onChange={(event) => setFilters((f) => ({ ...f, dueAfter: event.target.value }))}
              />
              <TextField
                fullWidth
                type="date"
                label="Vencimento até"
                slotProps={{ inputLabel: { shrink: true } }}
                value={filters.dueBefore}
                onChange={(event) => setFilters((f) => ({ ...f, dueBefore: event.target.value }))}
              />
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                type="number"
                label="Valor mín."
                slotProps={{ htmlInput: { inputMode: "decimal" } }}
                value={filters.amountMin}
                onChange={(event) => setFilters((f) => ({ ...f, amountMin: event.target.value }))}
              />
              <TextField
                fullWidth
                type="number"
                label="Valor máx."
                slotProps={{ htmlInput: { inputMode: "decimal" } }}
                value={filters.amountMax}
                onChange={(event) => setFilters((f) => ({ ...f, amountMax: event.target.value }))}
              />
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                type="date"
                label="Pago de"
                slotProps={{ inputLabel: { shrink: true } }}
                value={filters.paidAfter}
                onChange={(event) => setFilters((f) => ({ ...f, paidAfter: event.target.value }))}
              />
              <TextField
                fullWidth
                type="date"
                label="Pago até"
                slotProps={{ inputLabel: { shrink: true } }}
                value={filters.paidBefore}
                onChange={(event) => setFilters((f) => ({ ...f, paidBefore: event.target.value }))}
              />
            </Stack>
          </FilterSheet>

          {podeOperarEmMassa && charges.length > 0 && (
            <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
              <Checkbox
                size="small"
                checked={chargeSelection.allSelected(idsVisiveis)}
                indeterminate={chargeSelection.someSelected(idsVisiveis)}
                slotProps={{ input: { "aria-label": "Selecionar todas as mensalidades" } }}
                onChange={() => chargeSelection.toggleAll(idsVisiveis)}
              />
              <Typography variant="body2" color="text.secondary">
                Selecionar todas ({charges.length})
              </Typography>
            </Stack>
          )}

          <DataTable
            columns={chargeColumns}
            rows={charges}
            getRowKey={(charge) => charge.id}
            loading={chargesQuery.isLoading}
            error={
              chargesQuery.isError
                ? getApiErrorMessage(chargesQuery.error, "Não foi possível carregar o financeiro.")
                : null
            }
            onRetry={() => chargesQuery.refetch()}
            emptyMessage="Nenhuma mensalidade encontrada com estes filtros."
            defaultSortKey="due_date"
            renderCard={(charge) => (
              <ChargeCard
                charge={charge}
                canRegisterPayment={can("financial.register_payment")}
                onRegisterPayment={setChargeToPay}
                onOpenMember={openMemberFromCharge}
                selectable={podeOperarEmMassa}
                selected={chargeSelection.isSelected(charge.id)}
                onToggleSelect={() => chargeSelection.toggle(charge.id)}
              />
            )}
          />

          {podeOperarEmMassa && (
            <BulkActionBar
              count={chargeSelection.count}
              noun="mensalidade"
              nounPlural="mensalidades"
              onClear={chargeSelection.clear}
              actions={[
                ...(can("financial.manage")
                  ? [
                      {
                        key: "due-date",
                        label: "Alterar vencimento",
                        shortLabel: "Vencimento",
                        onClick: () => setBulkAction("due-date"),
                      },
                    ]
                  : []),
                ...(can("financial.register_payment")
                  ? [
                      {
                        key: "payment",
                        label: "Dar baixa",
                        shortLabel: "Baixa",
                        onClick: () => setBulkAction("payment"),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </>
      ) : null}

      {/* Cada aba condiciona a **si mesma**.
          Antes isto era um ternário `charges ? … : …`, e o "senão" pegava
          `members` **e** `expenses`: com a aba Despesas aberta, a tabela de
          mensalistas renderizava junto, logo acima das despesas. Era
          exatamente a mistura relatada — "a aba de despesas deve conter
          somente despesas". */}
      {tab === "members" && (
        <>
          {can("financial.edit_fee") && (
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ mb: 2, alignItems: { sm: "center" } }}
            >
              <Button
                variant="contained"
                disabled={members.length === 0}
                onClick={() => setFeeTargets(selecionados.length > 0 ? selecionados : null)}
              >
                Alterar mensalidade
                {selecionados.length > 0
                  ? ` de ${selecionados.length} selecionado(s)`
                  : " de todos"}
              </Button>
              {selecionados.length > 0 && (
                <Button size="small" onClick={() => setSelectedMembers(new Set())}>
                  Limpar seleção
                </Button>
              )}
            </Stack>
          )}

          {members.length === 0 && !memberFeesQuery.isLoading && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Nenhum mensalista ativo cadastrado. Só mensalistas ativos (e não temporários) têm
              mensalidade.
            </Alert>
          )}

          <DataTable
            columns={memberColumns}
            rows={members}
            getRowKey={(member) => member.player_id}
            loading={memberFeesQuery.isLoading}
            error={
              memberFeesQuery.isError
                ? getApiErrorMessage(memberFeesQuery.error, "Não foi possível carregar os mensalistas.")
                : null
            }
            onRetry={() => memberFeesQuery.refetch()}
            emptyMessage="Nenhum mensalista."
            defaultSortKey="player"
            // Nome ordena A→Z; o padrão decrescente da tabela serve a data e a
            // valor, não a uma lista de pessoas.
            defaultSortDesc={false}
          />
        </>
      )}

      {tab === "expenses" && (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ mb: 2, alignItems: { sm: "center" }, flexWrap: "wrap", rowGap: 1 }}
          >
            {can("financial.manage") && (
              <>
                <Button variant="contained" onClick={() => setExpenseFormOpen(true)}>
                  Lançar despesa
                </Button>
                <Button onClick={() => setFixedCostsOpen(true)}>Custos fixos</Button>
                <Button
                  disabled={
                    (fixedCostsQuery.data ?? []).every((cost) => !cost.is_active) ||
                    generateFixedMutation.isPending
                  }
                  onClick={() => generateFixedMutation.mutate(undefined)}
                >
                  Gerar custos fixos de {formatReference(summaryReference || currentReference())}
                </Button>
              </>
            )}
            <TextField
              select
              size="small"
              label="Tipo"
              sx={{ minWidth: 180 }}
              value={expenseKindFilter}
              onChange={(event) => setExpenseKindFilter(event.target.value as ExpenseKind | "")}
            >
              <MenuItem value="">Todos</MenuItem>
              {(Object.keys(EXPENSE_KIND_LABELS) as ExpenseKind[]).map((kind) => (
                <MenuItem key={kind} value={kind}>
                  {EXPENSE_KIND_LABELS[kind]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {summary && (
            <Alert severity="info" sx={{ mb: 2 }} data-testid="expenses-breakdown">
              {formatReference(summaryReference)}: custos fixos{" "}
              <strong>{formatMoney(summary.expenses.fixed.amount)}</strong> (
              {summary.expenses.fixed.count}) · custos extras{" "}
              <strong>{formatMoney(summary.expenses.extra.amount)}</strong> (
              {summary.expenses.extra.count}) · total{" "}
              <strong>{formatMoney(summary.expenses.total)}</strong>
            </Alert>
          )}

          <DataTable
            columns={expenseColumns}
            rows={expenses}
            getRowKey={(expense) => expense.id}
            loading={expensesQuery.isLoading}
            error={
              expensesQuery.isError
                ? getApiErrorMessage(expensesQuery.error, "Não foi possível carregar as despesas.")
                : null
            }
            onRetry={() => expensesQuery.refetch()}
            emptyMessage="Nenhuma despesa lançada."
            defaultSortKey="reference"
          />
        </>
      )}

      <ChargeFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        players={playersQuery.data ?? []}
        isSubmitting={createMutation.isPending}
        error={
          createMutation.isError
            ? getApiErrorMessage(createMutation.error, "Não foi possível lançar a mensalidade.")
            : null
        }
        onSubmit={(payload) => createMutation.mutateAsync(payload)}
      />

      <FeePlanDrawer
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        plan={activePlan}
        isSubmitting={planMutation.isPending}
        error={
          planMutation.isError
            ? getApiErrorMessage(planMutation.error, "Não foi possível salvar o plano.")
            : null
        }
        onSubmit={(payload) => planMutation.mutateAsync(payload)}
      />

      <RegisterPaymentDialog
        charge={chargeToPay}
        onClose={() => setChargeToPay(null)}
        isSubmitting={paymentMutation.isPending}
        onSubmit={(payload) => paymentMutation.mutateAsync({ chargeId: chargeToPay!.id, ...payload })}
      />

      <CancelWithReasonDialog
        open={paymentToCancel !== null}
        title="Cancelar baixa"
        submitLabel="Cancelar baixa"
        summary={
          <CancelSummary
            main={`${formatMoney(paymentToCancel?.payment.amount)} · competência ${formatReference(
              paymentToCancel?.charge.reference,
            )}`}
            meta={
              paymentToCancel?.payment.registered_by_name
                ? `Baixa registrada por ${paymentToCancel.payment.registered_by_name}`
                : undefined
            }
          />
        }
        onClose={() => setPaymentToCancel(null)}
        isSubmitting={cancelPaymentMutation.isPending}
        error={
          cancelPaymentMutation.isError
            ? getApiErrorMessage(cancelPaymentMutation.error, "Não foi possível cancelar a baixa.")
            : null
        }
        onSubmit={(reason) =>
          cancelPaymentMutation.mutateAsync({ paymentId: paymentToCancel!.payment.id, reason })
        }
      />

      <CancelWithReasonDialog
        open={expenseToCancel !== null}
        title="Cancelar despesa"
        submitLabel="Cancelar despesa"
        summary={
          <CancelSummary
            main={`${expenseToCancel?.description ?? ""} · ${formatMoney(expenseToCancel?.amount)}`}
            meta={`Competência ${formatReference(expenseToCancel?.reference)}`}
          />
        }
        onClose={() => setExpenseToCancel(null)}
        isSubmitting={cancelExpenseMutation.isPending}
        error={
          cancelExpenseMutation.isError
            ? getApiErrorMessage(cancelExpenseMutation.error, "Não foi possível cancelar a despesa.")
            : null
        }
        onSubmit={(reason) =>
          cancelExpenseMutation.mutateAsync({ expenseId: expenseToCancel!.id, reason })
        }
      />

      <ExpenseFormDialog
        open={expenseFormOpen || expenseToEdit !== null}
        expense={expenseToEdit}
        onClose={() => {
          setExpenseFormOpen(false);
          setExpenseToEdit(null);
        }}
        isSubmitting={expenseMutation.isPending || updateExpenseMutation.isPending}
        error={
          expenseMutation.isError
            ? getApiErrorMessage(expenseMutation.error, "Não foi possível lançar a despesa.")
            : updateExpenseMutation.isError
              ? getApiErrorMessage(
                  updateExpenseMutation.error,
                  "Não foi possível alterar a despesa.",
                )
              : null
        }
        onSubmit={(payload) =>
          expenseToEdit
            ? updateExpenseMutation.mutateAsync({ id: expenseToEdit.id, ...payload })
            : expenseMutation.mutateAsync(payload)
        }
      />

      <FixedCostsDrawer
        open={fixedCostsOpen}
        costs={fixedCostsQuery.data ?? []}
        onClose={() => setFixedCostsOpen(false)}
        isSubmitting={fixedCostMutation.isPending}
        error={
          fixedCostMutation.isError
            ? getApiErrorMessage(fixedCostMutation.error, "Não foi possível salvar o custo fixo.")
            : null
        }
        onSave={(payload) => fixedCostMutation.mutateAsync(payload)}
      />

      <GenerateChargesDialog
        open={bulkAction === "generate"}
        onClose={() => setBulkAction(null)}
        isSubmitting={bulkGenerateMutation.isPending}
        onConfirm={(reference) => {
          setBulkAction(null);
          bulkGenerateMutation.mutate({ reference });
        }}
      />

      <BulkDueDateDialog
        open={bulkAction === "due-date"}
        charges={cobrancasSelecionadas}
        onClose={() => setBulkAction(null)}
        isSubmitting={bulkDueDateMutation.isPending}
        onConfirm={(dueDay) => {
          setBulkAction(null);
          bulkDueDateMutation.mutate({ due_day: dueDay, charge_ids: [...chargeSelection.selected] });
        }}
      />

      <BulkPaymentDialog
        open={bulkAction === "payment"}
        charges={cobrancasSelecionadas}
        onClose={() => setBulkAction(null)}
        isSubmitting={bulkPaymentMutation.isPending}
        onConfirm={(payload) => {
          setBulkAction(null);
          bulkPaymentMutation.mutate({
            ...payload,
            charge_ids: [...chargeSelection.selected],
          });
        }}
      />

      <BulkResultDialog
        title={bulkResult?.title ?? ""}
        result={bulkResult?.result ?? null}
        onClose={() => setBulkResult(null)}
      />

      <ChangeFeeDialog
        open={feeTargets !== undefined}
        targets={feeTargets ?? null}
        onClose={() => setFeeTargets(undefined)}
        isSubmitting={feeMutation.isPending}
        error={
          feeMutation.isError
            ? getApiErrorMessage(feeMutation.error, "Não foi possível alterar a mensalidade.")
            : null
        }
        onSubmit={(payload) => feeMutation.mutateAsync(payload)}
      />

      <MemberFinanceDrawer
        member={openMember}
        charges={(chargesQuery.data ?? [])
          .filter((charge) => charge.player === openMember?.player_id)
          .sort((a, b) => b.reference.localeCompare(a.reference))}
        canEditFee={can("financial.edit_fee")}
        canRegisterPayment={can("financial.register_payment")}
        canCancelPayment={can("financial.cancel_payment")}
        onClose={() => setOpenMember(null)}
        onChangeFee={(member) => setFeeTargets([member])}
        onRegisterPayment={(charge) => setChargeToPay(charge)}
        onCancelPayment={(payment, charge) => setPaymentToCancel({ payment, charge })}
      />
    </AppLayout>
  );
}
