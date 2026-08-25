import type { Player } from "./player";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "Segunda-feira",
  1: "Terça-feira",
  2: "Quarta-feira",
  3: "Quinta-feira",
  4: "Sexta-feira",
  5: "Sábado",
  6: "Domingo",
};

export interface RecurringGame {
  id: number;
  name: string;
  weekday: Weekday;
  match_time: string;
  draw_time: string;
  teams_count: number;
  min_players_per_team_line: number;
  max_players_per_team_line: number;
  /** Goleiros reservados por time. **0** é o caso da pelada de goleiro fixo,
   * que não é sorteado — aí a partida conta só jogadores de linha. */
  goalkeepers_per_team: number;
  /** Calculado no backend: teams_count * (jogadores de linha + goleiros). */
  min_players: number;
  max_players: number;
  /** Antecedência (em dias) com que a próxima partida é criada. Padrão 7. */
  days_before_to_generate: number;
  is_active: boolean;
}

export type MatchStatus =
  | "scheduled"
  | "confirming"
  | "drawn"
  | "in_progress"
  | "completed"
  | "canceled";

/** Configuração efetiva da partida, calculada no backend. A interface **lê**
 * daqui em vez de recalcular times × (linha + goleiro) por conta própria. */
export interface MatchCapacity {
  teams_count: number;
  min_players: number;
  max_players: number;
  goalkeepers_per_team: number;
  line_players_per_team: number;
  total_goalkeepers: number;
  total_line_players: number;
}

/** Origem do agendamento que habilita o sorteio automático de uma partida. */
export type AutomaticDrawSource = "match" | "recurring_game";

/** Uma diferença entre a partida já gerada e a configuração **atual** do jogo
 * recorrente. Alterar o jogo recorrente não reescreve a partida (ela pode ter
 * confirmações e sorteio) — a divergência é sinalizada para o organizador
 * decidir se ajusta a partida ou mantém como está. */
export interface MatchDivergence {
  field: string;
  label: string;
  match_value: string;
  recurring_game_value: string;
}

export interface Match {
  id: number;
  recurring_game: number | null;
  /** Nome do jogo recorrente de origem, quando houver (somente leitura). */
  recurring_game_name: string | null;
  /** Identificação livre da partida — usado sobretudo em partidas avulsas. */
  name: string;
  location: string;
  notes: string;
  scheduled_date: string;
  scheduled_time: string;
  /** Horário do sorteio automático próprio da partida; quando nulo, herda o do jogo recorrente. */
  draw_time: string | null;
  /** Critério do sorteio automático, calculado no backend (a interface **lê**,
   * não deduz): `true` quando a partida tem agendamento válido — horário
   * próprio ou herdado do jogo recorrente. Partida avulsa sem horário de
   * sorteio vem `false` e só é sorteada pelo botão manual. */
  automatic_draw: boolean;
  /** De onde veio o agendamento, quando há: da própria partida ou do jogo recorrente. */
  automatic_draw_source: AutomaticDrawSource | null;
  /** Momento exato do sorteio automático (data da partida + horário efetivo). */
  automatic_draw_at: string | null;
  /** Horário efetivo do sorteio: o próprio da partida, senão o do jogo recorrente. */
  effective_draw_time: string | null;
  /** Preenchido só quando o sorteio automático **já venceu e não pôde rodar**
   * (na prática: mínimo de confirmados não atingido). É o que evita a partida
   * ficar parada sem explicação depois do horário. */
  automatic_draw_blocked_reason: string | null;
  teams_count: number;
  /** Goleiros reservados por time nesta partida (0 = goleiro fixo, fora do sorteio). */
  goalkeepers_per_team: number;
  min_players: number;
  max_players: number;
  capacity: MatchCapacity;
  /** Vazio quando a partida está alinhada (ou não veio de jogo recorrente). */
  recurring_game_divergences: MatchDivergence[];
  status: MatchStatus;
  draw_executed_at: string | null;
  confirmed_count: number;
  waitlist_count: number;
  created_at: string;
}

