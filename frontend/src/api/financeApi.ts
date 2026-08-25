import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type {
  BulkFeePreview,
  BulkFeeResult,
  BulkResult,
  Charge,
  Expense,
  ExpenseKind,
  FinancialCapability,
  FinancialSummary,
  MemberFee,
  MemberFeeHistory,
  MembershipFeePlan,
  Payment,
  PaymentMethod,
  PlayerMonthlyFee,
  RecurringExpense,
  ResyncPreview,
  ResyncResult,
  TimelineEntry,
} from "../core/types/finance";

export interface ExpenseFilters {
  kind?: ExpenseKind;
  status?: string;
  reference?: string;
  reference_after?: string;
  reference_before?: string;
}

export interface CreateExpensePayload {
  description: string;
  amount: string;
  reference: string;
  incurred_on: string;
  /** Informativo: a despesa entra no custo do mês pelo lançamento, não pelo
   * vencimento. */
  due_date?: string;
  kind: ExpenseKind;
  notes?: string;
}

/** Filtros da listagem de mensalidades.
 *
 * `status` é o campo **gravado**; "atrasado" é derivado e continua sendo
 * filtrado na tela, que já tem a lista. Competência, período de vencimento,
 * faixa de valor e data de pagamento são filtrados no servidor. */
export interface ChargeFilters {
  status?: string;
  player?: number;
  reference?: string;
  reference_after?: string;
  reference_before?: string;
  due_after?: string;
  due_before?: string;
  amount_min?: string;
  amount_max?: string;
  paid_after?: string;
  paid_before?: string;
}

export interface CreateChargePayload {
  player: number;
  reference: string;
  amount: string;
  due_date: string;
  notes?: string;
}

export interface RegisterPaymentPayload {
  amount: string;
  paid_at?: string;
  method: PaymentMethod;
  notes?: string;
}

export interface SetMemberFeePayload {
  player: number;
  amount: string;
  effective_from: string;
  reason?: string;
}

export interface BulkSetMemberFeePayload {
  /** Vazio/ausente = todos os mensalistas ativos (resolvido no servidor). */
  players?: number[];
  amount: string;
  effective_from: string;
  reason?: string;
}

