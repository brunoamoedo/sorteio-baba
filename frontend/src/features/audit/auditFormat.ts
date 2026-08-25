/**
 * Tradução do `before`/`after` da auditoria para linguagem de gente.
 *
 * A trilha guarda JSON cru (`{"team_id": 4, "team_name": "Time B"}`) e a tela
 * simplesmente **não o exibia** — justamente no caso em que ele é a informação
 * inteira: uma movimentação manual de jogador. Mostrar o JSON seria melhor que
 * nada; mostrar "Time 1 🔵 · ME → Time 2 🔴 · ATA" é o que o organizador
 * precisa para conferir o que mudou.
 *
 * Módulo puro (sem React) para ser testável e reaproveitável.
 */

export interface AuditFact {
  label: string;
  before?: string;
  after?: string;
  /** Valor único, quando a ação não é uma transição (ex.: sorteio realizado). */
  value?: string;
}

/** Rótulos dos campos que aparecem nos payloads. Um campo desconhecido não é
 * escondido: cai no rótulo cru, para a trilha nunca perder informação. */
const FIELD_LABELS: Record<string, string> = {
  team_name: "Time",
  team_id: "Time (id)",
  position_code: "Posição",
  position_name: "Posição",
  position_id: "Posição (id)",
  line_index: "Linha",
  slot_index: "Vaga na linha",
  formation: "Formação",
  status: "Situação",
  algorithm: "Algoritmo",
  trigger: "Origem",
  teams_count: "Times",
  players_count: "Jogadores",
  max_players: "Máximo de jogadores",
  moved_to_waitlist: "Movidos para a espera",
  total_score: "Score total",
  score_weakest_split: "Custo da separação dos piores",
  score_guest_balance: "Custo da distribuição de convidados",
  amount: "Valor",
  reference: "Competência",
  due_date: "Vencimento",
  waitlist_position: "Posição na fila",
  name: "Nome",
  role: "Perfil",
};

/** Campos que só interessam a quem depura, não ao organizador. */
const NOISE = new Set(["team_id", "position_id", "id", "player_id", "organization_id"]);

const VALUE_LABELS: Record<string, string> = {
  manual: "Manual",
  automatic: "Automático",
  confirmed: "Confirmado",
  declined: "Recusado",
  pending: "Pendente",
  drawn: "Sorteada",
  scheduled: "Agendada",
  canceled: "Cancelada",
  completed: "Concluída",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  const text = String(value);
  return VALUE_LABELS[text] ?? text;
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * Monta a lista de fatos de um registro.
 *
 * Campos presentes nos **dois** lados viram transição ("antes → depois"); os
 * que só existem em `after` viram valor único.
 */
export function describeAuditPayload(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditFact[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
    (key) => !NOISE.has(key),
  );

  return keys.map((key) => {
    const hasBefore = before && key in before;
    const hasAfter = after && key in after;

    if (hasBefore && hasAfter) {
      return {
        label: fieldLabel(key),
        before: formatValue(before[key]),
        after: formatValue(after[key]),
      };
    }
    return {
      label: fieldLabel(key),
      value: formatValue(hasAfter ? after[key] : before[key]),
    };
  });
}

/** Fatos que realmente mudaram — o resto é ruído numa trilha de conferência. */
export function changedFacts(facts: AuditFact[]): AuditFact[] {
  return facts.filter((fact) => fact.value !== undefined || fact.before !== fact.after);
}
