export type AuditAction =
  | "draw_created"
  | "player_moved"
  | "confirmation_changed"
  | "waitlist_added"
  | "waitlist_promoted"
  | "match_created"
  | "match_updated"
  | "match_canceled"
  | "organization_created"
  | "organization_updated"
  | "membership_changed"
  | "charge_created"
  | "charge_canceled"
  | "payment_registered";

/** Rótulo de cada ação. O backend também manda `action_display`; este mapa
 * existe para o **filtro**, que precisa dos rótulos antes de haver registros. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  draw_created: "Sorteio realizado",
  player_moved: "Jogador movido entre times",
  confirmation_changed: "Confirmação alterada",
  waitlist_added: "Entrou na lista de espera",
  waitlist_promoted: "Promovido da lista de espera",
  match_created: "Partida criada",
  match_updated: "Partida alterada",
  match_canceled: "Partida cancelada",
  organization_created: "Organização criada",
  organization_updated: "Organização alterada",
  membership_changed: "Perfil de usuário alterado",
  charge_created: "Mensalidade lançada",
  charge_canceled: "Mensalidade cancelada",
  payment_registered: "Baixa de pagamento",
};

export interface AuditLogEntry {
  id: number;
  action: AuditAction;
  action_display: string;
  match: number | null;
  draw: number | null;
  user_username: string | null;
  player_name: string | null;
  team_from_name: string | null;
  team_to_name: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
  ip_address: string | null;
  created_at: string;
}
