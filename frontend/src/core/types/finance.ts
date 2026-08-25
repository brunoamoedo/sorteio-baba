/** Situação **efetiva** de uma mensalidade.
 *
 * `overdue` não existe no banco: é derivado de vencimento + pagamentos, do
 * mesmo jeito que vitória/derrota é derivada dos gols. Por isso a tela lê
 * `effective_status`, nunca `status`. */
export type ChargeStatus = "pending" | "paid" | "overdue" | "canceled";

export type PaymentMethod = "cash" | "pix" | "transfer" | "card" | "other";

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  transfer: "Transferência",
  card: "Cartão",
  other: "Outro",
};

/** Situação de uma baixa. Cancelar **não** apaga o pagamento — ele muda de
 * estado e passa a registrar quem cancelou, quando e por quê. */
export type PaymentStatus = "registered" | "canceled";

export interface Payment {
  id: number;
  amount: string;
  /** Data em que o dinheiro entrou. **Não** determina a competência. */
  paid_at: string;
  method: PaymentMethod;
  notes: string;
  status: PaymentStatus;
  registered_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancellation_reason: string;
  created_at: string;
}

export interface Charge {
  id: number;
  player: number;
  player_name: string;
  player_nickname: string;
  plan: number | null;
  /** Competência no formato AAAA-MM. */
  reference: string;
  amount: string;
  /** A multa **congelada** nesta competência. Zero quando a organização não
   * cobra multa (ou não cobrava quando a mensalidade foi lançada). */
  late_fee_amount: string;
  /** A multa que **incide** — zero se foi paga em dia ou ainda não venceu.
   * Nunca é gravada: é derivada de vencimento + datas de pagamento. */
  late_fee_due: string;
  /** `amount + late_fee_due`. O que precisa entrar para quitar. */
  total_due: string;
  due_date: string;
  status: "pending" | "paid" | "canceled";
  effective_status: ChargeStatus;
  paid_amount: string;
  outstanding: string;
  notes: string;
  payments: Payment[];
  created_at: string;
}

export interface FinancialSummary {
  /** Competência a que o resumo se refere; vazio = toda a história. */
  reference: string;
  by_status: Record<ChargeStatus, { count: number; amount: string }>;
  total_expected: string;
  total_received: string;
  total_outstanding: string;
  expenses: {
    fixed: { count: number; amount: string };
    extra: { count: number; amount: string };
    total: string;
  };
  /** Arrecadado − despesas. Pode ser negativo: o mês custou mais do que entrou. */
  balance: string;
}

/** Como a despesa se comporta no tempo.
 *
 * - `fixed`: custo fixo mensal (quadra, arbitragem) — vem de um cadastro e se
 *   repete todo mês.
 * - `extra`: aconteceu uma vez (bola nova, churrasco, multa).
 *
 * A separação existe porque comparar dois meses sem ela esconde **por que** um
 * custou mais que o outro. */
export type ExpenseKind = "fixed" | "extra";

export type ExpenseStatus = "registered" | "canceled";

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  fixed: "Custo fixo mensal",
  extra: "Custo extra",
};

/** Cadastro de um custo fixo mensal — o contrato do gasto, não o gasto. */
export interface RecurringExpense {
  id: number;
  description: string;
  amount: string;
  due_day: number;
  notes: string;
  is_active: boolean;
}

export interface Expense {
  id: number;
  kind: ExpenseKind;
  recurring: number | null;
  recurring_description: string | null;
  description: string;
  amount: string;
  /** Competência (AAAA-MM) a que a despesa pertence. */
  reference: string;
  /** Quando **vencia**. Informativo: a despesa entra no custo do mês pelo
   * lançamento, não pelo vencimento. */
  due_date: string | null;
  /** Quando foi paga — não determina a competência. */
  incurred_on: string;
  notes: string;
  status: ExpenseStatus;
  registered_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancellation_reason: string;
  created_at: string;
}

/** Uma linha da tela "Mensalistas": quem paga quanto, desde quando, e como está
 * a competência corrente. */
export interface MemberFee {
  player_id: number;
  player_name: string;
  player_nickname: string;
  current_amount: string | null;
  /** O valor vem do plano da organização (o jogador nunca teve valor próprio). */
  from_plan: boolean;
  effective_from: string | null;
  current_reference: string;
  current_charge_status: ChargeStatus | null;
  current_charge_id: number | null;
}

