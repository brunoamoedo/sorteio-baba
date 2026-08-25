export interface PlayerStatistics {
  player_id: number;
  name: string;
  nickname: string;
  player_type: "mensalista" | "convidado";
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  presences: number;
  absences: number;
  avg_team_skill: number | null;
  last_match_date: string | null;
  days_since_last_match: number | null;
  longest_win_streak: number;
  longest_loss_streak: number;
  current_streak_type: "win" | "loss" | null;
  current_streak_length: number;
}
