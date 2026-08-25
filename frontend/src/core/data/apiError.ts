/**
 * Leitura das mensagens de erro da API.
 *
 * O backend voltou a devolver o formato nativo do DRF (`{"campo": ["msg"]}` ou
 * `{"detail": "msg"}`) — antes tudo era re-embrulhado em `{"detail": {...}}` e
 * nenhuma tela conseguia mostrar o motivo real, caindo sempre em textos como
 * "Não foi possível salvar. Confira os dados". Estas funções são o único ponto
 * do frontend que interpreta esse formato.
 */

interface ApiErrorShape {
  response?: { status?: number; data?: unknown };
}

const FIELD_LABELS: Record<string, string> = {
  non_field_errors: "",
  detail: "",
  teams_count: "Quantidade de times",
  min_players: "Mínimo de jogadores",
  max_players: "Máximo de jogadores",
  min_players_per_team_line: "Jogadores de linha (mínimo)",
  max_players_per_team_line: "Jogadores de linha (máximo)",
  scheduled_date: "Data",
  scheduled_time: "Horário",
  draw_time: "Horário do sorteio",
  name: "Nome",
  username: "Usuário",
  email: "E-mail",
  password: "Senha",
  // Sem estes dois, a recusa mais importante do primeiro acesso chegava à tela
  // como "new_password: A nova senha não pode ser a temporária."
  current_password: "Senha atual",
  new_password: "Nova senha",
  organization_name: "Nome da organização",
  primary_position: "Posição principal",
  secondary_position: "Posição secundária",
  player: "Jogador",
  position: "Posição na fila",
  days_before_to_generate: "Antecedência de geração",
};

function responseData(error: unknown): unknown {
  return (error as ApiErrorShape | null)?.response?.data;
}

export function getApiStatus(error: unknown): number | undefined {
  return (error as ApiErrorShape | null)?.response?.status;
}

function flatten(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flatten);
  return [String(value)];
}

/** Erros por campo, prontos para alimentar `setError` do react-hook-form. */
export function getApiFieldErrors(error: unknown): Record<string, string> {
  const data = responseData(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  const result: Record<string, string> = {};
  for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
    const messages = flatten(value);
    if (messages.length > 0) result[field] = messages[0];
  }
  return result;
}

/** Mensagem única e legível para Alert/toast. */
export function getApiErrorMessage(error: unknown, fallback = "Não foi possível concluir a operação."): string {
  const status = getApiStatus(error);
  if (status === 429) {
    return "Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.";
  }
  if (status === 403) {
    return "Você não tem permissão para esta ação.";
  }

  const data = responseData(error);
  if (typeof data === "string" && data.trim()) return data;

  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    const messages = entries.flatMap(([field, value]) => {
      const label = FIELD_LABELS[field] ?? field;
      return flatten(value).map((message) => (label ? `${label}: ${message}` : message));
    });
    if (messages.length > 0) return messages.join(" · ");
  }

  if (status === undefined && error instanceof Error && error.message) {
    return "Não foi possível falar com o servidor. Verifique sua conexão.";
  }

  return fallback;
}