export type ConfirmationStatus = "confirmed" | "declined" | "pending";

export interface RosterEntry {
  player: Player;
  confirmation_status: ConfirmationStatus;
  /** Posição na lista de espera (1-based) ou `null` se não estiver na fila. */
  waitlist_position: number | null;
}

/** Resposta de `set-confirmation`. `waitlisted` avisa que a partida estava
 * cheia e o jogador entrou na fila em vez de ser confirmado. */
export interface SetConfirmationResult {
  player: number;
  status: ConfirmationStatus | "waitlisted";
  waitlisted: boolean;
  waitlist_position: number | null;
  promoted: { id: number; name: string }[];
  confirmed_count: number;
}

export interface WaitlistEntry {
  id: number;
  position: number;
  player_id: number;
  player_name: string;
  player_nickname: string;
  player_type: "mensalista" | "convidado";
  player_photo: string | null;
  joined_at: string;
}

export interface QuickConfirmResolution {
  /** A linha exatamente como foi colada — inclusive numeração e emojis. */
  input_name: string;
  /** O nome que sobrou depois de tirar numeração, emojis e anotações; é ele
   * que foi procurado entre os mensalistas. */
  parsed_name: string;
  /**
   * - `fora_da_lista`: linha marcada com 👋/❌ — relatada, mas **não** confirmada.
   * - `ja_confirmado`: o nome só se parece com quem **já está confirmado** na
   *   partida (lista colada duas vezes, ou duas linhas parecidas disputando o
   *   mesmo mensalista). Nada é alterado: nem reconfirma, nem cria convidado
   *   homônimo — a linha fica visível para o organizador resolver.
   */
  resolution: "mensalista" | "convidado_criado" | "fora_da_lista" | "ja_confirmado";
  confidence: number;
  /** Nulo nas linhas `fora_da_lista`, que não viram jogador nenhum. */
  player_id: number | null;
  player_name: string | null;
  player_type: "mensalista" | "convidado" | null;
  waitlisted: boolean;
  waitlist_position: number | null;
}

/** Pendência do dashboard — algo que espera ação do organizador. `kind` existe
 * para a interface escolher ícone e destino sem interpretar o texto. */
export interface DashboardPendingItem {
  kind: "draw_blocked" | "waitlist" | "below_minimum" | "divergence";
  message: string;
  match: number | null;
  severity: "info" | "warning";
}

/** Resumo financeiro da competência corrente. Vem `null` para quem não tem
 * `financial.view` — o dado nem sai do servidor. */
export interface DashboardFinance {
  reference: string;
  total_received: string;
  total_outstanding: string;
  balance: string;
}

export interface DashboardSummary {
  next_match: Match | null;
  /** A próxima partida é hoje — muda o que a tela destaca. */
  is_today: boolean;
  players: {
    ativos: number;
    mensalistas: number;
    convidados: number;
  };
  pending: DashboardPendingItem[];
  finance: DashboardFinance | null;
}


/** Partida do ponto de vista do jogador logado (`/matches/mine/`).
 *
 * `my_player_id` nulo significa que o login ainda não está vinculado a uma
 * ficha nesta organização — sem isso ele não consegue confirmar presença. */
export interface MyMatch extends Match {
  my_confirmation_status: ConfirmationStatus;
  my_player_id: number | null;
}

/** Um confirmado, como o jogador o vê.
 *
 * Enxuto de propósito: telefone, nível técnico e observações continuam
 * restritos ao roster do organizador. */
export interface ConfirmedPlayer {
  id: number;
  name: string;
  nickname: string;
  confirmed_at: string | null;
}

export interface ConfirmedList {
  confirmed: ConfirmedPlayer[];
  confirmed_count: number;
  max_players: number;
  min_players: number;
}