export const financeApi = {
  listCharges: (filters: ChargeFilters = {}): Promise<Charge[]> =>
    fetchAllPages<Charge>(apiClient, "/finance/charges/", filters),
  createCharge: async (payload: CreateChargePayload): Promise<Charge> => {
    const { data } = await apiClient.post<Charge>("/finance/charges/", payload);
    return data;
  },
  registerPayment: async (chargeId: number, payload: RegisterPaymentPayload): Promise<Charge> => {
    const { data } = await apiClient.post<Charge>(
      `/finance/charges/${chargeId}/register-payment/`,
      payload,
    );
    return data;
  },
  /** Cancela a baixa **sem apagá-la**. O motivo é obrigatório no servidor. */
  cancelPayment: async (paymentId: number, reason: string): Promise<Payment> => {
    const { data } = await apiClient.post<Payment>(`/finance/payments/${paymentId}/cancel/`, {
      reason,
    });
    return data;
  },
  cancelCharge: async (chargeId: number, reason = ""): Promise<Charge> => {
    const { data } = await apiClient.post<Charge>(`/finance/charges/${chargeId}/cancel/`, { reason });
    return data;
  },
  /** Histórico completo de uma competência: baixas, cancelamentos, alterações. */
  timeline: async (chargeId: number): Promise<TimelineEntry[]> => {
    const { data } = await apiClient.get<TimelineEntry[]>(
      `/finance/charges/${chargeId}/timeline/`,
    );
    return data;
  },
  summary: async (reference?: string): Promise<FinancialSummary> => {
    const { data } = await apiClient.get<FinancialSummary>("/finance/summary/", {
      params: reference ? { reference } : undefined,
    });
    return data;
  },
  capabilities: async (): Promise<FinancialCapability[]> => {
    const { data } = await apiClient.get<{ capabilities: FinancialCapability[] }>(
      "/finance/capabilities/",
    );
    return data.capabilities;
  },
  listPlans: (): Promise<MembershipFeePlan[]> =>
    fetchAllPages<MembershipFeePlan>(apiClient, "/finance/fee-plans/"),
  savePlan: async (
    payload: Omit<MembershipFeePlan, "id"> & { id?: number },
  ): Promise<MembershipFeePlan> => {
    const { id, ...body } = payload;
    const { data } = id
      ? await apiClient.patch<MembershipFeePlan>(`/finance/fee-plans/${id}/`, body)
      : await apiClient.post<MembershipFeePlan>("/finance/fee-plans/", body);
    return data;
  },
  /** Lança a mensalidade do mês para todos os mensalistas. Idempotente. */
  generateMonthly: async (reference?: string): Promise<{ created: number }> => {
    const { data } = await apiClient.post("/finance/charges/generate-monthly/", { reference });
    return data;
  },
  /** Auto-serviço: as mensalidades de quem está logado. */
  mine: async (): Promise<Charge[]> => {
    const { data } = await apiClient.get<Charge[]>("/finance/charges/mine/");
    return data;
  },

  // -- Mensalidade por mensalista -------------------------------------------

  memberFees: async (reference?: string): Promise<MemberFee[]> => {
    const { data } = await apiClient.get<MemberFee[]>("/finance/member-fees/", {
      params: reference ? { reference } : undefined,
    });
    return data;
  },
  setMemberFee: async (payload: SetMemberFeePayload): Promise<PlayerMonthlyFee> => {
    const { data } = await apiClient.post<PlayerMonthlyFee>("/finance/member-fees/set/", payload);
    return data;
  },
  /** Prévia da alteração em massa — não altera nada, alimenta a confirmação. */
  bulkPreview: async (effectiveFrom: string, players?: number[]): Promise<BulkFeePreview> => {
    const { data } = await apiClient.get<BulkFeePreview>("/finance/member-fees/bulk-set/", {
      params: { effective_from: effectiveFrom, ...(players?.length ? { players } : {}) },
    });
    return data;
  },
  bulkSetMemberFee: async (payload: BulkSetMemberFeePayload): Promise<BulkFeeResult> => {
    const { data } = await apiClient.post<BulkFeeResult>(
      "/finance/member-fees/bulk-set/",
      payload,
    );
    return data;
  },
  /** Correção de uma despesa já lançada. Passa pelo serviço no servidor, que
   * valida e audita — `kind` e `recurring` não são alterados. */
  updateExpense: async (
    expenseId: number,
    payload: Partial<CreateExpensePayload>,
  ): Promise<Expense> => {
    const { data } = await apiClient.patch<Expense>(`/finance/expenses/${expenseId}/`, payload);
    return data;
  },

  // -- Operações em massa ----------------------------------------------------
  //
  // As três devolvem o mesmo formato: processadas, puladas e o motivo de cada
  // pulada. Nenhuma é tudo-ou-nada — uma mensalidade problemática não desfaz
  // as outras dezessete.

  generateChargesFor: async (payload: {
    reference: string;
    player_ids?: number[];
  }): Promise<BulkResult> => {
    const { data } = await apiClient.post<BulkResult>("/finance/charges/generate-for/", payload);
    return data;
  },
  /** Recebe **cobranças**, não jogadores: é o que a tela seleciona, e o dia é
   * resolvido contra a competência de cada uma — uma seleção que cruze meses
   * sai com o dia certo em cada um. */
  bulkDueDate: async (payload: {
    due_day: number;
    charge_ids: number[];
  }): Promise<BulkResult> => {
    const { data } = await apiClient.post<BulkResult>("/finance/charges/bulk-due-date/", payload);
    return data;
  },
  bulkRegisterPayment: async (payload: {
    charge_ids: number[];
    paid_at?: string;
    method?: string;
    notes?: string;
  }): Promise<BulkResult> => {
    const { data } = await apiClient.post<BulkResult>(
      "/finance/charges/bulk-register-payment/",
      payload,
    );
    return data;
  },

  // -- Ressincronização das mensalidades em aberto ---------------------------
  //
  // Alterar o valor nunca é retroativo: a competência **já lançada** continua
  // com o valor congelado. Estas duas rotas são o caminho explícito para
  // aplicar o valor novo ao que ninguém pagou ainda.

  /** O que a ressincronização faria — não altera nada. */
  resyncPreview: async (reference: string, players?: number[]): Promise<ResyncPreview> => {
    const { data } = await apiClient.get<ResyncPreview>("/finance/charges/resync-preview/", {
      params: { reference, ...(players?.length ? { player_ids: players } : {}) },
    });
    return data;
  },
  resyncCharges: async (payload: {
    reference: string;
    player_ids?: number[];
    reason?: string;
  }): Promise<ResyncResult> => {
    const { data } = await apiClient.post<ResyncResult>("/finance/charges/resync/", payload);
    return data;
  },

  feeHistory: async (playerId: number): Promise<MemberFeeHistory> => {
    const { data } = await apiClient.get<MemberFeeHistory>(
      `/finance/member-fees/${playerId}/history/`,
    );
    return data;
  },

  // -- Despesas --------------------------------------------------------------

  listExpenses: (filters: ExpenseFilters = {}): Promise<Expense[]> =>
    fetchAllPages<Expense>(apiClient, "/finance/expenses/", filters),
  createExpense: async (payload: CreateExpensePayload): Promise<Expense> => {
    const { data } = await apiClient.post<Expense>("/finance/expenses/", payload);
    return data;
  },
  /** Cancela a despesa **sem apagá-la**. O motivo é obrigatório no servidor. */
  cancelExpense: async (expenseId: number, reason: string): Promise<Expense> => {
    const { data } = await apiClient.post<Expense>(`/finance/expenses/${expenseId}/cancel/`, {
      reason,
    });
    return data;
  },
  /** Lança os custos fixos ativos na competência. Idempotente. */
  generateFixedExpenses: async (reference?: string): Promise<{ created: number }> => {
    const { data } = await apiClient.post("/finance/expenses/generate-fixed/", { reference });
    return data;
  },
  listRecurringExpenses: (): Promise<RecurringExpense[]> =>
    fetchAllPages<RecurringExpense>(apiClient, "/finance/recurring-expenses/"),
  saveRecurringExpense: async (
    payload: Omit<RecurringExpense, "id"> & { id?: number },
  ): Promise<RecurringExpense> => {
    const { id, ...body } = payload;
    const { data } = id
      ? await apiClient.patch<RecurringExpense>(`/finance/recurring-expenses/${id}/`, body)
      : await apiClient.post<RecurringExpense>("/finance/recurring-expenses/", body);
    return data;
  },
};
