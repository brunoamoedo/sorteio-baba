export interface TeamPlayer {
  id: number;
  player_id: number;
  player_name: string;
  player_nickname: string;
  player_photo: string | null;
  player_type: "mensalista" | "convidado";
  position_snapshot: {
    id: number;
    code: string;
    name: string;
    sort_order: number;
    is_active: boolean;
  };
  skill_snapshot: number;
  used_secondary_position: boolean;
  /** Vaga no desenho da formação. Nulos = sorteio sem formação (ou anterior a
   * ela): o campo agrupa pelo `sort_order` da posição, como sempre fez. */
  line_index: number | null;
  slot_index: number | null;
}

export type TeamResultOutcome = "win" | "loss" | "draw";

export interface TeamResult {
  result: TeamResultOutcome;
  goals_scored: number | null;
  goals_conceded: number | null;
}

export interface Team {
  id: number;
  name: string;
  color: string;
  order_index: number;
  /** Formação **deste** time, no formato "2-2-2". Vazio = sem formação. */
  formation: string;
  total_skill: number;
  team_players: TeamPlayer[];
  result: TeamResult | null;
}

/** Quem disparou o sorteio: o botão da tela ou o agendamento automático. */
export type DrawTrigger = "manual" | "automatic";

export interface Draw {
  id: number;
  match: number;
  algorithm: string;
  trigger: DrawTrigger;
  /** Formação padrão escolhida no sorteio. Vazio = sorteio sem formação. */
  formation: string;
  weights: Record<string, number>;
  score_balance: number;
  score_position: number;
  score_repetition: number;
  /** Custo da separação dos piores e da distribuição de convidados. Vêm do
   * payload da auditoria do sorteio (não têm coluna própria em `Draw`) e são
   * nulos em sorteios anteriores ao registro desses critérios. */
  score_weakest_split: number | null;
  score_guest_balance: number | null;
  total_score: number;
  iterations_run: number;
  is_current: boolean;
  executed_by_name: string | null;
  created_at: string;
  teams: Team[];
}
