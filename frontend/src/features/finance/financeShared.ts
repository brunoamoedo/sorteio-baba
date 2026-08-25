/**
 * Vocabulário comum do financeiro: chaves de cache, dinheiro e competência.
 *
 * Vive fora dos componentes porque as três telas do módulo (Financeiro,
 * Mensalidades e "Minhas mensalidades") precisam formatar do mesmo jeito — e
 * porque `formatMoney` já estava copiado em dois arquivos, o que é como duas
 * formatações de dinheiro começam a divergir.
 */

import type { QueryKey } from "../../core/data";

export const financeKeys = {
  charges: (): QueryKey => ["finance", "charges"],
  summary: (): QueryKey => ["finance", "summary"],
  plans: (): QueryKey => ["finance", "plans"],
  memberFees: (): QueryKey => ["finance", "member-fees"],
  expenses: (): QueryKey => ["finance", "expenses"],
  recurringExpenses: (): QueryKey => ["finance", "recurring-expenses"],
  feeHistory: (playerId: number): QueryKey => ["finance", "fee-history", playerId],
  timeline: (chargeId: number): QueryKey => ["finance", "timeline", chargeId],
  capabilities: (): QueryKey => ["finance", "capabilities"],
};

/** `"80.00"` → `"R$ 80,00"`. O backend manda string de propósito: `number` em
 * JavaScript é ponto flutuante e não é lugar para dinheiro. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

/** `"2026-05"` → `"Mai/2026"`. Competência é conceito financeiro: aparece
 * sempre no mesmo formato, nunca como data. */
export function formatReference(reference: string | null | undefined): string {
  if (!reference) return "—";
  const [year, month] = reference.split("-");
  const label = MONTH_LABELS[Number(month) - 1];
  return label ? `${label}/${year}` : reference;
}

/** Competência de hoje, no formato do servidor. */
export function currentReference(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Competências oferecidas nos seletores: alguns meses para trás e para frente
 * a partir de hoje. O passado existe para lançar uma competência esquecida; o
 * futuro, para agendar um reajuste ("a partir de Maio/2026"). */
export function referenceOptions(back = 12, forward = 12, now = new Date()): string[] {
  const options: string[] = [];
  for (let offset = -back; offset <= forward; offset += 1) {
    const moment = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    options.push(currentReference(moment));
  }
  return options;
}

/** Soma um mês à competência — o padrão sugerido para um reajuste ("vale a
 * partir do mês que vem", já que o atual costuma estar lançado). */
export function nextReference(reference: string): string {
  const [year, month] = reference.split("-").map(Number);
  const moment = new Date(year, month, 1);
  return currentReference(moment);
}