/** Uma vigência de valor: "R$ 120,00 a partir de Maio/2026". */
export interface PlayerMonthlyFee {
  id: number;
  player: number;
  amount: string;
  effective_from: string;
  reason: string;
  /** Identificador da alteração em massa que criou esta vigência, se houver. */
  batch: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface MemberFeeHistory {
  player_id: number;
  player_name: string;
  current_amount: string | null;
  history: PlayerMonthlyFee[];
}

/** Prévia de uma alteração em massa — o que a confirmação mostra antes de
 * qualquer alteração acontecer. */
export interface BulkFeePreview {
  players_count: number;
  effective_from: string;
  current_amounts: string[];
  /** Competências desta referência já lançadas: **não** serão alteradas. */
  already_charged: number;
}

/** Uma linha do resultado de uma operação em massa.
 *
 * O mesmo formato para gerar, alterar vencimento e dar baixa: as três dizem o
 * que entrou, o que ficou de fora e **por quê**. */
export interface BulkRow {
  player_id: number;
  player_name: string;
  charge_id?: number;
  payment_id?: number;
  amount?: string;
  late_fee?: string;
  due_date?: string;
  previous_due_date?: string;
  /** A cobrança deixou de ter multa por causa do novo vencimento. */
  lost_late_fee?: boolean;
  /** Presente só nas puladas. */
  reason?: string;
}

export interface BulkResult {
  processed: BulkRow[];
  skipped: BulkRow[];
  processed_count: number;
  skipped_count: number;
  total: number;
  reference?: string;
  due_date?: string;
  paid_at?: string;
}

/** Uma cobrança na prévia/resultado da ressincronização. */
export interface ResyncRow {
  charge_id: number;
  player_id: number;
  player_name: string;
  current_amount: string;
  /** Presente quando a cobrança **vai** (ou foi) mudar de valor. */
  new_amount?: string;
  previous_amount?: string;
  /** Presente quando a cobrança foi deixada de fora — e por quê. */
  reason?: string;
}

export interface ResyncPreview {
  reference: string;
  to_update: ResyncRow[];
  skipped: ResyncRow[];
  to_update_count: number;
  skipped_count: number;
  /** Quantas estão **em aberto e ao alcance** — inclusive as que já batem com
   * o valor vigente. É este o número que a tela mostra antes de salvar:
   * `to_update_count` compara com a vigência **atual**, que ainda é a antiga
   * enquanto o organizador digita o valor novo. */
  eligible_count: number;
  current_amounts: string[];
}

export interface ResyncResult {
  reference: string;
  updated: ResyncRow[];
  skipped: ResyncRow[];
  updated_count: number;
  skipped_count: number;
  eligible_count: number;
}

export interface BulkFeeResult {
  batch: string;
  players_count: number;
  amount: string;
  effective_from: string;
  previous_amounts: string[];
}

/** Um evento do histórico financeiro de uma competência. */
export interface TimelineEntry {
  id: number;
  action: string;
  action_display: string;
  user: string | null;
  created_at: string;
  entity: string;
  entity_id: number | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
}

/** Capacidades financeiras do usuário logado, vindas do servidor — a tela não
 * deduz permissão a partir do papel. */
export type FinancialCapability =
  | "financial.view"
  | "financial.manage"
  | "financial.edit_fee"
  | "financial.register_payment"
  | "financial.cancel_payment"
  | "financial.view_audit";


/** Contrato de mensalidade da organização: quanto e quando se cobra.
 *
 * É a base da geração automática — a task noturna lança uma `Charge` por
 * mensalista ativo usando `amount` e `due_day`. */
export interface MembershipFeePlan {
  id: number;
  name: string;
  amount: string;
  period: "monthly" | "weekly";
  /** Dia do mês do vencimento. Dia 31 em mês curto escorrega para o último. */
  due_day: number;
  /** Multa fixa por atraso. `"0.00"` desativa a cobrança de multa.
   *
   * O valor é **congelado** em cada mensalidade na geração: reajustar aqui não
   * cria dívida retroativa em competência nenhuma. */
  late_fee_amount: string;
  is_active: boolean;
}
